/**
 * 排行榜服务
 */

const request = require('../../utils/request');
const apiConfig = require('../../config/api.config');

module.exports = {
  /**
   * 获取期次排行榜
   * @param {string} periodId - 期次ID
   * @param {Object} options - 选项
   * @param {string} options.timeRange - 时间范围 (all, thisWeek, lastWeek, today, yesterday)
   * @param {number} options.page - 页码
   * @param {number} options.limit - 每页数量
   * @returns {Promise}
   */
  getPeriodRanking(periodId, options = {}) {
    const { timeRange = 'all', page = 1, limit = 20 } = options;

    return request.request({
      url: `/ranking/period/${periodId}`,
      method: 'GET',
      data: {
        timeRange,
        page,
        limit
      }
    });
  },

  // Stage 5 Test Methods
  /**
   * 获取排行榜列表
   * @param {string} periodId - 期次ID
   * @param {Object} options - 选项
   * @returns {Promise}
   */
  getRankingList(periodId, options = {}) {
    return request.get(`/rankings/period/${periodId}`, options);
  },

  /**
   * 获取当前用户排名
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  getCurrentUserRanking(periodId) {
    return request.get(`/rankings/period/${periodId}/me`);
  },

  /**
   * 刷新排行榜
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  refreshRankings(periodId) {
    return request.post(`/rankings/period/${periodId}/refresh`);
  },

  /**
   * 获取排名趋势
   * @param {string} userId - 用户ID
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  getRankingTrend(userId, periodId) {
    return request.get(`/rankings/user/${userId}/trend`, { periodId });
  },

  /**
   * 对比用户排名
   * @param {string} userId - 用户ID
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  getPeerComparison(userId, periodId) {
    return request.get(`/rankings/user/${userId}/compare`, { periodId });
  },

  /**
   * 获取排名统计
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  getRankingStats(periodId) {
    return request.get(`/rankings/period/${periodId}/stats`);
  },

  /**
   * 订阅排名更新
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  subscribeRankingUpdates(periodId) {
    return Promise.resolve({});
  },

  /**
   * 监听排名更新
   * @param {string} periodId - 期次ID
   * @param {Function} callback - 回调
   */
  onRankingUpdate(periodId, callback) {
    // WebSocket event listener
  },

  /**
   * 取消订阅排名更新
   * @param {string} periodId - 期次ID
   * @returns {Promise}
   */
  unsubscribeRankingUpdates(periodId) {
    return Promise.resolve({});
  },

  /**
   * 获取高赞评论
   * @param {string} insightId - Insight ID
   * @returns {Promise}
   */
  getMostLikedComments(insightId) {
    return request.get(`/insights/${insightId}/comments/top-liked`);
  }
};
