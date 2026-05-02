import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentVersionDocument = HydratedDocument<AgentVersion>;

@Schema({ timestamps: true, collection: 'agent_versions' })
export class AgentVersion {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  agentDefinitionId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  versionNumber: number;

  /**
   * Raw DAG as stored from the canvas (xyflow JSON).
   * Shape: { nodes: DagNode[], edges: DagEdge[] }
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  dag: Record<string, unknown>;

  /**
   * Output of AgentCompilerService — topological order, indices, terminal IDs.
   * Persisted so we don't have to recompile on every run.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  compiledPlan?: Record<string, unknown>;

  @Prop()
  defaultModel?: string;

  @Prop()
  entryNodeId?: string;

  @Prop({ type: [String], default: [] })
  terminalNodeIds: string[];

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  createdBy: Types.ObjectId;

  @Prop()
  publishedAt?: Date;

  /** Free-form notes the author can add when publishing a new version. */
  @Prop({ default: '' })
  changelog: string;
}

export const AgentVersionSchema = SchemaFactory.createForClass(AgentVersion);

AgentVersionSchema.index(
  { agentDefinitionId: 1, versionNumber: -1 },
  { unique: true },
);
