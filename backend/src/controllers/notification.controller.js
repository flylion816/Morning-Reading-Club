const Notification = require("../models/Notification");
const User = require("../models/User");
const { success, errors } = require("../utils/response");
const logger = require("../utils/logger");
const { publishSyncEvent } = require("../services/sync.service");
const subscribeMessageService = require("../services/subscribe-message.service");
const { getCurrentTenantId } = require("../utils/tenantContext");

function serializeNotificationUser(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  return {
    _id: user._id,
    nickname: user.nickname || "",
    avatar: user.avatar || "",
    avatarUrl: user.avatarUrl || "",
  };
}

function resolveNotificationDisplaySender(notification) {
  const request = notification.requestId || {};

  if (notification.type === "request_created") {
    return (
      serializeNotificationUser(request.fromUserId) ||
      serializeNotificationUser(notification.senderId)
    );
  }

  if (
    ["request_approved", "request_rejected", "permission_revoked"].includes(
      notification.type,
    )
  ) {
    return (
      serializeNotificationUser(request.toUserId) ||
      serializeNotificationUser(notification.senderId)
    );
  }

  return serializeNotificationUser(notification.senderId);
}

function decorateNotificationForResponse(notification) {
  const data =
    notification && typeof notification.toObject === "function"
      ? notification.toObject()
      : notification;
  const displaySender = resolveNotificationDisplaySender(data);

  if (!displaySender) {
    return data;
  }

  return {
    ...data,
    displaySender,
    data: {
      ...(data.data || {}),
      senderName: displaySender.nickname || data.data?.senderName || "",
      senderAvatar: displaySender.avatarUrl || data.data?.senderAvatar || "",
    },
  };
}

/**
 * 获取用户的通知列表
 */
