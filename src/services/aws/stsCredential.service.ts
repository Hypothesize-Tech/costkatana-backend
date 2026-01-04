import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { Types } from 'mongoose';
import { AWSConnection, IAWSConnection } from '../../models/AWSConnection';
import { loggingService } from '../logging.service';
import { killSwitchService } from './killSwitch.service';

/**
 * STS Credential Manager - Secure Temporary Credential Management
 * 
 * Security Guarantees:
 * - AssumeRole with short session duration (15 min default)
 * - Scoped inline policy for additional restrictions
 * - Session name tracking: CostKatana-{userId}-{timestamp}
 * - Credential caching per plan execution (not per request)
 * - Circuit breaker for STS throttling
 * - NO credential revocation (STS limitation - documented)
 * 
 * IMPORTANT: STS credentials CANNOT be revoked once issued.
 * They automatically expire after the configured duration.
 * For immediate access termination, customer must:
 * 1. Remove trust relationship from IAM role
 * 2. OR add explicit Deny for sts:AssumeRole
 * 3. OR delete the IAM role entirely
 */

export interface STSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

export interface CredentialCacheEntry {
  credentials: STSCredentials;
  connectionId: string;
  planId?: string;
  createdAt: Date;
  expiresAt: Date;
  usageCount: number;
}

export interface AssumeRoleResult {
  credentials: STSCredentials;
  sessionName: string;
  assumedRoleArn: string;
  latencyMs: number;
}

export interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailure?: Date;
  nextRetryAt?: Date;
}

// Scoped policy to further restrict assumed role permissions
const getScopedPolicy = (connection: IAWSConnection): string => {
  const allowedActions: string[] = [];
  
  // Build allowed actions from connection config
  for (const service of connection.allowedServices) {
    for (const action of service.actions) {
      // Check if action already has service prefix to avoid duplication
      if (action.includes(':')) {
        allowedActions.push(action);
      } else {
        allowedActions.push(`${service.service}:${action}`);
      }
    }
  }
  
  // If no specific actions, allow read-only by default
  if (allowedActions.length === 0) {
    allowedActions.push(
      'ec2:Describe*',
      's3:Get*',
      's3:List*',
      'rds:Describe*',
      'lambda:Get*',
      'lambda:List*',
      'cloudwatch:Get*',
      'cloudwatch:List*',
      'cloudwatch:Describe*'
    );
  }
  
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: allowedActions,
        Resource: '*',
        Condition: {
          StringEquals: {
            'aws:RequestedRegion': connection.allowedRegions,
          },
        },
      },
      {
        Effect: 'Deny',
        Action: connection.deniedActions,
        Resource: '*',
      },
    ],
  });
};

class STSCredentialService {
  private static instance: STSCredentialService;
  
  // Credential cache (per plan execution)
  private credentialCache: Map<string, CredentialCacheEntry> = new Map();
  
  // Circuit breaker for STS throttling
  private circuitBreaker: CircuitBreakerState = {
    isOpen: false,
    failureCount: 0,
  };
  
  // Circuit breaker thresholds
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_RESET_MS = 30000; // 30 seconds
  private readonly BACKOFF_BASE_MS = 1000;
  private readonly BACKOFF_MAX_MS = 30000;
  
  // STS client (uses CostKatana's own credentials)
  private stsClient: STSClient;
  
  private constructor() {
    this.stsClient = new STSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    
    // Start cache cleanup interval
    this.startCacheCleanup();
  }
  
  public static getInstance(): STSCredentialService {
    if (!STSCredentialService.instance) {
      STSCredentialService.instance = new STSCredentialService();
    }
    return STSCredentialService.instance;
  }
  
