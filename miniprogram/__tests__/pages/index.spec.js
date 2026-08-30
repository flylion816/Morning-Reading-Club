jest.mock('../../services/user.service.js', () => ({
  getUserProfile: jest.fn(),
  getUserStats: jest.fn()
}));

jest.mock('../../services/auth.service.js', () => ({
  logout: jest.fn()
}));

jest.mock('../../services/course.service.js', () => ({
  getPeriods: jest.fn(),
  getTodayTask: jest.fn(),
  getSectionDetail: jest.fn(),
  getPeriodSections: jest.fn()
}));

jest.mock('../../services/enrollment.service.js', () => ({
  getUserEnrollments: jest.fn()
}));

jest.mock('../../services/checkin.service.js', () => ({
  getUserCheckinsWithStats: jest.fn(),
  getCheckinDetail: jest.fn()
}));

jest.mock('../../services/insight.service.js', () => ({
  getInsightsList: jest.fn(),
  getSentRequests: jest.fn(),
  getUserInsightsList: jest.fn(),
  getReceivedRequests: jest.fn(),
  approveRequest: jest.fn(),
  rejectRequest: jest.fn()
}));

jest.mock('../../services/notification.service.js', () => ({
  getUnreadCount: jest.fn(() => Promise.resolve({ unreadCount: 0 }))
}));

jest.mock('../../services/activity.service.js', () => ({
  track: jest.fn(() => Promise.resolve())
}));

jest.mock('../../utils/subscribe-auto-topup', () => ({
  maybeAutoTopUpNextDayStudyReminder: jest.fn(() => Promise.resolve())
}));

jest.mock('../../services/communityActivity.service', () => ({
  getPopup: jest.fn(),
  getList: jest.fn()
}));

jest.mock('../../services/imprint.service.js', () => ({
  list: jest.fn()
}));

jest.mock('../../services/completion-report.service', () => ({
  getMyReports: jest.fn()
}));

jest.mock('../../config/constants.js', () => ({
  STORAGE_KEYS: {
    TOKEN: 'token',
    USER_INFO: 'userInfo'
  }
}));

jest.mock('../../utils/formatters.js', () => ({
  formatNumber: jest.fn(value => value),
  formatDate: jest.fn(value => value),
  getAvatarColorByUserId: jest.fn(() => '#4a90e2'),
  getInsightTypeConfig: jest.fn(() => ({
    color: '#4a90e2',
    bgColor: '#eef4ff'
  }))
}));

