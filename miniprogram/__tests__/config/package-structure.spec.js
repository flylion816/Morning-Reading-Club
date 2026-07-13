const fs = require('fs');
const path = require('path');

const miniprogramRoot = path.resolve(__dirname, '../..');
const appJson = JSON.parse(
  fs.readFileSync(path.join(miniprogramRoot, 'app.json'), 'utf8')
);

const expectedSubPackages = [
  {
    name: 'zaichang',
    root: 'pages/zaichang',
    pages: ['list/list', 'detail/detail', 'publish/publish']
  },
  {
    name: 'admin-analytics',
    root: 'pages/admin-analytics',
    pages: ['admin-analytics']
  },
  {
    name: 'admin-workbench',
    root: 'pages/admin-workbench',
    pages: [
      'admin-workbench',
      'activity-registrations/activity-registrations'
    ]
  },
  {
    name: 'admin-section-insights',
    root: 'pages/admin-section-insights',
    pages: ['admin-section-insights']
  },
  {
    name: 'community-activity-detail',
    root: 'pages/community-activity-detail',
    pages: ['community-activity-detail']
  },
  {
    name: 'my-community-activities',
    root: 'pages/my-community-activities',
    pages: ['my-community-activities']
  },
  {
    name: 'activities',
    root: 'pages/activities',
    pages: ['activities']
  },
  {
    name: 'my-coupons',
    root: 'pages/my-coupons',
    pages: ['my-coupons']
  },
  {
    name: 'insight-detail',
    root: 'pages/insight-detail',
    pages: ['insight-detail']
  },
  {
    name: 'insight-edit',
    root: 'pages/insight-edit',
    pages: ['insight-edit']
  },
  {
    name: 'enrollment',
    root: 'pages/enrollment',
    pages: ['enrollment']
  },
  {
    name: 'payment',
    root: 'pages/payment',
    pages: ['payment']
  },
  {
    name: 'invite',
    root: 'pages/invite',
    pages: ['invite']
  },
  {
    name: 'notifications',
    root: 'pages/notifications',
    pages: ['notifications']
  },
  {
    name: 'notification-settings',
    root: 'pages/notification-settings',
    pages: ['notification-settings']
  },
  {
    name: 'completion-reports',
    root: 'pages/completion-reports',
    pages: ['completion-reports']
  },
  {
    name: 'completion-report-detail',
    root: 'pages/completion-report-detail',
    pages: ['completion-report-detail']
  },
  {
    name: 'checkin-records',
    root: 'pages/checkin-records',
    pages: ['checkin-records']
  },
  {
    name: 'profile-others',
    root: 'pages/profile-others',
    pages: ['profile-others']
  },
  {
    name: 'ranking',
    root: 'pages/ranking',
    pages: ['ranking']
  },
  {
    name: 'members',
    root: 'pages/members',
    pages: ['members']
  }
];

describe('miniprogram package structure', () => {
  test('keeps tab and core learning pages in the main package', () => {
    expect(appJson.pages).toEqual(expect.arrayContaining([
      'pages/index/index',
      'pages/periods/periods',
      'pages/profile/profile',
      'pages/course-detail/course-detail',
      'pages/checkin/checkin',
      'pages/insights/insights'
    ]));
  });

  test('does not declare duplicate main package routes', () => {
    expect(new Set(appJson.pages).size).toBe(appJson.pages.length);
  });

  test('keeps subpackage-only admin services out of the main services directory', () => {
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'services/adminAnalytics.service.js')
    )).toBe(false);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'services/adminWorkbench.service.js')
    )).toBe(false);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'pages/admin-analytics/adminAnalytics.service.js')
    )).toBe(true);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'pages/admin-workbench/adminWorkbench.service.js')
    )).toBe(true);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'services/danmaku.service.js')
    )).toBe(false);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'pages/insight-detail/danmaku.service.js')
    )).toBe(true);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'services/ranking.service.js')
    )).toBe(false);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'pages/ranking/ranking.service.js')
    )).toBe(true);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'services/payment.service.js')
    )).toBe(false);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'pages/payment/payment.service.js')
    )).toBe(true);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'pages/community-activity-detail/payment-confirmation.service.js')
    )).toBe(true);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'services/websocket.service.js')
    )).toBe(false);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'pages/notifications/websocket.service.js')
    )).toBe(true);
    expect(fs.existsSync(
      path.join(miniprogramRoot, 'components/notification-badge')
    )).toBe(false);
  });

  test('declares low-frequency pages in their owning subpackages', () => {
    expect(appJson.subPackages).toEqual(expectedSubPackages);

    expectedSubPackages.forEach(subPackage => {
      subPackage.pages.forEach(page => {
        const route = path.posix.join(subPackage.root, page);
        expect(appJson.pages).not.toContain(route);
        expect(fs.existsSync(path.join(miniprogramRoot, `${route}.js`))).toBe(true);
        expect(fs.existsSync(path.join(miniprogramRoot, `${route}.wxml`))).toBe(true);
      });
    });
  });
});
