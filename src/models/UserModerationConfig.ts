/**
 * User Moderation Configuration Model
 *
 * Stores user's content moderation and safety preferences.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IUserModerationConfig extends Document {
    userId: string;

    // Content filtering
    enableContentFiltering: boolean;
    contentFilterLevel: 'permissive' | 'moderate' | 'strict';

    // Safety settings
    blockUnsafeContent: boolean;
    allowAdultContent: boolean;
    blockHateSpeech: boolean;
    blockViolence: boolean;
    blockHarassment: boolean;

    // Custom filters
    customBlockedWords: string[];
    customBlockedPatterns: string[];
    allowedDomains: string[];
    blockedDomains: string[];

    // PII detection
    enablePIIDetection: boolean;
    piiDetectionLevel: 'basic' | 'comprehensive';
    maskSensitiveData: boolean;

    // Response filtering
    filterModelResponses: boolean;
    responseSafetyLevel: 'low' | 'medium' | 'high';

    // Notification settings
    notifyOnBlockedContent: boolean;
    notifyOnSafetyViolations: boolean;

    // Compliance
    complianceFrameworks: ('gdpr' | 'ccpa' | 'hipaa' | 'coppa')[];
    dataRetentionDays: number;

    // Custom rules
    customModerationRules: {
        ruleName: string;
        condition: string;
        action: 'block' | 'warn' | 'log' | 'allow';
        severity: 'low' | 'medium' | 'high' | 'critical';
        enabled: boolean;
    }[];

    // Status
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastModerationEventAt?: Date;
}

const UserModerationConfigSchema = new Schema<IUserModerationConfig>({
    userId: {
        type: String,
        required: true,
        index: true,
        unique: true
    },

    // Content filtering
    enableContentFiltering: {
        type: Boolean,
        default: true
    },

    contentFilterLevel: {
        type: String,
        enum: ['permissive', 'moderate', 'strict'],
        default: 'moderate'
    },

    // Safety settings
    blockUnsafeContent: {
        type: Boolean,
        default: true
    },

    allowAdultContent: {
        type: Boolean,
        default: false
    },

    blockHateSpeech: {
        type: Boolean,
        default: true
    },

    blockViolence: {
        type: Boolean,
        default: true
    },

    blockHarassment: {
        type: Boolean,
        default: true
    },

    // Custom filters
    customBlockedWords: [{
        type: String,
        trim: true,
        lowercase: true
    }],

    customBlockedPatterns: [{
        type: String // Regex patterns
    }],

    allowedDomains: [{
        type: String,
        trim: true,
        lowercase: true
    }],

    blockedDomains: [{
        type: String,
        trim: true,
        lowercase: true
    }],

    // PII detection
    enablePIIDetection: {
        type: Boolean,
        default: true
    },

    piiDetectionLevel: {
        type: String,
        enum: ['basic', 'comprehensive'],
        default: 'comprehensive'
    },

    maskSensitiveData: {
        type: Boolean,
        default: true
    },

    // Response filtering
    filterModelResponses: {
        type: Boolean,
        default: true
    },

    responseSafetyLevel: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },

    // Notification settings
    notifyOnBlockedContent: {
        type: Boolean,
        default: true
    },

    notifyOnSafetyViolations: {
        type: Boolean,
        default: true
    },

    // Compliance
    complianceFrameworks: [{
        type: String,
        enum: ['gdpr', 'ccpa', 'hipaa', 'coppa']
    }],

    dataRetentionDays: {
        type: Number,
        default: 2555, // 7 years for GDPR compliance
        min: 30,
        max: 2555
    },

    // Custom rules
    customModerationRules: [{
        ruleName: { type: String, required: true },
        condition: { type: String, required: true },
        action: {
            type: String,
            enum: ['block', 'warn', 'log', 'allow'],
            default: 'block'
        },
        severity: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'medium'
        },
        enabled: { type: Boolean, default: true }
    }],

    // Status
    isActive: {
        type: Boolean,
        default: true
    },

    lastModerationEventAt: Date
}, {
    timestamps: true,
    collection: 'user_moderation_configs'
});

// Indexes
UserModerationConfigSchema.index({ userId: 1 });
UserModerationConfigSchema.index({ isActive: 1 });
UserModerationConfigSchema.index({ 'complianceFrameworks': 1 });

export const UserModerationConfig = mongoose.model<IUserModerationConfig>('UserModerationConfig', UserModerationConfigSchema);