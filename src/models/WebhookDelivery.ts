import mongoose, { Document, Schema } from 'mongoose';

export interface IWebhookDelivery extends Document {
    webhookId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    eventId: string; // Unique event identifier for idempotency
    eventType: string;
    eventData: any;
    
    // Delivery details
    attempt: number;
    status: 'pending' | 'success' | 'failed' | 'timeout' | 'cancelled';
    
    // Request details
    request: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body: string;
        timestamp: Date;
    };
    
    // Response details
    response?: {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
        responseTime: number; // milliseconds
        timestamp: Date;
    };
    
    // Error details
    error?: {
        type: string;
        message: string;
        code?: string;
        details?: any;
    };
    
    // Retry information
    nextRetryAt?: Date;
    retriesLeft: number;
    
    // HMAC signature used
    signature?: string;
    
    // Metadata
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

const WebhookDeliverySchema = new Schema<IWebhookDelivery>({
    webhookId: {
        type: Schema.Types.ObjectId,
        ref: 'Webhook',
        required: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    eventId: {
        type: String,
        required: true,
        index: true
    },
    eventType: {
        type: String,
        required: true,
        index: true
    },
    eventData: {
        type: Schema.Types.Mixed,
        required: true
    },
    
    attempt: {
        type: Number,
        default: 1,
        min: 1
    },
    status: {
        type: String,
        enum: ['pending', 'success', 'failed', 'timeout', 'cancelled'],
        default: 'pending',
        index: true
    },
    
    request: {
        url: {
            type: String,
            required: true
        },
        method: {
            type: String,
            default: 'POST'
        },
        headers: {
            type: Map,
            of: String
        },
        body: {
            type: String,
            required: true
        },
        timestamp: {
            type: Date,
            required: true
        }
    },
    
    response: {
        statusCode: Number,
        headers: {
            type: Map,
            of: String
        },
        body: String,
        responseTime: Number,
        timestamp: Date
    },
    
    error: {
        type: {
            type: String
        },
        message: String,
        code: String,
        details: Schema.Types.Mixed
    },
    
    nextRetryAt: {
        type: Date,
        index: true
    },
    retriesLeft: {
        type: Number,
        default: 0
    },
    
    signature: String,
    
    metadata: {
        type: Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
WebhookDeliverySchema.index({ webhookId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ userId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ status: 1, nextRetryAt: 1 }); // For retry processing
WebhookDeliverySchema.index({ webhookId: 1, eventId: 1 }); // For idempotency checks

// TTL index to automatically remove old delivery records after 30 days
WebhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookDelivery = mongoose.model<IWebhookDelivery>('WebhookDelivery', WebhookDeliverySchema);
