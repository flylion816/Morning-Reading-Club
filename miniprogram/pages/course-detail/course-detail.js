const courseService = require('../../services/course.service');
const checkinService = require('../../services/checkin.service');
const commentService = require('../../services/comment.service');
const activityService = require('../../services/activity.service');
const subscribeMessageService = require('../../services/subscribe-message.service');
const subscribeAutoTopUp = require('../../utils/subscribe-auto-topup');
const constants = require('../../config/constants');
const { getAvatarColorByUserId } = require('../../utils/formatters');
const { getPeriodAccess, extractId } = require('../../utils/period-access');
const { renderRichTextContent } = require('../../utils/markdown');
const envConfig = require('../../config/env');
const { requireLogin } = require('../../utils/require-login');
const { normalizeDanmakuContent } = require('../../utils/danmaku');
const { createContainedShareCover } = require('../../utils/share-cover');
const { THEME_PRIMARY, WECHAT_SI_PLUGIN_ENABLED } = require('../../utils/theme');
const { getBrandName, getDefaultShareImage } = require('../../utils/brand');
const {
  createPodcastAudioContext,
  setPodcastAudioSource,
  stopPodcastAudio
} = require('../../utils/podcast-audio');

const COMMUNITY_AUTO_TOP_UP_SCENES = [
  'comment_received',
  'like_received',
  'next_day_study_reminder'
];

const MINI_PROGRAM_CODE_ASSET_PATHS = [
  '/assets/images/mini-program-code.jpg',
  '../../assets/images/mini-program-code.jpg'
];
const SECTION_CHECKIN_FETCH_LIMIT = 30;
const CHECKIN_CONTENT_FOLD_LINE_LIMIT = 6;
const CHECKIN_CONTENT_FOLD_UNITS_PER_LINE = 18;
const POSTER_MIN_HEIGHT = 900;
const POSTER_LONG_IMAGE_HEIGHT = 2600;
const POSTER_FALLBACK_MAX_HEIGHT = 2400;
const GENERIC_AVATAR_NAMES = new Set(['用户', '匿名用户', '匿名', 'user', 'member']);
const MAX_CHECKIN_IMAGE_COUNT = 9;

const POSTER_STYLE_PRESETS = [
  {
    id: 'aurora',
    name: '青岚',
    cardFill: '#ffffff',
    bgColors: ['#dff9ef', '#8fe5db', '#f7fffd'],
    accentColors: ['#50d1b2', '#7dd8ff'],
    chipFill: '#eefaf7',
    chipText: '#24a381',
    contentCardFill: '#ffffff',
    footerText: '#8fa0b2'
  },
  {
    id: 'lilac',
    name: '暮紫',
    cardFill: '#ffffff',
    bgColors: ['#f5ebff', '#d7dcff', '#fff9ff'],
    accentColors: ['#9e84ff', '#e7a7ff'],
    chipFill: '#f4eeff',
    chipText: '#775ee8',
    contentCardFill: '#ffffff',
    footerText: '#988fb5'
  },
  {
    id: 'sky',
    name: '晴空',
    cardFill: '#ffffff',
    bgColors: ['#dff2ff', '#8fd1ff', '#ffffff'],
    accentColors: ['#4b8cff', '#7cc7ff'],
    chipFill: '#edf4ff',
    chipText: '#356ed9',
    contentCardFill: '#ffffff',
    footerText: '#8ba1bf'
  },
  {
    id: 'paper',
    name: '留白',
    cardFill: '#fffdf8',
    bgColors: ['#f7f4ee', '#ffffff', '#f3f6fb'],
    accentColors: ['#2c3f63', '#5d7596'],
    chipFill: '#f2efe8',
    chipText: '#516278',
    contentCardFill: '#ffffff',
    footerText: '#9da7b6'
  }
];

