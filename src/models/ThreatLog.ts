import mongoose, { Document, Schema, model, ObjectId } from 'mongoose';

export interface IThreatLog extends Document {
    _id: ObjectId;
    requestId: string;
    userId?: ObjectId;
    threatCategory: string;
    confidence: number;
    stage: 'prompt-guard' | 'llama-guard';
    reason: string;
    details: any;
    costSaved: number;
    timestamp: Date;
    promptHash?: string; // SHA-256 hash of the blocked prompt for analysis
    ipAddress?: string;
    userAgent?: string;
}

const threatLogSchema = new Schema<IThreatLog>({
    requestId: {
        type: String,
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    threatCategory: {
        type: String,
        required: true,
        enum: [
            'prompt_injection',
            'jailbreak_attempt',
            'violence_and_hate',
            'sexual_content',
            'criminal_planning',
            'guns_and_illegal_weapons',
            'regulated_substances',
            'self_harm',
            'jailbreaking',
            'data_exfiltration',
            'phishing_and_social_engineering',
            'spam_and_unwanted_content',
            'misinformation',
            'privacy_violations',
            'intellectual_property_violations',
            'harassment_and_bullying',
            'harmful_content',
            'unknown'
        ]
    },
    confidence: {
        type: Number,
        required: true,
        min: 0,
        max: 1
    },
    stage: {
        type: String,
        required: true,
        enum: ['prompt-guard', 'llama-guard']
    },
    reason: {
        type: String,
        required: true,
        maxlength: 1000
    },
    details: {
        type: Schema.Types.Mixed,
        default: {}
    },
    costSaved: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    promptHash: {
        type: String,
        sparse: true
    },
    ipAddress: {
        type: String,
        maxlength: 45 // IPv6 max length
    },
    userAgent: {
        type: String,
        maxlength: 500
    }
}, {
    timestamps: true
});

// 1. Primary queries by user and time
threatLogSchema.index({ userId: 1, timestamp: -1 });

// 2. Time-based queries
threatLogSchema.index({ timestamp: -1 });

// 3. Threat category analysis
threatLogSchema.index({ threatCategory: 1, timestamp: -1 });

// 4. TTL index to automatically delete old logs after 1 year
threatLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export const ThreatLog = model<IThreatLog>('ThreatLog', threatLogSchema);