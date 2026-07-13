const adminWorkbenchService = require('./adminWorkbench.service');

const PAGE_SIZE = 20;

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}-${day}`;
}

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

const enrollmentStatusMap = {
  active: '进行中',
  completed: '已完成',
  withdrawn: '已退出'
};

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

function decorateUser(user = {}) {
  const summary = user.summary || {};
  return {
    ...user,
    displayName: user.nickname || '微信用户',
    avatarText: (user.nickname || '微').slice(0, 1),
    phoneText: user.phoneMasked || '未绑定手机号',
    latestEnrollmentText: summary.latestEnrollment
      ? `${summary.latestEnrollment.periodName} · ${statusText(summary.latestEnrollment.paymentStatus, paymentStatusMap)}`
      : '暂无报名'
  };
}

function decorateEnrollment(item = {}) {
  const payment = item.latestPayment || {};
  return {
    ...item,
    enrolledAtText: formatDate(item.enrolledAt),
    paidAtText: formatDateTime(item.paidAt || payment.paidAt),
    paymentAmountText: formatMoney(item.paymentAmount || payment.amount),
    statusText: statusText(item.status, enrollmentStatusMap),
    paymentStatusText: statusText(item.paymentStatus, paymentStatusMap),
    orderStatusText: payment.status ? statusText(payment.status, orderStatusMap) : '无订单'
  };
}

function decorateActivity(item = {}) {
  return {
    ...item,
    timeText: formatDateTime(item.startTime),
    priceText: item.isPaid ? formatMoney(item.price) : '免费',
    statusText: statusText(item.status, activityStatusMap)
  };
}

function decorateRegistration(item = {}) {
  const user = item.user || {};
  const payment = item.payment || {};
  return {
    ...item,
    user: decorateUser(user),
    registeredAtText: formatDateTime(item.registeredAt),
    paidAmountText: formatMoney(item.paidAmount || payment.amount),
    statusText: statusText(item.status, registrationStatusMap),
    paymentStatusText: statusText(item.paymentStatus, paymentStatusMap),
    orderStatusText: payment.status ? statusText(payment.status, orderStatusMap) : '无订单'
  };
}

Page({
  data: {
    activeTab: 'activities',
    userKeyword: '',
    userLoading: false,
    users: [],
    userPagination: { page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false },
    selectedUser: null,
    selectedUserDetail: null,
    userDetailLoading: false,
    activityKeyword: '',
    activityLoading: false,
    activities: [],
    activityPagination: { page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false },
    loadingMoreUsers: false,
    loadingMoreActivities: false
  },

  onLoad() {
    this.loadActivities();
  },

  onPullDownRefresh() {
    const task = this.data.activeTab === 'users'
      ? this.searchUsers()
      : this.loadActivities();
    task.finally(() => wx.stopPullDownRefresh());
  },

  handleTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === 'activities' && this.data.activities.length === 0) {
      this.loadActivities();
    }
  },

  handleUserKeywordInput(e) {
    this.setData({ userKeyword: e.detail.value });
  },

  handleActivityKeywordInput(e) {
    this.setData({ activityKeyword: e.detail.value });
  },

  async searchUsers(page = 1, append = false) {
    const keyword = this.data.userKeyword.trim();
    if (!keyword) {
      this.setData({
        users: [],
        selectedUser: null,
        selectedUserDetail: null,
        userPagination: { page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
      });
      return;
    }

    this.setData(append ? { loadingMoreUsers: true } : { userLoading: true });
    try {
      const res = await adminWorkbenchService.searchUsers({
        q: keyword,
        page,
        pageSize: PAGE_SIZE
      });
      const nextUsers = (res.list || []).map(decorateUser);
      this.setData({
        users: append ? this.data.users.concat(nextUsers) : nextUsers,
        userPagination: res.pagination || { page, pageSize: PAGE_SIZE, total: nextUsers.length, hasMore: false },
        userLoading: false,
        loadingMoreUsers: false
      });
    } catch (error) {
      wx.showToast({ title: '用户查询失败', icon: 'none' });
      this.setData({ userLoading: false, loadingMoreUsers: false });
    }
  },

  handleUserSearch() {
    this.searchUsers(1, false);
  },

  handleLoadMoreUsers() {
    const pagination = this.data.userPagination || {};
    if (!pagination.hasMore || this.data.loadingMoreUsers || this.data.userLoading) return;
    this.searchUsers((Number(pagination.page) || 1) + 1, true);
  },

  async handleUserTap(e) {
    const userId = e.currentTarget.dataset.id;
    if (!userId) return;
    const selectedUser = this.data.users.find((item) => item.userId === userId) || null;
    this.setData({
      selectedUser,
      userDetailLoading: true,
      selectedUserDetail: null
    });
    try {
      const res = await adminWorkbenchService.getUserDetail(userId);
      this.setData({
        selectedUserDetail: {
          user: decorateUser(res.user || {}),
          enrollments: (res.enrollments || []).map(decorateEnrollment),
          activityRegistrations: (res.activityRegistrations || []).map((item) => ({
            ...decorateRegistration(item),
            activity: item.activity ? decorateActivity(item.activity) : null
          }))
        },
        userDetailLoading: false
      });
    } catch (error) {
      wx.showToast({ title: '用户详情加载失败', icon: 'none' });
      this.setData({ userDetailLoading: false });
    }
  },

  async loadActivities(page = 1, append = false) {
    this.setData(append ? { loadingMoreActivities: true } : { activityLoading: true });
    try {
      const res = await adminWorkbenchService.getActivities({
        q: this.data.activityKeyword.trim(),
        page,
        pageSize: PAGE_SIZE
      });
      const nextActivities = (res.list || []).map(decorateActivity);
      this.setData({
        activities: append ? this.data.activities.concat(nextActivities) : nextActivities,
        activityPagination: res.pagination || { page, pageSize: PAGE_SIZE, total: nextActivities.length, hasMore: false },
        activityLoading: false,
        loadingMoreActivities: false
      });
    } catch (error) {
      wx.showToast({ title: '活动列表加载失败', icon: 'none' });
      this.setData({ activityLoading: false, loadingMoreActivities: false });
    }
  },

  handleActivitySearch() {
    this.loadActivities(1, false);
  },

  handleLoadMoreActivities() {
    const pagination = this.data.activityPagination || {};
    if (!pagination.hasMore || this.data.loadingMoreActivities || this.data.activityLoading) return;
    this.loadActivities((Number(pagination.page) || 1) + 1, true);
  },

  handleActivityTap(e) {
    const activityId = e.currentTarget.dataset.id;
    if (!activityId) return;
    wx.navigateTo({
      url: `/pages/admin-workbench/activity-registrations/activity-registrations?activityId=${activityId}`
    });
  }
});
