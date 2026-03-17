/**
 * Bridge: Re-exports for legacy Express middleware.
 * For NestJS usage, use PriorityQueueService from GatewayModule.
 */
export { PriorityQueueService } from '../modules/gateway/services/priority-queue.service';
export {
  PriorityLevel,
  type QueueStats,
  type PriorityRequest,
} from '../modules/gateway/interfaces/gateway.interfaces';

// Stub for legacy middleware (sync getQueueStats for Express compat)
import type { QueueStats } from '../modules/gateway/interfaces/gateway.interfaces';

const defaultStats: QueueStats = {
  queueDepth: 0,
  activeWorkers: 0,
  priorityDistribution: {},
  maxWaitTime: 0,
  averageProcessingTime: 0,
};

export const priorityQueueService = {
  parsePriorityHeader: (_h?: string): number | undefined => undefined,
  getQueueStats: (): QueueStats => defaultStats,
  isQueueOverCapacity: (): boolean => false,
  wouldExceedMaxWaitTime: (): boolean => false,
  acquireSlot: async (_req: unknown, _res: unknown, _priority: number) => {},
  enqueueRequest: async () => '',
  dequeueHighestPriority: async () => null,
};
