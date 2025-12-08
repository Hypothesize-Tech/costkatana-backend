import mongoose, { Schema, Document, Types } from 'mongoose';
import { encryptData, decryptData } from '../utils/encryption';

export interface IGoogleDriveFile {
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
    iconLink?: string;
    createdTime?: Date;
    modifiedTime?: Date;
    size?: number;
    parents?: string[];
}

export interface IGoogleConnection extends Document {
    _id: Types.ObjectId;
    userId: string;
    accessToken: string; // Encrypted token
    refreshToken?: string; // Encrypted refresh token
    tokenType: 'oauth';
    scope?: string; // Granted OAuth scopes
    driveFiles: IGoogleDriveFile[];
    googleUserId?: string; // Google user ID
    googleEmail: string; // Google email
    googleName?: string; // Google display name
    googleAvatar?: string; // Google profile picture URL
    googleDomain?: string; // Google Workspace domain (e.g., company.com)
    isActive: boolean;
    healthStatus: 'healthy' | 'needs_reconnect' | 'error';
    lastSyncedAt?: Date;
    expiresAt?: Date; // Token expiration
    createdAt: Date;
    updatedAt: Date;
    encryptToken(token: string): string;
    decryptToken(): string;
    decryptRefreshToken?(): string;
}

const driveFileSchema = new Schema<IGoogleDriveFile>({
    id: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    mimeType: {
        type: String,
        required: true
    },
    webViewLink: String,
    iconLink: String,
    createdTime: Date,
    modifiedTime: Date,
    size: Number,
    parents: [String]
}, { _id: false });

const googleConnectionSchema = new Schema<IGoogleConnection>({
    userId: {
        type: String,
        required: true,
        index: true
    },
    accessToken: {
        type: String,
        required: true,
        select: false // Don't return by default for security
    },
    refreshToken: {
        type: String,
        select: false // Don't return by default for security
    },
    tokenType: {
        type: String,
        enum: ['oauth'],
        default: 'oauth'
    },
    scope: {
        type: String
    },
    driveFiles: {
        type: [driveFileSchema],
        default: []
    },
    googleUserId: {
        type: String
    },
    googleEmail: {
        type: String,
        required: true
    },
    googleName: {
        type: String
    },
    googleAvatar: {
        type: String
    },
    googleDomain: {
        type: String
    },
    isActive: {
        type: Boolean,
        default: true
    },
    healthStatus: {
        type: String,
        enum: ['healthy', 'needs_reconnect', 'error'],
        default: 'healthy'
    },
    lastSyncedAt: {
        type: Date
    },
    expiresAt: {
        type: Date
    }
}, {
    timestamps: true,
    collection: 'google_connections'
});

// Indexes for performance
googleConnectionSchema.index({ userId: 1, isActive: 1 });
googleConnectionSchema.index({ googleEmail: 1 });
googleConnectionSchema.index({ googleDomain: 1 });
googleConnectionSchema.index({ healthStatus: 1 });

// Instance methods for token encryption/decryption
googleConnectionSchema.methods.encryptToken = function(token: string): string {
    return encryptData(token);
};

googleConnectionSchema.methods.decryptToken = function(): string {
    return decryptData(this.accessToken);
};

googleConnectionSchema.methods.decryptRefreshToken = function(): string | undefined {
    if (!this.refreshToken) return undefined;
    return decryptData(this.refreshToken);
};

// Pre-save hook to encrypt tokens
googleConnectionSchema.pre('save', function(next) {
    if (this.isModified('accessToken') && this.accessToken && !this.accessToken.includes(':')) {
        this.accessToken = encryptData(this.accessToken);
    }
    if (this.isModified('refreshToken') && this.refreshToken && !this.refreshToken.includes(':')) {
        this.refreshToken = encryptData(this.refreshToken);
    }
    next();
});

export const GoogleConnection = mongoose.model<IGoogleConnection>('GoogleConnection', googleConnectionSchema);

