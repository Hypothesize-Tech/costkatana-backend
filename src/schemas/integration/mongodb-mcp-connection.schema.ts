import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * MongoDB MCP Connection schema (Express-compatible).
 * Uses collection 'mongodbconnections' for migration compatibility.
 */
export interface IMongodbMcpConnectionMetadata {
  description?: string;
  environment?: 'development' | 'staging' | 'production';
  provider?: 'atlas' | 'self-hosted' | 'aws-documentdb' | 'azure-cosmos';
  region?: string;
  host?: string;
  port?: number;
  username?: string;
  database?: string;
  allowedCollections?: string[];
  blockedCollections?: string[];
  allowedFields?: Record<string, string[]>;
  blockedFields?: Record<string, string[]>;
  maxDocsPerQuery?: number;
  maxQueryTimeMs?: number;
  credentialExpiry?: Date;
}

export type MongodbMcpConnectionDocument =
  HydratedDocument<MongodbMcpConnection>;

@Schema({ timestamps: true, collection: 'mongodbconnections' })
export class MongodbMcpConnection {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  alias: string;

  @Prop({ required: true, select: false })
  connectionString: string;

  @Prop({ required: true, trim: true })
  database: string;

  @Prop({
    type: {
      description: { type: String, maxlength: 500 },
      environment: {
        type: String,
        enum: ['development', 'staging', 'production'],
        default: 'production',
      },
      provider: {
        type: String,
        enum: ['atlas', 'self-hosted', 'aws-documentdb', 'azure-cosmos'],
      },
      region: String,
      host: String,
      port: Number,
      username: String,
      database: String,
      allowedCollections: [String],
      blockedCollections: [String],
      allowedFields: MongooseSchema.Types.Mixed,
      blockedFields: MongooseSchema.Types.Mixed,
      maxDocsPerQuery: { type: Number, min: 1, max: 1000, default: 500 },
      maxQueryTimeMs: { type: Number, min: 1000, max: 30000, default: 8000 },
      credentialExpiry: Date,
    },
  })
  metadata?: IMongodbMcpConnectionMetadata;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop()
  lastValidated?: Date;

  @Prop()
  lastUsed?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MongodbMcpConnectionSchema =
  SchemaFactory.createForClass(MongodbMcpConnection);

MongodbMcpConnectionSchema.index({ userId: 1, isActive: 1 });
MongodbMcpConnectionSchema.index({ userId: 1, alias: 1 }, { unique: true });
