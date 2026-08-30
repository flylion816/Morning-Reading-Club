const path = require("path");
const mongoose = require("mongoose");

// ⚠️ 重要：最早加载环境配置，在任何模块 require 之前
// 首先尝试加载根目录的统一环境配置（.env.config.js 是权威来源）
try {
  const envConfigPath = path.resolve(__dirname, "../../.env.config.js");
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const envConfig = require(envConfigPath);

  // .env.config.js 的 nodeEnv 优先级高于默认值，但低于系统环境变量
  // 只有当系统没有显式设置 NODE_ENV 时，才使用 .env.config.js 的值
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = envConfig.config.backend.nodeEnv;
  }
  process.env.MONGODB_URI =
    process.env.MONGODB_URI || envConfig.config.backend.mongodbUri;
} catch (error) {
  // 如果没有 .env.config.js，使用默认值
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "development";
  }
}

// 根据 NODE_ENV 加载相应的环境文件
const envFile =
  process.env.NODE_ENV === "production"
    ? path.resolve(__dirname, "../.env.production")
    : path.resolve(__dirname, "../.env");

require("dotenv").config({ path: envFile });

// 再加载 .env.local（本地开发/测试覆盖）
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

// 日志输出当前的 MYSQL_PORT 值（用于调试）
const logger_temp = console;
logger_temp.log("[DEBUG] After dotenv loading:");
logger_temp.log("  NODE_ENV:", process.env.NODE_ENV);
logger_temp.log("  MYSQL_HOST:", process.env.MYSQL_HOST);
logger_temp.log("  MYSQL_PORT:", process.env.MYSQL_PORT);

// 现在才能 require 其他模块，确保环境变量已加载
const { WebSocketServer } = require("ws");
const { connectMongoDB, testMySQLConnection } = require("./config/database");
const { validateConfig } = require("./utils/config-validator");
const ConfigSyncValidator = require("./utils/config-sync-validator");
const logger = require("./utils/logger");
const WebSocketManager = require("./utils/websocket");
const { initWsPubSub } = require("./utils/ws-pubsub");
const redisManager = require("./utils/redis");
const {
  initRedisClient,
  startSyncListener,
} = require("./services/sync.service");
const backupService = require("./services/backup.service");
const studyReminderService = require("./services/study-reminder.service");
const periodStatusService = require("./services/period-status.service");
const activityReminderService = require("./services/activity-reminder.service");

// 现在 app.js 可以安全加载，NODE_ENV 已经被正确设置
const app = require("./app");

// 验证环境配置
validateConfig();

// 配置同步检查：验证前后端环境配置是否一致
ConfigSyncValidator.validateConfigSync();

const PORT = process.env.PORT || 3000;
let mongoFailureTriggered = false;

function handleMongoDependencyFailure(reason) {
  if (mongoFailureTriggered) return;
  mongoFailureTriggered = true;

  logger.error("MongoDB 依赖不可用，当前 worker 将退出", { reason });

  setTimeout(() => {
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }, 100);
}

function setupMongoLifecycleHandlers() {
  mongoose.connection.on("error", (error) => {
    logger.error("MongoDB 运行时错误", error, {
      readyState: mongoose.connection.readyState,
    });
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("MongoDB 已重新连接");
  });

  mongoose.connection.on("disconnected", () => {
    logger.error("MongoDB 连接已断开", {
      readyState: mongoose.connection.readyState,
    });

    if (process.env.NODE_ENV === "production") {
      handleMongoDependencyFailure("mongodb disconnected");
    }
  });
}

// 记录应用启动配置
logger.info("应用启动配置", {
  environment: process.env.NODE_ENV || "development",
  port: PORT,
  nodeVersion: process.version,
});