  /**
   * Obtain temporary credentials by assuming the customer's role
   * This is the core STS AssumeRole operation
   */
  public async assumeRole(
    connection: IAWSConnection,
    planId?: string
  ): Promise<AssumeRoleResult> {
    // Check circuit breaker
    if (this.isCircuitBreakerOpen()) {
      throw new Error('STS circuit breaker is open - too many failures. Retry later.');
    }
    
    // Check kill switch
    const killSwitchCheck = killSwitchService.checkKillSwitch({
      customerId: connection.userId.toString(),
      connectionId: connection._id.toString(),
      service: 'sts',
      action: 'AssumeRole',
      isWrite: false,
      riskLevel: 'low',
    });
    
    if (!killSwitchCheck.allowed) {
      throw new Error(`Kill switch active: ${killSwitchCheck.reason}`);
    }
    
    // Check cache first
    const cacheKey = this.getCacheKey(connection._id.toString(), planId);
    const cached = this.credentialCache.get(cacheKey);
    
    if (cached && cached.expiresAt > new Date()) {
      cached.usageCount++;
      loggingService.info('Using cached STS credentials', {
        component: 'STSCredentialService',
        operation: 'assumeRole',
        connectionId: connection._id.toString(),
        usageCount: cached.usageCount,
      });
      
      return {
        credentials: cached.credentials,
        sessionName: `CostKatana-cached-${connection.userId}`,
        assumedRoleArn: connection.roleArn,
        latencyMs: 0,
      };
    }
    
    const startTime = Date.now();
    
    try {
      // Generate unique session name
      const sessionName = `CostKatana-${connection.userId}-${Date.now()}`;
      
      // Get decrypted external ID
      const externalId = connection.getDecryptedExternalId();
      
      // Get scoped policy for additional restrictions
      const scopedPolicy = getScopedPolicy(connection);
      
      // Assume the role
      const command = new AssumeRoleCommand({
        RoleArn: connection.roleArn,
        RoleSessionName: sessionName,
        ExternalId: externalId,
        DurationSeconds: connection.sessionConfig.maxDurationSeconds,
        Policy: scopedPolicy,
      });
      
      const response = await this.stsClient.send(command);
      
      if (!response.Credentials) {
        throw new Error('No credentials returned from STS');
      }
      
      const latencyMs = Date.now() - startTime;
      
      // Reset circuit breaker on success
      this.resetCircuitBreaker();
      
      // Update connection health
      await connection.updateHealth(true, undefined, latencyMs);
      
      const credentials: STSCredentials = {
        accessKeyId: response.Credentials.AccessKeyId!,
        secretAccessKey: response.Credentials.SecretAccessKey!,
        sessionToken: response.Credentials.SessionToken!,
        expiration: response.Credentials.Expiration!,
      };
      
      // Cache the credentials
      this.cacheCredentials(cacheKey, credentials, connection._id.toString(), planId);
      
      loggingService.info('STS AssumeRole successful', {
        component: 'STSCredentialService',
        operation: 'assumeRole',
        connectionId: connection._id.toString(),
        sessionName,
        expiresAt: credentials.expiration,
        latencyMs,
        // IMPORTANT: Never log actual credentials
      });
      
      return {
        credentials,
        sessionName,
        assumedRoleArn: response.AssumedRoleUser?.Arn || connection.roleArn,
        latencyMs,
      };
      
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      // Update circuit breaker
      this.recordFailure();
      
      // Update connection health
      await connection.updateHealth(
        false,
        error instanceof Error ? error.message : String(error),
        latencyMs
      );
      
      loggingService.error('STS AssumeRole failed', {
        component: 'STSCredentialService',
        operation: 'assumeRole',
        connectionId: connection._id.toString(),
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
        circuitBreakerState: this.circuitBreaker,
      });
      
      throw error;
    }
  }
  
  /**
   * Get credentials for a connection (with caching)
   */
  public async getCredentials(
    connectionId: Types.ObjectId,
    userId: Types.ObjectId,
    planId?: string
  ): Promise<STSCredentials> {
    const connection = await AWSConnection.findOne({
      _id: connectionId,
      userId,
      status: 'active',
    });
    
    if (!connection) {
      throw new Error('Connection not found or not active');
    }
    
    const result = await this.assumeRole(connection, planId);
    return result.credentials;
  }
  
