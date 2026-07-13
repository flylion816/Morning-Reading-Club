const request = require('../../utils/request');
const { THEME_PRIMARY } = require('../../utils/theme');

const danmakuService = {
  getDanmaku(insightId) {
    return request.get(`/insights/${insightId}/danmaku`);
  },

  postDanmaku(insightId, { content, type = 'comment', scrollPercent = 0, color = THEME_PRIMARY }) {
    return request.post(`/insights/${insightId}/danmaku`, {
      content,
      type,
      scrollPercent,
      color
    });
  }
};

module.exports = danmakuService;
