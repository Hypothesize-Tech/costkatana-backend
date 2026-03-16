import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type RequestScoreDocument = HydratedDocument<RequestScore>;

@Schema({ timestamps: true })
export class RequestScore {
  @Prop({ required: true })
  requestId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  score: number;

  @Prop({ maxlength: 500 })
  notes?: string;

  @Prop({ default: Date.now })
  scoredAt: Date;

  @Prop({
    type: Boolean,
    default: function (this: RequestScore) {
      return this.score >= 4;
    },
  })
  isTrainingCandidate: boolean;

  @Prop([
    {
      type: String,
      enum: [
        'concise',
        'accurate',
        'efficient',
        'creative',
        'helpful',
        'clear',
        'complete',
      ],
    },
  ])
  trainingTags: (
    | 'concise'
    | 'accurate'
    | 'efficient'
    | 'creative'
    | 'helpful'
    | 'clear'
    | 'complete'
  )[];

  @Prop()
  tokenEfficiency?: number;

  @Prop()
  costEfficiency?: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const RequestScoreSchema = SchemaFactory.createForClass(RequestScore);

// Indexes
RequestScoreSchema.index({ userId: 1, scoredAt: -1 });
RequestScoreSchema.index({ requestId: 1, userId: 1 }, { unique: true });
RequestScoreSchema.index({ isTrainingCandidate: 1, score: -1 });

// Pre-save middleware to calculate efficiency metrics
RequestScoreSchema.pre('save', function (next) {
  // These will be calculated when we link with usage data
  next();
});
