const Checkin = require('../models/Checkin');
const User = require('../models/User');
const Section = require('../models/Section');
const Period = require('../models/Period');
const { success, errors } = require('../utils/response');
const logger = require('../utils/logger');
const { publishSyncEvent } = require('../services/sync.service');
const { dispatchNotificationWithSubscribe } = require('../services/user-notification.service');
const {
  ensurePeriodCommunityAccess,
  getCommunityAccessiblePeriodIds
} = require('../services/community-access.service');
const { getCurrentTenantId } = require('../utils/tenantContext');
const {
  buildCourseDetailTargetPage,
  formatNotificationTime
} = require('../utils/notification-links');
const { resolveTenantSlug } = require('../utils/tenantSlug');

function getRequestUserId(req) {
  return req.user?.id || req.user?.userId || req.user?._id;
}

function isNonEmptyNote(note) {
  return typeof note === 'string' && note.trim().length > 0;
}

const MAX_CHECKIN_NOTE_LENGTH = 3000;
const MAX_CHECKIN_IMAGE_COUNT = 9;
const MAX_CHECKIN_HTML_LENGTH = 20000;
const ALLOWED_CHECKIN_HTML_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'span',
  'div',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a'
]);
const ALLOWED_CHECKIN_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-align',
  'line-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-left',
  'border-left'
]);

function getPublicBaseUrl(req) {
  const configured = process.env.API_BASE_URL || '';
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const protocol = req.protocol || 'https';
  const host = req.get?.('host') || '';
  return host ? `${protocol}://${host}` : '';
}

function normalizeCheckinImages(images) {
  if (images === undefined || images === null) {
    return { value: [] };
  }

  if (!Array.isArray(images)) {
    return { error: '图片数据格式不正确' };
  }

  const normalized = [];
  for (const imageUrl of images) {
    if (typeof imageUrl !== 'string') {
      return { error: '图片地址必须是字符串' };
    }

    const trimmed = imageUrl.trim();
    if (trimmed) {
      normalized.push(trimmed);
    }
  }

  if (normalized.length > MAX_CHECKIN_IMAGE_COUNT) {
    return { error: `最多只能上传${MAX_CHECKIN_IMAGE_COUNT}张图片` };
  }

  return { value: normalized };
}

function buildEmptyUserCheckinPayload(page = 1, limit = 20) {
  return {
    list: [],
    stats: {
      diaryCount: 0,
      featuredCount: 0,
      likeCount: 0,
      totalCheckins: 0,
      consecutiveDays: 0
    },
    calendar: null,
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total: 0,
      pages: 0
    }
  };
}

function isNoteTooLong(note) {
  return typeof note === 'string' && note.length > MAX_CHECKIN_NOTE_LENGTH;
}

function decodeHtmlEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeHtmlAttribute(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function richTextHtmlToPlainText(html = '') {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeCheckinStyle(style = '') {
  return String(style || '')
    .split(';')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => {
      const separatorIndex = rule.indexOf(':');
      if (separatorIndex === -1) return '';

      const prop = rule.slice(0, separatorIndex).trim().toLowerCase();
      const value = rule.slice(separatorIndex + 1).trim();
      if (!ALLOWED_CHECKIN_STYLE_PROPS.has(prop)) return '';
      if (/expression\s*\(|url\s*\(|javascript:/i.test(value)) return '';

      return `${prop}:${value}`;
    })
    .filter(Boolean)
    .join(';');
}

function sanitizeCheckinHtml(contentHtml) {
  if (contentHtml === undefined || contentHtml === null) {
    return { value: null };
  }

  if (typeof contentHtml !== 'string') {
    return { error: '富文本内容格式不正确' };
  }

  if (contentHtml.length > MAX_CHECKIN_HTML_LENGTH) {
    return { error: `富文本内容不能超过${MAX_CHECKIN_HTML_LENGTH}字` };
  }

  let sanitized = contentHtml
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!doctype[\s\S]*?>/gi, '');

  sanitized = sanitized.replace(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g, (match, tagName, rawAttrs = '') => {
    const lowerTagName = tagName.toLowerCase();
    const isClosingTag = /^<\//.test(match);

    if (!ALLOWED_CHECKIN_HTML_TAGS.has(lowerTagName)) {
      return '';
    }

    if (isClosingTag) {
      return `</${lowerTagName}>`;
    }

    const attrs = [];
    const attrPattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(rawAttrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrValue = attrMatch[3] ?? attrMatch[4] ?? attrMatch[5] ?? '';

      if (attrName.startsWith('on')) continue;

      if (attrName === 'style') {
        const safeStyle = sanitizeCheckinStyle(attrValue);
        if (safeStyle) {
          attrs.push(`style="${escapeHtmlAttribute(safeStyle)}"`);
        }
        continue;
      }

      if (lowerTagName === 'a' && attrName === 'href') {
        const trimmedHref = String(attrValue).trim();
        if (/^(https?:\/\/|\/|#)/i.test(trimmedHref)) {
          attrs.push(`href="${escapeHtmlAttribute(trimmedHref)}"`);
        }
      }
    }

    const suffix = lowerTagName === 'br' ? ' /' : '';
    return `<${lowerTagName}${attrs.length ? ` ${attrs.join(' ')}` : ''}${suffix}>`;
  });

  return { value: sanitized.trim() || null };
}

function buildPeriodSummaryItem(checkin) {
  const period = checkin.periodId || {};

  return {
    periodId: String(period._id || checkin.periodId || 'unknown'),
    name: period.name || period.title || '未知期次',
    title: period.title || period.name || '未知期次',
    icon: period.icon || period.coverEmoji || '📚',
    coverEmoji: period.coverEmoji || period.icon || '📚',
    coverColor: period.coverColor || 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
    color: period.coverColor || 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
    currentEnrollment: period.currentEnrollment || period.enrollmentCount || 0,
    totalDays: period.totalDays || 0,
    totalCheckins: 0,
    checkedDays: 0,
    diaryCount: 0,
    likeCount: 0,
    lastCheckinAt: null,
    lastCheckinSection: null,
    lastCheckinDay: null,
    status: period.status || null
  };
}

function buildUserDiarySummary(checkins = []) {
  const stats = {
    diaryCount: 0,
    likeCount: 0,
    totalCheckins: checkins.length,
    periodCount: 0
  };

  const periodMap = new Map();

  for (const checkin of checkins) {
    const periodKey = String(
      (checkin.periodId && checkin.periodId._id) || checkin.periodId || 'unknown'
    );

    let summary = periodMap.get(periodKey);
    if (!summary) {
      summary = buildPeriodSummaryItem(checkin);
      periodMap.set(periodKey, summary);
    }

    summary.totalCheckins += 1;
    summary.checkedDays += 1;
    summary.likeCount += checkin.likeCount || 0;

    if (isNonEmptyNote(checkin.note)) {
      summary.diaryCount += 1;
      stats.diaryCount += 1;
    }

    stats.likeCount += checkin.likeCount || 0;

    const checkinTime = checkin.checkinDate ? new Date(checkin.checkinDate) : null;
    if (checkinTime && (!summary.lastCheckinAt || checkinTime > summary.lastCheckinAt)) {
      summary.lastCheckinAt = checkinTime;
      summary.lastCheckinSection = checkin.sectionId
        ? {
            sectionId: String(checkin.sectionId._id || checkin.sectionId),
            title: checkin.sectionId.title || '课程',
            day: checkin.sectionId.day ?? null
          }
        : null;
      summary.lastCheckinDay = checkin.day ?? null;
    }
  }

  const periods = Array.from(periodMap.values()).sort((a, b) => {
    const aTime = a.lastCheckinAt ? new Date(a.lastCheckinAt).getTime() : 0;
    const bTime = b.lastCheckinAt ? new Date(b.lastCheckinAt).getTime() : 0;
    return bTime - aTime;
  });

  stats.periodCount = periods.length;

  return {
    stats,
    periods
  };
}

// 创建打卡记录
async function createCheckin(req, res, next) {
  try {
    const { periodId, sectionId, day, readingTime, completionRate, note, contentHtml, images, mood, isPublic } =
      req.body;
    const normalizedNote =
      note === undefined && contentHtml ? richTextHtmlToPlainText(contentHtml) : note;

    // JWT payload from admin controller uses 'id', from auth uses 'userId'
    const userId = getRequestUserId(req);

    // 验证课程存在
    const section = await Section.findById(sectionId);
    if (!section) {
      return res.status(404).json(errors.notFound('课程不存在'));
    }

    if (isNoteTooLong(normalizedNote)) {
      return res
        .status(400)
        .json(errors.badRequest(`打卡内容不能超过${MAX_CHECKIN_NOTE_LENGTH}字`));
    }

    const sanitizedContentHtml = sanitizeCheckinHtml(contentHtml);
    if (sanitizedContentHtml.error) {
      return res.status(400).json(errors.badRequest(sanitizedContentHtml.error));
    }

    const normalizedImages = normalizeCheckinImages(images);
    if (normalizedImages.error) {
      return res.status(400).json(errors.badRequest(normalizedImages.error));
    }

    const hasCommunityAccess = await ensurePeriodCommunityAccess(res, userId, periodId);
    if (!hasCommunityAccess) {
      return;
    }

    // 规范化checkinDate为当天的00:00:00（仅用于连续打卡计算）
    const now = new Date();
    const checkinDateNormalized = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 创建打卡记录
    // 注意：不再限制每日一次打卡，checkinDate使用当前精确时间
    const checkin = await Checkin.create({
      userId,
      periodId,
      sectionId,
      day,
      checkinDate: now,
      readingTime: readingTime || 0,
      completionRate: completionRate || 100,
      note: normalizedNote,
      contentHtml: sanitizedContentHtml.value,
      images: normalizedImages.value,
      mood,
      points: 10,
      isPublic: isPublic !== undefined ? isPublic : true,
      tenantId: getCurrentTenantId()
    });

    // 原子更新累计统计，防止并发打卡时数值被覆盖
    await User.findByIdAndUpdate(userId, {
      $inc: { totalCheckinDays: 1, totalPoints: 10 }
    });

    // 计算连续打卡天数：检查前一天是否打卡
    const yesterday = new Date(checkinDateNormalized);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStart = new Date(yesterday);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const yesterdayCheckin = await Checkin.findOne({
      userId,
      checkinDate: {
        $gte: yesterdayStart,
        $lte: yesterdayEnd
      }
    });

    // 读取最新用户数据计算 streak（$inc 已更新，这里只需要 streak 字段）
    const user = await User.findById(userId).select('currentStreak maxStreak');

    // 用户可能在打卡过程中被删除，跳过 streak 更新避免崩溃
    if (user) {
      // 如果昨天有打卡，连续天数 +1；否则重置为 1
      const newStreak = yesterdayCheckin ? (user.currentStreak || 0) + 1 : 1;
      const newMaxStreak = Math.max(user.maxStreak || 0, newStreak);

      await User.findByIdAndUpdate(userId, {
        currentStreak: newStreak,
        maxStreak: newMaxStreak
      });
    }

    // 更新课节的打卡人数统计
    logger.debug('Updating Section.checkinCount', {
      sectionId: section._id,
      beforeCount: section.checkinCount
    });
    section.checkinCount = (section.checkinCount || 0) + 1;
    logger.debug('Section.checkinCount after update', {
      sectionId: section._id,
      afterCount: section.checkinCount
    });

    try {
      await section.save();
      logger.debug('Section save successful', { sectionId: section._id });

      // 验证保存结果
      const verifySection = await Section.findById(section._id);
      logger.debug('Section save verified', {
        sectionId: section._id,
        checkinCount: verifySection.checkinCount
      });
    } catch (saveError) {
      logger.error('Section save failed', saveError, { sectionId: section._id });
    }

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'create',
      collection: 'checkins',
      documentId: checkin._id.toString(),
      data: checkin.toObject()
    });

    res.status(201).json(
      success(
        checkin,
        '打卡成功'
      )
    );
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json(errors.badRequest('今日已打卡'));
    }
    next(error);
  }
}

