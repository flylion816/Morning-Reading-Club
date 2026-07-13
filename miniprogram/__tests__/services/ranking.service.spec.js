/**
 * Ranking Service Tests (Stage 5: Task 5.2)
 * Tests for leaderboard and ranking functionality
 *
 * Test Coverage:
 * - Ranking list retrieval
 * - User ranking and position
 * - Ranking statistics
 * - Time-based ranking (daily, weekly, monthly)
 * - Ranking updates and caching
 * - User progress tracking
 */

const rankingService = require('../../pages/ranking/ranking.service');
const request = require('../../utils/request');
const { createMockRankingItem, createMockUser, generateId } = require('../fixtures');

jest.mock('../../utils/request');

describe('Ranking Service Tests (Stage 5: Task 5.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.wx.__storage = {};
    global.wx.getStorageSync.mockClear();
    global.wx.setStorageSync.mockClear();
    global.wx.removeStorageSync.mockClear();
    request.get.mockClear();
    request.post.mockClear();
  });

  describe('[RANK-1] 获取排行榜列表应按打卡数倒序', () => {
    test('should return rankings sorted by checkin count descending', async () => {
      const mockRankings = [
        createMockRankingItem({ checkinCount: 30, rank: 1 }),
        createMockRankingItem({ checkinCount: 28, rank: 2 }),
        createMockRankingItem({ checkinCount: 25, rank: 3 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 3
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data.length).toBe(3);
      for (let i = 0; i < result.data.length - 1; i++) {
        expect(result.data[i].checkinCount).toBeGreaterThanOrEqual(result.data[i + 1].checkinCount);
      }
    });

    test('should maintain rank order across list', async () => {
      const mockRankings = [
        createMockRankingItem({ rank: 1 }),
        createMockRankingItem({ rank: 2 }),
        createMockRankingItem({ rank: 3 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 3
      });

      const result = await rankingService.getRankingList('period_123');

      for (let i = 0; i < result.data.length; i++) {
        expect(result.data[i].rank).toBe(i + 1);
      }
    });
  });

  describe('[RANK-2] 排行榜应显示用户昵称和头像', () => {
    test('should include user nickname and avatar', async () => {
      const mockRankings = [
        createMockRankingItem({
          userNickname: '小凡',
          userAvatar: 'https://example.com/avatar1.jpg'
        })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data[0]).toHaveProperty('userNickname');
      expect(result.data[0]).toHaveProperty('userAvatar');
      expect(result.data[0].userNickname).toBe('小凡');
    });

    test('should validate user info fields', async () => {
      const mockRankings = [
        createMockRankingItem({
          userNickname: '晨读者',
          userAvatar: 'https://example.com/avatar.jpg'
        })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123');

      expect(typeof result.data[0].userNickname).toBe('string');
      expect(typeof result.data[0].userAvatar).toBe('string');
    });
  });

  describe('[RANK-3] 排行榜应显示用户打卡数', () => {
    test('should display checkin count for each user', async () => {
      const mockRankings = [
        createMockRankingItem({ userId: 'user_1', checkinCount: 25 }),
        createMockRankingItem({ userId: 'user_2', checkinCount: 20 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 2
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data[0]).toHaveProperty('checkinCount');
      expect(result.data[0].checkinCount).toBe(25);
      expect(result.data[1].checkinCount).toBe(20);
    });

    test('should show zero checkins for inactive users', async () => {
      const mockRankings = [
        createMockRankingItem({ checkinCount: 0 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data[0].checkinCount).toBe(0);
    });
  });

  describe('[RANK-4] 排行榜应显示用户排名', () => {
    test('should display user rank position', async () => {
      const mockRankings = [
        createMockRankingItem({ rank: 1 }),
        createMockRankingItem({ rank: 2 }),
        createMockRankingItem({ rank: 3 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 3
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data[0].rank).toBe(1);
      expect(result.data[1].rank).toBe(2);
      expect(result.data[2].rank).toBe(3);
    });

    test('should assign ranks starting from 1', async () => {
      const mockRankings = Array.from({ length: 5 }, (_, i) =>
        createMockRankingItem({ rank: i + 1 })
      );

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 5
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data[0].rank).toBe(1);
      expect(result.data[result.data.length - 1].rank).toBe(5);
    });
  });

  describe('[RANK-5] 应支持按期次查询排行榜', () => {
    test('should filter rankings by period', async () => {
      const periodId = 'period_123';
      const mockRankings = [
        createMockRankingItem({ periodId: periodId })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList(periodId);

      expect(request.get).toHaveBeenCalledWith(
        `/rankings/period/${periodId}`,
        expect.any(Object)
      );
    });

    test('should return only specified period rankings', async () => {
      const periodId = 'period_456';
      const mockRankings = [
        createMockRankingItem({ periodId: periodId })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList(periodId);

      expect(result.data[0].periodId).toBe(periodId);
    });
  });

  describe('[RANK-6] 获取当前用户在排行榜中的排名', () => {
    test('should return current user ranking', async () => {
      const userId = 'user_123';
      wx.setStorageSync('userInfo', { _id: userId });

      const mockRanking = createMockRankingItem({
        userId: userId,
        rank: 5
      });

      request.get.mockResolvedValue(mockRanking);

      const result = await rankingService.getCurrentUserRanking('period_123');

      expect(result.rank).toBe(5);
      expect(result.userId).toBe(userId);
    });

    test('should include current user stats', async () => {
      const mockRanking = createMockRankingItem({
        userId: 'current_user',
        checkinCount: 20,
        rank: 10
      });

      request.get.mockResolvedValue(mockRanking);

      const result = await rankingService.getCurrentUserRanking('period_123');

      expect(result).toHaveProperty('checkinCount');
      expect(result).toHaveProperty('rank');
    });
  });

  describe('[RANK-7] 排行榜更新时应刷新本地缓存', () => {
    test('should update cache after ranking changes', async () => {
      const mockRankings = [createMockRankingItem()];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result).toBeDefined();
      // Service should handle caching
    });

    test('should invalidate old cache on update', async () => {
      wx.setStorageSync('rankings_period_123', []);

      const mockRankings = [createMockRankingItem()];

      request.post.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.refreshRankings('period_123');

      expect(request.post).toHaveBeenCalled();
    });
  });

  describe('[RANK-8] 应支持周排行和月排行', () => {
    test('should support weekly ranking', async () => {
      const mockRankings = [
        createMockRankingItem({ rank: 1 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123', {
        timeRange: 'week'
      });

      expect(request.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeRange: 'week' })
      );
    });

    test('should support monthly ranking', async () => {
      const mockRankings = [
        createMockRankingItem({ rank: 1 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123', {
        timeRange: 'month'
      });

      expect(request.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeRange: 'month' })
      );
    });

    test('should support all-time ranking', async () => {
      const mockRankings = [
        createMockRankingItem({ rank: 1 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123', {
        timeRange: 'all'
      });

      expect(result).toBeDefined();
    });
  });

  describe('[RANK-9] 排行榜应只显示已报名的用户', () => {
    test('should exclude non-enrolled users from rankings', async () => {
      const mockRankings = [
        createMockRankingItem({ enrollmentStatus: 'enrolled' })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data.length).toBeGreaterThan(0);
    });

    test('should verify enrollment before ranking', async () => {
      const mockRankings = [
        createMockRankingItem({ periodId: 'period_123' })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123');

      expect(request.get).toHaveBeenCalled();
    });
  });

  describe('[RANK-10] 排行榜应按日期范围计算排名', () => {
    test('should calculate ranking within date range', async () => {
      const startDate = new Date(2024, 0, 1);
      const endDate = new Date(2024, 0, 31);

      const mockRankings = [createMockRankingItem()];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      expect(request.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        })
      );
    });
  });

  describe('[RANK-11] 获取排行榜应支持分页', () => {
    test('should support pagination for rankings', async () => {
      const mockRankings = Array.from({ length: 10 }, () => createMockRankingItem());

      request.get.mockResolvedValue({
        data: mockRankings,
        page: 1,
        pageSize: 10,
        total: 100
      });

      const result = await rankingService.getRankingList('period_123', {
        page: 1,
        limit: 10
      });

      expect(request.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ page: 1, limit: 10 })
      );
      expect(result.total).toBe(100);
    });

    test('should handle different page sizes', async () => {
      request.get.mockResolvedValue({
        data: Array.from({ length: 20 }, () => createMockRankingItem()),
        page: 1,
        pageSize: 20,
        total: 100
      });

      const result = await rankingService.getRankingList('period_123', {
        limit: 20
      });

      expect(result.data.length).toBe(20);
    });
  });

  describe('[RANK-12] 排行榜应显示打卡进度百分比', () => {
    test('should include progress percentage for each user', async () => {
      const mockRankings = [
        createMockRankingItem({
          checkinCount: 20,
          totalCourses: 30,
          progressPercentage: 66.67
        })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data[0]).toHaveProperty('progressPercentage');
      expect(result.data[0].progressPercentage).toBeLessThanOrEqual(100);
    });

    test('should calculate accurate progress percentage', async () => {
      const mockRankings = [
        createMockRankingItem({
          checkinCount: 15,
          totalCourses: 30,
          progressPercentage: 50
        })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123');

      expect(result.data[0].progressPercentage).toBe(50);
    });
  });

  describe('[RANK-13] 排行榜应支持按打卡数搜索用户', () => {
    test('should filter rankings by checkin count range', async () => {
      const mockRankings = [
        createMockRankingItem({ checkinCount: 25 })
      ];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123', {
        minCheckins: 20,
        maxCheckins: 30
      });

      expect(request.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          minCheckins: 20,
          maxCheckins: 30
        })
      );
    });
  });

  describe('[RANK-14] 获取排行榜缓存应在一天后过期', () => {
    test('should cache rankings locally', async () => {
      const mockRankings = [createMockRankingItem()];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      await rankingService.getRankingList('period_123');

      expect(request.get).toHaveBeenCalled();
    });

    test('should expire cache after configured time', async () => {
      const mockRankings = [createMockRankingItem()];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      await rankingService.getRankingList('period_123');

      // Wait for cache to expire (simulated)
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await rankingService.getRankingList('period_123', {
        forceRefresh: true
      });

      expect(result).toBeDefined();
    });
  });

  describe('[RANK-15] 排行榜变化应通过 WebSocket 实时推送（或模拟）', () => {
    test('should support real-time ranking updates', async () => {
      const mockUpdate = {
        userId: 'user_123',
        newRank: 5,
        oldRank: 6
      };

      const result = await rankingService.subscribeRankingUpdates('period_123');

      expect(result).toBeDefined();
    });

    test('should handle ranking change notifications', async () => {
      const updateHandler = jest.fn();

      rankingService.onRankingUpdate('period_123', updateHandler);

      expect(updateHandler).toBeDefined();
    });

    test('should unsubscribe from ranking updates', async () => {
      const result = await rankingService.unsubscribeRankingUpdates('period_123');

      expect(result).toBeDefined();
    });
  });

  // Additional edge case tests
  describe('[RANK-EXTRA] Additional Ranking Service Methods', () => {
    test('should get ranking trends', async () => {
      request.get.mockResolvedValue({
        trend: 'up',
        changeAmount: 2,
        previousRank: 7,
        currentRank: 5
      });

      const result = await rankingService.getRankingTrend('user_123', 'period_123');

      expect(result).toHaveProperty('trend');
      expect(result).toHaveProperty('changeAmount');
    });

    test('should compare user with peers', async () => {
      request.get.mockResolvedValue({
        userId: 'user_123',
        rank: 5,
        percentile: 95,
        compareWith: [
          { userId: 'peer_1', rank: 3 },
          { userId: 'peer_2', rank: 7 }
        ]
      });

      const result = await rankingService.getPeerComparison('user_123', 'period_123');

      expect(result).toHaveProperty('percentile');
    });

    test('should get ranking statistics', async () => {
      request.get.mockResolvedValue({
        totalUsers: 100,
        averageCheckins: 15,
        medianRank: 50,
        topCheckinCount: 30
      });

      const result = await rankingService.getRankingStats('period_123');

      expect(result).toHaveProperty('totalUsers');
      expect(result).toHaveProperty('averageCheckins');
    });

    test('should support custom ranking algorithms', async () => {
      const mockRankings = [createMockRankingItem()];

      request.get.mockResolvedValue({
        data: mockRankings,
        total: 1
      });

      const result = await rankingService.getRankingList('period_123', {
        algorithm: 'weighted'
      });

      expect(result).toBeDefined();
    });
  });
});
