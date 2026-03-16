import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IApprovalRequestDetails {
  operation: string;
  estimatedCost: number;
  estimatedTokens?: number;
  model?: string;
  prompt?: string;
  reason?: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface IApprovalRequestApproval {
  approverId?: MongooseSchema.Types.ObjectId;
  approvedAt?: Date;
  comments?: string;
  conditions?: string[];
}

export interface IRequesterHistory {
  totalRequests: number;
  approvedRequests: number;
  totalSpending: number;
}

export interface IApprovalRequestMetadata {
  currentProjectSpending?: number;
  budgetRemaining?: number;
  requesterHistory?: IRequesterHistory;
}

export interface IApprovalRequestMethods {
  approve(
    approverId: string,
    comments?: string,
    conditions?: string[],
  ): Promise<ApprovalRequest>;
  reject(approverId: string, comments: string): Promise<ApprovalRequest>;
  isExpired(): boolean;
}

export type ApprovalRequestDocument = HydratedDocument<
  ApprovalRequest,
  IApprovalRequestMethods
>;

@Schema({ timestamps: true })
export class ApprovalRequest implements IApprovalRequestMethods {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  requesterId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', required: true })
  projectId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['api_call', 'bulk_operation', 'model_change', 'budget_increase'],
    required: true,
  })
  type: 'api_call' | 'bulk_operation' | 'model_change' | 'budget_increase';

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'rejected', 'expired'],
    default: 'pending',
  })
  status: 'pending' | 'approved' | 'rejected' | 'expired';

  @Prop({
    type: {
      operation: { type: String, required: true },
      estimatedCost: { type: Number, required: true, min: 0 },
      estimatedTokens: Number,
      model: String,
      prompt: String,
      reason: String,
      urgency: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium',
      },
    },
  })
  details: IApprovalRequestDetails;

  @Prop({
    type: {
      approverId: { type: MongooseSchema.Types.ObjectId, ref: 'User' },
      approvedAt: Date,
      comments: String,
      conditions: [String],
    },
  })
  approval?: IApprovalRequestApproval;

  @Prop({
    type: {
      currentProjectSpending: Number,
      budgetRemaining: Number,
      requesterHistory: {
        totalRequests: Number,
        approvedRequests: Number,
        totalSpending: Number,
      },
    },
  })
  metadata?: IApprovalRequestMetadata;

  @Prop({ default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }) // 24 hours
  expiresAt: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  // Methods
  async approve(
    approverId: string,
    comments?: string,
    conditions?: string[],
  ): Promise<ApprovalRequest> {
    this.status = 'approved';
    this.approval = {
      approverId: new MongooseSchema.Types.ObjectId(approverId),
      approvedAt: new Date(),
      comments,
      conditions,
    };
    return (this as any).save();
  }

  async reject(approverId: string, comments: string): Promise<ApprovalRequest> {
    this.status = 'rejected';
    this.approval = {
      approverId: new MongooseSchema.Types.ObjectId(approverId),
      approvedAt: new Date(),
      comments,
    };
    return (this as any).save();
  }

  isExpired(): boolean {
    return this.status === 'pending' && new Date() > this.expiresAt;
  }
}

export const ApprovalRequestSchema =
  SchemaFactory.createForClass(ApprovalRequest);

// Indexes
ApprovalRequestSchema.index({ requesterId: 1, status: 1 });
ApprovalRequestSchema.index({ projectId: 1, status: 1 });
ApprovalRequestSchema.index({ 'approval.approverId': 1 });
ApprovalRequestSchema.index({ expiresAt: 1 });
ApprovalRequestSchema.index({ status: 1, 'details.urgency': 1 });

// Static methods
ApprovalRequestSchema.statics.expirePendingRequests = async function () {
  return this.updateMany(
    {
      status: 'pending',
      expiresAt: { $lt: new Date() },
    },
    {
      status: 'expired',
    },
  );
};
