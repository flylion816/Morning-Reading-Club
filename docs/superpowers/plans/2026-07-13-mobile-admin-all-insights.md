# Mobile Admin All Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小程序管理员无需申请授权即可在“他人的”标签查看当前租户所有用户、所有期次的已完成小凡看见。

**Architecture:** 新增受小程序用户 JWT 保护的管理员聚合接口，显式限定管理员角色和租户；小程序管理员分支分页拉取该接口，普通用户保留现有申请授权链路。管理员结果允许包含本人记录，不做去重。

**Tech Stack:** Express、Mongoose、微信小程序原生框架、Mocha/Sinon/Chai、Jest。

---

### Task 1: 后端管理员聚合接口

**Files:**
- Modify: `backend/tests/unit/controllers/insight.controller.test.js`
- Modify: `backend/src/controllers/insight.controller.js`
- Modify: `backend/src/routes/insight.routes.js`

- [x] **Step 1: 写管理员全量读取和普通用户 403 的失败测试**
- [x] **Step 2: 运行 controller 单测，确认因接口缺失而失败**
- [x] **Step 3: 实现 `getMobileAdminInsights`，固定查询当前租户的 completed insight，并返回分页**
- [x] **Step 4: 注册 `/mobile-admin/all` 路由，使用 `authMiddleware` 和 `userTenantContext`**
- [x] **Step 5: 运行 controller 单测，确认通过**

### Task 2: 小程序管理员加载分支

**Files:**
- Modify: `miniprogram/__tests__/services/insight.service.spec.js`
- Modify: `miniprogram/__tests__/pages/insights.spec.js`
- Modify: `miniprogram/services/insight.service.js`
- Modify: `miniprogram/pages/insights/insights.js`

- [x] **Step 1: 写 service 路径、管理员跳过申请列表并合并多页的失败测试**
- [x] **Step 2: 运行 Jest，确认测试因管理员接口方法缺失而失败**
- [x] **Step 3: 新增 `getMobileAdminInsights` service 方法**
- [x] **Step 4: 在 `loadOtherInsights` 中增加管理员分页分支，并保留普通用户原逻辑**
- [x] **Step 5: 运行 insights 页面和 service 测试，确认通过**

### Task 3: 回归、同步与发布

**Files:**
- Verify: `backend/src/controllers/insight.controller.js`
- Verify: `backend/src/routes/insight.routes.js`
- Verify: `miniprogram/pages/insights/insights.js`
- Verify: `miniprogram/services/insight.service.js`

- [x] **Step 1: 运行后端 controller 单测、相关单元回归和 ESLint**
- [x] **Step 2: 运行小程序 insights/service 测试和小程序测试集**
- [x] **Step 3: 审查 diff，确认未夹带隔离工作区之外的改动**
- [x] **Step 4: 将本次改动同步回主工作区，保留用户已有改动**
- [x] **Step 5: 备份服务器目标文件，发布后端代码并 reload PM2**
- [x] **Step 6: 用普通用户和管理员身份验证权限边界、租户边界及线上返回总数**