jest.mock('../../utils/markdown.js', () => ({
  richContentToPlainText: jest.fn(content =>
    String(content || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}));

jest.mock('../../utils/period-access.js', () => ({
  getPeriodAccess: jest.fn(() =>
    Promise.resolve({
      canAccessCommunity: true,
      communityAccessState: 'enabled',
      paymentStatus: 'paid'
    })
  ),
  hasPaidEnrollment: jest.fn((enrollmentList = []) =>
    enrollmentList.some(item =>
      ['active', 'completed'].includes(item.status) &&
      ['paid', 'free'].includes(item.paymentStatus)
    )
  )
}));

jest.mock('../../utils/reading-completion.js', () => ({
  decorateSectionWithReadingCompletion: jest.fn(section => section)
}));

let pageConfig;
let pageInstance;
let checkinService;
let userService;
let courseService;
let enrollmentService;
let periodAccess;
let insightService;
let activityService;
let communityActivityService;
  let completionReportService;
  let imprintService;
  let subscribeAutoTopUp;
let notificationService;

describe('index page', () => {
  beforeEach(() => {
    jest.resetModules();
    pageConfig = null;

    global.Page = jest.fn(config => {
      pageConfig = config;
      return config;
    });

    global.getApp = jest.fn(() => ({
      globalData: {
        userInfo: {
          _id: 'user_123',
          nickname: '小狐狸'
        }
      }
    }));

    wx.navigateTo.mockClear();
    wx.showToast.mockClear();
    wx.showLoading.mockClear();
    wx.hideLoading.mockClear();
    wx.navigateToMiniProgram = jest.fn();
    wx.showTabBar = jest.fn();

    checkinService = require('../../services/checkin.service.js');
    userService = require('../../services/user.service.js');
    courseService = require('../../services/course.service.js');
    enrollmentService = require('../../services/enrollment.service.js');
    periodAccess = require('../../utils/period-access.js');
    insightService = require('../../services/insight.service.js');
    activityService = require('../../services/activity.service.js');
    notificationService = require('../../services/notification.service.js');
    communityActivityService = require('../../services/communityActivity.service');
    completionReportService = require('../../services/completion-report.service');
    imprintService = require('../../services/imprint.service.js');
    subscribeAutoTopUp = require('../../utils/subscribe-auto-topup');
    require('../../pages/index/index.js');

    pageInstance = {
      ...pageConfig,
      data: JSON.parse(JSON.stringify(pageConfig.data)),
      setData(update, callback) {
        this.data = {
          ...this.data,
          ...update
        };
        if (typeof callback === 'function') {
          callback();
        }
      }
    };
    pageInstance.data.currentPeriodCommunityState = 'enabled';
    pageInstance.data.canUsePaidFeatures = true;

    checkinService.getUserCheckinsWithStats.mockReset();
    checkinService.getCheckinDetail.mockReset();
    userService.getUserProfile.mockReset();
    userService.getUserStats.mockReset();
    courseService.getPeriods.mockReset();
    courseService.getTodayTask.mockReset();
    courseService.getSectionDetail.mockReset();
    courseService.getPeriodSections.mockReset();
    enrollmentService.getUserEnrollments.mockReset();
    periodAccess.getPeriodAccess.mockReset();
    periodAccess.hasPaidEnrollment.mockClear();
    insightService.getInsightsList.mockReset();
    insightService.getSentRequests.mockReset();
    insightService.getUserInsightsList.mockReset();
    insightService.getReceivedRequests.mockReset();
    activityService.track.mockClear();
    notificationService.getUnreadCount.mockReset();
    notificationService.getUnreadCount.mockResolvedValue({ unreadCount: 0 });
    communityActivityService.getPopup.mockReset();
    communityActivityService.getList.mockReset();
    completionReportService.getMyReports.mockReset();
    completionReportService.getMyReports.mockResolvedValue({ list: [] });
    imprintService.list.mockReset();
    imprintService.list.mockResolvedValue({ list: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.Page;
    delete global.getApp;
  });

  test('should load the latest three recent checkins for home cards', async () => {
    checkinService.getUserCheckinsWithStats.mockResolvedValue({
      list: [
        {
          _id: 'checkin_1',
          createdAt: '2026-03-29T13:11:00.000Z',
          note: '中心是因，人生是果。因缘果报，随缘消旧业，切莫造新殃。',
          likeCount: 2,
          sectionId: {
            _id: 'section_1',
            title: '第一天 品德成功论',
            day: 1
          },
          periodId: {
            _id: 'period_1',
            title: '内在之光',
            coverEmoji: '⛰️',
            coverColor: '#4a90e2'
          }
        },
        {
          _id: 'checkin_2',
          createdAt: '2026-03-28T13:11:00.000Z',
          note: '第二篇打卡',
          likeCount: 1,
          sectionId: {
            _id: 'section_2',
            title: '第二天 思维方式的力量',
            day: 2
          },
          periodId: {
            _id: 'period_1',
            title: '内在之光',
            coverEmoji: '⛰️',
            coverColor: '#4a90e2'
          }
        },
        {
          _id: 'checkin_3',
          createdAt: '2026-03-27T13:11:00.000Z',
          note: '',
          images: ['/uploads/tenants/fanren/checkins/a.jpg', '/uploads/tenants/fanren/checkins/b.jpg'],
          likeCount: 0,
          sectionId: {
            _id: 'section_3',
            title: '第三天 以原则为中心',
            day: 3
          },
          periodId: {
            _id: 'period_2',
            title: '品德之路',
            coverEmoji: '📘',
            coverColor: '#5b8def'
          }
        },
        {
          _id: 'checkin_4',
          createdAt: '2026-03-26T13:11:00.000Z',
          note: '第四篇打卡',
          likeCount: 4,
          sectionId: {
            _id: 'section_4',
            title: '第四天',
            day: 4
          },
          periodId: {
            _id: 'period_3',
            title: '平衡之道'
          }
        }
      ]
    });

    const cards = await pageInstance.loadRecentCheckins.call(pageInstance);

    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({
      id: 'checkin_1',
      sectionId: 'section_1',
      periodTitle: '内在之光',
      sectionTitle: '第一天 品德成功论',
      dayLabel: '第1天',
      preview: '中心是因，人生是果。因缘果报，随缘消旧业...',
      likeCount: 2
    });
    expect(cards[2].id).toBe('checkin_3');
    expect(cards[2].preview).toBe('分享了2张图片');
    expect(cards[2].imageCount).toBe(2);
  });

  test('should show only two upcoming activities on home page', async () => {
    communityActivityService.getList.mockResolvedValue({
      list: [
        { _id: 'activity_1', title: '活动一', type: 'chat', startTime: '2026-05-31T12:00:00.000Z' },
        { _id: 'activity_2', title: '活动二', type: 'cooking', startTime: '2026-05-30T12:00:00.000Z' },
        { _id: 'activity_3', title: '活动三', type: 'witness', startTime: '2026-05-29T12:00:00.000Z' }
      ]
    });

    await pageInstance.loadUpcomingActivities.call(pageInstance);
    await Promise.resolve();

    expect(communityActivityService.getList).toHaveBeenCalledWith({
      limit: 3,
      sort: 'desc'
    });
    expect(pageInstance.data.upcomingActivities).toHaveLength(2);
    expect(pageInstance.data.upcomingActivities.map(item => item._id)).toEqual([
      'activity_1',
      'activity_2'
    ]);
    expect(pageInstance.data.upcomingActivitiesHasMore).toBe(true);
  });

  test('should resolve my recent insight period name from a string period id', async () => {
    pageInstance._periodNameById = new Map([
      ['period_resilience', '韧性之树']
    ]);
    insightService.getInsightsList.mockResolvedValue({
      list: [
        {
          _id: 'insight_1',
          summary: '今天练习了积极主动。',
          sectionId: { _id: 'section_2', day: 2, title: '思维方式的力量' },
          periodId: 'period_resilience'
        }
      ]
    });

    const cards = await pageInstance.loadRecentInsights.call(pageInstance);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: 'insight_1',
      courseDayLabel: '第2天',
      courseTitle: '思维方式的力量',
      periodName: '韧性之树'
    });
  });

  test('should add the period snapshot to other recent insight cards', async () => {
    insightService.getSentRequests.mockResolvedValue({
      list: [
        {
          toUserId: {
            _id: 'user_other',
            nickname: '小树',
            avatarUrl: ''
          }
        }
      ]
    });
    insightService.getUserInsightsList.mockResolvedValue({
      list: [
        {
          _id: 'insight_other_1',
          summary: '看见你持续练习。',
          periodName: '内在之光',
          sectionId: { _id: 'section_3', day: 3, title: '以原则为中心' }
        }
      ]
    });

    await pageInstance.loadRecentOtherInsights.call(pageInstance);

    expect(pageInstance.data.recentOtherInsights).toHaveLength(1);
    expect(pageInstance.data.recentOtherInsights[0]).toMatchObject({
      id: 'insight_other_1',
      courseDayLabel: '第3天',
      courseTitle: '以原则为中心',
      periodName: '内在之光'
    });
  });

  test('should open checkin detail directly when sectionId exists', async () => {
    await pageInstance.handleRecentCheckinTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          checkinId: 'checkin_1',
          sectionId: 'section_1'
        }
      }
    });

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/course-detail/course-detail?id=section_1&checkinId=checkin_1'
    });
    expect(checkinService.getCheckinDetail).not.toHaveBeenCalled();
  });

  test('should load current period report shortcut only when report exists', async () => {
    completionReportService.getMyReports.mockResolvedValue({
      list: [
        {
          periodId: 'period_1',
          hasReport: true,
          reportTitle: '小狐狸分享实录'
        },
        {
          periodId: 'period_2',
          hasReport: false
        }
      ]
    });

    await pageInstance.loadCurrentPeriodReport.call(pageInstance, 'period_1');

    expect(completionReportService.getMyReports).toHaveBeenCalled();
    expect(pageInstance.data.currentPeriodReport).toMatchObject({
      periodId: 'period_1',
      hasReport: true
    });
  });

  test('should navigate to completion report detail from today task shortcut', () => {
    pageInstance.setData({
      currentPeriodReport: {
        periodId: 'period_1',
        hasReport: true
      }
    });

    pageInstance.handleTodayReportBtnTap.call(pageInstance, {
      stopPropagation: jest.fn()
    });

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/completion-report-detail/completion-report-detail?periodId=period_1'
    });
  });

  test('should navigate from ended-period task empty actions', () => {
    pageInstance.setData({
      currentPeriod: {
        _id: 'period_resilience'
      },
      todayTaskEmptyState: {
        type: 'period-ended',
        periodId: 'period_resilience'
      }
    });

    pageInstance.handleTodayTaskEmptyAction.call(pageInstance, {
      stopPropagation: jest.fn(),
      currentTarget: {
        dataset: {
          action: 'courses'
        }
      }
    });

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/courses/courses?periodId=period_resilience'
    });
  });

  test('should navigate to all periods from task empty action', () => {
    wx.switchTab = jest.fn();
    pageInstance.setData({
      todayTaskEmptyState: {
        type: 'no-enrollment'
      }
    });

    pageInstance.handleTodayTaskEmptyAction.call(pageInstance, {
      stopPropagation: jest.fn(),
      currentTarget: {
        dataset: {
          action: 'periods'
        }
      }
    });

    expect(wx.switchTab).toHaveBeenCalledWith({
      url: '/pages/periods/periods'
    });
  });

  test('should show join-period empty state for a user without enrollments', async () => {
    userService.getUserProfile.mockResolvedValue({
      _id: 'user_123',
      nickname: '小狐狸',
      signature: '初来乍到'
    });
    userService.getUserStats.mockResolvedValue({ totalCheckinDays: 0 });
    courseService.getPeriods.mockResolvedValue({
      list: [
        {
          _id: 'period_active',
          title: '韧性之树',
          name: '韧性之树',
          startDate: '2000-01-01T00:00:00.000Z',
          endDate: '2099-12-31T00:00:00.000Z',
          totalDays: 21
        }
      ]
    });
    enrollmentService.getUserEnrollments.mockResolvedValue({ list: [] });
    courseService.getTodayTask.mockResolvedValue(null);
    periodAccess.getPeriodAccess.mockResolvedValue({
      canAccessCommunity: false,
      communityAccessState: 'locked',
      paymentStatus: null
    });

    await pageInstance.loadUserData.call(pageInstance, true);
    await new Promise(resolve => setImmediate(resolve));

    expect(courseService.getSectionDetail).not.toHaveBeenCalled();
    expect(courseService.getPeriodSections).not.toHaveBeenCalled();
    expect(pageInstance.data.currentPeriod).toBe(null);
    expect(pageInstance.data.todaySection).toBe(null);
    expect(pageInstance._periodNameById.get('period_active')).toBe('韧性之树');
    expect(pageInstance.data.todayTaskEmptyState).toMatchObject({
      type: 'no-enrollment',
      coverLabel: '未加入',
      title: '还没有加入晨读营',
      description: '加入一期晨读营后，这里会显示每天的晨读与打卡任务。',
      primaryAction: {
        text: '选择晨读营',
        type: 'periods'
      },
      secondaryActions: []
    });
  });

  test('should fetch checkin detail when recent card is missing sectionId', async () => {
    checkinService.getCheckinDetail.mockResolvedValue({
      _id: 'checkin_2',
      sectionId: {
        _id: 'section_2'
      }
    });

    await pageInstance.handleRecentCheckinTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          checkinId: 'checkin_2',
          sectionId: ''
        }
      }
    });

    expect(wx.showLoading).toHaveBeenCalled();
    expect(checkinService.getCheckinDetail).toHaveBeenCalledWith('checkin_2');
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/course-detail/course-detail?id=section_2&checkinId=checkin_2'
    });
    expect(wx.hideLoading).toHaveBeenCalled();
  });

  test('should navigate to checkin records page from more card', () => {
    pageInstance.navigateToCheckinRecords.call(pageInstance);

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/checkin-records/checkin-records'
    });
  });

  test('should navigate to notifications page from home task header', () => {
    pageInstance.navigateToNotifications.call(pageInstance);

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/notifications/notifications'
    });
  });

  test('should refresh unread notification count when returning to home within data throttle window', async () => {
    pageInstance._lastLoadTime = Date.now();
    const { tenantStorage } = require('../../utils/storage');
    tenantStorage.set('token', 'token_1');
    tenantStorage.set('userInfo', {
      _id: 'user_123',
      nickname: '小狐狸'
    });
    pageInstance.setData({
      isLogin: true,
      unreadNotificationCount: 6
    });
    notificationService.getUnreadCount.mockResolvedValue({ unreadCount: 0 });

    pageInstance.onShow.call(pageInstance);
    await Promise.resolve();

    expect(notificationService.getUnreadCount).toHaveBeenCalled();
    expect(pageInstance.data.unreadNotificationCount).toBe(0);
  });

  test('should open immersive reading from the morning reading button', async () => {
    pageInstance.data.currentPeriod = {
      _id: 'period_1'
    };
    pageInstance.data.todaySection = {
      _id: 'section_today',
      periodId: 'period_1'
    };

    await pageInstance.handleJoinMeeting.call(pageInstance);

    expect(subscribeAutoTopUp.maybeAutoTopUpNextDayStudyReminder).toHaveBeenCalledWith({
      periodId: 'period_1',
      sectionId: 'section_today',
      sourcePage: 'index',
      sourceAction: 'morning_read_click'
    });

    expect(activityService.track).toHaveBeenCalledWith('meeting_enter', {
      targetType: 'immersive_reading',
      targetId: 'section_today',
      periodId: 'period_1',
      sectionId: 'section_today',
      metadata: {
        source: 'profile_today_task',
        tencentMeetingDisabled: true
      }
    });
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/reading-mode/reading-mode?id=section_today&periodId=period_1'
    });
    expect(wx.navigateToMiniProgram).not.toHaveBeenCalled();
  });

  test('should show an error when morning reading has no section id', async () => {
    pageInstance.data.currentPeriod = {
      _id: 'period_1'
    };
    pageInstance.data.todaySection = {};

    await pageInstance.handleJoinMeeting.call(pageInstance);

    expect(wx.showToast).toHaveBeenCalledWith({
      title: '课节信息不存在',
      icon: 'none'
    });
    expect(wx.navigateTo).not.toHaveBeenCalled();
    expect(activityService.track).not.toHaveBeenCalled();
  });

  test('should pass reading completion state into immersive reading', async () => {
    pageInstance.data.currentPeriod = {
      _id: 'period_1'
    };
    pageInstance.data.todaySection = {
      _id: 'section_today',
      periodId: 'period_1',
      readingCompleted: true,
      readingDurationMs: 91000,
      readingCompletedAt: '2026-05-15T08:00:00.000Z'
    };

    await pageInstance.handleJoinMeeting.call(pageInstance);

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url:
        '/pages/reading-mode/reading-mode?id=section_today&periodId=period_1' +
        '&readingCompleted=1&readingDurationMs=91000' +
        '&readingCompletedAt=2026-05-15T08%3A00%3A00.000Z'
    });
  });

  test('should show morning read prompt only inside window and once per day', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 4, 15, 5, 55));
    wx.clearStorageSync();

    pageInstance.data.isLogin = true;
    pageInstance.data.todaySection = {
      _id: 'section_today',
      periodId: 'period_1',
      readingCompleted: false
    };

    pageInstance.maybeShowMorningReadPrompt.call(pageInstance);

    expect(pageInstance.data.showMorningReadPrompt).toBe(true);

    pageInstance.data.showMorningReadPrompt = false;
    pageInstance.data.todaySection.readingCompleted = true;
    pageInstance.maybeShowMorningReadPrompt.call(pageInstance);

    expect(pageInstance.data.showMorningReadPrompt).toBe(false);

    pageInstance.data.todaySection.readingCompleted = false;
    wx.setStorageSync('morning_read_prompt_date', '2026-05-15');
    pageInstance.maybeShowMorningReadPrompt.call(pageInstance);

    expect(pageInstance.data.showMorningReadPrompt).toBe(false);
    jest.useRealTimers();
  });

  test('should handle morning read prompt primary action', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 4, 15, 5, 55));
    wx.clearStorageSync();
    pageInstance.data.currentPeriod = {
      _id: 'period_1'
    };
    pageInstance.data.todaySection = {
      _id: 'section_today',
      periodId: 'period_1'
    };
    pageInstance.data.showMorningReadPrompt = true;

    pageInstance.handleMorningReadPromptGo.call(pageInstance);
    await Promise.resolve();
    await Promise.resolve();

    expect(wx.setStorageSync).toHaveBeenCalledWith(
      'morning_read_prompt_date',
      '2026-05-15'
    );
    expect(pageInstance.data.showMorningReadPrompt).toBe(false);
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/reading-mode/reading-mode?id=section_today&periodId=period_1'
    });
    expect(activityService.track).toHaveBeenCalledWith(
      'meeting_enter',
      {
        targetType: 'immersive_reading',
        targetId: 'section_today',
        periodId: 'period_1',
        sectionId: 'section_today',
        metadata: {
          source: 'profile_today_task',
          tencentMeetingDisabled: true
        }
      }
    );
    jest.useRealTimers();
  });

  test('should block checkin navigation when current period community is locked', async () => {
    pageInstance.data.currentPeriodCommunityState = 'locked';
    pageInstance.data.canUsePaidFeatures = false;

    await pageInstance.handleRecentCheckinTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          checkinId: 'checkin_1',
          sectionId: 'section_1'
        }
      }
    });

    expect(wx.showToast).toHaveBeenCalledWith({
      title: '完成支付后可查看打卡日记',
      icon: 'none'
    });
    expect(wx.navigateTo).not.toHaveBeenCalled();
  });

  test('should keep reading completion state on the home today task', async () => {
    userService.getUserProfile.mockResolvedValue({
      _id: 'user_123',
      nickname: '小狐狸',
      signature: '认真读完'
    });
    userService.getUserStats.mockResolvedValue({ totalCheckinDays: 6 });
    courseService.getPeriods.mockResolvedValue({
      list: [
        {
          _id: 'period_current',
          title: '秩序之锚',
          name: '秩序之锚',
          startDate: '2000-01-01T00:00:00.000Z',
          endDate: '2099-12-31T00:00:00.000Z',
          coverColor: '#4a90e2',
          coverEmoji: '∞'
        }
      ]
    });
    enrollmentService.getUserEnrollments.mockResolvedValue({
      list: [
        {
          _id: 'enrollment_current',
          periodId: 'period_current',
          status: 'active',
          paymentStatus: 'paid'
        }
      ]
    });
    courseService.getTodayTask.mockResolvedValue({
      sectionId: 'section_day_6',
      periodId: 'period_current',
      periodTitle: '秩序之锚',
      day: 6,
      checkinCount: 2,
      checkinUsers: [],
      isCheckedIn: false,
      readingCompleted: true,
      readingCompletedAt: '2026-05-15T08:00:00.000Z',
      readingDurationMs: 92000
    });
    courseService.getSectionDetail.mockResolvedValue({
      _id: 'section_day_6',
      title: '第六天 积极主动',
      readingCompleted: false
    });
    periodAccess.getPeriodAccess.mockResolvedValue({
      canAccessCommunity: true,
      communityAccessState: 'enabled',
      paymentStatus: 'paid'
    });
    checkinService.getUserCheckinsWithStats.mockResolvedValue({ list: [] });
    insightService.getInsightsList.mockResolvedValue({ list: [] });
    insightService.getReceivedRequests.mockResolvedValue([]);

    await pageInstance.loadUserData.call(pageInstance, true);

    expect(pageInstance.data.todaySection).toMatchObject({
      _id: 'section_day_6',
      day: 6,
      readingCompleted: true,
      readingCompletedAt: '2026-05-15T08:00:00.000Z',
      readingDurationMs: 92000
    });
  });

  test('should keep paid homepage sections visible when current period is unpaid', async () => {
    userService.getUserProfile.mockResolvedValue({
      _id: 'user_123',
      nickname: '小狐狸',
      signature: '呼噜呼噜'
    });
    userService.getUserStats.mockResolvedValue({ totalCheckinDays: 5 });
    courseService.getPeriods.mockResolvedValue({
      list: [
        {
          _id: 'period_current',
          title: '秩序之锚',
          name: '秩序之锚',
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-31T00:00:00.000Z',
          coverColor: '#4a90e2',
          coverEmoji: '∞'
        },
        {
          _id: 'period_paid',
          title: '内在之光',
          name: '内在之光',
          startDate: '2026-03-01T00:00:00.000Z',
          endDate: '2026-03-31T00:00:00.000Z'
        }
      ]
    });
    enrollmentService.getUserEnrollments.mockResolvedValue({
      list: [
        {
          _id: 'enrollment_current',
          periodId: 'period_current',
          status: 'active',
          paymentStatus: 'pending'
        },
        {
          _id: 'enrollment_paid',
          periodId: 'period_paid',
          status: 'completed',
          paymentStatus: 'paid'
        }
      ]
    });
    courseService.getTodayTask.mockResolvedValue({
      sectionId: 'section_today',
      periodId: 'period_current',
      periodTitle: '秩序之锚',
      day: 6,
      checkinCount: 0,
      checkinUsers: [],
      isCheckedIn: false
    });
    courseService.getSectionDetail.mockResolvedValue({
      _id: 'section_today',
      title: '开营词'
    });
    periodAccess.getPeriodAccess.mockResolvedValue({
      canAccessCommunity: false,
      communityAccessState: 'locked',
      paymentStatus: 'pending'
    });
    checkinService.getUserCheckinsWithStats.mockResolvedValue({
      list: [
        {
          _id: 'checkin_paid',
          createdAt: '2026-03-29T13:11:00.000Z',
          note: '历史打卡',
          sectionId: { _id: 'section_paid', title: '第二天', day: 2 },
          periodId: { _id: 'period_paid', title: '内在之光' }
        }
      ]
    });
    insightService.getInsightsList.mockResolvedValue({ list: [] });
    insightService.getReceivedRequests.mockResolvedValue([]);

    await pageInstance.loadUserData.call(pageInstance, true);
    await new Promise(resolve => setImmediate(resolve));

    expect(pageInstance.data.currentPeriodCommunityState).toBe('locked');
    expect(pageInstance.data.canUsePaidFeatures).toBe(true);
    expect(checkinService.getUserCheckinsWithStats).toHaveBeenCalled();
    expect(insightService.getInsightsList).toHaveBeenCalledWith({ limit: 100 });
    expect(pageInstance.data.recentCheckins).toHaveLength(1);
  });

  test('should show ended-period empty state after the current period has ended', async () => {
    userService.getUserProfile.mockResolvedValue({
      _id: 'user_123',
      nickname: '小狐狸',
      signature: '结营复盘'
    });
    userService.getUserStats.mockResolvedValue({ totalCheckinDays: 21 });
    courseService.getPeriods.mockResolvedValue({
      list: [
        {
          _id: 'period_resilience',
          title: '韧性之树',
          name: '韧性之树',
          startDate: '2000-01-01T00:00:00.000Z',
          endDate: '2000-01-21T00:00:00.000Z',
          totalDays: 21,
          coverColor: '#4a90e2',
          coverEmoji: '🌳'
        }
      ]
    });
    enrollmentService.getUserEnrollments.mockResolvedValue({
      list: [
        {
          _id: 'enrollment_resilience',
          periodId: 'period_resilience',
          status: 'completed',
          paymentStatus: 'paid'
        }
      ]
    });
    courseService.getTodayTask.mockResolvedValue(null);
    courseService.getPeriodSections.mockResolvedValue({
      list: [
        {
          _id: 'section_day_1',
          id: 'section_day_1',
          day: 1,
          title: '第一天 品德成功论',
          isCheckedIn: false
        },
        {
          _id: 'section_day_21',
          id: 'section_day_21',
          day: 21,
          title: '结营词',
          isCheckedIn: true
        }
      ]
    });
    periodAccess.getPeriodAccess.mockResolvedValue({
      canAccessCommunity: true,
      communityAccessState: 'enabled',
      paymentStatus: 'paid'
    });
    checkinService.getUserCheckinsWithStats.mockResolvedValue({ list: [] });
    insightService.getInsightsList.mockResolvedValue({ list: [] });
    insightService.getReceivedRequests.mockResolvedValue([]);
    completionReportService.getMyReports.mockResolvedValue({
      list: [
        {
          periodId: 'period_resilience',
          hasReport: true,
          reportTitle: '韧性之树结营实录'
        }
      ]
    });

    await pageInstance.loadUserData.call(pageInstance, true);
    await new Promise(resolve => setImmediate(resolve));

    expect(courseService.getPeriodSections).not.toHaveBeenCalled();
    expect(pageInstance.data.todaySection).toBe(null);
    expect(pageInstance.data.todayTaskEmptyState).toMatchObject({
      type: 'period-ended',
      title: '韧性之树已结营',
      periodId: 'period_resilience',
      primaryAction: {
        text: '查看结营实录',
        type: 'report'
      },
      secondaryActions: [
        { text: '回看课程', type: 'courses' }
      ]
    });
    expect(pageInstance.data.currentPeriodReport).toMatchObject({
      periodId: 'period_resilience',
      hasReport: true
    });
  });

  test('should ignore stale first-day today task after the period has ended', async () => {
    userService.getUserProfile.mockResolvedValue({
      _id: 'user_123',
      nickname: '小狐狸',
      signature: '结营复盘'
    });
    userService.getUserStats.mockResolvedValue({ totalCheckinDays: 21 });
    courseService.getPeriods.mockResolvedValue({
      list: [
        {
          _id: 'period_resilience',
          title: '韧性之树',
          name: '韧性之树',
          startDate: '2000-01-01T00:00:00.000Z',
          endDate: '2000-01-21T00:00:00.000Z',
          totalDays: 21
        }
      ]
    });
    enrollmentService.getUserEnrollments.mockResolvedValue({
      list: [
        {
          _id: 'enrollment_resilience',
          periodId: 'period_resilience',
          status: 'completed',
          paymentStatus: 'paid'
        }
      ]
    });
    courseService.getTodayTask.mockResolvedValue({
      sectionId: 'section_day_1',
      periodId: 'period_resilience',
      periodTitle: '韧性之树',
      day: 1,
      checkinCount: 5,
      checkinUsers: [],
      isCheckedIn: false
    });
    courseService.getSectionDetail.mockResolvedValue({
      _id: 'section_day_1',
      title: '第一天 品德成功论'
    });
    courseService.getPeriodSections.mockResolvedValue({
      list: [
        {
          _id: 'section_day_1',
          id: 'section_day_1',
          day: 1,
          title: '第一天 品德成功论',
          isCheckedIn: false
        },
        {
          _id: 'section_day_21',
          id: 'section_day_21',
          day: 21,
          title: '结营词',
          isCheckedIn: true
        }
      ]
    });
    periodAccess.getPeriodAccess.mockResolvedValue({
      canAccessCommunity: true,
      communityAccessState: 'enabled',
      paymentStatus: 'paid'
    });
    checkinService.getUserCheckinsWithStats.mockResolvedValue({ list: [] });
    insightService.getInsightsList.mockResolvedValue({ list: [] });
    insightService.getReceivedRequests.mockResolvedValue([]);

    await pageInstance.loadUserData.call(pageInstance, true);
    await new Promise(resolve => setImmediate(resolve));

    expect(courseService.getSectionDetail).not.toHaveBeenCalled();
    expect(courseService.getPeriodSections).not.toHaveBeenCalled();
    expect(pageInstance.data.todaySection).toBe(null);
    expect(pageInstance.data.todayTaskEmptyState).toMatchObject({
      type: 'period-ended',
      title: '韧性之树已结营',
      periodId: 'period_resilience',
      primaryAction: null
    });
  });

  test('should hide completion report shortcut before the final period day', async () => {
    userService.getUserProfile.mockResolvedValue({
      _id: 'user_123',
      nickname: '小狐狸',
      signature: '今日精进'
    });
    userService.getUserStats.mockResolvedValue({ totalCheckinDays: 1 });
    courseService.getPeriods.mockResolvedValue({
      list: [
        {
          _id: 'period_active',
          title: '韧性之树',
          name: '韧性之树',
          startDate: '2000-01-01T00:00:00.000Z',
          endDate: '2099-12-31T00:00:00.000Z',
          totalDays: 21
        }
      ]
    });
    enrollmentService.getUserEnrollments.mockResolvedValue({
      list: [
        {
          _id: 'enrollment_active',
          periodId: 'period_active',
          status: 'active',
          paymentStatus: 'paid'
        }
      ]
    });
    courseService.getTodayTask.mockResolvedValue({
      sectionId: 'section_day_1',
      periodId: 'period_active',
      periodTitle: '韧性之树',
      day: 1,
      checkinCount: 5,
      checkinUsers: [],
      isCheckedIn: false
    });
    courseService.getSectionDetail.mockResolvedValue({
      _id: 'section_day_1',
      id: 'section_day_1',
      day: 1,
      title: '第一天 品德成功论'
    });
    periodAccess.getPeriodAccess.mockResolvedValue({
      canAccessCommunity: true,
      communityAccessState: 'enabled',
      paymentStatus: 'paid'
    });
    checkinService.getUserCheckinsWithStats.mockResolvedValue({ list: [] });
    insightService.getInsightsList.mockResolvedValue({ list: [] });
    insightService.getReceivedRequests.mockResolvedValue([]);
    completionReportService.getMyReports.mockResolvedValue({
      list: [
        {
          periodId: 'period_active',
          hasReport: true,
          reportTitle: '提前上传的实录'
        }
      ]
    });

    await pageInstance.loadUserData.call(pageInstance, true);
    await Promise.resolve();
    await Promise.resolve();

    expect(pageInstance.data.todaySection).toMatchObject({
      _id: 'section_day_1',
      day: 1,
      canShowReportShortcut: false
    });
    expect(completionReportService.getMyReports).not.toHaveBeenCalled();
    expect(pageInstance.data.currentPeriodReport).toBe(null);
  });

  test('should omit hidden home sections from configured homepage order', async () => {
    wx.request.mockImplementationOnce((options) => {
      options.success({
        statusCode: 200,
        data: {
          code: 0,
          data: {
            sections: [
              { key: 'recentActivities', hidden: false },
              { key: 'todayTask', hidden: true },
              'zaichang',
              { key: 'myCheckins', hidden: true },
              'xiaofanInsights',
              'insightRequests'
            ]
          }
        }
      });
    });
    userService.getUserProfile.mockResolvedValue({
      _id: 'user_123',
      nickname: '小狐狸',
      signature: '呼噜呼噜'
    });
    userService.getUserStats.mockResolvedValue({ totalCheckinDays: 5 });
    courseService.getPeriods.mockResolvedValue({
      list: [
        {
          _id: 'period_current',
          title: '秩序之锚',
          name: '秩序之锚',
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-31T00:00:00.000Z'
        }
      ]
    });
    enrollmentService.getUserEnrollments.mockResolvedValue({
      list: [
        {
          _id: 'enrollment_current',
          periodId: 'period_current',
          status: 'active',
          paymentStatus: 'paid'
        }
      ]
    });
    courseService.getTodayTask.mockResolvedValue(null);
    periodAccess.getPeriodAccess.mockResolvedValue({
      canAccessCommunity: true,
      communityAccessState: 'enabled',
      paymentStatus: 'paid'
    });
    checkinService.getUserCheckinsWithStats.mockResolvedValue({ list: [] });
    insightService.getInsightsList.mockResolvedValue({ list: [] });
    insightService.getReceivedRequests.mockResolvedValue([]);

    await pageInstance.loadUserData.call(pageInstance, true);

    expect(pageInstance.data.homeSections.map(item => item.key)).toEqual([
      'recentActivities',
      'zaichang',
      'xiaofanInsights',
      'insightRequests'
    ]);
  });
});
