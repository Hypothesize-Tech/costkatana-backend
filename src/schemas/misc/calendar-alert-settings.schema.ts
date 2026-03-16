import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface ICalendarThreshold {
  percentage: number;
  color: 'green' | 'yellow' | 'orange' | 'red';
  notifyBefore: number;
}

export interface ICalendarServices {
  budget: boolean;
  usage: boolean;
  anomaly: boolean;
}

export interface IReminderDefaults {
  timing: number[];
  method: 'email' | 'popup' | 'both';
}

export type CalendarAlertSettingsDocument =
  HydratedDocument<CalendarAlertSettings>;

@Schema({ timestamps: true })
export class CalendarAlertSettings {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Workspace' })
  workspaceId?: MongooseSchema.Types.ObjectId;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ required: true })
  calendarId: string;

  @Prop([
    {
      percentage: { type: Number, required: true, min: 0, max: 100 },
      color: {
        type: String,
        enum: ['green', 'yellow', 'orange', 'red'],
        required: true,
      },
      notifyBefore: { type: Number, required: true, min: 0 },
    },
  ])
  thresholds: ICalendarThreshold[];

  @Prop([
    {
      type: String,
      validate: {
        validator: function (email: string) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        },
        message: 'Invalid email address',
      },
    },
  ])
  recipients: string[];

  @Prop({
    type: {
      budget: { type: Boolean, default: true },
      usage: { type: Boolean, default: true },
      anomaly: { type: Boolean, default: true },
    },
  })
  services: ICalendarServices;

  @Prop({
    type: {
      timing: { type: [Number], default: [15, 60, 1440] },
      method: {
        type: String,
        enum: ['email', 'popup', 'both'],
        default: 'both',
      },
    },
  })
  reminderDefaults: IReminderDefaults;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const CalendarAlertSettingsSchema = SchemaFactory.createForClass(
  CalendarAlertSettings,
);

// Indexes
CalendarAlertSettingsSchema.index({ workspaceId: 1 });
CalendarAlertSettingsSchema.index({ enabled: 1 });
