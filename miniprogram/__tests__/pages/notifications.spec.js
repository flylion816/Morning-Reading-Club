jest.mock('../../services/notification.service', () => ({
  __esModule: true,
  default: {
    getNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    deleteNotification: jest.fn(),
    getTypeIcon: jest.fn(() => '🔔'),
    getTypeLabel: jest.fn(type => type),
    getTypeColor: jest.fn(() => '#4a90e2'),
    formatTime: jest.fn(() => '刚刚')
  }
}));

jest.mock('../../pages/notifications/websocket.service', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(() => Promise.resolve()),
    on: jest.fn(() => jest.fn())
  }
}));

describe('notifications page', () => {
  let pageConfig;
  let pageInstance;
  let notificationService;

  beforeEach(() => {
    jest.resetModules();
    pageConfig = null;

    global.Page = jest.fn(config => {
      pageConfig = config;
      return config;
    });

    wx.navigateTo.mockClear();
    wx.switchTab.mockClear();

    notificationService = require('../../services/notification.service').default;
    notificationService.markAsRead.mockReset();
    notificationService.markAsRead.mockResolvedValue({});
    notificationService.getNotifications.mockReset();
    notificationService.getUnreadCount.mockReset();

    require('../../pages/notifications/notifications');

    pageInstance = {
      ...pageConfig,
      data: JSON.parse(JSON.stringify(pageConfig.data)),
      setData(update) {
        this.data = {
          ...this.data,
          ...update
        };
      }
    };
  });

  afterEach(() => {
    delete global.Page;
  });

  test('should open other user profile page for approved insight request notification', async () => {
    const notification = pageInstance.decorateNotification.call(pageInstance, {
      _id: 'notice_1',
      type: 'request_approved',
      isRead: false,
      senderId: {
        _id: 'user_target',
        nickname: '被申请人'
      },
      data: {
        periodId: 'period_1'
      }
    });

    pageInstance.setData({
      notifications: [notification]
    });

    await pageInstance.handleNotificationTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          id: 'notice_1'
        }
      }
    });

    expect(notificationService.markAsRead).toHaveBeenCalledWith('notice_1');
    expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/profile-others/profile-others?userId=user_target&periodId=period_1'
    }));
  });

  test('should switch to home tab for new insight request notification', async () => {
    const notification = pageInstance.decorateNotification.call(pageInstance, {
      _id: 'notice_2',
      type: 'request_created',
      isRead: true,
      data: {
        targetPage: 'pages/index/index'
      }
    });

    pageInstance.setData({
      notifications: [notification]
    });

    await pageInstance.handleNotificationTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          id: 'notice_2'
        }
      }
    });

    expect(wx.switchTab).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/index/index'
    }));
  });

  test('should ignore legacy profile target for new insight request notification', async () => {
    const notification = pageInstance.decorateNotification.call(pageInstance, {
      _id: 'notice_legacy_profile',
      type: 'request_created',
      isRead: true,
      data: {
        targetPage: 'pages/profile/profile'
      }
    });

    pageInstance.setData({
      notifications: [notification]
    });

    await pageInstance.handleNotificationTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          id: 'notice_legacy_profile'
        }
      }
    });

    expect(wx.switchTab).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/index/index'
    }));
  });

  test('should navigate immediately when action hint is tapped', () => {
    notificationService.markAsRead.mockImplementation(() => new Promise(() => {}));

    const notification = pageInstance.decorateNotification.call(pageInstance, {
      _id: 'notice_3',
      type: 'request_created',
      isRead: false,
      data: {
        targetPage: 'pages/index/index'
      }
    });

    pageInstance.setData({
      notifications: [notification],
      displayedNotifications: [notification],
      unreadCount: 1
    });

    pageInstance.handleNotificationActionTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          id: 'notice_3'
        }
      }
    });

    expect(notificationService.markAsRead).toHaveBeenCalledWith('notice_3');
    expect(wx.switchTab).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/index/index'
    }));
  });

  test('should still navigate when dataset id is missing but index is present', () => {
    const notification = pageInstance.decorateNotification.call(pageInstance, {
      _id: 'notice_4',
      type: 'request_created',
      isRead: true,
      data: {
        targetPage: 'pages/index/index'
      }
    });

    pageInstance.setData({
      notifications: [notification],
      displayedNotifications: [notification]
    });

    pageInstance.handleNotificationActionTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          index: 0
        }
      }
    });

    expect(wx.switchTab).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/index/index'
    }));
  });
});
