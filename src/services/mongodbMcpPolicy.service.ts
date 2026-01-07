import { loggingService } from './logging.service';
import { IMongoDBConnection } from '../models/MongoDBConnection';

/**
 * MongoDB MCP Policy Engine
 * 
 * Validates and sanitizes all MongoDB queries before execution.
 * Implements multi-layered security:
 * - Operator blocklist (dangerous operations)
 * - Collection allowlist/blocklist
 * - Field-level redaction
 * - Query size limits
 * - Timeout enforcement
 */

export interface PolicyValidationResult {
    allowed: boolean;
    reason?: string;
    sanitizedQuery?: any;
    metadata?: {
        redactedFields?: string[];
        appliedLimits?: any;
    };
}

export interface QueryPolicy {
    maxDocuments: number;
    maxTimeoutMs: number;
    maxResponseSizeMB: number;
    blockedOperators: string[];
    defaultRedactedFields: string[];
}

export class MongoDBMCPPolicyService {
    // Default policy configuration
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
            '$expr', // Can contain JavaScript
            'function', // JavaScript functions
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
        ]
    };

    /**
     * Validate a find query
     */
    static async validateFindQuery(
        connection: IMongoDBConnection,
        collection: string,
        query: any,
        options?: any
    ): Promise<PolicyValidationResult> {
        loggingService.info('Validating find query', {
            component: 'MongoDBMCPPolicyService',
            operation: 'validateFindQuery',
            collection,
            userId: connection.userId.toString()
        });

        // 1. Validate collection access
        const collectionCheck = this.validateCollectionAccess(connection, collection);
        if (!collectionCheck.allowed) {
            return collectionCheck;
        }

        // 2. Check for dangerous operators
        const operatorCheck = this.checkDangerousOperators(query);
        if (!operatorCheck.allowed) {
            return operatorCheck;
        }

        // 3. Apply document limit
        const limit = this.getEffectiveLimit(connection, options?.limit);
        
        // 4. Build projection for field redaction
        const projection = this.buildRedactionProjection(connection, collection, options?.projection);

        // 5. Sanitize query
        const sanitizedQuery = this.sanitizeQuery(query);

        return {
            allowed: true,
            sanitizedQuery: {
                query: sanitizedQuery,
                options: {
                    ...options,
                    limit,
                    projection,
                    maxTimeMS: this.getEffectiveTimeout(connection)
                }
            },
            metadata: {
                appliedLimits: {
                    limit,
                    maxTimeMS: this.getEffectiveTimeout(connection)
                }
            }
        };
    }

    /**
     * Validate an aggregation pipeline
     */
    static async validateAggregationPipeline(
        connection: IMongoDBConnection,
        collection: string,
        pipeline: any[]
    ): Promise<PolicyValidationResult> {
        loggingService.info('Validating aggregation pipeline', {
            component: 'MongoDBMCPPolicyService',
            operation: 'validateAggregationPipeline',
            collection,
            pipelineStages: pipeline.length,
            userId: connection.userId.toString()
        });

        // 1. Validate collection access
        const collectionCheck = this.validateCollectionAccess(connection, collection);
        if (!collectionCheck.allowed) {
            return collectionCheck;
        }

        // 2. Check each stage for dangerous operators
        for (const stage of pipeline) {
            const operatorCheck = this.checkDangerousOperators(stage);
            if (!operatorCheck.allowed) {
                return operatorCheck;
            }
        }

        // 3. Ensure $limit stage exists
        const hasLimit = pipeline.some(stage => '$limit' in stage);
        const sanitizedPipeline = [...pipeline];
        
        if (!hasLimit) {
            const limit = this.getEffectiveLimit(connection);
            sanitizedPipeline.push({ $limit: limit });
        }

        // 4. Add field redaction stage at the end
        const redactionStage = this.buildRedactionStage(connection, collection);
        if (redactionStage) {
            sanitizedPipeline.push(redactionStage);
        }

        return {
            allowed: true,
            sanitizedQuery: {
                pipeline: sanitizedPipeline,
                options: {
                    maxTimeMS: this.getEffectiveTimeout(connection)
                }
            },
            metadata: {
                appliedLimits: {
                    maxTimeMS: this.getEffectiveTimeout(connection)
                }
            }
        };
    }

    /**
     * Validate count query
     */
    static async validateCountQuery(
        connection: IMongoDBConnection,
        collection: string,
        query: any
    ): Promise<PolicyValidationResult> {
        loggingService.info('Validating count query', {
            component: 'MongoDBMCPPolicyService',
            operation: 'validateCountQuery',
            collection,
            userId: connection.userId.toString()
        });

        // 1. Validate collection access
        const collectionCheck = this.validateCollectionAccess(connection, collection);
        if (!collectionCheck.allowed) {
            return collectionCheck;
        }

        // 2. Check for dangerous operators
        const operatorCheck = this.checkDangerousOperators(query);
        if (!operatorCheck.allowed) {
            return operatorCheck;
        }

        // 3. Sanitize query
        const sanitizedQuery = this.sanitizeQuery(query);

        return {
            allowed: true,
            sanitizedQuery: {
                query: sanitizedQuery,
                options: {
                    maxTimeMS: this.getEffectiveTimeout(connection)
                }
            }
        };
    }

    /**
     * Check if collection access is allowed
     */
    private static validateCollectionAccess(
        connection: IMongoDBConnection,
        collection: string
    ): PolicyValidationResult {
        const allowedCollections = connection.metadata?.allowedCollections;
        const blockedCollections = connection.metadata?.blockedCollections;

        // If allowlist exists, collection must be in it
        if (allowedCollections && allowedCollections.length > 0) {
            if (!allowedCollections.includes(collection)) {
                loggingService.warn('Collection not in allowlist', {
                    component: 'MongoDBMCPPolicyService',
                    operation: 'validateCollectionAccess',
                    collection,
                    connectionId: connection._id
                });
                return {
                    allowed: false,
                    reason: `Collection '${collection}' is not in the allowed list for this connection`
                };
            }
        }

        // If blocklist exists, collection must not be in it
        if (blockedCollections && blockedCollections.includes(collection)) {
            loggingService.warn('Collection in blocklist', {
                component: 'MongoDBMCPPolicyService',
                operation: 'validateCollectionAccess',
                collection,
                connectionId: connection._id
            });
            return {
                allowed: false,
                reason: `Collection '${collection}' is blocked for this connection`
            };
        }

        return { allowed: true };
    }

    /**
     * Check for dangerous operators in query
     */
    private static checkDangerousOperators(query: any): PolicyValidationResult {
        const queryString = JSON.stringify(query);
        
        for (const operator of this.DEFAULT_POLICY.blockedOperators) {
            if (queryString.includes(operator)) {
                loggingService.warn('Dangerous operator detected', {
                    component: 'MongoDBMCPPolicyService',
                    operation: 'checkDangerousOperators',
                    operator,
                    query: queryString.substring(0, 200)
                });
                return {
                    allowed: false,
                    reason: `Dangerous operator '${operator}' is not allowed`
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Get effective document limit
     */
    private static getEffectiveLimit(connection: IMongoDBConnection, requestedLimit?: number): number {
        const connectionLimit = connection.metadata?.maxDocsPerQuery || this.DEFAULT_POLICY.maxDocuments;
        const systemLimit = this.DEFAULT_POLICY.maxDocuments;

        // Use the most restrictive limit
        let effectiveLimit = Math.min(connectionLimit, systemLimit);

        if (requestedLimit !== undefined && requestedLimit > 0) {
            effectiveLimit = Math.min(effectiveLimit, requestedLimit);
        }

        return effectiveLimit;
    }

    /**
     * Get effective timeout
     */
    private static getEffectiveTimeout(connection: IMongoDBConnection): number {
        const connectionTimeout = connection.metadata?.maxQueryTimeMs || this.DEFAULT_POLICY.maxTimeoutMs;
        const systemTimeout = this.DEFAULT_POLICY.maxTimeoutMs;

        // Use the most restrictive timeout
        return Math.min(connectionTimeout, systemTimeout);
    }

    /**
     * Build projection for field redaction
     */
    private static buildRedactionProjection(
        connection: IMongoDBConnection,
        collection: string,
        existingProjection?: any
    ): any {
        const redactedFields = this.getRedactedFields(connection, collection);
        
        // Build exclusion projection
        const projection: any = { ...existingProjection };
        
        for (const field of redactedFields) {
            projection[field] = 0; // Exclude field
        }

        return Object.keys(projection).length > 0 ? projection : undefined;
    }

    /**
     * Build aggregation stage for field redaction
     */
    private static buildRedactionStage(
        connection: IMongoDBConnection,
        collection: string
    ): any | null {
        const redactedFields = this.getRedactedFields(connection, collection);
        
        if (redactedFields.length === 0) {
            return null;
        }

        // Build $unset stage to remove sensitive fields
        return { $unset: redactedFields };
    }

    /**
     * Get list of fields to redact
     */
    private static getRedactedFields(connection: IMongoDBConnection, collection: string): string[] {
        const defaultFields = this.DEFAULT_POLICY.defaultRedactedFields;
        const connectionBlockedFields = connection.metadata?.blockedFields?.[collection] || [];
        
        // Combine default and connection-specific redacted fields
        return [...new Set([...defaultFields, ...connectionBlockedFields])];
    }

    /**
     * Sanitize query object (remove null bytes, etc.)
     */
    private static sanitizeQuery(query: any): any {
        if (typeof query !== 'object' || query === null) {
            return query;
        }

        if (Array.isArray(query)) {
            return query.map(item => this.sanitizeQuery(item));
        }

        const sanitized: any = {};
        for (const [key, value] of Object.entries(query)) {
            // Remove null bytes from keys
            const sanitizedKey = key.replace(/\0/g, '');
            sanitized[sanitizedKey] = this.sanitizeQuery(value);
        }

        return sanitized;
    }

    /**
     * Validate response size
     */
    static validateResponseSize(responseSizeBytes: number, connection: IMongoDBConnection): boolean {
        const maxSizeBytes = this.DEFAULT_POLICY.maxResponseSizeMB * 1024 * 1024;
        
        if (responseSizeBytes > maxSizeBytes) {
            loggingService.warn('Response size exceeds limit', {
                component: 'MongoDBMCPPolicyService',
                operation: 'validateResponseSize',
                responseSizeMB: (responseSizeBytes / 1024 / 1024).toFixed(2),
                maxSizeMB: this.DEFAULT_POLICY.maxResponseSizeMB,
                connectionId: connection._id
            });
            return false;
        }

        return true;
    }

    /**
     * Get policy summary for connection
     */
    static getPolicySummary(connection: IMongoDBConnection): any {
        return {
            maxDocuments: this.getEffectiveLimit(connection),
            maxTimeoutMs: this.getEffectiveTimeout(connection),
            maxResponseSizeMB: this.DEFAULT_POLICY.maxResponseSizeMB,
            allowedCollections: connection.metadata?.allowedCollections || 'all',
            blockedCollections: connection.metadata?.blockedCollections || [],
            blockedOperators: this.DEFAULT_POLICY.blockedOperators,
            redactedFields: this.DEFAULT_POLICY.defaultRedactedFields
        };
    }
}
