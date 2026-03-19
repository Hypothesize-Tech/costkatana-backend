import { Injectable } from '@nestjs/common';
import {
  S3Client,
  HeadBucketCommand,
  ListBucketsCommand,
  CreateBucketCommand,
  PutBucketEncryptionCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetBucketTaggingCommand,
  PutBucketTaggingCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketIntelligentTieringConfigurationCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { LoggerService } from '../../../common/logger/logger.service';
import { StsCredentialService } from './sts-credential.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import { AWSConnectionDocument } from '@/schemas/integration/aws-connection.schema';

export interface S3Bucket {
  name: string;
  creationDate?: Date;
  region?: string;
  tags?: Record<string, string>;
}

@Injectable()
export class S3Service {
  constructor(
    private readonly stsCredentialService: StsCredentialService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get S3 client for a connection
   */
  private async getClient(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<S3Client> {
    const credentials = await this.stsCredentialService.assumeRole(connection);

    return new S3Client({
      region: region || connection.allowedRegions?.[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * List S3 buckets
   */
  async listBuckets(connection: AWSConnectionDocument): Promise<S3Bucket[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'ListBuckets' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection);

    const command = new ListBucketsCommand({});
    const response = await client.send(command);

    const buckets: S3Bucket[] = (response.Buckets || []).map((bucket) => ({
      name: bucket.Name || '',
      creationDate: bucket.CreationDate,
    }));

    this.logger.log('S3 buckets listed', {
      connectionId: connection._id.toString(),
      bucketCount: buckets.length,
    });

    return buckets;
  }

  /**
   * Create S3 bucket with security defaults
   */
  async createBucket(
    connection: AWSConnectionDocument,
    bucketName: string,
    region?: string,
    tags?: Record<string, string>,
  ): Promise<S3Bucket> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'CreateBucket', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const targetRegion =
      region || connection.allowedRegions?.[0] || 'us-east-1';
    const client = await this.getClient(connection, targetRegion);

    // Normalize bucket name: lowercase, replace spaces/underscores with hyphens, remove invalid chars
    let normalizedName = bucketName
      .toLowerCase()
      .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/[^a-z0-9-]/g, '') // Remove any other invalid characters
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    // Ensure minimum length
    if (normalizedName.length < 3) {
      normalizedName = `ck-${normalizedName}`;
    }

    // Ensure maximum length
    if (normalizedName.length > 63) {
      normalizedName = normalizedName.substring(0, 63);
    }

    // Validate bucket name
    if (
      !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalizedName) ||
      normalizedName.length < 3 ||
      normalizedName.length > 63
    ) {
      throw new Error(
        `Invalid bucket name after normalization: '${normalizedName}'. Bucket name must be 3-63 characters, lowercase alphanumeric with hyphens, and start/end with alphanumeric`,
      );
    }

    // Check if bucket already exists
    try {
      const headCommand = new GetBucketLocationCommand({
        Bucket: normalizedName,
      });
      await client.send(headCommand);
      throw new Error(`Bucket '${normalizedName}' already exists`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw error;
      }
      // Bucket doesn't exist, continue with creation
    }

    try {
      // Step 1: Create bucket
      const createCommand = new CreateBucketCommand({
        Bucket: normalizedName,
        CreateBucketConfiguration:
          targetRegion !== 'us-east-1'
            ? {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                LocationConstraint: targetRegion as any,
              }
            : undefined,
      });

      await client.send(createCommand);

      // Step 2: Enable encryption (AES256 by default)
      const encryptionCommand = new PutBucketEncryptionCommand({
        Bucket: normalizedName,
        ServerSideEncryptionConfiguration: {
          Rules: [
            {
              ApplyServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
      });

      await client.send(encryptionCommand);

      // Step 3: Enable versioning
      const versioningCommand = new PutBucketVersioningCommand({
        Bucket: normalizedName,
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });

      await client.send(versioningCommand);

      // Step 4: Block public access
      const blockPublicCommand = new PutPublicAccessBlockCommand({
        Bucket: normalizedName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });

      await client.send(blockPublicCommand);

      // Step 5: Apply tags (including CostKatana metadata)
      const defaultTags: Record<string, string> = {
        ManagedBy: 'CostKatana',
        CreatedBy: connection.userId?.toString() || 'unknown',
        CreatedAt: new Date().toISOString(),
        ConnectionId: connection._id.toString(),
        Environment: connection.environment || 'development',
        OriginalName: bucketName,
        ...tags,
      };

      const taggingCommand = new PutBucketTaggingCommand({
        Bucket: normalizedName,
        Tagging: {
          TagSet: Object.entries(defaultTags).map(([Key, Value]) => ({
            Key,
            Value,
          })),
        },
      });

      await client.send(taggingCommand);

      this.logger.log('S3 bucket created successfully', {
        component: 'S3Service',
        connectionId: connection._id.toString(),
        bucketName: normalizedName,
        originalName: bucketName,
        region: targetRegion,
        encryption: 'AES256',
        versioning: 'Enabled',
        publicAccessBlocked: true,
        tagCount: Object.keys(defaultTags).length,
      });

      return {
        name: normalizedName,
        region: targetRegion,
        creationDate: new Date(),
        tags: defaultTags,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to create S3 bucket', {
        component: 'S3Service',
        bucketName: normalizedName,
        originalName: bucketName,
        region: targetRegion,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Apply security defaults to a newly created bucket
   */
  private async applySecurityDefaults(
    connection: AWSConnectionDocument,
    bucketName: string,
    region?: string,
  ): Promise<void> {
    const client = await this.getClient(connection, region);

    try {
      // Enable server-side encryption
      await client.send(
        new PutBucketEncryptionCommand({
          Bucket: bucketName,
          ServerSideEncryptionConfiguration: {
            Rules: [
              {
                ApplyServerSideEncryptionByDefault: {
                  SSEAlgorithm: 'AES256',
                },
              },
            ],
          },
        }),
      );

      // Enable versioning
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: bucketName,
          VersioningConfiguration: {
            Status: 'Enabled',
          },
        }),
      );

      // Block public access
      await client.send(
        new PutPublicAccessBlockCommand({
          Bucket: bucketName,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        }),
      );

      this.logger.debug('S3 security defaults applied', {
        bucketName,
      });
    } catch (error) {
      this.logger.warn('Failed to apply some S3 security defaults', {
        bucketName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get bucket details
   */
  async getBucketDetails(
    connection: AWSConnectionDocument,
    bucketName: string,
  ): Promise<{
    name: string;
    creationDate?: Date;
    region?: string;
    versioning?: boolean;
    encryption?: boolean;
  }> {
    // Validate permissions for location
    const locationValidation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'GetBucketLocation' },
      connection,
    );

    if (!locationValidation.allowed) {
      throw new Error(`Permission denied: ${locationValidation.reason}`);
    }

    const client = await this.getClient(connection);

    try {
      // Get bucket region
      const locationCommand = new GetBucketLocationCommand({
        Bucket: bucketName,
      });
      const locationResponse = await client.send(locationCommand);
      const region = locationResponse.LocationConstraint || 'us-east-1';

      // Get bucket versioning status
      let versioning = false;
      try {
        const versioningValidation =
          this.permissionBoundaryService.validateAction(
            { service: 's3', action: 'GetBucketVersioning' },
            connection,
          );

        if (versioningValidation.allowed) {
          const versioningCommand = new GetBucketVersioningCommand({
            Bucket: bucketName,
          });
          const versioningResponse = await client.send(versioningCommand);
          versioning = versioningResponse.Status === 'Enabled';
        }
      } catch (error) {
        this.logger.warn('Failed to get bucket versioning', {
          bucketName,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Get bucket encryption status
      let encryption = false;
      try {
        const encryptionValidation =
          this.permissionBoundaryService.validateAction(
            { service: 's3', action: 'GetBucketEncryption' },
            connection,
          );

        if (encryptionValidation.allowed) {
          const encryptionCommand = new GetBucketEncryptionCommand({
            Bucket: bucketName,
          });
          await client.send(encryptionCommand);
          encryption = true; // If no error, encryption is configured
        }
      } catch (error) {
        // If encryption is not configured, AWS returns NoSuchConfiguration
        if (
          error instanceof Error &&
          'name' in error &&
          error.name !== 'NoSuchConfiguration'
        ) {
          this.logger.warn('Failed to get bucket encryption', {
            bucketName,
            error: error.message,
          });
        }
        // encryption remains false if NoSuchConfiguration or permission denied
      }

      // Get creation date from list buckets (inefficient but necessary for single bucket)
      let creationDate: Date | undefined;
      try {
        const bucketsValidation = this.permissionBoundaryService.validateAction(
          { service: 's3', action: 'ListBuckets' },
          connection,
        );

        if (bucketsValidation.allowed) {
          const listCommand = new ListBucketsCommand({});
          const listResponse = await client.send(listCommand);
          const bucket = listResponse.Buckets?.find(
            (b) => b.Name === bucketName,
          );
          creationDate = bucket?.CreationDate;
        }
      } catch (error) {
        this.logger.warn('Failed to get bucket creation date', {
          bucketName,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const details = {
        name: bucketName,
        creationDate,
        region,
        versioning,
        encryption,
      };

      this.logger.log('Retrieved bucket details', {
        connectionId: connection._id.toString(),
        bucketName,
        region,
        versioning,
        encryption,
      });

      return details;
    } catch (error) {
      this.logger.error('Failed to get bucket details', {
        connectionId: connection._id.toString(),
        bucketName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to get bucket details: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Format buckets for chat response
   */
  formatBucketsForChat(buckets: S3Bucket[]): string {
    if (buckets.length === 0) {
      return 'No S3 buckets found.';
    }

    let message = `🪣 **S3 Buckets (${buckets.length})**\n\n`;

    for (const bucket of buckets.slice(0, 10)) {
      // Limit to first 10
      message += `📦 **${bucket.name}**\n`;

      if (bucket.creationDate) {
        message += `   Created: ${bucket.creationDate.toLocaleDateString()}\n`;
      }

      message += '\n';
    }

    if (buckets.length > 10) {
      message += `*... and ${buckets.length - 10} more buckets*`;
    }

    return message;
  }

  /**
   * Checks if an S3 bucket name is available and valid.
   *
   * This method first validates the bucket name against AWS S3 rules and optionally
   * (if async logic is added in the future) could try to create a test bucket to
   * check global uniqueness. For now, it only performs local validation.
   * Future enhancement: Add AWS API call to verify global uniqueness.
   *
   * S3 Bucket Name Rules (summary):
   * - Must be 3-63 characters
   * - Only lowercase letters, numbers, and hyphens
   * - Start and end with letter or number
   * - Must not resemble an IPv4 address (e.g. "192.168.0.1")
   * - Cannot have two adjacent periods, or dashes next to periods, or consecutive hyphens
   * - Cannot contain uppercase or underscores or special chars
   * - Valid in DNS
   *
   * Note: This does NOT guarantee global uniqueness – AWS only guarantees this
   * by attempting to create a bucket and observing any error.
   */
  isBucketNameAvailable(bucketName: string): boolean {
    // Local syntax/format validation

    // Length between 3 and 63
    if (bucketName.length < 3 || bucketName.length > 63) {
      return false;
    }

    // Only lowercase letters, digits, hyphens
    if (!/^[a-z0-9-]+$/.test(bucketName)) {
      return false;
    }

    // Begin and end with letter or digit
    if (!/^[a-z0-9]/.test(bucketName) || !/[a-z0-9]$/.test(bucketName)) {
      return false;
    }

    // No consecutive periods, dashes next to periods, or consecutive dashes
    if (
      bucketName.includes('..') ||
      bucketName.includes('-.') ||
      bucketName.includes('.-') ||
      bucketName.includes('--')
    ) {
      return false;
    }

    // Bucket name cannot look like IPv4 address
    if (/^\d+\.\d+\.\d+\.\d+$/.test(bucketName)) {
      return false;
    }

    // No uppercase, underscores, or special characters (already checked above)
    // No need to check underscores or uppercase as regex above excludes them

    return true;
  }

  /**
   * Verify S3 bucket name global uniqueness via AWS HeadBucket API.
   * Returns true if the bucket does not exist (name is available), false if it exists.
   */
  async checkBucketNameUniqueness(
    connection: AWSConnectionDocument,
    bucketName: string,
    region?: string,
  ): Promise<{ available: boolean; error?: string }> {
    if (!this.isBucketNameAvailable(bucketName)) {
      return { available: false, error: 'Invalid bucket name format' };
    }
    try {
      const client = await this.getClient(connection, region);
      await client.send(new HeadBucketCommand({ Bucket: bucketName }));
      return { available: false };
    } catch (err: unknown) {
      const e = err as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const is404 =
        e?.$metadata?.httpStatusCode === 404 ||
        e?.name === 'NotFound' ||
        e?.name === 'NoSuchBucket';
      if (is404) {
        return { available: true };
      }
      return {
        available: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Get bucket location
   */
  async getBucketLocation(
    connection: AWSConnectionDocument,
    bucketName: string,
  ): Promise<string> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'GetBucketLocation' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection);

    const command = new GetBucketLocationCommand({
      Bucket: bucketName,
    });

    const response = await client.send(command);

    const location = response.LocationConstraint || 'us-east-1';

    this.logger.log('Bucket location retrieved', {
      connectionId: connection._id.toString(),
      bucketName,
      location,
    });

    return location;
  }

  /**
   * Get bucket tags
   */
  async getBucketTags(
    connection: AWSConnectionDocument,
    bucketName: string,
  ): Promise<Array<{ key: string; value: string }>> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'GetBucketTagging' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection);

    try {
      const command = new GetBucketTaggingCommand({
        Bucket: bucketName,
      });

      const response = await client.send(command);

      const tags = (response.TagSet || []).map((tag) => ({
        key: tag.Key || '',
        value: tag.Value || '',
      }));

      this.logger.log('Bucket tags retrieved', {
        connectionId: connection._id.toString(),
        bucketName,
        tagCount: tags.length,
      });

      return tags;
    } catch (error) {
      // If no tags are set, AWS returns NoSuchTagSet
      if (
        error instanceof Error &&
        'name' in error &&
        error.name === 'NoSuchTagSet'
      ) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get bucket lifecycle configuration
   */
  async getLifecycleConfiguration(
    connection: AWSConnectionDocument,
    bucketName: string,
  ): Promise<any[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'GetBucketLifecycleConfiguration' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection);

    try {
      const command = new GetBucketLifecycleConfigurationCommand({
        Bucket: bucketName,
      });

      const response = await client.send(command);

      const rules = response.Rules || [];

      this.logger.log('Bucket lifecycle configuration retrieved', {
        connectionId: connection._id.toString(),
        bucketName,
        ruleCount: rules.length,
      });

      return rules;
    } catch (error) {
      // If no lifecycle configuration is set, AWS returns NoSuchLifecycleConfiguration
      if (
        error instanceof Error &&
        'name' in error &&
        error.name === 'NoSuchLifecycleConfiguration'
      ) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Set bucket lifecycle configuration
   */
  async setLifecycleConfiguration(
    connection: AWSConnectionDocument,
    bucketName: string,
    rules: any[],
  ): Promise<void> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'PutBucketLifecycleConfiguration' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection);

    const command = new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: {
        Rules: rules,
      },
    });

    await client.send(command);

    this.logger.log('Bucket lifecycle configuration set', {
      connectionId: connection._id.toString(),
      bucketName,
      ruleCount: rules.length,
    });
  }

  /**
   * Enable S3 Intelligent Tiering
   */
  async enableIntelligentTiering(
    connection: AWSConnectionDocument,
    bucketName: string,
    configurationId?: string,
  ): Promise<void> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'PutBucketIntelligentTieringConfiguration' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection);

    const command = new PutBucketIntelligentTieringConfigurationCommand({
      Bucket: bucketName,
      Id: configurationId || 'EntireBucket',
      IntelligentTieringConfiguration: {
        Id: configurationId || 'EntireBucket',
        Status: 'Enabled',
        Tierings: [
          {
            Days: 90,
            AccessTier: 'ARCHIVE_ACCESS',
          },
          {
            Days: 180,
            AccessTier: 'DEEP_ARCHIVE_ACCESS',
          },
        ],
      },
    });

    await client.send(command);

    this.logger.log('S3 Intelligent Tiering enabled', {
      connectionId: connection._id.toString(),
      bucketName,
      configurationId: configurationId || 'EntireBucket',
    });
  }

  /**
   * Get bucket size estimate
   */
  async getBucketSizeEstimate(
    connection: AWSConnectionDocument,
    bucketName: string,
  ): Promise<{ objectCount: number; totalSizeBytes: number }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 's3', action: 'ListObjectsV2' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection);

    let objectCount = 0;
    let totalSizeBytes = 0;
    let continuationToken: string | undefined;
    const maxKeys = 1000; // Per-request limit (AWS max is 1000)

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      });

      const response = await client.send(command);

      if (response.Contents) {
        objectCount += response.Contents.length;
        totalSizeBytes += response.Contents.reduce(
          (sum, obj) => sum + (obj.Size || 0),
          0,
        );
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    const isEstimate = false; // Full pagination complete

    this.logger.log('Bucket size calculated', {
      connectionId: connection._id.toString(),
      bucketName,
      objectCount,
      totalSizeBytes,
    });

    return {
      objectCount,
      totalSizeBytes,
    };
  }

  /**
   * Create optimization rules for cost savings
   */
  async createOptimizationRules(
    connection: AWSConnectionDocument,
    bucketName: string,
  ): Promise<void> {
    // Create lifecycle rules for cost optimization
    const lifecycleRules = [
      {
        ID: 'DeleteIncompleteMultipartUploads',
        Status: 'Enabled',
        Filter: {
          Prefix: '',
        },
        AbortIncompleteMultipartUpload: {
          DaysAfterInitiation: 7,
        },
      },
      {
        ID: 'MoveOldVersionsToIA',
        Status: 'Enabled',
        Filter: {
          Prefix: '',
        },
        NoncurrentVersionTransitions: [
          {
            NoncurrentDays: 30,
            StorageClass: 'STANDARD_IA',
          },
          {
            NoncurrentDays: 90,
            StorageClass: 'GLACIER',
          },
        ],
        NoncurrentVersionExpiration: {
          NoncurrentDays: 365,
        },
      },
      {
        ID: 'MoveOldObjectsToIA',
        Status: 'Enabled',
        Filter: {
          Prefix: '',
        },
        Transitions: [
          {
            Days: 90,
            StorageClass: 'STANDARD_IA',
          },
          {
            Days: 365,
            StorageClass: 'GLACIER',
          },
        ],
      },
    ];

    await this.setLifecycleConfiguration(
      connection,
      bucketName,
      lifecycleRules,
    );

    // Enable Intelligent Tiering
    await this.enableIntelligentTiering(connection, bucketName);

    this.logger.log('Optimization rules created for bucket', {
      connectionId: connection._id.toString(),
      bucketName,
    });
  }

  /**
   * Upload document to S3 bucket
   */
  async uploadDocument(
    connection: AWSConnectionDocument,
    userId: string,
    fileName: string,
    fileBuffer: Buffer,
    fileType: string,
    metadata?: Record<string, string>,
    bucketName?: string,
  ): Promise<{ s3Key: string; s3Url: string }> {
    const client = await this.getClient(connection);
    const actualBucketName = bucketName || connection.s3BucketName;

    if (!actualBucketName) {
      throw new Error('No S3 bucket configured for this connection');
    }

    // Create folder structure: documents/{userId}/{fileName}
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `documents/${userId}/${timestamp}-${sanitizedFileName}`;

    const command = new PutObjectCommand({
      Bucket: actualBucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: fileType,
      Metadata: {
        userId,
        originalFileName: fileName,
        uploadDate: new Date().toISOString(),
        ...metadata,
      },
    });

    try {
      await client.send(command);

      const s3Url = `s3://${actualBucketName}/${key}`;

      this.logger.log('Document uploaded to S3', {
        connectionId: connection._id.toString(),
        userId,
        fileName,
        s3Key: key,
        fileSize: fileBuffer.length,
        component: 'S3Service',
        operation: 'uploadDocument',
      });

      return { s3Key: key, s3Url };
    } catch (error) {
      this.logger.error('Error uploading document to S3', {
        connectionId: connection._id.toString(),
        userId,
        fileName,
        error: error instanceof Error ? error.message : String(error),
        component: 'S3Service',
        operation: 'uploadDocument',
      });
      throw new Error('Could not upload document to S3.');
    }
  }
}