// 上传打卡图片
async function uploadCheckinImage(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json(errors.badRequest('请选择要上传的图片'));
    }

    const tenantId = req._resolvedTenantId || req.user?.tenantId || getCurrentTenantId();
    const slug = req._checkinUploadTenantSlug || (tenantId ? await resolveTenantSlug(tenantId) : '');
    if (!slug) {
      return res.status(400).json(errors.badRequest('缺少租户上下文'));
    }

    const relativeUrl = `/uploads/tenants/${slug}/checkins/${req.file.filename}`;
    const publicBaseUrl = getPublicBaseUrl(req);

    res.json(success({
      url: publicBaseUrl ? `${publicBaseUrl}${relativeUrl}` : relativeUrl,
      path: relativeUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    }, '图片上传成功'));
  } catch (error) {
    next(error);
  }
}

// 获取打卡列表（支持按periodId过滤）
async function getCheckins(req, res, next) {
  try {
    const { periodId, page = 1, limit = 20 } = req.query;
    const userId = getRequestUserId(req);

    const query = {};
    if (periodId) {
      const hasCommunityAccess = await ensurePeriodCommunityAccess(res, userId, periodId);
      if (!hasCommunityAccess) return;
      query.periodId = periodId;
    } else {
      const accessiblePeriodIds = await getCommunityAccessiblePeriodIds(userId);
      if (accessiblePeriodIds.length === 0) {
        const response = success([]);
        response.pagination = {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: 0,
          totalPages: 0
        };
        return res.json(response);
      }
      query.periodId = { $in: accessiblePeriodIds };
    }

    const total = await Checkin.countDocuments(query);
    const checkins = await Checkin.find(query)
      .populate('userId', 'nickname avatar avatarUrl')
      .populate('sectionId', 'title day')
      .populate('likes.userId', 'nickname avatar avatarUrl')
      .sort({ createdAt: -1 })
      .skip((parseInt(page, 10) - 1) * parseInt(limit, 10))
      .limit(parseInt(limit, 10))
      .select('-__v');

    // 返回带分页信息的响应
    const response = success(checkins);
    response.pagination = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      totalPages: Math.ceil(total / parseInt(limit, 10))
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// 获取用户的打卡列表（包含统计和日历数据）
async function getUserCheckins(req, res, next) {
  try {
    const { page = 1, limit = 20, periodId, year, month } = req.query;
    // 强制使用当前登录用户，防止 IDOR 越权读取他人打卡记录
    const userId = req.user.userId;
    const requestUserId = getRequestUserId(req);

    const query = { userId };
    if (periodId) {
      const hasCommunityAccess = await ensurePeriodCommunityAccess(res, requestUserId, periodId);
      if (!hasCommunityAccess) return;
      query.periodId = periodId;
    } else {
      const accessiblePeriodIds = await getCommunityAccessiblePeriodIds(requestUserId);
      if (accessiblePeriodIds.length === 0) {
        return res.json(success(buildEmptyUserCheckinPayload(page, limit)));
      }
      query.periodId = { $in: accessiblePeriodIds };
    }

    // 获取打卡列表
    const total = await Checkin.countDocuments(query);
    const checkins = await Checkin.find(query)
      .populate('userId', 'nickname avatar avatarUrl')
      .populate('sectionId', 'title day icon')
      .populate('periodId', 'name title')
      .populate('likes.userId', 'nickname avatar avatarUrl')
      .sort({ checkinDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select('-__v');

    // 计算统计数据
    const stats = {
      diaryCount: 0, // 日记总数（有内容的打卡）
      featuredCount: 0, // 精选次数
      likeCount: 0, // 获赞总数
      totalCheckins: 0, // 总打卡次数
      consecutiveDays: 0 // 连续打卡天数（待计算）
    };

    // 统计所有打卡记录
    const allCheckins = await Checkin.find(query).select('note likeCount isFeatured checkinDate');

    stats.diaryCount = allCheckins.filter(c => c.note && c.note.trim().length > 0).length;
    stats.featuredCount = allCheckins.filter(c => c.isFeatured).length;
    stats.likeCount = allCheckins.reduce((sum, c) => sum + (c.likeCount || 0), 0);
    stats.totalCheckins = allCheckins.length;

    // 计算连续打卡天数
    // ✅ Bug修复：从最新打卡日期开始计算，而不是从今天开始
    if (allCheckins.length > 0) {
      const sortedCheckins = allCheckins.sort((a, b) => b.checkinDate - a.checkinDate);
      let consecutive = 0;

      // 从最新打卡日期开始计算
      let expectedDate = new Date(sortedCheckins[0].checkinDate);
      expectedDate.setHours(0, 0, 0, 0);

      for (const checkin of sortedCheckins) {
        const checkinDateNormalized = new Date(checkin.checkinDate);
        checkinDateNormalized.setHours(0, 0, 0, 0);

        if (expectedDate.getTime() === checkinDateNormalized.getTime()) {
          consecutive++;
          expectedDate.setDate(expectedDate.getDate() - 1);
        } else {
          break;
        }
      }
      stats.consecutiveDays = consecutive;
    }

    // 如果提供了year和month，计算日历数据
    let calendar = null;
    if (year && month) {
      const targetYear = parseInt(year);
      const targetMonth = parseInt(month);

      // 获取指定月份的所有打卡日期
      const monthStart = new Date(targetYear, targetMonth - 1, 1);
      const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

      const monthCheckins = await Checkin.find({
        ...query,
        checkinDate: {
          $gte: monthStart,
          $lte: monthEnd
        }
      }).select('checkinDate');

      // 提取打卡的日期（仅日期部分）
      const checkinDays = monthCheckins.map(c => new Date(c.checkinDate).getDate());

      calendar = {
        year: targetYear,
        month: targetMonth,
        checkinDays: [...new Set(checkinDays)].sort((a, b) => a - b)
      };
    }

    res.json(
      success({
        list: checkins,
        stats,
        calendar,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      })
    );
  } catch (error) {
    next(error);
  }
}

// 获取用户的打卡日记聚合信息（顶部统计 + 期次聚合）
async function getUserCheckinSummary(req, res, next) {
  try {
    const userId = req.params.userId || req.user.userId || req.user.id || req.user._id;
    const requestUserId = getRequestUserId(req);
    const accessiblePeriodIds = await getCommunityAccessiblePeriodIds(requestUserId);

    if (accessiblePeriodIds.length === 0) {
      const summary = buildUserDiarySummary([]);
      return res.json(
        success({
          userId,
          stats: summary.stats,
          periods: summary.periods
        })
      );
    }

    const checkins = await Checkin.find({
      userId,
      periodId: { $in: accessiblePeriodIds }
    })
      .populate('periodId', 'name title icon coverColor coverEmoji currentEnrollment enrollmentCount totalDays status')
      .populate('sectionId', 'title day')
      .populate('likes.userId', 'nickname avatar avatarUrl')
      .sort({ checkinDate: -1 })
      .select('-__v');

    const summary = buildUserDiarySummary(checkins);

    res.json(
      success({
        userId,
        stats: summary.stats,
        periods: summary.periods
      })
    );
  } catch (error) {
    next(error);
  }
}

// 获取期次的打卡列表（广场）
async function getPeriodCheckins(req, res, next) {
  try {
    const { periodId } = req.params;
    const { page = 1, limit = 20, day, sectionId } = req.query;

    // 验证期次存在
    const period = await Period.findById(periodId);
    if (!period) {
      return res.json(success([])); // 返回空数组而不是404
    }

    const hasCommunityAccess = await ensurePeriodCommunityAccess(
      res,
      getRequestUserId(req),
      periodId
    );
    if (!hasCommunityAccess) return;

    const query = {
      periodId,
      isPublic: true
    };

    if (sectionId) {
      query.sectionId = sectionId;
    }

    // 按日期筛选
    if (day) {
      query.day = parseInt(day, 10);
    }

    const total = await Checkin.countDocuments(query);
    const checkins = await Checkin.find(query)
      .populate('userId', 'nickname avatar avatarUrl')
      .populate('sectionId', 'title day')
      .populate('likes.userId', 'nickname avatar avatarUrl')
      .sort({ createdAt: -1 })
      .skip((parseInt(page, 10) - 1) * parseInt(limit, 10))
      .limit(parseInt(limit, 10))
      .select('-__v');

    // 返回带分页信息的响应
    const response = success(checkins);
    response.pagination = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      totalPages: Math.ceil(total / parseInt(limit, 10)),
      hasNext: parseInt(page, 10) * parseInt(limit, 10) < total
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// 获取打卡详情
async function getCheckinDetail(req, res, next) {
  try {
    const { checkinId } = req.params;
    const requestUserId = getRequestUserId(req);

    const checkin = await Checkin.findById(checkinId)
      .populate('userId', 'nickname avatar avatarUrl signature')
      .populate('sectionId', 'title day icon')
      .populate('periodId', 'name title')
      .populate('likes.userId', 'nickname avatar avatarUrl');

    if (!checkin) {
      return res.status(404).json(errors.notFound('打卡记录不存在'));
    }

    if (checkin.isPublic === false) {
      if (requestUserId) {
        const hasCommunityAccess = await ensurePeriodCommunityAccess(
          res,
          requestUserId,
          checkin.periodId?._id || checkin.periodId
        );
        if (!hasCommunityAccess) return;
      } else {
        return res.status(403).json(errors.forbidden('该打卡仅登录用户可见'));
      }
    }

    const checkinObj = checkin.toObject();

    // populate('likes.userId') 可能因为存储类型问题而失败（userId 存为字符串而非 ObjectId）
    // 手动补充：对 populate 失败的 like 重新查询用户信息
    const unpopulatedIds = checkinObj.likes
      .filter(l => l.userId && typeof l.userId !== 'object')
      .map(l => String(l.userId));

    if (unpopulatedIds.length > 0) {
      const likers = await User.find({ _id: { $in: unpopulatedIds } })
        .select('nickname avatar avatarUrl')
        .lean();
      const likerMap = {};
      likers.forEach(u => { likerMap[String(u._id)] = u; });
      checkinObj.likes = checkinObj.likes.map(like => {
        if (like.userId && typeof like.userId !== 'object') {
          return { ...like, userId: likerMap[String(like.userId)] || like.userId };
        }
        return like;
      });
    }

    res.json(success(checkinObj));
  } catch (error) {
    next(error);
  }
}

// 更新打卡记录
async function updateCheckin(req, res, next) {
  try {
    const { checkinId } = req.params;
    const userId = req.user.userId;
    const { note, contentHtml, images, readingTime, mood, isPublic, completionRate } = req.body;
    const normalizedNote =
      note === undefined && contentHtml !== undefined
        ? richTextHtmlToPlainText(contentHtml)
        : note;

    const checkin = await Checkin.findById(checkinId);

    if (!checkin) {
      return res.status(404).json(errors.notFound('打卡记录不存在'));
    }

    // 只能更新自己的打卡
    if (checkin.userId.toString() !== userId) {
      return res.status(403).json(errors.forbidden('无权更新'));
    }

    if (isNoteTooLong(normalizedNote)) {
      return res
        .status(400)
        .json(errors.badRequest(`打卡内容不能超过${MAX_CHECKIN_NOTE_LENGTH}字`));
    }

    let sanitizedContentHtml;
    if (contentHtml !== undefined) {
      sanitizedContentHtml = sanitizeCheckinHtml(contentHtml);
      if (sanitizedContentHtml.error) {
        return res.status(400).json(errors.badRequest(sanitizedContentHtml.error));
      }
    }

    let normalizedImages;
    if (images !== undefined) {
      normalizedImages = normalizeCheckinImages(images);
      if (normalizedImages.error) {
        return res.status(400).json(errors.badRequest(normalizedImages.error));
      }
    }

    // 更新允许的字段
    if (normalizedNote !== undefined) checkin.note = normalizedNote;
    if (contentHtml !== undefined) checkin.contentHtml = sanitizedContentHtml.value;
    if (images !== undefined) checkin.images = normalizedImages.value;
    if (readingTime !== undefined) checkin.readingTime = readingTime;
    if (mood !== undefined) checkin.mood = mood;
    if (isPublic !== undefined) checkin.isPublic = isPublic;
    if (completionRate !== undefined) checkin.completionRate = completionRate;

    await checkin.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'update',
      collection: 'checkins',
      documentId: checkin._id.toString(),
      data: checkin.toObject()
    });

    res.json(success(checkin, '打卡更新成功'));
  } catch (error) {
    next(error);
  }
}

// 删除打卡记录
async function deleteCheckin(req, res, next) {
  try {
    const { checkinId } = req.params;
    const userId = req.user.userId;

    const checkin = await Checkin.findById(checkinId);

    if (!checkin) {
      return res.status(404).json(errors.notFound('打卡记录不存在'));
    }

    // 只能删除自己的打卡
    if (checkin.userId.toString() !== userId) {
      return res.status(403).json(errors.forbidden('无权删除'));
    }

    // 保存打卡信息用于同步
    const checkinData = checkin.toObject();

    await Checkin.findByIdAndDelete(checkinId);

    // 更新用户统计
    const user = await User.findById(userId);
    user.totalCheckinDays = Math.max(0, user.totalCheckinDays - 1);
    user.totalPoints = Math.max(0, user.totalPoints - checkin.points);
    await user.save();

    // 更新课节打卡计数
    await Section.findByIdAndUpdate(checkin.sectionId, {
      $inc: { checkinCount: -1 }
    });

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'delete',
      collection: 'checkins',
      documentId: checkin._id.toString(),
      data: checkinData
    });

    res.json(success(null, '打卡删除成功'));
  } catch (error) {
    next(error);
  }
}

// 【Admin】获取所有打卡记录（后台管理）
async function getAdminCheckins(req, res, next) {
  try {
    const { page = 1, limit = 20, userId, periodId, dateFrom, dateTo, search } = req.query;

    const query = {};

    // 按用户筛选
    if (userId) {
      query.userId = userId;
    }

    // 按期次筛选
    if (periodId) {
      query.periodId = periodId;
    }

    // 按日期范围筛选
    if (dateFrom || dateTo) {
      query.checkinDate = {};
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        query.checkinDate.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        query.checkinDate.$lte = toDate;
      }
    }

    // 按用户名或用户ID搜索
    if (search) {
      const searchUsers = await User.find({
        $or: [
          { nickname: { $regex: search, $options: 'i' } },
          { openid: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = searchUsers.map(u => u._id);
      if (userIds.length > 0) {
        query.userId = { $in: userIds };
      } else {
        // 搜索无结果
        return res.json(
          success({
            list: [],
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: 0,
              pages: 0
            },
            stats: {
              totalCount: 0,
              todayCount: 0,
              uniqueUserCount: 0,
              totalPoints: 0
            }
          })
        );
      }
    }

    // 获取总数
    const total = await Checkin.countDocuments(query);

    // 获取打卡列表
    const checkins = await Checkin.find(query)
      .populate('userId', 'nickname avatar avatarUrl openid')
      .populate('sectionId', 'title day')
      .populate('periodId', 'name title')
      .populate('likes.userId', 'nickname avatar avatarUrl')
      .sort({ checkinDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select('-__v');

    // 计算统计信息
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayCount = await Checkin.countDocuments({
      checkinDate: {
        $gte: today,
        $lt: tomorrow
      }
    });

    // 用 aggregate 替代全量 find + reduce，避免把所有记录 load 进内存
    const [statsResult, uniqueUsers] = await Promise.all([
      Checkin.aggregate([
        { $match: query },
        { $group: { _id: null, totalPoints: { $sum: '$points' } } }
      ]),
      Checkin.distinct('userId', query)
    ]);
    const totalPoints = statsResult[0]?.totalPoints ?? 0;

    res.json(
      success({
        list: checkins,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        stats: {
          totalCount: total,
          todayCount,
          uniqueUserCount: uniqueUsers.length,
          totalPoints
        }
      })
    );
  } catch (error) {
    next(error);
  }
}

// 【Admin】删除打卡记录（管理员可删除任何记录）
async function updateAdminCheckin(req, res, next) {
  try {
    const { checkinId } = req.params;
    const { note, contentHtml, isPublic } = req.body;
    const normalizedNote =
      note === undefined && contentHtml !== undefined
        ? richTextHtmlToPlainText(contentHtml)
        : note;

    const checkin = await Checkin.findById(checkinId);
    if (!checkin) {
      return res.status(404).json(errors.notFound('打卡记录不存在'));
    }

    if (isNoteTooLong(normalizedNote)) {
      return res
        .status(400)
        .json(errors.badRequest(`打卡内容不能超过${MAX_CHECKIN_NOTE_LENGTH}字`));
    }

    let sanitizedContentHtml;
    if (contentHtml !== undefined) {
      sanitizedContentHtml = sanitizeCheckinHtml(contentHtml);
      if (sanitizedContentHtml.error) {
        return res.status(400).json(errors.badRequest(sanitizedContentHtml.error));
      }
    }

    if (normalizedNote !== undefined) checkin.note = normalizedNote;
    if (contentHtml !== undefined) checkin.contentHtml = sanitizedContentHtml.value;
    if (isPublic !== undefined) checkin.isPublic = isPublic;

    await checkin.save();

    publishSyncEvent({
      type: 'update',
      collection: 'checkins',
      documentId: checkin._id.toString(),
      data: checkin.toObject()
    });

    res.json(success(checkin, '打卡记录已更新'));
  } catch (error) {
    next(error);
  }
}

async function deleteAdminCheckin(req, res, next) {
  try {
    const { checkinId } = req.params;

    const checkin = await Checkin.findById(checkinId);

    if (!checkin) {
      return res.status(404).json(errors.notFound('打卡记录不存在'));
    }

    // 保存打卡信息用于同步
    const checkinData = checkin.toObject();

    // 更新用户统计
    const user = await User.findById(checkin.userId);
    if (user) {
      user.totalCheckinDays = Math.max(0, user.totalCheckinDays - 1);
      user.totalPoints = Math.max(0, user.totalPoints - (checkin.points || 0));
      await user.save();
    }

    // 更新课节统计
    const section = await Section.findById(checkin.sectionId);
    if (section) {
      section.checkinCount = Math.max(0, (section.checkinCount || 1) - 1);
      await section.save();
    }

    // 删除打卡记录
    await Checkin.findByIdAndDelete(checkinId);

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'delete',
      collection: 'checkins',
      documentId: checkin._id.toString(),
      data: checkinData
    });

    res.json(success(null, '打卡记录已删除'));
  } catch (error) {
    next(error);
  }
}

// 【Admin】获取打卡统计数据
async function getCheckinStats(req, res, next) {
  try {
    const { periodId, dateFrom, dateTo } = req.query;

    const query = {};

    if (periodId) {
      query.periodId = periodId;
    }

    // 按日期范围筛选
    if (dateFrom || dateTo) {
      query.checkinDate = {};
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        query.checkinDate.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        query.checkinDate.$lte = toDate;
      }
    }

    // 总统计
    const totalCount = await Checkin.countDocuments(query);
    const uniqueUsers = await Checkin.distinct('userId', query);

    // 使用聚合计算总积分和总点赞数，避免加载所有文档
    const statsAggregation = await Checkin.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalPoints: { $sum: '$points' },
          totalLikes: { $sum: '$likeCount' },
          featuredCount: {
            $sum: { $cond: [{ $eq: ['$isFeatured', true] }, 1, 0] }
          }
        }
      }
    ]);

    const stats =
      statsAggregation.length > 0
        ? statsAggregation[0]
        : {
          totalPoints: 0,
          totalLikes: 0,
          featuredCount: 0
        };

    // 今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayCount = await Checkin.countDocuments({
      ...query,
      checkinDate: {
        $gte: today,
        $lt: tomorrow
      }
    });

    res.json(
      success({
        totalCount,
        todayCount,
        uniqueUserCount: uniqueUsers.length,
        totalPoints: stats.totalPoints,
        totalLikes: stats.totalLikes,
        featuredCount: stats.featuredCount,
        averagePointsPerUser:
          uniqueUsers.length > 0 ? (stats.totalPoints / uniqueUsers.length).toFixed(2) : 0
      })
    );
  } catch (error) {
    next(error);
  }
}

