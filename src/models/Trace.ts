import mongoose, { Document, Schema } from 'mongoose';

export interface ITrace extends Document {
    traceId: string;
    sessionId: string;
    parentId?: string;
    name: string;
    type: 'http' | 'llm' | 'tool' | 'database' | 'custom';
    startedAt: Date;
    endedAt?: Date;
    duration?: number;
    status: 'ok' | 'error';
    error?: {
        message: string;
        stack?: string;
    };
    aiModel?: string;
    tokens?: {
        input: number;
        output: number;
    };
    costUSD?: number;
    tool?: string;
    resourceIds?: string[];
    metadata?: Record<string, any>;
    depth: number;
    createdAt: Date;
    updatedAt: Date;
}

const TraceSchema = new Schema<ITrace>(
    {
        traceId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        sessionId: {
            type: String,
            required: true,
            index: true
        },
        parentId: {
            type: String,
            index: true
        },
        name: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: ['http', 'llm', 'tool', 'database', 'custom'],
            default: 'custom'
        },
        startedAt: {
            type: Date,
            required: true,
            index: true
        },
        endedAt: {
            type: Date
        },
        duration: {
            type: Number
        },
        status: {
            type: String,
            enum: ['ok', 'error'],
            default: 'ok',
            index: true
        },
        error: {
            message: String,
            stack: String
        },
        aiModel: String,
        tokens: {
            input: {
                type: Number,
                default: 0
            },
            output: {
                type: Number,
                default: 0
            }
        },
        costUSD: Number,
        tool: String,
        resourceIds: [String],
        metadata: {
            type: Schema.Types.Mixed
        },
        depth: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes for efficient queries
TraceSchema.index({ sessionId: 1, parentId: 1, startedAt: 1 });
TraceSchema.index({ sessionId: 1, startedAt: 1 });
TraceSchema.index({ status: 1, startedAt: -1 });

// Calculate duration on save if endedAt is set
TraceSchema.pre('save', function(next) {
    if (this.endedAt && this.startedAt) {
        this.duration = this.endedAt.getTime() - this.startedAt.getTime();
    }
    next();
});

// TTL index if enabled
if (process.env.TRACE_TTL_DAYS) {
    const ttlDays = parseInt(process.env.TRACE_TTL_DAYS);
    TraceSchema.index({ createdAt: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });
}

export const Trace = mongoose.model<ITrace>('Trace', TraceSchema);
