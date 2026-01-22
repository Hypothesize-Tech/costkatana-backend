import { Schema, model, Document, Types } from 'mongoose';
import { EncryptionService } from '../utils/encryption';

// Interface for Vercel project data
export interface IVercelProject {
    id: string;
    name: string;
    framework?: string;
    latestDeployment?: {
        id: string;
        url: string;
        state: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
        createdAt: Date;
    };
    targets?: {
        production?: {
            url: string;
        };
    };
    createdAt?: Date;
    updatedAt?: Date;
}

// Interface for Vercel team data
export interface IVercelTeam {
    id: string;
    slug: string;
    name: string;
    avatar?: string;
}

// Main Vercel connection interface
export interface IVercelConnection extends Document {
    _id: Types.ObjectId;
    userId: string;
    accessToken: string; // Encrypted OAuth token
    refreshToken?: string; // Encrypted refresh token (for future-proofing)
    tokenType: string; // Usually 'Bearer'
    scope?: string; // OAuth scopes granted
    vercelUserId: string; // Vercel user ID
    vercelUsername: string; // Vercel username
    vercelEmail?: string; // Vercel email
    avatarUrl?: string;
    teamId?: string; // Vercel team ID (if connected to a team)
    teamSlug?: string; // Team slug for display
    team?: IVercelTeam; // Full team data
    projects: IVercelProject[]; // Cached list of projects
    isActive: boolean;
    lastSyncedAt?: Date;
    expiresAt?: Date; // Token expiration (Vercel tokens don't expire but we store for future-proofing)
    createdAt: Date;
    updatedAt: Date;
    encryptToken(token: string): string;
    decryptToken(): string;
    decryptRefreshToken?(): string;
}

const projectSchema = new Schema<IVercelProject>({
    id: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    framework: {
        type: String
    },
    latestDeployment: {
        id: String,
        url: String,
        state: {
            type: String,
            enum: ['BUILDING', 'ERROR', 'INITIALIZING', 'QUEUED', 'READY', 'CANCELED']
        },
        createdAt: Date
    },
    targets: {
        production: {
            url: String
        }
    },
    createdAt: {
        type: Date
    },
    updatedAt: {
        type: Date
    }
}, { _id: false });

const teamSchema = new Schema<IVercelTeam>({
    id: {
        type: String,
        required: true
    },
    slug: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    avatar: {
        type: String
    }
}, { _id: false });

const vercelConnectionSchema = new Schema<IVercelConnection>({
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
        default: 'Bearer'
    },
    scope: {
        type: String
    },
    vercelUserId: {
        type: String,
        required: true
    },
    vercelUsername: {
        type: String,
        required: true
    },
    vercelEmail: {
        type: String
    },
    avatarUrl: {
        type: String
    },
    teamId: {
        type: String
    },
    teamSlug: {
        type: String
    },
    team: {
        type: teamSchema
    },
    projects: {
        type: [projectSchema],
        default: []
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastSyncedAt: {
        type: Date
    },
    expiresAt: {
        type: Date
    }
}, {
    timestamps: true,
    collection: 'vercel_connections'
});

// Indexes for performance
vercelConnectionSchema.index({ userId: 1, isActive: 1 });
vercelConnectionSchema.index({ vercelUsername: 1 });
vercelConnectionSchema.index({ vercelUserId: 1 });
vercelConnectionSchema.index({ teamId: 1 }, { sparse: true });

// Method to encrypt access token
vercelConnectionSchema.methods.encryptToken = function(token: string): string {
    const { encrypted, iv } = EncryptionService.encryptCBC(token);
    return `${iv}:${encrypted}`;
};

// Method to decrypt access token
vercelConnectionSchema.methods.decryptToken = function(this: IVercelConnection): string {
    if (!this.accessToken) {
        throw new Error('Access token is not available');
    }
    
    const parts: string[] = this.accessToken.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid access token format');
    }
    
    const [iv, encrypted] = parts;
    return EncryptionService.decryptCBC(encrypted, iv);
};

// Method to decrypt refresh token
vercelConnectionSchema.methods.decryptRefreshToken = function(this: IVercelConnection): string | undefined {
    if (!this.refreshToken) {
        return undefined;
    }
    
    const parts: string[] = this.refreshToken.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid refresh token format');
    }
    
    const [iv, encrypted] = parts;
    return EncryptionService.decryptCBC(encrypted, iv);
};

// Pre-save hook to encrypt token if modified
vercelConnectionSchema.pre('save', function(next) {
    // Encrypt access token if modified and not already encrypted
    if (this.isModified('accessToken') && !this.accessToken.includes(':')) {
        const { encrypted, iv } = EncryptionService.encryptCBC(this.accessToken);
        this.accessToken = `${iv}:${encrypted}`;
    }
    
    // Encrypt refresh token if modified and not already encrypted
    if (this.refreshToken && this.isModified('refreshToken') && !this.refreshToken.includes(':')) {
        const { encrypted, iv } = EncryptionService.encryptCBC(this.refreshToken);
        this.refreshToken = `${iv}:${encrypted}`;
    }
    
    next();
});

export const VercelConnection = model<IVercelConnection>('VercelConnection', vercelConnectionSchema);
