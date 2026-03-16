/**
 * Legacy adapter for Express telemetry controller.
 * Provides static methods matching the old TelemetryService API.
 * When running Express (server.ts), these return stub data.
 * For production (Nest main.ts), use the Nest telemetry endpoints instead.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

const metricsStub = {
  requests_per_minute: 0,
  error_rate: 0,
  avg_duration_ms: 0,
  p95_duration_ms: 0,
  top_operations: [] as Array<{ operation: string; count: number; avgDuration: number; avgCost: number }>,
  cost_by_model: [] as Array<{ model: string; count: number; avgCost: number }>,
};

export const TelemetryServiceLegacy = {
  queryTelemetry: async (_query: Record<string, unknown>) => ({
    data: [] as unknown[],
    total: 0,
    page: 1,
    limit: 100,
  }),

  getTraceDetails: async (_traceId: string) => ({
    trace: { id: '', spans: [], summary: { totalSpans: 0, totalDuration: 0, totalCost: 0, errorCount: 0, startTime: new Date(), endTime: new Date() } },
  }),

  getPerformanceMetrics: async (_options?: Record<string, unknown>) => metricsStub,

  getServiceDependencies: async (_timeframe?: string) => [],

  getUnifiedDashboardData: async (_query?: Record<string, unknown>) => ({
    last5min: metricsStub,
    last1hour: metricsStub,
    last24hours: metricsStub,
    serviceDeps: [],
    recentErrors: { data: [] },
    highCostOps: { data: [] },
  }),

  getEnrichmentStats: async (_query?: string | Record<string, unknown>) => ({
    total: 0,
    enriched: 0,
    pending: 0,
  }),

  getEnrichedSpans: async (_query?: Record<string, unknown>) => [],

  generateAIRecommendations: async (_timeframe?: string) => [],

  autoEnrichSpans: async () => undefined,

  startBackgroundEnrichment: () => undefined,
};
