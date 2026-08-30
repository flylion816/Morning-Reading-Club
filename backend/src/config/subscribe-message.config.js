const {
  getCurrentTenantId,
  withSystemContext,
} = require("../utils/tenantContext");
const {
  FANREN_SUBSCRIBE_TEMPLATES,
  getConfiguredSubscribeTemplates,
} = require("./subscribe-templates.config");

const sceneConfigs = {
  enrollment_result: {
    scene: "enrollment_result",
    title: "报名结果",
    description: "报名成功后提醒用户进入晨读营",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.enrollment_result,
    page: "pages/periods/periods",
    autoTopUpTarget: 1,
    fieldDefinitions: [
      { name: "result", label: "报名结果" },
      { name: "name", label: "姓名" },
      { name: "content", label: "报名内容" },
    ],
    defaultFieldKeyMap: {
      result: "phrase1",
      name: "name6",
      content: "thing7",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_ENROLLMENT_RESULT",
  },
  payment_result: {
    scene: "payment_result",
    title: "付款结果",
    description: "支付完成后提醒用户进入晨读营",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.payment_result,
    page: "pages/periods/periods",
    autoTopUpTarget: 1,
    fieldDefinitions: [
      { name: "orderContent", label: "订单内容" },
      { name: "orderTime", label: "下单时间" },
    ],
    defaultFieldKeyMap: {
      orderContent: "thing1",
      orderTime: "date3",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_PAYMENT_RESULT",
  },
  comment_received: {
    scene: "comment_received",
    title: "收到评论",
    description: "有人评论或回复时提醒查看",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.comment_received,
    page: "pages/course-detail/course-detail",
    autoTopUpTarget: 50,
    fieldDefinitions: [
      { name: "replyUser", label: "回复人" },
      { name: "replyTopic", label: "回复主题" },
      { name: "replyContent", label: "回复内容" },
      { name: "replyTime", label: "回复时间" },
    ],
    defaultFieldKeyMap: {
      replyUser: "thing1",
      replyTopic: "thing5",
      replyContent: "thing2",
      replyTime: "time3",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_COMMENT_RECEIVED",
  },
  like_received: {
    scene: "like_received",
    title: "收到点赞",
    description: "有人点赞打卡或评论时提醒查看",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.like_received,
    page: "pages/course-detail/course-detail",
    autoTopUpTarget: 50,
    fieldDefinitions: [
      { name: "likeUser", label: "点赞用户" },
      { name: "likeTime", label: "点赞时间" },
    ],
    defaultFieldKeyMap: {
      likeUser: "thing1",
      likeTime: "time2",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_LIKE_RECEIVED",
  },
  danmaku_received: {
    scene: "danmaku_received",
    title: "小凡看见弹幕",
    description: "有人在你的小凡看见发表弹幕时提醒查看",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.danmaku_received,
    page: "pages/insight-detail/insight-detail",
    autoTopUpTarget: 50,
    fieldDefinitions: [
      { name: "replyUser", label: "回复人" },
      { name: "replyTopic", label: "回复主题" },
      { name: "replyContent", label: "回复内容" },
      { name: "replyTime", label: "回复时间" },
    ],
    defaultFieldKeyMap: {
      replyUser: "thing1",
      replyTopic: "thing5",
      replyContent: "thing2",
      replyTime: "time3",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_DANMAKU_RECEIVED",
  },
  insight_liked: {
    scene: "insight_liked",
    title: "小凡看见点赞",
    description: "有人给你的小凡看见点赞时提醒查看",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.insight_liked,
    page: "pages/insight-detail/insight-detail",
    autoTopUpTarget: 50,
    fieldDefinitions: [
      { name: "likeUser", label: "点赞用户" },
      { name: "likeTime", label: "点赞时间" },
    ],
    defaultFieldKeyMap: {
      likeUser: "thing1",
      likeTime: "time2",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_INSIGHT_LIKED",
  },
  insight_request_created: {
    scene: "insight_request_created",
    title: "申请小凡看见",
    description: "有人请求查看你的小凡看见时提醒处理",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.insight_request_created,
    page: "pages/index/index",
    autoTopUpTarget: 1,
    fieldDefinitions: [
      { name: "requestUser", label: "申请人" },
      { name: "remark", label: "备注" },
      { name: "requestTime", label: "申请时间" },
    ],
    defaultFieldKeyMap: {
      requestUser: "name2",
      remark: "thing3",
      requestTime: "date1",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_INSIGHT_REQUEST_CREATED",
  },
  insight_request_approved: {
    scene: "insight_request_approved",
    title: "小凡看见申请通过",
    description: "你发起的小凡看见查看申请被同意时提醒查看",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.insight_request_approved,
    page: "pages/insight-detail/insight-detail",
    autoTopUpTarget: 1,
    fieldDefinitions: [
      { name: "approverName", label: "同意人" },
      { name: "remark", label: "备注" },
      { name: "approvedTime", label: "同意时间" },
    ],
    defaultFieldKeyMap: {
      approverName: "name2",
      remark: "thing3",
      approvedTime: "date1",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_INSIGHT_REQUEST_APPROVED",
  },
  insight_created: {
    scene: "insight_created",
    title: "小凡看见通知",
    description: "外部系统创建小凡看见时通知被看见的用户",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.insight_created,
    page: "pages/insight-detail/insight-detail",
    autoTopUpTarget: 50,
    fieldDefinitions: [
      { name: "replyUser", label: "作者" },
      { name: "replyTopic", label: "项目名称" },
      { name: "replyContent", label: "发布标题" },
      { name: "replyTime", label: "发布时间" },
    ],
    defaultFieldKeyMap: {
      replyUser: "thing6",
      replyTopic: "thing14",
      replyContent: "thing12",
      replyTime: "time8",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_INSIGHT_CREATED",
  },
  next_day_study_reminder: {
    scene: "next_day_study_reminder",
    title: "明日开课通知",
    description: "次日 05:55 发送晨读营开课通知",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.next_day_study_reminder,
    page: "pages/periods/periods",
    autoTopUpTarget: 1,
    fieldDefinitions: [
      { name: "activityName", label: "活动名称" },
      { name: "activityContent", label: "活动内容" },
      { name: "startTime", label: "开始时间" },
      { name: "joinMethod", label: "参与方式" },
    ],
    defaultFieldKeyMap: {
      activityName: "thing4",
      activityContent: "thing2",
      joinMethod: "thing12",
      startTime: "date3",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_NEXT_DAY_STUDY_REMINDER",
  },
  podcast_published: {
    scene: "podcast_published",
    title: "凡人播客上新",
    description: "当天课程的凡人播客上传后通知报名用户收听",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.podcast_published,
    page: "pages/course-detail/course-detail",
    autoTopUpTarget: 50,
    fieldDefinitions: [
      { name: "replyUser", label: "作者" },
      { name: "replyTopic", label: "课程信息" },
      { name: "replyContent", label: "播客标题" },
      { name: "replyTime", label: "发布时间" },
    ],
    defaultFieldKeyMap: {
      replyUser: "thing6",
      replyTopic: "thing14",
      replyContent: "thing12",
      replyTime: "time8",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_PODCAST_PUBLISHED",
  },
  activity_reminder: {
    scene: "activity_reminder",
    title: "活动开始通知",
    description: "活动开始前10分钟提醒已报名用户",
    templateId: FANREN_SUBSCRIBE_TEMPLATES.activity_reminder,
    page: "pages/community-activity-detail/community-activity-detail",
    autoTopUpTarget: 1,
    fieldDefinitions: [
      { name: "activityName", label: "活动名称" },
      { name: "activityContent", label: "活动内容" },
      { name: "startTime", label: "开始时间" },
      { name: "joinMethod", label: "参与方式" },
    ],
    defaultFieldKeyMap: {
      activityName: "thing4",
      activityContent: "thing2",
      startTime: "date3",
      joinMethod: "thing12",
    },
    fieldKeyMapEnv: "WECHAT_SUBSCRIBE_FIELD_KEYS_ACTIVITY_REMINDER",
  },
};

function getSubscribeSceneConfig(scene) {
  return sceneConfigs[scene] || null;
}

function getSubscribeSceneList() {
  return Object.values(sceneConfigs);
}

function cloneSceneConfig(sceneConfig, templateId) {
  if (!sceneConfig) {
    return null;
  }

  return {
    ...sceneConfig,
    fieldDefinitions: sceneConfig.fieldDefinitions.map((field) => ({
      ...field,
    })),
    defaultFieldKeyMap: { ...sceneConfig.defaultFieldKeyMap },
    templateId: templateId || "",
  };
}

async function getTenantSubscribeTemplates(tenantId = getCurrentTenantId()) {
  if (!tenantId) {
    return getConfiguredSubscribeTemplates();
  }

  const Tenant = require("../models/Tenant");
  const tenant = await withSystemContext(null, () =>
    Tenant.findById(tenantId)
      .select("slug wxAppIds wechatLogin.appId subscribeTemplates")
      .lean(),
  );

  if (!tenant) {
    return {};
  }

  return {
    ...getConfiguredSubscribeTemplates(tenant),
    ...(tenant?.subscribeTemplates || {}),
  };
}

async function resolveSubscribeSceneConfig(
  scene,
  tenantId = getCurrentTenantId(),
) {
  const sceneConfig = getSubscribeSceneConfig(scene);
  if (!sceneConfig) {
    return null;
  }

  const templates = await getTenantSubscribeTemplates(tenantId);
  return cloneSceneConfig(sceneConfig, templates[sceneConfig.scene]);
}

async function resolveSubscribeSceneList(tenantId = getCurrentTenantId()) {
  const templates = await getTenantSubscribeTemplates(tenantId);
  return getSubscribeSceneList().map((sceneConfig) =>
    cloneSceneConfig(sceneConfig, templates[sceneConfig.scene]),
  );
}

function normalizeMiniProgramPage(page = "") {
  return String(page || "").replace(/^\/+/, "");
}

module.exports = {
  SUBSCRIBE_MESSAGE_SCENES: sceneConfigs,
  getSubscribeSceneConfig,
  getSubscribeSceneList,
  getTenantSubscribeTemplates,
  resolveSubscribeSceneConfig,
  resolveSubscribeSceneList,
  normalizeMiniProgramPage,
};
