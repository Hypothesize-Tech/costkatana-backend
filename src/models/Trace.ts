import mongoose, { Schema } from 'mongoose';

export interface ITrace {
    _id?: any;
    traceId: string;
    userId: mongoose.Types.ObjectId;
    projectId?: mongoose.Types.ObjectId;
    name: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    startTime: Date;
    endTime?: Date;
    duration?: number; // milliseconds
    totalCost: number;
    totalTokens: number;
    callCount: number;
    rootSpanId?: string;
    spans: ITraceSpan[];
    metadata: {
        environment?: string;
        version?: string;
        userId?: string;
        sessionId?: string;
        tags?: string[];
        customAttributes?: Record<string, any>;
        replayOf?: string;
        replayId?: string;
        replayConfig?: any;
    };
    dependencies: {
        services: string[];
        models: string[];
        providers: string[];
    };
    performance: {
        criticalPath: string[];
        bottlenecks: Array<{
            spanId: string;
            reason: string;
            impact: number;
        }>;
        parallelizable: string[];
        cacheOpportunities: Array<{
            spanId: string;
            promptHash: string;
            estimatedSavings: number;
        }>;
    };
    errors: Array<{
        spanId: string;
        error: string;
        timestamp: Date;
        severity: 'low' | 'medium' | 'high' | 'critical';
    }>;
    sampling: {
        sampled: boolean;
        sampleRate: number;
        reason?: string;
    };
    createdAt: Date;
    updatedAt: Date;
}

export interface ITraceSpan {
    spanId: string;
    parentSpanId?: string;
    name: string;
    operation: 'ai_call' | 'processing' | 'database' | 'http_request' | 'custom';
    startTime: Date;
    endTime?: Date;
    duration?: number;
    status: 'running' | 'completed' | 'failed';

    // AI-specific data
    aiCall?: {
        provider: string;
        model: string;
        prompt: string;
        completion?: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost: number;
        promptHash: string;
        parameters: {
            temperature?: number;
            maxTokens?: number;
            topP?: number;
            [key: string]: any;
        };
        cacheHit: boolean;
        retryCount?: number;
    };

    // Performance data
    performance: {
        latency: number;
        queueTime?: number;
        processingTime?: number;
        networkTime?: number;
    };

    // Context and relationships
    relationships: {
        children: string[];
        dependencies: string[];
        triggers: string[];
    };

    // Error handling
    error?: {
        message: string;
        code?: string;
        stack?: string;
        recoverable: boolean;
    };

    // Metadata
    tags: Record<string, string>;
    logs: Array<{
        timestamp: Date;
        level: 'debug' | 'info' | 'warn' | 'error';
        message: string;
        data?: any;
    }>;
}

const TraceSpanSchema = new Schema<ITraceSpan>({
    spanId: { type: String, required: true },
    parentSpanId: { type: String },
    name: { type: String, required: true },
    operation: {
        type: String,
        enum: ['ai_call', 'processing', 'database', 'http_request', 'custom'],
        required: true
    },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    duration: { type: Number },
    status: {
        type: String,
        enum: ['running', 'completed', 'failed'],
        default: 'running'
    },

    aiCall: {
        provider: { type: String },
        model: { type: String },
        prompt: { type: String },
        completion: { type: String },
        promptTokens: { type: Number },
        completionTokens: { type: Number },
        totalTokens: { type: Number },
        cost: { type: Number },
        promptHash: { type: String },
        parameters: { type: Schema.Types.Mixed },
        cacheHit: { type: Boolean, default: false },
        retryCount: { type: Number, default: 0 }
    },

    performance: {
        latency: { type: Number },
        queueTime: { type: Number },
        processingTime: { type: Number },
        networkTime: { type: Number }
    },

    relationships: {
        children: [{ type: String }],
        dependencies: [{ type: String }],
        triggers: [{ type: String }]
    },

    error: {
        message: { type: String },
        code: { type: String },
        stack: { type: String },
        recoverable: { type: Boolean, default: false }
    },

    tags: { type: Schema.Types.Mixed, default: {} },
    logs: [{
        timestamp: { type: Date, required: true },
        level: {
            type: String,
            enum: ['debug', 'info', 'warn', 'error'],
            default: 'info'
        },
        message: { type: String, required: true },
        data: { type: Schema.Types.Mixed }
    }]
});

