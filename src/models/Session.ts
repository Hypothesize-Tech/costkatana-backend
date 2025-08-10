import mongoose, { Document, Schema } from 'mongoose';

export interface ISession extends Document {
    sessionId: string;
    userId?: string;
    label?: string;
    startedAt: Date;
    endedAt?: Date;
    status: 'active' | 'completed' | 'error';
    metadata?: Record<string, any>;
    error?: {
        message: string;
        stack?: string;
    };
    summary?: {
        totalSpans: number;
        totalDuration?: number;
        totalCost?: number;
        totalTokens?: {
            input: number;
            output: number;
        };
    };
    createdAt: Date;
    updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        userId: {
            type: String,
            index: true
        },
        label: {
            type: String,
            index: true
        },
        startedAt: {
            type: Date,
            required: true,
            index: true
        },
        endedAt: {
            type: Date
        },
        status: {
            type: String,
            enum: ['active', 'completed', 'error'],
            default: 'active',
            index: true
        },
        metadata: {
            type: Schema.Types.Mixed
        },
        error: {
            message: String,
            stack: String
        },
        summary: {
            totalSpans: {
                type: Number,
                default: 0
            },
            totalDuration: Number,
            totalCost: Number,
            totalTokens: {
                input: {
                    type: Number,
                    default: 0
                },
                output: {
                    type: Number,
                    default: 0
                }
            }
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes for efficient queries
SessionSchema.index({ userId: 1, startedAt: -1 });
SessionSchema.index({ label: 1, startedAt: -1 });
SessionSchema.index({ status: 1, startedAt: -1 });

// TTL index if enabled
if (process.env.TRACE_TTL_DAYS) {
    const ttlDays = parseInt(process.env.TRACE_TTL_DAYS);
    SessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });
}

export const Session = mongoose.model<ISession>('Session', SessionSchema);