// 点赞打卡记录
async function likeCheckin(req, res, next) {
  try {
    const { checkinId } = req.params;
    const userId = getRequestUserId(req);

    const checkin = await Checkin.findById(checkinId);
    if (!checkin) {
      return res.status(404).json(errors.notFound('打卡记录不存在'));
    }

    const hasCommunityAccess = await ensurePeriodCommunityAccess(res, userId, checkin.periodId);
    if (!hasCommunityAccess) {
      return;
    }

    const alreadyLiked = checkin.likes && checkin.likes.some(like => like.userId.toString() === userId);
    if (alreadyLiked) {
      return res.status(400).json(errors.badRequest('已经点过赞了'));
    }

    if (!checkin.likes) checkin.likes = [];
    checkin.likes.push({ userId, createdAt: new Date() });
    checkin.likeCount = checkin.likes.length;
    await checkin.save();

    const checkinOwnerId = checkin.userId?.toString?.() || String(checkin.userId);
    if (checkinOwnerId !== userId) {
      try {
        const actorUser = await User.findById(userId).select('nickname avatar avatarUrl').lean();
        const targetPage = buildCourseDetailTargetPage(checkin.sectionId, {
          focus: 'comments',
          checkinId: checkin._id
        });

        await dispatchNotificationWithSubscribe(req, {
          recipientUserId: checkinOwnerId,
          notificationType: 'like_received',
          title: '收到新的点赞',
          content: `${actorUser?.nickname || '有人'} 点赞了你的打卡`,
          scene: 'like_received',
          targetPage,
          senderId: userId,
          data: {
            senderName: actorUser?.nickname,
            senderAvatar: actorUser?.avatarUrl || '',
            sectionId: checkin.sectionId.toString(),
            checkinId: checkin._id.toString(),
            commentId: null,
            replyId: null
          },
          subscribeFields: {
            likeUser: actorUser?.nickname || '用户',
            likeTime: formatNotificationTime(new Date())
          },
          sourceType: 'checkin_like',
          sourceId: checkin._id
        });
      } catch (notifyError) {
        logger.warn('打卡点赞通知发送失败', {
          message: notifyError.message,
          checkinId: checkin._id.toString()
        });
      }
    }

    res.json(success({ likeCount: checkin.likeCount }, '点赞成功'));
  } catch (error) {
    next(error);
  }
}

