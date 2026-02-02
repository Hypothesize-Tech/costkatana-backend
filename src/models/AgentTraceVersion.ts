import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentTraceVersion extends Document {
    userId: mongoose.Types.ObjectId;
    traceId: string;
    traceName: string;
    platform: 'zapier' | 'make' | 'n8n';
    version: number;
    previousVersionId?: mongoose.Types.ObjectId;

    // Cost metrics at time of version
    costMetrics: {
        averageCostPerExecution: number;
        totalExecutions: number;
        totalCost: number;
        modelBreakdown: Array<{
            model: string;
            cost: number;
            percentage: number;
        }>;
    };

    // Agent trace structure
    structure: {
        stepCount: number;
        aiStepCount: number;
        stepTypes: string[];
        complexityScore: number;
    };

    // Changes from previous version
    changes?: {
        stepsAdded?: number;
        stepsRemoved?: number;
        stepsModified?: number;
        modelsChanged?: Array<{
            from: string;
            to: string;
        }>;
        costImpact?: number; // Expected cost change
    };

    createdAt: Date;
}

const agentTraceVersionSchema = new Schema<IAgentTraceVersion>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    traceId: {
        type: String,
        required: true,
        index: true
    },
    traceName: {
        type: String,
        required: true
    },
    platform: {
        type: String,
        enum: ['zapier', 'make', 'n8n'],
        required: true
    },
    version: {
        type: Number,
        required: true,
        default: 1
    },
    previousVersionId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentTraceVersion'
    },
    costMetrics: {
        averageCostPerExecution: {
            type: Number,
            default: 0
        },
        totalExecutions: {
            type: Number,
            default: 0
        },
        totalCost: {
            type: Number,
            default: 0
        },
        modelBreakdown: [{
            model: String,
            cost: Number,
            percentage: Number
        }]
    },
    structure: {
        stepCount: {
            type: Number,
            default: 0
        },
        aiStepCount: {
            type: Number,
            default: 0
        },
        stepTypes: [String],
        complexityScore: {
            type: Number,
            default: 0
        }
    },
    changes: {
        stepsAdded: Number,
        stepsRemoved: Number,
        stepsModified: Number,
        modelsChanged: [{
            from: String,
            to: String
        }],
        costImpact: Number
    }
}, {
    timestamps: true,
    collection: 'agenttraceversions'
});

// Indexes
agentTraceVersionSchema.index({ userId: 1, traceId: 1, version: -1 });
agentTraceVersionSchema.index({ traceId: 1, version: -1 });

export const AgentTraceVersion = mongoose.model<IAgentTraceVersion>('AgentTraceVersion', agentTraceVersionSchema);
