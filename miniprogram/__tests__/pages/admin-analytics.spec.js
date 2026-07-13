jest.mock('../../pages/admin-analytics/adminAnalytics.service', () => ({
  getPeriods: jest.fn(),
  getOverview: jest.fn(),
  getActivity: jest.fn()
}));

describe('admin analytics page', () => {
  let pageConfig;
  let pageInstance;
  let service;

  beforeEach(() => {
    jest.resetModules();
    pageConfig = null;
    global.Page = jest.fn((config) => {
      pageConfig = config;
      return config;
    });

    service = require('../../pages/admin-analytics/adminAnalytics.service');
    service.getPeriods.mockResolvedValue({
      list: [{ id: 'period_1', name: '第八期' }]
    });
    service.getOverview.mockResolvedValue({
      summary: {
        totalUsers: 177,
        totalEnrollments: 65,
        paidEnrollments: 51,
        enrollmentRevenue: 30000,
        activityRevenue: 248,
        totalRevenue: 30248,
        conversionRate: 78.5
      },
      enrollmentTrend: [{ date: '2026-06-28', enrollmentCount: 2, paidEnrollmentCount: 1 }],
      paymentTrend: [{ date: '2026-06-28', totalAmount: 30248, enrollmentAmount: 30000, activityAmount: 248 }],
      periodPopularity: [{ periodId: 'period_1', periodName: '第八期', enrollmentCount: 65, paidEnrollmentCount: 51 }]
    });
    service.getActivity.mockResolvedValue({
      summary: {
        today: { appOpenUsers: 19, checkinUsers: 2, insightViewUsers: 18, activeUsers: 20 },
        yesterday: { appOpenUsers: 8, checkinUsers: 1, insightViewUsers: 7, activeUsers: 9 },
        delta: { appOpenUsers: 11, checkinUsers: 1, insightViewUsers: 11, activeUsers: 11 }
      },
      trend: [
        {
          date: '2026-06-27',
          activeUserCount: 9,
          app_open: 8,
          course_view: 7,
          checkin_submit: 1,
          own_insight_view: 7,
          other_insight_view: 4,
          meeting_enter: 5,
          zaichang_activity: 4,
          podcast_activity: 3,
          ai_read_activity: 2,
          share_activity: 1,
          activity_enroll: 0,
          insight_interaction: 1
        },
        {
          date: '2026-06-28',
          activeUserCount: 20,
          app_open: 19,
          course_view: 9,
          checkin_submit: 2,
          own_insight_view: 14,
          other_insight_view: 9,
          meeting_enter: 15,
          zaichang_activity: 5,
          podcast_activity: 3,
          ai_read_activity: 2,
          share_activity: 4,
          activity_enroll: 1,
          insight_interaction: 2
        }
      ],
      detailsPagination: {
        page: 1,
        pageSize: 20,
        total: 21,
        totalPages: 2,
        hasMore: true
      },
      details: [{
        date: '2026-06-28',
        userId: 'user_1',
        nickname: '狮子',
        phone: '13564053520',
        actions: [{ action: 'app_open', label: '访问小程序', count: 41 }],
        totalCount: 41,
        lastOccurredAt: '2026-06-28T04:22:07.000Z'
      }]
    });

    require('../../pages/admin-analytics/admin-analytics');
    pageInstance = {
      ...pageConfig,
      data: JSON.parse(JSON.stringify(pageConfig.data)),
      setData(update) {
        this.data = { ...this.data, ...update };
      }
    };
  });

  afterEach(() => {
    delete global.Page;
  });

  test('loads periods, overview and activity data', async () => {
    await pageInstance.loadAll.call(pageInstance);

    expect(service.getPeriods).toHaveBeenCalled();
    expect(service.getOverview).toHaveBeenCalledWith(expect.objectContaining({
      startDate: expect.any(String),
      endDate: expect.any(String)
    }));
    expect(service.getActivity).toHaveBeenCalled();
    expect(service.getActivity).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 20
    }));
    expect(pageInstance.data.periodNames).toEqual(['全部期次', '第八期']);
    expect(pageInstance.data.selectedPeriodName).toBe('全部期次');
    expect(pageInstance.data.overview.summary.totalRevenueText).toBe('¥302.48');
    expect(pageInstance.data.overview.enrollmentChart.empty).toBe(false);
    expect(pageInstance.data.overview.paymentChart.rows[0].values[0].height).toBeGreaterThan(0);
    expect(pageInstance.data.activity.trendChart.empty).toBe(false);
    expect(pageInstance.data.activity.trendChart.rows[0].label).toBe('06-28');
    expect(pageInstance.data.activity.todayMetricChart.date).toBe('2026-06-28');
    expect(pageInstance.data.activity.todayMetricChart.bars.map((bar) => bar.value)).toEqual([
      20, 19, 15, 14, 9, 9, 5, 4, 3, 2, 2, 2, 1
    ]);
    expect(pageInstance.data.activity.todayMetricChart.bars.map((bar) => bar.label)).toEqual([
      '活跃', '访问', '晨读', '看自己', '课程', '看他人', '在场', '分享', '播客', '打卡', 'AI朗读', '互动', '活动'
    ]);
    expect(pageInstance.data.activity.details[0].phone).toBe('13564053520');
    expect(pageInstance.data.activity.detailsPagination.hasMore).toBe(true);
    expect(pageInstance.data.activity.detailsPagination.total).toBe(21);
    expect(pageInstance.data.activityCards[0].deltaText).toBe('较昨日+11');
  });

  test('loads more activity details by page', async () => {
    await pageInstance.loadAll.call(pageInstance);

    service.getActivity.mockResolvedValueOnce({
      summary: {
        today: { appOpenUsers: 19, checkinUsers: 2, insightViewUsers: 18, activeUsers: 20 },
        yesterday: { appOpenUsers: 8, checkinUsers: 1, insightViewUsers: 7, activeUsers: 9 },
        delta: { appOpenUsers: 11, checkinUsers: 1, insightViewUsers: 11, activeUsers: 11 }
      },
      trend: [{
        date: '2026-06-28',
        activeUserCount: 20,
        app_open: 19
      }],
      detailsPagination: {
        page: 2,
        pageSize: 20,
        total: 21,
        totalPages: 2,
        hasMore: false
      },
      details: [{
        date: '2026-06-28',
        userId: 'user_2',
        nickname: '第二页用户',
        phone: '15000111111',
        actions: [{ action: 'course_view', label: '查看课程', count: 3 }],
        totalCount: 3,
        lastOccurredAt: '2026-06-28T05:22:07.000Z'
      }]
    });

    await pageInstance.handleLoadMoreDetails.call(pageInstance);

    expect(service.getActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 2,
      pageSize: 20
    }));
    expect(pageInstance.data.activity.details).toHaveLength(2);
    expect(pageInstance.data.activity.details[1].nickname).toBe('第二页用户');
    expect(pageInstance.data.activity.detailsPagination.hasMore).toBe(false);
    expect(pageInstance.data.loadingMoreDetails).toBe(false);
  });

  test('reloads with selected period filter', async () => {
    await pageInstance.loadAll.call(pageInstance);
    await pageInstance.handlePeriodChange.call(pageInstance, { detail: { value: 1 } });

    expect(pageInstance.data.periodIndex).toBe(1);
    expect(pageInstance.data.selectedPeriodName).toBe('第八期');
    expect(service.getOverview).toHaveBeenLastCalledWith(expect.objectContaining({
      periodId: 'period_1'
    }));
    expect(service.getActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      periodId: 'period_1',
      page: 1,
      pageSize: 20
    }));
  });

  test('reloads with custom date range', async () => {
    await pageInstance.loadAll.call(pageInstance);
    await pageInstance.handleStartDateChange.call(pageInstance, { detail: { value: '2026-06-10' } });
    await pageInstance.handleEndDateChange.call(pageInstance, { detail: { value: '2026-06-20' } });

    expect(pageInstance.data.activePreset).toBe('custom');
    expect(service.getOverview).toHaveBeenLastCalledWith(expect.objectContaining({
      startDate: '2026-06-10',
      endDate: '2026-06-20'
    }));
  });

  test('shows no permission state when loading fails with permission error', async () => {
    service.getOverview.mockRejectedValueOnce({ statusCode: 403, message: '需要管理员权限' });

    await pageInstance.loadAll.call(pageInstance);

    expect(pageInstance.data.loading).toBe(false);
    expect(pageInstance.data.errorMessage).toBe('当前账号没有数据分析权限');
  });
});