// 取消点赞打卡记录
async function unlikeCheckin(req, res, next) {
  try {
    const { checkinId } = req.params;
    const userId = getRequestUserId(req);

    const checkin = await Checkin.findById(checkinId);
    if (!checkin) {
      return res.status(404).json(errors.notFound('打卡记录不存在'));
    }

    const hasCommunityAccess = await ensurePeriodCommunityAccess(res, userId, checkin.periodId);
    if (!hasCommunityAccess) {
      return;
    }

    const likeIndex = checkin.likes ? checkin.likes.findIndex(like => like.userId.toString() === userId) : -1;
    if (likeIndex === -1) {
      return res.status(400).json(errors.badRequest('未点赞'));
    }

    checkin.likes.splice(likeIndex, 1);
    checkin.likeCount = checkin.likes.length;
    await checkin.save();

    res.json(success({ likeCount: checkin.likeCount }, '取消点赞成功'));
  } catch (error) {
    next(error);
  }
}

// 搜索期次内的打卡（按笔记关键词）
async function searchCheckins(req, res, next) {
  try {
    const { periodId, keyword, limit: limitParam = 50 } = req.query;

    if (!periodId) {
      return res.status(400).json({ code: 400, message: 'periodId 不能为空' });
    }

    const trimmedKeyword = (keyword || '').trim();
    if (!trimmedKeyword) {
      return res.status(400).json({ code: 400, message: '请输入搜索关键词' });
    }

    const limit = Math.min(parseInt(limitParam, 10) || 50, 100);

    // 验证期次存在
    const period = await Period.findById(periodId);
    if (!period) {
      return res.json(success({ list: [], total: 0, keyword: trimmedKeyword }));
    }

    const hasCommunityAccess = await ensurePeriodCommunityAccess(
      res,
      getRequestUserId(req),
      periodId
    );
    if (!hasCommunityAccess) return;

    const query = {
      periodId,
      isPublic: true,
      note: { $regex: trimmedKeyword, $options: 'i' }
    };

    const checkins = await Checkin.find(query)
      .populate('userId', 'nickname avatar avatarUrl')
      .populate('sectionId', 'title day')
      .populate('likes.userId', 'nickname avatar avatarUrl')
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-__v');

    res.json(success({ list: checkins, total: checkins.length, keyword: trimmedKeyword }));
  } catch (error) {
    next(error);
  }
}

