import mongoose, { Schema, Document } from 'mongoose';

export interface IUserApprovalRequest extends Document {
  userId: mongoose.Types.ObjectId;
  requestType: 'http_request' | 'dangerous_operation' | 'resource_access';
  requestData: {
    url?: string;
    method?: string;
    resource?: string;
    action?: string;
    integration?: string;
    toolName?: string;
    timestamp: Date;
  };
  status: 'pending' | 'approved' | 'denied' | 'expired';
  expiresAt: Date;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserApprovalRequestSchema = new Schema<IUserApprovalRequest>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    requestType: {
      type: String,
      enum: ['http_request', 'dangerous_operation', 'resource_access'],
      required: true,
    },
    requestData: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'expired'],
      default: 'pending',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    respondedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-expire documents
UserApprovalRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for efficient queries
UserApprovalRequestSchema.index({ userId: 1, status: 1, expiresAt: 1 });

export const UserApprovalRequest = mongoose.model<IUserApprovalRequest>(
  'UserApprovalRequest',
  UserApprovalRequestSchema
);
