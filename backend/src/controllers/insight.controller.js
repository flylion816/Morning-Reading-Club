const Insight = require('../models/Insight');
const InsightDanmaku = require('../models/InsightDanmaku');
const Checkin = require('../models/Checkin');
const InsightRequest = require('../models/InsightRequest');
const User = require('../models/User');
const Enrollment = require('../models/Enrollment');
const Period = require('../models/Period');
const Section = require('../models/Section');
const { success, errors } = require('../utils/response');
const { createNotification, createNotifications } = require('./notification.controller');
const logger = require('../utils/logger');
const { publishSyncEvent } = require('../services/sync.service');
const { dispatchNotificationWithSubscribe } = require('../services/user-notification.service');
const {
  buildInsightApprovalTargetPage,
  buildInsightDetailTargetPage,
  buildProfileOthersTargetPage,
  formatNotificationTime,
  truncateText
} = require('../utils/notification-links');
const { getCurrentTenantId } = require('../utils/tenantContext');

const ADMIN_ROLES = [
  'platform_superadmin',
  'superadmin',
  'super_admin',
  'tenant_admin',
  'admin',
  'operator'
];
const MAX_DANMAKU_CONTENT_LENGTH = 60;

function countUnicodeChars(value) {
  const content = String(value || '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(content)).length;
  }
  return Array.from(content).length;
}

function getTimeValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getInsightPeriodSortTime(insight) {
  const period = insight?.periodId || {};
  return getTimeValue(period.endDate || period.startDate);
}

function getInsightDaySortValue(insight) {
  const day = insight?.sectionId?.day ?? insight?.day ?? 0;
  return Number(day) || 0;
}

function compareInsightsByPeriodAndDayDesc(a, b) {
  const periodDiff = getInsightPeriodSortTime(b) - getInsightPeriodSortTime(a);
  if (periodDiff !== 0) return periodDiff;

  const dayDiff = getInsightDaySortValue(b) - getInsightDaySortValue(a);
  if (dayDiff !== 0) return dayDiff;

  return getTimeValue(b.updatedAt || b.createdAt) - getTimeValue(a.updatedAt || a.createdAt);
}

/**
 * 辅助函数：创建通知并自动添加 WebSocket 管理器
 * @param {Object} req - Express 请求对象
 * @param {string} userId - 用户ID
 * @param {string} type - 通知类型
 * @param {string} title - 标题
 * @param {string} content - 内容
 * @param {Object} options - 选项
 */
async function notifyUser(req, userId, type, title, content, options = {}) {
  const data = {
    ...(options.data || {})
  };

  if (options.scene) {
    data.scene = options.scene;
  }

  if (options.targetPage) {
    data.targetPage = options.targetPage;
  }

  return createNotification(userId, type, title, content, {
    ...options,
    data,
    wsManager: req.wsManager
  });
}

/**
 * 辅助函数：为多个用户创建通知并自动添加 WebSocket 管理器
 * @param {Object} req - Express 请求对象
 * @param {string[]} userIds - 用户ID列表
 * @param {string} type - 通知类型
 * @param {string} title - 标题
 * @param {string} content - 内容
 * @param {Object} options - 选项
 */
async function notifyUsers(req, userIds, type, title, content, options = {}) {
  const data = {
    ...(options.data || {})
  };

  if (options.scene) {
    data.scene = options.scene;
  }

  if (options.targetPage) {
    data.targetPage = options.targetPage;
  }

  return createNotifications(userIds, type, title, content, {
    ...options,
    data,
    wsManager: req.wsManager
  });
}

async function persistInsight(insightData) {
  const insight = await Insight.create({ ...insightData, tenantId: insightData.tenantId || getCurrentTenantId() });

  publishSyncEvent({
    type: 'create',
    collection: 'insights',
    documentId: insight._id.toString(),
    data: insight.toObject()
  });

  return insight;
}

async function upsertExternalInsight(insightData) {
  const existingInsight = await Insight.findOne({
    targetUserId: insightData.targetUserId,
    periodId: insightData.periodId,
    sectionId: insightData.sectionId,
    type: 'insight'
  });

  if (!existingInsight) {
    const insight = await persistInsight(insightData);
    return { insight, created: true };
  }

  existingInsight.set({
    userId: insightData.userId,
    periodName: insightData.periodName,
    title: insightData.title,
    day: insightData.day,
    mediaType: insightData.mediaType,
    content: insightData.content,
    imageUrl: insightData.imageUrl,
    source: insightData.source,
    status: insightData.status,
    isPublished: insightData.isPublished
  });
  const insight = await existingInsight.save();

  publishSyncEvent({
    type: 'update',
    collection: 'insights',
    documentId: insight._id.toString(),
    data: insight.toObject()
  });

  return { insight, created: false };
}

function normalizeOptionalDay(day) {
  if (day === undefined || day === null || day === '') {
    return null;
  }

  const parsed = Number(day);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function normalizeInsightContent({ content, imageUrl }) {
  if (content) {
    return content;
  }

  if (imageUrl) {
    return ' ';
  }

  return content;
}

async function resolveExternalInsightContext({
  periodId,
  periodName,
  sectionId,
  day
}) {
  const normalizedDay = normalizeOptionalDay(day);
  if (Number.isNaN(normalizedDay)) {
    return {
      status: 400,
      body: errors.badRequest('day 必须是整数')
    };
  }

  let period = null;
  if (periodId) {
    period = await Period.findById(periodId).select('_id name title');
    if (!period) {
      return {
        status: 404,
        body: errors.notFound(`期次不存在：ID ${periodId}`)
      };
    }
  } else if (periodName) {
    period = await Period.findOne({ name: periodName }).select('_id name title');
    if (!period) {
      return {
        status: 404,
        body: errors.notFound(`期次不存在：${periodName}`)
      };
    }
  }

  let section = null;
  if (sectionId) {
    section = await Section.findById(sectionId).select('_id periodId title day');
    if (!section) {
      return {
        status: 404,
        body: errors.notFound(`课节不存在：ID ${sectionId}`)
      };
    }

    if (period && section.periodId?.toString() !== period._id.toString()) {
      return {
        status: 400,
        body: errors.badRequest('sectionId 与 periodId/periodName 不匹配')
      };
    }

    if (!period) {
      period = await Period.findById(section.periodId).select('_id name title');
      if (!period) {
        return {
          status: 404,
          body: errors.notFound(`课节所属期次不存在：${section.periodId}`)
        };
      }
    }
  } else if (period && normalizedDay !== null) {
    section = await Section.findOne({
      periodId: period._id,
      day: normalizedDay
    }).select('_id periodId title day');

    if (!section) {
      return {
        status: 404,
        body: errors.notFound(`期次 ${period.name || period.title} 下不存在第 ${normalizedDay} 天课程`)
      };
    }
  }

  return {
    status: 200,
    body: {
      period,
      section,
      resolvedPeriodId: period?._id || null,
      resolvedPeriodName: period?.name || period?.title || periodName || null,
      resolvedSectionId: section?._id || sectionId || null,
      resolvedTitle: section?.title || null,
      resolvedDay: section?.day ?? normalizedDay
    }
  };
}

function isActiveEnrollment(enrollment) {
  return (
    enrollment &&
    enrollment.deleted !== true &&
    ['active', 'completed'].includes(enrollment.status || 'active')
  );
}

function getEnrollmentUser(enrollment) {
  return enrollment?.userId && typeof enrollment.userId === 'object' ? enrollment.userId : null;
}

function doesEnrollmentMatchTargetName(enrollment, targetUserName) {
  const normalizedName = String(targetUserName || '').trim();
  if (!normalizedName) {
    return false;
  }

  const user = getEnrollmentUser(enrollment);
  return [user?.nickname, enrollment?.name]
    .filter(Boolean)
    .some(name => String(name).trim() === normalizedName);
}

async function findTargetUserForExternalInsight({ targetUserId, targetUserName, periodId, periodName }) {
  if (targetUserId) {
    if (!/^[0-9a-fA-F]{24}$/.test(targetUserId)) {
      return {
        status: 400,
        body: errors.badRequest(`targetUserId 格式无效：${targetUserId}`)
      };
    }
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return {
        status: 404,
        body: errors.notFound(`被看见人不存在：ID ${targetUserId}`)
      };
    }

    const enrollment = await Enrollment.findOne({
      userId: targetUser._id,
      periodId,
      status: { $in: ['active', 'completed'] },
      deleted: { $ne: true }
    });
    if (!enrollment) {
      return {
        status: 403,
        body: errors.forbidden(`用户 ${targetUser.nickname} 未报名期次 ${periodName}`)
      };
    }

    return { status: 200, body: { targetUser, enrollment } };
  }

  const enrollments = await Enrollment.find({
    periodId,
    status: { $in: ['active', 'completed'] },
    deleted: { $ne: true }
  })
    .populate('userId', 'nickname avatar avatarUrl status')
    .lean();

  const matchedEnrollments = (enrollments || [])
    .filter(isActiveEnrollment)
    .filter(enrollment => getEnrollmentUser(enrollment))
    .filter(enrollment => doesEnrollmentMatchTargetName(enrollment, targetUserName));

  if (matchedEnrollments.length === 0) {
    return {
      status: 404,
      body: errors.notFound(`期次 ${periodName} 中不存在被看见人：昵称 ${targetUserName}`)
    };
  }

  if (matchedEnrollments.length > 1) {
    return {
      status: 400,
      body: errors.badRequest(
        `期次 ${periodName} 中昵称 "${targetUserName}" 对应多个报名用户，请改用 targetUserId 精确指定`
      )
    };
  }

  return {
    status: 200,
    body: {
      targetUser: matchedEnrollments[0].userId,
      enrollment: matchedEnrollments[0]
    }
  };
}

async function resolveQueryResult(query) {
  if (!query) {
    return query;
  }
  if (typeof query.exec === 'function') {
    return query.exec();
  }
  return query;
}

async function getUserProfile(userId, fields = 'nickname avatar avatarUrl') {
  const query = User.findById(userId);
  if (!query) {
    return null;
  }

  const selectedQuery = typeof query.select === 'function' ? query.select(fields) : query;
  const finalQuery =
    selectedQuery && typeof selectedQuery.lean === 'function' ? selectedQuery.lean() : selectedQuery;

  return resolveQueryResult(finalQuery);
}

