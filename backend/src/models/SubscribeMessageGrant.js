const mongoose = require("mongoose");

const subscribeMessageGrantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    scene: {
      type: String,
      required: true,
      index: true,
    },
    templateId: {
      type: String,
      required: true,
    },
    periodId: {
      type: String,
      default: null,
      index: true,
    },
    sourceAction: {
      type: String,
      default: null,
    },
    context: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    availableCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    autoTopUpTarget: {
      type: Number,
      default: 1,
      min: 1,
    },
    scheduledSendDate: {
      type: Date,
      default: null,
    },
    scheduledSendDateKey: {
      type: String,
      default: null,
      index: true,
    },
    // 明日授权在今日通知尚未消耗时暂存于排队槽，最多保留一个排队日期。
    queuedSendDate: {
      type: Date,
      default: null,
    },
    queuedSendDateKey: {
      type: String,
      default: null,
      index: true,
    },
    queuedPeriodId: {
      type: String,
      default: null,
    },
    queuedContext: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    retryAt: {
      type: Date,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastResult: {
      type: String,
      enum: ["accept", "reject", "ban", "error", null],
      default: null,
    },
    lastAcceptedAt: {
      type: Date,
      default: null,
    },
    lastRejectedAt: {
      type: Date,
      default: null,
    },
    lastRequestedAt: {
      type: Date,
      default: null,
    },
    deliveryBlocked: {
      type: Boolean,
      default: false,
    },
    deliveryBlockedReason: {
      type: String,
      default: null,
    },
    lastWechatErrorCode: {
      type: Number,
      default: null,
    },
    lastWechatRefusedAt: {
      type: Date,
      default: null,
    },
    // 发送前短暂领取锁，避免 05:55 主任务和 06:00 重试并发投递同一条通知。
    deliveryClaimedAt: {
      type: Date,
      default: null,
    },
    deliveryClaimToken: {
      type: String,
      default: null,
    },
    deliveryClaimDateKey: {
      type: String,
      default: null,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "subscribe_message_grants",
  },
);

subscribeMessageGrantSchema.index(
  { tenantId: 1, userId: 1, scene: 1, templateId: 1 },
  { unique: true },
);
subscribeMessageGrantSchema.index({
  scene: 1,
  scheduledSendDate: 1,
  retryAt: 1,
  availableCount: 1,
});
subscribeMessageGrantSchema.index({ tenantId: 1, createdAt: -1 });

const tenantPlugin = require("./plugins/tenantPlugin");
subscribeMessageGrantSchema.plugin(tenantPlugin);

module.exports = mongoose.model(
  "SubscribeMessageGrant",
  subscribeMessageGrantSchema,
);
