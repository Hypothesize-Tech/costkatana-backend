import mongoose, { Schema } from 'mongoose';

export interface IApprovalRequest {
    _id?: any;
    requesterId: mongoose.Types.ObjectId;
    projectId: mongoose.Types.ObjectId;
    type: 'api_call' | 'bulk_operation' | 'model_change' | 'budget_increase';
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    details: {
        operation: string;
        estimatedCost: number;
        estimatedTokens?: number;
        model?: string;
        prompt?: string;
        reason?: string;
        urgency: 'low' | 'medium' | 'high' | 'critical';
    };
    approval: {
        approverId?: mongoose.Types.ObjectId;
        approvedAt?: Date;
        comments?: string;
        conditions?: string[];
    };
    metadata: {
        currentProjectSpending?: number;
        budgetRemaining?: number;
        requesterHistory?: {
            totalRequests: number;
            approvedRequests: number;
            totalSpending: number;
        };
    };
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const approvalRequestSchema = new Schema<IApprovalRequest>({
    requesterId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    type: {
        type: String,
        enum: ['api_call', 'bulk_operation', 'model_change', 'budget_increase'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'expired'],
        default: 'pending'
    },
    details: {
        operation: {
            type: String,
            required: true
        },
        estimatedCost: {
            type: Number,
            required: true,
            min: 0
        },
        estimatedTokens: Number,
        model: String,
        prompt: String,
        reason: String,
        urgency: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'medium'
        }
    },
    approval: {
        approverId: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        approvedAt: Date,
        comments: String,
        conditions: [String]
    },
    metadata: {
        currentProjectSpending: Number,
        budgetRemaining: Number,
        requesterHistory: {
            totalRequests: Number,
            approvedRequests: Number,
            totalSpending: Number
        }
    },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    }
}, {
    timestamps: true
});

// Indexes
approvalRequestSchema.index({ requesterId: 1, status: 1 });
approvalRequestSchema.index({ projectId: 1, status: 1 });
approvalRequestSchema.index({ 'approval.approverId': 1 });
approvalRequestSchema.index({ expiresAt: 1 });
approvalRequestSchema.index({ status: 1, 'details.urgency': 1 });

// Methods
approvalRequestSchema.methods.approve = async function (approverId: string, comments?: string, conditions?: string[]) {
    this.status = 'approved';
    this.approval = {
        approverId,
        approvedAt: new Date(),
        comments,
        conditions
    };
    return this.save();
};

approvalRequestSchema.methods.reject = async function (approverId: string, comments: string) {
    this.status = 'rejected';
    this.approval = {
        approverId,
        approvedAt: new Date(),
        comments
    };
    return this.save();
};

approvalRequestSchema.methods.isExpired = function (): boolean {
    return this.status === 'pending' && new Date() > this.expiresAt;
};

// Static methods
approvalRequestSchema.statics.expirePendingRequests = async function () {
    return this.updateMany(
        {
            status: 'pending',
            expiresAt: { $lt: new Date() }
        },
        {
            status: 'expired'
        }
    );
};

export const ApprovalRequest = mongoose.model<IApprovalRequest>('ApprovalRequest', approvalRequestSchema); 