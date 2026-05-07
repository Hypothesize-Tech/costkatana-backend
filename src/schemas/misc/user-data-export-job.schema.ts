import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type UserDataExportJobDocument = HydratedDocument<UserDataExportJob>;

/**
 * Job record for the async GDPR data-portability export.
 *
 * Lifecycle:
 *   pending  → background worker picked it up
 *   ready    → JSON written to S3, signedUrl populated, expiresAt set
 *   failed   → error captured in `error`, downloadable from a manual
 *              support path (not exposed via the public route)
 *
 * Records auto-expire 7 days after `ready` so we don't accumulate
 * indefinite signed-URL state. The TTL index is on `purgeAt` (set when
 * the job lands in `ready`).
 */
@Schema({ timestamps: true, collection: 'user_data_export_jobs' })
export class UserDataExportJob {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'ready', 'failed'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'ready' | 'failed';

  @Prop()
  s3Key?: string;

  @Prop()
  signedUrl?: string;

  @Prop()
  expiresAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  error?: string;

  /** Set when status flips to ready/failed; TTL index purges the record. */
  @Prop({ type: Date })
  purgeAt?: Date;
}

export const UserDataExportJobSchema =
  SchemaFactory.createForClass(UserDataExportJob);

UserDataExportJobSchema.index({ userId: 1, createdAt: -1 });
// 7-day automatic cleanup. Mongoose evaluates this at index-creation
// time; the worker sets `purgeAt = new Date(Date.now() + 7d)` on
// completion so unfinished jobs hang around until they finish.
UserDataExportJobSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
