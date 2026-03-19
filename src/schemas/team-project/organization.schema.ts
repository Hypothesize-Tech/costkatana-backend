import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IOrganizationSecuritySettings {
  killSwitchActive?: boolean;
  readOnlyMode?: boolean;
  requireMfaForSensitiveActions?: boolean;
}

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ required: true, trim: true, maxlength: 150 })
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
      killSwitchActive: { type: Boolean, default: false },
      readOnlyMode: { type: Boolean, default: false },
      requireMfaForSensitiveActions: { type: Boolean, default: false },
    },
    _id: false,
  })
  securitySettings?: IOrganizationSecuritySettings;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);

OrganizationSchema.index({ ownerId: 1 });
OrganizationSchema.index({ slug: 1 }, { unique: true });
OrganizationSchema.index({ isActive: 1 });
