const communityActivityService = require('../../services/communityActivity.service');
const activityService = require('../../services/activity.service');
const currentTenant = require('../../config/current-tenant');
const { renderRichTextContent } = require('../../utils/markdown');

function formatDatetime(val) {
  if (!val) return '';
  const d = new Date(val);
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${mo}月${day}日 ${h}:${m}`;
}

function getActivityStatus(activity) {
  if (!activity) return '';
  const now = Date.now();
  const start = activity.startTime ? new Date(activity.startTime).getTime() : 0;
  const end = activity.endTime ? new Date(activity.endTime).getTime() : 0;
  if (activity.status === 'cancelled') return 'cancelled';
  if (end && now > end) return 'ended';
  if (start && now >= start) return 'ongoing';
  return 'upcoming';
}

function shouldShowMeeting(activity) {
  if (!activity) return false;
  if (!activity.meetingId && !activity.meetingJoinUrl) return false;
  const now = Date.now();
  const start = activity.startTime ? new Date(activity.startTime).getTime() : 0;
  const end = activity.endTime ? new Date(activity.endTime).getTime() : Infinity;
  return now >= start - 30 * 60 * 1000 && now <= end;
}

function buildFormFieldState(field, savedAnswers = []) {
  const saved = savedAnswers.find(answer => answer.fieldId === field.fieldId);
  const value = saved ? saved.value : (field.type === 'multi_select' ? [] : '');
  return {
    ...field,
    value,
    valueText: saved ? saved.valueText : '',
    options: (field.options || []).map(option => ({
      ...option,
      checked: Array.isArray(value)
        ? value.includes(option.optionId)
        : value === option.optionId
    }))
  };
}

function decorateAnswers(answers = []) {
  return answers.map(answer => ({
    ...answer,
    displayValue: answer.valueText || '-'
  }));
}

Page({
  data: {
    activityId: '',
    activity: null,
    loading: true,
    registered: false,
    registering: false,
    showMeeting: false,
    typeMap: { witness: '见证会', chat: '聊天局', cooking: '料理人生', other: '其他' },
    showPayModal: false,
    showFormModal: false,
    formSubmitting: false,
    registrationFormFields: [],
    formAnswers: {},
    submittedAnswers: [],
    paying: false,
    payInfo: {
      registrationId: '',
      paymentId: '',
      originalPrice: 0,
      originalPriceDisplay: '',
      coupon: null,
      finalPrice: 0,
      finalPriceDisplay: '',
      discountDisplay: '',
      wxParams: null
    }
  },

  onLoad(options) {
    if (!options.activityId || options.activityId === 'undefined') {
      wx.redirectTo({ url: '/pages/index/index' });
      return;
    }
    this.setData({ activityId: options.activityId });
    this.loadDetail(options.activityId);
  },

  onShow() {
    if (this.data.activityId) {
      this.refreshMeetingVisibility();
    }
  },

  async onPullDownRefresh() {
    if (this.data.activityId) {
      await this.loadDetail(this.data.activityId);
    }
    wx.stopPullDownRefresh();
  },

  async loadDetail(activityId) {
    this.setData({ loading: true });
    try {
      const res = await communityActivityService.getDetail(activityId);
      const activity = res.data || res;
      const showMeeting = shouldShowMeeting(activity);
      // 付费活动 pending 状态：isRegistered 为 false，显示"继续支付"
      const isPendingPayment = activity.isPaid &&
        activity.userRegistration &&
        activity.userRegistration.paymentStatus === 'pending';
      this.setData({
        activity: {
          ...activity,
          descriptionHtml: renderRichTextContent(activity.description),
          startTimeFormatted: formatDatetime(activity.startTime),
          endTimeFormatted: formatDatetime(activity.endTime),
          computedStatus: getActivityStatus(activity),
          priceDisplay: activity.isPaid ? (activity.price / 100).toFixed(2) : '0.00'
        },
        submittedAnswers: decorateAnswers(activity.userRegistration?.formAnswers || []),
        registered: isPendingPayment ? false : (activity.isRegistered || false),
        showMeeting,
        loading: false
      });
      wx.setNavigationBarTitle({ title: activity.title || '活动详情' });
    } catch (err) {
      console.error('加载活动详情失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    }
  },

  refreshMeetingVisibility() {
    const showMeeting = shouldShowMeeting(this.data.activity);
    if (showMeeting !== this.data.showMeeting) {
      this.setData({ showMeeting });
    }
  },

  async handleRegister() {
    const app = getApp();
    if (!app.globalData.isLogin) {
      wx.showModal({
        title: '需要登录',
        content: '报名前需要先登录，是否前往登录？',
        confirmText: '去登录',
        cancelText: '再看看',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: `/pages/login/login?redirect=community-activity-detail&activityId=${this.data.activityId}` });
          }
        }
      });
      return;
    }

    const activity = this.data.activity || {};
    if (activity.registrationForm && activity.registrationForm.enabled) {
      const savedAnswers = activity.userRegistration?.formAnswers || [];
      const fields = (activity.registrationForm.fields || []).map(field => buildFormFieldState(field, savedAnswers));
      const answers = {};
      fields.forEach(field => {
        answers[field.fieldId] = field.value;
      });
      this.setData({
        registrationFormFields: fields,
        formAnswers: answers,
        showFormModal: true
      });
      return;
    }

    return this.submitRegistration({});
  },

  async submitRegistration(formAnswers = {}) {
    this.setData({ registering: true, formSubmitting: true });
    try {
      let reminderGranted = false;
      let reminderGrant = null;
      const activityReminderTemplateId = currentTenant.subscribeTemplates?.activity_reminder || '';
      if (activityReminderTemplateId) {
        await new Promise((resolve) => {
          wx.requestSubscribeMessage({
            tmplIds: [activityReminderTemplateId],
            success(subRes) {
              reminderGranted = subRes[activityReminderTemplateId] === 'accept';
              reminderGrant = {
                scene: 'activity_reminder',
                templateId: activityReminderTemplateId,
                result: subRes[activityReminderTemplateId] || 'error'
              };
              resolve();
            },
            fail() { resolve(); }
          });
        });
      }

      const regRes = await communityActivityService.register(this.data.activityId, {
        reminderGranted,
        reminderGrant,
        formAnswers
      });
      const regData = regRes.data || regRes;

      if (regData.paymentId) {
        // 付费活动：展示支付弹窗
        const originalPrice = regData.originalPrice || 0;
        const finalPrice = regData.finalPrice || 0;
        const coupon = regData.coupon || null;
        const discountAmount = originalPrice - finalPrice;
        const discountDisplay = discountAmount > 0
          ? `-¥${(discountAmount / 100).toFixed(2)}`
          : '';
        // 提取微信支付参数
        const wxParams = regData.timeStamp ? {
          timeStamp: regData.timeStamp,
          nonceStr: regData.nonceStr,
          package: regData.package,
          signType: regData.signType,
          paySign: regData.paySign
        } : null;
        this.setData({
          showPayModal: true,
          payInfo: {
            registrationId: regData.registrationId || '',
            paymentId: regData.paymentId,
            originalPrice,
            originalPriceDisplay: (originalPrice / 100).toFixed(2),
            coupon,
            finalPrice,
            finalPriceDisplay: (finalPrice / 100).toFixed(2),
            discountDisplay,
            wxParams
          }
        });
        activityService.track('activity_enroll', { targetId: this.data.activityId });
      } else {
        // 免费活动：原有逻辑
        this.setData({ registered: true });
        activityService.track('activity_enroll', { targetId: this.data.activityId });
        wx.showToast({ title: '报名成功', icon: 'success' });
        this.loadDetail(this.data.activityId);
      }
    } catch (err) {
      console.error('报名失败:', err);
      wx.showToast({ title: err.message || '报名失败，请重试', icon: 'none' });
    } finally {
      this.setData({ registering: false, formSubmitting: false });
    }
  },

  handleFormInput(e) {
    const { fieldId } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.updateFormAnswer(fieldId, value);
  },

  handleBooleanChange(e) {
    const { fieldId } = e.currentTarget.dataset;
    this.updateFormAnswer(fieldId, !!e.detail.value);
  },

  handleSingleSelect(e) {
    const { fieldId, optionId } = e.currentTarget.dataset;
    this.updateFormAnswer(fieldId, optionId);
  },

  handleMultiSelect(e) {
    const { fieldId, optionId } = e.currentTarget.dataset;
    const current = this.data.formAnswers[fieldId] || [];
    const next = current.includes(optionId)
      ? current.filter(item => item !== optionId)
      : current.concat(optionId);
    this.updateFormAnswer(fieldId, next);
  },

  updateFormAnswer(fieldId, value) {
    const formAnswers = {
      ...this.data.formAnswers,
      [fieldId]: value
    };
    const fields = this.data.registrationFormFields.map(field => {
      if (field.fieldId !== fieldId) return field;
      return {
        ...field,
        value,
        options: (field.options || []).map(option => ({
          ...option,
          checked: Array.isArray(value)
            ? value.includes(option.optionId)
            : value === option.optionId
        }))
      };
    });
    this.setData({ formAnswers, registrationFormFields: fields });
  },

  validateRegistrationForm() {
    const fields = this.data.registrationFormFields || [];
    for (const field of fields) {
      const value = this.data.formAnswers[field.fieldId];
      const empty = field.type === 'multi_select'
        ? !Array.isArray(value) || value.length === 0
        : value === undefined || value === null || String(value).trim() === '';
      if (field.required && empty) {
        wx.showToast({ title: `请填写${field.label}`, icon: 'none' });
        return false;
      }
      if (field.type === 'phone' && value && !/^1\d{10}$/.test(String(value).trim())) {
        wx.showToast({ title: `${field.label}格式不正确`, icon: 'none' });
        return false;
      }
    }
    return true;
  },

  async handleFormSubmit() {
    if (!this.validateRegistrationForm()) return;
    const answers = {};
    (this.data.registrationFormFields || []).forEach(field => {
      answers[field.fieldId] = this.data.formAnswers[field.fieldId];
    });
    this.setData({ showFormModal: false });
    await this.submitRegistration(answers);
  },

  handleFormCancel() {
    this.setData({ showFormModal: false });
  },

  // 用户点击弹窗"立即支付"
  async handlePayConfirm() {
    const { payInfo } = this.data;
    if (!payInfo.wxParams || !payInfo.wxParams.timeStamp) {
      wx.showToast({ title: '获取支付参数失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ paying: true });
    try {
      const payResult = await new Promise((resolve, reject) => {
        wx.requestPayment({
          ...payInfo.wxParams,
          success: resolve,
          fail: (err) => {
            if (err.errMsg && err.errMsg.includes('cancel')) {
              wx.showToast({ title: '已取消支付', icon: 'none' });
              resolve(null); // 取消不算失败
            } else {
              reject(new Error(err.errMsg || '支付失败'));
            }
          }
        });
      });
      if (payResult !== null) {
        // 支付成功（非取消）
        await this.confirmActivityPayment(payInfo.paymentId);
        this.setData({ showPayModal: false });
        wx.showToast({ title: '报名成功', icon: 'success' });
        this.loadDetail(this.data.activityId);
      }
    } catch (err) {
      wx.showToast({ title: err.message || '支付失败，请重试', icon: 'none' });
    } finally {
      this.setData({ paying: false });
    }
  },

  // 关闭支付弹窗（取消）
  handlePayCancel() {
    this.setData({ showPayModal: false });
  },

  // 通知后端确认支付
  async confirmActivityPayment(paymentId) {
    const paymentService = require('./payment-confirmation.service');
    try {
      await paymentService.confirmPayment(paymentId, { transactionId: '' });
    } catch (err) {
      console.warn('确认活动支付失败，但微信支付已成功:', err);
    }
  },

  // 继续支付（pending 状态）
  async handleContinuePay() {
    const { activity } = this.data;
    if (!activity || !activity.userRegistration) return;
    const { paymentId } = activity.userRegistration;
    if (!paymentId) {
      wx.showToast({ title: '支付信息缺失，请重新报名', icon: 'none' });
      return;
    }
    // 重新发起报名流程以获取最新支付参数
    this.handleRegister();
  },

  // 阻止事件冒泡
  noop() {},

  async handleCancelRegister() {
    wx.showModal({
      title: '取消报名',
      content: '确定要取消报名吗？',
      confirmText: '确定取消',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ registering: true });
        try {
          await communityActivityService.cancelRegister(this.data.activityId);
          this.setData({ registered: false });
          wx.showToast({ title: '已取消报名', icon: 'success' });
          this.loadDetail(this.data.activityId);
        } catch (err) {
          console.error('取消报名失败:', err);
          wx.showToast({ title: err.message || '取消失败，请重试', icon: 'none' });
        } finally {
          this.setData({ registering: false });
        }
      }
    });
  },

  handleJoinMeeting() {
    const { activity } = this.data;
    wx.navigateTo({
      url: `/pages/meeting-webview/meeting-webview?meetingId=${encodeURIComponent(activity.meetingId || '')}&url=${encodeURIComponent(activity.meetingJoinUrl || '')}`
    });
  },

  handleCopyMeetingId() {
    const meetingId = this.data.activity && this.data.activity.meetingId;
    if (!meetingId) return;
    wx.setClipboardData({
      data: meetingId,
      success() { wx.showToast({ title: '会议号已复制', icon: 'success' }); }
    });
  },

  onShareAppMessage() {
    const { activity, activityId } = this.data;
    return {
      title: activity ? activity.title : '活动详情',
      path: `/pages/community-activity-detail/community-activity-detail?activityId=${activityId}`,
      imageUrl: activity && activity.posterUrl ? activity.posterUrl : ''
    };
  }
});
