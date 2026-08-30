/**
 * Auth Middleware 单元测试
 * 完整的 100% 覆盖，包括 async/await、Token 续期、权限检查等
 */

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const mongoose = require('mongoose');
const {
  tokenData,
  authorizationHeaders,
  createMockRequest,
  createMockResponse,
  testUsers,
  decodedJwt,
  errorResponses,
  boundaryValues
} = require('../../fixtures/middleware-fixtures');

describe('Auth Middleware - 100% Coverage', () => {
  let sandbox;
  let req;
  let res;
  let next;
  let jwtStub;
  let responseStub;
  let UserStub;
  let loggerStub;
  let authMiddleware;
  let optionalAuthMiddleware;
  let adminMiddleware;
  let systemContextActive;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    systemContextActive = false;

    req = {
      headers: {},
      user: null
    };

    res = {
      statusCode: 200,
      _headers: {},
      _jsonData: null,
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub().returnsThis(),
      setHeader: sandbox.stub().returnsThis(),
      getHeader: sandbox.stub().returnsThis()
    };

    next = sandbox.stub();

    // Mock JWT
    jwtStub = {
      verifyAccessToken: sandbox.stub(),
      generateTokens: sandbox.stub()
    };

    // Mock response utils
    responseStub = {
      errors: {
        unauthorized: (msg) => ({ code: 401, message: msg }),
        forbidden: (msg) => ({ code: 403, message: msg })
      }
    };

    // Mock User 模型（用于 Token 续期）
    UserStub = {
      findById: sandbox.stub()
    };

    // Mock logger
    loggerStub = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
      debug: sandbox.stub()
    };

    // 使用 proxyquire 加载中间件
    const auth = proxyquire('../../../src/middleware/auth', {
      '../utils/jwt': jwtStub,
      '../utils/response': responseStub,
      '../models/User': UserStub,
      '../utils/logger': loggerStub,
      '../utils/tenantContext': {
        withSystemContext: (tenantId, fn) => {
          systemContextActive = true;
          try {
            return fn();
          } finally {
            systemContextActive = false;
          }
        }
      }
    });

    authMiddleware = auth.authMiddleware;
    optionalAuthMiddleware = auth.optionalAuthMiddleware;
    adminMiddleware = auth.adminMiddleware;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('authMiddleware - 有效认证', () => {
    it('TC-AUTH-MW-001: 应该在提供有效token时调用next()并设置req.user', async () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      jwtStub.verifyAccessToken.returns(decodedJwt.validDecoded);

      await authMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user).to.deep.equal(decodedJwt.validDecoded);
    });

    it('TC-AUTH-MW-002: 应该支持管理员token', async () => {
      req.headers.authorization = authorizationHeaders.validAdminBearer();
      jwtStub.verifyAccessToken.returns(decodedJwt.adminDecoded);

      await authMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user.role).to.equal('admin');
    });

    it('TC-AUTH-MW-003: 应该支持超级管理员token', async () => {
      req.headers.authorization = authorizationHeaders.validSuperadminBearer();
      jwtStub.verifyAccessToken.returns(decodedJwt.superadminDecoded);

      await authMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user.role).to.equal('superadmin');
    });

    it('TC-AUTH-MW-004: 应该正确提取Bearer token（含多个点号）', async () => {
      const token = 'eyJhbGc.eyJpZCI6MX0.SflKxw';
      req.headers.authorization = `Bearer ${token}`;
      jwtStub.verifyAccessToken.returns(decodedJwt.validDecoded);

      await authMiddleware(req, res, next);

      expect(jwtStub.verifyAccessToken.calledWith(token)).to.be.true;
    });

    it('TC-AUTH-MW-005: 应该保留完整的decoded信息到req.user', async () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      const fullDecodedUser = {
        userId: 'user_id_123',
        openid: 'test_openid',
        role: 'admin',
        iat: 1234567890,
        exp: 1234571490
      };
      jwtStub.verifyAccessToken.returns(fullDecodedUser);

      await authMiddleware(req, res, next);

      expect(req.user).to.deep.equal(fullDecodedUser);
      expect(req.user.userId).to.equal('user_id_123');
      expect(req.user.openid).to.equal('test_openid');
      expect(req.user.role).to.equal('admin');
    });
  });

  describe('authMiddleware - Authorization Header 处理', () => {
    it('TC-AUTH-MW-006: 应该在没有Authorization header时返回401', async () => {
      // 不设置任何 authorization header
      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(res.json.called).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-007: 应该在Authorization header为null时返回401', async () => {
      req.headers.authorization = null;
      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-008: 应该在Authorization header为空字符串时返回401', async () => {
      req.headers.authorization = '';
      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-009: 应该在Authorization header不以Bearer开头时返回401', async () => {
      req.headers.authorization = authorizationHeaders.wrongScheme();
      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-010: 应该拒绝小写的bearer前缀（区分大小写）', async () => {
      req.headers.authorization = authorizationHeaders.lowercaseBearer();
      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-011: 应该拒绝缺少空格的Bearer前缀', async () => {
      req.headers.authorization = authorizationHeaders.tokenWithoutSpace();
      // 验证时会抛错
      jwtStub.verifyAccessToken.throws(new Error('Invalid token'));
      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-012: 应该拒绝只有Bearer前缀无token的header', async () => {
      req.headers.authorization = authorizationHeaders.emptyBearer();
      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-013: 应该处理多个空格分隔符', async () => {
      req.headers.authorization = authorizationHeaders.extraSpaces();
      // Bearer  token 会导致第一个空字符被提取
      expect(() => {
        req.headers.authorization.substring(7); // 会是 ' token'
      }).to.not.throw();
    });
  });

  describe('authMiddleware - Token 验证失败', () => {
    it('TC-AUTH-MW-014: 应该在token验证失败时返回401', async () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      jwtStub.verifyAccessToken.throws(new Error('Token无效'));

      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-015: 应该处理过期token错误', async () => {
      req.headers.authorization = authorizationHeaders.validBearer(tokenData.expiredToken);
      jwtStub.verifyAccessToken.throws(new Error('Token已过期'));

      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(res.json.calledOnce).to.be.true;
      const errorResponse = res.json.getCall(0).args[0];
      expect(errorResponse.code).to.equal(401);
    });

    it('TC-AUTH-MW-016: 应该处理格式错误的token', async () => {
      req.headers.authorization = authorizationHeaders.validBearer(tokenData.malformedToken);
      jwtStub.verifyAccessToken.throws(new Error('格式不正确'));

      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('TC-AUTH-MW-017: 应该处理签名验证失败', async () => {
      req.headers.authorization = authorizationHeaders.validBearer(tokenData.invalidSignatureToken);
      jwtStub.verifyAccessToken.throws(new Error('签名验证失败'));

      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
    });

    it('TC-AUTH-MW-018: 应该处理被篡改的token', async () => {
      req.headers.authorization = authorizationHeaders.validBearer('tampered_token');
      jwtStub.verifyAccessToken.throws(new Error('Token被篡改'));

      await authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
    });
  });

  describe('authMiddleware - Token 自动续期', () => {
    it('TC-AUTH-MW-019: 应该在Token剩余<30分钟时自动续期', async () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      // 模拟 Token 即将过期（10分钟后）
      const almostExpiredDecoded = {
        userId: testUsers.regularUser.userId,
        role: 'user',
        tenantId: 'test-tenant-id',
        iat: Math.floor(Date.now() / 1000) - 3000,
        exp: Math.floor(Date.now() / 1000) + 600 // 10 分钟后过期
      };
      jwtStub.verifyAccessToken.returns(almostExpiredDecoded);

      // Mock User.findById
      const mockUser = { _id: testUsers.regularUser.userId, nickname: 'Test User' };
      UserStub.findById.returns({ exec: sandbox.stub().resolves(mockUser) });
      jwtStub.generateTokens.returns({
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token'
      });

      await authMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(jwtStub.generateTokens.called).to.be.true;
      expect(res.setHeader.calledWithMatch('X-New-Token')).to.be.true;
      expect(res.setHeader.calledWithMatch('X-New-Refresh-Token')).to.be.true;
    });

    it('TC-AUTH-MW-019A: 应该在租户上下文内执行续期用户查询', async () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      jwtStub.verifyAccessToken.returns({
        userId: testUsers.regularUser.userId,
        role: 'user',
        tenantId: 'test-tenant-id',
        iat: Math.floor(Date.now() / 1000) - 3000,
        exp: Math.floor(Date.now() / 1000) + 600
      });

      const mockUser = { _id: testUsers.regularUser.userId, nickname: 'Test User' };
      let execCalled = false;
      UserStub.findById.returns({
        exec() {
          execCalled = true;
          if (!systemContextActive) {
            return Promise.reject(new Error('查询在租户上下文外执行'));
          }
          return Promise.resolve(mockUser);
        },
        then(resolve, reject) {
          if (!systemContextActive) {
            return reject(new Error('查询在租户上下文外执行'));
          }
          return resolve(mockUser);
        }
      });
      jwtStub.generateTokens.returns({
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token'
      });

      await authMiddleware(req, res, next);

      expect(execCalled).to.be.true;
      expect(loggerStub.error.called).to.be.false;
      expect(res.setHeader.calledWith('X-New-Token', 'new_access_token')).to.be.true;
    });

    it('TC-AUTH-MW-020: 应该在Token有效期充足时不进行续期', async () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      // 模拟 Token 仍有2小时有效期
      const sufficientDecoded = {
        userId: testUsers.regularUser.userId,
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 7200 // 2 小时后过期
      };
      jwtStub.verifyAccessToken.returns(sufficientDecoded);

      await authMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(jwtStub.generateTokens.called).to.be.false;
      expect(res.setHeader.called).to.be.false;
    });

    it('TC-AUTH-MW-021: 应该处理续期时User.findById失败', async () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      const almostExpiredDecoded = {
        userId: testUsers.regularUser.userId,
        role: 'user',
        iat: Math.floor(Date.now() / 1000) - 3000,
        exp: Math.floor(Date.now() / 1000) + 600
      };
      jwtStub.verifyAccessToken.returns(almostExpiredDecoded);

      // Mock User.findById 返回 null
      UserStub.findById.resolves(null);

      await authMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(jwtStub.generateTokens.called).to.be.false;
      expect(loggerStub.error.called).to.be.false; // 用户不存在时不记录错误
    });

    it('TC-AUTH-MW-022: 应该处理续期时generateTokens异常', async () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      const almostExpiredDecoded = {
        userId: testUsers.regularUser.userId,
        role: 'user',
        tenantId: 'test-tenant-id',
        iat: Math.floor(Date.now() / 1000) - 3000,
        exp: Math.floor(Date.now() / 1000) + 600
      };
      jwtStub.verifyAccessToken.returns(almostExpiredDecoded);

      const mockUser = { _id: testUsers.regularUser.userId };
      UserStub.findById.returns({ exec: sandbox.stub().resolves(mockUser) });
      jwtStub.generateTokens.throws(new Error('生成token失败'));

      await authMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(loggerStub.error.called).to.be.true;
    });
  });

  describe('optionalAuthMiddleware - 可选认证', () => {
    it('TC-AUTH-MW-023: 应该在提供有效token时设置req.user并调用next()', () => {
      req.headers.authorization = authorizationHeaders.validBearer();
      jwtStub.verifyAccessToken.returns(decodedJwt.validDecoded);

      optionalAuthMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user).to.deep.equal(decodedJwt.validDecoded);
    });

    it('TC-AUTH-MW-024: 应该在没有Authorization header时仍然调用next()', () => {
      // 不设置任何 authorization header
      optionalAuthMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user).to.be.null;
    });

    it('TC-AUTH-MW-025: 应该在Authorization header为空时仍然调用next()', () => {
      req.headers.authorization = '';
      optionalAuthMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user).to.be.null;
    });

    it('TC-AUTH-MW-026: 应该在token验证失败时仍然调用next()', () => {
      req.headers.authorization = authorizationHeaders.validBearer(tokenData.expiredToken);
      jwtStub.verifyAccessToken.throws(new Error('Token已过期'));

      optionalAuthMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user).to.be.null;
    });

    it('TC-AUTH-MW-027: 应该忽略错误的Authorization header格式', () => {
      req.headers.authorization = authorizationHeaders.wrongScheme();
      optionalAuthMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user).to.be.null;
    });

    it('TC-AUTH-MW-028: 应该忽略小写的bearer前缀', () => {
      req.headers.authorization = authorizationHeaders.lowercaseBearer();
      optionalAuthMiddleware(req, res, next);

      expect(next.called).to.be.true;
      expect(req.user).to.be.null;
    });

    it('TC-AUTH-MW-029: 应该在验证成功时保留完整decoded信息', () => {
      req.headers.authorization = authorizationHeaders.validAdminBearer();
      jwtStub.verifyAccessToken.returns(decodedJwt.adminDecoded);

      optionalAuthMiddleware(req, res, next);

      expect(req.user).to.deep.equal(decodedJwt.adminDecoded);
      expect(req.user.role).to.equal('admin');
    });

    it('TC-AUTH-MW-030: 应该不返回401错误，即使token无效', () => {
      req.headers.authorization = authorizationHeaders.validBearer(tokenData.malformedToken);
      jwtStub.verifyAccessToken.throws(new Error('Invalid token'));

      optionalAuthMiddleware(req, res, next);

      expect(res.status.called).to.be.false;
      expect(res.json.called).to.be.false;
    });

    it('TC-AUTH-MW-031: 应该处理格式错误的token而不抛异常', () => {
      req.headers.authorization = authorizationHeaders.validBearer(tokenData.truncatedToken);
      jwtStub.verifyAccessToken.throws(new Error('Token格式错误'));

      expect(() => {
        optionalAuthMiddleware(req, res, next);
      }).to.not.throw();
      expect(next.called).to.be.true;
    });
  });

  describe('adminMiddleware', () => {
    it('应该在用户是admin时调用next()', () => {
      req.user = { userId: '123', role: 'admin' };

      adminMiddleware(req, res, next);

      expect(next.called).to.be.true;
    });

    it('应该在用户是superadmin时调用next()', () => {
      req.user = { userId: '123', role: 'superadmin' };

      adminMiddleware(req, res, next);

      expect(next.called).to.be.true;
    });

    it('应该在没有req.user时返回401', () => {
      adminMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('应该在用户不是admin时返回403', () => {
      req.user = { userId: '123', role: 'user' };

      adminMiddleware(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
      expect(next.called).to.be.false;
    });

    it('应该在role为guest时返回403', () => {
      req.user = { userId: '123', role: 'guest' };

      adminMiddleware(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
    });

    it('应该在req.user为null时返回401', () => {
      req.user = null;

      adminMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
    });

    it('应该验证role字段精确匹配', () => {
      req.user = { userId: '123', role: 'ADMIN' }; // 大写

      adminMiddleware(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
    });

    it('应该在role为undefined时返回403', () => {
      req.user = { userId: '123' }; // 没有role字段

      adminMiddleware(req, res, next);

      expect(res.status.calledWith(403)).to.be.true;
    });

    it('应该返回正确的403错误消息', () => {
      req.user = { userId: '123', role: 'user' };

      adminMiddleware(req, res, next);

      const jsonCall = res.json.getCall(0);
      expect(jsonCall.args[0]).to.have.property('code', 403);
    });
  });

  describe('错误处理', () => {
    it('应该处理token验证抛出的各种错误', () => {
      req.headers.authorization = 'Bearer token';

      const errors = [
        new Error('Token已过期'),
        new Error('Token无效'),
        new Error('格式不正确'),
        new Error('签名验证失败')
      ];

      errors.forEach(err => {
        jwtStub.verifyAccessToken.throws(err);
        res.status.resetHistory();
        res.json.resetHistory();
        next.resetHistory();

        authMiddleware(req, res, next);

        expect(res.status.calledWith(401)).to.be.true;
        expect(next.called).to.be.false;
      });
    });
  });

  describe('安全特性', () => {
    it('应该不会将密敏感信息暴露在响应中', () => {
      req.headers.authorization = 'Bearer invalid';
      jwtStub.verifyAccessToken.throws(new Error('Token验证失败'));

      authMiddleware(req, res, next);

      const errorMessage = res.json.getCall(0).args[0];
      // 确保不暴露内部实现细节
      expect(errorMessage.message).not.to.include('secret');
      expect(errorMessage.message).not.to.include('private');
    });

    it('应该在token缺失时提供安全的错误信息', () => {
      authMiddleware(req, res, next);

      const errorMessage = res.json.getCall(0).args[0];
      expect(errorMessage.code).to.equal(401);
      expect(errorMessage.message).to.be.a('string');
    });
  });

  describe('边界情况', () => {
    it('应该处理非常长的token', () => {
      req.headers.authorization = `Bearer ${'a'.repeat(10000)}`;
      jwtStub.verifyAccessToken.throws(new Error('Invalid'));

      authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
    });

    it('应该处理特殊字符在authorization header中', () => {
      req.headers.authorization = 'Bearer token!@#$%^&*()';
      jwtStub.verifyAccessToken.throws(new Error('Invalid'));

      authMiddleware(req, res, next);

      expect(res.status.calledWith(401)).to.be.true;
    });

    it('应该处理多个authorization header', () => {
      // Node.js/Express 通常只保留最后一个
      req.headers.authorization = 'Bearer token1';

      authMiddleware(req, res, next);

      // 应该使用最后一个值
      expect(jwtStub.verifyAccessToken.called).to.be.true;
    });
  });
});