const TraceSchema = new Schema<ITrace>({
    traceId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    name: { type: String, required: true },
    status: {
        type: String,
        enum: ['running', 'completed', 'failed', 'cancelled'],
        default: 'running',
        index: true
    },
    startTime: { type: Date, required: true, index: true },
    endTime: { type: Date },
    duration: { type: Number },
    totalCost: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    callCount: { type: Number, default: 0 },
    rootSpanId: { type: String },
    spans: [TraceSpanSchema],

    metadata: {
        environment: { type: String },
        version: { type: String },
        userId: { type: String },
        sessionId: { type: String },
        tags: [{ type: String }],
        customAttributes: { type: Schema.Types.Mixed },
        replayOf: { type: String },
        replayId: { type: String },
        replayConfig: { type: Schema.Types.Mixed }
    },

    dependencies: {
        services: [{ type: String }],
        models: [{ type: String }],
        providers: [{ type: String }]
    },

    performance: {
        criticalPath: [{ type: String }],
        bottlenecks: [{
            spanId: { type: String },
            reason: { type: String },
            impact: { type: Number }
        }],
        parallelizable: [{ type: String }],
        cacheOpportunities: [{
            spanId: { type: String },
            promptHash: { type: String },
            estimatedSavings: { type: Number }
        }]
    },

    errors: [{
        spanId: { type: String },
        error: { type: String },
        timestamp: { type: Date },
        severity: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'medium'
        }
    }],

    sampling: {
        sampled: { type: Boolean, default: true },
        sampleRate: { type: Number, default: 1.0 },
        reason: { type: String }
    }
}, {
    timestamps: true,
    collection: 'traces'
});

// Indexes for performance
TraceSchema.index({ userId: 1, startTime: -1 });
TraceSchema.index({ projectId: 1, startTime: -1 });
TraceSchema.index({ 'spans.spanId': 1 });
TraceSchema.index({ 'spans.aiCall.promptHash': 1 });
TraceSchema.index({ 'metadata.tags': 1 });
TraceSchema.index({ status: 1, startTime: -1 });

// TTL index for automatic cleanup of old traces (optional)
TraceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

// Methods
TraceSchema.methods.addSpan = function (span: Partial<ITraceSpan>) {
    this.spans.push(span);
    this.callCount = this.spans.length;
    return this;
};

TraceSchema.methods.updateSpan = function (spanId: string, updates: Partial<ITraceSpan>) {
    const span = this.spans.find((s: ITraceSpan) => s.spanId === spanId);
    if (span) {
        Object.assign(span, updates);
    }
    return this;
};

TraceSchema.methods.complete = function () {
    this.status = 'completed';
    this.endTime = new Date();
    this.duration = this.endTime.getTime() - this.startTime.getTime();

    // Calculate totals
    this.totalCost = this.spans.reduce((sum: number, span: ITraceSpan) =>
        sum + (span.aiCall?.cost || 0), 0);
    this.totalTokens = this.spans.reduce((sum: number, span: ITraceSpan) =>
        sum + (span.aiCall?.totalTokens || 0), 0);

    return this;
};

TraceSchema.methods.analyzeCriticalPath = function () {
    const spans = this.spans;
    const spanMap = new Map();
    const dependencies = new Map();

    // Build maps of spans and dependencies
    spans.forEach((span: any) => {
        spanMap.set(span.spanId, span);
        if (span.parentSpanId) {
            if (!dependencies.has(span.parentSpanId)) {
                dependencies.set(span.parentSpanId, []);
            }
            dependencies.get(span.parentSpanId).push(span.spanId);
        }
    });

    // Find root spans (no parent)
    const rootSpans = spans.filter((span: any) => !span.parentSpanId);

    // Calculate path durations using DFS
    const calculatePathDuration = (spanId: string, visited = new Set()): number => {
        if (visited.has(spanId)) return 0;
        visited.add(spanId);

        const span = spanMap.get(spanId);
        const childSpans = dependencies.get(spanId) || [];
        
        // Get max duration of child paths
        const maxChildDuration = Math.max(
            0,
            ...childSpans.map((childId: any) => calculatePathDuration(childId, visited))
        );

        return (span.duration || 0) + maxChildDuration;
    };

    // Find critical path by following highest duration paths
    const criticalPath: string[] = [];
    let currentSpan = rootSpans.reduce((longest: any, span: any) => {
        const duration = calculatePathDuration(span.spanId);
        return duration > calculatePathDuration(longest.spanId) ? span : longest;
    }, rootSpans[0]);

    // Build path by following highest duration children
    while (currentSpan) {
        criticalPath.push(currentSpan.spanId);
        const children = dependencies.get(currentSpan.spanId) || [];
        if (children.length === 0) break;

        currentSpan = children
            .map((spanId: any) => spanMap.get(spanId))
            .reduce((longest: any, span: any) => {
                const duration = calculatePathDuration(span.spanId);
                return duration > calculatePathDuration(longest.spanId) ? span : longest;
            }, spanMap.get(children[0]));
    }

    this.performance.criticalPath = criticalPath;
    return this;
};

export const Trace = mongoose.model<ITrace>('Trace', TraceSchema); 