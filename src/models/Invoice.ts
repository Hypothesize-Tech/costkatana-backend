import mongoose, { Schema, Document, ObjectId } from 'mongoose';

export interface IInvoiceLineItem {
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    type: 'plan' | 'overage' | 'discount' | 'proration' | 'tax' | 'seat' | 'other';
    metadata?: Record<string, any>;
}

export interface IInvoice extends Document {
    subscriptionId: ObjectId;
    userId: ObjectId;
    invoiceNumber: string;
    status: 'paid' | 'pending' | 'failed' | 'refunded' | 'voided';
    
    // Amounts
    subtotal: number;
    tax: number;
    discount: number;
    total: number;
    currency: string;
    
    // Line items
    lineItems: IInvoiceLineItem[];
    
    // Payment information
    paymentDate?: Date;
    dueDate: Date;
    paymentMethodId?: ObjectId;
    paymentGateway: 'stripe' | 'razorpay' | 'paypal' | null;
    gatewayTransactionId?: string; // Stripe charge ID, Razorpay payment ID, PayPal transaction ID
    
    // Period
    periodStart: Date;
    periodEnd: Date;
    
    // Metadata
    metadata?: Record<string, any>;
    
    createdAt: Date;
    updatedAt: Date;
}

const invoiceLineItemSchema = new Schema<IInvoiceLineItem>({
    description: {
        type: String,
        required: true,
    },
    quantity: {
        type: Number,
        required: true,
        default: 1,
    },
    unitPrice: {
        type: Number,
        required: true,
    },
    total: {
        type: Number,
        required: true,
    },
    type: {
        type: String,
        enum: ['plan', 'overage', 'discount', 'proration', 'tax', 'seat', 'other'],
        required: true,
    },
    metadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
}, { _id: false });

const invoiceSchema = new Schema<IInvoice>({
    subscriptionId: {
        type: Schema.Types.ObjectId,
        ref: 'Subscription',
        required: true,
        index: true,
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    invoiceNumber: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['paid', 'pending', 'failed', 'refunded', 'voided'],
        required: true,
        default: 'pending',
        index: true,
    },
    subtotal: {
        type: Number,
        required: true,
    },
    tax: {
        type: Number,
        default: 0,
    },
    discount: {
        type: Number,
        default: 0,
    },
    total: {
        type: Number,
        required: true,
    },
    currency: {
        type: String,
        required: true,
        default: 'USD',
    },
    lineItems: [invoiceLineItemSchema],
    paymentDate: Date,
    dueDate: {
        type: Date,
        required: true,
    },
    paymentMethodId: {
        type: Schema.Types.ObjectId,
        ref: 'PaymentMethod',
    },
    paymentGateway: {
        type: String,
        enum: ['stripe', 'razorpay', 'paypal', null],
        default: null,
    },
    gatewayTransactionId: String,
    periodStart: {
        type: Date,
        required: true,
    },
    periodEnd: {
        type: Date,
        required: true,
    },
    metadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
});

// Indexes
invoiceSchema.index({ userId: 1, createdAt: -1 });
invoiceSchema.index({ subscriptionId: 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ invoiceNumber: 1 });
invoiceSchema.index({ gatewayTransactionId: 1 });
invoiceSchema.index({ dueDate: 1 });

// Generate invoice number before saving
invoiceSchema.pre('save', async function(next) {
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

export const Invoice = mongoose.model<IInvoice>('Invoice', invoiceSchema);

