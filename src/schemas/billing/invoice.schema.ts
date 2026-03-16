import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IInvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  type:
    | 'plan'
    | 'overage'
    | 'discount'
    | 'proration'
    | 'tax'
    | 'seat'
    | 'other';
  metadata?: Record<string, any>;
}

export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ timestamps: true })
export class Invoice {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
  })
  subscriptionId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, unique: true })
  invoiceNumber: string;

  @Prop({
    type: String,
    enum: ['paid', 'pending', 'failed', 'refunded', 'voided'],
    required: true,
    default: 'pending',
  })
  status: 'paid' | 'pending' | 'failed' | 'refunded' | 'voided';

  @Prop({ required: true })
  subtotal: number;

  @Prop({ default: 0 })
  tax: number;

  @Prop({ default: 0 })
  discount: number;

  @Prop({ required: true })
  total: number;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop()
  description?: string;

  @Prop({
    type: [
      {
        description: { type: String, required: true },
        quantity: { type: Number, required: true, default: 1 },
        unitPrice: { type: Number, required: true },
        total: { type: Number, required: true },
        type: {
          type: String,
          enum: [
            'plan',
            'overage',
            'discount',
            'proration',
            'tax',
            'seat',
            'other',
          ],
          required: true,
        },
        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],
    _id: false,
  })
  lineItems: IInvoiceLineItem[];

  @Prop()
  paymentDate?: Date;

  @Prop({ required: true })
  dueDate: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PaymentMethod' })
  paymentMethodId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['stripe', 'razorpay', 'paypal', null],
    default: null,
  })
  paymentGateway: 'stripe' | 'razorpay' | 'paypal' | null;

  @Prop()
  gatewayTransactionId?: string;

  @Prop({ required: true })
  periodStart: Date;

  @Prop({ required: true })
  periodEnd: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata?: Record<string, any>;

  @Prop()
  failureReason?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

// Indexes
InvoiceSchema.index({ userId: 1, createdAt: -1 });
InvoiceSchema.index({ subscriptionId: 1 });
InvoiceSchema.index({ status: 1 });
InvoiceSchema.index({ gatewayTransactionId: 1 });
InvoiceSchema.index({ dueDate: 1 });

// Generate invoice number before saving
InvoiceSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const count = await mongoose.model('Invoice').countDocuments();
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const sequence = String(count + 1).padStart(6, '0');
    this.invoiceNumber = `INV-${year}${month}-${sequence}`;
  }
  next();
});
