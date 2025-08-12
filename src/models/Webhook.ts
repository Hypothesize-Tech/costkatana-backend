import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';

export interface IWebhook extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    description?: string;
    url: string;
    active: boolean;
    version: string;
    
    // Authentication
    auth?: {
        type: 'none' | 'basic' | 'bearer' | 'custom_header' | 'oauth2';
        credentials?: {
            username?: string;
            password?: string; // Encrypted
            token?: string; // Encrypted
            headerName?: string;
            headerValue?: string; // Encrypted
            oauth2?: {
                clientId?: string;
                clientSecret?: string; // Encrypted
                tokenUrl?: string;
                scope?: string;
            };
        };
    };
    
    // Event filtering
    events: string[]; // ['cost.alert', 'optimization.completed', 'model.performance.degraded', etc.]
    filters?: {
        severity?: string[];
        tags?: string[];
        projects?: mongoose.Types.ObjectId[];
        models?: string[];
        minCost?: number;
        customQuery?: Record<string, any>;
    };
    
    // Headers and payload
    headers?: Record<string, string>;
    payloadTemplate?: string; // JSON template with placeholders
    useDefaultPayload: boolean;
    
    // Security
    secret: string; // For HMAC signing
    maskedSecret: string; // For display (last 4 chars)
    
    // Delivery settings
    timeout: number; // milliseconds
    retryConfig: {
        maxRetries: number;
        backoffMultiplier: number;
        initialDelay: number; // milliseconds
    } | undefined;
    
    // Statistics
    stats: {
        totalDeliveries: number;
        successfulDeliveries: number;
        failedDeliveries: number;
        lastDeliveryAt?: Date;
        lastSuccessAt?: Date;
        lastFailureAt?: Date;
        averageResponseTime?: number; // milliseconds
    };
    
    // Metadata
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

const WebhookSchema = new Schema<IWebhook>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    url: {
        type: String,
        required: true,
        validate: {
            validator: function(v: string) {
                try {
                    new URL(v);
                    return true;
                } catch {
                    return false;
                }
            },
            message: 'Invalid URL format'
        }
    },
    active: {
        type: Boolean,
        default: true,
        index: true
    },
    version: {
        type: String,
        default: '1.0.0'
    },
    
    auth: {
        type: {
            type: String,
            enum: ['none', 'basic', 'bearer', 'custom_header', 'oauth2'],
            default: 'none'
        },
        credentials: {
            username: String,
            password: String, // Encrypted
            token: String, // Encrypted
            headerName: String,
            headerValue: String, // Encrypted
            oauth2: {
                clientId: String,
                clientSecret: String, // Encrypted
                tokenUrl: String,
                scope: String
            }
        }
    },
    
    events: {
        type: [String],
        required: true,
        validate: {
            validator: function(v: string[]) {
                return v && v.length > 0;
            },
            message: 'At least one event must be selected'
        }
    },
    
    filters: {
        severity: [String],
        tags: [String],
        projects: [{
            type: Schema.Types.ObjectId,
            ref: 'Project'
        }],
        models: [String],
        minCost: Number,
        customQuery: Schema.Types.Mixed
    },
    
    headers: {
        type: Map,
        of: String
    },
    
    payloadTemplate: {
        type: String,
        validate: {
            validator: function(v: string) {
                if (!v) return true;
                try {
                    // Basic JSON validation
                    JSON.parse(v.replace(/\{\{[^}]+\}\}/g, '"placeholder"'));
                    return true;
                } catch {
                    return false;
                }
            },
            message: 'Invalid JSON template'
        }
    },
    
    useDefaultPayload: {
        type: Boolean,
        default: true
    },
    
    secret: {
        type: String,
        required: true,
        default: function() {
            return crypto.randomBytes(32).toString('hex');
        }
    },
    
    maskedSecret: {
        type: String
    },
    
    timeout: {
        type: Number,
        default: 30000, // 30 seconds
        min: 5000,
        max: 120000
    },
    
    retryConfig: {
        maxRetries: {
            type: Number,
            default: 3,
            min: 0,
            max: 10
        },
        backoffMultiplier: {
            type: Number,
            default: 2,
            min: 1,
            max: 5
        },
        initialDelay: {
            type: Number,
            default: 5000, // 5 seconds
            min: 1000,
            max: 60000
        }
    },
    
    stats: {
        totalDeliveries: {
            type: Number,
            default: 0
        },
        successfulDeliveries: {
            type: Number,
            default: 0
        },
        failedDeliveries: {
            type: Number,
            default: 0
        },
        lastDeliveryAt: Date,
        lastSuccessAt: Date,
        lastFailureAt: Date,
        averageResponseTime: Number
    },
    
    metadata: {
        type: Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
WebhookSchema.index({ userId: 1, active: 1 });
WebhookSchema.index({ userId: 1, 'events': 1 });
WebhookSchema.index({ 'stats.lastDeliveryAt': -1 });

// Pre-save hook to mask secret
WebhookSchema.pre('save', function(next) {
    if (this.isModified('secret')) {
        this.maskedSecret = '****' + this.secret.slice(-4);
    }
    next();
});

export const Webhook = mongoose.model<IWebhook>('Webhook', WebhookSchema);
