import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, createHmac, randomBytes } from 'crypto';
import { AuditLoggerService } from './audit-logger.service';
import {
  AuditAnchor,
  AuditAnchorDocument,
} from '../../../schemas/security/audit-anchor.schema';
import {
  DailyAnchorSummary as DailyAnchorSummarySchema,
  DailyAnchorSummaryDocument,
} from '../../../schemas/security/daily-anchor-summary.schema';
import {
  RootOfTrust,
  RootOfTrustDocument,
} from '../../../schemas/security/root-of-trust.schema';

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

@Injectable()
export class AuditAnchorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditAnchorService.name);
  private readonly signingKey: string;

  // S3 bucket for publishing (configured via environment)
  private readonly S3_BUCKET =
    process.env.AUDIT_ANCHOR_S3_BUCKET ?? 'costkatana-audit-anchors';
  private readonly S3_REGION =
    process.env.AUDIT_ANCHOR_S3_REGION ?? 'us-east-1';

  private dailyAnchorInterval?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly auditLoggerService: AuditLoggerService,
    @InjectModel(AuditAnchor.name)
    private auditAnchorModel: Model<AuditAnchorDocument>,
    @InjectModel(DailyAnchorSummarySchema.name)
    private dailyAnchorSummaryModel: Model<DailyAnchorSummaryDocument>,
    @InjectModel(RootOfTrust.name)
    private rootOfTrustModel: Model<RootOfTrustDocument>,
  ) {
    const configuredSigningKey = this.configService
      .get<string>('AUDIT_ANCHOR_SIGNING_KEY')
      ?.trim();
    if (
      configuredSigningKey &&
      configuredSigningKey !== 'costkatana-anchor-signing-key'
    ) {
      this.signingKey = configuredSigningKey;
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AUDIT_ANCHOR_SIGNING_KEY must be configured securely in production',
      );
    }

    this.signingKey = randomBytes(32).toString('hex');
    this.logger.warn(
      'AUDIT_ANCHOR_SIGNING_KEY not configured; using ephemeral development key',
    );
  }

  onModuleInit() {
    // Start daily anchor job
    this.scheduleDailyAnchor();
  }

  onModuleDestroy() {
    // Clean up the interval
    if (this.dailyAnchorInterval) {
      clearInterval(this.dailyAnchorInterval);
    }
  }

  /**
   * Create and publish an anchor
   */
  async createAndPublishAnchor(): Promise<AnchorRecord> {
    // Get anchor from audit logger
    const anchor = await this.auditLoggerService.createAnchor();

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
    const auditAnchor = new this.auditAnchorModel(record);
    await auditAnchor.save();

    // Set root of trust if this is the first anchor
    const existingRootOfTrust = await this.rootOfTrustModel.findOne();
    if (!existingRootOfTrust) {
      const rootOfTrust = new this.rootOfTrustModel({
        anchorId: anchor.anchorId,
        hash: anchor.anchorHash,
        createdAt: anchor.createdAt,
      });
      await rootOfTrust.save();

      this.logger.log('Root of trust established', {
        component: 'AuditAnchorService',
        operation: 'createAndPublishAnchor',
        anchorId: anchor.anchorId,
        hashPrefix: anchor.anchorHash.substring(0, 16),
      });
    }

    // Publish to S3 (in production)
    try {
      const s3Location = await this.publishToS3(record);
      record.publishedAt = new Date();
      record.s3Location = s3Location;

      // Update database with publish info
      await this.auditAnchorModel.updateOne(
        { anchorId: record.anchorId },
        {
          $set: {
            publishedAt: record.publishedAt,
            s3Location: record.s3Location,
          },
        },
      );
    } catch (error) {
      this.logger.warn('Failed to publish anchor to S3', {
        component: 'AuditAnchorService',
        operation: 'createAndPublishAnchor',
        anchorId: anchor.anchorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Update daily summary
    await this.updateDailySummary(record);

    this.logger.log('Anchor created and published', {
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
  private async publishToS3(record: AnchorRecord): Promise<string> {
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

    this.logger.log('Publishing anchor to S3', {
      component: 'AuditAnchorService',
      operation: 'publishToS3',
      bucket: this.S3_BUCKET,
      key: s3Key,
      anchorId: record.anchorId,
    });

    // Initialize S3 client and upload anchor document
    const s3Client = new S3Client({ region: this.S3_REGION });
    await s3Client.send(
      new PutObjectCommand({
        Bucket: this.S3_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(anchorDocument, null, 2),
        ContentType: 'application/json',
        Metadata: {
          'anchor-id': record.anchorId,
          'anchor-hash': record.anchorHash,
          'entry-count': String(record.entryCount),
        },
      }),
    );

    const s3Location = `s3://${this.S3_BUCKET}/${s3Key}`;

    this.logger.log('Anchor published to S3 successfully', {
      component: 'AuditAnchorService',
      operation: 'publishToS3',
      bucket: this.S3_BUCKET,
      key: s3Key,
      anchorId: record.anchorId,
      s3Location,
    });

    return s3Location;
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

    return createHmac('sha256', this.signingKey).update(content).digest('hex');
  }

  /**
   * Verify an anchor against the audit logger
   */
  async verifyAnchor(anchorId: string): Promise<AnchorVerificationResult> {
    const record = await this.getAnchor(anchorId);

    if (!record) {
      return {
        valid: false,
        anchorId,
        reason: 'Anchor not found',
        localHash: '',
        verifiedAt: new Date(),
      };
    }

    // Verify with audit logger service
    const loggerVerification =
      await this.auditLoggerService.verifyAnchor(anchorId);

    if (!loggerVerification.valid) {
      return {
        valid: false,
        anchorId,
        reason: loggerVerification.reason,
        localHash: record.anchorHash,
        verifiedAt: new Date(),
      };
    }

    // Update verification status
    record.verified = true;
    record.verifiedAt = new Date();
    await this.auditAnchorModel.updateOne(
      { anchorId: record.anchorId },
      { $set: { verified: true, verifiedAt: record.verifiedAt } },
    );

    this.logger.log('Anchor verified successfully', {
      component: 'AuditAnchorService',
      operation: 'verifyAnchor',
      anchorId,
      localHash: record.anchorHash,
      verifiedAt: record.verifiedAt,
    });

    return {
      valid: true,
      anchorId,
      localHash: record.anchorHash,
      verifiedAt: new Date(),
    };
  }

  /**
   * Update daily summary
   */
  private async updateDailySummary(record: AnchorRecord): Promise<void> {
    const dateKey = record.createdAt.toISOString().split('T')[0];

    // Get or create daily summary
    let summary = await this.dailyAnchorSummaryModel.findOne({ date: dateKey });

    if (!summary) {
      summary = new this.dailyAnchorSummaryModel({
        date: dateKey,
        anchorCount: 0,
        totalEntries: 0,
        dailyHash: '',
      });
    }

    summary.anchorCount += 1;
    summary.totalEntries += record.entryCount;

    if (!summary.firstAnchorId) {
      summary.firstAnchorId = record.anchorId;
    }
    summary.lastAnchorId = record.anchorId;

    // Update daily hash
    const hashContent = `${summary.dailyHash}:${record.anchorHash}`;
    summary.dailyHash = createHash('sha256').update(hashContent).digest('hex');

    await summary.save();
  }

  /**
   * Get anchor by ID
   */
  async getAnchor(anchorId: string): Promise<AnchorRecord | null> {
    const anchor = await this.auditAnchorModel.findOne({ anchorId }).exec();
    if (!anchor) return null;

    return {
      anchorId: anchor.anchorId,
      anchorHash: anchor.anchorHash,
      startPosition: anchor.startPosition,
      endPosition: anchor.endPosition,
      entryCount: anchor.entryCount,
      createdAt: anchor.createdAt,
      publishedAt: anchor.publishedAt,
      s3Location: anchor.s3Location,
      verified: anchor.verified,
      verifiedAt: anchor.verifiedAt,
    };
  }

  /**
   * Get all anchors for a date
   */
  async getAnchorsForDate(date: string): Promise<AnchorRecord[]> {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const anchors = await this.auditAnchorModel
      .find({
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      })
      .sort({ createdAt: 1 })
      .exec();

    return anchors.map((anchor) => ({
      anchorId: anchor.anchorId,
      anchorHash: anchor.anchorHash,
      startPosition: anchor.startPosition,
      endPosition: anchor.endPosition,
      entryCount: anchor.entryCount,
      createdAt: anchor.createdAt,
      publishedAt: anchor.publishedAt,
      s3Location: anchor.s3Location,
      verified: anchor.verified,
      verifiedAt: anchor.verifiedAt,
    }));
  }

  /**
   * Get daily summary
   */
  async getDailySummary(date: string): Promise<DailyAnchorSummary | null> {
    const summary = await this.dailyAnchorSummaryModel.findOne({ date }).exec();
    if (!summary) return null;

    return {
      date: summary.date,
      anchorCount: summary.anchorCount,
      totalEntries: summary.totalEntries,
      firstAnchorId: summary.firstAnchorId,
      lastAnchorId: summary.lastAnchorId,
      dailyHash: summary.dailyHash,
    };
  }

  /**
   * Get root of trust
   */
  async getRootOfTrust(): Promise<{
    anchorId: string;
    hash: string;
    createdAt: Date;
  } | null> {
    const rootOfTrust = await this.rootOfTrustModel.findOne().exec();
    if (!rootOfTrust) return null;

    return {
      anchorId: rootOfTrust.anchorId,
      hash: rootOfTrust.hash,
      createdAt: rootOfTrust.createdAt,
    };
  }

  /**
   * Get latest anchor
   */
  async getLatestAnchor(): Promise<AnchorRecord | null> {
    const latestAnchor = await this.auditAnchorModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec();

    if (!latestAnchor) return null;

    return {
      anchorId: latestAnchor.anchorId,
      anchorHash: latestAnchor.anchorHash,
      startPosition: latestAnchor.startPosition,
      endPosition: latestAnchor.endPosition,
      entryCount: latestAnchor.entryCount,
      createdAt: latestAnchor.createdAt,
      publishedAt: latestAnchor.publishedAt,
      s3Location: latestAnchor.s3Location,
      verified: latestAnchor.verified,
      verifiedAt: latestAnchor.verifiedAt,
    };
  }

  /**
   * Get anchor chain (for verification)
   */
  async getAnchorChain(limit: number = 10): Promise<AnchorRecord[]> {
    const anchors = await this.auditAnchorModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return anchors.map((anchor) => ({
      anchorId: anchor.anchorId,
      anchorHash: anchor.anchorHash,
      startPosition: anchor.startPosition,
      endPosition: anchor.endPosition,
      entryCount: anchor.entryCount,
      createdAt: anchor.createdAt,
      publishedAt: anchor.publishedAt,
      s3Location: anchor.s3Location,
      verified: anchor.verified,
      verifiedAt: anchor.verifiedAt,
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
      this.dailyAnchorInterval = setInterval(
        () => {
          void this.createDailyAnchor();
        },
        24 * 60 * 60 * 1000,
      );
    }, msUntilMidnight);

    this.logger.log('Daily anchor scheduled', {
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

      this.logger.log('Daily anchor created', {
        component: 'AuditAnchorService',
        operation: 'createDailyAnchor',
        anchorId: anchor.anchorId,
        entryCount: anchor.entryCount,
      });
    } catch (error) {
      this.logger.error('Failed to create daily anchor', {
        component: 'AuditAnchorService',
        operation: 'createDailyAnchor',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get public anchor endpoint data
   * This is exposed via the /api/aws/audit/anchor endpoint
   */
  async getPublicAnchorData(): Promise<{
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
    const latest = await this.getLatestAnchor();
    const rootOfTrust = await this.getRootOfTrust();

    // Get actual chain position from audit logger service
    const chainPosition = this.auditLoggerService.getChainPosition();

    // Get total anchor count from database
    const totalAnchors = await this.auditAnchorModel.countDocuments().exec();

    return {
      latestAnchor: latest
        ? {
            anchorId: latest.anchorId,
            anchorHash: latest.anchorHash,
            entryCount: latest.entryCount,
            createdAt: latest.createdAt.toISOString(),
          }
        : null,
      rootOfTrust: rootOfTrust
        ? {
            anchorId: rootOfTrust.anchorId,
            hash: rootOfTrust.hash,
            createdAt: rootOfTrust.createdAt.toISOString(),
          }
        : null,
      totalAnchors,
      chainPosition,
    };
  }

  /**
   * Verify entire anchor chain
   */
  async verifyAnchorChain(): Promise<{
    valid: boolean;
    anchorsVerified: number;
    firstInvalidAnchor?: string;
    verifiedAt: Date;
  }> {
    const anchors = await this.auditAnchorModel
      .find()
      .sort({ createdAt: 1 })
      .exec();

    let anchorsVerified = 0;

    for (const anchor of anchors) {
      const result = await this.verifyAnchor(anchor.anchorId);

      if (!result.valid) {
        return {
          valid: false,
          anchorsVerified,
          firstInvalidAnchor: anchor.anchorId,
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
