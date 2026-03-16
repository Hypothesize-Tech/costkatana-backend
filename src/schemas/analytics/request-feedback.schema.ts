import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface IImplicitSignals {
  copied?: boolean;
  conversationContinued?: boolean;
  immediateRephrase?: boolean;
  sessionDuration?: number;
  codeAccepted?: boolean;
}

export type RequestFeedbackDocument = HydratedDocument<RequestFeedback>;

@Schema({ timestamps: true })
export class RequestFeedback {
  @Prop({ required: true, unique: true })
  requestId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  rating: boolean;

  @Prop({ maxlength: 1000 })
  comment?: string;

  @Prop()
  modelName?: string;

  @Prop()
  provider?: string;

  @Prop()
  cost?: number;

  @Prop()
  tokens?: number;

  @Prop({
    type: {
      copied: Boolean,
      conversationContinued: Boolean,
      immediateRephrase: Boolean,
      sessionDuration: Number,
      codeAccepted: Boolean,
    },
  })
  implicitSignals?: IImplicitSignals;

  @Prop()
  userAgent?: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  feature?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const RequestFeedbackSchema =
  SchemaFactory.createForClass(RequestFeedback);

// Indexes
RequestFeedbackSchema.index({ userId: 1, createdAt: -1 });
RequestFeedbackSchema.index({ rating: 1, createdAt: -1 });
RequestFeedbackSchema.index({ provider: 1, rating: 1 });