async function findExistingInsightRequest(query, sort = { updatedAt: -1 }) {
  const requestQuery = InsightRequest.findOne(query);
  if (!requestQuery) {
    return null;
  }

  if (typeof requestQuery.sort === 'function') {
    return resolveQueryResult(requestQuery.sort(sort));
  }

  return resolveQueryResult(requestQuery);
}

async function notifyInsightRequestCreated(req, { request, fromUser, toUser }) {
  const insightTitle = request.requestInsightTitle || '学习反馈';
  const titleHasDay = /第[一二三四五六七八九十0-9]+天/.test(insightTitle);
  const dayText =
    request.requestInsightDay && !titleHasDay ? `第${request.requestInsightDay}天` : '';
  const remark = [request.requestPeriodName, dayText, insightTitle].filter(Boolean).join(' · ');

  try {
    await dispatchNotificationWithSubscribe(req, {
      recipientUserId: request.toUserId,
      notificationType: 'request_created',
      title: '收到新的小凡看见查看申请',
      content: `${fromUser?.nickname || '用户'} 申请查看你的小凡看见`,
      scene: 'insight_request_created',
      targetPage: 'pages/index/index',
      senderId: request.fromUserId,
      requestId: request._id,
      upsertExistingNotification: true,
      data: {
        senderName: fromUser?.nickname,
        senderAvatar: fromUser?.avatarUrl || '',
        fromUserName: fromUser?.nickname,
        toUserName: toUser?.nickname,
        periodName: request.requestPeriodName || '',
        insightRequestId: request._id.toString()
      },
      subscribeFields: {
        requestUser: fromUser?.nickname || '用户',
        remark: truncateText(remark || '小凡看见查看申请', 32),
        requestTime: formatNotificationTime(request.createdAt || request.updatedAt || new Date())
      },
      sourceType: 'insight_request',
      sourceId: request._id
    });
  } catch (error) {
    logger.warn('小凡看见申请通知发送失败', {
      requestId: request._id?.toString?.(),
      message: error.message
    });
  }
}

async function notifyInsightCreated(req, { insight, targetUser, periodName, sectionTitle, day }) {
  const contentPreview = truncateText(
    insight.content || (insight.imageUrl ? '[图片]' : '小凡看见'),
    32
  );
  const dayText = day ? `第${day}天` : '';
  const topic = [periodName, dayText, sectionTitle].filter(Boolean).join(' · ');

  try {
    await dispatchNotificationWithSubscribe(req, {
      recipientUserId: targetUser._id,
      notificationType: 'insight_created',
      title: '你被小凡看见了',
      content: truncateText(topic || contentPreview, 50),
      scene: 'insight_created',
      targetPage: `pages/insight-detail/insight-detail?id=${insight._id}`,
      data: {
        insightId: insight._id.toString(),
        periodName: periodName || '',
        day: day || null
      },
      upsertExistingNotification: true,
      subscribeFields: {
        replyUser: '小凡',
        replyTopic: truncateText(periodName || '晨读营', 32),
        replyContent: truncateText([dayText, sectionTitle].filter(Boolean).join(' ') || contentPreview, 32),
        replyTime: formatNotificationTime(insight.updatedAt || insight.createdAt || new Date())
      },
      sourceType: 'insight',
      sourceId: insight._id
    });
  } catch (error) {
    logger.warn('小凡看见创建通知发送失败', {
      insightId: insight._id?.toString?.(),
      targetUserId: targetUser._id?.toString?.(),
      message: error.message
    });
  }
}

async function notifyInsightLiked(req, { insight, actorUser, insightId }) {
  try {
    await dispatchNotificationWithSubscribe(req, {
      recipientUserId: insight.targetUserId,
      notificationType: 'insight_liked',
      title: '你的看见收到了点赞',
      content: `${actorUser?.nickname || '有人'} 为你的「${truncateText(insight.title || '小凡看见', 20)}」点了赞`,
      scene: 'insight_liked',
      targetPage: buildInsightDetailTargetPage(insightId),
      senderId: actorUser?._id,
      data: {
        insightId: insightId.toString(),
        senderName: actorUser?.nickname || '',
        senderAvatar: actorUser?.avatarUrl || ''
      },
      subscribeFields: {
        likeUser: actorUser?.nickname || '用户',
        likeTime: formatNotificationTime(new Date())
      },
      sourceType: 'insight',
      sourceId: insight._id
    });
  } catch (error) {
    logger.warn('点赞通知发送失败', { insightId: insightId?.toString(), message: error.message });
  }
}

async function notifyInsightDanmaku(req, { insight, danmaku, actorUser, insightId }) {
  try {
    await dispatchNotificationWithSubscribe(req, {
      recipientUserId: insight.targetUserId,
      notificationType: 'danmaku_received',
      title: '你的看见收到了弹幕',
      content: `${actorUser?.nickname || '有人'} 在你的看见发表了弹幕：${truncateText(danmaku.content, 20)}`,
      scene: 'danmaku_received',
      targetPage: buildInsightDetailTargetPage(insightId),
      senderId: actorUser?._id,
      data: {
        insightId: insightId.toString(),
        danmakuId: danmaku._id.toString(),
        senderName: actorUser?.nickname || ''
      },
      subscribeFields: {
        replyUser: actorUser?.nickname || '用户',
        replyTopic: truncateText(insight.title || '小凡看见', 32),
        replyContent: truncateText(danmaku.content, 32),
        replyTime: formatNotificationTime(danmaku.createdAt)
      },
      sourceType: 'danmaku',
      sourceId: danmaku._id
    });
  } catch (error) {
    logger.warn('弹幕通知发送失败', { insightId: insightId?.toString(), message: error.message });
  }
}

async function getApprovedPeriodIdsForViewer(viewerUserId, targetUserId) {
  if (!viewerUserId || !targetUserId || viewerUserId === targetUserId) {
    return new Set();
  }

  const approvedRequests = await InsightRequest.find({
    fromUserId: viewerUserId,
    toUserId: targetUserId,
    status: 'approved',
    periodId: { $ne: null },
    insightId: null
  }).select('periodId');

  return new Set(
    approvedRequests
      .map(request => request.periodId?.toString())
      .filter(Boolean)
  );
}

async function getViewerAccessContext(viewerUserId, targetUserId) {
  if (!viewerUserId || !targetUserId || viewerUserId === targetUserId) {
    return {
      approvedInsightIds: new Set(),
      approvedPeriodIds: new Set(),
      latestInsightRequests: new Map(),
      latestPeriodRequests: new Map()
    };
  }

  const requests = await InsightRequest.find({
    fromUserId: viewerUserId,
    toUserId: targetUserId
  })
    .select('_id status insightId periodId createdAt updatedAt')
    .sort({ updatedAt: -1, createdAt: -1 })
    .exec();

  const approvedInsightIds = new Set();
  const approvedPeriodIds = new Set();
  const latestInsightRequests = new Map();
  const latestPeriodRequests = new Map();

  requests.forEach(request => {
    const insightId = request.insightId?.toString();
    const periodId = request.periodId?.toString();

    if (request.status === 'approved') {
      if (insightId) {
        approvedInsightIds.add(insightId);
      } else if (periodId) {
        approvedPeriodIds.add(periodId);
      }
    }

    if (insightId && !latestInsightRequests.has(insightId)) {
      latestInsightRequests.set(insightId, request);
    }

    if (!insightId && periodId && !latestPeriodRequests.has(periodId)) {
      latestPeriodRequests.set(periodId, request);
    }
  });

  return {
    approvedInsightIds,
    approvedPeriodIds,
    latestInsightRequests,
    latestPeriodRequests
  };
}

function serializeInsightForViewer(insight, options = {}) {
  const {
    isOwnerView = false,
    allowedPeriodIds = new Set(),
    allowedInsightIds = new Set(),
    latestInsightRequests = new Map(),
    latestPeriodRequests = new Map()
  } = options;
  const insightData = insight.toObject ? insight.toObject() : insight;
  const insightId = insightData._id?.toString?.() || insightData.id?.toString?.() || null;
  const periodId =
    insightData.periodId?._id?.toString?.() ||
    insightData.periodId?.toString?.() ||
    null;
  const isAccessible =
    isOwnerView ||
    (!!insightId && allowedInsightIds.has(insightId)) ||
    (!!periodId && allowedPeriodIds.has(periodId));
  const matchedInsightRequest =
    !isOwnerView && insightId ? latestInsightRequests.get(insightId) || null : null;
  const matchedPeriodRequest =
    !isOwnerView && !matchedInsightRequest && periodId
      ? latestPeriodRequests.get(periodId) || null
      : null;
  const matchedRequest = matchedInsightRequest || matchedPeriodRequest;
  const requestScope = matchedInsightRequest
    ? 'insight'
    : matchedPeriodRequest
      ? 'period'
      : isOwnerView
        ? 'owner'
        : (!!insightId && allowedInsightIds.has(insightId))
          ? 'insight'
          : (!!periodId && allowedPeriodIds.has(periodId))
            ? 'period'
            : null;
  const requestStatus = isOwnerView
    ? 'owner'
    : isAccessible
      ? 'approved'
      : matchedRequest?.status || 'none';

  if (isAccessible) {
    return {
      ...insightData,
      isAccessible: true,
      requestStatus,
      requestScope,
      requestId: matchedRequest?._id || null
    };
  }

  return {
    ...insightData,
    summary: null,
    content: null,
    imageUrl: null,
    isAccessible: false,
    requestStatus,
    requestScope,
    requestId: matchedRequest?._id || null
  };
}

