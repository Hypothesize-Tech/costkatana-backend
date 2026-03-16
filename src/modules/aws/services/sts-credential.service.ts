import { Injectable } from '@nestjs/common';
import {
  STSClient,
  AssumeRoleCommand,
  AssumeRoleCommandInput,
  AssumeRoleCommandOutput,
} from '@aws-sdk/client-sts';
import { CacheService } from '../../../common/cache/cache.service';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '@/schemas/integration/aws-connection.schema';
import { EncryptionService } from '../../../common/encryption/encryption.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

@Injectable()
export class StsCredentialService {
  private readonly stsClient: STSClient;

  constructor(
    private readonly cacheService: CacheService,
    private readonly logger: LoggerService,
    private readonly encryptionService: EncryptionService,
    @InjectModel(AWSConnection.name)
    private awsConnectionModel: Model<AWSConnectionDocument>,
  ) {
    this.stsClient = new STSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  /**
   * Assume role for customer AWS connection
   */
  async assumeRole(connection: AWSConnectionDocument): Promise<AWSCredentials> {
    const cacheKey = `aws_credentials_${connection._id}`;

    // Check cache first
    const cached = await this.cacheService.get<AWSCredentials>(cacheKey);
    if (cached && cached.expiration > new Date()) {
      return cached;
    }

    try {
      // Decrypt external ID (assuming it's stored as encrypted:iv:authTag format)
      const encryptedParts = connection.encryptedExternalId.split(':');
      if (encryptedParts.length !== 3) {
        throw new Error('Invalid encrypted external ID format');
      }
      const [encrypted, iv, authTag] = encryptedParts;
      const externalId = this.decryptGCM(encrypted, iv, authTag);

      // Create scoped policy if custom permissions
      let policy: string | undefined;
      if (
        connection.permissionMode === 'custom' &&
        connection.allowedServices?.length
      ) {
        policy = this.buildScopedPolicy(connection);
      }

      const params: AssumeRoleCommandInput = {
        RoleArn: connection.roleArn,
        RoleSessionName: `CostKatana-${connection.userId}-${Date.now()}`,
        ExternalId: externalId,
        DurationSeconds: connection.sessionConfig?.maxDurationSeconds || 1800,
        Policy: policy,
      };

      const startTime = Date.now();
      const command = new AssumeRoleCommand(params);
      const response: AssumeRoleCommandOutput =
        await this.stsClient.send(command);
      const latency = Date.now() - startTime;

      if (!response.Credentials) {
        throw new Error('No credentials returned from AssumeRole');
      }

      const credentials: AWSCredentials = {
        accessKeyId: response.Credentials.AccessKeyId!,
        secretAccessKey: response.Credentials.SecretAccessKey!,
        sessionToken: response.Credentials.SessionToken!,
        expiration: response.Credentials.Expiration!,
      };

      // Cache credentials with TTL (15 minutes less than expiration)
      const ttl = Math.max(
        300,
        (credentials.expiration.getTime() - Date.now()) / 1000 - 900,
      );
      await this.cacheService.set(cacheKey, credentials, ttl);

      // Update connection health
      await this.awsConnectionModel.updateOne(
        { _id: connection._id },
        {
          $set: {
            'health.lastSuccessful': new Date(),
            'health.assumeRoleLatencyMs': latency,
            'health.consecutiveFailures': 0,
          },
        },
      );

      this.logger.log('AWS role assumed successfully', {
        connectionId: connection._id.toString(),
        latency,
        region: process.env.AWS_REGION || 'us-east-1',
      });

      return credentials;
    } catch (error) {
      // Update connection health on failure
      await this.awsConnectionModel.updateOne(
        { _id: connection._id },
        {
          $set: {
            'health.lastChecked': new Date(),
            'health.lastError':
              error instanceof Error ? error.message : String(error),
            $inc: { 'health.consecutiveFailures': 1 },
          },
        },
      );

      this.logger.error('Failed to assume AWS role', {
        connectionId: connection._id.toString(),
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Verify connection by attempting to assume role
   */
  async verifyConnection(connection: AWSConnectionDocument): Promise<boolean> {
    try {
      await this.assumeRole(connection);
      return true;
    } catch (error) {
      this.logger.warn('AWS connection verification failed', {
        connectionId: connection._id.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Build scoped IAM policy for custom permissions
   */
  private buildScopedPolicy(connection: AWSConnectionDocument): string {
    if (!connection.allowedServices?.length) {
      return JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Deny',
            Action: '*',
            Resource: '*',
          },
        ],
      });
    }

    const statements = connection.allowedServices.map((service) => ({
      Effect: 'Allow' as const,
      Action: service.actions.map((action) => `${service.service}:${action}`),
      Resource: '*',
      Condition: service.regions.length
        ? {
            StringEquals: {
              'aws:RequestedRegion': service.regions,
            },
          }
        : undefined,
    }));

    return JSON.stringify({
      Version: '2012-10-17',
      Statement: statements,
    });
  }

  /**
   * Decrypt GCM encrypted data
   */
  private decryptGCM(encrypted: string, iv: string, authTag: string): string {
    return this.encryptionService.decryptGCM(encrypted, iv, authTag);
  }

  /**
   * Clear cached credentials for a connection
   */
  async clearCredentials(connectionId: string): Promise<void> {
    const cacheKey = `aws_credentials_${connectionId}`;
    await this.cacheService.del(cacheKey);

    this.logger.log('AWS credentials cleared from cache', {
      connectionId,
    });
  }
}
