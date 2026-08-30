/**
 * Period Controller 单元测试
 */

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const mongoose = require('mongoose');

describe('Period Controller', () => {
  let periodController;
  let sandbox;
  let req;
  let res;
  let next;
  let PeriodStub;
  let CheckinStub;
  let UserStub;
  let EnrollmentStub;
  let SectionStub;
  let publishSyncEventStub;

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
      json: sandbox.stub().returnsThis()
    };

    next = sandbox.stub();

    PeriodStub = {
      findById: sandbox.stub(),
      find: sandbox.stub(),
      countDocuments: sandbox.stub(),
      findByIdAndUpdate: sandbox.stub(),
      create: sandbox.stub(),
      findByIdAndDelete: sandbox.stub()
    };

    CheckinStub = {
      aggregate: sandbox.stub()
    };

    UserStub = {
      find: sandbox.stub()
    };

    EnrollmentStub = {
      countDocuments: sandbox.stub(),
      distinct: sandbox.stub().resolves([])
    };

    SectionStub = {
      find: sandbox.stub(),
      insertMany: sandbox.stub()
    };

    publishSyncEventStub = sandbox.stub();

    const responseUtils = {
      success: (data, message) => ({ code: 200, message, data }),
      errors: {
        badRequest: (msg) => ({ code: 400, message: msg }),
        notFound: (msg) => ({ code: 404, message: msg }),
        forbidden: (msg) => ({ code: 403, message: msg })
      }
    };

    periodController = proxyquire(
      '../../../src/controllers/period.controller',
      {
        '../models/Period': PeriodStub,
        '../models/Checkin': CheckinStub,
        '../models/User': UserStub,
        '../models/Enrollment': EnrollmentStub,
        '../models/Section': SectionStub,
        '../utils/response': responseUtils,
        '../services/sync.service': {
          publishSyncEvent: publishSyncEventStub
        }
      }
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getPeriodList', () => {
    it('应该返回所有期次列表', async () => {
      req.query = { page: 1, limit: 10 };

      const mockPeriods = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: '期次1',
          status: 'ongoing',
          toObject: sandbox.stub().returnsThis()
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: '期次2',
          status: 'completed',
          toObject: sandbox.stub().returnsThis()
        }
      ];

      PeriodStub.countDocuments.resolves(2);
      PeriodStub.find.returns({
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        populate: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockPeriods)
      });

      await periodController.getPeriodList(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data).to.be.an('array');
    });

    it('应该按status过滤，支持active映射到ongoing', async () => {
      req.query = { page: 1, limit: 10, status: 'active' };

      PeriodStub.countDocuments.resolves(1);
      PeriodStub.find.returns({
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        populate: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });

      await periodController.getPeriodList(req, res, next);

      const query = PeriodStub.find.getCall(0).args[0];
      expect(query).to.have.property('status');
      expect(query.status).to.equal('ongoing');
    });

    it('应该返回正确的分页信息', async () => {
      req.query = { page: 2, limit: 10 };

      PeriodStub.countDocuments.resolves(25);
      PeriodStub.find.returns({
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        populate: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([])
      });

      await periodController.getPeriodList(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.pagination.page).to.equal(2);
      expect(responseData.pagination.total).to.equal(25);
    });
  });

  describe('getPeriodListForUser', () => {
    it('应该根据日期返回动态状态，而不是数据库中的旧状态', async () => {
      sandbox.useFakeTimers(new Date('2026-05-10T08:00:00.000Z'));

      const periodId = new mongoose.Types.ObjectId();
      req.user = {
        userId: new mongoose.Types.ObjectId(),
        role: 'admin'
      };
      req.query = { page: 1, limit: 20 };

      const mockPeriod = {
        _id: periodId,
        name: '秩序之锚',
        title: '秩序之锚 - 七个习惯晨读营',
        status: 'not_started',
        startDate: new Date('2026-05-08T16:00:00.000Z'),
        endDate: new Date('2026-05-30T16:00:00.000Z'),
        coverColor: '#4a90e2',
        toObject: sandbox.stub().returns({
          _id: periodId,
          name: '秩序之锚',
          title: '秩序之锚 - 七个习惯晨读营',
          status: 'not_started',
          startDate: new Date('2026-05-08T16:00:00.000Z'),
          endDate: new Date('2026-05-30T16:00:00.000Z')
        })
      };

      PeriodStub.countDocuments.resolves(1);
      PeriodStub.find.returns({
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        populate: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves([mockPeriod])
      });
      CheckinStub.aggregate.resolves([]);

      await periodController.getPeriodListForUser(req, res, next);

      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data[0].status).to.equal('ongoing');
      expect(responseData.data[0].statusText).to.equal('进行中');
    });

    it('应该通过一次聚合合并用户打卡统计', async () => {
      const periodId1 = new mongoose.Types.ObjectId();
      const periodId2 = new mongoose.Types.ObjectId();
      req.user = {
        userId: new mongoose.Types.ObjectId(),
        role: 'user'
      };
      req.query = { page: 1, limit: 20 };

      const mockPeriods = [
        {
          _id: periodId1,
          name: '期次1',
          title: '期次1',
          status: 'ongoing',
          coverColor: '#4a90e2',
          toObject: sandbox.stub().returns({
            _id: periodId1,
            name: '期次1',
            title: '期次1',
            status: 'ongoing'
          })
        },
        {
          _id: periodId2,
          name: '期次2',
          title: '期次2',
          status: 'completed',
          coverColor: '#357abd',
          toObject: sandbox.stub().returns({
            _id: periodId2,
            name: '期次2',
            title: '期次2',
            status: 'completed'
          })
        }
      ];

      PeriodStub.countDocuments.resolves(2);
      PeriodStub.find.returns({
        sort: sandbox.stub().returnsThis(),
        skip: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        populate: sandbox.stub().returnsThis(),
        select: sandbox.stub().resolves(mockPeriods)
      });
      CheckinStub.aggregate.resolves([
        { _id: periodId1, checkedDays: 3 },
        { _id: periodId2, checkedDays: 1 }
      ]);

      await periodController.getPeriodListForUser(req, res, next);

      expect(CheckinStub.aggregate.calledOnce).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data[0].checkedDays).to.equal(3);
      expect(responseData.data[1].checkedDays).to.equal(1);
    });
  });

  describe('getPeriodDetail', () => {
    it('应该返回期次详情', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };

      const mockPeriod = {
        _id: periodId,
        name: '2025年第一期',
        status: 'ongoing',
        enrollmentCount: 50,
        maxEnrollment: 100
      };

      PeriodStub.findById.resolves(mockPeriod);

      await periodController.getPeriodDetail(req, res, next);

      expect(res.json.called).to.be.true;
      const responseData = res.json.getCall(0).args[0];
      expect(responseData.data.name).to.equal('2025年第一期');
    });

    it('应该返回404当期次不存在', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };

      PeriodStub.findById.resolves(null);

      await periodController.getPeriodDetail(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });
  });

  describe('createPeriod (Admin)', () => {
    it('应该创建新期次', async () => {
      req.body = {
        name: '新期次',
        title: '新期次标题',
        description: '新期次描述',
        capacity: 100,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000)
      };

      const mockPeriod = {
        _id: new mongoose.Types.ObjectId(),
        ...req.body,
        status: 'not_started',
        enrolledCount: 0,
        toObject: sandbox.stub().returnsThis()
      };

      PeriodStub.create.resolves(mockPeriod);

      await periodController.createPeriod(req, res, next);

      expect(PeriodStub.create.called).to.be.true;
      expect(res.status.calledWith(201)).to.be.true;
      expect(res.json.called).to.be.true;
    });
  });

  describe('updatePeriod (Admin)', () => {
    it('应该更新期次信息', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.body = { name: '更新的名称', status: 'ongoing' };

      const mockPeriod = {
        _id: periodId,
        name: '原名称',
        status: 'not_started',
        visibleUserIds: [],
        markModified: sandbox.stub(),
        save: sandbox.stub().resolves(),
        toObject: sandbox.stub().returnsThis()
      };

      PeriodStub.findById.resolves(mockPeriod);

      await periodController.updatePeriod(req, res, next);

      expect(PeriodStub.findById.called).to.be.true;
      expect(mockPeriod.save.called).to.be.true;
      expect(res.json.called).to.be.true;
    });

    it('应该返回404当期次不存在', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };
      req.body = { name: '新名称' };

      PeriodStub.findById.resolves(null);

      await periodController.updatePeriod(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });
  });

  describe('deletePeriod (Admin)', () => {
    it('应该删除空的期次', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };

      const mockPeriod = {
        _id: periodId,
        name: '期次',
        enrollmentCount: 0,
        toObject: sandbox.stub().returns({ _id: periodId, name: '期次', enrollmentCount: 0 })
      };

      PeriodStub.findById.resolves(mockPeriod);
      PeriodStub.findByIdAndDelete.resolves(mockPeriod);

      await periodController.deletePeriod(req, res, next);

      expect(res.json.called).to.be.true;
      expect(PeriodStub.findByIdAndDelete.called).to.be.true;
    });

    it('应该返回400当期次有报名', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };

      const mockPeriod = { _id: periodId, name: '期次', enrollmentCount: 5 };

      PeriodStub.findById.resolves(mockPeriod);

      await periodController.deletePeriod(req, res, next);

      expect(res.status.calledWith(400)).to.be.true;
      const errorMsg = res.json.getCall(0).args[0].message;
      expect(errorMsg).to.include('已有用户报名');
    });

    it('应该返回404当期次不存在', async () => {
      const periodId = new mongoose.Types.ObjectId();
      req.params = { periodId };

      PeriodStub.findById.resolves(null);

      await periodController.deletePeriod(req, res, next);

      expect(res.status.calledWith(404)).to.be.true;
    });
  });

  describe('copyPeriod (Admin)', () => {
    it('复制期次时不应复制结营视频和凡人播客内容', async () => {
      const sourcePeriodId = new mongoose.Types.ObjectId();
      const newPeriodId = new mongoose.Types.ObjectId();
      const tenantId = new mongoose.Types.ObjectId();
      const sourceSectionId = new mongoose.Types.ObjectId();
      const sourceSection = {
        _id: sourceSectionId,
        periodId: sourcePeriodId,
        day: 23,
        title: '结营词',
        closingVideo: {
          url: '/uploads/closing-video.mp4',
          coverUrl: '/uploads/closing-video.jpg'
        },
        podcastUrl: '/uploads/podcast.mp3',
        podcastDescription: '凡人播客介绍',
        podcastDuration: 180,
        audioUrl: '/uploads/legacy-audio.mp3',
        videoCover: '/uploads/legacy-video-cover.jpg',
        checkinCount: 8,
        toObject: sandbox.stub()
      };
      sourceSection.toObject.returns({
        _id: sourceSection._id,
        periodId: sourceSection.periodId,
        day: sourceSection.day,
        title: sourceSection.title,
        closingVideo: sourceSection.closingVideo,
        podcastUrl: sourceSection.podcastUrl,
        podcastDescription: sourceSection.podcastDescription,
        podcastDuration: sourceSection.podcastDuration,
        audioUrl: sourceSection.audioUrl,
        videoCover: sourceSection.videoCover,
        checkinCount: sourceSection.checkinCount
      });

      req.params = { id: sourcePeriodId };
      req.body = {
        name: '新期次',
        title: '新期次标题',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2026-09-23T00:00:00.000Z'),
        totalDays: 23,
        price: 9900,
        originalPrice: 0,
        sortOrder: 0
      };

      const sourcePeriod = {
        _id: sourcePeriodId,
        tenantId,
        toObject: sandbox.stub().returns({ _id: sourcePeriodId, tenantId })
      };
      const newPeriod = {
        _id: newPeriodId,
        toObject: sandbox.stub().returns({ _id: newPeriodId })
      };

      PeriodStub.findById.resolves(sourcePeriod);
      PeriodStub.create.resolves(newPeriod);
      SectionStub.find.resolves([sourceSection]);
      SectionStub.insertMany.resolves([]);

      await periodController.copyPeriod(req, res, next);

      expect(next.called).to.be.false;
      expect(SectionStub.insertMany.calledOnce).to.be.true;
      const [copiedSections] = SectionStub.insertMany.firstCall.args;
      expect(copiedSections).to.have.lengthOf(1);
      expect(copiedSections[0]).not.to.have.property('closingVideo');
      expect(copiedSections[0]).not.to.have.property('podcastUrl');
      expect(copiedSections[0]).not.to.have.property('podcastDescription');
      expect(copiedSections[0]).not.to.have.property('podcastDuration');
      expect(copiedSections[0]).not.to.have.property('audioUrl');
      expect(copiedSections[0].videoCover).to.equal(sourceSection.videoCover);
      expect(copiedSections[0].periodId).to.equal(newPeriodId);
      expect(copiedSections[0].checkinCount).to.equal(0);
    });
  });

});
