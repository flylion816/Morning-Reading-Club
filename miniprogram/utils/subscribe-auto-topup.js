const subscribeMessageService = require('../services/subscribe-message.service');
const currentTenant = require('../config/current-tenant');

const MAX_SUBSCRIBE_SCENES_PER_REQUEST = 5;
const SETTINGS_CACHE_TTL_MS = 15000;
const PROMPT_THROTTLE_STORAGE_PREFIX = 'subscribe_prompt_throttle';

let settingsCache = null;
let settingsCacheAt = 0;
let settingsCacheKey = '';
let inFlightPromise = null;

function resetAutoTopUpState() {
  settingsCache = null;
  settingsCacheAt = 0;
  settingsCacheKey = '';
  inFlightPromise = null;
}

const _t = currentTenant.subscribeTemplates || {};

const AUTO_TOP_UP_POLICIES = {
  enrollment_result: {
    scene: 'enrollment_result',
    title: '报名结果',
    description: '报名成功后提醒用户进入晨读营',
    templateId: _t.enrollment_result || '',
    target: 1,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  payment_result: {
    scene: 'payment_result',
    title: '付款结果',
    description: '支付完成后提醒用户进入晨读营',
    templateId: _t.payment_result || '',
    target: 1,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  comment_received: {
    scene: 'comment_received',
    title: '收到评论',
    description: '有人评论或回复时提醒查看',
    templateId: _t.comment_received || '',
    target: 50,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  like_received: {
    scene: 'like_received',
    title: '收到点赞',
    description: '有人点赞打卡或评论时提醒查看',
    templateId: _t.like_received || '',
    target: 50,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  danmaku_received: {
    scene: 'danmaku_received',
    title: '小凡看见弹幕',
    description: '有人在你的小凡看见发表弹幕时提醒查看',
    templateId: _t.danmaku_received || '',
    target: 50,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  insight_liked: {
    scene: 'insight_liked',
    title: '小凡看见点赞',
    description: '有人给你的小凡看见点赞时提醒查看',
    templateId: _t.insight_liked || '',
    target: 50,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  insight_request_created: {
    scene: 'insight_request_created',
    title: '申请小凡看见',
    description: '有人请求查看你的小凡看见时提醒处理',
    templateId: _t.insight_request_created || '',
    target: 1,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  insight_request_approved: {
    scene: 'insight_request_approved',
    title: '小凡看见申请通过',
    description: '你发起的小凡看见查看申请被同意时提醒查看',
    templateId: _t.insight_request_approved || '',
    target: 1,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  next_day_study_reminder: {
    scene: 'next_day_study_reminder',
    title: '明日开课通知',
    description: '次日早上 5:55 发送晨读营开课通知',
    templateId: _t.next_day_study_reminder || '',
    target: 1,
    requiresPeriodId: true,
    scheduledSendText: '每天 05:55 自动发送'
  },
  insight_created: {
    scene: 'insight_created',
    title: '小凡看见发布',
    description: '小凡发布专属看见内容时第一时间提醒查看',
    templateId: _t.insight_created || '',
    target: 50,
    requiresPeriodId: false,
    scheduledSendText: ''
  },
  podcast_published: {
    scene: 'podcast_published',
    title: '凡人播客上新',
    description: '播客发布时第一时间提醒收听',
    templateId: _t.podcast_published || '',
    target: 50,
    requiresPeriodId: false,
    scheduledSendText: ''
  }
};

function getAppInstance() {
  if (typeof getApp !== 'function') {
    return null;
  }

  try {
    return getApp();
  } catch (error) {
    return null;
  }
}

function getCurrentUserCacheKey() {
  const app = getAppInstance();
  const userInfo = app?.globalData?.userInfo || {};
  return String(userInfo._id || userInfo.id || 'anonymous');
}

function getTodayDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPromptThrottleStorageKey() {
  return `${PROMPT_THROTTLE_STORAGE_PREFIX}_${getCurrentUserCacheKey()}`;
}

function readPromptThrottleState() {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') {
    return {};
  }

  try {
    const state = wx.getStorageSync(getPromptThrottleStorageKey());
    return state && typeof state === 'object' ? state : {};
  } catch (error) {
    return {};
  }
}

function writePromptThrottleState(state) {
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') {
    return;
  }

  try {
    wx.setStorageSync(getPromptThrottleStorageKey(), state);
  } catch (error) {
    // 忽略本地存储失败，不影响主流程
  }
}

function buildPromptThrottleKey(scene = {}, periodId = null) {
  const periodSuffix = scene.scene === 'next_day_study_reminder' && periodId
    ? `:${periodId}`
    : '';
  return `${scene.scene || 'unknown'}:${scene.templateId || ''}${periodSuffix}`;
}

function isPromptThrottled(scene, periodId = null) {
  if (!scene?.templateId) {
    return false;
  }

  const today = getTodayDateKey();
  const state = readPromptThrottleState();
  if (state[buildPromptThrottleKey(scene, periodId)] === today) {
    return true;
  }

  return false;
}

function markPromptThrottled(scenes = [], options = {}) {
  if (!Array.isArray(scenes) || !scenes.length) {
    return;
  }

  const state = readPromptThrottleState();
  const today = getTodayDateKey();

  scenes.forEach(scene => {
    if (scene?.templateId) {
      state[buildPromptThrottleKey(scene, options.periodId)] = today;
    }
  });

  writePromptThrottleState(state);
}

function normalizeCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getScenePolicy(sceneKey) {
  return AUTO_TOP_UP_POLICIES[sceneKey] || null;
}

function hasTemplateId(scene = {}) {
  return !!String(scene.templateId || '').trim();
}

function getSceneAutoTopUpTarget(scene = {}) {
  const policy = getScenePolicy(scene.scene);
  const explicitTarget = normalizeCount(scene.autoTopUpTarget);

  if (explicitTarget > 0) {
    return explicitTarget;
  }

  return policy ? policy.target : 0;
}

function mergeSceneMetadata(scene = {}) {
  const policy = getScenePolicy(scene.scene);
  const autoTopUpTarget = getSceneAutoTopUpTarget(scene);
  const scheduledSendDate = scene.scheduledSendDate || null;
  const scheduledSendText =
    scene.scheduledSendText ||
    (policy ? policy.scheduledSendText : '');

  return {
    ...scene,
    autoTopUpTarget,
    scheduledSendDate,
    scheduledSendDateKey: scene.scheduledSendDateKey || null,
    queuedSendDate: scene.queuedSendDate || null,
    queuedSendDateKey: scene.queuedSendDateKey || null,
    queuedPeriodId: scene.queuedPeriodId || scene.queuedContext?.periodId || null,
    queuedContext: scene.queuedContext || null,
    scheduledSendText,
    deliveryBlocked: !!scene.deliveryBlocked,
    deliveryBlockedReason: scene.deliveryBlockedReason || null,
    lastWechatErrorCode: scene.lastWechatErrorCode || null,
    lastWechatRefusedAt: scene.lastWechatRefusedAt || null,
    needsReauthorization: !!scene.deliveryBlocked,
    localOnly: !!scene.localOnly,
    requiresPeriodId: scene.requiresPeriodId ?? !!(policy && policy.requiresPeriodId)
  };
}

function mergeAutoTopUpScenes(serverScenes = []) {
  const sceneMap = new Map((serverScenes || []).map(scene => [scene.scene, mergeSceneMetadata(scene)]));
  const mergedScenes = Array.from(sceneMap.values());

  Object.values(AUTO_TOP_UP_POLICIES).forEach(policy => {
    if (!sceneMap.has(policy.scene)) {
      mergedScenes.push(
        mergeSceneMetadata({
          ...policy,
          availableCount: 0,
          lastResult: null,
          lastAcceptedAt: null,
          lastRejectedAt: null,
          lastRequestedAt: null,
          localOnly: true
        })
      );
    }
  });

  return mergedScenes;
}

function buildEligibleScenes(scenes = [], options = {}) {
  const { sceneKeys = null, periodId = null } = options;
  const allowedSceneKeys = Array.isArray(sceneKeys) && sceneKeys.length > 0 ? new Set(sceneKeys) : null;

  return scenes.filter(scene => {
    if (!scene || scene.localOnly) {
      return false;
    }

    if (allowedSceneKeys && !allowedSceneKeys.has(scene.scene)) {
      return false;
    }

    const policy = getScenePolicy(scene.scene);
    if (!policy) {
      return false;
    }

    if (!hasTemplateId(scene)) {
      return false;
    }

    if (policy.requiresPeriodId && !periodId) {
      return false;
    }

    const target = getSceneAutoTopUpTarget(scene);
    if (target <= 0) {
      return false;
    }

    if (scene.scene === 'next_day_study_reminder' && periodId && scene.nextDay) {
      return scene.nextDay?.canRequest === true;
    }

    return !!scene.deliveryBlocked || normalizeCount(scene.availableCount) < target;
  });
}

function buildPromptableScenes(options = {}) {
  const { sceneKeys = null, periodId = null } = options;
  const targetSceneKeys =
    Array.isArray(sceneKeys) && sceneKeys.length > 0
      ? sceneKeys
      : Object.keys(AUTO_TOP_UP_POLICIES);

  return targetSceneKeys
    .map(sceneKey => getScenePolicy(sceneKey))
    .filter(Boolean)
    .filter(hasTemplateId)
    .filter(scene => !scene.requiresPeriodId || !!periodId)
    .map(scene =>
      mergeSceneMetadata({
        ...scene,
        periodId: periodId || null
      })
    );
}

function getSubscriptionSettingMap(settingResponse = {}) {
  const subscriptionsSetting = settingResponse.subscriptionsSetting || {};
  return subscriptionsSetting.itemSettings || {};
}

function requestSubscribeMessage(tmplIds = []) {
  if (!tmplIds.length || typeof wx === 'undefined' || typeof wx.requestSubscribeMessage !== 'function') {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: resolve,
      fail: reject
    });
  });
}

function getErrorMessage(error) {
  if (!error) {
    return '';
  }

  return error.errMsg || error.message || String(error);
}

function isInvalidTemplateRequestError(error) {
  const message = getErrorMessage(error);
  return (
    message.includes('No template data return') ||
    message.includes('verify the template id exist') ||
    message.includes('20001')
  );
}

function buildGrantContext(options = {}, periodId = null) {
  return {
    periodId: periodId || null,
    sourceAction: options.sourceAction || '',
    sourcePage: options.sourcePage || '',
    sectionId: options.sectionId || options.courseId || null,
    courseId: options.courseId || null
  };
}

function buildGrantPayloads(requestScenes = [], requestResult = {}, options = {}, periodId = null) {
  return requestScenes.map(scene => ({
    scene: scene.scene,
    templateId: scene.templateId,
    result: requestResult[scene.templateId] || 'error',
    context: buildGrantContext(options, periodId || scene.periodId || null)
  }));
}

function buildErrorGrantPayloads(requestScenes = [], options = {}, periodId = null) {
  return requestScenes.map(scene => ({
    scene: scene.scene,
    templateId: scene.templateId,
    result: 'error',
    context: buildGrantContext(options, periodId || scene.periodId || null)
  }));
}

async function requestSceneSubscriptions(requestScenes = [], options = {}) {
  const validRequestScenes = (Array.isArray(requestScenes) ? requestScenes : []).filter(hasTemplateId);

  if (!validRequestScenes.length) {
    return {
      grants: [],
      fallbackTriggered: false
    };
  }

  const periodId = options.periodId || null;

  try {
    const batchResult = await requestSubscribeMessage(validRequestScenes.map(scene => scene.templateId));
    return {
      grants: buildGrantPayloads(validRequestScenes, batchResult, options, periodId),
      fallbackTriggered: false
    };
  } catch (batchError) {
    if (!isInvalidTemplateRequestError(batchError) || validRequestScenes.length === 1) {
      return {
        grants: buildErrorGrantPayloads(validRequestScenes, options, periodId),
        fallbackTriggered: false,
        error: batchError
      };
    }

    const grants = [];
    for (const scene of validRequestScenes) {
      try {
        const singleResult = await requestSubscribeMessage([scene.templateId]);
        grants.push(...buildGrantPayloads([scene], singleResult, options, periodId));
      } catch (singleError) {
        console.warn('单模板订阅授权失败:', {
          scene: scene.scene,
          templateId: scene.templateId,
          error: getErrorMessage(singleError)
        });
        grants.push(...buildErrorGrantPayloads([scene], options, periodId));
      }
    }

    return {
      grants,
      fallbackTriggered: true,
      error: batchError
    };
  }
}

async function getSettings(options = {}) {
  const normalizedOptions = typeof options === 'boolean'
    ? { forceRefresh: options }
    : options || {};
  const { forceRefresh = false, periodId = null } = normalizedOptions;
  const now = Date.now();
  const cacheKey = String(periodId || '__all__');
  if (
    !forceRefresh &&
    settingsCache &&
    settingsCacheKey === cacheKey &&
    now - settingsCacheAt < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsCache;
  }

  const response = await subscribeMessageService.getSettings(periodId ? { periodId } : {});
  settingsCache = response;
  settingsCacheAt = now;
  settingsCacheKey = cacheKey;
  return response;
}

function updateSettingsCache(response, options = {}) {
  settingsCache = response || null;
  settingsCacheAt = Date.now();
  settingsCacheKey = String(options.periodId || '__all__');
}

function getWxSettingWithSubscriptions() {
  if (typeof wx === 'undefined' || typeof wx.getSetting !== 'function') {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    wx.getSetting({
      withSubscriptions: true,
      success: resolve,
      fail: reject
    });
  });
}

async function maybeAutoTopUpSubscriptions(options = {}) {
  if (inFlightPromise) {
    return inFlightPromise;
  }

  const app = getAppInstance();
  if (app && app.globalData && app.globalData.isLogin === false) {
    return {
      skipped: true,
      reason: 'not_logged_in'
    };
  }

  inFlightPromise = (async () => {
    const {
      sceneKeys = null,
      periodId = null,
      requestMode = 'remembered',
      forceRefresh = false
    } = options;
    let requestScenes = [];
    const response = await getSettings({ forceRefresh, periodId });
    const serverScenes = Array.isArray(response?.scenes) ? response.scenes : [];
    const eligibleScenes = buildEligibleScenes(serverScenes, { sceneKeys, periodId });

    if (requestMode === 'remembered') {
      if (!eligibleScenes.length) {
        return {
          skipped: true,
          reason: 'no_eligible_scene'
        };
      }

      const settingResponse = await getWxSettingWithSubscriptions();
      const itemSettings = getSubscriptionSettingMap(settingResponse);
      requestScenes = eligibleScenes.filter(scene => itemSettings[scene.templateId] === 'accept');
      if (!requestScenes.length) {
        return {
          skipped: true,
          reason: 'no_remembered_accept'
        };
      }
    } else {
      const promptableSceneMap = new Map(
        buildPromptableScenes({ sceneKeys, periodId }).map(scene => [scene.scene, scene])
      );
      const promptableScenes = eligibleScenes
        .map(scene => promptableSceneMap.get(scene.scene))
        .filter(Boolean);
      if (!promptableScenes.length) {
        return {
          skipped: true,
          reason: 'no_eligible_scene'
        };
      }

      const settingResponse = await getWxSettingWithSubscriptions();
      const itemSettings = getSubscriptionSettingMap(settingResponse);
      requestScenes = promptableScenes.filter(
        scene => itemSettings[scene.templateId] !== 'reject' && itemSettings[scene.templateId] !== 'ban'
      );
      const throttledScenes = requestScenes.filter(scene => isPromptThrottled(scene, periodId));
      requestScenes = requestScenes.filter(scene => !isPromptThrottled(scene, periodId));
      if (!requestScenes.length) {
        return {
          skipped: true,
          reason: throttledScenes.length ? 'prompt_throttled' : 'no_requestable_scene'
        };
      }
    }

    const requestBatch = requestScenes.slice(0, MAX_SUBSCRIBE_SCENES_PER_REQUEST);
    const requestMeta = await requestSceneSubscriptions(requestBatch, {
      ...options,
      periodId
    });
    const grants = requestMeta.grants;

    const saveResult = await subscribeMessageService.saveGrants(grants);
    updateSettingsCache(saveResult, { periodId });

    const successfulGrantScenes = grants
      .filter(grant => grant && grant.templateId && grant.result !== 'error')
      .map(grant => ({
        scene: grant.scene,
        templateId: grant.templateId
      }));

    if (requestMode !== 'remembered' && successfulGrantScenes.length > 0) {
      markPromptThrottled(successfulGrantScenes, { periodId });
    }

    return {
      skipped: false,
      requestedScenes: requestBatch.map(scene => scene.scene),
      grants,
      saveResult,
      fallbackTriggered: !!requestMeta.fallbackTriggered
    };
  })()
    .catch(error => {
      console.warn('自动补量失败:', error);
      return {
        skipped: true,
        reason: 'error',
        error: error.message || String(error)
      };
    })
    .finally(() => {
      inFlightPromise = null;
    });

  return inFlightPromise;
}

function maybeAutoTopUpNextDayStudyReminder(options = {}) {
  return maybeAutoTopUpSubscriptions({
    ...options,
    sceneKeys: ['next_day_study_reminder'],
    requestMode: 'any',
    forceRefresh: true
  });
}

module.exports = {
  AUTO_TOP_UP_POLICIES,
  MAX_SUBSCRIBE_SCENES_PER_REQUEST,
  buildEligibleScenes,
  getSettings,
  getSceneAutoTopUpTarget,
  getScenePolicy,
  getSubscriptionSettingMap,
  mergeAutoTopUpScenes,
  maybeAutoTopUpSubscriptions,
  maybeAutoTopUpNextDayStudyReminder,
  requestSceneSubscriptions,
  resetAutoTopUpState,
  updateSettingsCache,
  isPromptThrottled,
  markPromptThrottled
};
