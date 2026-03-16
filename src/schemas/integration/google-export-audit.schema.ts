import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'pdf';

export interface IExportMetadata {
  recordCount: number;
  fileSize?: number;
  checksum?: string;
  format: ExportFormat;
}

export type GoogleExportAuditDocument = HydratedDocument<GoogleExportAudit>;

@Schema({ timestamps: true, collection: 'google_export_audits' })
export class GoogleExportAudit {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'GoogleConnection',
    required: true,
  })
  googleConnectionId: MongooseSchema.Types.ObjectId;

  /** Express-compatible: same as googleConnectionId */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'GoogleConnection' })
  connectionId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  exportId: string;

  @Prop({ required: true })
  requestorId: string;

  /** Express-compatible: userId (ObjectId) */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  })
  status: ExportStatus;

  /** Express-compatible: sheets | docs | drive */
  @Prop({ type: String, enum: ['sheets', 'docs', 'drive'] })
  exportType?: 'sheets' | 'docs' | 'drive';

  @Prop({
    type: String,
    enum: ['cost_data', 'analytics', 'report', 'budget', 'usage', 'custom'],
  })
  datasetType?: string;

  @Prop()
  fileId?: string;

  @Prop()
  fileName?: string;

  @Prop()
  fileLink?: string;

  @Prop()
  scope?: string;

  @Prop()
  recordCount?: number;

  @Prop()
  exportedAt?: Date;

  @Prop({
    type: {
      recordCount: { type: Number, required: false },
      fileSize: Number,
      checksum: String,
      format: {
        type: String,
        enum: ['csv', 'json', 'xlsx', 'pdf'],
        required: false,
      },
    },
  })
  metadata?: IExportMetadata & {
    startDate?: Date;
    endDate?: Date;
    projectId?: string;
    redactionApplied?: boolean;
    maskingOptions?: string[];
  };

  @Prop()
  googleDriveFileId?: string;

  @Prop()
  downloadUrl?: string;

  @Prop()
  errorMessage?: string;

  @Prop()
  requestedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const GoogleExportAuditSchema =
  SchemaFactory.createForClass(GoogleExportAudit);

// Indexes
GoogleExportAuditSchema.index({ googleConnectionId: 1 });
GoogleExportAuditSchema.index({ exportId: 1 }, { unique: true });
GoogleExportAuditSchema.index({ status: 1 });
GoogleExportAuditSchema.index({ requestorId: 1 });
GoogleExportAuditSchema.index({ userId: 1, exportedAt: -1 });
GoogleExportAuditSchema.index({ userId: 1, exportType: 1, exportedAt: -1 });
GoogleExportAuditSchema.index({ connectionId: 1, exportedAt: -1 });
