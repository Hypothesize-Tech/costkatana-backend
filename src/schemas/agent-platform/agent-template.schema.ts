import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AgentTemplateDocument = HydratedDocument<AgentTemplate>;

@Schema({ timestamps: true, collection: 'agent_templates' })
export class AgentTemplate {
  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: 'general' })
  category: string;

  /** DAG snapshot of the template (xyflow JSON). */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  dag: Record<string, unknown>;

  /**
   * Capabilities the template needs at runtime, e.g. `["bedrock-kb",
   * "google-search"]`. The frontend uses this to render badges; the backend
   * uses it for capability gating.
   */
  @Prop({ type: [String], default: [] })
  requiredCapabilities: string[];

  @Prop()
  previewThumb?: string;

  @Prop({ default: true })
  isOfficial: boolean;

  @Prop({ default: 0 })
  clonedCount: number;
}

export const AgentTemplateSchema = SchemaFactory.createForClass(AgentTemplate);

AgentTemplateSchema.index({ slug: 1 }, { unique: true });
AgentTemplateSchema.index({ category: 1, isOfficial: 1 });
