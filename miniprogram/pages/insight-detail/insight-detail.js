const insightService = require('../../services/insight.service');
const danmakuService = require('./danmaku.service');
const env = require('../../config/env');
const { renderInsightRichTextContent } = require('../../utils/markdown');
const activityService = require('../../services/activity.service');
const subscribeAutoTopUp = require('../../utils/subscribe-auto-topup');
const { requireLogin } = require('../../utils/require-login');
const { isAdminUser } = require('../../utils/auth');
const { THEME_PRIMARY, WECHAT_SI_PLUGIN_ENABLED } = require('../../utils/theme');
const { getBrandName } = require('../../utils/brand');
const {
  normalizeDanmakuContent,
  countDanmakuChars,
  truncateDanmakuContent
} = require('../../utils/danmaku');

// 弹幕泳道数量
const DANMAKU_LANES = 4;
// 弹幕横跨屏幕时长（秒）
const DANMAKU_DURATION = 18;
// activeDanmaku 上限（包含排队等候但尚未出现的条目，给足余量）
const DANMAKU_MAX_VISIBLE = 20;
// 同一泳道两条弹幕最小间隔（ms）：让前一条有足够空间移走再进下一条
// 72vw 宽气泡 + 20vw 间隙 = 92vw，220vw/18s ≈ 12.2vw/s → 92/12.2 ≈ 7.5s
const DANMAKU_LANE_COOLDOWN = 7500;

const INSIGHT_POSTER_WIDTH = 750;
const INSIGHT_INTERACTION_SUBSCRIBE_SCENES = ['insight_liked', 'danmaku_received'];

function getEntityId(entity) {
  if (!entity) return '';
  if (typeof entity === 'object') {
    return entity._id || entity.id || '';
  }
  return entity;
}

function getEntityNickname(entity) {
  if (!entity || typeof entity !== 'object') return '';
  return entity.nickname || entity.name || '';
}

function resolveInsightOwner(insight = {}, currentUser = {}) {
  const targetUserId = getEntityId(insight.targetUserId);
  const creatorUserId = getEntityId(insight.userId);
  const ownerId = targetUserId || creatorUserId;
  const ownerUser =
    (targetUserId && typeof insight.targetUserId === 'object' && insight.targetUserId) ||
    (creatorUserId && typeof insight.userId === 'object' && insight.userId) ||
    null;
  const currentUserId = getEntityId(currentUser);
  const currentUserName = getEntityNickname(currentUser);
  const ownerName = getEntityNickname(ownerUser);

  return {
    id: ownerId,
    name:
      ownerName ||
      (ownerId && currentUserId && String(ownerId) === String(currentUserId) ? currentUserName : '') ||
      '晨读者'
  };
}


function normalizeInsightDetail(rawInsight) {
  if (!rawInsight) return {};

  const title = rawInsight.sectionId?.title || rawInsight.title || '学习反馈';
  const periodName =
    rawInsight.periodId?.name ||
    rawInsight.periodId?.title ||
    rawInsight.periodName ||
    '七个习惯晨读营';

  return {
    ...rawInsight,
    title,
    periodName
  };
}

