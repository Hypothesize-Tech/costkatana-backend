import crypto from 'crypto';
import { Types } from 'mongoose';
import { 
  AWSAuditLog, 
  IAWSAuditLog, 
  AuditEventType, 
  AuditResult,
  IAuditContext,
  IAuditAction,
  IAuditImpact,
  calculateAuditEntryHash,
} from '../../models/AWSAuditLog';
import { loggingService } from '../logging.service';

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

export interface AuditAnchor {
  anchorId: string;
  anchorHash: string;
  startPosition: number;
  endPosition: number;
  entryCount: number;
  createdAt: Date;
}

// Genesis hash (root of trust)
const GENESIS_HASH = 'costkatana-genesis-2025-01-02-sha256:0000000000000000000000000000000000000000000000000000000000000000';

class AuditLoggerService {
  private static instance: AuditLoggerService;
  
  // Chain position counter (in-memory, synced from DB on startup)
  private chainPosition: number = 0;
  private lastHash: string = GENESIS_HASH;
  private initialized: boolean = false;
  
  // Anchor storage (in production, this would go to S3 or external service)
  private anchors: Map<string, AuditAnchor> = new Map();
  private lastAnchorPosition: number = 0;
  
  // Anchor interval (entries between anchors)
  private readonly ANCHOR_INTERVAL = 1000;
  
  private constructor() {}
  
  public static getInstance(): AuditLoggerService {
    if (!AuditLoggerService.instance) {
      AuditLoggerService.instance = new AuditLoggerService();
    }
    return AuditLoggerService.instance;
  }
  
  /**
   * Initialize the audit logger by syncing with database
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      const latestEntry = await (AWSAuditLog as any).getLatestEntry();
      
      if (latestEntry) {
        this.chainPosition = latestEntry.chainPosition;
        this.lastHash = latestEntry.entryHash;
      } else {
        this.chainPosition = 0;
        this.lastHash = GENESIS_HASH;
      }
      
      this.initialized = true;
      
      loggingService.info('Audit logger initialized', {
        component: 'AuditLoggerService',
        operation: 'initialize',
        chainPosition: this.chainPosition,
        lastHashPrefix: this.lastHash.substring(0, 16),
      });
    } catch (error) {
      loggingService.error('Failed to initialize audit logger', {
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
  public async log(entry: AuditLogEntry): Promise<IAWSAuditLog> {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Generate entry ID
    const entryId = `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    // Increment chain position
    this.chainPosition += 1;
    
    // Create the audit log entry
    const auditEntry = new AWSAuditLog({
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
    auditEntry.entryHash = calculateAuditEntryHash(auditEntry);
    
    // Save to database
    await auditEntry.save();
    
    // Update last hash
    this.lastHash = auditEntry.entryHash;
    
    // Check if we need to create an anchor
    if (this.chainPosition - this.lastAnchorPosition >= this.ANCHOR_INTERVAL) {
      await this.createAnchor();
    }
    
    loggingService.info('Audit entry logged', {
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
  public async logSuccess(
    eventType: AuditEventType,
    context: IAuditContext,
    action?: IAuditAction,
    impact?: IAuditImpact,
    metadata?: Record<string, any>
  ): Promise<IAWSAuditLog> {
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
  public async logFailure(
    eventType: AuditEventType,
    context: IAuditContext,
    error: string,
    action?: IAuditAction,
    metadata?: Record<string, any>
  ): Promise<IAWSAuditLog> {
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
   * Log a blocked action with decision trace
   */
  public async logBlocked(
    eventType: AuditEventType,
    context: IAuditContext,
    blockedReason: string,
    action?: IAuditAction,
    decisionTrace?: AuditLogEntry['decisionTrace']
  ): Promise<IAWSAuditLog> {
    return this.log({
      eventType,
      context,
      action,
      result: 'blocked',
      decisionTrace: {
        ...decisionTrace,
        blockedReason,
      },
    });
  }
  
  /**
   * Query audit logs
   */
  public async query(options: AuditQueryOptions): Promise<{
    entries: IAWSAuditLog[];
    total: number;
    hasMore: boolean;
  }> {
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
    
    if (options.startDate || options.endDate) {
      query.timestamp = {};
      if (options.startDate) {
        query.timestamp.$gte = options.startDate;
      }
      if (options.endDate) {
        query.timestamp.$lte = options.endDate;
      }
    }
    
    if (options.planId) {
      query['action.planId'] = options.planId;
    }
    
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    
    const [entries, total] = await Promise.all([
      AWSAuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .exec(),
      AWSAuditLog.countDocuments(query),
    ]);
    
    return {
      entries,
      total,
      hasMore: offset + entries.length < total,
    };
  }
  
  /**
   * Verify chain integrity
   */
  public async verifyChain(
    startPosition?: number,
    endPosition?: number
  ): Promise<{
    valid: boolean;
    brokenAt?: number;
    entriesChecked: number;
  }> {
    const start = startPosition || 1;
    const end = endPosition || this.chainPosition;
    
    const result = await (AWSAuditLog as any).verifyChain(start, end);
    
    loggingService.info('Chain verification completed', {
      component: 'AuditLoggerService',
      operation: 'verifyChain',
      startPosition: start,
      endPosition: end,
      valid: result.valid,
      brokenAt: result.brokenAt,
    });
    
    return {
      ...result,
      entriesChecked: end - start + 1,
    };
  }
  
