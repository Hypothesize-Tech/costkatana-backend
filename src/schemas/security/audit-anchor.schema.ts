import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuditAnchorDocument = AuditAnchor & Document;

@Schema({
  timestamps: true,
  collection: 'audit_anchors',
  // Keep anchor records for 1 year (regulatory requirement)
  expires: 365 * 24 * 60 * 60, // 1 year in seconds
})
export class AuditAnchor {
  @Prop({ required: true, unique: true, index: true })
  anchorId: string;

  @Prop({ required: true })
  anchorHash: string;

  @Prop({ required: true, type: Number })
  startPosition: number;

  @Prop({ required: true, type: Number })
  endPosition: number;

  @Prop({ required: true, type: Number })
  entryCount: number;

  @Prop({ type: Date })
  publishedAt?: Date;

  @Prop({ type: String })
  s3Location?: string;

  @Prop({ type: Boolean, default: false })
  verified: boolean;

  @Prop({ type: Date })
  verifiedAt?: Date;

  // TTL index will automatically delete old records
  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const AuditAnchorSchema = SchemaFactory.createForClass(AuditAnchor);

// Additional indexes for performance
AuditAnchorSchema.index({ verified: 1, createdAt: -1 });
AuditAnchorSchema.index({ publishedAt: 1 }, { sparse: true });
AuditAnchorSchema.index({ createdAt: -1 });
