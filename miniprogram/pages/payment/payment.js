/**
 * 支付页面
 * 处理报名后的支付流程
 */

const paymentService = require('./payment.service');
const courseService = require('../../services/course.service');
const envConfig = require('../../config/env');
const subscribeAutoTopUp = require('../../utils/subscribe-auto-topup');
const { tenantStorage } = require('../../utils/storage');
const {
  getCachedEnrollmentAccess,
  setCachedEnrollmentAccess,
  signalEnrollmentChanged
} = require('../../utils/period-access');

const OPTIMISTIC_ENROLLMENT_TTL_MS = 2 * 60 * 1000;

function buildOptimisticEnrollmentAccess(enrollmentData, syncPending = true) {
  if (!enrollmentData || !enrollmentData.periodId) {
    return null;
  }

  return {
    periodId: enrollmentData.periodId,
    isEnrolled: true,
    paymentStatus: 'paid',
    enrollmentId: enrollmentData.enrollmentId || '',
    paymentPending: false,
    canAccessCommunity: true,
    communityAccessState: 'enabled',
    communityLocked: false,
    syncPending,
    syncPendingExpiresAt: syncPending
      ? new Date(Date.now() + OPTIMISTIC_ENROLLMENT_TTL_MS).toISOString()
      : null,
    updatedAt: new Date().toISOString()
  };
}

function applyOptimisticEnrollmentAccess(enrollmentData, syncPending = true) {
  const access = buildOptimisticEnrollmentAccess(enrollmentData, syncPending);
  if (!access) {
    return;
  }

  setCachedEnrollmentAccess(enrollmentData.periodId, access);
}

