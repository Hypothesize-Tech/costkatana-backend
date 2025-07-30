import { Schema, model, Document, ObjectId } from 'mongoose';

export interface IProxyKey extends Document {
    _id: ObjectId;
    keyId: string; // ck-proxy-xxxxxxxx format
    name: string;
    description?: string;
    providerKeyId: ObjectId;
    userId: ObjectId;
    projectId?: ObjectId;
    // Team/Project-based distribution
    teamId?: ObjectId; // Associated team
    assignedProjects?: ObjectId[]; // Multiple projects this key can access
    scope: 'personal' | 'team' | 'project' | 'organization'; // Access scope
    sharedWith?: ObjectId[]; // User IDs who can use this key
    permissions: ('read' | 'write' | 'admin')[];
    budgetLimit?: number; // Optional spending limit in USD
    dailyBudgetLimit?: number; // Optional daily spending limit
    monthlyBudgetLimit?: number; // Optional monthly spending limit
    rateLimit?: number; // Optional requests per minute
    allowedIPs?: string[]; // Optional IP whitelist
    allowedDomains?: string[]; // Optional domain whitelist
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastUsed?: Date;
    expiresAt?: Date;
    usageStats: {
        totalRequests: number;
        totalCost: number;
        lastResetDate: Date;
        dailyCost: number;
        monthlyCost: number;
    };
    
    // Methods
    isExpired(): boolean;
    isOverBudget(): boolean;
    canBeUsedBy(userId: ObjectId): boolean;
    canAccessProject(projectId: ObjectId): boolean;
}

const proxyKeySchema = new Schema<IProxyKey>({
    keyId: {
        type: String,
        required: true,
        unique: true,
        match: /^ck-proxy-[a-zA-Z0-9]{32}$/
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    description: {
        type: String,
        trim: true,
        maxlength: 500
    },
    providerKeyId: {
        type: Schema.Types.ObjectId,
        ref: 'ProviderKey',
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project'
    },
    // Team/Project-based distribution fields
    teamId: {
        type: Schema.Types.ObjectId,
        ref: 'Team'
    },
    assignedProjects: [{
        type: Schema.Types.ObjectId,
        ref: 'Project'
    }],
    scope: {
        type: String,
        enum: ['personal', 'team', 'project', 'organization'],
        default: 'personal'
    },
    sharedWith: [{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }],
    permissions: [{
        type: String,
        enum: ['read', 'write', 'admin'],
        default: 'read'
    }],
    budgetLimit: {
        type: Number,
        min: 0
    },
    dailyBudgetLimit: {
        type: Number,
        min: 0
    },
    monthlyBudgetLimit: {
        type: Number,
        min: 0
    },
    rateLimit: {
        type: Number,
        min: 1,
        max: 10000 // Max 10k requests per minute
    },
    allowedIPs: [{
        type: String,
        validate: {
            validator: function(ip: string) {
                // Basic IP validation regex
                return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip);
            },
            message: 'Invalid IP address format'
        }
    }],
    allowedDomains: [{
        type: String,
        validate: {
            validator: function(domain: string) {
                // Basic domain validation
                return /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/.test(domain);
            },
            message: 'Invalid domain format'
        }
    }],
    isActive: {
        type: Boolean,
        default: true
    },
    lastUsed: {
        type: Date
    },
    expiresAt: {
        type: Date
    },
    usageStats: {
        totalRequests: {
            type: Number,
            default: 0
        },
        totalCost: {
            type: Number,
            default: 0
        },
        lastResetDate: {
            type: Date,
            default: Date.now
        },
        dailyCost: {
            type: Number,
            default: 0
        },
        monthlyCost: {
            type: Number,
            default: 0
        }
    }
}, {
    timestamps: true
});

// Indexes for performance
proxyKeySchema.index({ keyId: 1 }, { unique: true });
proxyKeySchema.index({ userId: 1, isActive: 1 });
proxyKeySchema.index({ providerKeyId: 1 });
proxyKeySchema.index({ projectId: 1 });
proxyKeySchema.index({ createdAt: -1 });
proxyKeySchema.index({ expiresAt: 1 }, { sparse: true });

// Compound index for user's active proxy keys
proxyKeySchema.index({ userId: 1, isActive: 1, createdAt: -1 });

// Method to check if proxy key is expired
proxyKeySchema.methods.isExpired = function(this: IProxyKey): boolean {
    return this.expiresAt ? this.expiresAt < new Date() : false;
};

// Method to check if proxy key has exceeded budget limits
proxyKeySchema.methods.isOverBudget = function(this: IProxyKey): boolean {
    if (this.budgetLimit && this.usageStats.totalCost >= this.budgetLimit) {
        return true;
    }
    if (this.dailyBudgetLimit && this.usageStats.dailyCost >= this.dailyBudgetLimit) {
        return true;
    }
    if (this.monthlyBudgetLimit && this.usageStats.monthlyCost >= this.monthlyBudgetLimit) {
        return true;
    }
    return false;
};

// Method to check if a user can use this proxy key
proxyKeySchema.methods.canBeUsedBy = function(this: IProxyKey, userId: ObjectId): boolean {
    // Owner can always use their key
    if (this.userId.toString() === userId.toString()) {
        return true;
    }
    
    // Check if user is in sharedWith list
    if (this.sharedWith && this.sharedWith.some(id => id.toString() === userId.toString())) {
        return true;
    }
    
    // For team/organization scope, additional checks would be needed
    // This would require team membership validation
    return false;
};

// Method to check if proxy key can access a specific project
proxyKeySchema.methods.canAccessProject = function(this: IProxyKey, projectId: ObjectId): boolean {
    // If no project restrictions, allow access
    if (!this.assignedProjects || this.assignedProjects.length === 0) {
        return true;
    }
    
    // Check if project is in assigned projects
    return this.assignedProjects.some(id => id.toString() === projectId.toString());
};

// Add indexes for team/project-based queries
proxyKeySchema.index({ teamId: 1, isActive: 1 });
proxyKeySchema.index({ assignedProjects: 1 });
proxyKeySchema.index({ scope: 1, isActive: 1 });
proxyKeySchema.index({ sharedWith: 1 });

export const ProxyKey = model<IProxyKey>('ProxyKey', proxyKeySchema);