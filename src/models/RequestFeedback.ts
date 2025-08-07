import mongoose, { Document, Schema } from 'mongoose';

export interface IRequestFeedback extends Document {
    requestId: string; // CostKatana-Request-Id
    userId: string;
    rating: boolean; // true = positive, false = negative
    comment?: string;
    
    // Request details for analytics
    modelName?: string; // Changed from 'model' to avoid conflict with Document.model
    provider?: string;
    cost?: number;
    tokens?: number;
    
    // Implicit feedback signals
    implicitSignals?: {
        copied?: boolean;
        conversationContinued?: boolean;
        immediateRephrase?: boolean;
        sessionDuration?: number; // in milliseconds
        codeAccepted?: boolean;
    };
    
    // Metadata
    userAgent?: string;
    ipAddress?: string;
    feature?: string; // e.g., 'support-bot', 'code-assistant'
    
    createdAt: Date;
    updatedAt: Date;
}

const requestFeedbackSchema = new Schema<IRequestFeedback>({
    requestId: {
        type: String,
        required: true,
        unique: true
    },
    userId: {
        type: String,
        required: true
    },
    rating: {
        type: Boolean,
        required: true
    },
    comment: {
        type: String,
        maxlength: 1000
    },
    
    // Request details
    modelName: String,
    provider: String,
    cost: Number,
    tokens: Number,
    
    // Implicit signals
    implicitSignals: {
        copied: Boolean,
        conversationContinued: Boolean,
        immediateRephrase: Boolean,
        sessionDuration: Number,
        codeAccepted: Boolean
    },
    
    // Metadata
    userAgent: String,
    ipAddress: String,
    feature: String
}, {
    timestamps: true
});

// 1. Primary user queries
requestFeedbackSchema.index({ userId: 1, createdAt: -1 });

// 2. Rating analysis
requestFeedbackSchema.index({ rating: 1, createdAt: -1 });

// 3. Provider analysis
requestFeedbackSchema.index({ provider: 1, rating: 1 });

export const RequestFeedback = mongoose.model<IRequestFeedback>('RequestFeedback', requestFeedbackSchema);