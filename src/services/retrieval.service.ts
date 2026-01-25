import { Document } from '@langchain/core/documents';
import { vectorStoreService } from './vectorStore.service';
import { MongoDBVectorStore } from './langchainVectorStore.service';
import { SafeBedrockEmbeddings, createSafeBedrockEmbeddings } from './safeBedrockEmbeddings';
import { DocumentModel } from '../models/Document';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import { vectorStrategyService } from './vectorization/vectorStrategy.service';
import { DomainType, ContentType, ImportanceLevel, TechnicalLevel } from '../types/metadata.types';

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
        
        // NEW: Enhanced semantic metadata filters
        domain?: DomainType[];
        topics?: string[];
        contentType?: ContentType[];
        technicalLevel?: TechnicalLevel[];
        importance?: ImportanceLevel[];
        minQualityScore?: number;
        maxAgeInDays?: number;
        excludeDeprecated?: boolean;
        mustContainKeywords?: string[];
        mustNotContainKeywords?: string[];
    };
    includeScore?: boolean;
    useCache?: boolean;
    rerank?: boolean;
    
    // NEW: User context for personalization
    userContext?: {
        technicalLevel?: TechnicalLevel;
        preferredTopics?: string[];
        recentQueries?: string[];
    };
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
    
    // NEW: Enhanced semantic metadata filters
    'metadata.domain'?: { $in: DomainType[] };
    'metadata.topics'?: { $in: string[] };
    'metadata.contentType'?: { $in: ContentType[] };
    'metadata.technicalLevel'?: { $in: TechnicalLevel[] };
    'metadata.importance'?: { $in: ImportanceLevel[] };
    'metadata.qualityScore'?: { $gte: number };
    'metadata.lastVerified'?: { $gte: Date };
    '$or'?: Array<Record<string, any>>;
}

interface ScoredDocument {
    doc: Document;
    score: number;
}

export class RetrievalService {
    private cachePrefix = 'retrieval:';
    private cacheTTL = 3600; // 1 hour
    private vectorStore?: MongoDBVectorStore;
    private embeddings?: SafeBedrockEmbeddings;

    // Static reranking configuration - no environment variables needed
    private readonly RERANKING_CONFIG = {
        ENABLED: true,
        IMPORTANCE_WEIGHTS: {
            critical: 1.5,
            high: 1.2,
            medium: 1.0,
            low: 0.8
        },
        QUALITY_WEIGHT: 0.5,
        FRESHNESS_WEIGHT: 0.2,
        FRESHNESS_DECAY_DAYS: 90,
        TECHNICAL_MATCH_BOOST: 1.3,
        TOPIC_OVERLAP_BOOST: 0.1,
        DEPRECATION_PENALTY: 0.3,
        RECENT_DOCUMENT_DAYS: 7,
        RECENT_DOCUMENT_BOOST: 0.5,
        ACCESS_COUNT_THRESHOLD: 10,
        ACCESS_COUNT_BOOST: 0.3
    };

    /**
     * Initialize with LangChain VectorStore
     */
    async initializeVectorStore(): Promise<void> {
        // Initialize vector strategy service if any FAISS features are enabled
        if (process.env.ENABLE_FAISS_DUAL_WRITE === 'true' || 
            process.env.ENABLE_FAISS_SHADOW_READ === 'true' || 
            process.env.ENABLE_FAISS_PRIMARY === 'true') {
            await vectorStrategyService.initialize();
            
            loggingService.info('✅ RetrievalService initialized with Vector Strategy Service', {
                component: 'RetrievalService',
                operation: 'initializeVectorStore',
                flags: vectorStrategyService.getFeatureFlags()
            });
        } else if (process.env.USE_LANGCHAIN_VECTORSTORE === 'true') {
            // Fallback to direct MongoDB vector store (legacy)
            this.embeddings = createSafeBedrockEmbeddings({
                model: 'amazon.titan-embed-text-v2:0'
            });

            this.vectorStore = new MongoDBVectorStore(this.embeddings, {
                indexName: process.env.MONGODB_VECTOR_INDEX_NAME || 'document_vector_index'
            });

            loggingService.info('✅ RetrievalService initialized with LangChain VectorStore', {
                component: 'RetrievalService',
                operation: 'initializeVectorStore'
            });
        }
    }

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

