import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../../schemas/integration/github-connection.schema';
import { EncryptionService } from '../../../utils/encryption';

export interface UpsertConnectionData {
  userId: string;
  githubUserId: number;
  githubUsername: string;
  accessToken: string;
  scopes?: string;
}

export interface UpsertInstallationData {
  userId: string;
  installationId: string;
  accountId?: string | number;
  accountLogin?: string;
  setupAction?: string;
}

/**
 * Service for persisting GitHub OAuth and App installation connections.
 * Used by GithubOAuthController to store connections after successful auth flows.
 */
@Injectable()
export class GithubConnectionService {
  private readonly logger = new Logger(GithubConnectionService.name);

  constructor(
    @InjectModel(GitHubConnection.name)
    private readonly githubConnectionModel: Model<GitHubConnectionDocument>,
  ) {}

  /**
   * Upsert a GitHub OAuth connection after successful code exchange.
   */
  async upsertConnection(data: UpsertConnectionData): Promise<void> {
    const { userId, githubUserId, githubUsername, accessToken, scopes } = data;

    // Encrypt token manually (findOneAndUpdate bypasses pre-save hook)
    const { encrypted, iv } = EncryptionService.encryptCBC(accessToken);
    const encryptedToken = `${iv}:${encrypted}`;

    await this.githubConnectionModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          githubUserId,
          githubUsername,
          username: githubUsername,
          login: githubUsername,
          accessToken: encryptedToken,
          scope: scopes,
          tokenType: 'oauth',
          isActive: true,
          lastSyncedAt: new Date(),
        },
        $setOnInsert: {
          userId,
          createdAt: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      },
    );

    this.logger.debug(`Upserted GitHub OAuth connection for user ${userId}`);
  }

  /**
   * Upsert a GitHub App installation connection.
   * For app installations, the access token is obtained on-demand via JWT;
   * we store a placeholder to satisfy the schema's required accessToken field.
   */
  async upsertInstallation(data: UpsertInstallationData): Promise<void> {
    const { userId, installationId, accountId, accountLogin } = data;

    const accountIdStr = accountId != null ? String(accountId) : undefined;

    await this.githubConnectionModel.findOneAndUpdate(
      { installationId },
      {
        $set: {
          installationId,
          userId,
          githubUsername: accountLogin,
          username: accountLogin,
          tokenType: 'app',
          isActive: true,
          lastSyncedAt: new Date(),
          // Intentional: GitHub App installation tokens are short-lived (1h). Real tokens
          // are fetched on-demand via JWT when needed. This marker satisfies schema requirements.
          accessToken: `app:${installationId}`,
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      },
    );

    this.logger.debug(
      `Upserted GitHub App installation ${installationId} for user ${userId}, account ${accountLogin ?? accountIdStr}`,
    );
  }
}