Page({
  data: {
    insightId: null,
    insight: {},
    isDetailReady: false,
    searchKeyword: '',
    showShareModal: false,
    isDev: env.currentEnv === 'dev',
    posterGenerating: false,
    posterGeneratingMode: '',
    posterTempFilePath: '',
    showPosterPanel: false,
    // 弹幕相关
    danmakuEnabled: true,
    showDanmakuPanel: false,
    danmakuList: [],
    activeDanmaku: [],
    danmakuInput: '',
    danmakuInputLength: 0,
    themePrimaryColor: THEME_PRIMARY,
    danmakuColor: THEME_PRIMARY,
    danmakuColors: [
      { name: '主题', value: THEME_PRIMARY },
      { name: '暖金', value: '#e6a23c' },
      { name: '草绿', value: '#52c41a' },
      { name: '淡紫', value: '#9b8fc4' },
      { name: '玫瑰', value: '#e8a0b4' }
    ],
    isOwnInsight: false,
    isLiked: false,
    ttsAvailable: WECHAT_SI_PLUGIN_ENABLED,
    ttsState: 'idle',  // idle | loading | playing | paused
    showHearts: false,
    heartItems: [],
    scrollPercent: 0,
    textShareFilePath: '',
    textShareFileName: '',
    canEditInsight: false
  },

  // 弹幕引擎内部状态（不需要响应式，放实例属性）
  _danmakuCooldowns: null,   // Map<id, lastShownTimestamp>，用冷却替代永久屏蔽
  _laneReleaseTimes: null,
  _pageScrollHeight: 0,
  _currentScrollPercent: 0,

  onLoad(options) {
    if (!options.id || options.id === 'undefined') {
      wx.redirectTo({ url: '/pages/index/index' });
      return;
    }
    this._danmakuCooldowns = new Map();
    this._laneReleaseTimes = new Array(DANMAKU_LANES).fill(0);
    this._pendingDanmakuIds = new Set();
    this._heartsBatchTimers = [];
    const savedDanmaku = wx.getStorageSync('danmakuEnabled');
    const keyword = options.keyword ? decodeURIComponent(options.keyword) : '';
    this.setData({
      insightId: options.id,
      searchKeyword: keyword,
      danmakuEnabled: savedDanmaku === false ? false : true
    });
    this.loadInsightDetail();
    this.loadDanmaku();
  },

  onShow() {
    // 从编辑页返回时重新加载内容
    if (this._needsReload && this.data.insightId) {
      this._needsReload = false;
      this.loadInsightDetail();
    }
  },

  onReady() {
    // onReady 时内容可能尚未渲染，先做一次粗测；loadInsightDetail 完成后会精确重测
    this._measurePageHeight();
    // 延迟设置哨兵观察器，确保元素已渲染
    setTimeout(() => {
      if (this.data.isDetailReady) {
        this._setupBottomObserver();
      }
    }, 600);
  },

  onUnload() {
    if (this._bottomObserver) {
      this._bottomObserver.disconnect();
      this._bottomObserver = null;
    }
    this._ttsDestroy();
  },

  // 用 IntersectionObserver 监测底部哨兵是否进入视口，滚到底时强制设 100%
  _setupBottomObserver() {
    if (this._bottomObserver) this._bottomObserver.disconnect();
    this._bottomObserver = wx.createIntersectionObserver(this, { thresholds: [0] });
    this._bottomObserver.relativeToViewport({ bottom: 0 }).observe('#scroll-end-sentinel', res => {
      // 只在已滚动到较深位置（>85%）时才认定为到底，避免短内容页误判
      if (res.intersectionRatio > 0 && this.data.scrollPercent >= 85) {
        if (this.data.scrollPercent < 100) {
          this.setData({ scrollPercent: 100 });
          this._currentScrollPercent = 100;
        }
      }
    });
  },

  _measurePageHeight() {
    const sysInfo = wx.getSystemInfoSync();
    // 196rpx = padding-bottom on .page-insight-detail（为固定底部栏预留），
    // WeChat 不允许滚动进入 padding 区域，所以从分母中减去它，保证滚到底时刚好是 100%
    const paddingBottomPx = Math.round(196 * sysInfo.windowWidth / 750);
    wx.createSelectorQuery()
      .select('.page-insight-detail')
      .boundingClientRect(rect => {
        if (rect && rect.height > 0) {
          const h = rect.height - sysInfo.windowHeight - paddingBottomPx;
          // 只在新值比旧值大时更新，避免用未渲染时的小值覆盖正确值
          if (h > (this._pageScrollHeight || 0)) {
            this._pageScrollHeight = Math.max(1, h);
          }
        }
      })
      .exec();
  },

  onPageScroll({ scrollTop }) {
    // scrollTop 超过存储高度说明之前测量时内容还没渲染完，立即重测
    if (scrollTop > 0 && scrollTop >= this._pageScrollHeight) {
      this._measurePageHeight();
    }
    if (this._pageScrollHeight > 0) {
      const percent = Math.min(100, Math.round((scrollTop / this._pageScrollHeight) * 100));
      this._currentScrollPercent = percent;
      if (this.data.danmakuEnabled) {
        this._checkDanmakuTrigger(percent);
      }
      // 仅在值变化时才 setData，减少频繁渲染
      if (percent !== this.data.scrollPercent) {
        this.setData({ scrollPercent: percent });
      }
    }
  },

  async loadInsightDetail() {
    try {
      const rawInsight = await insightService.getInsightDetail(
        this.data.insightId
      );
      const insight = normalizeInsightDetail(rawInsight);
      const app = getApp();
      const currentUser = app?.globalData?.userInfo || {};
      const currentUserId =
        currentUser?._id || currentUser?.id;
      const owner = resolveInsightOwner(insight, currentUser);
      const isOwnInsight =
        currentUserId && owner.id && String(currentUserId) === String(owner.id);
      const creatorUserId = getEntityId(insight.userId);
      const canEditInsight =
        isAdminUser(currentUser) ||
        (currentUserId &&
          creatorUserId &&
          String(currentUserId) === String(creatorUserId));

      if (currentUserId) {
        activityService.track(
          isOwnInsight ? 'own_insight_view' : 'other_insight_view',
          {
            targetType: 'insight',
            targetId: this.data.insightId,
            periodId: insight.periodId?._id || insight.periodId || null,
            sectionId: insight.sectionId?._id || insight.sectionId || null,
            metadata: {
              title: insight.title || ''
            }
          }
        );
      }

      // 添加 dayNumber 字段用于显示
      if (insight && !insight.dayNumber) {
        insight.dayNumber = insight.day || 1;
      }

      // 兼容 HTML 和 Markdown 内容。
      if (insight && insight.content) {
        insight.content = renderInsightRichTextContent(insight.content);
        const kw = this.data.searchKeyword;
        if (kw) {
          insight.content = this._highlightKeyword(insight.content, kw);
        }
      }

      // 检测当前用户是否已点赞
      const isLiked = Array.isArray(insight.likes) && currentUserId
        ? insight.likes.some(l => String(l.userId || l) === String(currentUserId))
        : false;

      this.setData({
        insight,
        isLiked,
        isOwnInsight: !!isOwnInsight,
        canEditInsight: !!canEditInsight,
        isDetailReady: true
      });
      if (isOwnInsight) {
        this.topUpInsightInteractionSubscriptions('insight_detail_own_view');
      }
      this._measurePageHeight();
      this._setupBottomObserver();
      // 富文本渲染完后重测页面高度（rich-text 渲染需要一点时间）
      setTimeout(() => this._measurePageHeight(), 400);
      // 有搜索关键词时，滚动到内容区
      if (this.data.searchKeyword) {
        setTimeout(() => {
          wx.createSelectorQuery()
            .select('.content-section')
            .boundingClientRect(rect => {
              if (rect && rect.top != null) {
                wx.pageScrollTo({ scrollTop: rect.top + wx.getWindowInfo().scrollTop - 16, duration: 300 });
              }
            })
            .exec();
        }, 500);
      }
    } catch (error) {
      console.error('加载失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  topUpInsightInteractionSubscriptions(sourceAction) {
    subscribeAutoTopUp
      .maybeAutoTopUpSubscriptions({
        sourceAction,
        sourcePage: 'insight-detail',
        sceneKeys: INSIGHT_INTERACTION_SUBSCRIBE_SCENES,
        requestMode: 'remembered'
      })
      .catch(() => {});
  },

  handleEdit() {
    this._needsReload = true;
    wx.navigateTo({
      url: `/pages/insight-edit/insight-edit?id=${this.data.insightId}`
    });
  },

  handleBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.switchTab({ url: '/pages/periods/periods' });
    }
  },

  /**
   * 打开分享菜单
   */
  async openShareMenu() {
    await this.prepareTextShareFile();
    this.setData({ showShareModal: true });
  },

  /**
   * 关闭分享菜单
   */
  closeShareModal() {
    this.setData({ showShareModal: false });
  },

  getShareTitle(insight = {}) {
    const app = getApp();
    const owner = resolveInsightOwner(insight, app?.globalData?.userInfo || {});
    return `${insight.title || getBrandName()} - 致${owner.name}`;
  },

  buildTextShareContent(insight = {}) {
    const title = this.getShareTitle(insight);
    const periodName = insight.periodName || '七个习惯晨读营';
    const body = this._stripHtmlForCanvas(insight.content || '');

    return [
      title,
      periodName,
      '',
      body,
      '',
      `By 小凡@${getBrandName()}`,
      'AI生成，注意甄别！'
    ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n');
  },

  getTextShareFileName(insight = {}) {
    const displayName = `小凡看见：${this.getShareTitle(insight)}`;
    const fileName = String(displayName)
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, '')
      .slice(0, 48) || '小凡看见';
    return `${fileName}.txt`;
  },

  handleShareMenuLongImage() {
    this.closeShareModal();
    this.handleLongImageShare({ currentTarget: { dataset: { mode: 'hd' } } });
  },

  prepareTextShareFile() {
    const { insight } = this.data;
    const content = this.buildTextShareContent(insight);

    if (!content.trim()) {
      this.setData({ textShareFilePath: '', textShareFileName: '' });
      return Promise.resolve(false);
    }

    const fileSystemManager = wx.getFileSystemManager && wx.getFileSystemManager();
    const userDataPath = wx.env && wx.env.USER_DATA_PATH;

    if (!fileSystemManager || !userDataPath) {
      this.setData({ textShareFilePath: '', textShareFileName: '' });
      return Promise.resolve(false);
    }

    const fileName = this.getTextShareFileName(insight);
    const filePath = `${userDataPath}/${fileName}`;
    wx.showLoading({ title: '生成文本...', mask: true });
    return new Promise(resolve => {
      fileSystemManager.writeFile({
        filePath,
        data: content,
        encoding: 'utf8',
        success: () => {
          wx.hideLoading();
          this.setData({ textShareFilePath: filePath, textShareFileName: fileName });
          resolve(true);
        },
        fail: error => {
          wx.hideLoading();
          console.error('文本文件生成失败:', error);
          this.setData({ textShareFilePath: '', textShareFileName: '' });
          resolve(false);
        }
      });
    });
  },

  handleTextShare() {
    this.closeShareModal();

    if (typeof wx.shareFileMessage !== 'function') {
      wx.showToast({ title: '当前微信版本不支持txt转发', icon: 'none' });
      return;
    }

    const { textShareFilePath, textShareFileName } = this.data;
    if (!textShareFilePath) {
      wx.showToast({ title: '文本未生成，请重新点分享', icon: 'none' });
      return;
    }

    wx.shareFileMessage({
      filePath: textShareFilePath,
      fileName: textShareFileName,
      fail: error => {
        console.error('文本文件转发失败:', error);
        wx.showToast({ title: '转发失败，请重试', icon: 'none' });
      }
    });
  },

  /**
   * 长图分享入口
   */
  handleLongImageShare(event) {
    const { insight, posterGenerating } = this.data;
    const posterMode = event?.currentTarget?.dataset?.mode || 'hd';
    const isFullPoster = posterMode === 'full';

    if (!insight || !insight.content) {
      wx.showToast({ title: '暂无可生成的内容', icon: 'none' });
      return;
    }

    if (posterGenerating) return;

    this.setData({ posterGenerating: true, posterGeneratingMode: posterMode });
    wx.showLoading({ title: '生成中...', mask: true });

    this._generateInsightLongImage(insight, { mode: posterMode })
      .then(result => {
        this.setData({
          posterGenerating: false,
          posterGeneratingMode: '',
          posterTempFilePath: result.tempFilePath,
          showPosterPanel: true
        });
        wx.hideLoading();
      })
      .catch(error => {
        this.setData({ posterGenerating: false, posterGeneratingMode: '' });
        wx.hideLoading();
        console.error('生成长图失败:', error);
        wx.showToast({
          title: isFullPoster ? '完整长图生成失败' : '长图生成失败',
          icon: 'none'
        });
      });
  },

  closePosterPanel() {
    this.setData({ showPosterPanel: false });
  },

  noop() {},

  handleSavePoster() {
    const { posterTempFilePath } = this.data;
    if (!posterTempFilePath) return;

    wx.saveImageToPhotosAlbum({
      filePath: posterTempFilePath,
      success() {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail(err) {
        if (String(err?.errMsg || '').includes('auth deny') && wx.showModal) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存到相册后重试',
            success(res) {
              if (res.confirm && wx.openSetting) wx.openSetting({});
            }
          });
        } else {
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
      }
    });
  },

  handleSharePoster() {
    const { posterTempFilePath } = this.data;
    if (!posterTempFilePath) return;

    // wx.showShareImageMenu：基础库 2.14.3+，弹出原生图片分享菜单（含"发送给朋友"）
    if (typeof wx.showShareImageMenu === 'function') {
      wx.showShareImageMenu({
        path: posterTempFilePath,
        success: () => {
          this.closePosterPanel();
        },
        fail() {
          wx.showToast({ title: '分享失败，请长按图片操作', icon: 'none' });
        }
      });
      return;
    }

    // 降级：wx.shareImageMessage（2.22.0+）
    if (typeof wx.shareImageMessage === 'function') {
      wx.shareImageMessage({
        imagePath: posterTempFilePath,
        success: () => {
          this.closePosterPanel();
        },
        fail() {
          wx.showToast({ title: '请长按图片选择转发', icon: 'none' });
        }
      });
      return;
    }

    // 最终降级：提示用户长按
    wx.showToast({ title: '请长按图片选择转发', icon: 'none' });
  },

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

  _stripHtmlForCanvas(html) {
    return (html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  // Parse HTML paragraph inner content into bold/regular runs
  _parseRunsFromHtmlInner(inner) {
    const clean = s => s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');

    const runs = [];
    const boldRe = /<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
    let last = 0;
    let m;

    while ((m = boldRe.exec(inner)) !== null) {
      const before = clean(inner.slice(last, m.index));
      if (before) runs.push({ text: before, bold: false });
      const bt = clean(m[1]);
      if (bt) runs.push({ text: bt, bold: true });
      last = m.index + m[0].length;
    }

    const after = clean(inner.slice(last));
    if (after) runs.push({ text: after, bold: false });
    if (runs.length === 0) {
      const t = clean(inner);
      if (t) runs.push({ text: t, bold: false });
    }
    return runs;
  },

  // Wrap runs into canvas lines, each line is [{text, bold}]
  _wrapRunsForCanvas(ctx, runs, maxWidth, regularFont, boldFont) {
    const lines = [];
    let curLine = [];
    let curW = 0;

    const flush = () => { lines.push(curLine); curLine = []; curW = 0; };

    for (const run of runs) {
      ctx.font = run.bold ? boldFont : regularFont;
      let i = 0;
      const text = run.text;

      while (i < text.length) {
        if (text[i] === '\n') { flush(); i++; continue; }

        let seg = '';
        let j = i;
        while (j < text.length && text[j] !== '\n') {
          const test = seg + text[j];
          if (curW + ctx.measureText(test).width > maxWidth) {
            if (seg) break;
            if (curLine.length > 0) {
              flush();
              continue;
            }
          }
          seg += text[j];
          j++;
        }

        if (!seg) { flush(); seg = text[i]; j = i + 1; }

        curLine.push({ text: seg, bold: run.bold });
        curW += ctx.measureText(seg).width;
        i = j;

        if (i < text.length && text[i] !== '\n') flush();
      }
    }

    if (curLine.length > 0) flush();
    return lines.length > 0 ? lines : [[{ text: '', bold: false }]];
  },

  _hasPosterBlockTags(html = '') {
    return /<(p|li|blockquote|div|h[1-6])\b[^>]*>/i.test(html);
  },

  _collectHtmlParagraphs(html, inheritedQuote = false) {
    const paragraphs = [];
    const blockRegex = /<(p|li|blockquote|div|h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = blockRegex.exec(html)) !== null) {
      const tagName = String(match[1] || '').toLowerCase();
      const attrs = match[2] || '';
      const inner = match[3];
      const isListItem = tagName === 'li';
      const isQuote = inheritedQuote || tagName === 'blockquote' || /border-left/i.test(attrs);

      if (!isListItem && this._hasPosterBlockTags(inner)) {
        paragraphs.push(...this._collectHtmlParagraphs(inner, isQuote));
        continue;
      }

      const runs = isListItem
        ? [{ text: '• ', bold: false }, ...this._parseRunsFromHtmlInner(inner)]
        : this._parseRunsFromHtmlInner(inner);
      const plainText = runs.map(r => r.text).join('').trim();
      if (plainText) paragraphs.push({ runs, isQuote });
    }

    return paragraphs;
  },

  // Parse HTML into paragraphs: [{runs:[{text,bold}], isQuote}]
  _parseHtmlToParagraphs(html) {
    const paragraphs = this._collectHtmlParagraphs(html);

    if (paragraphs.length === 0) {
      this._stripHtmlForCanvas(html).split('\n').forEach(line => {
        const t = line.trim();
        if (t) paragraphs.push({ runs: [{ text: t, bold: false }], isQuote: false });
      });
    }

    return paragraphs;
  },

  _wrapTextForCanvas(ctx, fontStr, text, maxWidth) {
    ctx.font = fontStr;
    const lines = [];
    const paragraphs = text.split('\n');

    for (const para of paragraphs) {
      if (!para.trim()) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const char of para) {
        const test = line + char;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = char;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
    }

    while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
    return lines.length > 0 ? lines : [''];
  },

  _getCanvasLinesHeight(lines = [], lineHeight) {
    return lines.reduce(
      (sum, line) => sum + (line ? lineHeight : Math.floor(lineHeight * 0.6)),
      0
    );
  },

  _trimTrailingBlankLines(lines = []) {
    const nextLines = [...lines];
    while (nextLines.length > 0 && !nextLines[nextLines.length - 1]) {
      nextLines.pop();
    }
    return nextLines;
  },

  _fitLinesToCanvasHeight(lines = [], maxHeight, lineHeight) {
    const overflowLines = ['……', '打开小程序查看全文'];
    const overflowHeight = this._getCanvasLinesHeight(overflowLines, lineHeight);
    const fittedLines = [];
    let usedHeight = 0;

    for (const line of lines) {
      const currentHeight = line ? lineHeight : Math.floor(lineHeight * 0.6);
      if (usedHeight + currentHeight + overflowHeight > maxHeight) {
        return {
          lines: [...this._trimTrailingBlankLines(fittedLines), ...overflowLines],
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

  _getPosterCanvasDpr(height, mode = 'hd') {
    if (mode === 'full') {
      return 1;
    }

    const systemDpr = wx.getWindowInfo?.().pixelRatio || 2;
    return Math.min(systemDpr, height > 3200 ? 1.5 : height > 2200 ? 2 : 3);
  },

  _exportInsightPosterCanvas(canvas, width, height, mode = 'hd') {
    if (mode === 'full') {
      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          width,
          height,
          destWidth: width,
          destHeight: height,
          fileType: 'jpg',
          quality: 0.82,
          success: res => resolve(res.tempFilePath),
          fail: reject
        });
      });
    }

    const preferredScales =
      height > 3200 ? [1.25, 1] : height > 2200 ? [1.5, 1.25, 1] : [2, 1.5, 1];
    let attemptIndex = 0;

    return new Promise((resolve, reject) => {
      const tryExport = () => {
        const scale = preferredScales[attemptIndex];

        wx.canvasToTempFilePath({
          canvas,
          width,
          height,
          destWidth: Math.round(width * scale),
          destHeight: Math.round(height * scale),
          fileType: 'png',
          quality: 1,
          success: res => resolve(res.tempFilePath),
          fail: error => {
            const isLastAttempt = attemptIndex >= preferredScales.length - 1;
            if (isLastAttempt) {
              reject(error);
              return;
            }

            console.warn('小凡看见长图导出失败，降低清晰度重试', {
              scale,
              width,
              height,
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

  _generateInsightLongImage(insight, options = {}) {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery().in(this);
      query
        .select('#insightLongImageCanvas')
        .fields({ node: true, size: true })
        .exec(async result => {
          if (!result || !result[0] || !result[0].node) {
            reject(new Error('找不到画布'));
            return;
          }

          try {
            const canvas = result[0].node;
            const ctx = canvas.getContext('2d');
            const mode = options.mode === 'full' ? 'full' : 'hd';
            const W = INSIGHT_POSTER_WIDTH;
            const PADDING = 48;
            const CONTENT_W = W - PADDING * 2;
            const FOOTER_H = 148;
            const TITLE_FONT = 42;
            const TITLE_LINE_H = 58;
            const CONTENT_FONT = 28;
            const CONTENT_LINE_H = 48;
            const PERIOD_FONT = 24;
            const REGULAR_FONT = `${CONTENT_FONT}px sans-serif`;
            const BOLD_FONT = `bold ${CONTENT_FONT}px sans-serif`;

            const rawTitle = insight.title || '小凡看见';
            const periodName = insight.periodName || getBrandName();
            const htmlParagraphs = this._parseHtmlToParagraphs(insight.content || '');
            const PARA_GAP = Math.floor(CONTENT_LINE_H * 0.75);

            // Pass 1: measure text to compute canvas height
            canvas.width = W;
            canvas.height = 400;

            const titleLines = this._wrapTextForCanvas(
              ctx,
              `bold ${TITLE_FONT}px sans-serif`,
              rawTitle,
              CONTENT_W
            );

            // Wrap each paragraph into lines of [{text, bold}] segments
            const wrappedParas = htmlParagraphs.map(para => {
              const lines = this._wrapRunsForCanvas(ctx, para.runs, CONTENT_W, REGULAR_FONT, BOLD_FONT);
              return { ...para, lines };
            });

            const contentTextH = wrappedParas.reduce((sum, para, i) => {
              return sum + para.lines.length * CONTENT_LINE_H +
                (i < wrappedParas.length - 1 ? PARA_GAP : 0);
            }, 0);
            const headerBodyGap = TITLE_LINE_H + 98;
            const footerGap = 48;
            const H = Math.max(
              PADDING +
                titleLines.length * TITLE_LINE_H +
                headerBodyGap +
                contentTextH +
                footerGap +
                FOOTER_H +
                PADDING,
              700
            );

            // Pass 2: resize canvas and draw
            if (typeof ctx.resetTransform === 'function') {
              ctx.resetTransform();
            } else if (typeof ctx.setTransform === 'function') {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
            const dpr = this._getPosterCanvasDpr(H, mode);
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, W, H);

            // White background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);

            // 无顶部色条，保持纯白背景

            // Title
            let cursorY = PADDING + TITLE_LINE_H;
            ctx.fillStyle = '#0d4f6c';
            ctx.font = `bold ${TITLE_FONT}px sans-serif`;
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
            for (const line of titleLines) {
              ctx.fillText(line, PADDING, cursorY);
              cursorY += TITLE_LINE_H;
            }

            // Period label
            cursorY += 14;
            ctx.fillStyle = '#2980b9';
            ctx.font = `${PERIOD_FONT}px sans-serif`;
            ctx.fillText(periodName, PADDING, cursorY);
            cursorY += 38;

            // Divider under period label
            cursorY += 10;
            ctx.strokeStyle = '#e2eaf3';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(PADDING, cursorY);
            ctx.lineTo(W - PADDING, cursorY);
            ctx.stroke();
            cursorY += 36;

            // Content text - inline-bold-aware segment rendering
            for (let pi = 0; pi < wrappedParas.length; pi++) {
              const para = wrappedParas[pi];

              if (para.isQuote) {
                ctx.fillStyle = '#d6e4ff';
                ctx.fillRect(PADDING, cursorY - CONTENT_LINE_H + 10, 3, para.lines.length * CONTENT_LINE_H - 10);
              }

              const baseX = para.isQuote ? PADDING + 14 : PADDING;
              for (const lineSegs of para.lines) {
                let segX = baseX;
                for (const seg of lineSegs) {
                  ctx.font = seg.bold ? BOLD_FONT : REGULAR_FONT;
                  ctx.fillStyle = para.isQuote ? '#5b6b8c' : (seg.bold ? '#111827' : '#374151');
                  ctx.fillText(seg.text, segX, cursorY);
                  segX += ctx.measureText(seg.text).width;
                }
                cursorY += CONTENT_LINE_H;
              }

              if (pi < wrappedParas.length - 1) {
                cursorY += PARA_GAP;
              }
            }

            // Footer divider
            const footerTop = cursorY + 56;
            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(PADDING, footerTop + 24);
            ctx.lineTo(W - PADDING, footerTop + 24);
            ctx.stroke();

            // QR / logo image (right side)
            let qrImage = null;
            try {
              qrImage = await new Promise((res, rej) => {
                const img = canvas.createImage();
                img.onload = () => res(img);
                img.onerror = rej;
                img.src = '/assets/images/mini-program-code.jpg';
              });
            } catch (e) {
              // continue without image
            }

            const QR_SIZE = 108;
            const QR_X = W - PADDING - QR_SIZE;
            const QR_Y = footerTop + 44;

            if (qrImage) {
              ctx.drawImage(qrImage, QR_X, QR_Y, QR_SIZE, QR_SIZE);
            }

            // Branding text (left side)
            const brandY = footerTop + 84;
            ctx.fillStyle = '#1f2937';
            ctx.font = 'bold 28px sans-serif';
            ctx.fillText(`By 小凡@${getBrandName()}`, PADDING, brandY);

            ctx.fillStyle = '#9ca3af';
            ctx.font = '24px sans-serif';
            ctx.fillText('AI生成，注意甄别！', PADDING, brandY + 40);

            this._exportInsightPosterCanvas(canvas, W, H, mode)
              .then(tempFilePath => resolve({ tempFilePath, contentTruncated: false }))
              .catch(reject);
          } catch (err) {
            reject(err);
          }
        });
    });
  },

  /**
   * 分享到微信好友（系统原生分享）
   */
  onShareAppMessage() {
    const { insight } = this.data;
    if (this.data.insightId) {
      insightService.shareInsight(this.data.insightId).catch(() => {});
      activityService.track('insight_share', { targetId: this.data.insightId });
    }
    return {
      title: this.getShareTitle(insight),
      path: `/pages/insight-detail/insight-detail?id=${this.data.insightId}&from=share`,
      imageUrl: '/assets/images/share-insight.jpg' // 使用新的"小凡看见"专属分享图
    };
  },

  /**
   * 分享到朋友圈
   */
  onShareTimeline() {
    const { insight } = this.data;
    return {
      title: this.getShareTitle(insight),
      query: `id=${this.data.insightId}&from=share`,
      imageUrl: '/assets/images/share-insight.jpg' // 使用新的"小凡看见"专属分享图
    };
  },

  // ===================== 弹幕功能 =====================

  async loadDanmaku() {
    try {
      const list = await danmakuService.getDanmaku(this.data.insightId);
      this.setData({ danmakuList: Array.isArray(list) ? list : [] });
      // 如果用户已经滚动到某位置后列表才加载完，补充检测一次当前位置
      if (this.data.danmakuEnabled && this._currentScrollPercent > 0) {
        this._checkDanmakuTrigger(this._currentScrollPercent);
      }
    } catch (e) {
      // 弹幕加载失败不影响主流程，静默处理
    }
  },

  openDanmakuPanel() {
    this.setData({ showDanmakuPanel: true });
  },

  closeDanmakuPanel() {
    this.setData({ showDanmakuPanel: false });
  },

  toggleDanmaku(e) {
    const val = e.detail.value;
    this.setData({ danmakuEnabled: val });
    wx.setStorageSync('danmakuEnabled', val);
  },

  onDanmakuInput(e) {
    const value = truncateDanmakuContent(normalizeDanmakuContent(e.detail.value || ''));
    this.setData({
      danmakuInput: value,
      danmakuInputLength: countDanmakuChars(value)
    });
  },

  selectColor(e) {
    this.setData({ danmakuColor: e.currentTarget.dataset.color });
  },

  async sendDanmaku() {
    if (!requireLogin('登录后才能发弹幕')) return;
    const { danmakuInput, danmakuColor, insightId } = this.data;
    const content = normalizeDanmakuContent(danmakuInput || '').trim();
    if (!content) return;

    try {
      const result = await danmakuService.postDanmaku(insightId, {
        content,
        type: 'comment',
        scrollPercent: this._currentScrollPercent,
        color: danmakuColor
      });

      const newItem = result.data || result;
      const danmakuList = [...this.data.danmakuList, newItem];
      this.setData({ danmakuList, danmakuInput: '', danmakuInputLength: 0 });
      this._showDanmaku(newItem);
      activityService.track('insight_danmaku', { targetId: insightId });
      this.closeDanmakuPanel();
    } catch (e) {
      wx.showToast({ title: '发送失败，请重试', icon: 'none' });
    }
  },

  async handleLike() {
    if (!requireLogin('登录后才能点赞')) return;
    const { insightId, isLiked } = this.data;
    try {
      if (isLiked) {
        await insightService.unlikeInsight(insightId);
        const insight = { ...this.data.insight, likeCount: Math.max(0, (this.data.insight.likeCount || 1) - 1) };
        this.setData({ isLiked: false, insight });
      } else {
        await insightService.likeInsight(insightId);
        const { danmakuColor } = this.data;

        const likeResult = await danmakuService.postDanmaku(insightId, {
          content: '被你触动到了！❤️',
          type: 'like',
          scrollPercent: this._currentScrollPercent,
          color: danmakuColor
        });

        const likeItem = likeResult.data || likeResult;
        const insight = { ...this.data.insight, likeCount: (this.data.insight.likeCount || 0) + 1 };
        const danmakuList = [...this.data.danmakuList, likeItem];
        this.setData({ isLiked: true, insight, danmakuList });
        activityService.track('insight_like', { targetId: insightId });
        // _showDanmaku 内部会因 type==='like' 触发爱心，无需在此额外调用
        this._showDanmaku(likeItem);
      }
    } catch (e) {
      wx.showToast({ title: isLiked ? '取消点赞失败' : '点赞失败', icon: 'none' });
    }
  },

  handleDanmakuLike() {
    return this.handleLike();
  },

  _showHearts() {
    if (!this._heartsBatchTimers) this._heartsBatchTimers = [];
    const batchId = Date.now();
    const count = 1;
    const newItems = Array.from({ length: count }, (_, i) => {
      const signX = Math.random() > 0.5 ? 1 : -1;
      const startX = (signX * (Math.random() * 22 + 10)).toFixed(1) + 'vw';
      const startY = (Math.random() * 18 + 28).toFixed(1) + 'vh';
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 35;
      const destX = (Math.cos(angle) * radius).toFixed(1) + 'vw';
      const destY = (Math.sin(angle) * radius).toFixed(1) + 'vw';
      return {
        id: `${batchId}_${i}`,
        batchId,
        startX, startY, destX, destY,
        delay: (i * 0.2).toFixed(2)
      };
    });

    // 超过5批时销毁最旧的一批
    if (this._heartsBatchTimers.length >= 5) {
      const oldest = this._heartsBatchTimers.shift();
      clearTimeout(oldest.timer);
      const filtered = this.data.heartItems.filter(h => h.batchId !== oldest.batchId);
      this.setData({ heartItems: filtered });
    }

    const merged = [...(this.data.heartItems || []), ...newItems];
    this.setData({ showHearts: true, heartItems: merged });

    const timer = setTimeout(() => {
      const remaining = this.data.heartItems.filter(h => h.batchId !== batchId);
      this._heartsBatchTimers = (this._heartsBatchTimers || []).filter(t => t.batchId !== batchId);
      this.setData({ heartItems: remaining, showHearts: remaining.length > 0 });
    }, 8000);
    this._heartsBatchTimers.push({ batchId, timer });
  },

  // 触发位置匹配的弹幕（滚动时调用）
  // cooldown 在实际展示时才标记，避免因泳道满而被静默丢弃
  _checkDanmakuTrigger(percent) {
    const { danmakuList } = this.data;
    const cooldowns = this._danmakuCooldowns;
    if (!cooldowns) return;
    if (!this._pendingDanmakuIds) this._pendingDanmakuIds = new Set();

    const now = Date.now();
    const cooldownMs = (DANMAKU_DURATION + 10) * 1000;

    // 收集命中弹幕：未在冷却期 且 未在待展示队列中
    const triggered = [];
    danmakuList.forEach(item => {
      const id = item._id || item.id;
      const lastShown = cooldowns.get(id) || 0;
      if (
        Math.abs((item.scrollPercent || 0) - percent) <= 10 &&
        now - lastShown > cooldownMs &&
        !this._pendingDanmakuIds.has(id)
      ) {
        this._pendingDanmakuIds.add(id);
        triggered.push(item);
      }
    });
    triggered.sort((a, b) => (a.scrollPercent || 0) - (b.scrollPercent || 0));
    triggered.forEach((item, idx) => {
      setTimeout(() => this._showDanmaku(item), idx * 600);
    });
  },

  // 将一条弹幕加入屏幕
  // 泳道满时用 animation-delay 让气泡在屏幕右侧排队，前一条走出足够间距后自动跟出
  _showDanmaku(item) {
    const itemId = item._id || item.id;
    if (!this._pendingDanmakuIds) this._pendingDanmakuIds = new Set();

    const { activeDanmaku } = this.data;
    // activeDanmaku 同时包含正在播放和排队等待的条目，给足余量
    if (activeDanmaku.length >= DANMAKU_MAX_VISIBLE) {
      this._pendingDanmakuIds.delete(itemId);
      return;
    }

    const now = Date.now();
    const lanes = this._laneReleaseTimes || new Array(DANMAKU_LANES).fill(0);

    // 选等待时间最短的泳道（不拒绝，允许排队）
    let lane = 0;
    let earliest = lanes[0];
    for (let i = 1; i < DANMAKU_LANES; i++) {
      if (lanes[i] < earliest) { earliest = lanes[i]; lane = i; }
    }

    // 需要等待的毫秒数 → 转换为 CSS animation-delay（秒）
    // 元素会在屏幕右侧（translateX(110%)）静止等候，间距 ≈ 半屏
    const waitMs = Math.max(0, earliest - now);
    const animDelay = waitMs / 1000;

    const displayId = `${itemId}_${now}`;
    // 下次该泳道可用时间 = 本条等待时间 + 泳道冷却时间
    lanes[lane] = now + waitMs + DANMAKU_LANE_COOLDOWN;
    this._laneReleaseTimes = lanes;

    if (this._danmakuCooldowns) this._danmakuCooldowns.set(itemId, now);
    this._pendingDanmakuIds.delete(itemId);

    this.setData({
      activeDanmaku: [...this.data.activeDanmaku, {
        id: displayId,
        nickname: item.userNickname || '',
        msg: normalizeDanmakuContent(item.content),
        lane,
        color: item.color || THEME_PRIMARY,
        duration: DANMAKU_DURATION,
        animDelay
      }]
    });

    if (item.type === 'like' && this.data.danmakuEnabled) {
      setTimeout(() => this._showHearts(), waitMs + 400);
    }

    // 等候时间 + 动画时长后从列表移除
    setTimeout(() => {
      this.setData({
        activeDanmaku: this.data.activeDanmaku.filter(d => d.id !== displayId)
      });
    }, (DANMAKU_DURATION + 0.5 + animDelay) * 1000);
  },

  // ===================== AI 朗读 =====================

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
    activityService.track('insight_ai_read', { targetId: this.data.insightId });
    this._ttsStart();
  },

  _ttsStart() {
    if (!WECHAT_SI_PLUGIN_ENABLED) {
      wx.showToast({ title: 'AI 朗读暂未开通', icon: 'none' });
      this.setData({ ttsState: 'idle' });
      return;
    }
    const content = this.data.insight && this.data.insight.content;
    if (!content) {
      wx.showToast({ title: '暂无可朗读内容', icon: 'none' });
      return;
    }
    const plainText = this._stripHtmlForCanvas(content).replace(/\s+/g, ' ').trim();
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

  _ttsDestroy() {
    if (this._ttsAudio) {
      this._ttsAudio.destroy();
      this._ttsAudio = null;
    }
    this._ttsChunks = null;
    this._ttsChunkIndex = 0;
    this.setData({ ttsState: 'idle' });
  }
});