            // NEW: Load user preferences and enhance options
            if (options.userId && !options.userContext) {
                const userPreferences = await this.loadUserPreferences(options.userId);
                
                if (userPreferences) {
                    // Enhance options with user context
                    options.userContext = {
                        technicalLevel: userPreferences.technicalLevel,
                        preferredTopics: userPreferences.commonTopics,
                        recentQueries: [] // Could load from conversation memory
                    };
                    
                    // Auto-add preferred topics to filters (boost relevant content)
                    if (userPreferences.commonTopics && userPreferences.commonTopics.length > 0) {
                        if (!options.filters) {
                            options.filters = {};
                        }
                        // Don't override existing topics, just add user's preferred topics
                        const existingTopics = options.filters.topics || [];
                        options.filters.topics = [...existingTopics, ...userPreferences.commonTopics];
                    }

                    loggingService.info('Enhanced retrieval with user preferences', {
                        component: 'RetrievalService',
                        userId: options.userId,
                        technicalLevel: userPreferences.technicalLevel,
                        preferredTopics: userPreferences.commonTopics?.length || 0
                    });
                }
            }

            // PRIORITY: If specific documentIds are provided, search directly by IDs first
            // This is more reliable than vector search for user-uploaded documents
            if (options.filters?.documentIds && options.filters.documentIds.length > 0) {
                loggingService.info('📄 Direct document lookup by IDs (priority path)', {
                    component: 'RetrievalService',
                    operation: 'retrieve',
                    documentIds: options.filters.documentIds,
                    userId: options.userId
                });
                
                const directResults = await this.searchDocumentsByIds(
                    options.filters.documentIds, 
                    options.userId, 
                    limit * 4
                );
                
                if (directResults.length > 0) {
                    loggingService.info('✅ Found documents via direct ID lookup', {
                        component: 'RetrievalService',
                        operation: 'retrieve',
                        found: directResults.length,
                        documentIds: options.filters.documentIds
                    });
                    
                    // Apply reranking and return
                    const rerankedResults = await this.rerankResults(query, directResults, limit, options);
                    const sources = this.extractSources(rerankedResults);
                    
                    return {
                        documents: rerankedResults,
                        sources,
                        totalResults: rerankedResults.length,
                        cacheHit: false,
                        retrievalTime: Date.now() - startTime,
                        stats: {
                            sources,
                            cacheHit: false,
                            retrievalTime: Date.now() - startTime
                        }
                    };
                } else {
                    loggingService.warn('⚠️ No documents found via direct ID lookup, falling back to vector search', {
                        component: 'RetrievalService',
                        operation: 'retrieve',
                        documentIds: options.filters.documentIds
                    });
                }
            }

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
            let initialResults: Document[];
            if (this.vectorStore && process.env.USE_LANGCHAIN_VECTORSTORE === 'true') {
                initialResults = await this.vectorSearchWithLangChain(query, limit * 4, options);
            } else {
                initialResults = await this.vectorSearch(query, limit * 4, options); // Get more for reranking
            }

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
                filteredResults = this.rerankResults(query, filteredResults, limit, options);
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
     * Vector search using LangChain VectorStore
     */
    private async vectorSearchWithLangChain(query: string, limit: number, options: RetrievalOptions): Promise<Document[]> {
        // When specific documentIds are provided, use direct MongoDB query for reliability
        // This bypasses FAISS since MongoDB is the source of truth and supports complex filters
        if (options.filters?.documentIds && options.filters.documentIds.length > 0) {
            loggingService.info('Using direct MongoDB search for documentIds filter', {
                component: 'RetrievalService',
                operation: 'vectorSearchWithLangChain',
                documentIds: options.filters.documentIds,
                userId: options.userId
            });
            return this.searchDocumentsByIds(options.filters.documentIds, options.userId, limit);
        }

        // Use vector strategy service for all other vector searches
        try {
            // Build filter
            const filter: any = {};

            // Existing filters
            if (options.userId) {
                filter['metadata.userId'] = options.userId;
            }

            if (options.filters?.source && options.filters.source.length > 0) {
                filter['metadata.source'] = { $in: options.filters.source };
            }

            if (options.filters?.projectId) {
                filter['metadata.projectId'] = options.filters.projectId;
            }

            if (options.filters?.conversationId) {
                filter['metadata.conversationId'] = options.filters.conversationId;
            }

            if (options.filters?.tags && options.filters.tags.length > 0) {
                filter['metadata.tags'] = { $in: options.filters.tags };
            }

            if (options.filters?.dateRange) {
                filter.createdAt = {
                    $gte: options.filters.dateRange.from,
                    $lte: options.filters.dateRange.to
                };
            }

            // NEW: Enhanced semantic metadata filters
            if (options.filters?.domain && options.filters.domain.length > 0) {
                filter['metadata.domain'] = { $in: options.filters.domain };
            }

            if (options.filters?.topics && options.filters.topics.length > 0) {
                filter['metadata.topics'] = { $in: options.filters.topics };
            }

            if (options.filters?.contentType && options.filters.contentType.length > 0) {
                filter['metadata.contentType'] = { $in: options.filters.contentType };
            }

            if (options.filters?.technicalLevel && options.filters.technicalLevel.length > 0) {
                filter['metadata.technicalLevel'] = { $in: options.filters.technicalLevel };
            }

            if (options.filters?.importance && options.filters.importance.length > 0) {
                filter['metadata.importance'] = { $in: options.filters.importance };
            }

            if (options.filters?.minQualityScore !== undefined) {
                filter['metadata.qualityScore'] = { $gte: options.filters.minQualityScore };
            }

            if (options.filters?.maxAgeInDays !== undefined) {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - options.filters.maxAgeInDays);
                filter['metadata.lastVerified'] = { $gte: cutoffDate };
            }

            if (options.filters?.excludeDeprecated) {
                filter['$or'] = [
                    { 'metadata.deprecationDate': { $exists: false } },
                    { 'metadata.deprecationDate': { $gt: new Date() } }
                ];
            }

            // Use vector strategy service (handles FAISS/MongoDB routing based on config)
            const results = await vectorStrategyService.search(
                query,
                limit,
                options.userId,
                filter
            );

            // Convert VectorSearchResult to Document[]
            const documents = results.map(result => result.document);

            loggingService.info('Vector strategy search completed', {
                component: 'RetrievalService',
                operation: 'vectorSearchWithLangChain',
                resultsFound: documents.length,
                strategy: vectorStrategyService.getFeatureFlags()
            });

            return documents;
        } catch (error) {
            loggingService.error('Vector strategy search failed, falling back', {
                component: 'RetrievalService',
                operation: 'vectorSearchWithLangChain',
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback to original method
            return this.vectorSearch(query, limit, options);
        }
    }

    /**
     * Search documents directly by IDs from MongoDB (source of truth)
     * This is more reliable than vector search when specific documentIds are known
     */
    private async searchDocumentsByIds(documentIds: string[], userId?: string, limit: number = 20): Promise<Document[]> {
        try {
            const { DocumentModel } = await import('../models/Document');
            
            const query: any = {
                'metadata.documentId': { $in: documentIds },
                status: 'active'
            };
            
            if (userId) {
                query['metadata.userId'] = userId;
            }
            
            loggingService.info('📄 Searching documents by IDs (direct lookup)', {
                component: 'RetrievalService',
                operation: 'searchDocumentsByIds',
                documentIds,
                userId,
                query: JSON.stringify(query)
            });
            
            const docs = await DocumentModel.find(query)
                .select('content metadata')
                .limit(limit)
                .lean();
            
            loggingService.info('📄 Documents found by direct ID lookup', {
                component: 'RetrievalService',
                operation: 'searchDocumentsByIds',
                found: docs.length,
                documentIds,
                docMetadataPreview: docs.length > 0 ? JSON.stringify(docs[0]?.metadata).substring(0, 200) : 'none'
            });
            
            if (docs.length === 0) {
                // Debug: Check if ANY documents exist with these documentIds (ignoring userId)
                const anyDocs = await DocumentModel.find({
                    'metadata.documentId': { $in: documentIds },
                    status: 'active'
                }).select('metadata.documentId metadata.userId').limit(5).lean();
                
                loggingService.warn('⚠️ No documents found for provided IDs - debugging', {
                    component: 'RetrievalService',
                    operation: 'searchDocumentsByIds',
                    documentIds,
                    userId,
                    docsWithoutUserFilter: anyDocs.length,
                    sampleDocs: anyDocs.map((d: any) => ({
                        docId: d.metadata?.documentId,
                        userId: d.metadata?.userId
                    }))
                });
            }
            
            // Convert to LangChain Document format
            return docs.map((doc: any) => new Document({
                pageContent: doc.content,
                metadata: doc.metadata
            }));
        } catch (error) {
            loggingService.error('❌ Failed to search documents by IDs', {
                component: 'RetrievalService',
                operation: 'searchDocumentsByIds',
                error: error instanceof Error ? error.message : String(error),
                documentIds
            });
            return [];
        }
    }

    /**
     * Vector search using hybrid strategy
     */
    private async vectorSearch(query: string, limit: number, options: RetrievalOptions): Promise<Document[]> {
        try {
            // Build filter for MongoDB
            const mongoFilters: MongoFilters = {};

            // Existing filters
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

            // NEW: Enhanced semantic metadata filters
            if (options.filters?.domain && options.filters.domain.length > 0) {
                mongoFilters['metadata.domain'] = { $in: options.filters.domain };
            }

            if (options.filters?.topics && options.filters.topics.length > 0) {
                mongoFilters['metadata.topics'] = { $in: options.filters.topics };
            }

            if (options.filters?.contentType && options.filters.contentType.length > 0) {
                mongoFilters['metadata.contentType'] = { $in: options.filters.contentType };
            }

            if (options.filters?.technicalLevel && options.filters.technicalLevel.length > 0) {
                mongoFilters['metadata.technicalLevel'] = { $in: options.filters.technicalLevel };
            }

            if (options.filters?.importance && options.filters.importance.length > 0) {
                mongoFilters['metadata.importance'] = { $in: options.filters.importance };
            }

            if (options.filters?.minQualityScore !== undefined) {
                mongoFilters['metadata.qualityScore'] = { $gte: options.filters.minQualityScore };
            }

            if (options.filters?.maxAgeInDays !== undefined) {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - options.filters.maxAgeInDays);
                mongoFilters['metadata.lastVerified'] = { $gte: cutoffDate };
            }

            if (options.filters?.excludeDeprecated) {
                mongoFilters['$or'] = [
                    { 'metadata.deprecationDate': { $exists: false } },
                    { 'metadata.deprecationDate': { $gt: new Date() } }
                ];
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
     * Re-rank results using advanced relevance scoring with metadata signals
     */
    private rerankResults(query: string, documents: Document[], limit: number, options?: RetrievalOptions): Document[] {
        try {
            // Simple re-ranking based on query term frequency and document metadata
            const queryTerms = query.toLowerCase().split(/\s+/);

            const scored: ScoredDocument[] = documents.map(doc => {
                let score = (doc.metadata.score as number) ?? 0;

                // Existing: Boost score based on query term matches in content
                const content = doc.pageContent.toLowerCase();
                queryTerms.forEach(term => {
                    const matches = (content.match(new RegExp(term, 'g')) ?? []).length;
                    score += matches * 0.1;
                });

                // NEW: Importance-based boosting (using static config)
                const importanceWeight = this.RERANKING_CONFIG.IMPORTANCE_WEIGHTS[
                    doc.metadata.importance as keyof typeof this.RERANKING_CONFIG.IMPORTANCE_WEIGHTS
                ] ?? 1.0;
                score *= importanceWeight;

                // NEW: Quality score boosting (using static config)
                if (doc.metadata.qualityScore) {
                    score *= (this.RERANKING_CONFIG.QUALITY_WEIGHT + 
                             (doc.metadata.qualityScore as number) * this.RERANKING_CONFIG.QUALITY_WEIGHT);
                }

                // NEW: Freshness decay (using static config)
                if (doc.metadata.lastVerified) {
                    const daysSinceVerified = this.getDaysSince(doc.metadata.lastVerified as Date);
                    const freshnessScore = Math.exp(
                        -daysSinceVerified / this.RERANKING_CONFIG.FRESHNESS_DECAY_DAYS
                    );
                    score *= (1 - this.RERANKING_CONFIG.FRESHNESS_WEIGHT + 
                             freshnessScore * this.RERANKING_CONFIG.FRESHNESS_WEIGHT);
                }

                // NEW: User context matching (using static config)
                if (options?.userContext?.technicalLevel && 
                    doc.metadata.technicalLevel === options.userContext.technicalLevel) {
                    score *= this.RERANKING_CONFIG.TECHNICAL_MATCH_BOOST;
                }

                // NEW: Topic relevance (using static config)
                if (options?.userContext?.preferredTopics && doc.metadata.topics) {
                    const docTopics = doc.metadata.topics as string[];
                    const topicOverlap = options.userContext.preferredTopics.filter(
                        topic => docTopics.includes(topic)
                    ).length;
                    score *= (1 + topicOverlap * this.RERANKING_CONFIG.TOPIC_OVERLAP_BOOST);
                }

                // NEW: Deprecation penalty (using static config)
                if (doc.metadata.deprecationDate && 
                    new Date() > new Date(doc.metadata.deprecationDate as string)) {
                    score *= this.RERANKING_CONFIG.DEPRECATION_PENALTY;
                }

                // Existing: Recent documents boost (using static config)
                if (doc.metadata.createdAt) {
                    const createdAt = doc.metadata.createdAt as string | Date;
                    const age = Date.now() - new Date(createdAt).getTime();
                    const daysSinceCreation = age / (1000 * 60 * 60 * 24);
                    if (daysSinceCreation < this.RERANKING_CONFIG.RECENT_DOCUMENT_DAYS) {
                        score += this.RERANKING_CONFIG.RECENT_DOCUMENT_BOOST;
                    }
                }

                // Existing: Frequently accessed boost (using static config)
                if ((doc.metadata.accessCount as number) > this.RERANKING_CONFIG.ACCESS_COUNT_THRESHOLD) {
                    score += this.RERANKING_CONFIG.ACCESS_COUNT_BOOST;
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
     * Helper method to calculate days since a given date
     */
    private getDaysSince(date: Date): number {
        const now = new Date();
        const diff = now.getTime() - new Date(date).getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    }

    /**
     * Load user preferences from Memory models for personalized retrieval
     */
    private async loadUserPreferences(userId?: string): Promise<any | null> {
        if (!userId) return null;
        
        try {
            const { UserPreference } = await import('../models/Memory');
            const preferences = await UserPreference.findOne({ userId, isActive: true });
            
            return preferences;
        } catch (error) {
            loggingService.warn('Failed to load user preferences', {
                component: 'RetrievalService',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
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
            // Check if query contains a link - if so, skip Google Drive files to avoid confusion
            const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
            const queryContainsLink = urlPattern.test(query);
            
            // Get regular retrieval results first
            const regularResults = await this.retrieve(query, { ...options, useCache: false });
            
            // If query contains a link, skip Google Drive files and return regular results
            if (queryContainsLink) {
                loggingService.debug('Skipping Google Drive files - query contains link', {
                    component: 'RetrievalService',
                    queryPreview: query.substring(0, 100)
                });
                return regularResults;
            }
            
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
