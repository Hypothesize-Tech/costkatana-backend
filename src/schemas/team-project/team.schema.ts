import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface ITeamSettings {
  defaultBudgetLimit?: number;
  defaultPermissions: ('read' | 'write' | 'admin')[];
  allowMembersToCreateKeys: boolean;
  requireApprovalForKeys: boolean;
}

export interface ITeamBilling {
  seatsIncluded: number;
  additionalSeats: number;
  pricePerSeat: number;
  billingCycle: 'monthly' | 'yearly';
}

export type TeamDocument = HydratedDocument<Team>;

@Schema({ timestamps: true })
export class Team {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization' })
  organizationId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  ownerId: MongooseSchema.Types.ObjectId;

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'User' }])
  members: MongooseSchema.Types.ObjectId[];

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'Project' }])
  projectIds: MongooseSchema.Types.ObjectId[];

  @Prop({
    type: {
      defaultBudgetLimit: { type: Number, min: 0 },
      defaultPermissions: [
        {
          type: String,
          enum: ['read', 'write', 'admin'],
          default: 'read',
        },
      ],
      allowMembersToCreateKeys: { type: Boolean, default: false },
      requireApprovalForKeys: { type: Boolean, default: true },
    },
    _id: false,
  })
  settings: ITeamSettings;

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
    _id: false,
  })
  billing: ITeamBilling;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const TeamSchema = SchemaFactory.createForClass(Team);

// Indexes
TeamSchema.index({ ownerId: 1, isActive: 1 });
TeamSchema.index({ members: 1, isActive: 1 });
TeamSchema.index({ organizationId: 1, isActive: 1 });
TeamSchema.index({ name: 1, organizationId: 1 }, { unique: true });
