jest.mock('../../services/course.service', () => ({}));
jest.mock('../../services/checkin.service', () => ({
  getCheckinDetail: jest.fn(),
  normalizeCheckinImages: jest.fn((images = [], maxCount = 9) =>
    (Array.isArray(images) ? images : [])
      .filter(Boolean)
      .map((url) =>
        typeof url === 'string' && url.startsWith('/uploads/')
          ? `https://wx.shubai01.com${url}`
          : url
      )
      .slice(0, maxCount)
  )
}));
jest.mock('../../services/comment.service', () => ({
  createComment: jest.fn()
}));
jest.mock('../../services/activity.service', () => ({
  track: jest.fn(() => Promise.resolve())
}));
jest.mock('../../services/subscribe-message.service', () => ({}));
jest.mock('../../utils/subscribe-auto-topup', () => ({
  maybeAutoTopUpNextDayStudyReminder: jest.fn(() => Promise.resolve())
}));
jest.mock('../../config/constants', () => ({
  STORAGE_KEYS: {
    TOKEN: 'token'
  }
}));
jest.mock('../../utils/period-access', () => ({
  getPeriodAccess: jest.fn(),
  extractId: jest.fn()
}));

const currentTenant = require('../../config/current-tenant');

describe('course-detail page markdown support', () => {
  let pageConfig;
  let pageInstance;
  let commentService;
  let getAvatarColorByUserId;
  let subscribeAutoTopUp;

  beforeEach(() => {
    jest.resetModules();
    pageConfig = null;
    global.Page = jest.fn(config => {
      pageConfig = config;
      return config;
    });
    global.getApp = jest.fn(() => ({
      globalData: {
        userInfo: {
          _id: 'user_fox',
          nickname: '小狐狸',
          avatarUrl: ''
        }
      }
    }));

    commentService = require('../../services/comment.service');
    ({ getAvatarColorByUserId } = require('../../utils/formatters'));
    subscribeAutoTopUp = require('../../utils/subscribe-auto-topup');
    require('../../pages/course-detail/course-detail');

    pageInstance = {
      ...pageConfig,
      data: JSON.parse(JSON.stringify(pageConfig.data)),
      setData(update, callback) {
        const nextData = { ...this.data };
        Object.entries(update).forEach(([key, value]) => {
          if (!key.includes('.')) {
            nextData[key] = value;
            return;
          }

          const parts = key.split('.');
          let target = nextData;
          parts.forEach((part, index) => {
            if (index === parts.length - 1) {
              target[part] = value;
              return;
            }
            target[part] = { ...(target[part] || {}) };
            target = target[part];
          });
        });
        this.data = nextData;
        if (typeof callback === 'function') {
          callback();
        }
      }
    };

    if (global.__mockCanvasContext?.drawImage) {
      global.__mockCanvasContext.drawImage.mockClear();
    }
    if (global.__mockCanvasCreateImage) {
      global.__mockCanvasCreateImage.mockClear();
    }
    if (Array.isArray(global.__mockCanvasImageSrcs)) {
      global.__mockCanvasImageSrcs.length = 0;
    }
    if (commentService.createComment) {
      commentService.createComment.mockReset();
    }
    wx.showShareMenu = wx.showShareMenu || jest.fn();
    wx.hideShareMenu = wx.hideShareMenu || jest.fn();
    wx.showShareMenu.mockClear();
    wx.hideShareMenu.mockClear();
    wx.showModal.mockClear();
    wx.showToast.mockClear();
    wx.showShareImageMenu?.mockClear();
    wx.canvasToTempFilePath?.mockClear();
  });

  afterEach(() => {
    delete global.Page;
    delete global.getApp;
    delete global.wx.env;
    delete global.wx.getFileSystemManager;
    delete global.wx.shareFileMessage;
    delete global.wx.setClipboardData;
    delete global.wx.createVideoContext;
    delete global.wx.nextTick;
  });

  test('should render markdown course content into rich-text html', () => {
    const course = pageInstance.processCourseModules({
      meditation: '',
      question: '',
      content: '# 标题\n\n- 第一条\n- 第二条\n\n**加粗**',
      reflection: '',
      action: '',
      learn: '',
      extract: '',
      say: ''
    });

    expect(course.contentVisible).toBe(true);
    expect(course.content).toContain('<strong>标题</strong>');
    expect(course.content).toContain('<ul');
    expect(course.content).toContain('<li');
    expect(course.content).toContain('<strong>加粗</strong>');
  });

  test('should keep html content compatible with rich-text', () => {
    const course = pageInstance.processCourseModules({
      meditation: '',
      question: '',
      content: '<p class="ql-align-center">正文</p><img src="https://example.com/test.png" data-id="1">',
      reflection: '',
      action: '',
      learn: '',
      extract: '',
      say: ''
    });

    expect(course.contentVisible).toBe(true);
    expect(course.content).toContain('<p>正文</p>');
    expect(course.content).toContain('alt="图片"');
    expect(course.content).toContain('style="display:block;width:100%;height:auto;margin:12px 0;border-radius:4px;"');
    expect(course.content).not.toContain('class=');
    expect(course.content).not.toContain('data-id=');
  });

  test('should share focused checkin when opened from a diary detail entry', () => {
    pageInstance.setData({
      courseId: 'section_123',
      course: {
        title: '觉察日记'
      },
      shareCheckinId: 'checkin_456',
      shareCheckinUserName: '狮子'
    });

    const shareConfig = pageInstance.onShareAppMessage.call(pageInstance);

    expect(shareConfig.title).toBe('狮子的打卡日记');
    expect(shareConfig.path).toBe('/pages/course-detail/course-detail?id=section_123&checkinId=checkin_456');
  });

  test('should top up next-day reminder before entering immersive reading', async () => {
    pageInstance.data.courseId = 'section_123';
    pageInstance.data.periodId = 'period_123';

    await pageInstance.handleImmersiveReading.call(pageInstance);

    expect(subscribeAutoTopUp.maybeAutoTopUpNextDayStudyReminder).toHaveBeenCalledWith({
      periodId: 'period_123',
      sectionId: 'section_123',
      courseId: 'section_123',
      sourcePage: 'course-detail',
      sourceAction: 'immersive_reading_click'
    });
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/reading-mode/reading-mode?id=section_123&periodId=period_123'
    });
  });

  test('should normalize closing video urls for display', () => {
    const course = pageInstance.processCourseModules({
      meditation: '',
      question: '',
      content: '',
      reflection: '',
      action: '',
      learn: '',
      extract: '',
      say: '',
      closingVideo: {
        url: '/uploads/tenants/default/closing.mp4',
        coverUrl: '/uploads/tenants/default/closing-cover.jpg',
        duration: 291
      }
    });

    expect(course.closingVideoVisible).toBe(true);
    expect(course.closingVideoUrl).toContain('/uploads/tenants/default/closing.mp4');
    expect(course.closingVideoCoverUrl).toContain('/uploads/tenants/default/closing-cover.jpg');
    expect(course.closingVideoDurationText).toBe('4:51');
    expect(course.closingVideo.url).toBe(course.closingVideoUrl);
    expect(course.closingVideo.coverUrl).toBe(course.closingVideoCoverUrl);
  });

  test('should activate closing video only after cover tap', () => {
    wx.createVideoContext = jest.fn(() => ({
      play: jest.fn()
    }));
    wx.nextTick = jest.fn(callback => callback());
    pageInstance.setData({
      closingVideoActivated: false,
      course: {
        closingVideoUrl: 'https://example.com/closing.mp4',
        closingVideoCoverUrl: 'https://example.com/closing-cover.jpg'
      }
    });

    pageInstance.handleClosingVideoPlay.call(pageInstance);

    expect(pageInstance.data.closingVideoActivated).toBe(true);
    expect(wx.createVideoContext).toHaveBeenCalledWith('closing-video-player', pageInstance);
  });

  test('should restore closing video cover when video load fails', () => {
    pageInstance.setData({
      closingVideoActivated: true,
      course: {
        closingVideoUrl: 'https://example.com/closing.mp4',
        closingVideoCoverUrl: 'https://example.com/closing-cover.jpg'
      }
    });

    pageInstance.handleClosingVideoError.call(pageInstance, { detail: { errMsg: 'fail' } });

    expect(pageInstance.data.closingVideoActivated).toBe(false);
    expect(wx.showToast).toHaveBeenCalledWith({
      title: '视频加载失败，请稍后再试',
      icon: 'none'
    });
  });

  test('should expose closing video cover load diagnostics', () => {
    pageInstance.setData({
      course: {
        closingVideoCoverUrl: 'https://example.com/closing-cover.jpg'
      }
    });

    expect(() => {
      pageInstance.handleClosingVideoCoverLoad.call(pageInstance, { detail: { width: 854, height: 480 } });
      pageInstance.handleClosingVideoCoverError.call(pageInstance, { detail: { errMsg: 'fail' } });
    }).not.toThrow();
  });

  test('should use closing video cover for normal course share', () => {
    pageInstance.setData({
      courseId: 'section_123',
      course: {
        title: '结营词',
        closingVideoCoverUrl: 'https://example.com/closing-cover.jpg'
      },
      shareCheckinId: ''
    });

    const shareConfig = pageInstance.onShareAppMessage.call(pageInstance);

    expect(shareConfig).toMatchObject({
      title: '结营词',
      path: '/pages/course-detail/course-detail?id=section_123',
      imageUrl: 'https://example.com/closing-cover.jpg'
    });
  });

  test('should share closing video with video anchor and cover', () => {
    pageInstance.setData({
      courseId: 'section_123',
      course: {
        title: '结营词',
        closingVideoVisible: true,
        closingVideoCoverUrl: 'https://example.com/closing-cover.jpg'
      }
    });

    pageInstance.handleClosingVideoShare.call(pageInstance);
    const shareConfig = pageInstance.onShareAppMessage.call(pageInstance);

    expect(shareConfig).toMatchObject({
      title: '结营视频｜结营词',
      path: '/pages/course-detail/course-detail?id=section_123&anchor=closingVideo',
      imageUrl: 'https://example.com/closing-cover.jpg'
    });
    expect(pageInstance.data.closingVideoShareMode).toBe(false);
  });

  test('should prepare checkin txt file before showing share menu and forward it on tap', async () => {
    let writtenFile = null;
    global.wx.env = { USER_DATA_PATH: '/mock-user-data' };
    global.wx.getFileSystemManager = jest.fn(() => ({
      writeFile: jest.fn(options => {
        writtenFile = options;
        options.success();
      })
    }));
    global.wx.shareFileMessage = jest.fn();
    global.wx.setClipboardData = jest.fn();

    pageInstance.setData({
      course: { title: '觉察日记' },
      shareCheckinId: 'checkin_456',
      shareCheckinUserName: '狮子',
      detailCheckin: {
        id: 'checkin_456',
        userName: '狮子',
        metaLine: '第2天打卡 | 第2个任务',
        hashTag: '#第2天 思维方式的力量',
        periodChip: '内在之光',
        dateLabel: '2026-03-29 22:11:39',
        content: '哈哈哈哈笑死我了！'
      }
    });

    await pageInstance.openCheckinShareMenu.call(pageInstance);

    const expectedFilePath = `/mock-user-data/${currentTenant.brandName}：狮子的打卡日记.txt`;
    expect(writtenFile.filePath).toBe(expectedFilePath);
    expect(writtenFile.encoding).toBe('utf8');
    expect(writtenFile.data).toContain('狮子的打卡日记');
    expect(writtenFile.data).toContain('哈哈哈哈笑死我了！');
    expect(pageInstance.data.showCheckinShareMenu).toBe(true);
    expect(pageInstance.data.checkinTextShareFilePath).toBe(expectedFilePath);

    pageInstance.handleCheckinTextShare.call(pageInstance);

    expect(global.wx.shareFileMessage).toHaveBeenCalledWith(expect.objectContaining({
      filePath: expectedFilePath,
      fileName: `${currentTenant.brandName}：狮子的打卡日记.txt`
    }));
    expect(global.wx.setClipboardData).not.toHaveBeenCalled();
  });

  test('should not copy checkin text when txt file forwarding is unavailable', () => {
    global.wx.setClipboardData = jest.fn();
    global.wx.showToast = jest.fn();

    pageInstance.setData({
      detailCheckin: {
        id: 'checkin_456',
        userName: '狮子',
        content: '哈哈哈哈笑死我了！'
      },
      checkinTextShareFilePath: '/mock-user-data/若星生活家：狮子的打卡日记.txt',
      checkinTextShareFileName: '若星生活家：狮子的打卡日记.txt',
      showCheckinShareMenu: true
    });

    pageInstance.handleCheckinTextShare.call(pageInstance);

    expect(global.wx.setClipboardData).not.toHaveBeenCalled();
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: '当前微信版本不支持txt转发',
      icon: 'none'
    });
  });

  test('should enable dynamic detail mode when opened with checkinId', () => {
    pageInstance.loadCourseDetail = jest.fn();
    wx.setNavigationBarTitle = jest.fn();

    pageInstance.onLoad.call(pageInstance, {
      id: 'section_123',
      checkinId: 'checkin_456'
    });
    pageInstance.onReady.call(pageInstance);

    expect(pageInstance.data.isCheckinDetailMode).toBe(true);
    expect(pageInstance.data.shareCheckinId).toBe('checkin_456');
    expect(pageInstance.data.canShareCurrentCheckin).toBe(true);
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({ title: '打卡详情' });
    expect(wx.showShareMenu).toHaveBeenCalled();
    expect(pageInstance.loadCourseDetail).toHaveBeenCalled();
  });

  test('should navigate to checkin detail when tapping a checkin card', () => {
    pageInstance.setData({
      courseId: 'section_123',
      isCheckinDetailMode: false,
      shareCheckinId: ''
    });

    pageInstance.handleCheckinDetailTap.call(pageInstance, {
      currentTarget: {
        dataset: {
          checkinId: 'checkin_456',
          sectionId: 'section_123'
        }
      }
    });

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/course-detail/course-detail?id=section_123&checkinId=checkin_456'
    });
  });

  test('should build single checkin detail payload for dynamic detail view', () => {
    pageInstance.setData({
      course: {
        title: '统合综效',
        day: 20,
        periodId: {
          title: '心流之境'
        },
        comments: [
          {
            id: 'checkin_456',
            userId: 'user_1',
            userName: '狮子',
            content: '真知共识如同活细胞',
            likeCount: 3,
            isLiked: true,
            replies: [
              { id: 'comment_1', content: '写得真好' }
            ],
            images: [
              'https://wx.shubai01.com/uploads/tenants/fanren/checkins/a.jpg',
              'https://wx.shubai01.com/uploads/tenants/fanren/checkins/b.jpg'
            ],
            sectionTitle: '统合综效',
            sectionDay: 20,
            checkinDate: '2025-07-04T07:09:53.000Z'
          }
        ]
      },
      isCheckinDetailMode: true,
      shareCheckinId: 'checkin_456'
    });

    pageInstance.syncDetailCheckinState.call(pageInstance);

    expect(pageInstance.data.detailCheckin).toMatchObject({
      id: 'checkin_456',
      metaLine: '第20天打卡 | 第20个任务',
      hashTag: '#第20天 统合综效',
      periodChip: '心流之境',
      commentCount: 1,
      images: [
        'https://wx.shubai01.com/uploads/tenants/fanren/checkins/a.jpg',
        'https://wx.shubai01.com/uploads/tenants/fanren/checkins/b.jpg'
      ]
    });
    expect(pageInstance.data.detailCheckin.dateLabel).toBe('2025-07-04 15:09:53');
  });

  test('should share selected poster image to WeChat friend', () => {
    pageInstance.setData({
      selectedPoster: {
        tempFilePath: 'wxfile://selected-poster.png'
      }
    });

    pageInstance.handleShareSelectedPoster.call(pageInstance);

    expect(wx.showShareImageMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'wxfile://selected-poster.png'
      })
    );
  });

  test('should show toast when poster image sharing is unavailable', () => {
    const originalShowShareImageMenu = wx.showShareImageMenu;
    delete wx.showShareImageMenu;
    pageInstance.setData({
      selectedPoster: {
        tempFilePath: 'wxfile://selected-poster.png'
      }
    });

    pageInstance.handleShareSelectedPoster.call(pageInstance);

    expect(wx.showToast).toHaveBeenCalledWith({
      title: '当前微信版本不支持图片分享',
      icon: 'none'
    });

    wx.showShareImageMenu = originalShowShareImageMenu;
  });

  test('should allow sharing for other users detail checkin', () => {
    pageInstance.setData({
      course: {
        comments: [
          {
            id: 'checkin_999',
            userId: 'user_other',
            userName: '陌生人',
            content: '这是别人的小凡看见'
          }
        ]
      },
      isCheckinDetailMode: true,
      shareCheckinId: 'checkin_999'
    });

    pageInstance.syncDetailCheckinState.call(pageInstance);

    expect(pageInstance.data.detailCheckin.canShare).toBe(true);
    expect(pageInstance.data.canShareCurrentCheckin).toBe(true);
    expect(wx.showShareMenu).toHaveBeenCalled();
    expect(wx.hideShareMenu).not.toHaveBeenCalled();
  });

  test('should mark long checkin content as expandable and toggle expanded state', () => {
    const longCheckin = pageInstance.buildCheckinItem.call(pageInstance, {
      _id: 'checkin_long',
      userId: 'user_fox',
      note: '这是很长的打卡内容'.repeat(20)
    });

    pageInstance.setData({
      course: {
        comments: [longCheckin]
      }
    });

    expect(longCheckin.canExpandContent).toBe(true);
    expect(longCheckin.contentExpanded).toBe(false);

    pageInstance.toggleCheckinContent.call(pageInstance, {
      currentTarget: {
        dataset: {
          checkinId: 'checkin_long'
        }
      }
    });

    expect(pageInstance.data.course.comments[0].contentExpanded).toBe(true);
  });

  test('should build poster snapshot from detail checkin data', () => {
    const snapshot = pageInstance.buildPosterSnapshot.call(pageInstance, {
      userName: '狮子',
      content: '第一段内容\n第二段内容',
      hashTag: '#第20天 统合综效',
      periodChip: '心流之境',
      dateLabel: '2025-07-04 15:09:53',
      sectionTitle: '统合综效',
      likeCount: 4,
      commentCount: 2
    });

    expect(snapshot.width).toBe(1040);
    expect(snapshot.height).toBeGreaterThanOrEqual(900);
    expect(snapshot.titleLines[0]).toContain('狮子的打卡日记');
    expect(snapshot.contentLines).toContain('第一段内容');
    expect(snapshot.contentTruncated).toBe(false);
    expect(snapshot.tagLines[0]).toBe('#第20天 统合综效');
    expect(snapshot.statsLine).toBe('获赞 4 · 评论 2');
    expect(snapshot.miniProgramCodePath).toBe('/assets/images/mini-program-code.jpg');
  });

  test('should keep oversized poster content complete by default', () => {
    const content = Array.from({ length: 180 }, (_, index) => `第${index + 1}句很长的打卡正文`).join('，');

    const snapshot = pageInstance.buildPosterSnapshot.call(pageInstance, {
      userName: '狮子',
      content,
      hashTag: '#第3天 第三天 以原则为中心的思维方式',
      periodChip: '秩序之锚 - 七个习惯晨读营',
      dateLabel: '2026-05-12 10:41:25',
      sectionTitle: '第三天 以原则为中心的思维方式'
    });

    expect(snapshot.height).toBeGreaterThan(2400);
    expect(snapshot.contentTruncated).toBe(false);
    expect(snapshot.contentLines).not.toContain('进入小程序查看完整内容');
  });

  test('should truncate oversized poster content only for fallback poster', () => {
    const content = Array.from({ length: 180 }, (_, index) => `第${index + 1}句很长的打卡正文`).join('，');

    const snapshot = pageInstance.buildPosterSnapshot.call(
      pageInstance,
      {
        userName: '狮子',
        content,
        hashTag: '#第3天 第三天 以原则为中心的思维方式',
        periodChip: '秩序之锚 - 七个习惯晨读营',
        dateLabel: '2026-05-12 10:41:25',
        sectionTitle: '第三天 以原则为中心的思维方式'
      },
      undefined,
      { maxHeight: 2400 }
    );

    expect(snapshot.height).toBeLessThanOrEqual(2400);
    expect(snapshot.contentTruncated).toBe(true);
    expect(snapshot.contentLines).toContain('进入小程序查看完整内容');
  });

  test('should draw mini program qr code into poster canvas', async () => {
    await pageInstance.generateLongImagePoster.call(pageInstance, {
      userName: '狮子',
      content: '测试正文',
      hashTag: '#第20天 统合综效',
      periodChip: '心流之境',
      dateLabel: '2025-07-04 15:09:53',
      sectionTitle: '统合综效',
      likeCount: 1,
      commentCount: 0
    });

    expect(global.__mockCanvasCreateImage).toHaveBeenCalled();
    expect(global.__mockCanvasImageSrcs).toContain('/assets/images/mini-program-code.jpg');
    expect(global.__mockCanvasContext.drawImage).toHaveBeenCalled();
  });

  test('should retry poster export with lower scale after timeout', async () => {
    wx.canvasToTempFilePath
      .mockImplementationOnce((options) => {
        options.fail({ errMsg: 'canvasToTempFilePath:fail timeout' });
      })
      .mockImplementationOnce((options) => {
        options.success({ tempFilePath: '/tmp/retry-poster.png' });
      });

    const tempFilePath = await pageInstance.exportPosterCanvasToTempFilePath.call(
      pageInstance,
      {},
      {
        width: 1040,
        height: 1480
      }
    );

    expect(tempFilePath).toBe('/tmp/retry-poster.png');
    expect(wx.canvasToTempFilePath).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        destWidth: 2080,
        destHeight: 2960
      })
    );
    expect(wx.canvasToTempFilePath).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        destWidth: 1560,
        destHeight: 2220
      })
    );
  });

  test('should create all poster template entries and generate the first one', async () => {
    pageInstance.generateLongImagePoster = jest
      .fn()
      .mockResolvedValueOnce('/tmp/poster-1.png');

    const galleryItems = await pageInstance.generatePosterGallery.call(pageInstance, {
      id: 'checkin_123',
      userName: '狮子',
      content: '测试正文'
    });

    expect(pageInstance.generateLongImagePoster).toHaveBeenCalledTimes(1);
    expect(galleryItems.map(item => item.name)).toEqual(['青岚', '暮紫', '晴空', '留白']);
    expect(galleryItems.map(item => item.tempFilePath)).toEqual([
      '/tmp/poster-1.png',
      '',
      '',
      ''
    ]);
  });

  test('should fall back to clipped poster when first template export fails', async () => {
    pageInstance.generateLongImagePoster = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('/tmp/poster-fallback.png');

    const galleryItems = await pageInstance.generatePosterGallery.call(pageInstance, {
      id: 'checkin_123',
      userName: '狮子',
      content: '测试正文'
    });

    expect(pageInstance.generateLongImagePoster).toHaveBeenCalledTimes(2);
    expect(pageInstance.generateLongImagePoster).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'checkin_123' }),
      expect.objectContaining({ id: 'aurora' }),
      { maxHeight: 2400 }
    );
    expect(galleryItems.map(item => item.tempFilePath)).toEqual([
      '/tmp/poster-fallback.png',
      '',
      '',
      ''
    ]);
  });

  test('should generate selected poster template on demand', async () => {
    pageInstance.generateLongImagePoster = jest
      .fn()
      .mockResolvedValueOnce('/tmp/poster-lilac.png');
    pageInstance.setData({
      detailCheckin: {
        id: 'checkin_123',
        userName: '狮子',
        content: '测试正文'
      },
      posterGalleryItems: [
        { id: 'aurora', name: '青岚', tempFilePath: '/tmp/poster-1.png', generated: true },
        { id: 'lilac', name: '暮紫', tempFilePath: '', generated: false },
        { id: 'sky', name: '晴空', tempFilePath: '', generated: false },
        { id: 'paper', name: '留白', tempFilePath: '', generated: false }
      ]
    });

    await pageInstance.handlePosterTemplateSelect.call(pageInstance, {
      currentTarget: {
        dataset: {
          index: 1
        }
      }
    });

    expect(pageInstance.generateLongImagePoster).toHaveBeenCalledTimes(1);
    expect(pageInstance.generateLongImagePoster).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'checkin_123' }),
      expect.objectContaining({ id: 'lilac' })
    );
    expect(pageInstance.data.posterSelectedIndex).toBe(1);
    expect(pageInstance.data.selectedPoster).toMatchObject({
      id: 'lilac',
      tempFilePath: '/tmp/poster-lilac.png',
      generated: true
    });
  });

  test('should show toast when generating long image without detail checkin', () => {
    pageInstance.handleLongImageShare.call(pageInstance);

    expect(wx.showToast).toHaveBeenCalledWith({
      title: '暂无可生成的内容',
      icon: 'none'
    });
  });

  test('should generate poster gallery panel when detail checkin exists', async () => {
    pageInstance.generatePosterGallery = jest.fn(() => Promise.resolve([
      { id: 'aurora', name: '青岚', tempFilePath: '/tmp/poster-1.png' },
      { id: 'lilac', name: '暮紫', tempFilePath: '/tmp/poster-2.png' }
    ]));
    pageInstance.setData({
      detailCheckin: {
        id: 'checkin_123',
        userName: '狮子',
        content: '测试正文'
      }
    });

    pageInstance.handleLongImageShare.call(pageInstance);
    await Promise.resolve();
    await Promise.resolve();

    expect(pageInstance.generatePosterGallery).toHaveBeenCalledWith({
      id: 'checkin_123',
      userName: '狮子',
      content: '测试正文'
    });
    expect(pageInstance.data.posterGalleryVisible).toBe(true);
    expect(pageInstance.data.posterGalleryItems).toHaveLength(2);
    expect(pageInstance.data.selectedPoster).toMatchObject({
      id: 'aurora',
      tempFilePath: '/tmp/poster-1.png'
    });
  });

  test('should keep local comment avatar text aligned with author avatar rule', async () => {
    commentService.createComment.mockResolvedValue({
      _id: 'comment_1'
    });
    wx.showModal.mockImplementation(({ success }) => {
      success({
        confirm: true,
        content: '哈哈哈[偷笑]'
      });
    });
    pageInstance.triggerAutoTopUp = jest.fn();
    pageInstance._requireInteraction = jest.fn(() => true);
    pageInstance.setData({
      communityAccessState: 'enabled',
      course: {
        comments: [
          {
            id: 'checkin_1',
            userName: '小狐狸',
            replies: []
          }
        ]
      }
    });

    await pageInstance.handleReplyComment.call(pageInstance, {
      currentTarget: {
        dataset: {
          id: 'checkin_1'
        }
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(commentService.createComment).toHaveBeenCalledWith({
      checkinId: 'checkin_1',
      content: '哈哈哈🤭'
    });
    expect(pageInstance.data.course.comments[0].replies[0]).toMatchObject({
      userName: '小狐狸',
      content: '哈哈哈🤭',
      avatarText: '狸',
      avatarUrl: '',
      avatarColor: getAvatarColorByUserId('user_fox')
    });
  });

  test('should use stable avatar color rule for checkin author and comments', () => {
    const checkinItem = pageInstance.buildCheckinItem.call(pageInstance, {
      _id: 'checkin_1',
      content: '今天很开心[庆祝]',
      images: ['https://wx.shubai01.com/uploads/tenants/fanren/checkins/a.jpg'],
      userId: {
        _id: 'user_fox',
        nickname: '小狐狸',
        avatarUrl: ''
      }
    });

    expect(checkinItem.avatarColor).toBe(getAvatarColorByUserId('user_fox'));
    expect(checkinItem.content).toBe('今天很开心🎉');
    expect(checkinItem.images).toEqual(['https://wx.shubai01.com/uploads/tenants/fanren/checkins/a.jpg']);
    expect(checkinItem.imageCount).toBe(1);
  });

  test('should preserve rich text html for checkin display', () => {
    const checkinItem = pageInstance.buildCheckinItem.call(pageInstance, {
      _id: 'checkin_rich',
      note: '要事第一：把注意力交还给生命主轴',
      contentHtml: '<p><strong>要事第一</strong>：<span style="color:#4a90e2">把注意力交还给生命主轴</span></p>',
      userId: {
        _id: 'user_fox',
        nickname: '小狐狸',
        avatarUrl: ''
      }
    });

    expect(checkinItem.content).toBe('要事第一：把注意力交还给生命主轴');
    expect(checkinItem.contentHtml).toContain('<strong>要事第一</strong>');
    expect(checkinItem.contentHtml).toContain('color:#4a90e2');
    expect(checkinItem.hasRichContent).toBe(true);
  });

  test('should use plain text highlight instead of rich html in checkin search mode', () => {
    pageInstance.setData({ searchKeyword: '注意力' });

    const checkinItem = pageInstance.buildCheckinItem.call(pageInstance, {
      _id: 'checkin_search',
      note: '要事第一：把注意力交还给生命主轴',
      contentHtml: '<p><strong>要事第一</strong>：<span style="color:#4a90e2">把注意力交还给生命主轴</span></p>'
    });

    expect(checkinItem.contentHtml).toContain('background:#fff3b0');
    expect(checkinItem.contentHtml).not.toContain('color:#4a90e2');
  });

  test('should preview all images from selected checkin', () => {
    pageInstance.setData({
      course: {
        comments: [
          {
            id: 'checkin_1',
            images: [
              'https://wx.shubai01.com/uploads/tenants/fanren/checkins/a.jpg',
              'https://wx.shubai01.com/uploads/tenants/fanren/checkins/b.jpg'
            ]
          }
        ]
      }
    });

    pageInstance.handleCheckinImagePreview.call(pageInstance, {
      currentTarget: {
        dataset: {
          checkinId: 'checkin_1',
          url: 'https://wx.shubai01.com/uploads/tenants/fanren/checkins/b.jpg'
        }
      }
    });

    expect(wx.previewImage).toHaveBeenCalledWith({
      current: 'https://wx.shubai01.com/uploads/tenants/fanren/checkins/b.jpg',
      urls: [
        'https://wx.shubai01.com/uploads/tenants/fanren/checkins/a.jpg',
        'https://wx.shubai01.com/uploads/tenants/fanren/checkins/b.jpg'
      ],
      showmenu: true
    });
  });
});
