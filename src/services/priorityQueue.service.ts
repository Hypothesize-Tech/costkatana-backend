/**
 * Priority Queue Service
 * 
 * Implements dual-layer priority queue for request prioritization:
 * - In-memory priority heap for fast access
 * - Redis sorted set for persistence and distributed coordination
 * 
 * Ensures high-priority requests are processed before low-priority ones.
 */

import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import { Request } from 'express';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface PriorityRequest {
    requestId: string;
    priority: number;
    userId: string;
    userTier: 'free' | 'plus' | 'pro' | 'enterprise';
    requestType: 'sync' | 'async';
    enqueuedAt: number;
    expiresAt: number;
    data: {
        method: string;
        url: string;
        headers: Record<string, string | string[] | undefined>;
        body: any;
        gatewayContext: any;
    };
}

export enum PriorityLevel {
    CRITICAL = 100,
    HIGH = 75,
    NORMAL = 50,
    LOW = 25,
    BULK = 10
}

export interface QueueStats {
    totalQueued: number;
    byPriority: Record<string, number>;
    avgWaitTime: number;
    oldestRequest: number;
    queueDepth: number;
}

// ============================================================================
// PRIORITY QUEUE SERVICE
// ============================================================================

export class PriorityQueueService {
    private static instance: PriorityQueueService;
    
    // In-memory priority heap (min-heap by priority score - higher is better)
    private memoryQueue: PriorityRequest[] = [];
    
    // Configuration
    private readonly MAX_QUEUE_SIZE = 10000;
    private readonly MAX_WAIT_TIME_MS = 30000; // 30 seconds
    private readonly REQUEST_TTL_MS = 120000; // 2 minutes
    
    // Redis keys
    private readonly QUEUE_KEY = 'priority:queue';
    private readonly REQUEST_DATA_PREFIX = 'priority:request:';
    private readonly STATS_KEY = 'priority:stats';
    
    // User tier weights for priority calculation
    private readonly TIER_WEIGHTS: Record<string, number> = {
        enterprise: 30,
        pro: 25,
        plus: 15,
        free: 5
    };
    
    // Request type weights
    private readonly REQUEST_TYPE_WEIGHTS: Record<string, number> = {
        sync: 20,
        async: 10
    };
    
    private constructor() {
        this.initializeQueue();
        this.startMaintenanceScheduler();
    }
    
    public static getInstance(): PriorityQueueService {
        if (!PriorityQueueService.instance) {
            PriorityQueueService.instance = new PriorityQueueService();
        }
        return PriorityQueueService.instance;
    }
    
