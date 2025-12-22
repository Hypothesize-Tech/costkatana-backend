import { Document } from '@langchain/core/documents';
import { vectorStoreService } from './vectorStore.service';
import { DocumentModel } from '../models/Document';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';

export interface RetrievalOptions {
    userId?: string;
    limit?: number;
    filters?: {
        source?: string[];
        dateRange?: { from: Date; to: Date };
        tags?: string[];
        projectId?: string;
        conversationId?: string;
        documentIds?: string[]; // Filter by specific document IDs
    };
    includeScore?: boolean;
    useCache?: boolean;
    rerank?: boolean;
}

export interface RetrievalResult {
    documents: Document[];
    sources: string[];
    totalResults: number;
    cacheHit: boolean;
    retrievalTime: number;
    stats: {
        sources: string[];
        cacheHit: boolean;
        retrievalTime: number;
    };
}

interface MongoFilters {
    'metadata.userId'?: string;
    'metadata.source'?: { $in: string[] };
    'metadata.projectId'?: string;
    'metadata.conversationId'?: string;
    'metadata.tags'?: { $in: string[] };
    'metadata.documentId'?: { $in: string[] };
    createdAt?: { $gte: Date; $lte: Date };
}

interface ScoredDocument {
    doc: Document;
    score: number;
}

export class RetrievalService {
    private cachePrefix = 'retrieval:';
    private cacheTTL = 3600; // 1 hour

    /**
     * Main retrieval method with hybrid search
     */
    async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
        const startTime = Date.now();
        const limit = options.limit ?? 5;

        try {
            loggingService.info('Starting document retrieval', {
                component: 'RetrievalService',
                operation: 'retrieve',
                query: query.substring(0, 100),
                options
            });

            // Check cache first
            if (options.useCache !== false) {
                const cached = await this.getCachedResults(query, options);
                if (cached) {
                    loggingService.info('Cache hit for retrieval query', {
                        component: 'RetrievalService',
                        query: query.substring(0, 100)
                    });

                    return {
                        ...cached,
                        cacheHit: true,
                        retrievalTime: Date.now() - startTime,
                        stats: {
                            ...(cached.stats || { sources: [], cacheHit: true, retrievalTime: 0 }),
                            cacheHit: true,
                            retrievalTime: Date.now() - startTime
                        }
                    };
                }
            }

            // Stage 1: Initial vector search
            const initialResults = await this.vectorSearch(query, limit * 4, options); // Get more for reranking

            if (initialResults.length === 0) {
                return {
                    documents: [],
                    sources: [],
                    totalResults: 0,
                    cacheHit: false,
                    retrievalTime: Date.now() - startTime,
                    stats: {
                        sources: [],
                        cacheHit: false,
                        retrievalTime: Date.now() - startTime
                    }
                };
            }

            // Stage 2: Apply metadata filters
            let filteredResults = this.applyFilters(initialResults, options);

            // Stage 3: Re-ranking (if enabled)
            if (options.rerank && filteredResults.length > limit) {
                filteredResults = this.rerankResults(query, filteredResults, limit);
            } else {
                filteredResults = filteredResults.slice(0, limit);
            }

            // Stage 4: Enhance with metadata and mark as accessed
            await this.markDocumentsAccessed(filteredResults);

            // Stage 5: Deduplicate
            const deduplicated = this.deduplicateResults(filteredResults);

            // Extract sources
            const sources = this.extractSources(deduplicated);

            const result: RetrievalResult = {
                documents: deduplicated,
                sources,
                totalResults: initialResults.length,
                cacheHit: false,
                retrievalTime: Date.now() - startTime,
                stats: {
                    sources,
                    cacheHit: false,
                    retrievalTime: Date.now() - startTime
                }
            };

            // Cache results
            if (options.useCache !== false) {
                await this.cacheResults(query, options, result);
            }

            loggingService.info('Document retrieval completed', {
                component: 'RetrievalService',
                operation: 'retrieve',
                documentsReturned: deduplicated.length,
                totalResults: initialResults.length,
                retrievalTime: result.retrievalTime
            });

            return result;
        } catch (error) {
            loggingService.error('Document retrieval failed', {
                component: 'RetrievalService',
                operation: 'retrieve',
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                documents: [],
                sources: [],
                totalResults: 0,
                cacheHit: false,
                retrievalTime: Date.now() - startTime,
                stats: {
                    sources: [],
                    cacheHit: false,
                    retrievalTime: Date.now() - startTime
                }
            };
        }
    }

