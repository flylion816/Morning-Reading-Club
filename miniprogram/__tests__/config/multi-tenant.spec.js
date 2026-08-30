/**
 * 多租户架构测试 — 构建时注入
 *
 * 覆盖范围:
 * [MT-1] config/tenants/_schema.js  — 字段校验逻辑
 * [MT-2] utils/subscribe-auto-topup — templateId 来自 currentTenant.subscribeTemplates
 * [MT-3] utils/storage.tenantStorage — key 前缀来自 currentTenant.wxAppId
 * [MT-4] utils/request              — X-Wx-AppId header 来自 currentTenant.wxAppId
 *
 * 对依赖 currentTenant 的模块使用 jest.isolateModules() + jest.doMock()
 * 每次隔离加载得到独立的模块实例，不污染其他测试。
 */

const { validateTenant } = require('../../config/tenants/_schema');
const committedTenant = require('../../config/current-tenant');
const committedProjectConfig = require('../../../project.config.json');

const VALID_CONFIG = {
  slug: 'fanren',
  brandName: '凡人共读',
  wxAppId: 'wx2b9a3c1d5e4195f8',
  cloudEnv: 'cloudbase-abc123',
  primaryColor: '#4a90e2',
  logo: '/assets/tenants/fanren/logo.png',
  navBar: { title: '凡人共读', bgColor: '#4a90e2', textStyle: 'white' },
  tabBar: { color: '#999', selectedColor: '#4a90e2', backgroundColor: '#fff', iconsDir: '/assets/tenants/fanren' },
  legalEntity: '凡人共读 团队',
  contactEmail: 'support@fanren.club',
  wechatSIPlugin: true,
  subscribeTemplates: { enrollment_result: 'TPL_001' },
  apiBaseUrl: null
};

describe('[MT-0] 仓库默认租户构建态', () => {
  test('提交到仓库的默认配置保持为 fanren', () => {
    expect(committedTenant.slug).toBe('fanren');
    expect(committedTenant.wxAppId).toBe(VALID_CONFIG.wxAppId);
    expect(committedTenant.cloudEnv).toBeNull();
    expect(committedProjectConfig.appid).toBe(VALID_CONFIG.wxAppId);
  });
});