// 启动服务器
async function startServer() {
  try {
    setupMongoLifecycleHandlers();

    // 初始化Redis连接（后台异步，不阻塞启动）
    logger.info("正在连接 Redis...");
    // 异步连接 Redis，不阻塞应用启动
    redisManager
      .connect()
      .then(() => {
        logger.info("✅ Redis 连接成功");
      })
      .catch((error) => {
        logger.warn(
          "⚠️ Redis 连接失败，将使用内存缓存作为降级方案",
          error.message,
        );
      });

    // 连接MongoDB
    logger.info("正在连接 MongoDB...");
    await connectMongoDB();
    logger.info("✅ MongoDB 连接成功");

    // 测试MySQL连接
    logger.info("正在测试 MySQL 连接...");
    try {
      await testMySQLConnection();
      logger.info("✅ MySQL 连接测试通过");
    } catch (dbError) {
      logger.warn(
        "⚠️ MySQL 连接测试失败，应用将继续运行但MySQL功能不可用",
        dbError.message,
      );
    }

    // 启动HTTP服务器（先启动，不等待 Redis）
    const server = app.listen(PORT, () => {
      logger.info("服务器已启动", {
        url: `http://localhost:${PORT}`,
        apiBaseUrl: `http://localhost:${PORT}/api/v1`,
        healthCheck: `http://localhost:${PORT}/api/v1/health`,
        environment: process.env.NODE_ENV || "development",
      });

      // 保留控制台输出用于本地开发
      logger.info(`\n🚀 Server is running on http://localhost:${PORT}`);
      logger.info(`📚 API Base URL: http://localhost:${PORT}/api/v1`);
      logger.info(`🏥 Health check: http://localhost:${PORT}/api/v1/health`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV || "development"}\n`);
    });

    // 初始化 WebSocket（原生 ws）
    const wss = new WebSocketServer({ server, path: "/ws" });
    const wsManager = new WebSocketManager(wss);

    // 多实例广播（PM2 cluster mode）
    initWsPubSub(wsManager);

    // 将 WebSocket 管理器附加到 app，以便其他模块可以访问
    app.locals.wsManager = wsManager;

    logger.info("✅ WebSocket (native ws) 已初始化");

    // 后台初始化 Redis（不阻塞 HTTP 服务器启动）
    logger.info("正在后台初始化 Redis 同步队列...");
    initRedisClient()
      .then((redisReady) => {
        if (redisReady) {
          logger.info("✅ Redis 同步队列初始化成功");
          // 启动 MongoDB 同步监听器
          logger.info("正在启动 MongoDB→MySQL 实时同步...");
          startSyncListener();
        } else {
          logger.warn("⚠️ Redis 初始化失败，同步功能将不可用");
        }
      })
      .catch((error) => {
        logger.warn("⚠️ Redis 初始化异常，同步功能将不可用", error.message);
      });

    // 初始化备份服务（仅在生产环境启用）
    if (process.env.NODE_ENV === "production") {
      periodStatusService.startPeriodStatusSchedules();
      logger.info(
        "✅ 期次状态自动同步任务已启动（启动时执行一次，每天 00:05 同步）",
      );

      studyReminderService.startStudyReminderSchedules();
      logger.info("✅ 明日学习提醒定时任务已启动（05:55 首发，06:00 重试）");

      activityReminderService.startActivityReminderSchedule();
      logger.info("✅ 活动 10 分钟提醒定时任务已启动（每分钟检查一次）");

      logger.info("正在初始化数据备份服务...");
      backupService
        .initBackupDirs()
        .then(() => {
          logger.info("✅ 备份目录初始化成功");
          // 启动定时备份任务
          backupService.startBackupSchedules();
          logger.info(
            "✅ 定时备份任务已启动（MongoDB: 02:00, MySQL: 02:30, 清理: 03:00）",
          );
        })
        .catch((error) => {
          logger.error("❌ 备份服务初始化失败", error.message);
        });
    }

    // 设置服务器监听所有网卡
    server.on("listening", () => {
      const addr = server.address();
      logger.info("服务器监听端口", { port: addr.port });
    });

    // 处理未捕获的异常
    process.on("uncaughtException", (error) => {
      logger.error("未捕获的异常", error, { type: "uncaughtException" });
    });

    // 处理未处理的Promise拒绝
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("未处理的Promise拒绝", reason, {
        promise: promise.toString(),
      });
    });
  } catch (error) {
    logger.error("服务器启动失败", error, {
      message: error.message,
      code: error.code,
    });
    logger.error("❌ Failed to start server:", error);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

// 优雅关闭
process.on("SIGINT", async () => {
  logger.info("应用接收到 SIGINT 信号，正在优雅关闭...");
  logger.info("\n\n👋 Shutting down gracefully...");
  // 断开Redis连接
  await redisManager.disconnect();
  // eslint-disable-next-line no-process-exit
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("应用接收到 SIGTERM 信号，正在优雅关闭...");
  logger.info("\n\n👋 Shutting down gracefully...");
  // 断开Redis连接
  await redisManager.disconnect();
  // eslint-disable-next-line no-process-exit
  process.exit(0);
});

// 应用退出时记录
process.on("exit", (code) => {
  logger.info("应用已关闭", { exitCode: code });
});

// 启动服务器（仅在非测试环境）
if (process.env.NODE_ENV !== "test") {
  startServer();
}

// 导出 app 供测试和其他模块使用
module.exports = app;
