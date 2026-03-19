/**
 * Bridge: Re-exports for legacy Express middleware.
 * For NestJS usage, inject PriorityQueueService from GatewayModule.
 *
 * The Nest PriorityQueueService instance MUST be wired via
 * setPriorityQueueServiceInstance() during app bootstrap (main.ts).
 */
export { PriorityQueueService } from '../modules/gateway/services/priority-queue.service';
export {
  PriorityLevel,
  type QueueStats,
  type PriorityRequest,
} from '../modules/gateway/interfaces/gateway.interfaces';

import type { PriorityQueueService as NestPriorityQueueService } from '../modules/gateway/services/priority-queue.service';
import type { QueueStats } from '../modules/gateway/interfaces/gateway.interfaces';

let _priorityQueueInstance: InstanceType<typeof NestPriorityQueueService> | null =
  null;

export function setPriorityQueueServiceInstance(
  instance: InstanceType<typeof NestPriorityQueueService>,
): void {
  _priorityQueueInstance = instance;
}

const defaultStats: QueueStats = {
  queueDepth: 0,
  activeWorkers: 0,
  priorityDistribution: {},
  maxWaitTime: 0,
  averageProcessingTime: 0,
};

/** Legacy bridge - delegates to real PriorityQueueService when wired */
export const priorityQueueService = {
  parsePriorityHeader: (h?: string): number | undefined =>
    _priorityQueueInstance?.parsePriorityHeader(h) ?? undefined,

  getQueueStats: async (): Promise<QueueStats> =>
    _priorityQueueInstance ? _priorityQueueInstance.getQueueStats() : defaultStats,

  isQueueOverCapacity: async (): Promise<boolean> =>
    _priorityQueueInstance ? _priorityQueueInstance.isQueueOverCapacity() : false,

  wouldExceedMaxWaitTime: async (): Promise<boolean> =>
    _priorityQueueInstance
      ? _priorityQueueInstance.wouldExceedMaxWaitTime()
      : false,

  acquireSlot: async (
    req: unknown,
    res: unknown,
    priority: number,
  ): Promise<void> =>
    _priorityQueueInstance
      ? _priorityQueueInstance.acquireSlot(
          req as { headers?: Record<string, string | string[] | undefined> },
          res as { on: (event: string, fn: () => void) => void },
          priority,
        )
      : undefined,

  enqueueRequest: async (request?: unknown): Promise<string> => {
    if (_priorityQueueInstance && request) {
      await _priorityQueueInstance.enqueueRequest(
        request as import('../modules/gateway/interfaces/gateway.interfaces').PriorityRequest,
      );
    }
    return '';
  },

  dequeueHighestPriority: async (): Promise<unknown> =>
    _priorityQueueInstance ? _priorityQueueInstance.dequeueRequest() : null,
};
