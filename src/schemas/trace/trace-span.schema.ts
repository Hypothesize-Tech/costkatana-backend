import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true, collection: 'traces' })
export class TraceSpan {
  @Prop({ required: true, unique: true })
  traceId: string;

  @Prop({ required: true })
  sessionId: string;

  @Prop()
  parentId?: string;

  @Prop({ required: true })
  name: string;

  @Prop({
    enum: ['http', 'llm', 'tool', 'database', 'custom'],
    default: 'custom',
  })
  type: 'http' | 'llm' | 'tool' | 'database' | 'custom';

  @Prop({ required: true })
  startedAt: Date;

  @Prop()
  endedAt?: Date;

  @Prop()
  duration?: number;

  @Prop({ enum: ['ok', 'error'], default: 'ok' })
  status: 'ok' | 'error';

  @Prop({
    type: {
      message: String,
      stack: String,
    },
  })
  error?: { message: string; stack?: string };

  @Prop()
  aiModel?: string;

  @Prop({
    type: {
      input: Number,
      output: Number,
    },
  })
  tokens?: { input: number; output: number };

  @Prop()
  costUSD?: number;

  @Prop()
  tool?: string;

  @Prop([String])
  resourceIds?: string[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ default: 0 })
  depth: number;
}

export type TraceSpanDocument = HydratedDocument<TraceSpan>;
export const TraceSpanSchema = SchemaFactory.createForClass(TraceSpan);

TraceSpanSchema.index({ sessionId: 1, startedAt: 1 });
TraceSpanSchema.index({ status: 1, startedAt: -1 });
