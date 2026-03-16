import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConnectionStatus =
  | 'active'
  | 'inactive'
  | 'error'
  | 'pending_verification';

export interface ICollectionAccess {
  name: string;
  permissions: ('read' | 'write' | 'delete' | 'admin')[];
}

export interface IDatabaseAccess {
  name: string;
  collections: ICollectionAccess[];
}

export interface IConnectionHealth {
  lastChecked: Date;
  lastSuccessful?: Date;
  consecutiveFailures: number;
  lastError?: string;
  responseTimeMs?: number;
}

export interface MongoDBConnectionDocument extends HydratedDocument<MongoDBConnection> {
  isCredentialExpired(): boolean;
}

@Schema({ timestamps: true, collection: 'mongodb_connections' })
export class MongoDBConnection {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  encryptedConnectionString: string;

  @Prop({
    type: String,
    enum: ['active', 'inactive', 'error', 'pending_verification'],
    default: 'pending_verification',
  })
  status: ConnectionStatus;

  @Prop({
    type: [
      {
        name: { type: String, required: true },
        collections: [
          {
            name: { type: String, required: true },
            permissions: [
              {
                type: String,
                enum: ['read', 'write', 'delete', 'admin'],
                default: 'read',
              },
            ],
          },
        ],
      },
    ],
    _id: false,
  })
  databaseAccess: IDatabaseAccess[];

  @Prop({
    type: {
      lastChecked: { type: Date, default: Date.now },
      lastSuccessful: Date,
      consecutiveFailures: { type: Number, default: 0 },
      lastError: String,
      responseTimeMs: Number,
    },
    _id: false,
  })
  health: IConnectionHealth;

  @Prop()
  expiresAt?: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const MongoDBConnectionSchema =
  SchemaFactory.createForClass(MongoDBConnection);

// Instance method for credential expiry check
MongoDBConnectionSchema.methods.isCredentialExpired = function (): boolean {
  return !!this.expiresAt && new Date() > new Date(this.expiresAt);
};

// Indexes
MongoDBConnectionSchema.index({ userId: 1, status: 1 });
MongoDBConnectionSchema.index({ expiresAt: 1 }, { sparse: true });
