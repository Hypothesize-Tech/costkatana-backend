/**
 * Cortex Training Data Collector Service
 * 
 * Asynchronously collects all Cortex prompts, LISP formats, and flow information
 * for future model training without affecting performance or latency.
 * 
 * Key Features:
 * - Fire-and-forget async operations
 * - Failure-resistant (errors don't affect Cortex flow)
 * - Comprehensive data collection for training
 * - Performance monitoring and metrics
 */

import { loggingService } from './logging.service';
import { CortexFrame } from '../types/cortex.types';
import mongoose, { Schema, Document } from 'mongoose';

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

interface CortexTrainingDataEntry {
    sessionId: string;
    userId: string;
    timestamp: Date;
    
    // Original user input
    originalPrompt: string;
    originalTokenCount: number;
    
    // LISP Instruction Generator
    lispInstructions: {
        encoderPrompt: string;
        coreProcessorPrompt: string;
        decoderPrompt: string;
        generatedAt: Date;
        model: string;
    };
    
    // Encoder stage
    encoderStage: {
        inputText: string;
        outputLisp: CortexFrame;
        confidence: number;
        processingTime: number;
        model: string;
        tokenCounts: {
            input: number;
            output: number;
        };
    };
    
    // Core Processor stage
    coreProcessorStage: {
        inputLisp: CortexFrame;
        outputLisp: CortexFrame;
        answerType: string;
        processingTime: number;
        model: string;
        tokenCounts: {
            input: number;
            output: number;
        };
    };
    
    // Decoder stage
    decoderStage: {
        inputLisp: CortexFrame;
        outputText: string;
        style: string;
        processingTime: number;
        model: string;
        tokenCounts: {
            input: number;
            output: number;
        };
    };
    
    // Performance metrics
    performance: {
        totalProcessingTime: number;
        totalTokenReduction: number;
        tokenReductionPercentage: number;
        costSavings: number;
        qualityScore?: number;
    };
    
    // Context information
    context: {
        service: string; // 'optimization', 'gateway', etc.
        category: string;
        complexity: 'simple' | 'medium' | 'complex';
        language: string;
        userAgent?: string;
        requestId?: string;
    };
    
    // Training labels (for future use)
    trainingLabels?: {
        isSuccessful: boolean;
        userFeedback?: number; // 1-5 rating
        errorType?: string;
        improvementSuggestions?: string[];
    };
}

interface CortexTrainingDataDocument extends CortexTrainingDataEntry, Document {}

// ============================================================================
// MONGODB SCHEMA
// ============================================================================

const CortexTrainingDataSchema = new Schema<CortexTrainingDataDocument>({
    sessionId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    
    originalPrompt: { type: String, required: true },
    originalTokenCount: { type: Number, required: true },
    
    lispInstructions: {
        encoderPrompt: String,
        coreProcessorPrompt: String,
        decoderPrompt: String,
        generatedAt: Date,
        model: String
    },
    
    encoderStage: {
        inputText: String,
        outputLisp: Schema.Types.Mixed,
        confidence: Number,
        processingTime: Number,
        model: String,
        tokenCounts: {
            input: Number,
            output: Number
        }
    },
    
    coreProcessorStage: {
        inputLisp: Schema.Types.Mixed,
        outputLisp: Schema.Types.Mixed,
        answerType: String,
        processingTime: Number,
        model: String,
        tokenCounts: {
            input: Number,
            output: Number
        }
    },
    
    decoderStage: {
        inputLisp: Schema.Types.Mixed,
        outputText: String,
        style: String,
        processingTime: Number,
        model: String,
        tokenCounts: {
            input: Number,
            output: Number
        }
    },
    
    performance: {
        totalProcessingTime: Number,
        totalTokenReduction: Number,
        tokenReductionPercentage: Number,
        costSavings: Number,
        qualityScore: Number
    },
    
    context: {
        service: String,
        category: String,
        complexity: { type: String, enum: ['simple', 'medium', 'complex'] },
        language: String,
        userAgent: String,
        requestId: String
    },
    
    trainingLabels: {
        isSuccessful: Boolean,
        userFeedback: Number,
        errorType: String,
        improvementSuggestions: [String]
    }
}, {
    timestamps: true,
    collection: 'cortex_training_data'
});

