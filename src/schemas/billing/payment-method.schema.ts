import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface ICardDetails {
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  maskedNumber: string;
}

export interface IUpiDetails {
  upiId: string;
  vpa: string;
}

export interface IBankAccountDetails {
  maskedAccountNumber: string;
  ifsc?: string;
  bankName?: string;
}

export interface IPayPalAccount {
  email: string;
}

export type PaymentMethodDocument = HydratedDocument<PaymentMethod>;

@Schema({ timestamps: true })
export class PaymentMethod {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['stripe', 'razorpay', 'paypal'],
    required: true,
    index: true,
  })
  gateway: 'stripe' | 'razorpay' | 'paypal';

  @Prop({ required: true })
  gatewayCustomerId: string;

  @Prop({ required: true, unique: true })
  gatewayPaymentMethodId: string;

  @Prop({
    type: String,
    enum: ['card', 'upi', 'bank_account', 'wallet', 'paypal_account'],
    required: true,
  })
  type: 'card' | 'upi' | 'bank_account' | 'wallet' | 'paypal_account';

  @Prop({
    type: {
      last4: String,
      brand: String,
      expiryMonth: Number,
      expiryYear: Number,
      maskedNumber: String,
    },
  })
  card?: ICardDetails;

  @Prop({
    type: {
      upiId: String,
      vpa: String,
    },
  })
  upi?: IUpiDetails;

  @Prop({
    type: {
      maskedAccountNumber: String,
      ifsc: String,
      bankName: String,
    },
  })
  bankAccount?: IBankAccountDetails;

  @Prop({
    type: {
      email: String,
    },
  })
  paypalAccount?: IPayPalAccount;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  setupForRecurring: boolean;

  @Prop({
    type: String,
    enum: ['active', 'failed', 'expired', 'cancelled'],
    default: 'active',
  })
  recurringStatus: 'active' | 'failed' | 'expired' | 'cancelled';

  @Prop()
  expiryDate?: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  gatewayMetadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const PaymentMethodSchema = SchemaFactory.createForClass(PaymentMethod);

PaymentMethodSchema.index({ userId: 1, isDefault: 1 });
PaymentMethodSchema.index({ userId: 1, isActive: 1 });
PaymentMethodSchema.index({ gatewayCustomerId: 1 });
PaymentMethodSchema.index({ recurringStatus: 1 });

// Ensure only one default payment method per user
PaymentMethodSchema.pre('save', async function (next) {
  if (this.isDefault && this.isModified('isDefault')) {
    await mongoose
      .model('PaymentMethod')
      .updateMany(
        { userId: this.userId, _id: { $ne: this._id } },
        { $set: { isDefault: false } },
      );
  }
  next();
});
