const Period = require('../models/Period');
const Checkin = require('../models/Checkin');
const User = require('../models/User');
const mongoose = require('mongoose');
const { success, errors } = require('../utils/response');
const { publishSyncEvent } = require('../services/sync.service');
const { getCurrentTenantId } = require('../utils/tenantContext');
const {
  calculatePeriodStatus,
  getPeriodStatusText,
  syncAllPeriodsStatus: syncPeriodStatuses
} = require('../services/period-status.service');

// 获取状态文本
function getStatusText(period) {
  // 动态计算状态，而不是使用数据库中的静态值
  return getPeriodStatusText(calculatePeriodStatus(period));
}

// 将 coverColor 转换为前端编辑表单可识别的格式（hex），展示端应优先使用 color 原值。
function convertCoverColorForForm(coverColor) {
  if (!coverColor) {
    return '#4a90e2'; // 默认蓝色
  }

  if (coverColor.includes('linear-gradient')) {
    const match = coverColor.match(/#[0-9a-fA-F]{6}/);
    return match ? match[0] : '#4a90e2';
  }

  if (coverColor.includes('rgb')) {
    return '#4a90e2';
  }

  // 如果已经是 hex 格式，直接返回
  if (coverColor.startsWith('#')) {
    return coverColor;
  }

  // 其他格式，返回默认值
  return '#4a90e2';
}

// 获取当前用户的期次列表（包含用户个人的打卡统计）
async function getPeriodListForUser(req, res, next) {
  try {
    const userId = req.user.userId || req.user._id;
    const userRole = req.user.role;
    const adminRole = req.admin && req.admin.role;
    const isAdmin = adminRole === 'admin' || adminRole === 'super_admin' ||
      adminRole === 'platform_superadmin' || adminRole === 'superadmin' ||
      adminRole === 'tenant_admin' || adminRole === 'operator' ||
      userRole === 'admin' || userRole === 'super_admin';
    const { page = 1, limit = 20, status, isPublished } = req.query;

    const query = {};
    if (status) {
      if (status === 'active') {
        query.status = 'ongoing';
      } else {
        query.status = status;
      }
    }

    // 非管理员只看已发布的期次；管理员可看全部
    if (!isAdmin) {
      query.isPublished = true;
    } else if (isPublished !== undefined) {
      query.isPublished = isPublished === 'true';
    }

    const normalizedUserId = mongoose.Types.ObjectId.isValid(String(userId))
      ? new mongoose.Types.ObjectId(String(userId))
      : userId;

    // 所有用户（含管理员）均受可见范围约束，specific 期次只有在名单内或已报名的用户才能看到
    // visibilityType 不存在（旧数据）视同 'all'
    const Enrollment = require('../models/Enrollment');
    const enrolledPeriodIds = await Enrollment.distinct('periodId', { userId: normalizedUserId });
    query.$or = [
      { visibilityType: { $exists: false } },
      { visibilityType: 'all' },
      { visibilityType: 'specific', visibleUserIds: normalizedUserId },
      { visibilityType: 'specific', _id: { $in: enrolledPeriodIds } }
    ];

    const total = await Period.countDocuments(query);
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const periods = await Period.find(query)
      .sort({ endDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .select('-__v');

    const periodIds = periods.map(period => period._id).filter(Boolean);
    const checkinStats = periodIds.length
      ? await Checkin.aggregate([
          {
            $match: {
              userId: normalizedUserId,
              periodId: { $in: periodIds }
            }
          },
          {
            $group: {
              _id: '$periodId',
              checkedDays: { $sum: 1 }
            }
          }
        ])
      : [];
    const checkedDaysByPeriod = new Map(
      checkinStats.map(item => [String(item._id), item.checkedDays || 0])
    );

    // 转换数据格式，并合并用户的打卡统计
    const transformedPeriods = periods.map(period => {
      const periodObj = period.toObject ? period.toObject({ virtuals: true }) : period;

      return {
        ...periodObj,
        status: calculatePeriodStatus(period),
        title: period.title || period.name,
        color: period.coverColor || 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
        // 转换 coverColor 为前端编辑表单能识别的格式（hex/rgb，不支持渐变）
        coverColor: convertCoverColorForForm(period.coverColor),
        icon: period.icon || period.coverEmoji || '📚',
        startTime: period.startDate ? period.startDate.toISOString() : null,
        endTime: period.endDate ? period.endDate.toISOString() : null,
        dateRange: periodObj.dateRange || '',
        statusText: getStatusText(period),
        checkedDays: checkedDaysByPeriod.get(String(period._id)) || 0,
        progress: 0,
        isCheckedIn: false,
        currentEnrollment: period.enrollmentCount || 0
      };
    });

    const response = success(transformedPeriods);
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

// 获取期次列表
async function getPeriodList(req, res, next) {
  try {
    const { page = 1, limit = 20, status, isPublished } = req.query;

    const query = {};
    if (status) {
      // 处理测试中使用的"active"状态 -> 映射为"ongoing"
      if (status === 'active') {
        query.status = 'ongoing';
      } else {
        query.status = status;
      }
    }

    const isAdmin = req.admin && (
      req.admin.role === 'admin' || req.admin.role === 'super_admin' ||
      req.admin.role === 'platform_superadmin' || req.admin.role === 'superadmin' ||
      req.admin.role === 'tenant_admin' || req.admin.role === 'operator'
    );

    // 管理员默认看全部期次（含未发布）；公开端点默认只看已发布
    if (isPublished !== undefined) {
      query.isPublished = isPublished === 'true';
    } else if (!isAdmin) {
      query.isPublished = true;
    }

    // 非管理员只能看全部可见的期次，管理员可看所有（含指定可见）
    if (!isAdmin) {
      query.visibilityType = { $ne: 'specific' };
    }

    const total = await Period.countDocuments(query);
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const periods = await Period.find(query)
      .sort({ endDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('visibleUserIds', '_id nickname avatarUrl')
      .select('-__v');

    // 转换数据格式以匹配前端期望
    // 注意：price 和 originalPrice 单位为"分"（100分 = 1元），前端负责转换显示
    const transformedPeriods = periods.map(period => {
      // 使用 virtuals: true 确保虚拟字段被包含
      const periodObj = period.toObject ? period.toObject({ virtuals: true }) : period;

      // 添加前端需要的字段
      return {
        ...periodObj,
        status: calculatePeriodStatus(period),
        title: period.title || period.name,
        color: period.coverColor || 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
        coverColor: convertCoverColorForForm(period.coverColor),
        icon: period.icon || period.coverEmoji || '📚',
        startTime: period.startDate ? period.startDate.toISOString() : null,
        endTime: period.endDate ? period.endDate.toISOString() : null,
        dateRange: periodObj.dateRange || '',
        statusText: getStatusText(period),
        checkedDays: 0,
        progress: 0,
        isCheckedIn: false,
        currentEnrollment: period.enrollmentCount || 0,
        visibleUsers: periodObj.visibleUserIds || []
      };
    });

    // 返回带分页信息的响应
    const response = success(transformedPeriods);
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

// 获取期次详情
async function getPeriodDetail(req, res, next) {
  try {
    const { periodId } = req.params;

    const period = await Period.findById(periodId);

    if (!period) {
      return res.status(404).json(errors.notFound('期次不存在'));
    }

    // 返回转换后的数据，与列表 API 格式一致
    const periodObj = period.toObject ? period.toObject({ virtuals: true }) : period;

    const transformedPeriod = {
      ...periodObj,
      status: calculatePeriodStatus(period),
      title: period.title || period.name,
      color: period.coverColor || 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
      // 转换 coverColor 为前端编辑表单能识别的格式（hex/rgb，不支持渐变）
      coverColor: convertCoverColorForForm(period.coverColor),
      icon: period.icon || period.coverEmoji || '📚',
      startTime: period.startDate ? period.startDate.toISOString() : null,
      endTime: period.endDate ? period.endDate.toISOString() : null,
      dateRange: periodObj.dateRange || '',
      statusText: getStatusText(period)
    };

    res.json(success(transformedPeriod));
  } catch (error) {
    next(error);
  }
}

// 创建期次（管理员）
async function createPeriod(req, res, next) {
  try {
    const {
      name,
      subtitle,
      title,
      description,
      icon,
      coverColor,
      coverEmoji,
      startDate,
      endDate,
      totalDays,
      price,
      originalPrice,
      maxEnrollment,
      sortOrder,
      meetingId,
      meetingJoinUrl,
      coverImage,
      inviteTitle,
      visibilityType,
      visibleUserIds
    } = req.body;

    const period = await Period.create({
      name,
      subtitle,
      title: title || name,
      description,
      icon,
      coverColor,
      coverEmoji,
      startDate,
      endDate,
      totalDays,
      price,
      originalPrice,
      maxEnrollment,
      sortOrder,
      meetingId: meetingId || null,
      meetingJoinUrl: meetingJoinUrl || null,
      coverImage: coverImage || null,
      inviteTitle: inviteTitle || null,
      visibilityType: visibilityType || 'all',
      visibleUserIds: visibilityType === 'specific' ? (visibleUserIds || []) : [],
      status: calculatePeriodStatus({ startDate, endDate }),
      isPublished: false,
      enrollmentOpen: false,
      currentEnrollment: 0,
      tenantId: getCurrentTenantId()
    });

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'create',
      collection: 'periods',
      documentId: period._id.toString(),
      data: period.toObject()
    });

    res.status(201).json(success(period, '期次创建成功'));
  } catch (error) {
    next(error);
  }
}

// 更新期次（管理员）
async function updatePeriod(req, res, next) {
  try {
    const { periodId } = req.params;
    const updates = req.body;

    const period = await Period.findById(periodId);

    if (!period) {
      return res.status(404).json(errors.notFound('期次不存在'));
    }

    // 更新字段（跳过前端虚拟字段 visibleUsers）
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined && key !== 'visibleUsers') {
        period[key] = updates[key];
      }
    });

    // 切换为全部可见时清空用户名单
    if (updates.visibilityType === 'all') {
      period.visibleUserIds = [];
    }
    // 数组字段直接赋值需要手动标记 modified
    period.markModified('visibleUserIds');

    period.status = calculatePeriodStatus(period);
    await period.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'update',
      collection: 'periods',
      documentId: period._id.toString(),
      data: period.toObject()
    });

    // 返回转换后的数据，与列表 API 格式一致
    const periodObj = period.toObject ? period.toObject({ virtuals: true }) : period;

    const transformedPeriod = {
      ...periodObj,
      status: calculatePeriodStatus(period),
      title: period.title || period.name,
      color: period.coverColor || 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
      coverColor: convertCoverColorForForm(period.coverColor),
      icon: period.icon || period.coverEmoji || '📚',
      startTime: period.startDate ? period.startDate.toISOString() : null,
      endTime: period.endDate ? period.endDate.toISOString() : null,
      dateRange: periodObj.dateRange || '',
      statusText: getStatusText(period)
    };

    res.json(success(transformedPeriod, '期次更新成功'));
  } catch (error) {
    next(error);
  }
}

// 删除期次（管理员）
async function deletePeriod(req, res, next) {
  try {
    const { periodId } = req.params;

    const period = await Period.findById(periodId);

    if (!period) {
      return res.status(404).json(errors.notFound('期次不存在'));
    }

    // 检查是否有报名
    if (period.enrollmentCount > 0) {
      return res.status(400).json(errors.badRequest('该期次已有用户报名，无法删除'));
    }

    // 保存期次信息用于同步
    const periodData = period.toObject();

    await Period.findByIdAndDelete(periodId);

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'delete',
      collection: 'periods',
      documentId: period._id.toString(),
      data: periodData
    });

    res.json(success(null, '期次删除成功'));
  } catch (error) {
    next(error);
  }
}