async function searchMyCheckins(req, res, next) {
  try {
    const { periodId, keyword, limit: limitParam = 50 } = req.query;
    const userId = getRequestUserId(req);

    const trimmedKeyword = (keyword || '').trim();
    if (!trimmedKeyword) {
      return res.status(400).json({ code: 400, message: '请输入搜索关键词' });
    }

    const limit = Math.min(parseInt(limitParam, 10) || 50, 100);

    const query = {
      userId,
      note: { $regex: trimmedKeyword, $options: 'i' }
    };

    if (periodId) {
      const hasCommunityAccess = await ensurePeriodCommunityAccess(res, userId, periodId);
      if (!hasCommunityAccess) return;
      query.periodId = periodId;
    } else {
      const accessiblePeriodIds = await getCommunityAccessiblePeriodIds(userId);
      if (accessiblePeriodIds.length === 0) {
        return res.json(success({ list: [], total: 0, keyword: trimmedKeyword }));
      }
      query.periodId = { $in: accessiblePeriodIds };
    }

    const checkins = await Checkin.find(query)
      .populate('sectionId', 'title day')
      .populate('periodId', 'name title')
      .sort({ checkinDate: -1 })
      .limit(limit)
      .select('-__v');

    res.json(success({ list: checkins, total: checkins.length, keyword: trimmedKeyword }));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createCheckin,
  getCheckins,
  getUserCheckins,
  getUserCheckinSummary,
  getPeriodCheckins,
  searchCheckins,
  searchMyCheckins,
  uploadCheckinImage,
  getCheckinDetail,
  updateCheckin,
  deleteCheckin,
  likeCheckin,
  unlikeCheckin,
  // Admin functions
  getAdminCheckins,
  updateAdminCheckin,
  deleteAdminCheckin,
  getCheckinStats
};
