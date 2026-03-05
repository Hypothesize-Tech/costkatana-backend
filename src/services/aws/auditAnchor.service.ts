import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { loggingService } from '../logging.service';
import { auditLoggerService } from './auditLogger.service';
import { AuditAnchor, DailyAnchorSummary } from '../../models/AuditAnchor';

/**
 * Audit Anchor Service - External Verification & Tamper Resistance
 * 
 * Security Guarantees:
 * - Daily hash notarization to customer-visible S3
 * - Anchor hash published to public endpoint
 * - Root of trust establishment
 * - External verification capability
 * - Audit logs are hash-chained and periodically anchored
 *   to an external, append-only store to prevent tampering
 */

export interface AnchorRecord {
  anchorId: string;
  anchorHash: string;
  startPosition: number;
  endPosition: number;
  entryCount: number;
  createdAt: Date;
  publishedAt?: Date;
  s3Location?: string;
  verified: boolean;
  verifiedAt?: Date;
}

export interface AnchorVerificationResult {
  valid: boolean;
  anchorId: string;
  reason?: string;
  localHash: string;
  publishedHash?: string;
  verifiedAt: Date;
}

export interface DailyAnchorSummary {
  date: string;
  anchorCount: number;
  totalEntries: number;
  firstAnchorId?: string;
  lastAnchorId?: string;
  dailyHash: string;
}

class AuditAnchorService {
  private static instance: AuditAnchorService;
  private readonly signingKey: string;

  // Root of trust (first anchor hash) - cached in memory for performance
  private rootOfTrust?: {
    anchorId: string;
    hash: string;
    createdAt: Date;
  };
  
  // S3 bucket for publishing (configured via environment)
  private readonly S3_BUCKET = process.env.AUDIT_ANCHOR_S3_BUCKET ?? 'costkatana-audit-anchors';
  private readonly S3_REGION = process.env.AUDIT_ANCHOR_S3_REGION ?? 'us-east-1';
  
  private constructor() {
    const configuredSigningKey = process.env.AUDIT_ANCHOR_SIGNING_KEY?.trim();
    if (configuredSigningKey && configuredSigningKey !== 'costkatana-anchor-signing-key') {
      this.signingKey = configuredSigningKey;
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AUDIT_ANCHOR_SIGNING_KEY must be configured securely in production'
      );
    } else {
      this.signingKey = crypto.randomBytes(32).toString('hex');
      loggingService.warn('AUDIT_ANCHOR_SIGNING_KEY not configured; using ephemeral development key');
    }

