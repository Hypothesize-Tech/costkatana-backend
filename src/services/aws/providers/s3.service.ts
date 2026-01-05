import { S3Client, ListBucketsCommand, GetBucketLocationCommand, GetBucketTaggingCommand, PutBucketLifecycleConfigurationCommand, GetBucketLifecycleConfigurationCommand, PutBucketIntelligentTieringConfigurationCommand, ListObjectsV2Command, CreateBucketCommand, PutBucketEncryptionCommand, PutBucketTaggingCommand, PutBucketVersioningCommand, PutPublicAccessBlockCommand } from '@aws-sdk/client-s3';
import { loggingService } from '../../logging.service';
import { stsCredentialService } from '../stsCredential.service';
import { permissionBoundaryService } from '../permissionBoundary.service';
import { IAWSConnection } from '../../../models/AWSConnection';

/**
 * S3 Service Provider - S3 Operations
 * 
 * Allowed Operations:
 * - Read: ListBuckets, GetBucketMetrics, GetBucketAnalytics
 * - Write: PutLifecycleConfiguration (with approval)
 * - Blocked: DeleteBucket, DeleteObject
 */

export interface S3Bucket {
  name: string;
  creationDate?: Date;
  region?: string;
  tags: Record<string, string>;
}

export interface LifecycleRule {
  id: string;
  status: 'Enabled' | 'Disabled';
  prefix?: string;
  transitions?: Array<{
    days: number;
    storageClass: string;
  }>;
  expiration?: {
    days?: number;
    expiredObjectDeleteMarker?: boolean;
  };
}

class S3ServiceProvider {
  private static instance: S3ServiceProvider;
  
  private constructor() {}
  
  public static getInstance(): S3ServiceProvider {
    if (!S3ServiceProvider.instance) {
      S3ServiceProvider.instance = new S3ServiceProvider();
    }
    return S3ServiceProvider.instance;
  }
  
  private async getClient(connection: IAWSConnection, region?: string): Promise<S3Client> {
    const credentials = await stsCredentialService.assumeRole(connection);
    
    return new S3Client({
      region: region || connection.allowedRegions[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }
  
  /**
   * Create S3 bucket with encryption, versioning, and tagging
   */
  public async createBucket(
    connection: IAWSConnection,
    bucketName: string,
    region?: string,
    tags?: Record<string, string>
  ): Promise<S3Bucket> {
    const validation = permissionBoundaryService.validateAction(
      { service: 's3', action: 'CreateBucket', resources: [bucketName] },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const targetRegion = region || connection.allowedRegions[0] || 'us-east-1';
    const client = await this.getClient(connection, targetRegion);
    
    // Normalize bucket name: lowercase, replace spaces/underscores with hyphens, remove invalid chars
    let normalizedName = bucketName
      .toLowerCase()
      .replace(/[\s_]+/g, '-')  // Replace spaces and underscores with hyphens
      .replace(/[^a-z0-9-]/g, '')  // Remove any other invalid characters
      .replace(/^-+|-+$/g, '');  // Remove leading/trailing hyphens
    
    // Ensure minimum length
    if (normalizedName.length < 3) {
      normalizedName = `ck-${normalizedName}`;
    }
    
    // Ensure maximum length
    if (normalizedName.length > 63) {
      normalizedName = normalizedName.substring(0, 63);
    }
    
    // Validate bucket name
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalizedName) || normalizedName.length < 3 || normalizedName.length > 63) {
      throw new Error(`Invalid bucket name after normalization: '${normalizedName}'. Bucket name must be 3-63 characters, lowercase alphanumeric with hyphens, and start/end with alphanumeric`);
    }
    
    // Check if bucket already exists
    try {
      const headCommand = new GetBucketLocationCommand({ Bucket: normalizedName });
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
        ...(targetRegion !== 'us-east-1' ? { CreateBucketConfiguration: { LocationConstraint: targetRegion as any } } : {}),
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
        'ManagedBy': 'CostKatana',
        'CreatedBy': connection.userId?.toString() || 'unknown',
        'CreatedAt': new Date().toISOString(),
        'ConnectionId': connection._id.toString(),
        'Environment': connection.environment || 'development',
        'OriginalName': bucketName,  // Store original name for reference
        ...tags,
      };
      
      const taggingCommand = new PutBucketTaggingCommand({
        Bucket: normalizedName,
        Tagging: {
          TagSet: Object.entries(defaultTags).map(([Key, Value]) => ({ Key, Value })),
        },
      });
      
      await client.send(taggingCommand);
      
      loggingService.info('S3 bucket created successfully', {
        component: 'S3ServiceProvider',
        operation: 'createBucket',
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to create S3 bucket', {
        component: 'S3ServiceProvider',
        operation: 'createBucket',
        bucketName: normalizedName,
        originalName: bucketName,
        region: targetRegion,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * List S3 buckets
   */
  public async listBuckets(connection: IAWSConnection): Promise<S3Bucket[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 's3', action: 'ListBuckets' },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection);
    
    const command = new ListBucketsCommand({});
    const response = await client.send(command);
    
    const buckets: S3Bucket[] = [];
    
    for (const bucket of response.Buckets || []) {
      if (bucket.Name) {
        buckets.push({
          name: bucket.Name,
          creationDate: bucket.CreationDate,
          tags: {},
        });
      }
    }
    
    loggingService.info('S3 buckets listed', {
      component: 'S3ServiceProvider',
      operation: 'listBuckets',
      connectionId: connection._id.toString(),
      bucketCount: buckets.length,
    });
    
    return buckets;
  }
  
  /**
   * Get bucket location
   */
  public async getBucketLocation(
    connection: IAWSConnection,
    bucketName: string
  ): Promise<string> {
    const client = await this.getClient(connection);
    
    const command = new GetBucketLocationCommand({
      Bucket: bucketName,
    });
    
    const response = await client.send(command);
    
    // Empty string means us-east-1
    return response.LocationConstraint || 'us-east-1';
  }
  
  /**
   * Get bucket tags
   */
  public async getBucketTags(
    connection: IAWSConnection,
    bucketName: string
  ): Promise<Record<string, string>> {
    const client = await this.getClient(connection);
    
    try {
      const command = new GetBucketTaggingCommand({
        Bucket: bucketName,
      });
      
      const response = await client.send(command);
      
      const tags: Record<string, string> = {};
      for (const tag of response.TagSet || []) {
        if (tag.Key) {
          tags[tag.Key] = tag.Value || '';
        }
      }
      
      return tags;
    } catch (error) {
      // Bucket might not have tags
      return {};
    }
  }
  
  /**
   * Get current lifecycle configuration
   */
  public async getLifecycleConfiguration(
    connection: IAWSConnection,
    bucketName: string
  ): Promise<LifecycleRule[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 's3', action: 'GetBucketLifecycleConfiguration' },
      connection
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
      
      return (response.Rules || []).map(rule => ({
        id: rule.ID || '',
        status: rule.Status as 'Enabled' | 'Disabled',
        prefix: rule.Prefix,
        transitions: rule.Transitions?.map(t => ({
          days: t.Days || 0,
          storageClass: t.StorageClass || '',
        })),
        expiration: rule.Expiration ? {
          days: rule.Expiration.Days,
          expiredObjectDeleteMarker: rule.Expiration.ExpiredObjectDeleteMarker,
        } : undefined,
      }));
    } catch (error) {
      // Bucket might not have lifecycle configuration
      return [];
    }
  }
  
  /**
   * Set lifecycle configuration for cost optimization
   */
  public async setLifecycleConfiguration(
    connection: IAWSConnection,
    bucketName: string,
    rules: LifecycleRule[]
  ): Promise<void> {
    const validation = permissionBoundaryService.validateAction(
      { service: 's3', action: 'PutBucketLifecycleConfiguration', resources: [bucketName] },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection);
    
    const command = new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: {
        Rules: rules.map(rule => ({
          ID: rule.id,
          Status: rule.status,
          Filter: rule.prefix ? { Prefix: rule.prefix } : { Prefix: '' },
          Transitions: rule.transitions?.map(t => ({
            Days: t.days,
            StorageClass: t.storageClass as any,
          })),
          Expiration: rule.expiration ? {
            Days: rule.expiration.days,
            ExpiredObjectDeleteMarker: rule.expiration.expiredObjectDeleteMarker,
          } : undefined,
        })),
      },
    });
    
