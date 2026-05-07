import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IEvaluationMetrics {
  contextRelevance: number;
  answerFaithfulness: number;
  answerRelevance: number;
  retrievalPrecision: number;
  retrievalRecall: number;
  overall: number;
}

export type EvaluationResultDocument = HydratedDocument<EvaluationResult>;

@Schema({ timestamps: true })
export class EvaluationResult {
  @Prop({ required: true, unique: true })
  requestId: string;

  @Prop()
  userId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PromptTemplate' })
  promptTemplateId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PromptVersion' })
  promptVersionId?: MongooseSchema.Types.ObjectId;

  @Prop()
  modelName?: string;

  @Prop()
  provider?: string;

  @Prop({
    type: {
      contextRelevance: { type: Number, required: true },
      answerFaithfulness: { type: Number, required: true },
      answerRelevance: { type: Number, required: true },
      retrievalPrecision: { type: Number, required: true },
      retrievalRecall: { type: Number, default: 0 },
      overall: { type: Number, required: true },
    },
    _id: false,
    required: true,
  })
  metrics: IEvaluationMetrics;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const EvaluationResultSchema =
  SchemaFactory.createForClass(EvaluationResult);

EvaluationResultSchema.index({ modelName: 1, createdAt: -1 });
EvaluationResultSchema.index({ promptVersionId: 1, createdAt: -1 });
EvaluationResultSchema.index({ userId: 1, createdAt: -1 });
