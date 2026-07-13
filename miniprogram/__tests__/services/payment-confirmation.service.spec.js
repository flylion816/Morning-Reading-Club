const request = require('../../utils/request');

jest.mock('../../utils/request');

describe('community activity payment confirmation service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('confirms a completed WeChat payment through the payment API', async () => {
    const paymentConfirmationService = require(
      '../../pages/community-activity-detail/payment-confirmation.service'
    );
    request.post.mockResolvedValue({ status: 'completed' });

    await paymentConfirmationService.confirmPayment('payment_1', {
      transactionId: ''
    });

    expect(request.post).toHaveBeenCalledWith('/payments/payment_1/confirm', {
      transactionId: ''
    });
  });
});