    await client.send(command);
    
    loggingService.info('S3 lifecycle configuration set', {
      component: 'S3ServiceProvider',
      operation: 'setLifecycleConfiguration',
      connectionId: connection._id.toString(),
      bucketName,
      ruleCount: rules.length,
    });
  }
  
  /**
   * Enable Intelligent Tiering
   */
  public async enableIntelligentTiering(
    connection: IAWSConnection,
    bucketName: string,
    configId: string = 'CostKatanaOptimization'
  ): Promise<void> {
    const validation = permissionBoundaryService.validateAction(
      { service: 's3', action: 'PutBucketIntelligentTieringConfiguration', resources: [bucketName] },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection);
    
    const command = new PutBucketIntelligentTieringConfigurationCommand({
      Bucket: bucketName,
      Id: configId,
      IntelligentTieringConfiguration: {
        Id: configId,
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
    
    loggingService.info('S3 Intelligent Tiering enabled', {
      component: 'S3ServiceProvider',
      operation: 'enableIntelligentTiering',
      connectionId: connection._id.toString(),
      bucketName,
    });
  }
  
  /**
   * Get bucket size estimate
   */
  public async getBucketSizeEstimate(
    connection: IAWSConnection,
    bucketName: string
  ): Promise<{ objectCount: number; sizeBytes: number }> {
    const client = await this.getClient(connection);
    
    let objectCount = 0;
    let sizeBytes = 0;
    let continuationToken: string | undefined;
    
    // Sample first 1000 objects for estimate
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      MaxKeys: 1000,
    });
    
    const response = await client.send(command);
    
    for (const obj of response.Contents || []) {
      objectCount++;
      sizeBytes += obj.Size || 0;
    }
    
    // If there are more objects, extrapolate
    if (response.IsTruncated) {
      // This is an estimate based on sample
      const avgSize = sizeBytes / Math.max(objectCount, 1);
      // Assume 10x more objects as rough estimate
      objectCount *= 10;
      sizeBytes = Math.round(avgSize * objectCount);
    }
    
    return { objectCount, sizeBytes };
  }
  
  /**
   * Create cost optimization lifecycle rules
   */
  public createOptimizationRules(
    prefix?: string,
    glacierDays: number = 90,
    deepArchiveDays: number = 180
  ): LifecycleRule[] {
    return [
      {
        id: 'CostKatana-IA-Transition',
        status: 'Enabled',
        prefix,
        transitions: [
          {
            days: 30,
            storageClass: 'STANDARD_IA',
          },
        ],
      },
      {
        id: 'CostKatana-Glacier-Transition',
        status: 'Enabled',
        prefix,
        transitions: [
          {
            days: glacierDays,
            storageClass: 'GLACIER',
          },
        ],
      },
      {
        id: 'CostKatana-DeepArchive-Transition',
        status: 'Enabled',
        prefix,
        transitions: [
          {
            days: deepArchiveDays,
            storageClass: 'DEEP_ARCHIVE',
          },
        ],
      },
    ];
  }
}

export const s3ServiceProvider = S3ServiceProvider.getInstance();
