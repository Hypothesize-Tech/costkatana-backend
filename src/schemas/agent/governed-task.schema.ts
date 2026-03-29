import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  AgentMode,
  ExecutionPlan,
  ScopeAnalysis,
  ExecutionProgress,
  VerificationResult,
} from '../../modules/governed-agent/interfaces/governed-agent.interfaces';

export type GovernedTaskDocument = HydratedDocument<GovernedTask>;

const classificationSubdocument = new MongooseSchema(
  {
    type: {
      type: String,
      enum: [
        'simple_query',
        'complex_query',
        'cross_integration',
        'coding',
        'research',
        'data_transformation',
      ],
    },
    complexity: { type: String, enum: ['low', 'medium', 'high'] },
    riskLevel: { type: String, enum: ['low', 'medium', 'high'] },
    integrations: [{ type: String }],
    route: { type: String, enum: ['DIRECT_EXECUTION', 'GOVERNED_WORKFLOW'] },
    reasoning: { type: String },
  },
  { _id: false },
);

@Schema({ timestamps: true, collection: 'governed_tasks' })
export class GovernedTask {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ index: true })
  sessionId?: string;

  @Prop({ index: true })
  chatId?: MongooseSchema.Types.ObjectId;

  @Prop({ index: true })
  parentMessageId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(AgentMode),
    default: AgentMode.SCOPE,
  })
  mode: AgentMode;

  @Prop({ required: true })
  userRequest: string;

  @Prop({ type: classificationSubdocument })
  classification?: {
    type: string;
    complexity: string;
    riskLevel: string;
    integrations: string[];
    route: string;
    reasoning: string;
  };

  @Prop({
    type: {
      compatible: { type: Boolean },
      ambiguities: [{ type: String }],
      requiredIntegrations: [{ type: String }],
      estimatedComplexity: { type: String, enum: ['low', 'medium', 'high'] },
      canProceed: { type: Boolean },
      clarificationNeeded: [{ type: String }],
    },
  })
  scopeAnalysis?: ScopeAnalysis;

  @Prop({ type: Object })
  clarifyingAnswers?: Record<string, string>;

  @Prop({
    type: {
      phases: [
        {
          name: { type: String },
          approvalRequired: { type: Boolean },
          steps: [
            {
              id: { type: String },
              tool: { type: String },
              action: { type: String },
              params: { type: Object },
              description: { type: String },
              estimatedDuration: { type: Number },
              dependencies: [{ type: String }],
            },
          ],
          riskLevel: { type: String, enum: ['none', 'low', 'medium', 'high'] },
        },
      ],
      researchSources: [
        {
          query: { type: String },
          sources: [
            {
              title: { type: String },
              url: { type: String },
              snippet: { type: String },
              relevance: { type: Number },
            },
          ],
          synthesis: { type: String },
          keyFindings: [{ type: String }],
        },
      ],
      estimatedDuration: { type: Number },
      estimatedCost: { type: Number },
      riskAssessment: {
        level: { type: String, enum: ['none', 'low', 'medium', 'high'] },
        reasons: [{ type: String }],
        requiresApproval: { type: Boolean },
      },
      rollbackPlan: { type: String },
    },
  })
  plan?: ExecutionPlan;

  @Prop({ index: true })
  approvalToken?: string;

  @Prop()
  approvedAt?: Date;

  @Prop()
  approvedBy?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: {
      currentPhase: { type: Number },
      currentStep: { type: String },
      totalPhases: { type: Number },
      totalSteps: { type: Number },
      completedSteps: [{ type: String }],
      failedSteps: [
        {
          stepId: { type: String },
          error: { type: String },
          timestamp: { type: Date },
        },
      ],
      startTime: { type: Date },
      estimatedCompletionTime: { type: Date },
    },
  })
  executionProgress?: ExecutionProgress;

  @Prop({ type: [Object] })
  executionResults?: any[];

  @Prop({
    type: {
      success: { type: Boolean },
      deploymentUrls: [{ type: String }],
      healthChecks: [
        {
          name: { type: String },
          status: { type: String, enum: ['healthy', 'degraded', 'unhealthy'] },
          details: { type: Object },
        },
      ],
      dataIntegrity: {
        recordsProcessed: { type: Number },
        recordsSuccessful: { type: Number },
        recordsFailed: { type: Number },
      },
      rollbackInstructions: { type: String },
      recommendations: [{ type: String }],
      timestamp: { type: Date },
    },
  })
  verification?: VerificationResult;

  @Prop({
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

  @Prop()
  error?: string;

  @Prop()
  errorStack?: string;

  @Prop()
  completedAt?: Date;

  // Virtual for createdAt from timestamps
  createdAt?: Date;

  // Virtual for updatedAt from timestamps
  updatedAt?: Date;
}

export const GovernedTaskSchema = SchemaFactory.createForClass(GovernedTask);

// Index for efficient queries (approvalToken index created by @Prop)
GovernedTaskSchema.index({ userId: 1, status: 1, createdAt: -1 });
