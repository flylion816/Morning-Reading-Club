const request = require('../utils/request');

class SubscribeMessageService {
  getSettings(params = {}) {
    return request.get('/notifications/subscriptions', params);
  }

  saveGrants(grants = []) {
    return request.post('/notifications/subscriptions/grants', { grants });
  }
}

module.exports = new SubscribeMessageService();