// 生成AI反馈（Mock版）
async function generateInsight(req, res, next) {
  try {
    const { checkinId } = req.body;
    const userId = req.user.userId;

    // 验证打卡存在
    const checkin = await Checkin.findById(checkinId).populate('sectionId', 'title day');

    if (!checkin) {
      return res.status(404).json(errors.notFound('打卡记录不存在'));
    }

    if (checkin.userId.toString() !== userId) {
      return res.status(403).json(errors.forbidden('无权操作'));
    }

    // 检查是否已生成
    const existing = await Insight.findOne({
      userId,
      checkinId
    });

    if (existing) {
      return res.json(success(existing, '反馈已生成'));
    }

    // Mock AI生成反馈内容
    const mockContent = `
      <div class="insight-content">
        <h3>📊 今日学习洞察</h3>
        <p>恭喜你完成了第 ${checkin.day} 天的晨读！</p>

        <h4>💪 你的进步</h4>
        <ul>
          <li>阅读时长: ${checkin.readingTime || 15} 分钟</li>
          <li>完成度: ${checkin.completionRate || 100}%</li>
          <li>坚持天数已达到新高度！</li>
        </ul>

        <h4>🎯 关键收获</h4>
        <p>通过今天的学习，你正在培养${checkin.sectionId?.title || '重要习惯'}。持续的积累会带来质的飞跃。</p>

        <h4>🌟 下一步建议</h4>
        <ul>
          <li>将今天学到的内容应用到实际生活中</li>
          <li>坚持打卡，保持学习节奏</li>
          <li>在社区中分享你的心得</li>
        </ul>
      </div>
    `;

    const mockSummary = `完成第${checkin.day}天学习，阅读${checkin.readingTime || 15}分钟，收获满满！`;

    // 创建反馈
    const insight = await Insight.create({
      userId,
      checkinId,
      periodId: checkin.periodId,
      sectionId: checkin.sectionId,
      day: checkin.day,
      type: 'daily',
      content: mockContent,
      summary: mockSummary,
      tags: ['学习反馈', '每日总结', '进步追踪'],
      status: 'completed',
      tenantId: getCurrentTenantId()
    });

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'create',
      collection: 'insights',
      documentId: insight._id.toString(),
      data: insight.toObject()
    });

    res.status(201).json(success(insight, 'AI反馈生成成功'));
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Insight.findOne({
        userId: req.user.userId,
        checkinId: req.body.checkinId
      });
      return res.json(success(existing, '反馈已生成'));
    }
    next(error);
  }
}

// 获取用户的反馈列表（包括创建的和分配给他们的）
async function getUserInsights(req, res, next) {
  try {
    const { page = 1, limit = 20, periodId, type } = req.query;
    const currentUserId = req.user.userId;
    const targetUserId = req.params.userId || currentUserId;
    const isAdminViewer =
      req.user?.role === 'admin' ||
      req.user?.role === 'super_admin' ||
      ADMIN_ROLES.includes(req.admin?.role);
    const isOwnerView = targetUserId === currentUserId || isAdminViewer;
    const {
      approvedInsightIds,
      approvedPeriodIds,
      latestInsightRequests,
      latestPeriodRequests
    } = isOwnerView
      ? {
          approvedInsightIds: new Set(),
          approvedPeriodIds: new Set(),
          latestInsightRequests: new Map(),
          latestPeriodRequests: new Map()
        }
      : await getViewerAccessContext(currentUserId, targetUserId);

    // 构建查询条件：
    // 1. 如果查看自己：返回自己创建的 + 分配给自己的insights
    // 2. 如果查看他人：只返回他人创建的insights（已approved权限）
    const baseQuery = { status: 'completed' };
    if (periodId) baseQuery.periodId = periodId;
    if (type) baseQuery.type = type;

    let query;
    if (targetUserId === currentUserId) {
      // 查看自己的insights
      const orConditions = [
        { userId: targetUserId, ...baseQuery }, // 自己创建的
        { targetUserId: targetUserId, ...baseQuery } // 分配给自己的
      ];
      query = { $or: orConditions };
    } else {
      // 查看他人的insights（只返回分配给他人的）
      query = { targetUserId: targetUserId, ...baseQuery };
    }

    const total = await Insight.countDocuments(query);
    const insights = await Insight.find(query)
      .populate('sectionId', 'title day icon')
      .populate('periodId', 'name title startDate endDate')
      .populate('userId', 'nickname avatar avatarUrl _id')
      .populate('targetUserId', 'nickname avatar avatarUrl _id')
      .select('-__v')
      .exec();

    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);
    const pagedInsights = insights
      .sort(compareInsightsByPeriodAndDayDesc)
      .slice((pageNumber - 1) * limitNumber, pageNumber * limitNumber);

    const serializedList = pagedInsights.map(insight =>
      serializeInsightForViewer(insight, {
        isOwnerView,
        allowedPeriodIds: approvedPeriodIds,
        allowedInsightIds: approvedInsightIds,
        latestInsightRequests,
        latestPeriodRequests
      })
    );

    res.json(
      success({
        list: serializedList,
        access: {
          isOwnerView,
          isAdminViewer,
          allowedPeriodIds: [...approvedPeriodIds],
          allowedInsightIds: [...approvedInsightIds]
        },
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          pages: Math.ceil(total / limitNumber)
        }
      })
    );
  } catch (error) {
    next(error);
  }
}

// 小程序管理员获取当前租户全部已完成小凡看见
async function getMobileAdminInsights(req, res, next) {
  try {
    if (!ADMIN_ROLES.includes(req.user?.role)) {
      return res.status(403).json(errors.forbidden('需要管理员权限'));
    }

    const pageNumber = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 100);
    const query = {
      tenantId: getCurrentTenantId(),
      type: 'insight',
      status: 'completed'
    };

    const total = await Insight.countDocuments(query);
    const insights = await Insight.find(query)
      .populate('sectionId', 'title day icon')
      .populate('periodId', 'name title startDate endDate')
      .populate('userId', 'nickname avatar avatarUrl _id')
      .populate('targetUserId', 'nickname avatar avatarUrl _id')
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .select('-__v')
      .exec();

    res.json(
      success({
        list: insights,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          pages: Math.ceil(total / limitNumber)
        }
      })
    );
  } catch (error) {
    next(error);
  }
}

// 获取反馈详情
async function getInsightDetail(req, res, next) {
  try {
    const { insightId } = req.params;
    const currentUserId = req.user?.userId;

    const insight = await Insight.findById(insightId)
      .populate('userId', 'nickname avatar avatarUrl')
      .populate('targetUserId', 'nickname avatar avatarUrl')
      .populate('sectionId', 'title day icon')
      .populate('periodId', 'name title')
      .populate('checkinId');

    if (!insight) {
      return res.status(404).json(errors.notFound('反馈不存在'));
    }

    const creatorUserId =
      insight.userId?._id?.toString?.() || insight.userId?.toString?.() || null;
    const targetUserId =
      insight.targetUserId?._id?.toString?.() || insight.targetUserId?.toString?.() || null;
    const ownerUserId = targetUserId || creatorUserId;
    const isPublicPublished =
      insight.type === 'insight' &&
      insight.status === 'completed' &&
      insight.isPublished === true;

    const isAdminViewer =
      req.user?.role === 'admin' ||
      req.user?.role === 'super_admin' ||
      ADMIN_ROLES.includes(req.admin?.role);

    let canView =
      isAdminViewer ||
      isPublicPublished ||
      (!!currentUserId &&
        (currentUserId === creatorUserId || currentUserId === ownerUserId));

    if (!canView && currentUserId && ownerUserId) {
      const { approvedInsightIds, approvedPeriodIds } =
        await getViewerAccessContext(currentUserId, ownerUserId);
      const insightRecordId = insight._id?.toString?.() || null;
      const insightPeriodId =
        insight.periodId?._id?.toString?.() || insight.periodId?.toString?.() || null;
      canView =
        (!!insightRecordId && approvedInsightIds.has(insightRecordId)) ||
        (!!insightPeriodId && approvedPeriodIds.has(insightPeriodId));
    }

    if (!canView) {
      return res.status(403).json(errors.forbidden('当前条目未获得查看授权'));
    }

    res.json(success(insight));
  } catch (error) {
    next(error);
  }
}

// 删除反馈
async function deleteInsight(req, res, next) {
  try {
    const { insightId } = req.params;
    const userId = req.user.userId;

    const insight = await Insight.findById(insightId);

    if (!insight) {
      return res.status(404).json(errors.notFound('反馈不存在'));
    }

    // 只能删除自己的反馈
    if (insight.userId.toString() !== userId) {
      return res.status(403).json(errors.forbidden('无权删除'));
    }

    // 保存反馈信息用于同步
    const insightData = insight.toObject();

    await Insight.findByIdAndDelete(insightId);

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'delete',
      collection: 'insights',
      documentId: insightId,
      data: insightData
    });

    res.json(success(null, '反馈删除成功'));
  } catch (error) {
    next(error);
  }
}

// ==================== 小凡看见(Insight) 相关接口 ====================

