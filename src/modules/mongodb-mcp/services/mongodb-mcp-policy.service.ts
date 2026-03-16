import { Injectable, Logger } from '@nestjs/common';
import type { MongodbMcpConnectionDocument } from '../../../schemas/integration/mongodb-mcp-connection.schema';

export interface PolicyValidationResult {
  allowed: boolean;
  reason?: string;
  sanitizedQuery?: {
    query?: Record<string, unknown>;
    options?: {
      limit?: number;
      projection?: Record<string, unknown>;
      maxTimeMS?: number;
    };
    pipeline?: unknown[];
  };
  metadata?: {
    redactedFields?: string[];
    appliedLimits?: Record<string, unknown>;
  };
}

interface QueryPolicy {
  maxDocuments: number;
  maxTimeoutMs: number;
  maxResponseSizeMB: number;
  blockedOperators: string[];
  defaultRedactedFields: string[];
}

/**
 * Validates and sanitizes MongoDB queries before execution.
 * Multi-layered security: operator blocklist, collection allow/block, field redaction, limits.
 */
@Injectable()
export class MongodbMcpPolicyService {
  private readonly logger = new Logger(MongodbMcpPolicyService.name);

  private static readonly DEFAULT_POLICY: QueryPolicy = {
    maxDocuments: 500,
    maxTimeoutMs: 8000,
    maxResponseSizeMB: 16,
    blockedOperators: [
      '$where',
      '$function',
      '$accumulator',
      '$eval',
      'mapReduce',
      '$expr',
      'function',
    ],
    defaultRedactedFields: [
      'password',
      'passwordHash',
      'encryptedKey',
      'accessToken',
      'refreshToken',
      'apiKey',
      'secret',
      'privateKey',
      'resetPasswordToken',
      'verificationToken',
      'sessionToken',
      'creditCard',
      'ssn',
      'taxId',
    ],
  };

  async validateFindQuery(
    connection: MongodbMcpConnectionDocument,
    collection: string,
    query: Record<string, unknown>,
    options?: {
      limit?: number;
      sort?: unknown;
      projection?: Record<string, unknown>;
    },
  ): Promise<PolicyValidationResult> {
    this.logger.debug('Validating find query', {
      collection,
      userId: String(connection.userId),
    });

    const collectionCheck = this.validateCollectionAccess(
      connection,
      collection,
    );
    if (!collectionCheck.allowed) return collectionCheck;

    const operatorCheck = this.checkDangerousOperators(query);
    if (!operatorCheck.allowed) return operatorCheck;

    const limit = this.getEffectiveLimit(connection, options?.limit);
    const projection = this.buildRedactionProjection(
      connection,
      collection,
      options?.projection,
    );

    return {
      allowed: true,
      sanitizedQuery: {
        query: this.sanitizeQuery(query) as Record<string, unknown>,
        options: {
          ...options,
          limit,
          projection,
          maxTimeMS: this.getEffectiveTimeout(connection),
        },
      },
      metadata: {
        appliedLimits: {
          limit,
          maxTimeMS: this.getEffectiveTimeout(connection),
        },
      },
    };
  }

  async validateAggregationPipeline(
    connection: MongodbMcpConnectionDocument,
    collection: string,
    pipeline: unknown[],
  ): Promise<PolicyValidationResult> {
    this.logger.debug('Validating aggregation pipeline', {
      collection,
      pipelineStages: pipeline.length,
    });

    const collectionCheck = this.validateCollectionAccess(
      connection,
      collection,
    );
    if (!collectionCheck.allowed) return collectionCheck;

    for (const stage of pipeline) {
      const operatorCheck = this.checkDangerousOperators(
        stage as Record<string, unknown>,
      );
      if (!operatorCheck.allowed) return operatorCheck;
    }

    const hasLimit = pipeline.some(
      (s) => typeof s === 'object' && s !== null && '$limit' in s,
    );
    const sanitizedPipeline = [...pipeline];
    if (!hasLimit) {
      sanitizedPipeline.push({ $limit: this.getEffectiveLimit(connection) });
    }
    const redactionStage = this.buildRedactionStage(connection, collection);
    if (redactionStage) sanitizedPipeline.push(redactionStage);

    return {
      allowed: true,
      sanitizedQuery: {
        pipeline: sanitizedPipeline,
        options: { maxTimeMS: this.getEffectiveTimeout(connection) },
      },
      metadata: {
        appliedLimits: { maxTimeMS: this.getEffectiveTimeout(connection) },
      },
    };
  }

  async validateCountQuery(
    connection: MongodbMcpConnectionDocument,
    collection: string,
    query: Record<string, unknown>,
  ): Promise<PolicyValidationResult> {
    const collectionCheck = this.validateCollectionAccess(
      connection,
      collection,
    );
    if (!collectionCheck.allowed) return collectionCheck;
    const operatorCheck = this.checkDangerousOperators(query);
    if (!operatorCheck.allowed) return operatorCheck;
    return {
      allowed: true,
      sanitizedQuery: {
        query: this.sanitizeQuery(query) as Record<string, unknown>,
        options: { maxTimeMS: this.getEffectiveTimeout(connection) },
      },
    };
  }

