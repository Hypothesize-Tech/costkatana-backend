import mongoose, { Schema, Document } from 'mongoose';

export interface IWorkflowVersion extends Document {
    userId: mongoose.Types.ObjectId;
    workflowId: string;
    workflowName: string;
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
    
    // Workflow structure
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

const workflowVersionSchema = new Schema<IWorkflowVersion>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    workflowId: {
        type: String,
        required: true,
        index: true
    },
    workflowName: {
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
        ref: 'WorkflowVersion'
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
    timestamps: true
});

// Indexes
workflowVersionSchema.index({ userId: 1, workflowId: 1, version: -1 });
workflowVersionSchema.index({ workflowId: 1, version: -1 });

export const WorkflowVersion = mongoose.model<IWorkflowVersion>('WorkflowVersion', workflowVersionSchema);