// 获取小凡看见列表（管理后台）
async function getInsights(req, res, next) {
  try {
    const { periodId, type, page = 1, limit = 20 } = req.query;

    const query = {};
    if (periodId) query.periodId = periodId;
    if (type) query.type = type;

    const total = await Insight.countDocuments(query);
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const insights = await Insight.find(query)
      .populate('userId', 'nickname avatar avatarUrl')
      .populate('targetUserId', 'nickname avatar avatarUrl')
      .populate('periodId', 'name title')
      .populate('sectionId', 'title day')
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .select('-__v');

    // 返回带分页信息的响应
    const response = success(insights);
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

// 创建小凡看见（手动导入）
async function createInsightManual(req, res, next) {
  try {
    const {
      periodId,
      periodName,
      sectionId,
      title,
      day,
      type,
      mediaType,
      content,
      imageUrl,
      targetUserId
    } = req.body;

    // ✅ 修复：支持两种认证方式
    // 1. 来自 authMiddleware 的小程序用户 (req.user.userId)
    // 2. 来自 adminAuthMiddleware 的管理员用户 (req.admin.id)
    const userId = req.user?.userId || req.admin?.id;

    // 验证必填字段
    if (!periodId || !type || !mediaType || (!content && !imageUrl)) {
      return res.status(400).json(errors.badRequest('缺少必填字段'));
    }

    // 验证 mediaType
    if (!['text', 'image'].includes(mediaType)) {
      return res.status(400).json(errors.badRequest('无效的媒体类型'));
    }

    // 验证 type
    if (!['daily', 'weekly', 'monthly', 'insight'].includes(type)) {
      return res.status(400).json(errors.badRequest('无效的内容类型'));
    }

    // 验证：不能给自己创建小凡看见
    if (targetUserId && targetUserId.toString() === userId.toString()) {
      return res.status(400).json(errors.badRequest('不能给自己创建小凡看见'));
    }

    // 创建小凡看见
    const insightData = {
      userId,
      targetUserId: targetUserId || null,
      periodId,
      type,
      mediaType,
      content: normalizeInsightContent({ content, imageUrl }),
      imageUrl: mediaType === 'image' ? imageUrl : null,
      source: 'manual',
      status: 'completed',
      isPublished: true
    };

    // 可选字段
    if (sectionId) insightData.sectionId = sectionId;
    if (periodName) insightData.periodName = periodName;
    if (title) insightData.title = title;

    if (day !== undefined) insightData.day = day;

    const insight = await persistInsight(insightData);

    // 如果有被看见人，异步发送通知
    if (targetUserId) {
      const targetUser = await User.findById(targetUserId).select('_id nickname');
      if (targetUser) {
        const period = periodId ? await Period.findById(periodId).select('name') : null;
        const section = sectionId ? await Section.findById(sectionId).select('title') : null;
        notifyInsightCreated(req, {
          insight,
          targetUser,
          periodName: periodName || period?.name || '',
          sectionTitle: title || section?.title || '',
          day: day || null
        }).catch(() => {});
      }
    }

    res.status(201).json(success(insight, '小凡看见创建成功'));
  } catch (error) {
    next(error);
  }
}

// 获取小凡看见列表（按期次）- 返回当前用户能看到的该期次的所有insights
// 包括：1) 当前用户创建的 2) 分配给当前用户的
async function getInsightsForPeriod(req, res, next) {
  try {
    const { periodId } = req.params;
    const { type, page = 1, limit = 20 } = req.query; // 移除type的默认值，让前端灵活控制
    const userId = req.user?.userId; // 获取当前登录用户

    // 构建查询条件：返回两类insights
    // 1. 当前用户创建的insights（userId === 当前用户）
    // 2. 分配给当前用户的insights（targetUserId === 当前用户）
    const baseQuery = {
      periodId,
      status: 'completed'
    };

    // 只在明确传递type参数时才过滤
    if (type) baseQuery.type = type;

    let orConditions = [];

    if (userId) {
      // 已登录：返回用户创建的或分配给用户的insights
      orConditions = [
        { userId, ...baseQuery }, // 当前用户创建的
        { targetUserId: userId, ...baseQuery } // 分配给当前用户的
      ];
    } else {
      // 未登录：只返回已发布的insights（即创建者选择公开的）
      baseQuery.isPublished = true;
      orConditions = [{ ...baseQuery }];
    }

    const query = orConditions.length > 1 ? { $or: orConditions } : orConditions[0];

    const total = await Insight.countDocuments(query);
    const insights = await Insight.find(query)
      .populate('userId', 'nickname avatar avatarUrl _id')
      .populate('targetUserId', 'nickname avatar avatarUrl _id')
      .populate('sectionId', 'title day')
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((parseInt(page, 10) - 1) * parseInt(limit, 10))
      .limit(parseInt(limit, 10))
      .exec();

    // 返回带分页信息的响应
    const response = success(insights);
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

// 更新小凡看见（编辑文案）
async function updateInsight(req, res, next) {
  try {
    const { insightId } = req.params;
    const {
      periodId,
      periodName,
      sectionId,
      title,
      targetUserId,
      type,
      mediaType,
      content,
      imageUrl,
      summary,
      tags,
      isPublished
    } = req.body;

    // 支持两种认证方式：
    // 1. 来自 authMiddleware 的小程序用户 (req.user.userId)
    // 2. 来自 adminAuthMiddleware 的管理员用户 (req.admin.id)
    const userId = req.user?.userId || req.admin?.id;
    const userRole = req.user?.role;
    const adminRole = req.admin?.role;

    const insight = await Insight.findById(insightId);

    if (!insight) {
      return res.status(404).json(errors.notFound('小凡看见不存在'));
    }

    // 权限检查：允许以下情况编辑
    // 1. 内容创建者可以编辑自己创建的内容
    // 2. 管理员可以编辑任何小凡看见（无论来源）
    const isCreator = insight.userId.toString() === userId;
    const isAdmin =
      userRole === 'admin' ||
      userRole === 'super_admin' ||
      ADMIN_ROLES.includes(adminRole);

    if (!isCreator && !isAdmin) {
      return res.status(403).json(errors.forbidden('无权编辑'));
    }

    // 更新所有字段
    if (periodId !== undefined) insight.periodId = periodId;
    if (periodName !== undefined) insight.periodName = periodName || null;
    if (sectionId !== undefined) insight.sectionId = sectionId || null;
    if (title !== undefined) insight.title = title || null;
    if (targetUserId !== undefined) insight.targetUserId = targetUserId || null;
    if (type !== undefined) insight.type = type;
    if (mediaType !== undefined) insight.mediaType = mediaType;
    if (content !== undefined) insight.content = content;
    if (imageUrl !== undefined) insight.imageUrl = imageUrl;
    if (summary !== undefined) insight.summary = summary;
    if (tags !== undefined) insight.tags = Array.isArray(tags) ? tags : [];
    if (isPublished !== undefined) insight.isPublished = isPublished;

    await insight.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'update',
      collection: 'insights',
      documentId: insight._id.toString(),
      data: insight.toObject()
    });

    // 保存后重新 populate 返回完整数据
    await insight.populate('targetUserId', 'nickname avatar avatarUrl');

    res.json(success(insight, '小凡看见更新成功'));
  } catch (error) {
    next(error);
  }
}

// 删除小凡看见
async function deleteInsightManual(req, res, next) {
  try {
    const { insightId } = req.params;

    // 支持两种认证方式：
    // 1. 来自 authMiddleware 的小程序用户 (req.user.userId)
    // 2. 来自 adminAuthMiddleware 的管理员用户 (req.admin.id)
    const userId = req.user?.userId || req.admin?.id;
    const userRole = req.user?.role;
    const adminRole = req.admin?.role;

    const insight = await Insight.findById(insightId);

    if (!insight) {
      return res.status(404).json(errors.notFound('小凡看见不存在'));
    }

    // 权限检查：允许以下情况删除
    // 1. 内容创建者可以删除自己创建的内容
    // 2. 管理员可以删除任何小凡看见（无论来源）
    const isCreator = insight.userId.toString() === userId;
    const isAdmin =
      userRole === 'admin' ||
      userRole === 'super_admin' ||
      ADMIN_ROLES.includes(adminRole);

    if (!isCreator && !isAdmin) {
      return res.status(403).json(errors.forbidden('无权删除'));
    }

    // 保存反馈信息用于同步
    const insightData = insight.toObject();

    await Insight.findByIdAndDelete(insightId);

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'delete',
      collection: 'insights',
      documentId: insightId,
      data: insightData
    });

    res.json(success(null, '小凡看见删除成功'));
  } catch (error) {
    next(error);
  }
}

// 创建小凡看见查看申请
async function createInsightRequest(req, res, next) {
  try {
    const { toUserId, periodId, insightId } = req.body;
    const fromUserId = req.user.userId;

    if (!toUserId) {
      return res.status(400).json(errors.badRequest('被申请用户ID不能为空'));
    }

    if (fromUserId === toUserId) {
      return res.status(400).json(errors.badRequest('不能申请查看自己的小凡看见'));
    }

    let finalPeriodId = periodId;
    let finalInsightId = insightId || null;
    let requestPeriodName = '';
    let requestInsightTitle = '';
    let requestInsightDay = null;

    if (finalInsightId) {
      const targetInsight = await Insight.findById(finalInsightId)
        .populate('sectionId', 'title day')
        .populate('periodId', 'name title')
        .populate('targetUserId', '_id')
        .populate('userId', '_id');

      if (!targetInsight) {
        return res.status(404).json(errors.notFound('目标小凡看见不存在'));
      }

      const insightOwnerId =
        targetInsight.targetUserId?._id?.toString?.() ||
        targetInsight.targetUserId?.toString?.() ||
        targetInsight.userId?._id?.toString?.() ||
        targetInsight.userId?.toString?.();

      if (insightOwnerId !== toUserId) {
        return res.status(400).json(errors.badRequest('申请目标与小凡看见归属不一致'));
      }

      finalPeriodId =
        targetInsight.periodId?._id?.toString?.() || targetInsight.periodId?.toString?.() || finalPeriodId;
      requestPeriodName = targetInsight.periodId?.name || targetInsight.periodId?.title || '';
      requestInsightTitle =
        targetInsight.sectionId?.title || targetInsight.title || '学习反馈';
      requestInsightDay = targetInsight.day || targetInsight.sectionId?.day || null;
    }

    // 如果没有提供periodId，自动查询目标用户的报名记录
    if (!finalPeriodId) {
      // 先查询活跃的报名，如果没有再查询最近的报名
      let enrollment = await Enrollment.findOne({
        userId: toUserId,
        status: 'active'
      }).sort({ createdAt: -1 });

      // 如果没有活跃报名，查询最近的任何报名
      if (!enrollment) {
        enrollment = await Enrollment.findOne({
          userId: toUserId
        }).sort({ createdAt: -1 });
      }

      if (enrollment && enrollment.periodId) {
        finalPeriodId = enrollment.periodId;
      }
    }

    // 检查同一期次是否已申请
    const existingRequestQuery = {
      fromUserId,
      toUserId
    };

    if (finalInsightId) {
      existingRequestQuery.insightId = finalInsightId;
    } else if (finalPeriodId) {
      existingRequestQuery.periodId = finalPeriodId;
    }

    const existingRequest = await findExistingInsightRequest(existingRequestQuery);

    if (existingRequest) {
      const previousStatus = existingRequest.status;
      existingRequest.periodId = finalPeriodId || existingRequest.periodId || null;
      existingRequest.insightId = finalInsightId || existingRequest.insightId || null;
      existingRequest.requestPeriodName = requestPeriodName || existingRequest.requestPeriodName || '';
      existingRequest.requestInsightTitle =
        requestInsightTitle || existingRequest.requestInsightTitle || '';
      existingRequest.requestInsightDay =
        requestInsightDay !== null && requestInsightDay !== undefined
          ? requestInsightDay
          : existingRequest.requestInsightDay;

      if (existingRequest.status === 'approved') {
        await existingRequest.save();
        return res.json(success(existingRequest, '已获得该内容的查看权限'));
      }

      let shouldRefreshNotification = existingRequest.status === 'pending';
      if (existingRequest.status === 'rejected' || existingRequest.status === 'revoked') {
        existingRequest.status = 'pending';
        existingRequest.rejectedAt = null;
        existingRequest.revokedAt = null;
        existingRequest.approvedAt = null;
        shouldRefreshNotification = true;
      }

      if (typeof existingRequest.save === 'function') {
        await existingRequest.save();
      }

      if (existingRequest.status === 'pending') {
        if (shouldRefreshNotification) {
          const [fromUser, toUser] = await Promise.all([
            getUserProfile(fromUserId),
            getUserProfile(toUserId)
          ]);
          await notifyInsightRequestCreated(req, {
            request: existingRequest,
            fromUser,
            toUser
          });
        }

        return res.json(success(existingRequest, '申请已更新'));
      }
    }

    // 创建新的申请，包含可选的periodId
    const createData = {
      fromUserId,
      toUserId,
      status: 'pending'
    };

    // 保存periodId
    if (finalPeriodId) {
      createData.periodId = finalPeriodId;
    }
    if (finalInsightId) {
      createData.insightId = finalInsightId;
    }
    if (requestPeriodName) {
      createData.requestPeriodName = requestPeriodName;
    }
    if (requestInsightTitle) {
      createData.requestInsightTitle = requestInsightTitle;
    }
    if (requestInsightDay !== null && requestInsightDay !== undefined) {
      createData.requestInsightDay = requestInsightDay;
    }

    const request = await InsightRequest.create({ ...createData, tenantId: getCurrentTenantId() });

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'create',
      collection: 'insight_requests',
      documentId: request._id.toString(),
      data: request.toObject()
    });

    // 获取申请者和被申请者信息
    const [fromUser, toUser] = await Promise.all([
      getUserProfile(fromUserId),
      getUserProfile(toUserId)
    ]);

    if (toUser) {
      await notifyInsightRequestCreated(req, {
        request,
        fromUser,
        toUser
      });
    }

    res.json(success(request, '申请已发送'));
  } catch (error) {
    next(error);
  }
}

