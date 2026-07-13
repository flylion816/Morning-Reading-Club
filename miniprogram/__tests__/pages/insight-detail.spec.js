jest.mock('../../services/insight.service', () => ({}));
jest.mock('../../pages/insight-detail/danmaku.service', () => ({
  postDanmaku: jest.fn()
}));
jest.mock('../../services/activity.service', () => ({
  track: jest.fn(() => Promise.resolve())
}));
jest.mock('../../utils/require-login', () => ({
  requireLogin: jest.fn(() => true)
}));
jest.mock('../../config/env', () => ({
  currentEnv: 'test'
}));

const currentTenant = require('../../config/current-tenant');

describe('insight-detail poster rendering', () => {
  let pageConfig;
  let pageInstance;
  let danmakuService;

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
          _id: 'user_1',
          nickname: '测试用户'
        }
      }
    }));

    danmakuService = require('../../pages/insight-detail/danmaku.service');
    danmakuService.postDanmaku.mockReset();
    danmakuService.postDanmaku.mockResolvedValue({
      _id: 'danmaku_1',
      content: '笑死🤦',
      type: 'comment'
    });

    require('../../pages/insight-detail/insight-detail');
    pageInstance = {
      ...pageConfig,
      data: JSON.parse(JSON.stringify(pageConfig.data)),
      setData(update) {
        this.data = {
          ...this.data,
          ...update
        };
      }
    };
  });

  afterEach(() => {
    delete global.Page;
    delete global.getApp;
    delete global.wx.env;
    delete global.wx.getFileSystemManager;
    delete global.wx.shareFileMessage;
    delete global.wx.setClipboardData;
  });

  test('should keep list items when poster content mixes paragraphs and lists', () => {
    const paragraphs = pageInstance._parseHtmlToParagraphs.call(
      pageInstance,
      '<p>第一段</p><ul><li>第一条</li><li><strong>第二条</strong></li></ul><p>最后一段</p>'
    );

    expect(paragraphs).toHaveLength(4);
    expect(paragraphs.map(item => item.runs.map(run => run.text).join(''))).toEqual([
      '第一段',
      '• 第一条',
      '• 第二条',
      '最后一段'
    ]);
    expect(paragraphs[2].runs).toEqual([
      { text: '• ', bold: false },
      { text: '第二条', bold: true }
    ]);
  });

  test('should preserve paragraph breaks inside rich text wrappers', () => {
    const paragraphs = pageInstance._parseHtmlToParagraphs.call(
      pageInstance,
      '<div><p>第一段</p><p><strong>第二段</strong></p></div>'
    );

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.map(item => item.runs.map(run => run.text).join(''))).toEqual([
      '第一段',
      '第二段'
    ]);
    expect(paragraphs[1].runs).toEqual([
      { text: '第二段', bold: true }
    ]);
  });

  test('should wrap before appending an overflowing styled run', () => {
    const ctx = {
      font: '',
      measureText: jest.fn(text => ({
        width: String(text || '').length * 3
      }))
    };

    const lines = pageInstance._wrapRunsForCanvas.call(
      pageInstance,
      ctx,
      [
        { text: 'abc', bold: false },
        { text: 'Z', bold: true }
      ],
      10,
      '28px sans-serif',
      'bold 28px sans-serif'
    );

    expect(lines).toEqual([
      [{ text: 'abc', bold: false }],
      [{ text: 'Z', bold: true }]
    ]);
  });

  test('should build plain text content for txt sharing', () => {
    const content = pageInstance.buildTextShareContent.call(pageInstance, {
      title: '第七天 积极主动的定义',
      periodName: '秩序之锚',
      content: '<p>第一段<strong>重点</strong></p><p>第二段&amp;符号</p>'
    });

    expect(content).toContain('第七天 积极主动的定义 - 致晨读者');
    expect(content).toContain('秩序之锚');
    expect(content).toContain('第一段重点');
    expect(content).toContain('第二段&符号');
    expect(content).toContain(`By 小凡@${currentTenant.brandName}`);
  });

  test('should sanitize txt share file names', () => {
    const fileName = pageInstance.getTextShareFileName.call(pageInstance, {
      title: '第七天: 积极/主动*定义?'
    });

    expect(fileName).toBe('小凡看见：第七天积极主动定义-致晨读者.txt');
  });

  test('should prepare a txt file before showing the share menu and forward it on tap', async () => {
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
      insight: {
        title: '第七天 积极主动的定义',
        periodName: '秩序之锚',
        content: '<p>分享正文</p>'
      },
      showShareModal: false
    });

    await pageInstance.openShareMenu.call(pageInstance);

    expect(writtenFile.filePath).toBe('/mock-user-data/小凡看见：第七天积极主动的定义-致晨读者.txt');
    expect(writtenFile.encoding).toBe('utf8');
    expect(writtenFile.data).toContain('分享正文');
    expect(pageInstance.data.showShareModal).toBe(true);
    expect(pageInstance.data.textShareFilePath).toBe('/mock-user-data/小凡看见：第七天积极主动的定义-致晨读者.txt');

    pageInstance.handleTextShare.call(pageInstance);

    expect(global.wx.shareFileMessage).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/mock-user-data/小凡看见：第七天积极主动的定义-致晨读者.txt',
      fileName: '小凡看见：第七天积极主动的定义-致晨读者.txt'
    }));
    expect(global.wx.setClipboardData).not.toHaveBeenCalled();
  });

  test('should not copy text when txt file forwarding is unavailable', () => {
    global.wx.setClipboardData = jest.fn();
    global.wx.showToast = jest.fn();

    pageInstance.setData({
      insight: {
        title: '第七天 积极主动的定义',
        content: '<p>分享正文</p>'
      },
      showShareModal: true
    });

    pageInstance.handleTextShare.call(pageInstance);

    expect(global.wx.setClipboardData).not.toHaveBeenCalled();
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: '当前微信版本不支持txt转发',
      icon: 'none'
    });
  });

  test('should normalize WeChat emoji tokens before sending danmaku', async () => {
    pageInstance.setData({
      insightId: 'insight_1',
      danmakuColor: '#4a90e2'
    });

    pageInstance.onDanmakuInput.call(pageInstance, {
      detail: { value: '笑死[捂脸]' }
    });
    await pageInstance.sendDanmaku.call(pageInstance);

    expect(danmakuService.postDanmaku).toHaveBeenCalledWith('insight_1', expect.objectContaining({
      content: '笑死🤦'
    }));
    expect(pageInstance.data.danmakuInput).toBe('');
  });
});
