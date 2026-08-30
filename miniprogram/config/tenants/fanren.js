// 凡人共读 —— 当前线上租户，仓库默认态
module.exports = {
  slug: 'fanren',
  brandName: '凡人共读',

  // —— 与 appId 强绑定（构建期固化）——
  wxAppId: 'wx2b9a3c1d5e4195f8',
  cloudEnv: null,
  wechatPayMchId: null,

  // 订阅消息模板 ID（按场景键，与 subscribe-auto-topup.js AUTO_TOP_UP_POLICIES 对齐）
  subscribeTemplates: {
    enrollment_result:         'Qzn9auOyMjCKUaHrfekzK0XMaQ64nO0mfdikQNXjbdo',
    payment_result:            'UCzIuWtUYbc_ucf05GEOqglXK1HJHzwtN50e1NkmhCI',
    comment_received:          'oMN_lu5vxoBlqcqiTxNDDq_kx9M4ENLUlfruD2rPZbs',
    like_received:             '7bzStHl6spoC8Vh_DHDXvAebxF5htrNLlfiAoDjp9Ek',
    danmaku_received:          'oMN_lu5vxoBlqcqiTxNDDq_kx9M4ENLUlfruD2rPZbs',
    insight_liked:             '7bzStHl6spoC8Vh_DHDXvAebxF5htrNLlfiAoDjp9Ek',
    insight_request_created:   '6M4Cb5qrZa5xF3uuJLvw4UPvRuMzAef_N0biZgx7j6A',
    insight_request_approved:  '6M4Cb5qrZa5xF3uuJLvw4UPvRuMzAef_N0biZgx7j6A',
    next_day_study_reminder:   'aVKlwM2zva8WuT04AdaibI6akNh8aoPjn3oKzWE-SLA',
    insight_created:           '7Q501HNbbT7_GqaBsoj71eKIhVYUFwRU097Q3r8d5_M',
    podcast_published:         '7Q501HNbbT7_GqaBsoj71eKIhVYUFwRU097Q3r8d5_M',
    activity_reminder:         'aVKlwM2zva8WuT04AdaibI6akNh8aoPjn3oKzWE-SLA'
  },

  // —— 视觉身份 ——
  primaryColor: '#4a90e2',
  logo: '/assets/tenants/fanren/logo.png',
  shareCover: '/assets/tenants/fanren/share-cover.jpg',
  navBar: {
    title: '凡人共读',
    bgColor: '#4a90e2',
    textStyle: 'white'
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#4a90e2',
    backgroundColor: '#ffffff',
    iconsDir: '/assets/tenants/fanren'
  },

  // —— 文案/主体 ——
  legalEntity: '凡人共读 团队',
  contactEmail: 'support@fanren.club',
  wechatSIPlugin: true,

  // 为 null 时由 env.js 按环境给默认值
  apiBaseUrl: null
};
