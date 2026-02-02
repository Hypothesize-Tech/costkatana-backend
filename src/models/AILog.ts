import mongoose, { Schema, Document } from 'mongoose';

/**
 * AILog Document Interface - Comprehensive AI operation logging
 * Captures all AI endpoint calls with full context for debugging and analysis
 */
export interface IAILogDocument {
    // Core identification fields
    userId: mongoose.Types.ObjectId;
    projectId?: mongoose.Types.ObjectId;
    requestId: string; // Correlation ID for distributed tracing
    timestamp: Date;
    
    // Service information
    service: 'aws-bedrock' | 'openai' | 'anthropic' | 'google-ai' | 'huggingface' | 'cohere' | 'cortex' | string;
    operation: string; // e.g., "invokeModel", "encodeToTOON", "streamResponse"
    endpoint?: string; // API endpoint if applicable
    method?: string; // HTTP method or SDK method
    
    // Model information
    aiModel: string; // Model identifier (e.g., "claude-3-sonnet", "gpt-4")
    modelVersion?: string;
    
    // Request data
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    prompt?: string; // Truncated for privacy (first 500 chars)
    promptHash?: string; // SHA256 hash for exact matching
    parameters?: {
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        topK?: number;
        frequencyPenalty?: number;
        presencePenalty?: number;
        stopSequences?: string[];
        [key: string]: any;
    };
    
    // Response data
    statusCode: number; // HTTP status or equivalent
    success: boolean;
    responseTime: number; // Milliseconds
    cost?: number; // USD
    result?: string; // Truncated response (first 500 chars)
    resultHash?: string; // SHA256 hash
    
    // Error tracking
    errorMessage?: string;
    errorType?: 'client_error' | 'server_error' | 'network_error' | 'auth_error' | 'rate_limit' | 'timeout' | 'validation_error' | 'throttling' | 'quota_exceeded';
    errorStack?: string; // Sanitized stack trace
    errorCode?: string; // Provider-specific error code
    
    // Context metadata
    ipAddress?: string;
    userAgent?: string;
    traceId?: string;
    traceName?: string;
    traceStep?: string;
    experimentId?: string;
    experimentName?: string;
    notebookId?: string;
    sessionId?: string;
    
    // Optimization flags
    cortexEnabled?: boolean;
    cortexOptimizationApplied?: boolean;
    cacheHit?: boolean;
    cacheKey?: string;
    retryAttempt?: number; // 0 for first attempt
    
    // Performance metrics
    ttfb?: number; // Time to first byte
    streamingLatency?: number;
    queueTime?: number;
    
    // Cost tracking
    costBreakdown?: {
        inputCost: number;
        outputCost: number;
        cacheCost?: number;
        additionalFees?: number;
    };
    
    // Compliance and governance
    tags?: string[];
    environment?: 'development' | 'staging' | 'production';
    region?: string; // AWS region or provider region
    
    // Log metadata
    logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
    logSource?: string; // File/service that generated the log
    
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IAILog extends IAILogDocument, Document {}

const aiLogSchema = new Schema<IAILog>({
    // Core identification
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        index: true
    },
    requestId: {
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
    
    // Service information
    service: {
        type: String,
        required: true,
        index: true
    },
    operation: {
        type: String,
        required: true,
        index: true
    },
    endpoint: String,
    method: String,
    
    // Model information
    aiModel: {
        type: String,
        required: true,
        index: true
    },
    modelVersion: String,
    
    // Request data
    inputTokens: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    outputTokens: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    totalTokens: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    prompt: {
        type: String,
        maxlength: 1000 // Truncated for storage
    },
    promptHash: String,
    parameters: {
        type: Schema.Types.Mixed,
        default: {}
    },
    
    // Response data
    statusCode: {
        type: Number,
        required: true,
        index: true
    },
    success: {
        type: Boolean,
        required: true,
        default: true,
        index: true
    },
    responseTime: {
        type: Number,
        required: true,
        min: 0,
        index: true
    },
    cost: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
        index: true
    },
    result: {
        type: String,
        maxlength: 1000
    },
    resultHash: String,
    
    // Error tracking
    errorMessage: {
        type: String,
        index: 'text' // Text index for search
    },
    errorType: {
        type: String,
        enum: ['client_error', 'server_error', 'network_error', 'auth_error', 'rate_limit', 'timeout', 'validation_error', 'throttling', 'quota_exceeded'],
        index: true
    },
    errorStack: String,
    errorCode: String,
    
    // Context metadata
    ipAddress: String,
    userAgent: String,
    traceId: {
        type: String,
        index: true
    },
    traceName: String,
    traceStep: String,
    experimentId: {
        type: String,
        index: true
    },
    experimentName: String,
    notebookId: String,
    sessionId: String,
    
    // Optimization flags
    cortexEnabled: {
        type: Boolean,
        default: false,
        index: true
    },
    cortexOptimizationApplied: Boolean,
    cacheHit: {
        type: Boolean,
        default: false,
        index: true
    },
    cacheKey: String,
    retryAttempt: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Performance metrics
    ttfb: Number,
    streamingLatency: Number,
    queueTime: Number,
    
    // Cost tracking
    costBreakdown: {
        inputCost: Number,
        outputCost: Number,
        cacheCost: Number,
        additionalFees: Number
    },
    
    // Compliance and governance
    tags: [{
        type: String,
        trim: true
    }],
    environment: {
        type: String,
        enum: ['development', 'staging', 'production'],
        default: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        index: true
    },
    region: String,
    
    // Log metadata
    logLevel: {
        type: String,
        enum: ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'],
        default: 'INFO',
        index: true
    },
    logSource: {
        type: String,
        default: 'system'
    }
}, {
    timestamps: true,
    collection: 'ailogs'
});