// ─────────────────────────────────────────────────────────
// MT-1: 校验逻辑
// ─────────────────────────────────────────────────────────
describe('[MT-1] _schema.js 配置校验', () => {
  test('合法配置零错误', () => {
    expect(validateTenant(VALID_CONFIG)).toEqual([]);
  });

  test('缺少必填字段 wxAppId 报缺失错误', () => {
    const { wxAppId: _omit, ...cfg } = VALID_CONFIG;
    const errors = validateTenant(cfg);
    expect(errors.some(e => e.includes('wxAppId'))).toBe(true);
  });

  test('wxAppId 不以 wx 开头报格式错误', () => {
    const errors = validateTenant({ ...VALID_CONFIG, wxAppId: 'ab1234567890abcdef' });
    expect(errors.some(e => e.includes('wxAppId'))).toBe(true);
  });

  test('wxAppId 长度不足 18 位报格式错误', () => {
    const errors = validateTenant({ ...VALID_CONFIG, wxAppId: 'wx12345' });
    expect(errors.some(e => e.includes('wxAppId'))).toBe(true);
  });

  test('primaryColor 非 #RRGGBB 格式报格式错误', () => {
    const errors = validateTenant({ ...VALID_CONFIG, primaryColor: 'blue' });
    expect(errors.some(e => e.includes('primaryColor'))).toBe(true);
  });

  test('navBar.textStyle 不在 white/black 白名单内报错', () => {
    const errors = validateTenant({
      ...VALID_CONFIG,
      navBar: { ...VALID_CONFIG.navBar, textStyle: 'gray' }
    });
    expect(errors.some(e => e.includes('navBar'))).toBe(true);
  });

  test('tabBar 缺少 iconsDir 报格式错误', () => {
    const errors = validateTenant({
      ...VALID_CONFIG,
      tabBar: { color: '#999', selectedColor: '#4a90e2', backgroundColor: '#fff' }
    });
    expect(errors.some(e => e.includes('tabBar'))).toBe(true);
  });

  test('logo 路径不以 /assets/ 开头报格式错误', () => {
    const errors = validateTenant({ ...VALID_CONFIG, logo: 'logo.png' });
    expect(errors.some(e => e.includes('logo'))).toBe(true);
  });

  test('cloudEnv 为 null 不报错（可选字段）', () => {
    const errors = validateTenant({ ...VALID_CONFIG, cloudEnv: null });
    expect(errors.filter(e => e.includes('cloudEnv'))).toHaveLength(0);
  });

  test('contactEmail 为 null 不报错（可选字段）', () => {
    const errors = validateTenant({ ...VALID_CONFIG, contactEmail: null });
    expect(errors.filter(e => e.includes('contactEmail'))).toHaveLength(0);
  });

  test('wechatSIPlugin 为布尔值或缺省不报错，非布尔值报错', () => {
    expect(validateTenant({ ...VALID_CONFIG, wechatSIPlugin: true })).toEqual([]);
    expect(validateTenant({ ...VALID_CONFIG, wechatSIPlugin: false })).toEqual([]);

    const { wechatSIPlugin: _omit, ...withoutPluginConfig } = VALID_CONFIG;
    expect(validateTenant(withoutPluginConfig)).toEqual([]);

    const errors = validateTenant({ ...VALID_CONFIG, wechatSIPlugin: 'true' });
    expect(errors.some(e => e.includes('wechatSIPlugin'))).toBe(true);
  });

  test('多个字段同时非法时返回多条错误', () => {
    const errors = validateTenant({
      ...VALID_CONFIG,
      wxAppId: 'bad',
      primaryColor: 'bad',
      logo: 'bad'
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  test('subscribeTemplates 必填，为 null 时报错', () => {
    const errors = validateTenant({ ...VALID_CONFIG, subscribeTemplates: null });
    expect(errors.some(e => e.includes('subscribeTemplates'))).toBe(true);
  });

  test('slug 含大写字母报格式错误', () => {
    const errors = validateTenant({ ...VALID_CONFIG, slug: 'FanRen' });
    expect(errors.some(e => e.includes('slug'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// MT-2: subscribe-auto-topup templateId 注入
// ─────────────────────────────────────────────────────────
describe('[MT-2] subscribe-auto-topup: templateId 来自 currentTenant', () => {
  test('AUTO_TOP_UP_POLICIES 的所有 templateId 来自 subscribeTemplates', () => {
    let AUTO_TOP_UP_POLICIES;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        wxAppId: 'wx1234567890abcdef',
        cloudEnv: null,
        subscribeTemplates: {
          enrollment_result:        'FAKE_ENROLL',
          payment_result:           'FAKE_PAYMENT',
          comment_received:         'FAKE_COMMENT',
          like_received:            'FAKE_LIKE',
          danmaku_received:         'FAKE_DANMAKU',
          insight_liked:            'FAKE_INSIGHT_LIKED',
          insight_request_created:  'FAKE_IRC',
          insight_request_approved: 'FAKE_IRA',
          next_day_study_reminder:  'FAKE_NEXT_DAY',
          insight_created:          'FAKE_IC',
          podcast_published:        'FAKE_PODCAST'
        }
      }));
      jest.doMock('../../services/subscribe-message.service', () => ({
        getSettings: jest.fn(),
        saveGrants: jest.fn()
      }));
      ({ AUTO_TOP_UP_POLICIES } = require('../../utils/subscribe-auto-topup'));
    });

    expect(AUTO_TOP_UP_POLICIES.enrollment_result.templateId).toBe('FAKE_ENROLL');
    expect(AUTO_TOP_UP_POLICIES.payment_result.templateId).toBe('FAKE_PAYMENT');
    expect(AUTO_TOP_UP_POLICIES.comment_received.templateId).toBe('FAKE_COMMENT');
    expect(AUTO_TOP_UP_POLICIES.like_received.templateId).toBe('FAKE_LIKE');
    expect(AUTO_TOP_UP_POLICIES.danmaku_received.templateId).toBe('FAKE_DANMAKU');
    expect(AUTO_TOP_UP_POLICIES.insight_liked.templateId).toBe('FAKE_INSIGHT_LIKED');
    expect(AUTO_TOP_UP_POLICIES.insight_request_created.templateId).toBe('FAKE_IRC');
    expect(AUTO_TOP_UP_POLICIES.insight_request_approved.templateId).toBe('FAKE_IRA');
    expect(AUTO_TOP_UP_POLICIES.next_day_study_reminder.templateId).toBe('FAKE_NEXT_DAY');
    expect(AUTO_TOP_UP_POLICIES.insight_created.templateId).toBe('FAKE_IC');
    expect(AUTO_TOP_UP_POLICIES.podcast_published.templateId).toBe('FAKE_PODCAST');
  });

  test('subscribeTemplates 为空对象时 templateId 降级为空字符串，不崩溃', () => {
    let AUTO_TOP_UP_POLICIES;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        wxAppId: 'wx1234567890abcdef',
        cloudEnv: null,
        subscribeTemplates: {}
      }));
      jest.doMock('../../services/subscribe-message.service', () => ({
        getSettings: jest.fn(),
        saveGrants: jest.fn()
      }));
      ({ AUTO_TOP_UP_POLICIES } = require('../../utils/subscribe-auto-topup'));
    });

    expect(AUTO_TOP_UP_POLICIES.enrollment_result.templateId).toBe('');
    expect(AUTO_TOP_UP_POLICIES.comment_received.templateId).toBe('');
    expect(AUTO_TOP_UP_POLICIES.next_day_study_reminder.templateId).toBe('');
  });

  test('切换租户后 templateId 跟随变化（两个独立实例互不干扰）', () => {
    let policiesA, policiesB;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        wxAppId: 'wx1111111111111111',
        subscribeTemplates: { enrollment_result: 'TPL_TENANT_A' }
      }));
      jest.doMock('../../services/subscribe-message.service', () => ({
        getSettings: jest.fn(), saveGrants: jest.fn()
      }));
      ({ AUTO_TOP_UP_POLICIES: policiesA } = require('../../utils/subscribe-auto-topup'));
    });
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        wxAppId: 'wx2222222222222222',
        subscribeTemplates: { enrollment_result: 'TPL_TENANT_B' }
      }));
      jest.doMock('../../services/subscribe-message.service', () => ({
        getSettings: jest.fn(), saveGrants: jest.fn()
      }));
      ({ AUTO_TOP_UP_POLICIES: policiesB } = require('../../utils/subscribe-auto-topup'));
    });

    expect(policiesA.enrollment_result.templateId).toBe('TPL_TENANT_A');
    expect(policiesB.enrollment_result.templateId).toBe('TPL_TENANT_B');
  });
});