    /**
     * Vector search using hybrid strategy
     */
    private async vectorSearch(query: string, limit: number, options: RetrievalOptions): Promise<Document[]> {
        try {
            // Build filter for MongoDB
            const mongoFilters: MongoFilters = {};

            if (options.userId) {
                mongoFilters['metadata.userId'] = options.userId;
            }

            if (options.filters?.source && options.filters.source.length > 0) {
                mongoFilters['metadata.source'] = { $in: options.filters.source };
            }

            if (options.filters?.projectId) {
                mongoFilters['metadata.projectId'] = options.filters.projectId;
            }

            if (options.filters?.conversationId) {
                mongoFilters['metadata.conversationId'] = options.filters.conversationId;
            }

            if (options.filters?.tags && options.filters.tags.length > 0) {
                mongoFilters['metadata.tags'] = { $in: options.filters.tags };
            }

            if (options.filters?.documentIds && options.filters.documentIds.length > 0) {
                mongoFilters['metadata.documentId'] = { $in: options.filters.documentIds };
            }

            if (options.filters?.dateRange) {
                mongoFilters.createdAt = {
                    $gte: options.filters.dateRange.from,
                    $lte: options.filters.dateRange.to
                };
            }
            const results = await vectorStoreService.searchMongoDB(query, limit, mongoFilters);

            return results;
        } catch (error) {
            loggingService.error('Vector search failed', {
                component: 'RetrievalService',
                operation: 'vectorSearch',
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Apply metadata filters
     */
    private applyFilters(documents: Document[], options: RetrievalOptions): Document[] {
        let filtered = documents;

        // User isolation - CRITICAL for security
        if (options.userId) {
            filtered = filtered.filter(doc => {
                // Allow public knowledge base documents
                if (doc.metadata.source === 'knowledge-base') {
                    return true;
                }
                // Filter user-specific documents
                return doc.metadata.userId === options.userId;
            });
        }

        // Additional filters are already applied in MongoDB query
        return filtered;
    }

    /**
     * Re-rank results using relevance scoring
     */
    private rerankResults(query: string, documents: Document[], limit: number): Document[] {
        try {
            // Simple re-ranking based on query term frequency and document metadata
            const queryTerms = query.toLowerCase().split(/\s+/);

            const scored: ScoredDocument[] = documents.map(doc => {
                let score = (doc.metadata.score as number) ?? 0;

                // Boost score based on query term matches in content
                const content = doc.pageContent.toLowerCase();
                queryTerms.forEach(term => {
                    const matches = (content.match(new RegExp(term, 'g')) ?? []).length;
                    score += matches * 0.1;
                });

                // Boost recent documents
                if (doc.metadata.createdAt) {
                    const createdAt = doc.metadata.createdAt as string | Date;
                    const age = Date.now() - new Date(createdAt).getTime();
                    const daysSinceCreation = age / (1000 * 60 * 60 * 24);
                    if (daysSinceCreation < 7) {
                        score += 0.5; // Boost recent documents
                    }
                }

                // Boost frequently accessed documents
                if ((doc.metadata.accessCount as number) > 10) {
                    score += 0.3;
                }

                return { doc, score };
            });

            // Sort by score and take top results
            scored.sort((a, b) => b.score - a.score);

            return scored.slice(0, limit).map(item => item.doc);
        } catch (error) {
            loggingService.error('Re-ranking failed', {
                component: 'RetrievalService',
                operation: 'rerankResults',
                error: error instanceof Error ? error.message : String(error)
            });
            return documents.slice(0, limit);
        }
    }

    /**
     * Mark documents as accessed for analytics
     */
    private async markDocumentsAccessed(documents: Document[]): Promise<void> {
        try {
            const documentIds = documents
                .map(doc => doc.metadata._id as string)
                .filter(id => id);

            if (documentIds.length === 0) return;

            // Update access count and timestamp
            await DocumentModel.updateMany(
                { _id: { $in: documentIds } },
                {
                    $inc: { accessCount: 1 },
                    $set: { lastAccessedAt: new Date() }
                }
            );
        } catch (error) {
            // Non-critical error, just log it
            loggingService.warn('Failed to mark documents as accessed', {
                component: 'RetrievalService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Deduplicate results based on content similarity
     */
    private deduplicateResults(documents: Document[]): Document[] {
        const seen = new Set<string>();
        const deduplicated: Document[] = [];

        for (const doc of documents) {
            // Use content hash or ID for deduplication
            const key = (doc.metadata._id as string) ?? 
                       (doc.metadata.contentHash as string) ?? 
                       doc.pageContent.substring(0, 100);

            if (!seen.has(key)) {
                seen.add(key);
                deduplicated.push(doc);
            }
        }

        return deduplicated;
    }

    /**
     * Extract sources from documents
     */
    private extractSources(documents: Document[]): string[] {
        const sources = new Set<string>();

        documents.forEach(doc => {
            if (doc.metadata.fileName) {
                sources.add(doc.metadata.fileName as string);
            } else if (doc.metadata.source) {
                sources.add(doc.metadata.source as string);
            }
        });

        return Array.from(sources);
    }

    /**
     * Get cached results
     */
    private async getCachedResults(query: string, options: RetrievalOptions): Promise<RetrievalResult | null> {
        try {
            const cacheKey = this.generateCacheKey(query, options);
            const cached = await redisService.get(cacheKey);

            if (cached && typeof cached === 'string') {
                return JSON.parse(cached) as RetrievalResult;
            }

            return null;
        } catch (error) {
            loggingService.warn('Cache retrieval failed', {
                component: 'RetrievalService',
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Cache results
     */
    private async cacheResults(query: string, options: RetrievalOptions, results: RetrievalResult): Promise<void> {
        try {
            const cacheKey = this.generateCacheKey(query, options);
            await redisService.set(cacheKey, JSON.stringify(results), this.cacheTTL);
        } catch (error) {
            // Non-critical error
            loggingService.warn('Cache storage failed', {
                component: 'RetrievalService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Generate cache key
     */
    private generateCacheKey(query: string, options: RetrievalOptions): string {
        const keyParts = [
            this.cachePrefix,
            query.substring(0, 50),
            options.userId ?? 'public',
            options.limit ?? 5,
            JSON.stringify(options.filters ?? {})
        ];

        return keyParts.join(':');
    }

    /**
     * Query user-specific documents with enhanced search
     */
    async retrieveUserDocuments(
        userId: string,
        query: string,
        options: Omit<RetrievalOptions, 'userId'> = {}
    ): Promise<RetrievalResult> {
        return this.retrieve(query, {
            ...options,
            userId,
            filters: {
                ...options.filters,
                source: options.filters?.source ?? ['user-upload', 'conversation', 'activity']
            }
        });
    }

    /**
     * Query knowledge base only
     */
    async retrieveKnowledgeBase(query: string, limit: number = 5): Promise<RetrievalResult> {
        return this.retrieve(query, {
            limit,
            filters: {
                source: ['knowledge-base']
            },
            useCache: true,
            rerank: true
        });
    }

    /**
     * Contextual retrieval with query expansion
     */
    async retrieveWithContext(
        query: string,
        context: {
            recentMessages?: string[];
            currentTopic?: string;
            userId?: string;
        },
        options: RetrievalOptions = {}
    ): Promise<RetrievalResult> {
        // Enhance query with context
        let enhancedQuery = query;

        if (context.currentTopic) {
            enhancedQuery = `${context.currentTopic}: ${query}`;
        }

        if (context.recentMessages && context.recentMessages.length > 0) {
            // Add recent conversation context
            const recentContext = context.recentMessages.slice(-2).join(' ');
            enhancedQuery = `${recentContext}\n${query}`;
        }

        return this.retrieve(enhancedQuery, {
            ...options,
            userId: context.userId,
            rerank: true
        });
    }

    /**
     * Clear cache for user
     */
    async clearCache(userId?: string): Promise<void> {
        try {
            if (userId) {
                const pattern = `${this.cachePrefix}*:${userId}:*`;
                const keys = await redisService.scanKeys(pattern);

                if (keys.length > 0) {
                    // Delete keys one by one since del expects individual keys
                    for (const key of keys) {
                        await redisService.del(key);
                    }
                }
                loggingService.info('Cache cleared for user', {
                    component: 'RetrievalService',
                    userId,
                    keysDeleted: keys.length
                });
            } else {
                // Clear all retrieval cache
                const pattern = `${this.cachePrefix}*`;
                const keys = await redisService.scanKeys(pattern);

                if (keys.length > 0) {
                    // Delete keys one by one since del expects individual keys
                    for (const key of keys) {
                        await redisService.del(key);
                    }
                }
                loggingService.info('All retrieval cache cleared', {
                    component: 'RetrievalService',
                    keysDeleted: keys.length
                });
            }
        } catch (error) {
            loggingService.error('Cache clear failed', {
                component: 'RetrievalService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Retrieve Google Drive files and include them in search results
     */
    async retrieveWithGoogleDriveFiles(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
        const startTime = Date.now();
        
        try {
            // Get regular retrieval results first
            const regularResults = await this.retrieve(query, { ...options, useCache: false });
            
            // If we have good results from regular retrieval, return them
            if (regularResults.documents.length >= (options.limit ?? 5)) {
                return regularResults;
            }
            
            // Try to get Google Drive files if regular results are sparse
            const googleDriveResults = await this.getGoogleDriveFileResults(query, options);
            
            // Combine results
            const combinedDocuments = [...regularResults.documents, ...googleDriveResults];
            const limit = options.limit ?? 5;
            const finalDocuments = combinedDocuments.slice(0, limit);
            
            const combinedSources = [...new Set([...regularResults.sources, ...this.extractSources(googleDriveResults)])];
            
            loggingService.info('Combined retrieval with Google Drive files completed', {
                component: 'RetrievalService',
                regularResults: regularResults.documents.length,
                googleDriveResults: googleDriveResults.length,
                combinedResults: finalDocuments.length
            });
            
            return {
                documents: finalDocuments,
                sources: combinedSources,
                totalResults: combinedDocuments.length,
                cacheHit: false,
                retrievalTime: Date.now() - startTime,
                stats: {
                    sources: combinedSources,
                    cacheHit: false,
                    retrievalTime: Date.now() - startTime
                }
            };
            
        } catch (error) {
            loggingService.error('Retrieval with Google Drive files failed', {
                component: 'RetrievalService',
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback to regular retrieval
            return await this.retrieve(query, options);
        }
    }

    /**
     * Get Google Drive file results
     */
    private async getGoogleDriveFileResults(query: string, options: RetrievalOptions): Promise<Document[]> {
        if (!options.userId) {
            return [];
        }
        
        try {
            const { GoogleService } = await import('./google.service');
            const { GoogleConnection } = await import('../models/GoogleConnection');
            
            // Get user's Google connections
            const connections = await GoogleConnection.find({
                userId: options.userId,
                isActive: true,
                healthStatus: 'healthy' // Only use healthy connections
            }).select('+accessToken +refreshToken');
            
            if (connections.length === 0) {
                return [];
            }
            
            const connection = connections[0];
            
            // Validate that connection has required token
            if (!connection.accessToken) {
                loggingService.warn('Google connection missing access token', {
                    connectionId: connection._id.toString(),
                    userId: options.userId
                });
                return [];
            }
            
            // Don't filter by fileType - get all accessible files (docs, sheets, drive)
            const accessibleFiles = await GoogleService.getAccessibleFiles(
                options.userId,
                connection._id.toString()
            );
            
            if (accessibleFiles.length === 0) {
                return [];
            }
            
            const documents: Document[] = [];
            const queryLower = query.toLowerCase();
            
            // Filter files by relevance to query
            // If query is generic (e.g., "what does this contain?", "what's in this file?"), include all recent files
            const genericQueries = ['this', 'that', 'file', 'document', 'contain', 'what', 'show', 'explain'];
            const isGenericQuery = genericQueries.every(word => queryLower.split(/\s+/).includes(word)) || 
                                    queryLower.includes('what does this') ||
                                    queryLower.includes('what is this') ||
                                    queryLower.includes('what\'s in') ||
                                    queryLower.includes('show me this');
            
            let relevantFiles: any[];
            if (isGenericQuery || accessibleFiles.length <= 3) {
                // For generic queries or when there are few files, include all files
                relevantFiles = accessibleFiles;
            } else {
                // Filter by filename relevance
                relevantFiles = accessibleFiles.filter(file => {
                    const nameLower = file.name.toLowerCase();
                    const queryWords = queryLower.split(/\s+/);
                    return queryWords.some(word => 
                        word.length > 2 && nameLower.includes(word)
                    );
                });
                
                // If no relevant files found, fallback to all files
                if (relevantFiles.length === 0) {
                    relevantFiles = accessibleFiles;
                }
            }
            
            // Limit to top 3 most relevant files
            const filesToProcess = relevantFiles.slice(0, 3);
            
            for (const file of filesToProcess) {
                try {
                    let content = '';
                    
                    if (file.mimeType === 'application/vnd.google-apps.document') {
                        content = await GoogleService.readDocument(connection, file.id);
                    } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
                        const sheetData = await GoogleService.readSpreadsheet(connection, file.id, 'Sheet1!A1:Z100');
                        if (Array.isArray(sheetData)) {
                            content = sheetData.map((row: any[]) => Array.isArray(row) ? row.join('\t') : '').join('\n') || '';
                        }
                    }
                    
                    if (content && content.length > 50) {
                        documents.push(new Document({
                            pageContent: content,
                            metadata: {
                                source: 'google-drive',
                                fileName: file.name,
                                fileId: file.id,
                                mimeType: file.mimeType,
                                userId: options.userId,
                                accessMethod: file.accessMethod,
                                lastAccessedAt: file.lastAccessedAt || new Date(),
                                score: 0.8 // High relevance score for selected files
                            }
                        }));
                        
                        loggingService.info('Added Google Drive file to results', {
                            fileName: file.name,
                            fileId: file.id,
                            contentLength: content.length
                        });
                    }
                } catch (error) {
                    loggingService.warn('Failed to read Google Drive file for retrieval', {
                        fileName: file.name,
                        fileId: file.id,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            
            return documents;
            
        } catch (error) {
            loggingService.error('Failed to get Google Drive file results', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
}

// Singleton instance
export const retrievalService = new RetrievalService();
