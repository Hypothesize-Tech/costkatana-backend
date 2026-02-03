import mongoose, { Schema } from 'mongoose';

export interface IAlert {
    _id?: any;
    userId: mongoose.Types.ObjectId;
    type: 'cost_threshold' | 'usage_spike' | 'optimization_available' | 'weekly_summary' | 'monthly_summary' | 'error_rate' | 'cost' | 'optimization' | 'anomaly' | 'system' | 'performance' | 'agent_trace_budget' | 'agent_trace_spike' | 'agent_trace_inefficiency' | 'agent_trace_failure';
    title: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    data: {
        currentValue?: number;
        threshold?: number;
        percentage?: number;
        period?: string;
        recommendations?: string[];
        [key: string]: any;
    };
    metadata?: {
        isTest?: boolean;
        testType?: string;
        costImpact?: number;
        [key: string]: any;
    };
    sent: boolean;
    sentAt?: Date;
    sentTo?: string;
    read: boolean;
    readAt?: Date;
    snoozedUntil?: Date;
    actionRequired: boolean;
    actionTaken?: boolean;
    actionTakenAt?: Date;
    actionDetails?: string;
    expiresAt?: Date;
    
    // Integration delivery tracking
    deliveryChannels?: string[]; // Integration IDs that should receive this alert
    deliveryStatus?: Map<string, {
        status: 'pending' | 'sent' | 'failed' | 'retrying';
        sentAt?: Date;
        responseTime?: number;
        attempts: number;
        lastError?: string;
    }>;
    
    createdAt: Date;
    updatedAt: Date;
}

const alertSchema = new Schema<IAlert>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    type: {
        type: String,
        enum: ['cost_threshold', 'usage_spike', 'optimization_available', 'weekly_summary', 'monthly_summary', 'error_rate', 'cost', 'optimization', 'anomaly', 'system', 'agent_trace_budget', 'agent_trace_spike', 'agent_trace_inefficiency', 'agent_trace_failure'],
        required: true,
    },
    title: {
        type: String,
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        required: true,
    },
    data: {
        type: Schema.Types.Mixed,
        default: {},
    },
    metadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
    sent: {
        type: Boolean,
        default: false,
    },
    sentAt: Date,
    sentTo: String,
    read: {
        type: Boolean,
        default: false,
    },
    readAt: Date,
    snoozedUntil: Date,
    actionRequired: {
        type: Boolean,
        default: false,
    },
    actionTaken: {
        type: Boolean,
        default: false,
    },
    actionTakenAt: Date,
    actionDetails: String,
    expiresAt: Date,
    deliveryChannels: [{
        type: String
    }],
    deliveryStatus: {
        type: Map,
        of: {
            status: {
                type: String,
                enum: ['pending', 'sent', 'failed', 'retrying'],
                default: 'pending'
            },
            sentAt: Date,
            responseTime: Number,
            attempts: {
                type: Number,
                default: 0
            },
            lastError: String
        },
        default: new Map()
    }
}, {
    timestamps: true,
});

// Compound indexes
alertSchema.index({ userId: 1, sent: 1 });
alertSchema.index({ userId: 1, read: 1 });
alertSchema.index({ userId: 1, type: 1, createdAt: -1 });
alertSchema.index({ createdAt: -1 });


alertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Alert = mongoose.model<IAlert>('Alert', alertSchema);