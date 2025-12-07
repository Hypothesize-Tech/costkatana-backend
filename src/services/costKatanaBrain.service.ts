import { EventEmitter } from 'events';
import mongoose from 'mongoose';
import { loggingService } from './logging.service';
import Redis from 'ioredis';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type FlowType = 'multi_agent' | 'workflow' | 'cortex_streaming' | 'gateway';
export type FlowPriority = 'critical' | 'high' | 'normal' | 'low';
export type FlowStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface FlowMetadata {
    model?: string;
    promptLength?: number;
    workflowName?: string;
    agentType?: string;
    endpoint?: string;
    provider?: string;
    [key: string]: any;
}

export interface ResourceReservation {
    budget: number;
    cpuPercent?: number;
    memoryMB?: number;
}

export interface ActiveFlow {
    flowId: string;
    type: FlowType;
    userId: string;
    projectId?: string;
    startTime: Date;
    estimatedCost: number;
    estimatedDuration?: number;
    priority: FlowPriority;
    status: FlowStatus;
    metadata: FlowMetadata;
    resourceReservation: ResourceReservation;
}

export interface GlobalResourceState {
    totalActiveFlows: number;
    totalEstimatedCost: number;
    totalReservedBudget: number;
    flowsByType: Record<FlowType, number>;
    flowsByPriority: Record<FlowPriority, number>;
    cpuUtilization?: number;
    memoryUtilization?: number;
    timestamp: Date;
}

export interface FlowConflict {
    flowId1: string;
    flowId2: string;
    conflictType: 'budget' | 'resource' | 'priority';
    severity: 'low' | 'medium' | 'high';
    recommendation: string;
}

export interface BrainEvent {
    type: 'flow-started' | 'flow-completed' | 'flow-failed' | 'budget-alert' | 'resource-conflict' | 'rebalance';
    flowId?: string;
    userId?: string;
    timestamp: Date;
    data: any;
}

// ============================================================================
// MONGODB SCHEMA
// ============================================================================

