import mongoose, { Schema, Document } from 'mongoose';

export interface IUserSession extends Document {
    userSessionId: string;
    userId: string;
    deviceName: string;
    userAgent: string;
    ipAddress: string;
    location: {
        city?: string;
        country?: string;
    };
    browser?: string;
    os?: string;
    createdAt: Date;
    lastActiveAt: Date;
    expiresAt: Date;
    isActive: boolean;
    refreshTokenHash: string; // Hash of refresh token for revocation
    revokeToken?: string; // Token for email-based revocation
    updatedAt: Date;
}

const UserSessionSchema = new Schema<IUserSession>({
    userSessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    deviceName: {
        type: String,
        required: true
    },
    userAgent: {
        type: String,
        required: true
    },
    ipAddress: {
        type: String,
        required: true,
        index: true
    },
    location: {
        city: String,
        country: String
    },
    browser: {
        type: String
    },
    os: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now,
        required: true
    },
    lastActiveAt: {
        type: Date,
        default: Date.now,
        required: true,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    refreshTokenHash: {
        type: String,
        required: true,
    },
    revokeToken: {
        type: String,
    }
}, {
    timestamps: true,
    collection: 'user_sessions'
});

// Compound indexes for common queries
UserSessionSchema.index({ userId: 1, isActive: 1 });
UserSessionSchema.index({ userId: 1, expiresAt: 1 });
UserSessionSchema.index({ refreshTokenHash: 1 });
UserSessionSchema.index({ revokeToken: 1 }, { sparse: true });

// TTL index for automatic cleanup of expired sessions (30 days)
UserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UserSession = mongoose.model<IUserSession>('UserSession', UserSessionSchema);

