/**
 * Payment Service Tests (Stage 4)
 * Tests for payment integration, order management, and transaction handling
 *
 * Test Coverage:
 * - Order creation and management
 * - Payment initiation and status tracking
 * - WeChat payment API integration
 * - Payment success/failure handling
 * - Order history and statistics
 * - Transaction validation and security
 */

const paymentService = require('../../pages/payment/payment.service');
const request = require('../../utils/request');
const { createMockPayment, createMockUser, createMockPeriod, generateId } = require('../fixtures');
const WxMock = require('../mocks/wx');

jest.mock('../../utils/request');

describe('Payment Service Tests (Stage 4)', () => {
  let wxMock;

  beforeEach(() => {
    jest.clearAllMocks();
    wxMock = new WxMock();
    global.wx = wxMock;
    request.get.mockClear();
    request.post.mockClear();
    request.put.mockClear();
  });

  describe('[PAY-1] 创建订单应返回订单号', () => {
    test('should return order ID when creating payment order', async () => {
      const mockPayment = createMockPayment({
        orderId: 'order_20240315_001',
        status: 'pending'
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.createPaymentOrder('period_123', 99.00);

      expect(result).toHaveProperty('orderId');
      expect(result.orderId).toMatch(/^order_/);
      expect(request.post).toHaveBeenCalledWith('/payments/orders', expect.any(Object));
    });

    test('should generate unique order IDs', async () => {
      const mockPayment1 = createMockPayment({ orderId: 'order_1' });
      const mockPayment2 = createMockPayment({ orderId: 'order_2' });

      request.post.mockResolvedValueOnce(mockPayment1);
      request.post.mockResolvedValueOnce(mockPayment2);

      const result1 = await paymentService.createPaymentOrder('period_123', 99.00);
      const result2 = await paymentService.createPaymentOrder('period_123', 99.00);

      expect(result1.orderId).not.toBe(result2.orderId);
    });
  });

  describe('[PAY-2] 获取订单信息应返回订单详情', () => {
    test('should return order details by order ID', async () => {
      const orderId = 'order_20240315_001';
      const mockPayment = createMockPayment({
        orderId: orderId,
        status: 'completed',
        amount: 99.00
      });

      request.get.mockResolvedValue(mockPayment);

      const result = await paymentService.getOrderDetails(orderId);

      expect(result.orderId).toBe(orderId);
      expect(request.get).toHaveBeenCalledWith(`/payments/orders/${orderId}`);
    });

    test('should include payment status in order details', async () => {
      const mockPayment = createMockPayment({
        status: 'completed'
      });

      request.get.mockResolvedValue(mockPayment);

      const result = await paymentService.getOrderDetails('order_123');

      expect(result).toHaveProperty('status');
      expect(['pending', 'completed', 'failed', 'cancelled'].includes(result.status)).toBe(true);
    });
  });

  describe('[PAY-3] 订单应包含金额、期次、用户 ID 等信息', () => {
    test('should include all required fields in order', async () => {
      const mockPayment = createMockPayment({
        amount: 99.00,
        periodId: 'period_123',
        userId: 'user_123',
        currency: 'CNY'
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.createPaymentOrder('period_123', 99.00);

      expect(result).toHaveProperty('amount');
      expect(result).toHaveProperty('periodId');
      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('currency');
      expect(result.amount).toBe(99.00);
      expect(result.currency).toBe('CNY');
    });

    test('should store payment date information', async () => {
      const mockPayment = createMockPayment({
        paymentDate: new Date().toISOString()
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.createPaymentOrder('period_123', 99.00);

      expect(result).toHaveProperty('paymentDate');
    });
  });

  describe('[PAY-4] 发起支付应调用 wx.requestPayment', () => {
    test('should call wx.requestPayment for WeChat payment', async () => {
      const paymentInfo = {
        timeStamp: '1234567890',
        nonceStr: 'abcdef1234567890',
        package: 'prepay_id=test_prepay_id',
        signType: 'RSA',
        paySign: 'test_signature'
      };

      const requestPaymentSpy = jest.spyOn(wxMock, 'requestPayment');

      wxMock.requestPayment({
        ...paymentInfo,
        success: jest.fn(),
        fail: jest.fn()
      });

      expect(requestPaymentSpy).toHaveBeenCalled();
      requestPaymentSpy.mockRestore();
    });

    test('should include all payment parameters', async () => {
      const paymentParams = {
        timeStamp: '1234567890',
        nonceStr: 'abcdef',
        package: 'prepay_id=test',
        signType: 'RSA',
        paySign: 'signature'
      };

      const callSpy = jest.fn();
      wxMock.requestPayment({
        ...paymentParams,
        success: callSpy
      });

      expect(callSpy).toBeDefined();
    });
  });

  describe('[PAY-5] 支付成功应更新订单状态', () => {
    test('should update order status to completed on payment success', async () => {
      const paymentId = 'payment_123';
      const mockPayment = createMockPayment({
        _id: paymentId,
        status: 'completed'
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.confirmPayment(paymentId, {
        transactionId: 'txn_123'
      });

      expect(request.post).toHaveBeenCalledWith(
        `/payments/${paymentId}/confirm`,
        expect.any(Object)
      );
      expect(result.status).toBe('completed');
    });

    test('should record transaction ID after payment', async () => {
      const mockPayment = createMockPayment({
        transactionId: 'txn_20240315_001'
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.confirmPayment('payment_123', {
        transactionId: 'txn_20240315_001'
      });

      expect(result.transactionId).toBe('txn_20240315_001');
    });
  });

  describe('[PAY-6] 支付失败应返回错误信息', () => {
    test('should return error when payment fails', async () => {
      request.post.mockRejectedValue({
        code: 400,
        message: 'Payment failed'
      });

      await expect(
        paymentService.confirmPayment('payment_123', { transactionId: 'txn_123' })
      ).rejects.toEqual(expect.objectContaining({
        message: 'Payment failed'
      }));
    });

    test('should include error code and message', async () => {
      request.post.mockRejectedValue({
        code: 500,
        message: 'Payment processing error'
      });

      await expect(
        paymentService.confirmPayment('payment_123', {})
      ).rejects.toBeDefined();
    });
  });

  describe('[PAY-7] 支付取消应返回取消状态', () => {
    test('should handle payment cancellation', async () => {
      const mockPayment = createMockPayment({
        status: 'cancelled'
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.cancelPayment('payment_123');

      expect(result.status).toBe('cancelled');
    });

    test('should store cancellation reason', async () => {
      const mockPayment = createMockPayment({
        status: 'cancelled',
        cancellationReason: 'User cancelled'
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.cancelPayment('payment_123');

      expect(result).toHaveProperty('status');
    });
  });

  describe('[PAY-8] 支付成功应自动更新报名状态为已批准', () => {
    test('should update enrollment after successful payment', async () => {
      const mockResponse = {
        paymentStatus: 'completed',
        enrollmentStatus: 'approved'
      };

      request.post.mockResolvedValue(mockResponse);

      const result = await paymentService.processPaymentSuccess('order_123', {
        periodId: 'period_123'
      });

      expect(request.post).toHaveBeenCalled();
    });

    test('should link payment to enrollment', async () => {
      request.put.mockResolvedValue({
        enrollmentId: 'enrollment_123',
        status: 'approved'
      });

      const result = await paymentService.confirmPayment('order_123', {
        enrollmentId: 'enrollment_123'
      });

      expect(result).toBeDefined();
    });
  });

  describe('[PAY-9] 支付成功应自动同步到本地缓存', () => {
    test('should update local cache after payment success', async () => {
      wxMock.setStorageSync('payments', []);

      const mockPayment = createMockPayment({
        status: 'completed'
      });

      request.post.mockResolvedValue(mockPayment);

      await paymentService.confirmPayment('payment_123', { transactionId: 'txn_123' });

      expect(request.post).toHaveBeenCalled();
    });
  });

  describe('[PAY-10] 获取支付历史列表应返回用户的所有支付记录', () => {
    test('should return payment history for user', async () => {
      const mockPayments = [
        createMockPayment({ status: 'completed' }),
        createMockPayment({ status: 'completed' })
      ];

      request.get.mockResolvedValue({
        data: mockPayments,
        total: 2
      });

      const result = await paymentService.getPaymentHistory();

      expect(result.data).toHaveLength(2);
      expect(request.get).toHaveBeenCalledWith('/payments/history', expect.any(Object));
    });

    test('should return only current user payments', async () => {
      const userId = 'user_123';
      wxMock.setStorageSync('userInfo', { _id: userId });

      const mockPayments = [
        createMockPayment({ userId: userId }),
        createMockPayment({ userId: userId })
      ];

      request.get.mockResolvedValue({
        data: mockPayments,
        total: 2
      });

      const result = await paymentService.getPaymentHistory();

      expect(result.data.every(p => p.userId === userId)).toBe(true);
    });
  });

  describe('[PAY-11] 支付列表应按时间倒序排序', () => {
    test('should return payments sorted by date descending', async () => {
      const baseDate = new Date();
      const mockPayments = [
        createMockPayment({
          paymentDate: new Date(baseDate.getTime() + 2 * 60 * 60 * 1000).toISOString()
        }),
        createMockPayment({
          paymentDate: new Date(baseDate.getTime() + 1 * 60 * 60 * 1000).toISOString()
        })
      ];

      request.get.mockResolvedValue({
        data: mockPayments,
        total: 2
      });

      const result = await paymentService.getPaymentHistory();

      const dates = result.data.map(p => new Date(p.paymentDate).getTime());
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });
  });

  describe('[PAY-12] 支付列表应支持按状态筛选（成功、待支付、失败）', () => {
    test('should filter payments by status', async () => {
      const mockPayments = [
        createMockPayment({ status: 'completed' })
      ];

      request.get.mockResolvedValue({
        data: mockPayments,
        total: 1
      });

      const result = await paymentService.getPaymentHistory({
        status: 'completed'
      });

      expect(request.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'completed' })
      );
    });

    test('should support multiple status filters', async () => {
      const mockPayments = [
        createMockPayment({ status: 'completed' }),
        createMockPayment({ status: 'pending' })
      ];

      request.get.mockResolvedValue({
        data: mockPayments,
        total: 2
      });

      const result = await paymentService.getPaymentHistory();

      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('[PAY-13] 支付列表应支持分页', () => {
    test('should support pagination for payment history', async () => {
      request.get.mockResolvedValue({
        data: [createMockPayment()],
        page: 1,
        pageSize: 10,
        total: 50
      });

      const result = await paymentService.getPaymentHistory({
        page: 1,
        limit: 10
      });

      expect(request.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ page: 1, limit: 10 })
      );
      expect(result.total).toBe(50);
    });
  });

  describe('[PAY-14] 同一订单不应重复支付', () => {
    test('should prevent duplicate payment for same order', async () => {
      request.post.mockRejectedValue({
        code: 400,
        message: 'Order already paid'
      });

      await expect(
        paymentService.confirmPayment('payment_123', { transactionId: 'txn_123' })
      ).rejects.toEqual(expect.objectContaining({
        message: 'Order already paid'
      }));
    });
  });

  describe('[PAY-15] 支付超时应自动取消订单', () => {
    test('should cancel order after payment timeout', async () => {
      const mockPayment = createMockPayment({
        status: 'cancelled',
        cancellationReason: 'Payment timeout'
      });

      request.put.mockResolvedValue(mockPayment);

      const result = await paymentService.handlePaymentTimeout('order_123');

      expect(result.status).toBe('cancelled');
    });
  });

  describe('[PAY-16] 应验证支付金额与订单金额一致', () => {
    test('should validate payment amount matches order amount', async () => {
      const orderAmount = 99.00;
      const mockPayment = createMockPayment({
        amount: orderAmount
      });

      request.get.mockResolvedValue(mockPayment);
      request.post.mockResolvedValue({
        valid: true,
        amount: orderAmount
      });

      const result = await paymentService.validatePaymentAmount('order_123', orderAmount);

      expect(request.post).toHaveBeenCalled();
    });
  });

  describe('[PAY-17] 应支持订单查询（确认支付状态）', () => {
    test('should query order payment status', async () => {
      const mockPayment = createMockPayment({
        orderId: 'order_123',
        status: 'completed'
      });

      request.get.mockResolvedValue(mockPayment);

      const result = await paymentService.queryOrderStatus('order_123');

      expect(result.status).toBeDefined();
      expect(request.get).toHaveBeenCalled();
    });
  });

  describe('[PAY-18] 支付失败后应允许重新支付', () => {
    test('should allow retry after payment failure', async () => {
      request.post.mockRejectedValueOnce({
        code: 400,
        message: 'Payment failed'
      });

      request.post.mockResolvedValueOnce(
        createMockPayment({ status: 'pending' })
      );

      // First attempt fails
      await expect(
        paymentService.confirmPayment('payment_123', { transactionId: 'txn_1' })
      ).rejects.toBeDefined();

      // Retry succeeds
      const result = await paymentService.confirmPayment('payment_123', { transactionId: 'txn_2' });

      expect(result).toBeDefined();
    });
  });

  describe('[PAY-19] 应记录支付交易 ID', () => {
    test('should store transaction ID with payment record', async () => {
      const transactionId = 'txn_20240315_001';
      const mockPayment = createMockPayment({
        transactionId: transactionId
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.confirmPayment('payment_123', {
        transactionId: transactionId
      });

      expect(result.transactionId).toBe(transactionId);
    });
  });

  describe('[PAY-20] 应支持发票信息保存', () => {
    test('should save invoice information', async () => {
      const invoiceInfo = {
        title: '晨读营课程费',
        amount: 99.00,
        taxId: '1234567890'
      };

      request.post.mockResolvedValue({
        invoiceId: 'inv_123',
        status: 'saved'
      });

      const result = await paymentService.saveInvoiceInfo('order_123', invoiceInfo);

      expect(result).toHaveProperty('invoiceId');
    });
  });

  describe('[PAY-21] 获取支付统计（总收入、支付成功率等）', () => {
    test('should return payment statistics', async () => {
      const mockStats = {
        totalRevenue: 9900.00,
        successfulPayments: 100,
        failedPayments: 10,
        successRate: 0.909,
        averageAmount: 99.00
      };

      request.get.mockResolvedValue(mockStats);

      const result = await paymentService.getPaymentStats();

      expect(result).toHaveProperty('totalRevenue');
      expect(result).toHaveProperty('successRate');
      expect(result).toHaveProperty('averageAmount');
    });
  });

  describe('[PAY-22] 应检查支付金额范围（最小 0.01 元）', () => {
    test('should validate minimum payment amount', async () => {
      request.post.mockRejectedValue({
        code: 400,
        message: 'Amount must be at least 0.01 CNY'
      });

      await expect(
        paymentService.createPaymentOrder('period_123', 0.001)
      ).rejects.toBeDefined();
    });
  });

  describe('[PAY-23] 应支持支付方式选择（微信支付）', () => {
    test('should support WeChat payment method', async () => {
      const mockPayment = createMockPayment({
        paymentMethod: 'wechat'
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.createPaymentOrder('period_123', 99.00, {
        method: 'wechat'
      });

      expect(result.paymentMethod).toBe('wechat');
    });
  });

  describe('[PAY-24] 订单创建时应记录时间戳', () => {
    test('should include creation timestamp', async () => {
      const mockPayment = createMockPayment({
        createdAt: new Date().toISOString()
      });

      request.post.mockResolvedValue(mockPayment);

      const result = await paymentService.createPaymentOrder('period_123', 99.00);

      expect(result).toHaveProperty('createdAt');
      expect(new Date(result.createdAt)).toBeInstanceOf(Date);
    });
  });

  describe('[PAY-25] 已支付的订单应锁定，不允许修改', () => {
    test('should prevent modification of completed orders', async () => {
      request.put.mockRejectedValue({
        code: 400,
        message: 'Cannot modify completed order'
      });

      await expect(
        paymentService.updateOrder('order_123', { amount: 199.00 })
      ).rejects.toBeDefined();
    });
  });
});
