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

class AdminAnalyticsService {
  getPeriods() {
    return request.get('/mobile-admin/analytics/periods', {}, { showLoading: false });
  }

  getOverview(params = {}) {
    return request.get(
      '/mobile-admin/analytics/overview',
      cleanParams(params),
      { showLoading: false }
    );
  }

  getActivity(params = {}) {
    return request.get(
      '/mobile-admin/analytics/activity',
      cleanParams(params),
      { showLoading: false }
    );
  }
}

module.exports = new AdminAnalyticsService();
