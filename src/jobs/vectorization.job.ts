import { loggingService } from '../services/logging.service';
import { backgroundVectorizationService } from '../services/backgroundVectorization.service';
import { smartSamplingService } from '../services/smartSampling.service';
import { redisService } from '../services/redis.service';

export interface VectorizationJobConfig {
    name: string;
    schedule: string;
    description: string;
    enabled: boolean;
    lastRun?: Date;
    nextRun?: Date;
    isRunning: boolean;
}

/**
 * Vectorization Job Definitions and Management
 * Handles automated scheduling of vectorization processes via cron jobs
 */
export class VectorizationJob {
    private static readonly SCHEDULES = {
        userMemory: '0 */1 * * *',      // Every hour
        conversations: '0 2 * * *',      // Daily at 2 AM  
        messages: '0 3 * * 0',          // Weekly on Sunday at 3 AM
        healthCheck: '0 4 1 * *',       // Monthly on 1st at 4 AM
        smartSampling: '0 1 * * *'      // Daily at 1 AM (before conversation processing)
    };

    /**
     * Process UserMemory vectorization (runs hourly)
     */
    static async processUserMemories(): Promise<void> {
        const jobName = 'UserMemory Vectorization';
        
        try {
            loggingService.info(`🕐 Starting ${jobName}`, {
                component: 'VectorizationJob',
                job: 'userMemory',
                schedule: VectorizationJob.SCHEDULES.userMemory
            });

            const stats = await backgroundVectorizationService.vectorizeUserMemories();
            
            loggingService.info(`✅ ${jobName} completed successfully`, {
                component: 'VectorizationJob',
                job: 'userMemory',
                stats: {
                    processed: stats.processed,
                    success: stats.success,
                    failed: stats.failed,
                    duration: stats.duration
                }
            });

            // Log business metrics
            loggingService.logBusiness({
                event: 'user_memory_vectorization_completed',
                category: 'background_processing',
                value: stats.duration ?? 0,
                metadata: {
                    processed: stats.processed,
                    success: stats.success,
                    failed: stats.failed,
                    successRate: stats.processed > 0 ? stats.success / stats.processed : 0
                }
            });

        } catch (error) {
            loggingService.error(`❌ ${jobName} failed:`, {
                component: 'VectorizationJob',
                job: 'userMemory',
                error: error instanceof Error ? error.message : String(error)
            });

            // Log business error metrics
            loggingService.logBusiness({
                event: 'user_memory_vectorization_failed',
                category: 'background_processing_errors',
                value: 1,
                metadata: {
                    error: error instanceof Error ? error.message : String(error)
                }
            });

            throw error;
        }
    }

    /**
     * Process ConversationMemory vectorization (runs daily)
     */
    static async processConversations(): Promise<void> {
        const jobName = 'ConversationMemory Vectorization';
        
        try {
            loggingService.info(`🕐 Starting ${jobName}`, {
                component: 'VectorizationJob',
                job: 'conversations',
                schedule: VectorizationJob.SCHEDULES.conversations
            });

            const stats = await backgroundVectorizationService.vectorizeConversationMemories();
            
            loggingService.info(`✅ ${jobName} completed successfully`, {
                component: 'VectorizationJob',
                job: 'conversations',
                stats: {
                    processed: stats.processed,
                    success: stats.success,
                    failed: stats.failed,
                    duration: stats.duration
                }
            });

            // Log business metrics
            loggingService.logBusiness({
                event: 'conversation_memory_vectorization_completed',
                category: 'background_processing',
                value: stats.duration ?? 0,
                metadata: {
                    processed: stats.processed,
                    success: stats.success,
                    failed: stats.failed,
                    successRate: stats.processed > 0 ? stats.success / stats.processed : 0
                }
            });

        } catch (error) {
            loggingService.error(`❌ ${jobName} failed:`, {
                component: 'VectorizationJob',
                job: 'conversations',
                error: error instanceof Error ? error.message : String(error)
            });

            // Log business error metrics
            loggingService.logBusiness({
                event: 'conversation_memory_vectorization_failed',
                category: 'background_processing_errors',
                value: 1,
                metadata: {
                    error: error instanceof Error ? error.message : String(error)
                }
            });

            throw error;
        }
    }

