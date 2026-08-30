const axios = require("axios");
const Enrollment = require("../models/Enrollment");
const Section = require("../models/Section");
const User = require("../models/User");
const Period = require("../models/Period");
const SubscribeMessageGrant = require("../models/SubscribeMessageGrant");
const SubscribeMessageDelivery = require("../models/SubscribeMessageDelivery");
const logger = require("../utils/logger");
const {
  getCurrentTenantId,
  withSystemContext,
} = require("../utils/tenantContext");
const {
  resolveSubscribeSceneConfig,
  resolveSubscribeSceneList,
  normalizeMiniProgramPage,
} = require("../config/subscribe-message.config");
const {
  buildNextDayStudyReminderPlan,
  normalizeGrantContext,
} = require("../utils/study-reminder.utils");

const NON_CONSUMING_FAILURE_CODES = new Set([43101]);
const WECHAT_REAUTH_REQUIRED_ERROR_CODES = new Set([43101]);

function getSceneAutoTopUpTarget(sceneConfig) {
  const target = Number(sceneConfig?.autoTopUpTarget);
  if (Number.isInteger(target) && target > 0) {
    return target;
  }
  return 1;
}

async function resolveLeanResult(queryOrValue) {
  if (!queryOrValue) {
    return queryOrValue;
  }

  if (typeof queryOrValue.lean === "function") {
    const leanResult = queryOrValue.lean();
    if (leanResult && typeof leanResult.exec === "function") {
      return leanResult.exec();
    }
    return leanResult;
  }

  if (typeof queryOrValue.exec === "function") {
    return queryOrValue.exec();
  }

  if (typeof queryOrValue.then === "function") {
    return queryOrValue;
  }

  return queryOrValue;
}

function parseFieldKeyMap(envKey) {
  const raw = process.env[envKey];
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    logger.warn("订阅消息字段映射解析失败", {
      envKey,
      message: error.message,
    });
    return null;
  }
}

function stringifyTemplateValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function truncateTemplateValue(value, maxLength) {
  const normalized = stringifyTemplateValue(value).replace(/\s+/g, " ").trim();

  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }

  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizeTemplateValueByKey(fieldKey, value) {
  const normalizedKey = String(fieldKey || "");

  if (normalizedKey.startsWith("thing")) {
    return truncateTemplateValue(value, 20);
  }

  if (normalizedKey.startsWith("name")) {
    return truncateTemplateValue(value, 10);
  }

  if (normalizedKey.startsWith("phrase")) {
    return truncateTemplateValue(value, 5);
  }

  return truncateTemplateValue(value, 32);
}

function buildGrantQuery({ userId, scene, templateId }) {
  return {
    userId,
    scene,
    templateId,
    availableCount: { $gt: 0 },
  };
}

