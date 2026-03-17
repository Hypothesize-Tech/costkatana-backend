/**
 * Bridge for legacy Express middleware.
 * Request prioritization is handled by PriorityQueueService in GatewayModule.
 */
export type RequestPriority = 'critical' | 'high' | 'medium' | 'low' | 'bulk' | 'background';

export const requestPrioritizationService = {
  getPriority: () => 'medium' as RequestPriority,
  shouldThrottle: () => false,
  enqueueRequest: async (
    _reqOrPriority: unknown,
    _path?: string,
    _method?: string,
    _processor?: unknown,
    _metadata?: unknown,
  ) => '',
  getDetailedStats: async () => ({}),
  clearQueues: async () => {},
};
