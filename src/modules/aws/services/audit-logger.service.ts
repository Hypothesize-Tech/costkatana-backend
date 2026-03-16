import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  AWSAuditLog,
  AWSAuditLogDocument,
  AuditEventType,
  AuditResult,
  IAuditContext,
  IAuditAction,
  IAuditImpact,
} from '../../../schemas/security/aws-audit-log.schema';
import {
  AuditAnchor as AuditAnchorSchema,
  AuditAnchorDocument,
} from '../../../schemas/security/audit-anchor.schema';

/**
 * Audit Logger Service - Immutable Hash-Chained Audit Trail
 *
 * Security Guarantees:
 * - Hash-chained audit entries (SHA-256)
 * - Previous hash reference for tamper detection
 * - Complete traceability: who, what, when, why, which permission
 * - Decision traces for blocked actions
 * - Periodic hash anchoring to external store
 * - Audit logs are hash-chained and periodically anchored
 */

export interface AuditLogEntry {
  eventType: AuditEventType;
  context: IAuditContext;
  action?: IAuditAction;
  result: AuditResult;
  error?: string;
  impact?: IAuditImpact;
  decisionTrace?: {
    intent?: string;
    interpretation?: string;
    approvalStatus?: string;
    blockedReason?: string;
    permissionCheck?: {
      allowed: boolean;
      reason?: string;
    };
  };
  metadata?: Record<string, any>;
}

export interface AuditQueryOptions {
  userId?: Types.ObjectId;
  connectionId?: Types.ObjectId;
  eventType?: AuditEventType | AuditEventType[];
  result?: AuditResult;
  startDate?: Date;
  endDate?: Date;
  planId?: string;
  limit?: number;
  offset?: number;
}

/** Anchor shape returned by this service (schema has verified) */
export interface AuditAnchor {
  anchorId: string;
  anchorHash: string;
  startPosition: number;
  endPosition: number;
  entryCount: number;
  verified?: boolean;
  createdAt: Date;
}

// Genesis hash (root of trust)
const GENESIS_HASH =
  'costkatana-genesis-2025-01-02-sha256:0000000000000000000000000000000000000000000000000000000000000000';

@Injectable()
export class AuditLoggerService implements OnModuleInit {
  // Chain position counter (in-memory, synced from DB on startup)
  private chainPosition: number = 0;
  private lastHash: string = GENESIS_HASH;
  private initialized: boolean = false;

  // Anchor storage is now persistent in database
  private lastAnchorPosition: number = 0;

  // Anchor interval (entries between anchors)
  private readonly ANCHOR_INTERVAL = 1000;