    /**
     * Process smart message sampling and vectorization (runs weekly)
     */
    static async processMessages(): Promise<void> {
        const jobName = 'Message Smart Sampling and Vectorization';
        
        try {
            loggingService.info(`🕐 Starting ${jobName}`, {
                component: 'VectorizationJob',
                job: 'messages',
                schedule: VectorizationJob.SCHEDULES.messages
            });

            // Step 1: Run smart sampling analysis on new messages
            loggingService.info('📊 Starting smart sampling analysis');
            const analysisResults = await smartSamplingService.analyzeMessages();
            
            // Step 2: Vectorize selected high-value messages
            loggingService.info('🎯 Starting vectorization of selected messages');
            const vectorizationStats = await backgroundVectorizationService.vectorizeHighValueMessages();
            
            // Step 3: Update selection criteria based on effectiveness
            loggingService.info('🔄 Updating smart sampling criteria');
            await smartSamplingService.updateSelectionCriteria();
            
            const selectedCount = analysisResults.filter(a => a.shouldVectorize).length;
            
            loggingService.info(`✅ ${jobName} completed successfully`, {
                component: 'VectorizationJob',
                job: 'messages',
                analysis: {
                    analyzed: analysisResults.length,
                    selected: selectedCount,
                    selectionRate: analysisResults.length > 0 ? selectedCount / analysisResults.length : 0
                },
                vectorization: {
                    processed: vectorizationStats.processed,
                    success: vectorizationStats.success,
                    failed: vectorizationStats.failed,
                    duration: vectorizationStats.duration
                }
            });

            // Log business metrics
            loggingService.logBusiness({
                event: 'message_smart_vectorization_completed',
                category: 'background_processing',
                value: vectorizationStats.duration ?? 0,
                metadata: {
                    analyzed: analysisResults.length,
                    selected: selectedCount,
                    vectorized: vectorizationStats.success,
                    selectionRate: analysisResults.length > 0 ? selectedCount / analysisResults.length : 0,
                    successRate: vectorizationStats.processed > 0 ? vectorizationStats.success / vectorizationStats.processed : 0
                }
            });

        } catch (error) {
            loggingService.error(`❌ ${jobName} failed:`, {
                component: 'VectorizationJob',
                job: 'messages',
                error: error instanceof Error ? error.message : String(error)
            });

            // Log business error metrics
            loggingService.logBusiness({
                event: 'message_smart_vectorization_failed',
                category: 'background_processing_errors',
                value: 1,
                metadata: {
                    error: error instanceof Error ? error.message : String(error)
                }
            });

            throw error;
        }
    }

    /**
     * Perform comprehensive health check and optimization (runs monthly)
     */
    static async performHealthCheck(): Promise<void> {
        const jobName = 'Vectorization Health Check and Optimization';
        
        try {
            loggingService.info(`🕐 Starting ${jobName}`, {
                component: 'VectorizationJob',
                job: 'healthCheck',
                schedule: VectorizationJob.SCHEDULES.healthCheck
            });

            // Get comprehensive health statistics
            const healthStats = await backgroundVectorizationService.getVectorizationHealth();
            
            // Get processing time estimates
            const timeEstimates = await backgroundVectorizationService.estimateProcessingTime();
            
            // Get sampling statistics
            const samplingStats = await smartSamplingService.getSamplingStats();
            
            loggingService.info(`✅ ${jobName} completed successfully`, {
                component: 'VectorizationJob',
                job: 'healthCheck',
                health: healthStats,
                estimates: timeEstimates,
                sampling: samplingStats
            });

            // Log comprehensive business metrics
            loggingService.logBusiness({
                event: 'vectorization_health_check_completed',
                category: 'system_health',
                value: 1,
                metadata: {
                    embeddingServiceHealth: healthStats.embeddingService,
                    vectorIndexHealth: healthStats.vectorIndexes,
                    userMemoryVectorization: healthStats.storageUsage.userMemories.percentage,
                    conversationVectorization: healthStats.storageUsage.conversations.percentage,
                    messageVectorization: healthStats.storageUsage.messages.percentage,
                    samplingSelectionRate: samplingStats.selectionRate,
                    averageLearningValue: samplingStats.averageLearningValue,
                    currentlyProcessing: healthStats.currentlyProcessing,
                    totalEstimatedProcessingTime: timeEstimates.totalEstimated
                }
            });

            // Alert if health issues detected
            if (healthStats.embeddingService === 'error' || healthStats.vectorIndexes === 'error') {
                loggingService.error('🚨 Vectorization health issues detected', {
                    component: 'VectorizationJob',
                    embeddingService: healthStats.embeddingService,
                    vectorIndexes: healthStats.vectorIndexes
                });
            }

        } catch (error) {
            loggingService.error(`❌ ${jobName} failed:`, {
                component: 'VectorizationJob',
                job: 'healthCheck',
                error: error instanceof Error ? error.message : String(error)
            });

            // Log business error metrics
            loggingService.logBusiness({
                event: 'vectorization_health_check_failed',
                category: 'system_health_errors',
                value: 1,
                metadata: {
                    error: error instanceof Error ? error.message : String(error)
                }
            });

            throw error;
        }
    }

