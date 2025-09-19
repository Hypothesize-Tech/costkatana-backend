import mongoose from 'mongoose';
import { ExperimentationService } from './experimentation.service';
import { SimulationTrackingService } from './simulationTracking.service';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

// Schema for auto-simulation settings
const AutoSimulationSettingsSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        unique: true 
    },
    enabled: { type: Boolean, default: false },
    
    // Trigger conditions
    triggers: {
        costThreshold: { type: Number, default: 0.01 }, // Auto-simulate if cost > threshold
        tokenThreshold: { type: Number, default: 1000 }, // Auto-simulate if tokens > threshold
        expensiveModels: [String], // Auto-simulate for these models
        allCalls: { type: Boolean, default: false }, // Auto-simulate all calls
    },
    
    // Auto-optimization settings
    autoOptimize: {
        enabled: { type: Boolean, default: false },
        approvalRequired: { type: Boolean, default: true },
        maxSavingsThreshold: { type: Number, default: 0.50 }, // Auto-apply if savings > 50%
        riskTolerance: { 
            type: String, 
            enum: ['low', 'medium', 'high'], 
            default: 'medium' 
        }
    },
    
    // Notification settings
    notifications: {
        email: { type: Boolean, default: true },
        dashboard: { type: Boolean, default: true },
        slack: { type: Boolean, default: false },
        slackWebhook: String
    },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    collection: 'auto_simulation_settings'
});

const AutoSimulationSettings = mongoose.model('AutoSimulationSettings', AutoSimulationSettingsSchema);

// Schema for auto-simulation queue
const AutoSimulationQueueSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    usageId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Usage', 
        required: true 
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed', 'approved', 'rejected'],
        default: 'pending'
    },
    
    // Simulation results
    simulationId: String,
    optimizationOptions: [mongoose.Schema.Types.Mixed],
    recommendations: [mongoose.Schema.Types.Mixed],
    potentialSavings: Number,
    confidence: Number,
    
    // Auto-optimization results
    autoApplied: { type: Boolean, default: false },
    appliedOptimizations: [mongoose.Schema.Types.Mixed],
    
    // Processing metadata
    processedAt: Date,
    errorMessage: String,
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    collection: 'auto_simulation_queue'
});

AutoSimulationQueueSchema.index({ userId: 1, status: 1 });
AutoSimulationQueueSchema.index({ status: 1, createdAt: 1 });

const AutoSimulationQueue = mongoose.model('AutoSimulationQueue', AutoSimulationQueueSchema);

export interface AutoSimulationSettings {
    userId: string;
    enabled: boolean;
    triggers: {
        costThreshold: number;
        tokenThreshold: number;
        expensiveModels: string[];
        allCalls: boolean;
    };
    autoOptimize: {
        enabled: boolean;
        approvalRequired: boolean;
        maxSavingsThreshold: number;
        riskTolerance: 'low' | 'medium' | 'high';
    };
    notifications: {
        email: boolean;
        dashboard: boolean;
        slack: boolean;
        slackWebhook?: string;
    };
}

export interface AutoSimulationQueueItem {
    id: string;
    userId: string;
    usageId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'approved' | 'rejected';
    simulationId?: string;
    optimizationOptions?: any[];
    recommendations?: any[];
    potentialSavings?: number;
    confidence?: number;
    autoApplied?: boolean;
    appliedOptimizations?: any[];
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

export class AutoSimulationService {
    
