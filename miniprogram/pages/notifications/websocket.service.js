/**
 * WebSocket 服务
 * 处理与后端的 WebSocket 连接和实时通知推送
 */

const envConfig = require('../../config/env');
const constants = require('../../config/constants');
const logger = require('../../utils/logger');
const { tenantStorage } = require('../../utils/storage');

class WebSocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.allowReconnect = false;
    this.manualClose = false;
    this.eventListeners = new Map();
    this.messageQueue = [];
    this.userId = null;
    this.heartbeatInterval = null;
  }

  /**
   * 初始化 WebSocket 连接
   * @param {string} userId - 用户ID
   * @param {object} options - 选项配置
   */
  connect(userId, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        if (this.isConnected) {
          logger.debug('[WebSocket] 已连接，无需重新连接');
          return resolve();
        }

        // 登录前禁止建连守卫
        const token = tenantStorage.get(constants.STORAGE_KEYS.TOKEN);
        if (!token) {
          logger.warn('[WebSocket] 未登录，拒绝建立连接');
          return reject(new Error('未登录，无法建立 WebSocket 连接'));
        }

        this.userId = userId;
        this.allowReconnect = options.allowReconnect === true;
        this.manualClose = false;

        // 获取服务器地址
        const apiUrl = envConfig.apiBaseUrl;
        const socketUrl = apiUrl
          .replace('http://', 'ws://')
          .replace('https://', 'wss://')
          .replace('/api/v1', '');

        logger.debug('[WebSocket] 正在连接到:', socketUrl);

        // 先获取 wsToken 再建立连接（§7.4.5.2 兜底方案）
        const request = require('../../utils/request');
        request.post('/auth/ws-token', {})
          .then((wsTokenData) => {
            const wsToken = wsTokenData.token || wsTokenData.wsToken;
            if (!wsToken) {
              throw new Error('获取 wsToken 失败');
            }

            // 创建 WebSocket 连接
            this.socket = wx.connectSocket({
              url: `${socketUrl}?wsToken=${encodeURIComponent(wsToken)}`
            });

            // 连接成功
            // eslint-disable-next-line no-unused-vars
            this.socket.onOpen(res => {
              logger.log('[WebSocket] 连接成功');
              this.isConnected = true;
              this.reconnectAttempts = 0;

              // 发送用户加入事件
              this.emit('user:join', { userId });

              // 启动心跳检测
              this.startHeartbeat();

              // 处理消息队列
              this.flushMessageQueue();

              resolve();
            });

            // 接收消息
            this.socket.onMessage(res => {
              try {
                const data = JSON.parse(res.data);
                this.handleMessage(data);
              } catch (error) {
                logger.error('[WebSocket] 消息解析错误:', error, res.data);
              }
            });

            // 连接错误
            this.socket.onError(error => {
              logger.error('[WebSocket] 连接错误:', error);
              this.isConnected = false;
              if (this.allowReconnect && !this.manualClose) {
                this.handleReconnect();
              }
              reject(error);
            });

            // 连接关闭
            // eslint-disable-next-line no-unused-vars
            this.socket.onClose(res => {
              logger.log('[WebSocket] 连接已关闭');
              this.isConnected = false;
              this.stopHeartbeat();
              if (this.allowReconnect && !this.manualClose) {
                this.handleReconnect();
              }
            });

            // 超时处理
            setTimeout(() => {
              if (!this.isConnected) {
                reject(new Error('WebSocket 连接超时'));
              }
            }, options.timeout || 10000);
          })
          .catch((err) => {
            logger.error('[WebSocket] 获取 wsToken 失败:', err);
            reject(err);
          });
      } catch (error) {
        logger.error('[WebSocket] 初始化失败:', error);
        reject(error);
      }
    });
  }

  /**
   * 处理接收到的消息
   * @private
   */
  handleMessage(data) {
    const { type, ...payload } = data;

    logger.debug(`[WebSocket] 收到消息: ${type}`, payload);

    // 触发对应的事件监听器
    if (this.eventListeners.has(type)) {
      const listeners = this.eventListeners.get(type);
      listeners.forEach(callback => {
        try {
          callback(payload);
        } catch (error) {
          logger.error(`[WebSocket] 处理 ${type} 事件时出错:`, error);
        }
      });
    }

    // 处理特定的消息类型
    switch (type) {
    case 'notification:new':
      this.handleNewNotification(payload);
      break;
    case 'notification:broadcast':
      this.handleBroadcastNotification(payload);
      break;
    case 'user:joined':
      logger.log('[WebSocket] 用户加入成功');
      break;
    case 'pong':
      // 心跳响应
      break;
    default:
      logger.warn('[WebSocket] 未知的消息类型:', type);
    }
  }

  /**
   * 处理新通知
   * @private
   */
  handleNewNotification(notification) {
    // 可以在这里触发本地通知或其他操作
    const app = getApp();
    if (app && app.globalData && typeof app.globalData.onNotification === 'function') {
      app.globalData.onNotification(notification);
    }

    // 也可以触发事件让订阅的页面更新
    wx.eventCenter?.emit('notification:received', notification);
  }

  /**
   * 处理广播通知
   * @private
   */
  handleBroadcastNotification(notification) {
    logger.debug('[WebSocket] 收到广播通知:', notification);
    // 类似于新通知的处理
    this.handleNewNotification(notification);
  }

  /**
   * 发送消息到服务器
   * @param {string} type - 消息类型
   * @param {object} data - 消息数据
   */
  emit(type, data = {}) {
    const message = {
      type,
      ...data
    };

    if (!this.isConnected) {
      logger.warn('[WebSocket] 未连接，消息将入队:', type);
      this.messageQueue.push(message);
      return;
    }

    try {
      this.socket.send({
        data: JSON.stringify(message)
      });
      logger.debug('[WebSocket] 发送消息:', type);
    } catch (error) {
      logger.error('[WebSocket] 发送失败:', error);
      this.messageQueue.push(message);
    }
  }

  /**
   * 订阅事件
   * @param {string} type - 事件类型
   * @param {function} callback - 回调函数
   */
  on(type, callback) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(callback);

    // 返回取消订阅函数
    return () => {
      const listeners = this.eventListeners.get(type);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * 取消订阅事件
   * @param {string} type - 事件类型
   * @param {function} callback - 回调函数
   */
  off(type, callback) {
    if (!this.eventListeners.has(type)) return;

    const listeners = this.eventListeners.get(type);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * 处理消息队列
   * @private
   */
  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.emit(message.type, message);
    }
  }

  /**
   * 启动心跳检测
   * @private
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        this.emit('ping');
      }
    }, 30000); // 每30秒发送一次心跳
  }

  /**
   * 停止心跳检测
   * @private
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 处理重新连接
   * @private
   */
  handleReconnect() {
    if (!this.allowReconnect || this.manualClose) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('[WebSocket] 达到最大重连次数，停止重连');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    logger.warn(`[WebSocket] 在 ${delay}ms 后进行第 ${this.reconnectAttempts} 次重连...`);

    setTimeout(() => {
      if (this.userId) {
        this.connect(this.userId).catch(error => {
          logger.error('[WebSocket] 重连失败:', error);
        });
      }
    }, delay);
  }

  /**
   * 租户切换时断开连接并清理状态
   */
  disconnectAndClearForTenantSwitch() {
    logger.log('[WebSocket] 租户切换：断开连接并清理状态');
    this.manualClose = true;
    this.allowReconnect = false;
    this.stopHeartbeat();

    if (this.socket) {
      try {
        this.socket.close();
      } catch (error) {
        logger.error('[WebSocket] 关闭失败:', error);
      }
    }

    this.isConnected = false;
    this.socket = null;
    this.userId = null;
    this.reconnectAttempts = 0;
    this.eventListeners.clear();
    this.messageQueue = [];
  }

  /**
   * 关闭连接
   */
  disconnect() {
    logger.log('[WebSocket] 正在断开连接...');
    this.manualClose = true;
    this.allowReconnect = false;
    this.stopHeartbeat();

    if (this.socket) {
      try {
        this.socket.close();
      } catch (error) {
        logger.error('[WebSocket] 关闭失败:', error);
      }
    }

    this.isConnected = false;
    this.socket = null;
    this.eventListeners.clear();
    this.messageQueue = [];
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      userId: this.userId,
      reconnectAttempts: this.reconnectAttempts,
      messageQueueLength: this.messageQueue.length
    };
  }
}

// 导出单例
module.exports = new WebSocketService();
