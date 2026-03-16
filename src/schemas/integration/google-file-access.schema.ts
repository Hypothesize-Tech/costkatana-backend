import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IFileMetadata {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: Date;
  webViewLink?: string;
  downloadUrl?: string;
  iconLink?: string;
  createdTime?: string;
}

export type GoogleFileAccessDocument = HydratedDocument<GoogleFileAccess>;

@Schema({ timestamps: true, collection: 'google_file_access' })
export class GoogleFileAccess {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: false,
    index: true,
  })
  userId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'GoogleConnection',
    required: true,
    index: true,
  })
  googleConnectionId: MongooseSchema.Types.ObjectId;

  /** Express-compatible: same as googleConnectionId */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'GoogleConnection' })
  connectionId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: false })
  fileId?: string;

  @Prop({ required: false })
  fileName?: string;

  @Prop({ type: String, enum: ['docs', 'sheets', 'drive'] })
  fileType?: 'docs' | 'sheets' | 'drive';

  @Prop({ required: false })
  mimeType?: string;

  @Prop({
    type: String,
    enum: ['app_created', 'picker_selected'],
    default: 'picker_selected',
  })
  accessMethod?: 'app_created' | 'picker_selected';

  @Prop({ type: Date, default: Date.now })
  lastAccessedAt?: Date;

  @Prop()
  webViewLink?: string;

  @Prop({ type: Object })
  metadata?: {
    size?: number;
    createdTime?: string;
    modifiedTime?: string;
    iconLink?: string;
  };

  @Prop({
    type: {
      fileId: { type: String, required: false },
      name: { type: String, required: false },
      mimeType: { type: String, required: false },
      size: { type: Number, required: false },
      modifiedTime: { type: Date, required: false },
      webViewLink: String,
      downloadUrl: String,
      iconLink: String,
      createdTime: String,
    },
  })
  fileMetadata?: IFileMetadata;

  @Prop({ type: Boolean, default: true })
  hasAccess: boolean;

  @Prop()
  lastAccessed?: Date;

  @Prop({ type: Number, default: 0 })
  accessCount: number;

  @Prop()
  permissions?: string[];

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const GoogleFileAccessSchema =
  SchemaFactory.createForClass(GoogleFileAccess);

// Indexes
GoogleFileAccessSchema.index({ googleConnectionId: 1 });
GoogleFileAccessSchema.index({ 'fileMetadata.fileId': 1 });
GoogleFileAccessSchema.index({ userId: 1, connectionId: 1, fileType: 1 });
GoogleFileAccessSchema.index({ userId: 1, fileId: 1 }, { unique: true });
