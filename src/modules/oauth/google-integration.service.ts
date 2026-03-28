import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { GoogleConnection } from '../../schemas/integration/google-connection.schema';
import { Integration } from '../../schemas/integration/integration.schema';
import { McpPermissionService } from '../mcp/services/mcp-permission.service';
import { EncryptionService } from '../../utils/encryption';

interface GoogleUser {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  locale: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string;
  webViewLink: string;
  thumbnailLink?: string;
  parents?: string[];
}

@Injectable()
export class GoogleIntegrationService {
  private readonly logger = new Logger(GoogleIntegrationService.name);

  constructor(
    private readonly httpService: HttpService,
    @InjectModel(GoogleConnection.name)
    private readonly googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(Integration.name)
    private readonly integrationModel: Model<Integration>,
    private readonly mcpPermissionService: McpPermissionService,
  ) {}

  /**
   * Setup Google connection for user
   */
  async setupConnection(
    userId: string,
    accessToken: string,
    googleTokenResponse: GoogleTokenResponse,
    isLinkingFlow: boolean = false,
  ): Promise<{ connectionId: string; userInfo: GoogleUser }> {
    try {
      this.logger.debug(
        `Setting up Google connection for user: ${userId}, linking: ${isLinkingFlow}`,
      );

      // Get authenticated user info
      const userInfo = await this.getGoogleUserInfo(accessToken);

      // Encrypt tokens as JSON strings (schema: string; decrypt via google-connection-tokens)
      const encryptedAccessToken = JSON.stringify(
        EncryptionService.encryptCBC(accessToken),
      );
      const encryptedRefreshToken = googleTokenResponse.refresh_token
        ? JSON.stringify(
            EncryptionService.encryptCBC(googleTokenResponse.refresh_token),
          )
        : undefined;

      // Upsert Google connection
      const connection = await this.googleConnectionModel.findOneAndUpdate(
        { userId },
        {
          $set: {
            googleId: userInfo.id,
            email: userInfo.email,
            name: userInfo.name,
            givenName: userInfo.given_name,
            familyName: userInfo.family_name,
            profilePicture: userInfo.picture,
            locale: userInfo.locale,
            encryptedAccessToken,
            encryptedRefreshToken,
            accessTokenExpiresAt: new Date(
              Date.now() + googleTokenResponse.expires_in * 1000,
            ),
            scope: googleTokenResponse.scope,
            isActive: true,
            lastSyncAt: new Date(),
            syncedAt: new Date(),
          },
          $setOnInsert: {
            userId,
            connectedAt: new Date(),
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
        },
      );

      this.logger.debug(`Google connection upserted: ${connection._id}`);

      // Sync Drive files in background
      this.syncDriveFiles(connection._id.toString(), accessToken).catch(
        (error) => {
          this.logger.error(
            'Failed to sync Google Drive files:',
            error instanceof Error ? error.message : String(error),
          );
        },
      );

      // Create/update integration record
      await this.integrationModel.findOneAndUpdate(
        { userId, type: 'google_oauth' },
        {
          $set: {
            name: 'Google',
            description: `Connected Google account ${userInfo.email}`,
            status: 'active',
            metadata: {
              googleId: userInfo.id,
              email: userInfo.email,
              connectedAt: new Date(),
            },
            lastUsedAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            userId,
            type: 'google_oauth',
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

      // Grant MCP permissions (check if already granted for reconnected accounts)
      const connectionId = connection._id.toString();
      const existingPermissions =
        await this.mcpPermissionService.getUserPermissions(userId);
      const googlePermissions = existingPermissions.filter(
        (p) => p.integration === 'google',
      );

      if (googlePermissions.length === 0) {
        await this.mcpPermissionService.grantPermissionsForNewConnection(
          userId,
          'google',
          connectionId,
        );
        this.logger.debug(
          `Granted MCP permissions for new Google connection: ${connectionId}`,
        );
      } else {
        this.logger.debug(
          `MCP permissions already exist for Google connection: ${connectionId}`,
        );
      }

      this.logger.log(`Google connection setup completed for user: ${userId}`);

      return {
        connectionId,
        userInfo,
      };
    } catch (error) {
      this.logger.error(
        'Error setting up Google connection:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Verify if user has an active Google connection
   */
  async verifyConnection(userId: string): Promise<boolean> {
    try {
      const connection = await this.googleConnectionModel.findOne({
        userId,
        isActive: true,
      });

      return !!connection;
    } catch (error) {
      this.logger.error(
        'Error verifying Google connection:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Get Google user info from API
   */
  private async getGoogleUserInfo(accessToken: string): Promise<GoogleUser> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<GoogleUser>(
          'https://www.googleapis.com/oauth2/v2/userinfo',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
            timeout: 10000,
          },
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        'Error fetching Google user info:',
        error instanceof Error ? error.message : String(error),
      );
      throw new Error('Failed to fetch Google user information');
    }
  }

  /**
   * Sync Google Drive files for a connection
   */
  private async syncDriveFiles(
    connectionId: string,
    accessToken: string,
  ): Promise<void> {
    try {
      this.logger.debug(`Syncing Drive files for connection: ${connectionId}`);

      const response = await firstValueFrom(
        this.httpService.get<{ files: GoogleDriveFile[] }>(
          'https://www.googleapis.com/drive/v3/files',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
            params: {
              pageSize: 50,
              orderBy: 'modifiedTime desc',
              fields:
                'files(id,name,mimeType,modifiedTime,size,webViewLink,thumbnailLink,parents)',
            },
            timeout: 15000,
          },
        ),
      );

      const files = response.data.files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: new Date(file.modifiedTime),
        size: file.size ? parseInt(file.size) : 0,
        webViewLink: file.webViewLink,
        thumbnailLink: file.thumbnailLink,
        parents: file.parents || [],
        syncedAt: new Date(),
      }));

      // Update connection with files
      await this.googleConnectionModel.findByIdAndUpdate(connectionId, {
        $set: {
          driveFiles: files,
          lastSyncAt: new Date(),
        },
      });

      this.logger.debug(
        `Synced ${files.length} Drive files for connection: ${connectionId}`,
      );
    } catch (error) {
      this.logger.error(
        'Error syncing Google Drive files:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}
