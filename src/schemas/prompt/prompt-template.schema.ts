import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IVariable {
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
}

export interface IFeedback {
  userId: MongooseSchema.Types.ObjectId;
  rating: number;
  comment?: string;
  createdAt: Date;
}

export interface IUsage {
  count: number;
  lastUsed?: Date;
  totalTokensSaved?: number;
  totalCostSaved?: number;
  averageRating?: number;
  feedback: IFeedback[];
}

export interface IExecutionStats {
  totalExecutions: number;
  totalCostSavings: number;
  averageCost: number;
  mostUsedModel: string;
  lastExecutedAt?: Date;
}

export interface ISharing {
  visibility: 'private' | 'project' | 'organization' | 'public';
  sharedWith: MongooseSchema.Types.ObjectId[];
  allowFork: boolean;
}

export interface IMetadata {
  estimatedTokens?: number;
  estimatedCost?: number;
  recommendedModel?: string;
  tags: string[];
  language?: string;
}

export interface IVisualComplianceConfig {
  industry: 'jewelry' | 'grooming' | 'retail' | 'fmcg' | 'documents';
  mode?: 'optimized' | 'standard';
  metaPromptPresetId?: string;
}

export interface IReferenceState {
  status: 'compliant' | 'non-compliant' | 'example';
  description: string;
  specificDetails: string;
  measurableAttributes: Record<string, any>;
  visualIndicators: string[];
}

export interface IComparisonInstructions {
  whatToCheck: string;
  howToMeasure: string;
  passCriteria: string;
  failCriteria: string;
  edgeCases: string[];
}

export interface ICriteriaAnalysis {
  criterionId: string;
  criterionText: string;
  referenceState: IReferenceState;
  comparisonInstructions: IComparisonInstructions;
  confidence: number;
}

export interface IStructuredData {
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
}

export interface IAnalysis {
  visualDescription: string;
  structuredData: IStructuredData;
  criteriaAnalysis: ICriteriaAnalysis[];
}

export interface IInitialCallTokens {
  input: number;
  output: number;
  cost: number;
}

export interface IFollowUpCall {
  reason: string;
  input: number;
  output: number;
  cost: number;
}

export interface IExtractionCost {
  initialCallTokens: IInitialCallTokens;
  followUpCalls: IFollowUpCall[];
  totalTokens: number;
  totalCost: number;
}

export interface IUsageStats {
  checksPerformed: number;
  totalTokensSaved: number;
  totalCostSaved: number;
  averageConfidence: number;
  lowConfidenceCount: number;
  lastUsedAt?: Date;
}

export interface IExtractedFeatures {
  extractedAt: Date;
  extractedBy: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  analysis: IAnalysis;
  extractionCost: IExtractionCost;
  usage: IUsageStats;
}

export interface IReferenceImage {
  s3Url: string;
  s3Key: string;
  uploadedAt: Date;
  uploadedBy: string;
  extractedFeatures?: IExtractedFeatures;
}

export interface IPromptTemplateMethods {
  canAccess(userId: string, userProjectIds?: string[]): boolean;
  fork(userId: string, projectId?: string): Promise<any>;
}

export type PromptTemplateDocument = HydratedDocument<PromptTemplate> &
  IPromptTemplateMethods;

