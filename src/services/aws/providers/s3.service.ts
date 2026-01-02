import { S3Client, ListBucketsCommand, GetBucketLocationCommand, GetBucketTaggingCommand, PutBucketLifecycleConfigurationCommand, GetBucketLifecycleConfigurationCommand, PutBucketIntelligentTieringConfigurationCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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