// 获取收到的查看申请列表
async function getReceivedRequests(req, res, next) {
  try {
    const userId = req.user.userId;
    const { status } = req.query;

    // 构建查询条件
    const query = { toUserId: userId };
    if (status && status !== 'all') {
      query.status = status;
    }

    // 查询申请，并populate申请者信息
    const requests = await InsightRequest.find(query)
      .populate('fromUserId', 'nickname avatarUrl avatar')
      .populate('periodId', 'name title')
      .populate({
        path: 'insightId',
        select: 'day title periodName periodId sectionId',
        populate: [
          { path: 'periodId', select: 'name title' },
          { path: 'sectionId', select: 'title day' }
        ]
      })
      .sort({ updatedAt: -1 });

    res.json(success(requests, '获取成功'));
  } catch (error) {
    next(error);
  }
}

// 获取发起的查看申请列表
async function getSentRequests(req, res, next) {
  try {
    const userId = req.user.userId;
    const { status } = req.query;

    // 构建查询条件
    const query = { fromUserId: userId };
    if (status && status !== 'all') {
      query.status = status;
    }

    // 查询申请，并populate被申请者信息
    const requests = await InsightRequest.find(query)
      .populate('toUserId', 'nickname avatarUrl avatar')
      .populate('periodId', 'name title')
      .populate({
        path: 'insightId',
        select: 'day title periodName periodId sectionId',
        populate: [
          { path: 'periodId', select: 'name title' },
          { path: 'sectionId', select: 'title day' }
        ]
      })
      .sort({ updatedAt: -1 });

    res.json(success(requests, '获取成功'));
  } catch (error) {
    next(error);
  }
}

// 检查与某个用户的小凡看见查看申请状态
async function getRequestStatus(req, res, next) {
  try {
    const userId = req.user.userId;
    const targetUserId = req.params.userId;

    const allRequests = await InsightRequest.find({
      fromUserId: userId,
      toUserId: targetUserId
    })
      .sort({ updatedAt: -1 })
      .exec();

    const latestRequest = allRequests[0];
    const approvedPeriodIds = allRequests
      .filter(request => request.status === 'approved' && request.periodId && !request.insightId)
      .map(request => request.periodId.toString());
    const approvedInsightIds = allRequests
      .filter(request => request.status === 'approved' && request.insightId)
      .map(request => request.insightId.toString());
    const hasPending = allRequests.some(request => request.status === 'pending');

    if (!latestRequest) {
      // 没有申请记录
      return res.json(
        success(
          {
            approved: false,
            pending: false,
            periodId: null,
            approvedPeriodIds: [],
            approvedInsightIds: []
          },
          '无申请记录'
        )
      );
    }

    // 返回申请状态
    const response = {
      approved: approvedPeriodIds.length > 0 || approvedInsightIds.length > 0,
      pending: hasPending,
      requestId: latestRequest._id,
      status:
        hasPending
          ? 'pending'
          : approvedPeriodIds.length > 0 || approvedInsightIds.length > 0
            ? 'approved'
            : latestRequest.status,
      createdAt: latestRequest.createdAt,
      periodId: latestRequest.periodId || null,
      approvedPeriodIds,
      approvedInsightIds
    };

    res.json(success(response, '申请状态'));
  } catch (error) {
    next(error);
  }
}

// 同意查看申请
async function approveInsightRequest(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const userId = req.user.userId;
    let { periodId } = req.body;

    // 查找申请
    const request = await InsightRequest.findById(requestId);

    if (!request) {
      return res.status(404).json(errors.notFound('申请不存在'));
    }

    // 验证当前用户是被申请者
    if (request.toUserId.toString() !== userId) {
      return res.status(403).json(errors.forbidden('无权审批'));
    }

    // 验证申请状态为pending
    if (request.status !== 'pending') {
      return res.status(400).json(errors.badRequest('申请状态已改变，无法操作'));
    }

    if (!periodId) {
      periodId = request.periodId;
    }

    let targetInsight = null;
    if (request.insightId) {
      const targetInsightQuery = Insight.findById(request.insightId);
      targetInsight =
        targetInsightQuery && typeof targetInsightQuery.select === 'function'
          ? await targetInsightQuery.select('periodId title sectionId day')
          : await targetInsightQuery;
      if (!periodId) {
        periodId = targetInsight?.periodId || null;
      }
    }

    if (!periodId) {
      return res.status(400).json(errors.badRequest('期次ID不能为空'));
    }

    // 更新申请
    request.status = 'approved';
    request.periodId = periodId;
    request.approvedAt = new Date();
    await request.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'update',
      collection: 'insight_requests',
      documentId: request._id.toString(),
      data: request.toObject()
    });

    // 获取被申请者和期次信息
    const toUser = await User.findById(request.toUserId).select('nickname avatar avatarUrl');
    const period = await Period.findById(periodId).select('name title');
    const requestIdText = request._id?.toString?.() || String(request._id);
    const insightIdText = request.insightId?.toString?.() || '';
    const periodIdText = periodId?.toString?.() || String(periodId);
    const targetUserIdText = request.toUserId?.toString?.() || String(request.toUserId);
    const insightTitle =
      request.requestInsightTitle ||
      targetInsight?.title ||
      targetInsight?.sectionId?.title ||
      '小凡看见';
    const targetPage = buildInsightApprovalTargetPage({
      insightId: insightIdText,
      requestId: requestIdText,
      targetUserId: targetUserIdText,
      periodId: periodIdText
    });

    await dispatchNotificationWithSubscribe(req, {
      recipientUserId: request.fromUserId,
      notificationType: 'request_approved',
      title: '小凡看见查看申请已批准',
      content: `${toUser?.nickname || '用户'} 同意了你的查看申请，允许查看 ${period?.name || '本期'} 的小凡看见`,
      scene: 'insight_request_approved',
      targetPage,
      requestId: request._id,
      senderId: request.toUserId,
      data: {
        senderName: toUser?.nickname,
        senderAvatar: toUser?.avatarUrl || '',
        periodId: periodIdText,
        periodName: period?.name || period?.title || '',
        targetUserId: targetUserIdText,
        targetUserName: toUser?.nickname || '',
        insightId: insightIdText,
        insightTitle
      },
      subscribeFields: {
        approverName: toUser?.nickname || '用户',
        remark: truncateText(`${period?.name || period?.title || '本期'} · ${insightTitle}`, 32),
        approvedTime: formatNotificationTime(request.approvedAt || new Date())
      },
      sourceType: 'insight_request',
      sourceId: request._id
    });

    res.json(success(request, '已同意查看请求'));
  } catch (error) {
    next(error);
  }
}

// 拒绝查看申请
async function rejectInsightRequest(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const userId = req.user.userId;

    // 查找申请
    const request = await InsightRequest.findById(requestId);

    if (!request) {
      return res.status(404).json(errors.notFound('申请不存在'));
    }

    // 验证当前用户是被申请者
    if (request.toUserId.toString() !== userId) {
      return res.status(403).json(errors.forbidden('无权拒绝'));
    }

    // 验证申请状态为pending
    if (request.status !== 'pending') {
      return res.status(400).json(errors.badRequest('申请状态已改变，无法操作'));
    }

    // 更新申请
    request.status = 'rejected';
    request.rejectedAt = new Date();
    await request.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'update',
      collection: 'insight_requests',
      documentId: request._id.toString(),
      data: request.toObject()
    });

    // 获取被申请者信息
    const toUser = await User.findById(request.toUserId).select('nickname avatar avatarUrl');
    const targetPage = buildProfileOthersTargetPage(request.toUserId.toString(), {
      periodId: request.periodId?.toString?.() || ''
    });

    // 发送通知给申请者
    await notifyUser(
      req,
      request.fromUserId,
      'request_rejected',
      '小凡看见查看申请已被拒绝',
      `${toUser?.nickname || '用户'} 拒绝了你的查看申请`,
      {
        requestId: request._id,
        senderId: request.toUserId,
        targetPage,
        data: {
          senderName: toUser?.nickname,
          senderAvatar: toUser?.avatarUrl || '',
          targetUserId: request.toUserId.toString(),
          targetUserName: toUser?.nickname || '',
          periodId: request.periodId?.toString?.() || ''
        }
      }
    );

    res.json(success(request, '已拒绝查看请求'));
  } catch (error) {
    next(error);
  }
}

// ==================== 管理员相关接口 ====================

