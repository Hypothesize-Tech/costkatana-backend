import mongoose, { Schema, Document } from 'mongoose';

// ============================================================================
// MODEL PERFORMANCE HISTORY MODEL
// ============================================================================

export interface IModelPerformanceHistory extends Document {
    modelName: string;
    provider: string;
    timestamp: Date;
    metrics: {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        averageCost: number;
        averageLatency: number;
        averageQualityScore?: number;
        totalCostSaved?: number;
    };
    contextMetrics: {
        byUserTier: Map<string, {
            requests: number;
            successRate: number;
            averageCost: number;
        }>;
        byTaskType: Map<string, {
            requests: number;
            successRate: number;
            averageQualityScore: number;
        }>;
        byPromptComplexity: {
            low: { requests: number; successRate: number };
            medium: { requests: number; successRate: number };
            high: { requests: number; successRate: number };
        };
    };
    performanceScore: number; // 0-100 composite score
    recommendationConfidence: number; // 0-1 confidence for recommendations
}

const ModelPerformanceHistorySchema = new Schema<IModelPerformanceHistory>({
    modelName: { 
        type: String, 
        required: true,
        index: true 
    },
    provider: { 
        type: String, 
        required: true,
        index: true 
    },
    timestamp: { 
        type: Date, 
        required: true, 
        default: Date.now,
        index: true 
    },
    metrics: {
        totalRequests: { type: Number, required: true, default: 0 },
        successfulRequests: { type: Number, required: true, default: 0 },
        failedRequests: { type: Number, required: true, default: 0 },
        averageCost: { type: Number, required: true, default: 0 },
        averageLatency: { type: Number, required: true, default: 0 },
        averageQualityScore: { type: Number },
        totalCostSaved: { type: Number }
    },
    contextMetrics: {
        byUserTier: { type: Map, of: Schema.Types.Mixed },
        byTaskType: { type: Map, of: Schema.Types.Mixed },
        byPromptComplexity: {
            low: { 
                requests: { type: Number, default: 0 },
                successRate: { type: Number, default: 0 }
            },
            medium: { 
                requests: { type: Number, default: 0 },
                successRate: { type: Number, default: 0 }
            },
            high: { 
                requests: { type: Number, default: 0 },
                successRate: { type: Number, default: 0 }
            }
        }
    },
    performanceScore: { 
        type: Number, 
        required: true, 
        min: 0, 
        max: 100,
        default: 50 
    },
    recommendationConfidence: { 
        type: Number, 
        required: true, 
        min: 0, 
        max: 1,
        default: 0.5 
    }
}, {
    timestamps: true,
    collection: 'model_performance_history'
});

// Compound indexes for performance queries
ModelPerformanceHistorySchema.index({ modelName: 1, provider: 1, timestamp: -1 });
ModelPerformanceHistorySchema.index({ performanceScore: -1, timestamp: -1 });
ModelPerformanceHistorySchema.index({ 'metrics.averageCost': 1, 'metrics.averageQualityScore': -1 });

// TTL index - keep 180 days of history
ModelPerformanceHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 15552000 }); // 180 days

export const ModelPerformanceHistory = mongoose.model<IModelPerformanceHistory>('ModelPerformanceHistory', ModelPerformanceHistorySchema);