function normalizeCheckinListResponse(response) {
  if (!response) return [];

  const candidates = [
    response.data,
    response.list,
    response.items,
    response.docs,
    response.rows,
    response
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (response.data && typeof response.data === 'object') {
    if (Array.isArray(response.data.list)) return response.data.list;
    if (Array.isArray(response.data.items)) return response.data.items;
    if (Array.isArray(response.data.docs)) return response.data.docs;
    if (Array.isArray(response.data.rows)) return response.data.rows;
  }

  return [];
}

function normalizeCheckinImages(images) {
  return checkinService.normalizeCheckinImages(images, MAX_CHECKIN_IMAGE_COUNT);
}

Page({
  data: {
    courseId: null,
    periodId: null,
    paymentStatus: null,
    course: { comments: [] },
    calendar: [],
    checkedDays: 0,
    loading: true,
    showPageContent: false,
    canAccessCommunity: false,
    communityAccessState: 'locked',
    hasUserCheckedIn: false,
    commentExpanded: {},
    commentLoading: {},
    notificationReminder: '',
    searchKeyword: '',
    isCheckinDetailMode: false,
    detailCheckin: null,
    posterGenerating: false,
    posterTempFilePath: '',
    posterSourceCheckinId: '',
    posterGalleryVisible: false,
    posterGalleryItems: [],
    posterSelectedIndex: 0,
    selectedPoster: null,
    focusCheckinId: '',
    focusCommentId: '',
    focusReplyId: '',
    shareCheckinId: '',
    shareCheckinUserName: '',
    canShareCurrentCheckin: true,
    themePrimaryColor: THEME_PRIMARY,
    checkinContentExpanded: {},
    highlightCheckinId: '',
    highlightCommentId: '',
    highlightReplyId: '',
    checkinPage: 1,
    checkinHasMore: false,
    checkinLoadingMore: false,
    readingContentExpanded: false,
    showCheckinShareMenu: false,
    checkinTextShareFilePath: '',
    checkinTextShareFileName: '',
    checkinShareCoverFilePath: '',
    checkinShareCoverSourceUrl: '',
    checkinShareCoverReady: false,
    // 播客
    podcastPlaying: false,
    podcastLoading: false,
    podcastSectionId: '',
    podcastProgress: 0,
    podcastDurationText: '',
    podcastDescExpanded: false,
    podcastShareMode: false,
    podcastShareImagePath: '',
    closingVideoShareMode: false,
    closingVideoShareImagePath: '',
    closingVideoActivated: false,
    // AI 朗读
    ttsAvailable: WECHAT_SI_PLUGIN_ENABLED,
    ttsState: 'idle'  // idle | loading | playing | paused
  },

  _hasRevealedContent: false,

  onLoad(options) {
    console.log('课程详情页加载，参数:', options);
    this._skipNextOnShowRefresh = true;
    this._hasRevealedContent = false;
    if (!options.id || options.id === 'undefined') {
      wx.redirectTo({ url: '/pages/courses/courses' });
      return;
    }
    this._pendingLoadOptions = options;
    this._scrollAnchor = options.anchor || '';
    this.updateShareMenu(true, !!options.checkinId);
    if (options.checkinId) {
      wx.setNavigationBarTitle({
        title: '打卡详情'
      });
    }
  },

  onReady() {
    const options = this._pendingLoadOptions;
    if (!options) return;
    this._pendingLoadOptions = null;

    this.setData({
      courseId: options.id,
      course: { comments: [] },
      showPageContent: false,
      periodId: options.periodId || null,
      searchKeyword: options.keyword ? decodeURIComponent(options.keyword) : '',
      paymentStatus: null,
      canAccessCommunity: false,
      communityAccessState: 'locked',
      isCheckinDetailMode: !!options.checkinId,
      detailCheckin: null,
      posterGenerating: false,
      posterTempFilePath: '',
      posterSourceCheckinId: '',
      posterGalleryVisible: false,
      posterGalleryItems: [],
      posterSelectedIndex: 0,
      selectedPoster: null,
      focusCheckinId: options.checkinId || '',
      focusCommentId: options.commentId || '',
      focusReplyId: options.replyId || '',
      shareCheckinId: options.checkinId || '',
      shareCheckinUserName: '',
      canShareCurrentCheckin: true,
      checkinContentExpanded: {},
      showCheckinShareMenu: false,
      checkinTextShareFilePath: '',
      checkinTextShareFileName: '',
      checkinShareCoverFilePath: '',
      checkinShareCoverSourceUrl: '',
      checkinShareCoverReady: false,
      closingVideoShareMode: false,
      closingVideoActivated: false
    });
    this.loadCourseDetail();
  },

  onHide() {
    this._isPageVisible = false;
    if (this._podcastSyncTimer) {
      clearInterval(this._podcastSyncTimer);
      this._podcastSyncTimer = null;
    }
  },

  onUnload() {
    this._isPageVisible = false;
    this._isPageAlive = false;
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
    if (this._podcastSyncTimer) {
      clearInterval(this._podcastSyncTimer);
      this._podcastSyncTimer = null;
    }
    this._ttsDestroy();
  },

  revealPageContent() {
    this._hasRevealedContent = true;
    if (!this.data.showPageContent) {
      this.setData({ showPageContent: true });
    }
    // 有搜索关键词时自动展开读一读并滚动到内容区
    if (this.data.searchKeyword && !this.data.isCheckinDetailMode) {
      this.setData({ readingContentExpanded: true });
      setTimeout(() => {
        wx.pageScrollTo({ selector: '#reading-section', duration: 300, offsetTop: -8 });
      }, 500);
    }
    if (this._scrollAnchor === 'podcast') {
      setTimeout(() => {
        wx.nextTick(() => {
          wx.pageScrollTo({ selector: '#podcast-section', duration: 280, offsetTop: -20 });
        });
      }, 400);
      this._scrollAnchor = '';
    }
    if (this._scrollAnchor === 'closingVideo') {
      setTimeout(() => {
        wx.nextTick(() => {
          wx.pageScrollTo({ selector: '#closing-video-section', duration: 280, offsetTop: -20 });
        });
      }, 400);
      this._scrollAnchor = '';
    }
    // 预生成播客分享图片，确保第一次点击就有图
    const { course } = this.data;
    if (course && course.podcastUrl && !this.data.podcastShareImagePath) {
      setTimeout(() => {
        this._generatePodcastShareImage(course).then((path) => {
          this.setData({ podcastShareImagePath: path });
        }).catch(() => {});
      }, 800);
    }
    if (course && course.closingVideoCoverUrl && !this.data.closingVideoShareImagePath) {
      setTimeout(() => {
        this._generateClosingVideoShareImage(course).then((path) => {
          this.setData({ closingVideoShareImagePath: path });
        }).catch(() => {});
      }, 1000);
    }
  },

  onShow() {
    this._isPageAlive = true;
    this._isPageVisible = true;
    if (this._podcastSyncTimer) {
      clearInterval(this._podcastSyncTimer);
      this._podcastSyncTimer = null;
    }
    this._podcastSyncTimer = setInterval(() => this.syncPodcastStateFromGlobal(), 1000);

    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false;
      this.syncPodcastStateFromGlobal();
      return;
    }

    // 每次显示页面时重新加载，以显示最新的打卡记录
    if (this.data.courseId && this.data.course) {
      this.loadCourseDetail();
    }
    this.syncPodcastStateFromGlobal();
  },

  setPodcastUiData(data) {
    if (!this._isPageVisible || this._isPageAlive === false) return;
    this.setData(data);
  },

  onShareAppMessage() {
    const {
      course,
      courseId,
      shareCheckinId,
      canShareCurrentCheckin,
      podcastShareMode,
      podcastShareImagePath,
      closingVideoShareMode,
      closingVideoShareImagePath
    } = this.data;

    if (podcastShareMode) {
      this.setData({ podcastShareMode: false });
      activityService.track('podcast_share', { targetId: courseId });
      return {
        title: `「${course.title || ''}」`,
        path: `/pages/course-detail/course-detail?id=${courseId}&anchor=podcast`,
        imageUrl: '/assets/images/fanren-boke.jpg'
      };
    }

    if (closingVideoShareMode) {
      this.setData({ closingVideoShareMode: false });
      activityService.track('closing_video_share', { targetId: courseId });
      return {
        title: `结营视频｜${course.title || '结营词'}`,
        path: `/pages/course-detail/course-detail?id=${courseId}&anchor=closingVideo`,
        imageUrl: closingVideoShareImagePath || course.closingVideoCoverUrl || getDefaultShareImage()
      };
    }

    if (shareCheckinId && canShareCurrentCheckin) {
      const shareConfig = {
        title: this.getCheckinShareTitle(),
        path: `/pages/course-detail/course-detail?id=${courseId}&checkinId=${shareCheckinId}`
      };
      const checkinShareImageUrl = this.getCheckinShareImageUrl();
      if (checkinShareImageUrl) {
        shareConfig.imageUrl = checkinShareImageUrl;
      }
      if (this.getCheckinFirstImageUrl(shareCheckinId)) {
        shareConfig.promise = this.prepareCheckinShareCover(shareCheckinId)
          .then((imageUrl) => ({
            ...shareConfig,
            imageUrl: imageUrl || shareConfig.imageUrl
          }))
          .catch(() => shareConfig);
      }
      return shareConfig;
    }

    activityService.track('course_share', { targetId: courseId });
    const shareConfig = {
      title: course.title || '课程详情',
      path: `/pages/course-detail/course-detail?id=${courseId}`
    };
    if (course.closingVideoCoverUrl) {
      shareConfig.imageUrl = course.closingVideoCoverUrl;
    }
    return shareConfig;
  },

  onShareTimeline() {
    const {
      course,
      courseId,
      shareCheckinId,
      canShareCurrentCheckin
    } = this.data;

    if (shareCheckinId && canShareCurrentCheckin) {
      const timelineConfig = {
        title: this.getCheckinShareTitle(),
        query: `id=${courseId}&checkinId=${shareCheckinId}`
      };
      const checkinShareImageUrl = this.getCheckinShareImageUrl();
      if (checkinShareImageUrl) {
        timelineConfig.imageUrl = checkinShareImageUrl;
      }
      return timelineConfig;
    }

    const timelineConfig = {
      title: course.title || '课程详情',
      query: `id=${courseId}`
    };
    if (course.closingVideoCoverUrl) {
      timelineConfig.imageUrl = course.closingVideoCoverUrl;
    }
    return timelineConfig;
  },

  getCheckinShareTitle() {
    const { course, shareCheckinUserName, detailCheckin } = this.data;
    const userName = shareCheckinUserName || detailCheckin?.userName || '';
    return userName
      ? `${userName}的打卡日记`
      : course.title || '动态详情';
  },

  getCheckinFirstImageUrl(checkinId = this.data.shareCheckinId) {
    if (!checkinId) {
      return '';
    }

    const { detailCheckin, course } = this.data;
    const candidates = [];

    if (
      detailCheckin &&
      String(detailCheckin.id || detailCheckin._id) === String(checkinId)
    ) {
      candidates.push(detailCheckin);
    }

    const targetCheckin = (course?.comments || []).find(
      (item) => String(item.id || item._id) === String(checkinId)
    );
    if (targetCheckin) {
      candidates.push(targetCheckin);
    }

    for (const checkin of candidates) {
      const images = normalizeCheckinImages(checkin.images);
      if (images.length > 0) {
        return images[0];
      }
    }

    return '';
  },

  getCheckinShareImageUrl(checkinId = this.data.shareCheckinId) {
    const sourceUrl = this.getCheckinFirstImageUrl(checkinId);
    if (!sourceUrl) {
      return '';
    }

    if (
      this.data.checkinShareCoverFilePath &&
      this.data.checkinShareCoverSourceUrl === sourceUrl &&
      this.data.checkinShareCoverReady
    ) {
      return this.data.checkinShareCoverFilePath;
    }

    return sourceUrl;
  },

  async generateCheckinShareCover(sourceUrl) {
    return createContainedShareCover(this, sourceUrl, {
      selector: '#checkinShareCoverCanvas'
    });
  },

  async prepareCheckinShareCover(checkinId = this.data.shareCheckinId) {
    const sourceUrl = this.getCheckinFirstImageUrl(checkinId);
    if (!sourceUrl) {
      return '';
    }

    if (
      this.data.checkinShareCoverFilePath &&
      this.data.checkinShareCoverSourceUrl === sourceUrl &&
      this.data.checkinShareCoverReady
    ) {
      return this.data.checkinShareCoverFilePath;
    }

    if (
      this._checkinShareCoverPromise &&
      this._checkinShareCoverSourceUrl === sourceUrl
    ) {
      return this._checkinShareCoverPromise;
    }

    this._checkinShareCoverSourceUrl = sourceUrl;
    this._checkinShareCoverPromise = this.generateCheckinShareCover(sourceUrl)
      .then((filePath) => {
        if (this._checkinShareCoverSourceUrl === sourceUrl) {
          this.setData({
            checkinShareCoverFilePath: filePath,
            checkinShareCoverSourceUrl: sourceUrl,
            checkinShareCoverReady: true
          });
        }
        return filePath;
      })
      .catch((error) => {
        console.warn('生成打卡分享封面失败，使用原图分享:', error);
        if (this._checkinShareCoverSourceUrl === sourceUrl) {
          this.setData({
            checkinShareCoverFilePath: '',
            checkinShareCoverSourceUrl: sourceUrl,
            checkinShareCoverReady: false
          });
        }
        return sourceUrl;
      })
      .finally(() => {
        if (this._checkinShareCoverSourceUrl === sourceUrl) {
          this._checkinShareCoverPromise = null;
        }
      });

    return this._checkinShareCoverPromise;
  },

  buildCheckinTextShareContent(checkin = this.data.detailCheckin) {
    const title = this.getCheckinShareTitle();
    const lines = [
      title,
      checkin?.metaLine || '',
      checkin?.hashTag || '',
      checkin?.periodChip || '',
      checkin?.dateLabel || '',
      '',
      checkin?.content || '',
      '',
      `By ${getBrandName()}`
    ];

    return lines
      .filter((line, index) => line || lines[index - 1] !== '')
      .join('\n')
      .trim();
  },

  getCheckinTextShareFileName() {
    const brandName = getBrandName();
    const displayName = `${brandName}：${this.getCheckinShareTitle()}`;
    const fileName = String(displayName)
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, '')
      .slice(0, 48) || brandName;
    return `${fileName}.txt`;
  },

  prepareCheckinTextShareFile(options = {}) {
    const showLoading = options.showLoading !== false;
    const content = this.buildCheckinTextShareContent();

    if (!content.trim()) {
      this.setData({ checkinTextShareFilePath: '', checkinTextShareFileName: '' });
      return Promise.resolve(false);
    }

    const fileSystemManager = wx.getFileSystemManager && wx.getFileSystemManager();
    const userDataPath = wx.env && wx.env.USER_DATA_PATH;

    if (!fileSystemManager || !userDataPath) {
      this.setData({ checkinTextShareFilePath: '', checkinTextShareFileName: '' });
      return Promise.resolve(false);
    }

    const fileName = this.getCheckinTextShareFileName();
    const filePath = `${userDataPath}/${fileName}`;
    if (showLoading) {
      wx.showLoading?.({ title: '生成文本...', mask: true });
    }

    return new Promise(resolve => {
      fileSystemManager.writeFile({
        filePath,
        data: content,
        encoding: 'utf8',
        success: () => {
          if (showLoading) {
            wx.hideLoading?.();
          }
          this.setData({
            checkinTextShareFilePath: filePath,
            checkinTextShareFileName: fileName
          });
          resolve(true);
        },
        fail: error => {
          if (showLoading) {
            wx.hideLoading?.();
          }
          console.error('打卡文本文件生成失败:', error);
          this.setData({ checkinTextShareFilePath: '', checkinTextShareFileName: '' });
          resolve(false);
        }
      });
    });
  },

  async openCheckinShareMenu() {
    wx.showLoading?.({ title: '准备分享...', mask: true });
    try {
      await Promise.all([
        this.prepareCheckinTextShareFile({ showLoading: false }),
        this.prepareCheckinShareCover()
      ]);
      this.setData({ showCheckinShareMenu: true });
    } finally {
      wx.hideLoading?.();
    }
  },

  closeCheckinShareMenu() {
    this.setData({ showCheckinShareMenu: false });
  },

  handleCheckinShareMenuLongImage() {
    this.closeCheckinShareMenu();
    this.handleLongImageShare();
  },

  handleCheckinTextShare() {
    this.closeCheckinShareMenu();

    if (typeof wx.shareFileMessage !== 'function') {
      wx.showToast({ title: '当前微信版本不支持txt转发', icon: 'none' });
      return;
    }

    const { checkinTextShareFilePath, checkinTextShareFileName } = this.data;
    if (!checkinTextShareFilePath) {
      wx.showToast({ title: '文本未生成，请重新点分享', icon: 'none' });
      return;
    }

    wx.shareFileMessage({
      filePath: checkinTextShareFilePath,
      fileName: checkinTextShareFileName,
      fail: error => {
        console.error('打卡文本文件转发失败:', error);
        wx.showToast({ title: '转发失败，请重试', icon: 'none' });
      }
    });
  },

  /**
   * 清理 HTML，使其与小程序 rich-text 兼容
   * 小程序 rich-text 支持：p、br、strong、em、u、s、span、img、a、li、ol、ul 等标签
   */
  _highlightKeyword(html, keyword) {
    if (!html || !keyword) return html;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    return html.replace(/(<[^>]*>)|([^<]+)/g, (match, tag, text) => {
      if (tag) return tag;
      if (!text) return match;
      return text.replace(re, '<span style="font-weight:bold;background:#fff3b0;color:#b45309">$1</span>');
    });
  },

  cleanHtmlForRichText(content) {
    if (!content) return '';

    let cleaned = renderRichTextContent(content);

    // 1. 移除 class 属性
    cleaned = cleaned.replace(/\s+class="[^"]*"/gi, '');

    // 2. 仅移除图片旧样式，保留 Markdown 渲染所需的段落/列表样式
    cleaned = cleaned.replace(/<img([^>]*?)\s+style="[^"]*"/gi, '<img$1');

    // 3. 识别手工输入的列表项格式（如"1. 文本"、"2. 文本"）并增加间距
    // 匹配 <p> 标签中以数字+点开头的内容
    cleaned = cleaned.replace(
      /<p>(\d+\.\s)/gi,
      '<p style="margin-bottom:16px;">$1'
    );

    // 4. 为所有 <img> 标签添加合适的 style
    // 关键：使用 display:block 和 width:100% 让图片充满容器
    cleaned = cleaned.replace(
      /<img([^>]*?)>/gi,
      '<img$1 style="display:block;width:100%;height:auto;margin:12px 0;border-radius:4px;" />'
    );

    // 5. 确保所有图片都有 alt 属性
    cleaned = cleaned.replace(/<img([^>]*?)src/gi, (match, before) => {
      if (!before.includes('alt=')) {
        return `<img${before}alt="图片" src`;
      }
      return match;
    });

    // 6. 移除其他不必要的属性（保留 src, href, alt, style）
    cleaned = cleaned.replace(/\s+(?!src|href|alt|style)[\w-]+="[^"]*"/gi, '');

    return cleaned;
  },

  /**
   * 检查内容是否为空（包括去除空格）
   */
  isContentEmpty(content) {
    if (!content) return true;
    if (typeof content === 'string') {
      return content.trim() === '';
    }
    return false;
  },

  normalizeId(value) {
    if (!value) return '';
    if (typeof value === 'object') {
      return String(value._id || value.id || '');
    }
    return String(value);
  },

  getCurrentUserId() {
    const app = getApp();
    return this.normalizeId(
      app.globalData.userInfo?._id || app.globalData.userInfo?.id
    );
  },

  getCheckinContentUnits(text = '') {
    return Array.from(String(text || '')).reduce((sum, char) => {
      return sum + (/[^\x00-\xff]/.test(char) ? 1 : 0.5);
    }, 0);
  },

  estimateCheckinContentLines(text = '') {
    const paragraphs = String(text || '')
      .replace(/\r/g, '')
      .split('\n');

    return paragraphs.reduce((total, paragraph) => {
      const units = this.getCheckinContentUnits(paragraph || ' ');
      return (
        total +
        Math.max(1, Math.ceil(units / CHECKIN_CONTENT_FOLD_UNITS_PER_LINE))
      );
    }, 0);
  },

  shouldFoldCheckinContent(text = '') {
    return (
      this.estimateCheckinContentLines(text) > CHECKIN_CONTENT_FOLD_LINE_LIMIT
    );
  },

  isOwnCheckin(checkin = {}) {
    const currentUserId = this.getCurrentUserId();
    if (!currentUserId) {
      return false;
    }

    return String(this.normalizeId(checkin.userId)) === String(currentUserId);
  },

  updateShareMenu(
    canShare = true,
    forceDetailMode = this.data.isCheckinDetailMode
  ) {
    if (forceDetailMode && !canShare) {
      if (typeof wx.hideShareMenu === 'function') {
        wx.hideShareMenu();
      }
      return;
    }

    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({
        withShareTicket: false
      });
    }
  },

  getAvatarDisplayInfo(user, options = {}) {
    const fallbackName = options.fallbackName || '用户';
    const fallbackAvatarText = options.fallbackAvatarText || this.getNameAvatarText(fallbackName);
    const suppressGenericFallback = !!options.suppressGenericFallback;

    if (!user) {
      return {
        avatarUrl: '',
        avatarText: suppressGenericFallback ? '' : fallbackAvatarText,
        avatarIsEmoji: false,
        avatarColor: getAvatarColorByUserId(fallbackName),
        userId: '',
        isGenericAvatar: suppressGenericFallback
      };
    }

    if (typeof user === 'string') {
      const knownUser = this.findKnownUserById(user);
      if (knownUser) {
        return this.getAvatarDisplayInfo(knownUser, options);
      }

      return {
        userId: String(user),
        avatarUrl: '',
        avatarText: suppressGenericFallback ? '' : fallbackAvatarText,
        avatarIsEmoji: false,
        avatarColor: getAvatarColorByUserId(user),
        isGenericAvatar: suppressGenericFallback
      };
    }

    const name =
      user.nickname ||
      user.name ||
      user.userName ||
      user.displayName ||
      fallbackName;
    const userId = String(user._id || user.id || user.userId || '');
    let avatarUrl = user.avatarUrl || '';
    let avatarText = '';

    if (!avatarUrl) {
      if (name && !GENERIC_AVATAR_NAMES.has(String(name).trim().toLowerCase())) {
        avatarText = this.getNameAvatarText(name, fallbackAvatarText);
      } else {
        avatarText = suppressGenericFallback ? '' : fallbackAvatarText;
      }
    }

    return {
      userId,
      avatarUrl,
      avatarText: avatarText || (suppressGenericFallback ? '' : fallbackAvatarText),
      avatarIsEmoji: false,
      avatarColor: user.avatarColor || getAvatarColorByUserId(userId || name || fallbackName),
      isGenericAvatar: !avatarUrl && !avatarText && suppressGenericFallback
    };
  },

  getNameAvatarText(name, fallback = '用') {
    const chars = Array.from(String(name || '').trim());
    if (chars.length === 0) return fallback;
    return chars[chars.length - 1];
  },

  findKnownUserById(userId) {
    const targetId = String(userId || '');
    if (!targetId) return null;

    const comments = this.data.course?.comments || [];
    const candidates = [];
    comments.forEach((item) => {
      candidates.push(item);
      (item.replies || []).forEach((reply) => {
        candidates.push(reply);
        (reply.replies || []).forEach((nestedReply) => candidates.push(nestedReply));
      });
    });
    if (this.data.detailCheckin) {
      candidates.push(this.data.detailCheckin);
      (this.data.detailCheckin.replies || []).forEach((reply) => candidates.push(reply));
    }

    const matched = candidates.find((item) => String(item.userId || '') === targetId);
    if (matched) {
      return {
        _id: matched.userId,
        nickname: matched.userName,
        avatar: '',
        avatarUrl: matched.avatarUrl || '',
        avatarColor: matched.avatarColor || getAvatarColorByUserId(matched.userId || matched.userName)
      };
    }

    const app = getApp();
    const currentUser = app.globalData.userInfo || {};
    const currentUserId = String(currentUser._id || currentUser.id || '');
    return currentUserId && currentUserId === targetId ? currentUser : null;
  },

  getLikeAvatarInfo(user) {
    if (!user) return null;

    // populate 成功：like.userId 是用户对象，有 _id 或 nickname
    if (typeof user === 'object' && (user._id || user.id || user.nickname || user.avatarUrl)) {
      const name = user.nickname || user.name || user.userName || '';
      return this.getAvatarDisplayInfo(user, {
        fallbackName: name || '赞',
        fallbackAvatarText: name ? this.getNameAvatarText(name) : '赞',
        suppressGenericFallback: false
      });
    }

    // populate 失败：like.userId || like 拿到的是原始 like 文档 {userId: ObjectId, createdAt}
    // 或者 like.userId 是字符串 ObjectId
    const userId = typeof user === 'string'
      ? user
      : String(user.userId || '');

    if (!userId) return null;

    const knownUser = this.findKnownUserById(userId);
    if (knownUser) {
      return this.getAvatarDisplayInfo(knownUser, {
        fallbackName: knownUser.nickname || '赞',
        fallbackAvatarText: this.getNameAvatarText(knownUser.nickname || '赞'),
        suppressGenericFallback: false
      });
    }

    return {
      userId,
      avatarUrl: '',
      avatarText: '赞',
      avatarIsEmoji: false,
      avatarColor: getAvatarColorByUserId(userId),
      isGenericAvatar: true
    };
  },

  getLikeAvatarsFromLikes(likes = []) {
    if (!Array.isArray(likes)) return [];
    return likes
      .map((like) => this.getLikeAvatarInfo(like.userId || like))
      .filter(Boolean);
  },

  getDisplayLikeAvatars(likeAvatars) {
    if (!likeAvatars || !Array.isArray(likeAvatars)) return [];
    return likeAvatars.slice(0, 4);
  },

  buildCheckinItem(checkin = {}) {
    const app = getApp();
    const currentUserId =
      app.globalData.userInfo?._id || app.globalData.userInfo?.id;
    const userInfo =
      checkin.userId && typeof checkin.userId === 'object'
        ? checkin.userId
        : {};
    const sectionInfo =
      checkin.sectionId && typeof checkin.sectionId === 'object'
        ? checkin.sectionId
        : {};
    const periodInfo =
      checkin.periodId && typeof checkin.periodId === 'object'
        ? checkin.periodId
        : {};
    const userName = userInfo.nickname || checkin.userName || '匿名用户';
    const avatarSource = {
      ...userInfo,
      avatarUrl: userInfo.avatarUrl || checkin.avatarUrl || '',
      avatar: userInfo.avatar || checkin.avatar || ''
    };
    const normalizedUserId = this.normalizeId(
      userInfo._id || userInfo.id || checkin.userId || userName
    );
    const id = this.normalizeId(checkin._id || checkin.id);
    const content = normalizeDanmakuContent(checkin.note || checkin.content || '');
    const images = normalizeCheckinImages(checkin.images);
    const kw = this.data.searchKeyword;
    const richContentHtml = checkin.contentHtml
      ? this.cleanHtmlForRichText(checkin.contentHtml)
      : '';
    const contentHtml = kw
      ? this._highlightKeyword(
          content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'),
          kw
        )
      : richContentHtml;

    return {
      id,
      userId: this.normalizeId(userInfo._id || userInfo.id || checkin.userId),
      periodId: this.normalizeId(
        periodInfo._id ||
          periodInfo.id ||
          checkin.periodId ||
          this.data.periodId
      ),
      sectionId: this.normalizeId(
        sectionInfo._id ||
          sectionInfo.id ||
          checkin.sectionId ||
          this.data.courseId
      ),
      userName,
      ...this.getAvatarDisplayInfo(avatarSource, {
        fallbackName: userName,
        fallbackAvatarText: this.getNameAvatarText(userName)
      }),
      avatarColor:
        checkin.avatarColor || getAvatarColorByUserId(normalizedUserId),
      content,
      contentHtml,
      hasRichContent: !!richContentHtml,
      images,
      imageCount: images.length,
      canExpandContent: this.shouldFoldCheckinContent(content),
      contentExpanded: !!this.data.checkinContentExpanded[id],
      createTime:
        checkin.createdAt || checkin.checkinDate
          ? this.formatTime(checkin.createdAt || checkin.checkinDate)
          : '刚刚',
      checkinDate: checkin.checkinDate || checkin.createdAt || '',
      likeCount: checkin.likeCount || 0,
      isLiked:
        Array.isArray(checkin.likes) && currentUserId
          ? checkin.likes.some(
              (like) =>
                String(
                  like.userId?._id || like.userId?.id || like.userId || like
                ) === String(currentUserId)
            )
          : false,
      likeAvatars: this.getLikeAvatarsFromLikes(checkin.likes),
      displayLikeAvatars: this.getDisplayLikeAvatars(this.getLikeAvatarsFromLikes(checkin.likes)),
      replies: [],
      day: checkin.day ?? sectionInfo.day ?? this.data.course?.day ?? null,
      sectionDay:
        sectionInfo.day ?? checkin.day ?? this.data.course?.day ?? null,
      sectionTitle: sectionInfo.title || this.data.course?.title || '晨读任务',
      sectionIcon: sectionInfo.icon || '',
      periodTitle:
        periodInfo.title ||
        periodInfo.name ||
        this.data.course?.periodId?.title ||
        this.data.course?.periodId?.name ||
        ''
    };
  },

  formatDetailDateTime(dateStr) {
    if (!dateStr) return '';

    try {
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        return '';
      }

      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const hh = String(date.getHours()).padStart(2, '0');
      const mi = String(date.getMinutes()).padStart(2, '0');
      const ss = String(date.getSeconds()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    } catch (error) {
      return '';
    }
  },

  buildDetailCheckinData(checkin) {
    if (!checkin) {
      return null;
    }

    const sectionDay =
      checkin.sectionDay || checkin.day || this.data.course?.day || null;
    const metaParts = [];
    if (sectionDay) {
      metaParts.push(`第${sectionDay}天打卡`);
      metaParts.push(`第${sectionDay}个任务`);
    } else {
      metaParts.push('打卡日记');
    }

    const periodTitle =
      checkin.periodTitle ||
      this.data.course?.periodId?.title ||
      this.data.course?.periodId?.name ||
      '';
    const sectionTitle =
      checkin.sectionTitle || this.data.course?.title || '晨读任务';
    const hashTag = sectionDay
      ? `#第${sectionDay}天 ${sectionTitle}`
      : `#${sectionTitle}`;
    const checkinId = this.normalizeId(checkin.id || checkin._id);

    return {
      ...checkin,
      images: normalizeCheckinImages(checkin.images),
      metaLine: metaParts.join(' | '),
      hashTag,
      periodChip: periodTitle || sectionTitle,
      dateLabel: this.formatDetailDateTime(checkin.checkinDate),
      commentCount: Array.isArray(checkin.replies) ? checkin.replies.length : 0,
      canShare: true,
      isOwner: this.isOwnCheckin(checkin),
      canExpandContent:
        checkin.canExpandContent ||
        this.shouldFoldCheckinContent(checkin.content),
      contentExpanded: !!this.data.checkinContentExpanded[checkinId] || !!this.data.searchKeyword
    };
  },

  syncDetailCheckinState(checkinId = this.data.shareCheckinId) {
    if (!this.data.isCheckinDetailMode || !checkinId) {
      return;
    }

    const targetCheckin = (this.data.course.comments || []).find(
      (item) => String(item.id || item._id) === String(checkinId)
    );

    if (!targetCheckin) {
      this.setData({
        detailCheckin: null,
        canShareCurrentCheckin: true
      });
      this.updateShareMenu(true);
      return;
    }

    const detailCheckin = this.buildDetailCheckinData(targetCheckin);
    this.setData({
      detailCheckin,
      canShareCurrentCheckin: !!detailCheckin.canShare
    }, () => {
      if (detailCheckin.canShare && detailCheckin.imageCount > 0) {
        this.prepareCheckinShareCover(checkinId);
      }
    });
    this.updateShareMenu(!!detailCheckin.canShare);
  },

  syncCheckinContentExpandedState(checkinId, expanded) {
    if (!checkinId) {
      return;
    }

    const nextExpandedMap = {
      ...this.data.checkinContentExpanded,
      [checkinId]: expanded
    };

    const nextComments = Array.isArray(this.data.course?.comments)
      ? this.data.course.comments.map((item) => {
          if (String(item.id || item._id) !== String(checkinId)) {
            return item;
          }

          return {
            ...item,
            contentExpanded: expanded
          };
        })
      : null;

    const nextData = {
      checkinContentExpanded: nextExpandedMap
    };

    if (nextComments) {
      nextData.course = {
        ...this.data.course,
        comments: nextComments
      };
    }

    if (
      this.data.detailCheckin &&
      String(this.data.detailCheckin.id) === String(checkinId)
    ) {
      nextData.detailCheckin = {
        ...this.data.detailCheckin,
        contentExpanded: expanded
      };
    }

    this.setData(nextData);
  },

  toggleCheckinContent(e) {
    const { checkinId } = e.currentTarget.dataset;
    const expanded = !this.data.checkinContentExpanded[checkinId];
    this.syncCheckinContentExpandedState(checkinId, expanded);
  },

  toggleReadingContent() {
    this.setData({ readingContentExpanded: !this.data.readingContentExpanded });
  },

  getPosterTextUnits(text = '') {
    return Array.from(String(text)).reduce((sum, char) => {
      return sum + (/[^\x00-\xff]/.test(char) ? 2 : 1);
    }, 0);
  },

  wrapPosterText(text = '', maxUnits = 34) {
    const lines = [];
    const paragraphs = String(text || '').split('\n');

    paragraphs.forEach((paragraph, paragraphIndex) => {
      const trimmed = paragraph.replace(/\r/g, '');
      if (!trimmed) {
        lines.push('');
        return;
      }

      let currentLine = '';
      let currentUnits = 0;

      Array.from(trimmed).forEach((char) => {
        const nextUnits = this.getPosterTextUnits(char);
        if (currentLine && currentUnits + nextUnits > maxUnits) {
          lines.push(currentLine);
          currentLine = char;
          currentUnits = nextUnits;
          return;
        }

        currentLine += char;
        currentUnits += nextUnits;
      });

      if (currentLine) {
        lines.push(currentLine);
      }

      if (paragraphIndex < paragraphs.length - 1) {
        lines.push('');
      }
    });

    return lines.length > 0 ? lines : [''];
  },

  getPosterLinesHeight(lines = [], lineHeight, emptyLineHeight) {
    return lines.reduce((sum, line) => {
      return sum + (line ? lineHeight : emptyLineHeight);
    }, 0);
  },

  trimPosterTrailingBlankLines(lines = []) {
    const nextLines = [...lines];
    while (nextLines.length > 0 && !nextLines[nextLines.length - 1]) {
      nextLines.pop();
    }
    return nextLines;
  },

  fitPosterLinesToHeight(lines = [], maxHeight, lineHeight, emptyLineHeight) {
    const overflowLines = ['', '……', '进入小程序查看完整内容'];
    const overflowHeight = this.getPosterLinesHeight(
      overflowLines,
      lineHeight,
      emptyLineHeight
    );
    const fittedLines = [];
    let usedHeight = 0;

    for (const line of lines) {
      const currentHeight = line ? lineHeight : emptyLineHeight;
      if (usedHeight + currentHeight + overflowHeight > maxHeight) {
        return {
          lines: [...this.trimPosterTrailingBlankLines(fittedLines), ...overflowLines],
          truncated: true
        };
      }

      fittedLines.push(line);
      usedHeight += currentHeight;
    }

    return {
      lines,
      truncated: false
    };
  },

  normalizePosterContent(text = '') {
    return String(text || '')
      .replace(/\[爱心\]/g, '❤️')
      .replace(/\[拥抱\]/g, '🤗')
      .replace(/\[玫瑰\]/g, '🌹')
      .replace(/\[玫瑰花\]/g, '🌹');
  },

  buildPosterSnapshot(
    detailCheckin,
    stylePreset = POSTER_STYLE_PRESETS[0],
    options = {}
  ) {
    const contentText = this.normalizePosterContent(
      detailCheckin?.content || '这篇打卡还没有填写正文'
    );
    const contentWrapUnits = stylePreset.id === 'paper' ? 50 : 52;
    const titleWrapUnits = stylePreset.id === 'paper' ? 28 : 30;
    const tagWrapUnits = stylePreset.id === 'paper' ? 36 : 38;
    const rawContentLines = this.wrapPosterText(contentText, contentWrapUnits);
    const titleLines = this.wrapPosterText(
      `${detailCheckin?.userName || '伙伴'}的打卡日记`,
      titleWrapUnits
    );
    const tagLines = detailCheckin?.hashTag
      ? this.wrapPosterText(detailCheckin.hashTag, tagWrapUnits)
      : [];
    const periodChip =
      detailCheckin?.periodChip || detailCheckin?.sectionTitle || '晨读任务';
    const dateLabel = detailCheckin?.dateLabel || '';
    const sectionTitle = detailCheckin?.sectionTitle || '晨读任务';
    const statsLine = `获赞 ${detailCheckin?.likeCount || 0} · 评论 ${detailCheckin?.commentCount || 0}`;
    const titleLineHeight = 54;
    const contentLineHeight = 52;
    const tagLineHeight = 42;
    const emptyLineHeight = Math.floor(contentLineHeight * 0.65);
    const emptyTagLineHeight = Math.floor(tagLineHeight * 0.65);
    const fullTagLines = tagLines.filter(l => !!l).length;
    const emptyTagLines = tagLines.length - fullTagLines;
    const footerHeight = 380;
    const tagHeight =
      tagLines.length > 0
        ? fullTagLines * tagLineHeight + emptyTagLines * emptyTagLineHeight + 24
        : 0;
    const fixedHeight =
      120 +
      titleLines.length * titleLineHeight +
      96 +
      tagHeight +
      footerHeight;
    const maxHeight = Number(options.maxHeight) || 0;
    const fittedContent = maxHeight
      ? this.fitPosterLinesToHeight(
          rawContentLines,
          Math.max(contentLineHeight * 6, maxHeight - fixedHeight),
          contentLineHeight,
          emptyLineHeight
        )
      : {
          lines: rawContentLines,
          truncated: false
        };
    const contentLines = fittedContent.lines;
    const contentHeight = this.getPosterLinesHeight(
      contentLines,
      contentLineHeight,
      emptyLineHeight
    );
    const baseHeight =
      fixedHeight +
      contentHeight;

    return {
      width: 1040,
      height: Math.max(
        POSTER_MIN_HEIGHT,
        maxHeight ? Math.min(maxHeight, baseHeight) : baseHeight
      ),
      titleLines,
      contentLines,
      contentTruncated: fittedContent.truncated,
      tagLines,
      periodChip,
      dateLabel,
      sectionTitle,
      statsLine,
      contentWrapUnits,
      authorName: detailCheckin?.userName || '伙伴',
      authorMeta: detailCheckin?.metaLine || '打卡日记',
      avatarText:
        detailCheckin?.avatarText ||
        this.getNameAvatarText(detailCheckin?.userName || '伙伴', '伙') ||
        '伙',
      miniProgramCodePath: MINI_PROGRAM_CODE_ASSET_PATHS[0],
      styleId: stylePreset.id,
      styleName: stylePreset.name,
      stylePreset,
      footerHeight
    };
  },

  async loadPosterImage(canvas, srcCandidates = []) {
    if (!canvas || typeof canvas.createImage !== 'function') {
      throw new Error('当前环境不支持图片绘制');
    }

    const candidates = Array.isArray(srcCandidates)
      ? srcCandidates
      : [srcCandidates];
    let lastError = null;

    for (const src of candidates) {
      if (!src) {
        continue;
      }

      try {
        const image = await new Promise((resolve, reject) => {
          const instance = canvas.createImage();
          instance.onload = () => resolve(instance);
          instance.onerror = (error) =>
            reject(error || new Error(`加载图片失败: ${src}`));
          instance.src = src;
        });
        return image;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('加载图片失败');
  },

  async getPosterCanvasNode() {
    if (!wx.createSelectorQuery) {
      throw new Error('当前环境不支持长图生成');
    }

    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery();
      if (typeof query.in === 'function') {
        query.in(this);
      }

      query
        .select('#longImageCanvas')
        .fields({ node: true, size: true })
        .exec((result) => {
          const target = result && result[0];
          if (!target || !target.node) {
            reject(new Error('找不到长图画布'));
            return;
          }
          resolve(target);
        });
    });
  },

  drawPosterRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
  },

  drawPosterTextLines(ctx, lines, startX, startY, lineHeight) {
    let cursorY = startY;
    lines.forEach((line) => {
      if (!line) {
        cursorY += Math.floor(lineHeight * 0.65);
        return;
      }

      ctx.fillText(line, startX, cursorY);
      cursorY += lineHeight;
    });
    return cursorY;
  },

  drawPosterDecoration(ctx, snapshot, stylePreset) {
    const cardMargin = 48;
    const cardX = cardMargin;
    const cardY = cardMargin;
    const cardWidth = snapshot.width - cardMargin * 2;
    const cardHeight = snapshot.height - cardMargin * 2;
    const borderRadius = 40;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.06)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 12;
    this.drawPosterRoundedRect(
      ctx,
      cardX,
      cardY,
      cardWidth,
      cardHeight,
      borderRadius,
      '#ffffff'
    );
    ctx.restore();

    const clipInner = () => {
      ctx.beginPath();
      ctx.moveTo(cardX + borderRadius, cardY);
      ctx.lineTo(cardX + cardWidth - borderRadius, cardY);
      ctx.arcTo(
        cardX + cardWidth,
        cardY,
        cardX + cardWidth,
        cardY + borderRadius,
        borderRadius
      );
      ctx.lineTo(cardX + cardWidth, cardY + cardHeight - borderRadius);
      ctx.arcTo(
        cardX + cardWidth,
        cardY + cardHeight,
        cardX + cardWidth - borderRadius,
        cardY + cardHeight,
        borderRadius
      );
      ctx.lineTo(cardX + borderRadius, cardY + cardHeight);
      ctx.arcTo(
        cardX,
        cardY + cardHeight,
        cardX,
        cardY + cardHeight - borderRadius,
        borderRadius
      );
      ctx.lineTo(cardX, cardY + borderRadius);
      ctx.arcTo(cardX, cardY, cardX + borderRadius, cardY, borderRadius);
      ctx.closePath();
      ctx.clip();
    };

    ctx.save();
    clipInner();

    if (stylePreset.id === 'aurora') {
      ctx.globalAlpha = 0.5;
      const grad1 = ctx.createLinearGradient(0, 0, snapshot.width, 400);
      grad1.addColorStop(0, stylePreset.accentColors[0]);
      grad1.addColorStop(1, '#ffffff');
      ctx.fillStyle = grad1;
      ctx.beginPath();
      ctx.arc(snapshot.width - 50, 50, 400, 0, Math.PI * 2);
      ctx.fill();

      const grad2 = ctx.createLinearGradient(0, 0, 400, 400);
      grad2.addColorStop(0, stylePreset.accentColors[1]);
      grad2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad2;
      ctx.beginPath();
      ctx.arc(cardX, 300, 350, 0, Math.PI * 2);
      ctx.fill();
    } else if (stylePreset.id === 'lilac') {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = stylePreset.accentColors[0];
      ctx.beginPath();
      ctx.arc(cardWidth / 2 + cardX, cardY - 50, 450, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.3;
      const grad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + 400);
      grad.addColorStop(0, stylePreset.bgColors[0]);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cardX, cardY, cardWidth, 400);
    } else if (stylePreset.id === 'sky') {
      const grad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + 400);
      grad.addColorStop(0, stylePreset.accentColors[0] || '#4b8cff');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = grad;
      ctx.fillRect(cardX, cardY, cardWidth, 500);

      ctx.globalAlpha = 0.08;
      ctx.fillStyle = stylePreset.accentColors[0];
      this.drawPosterRoundedRect(
        ctx,
        cardX + 32,
        cardY + 32,
        cardWidth - 64,
        280,
        24,
        stylePreset.accentColors[0]
      );
    } else if (stylePreset.id === 'paper') {
      ctx.globalAlpha = 0.02;
      ctx.fillStyle = stylePreset.accentColors[0];
      ctx.font = 'bold italic 160px sans-serif';
      ctx.fillText('DIARY', snapshot.width - 450, cardY + 160);
    }

    ctx.restore();
  },

  drawPosterOutline(
    ctx,
    x,
    y,
    width,
    height,
    radius,
    strokeStyle,
    lineWidth = 2
  ) {
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  },

  exportPosterCanvasToTempFilePath(canvas, snapshot) {
    const isLongPoster = snapshot.height > POSTER_LONG_IMAGE_HEIGHT;
    const preferredScales = isLongPoster
      ? [1, 0.85]
      : snapshot.height > 2200
        ? [1.25, 1]
        : [2, 1.5, 1];
    let attemptIndex = 0;

    return new Promise((resolve, reject) => {
      const tryExport = () => {
        const scale = preferredScales[attemptIndex];

        wx.canvasToTempFilePath({
          canvas,
          width: snapshot.width,
          height: snapshot.height,
          destWidth: Math.round(snapshot.width * scale),
          destHeight: Math.round(snapshot.height * scale),
          fileType: isLongPoster ? 'jpg' : 'png',
          quality: isLongPoster ? 0.88 : 1,
          success: (res) => resolve(res.tempFilePath),
          fail: (error) => {
            const isLastAttempt = attemptIndex >= preferredScales.length - 1;
            if (isLastAttempt) {
              reject(error);
              return;
            }
            console.warn('长图导出失败，降低清晰度重试', {
              scale,
              error
            });
            attemptIndex += 1;
            tryExport();
          }
        });
      };

      tryExport();
    });
  },

  async generateLongImagePoster(
    detailCheckin,
    stylePreset = POSTER_STYLE_PRESETS[0],
    options = {}
  ) {
    const snapshot = this.buildPosterSnapshot(detailCheckin, stylePreset, options);
    const target = await this.getPosterCanvasNode();
    const canvas = target.node;
    const ctx = canvas.getContext('2d');
    const systemDpr = wx.getWindowInfo?.().pixelRatio || 2;
    const dpr = snapshot.height > POSTER_LONG_IMAGE_HEIGHT
      ? 1
      : Math.min(systemDpr, 2);
    let miniProgramCodeImage = null;

    canvas.width = snapshot.width * dpr;
    canvas.height = snapshot.height * dpr;

    if (typeof ctx.resetTransform === 'function') {
      ctx.resetTransform();
    } else if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, snapshot.width, snapshot.height);

    try {
      miniProgramCodeImage = await this.loadPosterImage(
        canvas,
        MINI_PROGRAM_CODE_ASSET_PATHS
      );
    } catch (error) {
      console.warn('加载小程序码失败，继续生成无二维码长图', error);
    }

    const backgroundGradient = ctx.createLinearGradient(
      0,
      0,
      0,
      snapshot.height
    );
    backgroundGradient.addColorStop(0, stylePreset.bgColors[0] || '#eaf3ff');
    backgroundGradient.addColorStop(0.5, stylePreset.bgColors[1] || '#f8fbff');
    backgroundGradient.addColorStop(1, stylePreset.bgColors[2] || '#ffffff');
    ctx.fillStyle = backgroundGradient;
    ctx.fillRect(0, 0, snapshot.width, snapshot.height);

    this.drawPosterDecoration(ctx, snapshot, stylePreset);

    const contentStartX = 72;
    let cursorY = 120;
    ctx.fillStyle = stylePreset.id === 'paper' ? '#22324a' : '#111827';
    ctx.font = 'bold 44px sans-serif';
    cursorY = this.drawPosterTextLines(
      ctx,
      snapshot.titleLines,
      contentStartX,
      cursorY,
      58
    );

    ctx.fillStyle = stylePreset.id === 'paper' ? '#607089' : '#6b7280';
    ctx.font = '26px sans-serif';
    cursorY += 14;
    ctx.fillText(snapshot.sectionTitle, contentStartX, cursorY);

    cursorY += 80;
    ctx.fillStyle = '#1f2937';
    ctx.font = '34px sans-serif';
    cursorY = this.drawPosterTextLines(
      ctx,
      snapshot.contentLines,
      contentStartX,
      cursorY,
      52
    );

    if (snapshot.tagLines.length > 0) {
      cursorY += 32;
      ctx.fillStyle = stylePreset.chipText;
      ctx.font = '28px sans-serif';
      cursorY = this.drawPosterTextLines(
        ctx,
        snapshot.tagLines,
        contentStartX,
        cursorY,
        42
      );
    }

    cursorY += 44;
    const chipPadding = 24;
    ctx.font = '24px sans-serif';
    const chipTextParam = snapshot.periodChip;
    const textWidth = ctx.measureText(chipTextParam).width;
    this.drawPosterRoundedRect(
      ctx,
      contentStartX,
      cursorY - 26,
      textWidth + chipPadding * 2,
      54,
      27,
      stylePreset.chipFill
    );
    ctx.fillStyle = stylePreset.chipText;
    ctx.font = '24px sans-serif';
    ctx.fillText(chipTextParam, contentStartX + chipPadding, cursorY + 10);

    const footerTop = Math.max(
      cursorY + 74,
      snapshot.height - (snapshot.footerHeight || 270) - 64
    );
    const footerBottom = snapshot.height - 68;
    const footerCardX = 60;
    const footerCardWidth = snapshot.width - 120;
    const footerCardHeight = footerBottom - footerTop + 16;
    this.drawPosterRoundedRect(
      ctx,
      footerCardX,
      footerTop - 24,
      footerCardWidth,
      footerCardHeight,
      28,
      '#f8fbff'
    );
    this.drawPosterOutline(
      ctx,
      footerCardX,
      footerTop - 24,
      footerCardWidth,
      footerCardHeight,
      28,
      '#edf3fb',
      2
    );

    const footerTextX = contentStartX + 8;
    const footerTextY = footerTop + 30;
    ctx.fillStyle = '#607089';
    ctx.font = '24px sans-serif';
    ctx.fillText(`${getBrandName()} · 动态详情长图`, footerTextX, footerTextY);
    ctx.fillStyle = '#8b94a5';
    ctx.font = '22px sans-serif';
    ctx.fillText(
      snapshot.contentTruncated
        ? '正文已截取，进入小程序查看完整内容'
        : '打开小程序查看完整评论与互动',
      footerTextX,
      footerTextY + 42
    );
    ctx.fillStyle = '#5f6f82';
    ctx.font = '24px sans-serif';
    if (snapshot.dateLabel) {
      ctx.fillText(snapshot.dateLabel, footerTextX, footerTextY + 84);
    }
    ctx.fillStyle = '#8b94a5';
    ctx.font = '24px sans-serif';
    ctx.fillText(snapshot.statsLine, footerTextX, footerTextY + 120);

    if (miniProgramCodeImage && typeof ctx.drawImage === 'function') {
      const qrCardSize = 120;
      const qrPadding = 10;
      const qrCardX = snapshot.width - 72 - qrCardSize;
      const qrCardY = footerTop + Math.max((footerCardHeight - qrCardSize) / 2, 0);

      this.drawPosterRoundedRect(
        ctx,
        qrCardX,
        qrCardY,
        qrCardSize,
        qrCardSize,
        20,
        '#ffffff'
      );
      this.drawPosterOutline(
        ctx,
        qrCardX,
        qrCardY,
        qrCardSize,
        qrCardSize,
        20,
        '#e8edf5',
        2
      );
      ctx.drawImage(
        miniProgramCodeImage,
        qrCardX + qrPadding,
        qrCardY + qrPadding,
        qrCardSize - qrPadding * 2,
        qrCardSize - qrPadding * 2
      );
    }

    return this.exportPosterCanvasToTempFilePath(canvas, snapshot);
  },

  syncSelectedPoster(index = 0) {
    const posterGalleryItems = Array.isArray(this.data.posterGalleryItems)
      ? this.data.posterGalleryItems
      : [];
    const safeIndex = Math.min(
      Math.max(Number(index) || 0, 0),
      Math.max(posterGalleryItems.length - 1, 0)
    );
    const selectedPoster = posterGalleryItems[safeIndex] || null;

    this.setData({
      posterSelectedIndex: safeIndex,
      selectedPoster,
      posterTempFilePath: selectedPoster?.tempFilePath || ''
    });
  },

  buildPosterGalleryItems() {
    return POSTER_STYLE_PRESETS.map((stylePreset) => ({
      id: stylePreset.id,
      name: stylePreset.name,
      previewClass: `poster-template-${stylePreset.id}`,
      tempFilePath: '',
      generated: false
    }));
  },

  async generatePosterForStyle(detailCheckin, stylePreset) {
    try {
      return await this.generateLongImagePoster(detailCheckin, stylePreset);
    } catch (error) {
      console.warn('完整长图模板生成失败，尝试降级生成', {
        styleId: stylePreset.id,
        error
      });

      return this.generateLongImagePoster(
        detailCheckin,
        stylePreset,
        { maxHeight: POSTER_FALLBACK_MAX_HEIGHT }
      );
    }
  },

  async generatePosterGallery(detailCheckin) {
    const items = this.buildPosterGalleryItems();
    const firstStylePreset = POSTER_STYLE_PRESETS[0];
    const firstTempFilePath = await this.generatePosterForStyle(
      detailCheckin,
      firstStylePreset
    );

    if (!firstTempFilePath) {
      throw new Error('长图生成失败');
    }

    items[0] = {
      ...items[0],
      tempFilePath: firstTempFilePath,
      generated: true
    };

    return items;
  },

  previewGeneratedPoster(tempFilePath) {
    if (!tempFilePath) {
      return;
    }

    if (wx.previewImage) {
      wx.previewImage({
        current: tempFilePath,
        urls: [tempFilePath]
      });
    }
  },

  savePosterToAlbum(tempFilePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath: tempFilePath,
        success: () => {
          wx.showToast({
            title: '已保存到相册',
            icon: 'success'
          });
          resolve();
        },
        fail: (error) => {
          if (
            String(error?.errMsg || '').includes('auth deny') &&
            wx.showModal
          ) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存到相册后重试',
              success: (modalRes) => {
                if (modalRes.confirm && wx.openSetting) {
                  wx.openSetting({});
                }
              }
            });
          } else {
            wx.showToast({
              title: '保存失败',
              icon: 'none'
            });
          }
          reject(error);
        }
      });
    });
  },

  openPosterGallery() {
    if (
      !Array.isArray(this.data.posterGalleryItems) ||
      this.data.posterGalleryItems.length === 0
    ) {
      return;
    }

    this.setData({
      posterGalleryVisible: true
    });
  },

  closePosterGallery() {
    this.setData({
      posterGalleryVisible: false
    });
  },

  noop() {},

  async handlePosterTemplateSelect(e) {
    const { index } = e.currentTarget.dataset || {};
    const posterGalleryItems = Array.isArray(this.data.posterGalleryItems)
      ? this.data.posterGalleryItems
      : [];
    const safeIndex = Math.min(
      Math.max(Number(index) || 0, 0),
      Math.max(posterGalleryItems.length - 1, 0)
    );
    const selectedPoster = posterGalleryItems[safeIndex];

    this.syncSelectedPoster(safeIndex);

    if (!selectedPoster || selectedPoster.tempFilePath) {
      return;
    }

    if (this.data.posterGenerating || !this.data.detailCheckin) {
      return;
    }

    const stylePreset = POSTER_STYLE_PRESETS.find(
      (item) => item.id === selectedPoster.id
    );
    if (!stylePreset) {
      return;
    }

    this.setData({ posterGenerating: true });
    wx.showLoading?.({
      title: '生成长图中...',
      mask: true
    });

    try {
      const tempFilePath = await this.generatePosterForStyle(
        this.data.detailCheckin,
        stylePreset
      );
      const nextItems = posterGalleryItems.map((item, itemIndex) => {
        if (itemIndex !== safeIndex) {
          return item;
        }

        return {
          ...item,
          tempFilePath,
          generated: true
        };
      });

      this.setData({
        posterGenerating: false,
        posterGalleryItems: nextItems
      });
      this.syncSelectedPoster(safeIndex);
      wx.hideLoading?.();
    } catch (error) {
      console.error('生成模板长图失败:', error);
      this.setData({ posterGenerating: false });
      wx.hideLoading?.();
      wx.showToast({
        title: '长图生成失败',
        icon: 'none'
      });
    }
  },

  handlePreviewSelectedPoster() {
    this.previewGeneratedPoster(this.data.selectedPoster?.tempFilePath);
  },

  handleSaveSelectedPoster() {
    if (!this.data.selectedPoster?.tempFilePath) {
      return;
    }
    this.savePosterToAlbum(this.data.selectedPoster.tempFilePath);
  },

  handleShareSelectedPoster() {
    const tempFilePath = this.data.selectedPoster?.tempFilePath;

    if (!tempFilePath) {
      wx.showToast({
        title: '请先选择长图',
        icon: 'none'
      });
      return;
    }

    if (!wx.showShareImageMenu) {
      wx.showToast({
        title: '当前微信版本不支持图片分享',
        icon: 'none'
      });
      return;
    }

    wx.showShareImageMenu({
      path: tempFilePath,
      fail: (error) => {
        if (String(error?.errMsg || '').includes('cancel')) {
          return;
        }
        const isTimeout = String(error?.errMsg || error?.message || '').includes(
          'timeout'
        );
        wx.showToast({
          title: isTimeout ? '分享超时，请重试' : '分享图片失败',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 处理课程数据，添加模块可见性标志
   */
  processCourseModules(course) {
    const modules = [
      'meditation',
      'question',
      'content',
      'reflection',
      'action',
      'learn',
      'extract',
      'say'
    ];

    modules.forEach((module) => {
      // 判断模块内容是否为空，添加 visible 标志
      const isEmpty = this.isContentEmpty(course[module]);
      course[`${module}Visible`] = !isEmpty;

      // 如果是富文本内容（content），清理 HTML
      if (module === 'content' && course[module]) {
        course[module] = this.cleanHtmlForRichText(course[module]);
        const kw = this.data.searchKeyword;
        if (kw) {
          course[module] = this._highlightKeyword(course[module], kw);
        }
        console.log(
          '✅ 已清理富文本 HTML:',
          course[module].substring(0, 100) + '...'
        );
      }
    });

    // 看一看图片：相对路径补全为完整 URL
    course.lookImageVisible = !!(course.lookImage && course.lookImage.trim());
    if (course.lookImageVisible && course.lookImage.startsWith('/')) {
      const base = envConfig.apiBaseUrl.replace('/api/v1', '');
      course.lookImage = base + course.lookImage;
    }

    const base = envConfig.apiBaseUrl.replace('/api/v1', '');
    const closingVideo = course.closingVideo || {};
    const videoUrl = closingVideo.url || course.closingVideoUrl || '';
    const coverUrl = closingVideo.coverUrl || course.closingVideoCoverUrl || '';
    course.closingVideoVisible = !!videoUrl;
    course.closingVideoUrl = videoUrl && videoUrl.startsWith('/') ? base + videoUrl : videoUrl;
    course.closingVideoCoverUrl = coverUrl && coverUrl.startsWith('/') ? base + coverUrl : coverUrl;
    course.closingVideoDurationText = closingVideo.duration
      ? this.formatPodcastDuration(closingVideo.duration)
      : '';
    if (course.closingVideoVisible) {
      course.closingVideo = {
        ...closingVideo,
        url: course.closingVideoUrl,
        coverUrl: course.closingVideoCoverUrl
      };
      console.log('结营视频资源:', {
        url: course.closingVideoUrl,
        coverUrl: course.closingVideoCoverUrl,
        duration: closingVideo.duration || null
      });
    }

    // 播客介绍换行处理
    if (course.podcastDescription) {
      course.podcastDescriptionHtml = course.podcastDescription
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }

    return course;
  },

  async loadFocusedCheckinDetail(course, periodId, access, prefetchedDetail = null) {
    const detail =
      prefetchedDetail ||
      (await checkinService.getCheckinDetail(this.data.shareCheckinId));
    const checkinItem = this.buildCheckinItem(detail || {});
    const calendar = this.generateCalendar(course);
    const checkedDays = calendar.filter((d) => d.status === 'checked').length;

    course.comments = [checkinItem];
    this.syncShareCheckinMeta(course.comments);

    // 动态详情模式不渲染课程富文本内容，只关闭显示开关并移除正文字段，避免富文本块渲染
    const courseForDetail = {
      ...course,
      contentVisible: false
    };
    delete courseForDetail.content;

    this.setData(
      {
        periodId: periodId || this.normalizeId(detail?.periodId),
        paymentStatus: access.paymentStatus || null,
        canAccessCommunity: !!access.canAccessCommunity,
        communityAccessState: access.communityAccessState || 'locked',
        hasUserCheckedIn: this.isOwnCheckin(checkinItem),
        canShareCurrentCheckin: true,
        commentExpanded: { [checkinItem.id]: true },
        commentLoading: {},
        notificationReminder: '',
        course: courseForDetail,
        calendar,
        checkedDays,
        loading: false,
        showPageContent: true,
        podcastDurationText: course.podcastDuration ? this.formatPodcastDuration(course.podcastDuration) : ''
      },
      async () => {
        this.revealPageContent();
        this.syncDetailCheckinState(checkinItem.id);
        try {
          await this.expandCheckinCommentsByIndex(0);
        } catch (error) {
          console.warn('加载打卡详情评论失败:', error);
        }
        this.syncDetailCheckinState(checkinItem.id);
        this.loadNotificationReminder();
      }
    );
  },

  async loadCourseDetail() {
    this.setData(
      this._hasRevealedContent
        ? { loading: true }
        : { loading: true, showPageContent: false }
    );

    try {
      console.log('开始加载课程详情，ID:', this.data.courseId);

      const checkinDetailPromise =
        this.data.isCheckinDetailMode && this.data.shareCheckinId
          ? checkinService.getCheckinDetail(this.data.shareCheckinId)
          : Promise.resolve(null);

      // 优化：当 periodId 已知时，课程、权限、动态详情并行执行
      const knownPeriodId = this.data.periodId;
      const app = getApp();
      const isLogin = app.globalData.isLogin;
      let course, access, focusedCheckinDetail;

      // 未登录时跳过权限检查，直接用 locked 状态，避免 401 崩溃
      const getAccess = (pid) => isLogin
        ? getPeriodAccess(pid)
        : Promise.resolve({ communityAccessState: 'locked', canAccessCommunity: false, paymentStatus: null });

      if (knownPeriodId) {
        [course, access, focusedCheckinDetail] = await Promise.all([
          courseService.getCourseDetail(this.data.courseId),
          getAccess(knownPeriodId),
          checkinDetailPromise
        ]);
      } else {
        [course, focusedCheckinDetail] = await Promise.all([
          courseService.getCourseDetail(this.data.courseId),
          checkinDetailPromise
        ]);
        access = await getAccess(extractId(course.periodId));
      }

      const periodId = extractId(course.periodId) || knownPeriodId;

      // 行为追踪（fire-and-forget，不阻塞渲染）
      activityService.track('course_view', {
        targetType: 'section',
        targetId: this.data.courseId,
        periodId,
        sectionId: this.data.courseId,
        metadata: { title: course.title || course.name || '' }
      });
      const communityEnabled = access.communityAccessState === 'enabled';
      console.log('课程详情权限检查:', {
        courseId: this.data.courseId,
        periodId,
        paymentStatus: access.paymentStatus,
        paymentPending: access.paymentPending,
        communityAccessState: access.communityAccessState,
        canAccessCommunity: access.canAccessCommunity
      });

      // 确保 course.comments 是数组（后端可能不返回这个字段）
      if (!course.comments) {
        course.comments = [];
      }

      // 处理课程模块的可见性
      this.processCourseModules(course);

      console.log('course.comments:', course.comments);
      console.log('comments 是否存在:', !!course.comments);
      console.log(
        'comments 长度:',
        course.comments ? course.comments.length : 0
      );

      if (this.data.isCheckinDetailMode) {
        await this.loadFocusedCheckinDetail(
          course,
          periodId,
          access,
          focusedCheckinDetail
        );
        return;
      }

      if (!communityEnabled) {
        course.comments = [];
        const calendar = this.generateCalendar(course);
        const checkedDays = calendar.filter(
          (d) => d.status === 'checked'
        ).length;

        this.setData({
          periodId,
          paymentStatus: access.paymentStatus || null,
          canAccessCommunity: false,
          communityAccessState: access.communityAccessState || 'locked',
          hasUserCheckedIn: false,
          commentExpanded: {},
          commentLoading: {},
          notificationReminder: '',
          course,
          calendar,
          checkedDays,
          loading: false,
          showPageContent: true,
          podcastDurationText: course.podcastDuration ? this.formatPodcastDuration(course.podcastDuration) : ''
        });
        this.revealPageContent();
        return;
      }

      // 从数据库加载打卡记录
      let dbCheckins = [];
      let checkinHasMore = false;
      try {
        if (!periodId) {
          console.error('❌ periodId 为空，无法加载打卡记录!');
          throw new Error('periodId 为空');
        }

        const checkinRes = await courseService.getSectionCheckins(
          periodId,
          this.data.courseId,
          { limit: SECTION_CHECKIN_FETCH_LIMIT, page: 1 }
        );

        if (checkinRes) {
          dbCheckins = normalizeCheckinListResponse(checkinRes);
          const pagination = checkinRes.pagination;
          checkinHasMore = !!(pagination && pagination.hasNext);
          console.log(`📊 打卡记录首页: ${dbCheckins.length} 条，hasMore=${checkinHasMore}`);
        }
      } catch (error) {
        console.warn('从打卡API加载失败，尝试使用本地存储:', error);
      }

      // 如果数据库没有数据，则从本地存储加载
      if (dbCheckins.length === 0) {
        const storageKey = `checkins_${this.data.courseId}`;
        dbCheckins = wx.getStorageSync(storageKey) || [];
        console.log('本地打卡记录:', dbCheckins);
      }

      // 组织打卡记录的层级结构
      // 打卡(Checkin)为主层级，评论(Comment)为子层级
      let hasUserCheckedIn = false;
      const currentUserId =
        app.globalData.userInfo?._id || app.globalData.userInfo?.id;

      // 为每个打卡记录构建完整的数据结构
      const checkinWithComments = dbCheckins.map((checkin) => {
        const checkinUserId =
          checkin.userId?._id || checkin.userId?.id || checkin.userId;
        if (currentUserId && String(checkinUserId) === String(currentUserId)) {
          hasUserCheckedIn = true;
        }
        return this.buildCheckinItem(checkin);
      });

      // 评论改为延迟加载：用户点击"查看评论"时才加载，避免串行 N 次 API 请求
      course.comments = checkinWithComments;
      this.syncShareCheckinMeta(checkinWithComments);

      const calendar = this.generateCalendar(course);
      const checkedDays = calendar.filter((d) => d.status === 'checked').length;

      this.setData(
        {
          periodId,
          paymentStatus: access.paymentStatus || null,
          canAccessCommunity: true,
          communityAccessState: access.communityAccessState || 'enabled',
          course,
          calendar,
          checkedDays,
          loading: false,
          showPageContent: true,
          checkinPage: 1,
          checkinHasMore,
          checkinLoadingMore: false,
          podcastDurationText: course.podcastDuration ? this.formatPodcastDuration(course.podcastDuration) : ''
        },
        () => {
          this.revealPageContent();
          this.loadNotificationReminder();
          this.restoreTargetFocus();
        }
      );

      console.log('页面数据设置完成');
      console.log('this.data.course.comments:', this.data.course.comments);
    } catch (error) {
      console.error('加载课程详情失败:', error);
      this.setData({ loading: false });
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
    }
  },

  async loadMoreCheckins() {
    if (this.data.checkinLoadingMore || !this.data.checkinHasMore) return;

    this.setData({ checkinLoadingMore: true });
    const nextPage = this.data.checkinPage + 1;

    try {
      const checkinRes = await courseService.getSectionCheckins(
        this.data.periodId,
        this.data.courseId,
        { limit: SECTION_CHECKIN_FETCH_LIMIT, page: nextPage }
      );

      const newRawCheckins = normalizeCheckinListResponse(checkinRes || {});
      const pagination = checkinRes?.pagination;
      const hasMore = !!(pagination?.hasNext);

      const app = getApp();
      const currentUserId = app.globalData.userInfo?._id || app.globalData.userInfo?.id;
      let hasUserCheckedIn = this.data.hasUserCheckedIn;

      const newItems = newRawCheckins.map((checkin) => {
        const checkinUserId = checkin.userId?._id || checkin.userId?.id || checkin.userId;
        if (!hasUserCheckedIn && currentUserId && String(checkinUserId) === String(currentUserId)) {
          hasUserCheckedIn = true;
        }
        return this.buildCheckinItem(checkin);
      });

      const currentComments = this.data.course?.comments || [];
      this.setData({
        'course.comments': [...currentComments, ...newItems],
        checkinPage: nextPage,
        checkinHasMore: hasMore,
        checkinLoadingMore: false,
        hasUserCheckedIn
      });
    } catch (error) {
      console.error('加载更多打卡记录失败:', error);
      this.setData({ checkinLoadingMore: false });
    }
  },

  syncShareCheckinMeta(checkins = []) {
    const { shareCheckinId } = this.data;
    if (!shareCheckinId) {
      return;
    }

    const targetCheckin = checkins.find(
      (item) => String(item.id || item._id) === String(shareCheckinId)
    );

    if (!targetCheckin) {
      return;
    }

    this.setData({
      shareCheckinUserName: targetCheckin.userName || ''
    });
  },

  generateCalendar(course) {
    const calendar = [];
    for (let day = 1; day <= constants.COURSE_DURATION; day++) {
      calendar.push({
        day,
        status: day <= (course.currentDay || 0) ? 'checked' : 'pending',
        statusText: day <= (course.currentDay || 0) ? '✓' : ''
      });
    }
    return calendar;
  },

  async loadNotificationReminder() {
    const app = getApp();
    if (
      !app.globalData.isLogin ||
      this.data.communityAccessState !== 'enabled'
    ) {
      return;
    }

    try {
      const response = await subscribeMessageService.getSettings();
      const scenes = response.scenes || [];
      const commentScene = scenes.find(
        (item) => item.scene === 'comment_received'
      );
      const likeScene = scenes.find((item) => item.scene === 'like_received');
      const needsReminder =
        (commentScene && commentScene.availableCount <= 0) ||
        (likeScene && likeScene.availableCount <= 0);

      this.setData({
        notificationReminder: needsReminder
          ? '评论或点赞提醒已用完，可去消息提醒页补充。'
          : ''
      });
    } catch (error) {
      console.warn('加载课程详情通知提醒失败:', error);
    }
  },

  navigateToNotificationSettings() {
    this.triggerAutoTopUp('course_detail_notification_settings');
    wx.navigateTo({
      url: `/pages/notification-settings/notification-settings?periodId=${this.data.periodId || ''}`
    });
  },

  triggerAutoTopUp(sourceAction) {
    return subscribeAutoTopUp.maybeAutoTopUpSubscriptions({
      sourceAction,
      periodId: this.data.periodId || extractId(this.data.course?.periodId),
      sectionId: this.data.courseId,
      courseId: this.data.courseId,
      sourcePage: 'course-detail',
      sceneKeys: COMMUNITY_AUTO_TOP_UP_SCENES,
      requestMode: 'any'
    });
  },

  handleDayClick(e) {
    const { day } = e.currentTarget.dataset;
    console.log('点击第', day.day, '天');
  },

  handleEnroll() {
    wx.showModal({
      title: '确认报名',
      content: '确定要报名该课程吗？',
      success: (res) => {
        if (res.confirm) {
          // TODO: 调用报名API
          wx.showToast({
            title: '报名成功',
            icon: 'success'
          });
        }
      }
    });
  },

  handleBack() {
    wx.navigateBack();
  },

  async handleImmersiveReading() {
    const { courseId, periodId } = this.data;
    await subscribeAutoTopUp
      .maybeAutoTopUpNextDayStudyReminder({
        periodId,
        sectionId: courseId,
        courseId,
        sourcePage: 'course-detail',
        sourceAction: 'immersive_reading_click'
      })
      .catch((error) => {
        console.warn('补充明日开课通知失败，继续进入沉浸阅读:', error);
      });

    wx.navigateTo({
      url: `/pages/reading-mode/reading-mode?id=${courseId}&periodId=${periodId || ''}`
    });
  },

  handleLookImagePreview() {
    const url = this.data.course && this.data.course.lookImage;
    if (!url) return;
    wx.previewImage({ urls: [url], current: url, showmenu: true });
  },

  handleCheckinImagePreview(e) {
    const { url, checkinId } = e.currentTarget.dataset || {};
    if (!url) return;

    let urls = [];
    if (
      this.data.detailCheckin &&
      String(this.data.detailCheckin.id || this.data.detailCheckin._id) === String(checkinId)
    ) {
      urls = normalizeCheckinImages(this.data.detailCheckin.images);
    }

    if (urls.length === 0) {
      const targetCheckin = (this.data.course?.comments || []).find(
        (item) => String(item.id || item._id) === String(checkinId)
      );
      urls = normalizeCheckinImages(targetCheckin?.images);
    }

    wx.previewImage({
      current: url,
      urls: urls.length > 0 ? urls : [url],
      showmenu: true
    });
  },

  handleCheckinDetailTap(e) {
    const { checkinId, sectionId } = e.currentTarget.dataset;
    this.openCheckinDetail(checkinId, sectionId || this.data.courseId);
  },

  openCheckinDetail(checkinId, sectionId = '') {
    const targetSectionId = sectionId || this.data.courseId;

    if (!checkinId || !targetSectionId) {
      wx.showToast({
        title: '缺少详情参数',
        icon: 'none'
      });
      return;
    }

    if (
      this.data.isCheckinDetailMode &&
      String(this.data.shareCheckinId) === String(checkinId) &&
      String(this.data.courseId) === String(targetSectionId)
    ) {
      return;
    }

    wx.navigateTo({
      url: `/pages/course-detail/course-detail?id=${targetSectionId}&checkinId=${checkinId}`
    });
  },

  async handleCheckin() {
    if (!this._requireInteraction('登录后才能打卡')) return;

    await this.triggerAutoTopUp('course_detail_checkin');

    // 跳转到打卡页面
    wx.navigateTo({
      url: `/pages/checkin/checkin?courseId=${this.data.courseId}&periodId=${this.data.periodId}`
    });
  },

  /**
   * 切换评论展开/收起（延迟加载）
   */
  async toggleComments(e) {
    if (this.data.communityAccessState !== 'enabled' && !this._requireInteraction('登录后才能查看评论')) return;

    this.triggerAutoTopUp('course_detail_expand_comments');

    const { index } = e.currentTarget.dataset;
    const comments = this.data.course.comments;
    const checkin = comments[index];
    if (!checkin) return;

    const expandedKey = `commentExpanded.${checkin.id}`;

    // 已展开 → 收起
    if (this.data.commentExpanded[checkin.id]) {
      this.setData({ [expandedKey]: false });
      return;
    }

    try {
      await this.expandCheckinCommentsByIndex(index);
    } catch (error) {
      console.error('加载评论失败:', error);
      this.setData({ [expandedKey]: false });
      wx.showToast({ title: '加载评论失败', icon: 'none' });
    }
  },

  async expandCheckinCommentsByIndex(index) {
    const comments = this.data.course.comments;
    const checkin = comments[index];
    if (!checkin) return;

    if (checkin.replies && checkin.replies.length > 0) {
      this.setData({ [`commentExpanded.${checkin.id}`]: true });
      return;
    }

    const loadingKey = `commentLoading.${checkin.id}`;
    this.setData({
      [loadingKey]: true,
      [`commentExpanded.${checkin.id}`]: true
    });

    try {
      const checkinComments = await commentService.getCommentsByCheckin(
        checkin.id,
        { limit: 100 }
      );

      if (
        checkinComments &&
        checkinComments.list &&
        checkinComments.list.length > 0
      ) {
        const app = getApp();
        const currentUserId =
          app.globalData.userInfo?._id || app.globalData.userInfo?.id;

        const formattedReplies = checkinComments.list.map((comment) => {
          const formattedNestedReplies = (comment.replies || []).map(
            (reply) => {
              const isLiked =
                Array.isArray(reply.likes) && currentUserId
                  ? reply.likes.some(
                      (l) =>
                        String(
                          l.userId?._id || l.userId?.id || l.userId || l
                        ) === String(currentUserId)
                    )
                  : false;
              const replyLikeAvatars = this.getLikeAvatarsFromLikes(reply.likes);
              return {
                id: reply._id,
                userId: reply.userId?._id || reply.userId,
                userName: reply.userId?.nickname || '匿名用户',
                ...this.getAvatarDisplayInfo(reply.userId, {
                  fallbackName: '匿名用户',
                  fallbackAvatarText: this.getNameAvatarText(reply.userId?.nickname || '匿名用户')
                }),
                avatarColor: getAvatarColorByUserId(
                  reply.userId?._id ||
                    reply.userId ||
                    reply.userId?.nickname ||
                    '匿名用户'
                ),
                content: normalizeDanmakuContent(reply.content || ''),
                createTime: reply.createdAt
                  ? this.formatTime(reply.createdAt)
                  : '刚刚',
                likeCount: reply.likeCount || 0,
                isLiked,
                likeAvatars: replyLikeAvatars,
                displayLikeAvatars: this.getDisplayLikeAvatars(replyLikeAvatars),
                parentId: comment._id,
                canDelete: currentUserId && String(reply.userId?._id || reply.userId) === String(currentUserId)
              };
            }
          );

          const isCommentLiked =
            Array.isArray(comment.likes) && currentUserId
              ? comment.likes.some(
                  (l) =>
                    String(l.userId?._id || l.userId?.id || l.userId || l) ===
                    String(currentUserId)
                )
              : false;
          const commentLikeAvatars = this.getLikeAvatarsFromLikes(comment.likes);

          return {
            id: comment._id,
            userId: comment.userId?._id || comment.userId,
            userName: comment.userId?.nickname || '匿名用户',
            ...this.getAvatarDisplayInfo(comment.userId, {
              fallbackName: '匿名用户',
              fallbackAvatarText: this.getNameAvatarText(comment.userId?.nickname || '匿名用户')
            }),
            avatarColor: getAvatarColorByUserId(
              comment.userId?._id ||
                comment.userId ||
                comment.userId?.nickname ||
                '匿名用户'
            ),
            content: normalizeDanmakuContent(comment.content || ''),
            createTime: comment.createdAt
              ? this.formatTime(comment.createdAt)
              : '刚刚',
            likeCount: comment.likeCount || 0,
            isLiked: isCommentLiked,
            likeAvatars: commentLikeAvatars,
            displayLikeAvatars: this.getDisplayLikeAvatars(commentLikeAvatars),
            replies: formattedNestedReplies,
            canDelete: currentUserId && String(comment.userId?._id || comment.userId) === String(currentUserId)
          };
        });

        this.setData({
          [`course.comments[${index}].replies`]: formattedReplies,
          [loadingKey]: false
        });
        this.syncDetailCheckinState(checkin.id);
        return;
      }

      this.setData({ [loadingKey]: false });
      this.syncDetailCheckinState(checkin.id);
    } catch (error) {
      this.setData({
        [loadingKey]: false,
        [`commentExpanded.${checkin.id}`]: false
      });
      throw error;
    }
  },

  async restoreTargetFocus() {
    const { focusCheckinId, focusCommentId, focusReplyId } = this.data;
    if (!focusCheckinId) {
      return;
    }

    const checkins = this.data.course.comments || [];
    const targetIndex = checkins.findIndex(
      (item) => String(item.id || item._id) === String(focusCheckinId)
    );

    if (targetIndex === -1) {
      return;
    }

    try {
      await this.expandCheckinCommentsByIndex(targetIndex);
    } catch (error) {
      console.warn('恢复评论定位失败:', error);
    }

    this.setData({
      highlightCheckinId: focusCheckinId,
      highlightCommentId: focusCommentId,
      highlightReplyId: focusReplyId
    });

    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }

    this.highlightTimer = setTimeout(() => {
      this.setData({
        highlightCheckinId: '',
        highlightCommentId: '',
        highlightReplyId: ''
      });
    }, 2800);

    const selector = focusReplyId
      ? `#reply-${focusReplyId}`
      : focusCommentId
        ? `#comment-${focusCommentId}`
        : `#checkin-${focusCheckinId}`;

    this.scrollToSelector(selector, `#checkin-${focusCheckinId}`);
    this.setData({
      focusCheckinId: '',
      focusCommentId: '',
      focusReplyId: ''
    });
  },

  scrollToSelector(selector, fallbackSelector = '') {
    wx.nextTick(() => {
      wx.pageScrollTo({
        selector,
        duration: 280,
        offsetTop: 96,
        fail: () => {
          if (fallbackSelector && fallbackSelector !== selector) {
            wx.pageScrollTo({
              selector: fallbackSelector,
              duration: 280,
              offsetTop: 96
            });
          }
        }
      });
    });
  },

  handleEditCheckin() {
    const { detailCheckin } = this.data;
    if (!detailCheckin) return;
    wx.navigateTo({
      url: `/pages/checkin/checkin?checkinId=${detailCheckin.id}&sectionId=${detailCheckin.sectionId}&periodId=${detailCheckin.periodId}`
    });
  },

  handleDeleteComment(e) {
    const { commentId } = e.currentTarget.dataset;
    if (!commentId) return;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条评论吗？',
      confirmText: '删除',
      confirmColor: '#e74c3c',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await checkinService.deleteComment(commentId);
          const comments = (this.data.course?.comments || []).map(item => ({
            ...item,
            replies: (item.replies || []).filter(r => String(r.id) !== String(commentId))
          }));
          this.setData({ 'course.comments': comments });
          if (this.data.detailCheckin) {
            const replies = (this.data.detailCheckin.replies || []).filter(
              r => String(r.id) !== String(commentId)
            );
            this.setData({ 'detailCheckin.replies': replies });
          }
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  handleDeleteCheckin() {
    const { detailCheckin } = this.data;
    if (!detailCheckin) return;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除这条打卡吗？',
      confirmText: '删除',
      confirmColor: '#e74c3c',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          wx.showLoading({ title: '删除中...' });
          await checkinService.deleteCheckin(detailCheckin.id);
          wx.hideLoading();
          wx.showToast({ title: '删除成功', icon: 'success' });
          getApp().globalData.checkinListDirty = true;
          console.log('[删除打卡] 成功，已设置 checkinListDirty=true，1.5s 后返回');
          setTimeout(() => wx.navigateBack(), 1500);
        } catch (error) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败，请重试', icon: 'none' });
        }
      }
    });
  },

  /**
   * 点赞打卡记录（顶层列表项是打卡记录，不是评论）
   */
  async handleLikeComment(e) {
    if (!this._requireInteraction('登录后才能点赞')) return;

    this.triggerAutoTopUp('course_detail_like_checkin');

    const app = getApp();
    const currentUserId = String(app.globalData.userInfo?._id || app.globalData.userInfo?.id || '');

    const { id } = e.currentTarget.dataset;
    const comments = this.data.course.comments;
    const comment = comments.find((c) => c.id === id);

    if (!comment) {
      return;
    }

    try {
      if (comment.isLiked) {
        // 取消点赞打卡记录
        console.log(`👎 取消点赞打卡: checkinId=${id}`);
        await commentService.unlikeCheckin(id);
        comment.likeCount = Math.max(0, comment.likeCount - 1);
        comment.isLiked = false;
        if (comment.likeAvatars) {
          comment.likeAvatars = comment.likeAvatars.filter(l => String(l.userId) !== currentUserId);
          comment.displayLikeAvatars = this.getDisplayLikeAvatars(comment.likeAvatars);
        }
        console.log(`✅ 取消点赞成功: 当前点赞数=${comment.likeCount}`);
      } else {
        // 点赞打卡记录
        console.log(`👍 点赞打卡: checkinId=${id}`);
        await commentService.likeCheckin(id);
        activityService.track('like_create', {
          targetType: 'checkin',
          targetId: id,
          periodId: this.data.periodId || extractId(this.data.course?.periodId),
          sectionId: this.data.courseId
        });
        comment.likeCount += 1;
        comment.isLiked = true;
        if (!comment.likeAvatars) comment.likeAvatars = [];
        const currentUserInfo = this.getLikeAvatarInfo(app.globalData.userInfo);
        comment.likeAvatars.unshift({
          userId: currentUserId,
          avatarUrl: currentUserInfo.avatarUrl,
          avatarText: currentUserInfo.avatarText,
          avatarIsEmoji: currentUserInfo.avatarIsEmoji,
          avatarColor: currentUserInfo.avatarColor
        });
        comment.displayLikeAvatars = this.getDisplayLikeAvatars(comment.likeAvatars);
        console.log(`✅ 点赞成功: 当前点赞数=${comment.likeCount}`);
      }

      this.setData({
        'course.comments': comments
      });
      this.syncDetailCheckinState(id);
    } catch (error) {
      console.error('点赞操作失败:', error);
      wx.showToast({
        title: '操作失败，请重试',
        icon: 'none'
      });
    }
  },

  /**
   * 回复评论
   */
  async handleReplyComment(e) {
    if (!this._requireInteraction('登录后才能回复')) return;

    this.triggerAutoTopUp('course_detail_reply_checkin');

    const { id } = e.currentTarget.dataset;
    const comments = this.data.course.comments;
    const comment = comments.find((c) => c.id === id);

    if (!comment) {
      return;
    }

    // 使用 wx.showModal 获取回复内容
    wx.showModal({
      title: `回复 ${comment.userName}`,
      editable: true,
      placeholderText: '请输入回复内容...',
      success: async (res) => {
        const replyContent = normalizeDanmakuContent(res.content || '').trim();
        if (res.confirm && replyContent) {
          try {
            // 直接创建评论（关联到打卡记录）
            const app = getApp();
            const currentUser = app.globalData.userInfo;

            console.log('📝 创建评论，打卡ID:', id);

            const replyData = await commentService.createComment({
              checkinId: id,
              content: replyContent
            });
            activityService.track('comment_create', {
              targetType: 'checkin',
              targetId: id,
              periodId:
                this.data.periodId || extractId(this.data.course?.periodId),
              sectionId: this.data.courseId
            });

            console.log('✅ 评论已保存到数据库:', replyData);

            // 创建新的回复对象
            const newReply = {
              id: replyData._id || replyData.id || Date.now(),
              userId: currentUser?._id || currentUser?.id,
              userName: currentUser?.nickname || '我',
              ...this.getAvatarDisplayInfo(currentUser, {
                fallbackName: currentUser?.nickname || '我',
                fallbackAvatarText: this.getNameAvatarText(currentUser?.nickname || '我')
              }),
              avatarColor: getAvatarColorByUserId(
                currentUser?._id ||
                  currentUser?.id ||
                  currentUser?.nickname ||
                  '我'
              ),
              content: replyContent,
              createTime: '刚刚',
              likeCount: 0,
              isLiked: false
            };

            // 添加到回复列表
            if (!comment.replies) {
              comment.replies = [];
            }
            comment.replies.push(newReply);

            // 更新数据
            this.setData({
              'course.comments': comments
            });
            this.syncDetailCheckinState(id);

            wx.showToast({
              title: '回复成功',
              icon: 'success'
            });
          } catch (error) {
            console.error('回复失败:', error);
            wx.showToast({
              title: '回复失败，请重试',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  /**
   * 点赞评论（回复列表里的项是评论，commentId 是打卡ID，replyId 是评论ID）
   */
  async handleLikeReply(e) {
    if (!this._requireInteraction('登录后才能点赞')) return;

    this.triggerAutoTopUp('course_detail_like_reply');

    const app = getApp();
    const currentUserId = String(app.globalData.userInfo?._id || app.globalData.userInfo?.id || '');

    const { commentId, replyId } = e.currentTarget.dataset;
    const comments = this.data.course.comments;
    const comment = comments.find(
      (c) => c.id === commentId || c._id === commentId
    );

    if (!comment || !comment.replies) {
      console.error('评论或回复不存在', { commentId, replyId });
      return;
    }

    let isNestedReply = false;
    let parentCommentId = null;

    let reply = comment.replies.find(
      (r) => r.id === replyId || r._id === replyId
    );

    // 如果在第一层回复(replies)里找不到，就去第二层(replies.replies)里找
    if (!reply) {
      for (const r of comment.replies) {
        if (r.replies && r.replies.length > 0) {
          const nestedReply = r.replies.find(
            (nr) => nr.id === replyId || nr._id === replyId
          );
          if (nestedReply) {
            reply = nestedReply;
            isNestedReply = true;
            parentCommentId = nestedReply.parentId || r.id || r._id;
            break;
          }
        }
      }
    }

    if (!reply) {
      console.error('回复不存在');
      return;
    }

    try {
      if (reply.isLiked) {
        // 取消点赞评论
        console.log(
          `👎 取消点赞回复: checkinId=${commentId}, isNested=${isNestedReply}, parentCommentId=${parentCommentId}, replyId=${replyId}`
        );
        if (isNestedReply) {
          await commentService.unlikeReply(parentCommentId, replyId);
        } else {
          await commentService.unlikeComment(replyId);
        }
        reply.likeCount = Math.max(0, reply.likeCount - 1);
        reply.isLiked = false;
        if (reply.likeAvatars) {
          reply.likeAvatars = reply.likeAvatars.filter(l => String(l.userId) !== currentUserId);
          reply.displayLikeAvatars = this.getDisplayLikeAvatars(reply.likeAvatars);
        }
        console.log(`✅ 取消点赞成功: 当前点赞数=${reply.likeCount}`);
      } else {
        // 点赞评论
        console.log(
          `👍 点赞回复: checkinId=${commentId}, isNested=${isNestedReply}, parentCommentId=${parentCommentId}, replyId=${replyId}`
        );
        if (isNestedReply) {
          await commentService.likeReply(parentCommentId, replyId);
        } else {
          await commentService.likeComment(replyId);
        }
        activityService.track('like_create', {
          targetType: isNestedReply ? 'reply' : 'comment',
          targetId: replyId,
          periodId: this.data.periodId || extractId(this.data.course?.periodId),
          sectionId: this.data.courseId
        });
        reply.likeCount = (reply.likeCount || 0) + 1;
        reply.isLiked = true;
        if (!reply.likeAvatars) reply.likeAvatars = [];
        const currentUserInfo = this.getLikeAvatarInfo(app.globalData.userInfo);
        reply.likeAvatars.unshift({
          userId: currentUserId,
          avatarUrl: currentUserInfo.avatarUrl,
          avatarText: currentUserInfo.avatarText,
          avatarIsEmoji: currentUserInfo.avatarIsEmoji,
          avatarColor: currentUserInfo.avatarColor
        });
        reply.displayLikeAvatars = this.getDisplayLikeAvatars(reply.likeAvatars);
        console.log(`✅ 点赞成功: 当前点赞数=${reply.likeCount}`);
      }

      this.setData({
        'course.comments': comments
      });
      this.syncDetailCheckinState(commentId);
    } catch (error) {
      console.error('回复点赞操作失败:', error);
      wx.showToast({
        title: '操作失败，请重试',
        icon: 'none'
      });
    }
  },

  /**
   * 回复某条回复
   * 参数：
   *   - checkinId: 打卡记录ID（打卡列表的ID）
   *   - commentId: 评论ID（打卡的评论）
   *   - replyId: 被回复的用户ID（评论的回复者）
   *   - userName: 被回复的用户名
   */
  async handleReplyToReply(e) {
    if (!this._requireInteraction('登录后才能回复')) return;

    this.triggerAutoTopUp('course_detail_reply_reply');

    const { checkinId, commentId, replyId, userName } = e.currentTarget.dataset;

    console.log('📝 准备回复:', { checkinId, commentId, replyId, userName });

    // 验证必要参数
    if (!checkinId || !commentId || !replyId) {
      console.error('❌ 参数不完整', { checkinId, commentId, replyId });
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      });
      return;
    }

    // 在 course.comments（打卡列表）中找到这个打卡
    const checkins = this.data.course.comments;
    const checkin = checkins.find((c) => c.id === checkinId);

    if (!checkin || !checkin.replies) {
      console.error('❌ 找不到打卡或评论列表', { checkinId, checkin });
      return;
    }

    // 在打卡的 replies（评论列表）中找到这条评论
    const comment = checkin.replies.find((c) => c.id === commentId);

    if (!comment) {
      console.error('❌ 找不到评论', { commentId });
      return;
    }

    // 使用 wx.showModal 获取回复内容
    wx.showModal({
      title: `回复 ${userName}`,
      editable: true,
      placeholderText: '请输入回复内容...',
      success: async (res) => {
        const replyContent = normalizeDanmakuContent(res.content || '').trim();
        if (res.confirm && replyContent) {
          try {
            const app = getApp();
            const currentUser = app.globalData.userInfo;

            console.log(
              '📝 提交回复: commentId=' +
                commentId +
                ', content=' +
                replyContent.substring(0, 20)
            );

            // 调用API保存回复到这条评论
            // 后端返回的是整个更新后的 Comment 对象（包含更新的 replies 数组）
            const updatedComment = await commentService.replyComment(
              commentId,
              {
                content: replyContent,
                replyToUserId: replyId // 标记回复的是哪个用户
              }
            );

            console.log('✅ 回复已保存到数据库，更新后的评论:', updatedComment);
            console.log('回复列表长度:', updatedComment.replies?.length);

            // 重新加载该打卡的评论列表，确保前端数据与后端同步
            // （因为后端返回的 replies 数据结构需要格式化才能显示）
            try {
              const refreshedComments =
                await commentService.getCommentsByCheckin(checkinId, {
                  limit: 100
                });

              if (refreshedComments && refreshedComments.list) {
                // 找到这条评论
                const updatedCommentData = refreshedComments.list.find(
                  (c) => c._id === commentId
                );

                if (updatedCommentData && checkin.replies) {
                  // 更新前端的这条评论数据
                  const commentIdx = checkin.replies.findIndex(
                    (c) => c.id === commentId
                  );
                  if (
                    commentIdx !== -1 &&
                    updatedCommentData &&
                    updatedCommentData.replies
                  ) {
                    const formattedReplies = updatedCommentData.replies.map(
                      (reply) => {
                        const isNestedReplyLikedLocally =
                          Array.isArray(reply.likes) && currentUser
                            ? reply.likes.some(
                                (l) =>
                                  String(
                                    l.userId?._id ||
                                      l.userId?.id ||
                                      l.userId ||
                                      l
                                  ) ===
                                  String(currentUser?._id || currentUser?.id)
                              )
                            : false;

                        const replyLikeAvatars = this.getLikeAvatarsFromLikes(reply.likes);
                        return {
                          id: reply._id,
                          userId: reply.userId?._id || reply.userId,
                          userName: reply.userId?.nickname || '匿名用户',
                          ...this.getAvatarDisplayInfo(reply.userId, {
                            fallbackName: '匿名用户',
                            fallbackAvatarText: this.getNameAvatarText(reply.userId?.nickname || '匿名用户')
                          }),
                          avatarColor: getAvatarColorByUserId(
                            reply.userId?._id ||
                              reply.userId ||
                              reply.userId?.nickname ||
                              '匿名用户'
                          ),
                          content: normalizeDanmakuContent(reply.content || ''),
                          createTime: reply.createdAt
                            ? this.formatTime(reply.createdAt)
                            : '刚刚',
                          likeCount: reply.likeCount || 0,
                          isLiked: isNestedReplyLikedLocally,
                          likeAvatars: replyLikeAvatars,
                          displayLikeAvatars: this.getDisplayLikeAvatars(replyLikeAvatars)
                        };
                      }
                    );

                    checkin.replies[commentIdx].replies = formattedReplies.map(
                      (reply) => ({ ...reply, parentId: commentId })
                    );
                    checkin.replies[commentIdx].replyCount =
                      updatedCommentData.replyCount || 0;

                    // 🔍 调试日志：验证嵌套回复数据结构
                    console.log('✅ 更新后的评论结构:');
                    console.log('   - 评论ID:', checkin.replies[commentIdx].id);
                    console.log(
                      '   - 评论内容:',
                      checkin.replies[commentIdx].content
                    );
                    console.log(
                      '   - 回复总数:',
                      checkin.replies[commentIdx].replyCount
                    );
                    console.log(
                      '   - 回复列表:',
                      checkin.replies[commentIdx].replies
                    );
                    if (
                      checkin.replies[commentIdx].replies &&
                      checkin.replies[commentIdx].replies.length > 0
                    ) {
                      console.log(
                        '   - 最后一条回复:',
                        checkin.replies[commentIdx].replies[
                          checkin.replies[commentIdx].replies.length - 1
                        ]
                      );
                    }
                  }
                }
              }
            } catch (err) {
              console.warn('刷新评论数据失败:', err);
              // 即使刷新失败也继续，不影响用户体验
            }

            // 更新页面数据
            this.setData({
              'course.comments': checkins
            });
            this.syncDetailCheckinState(checkinId);

            wx.showToast({
              title: '回复成功',
              icon: 'success'
            });
          } catch (error) {
            console.error('❌ 回复失败:', error);
            wx.showToast({
              title: '回复失败，请重试',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  /**
   * 格式化时间
   */
  formatTime(dateStr) {
    if (!dateStr) return '刚刚';

    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diff = Math.floor((now - date) / 1000); // 秒数

      if (diff < 60) return '刚刚';
      if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
      if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
      if (diff < 604800) return Math.floor(diff / 86400) + '天前';

      // 其他情况显示日期
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    } catch (error) {
      return '刚刚';
    }
  },

  /**
   * 点击打卡人头像 - 跳转到他人主页
   */
  handleAvatarClick(e) {
    const { userId } = e.currentTarget.dataset;
    const { course } = this.data;

    console.log('🎯 handleAvatarClick - 开始构造导航URL');
    console.log('   userId:', userId);
    console.log('   course:', course);
    console.log('   course.periodId:', course?.periodId);

    if (!userId) {
      console.error('❌ 用户ID不存在');
      return;
    }

    // 跳转到他人主页，同时传递当前课程所属的期次ID
    let url = `/pages/profile-others/profile-others?userId=${userId}`;
    if (course && course.periodId) {
      // 处理periodId可能是对象的情况（API返回的是populate的对象）
      const periodId = course.periodId._id || course.periodId;
      url += `&periodId=${periodId}`;
      console.log('✅ 成功添加periodId:', periodId);
    } else {
      console.warn('⚠️ course.periodId未找到或为空');
    }

    console.log('🔗 最终导航URL:', url);
    wx.navigateTo({ url });
  },

  handleLikeAvatarClick(e) {
    const { userId } = e.currentTarget.dataset;
    if (!userId) return;
    const { course } = this.data;
    let url = `/pages/profile-others/profile-others?userId=${userId}`;
    if (course && course.periodId) {
      const periodId = course.periodId._id || course.periodId;
      url += `&periodId=${periodId}`;
    }
    wx.navigateTo({ url });
  },

  formatPodcastDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  syncPodcastStateFromGlobal() {
    const app = getApp();
    const { podcastPlaying, podcastSectionId, podcastCurrentTime, podcastDuration } = app.globalData;
    const progress = podcastDuration > 0 ? Math.min(100, (podcastCurrentTime / podcastDuration) * 100) : 0;
    this.setPodcastUiData({
      podcastPlaying: !!podcastPlaying,
      podcastSectionId: podcastSectionId || '',
      podcastProgress: progress
    });
  },

  handlePodcastShare() {
    const { course } = this.data;
    if (!course) return;
    this.setData({ podcastShareMode: true });
  },

  handleClosingVideoShare() {
    const { course } = this.data;
    if (!course?.closingVideoVisible) return;
    this.setData({ closingVideoShareMode: true });
  },

  handleClosingVideoPlay() {
    const { course } = this.data;
    if (!course?.closingVideoUrl) return;
    this.setData({ closingVideoActivated: true }, () => {
      wx.nextTick(() => {
        const videoContext = wx.createVideoContext && wx.createVideoContext('closing-video-player', this);
        if (videoContext && typeof videoContext.play === 'function') {
          videoContext.play();
        }
      });
    });
  },

  handleClosingVideoCoverLoad(event) {
    console.log('结营视频封面加载成功:', {
      coverUrl: this.data.course?.closingVideoCoverUrl || '',
      detail: event?.detail || null
    });
  },

  handleClosingVideoCoverError(event) {
    console.warn('结营视频封面加载失败:', {
      coverUrl: this.data.course?.closingVideoCoverUrl || '',
      detail: event?.detail || null
    });
  },

  handleClosingVideoError(event) {
    console.warn('结营视频加载失败:', {
      detail: event?.detail || null,
      url: this.data.course?.closingVideoUrl || '',
      coverUrl: this.data.course?.closingVideoCoverUrl || ''
    });
    this.setData({ closingVideoActivated: false });
    wx.showToast({
      title: '视频加载失败，请稍后再试',
      icon: 'none'
    });
  },

  _generatePodcastShareImage(course) {
    return new Promise((resolve, reject) => {
      const W = 750;
      const PAD = 40;
      const dpr = wx.getWindowInfo?.().pixelRatio || 2;
      const descText = (course.podcastDescription || '').replace(/<[^>]+>/g, '').trim();
      const fontSize = 28;
      const lineH = Math.round(fontSize * 1.7);
      const textW = W - PAD * 2;
      const sectionTitleH = 80;
      const playerCardH = 120;
      const MAX_DESC_LINES = 12;

      const query = wx.createSelectorQuery().in(this);
      query.select('#longImageCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) { reject(new Error('no canvas')); return; }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');

        // 用真实 ctx 计算换行，确定高度
        ctx.font = `${fontSize}px sans-serif`;
        const descLines = this._wrapText(ctx, descText, textW, fontSize);
        const showLines = Math.min(descLines.length, MAX_DESC_LINES);
        const descBlockH = showLines > 0 ? showLines * lineH + 16 : 0;
        const H = PAD + sectionTitleH + 24 + playerCardH + (descBlockH > 0 ? 24 + descBlockH : 0) + PAD;

        canvas.width = W * dpr;
        canvas.height = H * dpr;
        if (typeof ctx.resetTransform === 'function') ctx.resetTransform();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        // 白色背景
        this.drawPosterRoundedRect(ctx, 0, 0, W, H, 0, '#ffffff');

        let y = PAD;

        // 标题行：播图标 + "播一播"
        const iconSize = 56;
        const iconBg = ctx.createLinearGradient(PAD, y, PAD + iconSize, y + iconSize);
        iconBg.addColorStop(0, '#f97316');
        iconBg.addColorStop(1, '#ea580c');
        this.drawPosterRoundedRect(ctx, PAD, y, iconSize, iconSize, 12, iconBg);

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 28px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('播', PAD + iconSize / 2, y + iconSize / 2);

        ctx.fillStyle = '#333333';
        ctx.font = `bold 36px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('播一播', PAD + iconSize + 16, y + iconSize / 2);

        y += sectionTitleH;

        // 播放卡片
        const cardBg = ctx.createLinearGradient(PAD, y, PAD, y + playerCardH);
        cardBg.addColorStop(0, '#fff7ed');
        cardBg.addColorStop(1, '#ffedd5');
        this.drawPosterRoundedRect(ctx, PAD, y, W - PAD * 2, playerCardH, 20, cardBg);

        const maxTitleW = W - PAD * 2 - 130;
        ctx.fillStyle = '#1c1917';
        ctx.font = `bold 30px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const titleText = course.title || '';
        let displayTitle = titleText;
        if (ctx.measureText(titleText).width > maxTitleW) {
          let cut = titleText.length;
          while (cut > 0 && ctx.measureText(titleText.slice(0, cut) + '…').width > maxTitleW) cut--;
          displayTitle = titleText.slice(0, cut) + '…';
        }
        ctx.fillText(displayTitle, PAD + 24, y + playerCardH / 2);

        const btnX = W - PAD - 56;
        const btnY = y + playerCardH / 2;
        const btnR = 44;
        const btnGrad = ctx.createLinearGradient(btnX - btnR, btnY - btnR, btnX + btnR, btnY + btnR);
        btnGrad.addColorStop(0, '#f97316');
        btnGrad.addColorStop(1, '#ea580c');
        ctx.fillStyle = btnGrad;
        ctx.beginPath();
        ctx.arc(btnX, btnY, btnR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(btnX - 12, btnY - 18);
        ctx.lineTo(btnX - 12, btnY + 18);
        ctx.lineTo(btnX + 18, btnY);
        ctx.closePath();
        ctx.fill();

        y += playerCardH;

        // 简介文字
        if (showLines > 0) {
          y += 24;
          ctx.fillStyle = '#374151';
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          for (let i = 0; i < showLines; i++) {
            const isLast = i === showLines - 1 && descLines.length > showLines;
            const line = isLast ? descLines[i].slice(0, -1) + '…' : descLines[i];
            ctx.fillText(line, PAD, y);
            y += lineH;
          }
        }

        wx.canvasToTempFilePath({
          canvas,
          width: W,
          height: H,
          destWidth: W * 2,
          destHeight: H * 2,
          fileType: 'png',
          success: (r) => resolve(r.tempFilePath),
          fail: reject
        });
      });
    });
  },

  _generateClosingVideoShareImage(course) {
    return new Promise((resolve, reject) => {
      const W = 1000;
      const H = 800;
      const PAD = 40;
      const dpr = wx.getWindowInfo?.().pixelRatio || 2;
      const coverUrl = course.closingVideoCoverUrl;

      if (!coverUrl) {
        reject(new Error('missing closing video cover'));
        return;
      }

      const query = wx.createSelectorQuery().in(this);
      query.select('#longImageCanvas').fields({ node: true, size: true }).exec(async (res) => {
        try {
          if (!res || !res[0] || !res[0].node) {
            throw new Error('no canvas');
          }

          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const coverImage = await this.loadPosterImage(canvas, [coverUrl]);

          canvas.width = W * dpr;
          canvas.height = H * dpr;
          if (typeof ctx.resetTransform === 'function') ctx.resetTransform();
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, W, H);

          this.drawPosterRoundedRect(ctx, 0, 0, W, H, 0, '#f8fafc');

          const frameX = PAD;
          const frameY = PAD;
          const frameW = W - PAD * 2;
          const frameH = H - PAD * 2;
          this.drawPosterRoundedRect(ctx, frameX, frameY, frameW, frameH, 28, '#ffffff');

          const imgW = coverImage.width || frameW;
          const imgH = coverImage.height || frameH;
          const scale = Math.min(frameW / imgW, frameH / imgH);
          const drawW = imgW * scale;
          const drawH = imgH * scale;
          const drawX = frameX + (frameW - drawW) / 2;
          const drawY = frameY + (frameH - drawH) / 2;

          ctx.drawImage(coverImage, drawX, drawY, drawW, drawH);

          wx.canvasToTempFilePath({
            canvas,
            width: W,
            height: H,
            destWidth: W,
            destHeight: H,
            fileType: 'jpg',
            quality: 0.92,
            success: (r) => resolve(r.tempFilePath),
            fail: reject
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  },

  _wrapText(ctx, text, maxWidth, fontSize) {
    if (!text) return [];
    const lines = [];
    const paragraphs = text.split('\n');
    for (const para of paragraphs) {
      if (!para.trim()) { lines.push(''); continue; }
      let line = '';
      for (const char of para) {
        const test = line + char;
        const w = ctx ? ctx.measureText(test).width : test.length * fontSize;
        if (w > maxWidth && line) {
          lines.push(line);
          line = char;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  },

  handlePodcastPlay() {
    const { course, courseId } = this.data;
    if (!course.podcastUrl) return;

    const app = getApp();
    const isThisSection = app.globalData.podcastSectionId === courseId;

    if (isThisSection && app.globalData.podcastPlaying) {
      // 暂停
      app.globalData.audioContext && app.globalData.audioContext.pause();
      app.globalData.podcastPlaying = false;
      this.setPodcastUiData({ podcastPlaying: false });
      return;
    }

    if (isThisSection && !app.globalData.podcastPlaying) {
      // 恢复播放
      app.globalData.audioContext && app.globalData.audioContext.play();
      app.globalData.podcastPlaying = true;
      this.setPodcastUiData({ podcastPlaying: true });
      return;
    }

    // 新建播放
    if (app.globalData.audioContext) {
      stopPodcastAudio(app.globalData.audioContext);
    }

    const podcastSrc = course.podcastUrl.startsWith('http')
      ? course.podcastUrl
      : 'https://wx.shubai01.com' + course.podcastUrl;
    const podcastDescription = (course.podcastDescription || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    const ctx = createPodcastAudioContext({
      title: course.title || '凡人播客',
      description: podcastDescription,
      coverUrl: course.coverImage || ''
    });

    // 立即显示播客栏，不等 onPlay 回调，避免缓冲期间无反馈
    app.globalData.podcastActive = true;
    app.globalData.podcastLoading = true;
    app.globalData.podcastSectionId = courseId;
    app.globalData.podcastTitle = course.title || '';
    app.globalData.podcastDescription = podcastDescription;
    app.globalData.podcastUrl = course.podcastUrl;
    app.globalData.podcastCoverUrl = course.coverImage || '/assets/images/fanren-boke.jpg';
    app.globalData.podcastDuration = course.podcastDuration || 0;
    this.setPodcastUiData({ podcastSectionId: courseId, podcastLoading: true });

    ctx.onPlay(() => {
      app.globalData.podcastPlaying = true;
      app.globalData.podcastLoading = false;
      activityService.track('podcast_play', { targetId: courseId });
      this.setPodcastUiData({ podcastPlaying: true, podcastLoading: false });
    });

    ctx.onPause(() => {
      app.globalData.podcastPlaying = false;
      this.setPodcastUiData({ podcastPlaying: false });
    });

    ctx.onStop(() => {
      app.globalData.podcastPlaying = false;
      app.globalData.podcastActive = false;
      this.setPodcastUiData({ podcastPlaying: false, podcastProgress: 0 });
    });

    ctx.onEnded(() => {
      app.globalData.podcastPlaying = false;
      app.globalData.podcastActive = false;
      app.globalData.podcastCurrentTime = 0;
      this.setPodcastUiData({ podcastPlaying: false, podcastProgress: 0 });
    });

    ctx.onTimeUpdate(() => {
      const duration = ctx.duration || course.podcastDuration || 0;
      const current = ctx.currentTime || 0;
      app.globalData.podcastCurrentTime = current;
      app.globalData.podcastDuration = duration;
      const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
      this.setPodcastUiData({ podcastProgress: progress });
    });

    ctx.onError((err) => {
      console.error('播客播放失败:', err);
      wx.showToast({ title: '播放失败，请重试', icon: 'none' });
      app.globalData.podcastPlaying = false;
      app.globalData.podcastLoading = false;
      app.globalData.podcastActive = false;
      this.setPodcastUiData({ podcastPlaying: false, podcastLoading: false });
    });

    app.globalData.audioContext = ctx;
    app.globalData.podcastSectionId = courseId;
    setPodcastAudioSource(ctx, podcastSrc);
  },

  togglePodcastDesc() {
    this.setData({ podcastDescExpanded: !this.data.podcastDescExpanded });
  },

  handleLongImageShare() {
    const {
      detailCheckin,
      posterGenerating,
      posterGalleryItems,
      posterSourceCheckinId
    } = this.data;

    if (!detailCheckin) {
      wx.showToast({
        title: '暂无可生成的内容',
        icon: 'none'
      });
      return;
    }

    if (posterGenerating) {
      return;
    }

    if (
      Array.isArray(posterGalleryItems) &&
      posterGalleryItems.length > 0 &&
      posterSourceCheckinId === detailCheckin.id
    ) {
      this.openPosterGallery();
      return;
    }

    this.setData({ posterGenerating: true });
    if (wx.showLoading) {
      wx.showLoading({
        title: '生成长图中...',
        mask: true
      });
    }

    this.generatePosterGallery(detailCheckin)
      .then((galleryItems) => {
        this.setData({
          posterGenerating: false,
          posterTempFilePath: galleryItems[0]?.tempFilePath || '',
          posterSourceCheckinId: detailCheckin.id,
          posterGalleryItems: galleryItems,
          posterGalleryVisible: true
        });
        this.syncSelectedPoster(0);
        wx.hideLoading?.();
      })
      .catch((error) => {
        console.error('生成长图失败:', error);
        this.setData({ posterGenerating: false });
        wx.hideLoading?.();
        wx.showToast({
          title: '长图生成失败',
          icon: 'none'
        });
      });
  },

  // ── AI 朗读 ──────────────────────────────────────────

  handleTtsPlay() {
    const state = this.data.ttsState;
    if (state === 'loading') return;
    if (state === 'playing') {
      this._ttsAudio && this._ttsAudio.pause();
      this.setData({ ttsState: 'paused' });
      return;
    }
    if (state === 'paused') {
      this._ttsAudio && this._ttsAudio.play();
      this.setData({ ttsState: 'playing' });
      return;
    }
    activityService.track('course_ai_read', { targetId: this.data.courseId });
    this._ttsStart();
  },

  _ttsStart() {
    if (!WECHAT_SI_PLUGIN_ENABLED) {
      wx.showToast({ title: 'AI 朗读暂未开通', icon: 'none' });
      this.setData({ ttsState: 'idle' });
      return;
    }
    const content = this.data.course && this.data.course.content;
    if (!content) {
      wx.showToast({ title: '暂无可朗读内容', icon: 'none' });
      return;
    }
    const { richContentToPlainText } = require('../../utils/markdown');
    const plainText = richContentToPlainText(content).replace(/\s+/g, ' ').trim();
    if (!plainText) {
      wx.showToast({ title: '暂无可朗读内容', icon: 'none' });
      return;
    }
    this._ttsChunks = this._ttsSplit(plainText, 180);
    this._ttsChunkIndex = 0;
    this.setData({ ttsState: 'loading' });
    this._ttsPlayChunk();
  },

  _ttsSplit(text, maxLen) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      let end = start + maxLen;
      if (end < text.length) {
        const breakAt = text.lastIndexOf('。', end);
        if (breakAt > start) end = breakAt + 1;
      }
      chunks.push(text.slice(start, end));
      start = end;
    }
    return chunks;
  },

  _ttsPlayChunk() {
    if (this._ttsChunkIndex >= (this._ttsChunks || []).length) {
      this.setData({ ttsState: 'idle' });
      return;
    }
    const text = this._ttsChunks[this._ttsChunkIndex];
    const plugin = requirePlugin('WechatSI');
    plugin.textToSpeech({
      lang: 'zh_CN',
      tts: true,
      content: text,
      success: (res) => {
        if (!res.filename) {
          wx.showToast({ title: 'AI 朗读失败，请重试', icon: 'none' });
          this.setData({ ttsState: 'idle' });
          return;
        }
        if (!this._ttsAudio) {
          this._ttsAudio = wx.createInnerAudioContext();
          this._ttsAudio.onEnded(() => {
            this._ttsChunkIndex++;
            this.setData({ ttsState: 'loading' });
            this._ttsPlayChunk();
          });
          this._ttsAudio.onError((err) => {
            console.error('TTS 播放错误:', err);
            this.setData({ ttsState: 'idle' });
          });
        }
        this._ttsAudio.src = res.filename;
        this._ttsAudio.play();
        this.setData({ ttsState: 'playing' });
      },
      fail: (err) => {
        console.error('TTS 合成失败:', err);
        wx.showToast({ title: 'AI 朗读失败，请重试', icon: 'none' });
        this.setData({ ttsState: 'idle' });
      }
    });
  },

  // 未登录弹引导弹窗，已登录但未付费静默返回 false
  _requireInteraction(message) {
    const app = getApp();
    if (!app.globalData.isLogin) {
      return requireLogin(message);
    }
    return this.data.communityAccessState === 'enabled';
  },

  _ttsDestroy() {
    if (this._ttsAudio) {
      this._ttsAudio.destroy();
      this._ttsAudio = null;
    }
    this._ttsChunks = null;
    this._ttsChunkIndex = 0;
  }
});