const ActiveFlowSchema = new mongoose.Schema({
    flowId: { type: String, required: true, unique: true, index: true },
    type: { 
        type: String, 
        enum: ['multi_agent', 'workflow', 'cortex_streaming', 'gateway'],
        required: true,
        index: true
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    startTime: { type: Date, required: true, default: Date.now },
    estimatedCost: { type: Number, required: true, default: 0 },
    estimatedDuration: { type: Number }, // milliseconds
    priority: { 
        type: String, 
        enum: ['critical', 'high', 'normal', 'low'],
        default: 'normal',
        index: true
    },
    status: { 
        type: String, 
        enum: ['running', 'completed', 'failed', 'cancelled'],
        default: 'running',
        index: true
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    resourceReservation: {
        budget: { type: Number, required: true, default: 0 },
        cpuPercent: { type: Number },
        memoryMB: { type: Number }
    },
    completedAt: { type: Date },
    actualCost: { type: Number },
    actualDuration: { type: Number }
}, {
    timestamps: true,
    collection: 'active_flows'
});

// Compound indexes for efficient queries
ActiveFlowSchema.index({ status: 1, startTime: 1 });
ActiveFlowSchema.index({ userId: 1, status: 1 });
ActiveFlowSchema.index({ type: 1, status: 1 });

// TTL index - automatically remove completed flows after 1 hour
ActiveFlowSchema.index({ completedAt: 1 }, { expireAfterSeconds: 3600 });

const ActiveFlowModel = mongoose.model('ActiveFlow', ActiveFlowSchema);

// ============================================================================
// COST KATANA BRAIN SERVICE (META-ORCHESTRATOR)
// ============================================================================

export class CostKatanaBrain extends EventEmitter {
    private static instance: CostKatanaBrain;
    private redis: Redis;
    private redisSubscriber: Redis;
    
    // In-memory cache for active flows (for fast access)
    private activeFlowsCache: Map<string, ActiveFlow> = new Map();
    
    // Configuration
    private config = {
        maxConcurrentFlows: 1000,
        budgetWarningThreshold: 0.8, // 80% of total budget
        budgetCriticalThreshold: 0.95, // 95% of total budget
        conflictCheckInterval: 10000, // 10 seconds
        metricsUpdateInterval: 5000, // 5 seconds
        redisChannel: 'costkatana:brain:events'
    };

    private conflictCheckTimer?: NodeJS.Timeout;
    private metricsUpdateTimer?: NodeJS.Timeout;
    private isInitialized = false;

    private constructor() {
        super();
        this.setMaxListeners(100); // Increase for many concurrent flows
        
        // Initialize Redis connections
        const redisConfig = {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
            maxRetriesPerRequest: 3,
            retryStrategy: (times: number) => {
                if (times > 3) {
                    loggingService.error('Redis connection failed after 3 retries', {
                        component: 'CostKatanaBrain'
                    });
                    return null;
                }
                return Math.min(times * 1000, 3000);
            }
        };

        this.redis = new Redis(redisConfig);
        this.redisSubscriber = new Redis(redisConfig);

        // Setup Redis event handlers
        this.setupRedisHandlers();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): CostKatanaBrain {
        if (!CostKatanaBrain.instance) {
            CostKatanaBrain.instance = new CostKatanaBrain();
        }
        return CostKatanaBrain.instance;
    }

    /**
     * Initialize the Brain service
     */
    public async initialize(): Promise<void> {
        if (this.isInitialized) {
            loggingService.debug('CostKatanaBrain already initialized', {
                component: 'CostKatanaBrain'
            });
            return;
        }

        try {
            loggingService.info('🧠 Initializing Cost Katana Brain...', {
                component: 'CostKatanaBrain'
            });

            // Load active flows from database into cache
            await this.loadActiveFlows();

            // Subscribe to Redis events from other instances
            await this.subscribeToRedisEvents();

            // Start background tasks
            this.startConflictDetection();
            this.startMetricsUpdate();

            this.isInitialized = true;

            loggingService.info('✅ Cost Katana Brain initialized successfully', {
                component: 'CostKatanaBrain',
                activeFlows: this.activeFlowsCache.size
            });

        } catch (error) {
            loggingService.error('❌ Failed to initialize Cost Katana Brain', {
                component: 'CostKatanaBrain',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Setup Redis connection handlers
     */
    private setupRedisHandlers(): void {
        this.redis.on('connect', () => {
            loggingService.info('Redis connected for Brain service', {
                component: 'CostKatanaBrain'
            });
        });

        this.redis.on('error', (error) => {
            loggingService.error('Redis error in Brain service', {
                component: 'CostKatanaBrain',
                error: error.message
            });
        });

        this.redisSubscriber.on('message', (channel, message) => {
            if (channel === this.config.redisChannel) {
                this.handleRedisMessage(message);
            }
        });
    }

    /**
     * Subscribe to Redis events from other instances
     */
    private async subscribeToRedisEvents(): Promise<void> {
        await this.redisSubscriber.subscribe(this.config.redisChannel);
        loggingService.debug('Subscribed to Redis brain events', {
            component: 'CostKatanaBrain',
            channel: this.config.redisChannel
        });
    }

    /**
     * Handle Redis messages from other instances
     */
    private handleRedisMessage(message: string): void {
        try {
            const event: BrainEvent = JSON.parse(message);
            
            // Update local cache based on event
            if (event.type === 'flow-started' && event.flowId) {
                const flow = event.data as ActiveFlow;
                this.activeFlowsCache.set(event.flowId, flow);
            } else if ((event.type === 'flow-completed' || event.type === 'flow-failed') && event.flowId) {
                this.activeFlowsCache.delete(event.flowId);
            }

            // Emit locally for listeners
            this.emit('brain-event', event);

        } catch (error) {
            loggingService.error('Failed to handle Redis message', {
                component: 'CostKatanaBrain',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Publish event to Redis for other instances
     */
    private async publishEvent(event: BrainEvent): Promise<void> {
        try {
            await this.redis.publish(this.config.redisChannel, JSON.stringify(event));
        } catch (error) {
            loggingService.error('Failed to publish event to Redis', {
                component: 'CostKatanaBrain',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Load active flows from database into cache
     */
    private async loadActiveFlows(): Promise<void> {
        try {
            const flows = await ActiveFlowModel.find({ status: 'running' }).lean();
            
            this.activeFlowsCache.clear();
            flows.forEach(flow => {
                this.activeFlowsCache.set(flow.flowId, {
                    flowId: flow.flowId,
                    type: flow.type as FlowType,
                    userId: flow.userId.toString(),
                    projectId: flow.projectId?.toString(),
                    startTime: flow.startTime,
                    estimatedCost: flow.estimatedCost,
                    estimatedDuration: flow.estimatedDuration ?? undefined,
                    priority: flow.priority as FlowPriority,
                    status: flow.status as FlowStatus,
                    metadata: flow.metadata || {},
                    resourceReservation: {
                        budget: flow.resourceReservation?.budget ?? 0,
                        cpuPercent: flow.resourceReservation?.cpuPercent ?? undefined,
                        memoryMB: flow.resourceReservation?.memoryMB ?? undefined
                    }
                });
            });

            loggingService.debug('Loaded active flows into cache', {
                component: 'CostKatanaBrain',
                count: this.activeFlowsCache.size
            });

        } catch (error) {
            loggingService.error('Failed to load active flows', {
                component: 'CostKatanaBrain',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Register a new active flow
     */
    public async registerFlow(flow: ActiveFlow): Promise<void> {
        try {
            // Check if max concurrent flows exceeded
            if (this.activeFlowsCache.size >= this.config.maxConcurrentFlows) {
                loggingService.warn('Max concurrent flows reached', {
                    component: 'CostKatanaBrain',
                    maxFlows: this.config.maxConcurrentFlows,
                    currentFlows: this.activeFlowsCache.size
                });
            }

            // Save to database
            await ActiveFlowModel.create({
                flowId: flow.flowId,
                type: flow.type,
                userId: new mongoose.Types.ObjectId(flow.userId),
                projectId: flow.projectId ? new mongoose.Types.ObjectId(flow.projectId) : undefined,
                startTime: flow.startTime,
                estimatedCost: flow.estimatedCost,
                estimatedDuration: flow.estimatedDuration,
                priority: flow.priority,
                status: flow.status,
                metadata: flow.metadata,
                resourceReservation: flow.resourceReservation
            });

            // Add to cache
            this.activeFlowsCache.set(flow.flowId, flow);

            // Emit event locally
            const event: BrainEvent = {
                type: 'flow-started',
                flowId: flow.flowId,
                userId: flow.userId,
                timestamp: new Date(),
                data: flow
            };
            this.emit('brain-event', event);

            // Publish to Redis for other instances
            await this.publishEvent(event);

            loggingService.info('Flow registered with Brain', {
                component: 'CostKatanaBrain',
                flowId: flow.flowId,
                type: flow.type,
                userId: flow.userId,
                estimatedCost: flow.estimatedCost
            });

            // Check if budget alert needed
            await this.checkGlobalBudgetAlert();

        } catch (error) {
            loggingService.error('Failed to register flow', {
                component: 'CostKatanaBrain',
                flowId: flow.flowId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Unregister a completed flow
     */
    public async unregisterFlow(
        flowId: string, 
        status: 'completed' | 'failed' | 'cancelled',
        actualCost?: number,
        actualDuration?: number
    ): Promise<void> {
        try {
            // Update in database
            await ActiveFlowModel.findOneAndUpdate(
                { flowId },
                {
                    status,
                    completedAt: new Date(),
                    actualCost,
                    actualDuration
                }
            );

            // Remove from cache
            this.activeFlowsCache.delete(flowId);

            // Emit event locally
            const eventType = status === 'completed' ? 'flow-completed' : 'flow-failed';
            const event: BrainEvent = {
                type: eventType,
                flowId,
                timestamp: new Date(),
                data: { status, actualCost, actualDuration }
            };
            this.emit('brain-event', event);

            // Publish to Redis
            await this.publishEvent(event);

            loggingService.info('Flow unregistered from Brain', {
                component: 'CostKatanaBrain',
                flowId,
                status,
                actualCost,
                actualDuration
            });

        } catch (error) {
            loggingService.error('Failed to unregister flow', {
                component: 'CostKatanaBrain',
                flowId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get all active flows
     */
    public getAllActiveFlows(): ActiveFlow[] {
        return Array.from(this.activeFlowsCache.values());
    }

    /**
     * Get active flows by user
     */
    public getActiveFlowsByUser(userId: string): ActiveFlow[] {
        return this.getAllActiveFlows().filter(flow => flow.userId === userId);
    }

    /**
     * Get active flows by type
     */
    public getActiveFlowsByType(type: FlowType): ActiveFlow[] {
        return this.getAllActiveFlows().filter(flow => flow.type === type);
    }

    /**
     * Get active flows by priority
     */
    public getActiveFlowsByPriority(priority: FlowPriority): ActiveFlow[] {
        return this.getAllActiveFlows().filter(flow => flow.priority === priority);
    }

    /**
     * Get global resource state
     */
    public getGlobalResourceState(): GlobalResourceState {
        const flows = this.getAllActiveFlows();
        
        const flowsByType: Record<FlowType, number> = {
            multi_agent: 0,
            workflow: 0,
            cortex_streaming: 0,
            gateway: 0
        };

        const flowsByPriority: Record<FlowPriority, number> = {
            critical: 0,
            high: 0,
            normal: 0,
            low: 0
        };

        let totalEstimatedCost = 0;
        let totalReservedBudget = 0;

        flows.forEach(flow => {
            flowsByType[flow.type]++;
            flowsByPriority[flow.priority]++;
            totalEstimatedCost += flow.estimatedCost || 0;
            totalReservedBudget += flow.resourceReservation.budget || 0;
        });

        return {
            totalActiveFlows: flows.length,
            totalEstimatedCost,
            totalReservedBudget,
            flowsByType,
            flowsByPriority,
            timestamp: new Date()
        };
    }

    /**
     * Check for global budget alerts
     */
    private async checkGlobalBudgetAlert(): Promise<void> {
        const state = this.getGlobalResourceState();
        
        // This is a simplified check - in production, you'd query actual budget limits
        const estimatedTotalBudget = 1000; // Example: $1000 total budget
        const utilizationPercent = state.totalReservedBudget / estimatedTotalBudget;

        if (utilizationPercent >= this.config.budgetCriticalThreshold) {
            const event: BrainEvent = {
                type: 'budget-alert',
                timestamp: new Date(),
                data: {
                    severity: 'critical',
                    utilizationPercent,
                    totalReservedBudget: state.totalReservedBudget,
                    totalBudget: estimatedTotalBudget,
                    message: 'Global budget utilization critical (>95%)'
                }
            };
            
            this.emit('brain-event', event);
            await this.publishEvent(event);

            loggingService.warn('🚨 Global budget critical', {
                component: 'CostKatanaBrain',
                utilizationPercent: (utilizationPercent * 100).toFixed(2) + '%'
            });

        } else if (utilizationPercent >= this.config.budgetWarningThreshold) {
            const event: BrainEvent = {
                type: 'budget-alert',
                timestamp: new Date(),
                data: {
                    severity: 'warning',
                    utilizationPercent,
                    totalReservedBudget: state.totalReservedBudget,
                    totalBudget: estimatedTotalBudget,
                    message: 'Global budget utilization high (>80%)'
                }
            };
            
            this.emit('brain-event', event);
            await this.publishEvent(event);

            loggingService.warn('⚠️ Global budget warning', {
                component: 'CostKatanaBrain',
                utilizationPercent: (utilizationPercent * 100).toFixed(2) + '%'
            });
        }
    }

    /**
     * Detect flow conflicts and resource contention
     */
    private async detectFlowConflicts(): Promise<FlowConflict[]> {
        const conflicts: FlowConflict[] = [];
        const flows = this.getAllActiveFlows();

        // Check for budget conflicts (multiple high-cost flows for same user)
        const flowsByUser = new Map<string, ActiveFlow[]>();
        flows.forEach(flow => {
            const userFlows = flowsByUser.get(flow.userId) || [];
            userFlows.push(flow);
            flowsByUser.set(flow.userId, userFlows);
        });

        flowsByUser.forEach((userFlows, userId) => {
            if (userFlows.length > 1) {
                const totalCost = userFlows.reduce((sum, f) => sum + f.estimatedCost, 0);
                
                // If total estimated cost is high, flag as conflict
                if (totalCost > 10) { // $10 threshold - configurable
                    for (let i = 0; i < userFlows.length - 1; i++) {
                        for (let j = i + 1; j < userFlows.length; j++) {
                            conflicts.push({
                                flowId1: userFlows[i].flowId,
                                flowId2: userFlows[j].flowId,
                                conflictType: 'budget',
                                severity: totalCost > 50 ? 'high' : totalCost > 20 ? 'medium' : 'low',
                                recommendation: `User ${userId} has multiple concurrent flows with high combined cost ($${totalCost.toFixed(2)})`
                            });
                        }
                    }
                }
            }
        });

        return conflicts;
    }

    /**
     * Coordinate flows and optimize resource allocation
     */
    public async coordinateFlows(): Promise<void> {
        try {
            const conflicts = await this.detectFlowConflicts();
            
            if (conflicts.length > 0) {
                loggingService.warn('Flow conflicts detected', {
                    component: 'CostKatanaBrain',
                    conflictCount: conflicts.length
                });

                conflicts.forEach(conflict => {
                    const event: BrainEvent = {
                        type: 'resource-conflict',
                        timestamp: new Date(),
                        data: conflict
                    };
                    this.emit('brain-event', event);
                });
            }

        } catch (error) {
            loggingService.error('Failed to coordinate flows', {
                component: 'CostKatanaBrain',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Enforce global budget limits
     */
    public async enforceGlobalBudget(userId: string, requestedCost: number): Promise<{
        allowed: boolean;
        reason?: string;
        currentUtilization: number;
    }> {
        try {
            const userFlows = this.getActiveFlowsByUser(userId);
            const currentReserved = userFlows.reduce((sum, f) => sum + f.resourceReservation.budget, 0);
            
            // Example: $100 per-user budget limit
            const userBudgetLimit = 100;
            const newTotal = currentReserved + requestedCost;
            const utilization = newTotal / userBudgetLimit;

            if (newTotal > userBudgetLimit) {
                return {
                    allowed: false,
                    reason: `Budget limit exceeded. Current: $${currentReserved.toFixed(2)}, Requested: $${requestedCost.toFixed(2)}, Limit: $${userBudgetLimit}`,
                    currentUtilization: utilization
                };
            }

            return {
                allowed: true,
                currentUtilization: utilization
            };

        } catch (error) {
            loggingService.error('Failed to enforce global budget', {
                component: 'CostKatanaBrain',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fail open to avoid blocking
            return { allowed: true, currentUtilization: 0 };
        }
    }

    /**
     * Rebalance resources for a specific flow
     */
    public async rebalanceResources(flowId: string, newPriority: FlowPriority): Promise<void> {
        try {
            const flow = this.activeFlowsCache.get(flowId);
            if (!flow) {
                loggingService.warn('Flow not found for rebalancing', {
                    component: 'CostKatanaBrain',
                    flowId
                });
                return;
            }

            // Update priority
            flow.priority = newPriority;
            this.activeFlowsCache.set(flowId, flow);

            // Update in database
            await ActiveFlowModel.findOneAndUpdate(
                { flowId },
                { priority: newPriority }
            );

            // Emit rebalance event
            const event: BrainEvent = {
                type: 'rebalance',
                flowId,
                timestamp: new Date(),
                data: { oldPriority: flow.priority, newPriority }
            };
            this.emit('brain-event', event);
            await this.publishEvent(event);

            loggingService.info('Flow resources rebalanced', {
                component: 'CostKatanaBrain',
                flowId,
                newPriority
            });

        } catch (error) {
            loggingService.error('Failed to rebalance resources', {
                component: 'CostKatanaBrain',
                flowId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Start background conflict detection
     */
    private startConflictDetection(): void {
        this.conflictCheckTimer = setInterval(async () => {
            await this.coordinateFlows();
        }, this.config.conflictCheckInterval);

        loggingService.debug('Started conflict detection', {
            component: 'CostKatanaBrain',
            intervalMs: this.config.conflictCheckInterval
        });
    }

    /**
     * Start background metrics updates
     */
    private startMetricsUpdate(): void {
        this.metricsUpdateTimer = setInterval(() => {
            const state = this.getGlobalResourceState();
            
            // Emit metrics event
            const event: BrainEvent = {
                type: 'flow-started', // Using existing type, could add 'metrics-update'
                timestamp: new Date(),
                data: { metrics: state }
            };
            this.emit('brain-event', event);
            this.emit('metrics-update', state);

        }, this.config.metricsUpdateInterval);

        loggingService.debug('Started metrics updates', {
            component: 'CostKatanaBrain',
            intervalMs: this.config.metricsUpdateInterval
        });
    }

    /**
     * Shutdown the Brain service gracefully
     */
    public async shutdown(): Promise<void> {
        loggingService.info('🛑 Shutting down Cost Katana Brain...', {
            component: 'CostKatanaBrain'
        });

        // Stop background tasks
        if (this.conflictCheckTimer) {
            clearInterval(this.conflictCheckTimer);
        }
        if (this.metricsUpdateTimer) {
            clearInterval(this.metricsUpdateTimer);
        }

        // Close Redis connections
        await this.redis.quit();
        await this.redisSubscriber.quit();

        this.isInitialized = false;

        loggingService.info('✅ Cost Katana Brain shut down successfully', {
            component: 'CostKatanaBrain'
        });
    }
}

// Export singleton instance
export const costKatanaBrain = CostKatanaBrain.getInstance();