// ─────────────────────────────────────────────────────────
// MT-2B: brand helper 文案来自 currentTenant
// ─────────────────────────────────────────────────────────
describe('[MT-2B] brand helper: 品牌文案来自 currentTenant', () => {
  test('默认分享标题和品牌名跟随当前租户', () => {
    let brand;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        brandName: '若星生活家',
        shareCover: '/assets/tenants/starry/share-cover.jpg',
        navBar: { title: '若星生活家' }
      }));
      brand = require('../../utils/brand');
    });

    expect(brand.getBrandName()).toBe('若星生活家');
    expect(brand.getDefaultShareTitle()).toBe('若星生活家｜每日晨读');
    expect(brand.getDefaultShareImage()).toBe('/assets/tenants/starry/share-cover.jpg');
    expect(brand.getBrandedTitle('平衡之道')).toBe('平衡之道 - 若星生活家');
  });

  test('缺少 brandName 时使用 navBar.title 兜底', () => {
    let brand;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        navBar: { title: '凡人共读' }
      }));
      brand = require('../../utils/brand');
    });

    expect(brand.getBrandName()).toBe('凡人共读');
    expect(brand.getDefaultShareImage()).toBe('/assets/images/share-default.jpg');
  });
});

// ─────────────────────────────────────────────────────────
// MT-3: tenantStorage key 前缀
// ─────────────────────────────────────────────────────────
describe('[MT-3] tenantStorage: key 前缀来自 currentTenant.wxAppId', () => {
  beforeEach(() => {
    global.wx.__storage = {};
    global.wx.setStorageSync.mockImplementation((key, val) => {
      global.wx.__storage[key] = val;
    });
    global.wx.getStorageSync.mockImplementation(key => {
      const val = global.wx.__storage[key];
      return (val !== undefined && val !== null && val !== '') ? val : null;
    });
    global.wx.removeStorageSync.mockImplementation(key => {
      delete global.wx.__storage[key];
    });
  });

  test('set/get 的 key 带 wxAppId 前缀', () => {
    let tenantStorage;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({ wxAppId: 'wxAABBCCDDEEFF0011' }));
      ({ tenantStorage } = require('../../utils/storage'));
    });

    tenantStorage.set('token', 'tok123');
    expect(global.wx.__storage['wxAABBCCDDEEFF0011:token']).toBe('tok123');
    expect(tenantStorage.get('token')).toBe('tok123');
  });

  test('无前缀的裸 key 取不到带前缀存入的值', () => {
    let tenantStorage;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({ wxAppId: 'wxAABBCCDDEEFF0011' }));
      ({ tenantStorage } = require('../../utils/storage'));
    });

    tenantStorage.set('userInfo', { _id: 'u1' });
    expect(global.wx.__storage['userInfo']).toBeUndefined();
  });

  test('不同 wxAppId 的 tenantStorage 互相隔离', () => {
    let storageA, storageB;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({ wxAppId: 'wxAAAAAAAAAAAAAAAA' }));
      ({ tenantStorage: storageA } = require('../../utils/storage'));
    });
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({ wxAppId: 'wxBBBBBBBBBBBBBBBB' }));
      ({ tenantStorage: storageB } = require('../../utils/storage'));
    });

    storageA.set('user', 'userA');
    expect(storageB.get('user')).toBeNull();
    expect(storageA.get('user')).toBe('userA');
  });

  test('旧版无前缀 key 被自动迁移到带前缀 key', () => {
    let tenantStorage;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({ wxAppId: 'wxMIGRATE12345678' }));
      ({ tenantStorage } = require('../../utils/storage'));
    });

    global.wx.__storage['userInfo'] = { _id: 'legacy_user' };

    const val = tenantStorage.get('userInfo');
    expect(val).toEqual({ _id: 'legacy_user' });
    expect(global.wx.__storage['wxMIGRATE12345678:userInfo']).toEqual({ _id: 'legacy_user' });
    expect(global.wx.__storage['userInfo']).toBeUndefined();
  });

  test('remove 同时清除带前缀和无前缀的 key', () => {
    let tenantStorage;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({ wxAppId: 'wxREMOVETEST123456' }));
      ({ tenantStorage } = require('../../utils/storage'));
    });

    global.wx.__storage['wxREMOVETEST123456:token'] = 'tok';
    global.wx.__storage['token'] = 'old_tok';

    tenantStorage.remove('token');

    expect(global.wx.__storage['wxREMOVETEST123456:token']).toBeUndefined();
    expect(global.wx.__storage['token']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────
// MT-4: request X-Wx-AppId header
// ─────────────────────────────────────────────────────────
describe('[MT-4] request: X-Wx-AppId header 来自 currentTenant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.wx.__storage = {};
    global.wx.request.mockImplementation(options => {
      setTimeout(() => {
        options.success?.({ statusCode: 200, data: { code: 200, data: {} } });
      }, 10);
    });
  });

  test('每次请求 header 包含 currentTenant.wxAppId', async () => {
    let req;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        wxAppId: 'wxREQTEST1234abcd',
        apiBaseUrl: null
      }));
      req = require('../../utils/request');
    });

    await req.get('/api/test');
    const { header } = global.wx.request.mock.calls[0][0];
    expect(header['X-Wx-AppId']).toBe('wxREQTEST1234abcd');
  });

  test('切换租户后请求携带新 wxAppId', async () => {
    let reqA, reqB;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        wxAppId: 'wxTENANTA12345678', apiBaseUrl: null
      }));
      reqA = require('../../utils/request');
    });
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        wxAppId: 'wxTENANTB12345678', apiBaseUrl: null
      }));
      reqB = require('../../utils/request');
    });

    await reqA.get('/api/test');
    expect(global.wx.request.mock.calls[0][0].header['X-Wx-AppId']).toBe('wxTENANTA12345678');

    global.wx.request.mockClear();

    await reqB.get('/api/test');
    expect(global.wx.request.mock.calls[0][0].header['X-Wx-AppId']).toBe('wxTENANTB12345678');
  });

  test('上传接口 header 也携带 currentTenant.wxAppId', async () => {
    let req;
    jest.isolateModules(() => {
      jest.doMock('../../config/current-tenant', () => ({
        wxAppId: 'wxUPLOADTEST1234ab', apiBaseUrl: null
      }));
      req = require('../../utils/request');
    });

    global.wx.uploadFile = jest.fn(options => {
      setTimeout(() => {
        options.success?.({ statusCode: 200, data: JSON.stringify({ code: 0, data: { url: '/img.jpg' } }) });
      }, 10);
    });

    await req.upload('/upload', '/tmp/img.jpg', {});
    const { header } = global.wx.uploadFile.mock.calls[0][0];
    expect(header['X-Wx-AppId']).toBe('wxUPLOADTEST1234ab');
  });
});
