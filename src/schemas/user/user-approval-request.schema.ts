import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IRequestData {
  url?: string;
  method?: string;
  resource?: string;
  action?: string;
  integration?: string;
  toolName?: string;
  timestamp: Date;
}

export type UserApprovalRequestDocument = HydratedDocument<UserApprovalRequest>;

@Schema({ timestamps: true })
export class UserApprovalRequest {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['http_request', 'dangerous_operation', 'resource_access'],
    required: true,
  })
  requestType: 'http_request' | 'dangerous_operation' | 'resource_access';

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  requestData: IRequestData;

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'denied', 'expired'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'approved' | 'denied' | 'expired';

  @Prop({ required: true, index: true })
  expiresAt: Date;

  @Prop()
  respondedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const UserApprovalRequestSchema =
  SchemaFactory.createForClass(UserApprovalRequest);

/** Get Mongoose model for UserApprovalRequest (use when model is registered via MongooseModule) */
export const getUserApprovalRequestModel = () =>
  mongoose.models[UserApprovalRequest.name] ||
  mongoose.model(UserApprovalRequest.name, UserApprovalRequestSchema);

// Auto-expire documents
UserApprovalRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for efficient queries
UserApprovalRequestSchema.index({ userId: 1, status: 1, expiresAt: 1 });