// Indexes for efficient querying
CortexTrainingDataSchema.index({ userId: 1, timestamp: -1 });
CortexTrainingDataSchema.index({ 'context.service': 1, 'context.complexity': 1 });
CortexTrainingDataSchema.index({ 'performance.tokenReductionPercentage': -1 });
CortexTrainingDataSchema.index({ sessionId: 1, timestamp: 1 });

const CortexTrainingData = mongoose.model('CortexTrainingData', CortexTrainingDataSchema);

// ============================================================================
// CORTEX TRAINING DATA COLLECTOR SERVICE
// ============================================================================

export class CortexTrainingDataCollectorService {
    private static instance: CortexTrainingDataCollectorService;
    private collectionQueue: Map<string, Partial<CortexTrainingDataEntry>> = new Map();
    private batchQueue: CortexTrainingDataEntry[] = [];
    
    // Optimized: Bounded queue configuration
    private readonly MAX_QUEUE_SIZE = 1000;
    private readonly BATCH_SIZE = 50;
    private readonly BATCH_INTERVAL = 30000; // 30 seconds
    
    private stats = {
        totalCollected: 0,
        successfulSaves: 0,
        failedSaves: 0,
        averageProcessingTime: 0,
        batchesProcessed: 0
    };

    private constructor() {
        // Optimized: Batch processing instead of individual saves
        setInterval(() => this.processBatch(), this.BATCH_INTERVAL);
        // More frequent cleanup to prevent memory leaks
        setInterval(() => this.cleanupStaleEntries(), 60000); // 1 minute
    }

