import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { adaptiveRateLimitService } from './adaptiveRateLimit.service';
import { EventEmitter } from 'events';

/**
 * Request Prioritization Service
 * Manages priority queues for different request types and ensures critical requests are processed first
 */

export type RequestPriority = 'critical' | 'high' | 'medium' | 'low' | 'background';

export interface PriorityRequest {
    id: string;
    priority: RequestPriority;
    timestamp: number;
    userId?: string;
    endpoint: string;
    method: string;
    metadata: {
        userTier?: 'premium' | 'standard' | 'free';
        requestType?: 'api' | 'webhook' | 'background' | 'system';
        estimatedDuration?: number;
        retryCount?: number;
        deadline?: number; // timestamp when request becomes stale
        cost?: number; // estimated processing cost
    };
    resolve: (result: any) => void;
    reject: (error: any) => void;
    processor: () => Promise<any>;
}

export interface QueueStats {
    critical: number;
    high: number;
    medium: number;
    low: number;
    background: number;
    total: number;
    processing: number;
    averageWaitTime: number;
    throughput: number; // requests per second
}

export interface PrioritizationConfig {
    maxConcurrentRequests: number;
    maxQueueSize: number;
    maxWaitTime: number; // milliseconds
    priorityWeights: Record<RequestPriority, number>;
    adaptivePrioritization: boolean;
    starvationPrevention: boolean;
    starvationThreshold: number; // milliseconds
    deadlineAwareness: boolean;
    costAwareness: boolean;
}

export class RequestPrioritizationService extends EventEmitter {
    private static instance: RequestPrioritizationService;
    
    // Priority queues
    private queues: Record<RequestPriority, PriorityRequest[]> = {
        critical: [],
        high: [],
        medium: [],
        low: [],
        background: []
    };

    // Processing state
    private processingRequests = new Map<string, PriorityRequest>();
    private processingCount = 0;
    private stats = {
        processed: 0,
        rejected: 0,
        timeouts: 0,
        averageWaitTime: 0,
        lastProcessedTime: Date.now()
    };

    // Configuration
    private config: PrioritizationConfig = {
        maxConcurrentRequests: 50,
        maxQueueSize: 1000,
        maxWaitTime: 30000, // 30 seconds
        priorityWeights: {
            critical: 1.0,
            high: 0.8,
            medium: 0.6,
            low: 0.4,
            background: 0.2
        },
        adaptivePrioritization: true,
        starvationPrevention: true,
        starvationThreshold: 60000, // 1 minute
        deadlineAwareness: true,
        costAwareness: true
    };

    // Adaptive prioritization state
    private systemLoadFactor = 0.5;
    private priorityAdjustments = new Map<RequestPriority, number>();
    private starvationCounters = new Map<RequestPriority, number>();

    // Processing loop
    private processingInterval?: NodeJS.Timeout;
    private readonly PROCESSING_INTERVAL = 100; // 100ms

    private constructor() {
        super();
        this.startProcessingLoop();
        this.startStatsCollection();
        this.initializeStarvationCounters();
    }

    public static getInstance(): RequestPrioritizationService {
        if (!RequestPrioritizationService.instance) {
            RequestPrioritizationService.instance = new RequestPrioritizationService();
        }
        return RequestPrioritizationService.instance;
    }

    /**
     * Add request to priority queue
     */
    public async enqueueRequest(
        priority: RequestPriority,
        endpoint: string,
        method: string,
        processor: () => Promise<any>,
        metadata: PriorityRequest['metadata'] = {}
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const requestId = this.generateRequestId();
            const now = Date.now();

            // Check if queue is full
            const totalQueueSize = Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0);
            if (totalQueueSize >= this.config.maxQueueSize) {
                // Try to make room by removing lowest priority requests
                if (!this.makeRoomInQueue()) {
                    reject(new Error('Queue is full and cannot accommodate new requests'));
                    return;
                }
            }

            // Adjust priority based on system state if adaptive prioritization is enabled
            const adjustedPriority = this.config.adaptivePrioritization 
                ? this.adjustPriorityForSystemState(priority, metadata)
                : priority;

            const request: PriorityRequest = {
                id: requestId,
                priority: adjustedPriority,
                timestamp: now,
                endpoint,
                method,
                metadata,
                resolve,
                reject,
                processor
            };

            // Add to appropriate queue
            this.queues[adjustedPriority].push(request);

            // Sort queue by priority score if needed
            if (this.config.deadlineAwareness || this.config.costAwareness) {
                this.sortQueue(adjustedPriority);
            }