    /**
     * Check if usage should trigger auto-simulation
     */
    static async shouldTriggerSimulation(usageId: string): Promise<boolean> {
        try {
            // Single aggregation pipeline to get all needed data
            const [result] = await Usage.aggregate([
                { $match: { _id: new mongoose.Types.ObjectId(usageId) } },
                {
                    $lookup: {
                        from: 'auto_simulation_settings',
                        localField: 'userId',
                        foreignField: 'userId',
                        as: 'settings',
                        pipeline: [
                            { $project: { enabled: 1, triggers: 1 } } // Only select needed fields
                        ]
                    }
                },
                {
                    $lookup: {
                        from: 'auto_simulation_queue',
                        let: { userId: '$userId', usageId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$userId', '$$userId'] },
                                            { $eq: ['$usageId', '$$usageId'] },
                                            { $in: ['$status', ['pending', 'processing']] }
                                        ]
                                    }
                                }
                            },
                            { $project: { _id: 1 } } // Only need to know if exists
                        ],
                        as: 'existing'
                    }
                },
                {
                    $project: {
                        cost: 1,
                        totalTokens: 1,
                        model: 1,
                        settings: { $arrayElemAt: ['$settings', 0] },
                        hasExisting: { $gt: [{ $size: '$existing' }, 0] }
                    }
                }
            ]);

            if (!result) return false;

            const { settings, hasExisting, cost, totalTokens, model } = result;
            
            // Check if settings exist and enabled
            if (!settings || !settings.enabled) return false;
            
            // Check if already queued
            if (hasExisting) return false;

            const triggers = settings.triggers;
            if (!triggers) return false;

            // Check trigger conditions
            if (triggers.allCalls) return true;
            if (cost > triggers.costThreshold) return true;
            if (totalTokens > triggers.tokenThreshold) return true;
            if (triggers.expensiveModels && triggers.expensiveModels.includes(model)) return true;

            return false;
        } catch (error) {
            loggingService.error('Error checking auto-simulation trigger:', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    /**
     * Queue usage for auto-simulation
     */
    static async queueForSimulation(usageId: string): Promise<string | null> {
        try {
            const usage = await Usage.findById(usageId).lean();
            if (!usage) return null;

            const queueItem = new AutoSimulationQueue({
                userId: usage.userId,
                usageId: new mongoose.Types.ObjectId(usageId),
                status: 'pending'
            });

            const saved = await queueItem.save();
            loggingService.info(`Queued usage ${usageId} for auto-simulation: ${saved._id}`);
            
            // Process immediately if not too busy
            setImmediate(() => this.processQueue());
            
            return saved._id.toString();
        } catch (error) {
            loggingService.error('Error queuing for auto-simulation:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    /**
     * Process auto-simulation queue
     */
    static async processQueue(): Promise<void> {
        try {
            const pendingItems = await AutoSimulationQueue.find({
                status: 'pending'
            })
            .sort({ createdAt: 1 })
            .limit(5) // Process 5 at a time
            .populate('usageId')
            .lean();

            if (pendingItems.length === 0) return;

            // Mark all items as processing in bulk operation
            const bulkOps = pendingItems.map(item => ({
                updateOne: {
                    filter: { _id: item._id },
                    update: { 
                        status: 'processing',
                        processedAt: new Date()
                    }
                }
            }));

            await AutoSimulationQueue.bulkWrite(bulkOps);

            // Process items in parallel using Promise.all
            const results = await Promise.allSettled(
                pendingItems.map(item => this.processQueueItem(item))
            );

            // Log any failed processing
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    loggingService.error(`Failed to process queue item ${pendingItems[index]._id}:`, {
                        error: result.reason
                    });
                }
            });

        } catch (error) {
            loggingService.error('Error processing auto-simulation queue:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Process individual queue item
     */
    private static async processQueueItem(queueItem: any): Promise<void> {
        try {
            const usage = queueItem.usageId;
            if (!usage) {
                throw new Error('Usage not found');
            }

            // Run simulation and get settings in parallel
            const simulationRequest = {
                prompt: usage.prompt,
                currentModel: usage.model,
                simulationType: 'real_time_analysis' as const,
                options: {
                    optimizationGoals: ['cost', 'quality'] as ('cost' | 'quality')[],
                }
            };

            const [result, settings] = await Promise.all([
                ExperimentationService.runRealTimeWhatIfSimulation(simulationRequest),
                AutoSimulationSettings.findOne({ 
                    userId: queueItem.userId 
                }).select('autoOptimize').lean()
            ]);

            // Track simulation first
            const trackingId = await SimulationTrackingService.trackSimulation({
                userId: queueItem.userId.toString(),
                sessionId: `auto-${queueItem._id}`,
                originalUsageId: usage._id.toString(),
                simulationType: 'real_time_analysis',
                originalModel: usage.model,
                originalPrompt: usage.prompt,
                originalCost: usage.cost,
                originalTokens: usage.totalTokens,
                optimizationOptions: result.optimizedOptions || [],
                recommendations: result.recommendations || [],
                potentialSavings: result.potentialSavings || 0,
                confidence: result.confidence || 0
            });

            // Update queue item with tracking ID
            await AutoSimulationQueue.findByIdAndUpdate(queueItem._id, {
                status: 'completed',
                simulationId: trackingId,
                optimizationOptions: result.optimizedOptions,
                recommendations: result.recommendations,
                potentialSavings: result.potentialSavings,
                confidence: result.confidence,
                updatedAt: new Date()
            });

            // Check if auto-optimization should be applied
            if (settings?.autoOptimize?.enabled) {
                // Run auto-optimization in parallel with logging
                await Promise.all([
                    this.considerAutoOptimization(queueItem._id.toString(), result, settings),
                    Promise.resolve(loggingService.info(`Completed auto-simulation for queue item: ${queueItem._id}`, {
                        trackingId,
                        potentialSavings: result.potentialSavings,
                        confidence: result.confidence
                    }))
                ]);
            } else {
                loggingService.info(`Completed auto-simulation for queue item: ${queueItem._id}`, {
                    trackingId,
                    potentialSavings: result.potentialSavings,
                    confidence: result.confidence
                });
            }

        } catch (error) {
            loggingService.error(`Error processing queue item ${queueItem._id}:`, { error: error instanceof Error ? error.message : String(error) });
            
            // Update with error and retry logic
            await AutoSimulationQueue.findByIdAndUpdate(queueItem._id, {
                status: queueItem.retryCount >= queueItem.maxRetries ? 'failed' : 'pending',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                retryCount: queueItem.retryCount + 1,
                updatedAt: new Date()
            });
        }
    }

    /**
     * Consider auto-optimization based on settings
     */
    private static async considerAutoOptimization(
        queueItemId: string, 
        simulationResult: any, 
        settings: any
    ): Promise<void> {
        try {
            if (!simulationResult.optimizedOptions || simulationResult.optimizedOptions.length === 0) {
                return;
            }

            const autoOptimizeSettings = settings.autoOptimize;
            const appliedOptimizations = [];

            for (const option of simulationResult.optimizedOptions) {
                const shouldAutoApply = this.shouldAutoApplyOptimization(option, autoOptimizeSettings);
                
                if (shouldAutoApply) {
                    appliedOptimizations.push({
                        ...option,
                        autoApplied: true,
                        appliedAt: new Date()
                    });
                }
            }

            if (appliedOptimizations.length > 0) {
                await AutoSimulationQueue.findByIdAndUpdate(queueItemId, {
                    autoApplied: true,
                    appliedOptimizations,
                    updatedAt: new Date()
                });

                loggingService.info(`Auto-applied ${appliedOptimizations.length} optimizations for queue item: ${queueItemId}`);
            }
        } catch (error) {
            loggingService.error('Error considering auto-optimization:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Determine if optimization should be auto-applied
     */
    private static shouldAutoApplyOptimization(option: any, settings: any): boolean {
        // Check savings threshold
        if (option.savingsPercentage < settings.maxSavingsThreshold * 100) {
            return false;
        }

        // Check risk tolerance
        const riskLevels = { low: 1, medium: 2, high: 3 };
        const optionRisk = riskLevels[option.risk as keyof typeof riskLevels] || 2;
        const toleranceRisk = riskLevels[settings.riskTolerance as keyof typeof riskLevels] || 2;
        
        if (optionRisk > toleranceRisk) {
            return false;
        }

        // Check if approval is required
        if (settings.approvalRequired) {
            return false; // Queue for approval instead
        }

        return true;
    }

    /**
     * Get user's auto-simulation settings
     */
    static async getUserSettings(userId: string): Promise<AutoSimulationSettings | null> {
        try {
            const settings = await AutoSimulationSettings.findOne({ 
                userId: new mongoose.Types.ObjectId(userId) 
            }).lean();
            
            if (!settings) return null;
            
            return {
                userId: settings.userId.toString(),
                enabled: settings.enabled,
                triggers: settings.triggers || {
                    costThreshold: 0.01,
                    tokenThreshold: 1000,
                    expensiveModels: [],
                    allCalls: false
                },
                autoOptimize: settings.autoOptimize || {
                    enabled: false,
                    approvalRequired: true,
                    maxSavingsThreshold: 0.50,
                    riskTolerance: 'medium'
                },
                notifications: settings.notifications ? {
                    email: settings.notifications.email,
                    dashboard: settings.notifications.dashboard,
                    slack: settings.notifications.slack,
                    slackWebhook: settings.notifications.slackWebhook || undefined
                } : {
                    email: true,
                    dashboard: true,
                    slack: false
                }
            };
        } catch (error) {
            loggingService.error('Error getting user settings:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    /**
     * Update user's auto-simulation settings
     */
    static async updateUserSettings(
        userId: string, 
        settings: Partial<AutoSimulationSettings>
    ): Promise<void> {
        try {
            await AutoSimulationSettings.findOneAndUpdate(
                { userId: new mongoose.Types.ObjectId(userId) },
                { 
                    ...settings,
                    userId: new mongoose.Types.ObjectId(userId),
                    updatedAt: new Date() 
                },
                { upsert: true, new: true }
            );
            
            loggingService.info(`Updated auto-simulation settings for user: ${userId}`);
        } catch (error) {
            loggingService.error('Error updating user settings:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get user's simulation queue
     */
    static async getUserQueue(
        userId: string, 
        status?: string, 
        limit: number = 20
    ): Promise<AutoSimulationQueueItem[]> {
        try {
            // Use aggregation pipeline for better performance
            const pipeline: any[] = [
                { $match: { userId: new mongoose.Types.ObjectId(userId) } }
            ];

            if (status) {
                pipeline[0].$match.status = status;
            }

            pipeline.push(
                { $sort: { createdAt: -1 } },
                { $limit: limit },
                {
                    $lookup: {
                        from: 'usages',
                        localField: 'usageId',
                        foreignField: '_id',
                        as: 'usage',
                        pipeline: [
                            { $project: { prompt: 1, model: 1, cost: 1, totalTokens: 1 } } // Only needed fields
                        ]
                    }
                },
                {
                    $project: {
                        _id: 1,
                        userId: 1,
                        status: 1,
                        simulationId: 1,
                        optimizationOptions: 1,
                        recommendations: 1,
                        potentialSavings: 1,
                        confidence: 1,
                        autoApplied: 1,
                        appliedOptimizations: 1,
                        errorMessage: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        usage: { $arrayElemAt: ['$usage', 0] }
                    }
                }
            );

            const items = await AutoSimulationQueue.aggregate(pipeline);

            return items.map(item => ({
                id: item._id.toString(),
                userId: item.userId.toString(),
                usageId: item.usage?._id.toString() || '',
                status: item.status,
                simulationId: item.simulationId || undefined,
                optimizationOptions: item.optimizationOptions,
                recommendations: item.recommendations,
                potentialSavings: item.potentialSavings || undefined,
                confidence: item.confidence || undefined,
                autoApplied: item.autoApplied,
                appliedOptimizations: item.appliedOptimizations,
                errorMessage: item.errorMessage || undefined,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            }));
        } catch (error) {
            loggingService.error('Error getting user queue:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Approve or reject pending optimization
     */
    static async handleOptimizationApproval(
        queueItemId: string, 
        approved: boolean, 
        selectedOptimizations?: number[]
    ): Promise<void> {
        try {
            const updateData: any = {
                status: approved ? 'approved' : 'rejected',
                updatedAt: new Date()
            };

            if (approved && selectedOptimizations && selectedOptimizations.length > 0) {
                const queueItem = await AutoSimulationQueue.findById(queueItemId);
                if (queueItem && queueItem.optimizationOptions) {
                    const appliedOptimizations = selectedOptimizations.map(index => ({
                        ...queueItem.optimizationOptions[index],
                        approved: true,
                        appliedAt: new Date()
                    }));
                    
                    updateData.autoApplied = true;
                    updateData.appliedOptimizations = appliedOptimizations;
                }
            }

            await AutoSimulationQueue.findByIdAndUpdate(queueItemId, updateData);
            
            loggingService.info(`${approved ? 'Approved' : 'Rejected'} optimization for queue item: ${queueItemId}`);
        } catch (error) {
            loggingService.error('Error handling optimization approval:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }
}

export default AutoSimulationService;