    /**
     * Daily smart sampling job (runs before conversation processing)
     */
    static async performSmartSampling(): Promise<void> {
        const jobName = 'Daily Smart Sampling Analysis';
        
        try {
            loggingService.info(`🕐 Starting ${jobName}`, {
                component: 'VectorizationJob',
                job: 'smartSampling',
                schedule: VectorizationJob.SCHEDULES.smartSampling
            });

            // Analyze new messages from the last 24 hours
            const analysisResults = await smartSamplingService.analyzeMessages();
            const selectedCount = analysisResults.filter(a => a.shouldVectorize).length;
            
            loggingService.info(`✅ ${jobName} completed successfully`, {
                component: 'VectorizationJob',
                job: 'smartSampling',
                analyzed: analysisResults.length,
                selected: selectedCount,
                selectionRate: analysisResults.length > 0 ? selectedCount / analysisResults.length : 0
            });

            // Log business metrics
            loggingService.logBusiness({
                event: 'daily_smart_sampling_completed',
                category: 'background_processing',
                value: analysisResults.length,
                metadata: {
                    analyzed: analysisResults.length,
                    selected: selectedCount,
                    selectionRate: analysisResults.length > 0 ? selectedCount / analysisResults.length : 0,
                    averageLearningValue: analysisResults.reduce((sum, a) => sum + a.learningValue, 0) / (analysisResults.length || 1)
                }
            });

        } catch (error) {
            loggingService.error(`❌ ${jobName} failed:`, {
                component: 'VectorizationJob',
                job: 'smartSampling',
                error: error instanceof Error ? error.message : String(error)
            });

            // Log business error metrics  
            loggingService.logBusiness({
                event: 'daily_smart_sampling_failed',
                category: 'background_processing_errors',
                value: 1,
                metadata: {
                    error: error instanceof Error ? error.message : String(error)
                }
            });

            throw error;
        }
    }

    /**
     * Get all job configurations
     */
    static getJobConfigurations(): VectorizationJobConfig[] {
        return [
            {
                name: 'UserMemory Vectorization',
                schedule: VectorizationJob.SCHEDULES.userMemory,
                description: 'Vectorize user memories and preferences for personalization',
                enabled: true,
                isRunning: false
            },
            {
                name: 'Daily Smart Sampling',
                schedule: VectorizationJob.SCHEDULES.smartSampling,
                description: 'Analyze messages to identify high-value content for vectorization',
                enabled: true,
                isRunning: false
            },
            {
                name: 'ConversationMemory Vectorization',
                schedule: VectorizationJob.SCHEDULES.conversations,
                description: 'Vectorize conversation histories for context-aware responses',
                enabled: true,
                isRunning: false
            },
            {
                name: 'Message Vectorization',
                schedule: VectorizationJob.SCHEDULES.messages,
                description: 'Vectorize selected high-value messages and update selection criteria',
                enabled: true,
                isRunning: false
            },
            {
                name: 'Health Check and Optimization',
                schedule: VectorizationJob.SCHEDULES.healthCheck,
                description: 'Comprehensive system health monitoring and optimization',
                enabled: true,
                isRunning: false
            }
        ];
    }