            // Emit queue event
            this.emit('request_queued', {
                requestId,
                priority: adjustedPriority,
                originalPriority: priority,
                queueSize: this.queues[adjustedPriority].length,
                totalQueueSize: totalQueueSize + 1
            });

            loggingService.info('Request enqueued for prioritization', {
                component: 'RequestPrioritizationService',
                requestId,
                priority: adjustedPriority,
                originalPriority: priority,
                endpoint,
                method,
                queueSize: this.queues[adjustedPriority].length
            });

            // Set timeout for request
            setTimeout(() => {
                this.timeoutRequest(requestId);
            }, this.config.maxWaitTime);
        });
    }

    /**
     * Process next request from priority queues
     */
    private async processNextRequest(): Promise<void> {
        if (this.processingCount >= this.config.maxConcurrentRequests) {
            return; // At capacity
        }

        const nextRequest = this.selectNextRequest();
        if (!nextRequest) {
            return; // No requests to process
        }

        // Remove from queue
        const queue = this.queues[nextRequest.priority];
        const index = queue.findIndex(req => req.id === nextRequest.id);
        if (index !== -1) {
            queue.splice(index, 1);
        }

        // Start processing
        this.processingCount++;
        this.processingRequests.set(nextRequest.id, nextRequest);

        const startTime = Date.now();
        const waitTime = startTime - nextRequest.timestamp;

        loggingService.info('Processing prioritized request', {
            component: 'RequestPrioritizationService',
            requestId: nextRequest.id,
            priority: nextRequest.priority,
            endpoint: nextRequest.endpoint,
            waitTime,
            processingCount: this.processingCount
        });

        // Emit processing event
        this.emit('request_processing', {
            requestId: nextRequest.id,
            priority: nextRequest.priority,
            waitTime,
            processingCount: this.processingCount
        });

        try {
            const result = await nextRequest.processor();
            
            const processingTime = Date.now() - startTime;
            const totalTime = Date.now() - nextRequest.timestamp;

            // Update stats
            this.updateStats(waitTime, processingTime, 'success');

            // Resolve the request
            nextRequest.resolve(result);

            loggingService.info('Prioritized request completed successfully', {
                component: 'RequestPrioritizationService',
                requestId: nextRequest.id,
                priority: nextRequest.priority,
                endpoint: nextRequest.endpoint,
                waitTime,
                processingTime,
                totalTime
            });

            this.emit('request_completed', {
                requestId: nextRequest.id,
                priority: nextRequest.priority,
                waitTime,
                processingTime,
                totalTime,
                status: 'success'
            });

        } catch (error) {
            const processingTime = Date.now() - startTime;
            const totalTime = Date.now() - nextRequest.timestamp;

            // Update stats
            this.updateStats(waitTime, processingTime, 'error');

            // Reject the request
            nextRequest.reject(error);

            loggingService.error('Prioritized request failed', {
                component: 'RequestPrioritizationService',
                requestId: nextRequest.id,
                priority: nextRequest.priority,
                endpoint: nextRequest.endpoint,
                error: error instanceof Error ? error.message : String(error),
                waitTime,
                processingTime,
                totalTime
            });

            this.emit('request_failed', {
                requestId: nextRequest.id,
                priority: nextRequest.priority,
                error: error instanceof Error ? error.message : String(error),
                waitTime,
                processingTime,
                totalTime
            });

        } finally {
            // Clean up
            this.processingCount--;
            this.processingRequests.delete(nextRequest.id);
        }
    }

    /**
     * Select next request to process using intelligent prioritization
     */
    private selectNextRequest(): PriorityRequest | null {
        const now = Date.now();

        // First, check for critical requests
        if (this.queues.critical.length > 0) {
            return this.selectFromQueue('critical', now);
        }

        // Check for high priority requests or starvation prevention
        if (this.config.starvationPrevention) {
            // Check if any lower priority requests are starving
            for (const priority of ['background', 'low', 'medium'] as RequestPriority[]) {
                const queue = this.queues[priority];
                if (queue.length > 0) {
                    const oldestRequest = queue[0];
                    const waitTime = now - oldestRequest.timestamp;
                    
                    if (waitTime > this.config.starvationThreshold) {
                        loggingService.info('Preventing request starvation', {
                            component: 'RequestPrioritizationService',
                            priority,
                            requestId: oldestRequest.id,
                            waitTime
                        });
                        return oldestRequest;
                    }
                }
            }
        }

        // Normal priority-based selection
        for (const priority of ['high', 'medium', 'low', 'background'] as RequestPriority[]) {
            const request = this.selectFromQueue(priority, now);
            if (request) {
                return request;
            }
        }

        return null;
    }

    /**
     * Select best request from a specific queue
     */
    private selectFromQueue(priority: RequestPriority, now: number): PriorityRequest | null {
        const queue = this.queues[priority];
        if (queue.length === 0) return null;

        // If deadline awareness is disabled, just return the first request
        if (!this.config.deadlineAwareness && !this.config.costAwareness) {
            return queue[0];
        }

        // Calculate scores for each request
        let bestRequest = queue[0];
        let bestScore = this.calculateRequestScore(bestRequest, now);

        for (let i = 1; i < queue.length; i++) {
            const request = queue[i];
            const score = this.calculateRequestScore(request, now);
            
            if (score > bestScore) {
                bestScore = score;
                bestRequest = request;
            }
        }

        return bestRequest;
    }

    /**
     * Calculate priority score for a request
     */
    private calculateRequestScore(request: PriorityRequest, now: number): number {
        let score = this.config.priorityWeights[request.priority];

        // Age factor (older requests get higher priority)
        const age = now - request.timestamp;
        const ageFactor = Math.min(age / 60000, 2); // Max 2x boost after 1 minute
        score += ageFactor * 0.1;

        // Deadline factor
        if (this.config.deadlineAwareness && request.metadata.deadline) {
            const timeToDeadline = request.metadata.deadline - now;
            if (timeToDeadline > 0) {
                const urgencyFactor = 1 - (timeToDeadline / 300000); // 5 minute window
                score += Math.max(urgencyFactor, 0) * 0.3;
            } else {
                // Past deadline - very high priority
                score += 1.0;
            }
        }

        // Cost factor (lower cost gets slight priority)
        if (this.config.costAwareness && request.metadata.cost) {
            const costFactor = Math.max(1 - (request.metadata.cost / 1000), 0); // Normalize to $10
            score += costFactor * 0.1;
        }

        // User tier factor
        if (request.metadata.userTier === 'premium') {
            score += 0.2;
        } else if (request.metadata.userTier === 'standard') {
            score += 0.1;
        }

        // Retry penalty
        if (request.metadata.retryCount && request.metadata.retryCount > 0) {
            score -= request.metadata.retryCount * 0.05;
        }

        return score;
    }

    /**
     * Adjust priority based on current system state
     */
    private adjustPriorityForSystemState(
        priority: RequestPriority,
        metadata: PriorityRequest['metadata']
    ): RequestPriority {
        // Get current system load
        const systemLoad = this.systemLoadFactor;

        // Under high load, be more aggressive with prioritization
        if (systemLoad > 0.8) {
            // Demote background and low priority requests
            if (priority === 'background') return 'background'; // Keep background at background
            if (priority === 'low') return 'background';
            if (priority === 'medium') return 'low';
        } else if (systemLoad > 0.6) {
            // Moderate load adjustments
            if (priority === 'background') return 'background';
            if (priority === 'low' && metadata.userTier !== 'premium') return 'background';
        }

        // Promote critical system operations
        if (metadata.requestType === 'system') {
            if (priority === 'medium') return 'high';
            if (priority === 'low') return 'medium';
        }

        // Promote premium user requests slightly
        if (metadata.userTier === 'premium' && systemLoad < 0.7) {
            if (priority === 'medium') return 'high';
            if (priority === 'low') return 'medium';
        }

        return priority;
    }

    /**
     * Make room in queue by removing lowest priority requests
     */
    private makeRoomInQueue(): boolean {
        // Remove from background queue first
        if (this.queues.background.length > 0) {
            const removed = this.queues.background.shift();
            if (removed) {
                removed.reject(new Error('Request removed due to queue pressure'));
                this.stats.rejected++;
                return true;
            }
        }

        // Then from low priority queue
        if (this.queues.low.length > 0) {
            const removed = this.queues.low.shift();
            if (removed) {
                removed.reject(new Error('Request removed due to queue pressure'));
                this.stats.rejected++;
                return true;
            }
        }

        return false;
    }

    /**
     * Handle request timeout
     */
    private timeoutRequest(requestId: string): void {
        // Check if request is still in queue
        for (const priority of Object.keys(this.queues) as RequestPriority[]) {
            const queue = this.queues[priority];
            const index = queue.findIndex(req => req.id === requestId);
            
            if (index !== -1) {
                const request = queue[index];
                queue.splice(index, 1);
                request.reject(new Error('Request timed out in priority queue'));
                this.stats.timeouts++;
                
                loggingService.warn('Request timed out in priority queue', {
                    component: 'RequestPrioritizationService',
                    requestId,
                    priority,
                    waitTime: Date.now() - request.timestamp
                });

                this.emit('request_timeout', {
                    requestId,
                    priority,
                    waitTime: Date.now() - request.timestamp
                });
                
                return;
            }
        }
    }

    /**
     * Sort a queue by priority score
     */
    private sortQueue(priority: RequestPriority): void {
        const now = Date.now();
        this.queues[priority].sort((a, b) => {
            const scoreA = this.calculateRequestScore(a, now);
            const scoreB = this.calculateRequestScore(b, now);
            return scoreB - scoreA; // Higher score first
        });
    }

    /**
     * Update statistics
     */
    private updateStats(waitTime: number, processingTime: number, status: 'success' | 'error'): void {
        this.stats.processed++;
        
        // Update average wait time
        const totalWaitTime = (this.stats.averageWaitTime * (this.stats.processed - 1)) + waitTime;
        this.stats.averageWaitTime = totalWaitTime / this.stats.processed;
        
        this.stats.lastProcessedTime = Date.now();
    }

    /**
     * Start processing loop
     */
    private startProcessingLoop(): void {
        this.processingInterval = setInterval(async () => {
            try {
                // Update system load factor
                await this.updateSystemLoadFactor();
                
                // Process requests
                while (this.processingCount < this.config.maxConcurrentRequests) {
                    const hasRequest = Object.values(this.queues).some(queue => queue.length > 0);
                    if (!hasRequest) break;
                    
                    await this.processNextRequest();
                }
            } catch (error) {
                loggingService.error('Error in request prioritization processing loop', {
                    component: 'RequestPrioritizationService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.PROCESSING_INTERVAL);
    }

    /**
     * Update system load factor from adaptive rate limiting service
     */
    private async updateSystemLoadFactor(): Promise<void> {
        try {
            const stats = await adaptiveRateLimitService.getStatistics();
            this.systemLoadFactor = stats.systemLoad.cpuUsage / 100 * 0.4 + 
                                  stats.systemLoad.memoryUsage / 100 * 0.3 + 
                                  Math.min(stats.systemLoad.responseTime / 2000, 1) * 0.3;
        } catch (error) {
            // Keep current value on error
        }
    }

    /**
     * Start statistics collection
     */
    private startStatsCollection(): void {
        setInterval(async () => {
            try {
                const stats = this.getQueueStats();
                await cacheService.set('request_prioritization_stats', stats, 60);
                
                // Emit stats event
                this.emit('stats_updated', stats);
            } catch (error) {
                loggingService.debug('Failed to update prioritization stats', {
                    component: 'RequestPrioritizationService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Initialize starvation counters
     */
    private initializeStarvationCounters(): void {
        for (const priority of Object.keys(this.queues) as RequestPriority[]) {
            this.starvationCounters.set(priority, 0);
        }
    }

    /**
     * Get queue statistics
     */
    public getQueueStats(): QueueStats {
        const now = Date.now();
        const timeSinceLastProcessed = now - this.stats.lastProcessedTime;
        const throughput = timeSinceLastProcessed > 0 ? 
            (this.stats.processed * 1000) / timeSinceLastProcessed : 0;

        return {
            critical: this.queues.critical.length,
            high: this.queues.high.length,
            medium: this.queues.medium.length,
            low: this.queues.low.length,
            background: this.queues.background.length,
            total: Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0),
            processing: this.processingCount,
            averageWaitTime: this.stats.averageWaitTime,
            throughput
        };
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<PrioritizationConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        loggingService.info('Request prioritization configuration updated', {
            component: 'RequestPrioritizationService',
            config: this.config
        });
    }

    /**
     * Get detailed statistics
     */
    public getDetailedStats(): any {
        return {
            queues: this.getQueueStats(),
            processing: {
                concurrent: this.processingCount,
                maxConcurrent: this.config.maxConcurrentRequests,
                activeRequests: Array.from(this.processingRequests.keys())
            },
            stats: this.stats,
            config: this.config,
            systemLoad: this.systemLoadFactor
        };
    }

    /**
     * Generate unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Clear all queues (for testing/emergency)
     */
    public clearQueues(): void {
        for (const priority of Object.keys(this.queues) as RequestPriority[]) {
            const queue = this.queues[priority];
            while (queue.length > 0) {
                const request = queue.shift();
                if (request) {
                    request.reject(new Error('Queue cleared'));
                }
            }
        }
        
        loggingService.warn('All priority queues cleared', {
            component: 'RequestPrioritizationService'
        });
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = undefined;
        }
        
        this.clearQueues();
        this.removeAllListeners();
    }
}

// Export singleton instance
export const requestPrioritizationService = RequestPrioritizationService.getInstance();
