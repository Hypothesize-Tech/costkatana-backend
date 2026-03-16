import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type ThreatLogDocument = HydratedDocument<ThreatLog>;

@Schema({ timestamps: true })
export class ThreatLog {
  @Prop({ required: true })
  requestId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: [
      'prompt_injection',
      'jailbreak_attempt',
      'violence_and_hate',
      'sexual_content',
      'criminal_planning',
      'guns_and_illegal_weapons',
      'regulated_substances',
      'self_harm',
      'jailbreaking',
      'data_exfiltration',
      'phishing_and_social_engineering',
      'spam_and_unwanted_content',
      'misinformation',
      'privacy_violations',
      'intellectual_property_violations',
      'harassment_and_bullying',
      'harmful_content',
      'unauthorized_tool_access',
      'rag_security_violation',
      'context_manipulation',
      'system_prompt_extraction',
      'unknown',
    ],
  })
  threatCategory:
    | 'prompt_injection'
    | 'jailbreak_attempt'
    | 'violence_and_hate'
    | 'sexual_content'
    | 'criminal_planning'
    | 'guns_and_illegal_weapons'
    | 'regulated_substances'
    | 'self_harm'
    | 'jailbreaking'
    | 'data_exfiltration'
    | 'phishing_and_social_engineering'
    | 'spam_and_unwanted_content'
    | 'misinformation'
    | 'privacy_violations'
    | 'intellectual_property_violations'
    | 'harassment_and_bullying'
    | 'harmful_content'
    | 'unauthorized_tool_access'
    | 'rag_security_violation'
    | 'context_manipulation'
    | 'system_prompt_extraction'
    | 'unknown';

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number;

  @Prop({
    type: String,
    required: true,
    enum: [
      'prompt-guard',
      'openai-safeguard',
      'rag-guard',
      'tool-guard',
      'output-guard',
    ],
  })
  stage:
    | 'prompt-guard'
    | 'openai-safeguard'
    | 'rag-guard'
    | 'tool-guard'
    | 'output-guard';

  @Prop({ required: true, maxlength: 1000 })
  reason: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  details: any;

  @Prop({ required: true, min: 0, default: 0 })
  costSaved: number;

  @Prop({ default: Date.now })
  timestamp: Date;

  @Prop({ sparse: true })
  promptHash?: string;

  @Prop({ maxlength: 200, sparse: true })
  promptPreview?: string;

  @Prop({ maxlength: 45 })
  ipAddress?: string;

  @Prop({ maxlength: 500 })
  userAgent?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ThreatLogSchema = SchemaFactory.createForClass(ThreatLog);

// Indexes
ThreatLogSchema.index({ userId: 1, timestamp: -1 });
ThreatLogSchema.index({ timestamp: -1 });
ThreatLogSchema.index({ threatCategory: 1, timestamp: -1 });

// TTL index to automatically delete old logs after 1 year
ThreatLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 },
);
