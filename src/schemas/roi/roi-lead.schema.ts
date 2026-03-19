import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoiLeadDocument = RoiLead & HydratedDocument<RoiLead>;

@Schema({ timestamps: true, collection: 'roi_leads' })
export class RoiLead {
  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ trim: true })
  companyName?: string;

  @Prop()
  roiResultId?: string;

  @Prop({ type: Object })
  roiResultSnapshot?: Record<string, unknown>;

  @Prop({ default: false })
  reportSent: boolean;

  @Prop()
  reportSentAt?: Date;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const RoiLeadSchema = SchemaFactory.createForClass(RoiLead);

RoiLeadSchema.index({ email: 1 });
RoiLeadSchema.index({ createdAt: -1 });