    /**
     * Process batch of training data entries
     */
    private async processBatch(): Promise<void> {
        if (this.batchQueue.length === 0) return;
        
        const batch = this.batchQueue.splice(0, this.BATCH_SIZE);
        
        try {
            // Batch insert instead of individual saves
            await CortexTrainingData.insertMany(batch, { ordered: false });
            this.stats.successfulSaves += batch.length;
            this.stats.batchesProcessed++;
            
            loggingService.debug('✅ Batch training data saved', {
                batchSize: batch.length,
                totalBatches: this.stats.batchesProcessed
            });
        } catch (error) {
            this.stats.failedSaves += batch.length;
            
            loggingService.debug('❌ Batch save failed', {
                batchSize: batch.length,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }


    public static getInstance(): CortexTrainingDataCollectorService {
        if (!this.instance) {
            this.instance = new CortexTrainingDataCollectorService();
        }
        return this.instance;
    }

    /**
     * Start collecting data for a new Cortex session
     * This is called at the beginning of the Cortex flow
     */
    public startSession(
        sessionId: string,
        userId: string,
        originalPrompt: string,
        context: Partial<CortexTrainingDataEntry['context']>
    ): void {
        // Fire-and-forget - no await, no error handling that affects main flow
        setImmediate(() => {
            try {
                const entry: Partial<CortexTrainingDataEntry> = {
                    sessionId,
                    userId,
                    timestamp: new Date(),
                    originalPrompt,
                    originalTokenCount: this.estimateTokenCount(originalPrompt),
                    context: {
                        service: 'optimization',
                        category: 'unknown',
                        complexity: this.analyzeComplexity(originalPrompt),
                        language: 'en',
                        ...context
                    }
                };

                this.collectionQueue.set(sessionId, entry);
                
                loggingService.debug('🎯 Started Cortex training data collection', {
                    sessionId,
                    userId,
                    promptLength: originalPrompt.length
                });
            } catch (error) {
                // Silent failure - don't affect main Cortex flow
                loggingService.debug('Training data collection start failed (silent)', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    /**
     * Collect LISP instruction generation data
     */
    public collectLispInstructions(
        sessionId: string,
        instructions: {
            encoderPrompt: string;
            coreProcessorPrompt: string;
            decoderPrompt: string;
            model: string;
        }
    ): void {
        setImmediate(() => {
            try {
                const entry = this.collectionQueue.get(sessionId);
                if (entry) {
                    entry.lispInstructions = {
                        ...instructions,
                        generatedAt: new Date()
                    };
                    this.collectionQueue.set(sessionId, entry);
                }
            } catch (error) {
                // Silent failure
                loggingService.debug('❌ Failed to collect LISP instructions (silent)', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    /**
     * Collect encoder stage data
     */
    public collectEncoderData(
        sessionId: string,
        data: {
            inputText: string;
            outputLisp: CortexFrame;
            confidence: number;
            processingTime: number;
            model: string;
        }
    ): void {
        setImmediate(() => {
            try {
                const entry = this.collectionQueue.get(sessionId);
                if (entry) {
                    entry.encoderStage = {
                        ...data,
                        tokenCounts: {
                            input: this.estimateTokenCount(data.inputText),
                            output: this.estimateTokenCount(JSON.stringify(data.outputLisp))
                        }
                    };
                    this.collectionQueue.set(sessionId, entry);
                }
            } catch (error) {
                // Silent failure
                loggingService.debug('❌ Failed to collect encoder data (silent)', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    /**
     * Collect core processor stage data
     */
    public collectCoreProcessorData(
        sessionId: string,
        data: {
            inputLisp: CortexFrame;
            outputLisp: CortexFrame;
            answerType: string;
            processingTime: number;
            model: string;
        }
    ): void {
        setImmediate(() => {
            try {
                const entry = this.collectionQueue.get(sessionId);
                if (entry) {
                    entry.coreProcessorStage = {
                        ...data,
                        tokenCounts: {
                            input: this.estimateTokenCount(JSON.stringify(data.inputLisp)),
                            output: this.estimateTokenCount(JSON.stringify(data.outputLisp))
                        }
                    };
                    this.collectionQueue.set(sessionId, entry);
                }
            } catch (error) {
                // Silent failure
                loggingService.debug('❌ Failed to collect core processor data (silent)', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    /**
     * Collect decoder stage data
     */
    public collectDecoderData(
        sessionId: string,
        data: {
            inputLisp: CortexFrame;
            outputText: string;
            style: string;
            processingTime: number;
            model: string;
        }
    ): void {
        setImmediate(() => {
            try {
                const entry = this.collectionQueue.get(sessionId);
                if (entry) {
                    entry.decoderStage = {
                        ...data,
                        tokenCounts: {
                            input: this.estimateTokenCount(JSON.stringify(data.inputLisp)),
                            output: this.estimateTokenCount(data.outputText)
                        }
                    };
                    this.collectionQueue.set(sessionId, entry);
                }
            } catch (error) {
                // Silent failure
                loggingService.debug('❌ Failed to collect decoder data (silent)', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    /**
     * Finalize and save the complete training data entry - Optimized with batch processing
     */
    public finalizeSession(
        sessionId: string,
        performance: {
            totalProcessingTime: number;
            totalTokenReduction: number;
            tokenReductionPercentage: number;
            costSavings: number;
            qualityScore?: number;
        }
    ): void {
        // Fire-and-forget async processing
        setImmediate(() => {
            try {
                const entry = this.collectionQueue.get(sessionId);
                if (!entry) {
                    return; // Session not found, skip silently
                }

                // Check queue size limit to prevent memory leaks
                if (this.batchQueue.length >= this.MAX_QUEUE_SIZE) {
                    loggingService.debug('🚨 Batch queue full, dropping oldest entries', {
                        queueSize: this.batchQueue.length,
                        maxSize: this.MAX_QUEUE_SIZE
                    });
                    // Drop oldest entries to make room
                    this.batchQueue.splice(0, this.BATCH_SIZE);
                }

                // Add performance metrics
                entry.performance = performance;

                // Mark as successful by default
                entry.trainingLabels = {
                    isSuccessful: true
                };

                // Add to batch queue instead of immediate save
                this.batchQueue.push(entry as CortexTrainingDataEntry);
                
                // Remove from collection queue
                this.collectionQueue.delete(sessionId);
                
                this.stats.totalCollected++;
                
                loggingService.debug('✅ Cortex training data queued for batch processing', {
                    sessionId,
                    batchQueueSize: this.batchQueue.length,
                    totalTokenReduction: performance.totalTokenReduction,
                    reductionPercentage: performance.tokenReductionPercentage
                });
                
            } catch (error) {
                // Log error but don't throw - silent failure
                loggingService.debug('❌ Cortex training data finalization failed (silent)', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
                
                // Still remove from queue to prevent memory leaks
                this.collectionQueue.delete(sessionId);
            }
        });
    }

    /**
     * Add user feedback to existing training data
     */
    public addUserFeedback(
        sessionId: string,
        feedback: {
            rating: number; // 1-5
            isSuccessful: boolean;
            improvementSuggestions?: string[];
        }
    ): void {
        setImmediate(async () => {
            try {
                await CortexTrainingData.updateOne(
                    { sessionId },
                    {
                        $set: {
                            'trainingLabels.userFeedback': feedback.rating,
                            'trainingLabels.isSuccessful': feedback.isSuccessful,
                            'trainingLabels.improvementSuggestions': feedback.improvementSuggestions || []
                        }
                    }
                );
                
                loggingService.debug('✅ User feedback added to training data', {
                    sessionId,
                    rating: feedback.rating
                });
            } catch (error) {
                // Silent failure
                loggingService.debug('❌ Failed to add user feedback (silent)', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }

    /**
     * Get training data statistics - Enhanced with batch processing metrics
     */
    public getStats(): typeof this.stats & { queueSize: number; batchQueueSize: number } {
        return {
            ...this.stats,
            queueSize: this.collectionQueue.size,
            batchQueueSize: this.batchQueue.length
        };
    }

    /**
     * Export training data for model training
     */
    public async exportTrainingData(filters: {
        startDate?: Date;
        endDate?: Date;
        userId?: string;
        complexity?: 'simple' | 'medium' | 'complex';
        minTokenReduction?: number;
        limit?: number;
    } = {}): Promise<any[]> {
        try {
            const query: any = {};
            
            if (filters.startDate || filters.endDate) {
                query.timestamp = {};
                if (filters.startDate) query.timestamp.$gte = filters.startDate;
                if (filters.endDate) query.timestamp.$lte = filters.endDate;
            }
            
            if (filters.userId) query.userId = filters.userId;
            if (filters.complexity) query['context.complexity'] = filters.complexity;
            if (filters.minTokenReduction) {
                query['performance.tokenReductionPercentage'] = { $gte: filters.minTokenReduction };
            }

            const data = await CortexTrainingData.find(query)
                .sort({ timestamp: -1 })
                .limit(filters.limit || 1000)
                .lean();

            loggingService.info('📊 Exported Cortex training data', {
                count: data.length,
                filters
            });

            return data;
        } catch (error) {
            loggingService.error('❌ Failed to export training data', {
                error: error instanceof Error ? error.message : String(error),
                filters
            });
            throw error;
        }
    }

    // ========================================================================
    // PRIVATE HELPER METHODS
    // ========================================================================

    private estimateTokenCount(text: string): number {
        // Simple token estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }

    private analyzeComplexity(prompt: string): 'simple' | 'medium' | 'complex' {
        const length = prompt.length;
        const words = prompt.split(/\s+/).length;
        
        if (length < 100 && words < 20) return 'simple';
        if (length < 500 && words < 100) return 'medium';
        return 'complex';
    }

    private cleanupStaleEntries(): void {
        const now = Date.now();
        const staleThreshold = 30 * 60 * 1000; // 30 minutes
        
        const entriesToDelete: string[] = [];
        
        this.collectionQueue.forEach((entry, sessionId) => {
            if (entry.timestamp && (now - entry.timestamp.getTime()) > staleThreshold) {
                entriesToDelete.push(sessionId);
            }
        });
        
        entriesToDelete.forEach(sessionId => {
            this.collectionQueue.delete(sessionId);
            loggingService.debug('🧹 Cleaned up stale training data entry', { sessionId });
        });
    }
}

export { CortexTrainingData, CortexTrainingDataEntry };
