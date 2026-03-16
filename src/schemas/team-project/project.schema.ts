import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ProjectDocument = HydratedDocument<Project>;

@Schema({ _id: false })
export class ProjectBudgetAlert {
  @Prop({ required: true, min: 0, max: 100 })
  threshold: number;

  @Prop({ required: true, enum: ['email', 'in-app', 'both'], default: 'both' })
  type: 'email' | 'in-app' | 'both';

  @Prop({ type: [String], default: [] })
  recipients: string[];
}

@Schema({ _id: false })
export class ProjectBudget {
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({
    required: true,
    enum: ['monthly', 'quarterly', 'yearly', 'one-time'],
  })
  period: 'monthly' | 'quarterly' | 'yearly' | 'one-time';

  @Prop({ required: true })
  startDate: Date;

  @Prop()
  endDate?: Date;

  @Prop({ default: 'USD' })
  currency: string;

  @Prop({ type: [ProjectBudgetAlert], default: [] })
  alerts: ProjectBudgetAlert[];
}

@Schema({ _id: false })
export class ProjectSpendingHistory {
  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  amount: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  breakdown?: Record<string, number>;
}

@Schema({ _id: false })
export class ProjectSpending {
  @Prop({ default: 0 })
  current: number;

  @Prop({ default: Date.now })
  lastUpdated: Date;

  @Prop({ type: [ProjectSpendingHistory], default: [] })
  history: ProjectSpendingHistory[];
}

@Schema({ _id: false })
export class ProjectSettings {
  @Prop({ min: 0 })
  requireApprovalAbove?: number;

  @Prop({ type: [String] })
  allowedModels?: string[];

  @Prop({ min: 0 })
  maxTokensPerRequest?: number;

  @Prop({ default: true })
  enablePromptLibrary: boolean;

  @Prop({ default: true })
  enableCostAllocation: boolean;
}

@Schema({ timestamps: true })
export class Project {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization' })
  organizationId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  ownerId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
  })
  workspaceId: MongooseSchema.Types.ObjectId;

  @Prop({ type: ProjectBudget, required: true })
  budget: ProjectBudget;

  @Prop({ type: ProjectSpending, default: () => ({}) })
  spending: ProjectSpending;

  @Prop({ type: ProjectSettings, default: () => ({}) })
  settings: ProjectSettings;

  @Prop([String])
  tags: string[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  getBudgetUsagePercentage(): number {
    return this.budget.amount > 0
      ? (this.spending.current / this.budget.amount) * 100
      : 0;
  }
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

// Indexes
ProjectSchema.index({ ownerId: 1 });
ProjectSchema.index({ workspaceId: 1 });
ProjectSchema.index({ organizationId: 1 });
ProjectSchema.index({ isActive: 1 });

// Instance methods
ProjectSchema.methods.getBudgetUsagePercentage = function (): number {
  return this.budget.amount > 0
    ? (this.spending.current / this.budget.amount) * 100
    : 0;
};