    /**
     * Get cron expressions for job scheduler integration
     */
    static getCronExpressions(): { [jobName: string]: string } {
        return VectorizationJob.SCHEDULES;
    }

    /**
     * Validate that all required services are available
     */
    static async validateServices(): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];
        
        try {
            // Test background vectorization service
            await backgroundVectorizationService.getVectorizationHealth();
        } catch (error) {
            errors.push(`Background vectorization service: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
            // Test smart sampling service
            await smartSamplingService.getSamplingStats();
        } catch (error) {
            errors.push(`Smart sampling service: ${error instanceof Error ? error.message : String(error)}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Emergency stop for all vectorization jobs
     */
    static async emergencyStop(): Promise<void> {
        loggingService.warn('🛑 Emergency stop requested for all vectorization jobs', {
            component: 'VectorizationJob'
        });

        try {
            // Clear all processing locks to stop running jobs
            const lockKeys = [
                'vectorization:lock:user_memories',
                'vectorization:lock:conversations',
                'vectorization:lock:messages'
            ];

            const clearedLocks: string[] = [];
            for (const lockKey of lockKeys) {
                try {
                    const exists = await redisService.exists(lockKey);
                    if (exists) {
                        await redisService.del(lockKey);
                        clearedLocks.push(lockKey);
                        loggingService.info(`🔓 Cleared processing lock: ${lockKey}`, {
                            component: 'VectorizationJob',
                            operation: 'emergencyStop'
                        });
                    }
                } catch (error) {
                    loggingService.error(`Failed to clear lock ${lockKey}:`, {
                        component: 'VectorizationJob',
                        operation: 'emergencyStop',
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            // Clear any scheduled job flags (if using a job queue system)
            // This is a placeholder for future job queue integration
            const scheduledJobKeys = [
                'vectorization:scheduled:user_memories',
                'vectorization:scheduled:conversations',
                'vectorization:scheduled:messages',
                'vectorization:scheduled:smart_sampling',
                'vectorization:scheduled:health_check'
            ];

            for (const jobKey of scheduledJobKeys) {
                try {
                    await redisService.del(jobKey);
                } catch (error) {
                    // Ignore errors for optional keys
                }
            }

            loggingService.info('✅ Emergency stop completed', {
                component: 'VectorizationJob',
                operation: 'emergencyStop',
                clearedLocks: clearedLocks.length,
                totalLocks: lockKeys.length
            });

            loggingService.logBusiness({
                event: 'vectorization_emergency_stop',
                category: 'system_control',
                value: 1,
                metadata: {
                    timestamp: new Date().toISOString(),
                    reason: 'Manual emergency stop',
                    clearedLocks: clearedLocks.length,
                    locks: clearedLocks
                }
            });
        } catch (error) {
            loggingService.error('❌ Emergency stop failed:', {
                component: 'VectorizationJob',
                operation: 'emergencyStop',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}

/**
 * Job wrapper functions for easy integration with cron schedulers
 * These can be called directly by cron systems like node-cron, agenda, etc.
 */

export const vectorizationJobHandlers = {
    
    // Hourly job
    userMemoryVectorization: async (): Promise<void> => {
        await VectorizationJob.processUserMemories();
    },

    // Daily jobs
    smartSampling: async (): Promise<void> => {
        await VectorizationJob.performSmartSampling();
    },

    conversationVectorization: async (): Promise<void> => {
        await VectorizationJob.processConversations();
    },

    // Weekly job
    messageVectorization: async (): Promise<void> => {
        await VectorizationJob.processMessages();
    },

    // Monthly job
    healthCheckAndOptimization: async (): Promise<void> => {
        await VectorizationJob.performHealthCheck();
    }
};

// Export the schedules for easy integration
export const VECTORIZATION_CRON_SCHEDULES = VectorizationJob.getCronExpressions();