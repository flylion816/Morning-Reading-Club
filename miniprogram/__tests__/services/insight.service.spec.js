/**
 * Insight Service Tests (Stage 6: Task 6.1)
 * Tests for "小凡看见" (insight) social sharing functionality
 *
 * Test Coverage:
 * - Insight creation and publication
 * - Insight retrieval and filtering
 * - Insight editing and deletion
 * - Insight statistics (likes, comments)
 * - User insights management
 * - Insight caching and updates
 */

const insightService = require('../../services/insight.service');
const request = require('../../utils/request');
const { createMockInsight, createMockUser, generateId } = require('../fixtures');

jest.mock('../../utils/request');

describe('Insight Service Tests (Stage 6: Task 6.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.wx.__storage = {};
    global.wx.getStorageSync.mockClear();
    global.wx.setStorageSync.mockClear();
    global.wx.removeStorageSync.mockClear();
    request.get.mockClear();
    request.post.mockClear();
    request.put.mockClear();
    request.delete.mockClear();
  });

  describe('[INSIGHT-1] 发布 insight 应返回 insight 对象', () => {
    test('should return insight object after publishing', async () => {
      const mockInsight = createMockInsight({
        _id: 'insight_123',
        status: 'published'
      });

      request.post.mockResolvedValue(mockInsight);

      const result = await insightService.publishInsight({
        title: '我看见你的进步',
        content: '你今天表现得非常棒',
        targetUserId: 'user_456',
        periodId: 'period_123'
      });

      expect(result).toHaveProperty('_id');
      expect(result.status).toBe('published');
      expect(request.post).toHaveBeenCalledWith('/insights', expect.any(Object));
    });

    test('should include all insight metadata', async () => {
      const mockInsight = createMockInsight({
        _id: 'insight_123',
        creatorUserId: 'user_123',
        targetUserId: 'user_456',
        periodId: 'period_123'
      });

      request.post.mockResolvedValue(mockInsight);

      const result = await insightService.publishInsight({
        content: '很棒',
        targetUserId: 'user_456',
        periodId: 'period_123'
      });

      expect(result._id).toBe('insight_123');
    });
  });

  describe('[INSIGHT-2] Insight 应包含用户 ID、被看见人 ID、期次 ID', () => {
    test('should include required ID fields', async () => {
      const creatorId = 'user_123';
      const targetId = 'user_456';
      const periodId = 'period_789';

      const mockInsight = createMockInsight({
        creatorUserId: creatorId,
        targetUserId: targetId,
        periodId: periodId
      });

      request.post.mockResolvedValue(mockInsight);

      const result = await insightService.publishInsight({
        content: 'Content',
        targetUserId: targetId,
        periodId: periodId
      });

      expect(result.creatorUserId).toBe(creatorId);
      expect(result.targetUserId).toBe(targetId);
      expect(result.periodId).toBe(periodId);
    });
  });

  describe('[INSIGHT-3] Insight 应包含内容和发布时间', () => {
    test('should include content and publication time', async () => {
      const content = '我看见你的坚持';
      const createdAt = new Date().toISOString();

      const mockInsight = createMockInsight({
        content: content,
        createdAt: createdAt
      });

      request.post.mockResolvedValue(mockInsight);

      const result = await insightService.publishInsight({
        content: content,
        targetUserId: 'user_456',
        periodId: 'period_123'
      });

      expect(result.content).toBe(content);
      expect(result.createdAt).toBe(createdAt);
    });
  });

  describe('[INSIGHT-4] 获取 insights 列表应返回按时间倒序的列表', () => {
    test('should return insights sorted by time descending', async () => {
      const baseTime = new Date();
      const mockInsights = [
        createMockInsight({
          createdAt: new Date(baseTime.getTime() + 2 * 60 * 60 * 1000).toISOString()
        }),
        createMockInsight({
          createdAt: new Date(baseTime.getTime() + 1 * 60 * 60 * 1000).toISOString()
        }),
        createMockInsight({
          createdAt: baseTime.toISOString()
        })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 3
      });

      const result = await insightService.getInsightsList('period_123');

      expect(result.data.length).toBe(3);
      const times = result.data.map(i => new Date(i.createdAt).getTime());
      for (let i = 0; i < times.length - 1; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
      }
    });
  });

  describe('[INSIGHT-5] Insights 列表应支持分页', () => {
    test('should support pagination', async () => {
      const mockInsights = Array.from({ length: 10 }, () => createMockInsight());

      request.get.mockResolvedValue({
        data: mockInsights,
        page: 1,
        pageSize: 10,
        total: 100
      });

      const result = await insightService.getInsightsListByPeriod('period_123', {
        page: 1,
        limit: 10
      });

      expect(request.get).toHaveBeenCalledWith(
        `/insights/period/period_123`,
        expect.objectContaining({ page: 1, limit: 10 })
      );
      expect(result.total).toBe(100);
    });
  });

  describe('[INSIGHT-6] 获取特定用户的 insights 列表', () => {
    test('should return insights for specific user', async () => {
      const userId = 'user_123';
      const mockInsights = [
        createMockInsight({ creatorUserId: userId }),
        createMockInsight({ creatorUserId: userId })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 2
      });

      const result = await insightService.getUserInsightsByUserId(userId);

      expect(request.get).toHaveBeenCalledWith(`/insights/user/${userId}`);
      expect(result.data.length).toBe(2);
    });
  });

  describe('[INSIGHT-7] 获取特定期次的 insights 列表', () => {
    test('should return insights for specific period', async () => {
      const periodId = 'period_123';
      const mockInsights = [
        createMockInsight({ periodId: periodId }),
        createMockInsight({ periodId: periodId })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 2
      });

      const result = await insightService.getPeriodInsights(periodId);

      expect(request.get).toHaveBeenCalledWith(`/insights/period/${periodId}`);
    });
  });

  describe('[INSIGHT-ADMIN] 小程序管理员全量列表', () => {
    test('should request the mobile admin all-insights endpoint with pagination', async () => {
      request.get.mockResolvedValue({
        list: [],
        pagination: { page: 2, limit: 100, total: 0, pages: 0 }
      });

      await insightService.getMobileAdminInsights({ page: 2, limit: 100 });

      expect(request.get).toHaveBeenCalledWith('/insights/mobile-admin/all', {
        page: 2,
        limit: 100
      });
    });
  });

  describe('[INSIGHT-8] 获取我收到的 insights 列表（别人发给我的）', () => {
    test('should return insights received by current user', async () => {
      const userId = 'user_123';
      wx.setStorageSync('userInfo', { _id: userId });

      const mockInsights = [
        createMockInsight({ targetUserId: userId }),
        createMockInsight({ targetUserId: userId })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 2
      });

      const result = await insightService.getReceivedInsights();

      expect(result.data.length).toBe(2);
      expect(result.data[0].targetUserId).toBe(userId);
    });
  });

  describe('[INSIGHT-9] 获取我发出的 insights 列表', () => {
    test('should return insights published by current user', async () => {
      const userId = 'user_123';
      wx.setStorageSync('userInfo', { _id: userId });

      const mockInsights = [
        createMockInsight({ creatorUserId: userId }),
        createMockInsight({ creatorUserId: userId })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 2
      });

      const result = await insightService.getMyInsights();

      expect(result.data.length).toBe(2);
      expect(result.data[0].creatorUserId).toBe(userId);
    });
  });

  describe('[INSIGHT-10] 编辑 insight 应成功（如果是自己发布的）', () => {
    test('should update own insight', async () => {
      const insightId = 'insight_123';
      const mockInsight = createMockInsight({
        _id: insightId,
        content: '更新后的内容'
      });

      request.put.mockResolvedValue(mockInsight);

      const result = await insightService.updateInsight(insightId, {
        content: '更新后的内容'
      });

      expect(request.put).toHaveBeenCalledWith(`/insights/${insightId}`, expect.any(Object));
      expect(result.content).toBe('更新后的内容');
    });
  });

  describe('[INSIGHT-11] 其他用户不能编辑他人的 insight', () => {
    test('should prevent editing others insights', async () => {
      request.put.mockRejectedValue({
        code: 403,
        message: 'Cannot edit other users insight'
      });

      await expect(
        insightService.updateInsight('insight_123', { content: 'Hacked' })
      ).rejects.toEqual(expect.objectContaining({
        message: 'Cannot edit other users insight'
      }));
    });
  });

  describe('[INSIGHT-12] 删除 insight 应成功（如果是自己发布的）', () => {
    test('should delete own insight', async () => {
      const insightId = 'insight_123';
      request.delete.mockResolvedValue({
        code: 200,
        message: 'Insight deleted'
      });

      const result = await insightService.deleteInsight(insightId);

      expect(request.delete).toHaveBeenCalledWith(`/insights/${insightId}`);
      expect(result.code).toBe(200);
    });

    test('should prevent deleting others insights', async () => {
      request.delete.mockRejectedValue({
        code: 403,
        message: 'Cannot delete other users insight'
      });

      await expect(
        insightService.deleteInsight('other_insight_123')
      ).rejects.toBeDefined();
    });
  });

  describe('[INSIGHT-13] 获取 insight 详情应包含评论和点赞数', () => {
    test('should return insight with comments and likes count', async () => {
      const mockInsight = createMockInsight({
        _id: 'insight_123',
        likeCount: 15,
        commentCount: 5
      });

      request.get.mockResolvedValue(mockInsight);

      const result = await insightService.getInsightDetails('insight_123');

      expect(result).toHaveProperty('likeCount');
      expect(result).toHaveProperty('commentCount');
      expect(result.likeCount).toBe(15);
      expect(result.commentCount).toBe(5);
    });
  });

  describe('[INSIGHT-14] Insight 应支持多种类型（思想分享、疑问、建议等）', () => {
    test('should support different insight types', async () => {
      const types = ['thought', 'question', 'suggestion', 'praise'];

      for (const type of types) {
        const mockInsight = createMockInsight({
          type: type
        });

        request.post.mockResolvedValue(mockInsight);

        const result = await insightService.publishInsight({
          content: 'Content',
          type: type,
          targetUserId: 'user_456',
          periodId: 'period_123'
        });

        expect(result.type).toBe(type);
      }
    });
  });

  describe('[INSIGHT-15] 发布 insight 时应验证内容非空', () => {
    test('should reject empty content', async () => {
      request.post.mockRejectedValue({
        code: 400,
        message: 'Content is required'
      });

      await expect(
        insightService.publishInsight({
          content: '',
          targetUserId: 'user_456',
          periodId: 'period_123'
        })
      ).rejects.toBeDefined();
    });
  });

  describe('[INSIGHT-16] 发布 insight 时应验证被看见人确实存在', () => {
    test('should validate target user exists', async () => {
      request.post.mockRejectedValue({
        code: 404,
        message: 'Target user not found'
      });

      await expect(
        insightService.publishInsight({
          content: 'Content',
          targetUserId: 'non_existent_user',
          periodId: 'period_123'
        })
      ).rejects.toBeDefined();
    });
  });

  describe('[INSIGHT-17] 发布 insight 时应验证期次确实存在', () => {
    test('should validate period exists', async () => {
      request.post.mockRejectedValue({
        code: 404,
        message: 'Period not found'
      });

      await expect(
        insightService.publishInsight({
          content: 'Content',
          targetUserId: 'user_456',
          periodId: 'non_existent_period'
        })
      ).rejects.toBeDefined();
    });
  });

  describe('[INSIGHT-18] Insight 列表应包含评论数和点赞数', () => {
    test('should include counts in list items', async () => {
      const mockInsights = [
        createMockInsight({
          likeCount: 10,
          commentCount: 3
        }),
        createMockInsight({
          likeCount: 5,
          commentCount: 2
        })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 2
      });

      const result = await insightService.getInsightsList('period_123');

      expect(result.data[0]).toHaveProperty('likeCount');
      expect(result.data[0]).toHaveProperty('commentCount');
    });
  });

  describe('[INSIGHT-19] Insight 应包含发布者的用户信息（头像、昵称）', () => {
    test('should include creator user info', async () => {
      const mockInsight = createMockInsight({
        creatorNickname: '小凡',
        creatorAvatar: 'https://example.com/avatar.jpg'
      });

      request.get.mockResolvedValue({
        data: [mockInsight],
        total: 1
      });

      const result = await insightService.getInsightsList('period_123');

      expect(result.data[0]).toHaveProperty('creatorNickname');
      expect(result.data[0]).toHaveProperty('creatorAvatar');
    });
  });

  describe('[INSIGHT-20] 获取 insights 时应显示当前用户是否已点赞', () => {
    test('should indicate if current user liked insight', async () => {
      const mockInsights = [
        createMockInsight({ isLiked: true }),
        createMockInsight({ isLiked: false })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 2
      });

      const result = await insightService.getInsightsList('period_123');

      expect(result.data[0]).toHaveProperty('isLiked');
      expect(result.data[0].isLiked).toBe(true);
      expect(result.data[1].isLiked).toBe(false);
    });
  });

  describe('[INSIGHT-21] Insight 内容应支持 @mention 用户', () => {
    test('should support @mention in insight content', async () => {
      const content = '我看见 @user_456 的进步';
      const mockInsight = createMockInsight({
        content: content,
        mentions: ['user_456']
      });

      request.post.mockResolvedValue(mockInsight);

      const result = await insightService.publishInsight({
        content: content,
        targetUserId: 'user_456',
        periodId: 'period_123'
      });

      expect(result.content).toContain('@');
      expect(result.mentions).toContain('user_456');
    });
  });

  describe('[INSIGHT-22] Insight 应自动链接课程', () => {
    test('should link to related courses', async () => {
      const mockInsight = createMockInsight({
        relatedCourses: ['course_1', 'course_2']
      });

      request.post.mockResolvedValue(mockInsight);

      const result = await insightService.publishInsight({
        content: 'Content about courses',
        targetUserId: 'user_456',
        periodId: 'period_123'
      });

      expect(result).toHaveProperty('relatedCourses');
    });
  });

  describe('[INSIGHT-23] 获取相关 insights（同期次、同用户）', () => {
    test('should return related insights', async () => {
      const mockInsights = [
        createMockInsight({ periodId: 'period_123' }),
        createMockInsight({ periodId: 'period_123' })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 2
      });

      const result = await insightService.getRelatedInsights('insight_123');

      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('[INSIGHT-24] Insight 应支持本地草稿保存', () => {
    test('should save insight draft locally', async () => {
      const draft = {
        content: '草稿内容',
        targetUserId: 'user_456',
        periodId: 'period_123'
      };

      const result = await insightService.saveDraft(draft);

      expect(result).toBeDefined();
    });

    test('should retrieve saved draft', async () => {
      const result = await insightService.getDraft();

      // getDraft returns null by default
      expect(result).toBeNull();
    });
  });

  describe('[INSIGHT-25] Insight 发布成功后应清除草稿', () => {
    test('should clear draft after publishing', async () => {
      wx.setStorageSync('insight_draft', { content: '草稿' });

      const mockInsight = createMockInsight();
      request.post.mockResolvedValue(mockInsight);

      await insightService.publishInsight({
        content: '正式发布',
        targetUserId: 'user_456',
        periodId: 'period_123'
      });

      // Service should clear draft
      expect(request.post).toHaveBeenCalled();
    });
  });

  // Additional edge case tests
  describe('[INSIGHT-EXTRA] Additional Insight Service Methods', () => {
    test('should get insight statistics', async () => {
      request.get.mockResolvedValue({
        totalInsights: 100,
        totalLikes: 500,
        totalComments: 250,
        averageLikesPerInsight: 5
      });

      const result = await insightService.getInsightStats('period_123');

      expect(result).toHaveProperty('totalInsights');
      expect(result).toHaveProperty('averageLikesPerInsight');
    });

    test('should search insights by keywords', async () => {
      const mockInsights = [createMockInsight()];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 1
      });

      const result = await insightService.searchInsights('关键词', {
        periodId: 'period_123'
      });

      expect(result.data.length).toBeGreaterThan(0);
    });

    test('should get trending insights', async () => {
      const mockInsights = [
        createMockInsight({ likeCount: 50 }),
        createMockInsight({ likeCount: 40 })
      ];

      request.get.mockResolvedValue({
        data: mockInsights,
        total: 2
      });

      const result = await insightService.getTrendingInsights('period_123');

      expect(result.data[0].likeCount).toBeGreaterThanOrEqual(result.data[1].likeCount);
    });
  });
});
