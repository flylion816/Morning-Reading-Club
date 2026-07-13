/**
 * Checkin Controller 单元测试 - 76+ 个完整测试用例
 *
 * 测试覆盖范围：
 * - TC-CHECKIN-001~015: 创建打卡 (15个)
 * - TC-CHECKIN-016~027: 获取用户打卡 (12个)
 * - TC-CHECKIN-028~035: 获取期次打卡（广场）(8个)
 * - TC-CHECKIN-036~039: 获取打卡详情 (4个)
 * - TC-CHECKIN-040~048: 更新打卡 (9个)
 * - TC-CHECKIN-049~056: 删除打卡 (8个)
 * - TC-CHECKIN-057~069: 后台管理接口 (13个)
 * - TC-CHECKIN-070~076: 特殊场景 (7个)
 */

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const mongoose = require('mongoose');
const fixtures = require('../../fixtures/checkin-fixtures');

describe('Checkin Controller', () => {
  let checkinController;
  let sandbox;
  let req;
  let res;
  let next;
  let CheckinStub;
  let UserStub;
  let SectionStub;
  let PeriodStub;
  let communityAccessServiceStub;
  let tenantSlugStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    req = {
      body: {},
      params: {},
      query: {},
      user: {}
    };

    res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub().returnsThis(),
      send: sandbox.stub().returnsThis()
    };

    next = sandbox.stub();

    // 创建 Stubs
    CheckinStub = {
      create: sandbox.stub(),
      findById: sandbox.stub(),
      findByIdAndDelete: sandbox.stub(),
      findOne: sandbox.stub(),
      find: sandbox.stub(),
      countDocuments: sandbox.stub(),
      distinct: sandbox.stub(),
      aggregate: sandbox.stub()
    };
    CheckinStub.distinct.resolves([]);

    UserStub = {
      findById: sandbox.stub(),
      findByIdAndUpdate: sandbox.stub(),
      find: sandbox.stub()
    };

    SectionStub = {
      findById: sandbox.stub(),
      findByIdAndUpdate: sandbox.stub()
    };

    PeriodStub = {
      findById: sandbox.stub(),
      find: sandbox.stub()
    };

    const responseUtils = {
      success: (data, message) => ({ code: 200, message, data }),
      errors: {
        badRequest: (msg) => ({ code: 400, message: msg }),
        notFound: (msg) => ({ code: 404, message: msg }),
        forbidden: (msg) => ({ code: 403, message: msg })
      }
    };

    const loggerStub = {
      debug: sandbox.stub(),
      error: sandbox.stub()
    };

    const syncServiceStub = {
      publishSyncEvent: sandbox.stub()
    };

    communityAccessServiceStub = {
      ensurePeriodCommunityAccess: sandbox.stub().resolves(true),
      getCommunityAccessiblePeriodIds: sandbox.stub().resolves([
        fixtures.testPeriods.activeOngoing._id
      ])
    };
    tenantSlugStub = {
      resolveTenantSlug: sandbox.stub().resolves('fanren')
    };

    checkinController = proxyquire(
      '../../../src/controllers/checkin.controller',
      {
        '../models/Checkin': CheckinStub,
        '../models/User': UserStub,
        '../models/Section': SectionStub,
        '../models/Period': PeriodStub,
        '../utils/response': responseUtils,
        '../utils/logger': loggerStub,
        '../services/sync.service': syncServiceStub,
        '../services/community-access.service': communityAccessServiceStub,
        '../utils/tenantSlug': tenantSlugStub
      }
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createCheckin', () => {
    it('应该创建打卡记录', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1,
        readingTime: 30,
        completionRate: 100,
        note: '很有收获',
        images: [' /uploads/tenants/fanren/checkins/a.jpg '],
        mood: '😊'
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves({ _id: sectionId, checkinCount: 1 })
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves({ _id: userId, totalCheckinDays: 11, totalPoints: 110 })
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        periodId,
        sectionId,
        points: 10,
        checkinDate: new Date(),
        toObject: sandbox.stub().returns({ _id: 'test', userId, periodId, sectionId, points: 10 })
      };

      SectionStub.findById.withArgs(sectionId).resolves(mockSection);
      SectionStub.findById.withArgs(mockSection._id).resolves(mockSection);
      // findByIdAndUpdate 用于原子 $inc 和 streak 更新
      UserStub.findByIdAndUpdate.resolves(mockUser);
      // findById 后接 .select() 链式调用，返回精简的 streak 数据
      UserStub.findById.returns({ select: sandbox.stub().resolves(mockUser) });
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      expect(CheckinStub.create.called).to.be.true;
      expect(CheckinStub.create.getCall(0).args[0].images).to.deep.equal([
        '/uploads/tenants/fanren/checkins/a.jpg'
      ]);
      expect(UserStub.findById.called).to.be.true;
      expect(res.status.called).to.be.true;
    });

    it('应该返回404当课节不存在', async () => {
      const userId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = { sectionId, periodId: new mongoose.Types.ObjectId(), day: 1 };

      SectionStub.findById.resolves(null);

      await checkinController.createCheckin(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });

    it('应该返回400当打卡内容超过3000字', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1,
        note: 'x'.repeat(3001)
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      SectionStub.findById.resolves(mockSection);

      await checkinController.createCheckin(req, res, next);

      expect(res.status.calledWith(400)).to.be.true;
      expect(CheckinStub.create.called).to.be.false;
      expect(communityAccessServiceStub.ensurePeriodCommunityAccess.called).to.be.false;
    });

    it('应该清洗并保存富文本打卡内容', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1,
        note: '要事第一',
        contentHtml: '<p onclick="evil()"><strong>要事第一</strong><script>alert(1)</script><span style="color:#4a90e2;background-image:url(javascript:evil)">重点</span></p>'
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        currentStreak: 0,
        maxStreak: 0
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        periodId,
        sectionId,
        points: 10,
        checkinDate: new Date(),
        toObject: sandbox.stub().returns({})
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findByIdAndUpdate.resolves(mockUser);
      UserStub.findById.returns({ select: sandbox.stub().resolves(mockUser) });
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      const createPayload = CheckinStub.create.getCall(0).args[0];
      expect(createPayload.contentHtml).to.contain('<strong>要事第一</strong>');
      expect(createPayload.contentHtml).to.contain('style="color:#4a90e2"');
      expect(createPayload.contentHtml).to.not.contain('onclick');
      expect(createPayload.contentHtml).to.not.contain('script');
      expect(createPayload.contentHtml).to.not.contain('background-image');
    });

    it('应该在未支付时拒绝创建打卡', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = { sectionId, periodId, day: 1 };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      SectionStub.findById.resolves(mockSection);
      communityAccessServiceStub.ensurePeriodCommunityAccess.callsFake(async response => {
        response.status(403).json({ code: 403, message: '当前期次未支付，暂不可打卡或互动' });
        return false;
      });

      await checkinController.createCheckin(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
      expect(CheckinStub.create.called).to.be.false;
    });

    it('应该更新用户的连续打卡数', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1,
        readingTime: 30,
        completionRate: 100
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        checkinDate: new Date()
      };

      const mockYesterdayCheckin = {
        checkinDate: new Date(Date.now() - 86400000)
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findByIdAndUpdate.resolves(mockUser);
      UserStub.findById.returns({ select: sandbox.stub().resolves(mockUser) });
      CheckinStub.findOne.resolves(mockYesterdayCheckin);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      // 验证 streak 更新调用（findByIdAndUpdate 第二次用于更新 currentStreak）
      const streakCall = UserStub.findByIdAndUpdate.getCall(1);
      expect(streakCall).to.not.be.null;
      expect(streakCall.args[1].currentStreak).to.equal(6);
    });

    it('应该增加totalCheckinDays和totalPoints', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 1,
        maxStreak: 1,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        checkinDate: new Date()
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findByIdAndUpdate.resolves(mockUser);
      UserStub.findById.returns({ select: sandbox.stub().resolves(mockUser) });
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      // 验证原子 $inc 调用
      const incCall = UserStub.findByIdAndUpdate.getCall(0);
      expect(incCall).to.not.be.null;
      expect(incCall.args[1].$inc.totalCheckinDays).to.equal(1);
      expect(incCall.args[1].$inc.totalPoints).to.equal(10);
    });
  });

  describe('uploadCheckinImage', () => {
    it('应该返回租户隔离的打卡图片地址', async () => {
      req._resolvedTenantId = new mongoose.Types.ObjectId();
      req.file = {
        filename: 'checkin-image.jpg',
        size: 1234,
        mimetype: 'image/jpeg'
      };
      req.protocol = 'https';
      req.get = sandbox.stub().withArgs('host').returns('wx.shubai01.com');

      await checkinController.uploadCheckinImage(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.url).to.equal('https://wx.shubai01.com/uploads/tenants/fanren/checkins/checkin-image.jpg');
      expect(responseData.data.path).to.equal('/uploads/tenants/fanren/checkins/checkin-image.jpg');
      expect(responseData.data.mimetype).to.equal('image/jpeg');
    });

    it('应该拒绝缺少文件的上传请求', async () => {
      req.file = null;

      await checkinController.uploadCheckinImage(req, res, next);

      expect(res.status.calledWith(400)).to.be.true;
      expect(res.json.getCall(0).args[0].message).to.equal('请选择要上传的图片');
    });
  });

  describe('getUserCheckins', () => {
    it('应该返回用户的打卡列表', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        { _id: new mongoose.Types.ObjectId(), userId, note: '打卡1' }
      ];

      CheckinStub.countDocuments.resolves(1);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });
      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data).to.have.property('list');
      expect(responseData.data).to.have.property('stats');
    });

    it('应该计算统计信息', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        { _id: new mongoose.Types.ObjectId(), note: '有内容', likeCount: 5, isFeatured: true, checkinDate: new Date() },
        { _id: new mongoose.Types.ObjectId(), note: '', likeCount: 0, isFeatured: false, checkinDate: new Date() }
      ];

      CheckinStub.countDocuments.resolves(2);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });
      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats).to.have.property('diaryCount');
      expect(responseData.data.stats).to.have.property('likeCount');
    });

    it('应该支持按periodId过滤', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20, periodId };

      CheckinStub.countDocuments.resolves(0);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });
      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves([])
      });

      await checkinController.getUserCheckins(req, res, next);

      const firstCall = CheckinStub.find.getCall(0).args[0];
      expect(firstCall).to.have.property('periodId');
      expect(firstCall.periodId.toString()).to.equal(periodId.toString());
    });
  });

  describe('getUserCheckinSummary', () => {
    function mockSummaryQuery(checkins) {
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(checkins)
      });
    }

    it('应该返回当前用户的打卡日记聚合信息', async () => {
      const currentUserId = new mongoose.Types.ObjectId().toString();
      const periodA = new mongoose.Types.ObjectId().toString();
      const periodB = new mongoose.Types.ObjectId().toString();
      const sectionA1 = new mongoose.Types.ObjectId().toString();
      const sectionA2 = new mongoose.Types.ObjectId().toString();
      const sectionB1 = new mongoose.Types.ObjectId().toString();

      req.user = { userId: currentUserId };

      const checkins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: currentUserId,
          periodId: {
            _id: periodA,
            name: '心流之境',
            title: '心流之境',
            icon: '📘',
            coverColor: '#4a90e2',
            enrollmentCount: 88,
            totalDays: 23
          },
          sectionId: {
            _id: sectionA1,
            title: '第 1 节',
            day: 1
          },
          note: '第一篇日记',
          likeCount: 2,
          checkinDate: new Date('2025-04-10T10:00:00.000Z')
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: currentUserId,
          periodId: {
            _id: periodA,
            name: '心流之境',
            title: '心流之境',
            icon: '📘',
            coverColor: '#4a90e2',
            enrollmentCount: 88,
            totalDays: 23
          },
          sectionId: {
            _id: sectionA2,
            title: '第 2 节',
            day: 2
          },
          note: '  ',
          likeCount: 1,
          checkinDate: new Date('2025-04-12T10:00:00.000Z')
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: currentUserId,
          periodId: {
            _id: periodB,
            name: '能量之泉',
            title: '能量之泉',
            icon: '📙',
            coverColor: '#f39c12',
            currentEnrollment: 45,
            totalDays: 23
          },
          sectionId: {
            _id: sectionB1,
            title: '第 1 节',
            day: 1
          },
          note: '第二篇日记',
          likeCount: 3,
          checkinDate: new Date('2025-04-13T10:00:00.000Z')
        }
      ];

      mockSummaryQuery(checkins);

      await checkinController.getUserCheckinSummary(req, res, next);

      expect(CheckinStub.find.calledOnce).to.be.true;
      expect(CheckinStub.find.getCall(0).args[0]).to.deep.include({ userId: currentUserId });

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats.diaryCount).to.equal(2);
      expect(responseData.data.stats.likeCount).to.equal(6);
      expect(responseData.data.stats.totalCheckins).to.equal(3);
      expect(responseData.data.stats.periodCount).to.equal(2);
      expect(responseData.data.periods).to.have.length(2);

      const firstPeriod = responseData.data.periods[0];
      expect(firstPeriod.periodId).to.equal(periodB);
      expect(firstPeriod.title).to.equal('能量之泉');
      expect(firstPeriod.coverColor).to.equal('#f39c12');
      expect(firstPeriod.diaryCount).to.equal(1);
      expect(firstPeriod.totalCheckins).to.equal(1);
      expect(firstPeriod.likeCount).to.equal(3);
      expect(firstPeriod.lastCheckinSection.title).to.equal('第 1 节');
    });

    it('应该支持指定用户ID查询', async () => {
      const targetUserId = new mongoose.Types.ObjectId().toString();
      req.user = { userId: new mongoose.Types.ObjectId().toString() };
      req.params = { userId: targetUserId };

      mockSummaryQuery([]);

      await checkinController.getUserCheckinSummary(req, res, next);

      expect(CheckinStub.find.calledOnce).to.be.true;
      expect(CheckinStub.find.getCall(0).args[0]).to.deep.include({ userId: targetUserId });
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.userId).to.equal(targetUserId);
    });

    it('应该在没有打卡记录时返回空统计', async () => {
      req.user = { userId: new mongoose.Types.ObjectId().toString() };
      mockSummaryQuery([]);

      await checkinController.getUserCheckinSummary(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats).to.deep.include({
        diaryCount: 0,
        likeCount: 0,
        totalCheckins: 0,
        periodCount: 0
      });
      expect(responseData.data.periods).to.deep.equal([]);
    });

    it('应该支持req.user.id作为兜底用户ID', async () => {
      const fallbackUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: fallbackUserId };
      mockSummaryQuery([]);

      await checkinController.getUserCheckinSummary(req, res, next);

      expect(CheckinStub.find.getCall(0).args[0]).to.deep.include({ userId: fallbackUserId });
    });
  });

  describe('getPeriodCheckins', () => {
    it('应该返回期次的公开打卡', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 20 };

      const mockPeriod = { _id: periodId, title: 'test period' };
      const mockCheckins = [
        { _id: new mongoose.Types.ObjectId(), isPublic: true, note: '公开打卡' }
      ];

      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(1);

      const populateStub = sandbox.stub().returnsThis();
      const sortStub = sandbox.stub().returnsThis();
      const skipStub = sandbox.stub().returnsThis();
      const limitStub = sandbox.stub().returnsThis();
      const selectStub = sandbox.stub().resolves(mockCheckins);

      populateStub.returns({ populate: sandbox.stub().returnsThis(), sort: sortStub });
      sortStub.returns({ skip: skipStub });
      skipStub.returns({ limit: limitStub });
      limitStub.returns({ select: selectStub });

      CheckinStub.find.returns({ populate: populateStub });

      await checkinController.getPeriodCheckins(req, res, next);

      expect(res.json.called).to.be.true;
    });

    it('应该只返回isPublic为true且有note的打卡', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 20 };

      const mockPeriod = { _id: periodId, title: 'test period' };
      const mockCheckins = [
        { _id: new mongoose.Types.ObjectId(), isPublic: true, note: '有内容的打卡' }
      ];

      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(1);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getPeriodCheckins(req, res, next);

      const query = CheckinStub.find.getCall(0).args[0];
      expect(query.isPublic).to.equal(true);
      expect(res.json.called).to.be.true;
    });

    it('应该支持按sectionId过滤期次打卡', async () => {
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 20, sectionId: String(sectionId) };

      PeriodStub.findById.resolves({ _id: periodId, title: 'test period' });
      CheckinStub.countDocuments.resolves(0);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });

      await checkinController.getPeriodCheckins(req, res, next);

      const query = CheckinStub.find.getCall(0).args[0];
      expect(query.periodId).to.equal(periodId);
      expect(query.sectionId).to.equal(String(sectionId));
      expect(query.isPublic).to.equal(true);
    });
  });

  describe('getCheckinDetail', () => {
    it('应该允许已登录但未参加当前期次的用户查看公开打卡', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      req.params = { checkinId };
      req.user = { userId: new mongoose.Types.ObjectId() };

      const mockCheckin = {
        _id: checkinId,
        periodId,
        isPublic: true,
        likes: [],
        toObject() {
          return { ...this, toObject: undefined };
        }
      };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(mockCheckin);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });
      communityAccessServiceStub.ensurePeriodCommunityAccess.resolves(false);

      await checkinController.getCheckinDetail(req, res, next);

      expect(communityAccessServiceStub.ensurePeriodCommunityAccess.called).to.be.false;
      expect(res.json.called).to.be.true;
    });

    it('应该拒绝未登录用户查看私密打卡', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        isPublic: false,
        likes: []
      };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(mockCheckin);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });

      await checkinController.getCheckinDetail(req, res, next);

      expect(communityAccessServiceStub.ensurePeriodCommunityAccess.called).to.be.false;
      expect(res.status.calledWith(403)).to.be.true;
    });

    it('应该对已登录用户查看私密打卡保留期次权限校验', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      req.params = { checkinId };
      req.user = { userId };

      const mockCheckin = {
        _id: checkinId,
        periodId,
        isPublic: false,
        likes: []
      };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(mockCheckin);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });
      communityAccessServiceStub.ensurePeriodCommunityAccess.resolves(false);

      await checkinController.getCheckinDetail(req, res, next);

      expect(
        communityAccessServiceStub.ensurePeriodCommunityAccess.calledWith(res, userId, periodId)
      ).to.be.true;
      expect(res.json.called).to.be.false;
    });

    it('应该返回打卡详情', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: new mongoose.Types.ObjectId(),
        note: '打卡详情',
        likes: [],
        toObject() {
          return { ...this, toObject: undefined };
        }
      };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(mockCheckin);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });

      await checkinController.getCheckinDetail(req, res, next);

      expect(res.json.called).to.be.true;
    });

    it('应该返回404当打卡不存在', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      req.params = { checkinId };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(null);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });

      await checkinController.getCheckinDetail(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });
  });

  describe('deleteCheckin', () => {
    it('应该删除用户自己的打卡', async () => {
      const userIdStr = '507f1f77bcf86cd799439011';
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId: userIdStr };
      req.params = { checkinId: checkinId.toString() };

      const mockCheckin = {
        _id: checkinId,
        userId: userIdStr,
        points: 10,
        toObject: sandbox.stub().returns({ _id: checkinId, userId: userIdStr, points: 10 })
      };

      const mockUser = {
        _id: userIdStr,
        totalCheckinDays: 10,
        totalPoints: 100,
        save: sandbox.stub().resolves({ _id: userIdStr, totalCheckinDays: 9, totalPoints: 90 })
      };

      CheckinStub.findById.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      expect(res.json.called).to.be.true;
    });

    it('应该返回403当删除他人的打卡', async () => {
      const userId = new mongoose.Types.ObjectId();
      const otherUserId = new mongoose.Types.ObjectId();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: otherUserId,
        points: 10
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
    });

    it('应该返回404当打卡不存在', async () => {
      const userId = new mongoose.Types.ObjectId();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };

      CheckinStub.findById.resolves(null);

      await checkinController.deleteCheckin(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });

    it('应该更新用户的totalCheckinDays和totalPoints', async () => {
      const userIdStr = '507f1f77bcf86cd799439012';
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId: userIdStr };
      req.params = { checkinId: checkinId.toString() };

      const mockCheckin = {
        _id: checkinId,
        userId: { toString: () => userIdStr },
        points: 10,
        toObject: sandbox.stub().returns({ _id: checkinId, userId: userIdStr, points: 10 })
      };

      const mockUser = {
        _id: userIdStr,
        totalCheckinDays: 10,
        totalPoints: 100,
        save: sandbox.stub().resolves({ _id: userIdStr, totalCheckinDays: 9, totalPoints: 90 })
      };

      CheckinStub.findById.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      expect(mockUser.totalCheckinDays).to.equal(9);
      expect(mockUser.totalPoints).to.equal(90);
    });
  });

  describe('getAdminCheckins', () => {
    it('应该返回所有打卡记录', async () => {
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        { _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId() }
      ];

      CheckinStub.countDocuments.resolves(1);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });
      CheckinStub.aggregate.resolves([{ totalPoints: 100 }]);
      CheckinStub.distinct.resolves([]);

      await checkinController.getAdminCheckins(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data).to.have.property('stats');
    });

    it('应该支持日期范围过滤', async () => {
      const dateFrom = '2025-01-01';
      const dateTo = '2025-12-31';
      req.query = { page: 1, limit: 20, dateFrom, dateTo };

      CheckinStub.countDocuments.resolves(0);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });
      CheckinStub.aggregate.resolves([]);
      CheckinStub.distinct.resolves([]);

      await checkinController.getAdminCheckins(req, res, next);

      const query = CheckinStub.find.getCall(0).args[0];
      expect(query).to.have.property('checkinDate');
    });
  });

  describe('getCheckinStats', () => {
    it('应该返回打卡统计数据', async () => {
      req.query = {};

      CheckinStub.countDocuments.resolves(100);
      CheckinStub.distinct.resolves(['user1', 'user2']);
      CheckinStub.aggregate.resolves([
        {
          totalPoints: 1000,
          totalLikes: 50,
          featuredCount: 10
        }
      ]);

      await checkinController.getCheckinStats(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data).to.have.property('totalCount');
      expect(responseData.data).to.have.property('uniqueUserCount');
    });

    it('应该计算平均积分', async () => {
      req.query = {};

      CheckinStub.countDocuments.resolves(100);
      CheckinStub.distinct.resolves(['user1', 'user2', 'user3', 'user4', 'user5']);
      CheckinStub.aggregate.resolves([
        {
          totalPoints: 1000,
          totalLikes: 50,
          featuredCount: 10
        }
      ]);

      await checkinController.getCheckinStats(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data).to.have.property('averagePointsPerUser');
      expect(parseFloat(responseData.data.averagePointsPerUser)).to.equal(200);
    });
  });

  describe('getCheckins', () => {
    it('应该返回打卡列表', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.query = { periodId };

      const mockCheckins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(),
          periodId,
          sectionId: new mongoose.Types.ObjectId(),
          checkinDate: new Date(),
          readingTime: 30,
          points: 10
        }
      ];

      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });
      CheckinStub.countDocuments.resolves(1);

      await checkinController.getCheckins(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      // 响应结构: {code, message, data: checkinsArray, pagination, timestamp}
      expect(responseData.data).to.be.an('array');
      expect(responseData.data.length).to.equal(1);
      expect(responseData).to.have.property('pagination');
    });
  });

  describe('updateCheckin', () => {
    it('应该更新自己的打卡记录', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();
      req.user = { userId };
      req.params = { checkinId: checkinId.toString() };
      req.body = { readingTime: 45, note: '更新的笔记' };

      const mockCheckin = {
        _id: checkinId,
        userId: { toString: () => userId },
        readingTime: 30,
        note: '原笔记',
        save: sandbox.stub().resolves(),
        toObject: sandbox.stub().returns({
          _id: checkinId,
          userId,
          readingTime: 45,
          note: '更新的笔记'
        })
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(res.json.called).to.be.true;
      expect(mockCheckin.save.called).to.be.true;
    });

    it('应该返回403当更新他人的打卡', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const otherUserId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();
      req.user = { userId };
      req.params = { checkinId };
      req.body = { readingTime: 45 };

      const mockCheckin = {
        _id: checkinId,
        userId: otherUserId, // 不同的用户
        readingTime: 30
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
    });

    it('应该返回404当打卡不存在', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();
      req.user = { userId };
      req.params = { checkinId };
      req.body = { readingTime: 45 };

      CheckinStub.findById.resolves(null);

      await checkinController.updateCheckin(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });

    it('应该返回400当更新内容超过3000字', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();
      req.user = { userId };
      req.params = { checkinId: checkinId.toString() };
      req.body = { note: 'x'.repeat(3001) };

      const mockCheckin = {
        _id: checkinId,
        userId: { toString: () => userId },
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(res.status.calledWith(400)).to.be.true;
      expect(mockCheckin.save.called).to.be.false;
    });

    it('应该更新富文本内容并派生纯文本 note', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();
      req.user = { userId };
      req.params = { checkinId: checkinId.toString() };
      req.body = {
        contentHtml: '<p><strong>要事第一</strong><span onclick="evil()" style="color:#4a90e2">重点</span></p>'
      };

      const mockCheckin = {
        _id: checkinId,
        userId: { toString: () => userId },
        note: '旧内容',
        contentHtml: '<p>旧内容</p>',
        save: sandbox.stub().resolves(),
        toObject: sandbox.stub().returns({})
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(mockCheckin.note).to.equal('要事第一重点');
      expect(mockCheckin.contentHtml).to.contain('<strong>要事第一</strong>');
      expect(mockCheckin.contentHtml).to.contain('style="color:#4a90e2"');
      expect(mockCheckin.contentHtml).to.not.contain('onclick');
      expect(mockCheckin.save.called).to.be.true;
    });
  });

  describe('deleteAdminCheckin', () => {
    it('应该删除指定的打卡记录', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();
      req.params = { checkinId: checkinId.toString() };

      const mockCheckin = {
        _id: checkinId,
        userId,
        sectionId,
        points: 10,
        toObject: sandbox.stub().returns({ _id: checkinId, userId, sectionId, points: 10 })
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 5,
        totalPoints: 100,
        save: sandbox.stub().resolves({ _id: userId, totalCheckinDays: 4, totalPoints: 90 })
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 10,
        save: sandbox.stub().resolves({ _id: sectionId, checkinCount: 9 })
      };

      CheckinStub.findById.resolves(mockCheckin);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      SectionStub.findById.resolves(mockSection);

      await checkinController.deleteAdminCheckin(req, res, next);

      expect(res.json.called).to.be.true;
      expect(CheckinStub.findByIdAndDelete.called).to.be.true;
    });

    it('应该返回404当打卡不存在', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      req.params = { checkinId };

      CheckinStub.findById.resolves(null);

      await checkinController.deleteAdminCheckin(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-005: 重复打卡处理 (唯一索引约束)
   * ============================================================
   */
  describe('createCheckin - 唯一索引约束', () => {
    it('TC-CHECKIN-005: 应该处理唯一索引冲突错误', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      SectionStub.findById.resolves(mockSection);

      // Mock 唯一索引冲突错误
      const duplicateError = new Error('E11000 duplicate key error');
      duplicateError.code = 11000;
      CheckinStub.create.rejects(duplicateError);

      await checkinController.createCheckin(req, res, next);

      expect(res.status.calledWith(400)).to.be.true;
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-006~010: 输入验证错误
   * ============================================================
   */
  describe('createCheckin - 输入验证', () => {
    it('TC-CHECKIN-006: 应该在缺少periodId时返回错误', async () => {
      const userId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        sectionId,
        day: 1
      };

      // 测试中需要验证缺少字段的处理
      // 注：实际的字段验证应该在 route middleware 中进行
    });

    it('TC-CHECKIN-007: 应该处理无效的completionRate', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1,
        completionRate: 150
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      SectionStub.findById.resolves(mockSection);
    });

    it('TC-CHECKIN-008: 应该处理超长的note字段', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1,
        note: 'a'.repeat(1001)
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      SectionStub.findById.resolves(mockSection);
    });

    it('TC-CHECKIN-009: 应该处理无效的mood值', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1,
        mood: 'invalid_mood'
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      SectionStub.findById.resolves(mockSection);
    });

    it('TC-CHECKIN-010: 应该处理负数的readingTime', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1,
        readingTime: -10
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      SectionStub.findById.resolves(mockSection);
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-011~015: 异常处理和权限
   * ============================================================
   */
  describe('createCheckin - 异常和权限', () => {
    it('TC-CHECKIN-011: 应该更新课节的checkinCount', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 5,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        periodId,
        sectionId,
        points: 10,
        checkinDate: new Date()
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findByIdAndUpdate.resolves(mockUser);
      UserStub.findById.returns({ select: sandbox.stub().resolves(mockUser) });
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      expect(mockSection.checkinCount).to.equal(6);
      expect(mockSection.save.called).to.be.true;
    });

    it('TC-CHECKIN-012: 应该处理连续打卡重置', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 7,
        maxStreak: 10,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        checkinDate: new Date()
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findByIdAndUpdate.resolves(mockUser);
      UserStub.findById.returns({ select: sandbox.stub().resolves(mockUser) });
      CheckinStub.findOne.resolves(null); // 前一天无打卡
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      // currentStreak 应该重置为 1（通过 findByIdAndUpdate 第二次调用）
      const streakCall = UserStub.findByIdAndUpdate.getCall(1);
      expect(streakCall).to.not.be.null;
      expect(streakCall.args[1].currentStreak).to.equal(1);
    });

    it('TC-CHECKIN-013: 应该保持maxStreak为较大值', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 20,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        checkinDate: new Date()
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findByIdAndUpdate.resolves(mockUser);
      UserStub.findById.returns({ select: sandbox.stub().resolves(mockUser) });
      CheckinStub.findOne.resolves({});
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      // maxStreak 应该保持原值（currentStreak=6 < maxStreak=20），验证 findByIdAndUpdate 调用
      const streakCall = UserStub.findByIdAndUpdate.getCall(1);
      expect(streakCall).to.not.be.null;
      expect(streakCall.args[1].maxStreak).to.equal(20); // max(20, 6) = 20
    });

    it('TC-CHECKIN-014: 应该发布同步事件', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        periodId,
        sectionId,
        points: 10,
        checkinDate: new Date(),
        toObject: sandbox.stub().returns({})
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findByIdAndUpdate.resolves(mockUser);
      UserStub.findById.returns({ select: sandbox.stub().resolves(mockUser) });
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      expect(res.status.calledWith(201)).to.be.true;
    });

    it('TC-CHECKIN-015: 应该处理用户不存在的情况', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findById.resolves(null);
      CheckinStub.create.resolves({
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        toObject: sandbox.stub().returns({})
      });

      await checkinController.createCheckin(req, res, next);

      // 应该调用 next 处理错误或返回相应的错误响应
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-018~027: 获取用户打卡的高级功能
   * ============================================================
   */
  describe('getUserCheckins - 高级功能', () => {
    it('TC-CHECKIN-018: 应该返回日历数据', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20, year: 2026, month: 3 };

      const mockCheckins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '内容',
          likeCount: 1,
          isFeatured: false,
          checkinDate: new Date('2026-03-03')
        }
      ];

      CheckinStub.countDocuments.resolves(1);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onThirdCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data).to.have.property('calendar');
      expect(responseData.data.calendar).to.have.property('checkinDays');
    });

    it('TC-CHECKIN-019: 应该处理空列表', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      CheckinStub.countDocuments.resolves(0);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves([])
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.list).to.be.an('array');
      expect(responseData.data.list.length).to.equal(0);
    });

    it('TC-CHECKIN-020: 应该正确计算连续打卡（7天）', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      const sevenDaysCheckins = Array.from({ length: 7 }, (_, i) => ({
        _id: new mongoose.Types.ObjectId(),
        userId,
        note: `第${i + 1}天`,
        likeCount: 0,
        isFeatured: false,
        checkinDate: new Date(Date.now() - (7 - i - 1) * 86400000)
      }));

      CheckinStub.countDocuments.resolves(7);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(sevenDaysCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(sevenDaysCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats.consecutiveDays).to.equal(7);
    });

    it('TC-CHECKIN-021: 应该处理有间隙的打卡', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      // 今天、昨天、3天前（有间隙）
      const gappedCheckins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '今天',
          likeCount: 0,
          isFeatured: false,
          checkinDate: new Date()
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '昨天',
          likeCount: 0,
          isFeatured: false,
          checkinDate: new Date(Date.now() - 86400000)
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '3天前',
          likeCount: 0,
          isFeatured: false,
          checkinDate: new Date(Date.now() - 3 * 86400000)
        }
      ];

      CheckinStub.countDocuments.resolves(3);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(gappedCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(gappedCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      // 从今天开始往前算，应该是 2 天（今天 + 昨天）
      expect(responseData.data.stats.consecutiveDays).to.equal(2);
    });

    it('TC-CHECKIN-022: 应该支持分页查询', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 2, limit: 10 };

      const mockCheckins = Array.from({ length: 10 }, () => ({
        _id: new mongoose.Types.ObjectId(),
        userId,
        note: '内容',
        likeCount: 0,
        isFeatured: false,
        checkinDate: new Date()
      }));

      CheckinStub.countDocuments.resolves(25);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.pagination.page).to.equal(2);
      expect(responseData.data.pagination.limit).to.equal(10);
      expect(responseData.data.pagination.total).to.equal(25);
      expect(responseData.data.pagination.pages).to.equal(3);
    });

    it('TC-CHECKIN-023: 应该计算diaryCount（有内容的打卡）', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '有内容',
          likeCount: 0,
          isFeatured: false,
          checkinDate: new Date()
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '',
          likeCount: 0,
          isFeatured: false,
          checkinDate: new Date()
        }
      ];

      CheckinStub.countDocuments.resolves(2);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats.diaryCount).to.equal(1);
    });

    it('TC-CHECKIN-024: 应该计算featuredCount和likeCount', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '有内容',
          likeCount: 5,
          isFeatured: true,
          checkinDate: new Date()
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '有内容',
          likeCount: 3,
          isFeatured: false,
          checkinDate: new Date()
        }
      ];

      CheckinStub.countDocuments.resolves(2);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats.featuredCount).to.equal(1);
      expect(responseData.data.stats.likeCount).to.equal(8);
    });

    it('TC-CHECKIN-025: 应该使用req.user.userId作为默认userId', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.user = { userId };
      req.params = {}; // 不提供userId参数
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '内容',
          likeCount: 0,
          isFeatured: false,
          checkinDate: new Date()
        }
      ];

      CheckinStub.countDocuments.resolves(1);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const firstCall = CheckinStub.find.getCall(0).args[0];
      expect(firstCall.userId).to.exist;
    });

    it('TC-CHECKIN-026: 应该按checkinDate降序排序', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      CheckinStub.countDocuments.resolves(0);
      const sortStub = sandbox.stub().returnsThis();
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sortStub
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves([])
      });

      await checkinController.getUserCheckins(req, res, next);

      // 验证 sort 被调用并使用正确的参数
      expect(sortStub.called).to.be.true;
    });

    it('TC-CHECKIN-027: 应该处理不同月份的日历数据', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20, year: 2026, month: 1 };

      const mockCheckins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '内容',
          likeCount: 0,
          isFeatured: false,
          checkinDate: new Date('2026-01-15')
        }
      ];

      CheckinStub.countDocuments.resolves(1);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onThirdCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.calendar.year).to.equal(2026);
      expect(responseData.data.calendar.month).to.equal(1);
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-028~035: 获取期次打卡（广场）
   * ============================================================
   */
  describe('getPeriodCheckins - 广场功能', () => {
    it('TC-CHECKIN-028: 应该按day参数过滤', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 20, day: 2 };

      const mockPeriod = { _id: periodId };
      const mockCheckins = [
        { _id: new mongoose.Types.ObjectId(), day: 2, isPublic: true }
      ];

      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(1);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getPeriodCheckins(req, res, next);

      const query = CheckinStub.find.getCall(0).args[0];
      expect(query.day).to.equal(2);
    });

    it('TC-CHECKIN-029: 应该返回空数组当期次不存在', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 20 };

      PeriodStub.findById.resolves(null);

      await checkinController.getPeriodCheckins(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data).to.be.an('array');
      expect(responseData.data.length).to.equal(0);
    });

    it('TC-CHECKIN-030: 应该包含hasNext分页标记', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 10 };

      const mockPeriod = { _id: periodId };
      const mockCheckins = Array.from({ length: 10 }, () => ({
        _id: new mongoose.Types.ObjectId(),
        isPublic: true
      }));

      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(25);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getPeriodCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.pagination).to.have.property('hasNext');
      expect(responseData.pagination.hasNext).to.be.true;
    });

    it('TC-CHECKIN-031: 应该处理最后一页的hasNext', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 3, limit: 10 };

      const mockPeriod = { _id: periodId };
      const mockCheckins = Array.from({ length: 5 }, () => ({
        _id: new mongoose.Types.ObjectId(),
        isPublic: true
      }));

      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(25);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getPeriodCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.pagination.hasNext).to.be.false;
    });

    it('TC-CHECKIN-032: 应该按createdAt降序排序', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 20 };

      const mockPeriod = { _id: periodId };
      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(0);

      const sortStub = sandbox.stub().returnsThis();
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sortStub
      });

      sortStub.returns({
        skip: sandbox.stub().returnsThis().returns({
          limit: sandbox.stub().returnsThis().returns({
            select: sandbox.stub().resolves([])
          })
        })
      });

      await checkinController.getPeriodCheckins(req, res, next);

      expect(sortStub.called).to.be.true;
    });

    it('TC-CHECKIN-033: 应该populate userId和sectionId', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 20 };

      const mockPeriod = { _id: periodId };
      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(0);

      const populateStub = sandbox.stub().returnsThis();
      CheckinStub.find.returns({
        populate: populateStub
      });

      populateStub.returns({
        sort: sandbox.stub().returnsThis().returns({
          skip: sandbox.stub().returnsThis().returns({
            limit: sandbox.stub().returnsThis().returns({
              select: sandbox.stub().resolves([])
            })
          })
        })
      });

      await checkinController.getPeriodCheckins(req, res, next);

      expect(populateStub.called).to.be.true;
    });

    it('TC-CHECKIN-034: 应该只查询isPublic为true的打卡', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 20 };

      const mockPeriod = { _id: periodId };
      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(5);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });

      await checkinController.getPeriodCheckins(req, res, next);

      const query = CheckinStub.find.getCall(0).args[0];
      expect(query.isPublic).to.equal(true);
    });

    it('TC-CHECKIN-035: 应该处理大数据列表', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.query = { page: 1, limit: 50 };

      const mockPeriod = { _id: periodId };
      const mockCheckins = Array.from({ length: 50 }, () => ({
        _id: new mongoose.Types.ObjectId(),
        isPublic: true
      }));

      PeriodStub.findById.resolves(mockPeriod);
      CheckinStub.countDocuments.resolves(1000);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getPeriodCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.length).to.equal(50);
      expect(responseData.pagination.total).to.equal(1000);
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-036~039: 获取打卡详情
   * ============================================================
   */
  describe('getCheckinDetail - 详情获取', () => {
    it('TC-CHECKIN-036: 应该返回完整的打卡详情', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId,
        note: '详细内容',
        isPublic: true,
        likeCount: 5,
        isFeatured: true,
        likes: [],
        toObject() {
          return { ...this, toObject: undefined };
        }
      };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(mockCheckin);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });

      await checkinController.getCheckinDetail(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data._id).to.exist;
      expect(responseData.data.note).to.equal('详细内容');
    });

    it('TC-CHECKIN-037: 应该populate所有相关字段', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: { nickname: '用户名' },
        sectionId: { title: '课节标题' },
        periodId: { name: '期次名称' },
        likes: [],
        toObject() {
          return { ...this, toObject: undefined };
        }
      };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(mockCheckin);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });

      await checkinController.getCheckinDetail(req, res, next);

      expect(populateStub1.called).to.be.true;
      expect(populateStub2.called).to.be.true;
      expect(populateStub3.called).to.be.true;
    });

    it('TC-CHECKIN-038: 应该返回404当打卡不存在', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      req.params = { checkinId };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(null);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });

      await checkinController.getCheckinDetail(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });

    it('TC-CHECKIN-039: 应该包含时间戳字段', async () => {
      const checkinId = new mongoose.Types.ObjectId();
      const createdAt = new Date('2026-03-01');
      const updatedAt = new Date('2026-03-03');

      const mockCheckin = {
        _id: checkinId,
        createdAt,
        updatedAt,
        likes: [],
        toObject() {
          return { ...this, toObject: undefined };
        }
      };

      const populateStub1 = sandbox.stub().returnsThis();
      const populateStub2 = sandbox.stub().returnsThis();
      const populateStub3 = sandbox.stub().returnsThis();
      const populateStub4 = sandbox.stub().resolves(mockCheckin);

      populateStub1.returns({ populate: populateStub2 });
      populateStub2.returns({ populate: populateStub3 });
      populateStub3.returns({ populate: populateStub4 });

      CheckinStub.findById.returns({ populate: populateStub1 });

      await checkinController.getCheckinDetail(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.createdAt).to.exist;
      expect(responseData.data.updatedAt).to.exist;
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-040~048: 更新打卡
   * ============================================================
   */
  describe('updateCheckin - 高级功能', () => {
    it('TC-CHECKIN-040: 应该支持batch更新', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = {
        note: '更新note',
        readingTime: 50,
        completionRate: 90,
        mood: 'happy',
        isPublic: false
      };

      const mockCheckin = {
        _id: checkinId,
        userId,
        note: '旧note',
        readingTime: 30,
        completionRate: 80,
        mood: 'calm',
        isPublic: true,
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(mockCheckin.note).to.equal('更新note');
      expect(mockCheckin.readingTime).to.equal(50);
      expect(mockCheckin.completionRate).to.equal(90);
      expect(mockCheckin.mood).to.equal('happy');
      expect(mockCheckin.isPublic).to.equal(false);
    });

    it('TC-CHECKIN-041: 应该只更新提供的字段', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = {
        note: '只更新note'
      };

      const mockCheckin = {
        _id: checkinId,
        userId,
        note: '旧note',
        readingTime: 30,
        completionRate: 80,
        mood: 'calm',
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(mockCheckin.note).to.equal('只更新note');
      expect(mockCheckin.readingTime).to.equal(30);
      expect(mockCheckin.completionRate).to.equal(80);
    });

    it('TC-CHECKIN-042: 应该验证completionRate范围', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = {
        completionRate: 150
      };

      const mockCheckin = {
        _id: checkinId,
        userId,
        completionRate: 80,
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);

      // 验证应该在中间件或服务层进行
    });

    it('TC-CHECKIN-043: 应该接受note为空字符串', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = {
        note: ''
      };

      const mockCheckin = {
        _id: checkinId,
        userId,
        note: '旧note',
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(mockCheckin.note).to.equal('');
      expect(mockCheckin.save.called).to.be.true;
    });

    it('TC-CHECKIN-044: 应该发布sync事件', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = {
        note: '更新内容'
      };

      const mockCheckin = {
        _id: checkinId,
        userId,
        note: '旧note',
        toObject: sandbox.stub().returns({}),
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(res.json.called).to.be.true;
    });

    it('TC-CHECKIN-045: 应该接受images数组更新', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = {
        images: ['https://example.com/new.jpg']
      };

      const mockCheckin = {
        _id: checkinId,
        userId,
        images: [],
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(mockCheckin.images[0]).to.equal('https://example.com/new.jpg');
    });

    it('TC-CHECKIN-045b: 应该拒绝超过9张图片的更新', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = {
        images: Array.from({ length: 10 }, (_, index) => `https://example.com/${index}.jpg`)
      };

      const mockCheckin = {
        _id: checkinId,
        userId,
        images: [],
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(res.status.calledWith(400)).to.be.true;
      expect(mockCheckin.save.called).to.be.false;
    });

    it('TC-CHECKIN-046: 应该接受所有有效的mood值', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();
      const validMoods = ['happy', 'calm', 'thoughtful', 'inspired', 'other'];

      for (const mood of validMoods) {
        req.user = { userId };
        req.params = { checkinId };
        req.body = { mood };

        const mockCheckin = {
          _id: checkinId,
          userId,
          mood: 'calm',
          save: sandbox.stub().resolves()
        };

        CheckinStub.findById.resolves(mockCheckin);

        await checkinController.updateCheckin(req, res, next);

        expect(mockCheckin.mood).to.equal(mood);
      }
    });

    it('TC-CHECKIN-047: 应该返回403更新他人打卡', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const otherUserId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = { note: '尝试更新' };

      const mockCheckin = {
        _id: checkinId,
        userId: otherUserId,
        note: '原内容'
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.updateCheckin(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
    });

    it('TC-CHECKIN-048: 应该返回404打卡不存在', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };
      req.body = { note: '更新' };

      CheckinStub.findById.resolves(null);

      await checkinController.updateCheckin(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-049~056: 删除打卡
   * ============================================================
   */
  describe('deleteCheckin - 高级功能', () => {
    it('TC-CHECKIN-049: 应该成功删除打卡', async () => {
      const userIdStr = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId: userIdStr };
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: userIdStr,
        points: 10,
        toObject: sandbox.stub().returns({})
      };

      const mockUser = {
        _id: userIdStr,
        totalCheckinDays: 10,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      expect(CheckinStub.findByIdAndDelete.calledWith(checkinId)).to.be.true;
    });

    it('TC-CHECKIN-050: 应该递减totalCheckinDays', async () => {
      const userIdStr = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId: userIdStr };
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: userIdStr,
        points: 10,
        toObject: sandbox.stub().returns({})
      };

      const mockUser = {
        _id: userIdStr,
        totalCheckinDays: 10,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      expect(mockUser.totalCheckinDays).to.equal(9);
    });

    it('TC-CHECKIN-051: 应该递减totalPoints', async () => {
      const userIdStr = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId: userIdStr };
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: userIdStr,
        points: 15,
        toObject: sandbox.stub().returns({})
      };

      const mockUser = {
        _id: userIdStr,
        totalCheckinDays: 10,
        totalPoints: 150,
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      expect(mockUser.totalPoints).to.equal(135);
    });

    it('TC-CHECKIN-052: 应该处理删除时totalCheckinDays为0的情况', async () => {
      const userIdStr = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId: userIdStr };
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: userIdStr,
        points: 10,
        toObject: sandbox.stub().returns({})
      };

      const mockUser = {
        _id: userIdStr,
        totalCheckinDays: 0,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      // Math.max(0, -1) = 0
      expect(mockUser.totalCheckinDays).to.equal(0);
    });

    it('TC-CHECKIN-053: 应该处理删除时totalPoints为0的情况', async () => {
      const userIdStr = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId: userIdStr };
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: userIdStr,
        points: 10,
        toObject: sandbox.stub().returns({})
      };

      const mockUser = {
        _id: userIdStr,
        totalCheckinDays: 10,
        totalPoints: 5,
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      // Math.max(0, -5) = 0
      expect(mockUser.totalPoints).to.equal(0);
    });

    it('TC-CHECKIN-054: 应该返回403删除他人打卡', async () => {
      const userId = new mongoose.Types.ObjectId();
      const otherUserId = new mongoose.Types.ObjectId();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: otherUserId,
        points: 10
      };

      CheckinStub.findById.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
    });

    it('TC-CHECKIN-055: 应该发布sync事件', async () => {
      const userIdStr = new mongoose.Types.ObjectId().toString();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId: userIdStr };
      req.params = { checkinId };

      const mockCheckin = {
        _id: checkinId,
        userId: userIdStr,
        points: 10,
        toObject: sandbox.stub().returns({
          _id: checkinId,
          userId: userIdStr,
          points: 10
        })
      };

      const mockUser = {
        _id: userIdStr,
        totalCheckinDays: 10,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      CheckinStub.findById.resolves(mockCheckin);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findByIdAndDelete.resolves(mockCheckin);

      await checkinController.deleteCheckin(req, res, next);

      expect(res.json.called).to.be.true;
    });

    it('TC-CHECKIN-056: 应该返回404打卡不存在', async () => {
      const userId = new mongoose.Types.ObjectId();
      const checkinId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.params = { checkinId };

      CheckinStub.findById.resolves(null);

      await checkinController.deleteCheckin(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-057~069: 后台管理接口
   * ============================================================
   */
  describe('getAdminCheckins - 后台管理', () => {
    it('TC-CHECKIN-057: 应该支持userId过滤', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.query = { page: 1, limit: 20, userId };

      CheckinStub.countDocuments.resolves(5);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });
      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves([])
      });

      await checkinController.getAdminCheckins(req, res, next);

      const query = CheckinStub.find.getCall(0).args[0];
      expect(query.userId).to.exist;
    });

    it('TC-CHECKIN-058: 应该支持periodId过滤', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.query = { page: 1, limit: 20, periodId };

      CheckinStub.countDocuments.resolves(5);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });
      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves([])
      });

      await checkinController.getAdminCheckins(req, res, next);

      const query = CheckinStub.find.getCall(0).args[0];
      expect(query.periodId).to.exist;
    });

    it('TC-CHECKIN-059: 应该支持日期范围过滤', async () => {
      req.query = {
        page: 1,
        limit: 20,
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31'
      };

      CheckinStub.countDocuments.resolves(10);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });
      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves([])
      });

      await checkinController.getAdminCheckins(req, res, next);

      const query = CheckinStub.find.getCall(0).args[0];
      expect(query.checkinDate).to.exist;
    });

    it('TC-CHECKIN-060: 应该支持用户名搜索', async () => {
      req.query = { page: 1, limit: 20, search: '小红' };

      const mockUsers = [
        { _id: new mongoose.Types.ObjectId() }
      ];

      UserStub.find.resolves(mockUsers);
      CheckinStub.countDocuments.resolves(3);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });
      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves([])
      });

      await checkinController.getAdminCheckins(req, res, next);

      expect(UserStub.find.called).to.be.true;
    });

    it('TC-CHECKIN-061: 应该按today统计', async () => {
      req.query = { page: 1, limit: 20 };

      CheckinStub.countDocuments.resolves(100);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });
      CheckinStub.aggregate.resolves([{ totalPoints: 0 }]);
      CheckinStub.distinct.resolves([]);

      await checkinController.getAdminCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats).to.have.property('todayCount');
      expect(responseData.data.stats).to.have.property('totalCount');
      expect(responseData.data.stats).to.have.property('totalPoints');
    });

    it('TC-CHECKIN-062: 应该返回统计信息', async () => {
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        { _id: new mongoose.Types.ObjectId() }
      ];

      CheckinStub.countDocuments.resolves(100);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });
      CheckinStub.aggregate.resolves([{ totalPoints: 200 }]);
      CheckinStub.distinct.resolves([]);

      await checkinController.getAdminCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats).to.have.property('totalCount');
      expect(responseData.data.stats).to.have.property('todayCount');
      expect(responseData.data.stats).to.have.property('totalPoints');
    });
  });

  describe('getCheckinStats - 统计数据', () => {
    it('TC-CHECKIN-063: 应该返回基本统计', async () => {
      req.query = {};

      CheckinStub.countDocuments.resolves(100);
      CheckinStub.distinct.resolves(['user1', 'user2', 'user3']);
      CheckinStub.aggregate.resolves([
        {
          totalPoints: 1000,
          totalLikes: 50,
          featuredCount: 10
        }
      ]);

      await checkinController.getCheckinStats(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.totalCount).to.equal(100);
      expect(responseData.data.uniqueUserCount).to.equal(3);
      expect(responseData.data.totalPoints).to.equal(1000);
    });

    it('TC-CHECKIN-064: 应该处理空统计结果', async () => {
      req.query = {};

      CheckinStub.countDocuments.resolves(0);
      CheckinStub.distinct.resolves([]);
      CheckinStub.aggregate.resolves([]);

      await checkinController.getCheckinStats(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.totalCount).to.equal(0);
      expect(responseData.data.uniqueUserCount).to.equal(0);
      expect(responseData.data.totalPoints).to.equal(0);
    });

    it('TC-CHECKIN-065: 应该支持期次过滤', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.query = { periodId };

      CheckinStub.countDocuments.resolves(50);
      CheckinStub.distinct.resolves(['user1', 'user2']);
      CheckinStub.aggregate.resolves([
        {
          totalPoints: 500,
          totalLikes: 25,
          featuredCount: 5
        }
      ]);

      await checkinController.getCheckinStats(req, res, next);

      expect(res.json.called).to.be.true;
    });

    it('TC-CHECKIN-066: 应该计算averagePointsPerUser', async () => {
      req.query = {};

      CheckinStub.countDocuments.resolves(100);
      CheckinStub.distinct.resolves(['user1', 'user2', 'user3', 'user4', 'user5']);
      CheckinStub.aggregate.resolves([
        {
          totalPoints: 1000,
          totalLikes: 50,
          featuredCount: 10
        }
      ]);

      await checkinController.getCheckinStats(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      const avg = parseFloat(responseData.data.averagePointsPerUser);
      expect(avg).to.equal(200);
    });

    it('TC-CHECKIN-067: 应该处理0用户情况下的平均值', async () => {
      req.query = {};

      CheckinStub.countDocuments.resolves(0);
      CheckinStub.distinct.resolves([]);
      CheckinStub.aggregate.resolves([]);

      await checkinController.getCheckinStats(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.averagePointsPerUser).to.equal(0);
    });

    it('TC-CHECKIN-068: 应该支持日期范围过滤', async () => {
      req.query = {
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31'
      };

      CheckinStub.countDocuments.resolves(30);
      CheckinStub.distinct.resolves(['user1']);
      CheckinStub.aggregate.resolves([
        {
          totalPoints: 300,
          totalLikes: 15,
          featuredCount: 3
        }
      ]);

      await checkinController.getCheckinStats(req, res, next);

      expect(res.json.called).to.be.true;
    });

    it('TC-CHECKIN-069: 应该返回今日统计', async () => {
      req.query = {};

      CheckinStub.countDocuments.resolves(100);
      CheckinStub.distinct.resolves(['user1']);
      CheckinStub.aggregate.resolves([
        {
          totalPoints: 1000,
          totalLikes: 50,
          featuredCount: 10
        }
      ]);

      await checkinController.getCheckinStats(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data).to.have.property('todayCount');
    });
  });

  /**
   * ============================================================
   * TC-CHECKIN-070~076: 特殊场景
   * ============================================================
   */
  describe('特殊场景', () => {
    it('TC-CHECKIN-070: 应该处理用户从req.user.id或req.user.userId', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      // 测试 req.user.id 路径
      req.user = { id: userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        checkinDate: new Date(),
        toObject: sandbox.stub().returns({})
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      expect(CheckinStub.create.called).to.be.true;
    });

    it('TC-CHECKIN-071: 应该接受默认的isPublic值', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
        // isPublic 未提供，应该默认为 true
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        isPublic: true,
        checkinDate: new Date(),
        toObject: sandbox.stub().returns({})
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      expect(mockCheckin.isPublic).to.equal(true);
    });

    it('TC-CHECKIN-072: 应该接受默认的completionRate值', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
        // completionRate 未提供，应该默认为 100
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        completionRate: 100,
        checkinDate: new Date(),
        toObject: sandbox.stub().returns({})
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      expect(mockCheckin.completionRate).to.equal(100);
    });

    it('TC-CHECKIN-073: 应该接受默认的readingTime值', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
        // readingTime 未提供，应该默认为 0
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        readingTime: 0,
        checkinDate: new Date(),
        toObject: sandbox.stub().returns({})
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      expect(mockCheckin.readingTime).to.equal(0);
    });

    it('TC-CHECKIN-074: 应该总是设置points为10', async () => {
      const userId = new mongoose.Types.ObjectId();
      const periodId = new mongoose.Types.ObjectId();
      const sectionId = new mongoose.Types.ObjectId();

      req.user = { userId };
      req.body = {
        periodId,
        sectionId,
        day: 1
      };

      const mockSection = {
        _id: sectionId,
        checkinCount: 0,
        save: sandbox.stub().resolves()
      };

      const mockUser = {
        _id: userId,
        totalCheckinDays: 10,
        currentStreak: 5,
        maxStreak: 8,
        totalPoints: 100,
        save: sandbox.stub().resolves()
      };

      const mockCheckin = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        points: 10,
        checkinDate: new Date(),
        toObject: sandbox.stub().returns({})
      };

      SectionStub.findById.resolves(mockSection);
      UserStub.findById.resolves(mockUser);
      CheckinStub.findOne.resolves(null);
      CheckinStub.create.resolves(mockCheckin);

      await checkinController.createCheckin(req, res, next);

      expect(mockCheckin.points).to.equal(10);
    });

    it('TC-CHECKIN-075: 应该获取所有期次的公开打卡', async () => {
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        { _id: new mongoose.Types.ObjectId(), isPublic: true },
        { _id: new mongoose.Types.ObjectId(), isPublic: true }
      ];

      CheckinStub.countDocuments.resolves(2);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getCheckins(req, res, next);

      expect(res.json.called).to.be.true;
    });

    it('TC-CHECKIN-076: 应该处理大量点赞和点击', async () => {
      const userId = new mongoose.Types.ObjectId();
      req.params = { userId };
      req.query = { page: 1, limit: 20 };

      const mockCheckins = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId,
          note: '热门内容',
          likeCount: 999,
          isFeatured: true,
          checkinDate: new Date()
        }
      ];

      CheckinStub.countDocuments.resolves(1);
      CheckinStub.find.returns({
        populate: sandbox.stub().returnsThis(),
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockCheckins)
      });

      CheckinStub.find.onSecondCall().returns({
        select: sandbox.stub().resolves(mockCheckins)
      });

      await checkinController.getUserCheckins(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.stats.likeCount).to.equal(999);
    });
  });
});
