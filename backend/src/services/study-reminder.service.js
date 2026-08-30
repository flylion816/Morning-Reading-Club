const cron = require("node-cron");
const Enrollment = require("../models/Enrollment");
const Period = require("../models/Period");
const Section = require("../models/Section");
const SubscribeMessageGrant = require("../models/SubscribeMessageGrant");
const SubscribeMessageDelivery = require("../models/SubscribeMessageDelivery");
const Tenant = require("../models/Tenant");
const subscribeMessageService = require("./subscribe-message.service");
const logger = require("../utils/logger");
const {
  buildScheduledStudyReminderPlan,
  formatShanghaiDateTimeLabel,
  getShanghaiDateKey,
  getShanghaiDateTime,
} = require("../utils/study-reminder.utils");
const {
  resolveSubscribeSceneConfig,
} = require("../config/subscribe-message.config");
const { withSystemContext } = require("../utils/tenantContext");

const SCENE = "next_day_study_reminder";
const CRON_OPTIONS = { timezone: "Asia/Shanghai" };
const NON_RETRYABLE_ERROR_CODES = new Set([40003, 40037, 43101, 47003]);
const DEFAULT_TENANT_NAME = "晨读营";
const DELIVERY_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

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

function isRetryableDelivery(delivery) {
  if (!delivery || delivery.status !== "failed") {
    return false;
  }

  if (
    delivery.errorCode === null ||
    delivery.errorCode === undefined ||
    delivery.errorCode === ""
  ) {
    return true;
  }

  return !NON_RETRYABLE_ERROR_CODES.has(Number(delivery.errorCode));
}

async function clearGrantSchedule(grantId, extra = {}) {
  return SubscribeMessageGrant.findByIdAndUpdate(
    grantId,
    {
      $set: {
        availableCount: 0,
        scheduledSendDate: null,
        scheduledSendDateKey: null,
        retryAt: null,
        retryCount: 0,
        deliveryClaimedAt: null,
        deliveryClaimToken: null,
        deliveryClaimDateKey: null,
        ...extra,
      },
    },
    { new: true },
  );
}

function getQueuedSlot(grant) {
  if (
    !grant?.queuedSendDate ||
    !grant?.queuedSendDateKey ||
    !grant?.queuedPeriodId
  ) {
    return null;
  }

  return {
    sendDate: grant.queuedSendDate,
    sendDateKey: grant.queuedSendDateKey,
    periodId: grant.queuedPeriodId,
    context: grant.queuedContext || {},
  };
}

function buildClaimToken() {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
}

async function claimGrantForDelivery(
  grant,
  { attemptType = "scheduled", now = new Date() } = {},
) {
  if (!grant?._id) return null;

  const dueCondition =
    attemptType === "retry"
      ? {
          retryAt: { $lte: now },
          retryCount: { $gte: 1 },
        }
      : {
          scheduledSendDate: { $lte: now },
          retryAt: null,
        };
  const claimToken = buildClaimToken();
  const claimedAtBefore = new Date(now.getTime() - DELIVERY_CLAIM_TIMEOUT_MS);
  const claimed = await resolveLeanResult(
    SubscribeMessageGrant.findOneAndUpdate(
      {
        _id: grant._id,
        scene: SCENE,
        availableCount: { $gt: 0 },
        ...dueCondition,
        $or: [
          { deliveryClaimToken: null },
          { deliveryClaimedAt: null },
          { deliveryClaimedAt: { $lt: claimedAtBefore } },
        ],
      },
      {
        $set: {
          deliveryClaimedAt: now,
          deliveryClaimToken: claimToken,
          deliveryClaimDateKey: grant.scheduledSendDateKey || null,
        },
      },
      { new: true },
    ),
  );

  if (!claimed) return null;
  return { grant: claimed, claimToken };
}

