import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type OperatorMFADocument = HydratedDocument<OperatorMFA>;

@Schema()
export class OperatorMFA {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  operatorId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  encryptedSecret: Buffer;

  @Prop({ required: true })
  iv: Buffer; // Initialization vector for encryption

  @Prop({ required: true })
  authTag: Buffer; // Authentication tag for GCM mode

  @Prop({ required: true, default: Date.now })
  createdAt: Date;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ default: 0 })
  failedAttempts: number;

  @Prop()
  lockedUntil?: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  backupCodes?: {
    codes: Buffer[]; // Encrypted backup codes
    iv: Buffer;
    authTag: Buffer;
    createdAt: Date;
  };

  @Prop({ default: true })
  enabled: boolean;
}

export const OperatorMFASchema = SchemaFactory.createForClass(OperatorMFA);

// Indexes (operatorId unique index created by @Prop)
OperatorMFASchema.index({ enabled: 1 });

// No TTL - MFA data should be retained until operator is deactivated