// 复制期次（管理员）
async function copyPeriod(req, res, next) {
  try {
    const { id } = req.params;
    const {
      name,
      subtitle,
      title,
      description,
      icon,
      coverColor,
      coverEmoji,
      startDate,
      endDate,
      totalDays,
      price,
      originalPrice,
      maxEnrollment,
      sortOrder
    } = req.body;

    // 验证源期次是否存在
    const sourcePeriod = await Period.findById(id);
    if (!sourcePeriod) {
      return res.status(404).json(errors.notFound('源期次不存在'));
    }

    // 继承源期次的 tenantId（SuperAdmin 在 bypass 模式下 getCurrentTenantId() 返回 null）
    const tenantId = getCurrentTenantId() || sourcePeriod.tenantId;

    // 创建新期次（会议号和邀请链接都设为 null，新期次会议配置不同）
    const newPeriod = await Period.create({
      name,
      subtitle,
      title: title || name,
      description,
      icon,
      coverColor,
      coverEmoji,
      startDate,
      endDate,
      totalDays,
      price,
      originalPrice,
      maxEnrollment,
      sortOrder,
      meetingId: null,
      meetingJoinUrl: null,
      status: calculatePeriodStatus({ startDate, endDate }),
      isPublished: false,
      currentEnrollment: 0,
      tenantId
    });

    // 获取源期次的所有课节
    const Section = require('../models/Section');
    const sourceSections = await Section.find({ periodId: id });

    // 复制课节
    let copiedSectionCount = 0;
    if (sourceSections.length > 0) {
      const newSections = sourceSections.map(section => {
        const sectionObj = section.toObject();
        delete sectionObj._id;
        delete sectionObj.createdAt;
        delete sectionObj.updatedAt;
        // 每期现场生成的音视频内容不随期次复制
        delete sectionObj.closingVideo;
        delete sectionObj.podcastUrl;
        delete sectionObj.podcastDescription;
        delete sectionObj.podcastDuration;
        delete sectionObj.audioUrl;
        return {
          ...sectionObj,
          periodId: newPeriod._id,
          tenantId,
          checkinCount: 0
        };
      });

      await Section.insertMany(newSections);
      copiedSectionCount = newSections.length;
    }

    // 异步同步到 MySQL
    publishSyncEvent({
      type: 'create',
      collection: 'periods',
      documentId: newPeriod._id.toString(),
      data: newPeriod.toObject()
    });

    res.status(201).json(success({
      period: newPeriod,
      copiedSectionCount
    }, `期次复制成功，已复制 ${copiedSectionCount} 节课程`));
  } catch (error) {
    next(error);
  }
}