  /**
   * Invalidate cached credentials for a connection
   * Note: This does NOT revoke the credentials - they remain valid until expiration
   */
  public invalidateCache(connectionId: string, planId?: string): void {
    const cacheKey = this.getCacheKey(connectionId, planId);
    this.credentialCache.delete(cacheKey);
    
    loggingService.info('Credential cache invalidated', {
      component: 'STSCredentialService',
      operation: 'invalidateCache',
      connectionId,
      planId,
      // Note: Credentials remain valid until AWS expiration
    });
  }
  
  /**
   * Get emergency stop instructions
   * IMPORTANT: STS credentials cannot be revoked - this documents the alternatives
   */
  public getEmergencyStopInstructions(roleArn: string): string {
    return `
# IMPORTANT: STS Credentials Cannot Be Revoked

AWS STS temporary credentials cannot be force-revoked once issued.
They automatically expire after the configured duration (max 15 minutes for CostKatana).

## To Immediately Stop CostKatana Access:

### Option 1: Remove Trust Relationship (Recommended)
Edit your IAM role's trust policy to remove CostKatana's AWS account.

### Option 2: Add Explicit Deny
Add this to your role's trust policy:
\`\`\`json
{
  "Effect": "Deny",
  "Principal": {
    "AWS": "arn:aws:iam::${process.env.COSTKATANA_AWS_ACCOUNT_ID}:root"
  },
  "Action": "sts:AssumeRole"
}
\`\`\`

### Option 3: Delete the Role
\`\`\`bash
aws iam delete-role --role-name ${roleArn.split('/').pop()}
\`\`\`

## What Happens After These Actions:
- New credential requests will fail immediately
- Existing credentials remain valid until they expire (max 15 minutes)
- No new API calls can be made after credentials expire

## Contact Support
For security incidents: security@costkatana.com
`;
  }
  
  /**
   * Get circuit breaker state
   */
  public getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }
  
  /**
   * Manually reset circuit breaker (admin operation)
   */
  public resetCircuitBreaker(): void {
    this.circuitBreaker = {
      isOpen: false,
      failureCount: 0,
    };
  }
  
  // Private methods
  
  private getCacheKey(connectionId: string, planId?: string): string {
    return planId ? `${connectionId}:${planId}` : connectionId;
  }
  
  private cacheCredentials(
    key: string,
    credentials: STSCredentials,
    connectionId: string,
    planId?: string
  ): void {
    // Cache until 1 minute before expiration (safety margin)
    const expiresAt = new Date(credentials.expiration.getTime() - 60000);
    
    this.credentialCache.set(key, {
      credentials,
      connectionId,
      planId,
      createdAt: new Date(),
      expiresAt,
      usageCount: 1,
    });
  }
  
  private isCircuitBreakerOpen(): boolean {
    if (!this.circuitBreaker.isOpen) {
      return false;
    }
    
    // Check if we should try again
    if (this.circuitBreaker.nextRetryAt && this.circuitBreaker.nextRetryAt <= new Date()) {
      // Half-open state - allow one request
      return false;
    }
    
    return true;
  }
  
  private recordFailure(): void {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailure = new Date();
    
    if (this.circuitBreaker.failureCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBreaker.isOpen = true;
      
      // Calculate backoff with exponential increase
      const backoffMs = Math.min(
        this.BACKOFF_BASE_MS * Math.pow(2, this.circuitBreaker.failureCount - this.CIRCUIT_BREAKER_THRESHOLD),
        this.BACKOFF_MAX_MS
      );
      
      this.circuitBreaker.nextRetryAt = new Date(Date.now() + backoffMs);
      
      loggingService.warn('STS circuit breaker opened', {
        component: 'STSCredentialService',
        operation: 'recordFailure',
        failureCount: this.circuitBreaker.failureCount,
        nextRetryAt: this.circuitBreaker.nextRetryAt,
      });
    }
  }
  
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = new Date();
      let cleaned = 0;
      
      for (const [key, entry] of this.credentialCache) {
        if (entry.expiresAt <= now) {
          this.credentialCache.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        loggingService.info('Credential cache cleanup', {
          component: 'STSCredentialService',
          operation: 'cacheCleanup',
          entriesRemoved: cleaned,
          remainingEntries: this.credentialCache.size,
        });
      }
    }, 60000); // Every minute
  }
}

export const stsCredentialService = STSCredentialService.getInstance();
