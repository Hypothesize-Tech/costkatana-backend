import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AcceptanceEventDocument = AcceptanceEvent & Document;

@Schema({ timestamps: true })
export class AcceptanceEvent {
  @Prop({ required: true })
  suggestionId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({
    required: true,
    enum: [
      'code_completion',
      'refactor',
      'optimization',
      'documentation',
      'test_generation',
    ],
  })
  type:
    | 'code_completion'
    | 'refactor'
    | 'optimization'
    | 'documentation'
    | 'test_generation';

  @Prop({ required: true })
  language: string;

  @Prop({ required: true })
  accepted: boolean;

  @Prop()
  acceptanceTime?: number; // seconds from suggestion to acceptance

  @Prop({
    type: {
      filePath: String,
      lineNumber: Number,
      sessionId: String,
    },
    _id: false,
    default: {},
  })
  context?: {
    filePath?: string;
    lineNumber?: number;
    sessionId?: string;
  };
}

export const AcceptanceEventSchema =
  SchemaFactory.createForClass(AcceptanceEvent);

// Add indexes for efficient queries
AcceptanceEventSchema.index({ userId: 1, createdAt: -1 });
AcceptanceEventSchema.index({ type: 1, createdAt: -1 });
AcceptanceEventSchema.index({ language: 1, createdAt: -1 });
AcceptanceEventSchema.index({ accepted: 1, createdAt: -1 });
AcceptanceEventSchema.index({ createdAt: -1 });
AcceptanceEventSchema.index({ suggestionId: 1 }, { unique: true });