async function getUserNotifications(req, res, next) {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20, isRead } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1);

    // 构建查询条件
    const query = { userId, isArchived: false };
    if (isRead !== undefined && isRead !== "all") {
      query.isRead = isRead === "true";
    }

    // 计算分页
    const skip = (parsedPage - 1) * parsedLimit;

    // 查询总数
    const total = await Notification.countDocuments(query);

    // 查询通知，populate相关用户信息
    const notifications = await Notification.find(query)
      .populate("senderId", "nickname avatar avatarUrl")
      .populate({
        path: "requestId",
        select: "status fromUserId toUserId",
        populate: [
          { path: "fromUserId", select: "nickname avatar avatarUrl" },
          { path: "toUserId", select: "nickname avatar avatarUrl" },
        ],
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit);
    const responseNotifications = notifications.map(
      decorateNotificationForResponse,
    );

    res.json(
      success(
        {
          notifications: responseNotifications,
          pagination: {
            total,
            page: parsedPage,
            limit: parsedLimit,
            totalPages: Math.ceil(total / parsedLimit),
          },
        },
        "获取成功",
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * 获取未读通知数量
 */
async function getUnreadCount(req, res, next) {
  try {
    const userId = req.user.userId;

    const unreadCount = await Notification.countDocuments({
      userId,
      isRead: false,
      isArchived: false,
    });

    res.json(
      success(
        {
          unreadCount,
        },
        "获取成功",
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * 标记通知为已读
 */
async function markNotificationAsRead(req, res, next) {
  try {
    const { notificationId } = req.params;
    const userId = req.user.userId;

    // 查找通知
    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json(errors.notFound("通知不存在"));
    }

    // 验证用户是否是通知接收者
    if (notification.userId.toString() !== userId) {
      return res.status(403).json(errors.forbidden("无权操作"));
    }

    // 标记为已读
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: "update",
      collection: "notifications",
      documentId: notification._id.toString(),
      data: notification.toObject(),
    });

    res.json(success(notification, "已标记为已读"));
  } catch (error) {
    next(error);
  }
}

/**
 * 标记所有通知为已读
 */
async function markAllAsRead(req, res, next) {
  try {
    const userId = req.user.userId;

    // 更新所有未读通知
    const result = await Notification.updateMany(
      { userId, isRead: false, isArchived: false },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    res.json(
      success(
        {
          modifiedCount: result.modifiedCount,
        },
        `已标记 ${result.modifiedCount} 条通知为已读`,
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * 删除通知
 */
async function deleteNotification(req, res, next) {
  try {
    const { notificationId } = req.params;
    const userId = req.user.userId;

    // 查找通知
    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json(errors.notFound("通知不存在"));
    }

    // 验证用户是否是通知接收者
    if (notification.userId.toString() !== userId) {
      return res.status(403).json(errors.forbidden("无权删除"));
    }

    // 保存通知信息用于同步
    const notificationData = notification.toObject();

    // 删除通知
    await Notification.findByIdAndDelete(notificationId);

    // 异步同步到 MySQL
    publishSyncEvent({
      type: "delete",
      collection: "notifications",
      documentId: notificationId,
      data: notificationData,
    });

    res.json(success(null, "通知已删除"));
  } catch (error) {
    next(error);
  }
}

/**
 * 删除所有通知
 */
async function deleteAllNotifications(req, res, next) {
  try {
    const userId = req.user.userId;

    // 先查询所有要删除的通知
    const notifications = await Notification.find({ userId });

    const result = await Notification.deleteMany({ userId });

    // 异步同步到 MySQL（批量删除）
    notifications.forEach((notification) => {
      publishSyncEvent({
        type: "delete",
        collection: "notifications",
        documentId: notification._id.toString(),
        data: notification.toObject(),
      });
    });

    res.json(
      success(
        {
          deletedCount: result.deletedCount,
        },
        `已删除 ${result.deletedCount} 条通知`,
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * 获取当前用户的订阅消息场景状态
 */
async function getSubscriptionSettings(req, res, next) {
  try {
    const userId = req.user.userId;
    const settings = await subscribeMessageService.getUserSubscriptionStates(
      userId,
      {
        periodId: req.query?.periodId || null,
      },
    );

    res.json(success(settings, "获取成功"));
  } catch (error) {
    next(error);
  }
}

/**
 * 保存订阅消息授权结果
 */
async function saveSubscriptionGrants(req, res, next) {
  try {
    const userId = req.user.userId;
    const { grants = [] } = req.body || {};

    if (!Array.isArray(grants)) {
      return res.status(400).json(errors.badRequest("grants 必须是数组"));
    }

    const settings = await subscribeMessageService.recordUserGrantResults(
      userId,
      grants,
    );
    res.json(success(settings, "保存成功"));
  } catch (error) {
    next(error);
  }
}

/**
 * 内部函数：创建通知
 * 供其他controller调用
 */
async function buildNotificationData(options = {}) {
  const data = { ...(options.data || {}) };
  if (!options.senderId) {
    return data;
  }

  try {
    const sender = await User.findById(options.senderId)
      .select("nickname avatar avatarUrl")
      .lean();

    if (!sender) {
      return data;
    }

    data.senderName = sender.nickname || data.senderName || "";
    data.senderAvatar = sender.avatarUrl || data.senderAvatar || "";
  } catch (error) {
    logger.warn("Failed to enrich notification sender data", {
      senderId: options.senderId?.toString?.() || options.senderId,
      message: error.message,
    });
  }

  return data;
}

function buildNotificationUpsertQuery(userId, type, options = {}, data = {}) {
  const alternatives = [];

  if (options.requestId) {
    const requestIdText = options.requestId.toString();
    alternatives.push({ requestId: options.requestId });
    alternatives.push({ "data.insightRequestId": requestIdText });
  }

  if (data.insightId) {
    alternatives.push({ "data.insightId": data.insightId.toString() });
  }

  if (alternatives.length === 0) {
    return null;
  }

  return {
    userId,
    type,
    $or: alternatives,
  };
}

async function createNotification(userId, type, title, content, options = {}) {
  try {
    const data = await buildNotificationData(options);

    if (options.upsertExisting) {
      const upsertQuery = buildNotificationUpsertQuery(
        userId,
        type,
        options,
        data,
      );
      const existingNotification = upsertQuery
        ? await Notification.findOne(upsertQuery)
        : null;

      if (existingNotification) {
        const refreshedAt = new Date();
        existingNotification.title = title;
        existingNotification.content = content;
        existingNotification.requestId = options.requestId;
        existingNotification.senderId = options.senderId || null;
        existingNotification.data = data;
        existingNotification.isRead = false;
        existingNotification.readAt = null;
        existingNotification.isArchived = false;
        existingNotification.archivedAt = null;
        existingNotification.createdAt = refreshedAt;
        existingNotification.updatedAt = refreshedAt;

        await existingNotification.save();
        if (
          Notification.collection &&
          typeof Notification.collection.updateOne === "function"
        ) {
          await Notification.collection.updateOne(
            { _id: existingNotification._id },
            { $set: { createdAt: refreshedAt, updatedAt: refreshedAt } },
          );
        }

        publishSyncEvent({
          type: "update",
          collection: "notifications",
          documentId: existingNotification._id.toString(),
          data: existingNotification.toObject(),
        });

        if (options.wsManager) {
          const tenantId = getCurrentTenantId();
          if (tenantId) {
            options.wsManager.pushNotificationToUser(tenantId, userId, {
              type,
              title,
              content,
              notificationId: existingNotification._id,
              data,
            });
          }
        }

        return existingNotification;
      }
    }

    const notification = new Notification({
      userId,
      type,
      title,
      content,
      requestId: options.requestId || null,
      senderId: options.senderId || null,
      data,
    });

    await notification.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: "create",
      collection: "notifications",
      documentId: notification._id.toString(),
      data: notification.toObject(),
    });

    // 通过 WebSocket 推送通知（如果 wsManager 可用）
    if (options.wsManager) {
      const tenantId = getCurrentTenantId();
      if (tenantId) {
        options.wsManager.pushNotificationToUser(tenantId, userId, {
          type,
          title,
          content,
          notificationId: notification._id,
          data,
        });
      }
    }

    return notification;
  } catch (error) {
    logger.error("Failed to create notification", error, { userId, type });
    return null;
  }
}

/**
 * 内部函数：创建多条通知
 */
async function createNotifications(
  userIds,
  type,
  title,
  content,
  options = {},
) {
  try {
    const data = await buildNotificationData(options);
    const notifications = await Notification.insertMany(
      userIds.map((userId) => ({
        userId,
        type,
        title,
        content,
        requestId: options.requestId || null,
        senderId: options.senderId || null,
        data,
      })),
    );

    // 异步同步到 MySQL（批量创建）
    notifications.forEach((notification) => {
      publishSyncEvent({
        type: "create",
        collection: "notifications",
        documentId: notification._id.toString(),
        data: notification.toObject(),
      });
    });

    // 通过 WebSocket 推送所有通知（如果 wsManager 可用）
    if (options.wsManager) {
      const tenantId = getCurrentTenantId();
      if (tenantId) {
        userIds.forEach((userId) => {
          options.wsManager.pushNotificationToUser(tenantId, userId, {
            type,
            title,
            content,
            data,
          });
        });
      }
    }

    return notifications;
  } catch (error) {
    logger.error("Failed to batch create notifications", error, {
      userCount: userIds.length,
      type,
    });
    return [];
  }
}

/**
 * 归档单个通知
 */
async function archiveNotification(req, res, next) {
  try {
    const { notificationId } = req.params;
    const userId = req.user.userId;

    // 查找通知
    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json(errors.notFound("通知不存在"));
    }

    // 验证用户是否是通知接收者
    if (notification.userId.toString() !== userId) {
      return res.status(403).json(errors.forbidden("无权操作"));
    }

    // 标记为归档
    notification.isArchived = true;
    notification.archivedAt = new Date();
    await notification.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: "update",
      collection: "notifications",
      documentId: notification._id.toString(),
      data: notification.toObject(),
    });

    res.json(success(notification, "已归档"));
  } catch (error) {
    next(error);
  }
}

/**
 * 获取已归档的通知列表
 */
async function getArchivedNotifications(req, res, next) {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    // 计算分页
    const skip = (page - 1) * limit;

    // 查询总数
    const total = await Notification.countDocuments({
      userId,
      isArchived: true,
    });

    // 查询通知
    const notifications = await Notification.find({
      userId,
      isArchived: true,
    })
      .populate("senderId", "nickname avatar avatarUrl")
      .populate("requestId", "status fromUserId toUserId")
      .sort({ archivedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json(
      success(
        {
          notifications,
          pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit),
          },
        },
        "获取成功",
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * 归档所有通知
 */
async function archiveAllNotifications(req, res, next) {
  try {
    const userId = req.user.userId;

    // 更新所有未归档的通知
    const result = await Notification.updateMany(
      { userId, isArchived: false },
      {
        $set: {
          isArchived: true,
          archivedAt: new Date(),
        },
      },
    );

    res.json(
      success(
        {
          archivedCount: result.modifiedCount,
        },
        `已归档 ${result.modifiedCount} 条通知`,
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * 取消归档通知
 */
async function unarchiveNotification(req, res, next) {
  try {
    const { notificationId } = req.params;
    const userId = req.user.userId;

    // 查找通知
    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json(errors.notFound("通知不存在"));
    }

    // 验证用户是否是通知接收者
    if (notification.userId.toString() !== userId) {
      return res.status(403).json(errors.forbidden("无权操作"));
    }

    // 取消归档
    notification.isArchived = false;
    notification.archivedAt = null;
    await notification.save();

    // 异步同步到 MySQL
    publishSyncEvent({
      type: "update",
      collection: "notifications",
      documentId: notification._id.toString(),
      data: notification.toObject(),
    });

    res.json(success(notification, "已取消归档"));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUserNotifications,
  getUnreadCount,
  getSubscriptionSettings,
  markNotificationAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  saveSubscriptionGrants,
  createNotification,
  createNotifications,
  archiveNotification,
  getArchivedNotifications,
  archiveAllNotifications,
  unarchiveNotification,
};