// Compound indexes for common query patterns
aiLogSchema.index({ projectId: 1, timestamp: -1 }); // Project logs ordered by time
aiLogSchema.index({ userId: 1, timestamp: -1 }); // User logs ordered by time
aiLogSchema.index({ service: 1, model: 1, timestamp: -1 }); // Service/model performance
aiLogSchema.index({ success: 1, timestamp: -1 }); // Error tracking
aiLogSchema.index({ requestId: 1, timestamp: 1 }); // Distributed tracing
aiLogSchema.index({ traceId: 1, timestamp: 1 }); // Agent trace tracking
aiLogSchema.index({ experimentId: 1, timestamp: 1 }); // Experiment tracking
aiLogSchema.index({ cost: -1, timestamp: -1 }); // Expensive operations
aiLogSchema.index({ responseTime: -1, timestamp: -1 }); // Slow operations

// TTL index for optional data retention (default: no expiration)
// Uncomment to enable automatic cleanup after 90 days
// aiLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Virtual for total cost calculation
aiLogSchema.virtual('totalCost').get(function() {
    if (this.costBreakdown) {
        return (
            (this.costBreakdown.inputCost || 0) +
            (this.costBreakdown.outputCost || 0) +
            (this.costBreakdown.cacheCost || 0) +
            (this.costBreakdown.additionalFees || 0)
        );
    }
    return this.cost;
});

// Instance method to check if log represents an error
aiLogSchema.methods.isError = function(): boolean {
    return !this.success || this.statusCode >= 400;
};

// Instance method to get truncated error message
aiLogSchema.methods.getErrorSummary = function(): string | null {
    if (!this.errorMessage) return null;
    return this.errorMessage.length > 200 
        ? this.errorMessage.substring(0, 200) + '...' 
        : this.errorMessage;
};

// Static method to get logs for a specific request chain
aiLogSchema.statics.getRequestChain = async function(requestId: string) {
    return this.find({ requestId }).sort({ timestamp: 1 }).exec();
};

// Static method to get error rate for a time period
aiLogSchema.statics.getErrorRate = async function(
    startTime: Date,
    endTime: Date,
    filters: any = {}
) {
    const result = await this.aggregate([
        {
            $match: {
                timestamp: { $gte: startTime, $lte: endTime },
                ...filters
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                errors: {
                    $sum: {
                        $cond: [{ $eq: ['$success', false] }, 1, 0]
                    }
                }
            }
        },
        {
            $project: {
                _id: 0,
                total: 1,
                errors: 1,
                errorRate: {
                    $cond: [
                        { $eq: ['$total', 0] },
                        0,
                        { $divide: ['$errors', '$total'] }
                    ]
                }
            }
        }
    ]);
    
    return result[0] || { total: 0, errors: 0, errorRate: 0 };
};

// Static method to get cost analytics
aiLogSchema.statics.getCostAnalytics = async function(
    startTime: Date,
    endTime: Date,
    groupBy: 'service' | 'aiModel' | 'project' | 'user' = 'service'
) {
    const groupField = `$${groupBy === 'project' ? 'projectId' : groupBy === 'user' ? 'userId' : groupBy}`;
    
    return this.aggregate([
        {
            $match: {
                timestamp: { $gte: startTime, $lte: endTime }
            }
        },
        {
            $group: {
                _id: groupField,
                totalCost: { $sum: '$cost' },
                totalTokens: { $sum: '$totalTokens' },
                totalRequests: { $sum: 1 },
                avgLatency: { $avg: '$responseTime' },
                errors: {
                    $sum: {
                        $cond: [{ $eq: ['$success', false] }, 1, 0]
                    }
                }
            }
        },
        {
            $sort: { totalCost: -1 }
        }
    ]);
};

// Pre-save hook to calculate totalTokens and sanitize data
aiLogSchema.pre('save', function(next) {
    // Calculate total tokens if not set
    if (!this.totalTokens && (this.inputTokens || this.outputTokens)) {
        this.totalTokens = (this.inputTokens || 0) + (this.outputTokens || 0);
    }
    
    // Set success based on status code if not explicitly set
    if (this.statusCode && this.success === undefined) {
        this.success = this.statusCode < 400;
    }
    
    // Truncate long strings for storage efficiency
    if (this.prompt && this.prompt.length > 1000) {
        this.prompt = this.prompt.substring(0, 1000);
    }
    
    if (this.result && this.result.length > 1000) {
        this.result = this.result.substring(0, 1000);
    }
    
    // Sanitize error stack (remove sensitive paths)
    if (this.errorStack) {
        this.errorStack = this.errorStack.replace(/\/Users\/[^\/]+/g, '/Users/***')
                                         .replace(/\/home\/[^\/]+/g, '/home/***')
                                         .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***');
    }
    
    next();
});

export const AILog = mongoose.model<IAILog>('AILog', aiLogSchema);