function normalizeAmountInCents(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function formatAmountInYuan(amountInCents = 0) {
  return (normalizeAmountInCents(amountInCents) / 100).toFixed(2);
}

Page({
  data: {
    loading: true,
    paying: false,
    paymentMethod: '', // 'wechat' or 'mock'
    isDevelopment: envConfig.currentEnv !== 'prod', // 是否为开发/测试环境

    // 订单数据
    enrollmentData: {
      enrollmentId: '',
      periodId: '',
      periodTitle: '',
      startDate: '',
      endDate: ''
    },

    // 支付金额
    paymentAmount: 9900, // 单位：分
    discountAmount: 0, // 单位：分
    finalAmount: 9900, // 单位：分
    paymentAmountDisplay: '99.00',
    discountAmountDisplay: '0.00',
    finalAmountDisplay: '99.00',

    // 支付结果
    showPaymentResult: false,
    paymentResult: {
      success: false,
      title: '',
      message: ''
    }
  },

  onLoad(options) {
    // 从路由参数获取报名信息
    const { enrollmentId, periodId, periodTitle, startDate, endDate, amount } = options;

    if (!enrollmentId || !periodId) {
      wx.showToast({
        title: '参数错误，请重新操作',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 1500);
      return;
    }

    // amount 单位为"分"（100分 = 1元）
    const finalAmount = normalizeAmountInCents(amount, 0);
    this.setData({
      'enrollmentData.enrollmentId': enrollmentId,
      'enrollmentData.periodId': periodId,
      'enrollmentData.periodTitle': periodTitle || '晨读营课程',
      'enrollmentData.startDate': startDate || '2025-11-10',
      'enrollmentData.endDate': endDate || '2025-12-02',
      paymentMethod: 'wechat',
      loading: false
    });
    this.updateAmountDisplay(finalAmount);
    this.syncPeriodPrice(periodId, finalAmount);
  },

  updateAmountDisplay(amountInCents, discountInCents = 0) {
    const normalizedAmount = normalizeAmountInCents(amountInCents, 0);
    const normalizedDiscount = normalizeAmountInCents(discountInCents, 0);
    const normalizedFinalAmount = Math.max(normalizedAmount - normalizedDiscount, 0);

    this.setData({
      paymentAmount: normalizedAmount,
      discountAmount: normalizedDiscount,
      finalAmount: normalizedFinalAmount,
      paymentAmountDisplay: formatAmountInYuan(normalizedAmount),
      discountAmountDisplay: formatAmountInYuan(normalizedDiscount),
      finalAmountDisplay: formatAmountInYuan(normalizedFinalAmount)
    });
  },

  async syncPeriodPrice(periodId, fallbackAmount = 0) {
    try {
      const response = await courseService.getPeriods();
      const periods = response.list || response.items || response || [];
      const matchedPeriod = periods.find(item => item.id === periodId || item._id === periodId);
      const latestAmount = normalizeAmountInCents(matchedPeriod?.price, fallbackAmount);
      this.updateAmountDisplay(latestAmount);
    } catch (error) {
      console.warn('同步期次价格失败，使用页面金额兜底:', error);
      this.updateAmountDisplay(fallbackAmount);
    }
  },

  /**
   * 选择支付方式
   */
  selectPaymentMethod(e) {
    const method = e.currentTarget.dataset.method;
    this.setData({ paymentMethod: method });
  },

  /**
   * 处理支付
   */
  async handlePayment() {
    const { paymentMethod } = this.data;

    if (!paymentMethod) {
      wx.showToast({
        title: '请选择支付方式',
        icon: 'none'
      });
      return;
    }

    this.setData({ paying: true });

    try {
      if (paymentMethod === 'wechat') {
        // 真实微信支付流程
        await this.handleWechatPayment();
      } else if (paymentMethod === 'mock') {
        // 模拟支付流程（开发测试）
        await this.handleMockPayment();
      }
    } catch (error) {
      console.error('支付失败:', error);

      // 从错误对象中提取错误消息
      let errorMessage = '支付失败，请重试';

      // 优先级顺序：error.data.message > error.message > 默认值
      if (error && error.data && error.data.message) {
        errorMessage = error.data.message;
      } else if (error && error.message) {
        errorMessage = error.message;
      }

      this.showPaymentFailed('支付失败', errorMessage);
    } finally {
      this.setData({ paying: false });
    }
  },

  /**
   * 微信支付流程
   */
  async handleWechatPayment() {
    try {
      const { enrollmentData, finalAmount } = this.data;

      await subscribeAutoTopUp.maybeAutoTopUpSubscriptions({
        sourceAction: 'payment_click',
        sourcePage: 'payment',
        periodId: enrollmentData.periodId,
        sceneKeys: ['payment_result'],
        requestMode: 'any'
      });

      // 1. 调用后端初始化支付并获取支付参数
      console.log('初始化微信支付...');
      const initRes = await paymentService.initiatePayment({
        enrollmentId: enrollmentData.enrollmentId,
        paymentMethod: 'wechat',
        amount: finalAmount
      });

      if (!initRes || !initRes.paymentId) {
        throw new Error('支付初始化失败：无效的响应');
      }

      console.log('支付初始化成功，获取支付参数:', {
        paymentId: initRes.paymentId,
        orderNo: initRes.orderNo,
        amount: initRes.amount,
        status: initRes.status
      });

      if (typeof initRes.amount !== 'undefined') {
        this.updateAmountDisplay(initRes.amount);
      }

      // 检查是否获取到微信支付参数
      if (!initRes.timeStamp || !initRes.nonceStr || !initRes.package || !initRes.paySign) {
        console.warn('未获取到完整的微信支付参数，可能的原因：');
        console.warn('1. 后端配置了微信商户信息（WECHAT_MCH_ID, WECHAT_API_KEY）');
        console.warn('2. 微信 API 调用失败');
        console.warn('响应数据:', initRes);

        // 在开发环境下，使用模拟参数继续测试
        if (this.data.isDevelopment) {
          console.log('使用模拟支付参数进行测试...');
          return this.handleMockWechatPayment(initRes.paymentId);
        }

        throw new Error(initRes.message || '获取微信支付参数失败，请稍后重试');
      }

      // 2. 调用微信支付 JSAPI
      console.log('调用微信支付 JSAPI...');
      const paymentParams = {
        timeStamp: initRes.timeStamp,
        nonceStr: initRes.nonceStr,
        package: initRes.package,
        signType: initRes.signType,
        paySign: initRes.paySign
      };

      console.log('支付参数:', paymentParams);

      // 3. 执行微信支付
      return new Promise((resolve, reject) => {
        wx.requestPayment({
          ...paymentParams,
          success: res => {
            console.log('微信支付成功:', res);

            applyOptimisticEnrollmentAccess(enrollmentData, true);
            signalEnrollmentChanged();
            this.handlePaymentSuccess();
            // 4. 支付成功后，异步通知后端确认支付，不阻塞成功态
            this.confirmPaymentWithBackend(initRes.paymentId, enrollmentData.periodId);
            resolve(res);
          },
          fail: err => {
            console.error('微信支付失败:', err);
            // 用户取消支付时 errMsg 为 "requestPayment:fail cancel"
            if (err.errMsg && err.errMsg.includes('cancel')) {
              wx.showToast({
                title: '已取消支付',
                icon: 'none'
              });
              // 不抛出错误，允许用户重试
              resolve(err);
            } else {
              // 其他错误
              reject(new Error(`微信支付失败: ${err.errMsg || '未知错误'}`));
            }
          }
        });
      });
    } catch (error) {
      console.error('微信支付异常:', error);
      throw error;
    }
  },

  /**
   * 模拟微信支付（用于开发测试）
   * 当后端未配置微信商户信息时使用
   */
  async handleMockWechatPayment(paymentId) {
    console.log('使用模拟微信支付进行测试...');
    return new Promise((resolve) => {
      // 模拟微信支付流程：2秒后自动成功
      setTimeout(() => {
        console.log('模拟微信支付完成');
        applyOptimisticEnrollmentAccess(this.data.enrollmentData, true);
        signalEnrollmentChanged();
        this.handlePaymentSuccess();
        // 通知后端确认支付，不阻塞成功态
        this.confirmPaymentWithBackend(paymentId, this.data.enrollmentData.periodId);
        resolve({});
      }, 2000);
    });
  },

  /**
   * 通知后端确认支付
   * （微信支付成功后需要调用此 API）
   */
  async confirmPaymentWithBackend(paymentId, periodId = null) {
    try {
      console.log('通知后端确认支付，paymentId:', paymentId);
      const confirmRes = await paymentService.confirmPayment(paymentId, {
        transactionId: '' // 实际项目中应该从微信回调获取
      });
      console.log('后端确认支付成功:', confirmRes);

      if (periodId) {
        const currentAccess = getCachedEnrollmentAccess(periodId);
        if (currentAccess && currentAccess.syncPending) {
          // 后端已确认支付，将乐观缓存转为普通已支付缓存，不再受 TTL 限制
          setCachedEnrollmentAccess(periodId, {
            ...currentAccess,
            syncPending: false,
            syncPendingExpiresAt: null,
            updatedAt: new Date().toISOString()
          });
        }
      }

      return true;
    } catch (confirmErr) {
      console.warn('后端确认支付失败，但微信支付已成功:', confirmErr);
      // 不抛出错误，因为微信支付已经成功
      // 可以在后续的支付状态查询中恢复
      return false;
    }
  },

  /**
   * 模拟支付流程（开发测试用）
   */
  async handleMockPayment() {
    try {
      const { enrollmentData } = this.data;

      // 1. 调用后端初始化支付（模拟支付会直接完成）
      console.log('初始化模拟支付...');
      const initRes = await paymentService.initiatePayment({
        enrollmentId: enrollmentData.enrollmentId,
        paymentMethod: 'mock',
        amount: this.data.finalAmount
      });

      console.log('支付初始化响应:', initRes);

      if (initRes && initRes.paymentId) {
        console.log('支付初始化成功，paymentId:', initRes.paymentId);
        console.log('支付状态:', initRes.status);

        // 对于模拟支付，后端在 initiatePayment 中已经完成支付
        // 所以直接显示成功
        if (initRes.status === 'completed') {
          console.log('模拟支付已完成');
          applyOptimisticEnrollmentAccess(enrollmentData, false);
          signalEnrollmentChanged();
          this.handlePaymentSuccess();
          return Promise.resolve();
        } else if (initRes.status === 'pending') {
          // 如果是 pending 状态，则需要确认支付
          // 模拟 2 秒支付处理时间
          return new Promise(resolve => {
            setTimeout(async () => {
              console.log('模拟支付完成，开始确认支付...');
              try {
                const confirmRes = await paymentService.confirmPayment(initRes.paymentId);
                console.log('支付确认成功:', confirmRes);
                applyOptimisticEnrollmentAccess(enrollmentData, false);
                signalEnrollmentChanged();
                this.handlePaymentSuccess();
                resolve();
              } catch (confirmErr) {
                console.error('确认支付失败:', confirmErr);
                throw confirmErr;
              }
            }, 2000);
          });
        } else {
          throw new Error('支付状态异常：' + initRes.status);
        }
      } else {
        throw new Error('支付初始化失败：无效的响应');
      }
    } catch (error) {
      console.error('模拟支付异常:', error);
      throw error;
    }
  },

  /**
   * 支付成功处理
   */
  handlePaymentSuccess() {
    const { enrollmentData, finalAmount } = this.data;

    // 显示成功结果
    this.setData({
      showPaymentResult: true,
      'paymentResult.success': true,
      'paymentResult.title': '支付成功',
      'paymentResult.message': '报名已完成，现在可以进入课程学习了'
    });

    // 保存支付成功状态到本地存储
    const enrollmentInfo = {
      enrollmentId: enrollmentData.enrollmentId,
      periodId: enrollmentData.periodId,
      periodTitle: enrollmentData.periodTitle,
      paymentStatus: 'paid',
      paidAt: new Date().toISOString(),
      finalAmount
    };

    tenantStorage.set('lastEnrollment', enrollmentInfo);

    // 保存到报名列表
    const enrollments = tenantStorage.get('enrollments') || [];
    enrollments.unshift(enrollmentInfo);
    tenantStorage.set('enrollments', enrollments);
  },

  /**
   * 显示支付失败
   */
  showPaymentFailed(title, message) {
    this.setData({
      showPaymentResult: true,
      'paymentResult.success': false,
      'paymentResult.title': title,
      'paymentResult.message': message
    });
  },

  /**
   * 处理支付成功后进入课程
   */
  handleSuccess() {
    const { enrollmentData } = this.data;

    // 关闭弹窗
    this.closeModal();

    // 用 redirectTo 替换当前支付页面，直接进入课程列表
    setTimeout(() => {
      wx.redirectTo({
        url: `/pages/courses/courses?periodId=${enrollmentData.periodId}&name=${enrollmentData.periodTitle}`,
        fail: () => {
          // 回退：返回上一页
          wx.navigateBack({ delta: 1 });
        }
      });
    }, 800);
  },

  /**
   * 关闭弹窗
   */
  closeModal() {
    this.setData({ showPaymentResult: false });
  },

  /**
   * 阻止弹窗事件冒泡
   */
  preventClose(e) {
    e.stopPropagation();
  },

  /**
   * 取消支付（稍后支付）
   */
  handleCancel() {
    const { enrollmentData } = this.data;
    wx.showModal({
      title: '稍后支付',
      content: '您可以稍后在课程页面或个人中心继续支付',
      confirmText: '继续学习',
      cancelText: '留在此页',
      success: res => {
        if (res.confirm) {
          // 跳转到课程列表
          wx.redirectTo({
            url: `/pages/courses/courses?periodId=${enrollmentData.periodId}&name=${enrollmentData.periodTitle}`,
            fail: () => {
              wx.navigateBack({ delta: 1 });
            }
          });
        }
      }
    });
  }
});