async function finishGrantSchedule(grant, claimToken, extra = {}) {
  const queuedSlot = getQueuedSlot(grant);
  const query = {
    _id: grant._id,
    ...(claimToken ? { deliveryClaimToken: claimToken } : {}),
  };
  const update = {
    $set: {
      ...extra,
      retryAt: null,
      retryCount: 0,
      deliveryClaimedAt: null,
      deliveryClaimToken: null,
      deliveryClaimDateKey: null,
    },
  };

  if (queuedSlot) {
    update.$set.availableCount = 1;
    update.$set.scheduledSendDate = queuedSlot.sendDate;
    update.$set.scheduledSendDateKey = queuedSlot.sendDateKey;
    update.$set.periodId = queuedSlot.periodId;
    update.$set.context = queuedSlot.context;
    update.$unset = {
      queuedSendDate: 1,
      queuedSendDateKey: 1,
      queuedPeriodId: 1,
      queuedContext: 1,
    };
  } else {
    update.$set.availableCount = 0;
    update.$set.scheduledSendDate = null;
    update.$set.scheduledSendDateKey = null;
  }

  return SubscribeMessageGrant.findOneAndUpdate(query, update, { new: true });
}

async function queueRetryForGrant(
  grantId,
  retryAt,
  extra = {},
  claimToken = null,
) {
  const query = {
    _id: grantId,
    ...(claimToken ? { deliveryClaimToken: claimToken } : {}),
  };
  return SubscribeMessageGrant.findOneAndUpdate(
    query,
    {
      $set: {
        retryAt,
        retryCount: 1,
        deliveryClaimedAt: null,
        deliveryClaimToken: null,
        deliveryClaimDateKey: null,
        ...extra,
      },
    },
    { new: true },
  );
}

async function pauseGrantScheduleForReauthorization(
  grantId,
  extra = {},
  claimToken = null,
) {
  const query = {
    _id: grantId,
    ...(claimToken ? { deliveryClaimToken: claimToken } : {}),
  };
  return SubscribeMessageGrant.findOneAndUpdate(
    query,
    {
      $set: {
        scheduledSendDate: null,
        scheduledSendDateKey: null,
        retryAt: null,
        retryCount: 0,
        availableCount: 0,
        deliveryClaimedAt: null,
        deliveryClaimToken: null,
        deliveryClaimDateKey: null,
        ...extra,
      },
    },
    { new: true },
  );
}

async function resolveTenantDisplayName(tenantId) {
  if (!tenantId) {
    return DEFAULT_TENANT_NAME;
  }

  try {
    const tenant = await withSystemContext(null, () =>
      Tenant.findById(tenantId).select("name branding.brandName").lean().exec(),
    );
    return (
      String(
        tenant?.branding?.brandName || tenant?.name || DEFAULT_TENANT_NAME,
      ).trim() || DEFAULT_TENANT_NAME
    );
  } catch (error) {
    logger.warn("学习提醒租户名称解析失败，使用默认名称", {
      tenantId: tenantId?.toString?.() || tenantId,
      error: error.message,
    });
    return DEFAULT_TENANT_NAME;
  }
}

function buildReminderActivityName(
  period = {},
  tenantName = DEFAULT_TENANT_NAME,
) {
  const rawName = String(
    period?.name || period?.title || tenantName || DEFAULT_TENANT_NAME,
  ).trim();
  if (!rawName) {
    return `${DEFAULT_TENANT_NAME}晨读营`;
  }

  return rawName.includes("晨读营") ? rawName : `${rawName}晨读营`;
}

function buildReminderFields({
  period,
  section,
  sendDate,
  tenantName = DEFAULT_TENANT_NAME,
}) {
  const dayIndex = Number(section?.day || 0);
  const sectionTitle = String(section?.title || "").trim();
  const displayStartTime = getShanghaiDateTime(
    getShanghaiDateKey(sendDate),
    6,
    0,
    0,
  );
  const safeTenantName =
    String(tenantName || DEFAULT_TENANT_NAME).trim() || DEFAULT_TENANT_NAME;

  return {
    activityName: buildReminderActivityName(period, safeTenantName),
    activityContent: sectionTitle || `第${dayIndex + 1}天 晨读任务`,
    startTime: formatShanghaiDateTimeLabel(displayStartTime || sendDate),
    joinMethod: `进入${safeTenantName}小程序去学习`,
  };
}

