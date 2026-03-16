import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ModerationAppealDocument = HydratedDocument<ModerationAppeal>;

@Schema({ timestamps: true, collection: 'moderationappeals' })
export class ModerationAppeal {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ThreatLog',
    required: true,
  })
  threatId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, maxlength: 2000 })
  reason: string;

  @Prop({ maxlength: 2000 })
  additionalContext?: string;

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  })
  status: 'pending' | 'approved' | 'rejected';

  @Prop({ type: Date, default: Date.now })
  submittedAt: Date;

  @Prop()
  reviewedAt?: Date;

  @Prop({ maxlength: 1000 })
  reviewNote?: string;
}

export const ModerationAppealSchema =
  SchemaFactory.createForClass(ModerationAppeal);
ModerationAppealSchema.index({ userId: 1, submittedAt: -1 });
ModerationAppealSchema.index({ threatId: 1 });
ModerationAppealSchema.index({ status: 1 });