/**
 * 根据当前日期批量同步所有期次的 status 字段
 * POST /api/v1/periods/sync-status
 */
async function syncAllPeriodsStatus(req, res, next) {
  try {
    const result = await syncPeriodStatuses();

    res.json(
      success(
        result,
        `成功同步 ${result.updatedCount} 个期次的状态`
      )
    );
  } catch (error) {
    next(error);
  }
}

// 获取邀请落地页信息（公开接口）
async function getInviteInfo(req, res, next) {
  try {
    const { periodId } = req.params;
    const { inviterId } = req.query;

    const period = await Period.findById(periodId).select('-__v');

    if (!period) {
      return res.status(404).json(errors.notFound('期次不存在'));
    }

    if (!period.isPublished) {
      return res.status(404).json(errors.notFound('期次不存在'));
    }

    const periodObj = period.toObject({ virtuals: true });
    const periodData = {
      ...periodObj,
      status: calculatePeriodStatus(period),
      title: period.title || period.name,
      color: period.coverColor || 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
      icon: period.icon || period.coverEmoji || '📚',
      startTime: period.startDate ? period.startDate.toISOString() : null,
      endTime: period.endDate ? period.endDate.toISOString() : null,
      dateRange: periodObj.dateRange || '',
      statusText: getStatusText(period),
      currentEnrollment: period.enrollmentCount || 0
    };

    let inviter = null;
    if (inviterId && mongoose.Types.ObjectId.isValid(inviterId)) {
      const inviterUser = await User.findById(inviterId).select('nickname avatarUrl avatar');
      if (inviterUser) {
        inviter = {
          _id: inviterUser._id,
          nickname: inviterUser.nickname,
          avatarUrl: inviterUser.avatarUrl || null,
          avatar: inviterUser.avatar || '🦁'
        };
      }
    }

    res.json(success({ period: periodData, inviter }));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPeriodList,
  getPeriodListForUser,
  getPeriodDetail,
  getInviteInfo,
  createPeriod,
  updatePeriod,
  deletePeriod,
  copyPeriod,
  syncAllPeriodsStatus
};