    /**
     * Enqueue a request with calculated priority
     */
    public async enqueueRequest(
        req: Request,
        explicitPriority?: number
    ): Promise<string> {
        try {
            const context = req.gatewayContext;
            if (!context) {
                throw new Error('Gateway context is required');
            }
            
            const requestId = context.requestId || this.generateRequestId();
            const timestamp = Date.now();
            const userId = context.userId || 'anonymous';
            
            // Get user tier from context or default to 'free'
            // Type assertion needed as userTier is not in the base GatewayContext type
            const userTierRaw = (context as any).userTier;
            const userTier: 'free' | 'plus' | 'pro' | 'enterprise' = 
                (userTierRaw === 'free' || userTierRaw === 'plus' || userTierRaw === 'pro' || userTierRaw === 'enterprise')
                    ? userTierRaw
                    : 'free';
            
            // Calculate priority score
            const priority = this.calculatePriority(
                userId,
                userTier,
                'sync', // Assume sync for now
                explicitPriority
            );
            
            const priorityRequest: PriorityRequest = {
                requestId,
                priority,
                userId,
                userTier,
                requestType: 'sync',
                enqueuedAt: timestamp,
                expiresAt: timestamp + this.REQUEST_TTL_MS,
                data: {
                    method: req.method,
                    url: req.url || '/',
                    headers: req.headers,
                    body: req.body,
                    gatewayContext: context
                }
            };
            
            // Check queue size
            if (this.memoryQueue.length >= this.MAX_QUEUE_SIZE) {
                throw new Error('Queue is full');
            }
            
            // Add to memory queue
            this.memoryQueue.push(priorityRequest);
            this.memoryQueue.sort((a, b) => b.priority - a.priority); // Sort descending (higher priority first)
            
            // Persist to Redis for durability (non-blocking)
            void this.persistToRedis(priorityRequest).catch(error => {
                loggingService.warn('Failed to persist request to Redis', {
                    error: error instanceof Error ? error.message : String(error),
                    requestId
                });
            });
            
            loggingService.info('Request enqueued', {
                requestId,
                priority,
                userTier: priorityRequest.userTier,
                queueSize: this.memoryQueue.length
            });
            
            return requestId;
            
        } catch (error) {
            loggingService.error('Failed to enqueue request', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    
    /**
     * Dequeue the highest priority request
     */
    public async dequeueHighestPriority(): Promise<PriorityRequest | null> {
        try {
            // Clean up expired requests first
            this.cleanupExpiredRequests();
            
            // Get from memory queue (already sorted)
            const request = this.memoryQueue.shift();
            
            if (!request) {
                return null;
            }
            
            // Remove from Redis
            await this.removeFromRedis(request.requestId);
            
            const waitTime = Date.now() - request.enqueuedAt;
            
            loggingService.info('Request dequeued', {
                requestId: request.requestId,
                priority: request.priority,
                waitTime,
                remainingQueue: this.memoryQueue.length
            });
            
            // Update stats (non-blocking)
            void this.updateStats('dequeued', waitTime);
            
            return request;
            
        } catch (error) {
            loggingService.error('Failed to dequeue request', {
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }
    
    /**
     * Update priority for an existing request
     */
    public async updatePriority(
        requestId: string,
        newPriority: number
    ): Promise<boolean> {
        try {
            // Find in memory queue
            const index = this.memoryQueue.findIndex(r => r.requestId === requestId);
            
            if (index === -1) {
                return false;
            }
            
            // Update priority
            this.memoryQueue[index].priority = newPriority;
            
            // Re-sort
            this.memoryQueue.sort((a, b) => b.priority - a.priority);
            
            // Update in Redis
            await redisService.client.zAdd(this.QUEUE_KEY, {
                score: newPriority,
                value: requestId
            });
            
            loggingService.info('Priority updated', {
                requestId,
                newPriority
            });
            
            return true;
            
        } catch (error) {
            loggingService.error('Failed to update priority', {
                error: error instanceof Error ? error.message : String(error),
                requestId
            });
            return false;
        }
    }
    
    /**
     * Get queue statistics
     */
    public getQueueStats(): QueueStats {
        try {
            const now = Date.now();
            
            // Count by priority levels
            const byPriority: Record<string, number> = {
                critical: 0,
                high: 0,
                normal: 0,
                low: 0,
                bulk: 0
            };
            
            let oldestTimestamp = now;
            
            for (const req of this.memoryQueue) {
                const priorityNum = req.priority;
                if (priorityNum >= PriorityLevel.CRITICAL) {
                    byPriority.critical++;
                } else if (priorityNum >= PriorityLevel.HIGH) {
                    byPriority.high++;
                } else if (priorityNum >= PriorityLevel.NORMAL) {
                    byPriority.normal++;
                } else if (priorityNum >= PriorityLevel.LOW) {
                    byPriority.low++;
                } else {
                    byPriority.bulk++;
                }
                
                if (req.enqueuedAt < oldestTimestamp) {
                    oldestTimestamp = req.enqueuedAt;
                }
            }
            
            const avgWaitTime = oldestTimestamp < now ? now - oldestTimestamp : 0;
            
            return {
                totalQueued: this.memoryQueue.length,
                byPriority,
                avgWaitTime,
                oldestRequest: oldestTimestamp,
                queueDepth: this.memoryQueue.length
            };
            
        } catch (error) {
            loggingService.error('Failed to get queue stats', {
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                totalQueued: 0,
                byPriority: {},
                avgWaitTime: 0,
                oldestRequest: Date.now(),
                queueDepth: 0
            };
        }
    }
    
    /**
     * Check if queue is over capacity
     */
    public isQueueOverCapacity(): boolean {
        return this.memoryQueue.length >= this.MAX_QUEUE_SIZE * 0.9; // 90% threshold
    }
    
    /**
     * Check if a request would exceed max wait time
     */
    public wouldExceedMaxWaitTime(): boolean {
        if (this.memoryQueue.length === 0) {
            return false;
        }
        
        const oldestRequest = this.memoryQueue[this.memoryQueue.length - 1];
        const waitTime = Date.now() - oldestRequest.enqueuedAt;
        
        return waitTime >= this.MAX_WAIT_TIME_MS;
    }
    
    // ========================================================================
    // PRIVATE HELPER METHODS
    // ========================================================================
    
    /**
     * Calculate priority score based on multiple factors
     */
    private calculatePriority(
        userId: string,
        userTier: string,
        requestType: string,
        explicitPriority?: number
    ): number {
        const tierWeight = this.TIER_WEIGHTS[userTier] ?? this.TIER_WEIGHTS.free;
        const requestTypeWeight = this.REQUEST_TYPE_WEIGHTS[requestType] ?? this.REQUEST_TYPE_WEIGHTS.async;
        const headerPriority = explicitPriority ?? PriorityLevel.NORMAL;

        // Incorporate a user-level deterministic boost (for fairness and entropy)
        // Hash userId to a [0,1] float and use a small proportion, e.g. 5%
        let userHashBoost = 0;
        if (userId) {
            let hash = 0;
            for (let i = 0; i < userId.length; i++) {
                hash = ((hash << 5) - hash) + userId.charCodeAt(i);
                hash |= 0; // Convert to 32bit integer
            }
            userHashBoost = Math.abs(hash % 1000) / 1000 * 5; // Boost in [0, 5]
        }

        // Formula: (tierWeight * 30%) + (requestTypeWeight * 20%) + (headerPriority * 50%) + (userHashBoost)
        const priority = (tierWeight * 0.3) + (requestTypeWeight * 0.2) + (headerPriority * 0.5) + userHashBoost;

        return Math.round(priority);
    }
    
    /**
     * Persist request to Redis for durability
     */
    private async persistToRedis(request: PriorityRequest): Promise<void> {
        try {
            // Add to sorted set with priority as score
            await redisService.client.zAdd(this.QUEUE_KEY, {
                score: request.priority,
                value: request.requestId
            });
            
            // Store request data
            const dataKey = `${this.REQUEST_DATA_PREFIX}${request.requestId}`;
            await redisService.set(dataKey, request, Math.ceil(this.REQUEST_TTL_MS / 1000));
            
        } catch (error) {
            loggingService.warn('Failed to persist to Redis', {
                error: error instanceof Error ? error.message : String(error),
                requestId: request.requestId
            });
        }
    }
    
    /**
     * Remove request from Redis
     */
    private async removeFromRedis(requestId: string): Promise<void> {
        try {
            await redisService.client.zRem(this.QUEUE_KEY, requestId);
            await redisService.del(`${this.REQUEST_DATA_PREFIX}${requestId}`);
        } catch (error) {
            loggingService.warn('Failed to remove from Redis', {
                error: error instanceof Error ? error.message : String(error),
                requestId
            });
        }
    }
    
    /**
     * Clean up expired requests
     */
    private cleanupExpiredRequests(): void {
        const now = Date.now();
        const expiredCount = this.memoryQueue.filter(r => r.expiresAt < now).length;
        
        if (expiredCount > 0) {
            this.memoryQueue = this.memoryQueue.filter(r => r.expiresAt >= now);
            
            loggingService.info('Cleaned up expired requests', {
                expiredCount,
                remainingQueue: this.memoryQueue.length
            });
        }
    }
    
    /**
     * Generate unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Initialize queue from Redis (for recovery)
     */
    private async initializeQueue(): Promise<void> {
        try {
            // Load requests from Redis into memory
            const requestIds = await redisService.client.zRange(this.QUEUE_KEY, 0, -1);
            
            for (const requestId of requestIds) {
                const dataKey = `${this.REQUEST_DATA_PREFIX}${requestId}`;
                const request = await redisService.get(dataKey) as PriorityRequest | null;
                
                if (request && request.expiresAt > Date.now()) {
                    this.memoryQueue.push(request);
                }
            }
            
            // Sort by priority
            this.memoryQueue.sort((a, b) => b.priority - a.priority);
            
            loggingService.info('Priority queue initialized', {
                queueSize: this.memoryQueue.length
            });
            
        } catch (error) {
            loggingService.error('Failed to initialize queue', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    
    /**
     * Start maintenance scheduler
     */
    private startMaintenanceScheduler(): void {
        // Run cleanup every 30 seconds
        setInterval(() => {
            this.cleanupExpiredRequests();
        }, 30000);
    }
    
    /**
     * Update queue statistics
     */
    private async updateStats(event: string, value: number): Promise<void> {
        try {
            await redisService.client.hIncrBy(this.STATS_KEY, event, 1);
            await redisService.client.hIncrByFloat(this.STATS_KEY, `${event}_total_time`, value);
        } catch (error) {
            // Silently fail - stats are not critical
        }
    }
}

// Export singleton instance
export const priorityQueueService = PriorityQueueService.getInstance();