function normalizeId(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function getReminderSlot(grant, queued = false) {
  const prefix = queued ? "queued" : "";
  const dateKey = grant?.[`${prefix ? "queued" : "scheduled"}SendDateKey`];
  const date = grant?.[`${prefix ? "queued" : "scheduled"}SendDate`];
  const periodId = queued
    ? grant?.queuedPeriodId || grant?.queuedContext?.periodId
    : grant?.periodId || grant?.context?.periodId;

  if (!dateKey || !date || !periodId) return null;

  return {
    sendDate: date,
    sendDateKey: dateKey,
    periodId: normalizeId(periodId),
    context: normalizeGrantContext(
      queued ? grant.queuedContext : grant.context,
    ),
  };
}

function isSameReminderSlot(left, right) {
  return (
    !!left &&
    !!right &&
    left.sendDateKey === right.sendDateKey &&
    normalizeId(left.periodId) === normalizeId(right.periodId)
  );
}

function setCurrentReminderSlot(update, slot) {
  update.$set.availableCount = 1;
  update.$set.scheduledSendDate = slot.sendDate;
  update.$set.scheduledSendDateKey = slot.sendDateKey;
  update.$set.periodId = slot.periodId;
  update.$set.context = slot.context;
  update.$set.retryAt = null;
  update.$set.retryCount = 0;
}

function setQueuedReminderSlot(update, slot) {
  update.$set.queuedSendDate = slot.sendDate;
  update.$set.queuedSendDateKey = slot.sendDateKey;
  update.$set.queuedPeriodId = slot.periodId;
  update.$set.queuedContext = slot.context;
}

function getSlotTimestamp(slot) {
  const timestamp = new Date(slot.sendDate).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function clearQueuedReminderSlot(update) {
  update.$unset = {
    ...(update.$unset || {}),
    queuedSendDate: 1,
    queuedSendDateKey: 1,
    queuedPeriodId: 1,
    queuedContext: 1,
  };
}

function buildNextDayReminderAcceptanceUpdate({
  update,
  existingGrant,
  targetSlot,
}) {
  const currentSlot = getReminderSlot(existingGrant);
  const queuedSlot = getReminderSlot(existingGrant, true);

  if (isSameReminderSlot(currentSlot, targetSlot)) {
    return update;
  }

  // 当前槽位因发送失败/重新授权暂时为空时，把同一目标从排队槽提升回来。
  if (!currentSlot && isSameReminderSlot(queuedSlot, targetSlot)) {
    setCurrentReminderSlot(update, queuedSlot);
    clearQueuedReminderSlot(update);
    return update;
  }

  if (isSameReminderSlot(queuedSlot, targetSlot)) {
    return update;
  }

  if (!currentSlot || !(existingGrant?.availableCount > 0)) {
    setCurrentReminderSlot(update, targetSlot);
    return update;
  }

  if (!queuedSlot) {
    update.$set.periodId = currentSlot.periodId;
    update.$set.context = currentSlot.context;
    update.$set.sourceAction =
      currentSlot.context?.sourceAction || existingGrant?.sourceAction || null;
    setQueuedReminderSlot(update, targetSlot);
    return update;
  }

  // 保留最早的两个日期；通常 targetSlot 会是 queuedSlot，但这里也兼容时钟回拨/补录场景。
  const slots = [currentSlot, queuedSlot, targetSlot].sort(
    (left, right) => getSlotTimestamp(left) - getSlotTimestamp(right),
  );
  const nextCurrent = slots[0];
  const nextQueued = slots[1];

  if (!isSameReminderSlot(currentSlot, nextCurrent)) {
    setCurrentReminderSlot(update, nextCurrent);
  }
  if (!isSameReminderSlot(queuedSlot, nextQueued)) {
    setQueuedReminderSlot(update, nextQueued);
  }

  return update;
}

class SubscribeMessageService {
  constructor() {
    this.accessTokenCache = new Map();
  }

  resolveFieldKeyMap(sceneConfig) {
    const fieldKeyMap =
      parseFieldKeyMap(sceneConfig.fieldKeyMapEnv) ||
      sceneConfig.defaultFieldKeyMap;
    if (!fieldKeyMap) {
      return null;
    }

    const missingKeys = sceneConfig.fieldDefinitions
      .map((field) => field.name)
      .filter((fieldName) => !fieldKeyMap[fieldName]);

    if (missingKeys.length > 0) {
      logger.warn("订阅消息字段映射不完整", {
        scene: sceneConfig.scene,
        missingKeys,
      });
      return null;
    }

    return fieldKeyMap;
  }

  buildTemplateData(sceneConfig, fields = {}) {
    const fieldKeyMap = this.resolveFieldKeyMap(sceneConfig);
    if (!fieldKeyMap) {
      return null;
    }

    return sceneConfig.fieldDefinitions.reduce((result, field) => {
      const fieldKey = fieldKeyMap[field.name];
      result[fieldKey] = {
        value: normalizeTemplateValueByKey(fieldKey, fields[field.name]),
      };
      return result;
    }, {});
  }

  buildSummary(scenes) {
    const shortageScenes = scenes
      .filter(
        (scene) => (scene.availableCount || 0) < getSceneAutoTopUpTarget(scene),
      )
      .map((scene) => scene.scene);
    const reauthorizationScenes = scenes
      .filter((scene) => scene.deliveryBlocked)
      .map((scene) => scene.scene);

    return {
      totalScenes: scenes.length,
      availableSceneCount: scenes.filter((scene) => scene.availableCount > 0)
        .length,
      targetReadySceneCount: scenes.filter(
        (scene) =>
          (scene.availableCount || 0) >= getSceneAutoTopUpTarget(scene),
      ).length,
      shortageSceneCount: shortageScenes.length,
      needsReauthorizationSceneCount: reauthorizationScenes.length,
      totalAvailableCount: scenes.reduce(
        (sum, scene) => sum + (scene.availableCount || 0),
        0,
      ),
      shortageScenes,
      reauthorizationScenes,
    };
  }

  async getUserSubscriptionStates(userId, options = {}) {
    const { periodId = null, now = new Date() } = options;
    const grants =
      (await resolveLeanResult(SubscribeMessageGrant.find({ userId }))) || [];

    const sceneConfigs = await resolveSubscribeSceneList();
    const scenes = await Promise.all(
      sceneConfigs.map(async (sceneConfig) => {
        const grant = grants.find(
          (item) =>
            item.scene === sceneConfig.scene &&
            item.templateId === sceneConfig.templateId,
        );
        const autoTopUpTarget = getSceneAutoTopUpTarget(sceneConfig);
        const availableCount = grant?.availableCount || 0;
        const scene = {
          scene: sceneConfig.scene,
          title: sceneConfig.title,
          description: sceneConfig.description,
          templateId: sceneConfig.templateId,
          page: normalizeMiniProgramPage(sceneConfig.page),
          availableCount,
          autoTopUpTarget,
          remainingToTarget: Math.max(0, autoTopUpTarget - availableCount),
          periodId: grant?.periodId || grant?.context?.periodId || null,
          sourceAction:
            grant?.sourceAction || grant?.context?.sourceAction || null,
          scheduledSendDate: grant?.scheduledSendDate || null,
          scheduledSendDateKey: grant?.scheduledSendDateKey || null,
          queuedSendDate: grant?.queuedSendDate || null,
          queuedSendDateKey: grant?.queuedSendDateKey || null,
          queuedPeriodId:
            grant?.queuedPeriodId || grant?.queuedContext?.periodId || null,
          queuedContext: grant?.queuedContext || null,
          retryAt: grant?.retryAt || null,
          retryCount: grant?.retryCount || 0,
          context: grant?.context || {},
          lastResult: grant?.lastResult || null,
          lastAcceptedAt: grant?.lastAcceptedAt || null,
          lastRejectedAt: grant?.lastRejectedAt || null,
          lastRequestedAt: grant?.lastRequestedAt || null,
          deliveryBlocked: !!grant?.deliveryBlocked,
          deliveryBlockedReason: grant?.deliveryBlockedReason || null,
          lastWechatErrorCode: grant?.lastWechatErrorCode || null,
          lastWechatRefusedAt: grant?.lastWechatRefusedAt || null,
          needsReauthorization: !!grant?.deliveryBlocked,
        };

        if (sceneConfig.scene === "next_day_study_reminder" && periodId) {
          const period = await resolveLeanResult(
            Period.findById(periodId).select("_id startDate endDate").lean(),
          );
          const reminderPlan = buildNextDayStudyReminderPlan({ period, now });
          let eligible = reminderPlan.status === "ok";

          if (eligible) {
            const enrollment = await resolveLeanResult(
              Enrollment.findOne({
                userId,
                periodId,
                status: { $in: ["active", "completed"] },
                paymentStatus: { $in: ["paid", "free"] },
                deleted: { $ne: true },
              }).select("_id"),
            );
            const section = await resolveLeanResult(
              Section.findOne({
                periodId,
                day: reminderPlan.dayIndex,
                isPublished: true,
              }).select("_id"),
            );
            eligible = !!enrollment && !!section;
          }

          const targetSlot =
            reminderPlan.status === "ok"
              ? {
                  sendDate: reminderPlan.sendDate,
                  sendDateKey: reminderPlan.sendDateKey,
                  periodId: normalizeId(periodId),
                  context: normalizeGrantContext({
                    ...(grant?.context || {}),
                    periodId: normalizeId(periodId),
                  }),
                }
              : null;
          const currentSlot = getReminderSlot(grant);
          const queuedSlot = getReminderSlot(grant, true);

          scene.nextDay = {
            periodId: normalizeId(periodId),
            sendDate: reminderPlan.sendDate || null,
            sendDateKey: reminderPlan.sendDateKey || null,
            dayIndex: reminderPlan.dayIndex ?? null,
            status: reminderPlan.status,
            alreadyQueued:
              isSameReminderSlot(currentSlot, targetSlot) ||
              isSameReminderSlot(queuedSlot, targetSlot),
            canRequest:
              eligible &&
              !isSameReminderSlot(currentSlot, targetSlot) &&
              !isSameReminderSlot(queuedSlot, targetSlot),
          };
        }

        return scene;
      }),
    );

    return {
      scenes,
      summary: this.buildSummary(scenes),
    };
  }

  async recordUserGrantResults(userId, grants = []) {
    const now = new Date();

    for (const grant of grants) {
      const sceneConfig = await resolveSubscribeSceneConfig(grant.scene);
      if (
        !sceneConfig ||
        !sceneConfig.templateId ||
        grant.templateId !== sceneConfig.templateId
      ) {
        continue;
      }

      const existingGrant = await SubscribeMessageGrant.findOne({
        userId,
        scene: sceneConfig.scene,
        templateId: sceneConfig.templateId,
      });
      const currentAvailableCount = existingGrant?.availableCount || 0;
      const autoTopUpTarget = getSceneAutoTopUpTarget(sceneConfig);
      const normalizedContext = normalizeGrantContext(grant.context);
      let normalizedPeriodId =
        normalizedContext.periodId || existingGrant?.periodId || null;
      const result =
        grant.result === "accept"
          ? "accept"
          : grant.result === "reject"
            ? "reject"
            : grant.result === "ban"
              ? "ban"
              : "error";
      const update = {
        $set: {
          templateId: sceneConfig.templateId,
          lastResult: result,
          lastRequestedAt: now,
          autoTopUpTarget,
          context: normalizedContext,
          periodId: normalizedPeriodId,
          sourceAction:
            normalizedContext.sourceAction ||
            existingGrant?.sourceAction ||
            null,
        },
      };

      if (result === "accept") {
        update.$set.lastAcceptedAt = now;
        update.$set.deliveryBlocked = false;
        update.$set.deliveryBlockedReason = null;
        update.$set.lastWechatErrorCode = null;
        update.$set.lastWechatRefusedAt = null;

        if (sceneConfig.scene === "next_day_study_reminder") {
          const eligibleEnrollment = normalizedPeriodId
            ? await resolveLeanResult(
                Enrollment.findOne({
                  userId,
                  periodId: normalizedPeriodId,
                  status: { $in: ["active", "completed"] },
                  paymentStatus: { $in: ["paid", "free"] },
                  deleted: { $ne: true },
                }).select("periodId"),
              )
            : await resolveLeanResult(
                Enrollment.findOne({
                  userId,
                  status: { $in: ["active", "completed"] },
                  paymentStatus: { $in: ["paid", "free"] },
                  deleted: { $ne: true },
                })
                  .sort({ enrolledAt: -1, createdAt: -1 })
                  .select("periodId"),
              );

          if (eligibleEnrollment?.periodId) {
            normalizedPeriodId = String(eligibleEnrollment.periodId);
            update.$set.periodId = normalizedPeriodId;
            update.$set.context = {
              ...normalizedContext,
              periodId: normalizedPeriodId,
            };
          }

          const period = normalizedPeriodId
            ? await resolveLeanResult(Period.findById(normalizedPeriodId))
            : null;
          const reminderPlan = buildNextDayStudyReminderPlan({ period, now });

          // next_day 场景需要真实期次信息；如果 context 中没有 periodId，或者超出期次边界，
          // 就只记录本次授权事件，不覆盖已有的未来提醒状态。
          if (reminderPlan.status === "ok") {
            const section = await resolveLeanResult(
              Section.findOne({
                periodId: normalizedPeriodId,
                day: reminderPlan.dayIndex,
                isPublished: true,
              }).select("_id"),
            );

            if (section) {
              buildNextDayReminderAcceptanceUpdate({
                update,
                existingGrant,
                targetSlot: {
                  sendDate: reminderPlan.sendDate,
                  sendDateKey: reminderPlan.sendDateKey,
                  periodId: normalizedPeriodId,
                  context: {
                    ...normalizedContext,
                    periodId: normalizedPeriodId,
                  },
                },
              });
            }
          }
        } else {
          const nextAvailableCount = Math.min(
            currentAvailableCount + 1,
            autoTopUpTarget,
          );
          update.$set.availableCount = nextAvailableCount;
        }
      }

      if (result === "reject" || result === "ban") {
        update.$set.lastRejectedAt = now;
        update.$set.deliveryBlocked = true;
        update.$set.deliveryBlockedReason =
          result === "ban" ? "wechat_user_ban" : "wechat_user_reject";
        update.$set.lastWechatErrorCode = null;
        update.$set.lastWechatRefusedAt = now;
      }

      const grantQuery = {
        userId,
        scene: sceneConfig.scene,
        templateId: sceneConfig.templateId,
      };

      // 用当前两个日期槽做乐观并发保护：并发授权时，先成功的写入不会被后到请求覆盖。
      if (existingGrant?._id) {
        grantQuery._id = existingGrant._id;
        grantQuery.availableCount = existingGrant.availableCount || 0;
        grantQuery.scheduledSendDateKey =
          existingGrant.scheduledSendDateKey || null;
        grantQuery.queuedSendDateKey = existingGrant.queuedSendDateKey || null;
      }

      try {
        await SubscribeMessageGrant.findOneAndUpdate(grantQuery, update, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        });
      } catch (error) {
        // 并发首次授权可能由唯一索引产生重复键；另一请求已创建相同 grant，当前结果无需再覆盖。
        if (error?.code !== 11000) {
          throw error;
        }
      }
    }

    return this.getUserSubscriptionStates(userId);
  }

  async createDeliveryLog({
    userId,
    scene,
    templateId,
    status,
    targetPage = null,
    payload = {},
    responseData = null,
    errorCode = null,
    errorMessage = null,
    sourceType = null,
    sourceId = null,
  }) {
    return SubscribeMessageDelivery.create({
      userId,
      scene,
      templateId,
      status,
      targetPage,
      payload,
      responseData,
      errorCode,
      errorMessage,
      sourceType,
      sourceId: sourceId ? String(sourceId) : null,
      tenantId: getCurrentTenantId(),
    });
  }

  async restoreGrantInventoryIfNeeded(
    grant,
    { consumeOnSuccess = false, errorCode = null } = {},
  ) {
    if (consumeOnSuccess || !grant?._id) {
      return;
    }

    const normalizedErrorCode = Number(errorCode);
    if (!NON_CONSUMING_FAILURE_CODES.has(normalizedErrorCode)) {
      return;
    }

    await SubscribeMessageGrant.findByIdAndUpdate(grant._id, {
      $inc: { availableCount: 1 },
    });
  }

  async markGrantDeliveryBlockedIfNeeded(grant, { errorCode = null } = {}) {
    if (!grant?._id) {
      return;
    }

    const normalizedErrorCode = Number(errorCode);
    if (!WECHAT_REAUTH_REQUIRED_ERROR_CODES.has(normalizedErrorCode)) {
      return;
    }

    await SubscribeMessageGrant.findByIdAndUpdate(grant._id, {
      $set: {
        deliveryBlocked: true,
        deliveryBlockedReason: "wechat_delivery_refused",
        lastWechatErrorCode: normalizedErrorCode,
        lastWechatRefusedAt: new Date(),
      },
    });
  }

  async resolveWechatAccessTokenCredential(tenantId = getCurrentTenantId()) {
    if (!tenantId) {
      return {
        cacheKey: process.env.WECHAT_APPID || "__default__",
        appid: process.env.WECHAT_APPID,
        secret: process.env.WECHAT_SECRET,
      };
    }

    const Tenant = require("../models/Tenant");
    const tenant = await withSystemContext(null, () =>
      Tenant.findById(tenantId)
        .select("slug wxAppIds wechatLogin.appId +wechatLogin.appSecret")
        .lean(),
    );

    if (!tenant) {
      return {
        cacheKey: String(tenantId),
        appid: null,
        secret: null,
      };
    }

    const appid =
      tenant?.wechatLogin?.appId ||
      (Array.isArray(tenant?.wxAppIds) ? tenant.wxAppIds[0] : null) ||
      process.env.WECHAT_APPID;
    const secret =
      tenant?.wechatLogin?.appSecret ||
      (appid === process.env.WECHAT_APPID ? process.env.WECHAT_SECRET : null);

    return {
      cacheKey: appid || String(tenantId),
      appid,
      secret,
    };
  }

  async getAccessToken(options = {}) {
    const { appid, secret, cacheKey } =
      await this.resolveWechatAccessTokenCredential(options.tenantId);
    const cached = this.accessTokenCache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt && cached.value) {
      return cached.value;
    }

    if (!appid || !secret) {
      throw new Error("租户未配置微信 access_token 凭证");
    }

    const response = await axios.get(
      "https://api.weixin.qq.com/cgi-bin/token",
      {
        params: {
          grant_type: "client_credential",
          appid,
          secret,
        },
        timeout: 5000,
      },
    );

    if (response.data.errcode) {
      throw new Error(
        response.data.errmsg ||
          `微信 access_token 获取失败: ${response.data.errcode}`,
      );
    }

    this.accessTokenCache.set(cacheKey, {
      value: response.data.access_token,
      expiresAt:
        Date.now() + Math.max((response.data.expires_in - 120) * 1000, 60000),
    });

    return response.data.access_token;
  }

  clearAccessTokenCache(options = {}) {
    if (options.tenantId || options.cacheKey || options.appid) {
      this.accessTokenCache.delete(
        String(options.cacheKey || options.appid || options.tenantId),
      );
      return;
    }
    this.accessTokenCache.clear();
  }

  async sendSceneMessage({
    scene,
    recipientUserId,
    fields = {},
    page = "",
    sourceType = null,
    sourceId = null,
    consumeOnSuccess = false,
  }) {
    const sceneConfig = await resolveSubscribeSceneConfig(scene);
    if (!sceneConfig) {
      return null;
    }

    const targetPage = normalizeMiniProgramPage(page || sceneConfig.page);

    if (!sceneConfig.templateId) {
      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: "",
        status: "skipped_missing_config",
        targetPage,
        payload: { fields },
        errorMessage: "租户未配置订阅消息模板 ID",
        sourceType,
        sourceId,
      });
    }

    const fieldKeyMap = this.resolveFieldKeyMap(sceneConfig);

    if (!fieldKeyMap) {
      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: sceneConfig.templateId,
        status: "skipped_missing_config",
        targetPage,
        payload: { fields },
        errorMessage: `缺少 ${sceneConfig.fieldKeyMapEnv} 配置且代码默认映射不可用`,
        sourceType,
        sourceId,
      });
    }

    const user = await User.findById(recipientUserId)
      .select("openid nickname")
      .lean();
    if (!user?.openid) {
      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: sceneConfig.templateId,
        status: "skipped_missing_openid",
        targetPage,
        payload: { fields },
        errorMessage: "用户缺少 openid",
        sourceType,
        sourceId,
      });
    }

    const grantQuery = buildGrantQuery({
      userId: recipientUserId,
      scene,
      templateId: sceneConfig.templateId,
    });

    const blockedGrant = await SubscribeMessageGrant.findOne({
      ...grantQuery,
      deliveryBlocked: true,
    });

    if (blockedGrant) {
      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: sceneConfig.templateId,
        status: "skipped_reauthorization_required",
        targetPage,
        payload: { fields },
        errorCode: blockedGrant.lastWechatErrorCode || null,
        errorMessage: "微信侧订阅授权已失效，等待用户重新授权",
        sourceType,
        sourceId,
      });
    }

    let grant = consumeOnSuccess
      ? await SubscribeMessageGrant.findOne({
          ...grantQuery,
          deliveryBlocked: { $ne: true },
        })
      : await SubscribeMessageGrant.findOneAndUpdate(
          {
            ...grantQuery,
            deliveryBlocked: { $ne: true },
          },
          {
            $inc: { availableCount: -1 },
          },
          {
            new: true,
          },
        );

    if (!grant) {
      const reusableTemplateGrantQuery = {
        userId: recipientUserId,
        templateId: sceneConfig.templateId,
        availableCount: { $gt: 0 },
        deliveryBlocked: { $ne: true },
      };

      grant = consumeOnSuccess
        ? await SubscribeMessageGrant.findOne(reusableTemplateGrantQuery).sort({
            updatedAt: 1,
          })
        : await SubscribeMessageGrant.findOneAndUpdate(
            reusableTemplateGrantQuery,
            {
              $inc: { availableCount: -1 },
            },
            {
              new: true,
              sort: { updatedAt: 1 },
            },
          );
    }

    if (!grant) {
      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: sceneConfig.templateId,
        status: "skipped_no_grant",
        targetPage,
        payload: { fields },
        sourceType,
        sourceId,
      });
    }

    const templateData = this.buildTemplateData(sceneConfig, fields);
    if (!templateData) {
      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: sceneConfig.templateId,
        status: "skipped_missing_config",
        targetPage,
        payload: { fields },
        errorMessage: `缺少 ${sceneConfig.fieldKeyMapEnv} 配置且代码默认映射不可用`,
        sourceType,
        sourceId,
      });
    }

    if (
      process.env.NODE_ENV === "development" ||
      process.env.NODE_ENV === "test"
    ) {
      if (consumeOnSuccess) {
        await SubscribeMessageGrant.findByIdAndUpdate(grant._id, {
          $inc: { availableCount: -1 },
        });
      }

      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: sceneConfig.templateId,
        status: "mocked",
        targetPage,
        payload: {
          touser: user.openid,
          template_id: sceneConfig.templateId,
          page: targetPage,
          data: templateData,
        },
        sourceType,
        sourceId,
      });
    }

    try {
      const accessToken = await this.getAccessToken();
      const payload = {
        touser: user.openid,
        template_id: sceneConfig.templateId,
        page: targetPage,
        data: templateData,
      };

      let response = await axios.post(
        `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`,
        payload,
        {
          timeout: 5000,
        },
      );

      if (Number(response.data?.errcode) === 40001) {
        this.clearAccessTokenCache();
        const refreshedAccessToken = await this.getAccessToken();
        response = await axios.post(
          `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${refreshedAccessToken}`,
          payload,
          {
            timeout: 5000,
          },
        );
      }

      if (response.data.errcode && response.data.errcode !== 0) {
        await this.restoreGrantInventoryIfNeeded(grant, {
          consumeOnSuccess,
          errorCode: response.data.errcode,
        });
        await this.markGrantDeliveryBlockedIfNeeded(grant, {
          errorCode: response.data.errcode,
        });

        return this.createDeliveryLog({
          userId: recipientUserId,
          scene,
          templateId: sceneConfig.templateId,
          status: "failed",
          targetPage,
          payload,
          responseData: response.data,
          errorCode: response.data.errcode,
          errorMessage: response.data.errmsg || "订阅消息发送失败",
          sourceType,
          sourceId,
        });
      }

      if (consumeOnSuccess) {
        await SubscribeMessageGrant.findByIdAndUpdate(grant._id, {
          $inc: { availableCount: -1 },
        });
      }

      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: sceneConfig.templateId,
        status: "sent",
        targetPage,
        payload,
        responseData: response.data,
        sourceType,
        sourceId,
      });
    } catch (error) {
      logger.error("发送订阅消息失败", error, {
        scene,
        recipientUserId,
        sourceType,
        sourceId,
      });

      return this.createDeliveryLog({
        userId: recipientUserId,
        scene,
        templateId: sceneConfig.templateId,
        status: "failed",
        targetPage,
        payload: {
          fields,
          page: targetPage,
        },
        errorMessage: error.message,
        sourceType,
        sourceId,
      });
    }
  }
}

module.exports = new SubscribeMessageService();
