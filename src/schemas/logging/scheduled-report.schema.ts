import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IReportConfig {
  format: 'csv' | 'excel' | 'json';
  startDate?: Date;
  endDate?: Date;
  includeCharts?: boolean;
  sections?: string[];
}

export type ScheduledReportDocument = HydratedDocument<ScheduledReport>;

@Schema({ timestamps: true })
export class ScheduledReport {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true,
  })
  frequency: 'daily' | 'weekly' | 'monthly';

  @Prop({
    type: String,
    enum: ['csv', 'excel', 'json'],
    required: true,
  })
  format: 'csv' | 'excel' | 'json';

  @Prop({
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => v.length > 0,
      message: 'At least one recipient is required',
    },
  })
  recipients: string[];

  @Prop({
    type: {
      format: {
        type: String,
        enum: ['csv', 'excel', 'json'],
        required: true,
      },
      startDate: Date,
      endDate: Date,
      includeCharts: Boolean,
      sections: [String],
    },
  })
  config: IReportConfig;

  @Prop()
  lastSent?: Date;

  @Prop()
  nextSend?: Date;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop()
  reportType?: string;

  @Prop()
  lastRun?: Date;

  @Prop()
  nextRun?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  createdBy?: MongooseSchema.Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ScheduledReportSchema =
  SchemaFactory.createForClass(ScheduledReport);

// Indexes
ScheduledReportSchema.index({ isActive: 1, nextSend: 1 });
ScheduledReportSchema.index({ createdBy: 1 });
ScheduledReportSchema.index({ frequency: 1 });