  private validateCollectionAccess(
    connection: MongodbMcpConnectionDocument,
    collection: string,
  ): PolicyValidationResult {
    const allowed = connection.metadata?.allowedCollections;
    const blocked = connection.metadata?.blockedCollections;
    if (allowed && allowed.length > 0) {
      if (!allowed.includes(collection)) {
        this.logger.warn('Collection not in allowlist', {
          collection,
          connectionId: connection._id,
        });
        return {
          allowed: false,
          reason: `Collection '${collection}' is not in the allowed list for this connection`,
        };
      }
    }
    if (blocked && blocked.includes(collection)) {
      this.logger.warn('Collection in blocklist', { collection });
      return {
        allowed: false,
        reason: `Collection '${collection}' is blocked for this connection`,
      };
    }
    return { allowed: true };
  }

  private checkDangerousOperators(
    query: Record<string, unknown>,
  ): PolicyValidationResult {
    const queryString = JSON.stringify(query);
    for (const op of MongodbMcpPolicyService.DEFAULT_POLICY.blockedOperators) {
      if (queryString.includes(op)) {
        this.logger.warn('Dangerous operator detected', { operator: op });
        return {
          allowed: false,
          reason: `Dangerous operator '${op}' is not allowed`,
        };
      }
    }
    return { allowed: true };
  }

  private getEffectiveLimit(
    connection: MongodbMcpConnectionDocument,
    requestedLimit?: number,
  ): number {
    const connectionLimit =
      connection.metadata?.maxDocsPerQuery ??
      MongodbMcpPolicyService.DEFAULT_POLICY.maxDocuments;
    const systemLimit = MongodbMcpPolicyService.DEFAULT_POLICY.maxDocuments;
    let effective = Math.min(connectionLimit, systemLimit);
    if (requestedLimit !== undefined && requestedLimit > 0) {
      effective = Math.min(effective, requestedLimit);
    }
    return effective;
  }

  private getEffectiveTimeout(
    connection: MongodbMcpConnectionDocument,
  ): number {
    const connectionTimeout =
      connection.metadata?.maxQueryTimeMs ??
      MongodbMcpPolicyService.DEFAULT_POLICY.maxTimeoutMs;
    return Math.min(
      connectionTimeout,
      MongodbMcpPolicyService.DEFAULT_POLICY.maxTimeoutMs,
    );
  }

  private getRedactedFields(
    connection: MongodbMcpConnectionDocument,
    collection: string,
  ): string[] {
    const defaultFields =
      MongodbMcpPolicyService.DEFAULT_POLICY.defaultRedactedFields;
    const connectionBlocked =
      connection.metadata?.blockedFields?.[collection] ?? [];
    return [...new Set([...defaultFields, ...connectionBlocked])];
  }

  private buildRedactionProjection(
    connection: MongodbMcpConnectionDocument,
    collection: string,
    existingProjection?: Record<string, unknown>,
  ): Record<string, number> | undefined {
    const redactedFields = this.getRedactedFields(connection, collection);
    const projection: Record<string, number> = {
      ...(existingProjection as Record<string, number>),
    };
    for (const field of redactedFields) {
      projection[field] = 0;
    }
    return Object.keys(projection).length > 0 ? projection : undefined;
  }

  private buildRedactionStage(
    connection: MongodbMcpConnectionDocument,
    collection: string,
  ): Record<string, string[]> | null {
    const redactedFields = this.getRedactedFields(connection, collection);
    if (redactedFields.length === 0) return null;
    return { $unset: redactedFields };
  }

  private sanitizeQuery(query: unknown): unknown {
    if (typeof query !== 'object' || query === null) return query;
    if (Array.isArray(query)) {
      return query.map((item) => this.sanitizeQuery(item));
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      query as Record<string, unknown>,
    )) {
      const sanitizedKey = key.replace(/\0/g, '');
      sanitized[sanitizedKey] = this.sanitizeQuery(value);
    }
    return sanitized;
  }

  validateResponseSize(
    responseSizeBytes: number,
    connection: MongodbMcpConnectionDocument,
  ): boolean {
    const maxBytes =
      MongodbMcpPolicyService.DEFAULT_POLICY.maxResponseSizeMB * 1024 * 1024;
    if (responseSizeBytes > maxBytes) {
      this.logger.warn('Response size exceeds limit', {
        responseSizeMB: (responseSizeBytes / 1024 / 1024).toFixed(2),
        maxSizeMB: MongodbMcpPolicyService.DEFAULT_POLICY.maxResponseSizeMB,
      });
      return false;
    }
    return true;
  }
}
