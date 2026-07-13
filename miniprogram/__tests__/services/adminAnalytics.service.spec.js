const request = require('../../utils/request');
const adminAnalyticsService = require('../../pages/admin-analytics/adminAnalytics.service');

jest.mock('../../utils/request');

describe('Admin Analytics Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    request.get.mockResolvedValue({});
  });

  test('should request mobile admin periods', async () => {
    await adminAnalyticsService.getPeriods();

    expect(request.get).toHaveBeenCalledWith(
      '/mobile-admin/analytics/periods',
      {},
      { showLoading: false }
    );
  });

  test('should request overview with cleaned params', async () => {
    await adminAnalyticsService.getOverview({
      startDate: '2026-06-01',
      endDate: '2026-06-28',
      periodId: '',
      ignored: null
    });

    expect(request.get).toHaveBeenCalledWith(
      '/mobile-admin/analytics/overview',
      {
        startDate: '2026-06-01',
        endDate: '2026-06-28'
      },
      { showLoading: false }
    );
  });

  test('should request activity with period filter', async () => {
    await adminAnalyticsService.getActivity({
      startDate: '2026-06-01',
      endDate: '2026-06-28',
      periodId: 'period_1'
    });

    expect(request.get).toHaveBeenCalledWith(
      '/mobile-admin/analytics/activity',
      {
        startDate: '2026-06-01',
        endDate: '2026-06-28',
        periodId: 'period_1'
      },
      { showLoading: false }
    );
  });
});
