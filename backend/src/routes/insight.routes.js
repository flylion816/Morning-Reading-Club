const express = require('express');
const router = express.Router();
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const { adminAuthMiddleware } = require('../middleware/adminAuth');
const {
  userTenantContext,
  adminTenantContext,
  publicTenantContext,
  optionalUserOrPublicTenantContext
} = require('../middleware/tenantContext');
const {
  generateInsight,
  getUserInsights,
  getMobileAdminInsights,
  getInsightDetail,
  deleteInsight,
  createInsightManual,
  createInsightFromExternal,
  getInsights,
  getInsightsForPeriod,
  updateInsight,
  deleteInsightManual,
  likeInsight,
  unlikeInsight,
  postDanmaku,
  getDanmaku,
  adminGetInsightDetail,
  adminGetDanmaku,
  adminLikeForUser,
  adminPostDanmakuForUser,
  adminDeleteDanmaku,
  createInsightRequest,
  getReceivedRequests,
  getSentRequests,
  getRequestStatus,
  approveInsightRequest,
  rejectInsightRequest,
  revokeInsightRequest,
  getInsightRequestsAdmin,
  getInsightRequestsStats,
  adminApproveRequest,
  adminRejectRequest,
  deleteInsightRequest,
  batchApproveRequests,
  getSectionInsightsForAdmin,
  recordShare,
  searchInsights
} = require('../controllers/insight.controller');

// ===== 外部公开接口（无需认证） =====
router.post('/external/create', publicTenantContext, createInsightFromExternal);

// ===== 管理员路由 =====
router.get('/', adminAuthMiddleware, adminTenantContext, getInsights);
router.get('/admin/:insightId/detail', adminAuthMiddleware, adminTenantContext, adminGetInsightDetail);
router.get('/admin/:insightId/danmaku', adminAuthMiddleware, adminTenantContext, adminGetDanmaku);
router.post('/admin/:insightId/like', adminAuthMiddleware, adminTenantContext, adminLikeForUser);
router.post('/admin/:insightId/danmaku', adminAuthMiddleware, adminTenantContext, adminPostDanmakuForUser);
router.delete('/admin/danmaku/:danmakuId', adminAuthMiddleware, adminTenantContext, adminDeleteDanmaku);
router.put('/admin/:insightId', adminAuthMiddleware, adminTenantContext, updateInsight);
router.post('/manual/create', adminAuthMiddleware, adminTenantContext, createInsightManual);
router.delete('/manual/:insightId', adminAuthMiddleware, adminTenantContext, deleteInsightManual);
router.get('/admin/requests', adminAuthMiddleware, adminTenantContext, getInsightRequestsAdmin);
router.get('/admin/requests/stats', adminAuthMiddleware, adminTenantContext, getInsightRequestsStats);
router.put('/admin/requests/:requestId/approve', adminAuthMiddleware, adminTenantContext, adminApproveRequest);
router.put('/admin/requests/:requestId/reject', adminAuthMiddleware, adminTenantContext, adminRejectRequest);
router.delete('/admin/requests/:requestId', adminAuthMiddleware, adminTenantContext, deleteInsightRequest);
router.post('/admin/requests/batch-approve', adminAuthMiddleware, adminTenantContext, batchApproveRequests);

// ===== 用户路由 =====
router.post('/', authMiddleware, userTenantContext, createInsightManual);
router.get('/section/:sectionId', authMiddleware, userTenantContext, getSectionInsightsForAdmin);
router.post('/generate', authMiddleware, userTenantContext, generateInsight);
router.post('/requests', authMiddleware, userTenantContext, createInsightRequest);
router.get('/requests/status/:userId', authMiddleware, userTenantContext, getRequestStatus);
router.get('/requests/received', authMiddleware, userTenantContext, getReceivedRequests);
router.get('/requests/sent', authMiddleware, userTenantContext, getSentRequests);
router.post('/requests/:requestId/approve', authMiddleware, userTenantContext, approveInsightRequest);
router.post('/requests/:requestId/reject', authMiddleware, userTenantContext, rejectInsightRequest);
router.put('/requests/:requestId/revoke', authMiddleware, userTenantContext, revokeInsightRequest);
router.get('/search', authMiddleware, userTenantContext, searchInsights);
router.get('/mobile-admin/all', authMiddleware, userTenantContext, getMobileAdminInsights);
router.get('/user/:userId?', authMiddleware, userTenantContext, getUserInsights);
router.get('/period/:periodId', authMiddleware, userTenantContext, getInsightsForPeriod);
router.put('/:insightId', authMiddleware, userTenantContext, updateInsight);
router.delete('/:insightId', authMiddleware, userTenantContext, deleteInsight);
router.post('/:insightId/like', authMiddleware, userTenantContext, likeInsight);
router.post('/:insightId/unlike', authMiddleware, userTenantContext, unlikeInsight);
router.post('/:insightId/share', optionalAuthMiddleware, optionalUserOrPublicTenantContext, recordShare);
router.get('/:insightId/danmaku', authMiddleware, userTenantContext, getDanmaku);
router.post('/:insightId/danmaku', authMiddleware, userTenantContext, postDanmaku);

// 公开详情页（可选登录）
router.get('/:insightId', optionalAuthMiddleware, optionalUserOrPublicTenantContext, getInsightDetail);

module.exports = router;
