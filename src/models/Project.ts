import mongoose, { Schema } from 'mongoose';

export interface IProject {
    _id?: any;
    name: string;
    description?: string;
    organizationId?: mongoose.Types.ObjectId;
    ownerId: mongoose.Types.ObjectId;
    members: Array<{
        userId: mongoose.Types.ObjectId;
        role: 'owner' | 'admin' | 'member' | 'viewer';
        joinedAt: Date;
    }>;
    budget: {
        amount: number;
        period: 'monthly' | 'quarterly' | 'yearly' | 'one-time';
        startDate: Date;
        endDate?: Date;
        currency: string;
        alerts: Array<{
            threshold: number; // percentage
            type: 'email' | 'in-app' | 'both';
            recipients: string[];
        }>;
    };
    spending: {
        current: number;
        lastUpdated: Date;
        history: Array<{
            date: Date;
            amount: number;
            breakdown?: Record<string, number>;
        }>;
    };
    settings: {
        requireApprovalAbove?: number; // Amount above which approval is required
        allowedModels?: string[]; // Restrict to specific models
        maxTokensPerRequest?: number;
        enablePromptLibrary: boolean;
        enableCostAllocation: boolean;
    };
    tags: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const projectSchema = new Schema<IProject>({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization'
    },
    ownerId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    members: [{
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        role: {
            type: String,
            enum: ['owner', 'admin', 'member', 'viewer'],
            default: 'member'
        },
        joinedAt: {
            type: Date,
            default: Date.now
        }
    }],
    budget: {
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        period: {
            type: String,
            enum: ['monthly', 'quarterly', 'yearly', 'one-time'],
            required: true
        },
        startDate: {
            type: Date,
            required: true
        },
        endDate: Date,
        currency: {
            type: String,
            default: 'USD'
        },
        alerts: [{
            threshold: {
                type: Number,
                min: 0,
                max: 100
            },
            type: {
                type: String,
                enum: ['email', 'in-app', 'both'],
                default: 'both'
            },
            recipients: [String]
        }]
    },
    spending: {
        current: {
            type: Number,
            default: 0
        },
        lastUpdated: {
            type: Date,
            default: Date.now
        },
        history: [{
            date: Date,
            amount: Number,
            breakdown: Schema.Types.Mixed
        }]
    },
    settings: {
        requireApprovalAbove: Number,
        allowedModels: [String],
        maxTokensPerRequest: Number,
        enablePromptLibrary: {
            type: Boolean,
            default: true
        },
        enableCostAllocation: {
            type: Boolean,
            default: true
        }
    },
    tags: [String],
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Indexes
projectSchema.index({ ownerId: 1 });
projectSchema.index({ 'members.userId': 1 });
projectSchema.index({ organizationId: 1 });
projectSchema.index({ isActive: 1 });

// Methods
projectSchema.methods.isMember = function (userId: string): boolean {
    const ownerIdString = typeof this.ownerId === 'object' && this.ownerId._id
        ? this.ownerId._id.toString()
        : this.ownerId.toString();
    return this.members.some((member: any) => {
        const memberIdString = typeof member.userId === 'object' && member.userId._id
            ? member.userId._id.toString()
            : member.userId.toString();
        return memberIdString === userId;
    }) || ownerIdString === userId;
};

projectSchema.methods.getMemberRole = function (userId: string): string | null {
    const ownerIdString = typeof this.ownerId === 'object' && this.ownerId._id
        ? this.ownerId._id.toString()
        : this.ownerId.toString();
    if (ownerIdString === userId) return 'owner';
    const member = this.members.find((m: any) => {
        const memberIdString = typeof m.userId === 'object' && m.userId._id
            ? m.userId._id.toString()
            : m.userId.toString();
        return memberIdString === userId;
    });
    return member ? member.role : null;
};

projectSchema.methods.canManage = function (userId: string): boolean {
    const role = this.getMemberRole(userId);
    return role === 'owner' || role === 'admin';
};

projectSchema.methods.getBudgetUsagePercentage = function (): number {
    return this.budget.amount > 0 ? (this.spending.current / this.budget.amount) * 100 : 0;
};

export const Project = mongoose.model<IProject>('Project', projectSchema); 