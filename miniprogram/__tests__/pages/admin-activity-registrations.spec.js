jest.mock('../../pages/admin-workbench/adminWorkbench.service', () => ({
  getActivityRegistrations: jest.fn()
}));

describe('admin activity registrations page', () => {
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

    service = require('../../pages/admin-workbench/adminWorkbench.service');
    service.getActivityRegistrations.mockResolvedValue({
      activity: {
        activityId: 'activity_1',
        title: '线下共读会',
        status: 'published',
        startTime: '2026-06-28T12:00:00.000Z',
        isPaid: true,
        price: 1200,
        registrationCount: 2,
        paidCount: 1,
        pendingCount: 1
      },
      list: [{
        registrationId: 'reg_1',
        status: 'registered',
        paymentStatus: 'paid',
        paidAmount: 1200,
        reminderGranted: true,
        registeredAt: '2026-06-27T02:00:00.000Z',
        user: {
          userId: 'user_1',
          nickname: '狮子学员',
          avatarUrl: 'https://example.com/avatar.jpg',
          phoneMasked: '150****8787',
          totalCheckinDays: 9,
          summary: { enrollmentCount: 3 }
        },
        payment: { status: 'completed', amount: 1200 }
      }, {
        registrationId: 'reg_2',
        status: 'registered',
        paymentStatus: 'free',
        paidAmount: 0,
        reminderGranted: false,
        registeredAt: '2026-06-27T03:00:00.000Z',
        formAnswers: [{ fieldId: 'city', label: '城市', value: 'hz', valueText: '杭州' }],
        user: {
          userId: 'user_2',
          nickname: '小白',
          phoneMasked: '139****0000',
          totalCheckinDays: 2,
          summary: { enrollmentCount: 1 }
        },
        payment: null
      }],
      formStats: [{
        fieldId: 'city',
        label: '城市',
        options: [
          { optionId: 'sh', label: '上海', count: 1, registrationIds: ['reg_1'] },
          { optionId: 'hz', label: '杭州', count: 1, registrationIds: ['reg_2'] }
        ]
      }, {
        fieldId: 'note',
        label: '备注',
        options: [
          { optionId: '靠窗座位', label: '靠窗座位', count: 1, registrationIds: ['reg_2'] }
        ]
      }],
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 2, hasMore: true }
    });

    require('../../pages/admin-workbench/activity-registrations/activity-registrations');
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

  test('loads registrations with user avatar and learning stats', async () => {
    await pageInstance.onLoad.call(pageInstance, { activityId: 'activity_1' });

    expect(service.getActivityRegistrations).toHaveBeenCalledWith('activity_1', {
      q: '',
      page: 1,
      pageSize: 20
    });
    expect(pageInstance.data.activity.title).toBe('线下共读会');
    expect(pageInstance.data.activity.priceText).toBe('¥12.00');
    expect(pageInstance.data.registrations[0].user.avatarUrl).toBe('https://example.com/avatar.jpg');
    expect(pageInstance.data.registrations[0].user.enrollmentCount).toBe(3);
    expect(pageInstance.data.registrations[0].user.checkinCount).toBe(9);
    expect(pageInstance.data.registrations[0].paymentStatusText).toBe('已支付');
    expect(pageInstance.data.formStats[0].label).toBe('城市');
  });

  test('searches and loads more registrations', async () => {
    await pageInstance.onLoad.call(pageInstance, { activityId: 'activity_1' });
    pageInstance.handleKeywordInput.call(pageInstance, { detail: { value: '狮子' } });
    await pageInstance.handleSearch.call(pageInstance);

    expect(service.getActivityRegistrations).toHaveBeenLastCalledWith('activity_1', {
      q: '狮子',
      page: 1,
      pageSize: 20
    });

    service.getActivityRegistrations.mockResolvedValueOnce({
      activity: {
        activityId: 'activity_1',
        title: '线下共读会',
        status: 'published',
        startTime: '2026-06-28T12:00:00.000Z'
      },
      list: [{
        registrationId: 'reg_2',
        status: 'registered',
        paymentStatus: 'pending',
        paidAmount: 0,
        reminderGranted: false,
        registeredAt: '2026-06-27T03:00:00.000Z',
        user: {
          userId: 'user_2',
          nickname: '小白',
          phoneMasked: '139****0000',
          totalCheckinDays: 2,
          summary: { enrollmentCount: 1 }
        },
        payment: { status: 'pending', amount: 0 }
      }],
      pagination: { page: 2, pageSize: 20, total: 2, totalPages: 2, hasMore: false }
    });

    pageInstance.setData({
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 2, hasMore: true }
    });
    await pageInstance.handleLoadMore.call(pageInstance);

    expect(service.getActivityRegistrations).toHaveBeenLastCalledWith('activity_1', {
      q: '狮子',
      page: 2,
      pageSize: 20
    });
    expect(pageInstance.data.registrations).toHaveLength(3);
    expect(pageInstance.data.registrations[2].user.displayName).toBe('小白');
  });

  test('filters registrations from stats and opens detail', async () => {
    await pageInstance.onLoad.call(pageInstance, { activityId: 'activity_1' });

    pageInstance.handleFilterByStat.call(pageInstance, {
      currentTarget: {
        dataset: {
          fieldId: 'note',
          optionId: '靠窗座位',
          registrationIds: ['reg_2'],
          label: '备注：靠窗座位'
        }
      }
    });

    expect(pageInstance.data.activeTab).toBe('list');
    expect(pageInstance.data.visibleRegistrations).toHaveLength(1);
    expect(pageInstance.data.visibleRegistrations[0].registrationId).toBe('reg_2');

    pageInstance.handleCardTap.call(pageInstance, {
      currentTarget: { dataset: { id: 'reg_2' } }
    });

    expect(pageInstance.data.showRegistrationDetail).toBe(true);
    expect(pageInstance.data.selectedRegistration.formAnswers[0].displayValue).toBe('杭州');
  });
});
