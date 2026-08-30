// 晨读营小程序 - 应用入口
const envConfig = require('./config/env');
const currentTenant = require('./config/current-tenant');
const constants = require('./config/constants');
const logger = require('./utils/logger');
const activityService = require('./services/activity.service');
const { tenantStorage } = require('./utils/storage');

App({
  onLaunch(options) {
    try {
      logger.info('晨读营小程序启动', options);
      logger.debug('当前环境:', envConfig.currentEnv);

      // 检查登录状态
      this.checkLoginStatus();

      // 根据登录状态导航到正确的页面
      this.navigateToStartPage(options);

      // 获取系统信息
      this.getSystemInfo();

      // 更新检查在开发者工具中可能触发基础库 timeout，线上由微信客户端托管版本更新。
    } catch (error) {
      console.error('❌ 应用启动失败:', error);
      logger.error('启动错误详情:', error.message, error.stack);
    }
  },

  // 根据登录状态导航到正确的起始页面
  navigateToStartPage(launchOptions = {}) {
    console.log(
      '🔵🔵🔵 navigateToStartPage called, currentEnv:',
      envConfig.currentEnv
    );
    const pages = getCurrentPages();
    logger.debug(
      '当前页面栈:',
      pages.map((p) => p.route)
    );

    // 在开发环境，不自动导航（方便开发调试）
    if (envConfig.currentEnv === 'dev') {
      console.log('🔵🔵🔵 SKIP navigation in dev environment');
      logger.debug('⚙️ 开发环境，不自动导航');
      return;
    }

    const launchPath = launchOptions.path || '';
    const launchQuery = launchOptions.query || {};
    const hasLaunchQuery = Object.keys(launchQuery).length > 0;

    if (launchPath === 'pages/profile/profile' && launchQuery.from === 'share') {
      const query = Object.keys(launchQuery)
        .map((key) => `${key}=${encodeURIComponent(launchQuery[key])}`)
        .join('&');
      const url = `/pages/index/index${query ? `?${query}` : ''}`;

      logger.info('旧分享入口重定向到首页', { url });
      wx.reLaunch({
        url,
        fail: (err) => {
          logger.error('导航到首页失败:', err);
        }
      });
      return;
    }

    const shouldRespectLaunchPath =
      !!launchPath && (launchPath !== 'pages/index/index' || hasLaunchQuery);

    if (shouldRespectLaunchPath) {
      const query = Object.keys(launchQuery)
        .map((key) => `${key}=${encodeURIComponent(launchQuery[key])}`)
        .join('&');
      const url = `/${launchPath}${query ? `?${query}` : ''}`;

      logger.info('保留分享/外部入口路径', { url });
      wx.reLaunch({
        url,
        fail: (err) => {
          logger.error('导航到入口路径失败:', err);
        }
      });
      return;
    }

    // 生产环境：根据登录状态决定起始页
    // 未登录（首次打开）→ 晨读营列表（公开浏览，符合微信审核要求：先体验再登录）
    // 已登录（回访用户）→ 首页（今日任务）
    if (this.globalData.isLogin) {
      logger.info('已登录，导航到首页');
      wx.reLaunch({
        url: '/pages/index/index',
        fail: (err) => {
          logger.error('导航到首页失败:', err);
        }
      });
    } else {
      logger.info('未登录，导航到晨读营列表（公开页面）');
      wx.reLaunch({
        url: '/pages/periods/periods',
        fail: (err) => {
          logger.error('导航到晨读营列表失败:', err);
        }
      });
    }
  },

  onShow(options) {
    logger.info('晨读营小程序显示', options);

    // ⭐ 重新检查登录状态（防止token过期或globalData重置导致频繁跳转）
    console.log('🔄 app.onShow: 重新检查登录状态');
    this.checkLoginStatus();
    if (this.globalData.isLogin) {
      activityService.track('app_open', {
        targetType: 'app',
        metadata: {
          scene: options?.scene || null,
          path: options?.path || null
        }
      });
    }
  },

  onHide() {
    logger.debug('晨读营小程序隐藏');
  },

  onError(error) {
    logger.error('应用错误:', error);

    // 错误上报(生产环境)
    if (envConfig.currentEnv === 'prod') {
      // TODO: 接入错误监控平台
    }
  },

  // 检查登录状态
  checkLoginStatus() {
    try {
      const token = tenantStorage.get(constants.STORAGE_KEYS.TOKEN);
      const userInfo = tenantStorage.get(constants.STORAGE_KEYS.USER_INFO);

      logger.debug('=== checkLoginStatus ===');
      logger.debug('Token存在?:', !!token);
      logger.debug('UserInfo存在?:', !!userInfo);
      logger.debug('UserInfo._id:', userInfo?._id);

      if (token && userInfo) {
        this.globalData.isLogin = true;
        this.globalData.userInfo = userInfo;
        this.globalData.token = token;
        logger.info('✅ 登录状态恢复成功，用户ID:', userInfo._id);
      } else {
        this.globalData.isLogin = false;
        logger.debug('❌ 登录状态未找到');
      }
    } catch (error) {
      logger.error('登录状态检查失败:', error);
      this.globalData.isLogin = false;
    }
  },

  // 获取系统信息
  getSystemInfo() {
    try {
      const windowInfo = wx.getWindowInfo?.() || {};
      const deviceInfo = wx.getDeviceInfo?.() || {};
      const appBaseInfo = wx.getAppBaseInfo?.() || {};
      const systemInfo = {
        ...windowInfo,
        ...deviceInfo,
        ...appBaseInfo
      };

      this.globalData.systemInfo = systemInfo;
      this.globalData.statusBarHeight = windowInfo.statusBarHeight || 0;
      this.globalData.screenHeight = windowInfo.screenHeight || 0;
      this.globalData.screenWidth = windowInfo.screenWidth || 0;
      this.globalData.safeAreaBottom = windowInfo.safeArea ? (windowInfo.screenHeight - windowInfo.safeArea.bottom) : 0;
      this.globalData.platform = deviceInfo.platform || '';

      if (envConfig.enableDebug) {
        logger.debug('系统信息:', systemInfo);
      }
    } catch (error) {
      logger.warn('获取系统信息失败:', error);
    }
  },

  // 检查小程序更新
  checkUpdate() {
    const envVersion = wx.getAccountInfoSync?.().miniProgram?.envVersion;
    if (envVersion !== 'release') {
      logger.debug('非线上版本，跳过小程序更新检查:', envVersion || 'unknown');
      return;
    }

    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager();

      updateManager.onCheckForUpdate((res) => {
        if (res.hasUpdate) {
          logger.info('发现新版本');
        }
      });

      updateManager.onUpdateReady(() => {
        wx.showModal({
          title: '更新提示',
          content: '新版本已准备好，是否重启应用？',
          success: (res) => {
            if (res.confirm) {
              updateManager.applyUpdate();
            }
          }
        });
      });

      updateManager.onUpdateFailed(() => {
        logger.error('新版本下载失败');
      });
    }
  },

  // 全局数据
  globalData: {
    isLogin: false,
    canUsePaidFeatures: false,
    userInfo: null,
    token: null,
    systemInfo: null,
    statusBarHeight: 0,
    screenHeight: 0,
    screenWidth: 0,
    platform: '',
    apiBaseUrl: envConfig.apiBaseUrl,
    env: envConfig,
    // 播客播放状态
    podcastActive: false,
    podcastPlaying: false,
    podcastLoading: false,
    podcastTitle: '',
    podcastDescription: '',
    podcastUrl: '',
    podcastCoverUrl: '',
    podcastDuration: 0,
    podcastCurrentTime: 0,
    podcastSectionId: '',
    audioContext: null
  }
});