async function sendOneReminder(
  grant,
  { attemptType = "scheduled", now = new Date() } = {},
) {
  const sceneConfig = await resolveSubscribeSceneConfig(SCENE);
  if (!sceneConfig || !sceneConfig.templateId) {
    return { status: "skipped_missing_config" };
  }

  const claimed = await claimGrantForDelivery(grant, { attemptType, now });
  if (!claimed) {
    return { status: "skipped_claimed" };
  }

  const workingGrant = claimed.grant;
  const claimToken = claimed.claimToken;

  try {
    const periodId =
      workingGrant.periodId || workingGrant.context?.periodId || null;
    if (!periodId) {
      await finishGrantSchedule(workingGrant, claimToken);
      return { status: "skipped_missing_period" };
    }

    const enrollment = await Enrollment.findOne({
      userId: workingGrant.userId,
      periodId,
      status: { $in: ["active", "completed"] },
      paymentStatus: { $in: ["paid", "free"] },
      deleted: { $ne: true },
    })
      .lean()
      .exec();

    if (!enrollment) {
      await finishGrantSchedule(workingGrant, claimToken);
      return { status: "skipped_ineligible" };
    }

    const period = await Period.findById(periodId)
      .select("name title startDate endDate")
      .lean()
      .exec();
    if (!period) {
      await finishGrantSchedule(workingGrant, claimToken);
      return { status: "skipped_missing_period" };
    }

    const sendDate =
      workingGrant.scheduledSendDate || workingGrant.retryAt || null;
    const plan = buildScheduledStudyReminderPlan({ period, sendDate });

    if (plan.status !== "ok") {
      await finishGrantSchedule(workingGrant, claimToken);
      return { status: `skipped_${plan.status}` };
    }

    const resolvedSection = await Section.findOne({
      periodId: period._id,
      day: plan.dayIndex,
      isPublished: true,
    })
      .select("title day")
      .lean()
      .exec();

    if (!resolvedSection) {
      await finishGrantSchedule(workingGrant, claimToken);
      return { status: "skipped_missing_section" };
    }

    const sourceId = `${workingGrant.userId}:${periodId}:${plan.sendDateKey}`;
    const existingDelivery = await resolveLeanResult(
      SubscribeMessageDelivery.findOne({
        sourceType: "study_reminder",
        sourceId,
        status: { $in: ["sent", "mocked"] },
      }).select("_id"),
    );
    if (existingDelivery) {
      await finishGrantSchedule(workingGrant, claimToken);
      return { status: "skipped_already_delivered" };
    }

    const tenantName = await resolveTenantDisplayName(
      workingGrant.tenantId || enrollment.tenantId || period.tenantId,
    );
    const delivery = await subscribeMessageService.sendSceneMessage({
      scene: SCENE,
      recipientUserId: workingGrant.userId,
      fields: buildReminderFields({
        period,
        section: resolvedSection,
        sendDate: plan.sendDate,
        tenantName,
      }),
      page: sceneConfig.page,
      sourceType: "study_reminder",
      sourceId,
      consumeOnSuccess: true,
    });

    if (delivery?.status === "sent" || delivery?.status === "mocked") {
      await finishGrantSchedule(workingGrant, claimToken);
      return { status: "sent" };
    }

    if (
      delivery?.status === "skipped_reauthorization_required" ||
      (delivery?.status === "failed" && Number(delivery.errorCode) === 43101)
    ) {
      await pauseGrantScheduleForReauthorization(
        workingGrant._id,
        {},
        claimToken,
      );
      return { status: "skipped_reauthorization_required" };
    }

    if (
      isRetryableDelivery(delivery) &&
      attemptType !== "retry" &&
      (!workingGrant.retryCount || workingGrant.retryCount < 1)
    ) {
      const retryAt = getShanghaiDateTime(
        getShanghaiDateKey(plan.sendDate),
        6,
        0,
        0,
      );
      await queueRetryForGrant(
        workingGrant._id,
        retryAt,
        {
          availableCount: workingGrant.availableCount || 1,
          scheduledSendDate: workingGrant.scheduledSendDate || plan.sendDate,
          scheduledSendDateKey:
            workingGrant.scheduledSendDateKey || plan.sendDateKey,
          periodId,
          sourceAction:
            workingGrant.sourceAction ||
            workingGrant.context?.sourceAction ||
            null,
        },
        claimToken,
      );
      return { status: "retry_queued", retryAt };
    }

    await finishGrantSchedule(workingGrant, claimToken);
    return {
      status:
        delivery?.status === "failed"
          ? "failed"
          : delivery?.status?.startsWith("skipped_")
            ? delivery.status
            : `skipped_${delivery?.status || "unknown"}`,
    };
  } catch (error) {
    // 只有持有领取锁的 worker 才能清理，避免误删其他 worker 的排队项。
    try {
      await finishGrantSchedule(workingGrant, claimToken);
    } catch (cleanupError) {
      logger.error("明日学习提醒领取锁清理失败", cleanupError, {
        grantId: workingGrant?._id,
      });
    }
    throw error;
  }
}