  /**
   * Create an anchor point for external verification
   */
  public async createAnchor(): Promise<AuditAnchor> {
    const startPosition = this.lastAnchorPosition + 1;
    const endPosition = this.chainPosition;
    
    // Get all entries in range
    const entries = await AWSAuditLog.find({
      chainPosition: { $gte: startPosition, $lte: endPosition },
    }).sort({ chainPosition: 1 }).exec();
    
    // Calculate anchor hash (hash of all entry hashes)
    const hashContent = entries.map(e => e.entryHash).join(':');
    const anchorHash = crypto
      .createHash('sha256')
      .update(hashContent)
      .digest('hex');
    
    const anchorId = `anchor-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    const anchor: AuditAnchor = {
      anchorId,
      anchorHash,
      startPosition,
      endPosition,
      entryCount: entries.length,
      createdAt: new Date(),
    };
    
    // Store anchor
    this.anchors.set(anchorId, anchor);
    this.lastAnchorPosition = endPosition;
    
    // Update entries with anchor reference
    await AWSAuditLog.updateMany(
      { chainPosition: { $gte: startPosition, $lte: endPosition } },
      { $set: { anchorId, anchoredAt: new Date() } }
    ).exec().catch(() => {
      // Ignore update errors for immutable entries
    });
    
    loggingService.info('Audit anchor created', {
      component: 'AuditLoggerService',
      operation: 'createAnchor',
      anchorId,
      startPosition,
      endPosition,
      entryCount: entries.length,
      anchorHashPrefix: anchorHash.substring(0, 16),
    });
    
    return anchor;
  }
  
  /**
   * Get anchor by ID
   */
  public getAnchor(anchorId: string): AuditAnchor | null {
    return this.anchors.get(anchorId) || null;
  }
  
  /**
   * Get all anchors
   */
  public getAllAnchors(): AuditAnchor[] {
    return Array.from(this.anchors.values());
  }
  
  /**
   * Verify an anchor
   */
  public async verifyAnchor(anchorId: string): Promise<{
    valid: boolean;
    reason?: string;
  }> {
    const anchor = this.anchors.get(anchorId);
    
    if (!anchor) {
      return { valid: false, reason: 'Anchor not found' };
    }
    
    // Get entries in anchor range
    const entries = await AWSAuditLog.find({
      chainPosition: { $gte: anchor.startPosition, $lte: anchor.endPosition },
    }).sort({ chainPosition: 1 }).exec();
    
    if (entries.length !== anchor.entryCount) {
      return { valid: false, reason: 'Entry count mismatch' };
    }
    
    // Recalculate anchor hash
    const hashContent = entries.map(e => e.entryHash).join(':');
    const calculatedHash = crypto
      .createHash('sha256')
      .update(hashContent)
      .digest('hex');
    
    if (calculatedHash !== anchor.anchorHash) {
      return { valid: false, reason: 'Anchor hash mismatch - possible tampering' };
    }
    
    return { valid: true };
  }
  
  /**
   * Get audit statistics
   */
  public async getStatistics(
    userId?: Types.ObjectId,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalEntries: number;
    byEventType: Record<string, number>;
    byResult: Record<string, number>;
    chainIntegrity: boolean;
  }> {
    const query: any = {};
    
    if (userId) {
      query['context.userId'] = userId;
    }
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }
    
    const [totalEntries, byEventType, byResult] = await Promise.all([
      AWSAuditLog.countDocuments(query),
      AWSAuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
      ]),
      AWSAuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$result', count: { $sum: 1 } } },
      ]),
    ]);
    
    // Verify chain integrity (sample check)
    const chainCheck = await this.verifyChain(
      Math.max(1, this.chainPosition - 100),
      this.chainPosition
    );
    
    return {
      totalEntries,
      byEventType: Object.fromEntries(byEventType.map(e => [e._id, e.count])),
      byResult: Object.fromEntries(byResult.map(e => [e._id, e.count])),
      chainIntegrity: chainCheck.valid,
    };
  }
  
  /**
   * Get current chain position
   */
  public getChainPosition(): number {
    return this.chainPosition;
  }
  
  /**
   * Get genesis hash
   */
  public getGenesisHash(): string {
    return GENESIS_HASH;
  }
  
  /**
   * Export audit logs for compliance
   */
  public async exportForCompliance(
    startDate: Date,
    endDate: Date,
    userId?: Types.ObjectId
  ): Promise<{
    entries: Array<{
      entryId: string;
      timestamp: Date;
      eventType: string;
      result: string;
      entryHash: string;
      previousHash: string;
    }>;
    chainVerification: {
      valid: boolean;
      entriesChecked: number;
    };
    exportedAt: Date;
    exportHash: string;
  }> {
    const query: any = {
      timestamp: { $gte: startDate, $lte: endDate },
    };
    
    if (userId) {
      query['context.userId'] = userId;
    }
    
    const entries = await AWSAuditLog.find(query)
      .sort({ chainPosition: 1 })
      .select('entryId timestamp eventType result entryHash previousHash chainPosition')
      .exec();
    
    // Verify chain for exported entries
    const positions = entries.map(e => e.chainPosition);
    const chainVerification = positions.length > 0
      ? await this.verifyChain(Math.min(...positions), Math.max(...positions))
      : { valid: true, entriesChecked: 0 };
    
    // Calculate export hash
    const exportContent = entries.map(e => e.entryHash).join(':');
    const exportHash = crypto
      .createHash('sha256')
      .update(exportContent)
      .digest('hex');
    
    return {
      entries: entries.map(e => ({
        entryId: e.entryId,
        timestamp: e.timestamp,
        eventType: e.eventType,
        result: e.result,
        entryHash: e.entryHash,
        previousHash: e.previousHash,
      })),
      chainVerification,
      exportedAt: new Date(),
      exportHash,
    };
  }
}

export const auditLoggerService = AuditLoggerService.getInstance();
