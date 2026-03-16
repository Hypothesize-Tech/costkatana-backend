import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IWorkspaceSettings {
  allowMemberInvites: boolean;
  defaultProjectAccess: 'all' | 'assigned';
  requireEmailVerification: boolean;
}

export interface IWorkspaceBilling {
  seatsIncluded: number;
  additionalSeats: number;
  pricePerSeat: number;
  billingCycle: 'monthly' | 'yearly';
}

export type WorkspaceDocument = HydratedDocument<Workspace>;

@Schema({ timestamps: true })
export class Workspace {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/,
  })
  slug: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  ownerId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: {
      allowMemberInvites: { type: Boolean, default: false },
      defaultProjectAccess: {
        type: String,
        enum: ['all', 'assigned'],
        default: 'assigned',
      },
      requireEmailVerification: { type: Boolean, default: true },
    },
  })
  settings: IWorkspaceSettings;

  @Prop({
    type: {
      seatsIncluded: { type: Number, default: 1, min: 1 },
      additionalSeats: { type: Number, default: 0, min: 0 },
      pricePerSeat: { type: Number, default: 10, min: 0 },
      billingCycle: {
        type: String,
        enum: ['monthly', 'yearly'],
        default: 'monthly',
      },
    },
  })
  billing: IWorkspaceBilling;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);

// Indexes
WorkspaceSchema.index({ ownerId: 1 });
WorkspaceSchema.index({ isActive: 1 });