  constructor(
    @InjectModel(AWSAuditLog.name)
    private awsAuditLogModel: Model<AWSAuditLogDocument>,
    @InjectModel(AuditAnchorSchema.name)
    private auditAnchorModel: Model<AuditAnchorDocument>,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit() {
    await this.initialize();
  }

  /**
   * Initialize the audit logger by syncing with database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const latestEntry = await this.awsAuditLogModel
        .findOne()
        .sort({ chainPosition: -1 })
        .exec();

      if (latestEntry) {
        this.chainPosition = latestEntry.chainPosition;
        this.lastHash = latestEntry.entryHash;
      } else {
        this.chainPosition = 0;
        this.lastHash = GENESIS_HASH;
      }

      this.initialized = true;

      this.logger.log('Audit logger initialized', {
        component: 'AuditLoggerService',
        operation: 'initialize',
        chainPosition: this.chainPosition,
        lastHashPrefix: this.lastHash.substring(0, 16),
      });
    } catch (error) {
      this.logger.error('Failed to initialize audit logger', {
        component: 'AuditLoggerService',
        operation: 'initialize',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Log an audit entry with hash chaining
   */
  async log(entry: AuditLogEntry): Promise<AWSAuditLogDocument> {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Generate entry ID
    const entryId = `audit-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Increment chain position
    this.chainPosition += 1;

    // Create the audit log entry
    const auditEntry = new this.awsAuditLogModel({
      entryId,
      previousHash: this.lastHash,
      chainPosition: this.chainPosition,
      eventType: entry.eventType,
      timestamp: new Date(),
      context: entry.context,
      action: entry.action || {},
      result: entry.result,
      error: entry.error,
      impact: entry.impact || {},
      decisionTrace: entry.decisionTrace,
      metadata: entry.metadata,
    });

    // Calculate and set the entry hash
    auditEntry.entryHash = this.calculateAuditEntryHash(auditEntry);

    // Save to database
    await auditEntry.save();

    // Update last hash
    this.lastHash = auditEntry.entryHash;

    // Check if we need to create an anchor
    if (this.chainPosition - this.lastAnchorPosition >= this.ANCHOR_INTERVAL) {
      await this.createAnchor();
    }

    this.logger.log('Audit entry logged', {
      component: 'AuditLoggerService',
      operation: 'log',
      entryId,
      eventType: entry.eventType,
      chainPosition: this.chainPosition,
      hashPrefix: auditEntry.entryHash.substring(0, 16),
    });

    return auditEntry;
  }

  /**
   * Log a successful action
   */
  async logSuccess(
    eventType: AuditEventType,
    context: IAuditContext,
    action?: IAuditAction,
    impact?: IAuditImpact,
    metadata?: Record<string, any>,
  ): Promise<AWSAuditLogDocument> {
    return this.log({
      eventType,
      context,
      action,
      result: 'success',
      impact,
      metadata,
    });
  }

  /**
   * Log a failed action
   */
  async logFailure(
    eventType: AuditEventType,
    context: IAuditContext,
    action?: IAuditAction,
    error?: string,
    metadata?: Record<string, any>,
  ): Promise<AWSAuditLogDocument> {
    return this.log({
      eventType,
      context,
      action,
      result: 'failure',
      error,
      metadata,
    });
  }

  /**
   * Log a blocked action
   */
  async logBlocked(
    eventType: AuditEventType,
    context: IAuditContext,
    action?: IAuditAction,
    reason?: string,
    decisionTrace?: AuditLogEntry['decisionTrace'],
    metadata?: Record<string, any>,
  ): Promise<AWSAuditLogDocument> {
    return this.log({
      eventType,
      context,
      action,
      result: 'blocked',
      error: reason,
      decisionTrace,
      metadata,
    });
  }

  /**
   * Query audit logs
   */
  async query(options: AuditQueryOptions = {}): Promise<AWSAuditLogDocument[]> {
    const query: any = {};

    if (options.userId) {
      query['context.userId'] = options.userId;
    }

    if (options.connectionId) {
      query['context.connectionId'] = options.connectionId;
    }

    if (options.eventType) {
      if (Array.isArray(options.eventType)) {
        query.eventType = { $in: options.eventType };
      } else {
        query.eventType = options.eventType;
      }
    }

    if (options.result) {
      query.result = options.result;
    }

    if (options.planId) {
      query['action.planId'] = options.planId;
    }

    if (options.startDate || options.endDate) {
      query.timestamp = {};
      if (options.startDate) {
        query.timestamp.$gte = options.startDate;
      }
      if (options.endDate) {
        query.timestamp.$lte = options.endDate;
      }
    }

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    return this.awsAuditLogModel
      .find(query)
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .exec();
  }

  /**
   * Get recent audit logs (convenience method for security dashboard and reports)
   */
  async getRecentAuditLogs(
    limit: number = 100,
  ): Promise<AWSAuditLogDocument[]> {
    return this.query({
      limit,
      startDate: new Date(0),
      endDate: new Date(),
    });
  }

  /**
   * Verify the integrity of the audit chain
   */
  async verifyChain(
    startPosition?: number,
    endPosition?: number,
  ): Promise<{
    valid: boolean;
    checkedEntries: number;
    invalidEntries: number[];
    verifiedUpTo: number;
  }> {
    const start = startPosition || 1;
    const end = endPosition || this.chainPosition;

    let currentHash = GENESIS_HASH;
    const invalidEntries: number[] = [];
    let checkedEntries = 0;

    const entries = await this.awsAuditLogModel
      .find({
        chainPosition: { $gte: start, $lte: end },
      })
      .sort({ chainPosition: 1 })
      .exec();

    for (const entry of entries) {
      checkedEntries++;

      // Verify previous hash matches
      if (entry.previousHash !== currentHash) {
        invalidEntries.push(entry.chainPosition);
        break; // Chain is broken
      }

      // Verify entry hash
      const calculatedHash = this.calculateAuditEntryHash(entry);
      if (calculatedHash !== entry.entryHash) {
        invalidEntries.push(entry.chainPosition);
        break;
      }

      currentHash = entry.entryHash;
    }

    return {
      valid: invalidEntries.length === 0,
      checkedEntries,
      invalidEntries,
      verifiedUpTo: invalidEntries.length > 0 ? invalidEntries[0] - 1 : end,
    };
  }

  /**
   * Create an anchor point for external verification
   */
  async createAnchor(): Promise<AuditAnchor> {
    const anchorId = `anchor-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const startPosition = this.lastAnchorPosition + 1;
    const endPosition = this.chainPosition;
    const entryCount = endPosition - startPosition + 1;

    const anchor: AuditAnchor = {
      anchorId,
      anchorHash: this.lastHash,
      startPosition,
      endPosition,
      entryCount,
      verified: false,
      createdAt: new Date(),
    };

    // Store anchor in database
    try {
      await this.auditAnchorModel.create(anchor);
      this.lastAnchorPosition = endPosition;

      this.logger.log('Audit anchor created and stored in database', {
        component: 'AuditLoggerService',
        operation: 'createAnchor',
        anchorId,
        startPosition,
        endPosition,
        entryCount,
        hashPrefix: anchor.anchorHash.substring(0, 16),
      });
    } catch (error) {
      this.logger.error('Failed to store audit anchor in database', {
        component: 'AuditLoggerService',
        operation: 'createAnchor',
        anchorId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return anchor;
  }

  /**
   * Get all anchors
   */
  async getAnchors(): Promise<AuditAnchor[]> {
    try {
      const anchorDocs = await this.auditAnchorModel
        .find({})
        .sort({ createdAt: -1 })
        .lean();

      return anchorDocs.map((doc) => ({
        anchorId: doc.anchorId,
        anchorHash: doc.anchorHash,
        startPosition: doc.startPosition,
        endPosition: doc.endPosition,
        entryCount: doc.entryCount,
        verified: (doc as { verified?: boolean }).verified ?? false,
        createdAt: doc.createdAt,
      }));
    } catch (error) {
      this.logger.error('Failed to get anchors from database', {
        component: 'AuditLoggerService',
        operation: 'getAnchors',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get anchor by ID
   */
  async getAnchor(anchorId: string): Promise<AuditAnchor | null> {
    try {
      const anchorDoc = await this.auditAnchorModel
        .findOne({ anchorId })
        .lean();
      if (!anchorDoc) {
        return null;
      }

      return {
        anchorId: anchorDoc.anchorId,
        anchorHash: anchorDoc.anchorHash,
        startPosition: anchorDoc.startPosition,
        endPosition: anchorDoc.endPosition,
        entryCount: anchorDoc.entryCount,
        verified: (anchorDoc as { verified?: boolean }).verified ?? false,
        createdAt: anchorDoc.createdAt,
      };
    } catch (error) {
      this.logger.error('Failed to get anchor from database', {
        component: 'AuditLoggerService',
        operation: 'getAnchor',
        anchorId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Verify an anchor by recalculating its hash from database entries
   */
  async verifyAnchor(anchorId: string): Promise<{
    valid: boolean;
    reason?: string;
  }> {
    const anchor = await this.getAnchor(anchorId);

    if (!anchor) {
      return { valid: false, reason: 'Anchor not found' };
    }

    // Get entries in anchor range from database
    const entries = await this.awsAuditLogModel
      .find({
        chainPosition: { $gte: anchor.startPosition, $lte: anchor.endPosition },
      })
      .sort({ chainPosition: 1 })
      .exec();

    if (entries.length !== anchor.entryCount) {
      return { valid: false, reason: 'Entry count mismatch' };
    }

    // Recalculate anchor hash from entry hashes
    const hashContent = entries.map((e) => e.entryHash).join(':');
    const calculatedHash = createHash('sha256')
      .update(hashContent)
      .digest('hex');

    if (calculatedHash !== anchor.anchorHash) {
      return {
        valid: false,
        reason: 'Anchor hash mismatch - possible tampering',
      };
    }

    return { valid: true };
  }

  /**
   * Get current chain position
   */
  getChainPosition(): number {
    return this.chainPosition;
  }

  /**
   * Get genesis hash
   */
  getGenesisHash(): string {
    return GENESIS_HASH;
  }

  /**
   * Calculate audit entry hash
   */
  private calculateAuditEntryHash(entry: Partial<AWSAuditLogDocument>): string {
    const dataToHash = {
      entryId: entry.entryId,
      previousHash: entry.previousHash,
      chainPosition: entry.chainPosition,
      eventType: entry.eventType,
      timestamp: entry.timestamp?.toISOString(),
      context: entry.context,
      action: entry.action,
      result: entry.result,
      error: entry.error,
      impact: entry.impact,
      decisionTrace: entry.decisionTrace,
      metadata: entry.metadata,
    };

    const hashData = JSON.stringify(dataToHash, Object.keys(dataToHash).sort());
    return createHash('sha256').update(hashData).digest('hex');
  }
}