async function sendDueNextDayStudyReminders({
  attemptType = "scheduled",
} = {}) {
  const now = new Date();
  // 第一步：跨租户拿出所有"到期未发送"的 grant，只读 tenantId 和 _id
  // 注意：必须在回调内调用 .exec() 确保 Query 在 AsyncLocalStorage 上下文内执行
  const dueQuery = {
    scene: SCENE,
    availableCount: { $gt: 0 },
    ...(attemptType === "retry"
      ? {
          retryAt: { $lte: now },
          retryCount: { $gte: 1 },
        }
      : {
          scheduledSendDate: { $lte: now },
          retryAt: null,
        }),
    $or: [
      { deliveryClaimToken: null },
      { deliveryClaimedAt: null },
      {
        deliveryClaimedAt: {
          $lt: new Date(now.getTime() - DELIVERY_CLAIM_TIMEOUT_MS),
        },
      },
    ],
  };
  const allDueIds = await withSystemContext(null, () =>
    SubscribeMessageGrant.find(dueQuery)
      .select("_id tenantId")
      .sort({ scheduledSendDate: 1, createdAt: 1 })
      .lean()
      .exec(),
  );

  // 第二步：按 tenantId 分组
  const byTenant = new Map();
  for (const item of allDueIds) {
    const key = item.tenantId ? item.tenantId.toString() : "__no_tenant__";
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key).push(item._id);
  }

  const summary = {
    total: allDueIds.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    retryQueued: 0,
  };

  // 第三步：每个租户独立发送
  for (const [tenantIdStr, ids] of byTenant) {
    const tenantId = tenantIdStr === "__no_tenant__" ? null : tenantIdStr;
    await withSystemContext(tenantId, async () => {
      const grants = await SubscribeMessageGrant.find({ _id: { $in: ids } })
        .sort({ scheduledSendDate: 1, createdAt: 1 })
        .lean()
        .exec();

      for (const grant of grants) {
        try {
          const result = await sendOneReminder(grant, { attemptType });
          if (result.status === "sent") {
            summary.sent += 1;
          } else if (result.status === "retry_queued") {
            summary.retryQueued += 1;
          } else if (result.status === "failed") {
            summary.failed += 1;
          } else {
            summary.skipped += 1;
          }
        } catch (error) {
          summary.failed += 1;
          logger.error("明日学习提醒发送失败", error, {
            userId: grant.userId,
            periodId: grant.periodId || grant.context?.periodId || null,
          });
        }
      }
    });
  }

  return summary;
}

function startStudyReminderSchedules() {
  try {
    const instanceId = process.env.NODE_APP_INSTANCE;
    if (instanceId && instanceId !== "0") {
      logger.info(
        `Skipping study reminder schedules on instance ${instanceId} (only instance 0 runs study reminders)`,
      );
      return;
    }

    cron.schedule(
      "55 5 * * *",
      async () => {
        try {
          logger.info("🔔 Next-day study reminder scheduled job triggered");
          await sendDueNextDayStudyReminders({ attemptType: "scheduled" });
        } catch (error) {
          logger.error("Scheduled next-day study reminder job failed", error);
        }
      },
      CRON_OPTIONS,
    );

    cron.schedule(
      "0 6 * * *",
      async () => {
        try {
          logger.info("🔔 Next-day study reminder retry job triggered");
          await sendDueNextDayStudyReminders({ attemptType: "retry" });
        } catch (error) {
          logger.error(
            "Scheduled next-day study reminder retry job failed",
            error,
          );
        }
      },
      CRON_OPTIONS,
    );

    logger.info("✅ Study reminder schedules started successfully", {
      nextDayReminder: "05:55 CST (北京时间)",
      nextDayReminderRetry: "06:00 CST (北京时间)",
    });
  } catch (error) {
    logger.error("Failed to start study reminder schedules", error);
  }
}

module.exports = {
  buildReminderFields,
  clearGrantSchedule,
  queueRetryForGrant,
  sendDueNextDayStudyReminders,
  sendOneReminder,
  startStudyReminderSchedules,
};
