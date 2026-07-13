const adminWorkbenchService = require('../adminWorkbench.service');

const PAGE_SIZE = 20;

const paymentStatusMap = {
  pending: '待支付',
  paid: '已支付',
  refunded: '已退款',
  free: '免费'
};

const orderStatusMap = {
  pending: '待支付',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

const activityStatusMap = {
  draft: '草稿',
  published: '已发布',
  cancelled: '已取消'
};

const registrationStatusMap = {
  registered: '已报名',
  cancelled: '已取消'
};

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function formatMoney(fen) {
  const amount = Number(fen) || 0;
  return `¥${(amount / 100).toFixed(2)}`;
}

function statusText(value, map) {
  return map[value] || value || '-';
}

function decorateActivity(activity = {}) {
  return {
    ...activity,
    timeText: formatDateTime(activity.startTime),
    priceText: activity.isPaid ? formatMoney(activity.price) : '免费',
    statusText: statusText(activity.status, activityStatusMap)
  };
}

function decorateUser(user = {}) {
  const summary = user.summary || {};
  return {
    ...user,
    displayName: user.nickname || '微信用户',
    avatarText: (user.nickname || '微').slice(0, 1),
    phoneText: user.phoneMasked || '未绑定手机号',
    enrollmentCount: summary.enrollmentCount || 0,
    checkinCount: user.totalCheckinDays || 0
  };
}

function decorateRegistration(item = {}) {
  const payment = item.payment || {};
  const formAnswers = (item.formAnswers || []).map(answer => ({
    ...answer,
    displayValue: answer.valueText || '-'
  }));
  return {
    ...item,
    user: decorateUser(item.user || {}),
    registeredAtText: formatDateTime(item.registeredAt),
    paidAmountText: formatMoney(item.paidAmount || payment.amount),
    statusText: statusText(item.status, registrationStatusMap),
    paymentStatusText: statusText(item.paymentStatus, paymentStatusMap),
    orderStatusText: payment.status ? statusText(payment.status, orderStatusMap) : '无订单',
    formAnswers,
    answerChips: formAnswers.slice(0, 3).map(answer => `${answer.label} ${answer.displayValue}`),
    formSubmitted: formAnswers.length > 0
  };
}

function registrationMatchesFilter(registration, filter) {
  if (!filter || !filter.fieldId) return true;
  if (Array.isArray(filter.registrationIds)) {
    return filter.registrationIds.includes(registration.registrationId);
  }
  const answer = (registration.formAnswers || []).find(item => item.fieldId === filter.fieldId);
  if (!answer) return false;
  if (Array.isArray(answer.value)) return answer.value.includes(filter.optionId);
  if (filter.optionId === 'true' || filter.optionId === 'false') {
    return String(!!answer.value) === filter.optionId;
  }
  return String(answer.value) === String(filter.optionId);
}

Page({
  data: {
    activityId: '',
    keyword: '',
    activity: null,
    registrations: [],
    visibleRegistrations: [],
    formStats: [],
    activeTab: 'list',
    selectedRegistration: null,
    showRegistrationDetail: false,
    statsFilter: null,
    statsFilterText: '',
    pagination: { page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false },
    loading: false,
    loadingMore: false
  },

  onLoad(options = {}) {
    const activityId = options.activityId || '';
    this.setData({ activityId });
    if (!activityId) {
      wx.showToast({ title: '活动参数无效', icon: 'none' });
      return;
    }
    return this.loadRegistrations(1, false);
  },

  onPullDownRefresh() {
    this.loadRegistrations(1, false).finally(() => wx.stopPullDownRefresh());
  },

  handleKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  handleSearch() {
    return this.loadRegistrations(1, false);
  },

  async loadRegistrations(page = 1, append = false) {
    const { activityId } = this.data;
    if (!activityId) return;

    this.setData(append ? { loadingMore: true } : { loading: true });
    try {
      const res = await adminWorkbenchService.getActivityRegistrations(activityId, {
        q: this.data.keyword.trim(),
        page,
        pageSize: PAGE_SIZE
      });
      const nextRows = (res.list || []).map(decorateRegistration);
      const registrations = append ? this.data.registrations.concat(nextRows) : nextRows;
      this.setData({
        activity: res.activity ? decorateActivity(res.activity) : this.data.activity,
        registrations,
        visibleRegistrations: this.filterVisibleRegistrations(registrations, this.data.statsFilter),
        formStats: res.formStats || this.data.formStats || [],
        pagination: res.pagination || { page, pageSize: PAGE_SIZE, total: nextRows.length, hasMore: false },
        loading: false,
        loadingMore: false
      });
    } catch (error) {
      wx.showToast({ title: '报名名单加载失败', icon: 'none' });
      this.setData({ loading: false, loadingMore: false });
    }
  },

  handleLoadMore() {
    const pagination = this.data.pagination || {};
    if (!pagination.hasMore || this.data.loading || this.data.loadingMore) return;
    return this.loadRegistrations((Number(pagination.page) || 1) + 1, true);
  },

  filterVisibleRegistrations(registrations, filter) {
    return (registrations || []).filter(item => registrationMatchesFilter(item, filter));
  },

  handleTabChange(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab || 'list' });
  },

  handleCardTap(e) {
    const id = e.currentTarget.dataset.id;
    const selected = this.data.registrations.find(item => item.registrationId === id);
    if (!selected) return;
    this.setData({
      selectedRegistration: selected,
      showRegistrationDetail: true
    });
  },

  handleCloseDetail() {
    this.setData({
      selectedRegistration: null,
      showRegistrationDetail: false
    });
  },

  noop() {},

  handleFilterByStat(e) {
    const { fieldId, optionId, label, registrationIds } = e.currentTarget.dataset;
    const filter = {
      fieldId,
      optionId,
      registrationIds: Array.isArray(registrationIds) ? registrationIds : null
    };
    this.setData({
      statsFilter: filter,
      statsFilterText: label || '',
      activeTab: 'list',
      visibleRegistrations: this.filterVisibleRegistrations(this.data.registrations, filter)
    });
  },

  clearStatsFilter() {
    this.setData({
      statsFilter: null,
      statsFilterText: '',
      visibleRegistrations: this.data.registrations
    });
  }
});
