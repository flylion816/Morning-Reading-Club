jest.mock('../../services/insight.service.js', () => ({
  getSentRequests: jest.fn(),
  getUserInsightsList: jest.fn(),
  getMobileAdminInsights: jest.fn(),
  getInsightsList: jest.fn()
}));

jest.mock('../../services/user.service.js', () => ({}));
jest.mock('../../services/enrollment.service.js', () => ({}));
jest.mock('../../services/activity.service.js', () => ({ track: jest.fn() }));
jest.mock('../../services/course.service.js', () => ({ getPeriods: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));
jest.mock('../../utils/subscribe-auto-topup.js', () => ({
  maybeAutoTopUpSubscriptions: jest.fn(() => Promise.resolve())
}));
jest.mock('../../utils/period-access.js', () => ({
  hasPaidEnrollment: jest.fn(() => true),
  redirectAfterCommunityDenied: jest.fn()
}));
jest.mock('../../utils/auth.js', () => ({ isAdminUser: jest.fn(() => false) }));

describe('insights page period and keyword filters', () => {
  let pageConfig;
  let pageInstance;
  let courseService;
  let insightService;

  beforeEach(() => {
    jest.resetModules();
    pageConfig = null;
    global.Page = jest.fn(config => {
      pageConfig = config;
      return config;
    });
    global.getApp = jest.fn(() => ({
      globalData: {
        userInfo: { _id: 'user_1', nickname: '狮子' },
        periods: [
          { _id: 'period_2', name: '韧性之树' },
          { _id: 'period_1', title: '内在之光' }
        ]
      }
    }));

    courseService = require('../../services/course.service.js');
    insightService = require('../../services/insight.service.js');
    require('../../pages/insights/insights.js');

    pageInstance = {
      ...pageConfig,
      data: JSON.parse(JSON.stringify(pageConfig.data)),
      setData(update) {
        this.data = { ...this.data, ...update };
      }
    };
    courseService.getPeriods.mockReset();
    insightService.getSentRequests.mockReset();
    insightService.getUserInsightsList.mockReset();
    insightService.getMobileAdminInsights.mockReset();
  });

  afterEach(() => {
    delete global.Page;
    delete global.getApp;
  });

  test('initializes all-period option from existing period data', async () => {
    await pageInstance.loadPeriodOptions.call(pageInstance);

    expect(pageInstance.data.periodOptions).toEqual([
      { id: '', name: '所有期次' },
      { id: 'period_2', name: '韧性之树' },
      { id: 'period_1', name: '内在之光' }
    ]);
    expect(pageInstance.data.selectedPeriodIndex).toBe(0);
    expect(courseService.getPeriods).not.toHaveBeenCalled();
  });

  test('filters the current list immediately after selecting a period', () => {
    pageInstance.setData({
      insights: [
        { id: 'mine_1', periodId: 'period_1', title: '觉察' },
        { id: 'mine_2', periodId: 'period_2', title: '倾听' }
      ],
      otherInsights: [
        { id: 'other_1', periodId: 'period_1', title: '陪伴' },
        { id: 'other_2', periodId: 'period_2', title: '成长' }
      ],
      periodOptions: [
        { id: '', name: '所有期次' },
        { id: 'period_1', name: '内在之光' },
        { id: 'period_2', name: '韧性之树' }
      ]
    });

    pageInstance.onPeriodChange.call(pageInstance, { detail: { value: '1' } });

    expect(pageInstance.data.selectedPeriodId).toBe('period_1');
    expect(pageInstance.data.searchResults.map(item => item.id)).toEqual(['mine_1']);
    expect(pageInstance.data.otherSearchResults.map(item => item.id)).toEqual(['other_1']);
    expect(pageInstance.data.isSearchMode).toBe(true);
  });

  test('composes keyword search with the selected period', () => {
    pageInstance.setData({
      selectedPeriodId: 'period_1',
      searchKeyword: '觉察',
      insights: [
        { id: 'mine_1', periodId: 'period_1', title: '觉察日记', preview: '今天' },
        { id: 'mine_2', periodId: 'period_1', title: '倾听', preview: '练习' },
        { id: 'mine_3', periodId: 'period_2', title: '觉察日记', preview: '昨天' }
      ],
      otherInsights: [
        { id: 'other_1', periodId: 'period_1', title: '回应', preview: '看见你的觉察' },
        { id: 'other_2', periodId: 'period_2', title: '觉察', preview: '成长' }
      ]
    });

    pageInstance.onSearchSubmit.call(pageInstance);

    expect(pageInstance.data.activeSearchKeyword).toBe('觉察');
    expect(pageInstance.data.searchResults.map(item => item.id)).toEqual(['mine_1']);
    expect(pageInstance.data.otherSearchResults.map(item => item.id)).toEqual(['other_1']);
  });

  test('clears keyword while retaining the selected period', () => {
    pageInstance.setData({
      selectedPeriodId: 'period_1',
      searchKeyword: '觉察',
      activeSearchKeyword: '觉察',
      insights: [
        { id: 'mine_1', periodId: 'period_1', title: '觉察' },
        { id: 'mine_2', periodId: 'period_1', title: '倾听' },
        { id: 'mine_3', periodId: 'period_2', title: '觉察' }
      ]
    });

    pageInstance.onSearchClear.call(pageInstance);

    expect(pageInstance.data.activeSearchKeyword).toBe('');
    expect(pageInstance.data.selectedPeriodId).toBe('period_1');
    expect(pageInstance.data.searchResults.map(item => item.id)).toEqual(['mine_1', 'mine_2']);
    expect(pageInstance.data.isSearchMode).toBe(true);
  });

  test('keeps active filters when switching to others', () => {
    pageInstance.setData({
      activeTab: 'mine',
      selectedPeriodId: 'period_1',
      activeSearchKeyword: '觉察',
      otherInsightsLoaded: true,
      otherInsights: [
        { id: 'other_1', periodId: 'period_1', title: '觉察' },
        { id: 'other_2', periodId: 'period_2', title: '觉察' }
      ]
    });

    pageInstance.switchTab.call(pageInstance, {
      currentTarget: { dataset: { tab: 'others' } }
    });

    expect(pageInstance.data.activeTab).toBe('others');
    expect(pageInstance.data.selectedPeriodId).toBe('period_1');
    expect(pageInstance.data.otherSearchResults.map(item => item.id)).toEqual(['other_1']);
  });

  test('loads other insights before applying active filters on first tab switch', () => {
    pageInstance.setData({
      activeTab: 'mine',
      selectedPeriodId: 'period_1',
      activeSearchKeyword: '觉察',
      otherInsightsLoaded: false,
      otherInsightsLoading: false
    });
    pageInstance.loadOtherInsights = jest.fn();

    pageInstance.switchTab.call(pageInstance, {
      currentTarget: { dataset: { tab: 'others' } }
    });

    expect(pageInstance.loadOtherInsights).toHaveBeenCalledTimes(1);
  });

  test('admin loads every page without consulting approved requests', async () => {
    pageInstance.setData({ isAdmin: true });
    insightService.getMobileAdminInsights
      .mockResolvedValueOnce({
        list: [
          {
            _id: 'admin_1',
            day: 1,
            content: '第一条',
            targetUserId: { _id: 'user_a', nickname: '甲' },
            periodId: { _id: 'period_1', name: '内在之光' },
            sectionId: { day: 1, title: '第一天' }
          }
        ],
        pagination: { page: 1, limit: 100, total: 2, pages: 2 }
      })
      .mockResolvedValueOnce({
        list: [
          {
            _id: 'admin_2',
            day: 2,
            content: '第二条',
            targetUserId: { _id: 'user_b', nickname: '乙' },
            periodId: { _id: 'period_1', name: '内在之光' },
            sectionId: { day: 2, title: '第二天' }
          }
        ],
        pagination: { page: 2, limit: 100, total: 2, pages: 2 }
      });

    await pageInstance.loadOtherInsights.call(pageInstance);

    expect(insightService.getMobileAdminInsights.mock.calls).toEqual([
      [{ page: 1, limit: 100 }],
      [{ page: 2, limit: 100 }]
    ]);
    expect(insightService.getSentRequests).not.toHaveBeenCalled();
    expect(pageInstance.data.otherInsights.map(item => item.id).sort()).toEqual([
      'admin_1',
      'admin_2'
    ]);
  });

  test('regular user retains the approved-request discovery flow', async () => {
    pageInstance.setData({ isAdmin: false });
    insightService.getSentRequests.mockResolvedValue({
      list: [{ toUserId: { _id: 'user_a', nickname: '甲' } }]
    });
    insightService.getUserInsightsList.mockResolvedValue({ list: [] });

    await pageInstance.loadOtherInsights.call(pageInstance);

    expect(insightService.getSentRequests).toHaveBeenCalledWith({
      status: 'approved',
      limit: 100
    });
    expect(insightService.getMobileAdminInsights).not.toHaveBeenCalled();
  });
});
