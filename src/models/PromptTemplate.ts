import mongoose, { Schema } from 'mongoose';

export interface IPromptTemplate {
    _id?: any;
    name: string;
    description?: string;
    content: string;
    category: 'general' | 'coding' | 'writing' | 'analysis' | 'creative' | 'business' | 'custom' | 'visual-compliance';
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
        type?: 'text' | 'image';
        imageRole?: 'reference' | 'evidence';
        s3Url?: string;
        accept?: string;
        metadata?: {
            format?: string;
            dimensions?: string;
            uploadedAt?: Date;
        };
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
    executionStats?: {
        totalExecutions: number;
        totalCostSavings: number;
        averageCost: number;
        mostUsedModel: string;
        lastExecutedAt?: Date;
    };
    sharing: {
        visibility: 'private' | 'project' | 'organization' | 'public';
        sharedWith: mongoose.Types.ObjectId[]; // Specific users
        allowFork: boolean;
    };
    isVisualCompliance?: boolean;
    visualComplianceConfig?: {
        industry: 'jewelry' | 'grooming' | 'retail' | 'fmcg' | 'documents';
        mode?: 'optimized' | 'standard';
        metaPromptPresetId?: string;
    };
    referenceImage?: {
        s3Url: string;
        s3Key: string;
        uploadedAt: Date;
        uploadedBy: string;
        extractedFeatures?: {
            extractedAt: Date;
            extractedBy: string;
            status: 'pending' | 'processing' | 'completed' | 'failed';
            errorMessage?: string;
            analysis: {
                visualDescription: string;
                structuredData: {
                    colors: {
                        dominant: string[];
                        accent: string[];
                        background: string;
                    };
                    layout: {
                        composition: string;
                        orientation: string;
                        spacing: string;
                    };
                    objects: Array<{
                        name: string;
                        position: string;
                        description: string;
                        attributes: Record<string, any>;
                    }>;
                    text: {
                        detected: string[];
                        prominent: string[];
                        language?: string;
                    };
                    lighting: {
                        type: string;
                        direction: string;
                        quality: string;
                    };
                    quality: {
                        sharpness: string;
                        clarity: string;
                        professionalGrade: boolean;
                    };
                };
                criteriaAnalysis: Array<{
                    criterionId: string;
                    criterionText: string;
                    referenceState: {
                        status: 'compliant' | 'non-compliant' | 'example';
                        description: string;
                        specificDetails: string;
                        measurableAttributes: Record<string, any>;
                        visualIndicators: string[];
                    };
                    comparisonInstructions: {
                        whatToCheck: string;
                        howToMeasure: string;
                        passCriteria: string;
                        failCriteria: string;
                        edgeCases: string[];
                    };
                    confidence: number;
                }>;
            };
            extractionCost: {
                initialCallTokens: { input: number; output: number; cost: number };
                followUpCalls: Array<{ reason: string; input: number; output: number; cost: number }>;
                totalTokens: number;
                totalCost: number;
            };
            usage: {
                checksPerformed: number;
                totalTokensSaved: number;
                totalCostSaved: number;
                averageConfidence: number;
                lowConfidenceCount: number;
                lastUsedAt?: Date;
            };
        };
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
        enum: ['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom', 'visual-compliance'],
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
        },
        type: {
            type: String,
            enum: ['text', 'image'],
            default: 'text'
        },
        imageRole: {
            type: String,
            enum: ['reference', 'evidence']
        },
        s3Url: String,
        accept: String,
        metadata: {
            format: String,
            dimensions: String,
            uploadedAt: Date
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
    executionStats: {
        totalExecutions: {
            type: Number,
            default: 0
        },
        totalCostSavings: {
            type: Number,
            default: 0
        },
        averageCost: {
            type: Number,
            default: 0
        },
        mostUsedModel: {
            type: String,
            default: ''
        },
        lastExecutedAt: Date
    },
    isVisualCompliance: {
        type: Boolean,
        default: false
    },
    visualComplianceConfig: {
        industry: {
            type: String,
            enum: ['jewelry', 'grooming', 'retail', 'fmcg', 'documents']
        },
        mode: {
            type: String,
            enum: ['optimized', 'standard'],
            default: 'optimized'
        },
        metaPromptPresetId: String
    },
    referenceImage: {
        s3Url: String,
        s3Key: String,
        uploadedAt: Date,
        uploadedBy: String,
        extractedFeatures: {
            extractedAt: Date,
            extractedBy: String,
            status: {
                type: String,
                enum: ['pending', 'processing', 'completed', 'failed']
            },
            errorMessage: String,
            analysis: {
                visualDescription: String,
                structuredData: {
                    colors: {
                        dominant: [String],
                        accent: [String],
                        background: String
                    },
                    layout: {
                        composition: String,
                        orientation: String,
                        spacing: String
                    },
                    objects: [{
                        name: String,
                        position: String,
                        description: String,
                        attributes: Schema.Types.Mixed
                    }],
                    text: {
                        detected: [String],
                        prominent: [String],
                        language: String
                    },
                    lighting: {
                        type: { type: String },  // Explicitly define 'type' as a field, not schema type
                        direction: String,
                        quality: String
                    },
                    quality: {
                        sharpness: String,
                        clarity: String,
                        professionalGrade: Boolean
                    }
                },
                criteriaAnalysis: [{
                    criterionId: String,
                    criterionText: String,
                    referenceState: {
                        status: {
                            type: String,
                            enum: ['compliant', 'non-compliant', 'example']
                        },
                        description: String,
                        specificDetails: String,
                        measurableAttributes: Schema.Types.Mixed,
                        visualIndicators: [String]
                    },
                    comparisonInstructions: {
                        whatToCheck: String,
                        howToMeasure: String,
                        passCriteria: String,
                        failCriteria: String,
                        edgeCases: [String]
                    },
                    confidence: Number
                }]
            },
            extractionCost: {
                initialCallTokens: {
                    input: Number,
                    output: Number,
                    cost: Number
                },
                followUpCalls: [{
                    reason: String,
                    input: Number,
                    output: Number,
                    cost: Number
                }],
                totalTokens: Number,
                totalCost: Number
            },
            usage: {
                checksPerformed: {
                    type: Number,
                    default: 0
                },
                totalTokensSaved: {
                    type: Number,
                    default: 0
                },
                totalCostSaved: {
                    type: Number,
                    default: 0
                },
                averageConfidence: Number,
                lowConfidenceCount: {
                    type: Number,
                    default: 0
                },
                lastUsedAt: Date
            }
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
promptTemplateSchema.index({ isVisualCompliance: 1 });
promptTemplateSchema.index({ 'visualComplianceConfig.industry': 1 });
promptTemplateSchema.index({ 'referenceImage.extractedFeatures.status': 1 });

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