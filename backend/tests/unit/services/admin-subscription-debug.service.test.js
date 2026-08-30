const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const mongoose = require('mongoose');
const { setupFindChain } = require('../helpers/mock-helpers');

describe('Admin Subscription Debug Service', () => {
  let sandbox;
  let service;
  let UserStub;
  let EnrollmentStub;
  let PeriodStub;
  let SubscribeMessageGrantStub;
  let SubscribeMessageDeliveryStub;

  const periodId = new mongoose.Types.ObjectId();
  const otherPeriodId = new mongoose.Types.ObjectId();
  const userId1 = new mongoose.Types.ObjectId();
  const userId2 = new mongoose.Types.ObjectId();

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    UserStub = {
      find: sandbox.stub(),
      findOne: sandbox.stub()
    };

    EnrollmentStub = {
      find: sandbox.stub()
    };

    PeriodStub = {
      find: sandbox.stub()
    };

    SubscribeMessageGrantStub = {
      find: sandbox.stub()
    };

    SubscribeMessageDeliveryStub = {
      find: sandbox.stub()
    };

    service = proxyquire('../../../src/services/admin-subscription-debug.service', {
      '../models/User': UserStub,
      '../models/Enrollment': EnrollmentStub,
      '../models/Period': PeriodStub,
      '../models/SubscribeMessageGrant': SubscribeMessageGrantStub,
      '../models/SubscribeMessageDelivery': SubscribeMessageDeliveryStub
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should build a grouped list with statuses and pagination', async () => {
    const users = [
      {
        _id: userId1,
        nickname: '用户A',
        phone: '13800000001',
        openid: 'openid-a',
        status: 'active',
        createdAt: new Date('2026-03-01T00:00:00+08:00'),
        updatedAt: new Date('2026-03-02T00:00:00+08:00')
      },
      {
        _id: userId2,
        nickname: '用户B',
        phone: '13800000002',
        openid: 'openid-b',
        status: 'banned',
        createdAt: new Date('2026-03-03T00:00:00+08:00'),
        updatedAt: new Date('2026-03-04T00:00:00+08:00')
      }
    ];

    const enrollments = [
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId1,
        periodId,
        status: 'active',
        paymentStatus: 'paid',
        enrolledAt: new Date('2026-03-05T00:00:00+08:00'),
        createdAt: new Date('2026-03-05T00:00:00+08:00')
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId2,
        periodId: otherPeriodId,
        status: 'completed',
        paymentStatus: 'paid',
        enrolledAt: new Date('2026-03-06T00:00:00+08:00'),
        createdAt: new Date('2026-03-06T00:00:00+08:00')
      }
    ];

    const grants = [
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId1,
        scene: 'comment_received',
        templateId: 'comment-template',
        availableCount: 50,
        autoTopUpTarget: 50,
        lastResult: 'accept',
        lastAcceptedAt: new Date('2026-03-10T00:00:00+08:00'),
        updatedAt: new Date('2026-03-10T00:00:00+08:00')
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId1,
        scene: 'next_day_study_reminder',
        templateId: 'next-day-template',
        availableCount: 1,
        autoTopUpTarget: 1,
        periodId,
        scheduledSendDate: new Date('2026-03-30T05:55:00+08:00'),
        scheduledSendDateKey: '2026-03-30',
        lastResult: 'accept',
        context: { periodId: periodId.toString(), sourceAction: 'course_detail_click' },
        updatedAt: new Date('2026-03-29T00:00:00+08:00')
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId2,
        scene: 'like_received',
        templateId: 'like-template',
        availableCount: 0,
        autoTopUpTarget: 50,
        lastResult: 'reject',
        lastRejectedAt: new Date('2026-03-11T00:00:00+08:00'),
        updatedAt: new Date('2026-03-11T00:00:00+08:00')
      }
    ];

    const deliveries = [
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId1,
        scene: 'comment_received',
        templateId: 'comment-template',
        status: 'sent',
        createdAt: new Date('2026-03-12T00:00:00+08:00')
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId1,
        scene: 'next_day_study_reminder',
        templateId: 'next-day-template',
        status: 'failed',
        errorMessage: 'temporary error',
        createdAt: new Date('2026-03-13T00:00:00+08:00')
      }
    ];

    const periods = [
      {
        _id: periodId,
        title: '成都营',
        name: '成都营',
        startDate: new Date('2026-03-13T00:00:00+08:00'),
        endDate: new Date('2026-04-04T00:00:00+08:00'),
        dateRange: '03/13 至 04/04',
        status: 'ongoing',
        isPublished: true
      },
      {
        _id: otherPeriodId,
        title: '广州营',
        name: '广州营',
        startDate: new Date('2026-04-10T00:00:00+08:00'),
        endDate: new Date('2026-05-01T00:00:00+08:00'),
        dateRange: '04/10 至 05/01',
        status: 'ongoing',
        isPublished: true
      }
    ];

    UserStub.find.returns(setupFindChain(sandbox, users));
    EnrollmentStub.find.onFirstCall().returns(setupFindChain(sandbox, enrollments));
    EnrollmentStub.find.onSecondCall().returns(setupFindChain(sandbox, enrollments));
    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, grants));
    SubscribeMessageDeliveryStub.find.returns(setupFindChain(sandbox, deliveries));
    PeriodStub.find.returns(setupFindChain(sandbox, periods));

    const result = await service.buildSubscriptionDebugDataset({
      page: 1,
      limit: 20
    });

    expect(result.list).to.have.length(2);
    expect(result.summary.totalUsers).to.equal(2);
    expect(result.summary.blockedCount).to.equal(1);
    expect(result.summary.scheduledCount).to.equal(1);
    expect(result.summary.anomalyCount).to.equal(2);

    const rowA = result.list.find(item => item.user && item.user._id.toString() === userId1.toString());
    expect(rowA.status).to.equal('scheduled');
    expect(rowA.sceneStates.find(scene => scene.scene === 'comment_received').availableCount).to.equal(50);
    expect(rowA.sceneStates.find(scene => scene.scene === 'next_day_study_reminder').scheduledSendDate).to.be.instanceOf(Date);
  });

  it('should build user detail with recent deliveries', async () => {
    const user = {
      _id: userId1,
      nickname: '用户A',
      phone: '13800000001',
      openid: 'openid-a',
      status: 'active',
      createdAt: new Date('2026-03-01T00:00:00+08:00'),
      updatedAt: new Date('2026-03-02T00:00:00+08:00')
    };

    const enrollment = {
      _id: new mongoose.Types.ObjectId(),
      userId: userId1,
      periodId,
      status: 'active',
      paymentStatus: 'paid',
      enrolledAt: new Date('2026-03-05T00:00:00+08:00'),
      createdAt: new Date('2026-03-05T00:00:00+08:00')
    };

    const grant = {
      _id: new mongoose.Types.ObjectId(),
      userId: userId1,
      scene: 'next_day_study_reminder',
      templateId: 'next-day-template',
      availableCount: 1,
      autoTopUpTarget: 1,
      periodId,
      scheduledSendDate: new Date('2026-03-30T05:55:00+08:00'),
      scheduledSendDateKey: '2026-03-30',
      lastResult: 'accept',
      context: { periodId: periodId.toString(), sourceAction: 'course_detail_click' },
      updatedAt: new Date('2026-03-29T00:00:00+08:00')
    };

    const deliveries = [
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId1,
        scene: 'next_day_study_reminder',
        templateId: 'next-day-template',
        status: 'sent',
        createdAt: new Date('2026-03-12T00:00:00+08:00')
      }
    ];

    const periods = [
      {
        _id: periodId,
        title: '成都营',
        name: '成都营',
        startDate: new Date('2026-03-13T00:00:00+08:00'),
        endDate: new Date('2026-04-04T00:00:00+08:00'),
        dateRange: '03/13 至 04/04',
        status: 'ongoing',
        isPublished: true
      }
    ];

    UserStub.findOne.returns(setupFindChain(sandbox, user));
    EnrollmentStub.find.returns(setupFindChain(sandbox, [enrollment]));
    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, [grant]));
    SubscribeMessageDeliveryStub.find.returns(setupFindChain(sandbox, deliveries));
    PeriodStub.find.returns(setupFindChain(sandbox, periods));

    const result = await service.getSubscriptionDebugUserDetail(userId1.toString());

    expect(result.user.nickname).to.equal('用户A');
    expect(result.sceneStates).to.have.length(12);
    expect(result.sceneStates.find(scene => scene.scene === 'next_day_study_reminder').scheduledSendDate).to.be.instanceOf(Date);
    expect(result.recentDeliveries).to.have.length(1);
    expect(result.summary.totalAvailableCount).to.equal(1);
  });

  it('should keep rejected enrollment scenes with remaining inventory in warning state', async () => {
    const user = {
      _id: userId1,
      nickname: '用户A',
      phone: '13800000001',
      openid: 'openid-a',
      status: 'active',
      createdAt: new Date('2026-03-01T00:00:00+08:00'),
      updatedAt: new Date('2026-03-02T00:00:00+08:00')
    };

    const enrollment = {
      _id: new mongoose.Types.ObjectId(),
      userId: userId1,
      periodId,
      status: 'active',
      paymentStatus: 'paid',
      enrolledAt: new Date('2026-03-05T00:00:00+08:00'),
      createdAt: new Date('2026-03-05T00:00:00+08:00')
    };

    const grant = {
      _id: new mongoose.Types.ObjectId(),
      userId: userId1,
      scene: 'enrollment_result',
      templateId: 'enrollment-template',
      availableCount: 3,
      autoTopUpTarget: 1,
      lastResult: 'reject',
      lastAcceptedAt: new Date('2026-03-28T17:24:16+08:00'),
      lastRejectedAt: new Date('2026-03-28T17:25:34+08:00'),
      updatedAt: new Date('2026-03-28T17:25:34+08:00')
    };

    UserStub.findOne.returns(setupFindChain(sandbox, user));
    EnrollmentStub.find.returns(setupFindChain(sandbox, [enrollment]));
    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, [grant]));
    SubscribeMessageDeliveryStub.find.returns(setupFindChain(sandbox, []));
    PeriodStub.find.returns(setupFindChain(sandbox, [
      {
        _id: periodId,
        title: '成都营',
        name: '成都营',
        startDate: new Date('2026-03-13T00:00:00+08:00'),
        endDate: new Date('2026-04-04T00:00:00+08:00'),
        dateRange: '03/13 至 04/04',
        status: 'ongoing',
        isPublished: true
      }
    ]));

    const result = await service.getSubscriptionDebugUserDetail(userId1.toString());
    const enrollmentScene = result.sceneStates.find(scene => scene.scene === 'enrollment_result');

    expect(enrollmentScene.status).to.equal('ready');
    expect(enrollmentScene.statusLabel).to.equal('曾拒绝');
    expect(enrollmentScene.statusType).to.equal('warning');
    expect(result.summary.blockedSceneCount).to.equal(0);
  });

  it('should mark delivery-blocked scenes as reauthorization required', async () => {
    const user = {
      _id: userId1,
      nickname: '用户A',
      phone: '13800000001',
      openid: 'openid-a',
      status: 'active',
      createdAt: new Date('2026-03-01T00:00:00+08:00'),
      updatedAt: new Date('2026-03-02T00:00:00+08:00')
    };

    UserStub.findOne.returns(setupFindChain(sandbox, user));
    EnrollmentStub.find.returns(setupFindChain(sandbox, []));
    SubscribeMessageGrantStub.find.returns(setupFindChain(sandbox, [
      {
        _id: new mongoose.Types.ObjectId(),
        userId: userId1,
        scene: 'like_received',
        templateId: 'like-template',
        availableCount: 5,
        autoTopUpTarget: 50,
        deliveryBlocked: true,
        deliveryBlockedReason: 'wechat_delivery_refused',
        lastWechatErrorCode: 43101,
        lastWechatRefusedAt: new Date('2026-03-30T23:17:52+08:00'),
        updatedAt: new Date('2026-03-30T23:17:52+08:00')
      }
    ]));
    SubscribeMessageDeliveryStub.find.returns(setupFindChain(sandbox, []));
    PeriodStub.find.returns(setupFindChain(sandbox, []));

    const result = await service.getSubscriptionDebugUserDetail(userId1.toString());
    const likeScene = result.sceneStates.find(scene => scene.scene === 'like_received');

    expect(likeScene.status).to.equal('needs_reauthorization');
    expect(likeScene.statusLabel).to.equal('待重新授权');
    expect(likeScene.statusType).to.equal('warning');
    expect(result.status).to.equal('needs_reauthorization');
    expect(result.statusLabel).to.equal('待重新授权');
    expect(result.summary.needsReauthorizationSceneCount).to.equal(1);
  });
});
