import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type DiscountDocument = HydratedDocument<Discount>;

@Schema({ timestamps: true })
export class Discount {
  @Prop({
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true,
  })
  code: string;

  @Prop({
    type: String,
    enum: ['percentage', 'fixed'],
    required: true,
  })
  type: 'percentage' | 'fixed';

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, default: Date.now })
  validFrom: Date;

  @Prop({ required: true })
  validUntil: Date;

  @Prop({ required: true, default: -1 }) // -1 means unlimited
  maxUses: number;

  @Prop({ default: 0, min: 0 })
  currentUses: number;

  @Prop([
    {
      type: String,
      enum: ['free', 'plus', 'pro', 'enterprise'],
    },
  ])
  applicablePlans: ('free' | 'plus' | 'pro' | 'enterprise')[];

  @Prop({ min: 0 })
  minAmount?: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId?: MongooseSchema.Types.ObjectId;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop()
  description?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DiscountSchema = SchemaFactory.createForClass(Discount);

// Indexes
DiscountSchema.index({ code: 1, isActive: 1 });
DiscountSchema.index({ validUntil: 1 });
DiscountSchema.index({ userId: 1 });

// Validation: For percentage type, amount should be between 0 and 100
DiscountSchema.pre('save', function (next) {
  if (this.type === 'percentage' && (this.amount < 0 || this.amount > 100)) {
    next(new Error('Percentage discount must be between 0 and 100'));
  } else {
    next();
  }
});
