import mongoose, { Schema } from 'mongoose';

export interface IPromptTemplate {
    _id?: any;
    name: string;
    description?: string;
    content: string;
    category: 'general' | 'coding' | 'writing' | 'analysis' | 'creative' | 'business' | 'custom';
    projectId?: mongoose.Types.ObjectId;
    organizationId?: mongoose.Types.ObjectId;
    createdBy: mongoose.Types.ObjectId;
    version: number;
    parentId?: mongoose.Types.ObjectId; // For version control
    variables: Array<{
        name: string;
        description?: string;
        defaultValue?: string;
        required: boolean;
    }>;
    metadata: {
        estimatedTokens?: number;
        estimatedCost?: number;
        recommendedModel?: string;
        tags: string[];
        language?: string;
    };
    usage: {
        count: number;
        lastUsed?: Date;
        totalTokensSaved?: number;
        totalCostSaved?: number;
        averageRating?: number;
        feedback: Array<{
            userId: mongoose.Types.ObjectId;
            rating: number;
            comment?: string;
            createdAt: Date;
        }>;
    };
    sharing: {
        visibility: 'private' | 'project' | 'organization' | 'public';
        sharedWith: mongoose.Types.ObjectId[]; // Specific users
        allowFork: boolean;
    };
    isActive: boolean;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const promptTemplateSchema = new Schema<IPromptTemplate>({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    content: {
        type: String,
        required: true
    },
    category: {
        type: String,
        enum: ['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom'],
        default: 'general'
    },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project'
    },
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization'
    },
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    version: {
        type: Number,
        default: 1
    },
    parentId: {
        type: Schema.Types.ObjectId,
        ref: 'PromptTemplate'
    },
    variables: [{
        name: {
            type: String,
            required: true
        },
        description: String,
        defaultValue: String,
        required: {
            type: Boolean,
            default: false
        }
    }],
    metadata: {
        estimatedTokens: Number,
        estimatedCost: Number,
        recommendedModel: String,
        tags: [String],
        language: String
    },
    usage: {
        count: {
            type: Number,
            default: 0
        },
        lastUsed: Date,
        totalTokensSaved: {
            type: Number,
            default: 0
        },
        totalCostSaved: {
            type: Number,
            default: 0
        },
        averageRating: {
            type: Number,
            min: 1,
            max: 5
        },
        feedback: [{
            userId: {
                type: Schema.Types.ObjectId,
                ref: 'User'
            },
            rating: {
                type: Number,
                min: 1,
                max: 5,
                required: true
            },
            comment: String,
            createdAt: {
                type: Date,
                default: Date.now
            }
        }]
    },
    sharing: {
        visibility: {
            type: String,
            enum: ['private', 'project', 'organization', 'public'],
            default: 'private'
        },
        sharedWith: [{
            type: Schema.Types.ObjectId,
            ref: 'User'
        }],
        allowFork: {
            type: Boolean,
            default: true
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Indexes
promptTemplateSchema.index({ projectId: 1, isActive: 1 });
promptTemplateSchema.index({ organizationId: 1, isActive: 1 });
promptTemplateSchema.index({ createdBy: 1 });
promptTemplateSchema.index({ 'sharing.visibility': 1 });
promptTemplateSchema.index({ 'metadata.tags': 1 });
promptTemplateSchema.index({ category: 1 });

// Methods
promptTemplateSchema.methods.canAccess = function (userId: string, userProjectIds: string[] = []): boolean {
    // Owner can always access
    if (this.createdBy.toString() === userId) return true;

    // Check visibility
    switch (this.sharing.visibility) {
        case 'public':
            return true;
        case 'project':
            return this.projectId && userProjectIds.includes(this.projectId.toString());
        case 'private':
            return this.sharing.sharedWith.some((id: any) => id.toString() === userId);
        default:
            return false;
    }
};

promptTemplateSchema.methods.fork = async function (userId: string, projectId?: string) {
    const forkedTemplate = new (this.constructor as any)({
        ...this.toObject(),
        _id: undefined,
        createdBy: userId,
        projectId: projectId || this.projectId,
        parentId: this._id,
        version: 1,
        usage: {
            count: 0,
            totalTokensSaved: 0,
            totalCostSaved: 0,
            feedback: []
        },
        createdAt: undefined,
        updatedAt: undefined
    });

    return forkedTemplate.save();
};

export const PromptTemplate = mongoose.model<IPromptTemplate>('PromptTemplate', promptTemplateSchema); 