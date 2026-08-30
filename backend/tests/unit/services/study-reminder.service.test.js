const { expect } = require("chai");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();
const mongoose = require("mongoose");
const { setupFindChain } = require("../helpers/mock-helpers");
const {
  buildNextDayStudyReminderPlan,
  buildScheduledStudyReminderPlan,
  getShanghaiDateKey,
} = require("../../../src/utils/study-reminder.utils");

describe("Study Reminder Service", () => {
  let sandbox;
  let studyReminderService;
  let EnrollmentStub;
  let PeriodStub;
  let SectionStub;
  let SubscribeMessageGrantStub;
  let SubscribeMessageDeliveryStub;
  let TenantStub;
  let subscribeMessageServiceStub;
  let loggerStub;
  let scheduleStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

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
      findOneAndUpdate: sandbox.stub(),
      findByIdAndUpdate: sandbox.stub().resolves({}),
    };

    SubscribeMessageDeliveryStub = {
      findOne: sandbox.stub().returns(setupFindChain(sandbox, null)),
    };

    TenantStub = {
      findById: sandbox.stub(),
    };

    subscribeMessageServiceStub = {
      sendSceneMessage: sandbox.stub(),
    };

    loggerStub = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
    scheduleStub = sandbox.stub();

    studyReminderService = proxyquire(
      "../../../src/services/study-reminder.service",
      {
        "../models/Enrollment": EnrollmentStub,
        "../models/Period": PeriodStub,
        "../models/Section": SectionStub,
        "../models/SubscribeMessageGrant": SubscribeMessageGrantStub,
        "../models/SubscribeMessageDelivery": SubscribeMessageDeliveryStub,
        "../models/Tenant": TenantStub,
        "./subscribe-message.service": subscribeMessageServiceStub,
        "../utils/logger": loggerStub,
        "node-cron": {
          schedule: scheduleStub,
        },
        "../config/subscribe-message.config": {
          resolveSubscribeSceneConfig: sandbox.stub().resolves({
            scene: "next_day_study_reminder",
            templateId: "TPL_NEXT_DAY",
            page: "pages/periods/periods",
          }),
        },
      },
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should calculate next day reminder within period and block after last day", () => {
    const period = {
      startDate: new Date("2026-03-13T00:00:00+08:00"),
      endDate: new Date("2026-04-04T00:00:00+08:00"),
    };

    const inRange = buildNextDayStudyReminderPlan({
      period,
      now: new Date("2026-03-29T10:00:00+08:00"),
    });
    const outOfRange = buildNextDayStudyReminderPlan({
      period,
      now: new Date("2026-04-04T10:00:00+08:00"),
    });

    expect(inRange.status).to.equal("ok");
    expect(inRange.sendDateKey).to.equal("2026-03-30");
    expect(outOfRange.status).to.equal("out_of_range");
  });

  it("should build scheduled send plan based on actual send date", () => {
    const period = {
      startDate: new Date("2026-03-13T00:00:00+08:00"),
      endDate: new Date("2026-04-04T00:00:00+08:00"),
    };
    const sendDate = new Date("2026-03-30T05:55:00+08:00");

    const plan = buildScheduledStudyReminderPlan({ period, sendDate });

    expect(plan.status).to.equal("ok");
    expect(plan.sendDateKey).to.equal(getShanghaiDateKey(sendDate));
    expect(plan.dayIndex).to.equal(17);
  });

  it("should send reminder and clear grant after success", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const sendDate = new Date("2026-03-30T05:55:00+08:00");
    const scheduledPlan = buildScheduledStudyReminderPlan({
      period: {
        startDate: new Date("2026-03-13T00:00:00+08:00"),
        endDate: new Date("2026-04-04T00:00:00+08:00"),
      },
      sendDate,
    });
    const grant = {
      _id: new mongoose.Types.ObjectId(),
      userId,
      periodId: periodId.toString(),
      tenantId: new mongoose.Types.ObjectId(),
      availableCount: 1,
      scheduledSendDate: sendDate,
      scheduledSendDateKey: scheduledPlan.sendDateKey,
      retryAt: null,
      retryCount: 0,
      context: {
        periodId: periodId.toString(),
        sourceAction: "course_detail_click",
      },
    };
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
    const section = {
      _id: new mongoose.Types.ObjectId(),
      title: "第十八天 晨读任务",
      day: scheduledPlan.dayIndex,
    };

    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, [grant]));
    SubscribeMessageGrantStub.findOneAndUpdate.resolves(grant);
    EnrollmentStub.findOne.returns(setupFindChain(sandbox, enrollment));
    PeriodStub.findById.returns(setupFindChain(sandbox, period));
    SectionStub.findOne.returns(setupFindChain(sandbox, section));
    TenantStub.findById.returns(
      setupFindChain(sandbox, {
        name: "若星生活家",
        branding: { brandName: "若星生活家" },
      }),
    );
    subscribeMessageServiceStub.sendSceneMessage.resolves({ status: "sent" });

    const summary = await studyReminderService.sendDueNextDayStudyReminders();

    expect(summary.sent).to.equal(1);
    expect(subscribeMessageServiceStub.sendSceneMessage.calledOnce).to.be.true;
    const sendArgs =
      subscribeMessageServiceStub.sendSceneMessage.firstCall.args[0];
    expect(sendArgs.fields.activityName).to.equal("若星生活家晨读营");
    expect(sendArgs.fields.activityContent).to.equal("第十八天 晨读任务");
    expect(sendArgs.fields.startTime).to.include("06:00");
    expect(sendArgs.fields.joinMethod).to.equal("进入若星生活家小程序去学习");
    expect(SubscribeMessageGrantStub.findOneAndUpdate.calledTwice).to.be.true;
    const update =
      SubscribeMessageGrantStub.findOneAndUpdate.secondCall.args[1];
    expect(update.$set.availableCount).to.equal(0);
    expect(update.$set.scheduledSendDate).to.equal(null);
    expect(update.$set.retryAt).to.equal(null);
  });

  it("should queue one retry on temporary failure and clear after retry attempt", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const sendDate = new Date("2026-03-30T05:55:00+08:00");
    const scheduledPlan = buildScheduledStudyReminderPlan({
      period: {
        startDate: new Date("2026-03-13T00:00:00+08:00"),
        endDate: new Date("2026-04-04T00:00:00+08:00"),
      },
      sendDate,
    });
    const grant = {
      _id: new mongoose.Types.ObjectId(),
      userId,
      periodId: periodId.toString(),
      availableCount: 1,
      scheduledSendDate: sendDate,
      scheduledSendDateKey: scheduledPlan.sendDateKey,
      retryAt: null,
      retryCount: 0,
      context: {
        periodId: periodId.toString(),
        sourceAction: "course_detail_click",
      },
    };
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
    const section = {
      _id: new mongoose.Types.ObjectId(),
      title: "第十八天 晨读任务",
      day: scheduledPlan.dayIndex,
    };

    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, [grant]));
    SubscribeMessageGrantStub.findOneAndUpdate.resolves(grant);
    EnrollmentStub.findOne.returns(setupFindChain(sandbox, enrollment));
    PeriodStub.findById.returns(setupFindChain(sandbox, period));
    SectionStub.findOne.returns(setupFindChain(sandbox, section));
    subscribeMessageServiceStub.sendSceneMessage.resolves({ status: "failed" });

    const initialSummary =
      await studyReminderService.sendDueNextDayStudyReminders({
        attemptType: "scheduled",
      });
    expect(initialSummary.retryQueued).to.equal(1);
    expect(SubscribeMessageGrantStub.findOneAndUpdate.called).to.be.true;

    SubscribeMessageGrantStub.findOneAndUpdate.resetHistory();
    subscribeMessageServiceStub.sendSceneMessage.resetHistory();
    subscribeMessageServiceStub.sendSceneMessage.resolves({ status: "failed" });

    const retrySummary =
      await studyReminderService.sendDueNextDayStudyReminders({
        attemptType: "retry",
      });

    expect(retrySummary.failed).to.equal(1);
    expect(SubscribeMessageGrantStub.findOneAndUpdate.calledTwice).to.be.true;
    const retryUpdate =
      SubscribeMessageGrantStub.findOneAndUpdate.secondCall.args[1];
    expect(retryUpdate.$set.availableCount).to.equal(0);
    expect(retryUpdate.$set.retryAt).to.equal(null);
  });

  it("should promote a queued next-day grant after the current reminder succeeds", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const queuedPeriodId = new mongoose.Types.ObjectId();
    const currentSendDate = new Date("2026-03-30T05:55:00+08:00");
    const queuedSendDate = new Date("2026-03-31T05:55:00+08:00");
    const grant = {
      _id: new mongoose.Types.ObjectId(),
      userId,
      periodId: periodId.toString(),
      availableCount: 1,
      scheduledSendDate: currentSendDate,
      scheduledSendDateKey: "2026-03-30",
      queuedSendDate,
      queuedSendDateKey: "2026-03-31",
      queuedPeriodId: queuedPeriodId.toString(),
      queuedContext: {
        periodId: queuedPeriodId.toString(),
        sourceAction: "next_click",
      },
      retryAt: null,
      retryCount: 0,
    };
    const period = {
      _id: periodId,
      startDate: new Date("2026-03-13T00:00:00+08:00"),
      endDate: new Date("2026-04-04T00:00:00+08:00"),
    };

    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, [grant]));
    SubscribeMessageGrantStub.findOneAndUpdate.resolves(grant);
    EnrollmentStub.findOne.returns(
      setupFindChain(sandbox, { userId, periodId }),
    );
    PeriodStub.findById.returns(setupFindChain(sandbox, period));
    SectionStub.findOne.returns(
      setupFindChain(sandbox, { title: "当天课程", day: 17 }),
    );
    subscribeMessageServiceStub.sendSceneMessage.resolves({ status: "sent" });

    const summary = await studyReminderService.sendDueNextDayStudyReminders();

    expect(summary.sent).to.equal(1);
    const finishUpdate =
      SubscribeMessageGrantStub.findOneAndUpdate.secondCall.args[1];
    expect(finishUpdate.$set.availableCount).to.equal(1);
    expect(finishUpdate.$set.scheduledSendDate).to.equal(queuedSendDate);
    expect(finishUpdate.$set.scheduledSendDateKey).to.equal("2026-03-31");
    expect(finishUpdate.$set.periodId).to.equal(queuedPeriodId.toString());
    expect(finishUpdate.$unset.queuedSendDate).to.equal(1);
  });

  it("should allow only one concurrent worker to send a claimed grant", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const sendDate = new Date("2026-03-30T05:55:00+08:00");
    const grant = {
      _id: new mongoose.Types.ObjectId(),
      userId,
      periodId: periodId.toString(),
      availableCount: 1,
      scheduledSendDate: sendDate,
      scheduledSendDateKey: "2026-03-30",
      retryAt: null,
      retryCount: 0,
    };
    const period = {
      _id: periodId,
      startDate: new Date("2026-03-13T00:00:00+08:00"),
      endDate: new Date("2026-04-04T00:00:00+08:00"),
    };

    SubscribeMessageGrantStub.findOneAndUpdate
      .onFirstCall()
      .resolves(grant)
      .onSecondCall()
      .resolves(null);
    EnrollmentStub.findOne.returns(
      setupFindChain(sandbox, { userId, periodId }),
    );
    PeriodStub.findById.returns(setupFindChain(sandbox, period));
    SectionStub.findOne.returns(
      setupFindChain(sandbox, { title: "当天课程", day: 17 }),
    );
    subscribeMessageServiceStub.sendSceneMessage.resolves({ status: "sent" });

    const [first, second] = await Promise.all([
      studyReminderService.sendOneReminder(grant),
      studyReminderService.sendOneReminder(grant),
    ]);

    expect([first.status, second.status]).to.include("sent");
    expect([first.status, second.status]).to.include("skipped_claimed");
    expect(subscribeMessageServiceStub.sendSceneMessage.calledOnce).to.be.true;
  });

  it("should skip a reminder whose source id was already delivered successfully", async () => {
    const userId = new mongoose.Types.ObjectId();
    const periodId = new mongoose.Types.ObjectId();
    const sendDate = new Date("2026-03-30T05:55:00+08:00");
    const grant = {
      _id: new mongoose.Types.ObjectId(),
      userId,
      periodId: periodId.toString(),
      availableCount: 1,
      scheduledSendDate: sendDate,
      scheduledSendDateKey: "2026-03-30",
      retryAt: null,
      retryCount: 0,
    };
    const period = {
      _id: periodId,
      startDate: new Date("2026-03-13T00:00:00+08:00"),
      endDate: new Date("2026-04-04T00:00:00+08:00"),
    };

    SubscribeMessageGrantStub.findOneAndUpdate.resolves(grant);
    EnrollmentStub.findOne.returns(
      setupFindChain(sandbox, { userId, periodId }),
    );
    PeriodStub.findById.returns(setupFindChain(sandbox, period));
    SectionStub.findOne.returns(
      setupFindChain(sandbox, { title: "当天课程", day: 17 }),
    );
    SubscribeMessageDeliveryStub.findOne.returns(
      setupFindChain(sandbox, { _id: new mongoose.Types.ObjectId() }),
    );

    const result = await studyReminderService.sendOneReminder(grant);

    expect(result.status).to.equal("skipped_already_delivered");
    expect(subscribeMessageServiceStub.sendSceneMessage.called).to.equal(false);
  });

  it("should register the 05:55 primary schedule and 06:00 retry schedule", () => {
    studyReminderService.startStudyReminderSchedules();

    expect(scheduleStub.callCount).to.equal(2);
    expect(scheduleStub.firstCall.args[0]).to.equal("55 5 * * *");
    expect(scheduleStub.secondCall.args[0]).to.equal("0 6 * * *");
    expect(scheduleStub.firstCall.args[2]).to.deep.equal({
      timezone: "Asia/Shanghai",
    });
  });
});
