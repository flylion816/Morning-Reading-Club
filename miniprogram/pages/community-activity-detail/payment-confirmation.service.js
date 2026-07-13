const request = require('../../utils/request');

module.exports = {
  confirmPayment(paymentId, data = {}) {
    return request.post(`/payments/${paymentId}/confirm`, data);
  }
};
