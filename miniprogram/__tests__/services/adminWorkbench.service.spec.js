const request = require('../../utils/request');
const adminWorkbenchService = require('../../pages/admin-workbench/adminWorkbench.service');

jest.mock('../../utils/request');

describe('Admin Workbench Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    request.get.mockResolvedValue({});
  });

  test('should search users with cleaned params', async () => {
    await adminWorkbenchService.searchUsers({ q: '狮子', page: 1, empty: '' });

    expect(request.get).toHaveBeenCalledWith(
      '/mobile-admin/workbench/users',
      { q: '狮子', page: 1 },
      { showLoading: false }
    );
  });

  test('should request user detail', async () => {
    await adminWorkbenchService.getUserDetail('user_1');

    expect(request.get).toHaveBeenCalledWith(
      '/mobile-admin/workbench/users/user_1',
      {},
      { showLoading: false }
    );
  });

  test('should request activity registrations', async () => {
    await adminWorkbenchService.getActivityRegistrations('activity_1', { page: 2 });

    expect(request.get).toHaveBeenCalledWith(
      '/mobile-admin/workbench/activities/activity_1/registrations',
      { page: 2 },
      { showLoading: false }
    );
  });
});
