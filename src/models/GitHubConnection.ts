import { Schema, model, Document, Types } from 'mongoose';
import crypto from 'crypto';

// Interface for repository data
export interface IGitHubRepository {
    id: number;
    name: string;
    fullName: string;
    private: boolean;
    defaultBranch: string;
    description?: string;
    language?: string;
    url: string;
    createdAt?: Date;
    updatedAt?: Date;
}

// Main GitHub connection interface
export interface IGitHubConnection extends Document {
    _id: Types.ObjectId;
    userId: string;
    installationId?: string; // GitHub App installation ID
    accessToken: string; // Encrypted token
    refreshToken?: string; // Encrypted refresh token (for OAuth)
    tokenType: 'oauth' | 'app'; // OAuth token or GitHub App token
    scope?: string; // OAuth scopes granted
    repositories: IGitHubRepository[];
    githubUserId?: number; // GitHub user ID
    githubUsername?: string; // GitHub username
    avatarUrl?: string;
    isActive: boolean;
    lastSyncedAt?: Date;
    expiresAt?: Date; // Token expiration
    createdAt: Date;
    updatedAt: Date;
    encryptToken(token: string): string;
    decryptToken(): string;
    decryptRefreshToken?(): string;
}

const repositorySchema = new Schema<IGitHubRepository>({
    id: {
        type: Number,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    fullName: {
        type: String,
        required: true
    },
    private: {
        type: Boolean,
        default: false
    },
    defaultBranch: {
        type: String,
        default: 'main'
    },
    description: {
        type: String
    },
    language: {
        type: String
    },
    url: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date
    },
    updatedAt: {
        type: Date
    }
}, { _id: false });

const githubConnectionSchema = new Schema<IGitHubConnection>({
    userId: {
        type: String,
        required: true,
        index: true
    },
    installationId: {
        type: String
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
        enum: ['oauth', 'app'],
        default: 'oauth'
    },
    scope: {
        type: String
    },
    repositories: {
        type: [repositorySchema],
        default: []
    },
    githubUserId: {
        type: Number
    },
    githubUsername: {
        type: String
    },
    avatarUrl: {
        type: String
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
    collection: 'github_connections'
});

// Indexes for performance
githubConnectionSchema.index({ userId: 1, isActive: 1 });
githubConnectionSchema.index({ githubUsername: 1 });
githubConnectionSchema.index({ installationId: 1 }, { sparse: true });

// Method to encrypt access token
githubConnectionSchema.methods.encryptToken = function(token: string): string {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-encryption-key-change-this-in-production', 'utf8').slice(0, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
};

// Method to decrypt access token
githubConnectionSchema.methods.decryptToken = function(): string {
    if (!this.accessToken) {
        throw new Error('Access token is not available');
    }
    
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-encryption-key-change-this-in-production', 'utf8').slice(0, 32);
    
    const parts = this.accessToken.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid access token format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
};

// Method to decrypt refresh token
githubConnectionSchema.methods.decryptRefreshToken = function(): string | undefined {
    if (!this.refreshToken) {
        return undefined;
    }
    
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-encryption-key-change-this-in-production', 'utf8').slice(0, 32);
    
    const parts = this.refreshToken.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid refresh token format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
};

// Pre-save hook to encrypt token if modified
githubConnectionSchema.pre('save', function(next) {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-encryption-key-change-this-in-production', 'utf8').slice(0, 32);
    
    // Encrypt access token if modified and not already encrypted
    if (this.isModified('accessToken') && !this.accessToken.includes(':')) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        let encrypted = cipher.update(this.accessToken, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        this.accessToken = iv.toString('hex') + ':' + encrypted;
    }
    
    // Encrypt refresh token if modified and not already encrypted
    if (this.refreshToken && this.isModified('refreshToken') && !this.refreshToken.includes(':')) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        let encrypted = cipher.update(this.refreshToken, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        this.refreshToken = iv.toString('hex') + ':' + encrypted;
    }
    
    next();
});

export const GitHubConnection = model<IGitHubConnection>('GitHubConnection', githubConnectionSchema);