// 获取所有查看申请列表（管理员视图）
async function getInsightRequestsAdmin(req, res, next) {
  try {
    const { status, page = 1, limit = 20, fromUser, toUser } = req.query;

    // 构建查询条件
    const query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    // 根据用户搜索
    if (fromUser || toUser) {
      const User = require('../models/User');
      const users = await User.find({
        $or: [
          { nickname: new RegExp(fromUser || toUser, 'i') },
          { email: new RegExp(fromUser || toUser, 'i') }
        ]
      });

      if (fromUser) {
        query.fromUserId = { $in: users.map(u => u._id) };
      }
      if (toUser) {
        query.toUserId = { $in: users.map(u => u._id) };
      }
    }

    // 计算分页
    const skip = (page - 1) * limit;

    // 查询总数
    const total = await InsightRequest.countDocuments(query);

    // 查询申请，并populate用户信息
    const requests = await InsightRequest.find(query)
      .populate('fromUserId', 'nickname avatarUrl avatar email')
      .populate('toUserId', 'nickname avatarUrl avatar email')
      .populate('periodId', 'name title startDate endDate')
      .populate({
        path: 'insightId',
        select: 'day title periodName periodId sectionId',
        populate: [
          { path: 'periodId', select: 'name title' },
          { path: 'sectionId', select: 'title day' }
        ]
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    res.json(
      success(
        {
          requests,
          pagination: {
            total,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            totalPages: Math.ceil(total / parseInt(limit, 10))
          }
        },
        '获取成功'
      )
    );
  } catch (error) {
    next(error);
  }
}

// 获取申请统计信息
async function getInsightRequestsStats(req, res, next) {
  try {
    const stats = await InsightRequest.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ],
          responseTime: [
            {
              $match: { status: { $in: ['approved', 'rejected'] } }
            },
            {
              $group: {
                _id: null,
                avgTime: {
                  $avg: {
                    $subtract: [{ $ifNull: ['$approvedAt', '$rejectedAt'] }, '$createdAt']
                  }
                }
              }
            }
          ]
        }
      }
    ]);

    const totalCount = stats[0].total[0]?.count || 0;
    const byStatus = {};
    stats[0].byStatus.forEach(item => {
      byStatus[item._id] = item.count;
    });

    const avgResponseTime = stats[0].responseTime[0]?.avgTime || 0;

    res.json(
      success(
        {
          totalRequests: totalCount,
          pendingRequests: byStatus.pending || 0,
          approvedRequests: byStatus.approved || 0,
          rejectedRequests: byStatus.rejected || 0,
          avgResponseTimeMs: Math.round(avgResponseTime),
          avgResponseTime: formatDuration(avgResponseTime)
        },
        '获取成功'
      )
    );
  } catch (error) {
    next(error);
  }
}

// 管理员同意申请
async function adminApproveRequest(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const adminId = req.admin.id;
    const { periodId, adminNote } = req.body;

    if (!periodId) {
      return res.status(400).json(errors.badRequest('期次ID不能为空'));
    }

    // 查找申请
    const request = await InsightRequest.findById(requestId);

    if (!request) {
      return res.status(404).json(errors.notFound('申请不存在'));
    }

    // 验证申请状态为pending
    if (request.status !== 'pending') {
      return res.status(400).json(errors.badRequest('申请状态已改变，无法操作'));
    }

    // 更新申请
    request.status = 'approved';
    request.periodId = periodId;
    request.approvedAt = new Date();

    // 记录管理员操作
    if (!request.auditLog) {
      request.auditLog = [];
    }
    request.auditLog.push({
      action: 'admin_approve',
      actor: adminId,
      actorType: 'admin',
      timestamp: new Date(),
      note: adminNote || ''
    });

    await request.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'update',
      collection: 'insight_requests',
      documentId: request._id.toString(),
      data: request.toObject()
    });

    // 获取申请者、被申请者和期次信息
    const Period = require('../models/Period');
    const fromUser = await User.findById(request.fromUserId).select('nickname avatar avatarUrl');
    const toUser = await User.findById(request.toUserId).select('nickname avatar avatarUrl');
    const period = await Period.findById(periodId).select('name title');
    const targetPage = buildProfileOthersTargetPage(request.toUserId.toString(), {
      periodId
    });

    // 发送通知给申请者
    await notifyUser(
      req,
      request.fromUserId,
      'admin_approved',
      '小凡看见查看申请已由管理员批准',
      `管理员已批准你的查看申请，允许查看 ${period?.name || '本期'} 的小凡看见`,
      {
        requestId: request._id,
        targetPage,
        data: {
          periodId: periodId?.toString?.() || String(periodId),
          periodName: period?.name || period?.title || '',
          targetUserId: request.toUserId.toString(),
          targetUserName: toUser?.nickname || '',
          senderName: fromUser?.nickname || '',
          senderAvatar: fromUser?.avatarUrl || ''
        }
      }
    );

    res.json(success(request, '管理员已同意查看请求'));
  } catch (error) {
    next(error);
  }
}

// 管理员拒绝申请
async function adminRejectRequest(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const adminId = req.admin.id;
    const { adminNote } = req.body;

    // 查找申请
    const request = await InsightRequest.findById(requestId);

    if (!request) {
      return res.status(404).json(errors.notFound('申请不存在'));
    }

    // 验证申请状态为pending
    if (request.status !== 'pending') {
      return res.status(400).json(errors.badRequest('申请状态已改变，无法操作'));
    }

    // 更新申请
    request.status = 'rejected';
    request.rejectedAt = new Date();

    // 记录管理员操作
    if (!request.auditLog) {
      request.auditLog = [];
    }
    request.auditLog.push({
      action: 'admin_reject',
      actor: adminId,
      actorType: 'admin',
      timestamp: new Date(),
      reason: adminNote || ''
    });

    await request.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'update',
      collection: 'insight_requests',
      documentId: request._id.toString(),
      data: request.toObject()
    });

    // 发送通知给申请者
    const targetPage = buildProfileOthersTargetPage(request.toUserId.toString(), {
      periodId: request.periodId?.toString?.() || ''
    });

    await notifyUser(
      req,
      request.fromUserId,
      'admin_rejected',
      '小凡看见查看申请已由管理员拒绝',
      `管理员已拒绝你的查看申请`,
      {
        requestId: request._id,
        targetPage,
        data: {
          reason: adminNote,
          targetUserId: request.toUserId.toString(),
          periodId: request.periodId?.toString?.() || ''
        }
      }
    );

    res.json(success(request, '管理员已拒绝查看请求'));
  } catch (error) {
    next(error);
  }
}

// 用户撤销已批准的权限
async function revokeInsightRequest(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const userId = req.user.userId;

    // 查找申请
    const request = await InsightRequest.findById(requestId);

    if (!request) {
      return res.status(404).json(errors.notFound('申请不存在'));
    }

    // 验证当前用户是被申请者（只有被申请者可以撤销权限）
    if (request.toUserId.toString() !== userId) {
      return res.status(403).json(errors.forbidden('无权撤销权限'));
    }

    // 验证申请状态为approved
    if (request.status !== 'approved') {
      return res.status(400).json(errors.badRequest('只能撤销已批准的申请'));
    }

    // 更新申请
    request.status = 'revoked';
    request.revokedAt = new Date();

    // 记录操作到审计日志
    if (!request.auditLog) {
      request.auditLog = [];
    }
    request.auditLog.push({
      action: 'revoke',
      actor: userId,
      actorType: 'user',
      timestamp: new Date()
    });

    await request.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'update',
      collection: 'insight_requests',
      documentId: request._id.toString(),
      data: request.toObject()
    });

    // 获取被申请者信息
    const toUser = await User.findById(request.toUserId).select('nickname avatar avatarUrl');
    const targetPage = buildProfileOthersTargetPage(request.toUserId.toString(), {
      periodId: request.periodId?.toString?.() || ''
    });

    // 发送通知给申请者
    await notifyUser(
      req,
      request.fromUserId,
      'permission_revoked',
      '小凡看见查看权限已被撤销',
      `${toUser?.nickname || '用户'} 撤销了你的小凡看见查看权限`,
      {
        requestId: request._id,
        senderId: request.toUserId,
        targetPage,
        data: {
          senderName: toUser?.nickname,
          senderAvatar: toUser?.avatarUrl || '',
          targetUserId: request.toUserId.toString(),
          targetUserName: toUser?.nickname || '',
          periodId: request.periodId?.toString?.() || ''
        }
      }
    );

    res.json(success(request, '已撤销查看权限'));
  } catch (error) {
    next(error);
  }
}

// 管理员删除申请
async function deleteInsightRequest(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const adminId = req.admin?.id || req.user?.userId;
    const { adminNote } = req.body;

    // 查找申请
    const request = await InsightRequest.findById(requestId);

    if (!request) {
      return res.status(404).json(errors.notFound('申请不存在'));
    }

    // 记录删除操作到审计日志（在删除前）
    if (!request.auditLog) {
      request.auditLog = [];
    }
    request.auditLog.push({
      action: 'admin_delete',
      actor: adminId,
      actorType: 'admin',
      timestamp: new Date(),
      note: adminNote || ''
    });

    // 保存审计日志后删除
    await request.save();

    // 保存请求数据用于同步
    const requestData = request.toObject();

    // 然后删除记录
    await InsightRequest.findByIdAndDelete(requestId);

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'delete',
      collection: 'insight_requests',
      documentId: requestId,
      data: requestData
    });

    res.json(success(null, '申请已删除'));
  } catch (error) {
    next(error);
  }
}

// 辅助函数：格式化时间差
function formatDuration(ms) {
  if (!ms || ms < 0) return '0分钟';

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  return `${minutes}分钟`;
}

/**
 * 管理员批量同意查看申请
 * @route   POST /admin/insights/requests/batch-approve
 * @desc    一次性同意多个查看申请，可以为不同用户分别指定期次
 * @access  Private (Admin)
 */
async function batchApproveRequests(req, res, next) {
  try {
    const adminId = req.user.userId;
    const { approvals } = req.body; // approvals: [{ requestId, periodId }, ...]

    // 验证参数
    if (!Array.isArray(approvals) || approvals.length === 0) {
      return res.status(400).json(errors.badRequest('approvals 必须是非空数组'));
    }

    if (approvals.length > 100) {
      return res.status(400).json(errors.badRequest('单次批量操作最多100个申请'));
    }

    // 获取所有申请
    const requestIds = approvals.map(a => a.requestId);
    const requests = await InsightRequest.find({
      _id: { $in: requestIds },
      status: 'pending'
    });

    if (requests.length === 0) {
      return res.status(400).json(errors.badRequest('没有找到待审批的申请'));
    }

    // 创建映射：requestId -> periodId
    const periodMap = new Map(approvals.map(a => [a.requestId, a.periodId]));

    // 验证所有 periodId 都存在
    const periodIds = [...new Set(approvals.map(a => a.periodId))];
    const Period = require('../models/Period');
    const periods = await Period.find({ _id: { $in: periodIds } });

    if (periods.length !== periodIds.length) {
      return res.status(400).json(errors.badRequest('某些期次不存在'));
    }

    // 批量更新申请
    const updatedRequests = [];
    const notifications = [];

    for (const request of requests) {
      const periodId = periodMap.get(request._id.toString());
      if (!periodId) continue;

      // 更新申请
      request.status = 'approved';
      request.periodId = periodId;
      request.approvedAt = new Date();

      // 记录审计日志
      if (!request.auditLog) {
        request.auditLog = [];
      }
      request.auditLog.push({
        action: 'batch_approved',
        actor: adminId,
        actorType: 'admin',
        timestamp: new Date()
      });

      await request.save();
      updatedRequests.push(request);

      // 准备通知数据
      notifications.push({
        fromUserId: request.fromUserId,
        type: 'batch_approved',
        title: '小凡看见查看申请已由管理员批准',
        content: `管理员已批准你的查看申请`,
        requestId: request._id
      });
    }

    // 批量发送通知
    if (notifications.length > 0) {
      const Period = require('../models/Period');
      const period = await Period.findById(requests[0].periodId).select('name');

      for (const notif of notifications) {
        await notifyUser(
          req,
          notif.fromUserId,
          notif.type,
          notif.title,
          `${notif.content}，允许查看 ${period?.name || '本期'} 的小凡看见`,
          {
            requestId: notif.requestId,
            data: {
              periodName: period?.name
            }
          }
        );
      }
    }

    res.json(
      success(
        {
          processed: updatedRequests.length,
          total: requests.length,
          requests: updatedRequests
        },
        `已批准 ${updatedRequests.length} 个申请`
      )
    );
  } catch (error) {
    next(error);
  }
}

