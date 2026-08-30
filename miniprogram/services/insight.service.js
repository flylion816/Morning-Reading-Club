/**
 * 小凡看见服务
 * 处理AI个性化反馈相关的API请求
 */

const request = require('../utils/request');
const envConfig = require('../config/env');
const mockInsights = require('../mock/insights');

class InsightService {
  /**
   * 获取我的小凡看见列表
   * @param {Object} params 查询参数
   * @returns {Promise}
   */
  getMyInsights(params = {}) {
    return request.get('/insights/my', params);
  }

  /**
   * 获取用户的小凡看见列表
   * @param {Object} params 查询参数 {page, limit, periodId, type}
   * @returns {Promise}
   */
  getUserInsights(params = {}) {
    return request.get('/insights/user', params);
  }

  /**
   * 获取小凡看见列表（用于insights页面，查看自己的）
   * @param {Object} params 查询参数
   * @returns {Promise}
   */
  getInsightsList(params = {}) {
    // 获取当前用户的insights
    return request.get('/insights/user', params);
  }

  /**
   * 获取他人的小凡看见列表（需要已获得权限）
   * @param {string} userId 目标用户ID
   * @param {Object} params 查询参数
   * @returns {Promise}
   */
  getUserInsightsList(userId, params = {}) {
    // 获取特定用户的insights（需要权限检查）
    return request.get(`/insights/user/${userId}`, params);
  }

  /**
   * 小程序管理员获取当前租户全部已完成的小凡看见
   * @param {Object} params 查询参数 {page, limit}
   * @returns {Promise}
   */
  getMobileAdminInsights(params = {}) {
    return request.get('/insights/mobile-admin/all', params);
  }

  /**
   * 获取指定期次的小凡看见列表
   * @param {string} periodId 期次ID
   * @param {Object} params 查询参数 {page, limit, type}
   * @returns {Promise}
   */
  getInsightsForPeriod(periodId, params = {}) {
    return request.get(`/insights/period/${periodId}`, params);
  }

  /**
   * 获取小凡看见详情
   * @param {number} insightId 反馈ID
   * @returns {Promise}
   */
  getInsightDetail(insightId) {
    // Mock模式
    if (envConfig.useMock) {
      const insight = mockInsights.list.find(item => item.id == insightId);
      return Promise.resolve(insight || mockInsights.list[0]);
    }

    return request.get(`/insights/${insightId}`);
  }

  /**
   * 点赞小凡看见
   * @param {number} insightId 反馈ID
   * @returns {Promise}
   */
  likeInsight(insightId) {
    return request.post(`/insights/${insightId}/like`);
  }

  /**
   * 取消点赞
   * @param {number} insightId 反馈ID
   * @returns {Promise}
   */
  unlikeInsight(insightId) {
    return request.post(`/insights/${insightId}/unlike`);
  }

  /**
   * 分享小凡看见
   * @param {number} insightId 反馈ID
   * @returns {Promise}
   */
  shareInsight(insightId) {
    return request.post(`/insights/${insightId}/share`);
  }

  /**
   * 请求查看他人的小凡看见
   * @param {number} insightId 反馈ID
   * @param {string} message 申请留言
   * @returns {Promise}
   */
  requestInsightPermission(insightId, message = '') {
    return request.post(`/insights/${insightId}/request`, { message });
  }

  /**
   * 获取我收到的权限请求列表
   * @param {Object} params 查询参数
   * @returns {Promise}
   */
  getReceivedRequests(params = {}) {
    return request.get('/insights/requests/received', params);
  }

  /**
   * 获取我发出的权限请求列表
   * @param {Object} params 查询参数
   * @returns {Promise}
   */
  getSentRequests(params = {}) {
    return request.get('/insights/requests/sent', params);
  }

  /**
   * 批准权限请求
   * @param {number} requestId 请求ID
   * @param {Object} data 请求数据 {periodId}
   * @returns {Promise}
   */
  approveRequest(requestId, data = {}) {
    return request.post(`/insights/requests/${requestId}/approve`, data);
  }

  /**
   * 拒绝权限请求
   * @param {number} requestId 请求ID
   * @param {string|Object} reason 拒绝原因或请求体
   * @returns {Promise}
   */
  rejectRequest(requestId, reason = '') {
    const payload =
      typeof reason === 'object' && reason !== null ? reason : { reason };
    return request.post(`/insights/requests/${requestId}/reject`, payload);
  }

  /**
   * 获取广场小凡看见列表(公开的)
   * @param {Object} params 查询参数
   * @returns {Promise}
   */
  getPublicInsights(params = {}) {
    return request.get('/insights/public', params);
  }

  /**
   * 生成分享卡片数据
   * @param {number} insightId 反馈ID
   * @returns {Promise}
   */
  generateShareCard(insightId) {
    return request.get(`/insights/${insightId}/share-card`);
  }

  // Stage 6 Test Methods
  /**
   * 发布insight
   * @param {Object} data - insight数据
   * @returns {Promise}
   */
  publishInsight(data) {
    return request.post('/insights', data);
  }

  /**
   * 获取insights列表
   * @param {string} periodId - 期次ID
   * @param {Object} options - 选项
   * @returns {Promise}
   */
  getInsightsListByPeriod(periodId, options = {}) {
    return request.get(`/insights/period/${periodId}`, options);
  }

  /**
   * 获取特定用户insights
   * @param {string} userId - 用户ID
   * @returns {Promise}
   */
  getUserInsightsByUserId(userId) {
    return request.get(`/insights/user/${userId}`);
  }

  /**
   * 获取特定期次insights
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  getPeriodInsights(periodId) {
    return request.get(`/insights/period/${periodId}`);
  }

  /**
   * 获取我收到的insights
   * @returns {Promise}
   */
  getReceivedInsights() {
    return request.get('/insights/received');
  }

  /**
   * 更新insight
   * @param {string} insightId - Insight ID
   * @param {Object} data - 更新数据
   * @returns {Promise}
   */
  updateInsight(insightId, data) {
    return request.put(`/insights/${insightId}`, data);
  }

  /**
   * 删除insight
   * @param {string} insightId - Insight ID
   * @returns {Promise}
   */
  deleteInsight(insightId) {
    return request.delete(`/insights/${insightId}`);
  }

  /**
   * 获取insight详情
   * @param {string} insightId - Insight ID
   * @returns {Promise}
   */
  getInsightDetails(insightId) {
    return request.get(`/insights/${insightId}`);
  }

  /**
   * 获取相关insights
   * @param {string} insightId - Insight ID
   * @returns {Promise}
   */
  getRelatedInsights(insightId) {
    return request.get(`/insights/${insightId}/related`);
  }

  /**
   * 保存草稿
   * @param {Object} draft - 草稿数据
   * @returns {Promise}
   */
  saveDraft(draft) {
    return Promise.resolve({});
  }

  /**
   * 获取草稿
   * @returns {Promise}
   */
  getDraft() {
    return Promise.resolve(null);
  }

  /**
   * 获取insight统计
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  getInsightStats(periodId) {
    return request.get(`/insights/period/${periodId}/stats`);
  }

  /**
   * 搜索insights
   * @param {string} keyword - 关键词
   * @param {Object} options - 选项
   * @returns {Promise}
   */
  searchInsights(keyword, options = {}) {
    return request.get('/insights/search', { keyword, ...options });
  }

  /**
   * 获取热门insights
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  getTrendingInsights(periodId) {
    return request.get(`/insights/period/${periodId}/trending`);
  }
}

module.exports = new InsightService();