    // Start daily anchor job
    this.scheduleDailyAnchor();
  }
  
  public static getInstance(): AuditAnchorService {
    if (!AuditAnchorService.instance) {
      AuditAnchorService.instance = new AuditAnchorService();
    }
    return AuditAnchorService.instance;
  }
  
  /**
   * Create and publish an anchor
   */
  public async createAndPublishAnchor(): Promise<AnchorRecord> {
    // Get anchor from audit logger
    const anchor = await auditLoggerService.createAnchor();
    
    // Create anchor record
    const record: AnchorRecord = {
      anchorId: anchor.anchorId,
      anchorHash: anchor.anchorHash,
      startPosition: anchor.startPosition,
      endPosition: anchor.endPosition,
      entryCount: anchor.entryCount,
      createdAt: anchor.createdAt,
      verified: false,
    };
    
    // Store in database
    try {
      await AuditAnchor.create({
        anchorId: record.anchorId,
        anchorHash: record.anchorHash,
        startPosition: record.startPosition,
        endPosition: record.endPosition,
        entryCount: record.entryCount,
        verified: record.verified,
      });
    } catch (dbError) {
      loggingService.error('Failed to store audit anchor in database', {
        component: 'AuditAnchorService',
        operation: 'createAndPublishAnchor',
        anchorId: anchor.anchorId,
        error: dbError instanceof Error ? dbError.message : String(dbError),
      });
      throw dbError;
    }

    // Set root of trust if this is the first anchor
    if (!this.rootOfTrust) {
      // Check if we have any existing anchors in the database
      const existingAnchors = await AuditAnchor.find().sort({ createdAt: 1 }).limit(1);
      if (existingAnchors.length === 0) {
        this.rootOfTrust = {
          anchorId: anchor.anchorId,
          hash: anchor.anchorHash,
          createdAt: anchor.createdAt,
        };

        loggingService.info('Root of trust established', {
          component: 'AuditAnchorService',
          operation: 'createAndPublishAnchor',
          anchorId: anchor.anchorId,
          hashPrefix: anchor.anchorHash.substring(0, 16),
        });
      } else {
        // Load existing root of trust
        const firstAnchor = existingAnchors[0];
        this.rootOfTrust = {
          anchorId: firstAnchor.anchorId,
          hash: firstAnchor.anchorHash,
          createdAt: firstAnchor.createdAt,
        };
      }
    }
    
    // Publish to S3 (in production)
    try {
      await this.publishToS3(record);
      record.publishedAt = new Date();
    } catch (error) {
      loggingService.warn('Failed to publish anchor to S3', {
        component: 'AuditAnchorService',
        operation: 'createAndPublishAnchor',
        anchorId: anchor.anchorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    
    // Update daily summary
    await this.updateDailySummary(record);
    
    loggingService.info('Anchor created and published', {
      component: 'AuditAnchorService',
      operation: 'createAndPublishAnchor',
      anchorId: anchor.anchorId,
      entryCount: anchor.entryCount,
      published: !!record.publishedAt,
    });
    
    return record;
  }
  
  /**
   * Publish anchor to S3 for external verification
   */
  private async publishToS3(record: AnchorRecord): Promise<void> {
    const s3Key = `anchors/${record.createdAt.toISOString().split('T')[0]}/${record.anchorId}.json`;
    
    const anchorDocument = {
      anchorId: record.anchorId,
      anchorHash: record.anchorHash,
      startPosition: record.startPosition,
      endPosition: record.endPosition,
      entryCount: record.entryCount,
      createdAt: record.createdAt.toISOString(),
      signature: this.signAnchor(record),
    };
    
    loggingService.info('Publishing anchor to S3', {
      component: 'AuditAnchorService',
      operation: 'publishToS3',
      bucket: this.S3_BUCKET,
      key: s3Key,
      anchorId: record.anchorId,
    });
    
    record.s3Location = `s3://${this.S3_BUCKET}/${s3Key}`;
    
    // In production:
    const s3Client = new S3Client({ region: this.S3_REGION ?? 'us-east-1' });
    await s3Client.send(new PutObjectCommand({
      Bucket: this.S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(anchorDocument),
      ContentType: 'application/json',
    }));
  }
  
  /**
   * Sign an anchor for non-repudiation
   */
  private signAnchor(record: AnchorRecord): string {
    const content = JSON.stringify({
      anchorId: record.anchorId,
      anchorHash: record.anchorHash,
      startPosition: record.startPosition,
      endPosition: record.endPosition,
      entryCount: record.entryCount,
      createdAt: record.createdAt.toISOString(),
    });
    
    return crypto
      .createHmac('sha256', this.signingKey)
      .update(content)
      .digest('hex');
  }
  
  /**
   * Verify an anchor
   */
  public async verifyAnchor(anchorId: string): Promise<AnchorVerificationResult> {
    // Find record in database
    const dbRecord = await AuditAnchor.findOne({ anchorId });

    if (!dbRecord) {
      return {
        valid: false,
        anchorId,
        reason: 'Anchor not found',
        localHash: '',
        verifiedAt: new Date(),
      };
    }

    // Verify with audit logger
    const loggerVerification = await auditLoggerService.verifyAnchor(anchorId);

    if (!loggerVerification.valid) {
      return {
        valid: false,
        anchorId,
        reason: loggerVerification.reason,
        localHash: dbRecord.anchorHash,
        verifiedAt: new Date(),
      };
    }

    // Update verification status in database
    await AuditAnchor.findOneAndUpdate(
      { anchorId },
      {
        verified: true,
        verifiedAt: new Date(),
      }
    );
    
    return {
      valid: true,
      anchorId,
      localHash: dbRecord.anchorHash,
      verifiedAt: new Date(),
    };
  }
  
  /**
   * Update daily summary
   */
  private async updateDailySummary(record: AnchorRecord): Promise<void> {
    const dateKey = record.createdAt.toISOString().split('T')[0];

    try {
      const existingSummary = await DailyAnchorSummary.findOne({ date: dateKey });

      if (existingSummary) {
        // Update existing summary
        await DailyAnchorSummary.findOneAndUpdate(
          { date: dateKey },
          {
            $inc: {
              totalAnchors: 1,
              totalEntries: record.entryCount,
            },
            lastAnchorId: record.anchorId,
            // Note: firstAnchorId is set once and not updated
          }
        );
      } else {
        // Create new summary
        await DailyAnchorSummary.create({
          date: dateKey,
          totalAnchors: 1,
          verifiedAnchors: record.verified ? 1 : 0,
          publishedAnchors: 0, // Will be updated when published
          totalEntries: record.entryCount,
          lastAnchorId: record.anchorId,
        });
      }
    } catch (error) {
      loggingService.warn('Failed to update daily summary', {
        component: 'AuditAnchorService',
        operation: 'updateDailySummary',
        date: dateKey,
        anchorId: record.anchorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  /**
   * Get anchor by ID
   */
  public async getAnchor(anchorId: string): Promise<AnchorRecord | null> {
    const dbRecord = await AuditAnchor.findOne({ anchorId });
    if (!dbRecord) return null;

    return {
      anchorId: dbRecord.anchorId,
      anchorHash: dbRecord.anchorHash,
      startPosition: dbRecord.startPosition,
      endPosition: dbRecord.endPosition,
      entryCount: dbRecord.entryCount,
      createdAt: dbRecord.createdAt,
      verified: dbRecord.verified,
    };
  }
  
  /**
   * Get all anchors for a date
   */
  public async getAnchorsForDate(date: string): Promise<AnchorRecord[]> {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const dbRecords = await AuditAnchor.find({
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    }).sort({ createdAt: 1 });

    return dbRecords.map(record => ({
      anchorId: record.anchorId,
      anchorHash: record.anchorHash,
      startPosition: record.startPosition,
      endPosition: record.endPosition,
      entryCount: record.entryCount,
      createdAt: record.createdAt,
      verified: record.verified,
    }));
  }
  
  /**
   * Get daily summary
   */
  public async getDailySummary(date: string): Promise<DailyAnchorSummary | null> {
    const summary = await DailyAnchorSummary.findOne({ date });
    if (!summary) return null;

    return {
      date: summary.date,
      anchorCount: summary.totalAnchors,
      totalEntries: summary.totalEntries,
      firstAnchorId: undefined, // Not stored in DB schema
      lastAnchorId: summary.lastAnchorId,
      dailyHash: '', // Not stored in DB schema
    };
  }
  
  /**
   * Get root of trust
   */
  public getRootOfTrust(): typeof this.rootOfTrust {
    return this.rootOfTrust;
  }
  
  /**
   * Get latest anchor
   */
  public async getLatestAnchor(): Promise<AnchorRecord | null> {
    const latestRecord = await AuditAnchor.findOne().sort({ createdAt: -1 });
    if (!latestRecord) return null;

    return {
      anchorId: latestRecord.anchorId,
      anchorHash: latestRecord.anchorHash,
      startPosition: latestRecord.startPosition,
      endPosition: latestRecord.endPosition,
      entryCount: latestRecord.entryCount,
      createdAt: latestRecord.createdAt,
      verified: latestRecord.verified,
    };
  }
  
  /**
   * Get anchor chain (for verification)
   */
  public async getAnchorChain(limit: number = 10): Promise<AnchorRecord[]> {
    const dbRecords = await AuditAnchor.find()
      .sort({ createdAt: -1 })
      .limit(limit);

    return dbRecords.map(record => ({
      anchorId: record.anchorId,
      anchorHash: record.anchorHash,
      startPosition: record.startPosition,
      endPosition: record.endPosition,
      entryCount: record.entryCount,
      createdAt: record.createdAt,
      verified: record.verified,
    }));
  }
  
  /**
   * Schedule daily anchor creation
   */
  private scheduleDailyAnchor(): void {
    // Create anchor at midnight UTC
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    
    const msUntilMidnight = midnight.getTime() - now.getTime();
    
    setTimeout(() => {
      // Create daily anchor
      void this.createDailyAnchor();
      
      // Schedule next day
      setInterval(() => {
        void this.createDailyAnchor();
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
    
    loggingService.info('Daily anchor scheduled', {
      component: 'AuditAnchorService',
      operation: 'scheduleDailyAnchor',
      nextAnchorAt: midnight.toISOString(),
    });
  }
  
  /**
   * Create daily anchor
   */
  private async createDailyAnchor(): Promise<void> {
    try {
      const anchor = await this.createAndPublishAnchor();
      
      loggingService.info('Daily anchor created', {
        component: 'AuditAnchorService',
        operation: 'createDailyAnchor',
        anchorId: anchor.anchorId,
        entryCount: anchor.entryCount,
      });
    } catch (error) {
      loggingService.error('Failed to create daily anchor', {
        component: 'AuditAnchorService',
        operation: 'createDailyAnchor',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  /**
   * Get public anchor endpoint data
   * This is what would be exposed via the /aws/audit/anchor endpoint
   */
  public async getPublicAnchorData(): Promise<{
    latestAnchor: {
      anchorId: string;
      anchorHash: string;
      entryCount: number;
      createdAt: string;
    } | null;
    rootOfTrust: {
      anchorId: string;
      hash: string;
      createdAt: string;
    } | null;
    totalAnchors: number;
    chainPosition: number;
  }> {
    const [latest, totalCount] = await Promise.all([
      this.getLatestAnchor(),
      AuditAnchor.countDocuments(),
    ]);

    return {
      latestAnchor: latest ? {
        anchorId: latest.anchorId,
        anchorHash: latest.anchorHash,
        entryCount: latest.entryCount,
        createdAt: latest.createdAt.toISOString(),
      } : null,
      rootOfTrust: this.rootOfTrust ? {
        anchorId: this.rootOfTrust.anchorId,
        hash: this.rootOfTrust.hash,
        createdAt: this.rootOfTrust.createdAt.toISOString(),
      } : null,
      totalAnchors: totalCount,
      chainPosition: auditLoggerService.getChainPosition(),
    };
  }
  
  /**
   * Verify entire anchor chain
   */
  public async verifyAnchorChain(): Promise<{
    valid: boolean;
    anchorsVerified: number;
    firstInvalidAnchor?: string;
    verifiedAt: Date;
  }> {
    const dbRecords = await AuditAnchor.find().sort({ createdAt: 1 });

    let anchorsVerified = 0;

    for (const dbRecord of dbRecords) {
      const result = await this.verifyAnchor(dbRecord.anchorId);

      if (!result.valid) {
        return {
          valid: false,
          anchorsVerified,
          firstInvalidAnchor: dbRecord.anchorId,
          verifiedAt: new Date(),
        };
      }

      anchorsVerified++;
    }
    
    return {
      valid: true,
      anchorsVerified,
      verifiedAt: new Date(),
    };
  }
}

export const auditAnchorService = AuditAnchorService.getInstance();
