const { verifyAccessToken, generateTokens } = require('../utils/jwt');
const { withSystemContext } = require('../utils/tenantContext');
const { errors } = require('../utils/response');
const User = require('../models/User');
const logger = require('../utils/logger');

// 认证中间件（支持自动Token续期）
async function authMiddleware(req, res, next) {
  try {
    // 从请求头获取token
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(errors.unauthorized('未提供认证令牌'));
    }

    const token = authHeader.substring(7);

    // 验证token
    const decoded = verifyAccessToken(token);

    // 将用户信息添加到请求对象
    req.user = decoded;

    // 检查Token剩余有效期，如果<30分钟则自动续期
    const expiresAt = decoded.exp * 1000; // 转换为毫秒
    const now = Date.now();
    const remainingTime = expiresAt - now;
    const thirtyMinutes = 30 * 60 * 1000;

    if (remainingTime < thirtyMinutes && remainingTime > 0 && decoded.tenantId) {
      // Token剩余时间<30分钟且有 tenantId，生成新Token并添加到响应头
      // 老 token 没有 tenantId 时跳过续期，让后续 userTenantContext 返回 403
      try {
        const user = await withSystemContext(decoded.tenantId, () =>
          User.findById(decoded.userId || decoded._id).exec()
        );
        if (user) {
          const newTokens = generateTokens(user);

          // 添加新Token到响应头，前端自动更新
          res.setHeader('X-New-Token', newTokens.accessToken);
          res.setHeader('X-New-Refresh-Token', newTokens.refreshToken);

          logger.info('Token自动续期', {
            userId: user._id,
            remainingMinutes: Math.floor(remainingTime / 1000 / 60)
          });
        }
      } catch (renewError) {
        // 续期失败不影响当前请求，仅记录日志
        logger.error('Token自动续期失败', renewError, {
          userId: decoded.userId || decoded._id
        });
      }
    }

    next();
  } catch (error) {
    return res.status(401).json(errors.unauthorized(error.message));
  }
}

// 可选认证中间件（不强制要求登录）
function optionalAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyAccessToken(token);
      req.user = decoded;
    }

    next();
  } catch (error) {
    // 验证失败也继续，但不设置req.user
    next();
  }
}

// 管理员权限中间件
function adminMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json(errors.unauthorized('未登录'));
  }

  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json(errors.forbidden('需要管理员权限'));
  }

  next();
}

module.exports = {
  authMiddleware,
  optionalAuthMiddleware,
  adminMiddleware
};
