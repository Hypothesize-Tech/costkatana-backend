import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { EncryptionService } from '../../utils/encryption';

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

export interface IGitHubConnectionMethods {
  encryptToken(token: string): string;
  decryptToken(): string;
  decryptRefreshToken?(): string | undefined;
}

export type GitHubConnectionDocument = HydratedDocument<GitHubConnection> &
  IGitHubConnectionMethods;

@Schema({ timestamps: true, collection: 'github_connections' })
export class GitHubConnection implements IGitHubConnectionMethods {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop()
  installationId?: string; // GitHub App installation ID

  @Prop({ required: true, select: false }) // Don't return by default for security
  accessToken: string; // Encrypted token

  @Prop({ select: false }) // Don't return by default for security
  refreshToken?: string; // Encrypted refresh token (for OAuth)

  @Prop({ type: String, enum: ['oauth', 'app'], default: 'oauth' })
  tokenType: 'oauth' | 'app'; // OAuth token or GitHub App token

  @Prop()
  scope?: string; // OAuth scopes granted

  @Prop({
    type: [
      {
        id: { type: Number, required: true },
        name: { type: String, required: true },
        fullName: { type: String, required: true },
        private: { type: Boolean, default: false },
        defaultBranch: { type: String, default: 'main' },
        description: String,
        language: String,
        url: { type: String, required: true },
        createdAt: Date,
        updatedAt: Date,
      },
    ],
    _id: false,
  })
  repositories: IGitHubRepository[];

  @Prop()
  githubUserId?: number; // GitHub user ID

  @Prop()
  githubUsername?: string; // GitHub username (also exposed as username for API compatibility)

  /** Alias for githubUsername when populated from API */
  @Prop()
  login?: string;

  /** Alias for githubUsername */
  @Prop()
  username?: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop()
  lastSyncedAt?: Date;

  @Prop()
  organizationId?: string; // Optional org context for indexing

  @Prop()
  expiresAt?: Date; // Token expiration

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  encryptToken(token: string): string {
    const { encrypted, iv } = EncryptionService.encryptCBC(token);
    return `${iv}:${encrypted}`;
  }

  decryptToken(): string {
    if (!this.accessToken) {
      throw new Error('Access token is not available');
    }

    const parts = this.accessToken.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid access token format');
    }

    const [iv, encrypted] = parts;
    return EncryptionService.decryptCBC(encrypted, iv);
  }

  decryptRefreshToken(): string | undefined {
    if (!this.refreshToken) {
      return undefined;
    }

    const parts = this.refreshToken.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid refresh token format');
    }

    const [iv, encrypted] = parts;
    return EncryptionService.decryptCBC(encrypted, iv);
  }
}

export const GitHubConnectionSchema =
  SchemaFactory.createForClass(GitHubConnection);

// Indexes for performance
GitHubConnectionSchema.index({ userId: 1, isActive: 1 });
GitHubConnectionSchema.index({ githubUsername: 1 });
GitHubConnectionSchema.index({ installationId: 1 }, { sparse: true });

// Method to encrypt access token
GitHubConnectionSchema.methods.encryptToken = function (token: string): string {
  const { encrypted, iv } = EncryptionService.encryptCBC(token);
  return `${iv}:${encrypted}`;
};

// Method to decrypt access token
GitHubConnectionSchema.methods.decryptToken = function (): string {
  if (!this.accessToken) {
    throw new Error('Access token is not available');
  }

  const parts = this.accessToken.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid access token format');
  }

  const [iv, encrypted] = parts;
  return EncryptionService.decryptCBC(encrypted, iv);
};

// Method to decrypt refresh token
GitHubConnectionSchema.methods.decryptRefreshToken = function ():
  | string
  | undefined {
  if (!this.refreshToken) {
    return undefined;
  }

  const parts = this.refreshToken.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid refresh token format');
  }

  const [iv, encrypted] = parts;
  return EncryptionService.decryptCBC(encrypted, iv);
};

// Pre-save hook to encrypt token if modified
GitHubConnectionSchema.pre('save', function (next) {
  // Encrypt access token if modified and not already encrypted
  if (this.isModified('accessToken') && !this.accessToken.includes(':')) {
    const { encrypted, iv } = EncryptionService.encryptCBC(this.accessToken);
    this.accessToken = `${iv}:${encrypted}`;
  }

  // Encrypt refresh token if modified and not already encrypted
  if (
    this.refreshToken &&
    this.isModified('refreshToken') &&
    !this.refreshToken.includes(':')
  ) {
    const { encrypted, iv } = EncryptionService.encryptCBC(this.refreshToken);
    this.refreshToken = `${iv}:${encrypted}`;
  }

  next();
});
