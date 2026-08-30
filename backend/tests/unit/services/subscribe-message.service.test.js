const { expect } = require("chai");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();
const mongoose = require("mongoose");
const { setupFindChain } = require("../helpers/mock-helpers");
const {
  buildNextDayStudyReminderPlan,
} = require("../../../src/utils/study-reminder.utils");
const {
  getSubscribeSceneConfig,
} = require("../../../src/config/subscribe-message.config");
const { withSystemContext } = require("../../../src/utils/tenantContext");

describe("Subscribe Message Service", () => {
  let sandbox;
  let subscribeMessageService;
  let EnrollmentStub;
  let UserStub;
  let PeriodStub;
  let SectionStub;
  let SubscribeMessageGrantStub;
  let SubscribeMessageDeliveryStub;
  let TenantStub;
  let subscribeMessageConfig;
  let loggerStub;
  let axiosStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    UserStub = {
      findById: sandbox.stub(),
    };

    EnrollmentStub = {
      findOne: sandbox.stub(),
    };

    PeriodStub = {
      findById: sandbox.stub(),
    };

    SectionStub = {
      findOne: sandbox.stub(),
    };

    SubscribeMessageGrantStub = {
      find: sandbox.stub(),
      findOne: sandbox.stub(),
      findOneAndUpdate: sandbox.stub(),
      findByIdAndUpdate: sandbox.stub(),
    };

    SubscribeMessageDeliveryStub = {
      create: sandbox.stub().resolves({}),
    };

    TenantStub = {
      findById: sandbox.stub(),
    };

    subscribeMessageConfig = proxyquire(
      "../../../src/config/subscribe-message.config",
      {
        "../models/Tenant": TenantStub,
      },
    );

    loggerStub = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    axiosStub = {
      get: sandbox.stub(),
      post: sandbox.stub(),
    };

    subscribeMessageService = proxyquire(
      "../../../src/services/subscribe-message.service",
      {
        "../models/User": UserStub,
        "../models/Enrollment": EnrollmentStub,
        "../models/Period": PeriodStub,
        "../models/Section": SectionStub,
        "../models/SubscribeMessageGrant": SubscribeMessageGrantStub,
        "../models/SubscribeMessageDelivery": SubscribeMessageDeliveryStub,
        "../models/Tenant": TenantStub,
        "../config/subscribe-message.config": subscribeMessageConfig,
        "../utils/logger": loggerStub,
        axios: axiosStub,
      },
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  function setupTenantFindById(tenant) {
    TenantStub.findById.callsFake(() => {
      const chain = {};
      chain.select = sandbox.stub().returns(chain);
      chain.lean = sandbox.stub().resolves(tenant);
      return chain;
    });
  }

  it("should cap comment grants at target 50", async () => {
    const userId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("comment_received");

    SubscribeMessageGrantStub.findOne.resolves({ availableCount: 49 });
    SubscribeMessageGrantStub.findOneAndUpdate.resolves({ availableCount: 50 });
    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, []));

    await subscribeMessageService.recordUserGrantResults(userId, [
      {
        scene: "comment_received",
        templateId: sceneConfig.templateId,
        result: "accept",
      },
    ]);

    const update = SubscribeMessageGrantStub.findOneAndUpdate.firstCall.args[1];
    expect(update.$set.autoTopUpTarget).to.equal(50);
    expect(update.$set.availableCount).to.equal(50);
  });

  it("should accept tenant-specific template grants", async () => {
    const userId = new mongoose.Types.ObjectId();
    const tenantId = new mongoose.Types.ObjectId();
    const tenantTemplateId = "TENANT_COMMENT_TEMPLATE";

    setupTenantFindById({
      _id: tenantId,
      slug: "tenant-a",
      wxAppIds: ["wx1111111111111111"],
      wechatLogin: { appId: "wx1111111111111111" },
      subscribeTemplates: {
        comment_received: tenantTemplateId,
      },
    });
    SubscribeMessageGrantStub.findOne.resolves({ availableCount: 0 });
    SubscribeMessageGrantStub.findOneAndUpdate.resolves({ availableCount: 1 });
    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, []));

    await withSystemContext(tenantId, () =>
      subscribeMessageService.recordUserGrantResults(userId, [
        {
          scene: "comment_received",
          templateId: tenantTemplateId,
          result: "accept",
        },
      ]),
    );

    expect(SubscribeMessageGrantStub.findOneAndUpdate.calledOnce).to.be.true;
    const query = SubscribeMessageGrantStub.findOneAndUpdate.firstCall.args[0];
    const update = SubscribeMessageGrantStub.findOneAndUpdate.firstCall.args[1];
    expect(query.templateId).to.equal(tenantTemplateId);
    expect(update.$set.templateId).to.equal(tenantTemplateId);
  });

  it("should not fallback to default template when tenant config is missing", async () => {
    const userId = new mongoose.Types.ObjectId();
    const tenantId = new mongoose.Types.ObjectId();
    const defaultSceneConfig = getSubscribeSceneConfig("comment_received");

    setupTenantFindById(null);
    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, []));

    await withSystemContext(tenantId, () =>
      subscribeMessageService.recordUserGrantResults(userId, [
        {
          scene: "comment_received",
          templateId: defaultSceneConfig.templateId,
          result: "accept",
        },
      ]),
    );

    expect(SubscribeMessageGrantStub.findOneAndUpdate.called).to.be.false;

    const state = await withSystemContext(tenantId, () =>
      subscribeMessageService.getUserSubscriptionStates(userId),
    );
    const commentScene = state.scenes.find(
      (item) => item.scene === "comment_received",
    );
    expect(commentScene.templateId).to.equal("");
  });

  it("should schedule next day reminder once and keep it within period", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("next_day_study_reminder");
    const now = new Date("2026-03-29T10:00:00+08:00");
    const period = {
      _id: periodId,
      startDate: new Date("2026-03-13T00:00:00+08:00"),
      endDate: new Date("2026-04-04T00:00:00+08:00"),
    };
    const enrollment = {
      _id: new mongoose.Types.ObjectId(),
      userId,
      periodId,
    };
    const expectedPlan = buildNextDayStudyReminderPlan({
      period,
      now,
    });

    sandbox.useFakeTimers({
      now,
      toFake: ["Date"],
    });

    EnrollmentStub.findOne.returns(setupFindChain(sandbox, enrollment));
    PeriodStub.findById.returns(setupFindChain(sandbox, period));
    SectionStub.findOne.returns(
      setupFindChain(sandbox, { _id: new mongoose.Types.ObjectId() }),
    );
    SubscribeMessageGrantStub.findOne.resolves({ availableCount: 0 });
    SubscribeMessageGrantStub.findOneAndUpdate.resolves({ availableCount: 1 });

    await subscribeMessageService.recordUserGrantResults(userId, [
      {
        scene: "next_day_study_reminder",
        templateId: sceneConfig.templateId,
        result: "accept",
        context: {
          periodId: periodId.toString(),
          sourceAction: "course_detail_click",
        },
      },
    ]);

    const update = SubscribeMessageGrantStub.findOneAndUpdate.firstCall.args[1];
    expect(update.$set.autoTopUpTarget).to.equal(1);
    expect(update.$set.availableCount).to.equal(1);
    expect(update.$set.periodId).to.equal(periodId.toString());
    expect(update.$set.sourceAction).to.equal("course_detail_click");
    expect(update.$set.scheduledSendDateKey).to.equal(expectedPlan.sendDateKey);
    expect(update.$set.scheduledSendDate).to.be.instanceOf(Date);
  });

  it("should not overwrite existing next day reminder when out of period range", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("next_day_study_reminder");
    const existingGrant = {
      availableCount: 1,
      scheduledSendDate: new Date("2026-03-30T05:55:00+08:00"),
      scheduledSendDateKey: "2026-03-30",
      periodId: periodId.toString(),
    };
    const period = {
      _id: periodId,
      startDate: new Date("2026-03-13T00:00:00+08:00"),
      endDate: new Date("2026-03-29T00:00:00+08:00"),
    };

    EnrollmentStub.findOne.returns(
      setupFindChain(sandbox, {
        _id: new mongoose.Types.ObjectId(),
        userId,
        periodId,
      }),
    );
    PeriodStub.findById.returns(setupFindChain(sandbox, period));
    SubscribeMessageGrantStub.findOne.resolves(existingGrant);
    SubscribeMessageGrantStub.findOneAndUpdate.resolves(existingGrant);

    await subscribeMessageService.recordUserGrantResults(userId, [
      {
        scene: "next_day_study_reminder",
        templateId: sceneConfig.templateId,
        result: "accept",
        context: {
          periodId: periodId.toString(),
          sourceAction: "course_detail_click",
        },
      },
    ]);

    const update = SubscribeMessageGrantStub.findOneAndUpdate.firstCall.args[1];
    expect(update.$set.availableCount).to.be.undefined;
    expect(update.$set.scheduledSendDate).to.be.undefined;
    expect(update.$set.scheduledSendDateKey).to.be.undefined;
  });

  it("should queue tomorrow without overwriting an earlier scheduled reminder", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("next_day_study_reminder");
    const now = new Date("2026-03-29T10:00:00+08:00");
    const period = {
      _id: periodId,
      startDate: new Date("2026-03-13T00:00:00+08:00"),
      endDate: new Date("2026-04-04T00:00:00+08:00"),
    };
    const existingGrant = {
      availableCount: 1,
      periodId: periodId.toString(),
      context: { periodId: periodId.toString(), sourceAction: "first_click" },
      scheduledSendDate: new Date("2026-03-29T05:55:00+08:00"),
      scheduledSendDateKey: "2026-03-29",
    };

    sandbox.useFakeTimers({ now, toFake: ["Date"] });
    EnrollmentStub.findOne.returns(
      setupFindChain(sandbox, { _id: new mongoose.Types.ObjectId(), periodId }),
    );
    PeriodStub.findById.returns(setupFindChain(sandbox, period));
    SectionStub.findOne.returns(
      setupFindChain(sandbox, { _id: new mongoose.Types.ObjectId() }),
    );
    SubscribeMessageGrantStub.findOne.resolves(existingGrant);
    SubscribeMessageGrantStub.findOneAndUpdate.resolves(existingGrant);

    await subscribeMessageService.recordUserGrantResults(userId, [
      {
        scene: "next_day_study_reminder",
        templateId: sceneConfig.templateId,
        result: "accept",
        context: {
          periodId: periodId.toString(),
          sourceAction: "second_click",
        },
      },
    ]);

    const update = SubscribeMessageGrantStub.findOneAndUpdate.firstCall.args[1];
    expect(update.$set.scheduledSendDateKey).to.be.undefined;
    expect(update.$set.queuedSendDateKey).to.equal("2026-03-30");
    expect(update.$set.queuedPeriodId).to.equal(periodId.toString());
  });

  it("should preserve current and queued reminder slots when a new prompt is rejected", async () => {
    const userId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("next_day_study_reminder");
    const existingGrant = {
      availableCount: 1,
      periodId: "period_today",
      scheduledSendDate: new Date("2026-03-30T05:55:00+08:00"),
      scheduledSendDateKey: "2026-03-30",
      queuedPeriodId: "period_tomorrow",
      queuedSendDate: new Date("2026-03-31T05:55:00+08:00"),
      queuedSendDateKey: "2026-03-31",
    };
    SubscribeMessageGrantStub.findOne.resolves(existingGrant);
    SubscribeMessageGrantStub.findOneAndUpdate.resolves(existingGrant);

    await subscribeMessageService.recordUserGrantResults(userId, [
      {
        scene: "next_day_study_reminder",
        templateId: sceneConfig.templateId,
        result: "reject",
        context: { periodId: "period_new" },
      },
    ]);

    const update = SubscribeMessageGrantStub.findOneAndUpdate.firstCall.args[1];
    expect(update.$set.availableCount).to.be.undefined;
    expect(update.$set.scheduledSendDate).to.be.undefined;
    expect(update.$set.queuedSendDate).to.be.undefined;
  });

  it("should expose auto top up target and scheduled send date in states", async () => {
    const userId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("next_day_study_reminder");
    const grant = {
      scene: "next_day_study_reminder",
      templateId: sceneConfig.templateId,
      availableCount: 1,
      scheduledSendDate: new Date("2026-03-30T05:55:00+08:00"),
      scheduledSendDateKey: "2026-03-30",
      retryAt: null,
      retryCount: 0,
      context: {
        periodId: "period_1",
        sourceAction: "course_detail_click",
      },
      lastResult: "accept",
    };

    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, [grant]));

    const result =
      await subscribeMessageService.getUserSubscriptionStates(userId);

    const nextDayScene = result.scenes.find(
      (item) => item.scene === "next_day_study_reminder",
    );
    expect(nextDayScene.autoTopUpTarget).to.equal(1);
    expect(nextDayScene.scheduledSendDate).to.deep.equal(
      grant.scheduledSendDate,
    );
    expect(nextDayScene.periodId).to.equal("period_1");
    expect(nextDayScene.sourceAction).to.equal("course_detail_click");
  });

  it("should expose whether the target period tomorrow needs a reminder grant", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("next_day_study_reminder");
    const now = new Date("2026-03-29T10:00:00+08:00");
    const grant = {
      scene: "next_day_study_reminder",
      templateId: sceneConfig.templateId,
      availableCount: 1,
      scheduledSendDate: new Date("2026-03-30T05:55:00+08:00"),
      scheduledSendDateKey: "2026-03-30",
      periodId: periodId.toString(),
    };

    sandbox.useFakeTimers({ now, toFake: ["Date"] });
    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, [grant]));
    PeriodStub.findById.returns(
      setupFindChain(sandbox, {
        _id: periodId,
        startDate: new Date("2026-03-13T00:00:00+08:00"),
        endDate: new Date("2026-04-04T00:00:00+08:00"),
      }),
    );
    EnrollmentStub.findOne.returns(
      setupFindChain(sandbox, { _id: new mongoose.Types.ObjectId() }),
    );
    SectionStub.findOne.returns(
      setupFindChain(sandbox, { _id: new mongoose.Types.ObjectId() }),
    );

    const result = await subscribeMessageService.getUserSubscriptionStates(
      userId,
      {
        periodId: periodId.toString(),
        now,
      },
    );
    const nextDayScene = result.scenes.find(
      (item) => item.scene === "next_day_study_reminder",
    );

    expect(nextDayScene.nextDay).to.include({
      periodId: periodId.toString(),
      sendDateKey: "2026-03-30",
      alreadyQueued: true,
      canRequest: false,
    });
  });

  it("should ignore grants from a different template when building states", async () => {
    const userId = new mongoose.Types.ObjectId();
    const tenantId = new mongoose.Types.ObjectId();
    const tenantTemplateId = "TENANT_COMMENT_TEMPLATE";

    setupTenantFindById({
      _id: tenantId,
      slug: "tenant-state",
      wxAppIds: ["wx4444444444444444"],
      wechatLogin: { appId: "wx4444444444444444" },
      subscribeTemplates: {
        comment_received: tenantTemplateId,
      },
    });
    SubscribeMessageGrantStub.find.returns(
      setupFindChain(sandbox, [
        {
          scene: "comment_received",
          templateId: getSubscribeSceneConfig("comment_received").templateId,
          availableCount: 9,
          lastResult: "accept",
        },
      ]),
    );

    const result = await withSystemContext(tenantId, () =>
      subscribeMessageService.getUserSubscriptionStates(userId),
    );

    const commentScene = result.scenes.find(
      (item) => item.scene === "comment_received",
    );
    expect(commentScene.templateId).to.equal(tenantTemplateId);
    expect(commentScene.availableCount).to.equal(0);
  });

  it("should expose insight request approved scene in subscription states", async () => {
    const userId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("insight_request_approved");

    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, []));

    const result =
      await subscribeMessageService.getUserSubscriptionStates(userId);
    const approvedScene = result.scenes.find(
      (item) => item.scene === "insight_request_approved",
    );

    expect(sceneConfig).to.exist;
    expect(approvedScene).to.include({
      scene: "insight_request_approved",
      title: "小凡看见申请通过",
      templateId: sceneConfig.templateId,
      availableCount: 0,
      autoTopUpTarget: 1,
    });
  });

  it("should expose insight interaction scenes in subscription states", async () => {
    const userId = new mongoose.Types.ObjectId();

    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, []));

    const result =
      await subscribeMessageService.getUserSubscriptionStates(userId);
    const likedScene = result.scenes.find(
      (item) => item.scene === "insight_liked",
    );
    const danmakuScene = result.scenes.find(
      (item) => item.scene === "danmaku_received",
    );

    expect(likedScene).to.include({
      scene: "insight_liked",
      title: "小凡看见点赞",
      templateId: getSubscribeSceneConfig("like_received").templateId,
      availableCount: 0,
      autoTopUpTarget: 50,
    });
    expect(danmakuScene).to.include({
      scene: "danmaku_received",
      title: "小凡看见弹幕",
      templateId: getSubscribeSceneConfig("comment_received").templateId,
      availableCount: 0,
      autoTopUpTarget: 50,
    });
  });

  it("should reuse available grant from the same template when scene-specific grant is missing", async () => {
    const recipientUserId = new mongoose.Types.ObjectId();
    const grantId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("insight_request_approved");
    const originalNodeEnv = process.env.NODE_ENV;

    UserStub.findById.returns(
      setupFindChain(sandbox, {
        _id: recipientUserId,
        openid: "openid-123",
        nickname: "林泰君",
      }),
    );
    SubscribeMessageGrantStub.findOne.resolves(null);
    SubscribeMessageGrantStub.findOneAndUpdate
      .onFirstCall()
      .resolves(null)
      .onSecondCall()
      .resolves({
        _id: grantId,
        scene: "insight_request_created",
        templateId: sceneConfig.templateId,
        availableCount: 0,
      });

    process.env.NODE_ENV = "test";
    try {
      await subscribeMessageService.sendSceneMessage({
        scene: "insight_request_approved",
        recipientUserId,
        fields: {
          approverName: "狮子",
          remark: "秩序之锚 · 第五天",
          approvedTime: "2026-05-16 07:30",
        },
        sourceType: "insight_request",
        sourceId: "request-1",
      });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    expect(SubscribeMessageGrantStub.findOneAndUpdate.calledTwice).to.be.true;
    const fallbackQuery =
      SubscribeMessageGrantStub.findOneAndUpdate.secondCall.args[0];
    expect(fallbackQuery).to.include({
      userId: recipientUserId,
      templateId: sceneConfig.templateId,
    });
    expect(fallbackQuery.scene).to.be.undefined;
    expect(SubscribeMessageDeliveryStub.create.calledOnce).to.be.true;
    expect(SubscribeMessageDeliveryStub.create.firstCall.args[0]).to.include({
      scene: "insight_request_approved",
      status: "mocked",
    });
  });

  it("should send with tenant-specific template and credential", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const recipientUserId = new mongoose.Types.ObjectId();
    const grantId = new mongoose.Types.ObjectId();
    const tenantTemplateId = "TENANT_LIKE_TEMPLATE";
    const originalNodeEnv = process.env.NODE_ENV;

    setupTenantFindById({
      _id: tenantId,
      slug: "tenant-like",
      wxAppIds: ["wx2222222222222222"],
      wechatLogin: {
        appId: "wx2222222222222222",
        appSecret: "tenant-secret",
      },
      subscribeTemplates: {
        like_received: tenantTemplateId,
      },
    });
    UserStub.findById.returns(
      setupFindChain(sandbox, {
        _id: recipientUserId,
        openid: "openid-tenant",
        nickname: "租户用户",
      }),
    );
    SubscribeMessageGrantStub.findOneAndUpdate.resolves({
      _id: grantId,
      availableCount: 1,
    });
    axiosStub.get.resolves({
      data: {
        access_token: "tenant-access-token",
        expires_in: 7200,
      },
    });
    axiosStub.post.resolves({
      data: {
        errcode: 0,
        errmsg: "ok",
      },
    });

    process.env.NODE_ENV = "production";
    try {
      await withSystemContext(tenantId, () =>
        subscribeMessageService.sendSceneMessage({
          scene: "like_received",
          recipientUserId,
          fields: {
            likeUser: "点赞人",
            likeTime: "2026-03-31 07:00",
          },
          sourceType: "checkin_like",
          sourceId: "checkin-tenant",
        }),
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    expect(axiosStub.get.calledOnce).to.be.true;
    expect(axiosStub.get.firstCall.args[1].params).to.include({
      appid: "wx2222222222222222",
      secret: "tenant-secret",
    });
    expect(axiosStub.post.calledOnce).to.be.true;
    expect(axiosStub.post.firstCall.args[1].template_id).to.equal(
      tenantTemplateId,
    );
    expect(SubscribeMessageDeliveryStub.create.firstCall.args[0]).to.include({
      templateId: tenantTemplateId,
      status: "sent",
    });
  });

  it("should not fallback to default secret for another tenant appId", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const originalWechatAppId = process.env.WECHAT_APPID;
    const originalWechatSecret = process.env.WECHAT_SECRET;

    setupTenantFindById({
      _id: tenantId,
      slug: "tenant-missing-secret",
      wxAppIds: ["wx3333333333333333"],
      wechatLogin: {
        appId: "wx3333333333333333",
      },
      subscribeTemplates: {},
    });

    process.env.WECHAT_APPID = "wx2b9a3c1d5e4195f8";
    process.env.WECHAT_SECRET = "default-secret";
    try {
      await withSystemContext(tenantId, async () => {
        try {
          await subscribeMessageService.getAccessToken();
          throw new Error("expected getAccessToken to fail");
        } catch (error) {
          expect(error.message).to.equal("租户未配置微信 access_token 凭证");
        }
      });
    } finally {
      if (originalWechatAppId === undefined) {
        delete process.env.WECHAT_APPID;
      } else {
        process.env.WECHAT_APPID = originalWechatAppId;
      }
      if (originalWechatSecret === undefined) {
        delete process.env.WECHAT_SECRET;
      } else {
        process.env.WECHAT_SECRET = originalWechatSecret;
      }
    }

    expect(axiosStub.get.called).to.be.false;
  });

  it("should restore inventory when WeChat returns 43101 for non-consuming scenes", async () => {
    const recipientUserId = new mongoose.Types.ObjectId();
    const grantId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("like_received");
    const originalNodeEnv = process.env.NODE_ENV;

    UserStub.findById.returns(
      setupFindChain(sandbox, {
        _id: recipientUserId,
        openid: "openid-123",
        nickname: "测试用户",
      }),
    );
    SubscribeMessageGrantStub.findOneAndUpdate.resolves({
      _id: grantId,
      availableCount: 4,
    });
    SubscribeMessageGrantStub.findByIdAndUpdate.resolves({});
    axiosStub.get.resolves({
      data: {
        access_token: "access-token",
        expires_in: 7200,
      },
    });
    axiosStub.post.resolves({
      data: {
        errcode: 43101,
        errmsg: "user refuse to accept the msg",
      },
    });

    process.env.NODE_ENV = "production";
    try {
      await subscribeMessageService.sendSceneMessage({
        scene: "like_received",
        recipientUserId,
        fields: {
          likeUser: "点赞人",
          likeTime: "2026-03-31 07:00",
        },
        sourceType: "checkin_like",
        sourceId: "checkin-1",
      });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    expect(SubscribeMessageGrantStub.findOneAndUpdate.calledOnce).to.be.true;
    expect(SubscribeMessageGrantStub.findByIdAndUpdate.calledTwice).to.be.true;
    expect(
      SubscribeMessageGrantStub.findByIdAndUpdate.firstCall.args[0],
    ).to.equal(grantId);
    expect(
      SubscribeMessageGrantStub.findByIdAndUpdate.firstCall.args[1],
    ).to.deep.equal({
      $inc: { availableCount: 1 },
    });
    expect(
      SubscribeMessageGrantStub.findByIdAndUpdate.secondCall.args[0],
    ).to.equal(grantId);
    expect(
      SubscribeMessageGrantStub.findByIdAndUpdate.secondCall.args[1].$set
        .deliveryBlocked,
    ).to.equal(true);
    expect(
      SubscribeMessageGrantStub.findByIdAndUpdate.secondCall.args[1].$set
        .deliveryBlockedReason,
    ).to.equal("wechat_delivery_refused");
    expect(
      SubscribeMessageGrantStub.findByIdAndUpdate.secondCall.args[1].$set
        .lastWechatErrorCode,
    ).to.equal(43101);
    expect(SubscribeMessageDeliveryStub.create.calledOnce).to.be.true;
    expect(SubscribeMessageDeliveryStub.create.firstCall.args[0]).to.include({
      scene: sceneConfig.scene,
      status: "failed",
      errorCode: 43101,
    });
  });

  it("should skip sending when grant is blocked pending reauthorization", async () => {
    const recipientUserId = new mongoose.Types.ObjectId();
    const sceneConfig = getSubscribeSceneConfig("comment_received");

    UserStub.findById.returns(
      setupFindChain(sandbox, {
        _id: recipientUserId,
        openid: "openid-123",
        nickname: "测试用户",
      }),
    );
    SubscribeMessageGrantStub.findOne.onFirstCall().resolves({
      _id: new mongoose.Types.ObjectId(),
      availableCount: 3,
      deliveryBlocked: true,
      lastWechatErrorCode: 43101,
    });

    await subscribeMessageService.sendSceneMessage({
      scene: "comment_received",
      recipientUserId,
      fields: {
        replyUser: "回复者",
        replyTopic: "主题",
        replyContent: "内容",
        replyTime: "2026-03-31 08:00",
      },
      sourceType: "comment_reply",
      sourceId: "comment-1",
    });

    expect(SubscribeMessageGrantStub.findOneAndUpdate.called).to.be.false;
    expect(SubscribeMessageDeliveryStub.create.calledOnce).to.be.true;
    expect(SubscribeMessageDeliveryStub.create.firstCall.args[0]).to.include({
      scene: sceneConfig.scene,
      status: "skipped_reauthorization_required",
      errorCode: 43101,
    });
  });

  it("should constrain template values to WeChat field limits before sending", () => {
    const sceneConfig = getSubscribeSceneConfig("comment_received");

    const templateData = subscribeMessageService.buildTemplateData(
      sceneConfig,
      {
        replyUser: "王可心很长很长的名字",
        replyTopic: "感觉可心的管理能力也在蹭蹭上涨了，对同事更加关心",
        replyContent:
          "哈哈哈 谢谢！以前觉得公司的成绩重要，现在觉得让他们几个幸福更重要",
        replyTime: "2026-05-11 21:23",
      },
    );

    expect(templateData.thing1.value).to.have.lengthOf.at.most(20);
    expect(templateData.thing5.value).to.have.lengthOf.at.most(20);
    expect(templateData.thing2.value).to.have.lengthOf.at.most(20);
    expect(templateData.thing5.value).to.equal(
      "感觉可心的管理能力也在蹭蹭上涨了，...",
    );
    expect(templateData.time3.value).to.equal("2026-05-11 21:23");
  });

  it("should refresh access token and retry once when WeChat returns 40001", async () => {
    const recipientUserId = new mongoose.Types.ObjectId();
    const grantId = new mongoose.Types.ObjectId();
    const originalNodeEnv = process.env.NODE_ENV;

    UserStub.findById.returns(
      setupFindChain(sandbox, {
        _id: recipientUserId,
        openid: "openid-123",
        nickname: "测试用户",
      }),
    );
    SubscribeMessageGrantStub.findOneAndUpdate.resolves({
      _id: grantId,
      availableCount: 4,
    });
    axiosStub.get
      .onFirstCall()
      .resolves({
        data: {
          access_token: "stale-access-token",
          expires_in: 7200,
        },
      })
      .onSecondCall()
      .resolves({
        data: {
          access_token: "fresh-access-token",
          expires_in: 7200,
        },
      });
    axiosStub.post
      .onFirstCall()
      .resolves({
        data: {
          errcode: 40001,
          errmsg: "invalid credential",
        },
      })
      .onSecondCall()
      .resolves({
        data: {
          errcode: 0,
          errmsg: "ok",
        },
      });

    process.env.NODE_ENV = "production";
    try {
      await subscribeMessageService.sendSceneMessage({
        scene: "like_received",
        recipientUserId,
        fields: {
          likeUser: "点赞人",
          likeTime: "2026-03-31 07:00",
        },
        sourceType: "checkin_like",
        sourceId: "checkin-1",
      });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    expect(axiosStub.get.calledTwice).to.be.true;
    expect(axiosStub.post.calledTwice).to.be.true;
    expect(axiosStub.post.firstCall.args[0]).to.include("stale-access-token");
    expect(axiosStub.post.secondCall.args[0]).to.include("fresh-access-token");
    expect(SubscribeMessageDeliveryStub.create.calledOnce).to.be.true;
    expect(SubscribeMessageDeliveryStub.create.firstCall.args[0]).to.include({
      status: "sent",
      errorCode: null,
    });
  });
});