@Schema({ timestamps: true })
export class PromptTemplate implements IPromptTemplateMethods {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true })
  content: string;

  @Prop({
    type: String,
    enum: [
      'general',
      'coding',
      'writing',
      'analysis',
      'creative',
      'business',
      'custom',
      'visual-compliance',
    ],
    default: 'general',
  })
  category:
    | 'general'
    | 'coding'
    | 'writing'
    | 'analysis'
    | 'creative'
    | 'business'
    | 'custom'
    | 'visual-compliance';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project' })
  projectId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization' })
  organizationId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: MongooseSchema.Types.ObjectId;

  @Prop({ default: 1 })
  version: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PromptTemplate' })
  parentId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: [
      {
        name: { type: String, required: true },
        description: String,
        defaultValue: String,
        required: { type: Boolean, default: false },
        type: { type: String, enum: ['text', 'image'], default: 'text' },
        imageRole: { type: String, enum: ['reference', 'evidence'] },
        s3Url: String,
        accept: String,
        metadata: {
          format: String,
          dimensions: String,
          uploadedAt: Date,
        },
      },
    ],
    _id: false,
  })
  variables: IVariable[];

  @Prop({
    type: {
      estimatedTokens: Number,
      estimatedCost: Number,
      recommendedModel: String,
      tags: [String],
      language: String,
    },
    _id: false,
  })
  metadata: IMetadata;

  @Prop({
    type: {
      count: { type: Number, default: 0 },
      lastUsed: Date,
      totalTokensSaved: { type: Number, default: 0 },
      totalCostSaved: { type: Number, default: 0 },
      averageRating: { type: Number, min: 1, max: 5 },
      feedback: [
        {
          userId: { type: MongooseSchema.Types.ObjectId, ref: 'User' },
          rating: { type: Number, min: 1, max: 5, required: true },
          comment: String,
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },
    _id: false,
  })
  usage: IUsage;

  @Prop({
    type: {
      totalExecutions: { type: Number, default: 0 },
      totalCostSavings: { type: Number, default: 0 },
      averageCost: { type: Number, default: 0 },
      mostUsedModel: { type: String, default: '' },
      lastExecutedAt: Date,
    },
    _id: false,
  })
  executionStats?: IExecutionStats;

  @Prop({
    type: {
      visibility: {
        type: String,
        enum: ['private', 'project', 'organization', 'public'],
        default: 'private',
      },
      sharedWith: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }],
      allowFork: { type: Boolean, default: true },
    },
  })
  sharing: ISharing;

  @Prop({ type: Boolean, default: false })
  isVisualCompliance?: boolean;

  @Prop({
    type: {
      industry: {
        type: String,
        enum: ['jewelry', 'grooming', 'retail', 'fmcg', 'documents'],
      },
      mode: {
        type: String,
        enum: ['optimized', 'standard'],
        default: 'optimized',
      },
      metaPromptPresetId: String,
    },
  })
  visualComplianceConfig?: IVisualComplianceConfig;

  @Prop({
    type: {
      s3Url: String,
      s3Key: String,
      uploadedAt: Date,
      uploadedBy: String,
      extractedFeatures: {
        extractedAt: Date,
        extractedBy: String,
        status: {
          type: String,
          enum: ['pending', 'processing', 'completed', 'failed'],
        },
        errorMessage: String,
        analysis: {
          visualDescription: String,
          structuredData: {
            colors: {
              dominant: [String],
              accent: [String],
              background: String,
            },
            layout: {
              composition: String,
              orientation: String,
              spacing: String,
            },
            objects: [
              {
                name: String,
                position: String,
                description: String,
                attributes: mongoose.Schema.Types.Mixed,
              },
            ],
            text: {
              detected: [String],
              prominent: [String],
              language: String,
            },
            lighting: {
              type: String,
              direction: String,
              quality: String,
            },
            quality: {
              sharpness: String,
              clarity: String,
              professionalGrade: Boolean,
            },
          },
          criteriaAnalysis: [
            {
              criterionId: String,
              criterionText: String,
              referenceState: {
                status: {
                  type: String,
                  enum: ['compliant', 'non-compliant', 'example'],
                },
                description: String,
                specificDetails: String,
                measurableAttributes: mongoose.Schema.Types.Mixed,
                visualIndicators: [String],
              },
              comparisonInstructions: {
                whatToCheck: String,
                howToMeasure: String,
                passCriteria: String,
                failCriteria: String,
                edgeCases: [String],
              },
              confidence: Number,
            },
          ],
        },
        extractionCost: {
          initialCallTokens: {
            input: Number,
            output: Number,
            cost: Number,
          },
          followUpCalls: [
            {
              reason: String,
              input: Number,
              output: Number,
              cost: Number,
            },
          ],
          totalTokens: Number,
          totalCost: Number,
        },
        usage: {
          checksPerformed: { type: Number, default: 0 },
          totalTokensSaved: { type: Number, default: 0 },
          totalCostSaved: { type: Number, default: 0 },
          averageConfidence: Number,
          lowConfidenceCount: { type: Number, default: 0 },
          lastUsedAt: Date,
        },
      },
    },
  })
  referenceImage?: IReferenceImage;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  canAccess(userId: string, userProjectIds: string[] = []): boolean {
    // Owner can always access
    if (this.createdBy.toString() === userId) return true;

    // Check visibility
    switch (this.sharing.visibility) {
      case 'public':
        return true;
      case 'project':
        return !!(
          this.projectId && userProjectIds.includes(this.projectId.toString())
        );
      case 'private':
        return this.sharing.sharedWith.some(
          (id: any) => id.toString() === userId,
        );
      default:
        return false;
    }
  }

  async fork(userId: string, projectId?: string) {
    const forkedTemplate = new (this.constructor as any)({
      ...(this as any).toObject(),
      _id: undefined,
      createdBy: userId,
      projectId: projectId || this.projectId,
      parentId: (this as any)._id,
      version: 1,
      usage: {
        count: 0,
        totalTokensSaved: 0,
        totalCostSaved: 0,
        feedback: [],
      },
      createdAt: undefined,
      updatedAt: undefined,
    });

    return forkedTemplate.save();
  }
}

export const PromptTemplateSchema =
  SchemaFactory.createForClass(PromptTemplate);

// Indexes
PromptTemplateSchema.index({ projectId: 1, isActive: 1 });
PromptTemplateSchema.index({ organizationId: 1, isActive: 1 });
PromptTemplateSchema.index({ createdBy: 1 });
PromptTemplateSchema.index({ 'sharing.visibility': 1 });
PromptTemplateSchema.index({ 'metadata.tags': 1 });
PromptTemplateSchema.index({ category: 1 });
PromptTemplateSchema.index({ isVisualCompliance: 1 });
PromptTemplateSchema.index({ 'visualComplianceConfig.industry': 1 });
PromptTemplateSchema.index({ 'referenceImage.extractedFeatures.status': 1 });

// Instance methods
PromptTemplateSchema.methods.canAccess = function (
  userId: string,
  userProjectIds: string[] = [],
): boolean {
  // Owner can always access
  if (this.createdBy.toString() === userId) return true;

  // Check visibility
  switch (this.sharing.visibility) {
    case 'public':
      return true;
    case 'project':
      return (
        this.projectId && userProjectIds.includes(this.projectId.toString())
      );
    case 'private':
      return this.sharing.sharedWith.some(
        (id: any) => id.toString() === userId,
      );
    default:
      return false;
  }
};

PromptTemplateSchema.methods.fork = async function (
  userId: string,
  projectId?: string,
) {
  const forkedTemplate = new this.constructor({
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
      feedback: [],
    },
    createdAt: undefined,
    updatedAt: undefined,
  });

  return this.save();
};