/**
 * 外部接口：创建小凡看见
 * 用于外部系统提交用户的"小凡看见"内容
 * @route   POST /api/v1/insights/external/create
 * @param   targetUserId|targetUserName {string} - 被看见用户ID/昵称（二选一，ID优先；昵称按期次报名用户匹配）
 * @param   periodId|periodName {string} - 期次ID/名称（二选一）
 * @param   sessionId {string} - 课节ID（与day二选一，推荐）
 * @param   day {number} - 第几天的课程（与sessionId二选一，兼容旧写法）
 * @param   content {string} - 小凡看见的文字内容（与imageUrl二选一）
 * @param   imageUrl {string} - 小凡看见的图片地址（与content二选一）
 * @access  Public (外部系统调用)
 */
async function createInsightFromExternal(req, res, next) {
  try {
    const {
      periodName,
      periodId: rawPeriodId,
      period_id: rawPeriodIdSnake,
      sectionId: rawSectionId,
      section_id: rawSectionIdSnake,
      sessionId: rawSessionId,
      session_id: rawSessionIdSnake,
      day,
      content,
      imageUrl,
      targetUserId,
      targetUserName
    } = req.body;
    const periodId = rawPeriodId || rawPeriodIdSnake || null;
    const sectionId =
      rawSectionId || rawSectionIdSnake || rawSessionId || rawSessionIdSnake || null;

    // 验证必填字段
    if (!periodId && !periodName) {
      return res.status(400).json(errors.badRequest('缺少必填字段：periodId 或 periodName'));
    }

    if (!targetUserId && !targetUserName) {
      return res.status(400).json(errors.badRequest('缺少必填字段：targetUserId 或 targetUserName'));
    }

    // 验证content和imageUrl至少有一个
    if (!content && !imageUrl) {
      return res
        .status(400)
        .json(errors.badRequest('content 和 imageUrl 必选其一（至少填写一个）'));
    }

    if (!sectionId && (day === undefined || day === null || day === '')) {
      return res.status(400).json(errors.badRequest('缺少必填字段：sessionId 或 day'));
    }

    const resolvedContext = await resolveExternalInsightContext({
      periodId,
      periodName,
      sectionId,
      day
    });
    if (resolvedContext.status !== 200) {
      return res.status(resolvedContext.status).json(resolvedContext.body);
    }
    const {
      period,
      resolvedPeriodId,
      resolvedPeriodName,
      resolvedSectionId,
      resolvedTitle,
      resolvedDay
    } = resolvedContext.body;

    // 查询并验证被看见人是否存在且报名该期次。
    // targetUserName 必须限定在当前期次报名记录内匹配，避免全局同名用户误判重复。
    const resolvedTarget = await findTargetUserForExternalInsight({
      targetUserId,
      targetUserName,
      periodId: resolvedPeriodId,
      periodName: resolvedPeriodName
    });
    if (resolvedTarget.status !== 200) {
      return res.status(resolvedTarget.status).json(resolvedTarget.body);
    }
    const { targetUser } = resolvedTarget.body;

    // 获取系统用户作为创建者（如果存在），否则使用被看见人作为创建者
    // 这里可以配置一个系统用户ID
    const systemUserId = process.env.SYSTEM_USER_ID || targetUserId;
    const user = await User.findById(systemUserId);

    if (!user && systemUserId !== targetUserId) {
      return res.status(404).json(errors.notFound(`系统用户不存在：ID ${systemUserId}`));
    }

    // 如果没有系统用户，则使用被看见人作为创建者
    const creatorId = user ? user._id : targetUser._id;

    // 同一用户、同一期次、同一课节只保留一条外部生成的小凡看见；重复提交时更新原记录。
    const { insight, created } = await upsertExternalInsight({
      userId: creatorId,
      targetUserId: targetUser._id,
      periodId: resolvedPeriodId,
      periodName: resolvedPeriodName,
      sectionId: resolvedSectionId,
      title: resolvedTitle,
      day: resolvedDay,
      type: 'insight',
      mediaType: imageUrl ? 'image' : 'text',
      content: normalizeInsightContent({ content, imageUrl }),
      imageUrl: imageUrl || null,
      source: 'manual',
      status: 'completed',
      isPublished: true
    });

    // 返回简洁的响应（仅返回ID，不返回完整对象）
    const result = {
      _id: insight._id,
      targetUserId: insight.targetUserId,
      periodId: insight.periodId,
      periodName: insight.periodName,
      sectionId: insight.sectionId || null,
      day: insight.day,
      type: insight.type,
      mediaType: insight.mediaType,
      content: insight.content,
      imageUrl: insight.imageUrl,
      source: insight.source,
      status: insight.status,
      isPublished: insight.isPublished,
      createdAt: insight.createdAt,
      updatedAt: insight.updatedAt
    };

    await notifyInsightCreated(req, {
      insight,
      targetUser,
      periodName: resolvedPeriodName,
      sectionTitle: resolvedTitle,
      day: resolvedDay
    });

    res.status(created ? 201 : 200).json(success(result, created ? '小凡看见创建成功' : '小凡看见更新成功'));
  } catch (error) {
    logger.error('创建外部小凡看见失败:', error);
    next(error);
  }
}

// 点赞小凡看见（支持like和unlike action）
async function likeInsight(req, res, next) {
  try {
    const { insightId } = req.params;
    const { action = 'like' } = req.body;
    const userId = req.user.userId;

    // 验证小凡看见存在
    const insight = await Insight.findById(insightId);
    if (!insight) {
      return res.status(404).json(errors.notFound('小凡看见不存在'));
    }

    if (action === 'like') {
      // 检查是否已点赞
      const alreadyLiked = insight.likes.some(like => like.userId.toString() === userId);
      if (alreadyLiked) {
        return res.status(400).json(errors.badRequest('已经点过赞了'));
      }

      // 添加点赞
      insight.likes.push({ userId, createdAt: new Date() });
      insight.likeCount = insight.likes.length;
      await insight.save();

      // 通知看见的主人（异步，不阻塞响应）
      const insightOwnerId = insight.targetUserId?.toString?.();
      if (insightOwnerId && insightOwnerId !== userId) {
        User.findById(userId).select('nickname avatarUrl').then(actorUser => {
          notifyInsightLiked(req, { insight, actorUser, insightId });
        }).catch(() => {});
      }

      res.json(success(insight, '点赞成功'));
    } else if (action === 'unlike') {
      // 检查是否已点赞
      const likeIndex = insight.likes.findIndex(like => like.userId.toString() === userId);
      if (likeIndex === -1) {
        return res.status(400).json(errors.badRequest('未点过赞'));
      }

      // 移除点赞
      insight.likes.splice(likeIndex, 1);
      insight.likeCount = insight.likes.length;
      await insight.save();

      res.json(success(insight, '取消点赞成功'));
    } else {
      return res.status(400).json(errors.badRequest('action必须是like或unlike'));
    }
  } catch (error) {
    next(error);
  }
}

// 取消点赞小凡看见
async function unlikeInsight(req, res, next) {
  try {
    const { insightId } = req.params;
    const userId = req.user.userId;

    // 验证小凡看见存在
    const insight = await Insight.findById(insightId);
    if (!insight) {
      return res.status(404).json(errors.notFound('小凡看见不存在'));
    }

    // 检查是否已点赞
    const likeIndex = insight.likes.findIndex(like => like.userId.toString() === userId);
    if (likeIndex === -1) {
      return res.status(400).json(errors.badRequest('未点过赞'));
    }

    // 移除点赞
    insight.likes.splice(likeIndex, 1);
    insight.likeCount = insight.likes.length;
    await insight.save();

    res.json(success(insight, '取消点赞成功'));
  } catch (error) {
    next(error);
  }
}

// 发送弹幕
async function postDanmaku(req, res, next) {
  try {
    const { insightId } = req.params;
    const userId = req.user.userId;
    const { content, type = 'comment', scrollPercent = 0, color = '#4a90e2' } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json(errors.badRequest('弹幕内容不能为空'));
    }
    if (countUnicodeChars(content) > MAX_DANMAKU_CONTENT_LENGTH) {
      return res.status(400).json(errors.badRequest('弹幕内容不能超过60字'));
    }

    const insight = await Insight.findById(insightId);
    if (!insight) {
      return res.status(404).json(errors.notFound('小凡看见不存在'));
    }

    const user = await User.findById(userId).select('nickname');
    const userNickname = user?.nickname || '匿名读者';

    const danmaku = await InsightDanmaku.create({
      insightId,
      userId,
      userNickname,
      content: content.trim(),
      type,
      scrollPercent: Math.max(0, Math.min(100, Number(scrollPercent) || 0)),
      color,
      tenantId: getCurrentTenantId()
    });

    // 评论弹幕通知看见主人（点赞弹幕已由 likeInsight 单独通知，避免重复）
    if (type === 'comment') {
      const insightOwnerId = insight.targetUserId?.toString?.();
      if (insightOwnerId && insightOwnerId !== userId) {
        notifyInsightDanmaku(req, { insight, danmaku, actorUser: user, insightId });
      }
    }

    res.json(success(danmaku, '弹幕发送成功'));
  } catch (error) {
    next(error);
  }
}

