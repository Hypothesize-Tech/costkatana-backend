import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AutoSimulationSettingsDocument =
  HydratedDocument<AutoSimulationSettings>;

@Schema({ timestamps: true, collection: 'auto_simulation_settings' })
export class AutoSimulationSettings {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  @Prop({
    type: {
      costThreshold: { type: Number, default: 0.01 },
      tokenThreshold: { type: Number, default: 1000 },
      expensiveModels: [String],
      allCalls: { type: Boolean, default: false },
    },
  })
  triggers: {
    costThreshold: number;
    tokenThreshold: number;
    expensiveModels: string[];
    allCalls: boolean;
  };

  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      approvalRequired: { type: Boolean, default: true },
      maxSavingsThreshold: { type: Number, default: 0.5 },
      riskTolerance: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium',
      },
    },
    required: false,
  })
  autoOptimize?: {
    enabled: boolean;
    approvalRequired: boolean;
    maxSavingsThreshold: number;
    riskTolerance: 'low' | 'medium' | 'high';
  };

  @Prop({
    type: {
      email: { type: Boolean, default: true },
      dashboard: { type: Boolean, default: true },
      slack: { type: Boolean, default: false },
      slackWebhook: String,
    },
  })
  notifications: {
    email: boolean;
    dashboard: boolean;
    slack: boolean;
    slackWebhook?: string;
  };

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const AutoSimulationSettingsSchema = SchemaFactory.createForClass(
  AutoSimulationSettings,
);
