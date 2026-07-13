const request = require('../../utils/request');

function cleanParams(params = {}) {
  return Object.keys(params).reduce((acc, key) => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') {
      acc[key] = value;
    }
    return acc;
  }, {});
}

class AdminWorkbenchService {
  searchUsers(params = {}) {
    return request.get(
      '/mobile-admin/workbench/users',
      cleanParams(params),
      { showLoading: false }
    );
  }

  getUserDetail(userId) {
    return request.get(
      `/mobile-admin/workbench/users/${userId}`,
      {},
      { showLoading: false }
    );
  }

  getActivities(params = {}) {
    return request.get(
      '/mobile-admin/workbench/activities',
      cleanParams(params),
      { showLoading: false }
    );
  }

  getActivityRegistrations(activityId, params = {}) {
    return request.get(
      `/mobile-admin/workbench/activities/${activityId}/registrations`,
      cleanParams(params),
      { showLoading: false }
    );
  }
}

module.exports = new AdminWorkbenchService();