// 获取弹幕列表
async function getDanmaku(req, res, next) {
  try {
    const { insightId } = req.params;
    const danmakuList = await InsightDanmaku.find({ insightId })
      .sort({ createdAt: 1 })
      .lean();
    res.json(success(danmakuList));
  } catch (error) {
    next(error);
  }
}

async function adminGetInsightDetail(req, res, next) {
  try {
    const { insightId } = req.params;
    const insight = await Insight.findById(insightId)
      .populate('userId', 'nickname avatar avatarUrl')
      .populate('targetUserId', 'nickname avatar avatarUrl')
      .populate('sectionId', 'title day icon')
      .populate('periodId', 'name title')
      .populate('likes.userId', 'nickname avatar avatarUrl')
      .lean();
    if (!insight) {
      return res.status(404).json(errors.notFound('内容不存在'));
    }
    res.json(success(insight));
  } catch (error) {
    next(error);
  }
}

async function adminGetDanmaku(req, res, next) {
  try {
    const { insightId } = req.params;
    const danmakuList = await InsightDanmaku.find({ insightId })
      .populate('userId', 'nickname avatar avatarUrl')
      .sort({ createdAt: 1 })
      .lean();
    res.json(success(danmakuList));
  } catch (error) {
    next(error);
  }
}

async function adminLikeForUser(req, res, next) {
  try {
    const { insightId } = req.params;
    const { userId, scrollPercent = 0 } = req.body;
    if (!userId) return res.status(400).json(errors.badRequest('userId is required'));

    const insight = await Insight.findById(insightId);
    if (!insight) return res.status(404).json(errors.notFound('小凡看见不存在'));

    const alreadyLiked = insight.likes.some(l => String(l.userId) === String(userId));
    if (alreadyLiked) return res.status(400).json(errors.badRequest('该用户已点过赞'));

    const user = await User.findById(userId).select('nickname avatar avatarUrl');
    if (!user) return res.status(404).json(errors.notFound('用户不存在'));

    insight.likes.push({ userId, createdAt: new Date() });
    insight.likeCount = insight.likes.length;
    await insight.save();

    const danmaku = await InsightDanmaku.create({
      insightId,
      userId,
      userNickname: user.nickname || '匿名',
      content: '被你触动到了！❤️',
      type: 'like',
      scrollPercent: Math.max(0, Math.min(100, Number(scrollPercent) || 0)),
      color: '#e8a0b4',
      tenantId: getCurrentTenantId()
    });

    const insightOwnerId = insight.targetUserId?.toString?.();
    if (insightOwnerId && insightOwnerId !== String(userId)) {
      await notifyInsightLiked(req, { insight, actorUser: user, insightId });
    }

    res.json(success({ likeCount: insight.likeCount, danmaku }, '点赞成功'));
  } catch (error) {
    next(error);
  }
}

async function adminPostDanmakuForUser(req, res, next) {
  try {
    const { insightId } = req.params;
    const { userId, content, color = '#4a90e2', scrollPercent = 0 } = req.body;
    if (!userId || !content?.trim()) {
      return res.status(400).json(errors.badRequest('userId 和 content 不能为空'));
    }

    const insight = await Insight.findById(insightId);
    if (!insight) return res.status(404).json(errors.notFound('小凡看见不存在'));

    const user = await User.findById(userId).select('nickname avatar avatarUrl');
    if (!user) return res.status(404).json(errors.notFound('用户不存在'));

    const danmaku = await InsightDanmaku.create({
      insightId,
      userId,
      userNickname: user.nickname || '匿名',
      content: content.trim(),
      type: 'comment',
      scrollPercent: Math.max(0, Math.min(100, Number(scrollPercent) || 0)),
      color,
      tenantId: getCurrentTenantId()
    });

    const insightOwnerId = insight.targetUserId?.toString?.();
    if (insightOwnerId && insightOwnerId !== String(userId)) {
      await notifyInsightDanmaku(req, { insight, danmaku, actorUser: user, insightId });
    }

    res.json(success(danmaku, '弹幕发送成功'));
  } catch (error) {
    next(error);
  }
}

async function adminDeleteDanmaku(req, res, next) {
  try {
    const { danmakuId } = req.params;
    const danmaku = await InsightDanmaku.findById(danmakuId);
    if (!danmaku) return res.status(404).json(errors.notFound('弹幕不存在'));

    if (danmaku.type === 'like') {
      const insight = await Insight.findById(danmaku.insightId);
      if (insight) {
        insight.likes = insight.likes.filter(l => String(l.userId) !== String(danmaku.userId));
        insight.likeCount = insight.likes.length;
        await insight.save();
      }
    }

    await InsightDanmaku.findByIdAndDelete(danmakuId);
    res.json(success(null, '已删除'));
  } catch (error) {
    next(error);
  }
}

// 获取某课节所有书友的小凡看见（小程序管理员用）
async function getSectionInsightsForAdmin(req, res, next) {
  try {
    const { sectionId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const user = await User.findById(req.user.userId).select('role');
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      return res.status(403).json(errors.forbidden('无权限'));
    }

    const tenantId = getCurrentTenantId();
    const matchQuery = { sectionId: require('mongoose').Types.ObjectId.isValid(sectionId) ? new (require('mongoose').Types.ObjectId)(sectionId) : sectionId };
    if (tenantId) matchQuery.tenantId = tenantId;

    const total = await Insight.countDocuments(matchQuery);

    const insights = await Insight.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: 'insightdanmakus',
          localField: '_id',
          foreignField: 'insightId',
          as: '_danmakus'
        }
      },
      {
        $addFields: {
          danmakuCount: { $size: '$_danmakus' },
          engagementScore: { $add: ['$likeCount', { $size: '$_danmakus' }] }
        }
      },
      { $sort: { engagementScore: -1, createdAt: -1 } },
      { $skip: (parseInt(page, 10) - 1) * parseInt(limit, 10) },
      { $limit: parseInt(limit, 10) },
      {
        $lookup: {
          from: 'users',
          localField: 'targetUserId',
          foreignField: '_id',
          as: '_targetUser'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: '_authorUser'
        }
      },
      {
        $project: {
          _danmakus: 0,
          engagementScore: 0,
          _authorUser: 0
        }
      },
      {
        $addFields: {
          targetUserId: { $arrayElemAt: ['$_targetUser', 0] }
        }
      },
      { $project: { _targetUser: 0 } }
    ]);

    res.json(success({ list: insights, total, page: parseInt(page, 10), limit: parseInt(limit, 10) }));
  } catch (error) {
    next(error);
  }
}

// 搜索小凡看见
async function searchInsights(req, res, next) {
  try {
    const { keyword, userId: queryUserId, limit = 50 } = req.query;
    const currentUserId = req.user.userId;

    const trimmedKeyword = (keyword || '').trim();
    if (!trimmedKeyword) {
      return res.status(400).json(errors.badRequest('请输入搜索关键词'));
    }

    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
    const tenantId = getCurrentTenantId();

    const regex = { $regex: trimmedKeyword, $options: 'i' };
    const searchCondition = {
      $or: [{ title: regex }, { content: regex }, { summary: regex }]
    };

    let query;
    let isOwnerView;
    let approvedInsightIds = new Set();
    let approvedPeriodIds = new Set();
    let latestInsightRequests = new Map();
    let latestPeriodRequests = new Map();

    if (queryUserId) {
      // 搜索他人的 insights
      const targetUserId = queryUserId;
      ({
        approvedInsightIds,
        approvedPeriodIds,
        latestInsightRequests,
        latestPeriodRequests
      } = await getViewerAccessContext(currentUserId, targetUserId));
      isOwnerView = false;
      query = { targetUserId, status: 'completed', tenantId, ...searchCondition };
    } else {
      // 搜索自己的 insights
      isOwnerView = true;
      query = {
        $or: [{ userId: currentUserId }, { targetUserId: currentUserId }],
        status: 'completed',
        tenantId,
        ...searchCondition
      };
    }

    // 当自己搜索时，$or 条件需要合并
    if (!queryUserId) {
      query = {
        $and: [
          { $or: [{ userId: currentUserId }, { targetUserId: currentUserId }] },
          { status: 'completed' },
          { tenantId },
          { $or: [{ title: regex }, { content: regex }, { summary: regex }] }
        ]
      };
    }

    const insights = await Insight.find(query)
      .populate('sectionId', 'title day icon')
      .populate('periodId', 'name title')
      .populate('userId', 'nickname avatar avatarUrl _id')
      .populate('targetUserId', 'nickname avatar avatarUrl _id')
      .limit(limitNum)
      .exec();

    insights.sort((a, b) => {
      const dayA = a.sectionId?.day ?? -1;
      const dayB = b.sectionId?.day ?? -1;
      if (dayB !== dayA) return dayB - dayA;
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

    const serializedList = insights.map(insight =>
      serializeInsightForViewer(insight, {
        isOwnerView,
        allowedPeriodIds: approvedPeriodIds,
        allowedInsightIds: approvedInsightIds,
        latestInsightRequests,
        latestPeriodRequests
      })
    );

    res.json(success({ list: serializedList, total: serializedList.length, keyword: trimmedKeyword }));
  } catch (error) {
    next(error);
  }
}

// 记录分享，累加 shareCount
async function recordShare(req, res, next) {
  try {
    const { insightId } = req.params;
    await Insight.findByIdAndUpdate(insightId, { $inc: { shareCount: 1 } });
    res.json(success(null, '已记录'));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  generateInsight,
  getUserInsights,
  getMobileAdminInsights,
  getInsightDetail,
  deleteInsight,
  createInsightManual,
  createInsightFromExternal,
  getInsights,
  getInsightsForPeriod,
  updateInsight,
  deleteInsightManual,
  likeInsight,
  unlikeInsight,
  postDanmaku,
  getDanmaku,
  adminGetInsightDetail,
  adminGetDanmaku,
  adminLikeForUser,
  adminPostDanmakuForUser,
  adminDeleteDanmaku,
  createInsightRequest,
  getReceivedRequests,
  getSentRequests,
  getRequestStatus,
  approveInsightRequest,
  rejectInsightRequest,
  revokeInsightRequest,
  getInsightRequestsAdmin,
  getInsightRequestsStats,
  adminApproveRequest,
  adminRejectRequest,
  deleteInsightRequest,
  batchApproveRequests,
  getSectionInsightsForAdmin,
  recordShare,
  searchInsights
};
