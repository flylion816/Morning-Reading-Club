jest.mock('../../pages/admin-workbench/adminWorkbench.service', () => ({
  searchUsers: jest.fn(),
  getUserDetail: jest.fn(),
  getActivities: jest.fn(),
  getActivityRegistrations: jest.fn()
}));

describe('admin workbench page', () => {
  let pageConfig;
  let pageInstance;
  let service;

  beforeEach(() => {
    jest.resetModules();
    wx.navigateTo.mockClear();
    pageConfig = null;
    global.Page = jest.fn((config) => {
      pageConfig = config;
      return config;
    });

    service = require('../../pages/admin-workbench/adminWorkbench.service');
    service.searchUsers.mockResolvedValue({
      list: [{
        userId: 'user_1',
        nickname: '狮子学员',
        phoneMasked: '150****8787',
        summary: {
          enrollmentCount: 1,
          paidEnrollmentCount: 1,
          activityRegistrationCount: 1,
          latestEnrollment: { periodName: '第八期', paymentStatus: 'paid' }
        }
      }],
      pagination: { page: 1, pageSize: 20, total: 1, hasMore: false }
    });
    service.getUserDetail.mockResolvedValue({
      user: {
        userId: 'user_1',
        nickname: '狮子学员',
        phoneMasked: '150****8787',
        totalCheckinDays: 9,
        status: 'active'
      },
      enrollments: [{
        enrollmentId: 'enroll_1',
        periodName: '第八期',
        status: 'active',
        paymentStatus: 'paid',
        paymentAmount: 9900,
        enrolledAt: '2026-06-02T01:00:00.000Z',
        latestPayment: { status: 'completed', amount: 9900 }
      }],
      activityRegistrations: [{
        registrationId: 'reg_1',
        status: 'registered',
        paymentStatus: 'paid',
        paidAmount: 1200,
        registeredAt: '2026-06-27T02:00:00.000Z',
        user: { userId: 'user_1', nickname: '狮子学员', phoneMasked: '150****8787' },
        payment: { status: 'completed', amount: 1200 },
        activity: { activityId: 'activity_1', title: '线下共读会', startTime: '2026-06-28T12:00:00.000Z' }
      }]
    });
    service.getActivities.mockResolvedValue({
      list: [{
        activityId: 'activity_1',
        title: '线下共读会',
        status: 'published',
        startTime: '2026-06-28T12:00:00.000Z',
        isPaid: true,
        price: 1200,
        registrationCount: 1,
        paidCount: 1,
        pendingCount: 0
      }],
      pagination: { page: 1, pageSize: 20, total: 1, hasMore: false }
    });
    service.getActivityRegistrations.mockResolvedValue({
      activity: {
        activityId: 'activity_1',
        title: '线下共读会',
        status: 'published',
        startTime: '2026-06-28T12:00:00.000Z',
        isPaid: true,
        price: 1200
      },
      list: [{
        registrationId: 'reg_1',
        status: 'registered',
        paymentStatus: 'paid',
        paidAmount: 1200,
        reminderGranted: true,
        registeredAt: '2026-06-27T02:00:00.000Z',
        user: { userId: 'user_1', nickname: '狮子学员', phoneMasked: '150****8787' },
        payment: { status: 'completed', amount: 1200 }
      }],
      pagination: { page: 1, pageSize: 20, total: 1, hasMore: false }
    });

    require('../../pages/admin-workbench/admin-workbench');
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

  test('loads activities on page load', async () => {
    await pageInstance.onLoad.call(pageInstance);

    expect(pageInstance.data.activeTab).toBe('activities');
    expect(service.getActivities).toHaveBeenCalledWith({
      q: '',
      page: 1,
      pageSize: 20
    });
    expect(pageInstance.data.activities[0].title).toBe('线下共读会');
    expect(pageInstance.data.activities[0].priceText).toBe('¥12.00');
  });

  test('searches users and opens user detail', async () => {
    pageInstance.handleUserKeywordInput.call(pageInstance, { detail: { value: '狮子' } });
    await pageInstance.handleUserSearch.call(pageInstance);
    await pageInstance.handleUserTap.call(pageInstance, { currentTarget: { dataset: { id: 'user_1' } } });

    expect(service.searchUsers).toHaveBeenCalledWith({
      q: '狮子',
      page: 1,
      pageSize: 20
    });
    expect(pageInstance.data.users[0].displayName).toBe('狮子学员');
    expect(pageInstance.data.users[0].latestEnrollmentText).toBe('第八期 · 已支付');
    expect(service.getUserDetail).toHaveBeenCalledWith('user_1');
    expect(pageInstance.data.selectedUserDetail.enrollments[0].paymentAmountText).toBe('¥99.00');
  });

  test('navigates to registration page after selecting activity', async () => {
    await pageInstance.loadActivities.call(pageInstance);
    pageInstance.handleActivityTap.call(pageInstance, {
      currentTarget: { dataset: { id: 'activity_1' } }
    });

    expect(service.getActivityRegistrations).not.toHaveBeenCalled();
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/admin-workbench/activity-registrations/activity-registrations?activityId=activity_1'
    });
  });
});
