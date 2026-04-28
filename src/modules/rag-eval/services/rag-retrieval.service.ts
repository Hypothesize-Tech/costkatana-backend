import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Document } from '@langchain/core/documents';
import { RagServiceLocator } from './rag-service-locator';

export interface RetrievalOptions {
  userId?: string;
  limit?: number;
  filters?: {
    source?: string[];
    dateRange?: { from: Date; to: Date };
    tags?: string[];
    projectId?: string;
    conversationId?: string;
    documentIds?: string[];
    domain?: string[];
    topics?: string[];
    contentType?: string[];
    technicalLevel?: string[];
    importance?: string[];
    minQualityScore?: number;
    maxAgeInDays?: number;
    excludeDeprecated?: boolean;
    mustContainKeywords?: string[];
    mustNotContainKeywords?: string[];
  };
  includeScore?: boolean;
  useCache?: boolean;
  rerank?: boolean;
  userContext?: {
    technicalLevel?: string;
    preferredTopics?: string[];
    recentQueries?: string[];
  };
  /**
   * Weight for vector rank contribution in RRF merge (0–1). Lexical weight is `1 - hybridVectorWeight`.
   * Default 0.6 — matches common “slightly favor semantics” tuning.
   */
  hybridVectorWeight?: number;
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
  'metadata.domain'?: { $in: string[] };
  'metadata.topics'?: { $in: string[] };
  'metadata.contentType'?: { $in: string[] };
  'metadata.technicalLevel'?: { $in: string[] };
  'metadata.importance'?: { $in: string[] };
  'metadata.qualityScore'?: { $gte: number };
  'metadata.lastVerified'?: { $gte: Date };
  $or?: Array<Record<string, any>>;
}

interface ScoredDocument {
  doc: Document;
  score: number;
}

/** Constant for Reciprocal Rank Fusion — standard value from the BM25+RRF literature */
const RRF_K = 60;

@Injectable()
export class RagRetrievalService implements OnModuleInit {
  private readonly logger = new Logger(RagRetrievalService.name);
  private vectorStore: any = null;
  private embeddings?: any;

  constructor(@InjectModel('Document') private documentModel: Model<any>) {}

  async onModuleInit() {
    await this.initializeVectorStore();
  }

  async retrieve(
    query: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult> {
    const startTime = Date.now();
    const limit = options.limit ?? 5;

    try {
      this.logger.log('Starting document retrieval', {
        component: 'RagRetrievalService',
        operation: 'retrieve',
        query: query.substring(0, 100),
        options,
      });

      // Fast path: when the caller has selected specific documentIds (e.g.
      // user attached a PDF to the chat), skip vector + lexical search and
      // return all chunks of those documents directly from MongoDB. This
      // bypasses the vector-search failure modes (Atlas $vectorSearch not
      // configured, embeddings not built yet, semantic miss on a short
      // query) that otherwise cause "I don't have enough information"
      // fallbacks when the answer is literally in the attached file.
      const directIds = options.filters?.documentIds;
      if (directIds && directIds.length > 0) {
        const direct = await this.retrieveByDocumentIds(
          directIds,
          options,
          startTime,
        );
        if (direct.documents.length > 0) {
          return direct;
        }
        // If direct fetch found nothing, fall through to vector search so
        // we at least return something (indexing may still be pending).
      }

      // Check cache first
      if (options.useCache !== false) {
        const cached = await this.getCachedResults(query, options);
        if (cached) {
          this.logger.log('Cache hit for retrieval query', {
            component: 'RagRetrievalService',
            query: query.substring(0, 100),
          });

          return {
            ...cached,
            cacheHit: true,
            retrievalTime: Date.now() - startTime,
            stats: {
              ...(cached.stats || {
                sources: [],
                cacheHit: true,
                retrievalTime: 0,
              }),
              cacheHit: true,
              retrievalTime: Date.now() - startTime,
            },
          };
        }
      }

      // Stage 1: Run vector search and BM25 lexical search in parallel
      const [vectorResults, lexicalResults] = await Promise.all([
        this.vectorSearch(query, limit * 4, options),
        this.lexicalSearch(query, limit * 4, options),
      ]);

      const vectorW = Math.min(
        1,
        Math.max(0, options.hybridVectorWeight ?? 0.6),
      );
      const initialResults = this.mergeWithRRF(vectorResults, lexicalResults, {
        vectorWeight: vectorW,
        lexicalWeight: 1 - vectorW,
        limit: limit * 4,
      });

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
            retrievalTime: Date.now() - startTime,
          },
        };
      }

      // Stage 2: Apply metadata filters
      let filteredResults = this.applyFilters(initialResults, options);

      // Stage 3: Re-ranking (if enabled)
      if (options.rerank && filteredResults.length > limit) {
        filteredResults = this.rerankResults(
          query,
          filteredResults,
          limit,
          options,
        );
      } else {
        filteredResults = filteredResults.slice(0, limit);
      }

      // Stage 4: Deduplicate
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
          retrievalTime: Date.now() - startTime,
        },
      };

      // Cache results
      if (options.useCache !== false) {
        await this.cacheResults(query, options, result);
      }

      this.logger.log('Document retrieval completed', {
        component: 'RagRetrievalService',
        operation: 'retrieve',
        documentsReturned: deduplicated.length,
        totalResults: initialResults.length,
        retrievalTime: result.retrievalTime,
      });

      return result;
    } catch (error) {
      this.logger.error('Document retrieval failed', {
        component: 'RagRetrievalService',
        operation: 'retrieve',
        error: error instanceof Error ? error.message : String(error),
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
          retrievalTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Load all chunks of the given documentIds directly from MongoDB, sorted by
   * parent-doc ordinal then chunk index. No embeddings or vector search
   * required. Used when the user explicitly attached documents to the chat —
   * they want those specific docs, not "most semantically similar" chunks.
   *
   * Public so the RetrieveModule can bypass strategy selection and call this
   * directly when the request carries a `documentIds` filter.
   */
  public async retrieveByDocumentIds(
    documentIds: string[],
    options: RetrievalOptions,
    startTime: number = Date.now(),
  ): Promise<RetrievalResult> {
    const filter: Record<string, unknown> = {
      'metadata.documentId': { $in: documentIds },
      status: 'active',
    };
    // Coerce to string so we match chunks regardless of whether the write
    // side stored the userId as an ObjectId or a string.
    const userIdStr = options.userId ? String(options.userId) : '';
    if (userIdStr) {
      filter['metadata.userId'] = userIdStr;
    }

    const limit = Math.max(options.limit ?? 5, documentIds.length * 20);
    let rows = await this.documentModel
      .find(filter)
      .sort({ 'metadata.documentId': 1, chunkIndex: 1 })
      .limit(limit)
      .lean()
      .exec();

    // Fallback: if strict userId filter returned nothing but the documentIds
    // exist with a differently-typed userId, still surface them when the
    // coerced-string comparison matches. Avoids "I don't have enough
    // information" on documents the user legitimately owns.
    if (rows.length === 0 && userIdStr) {
      const loose = await this.documentModel
        .find({
          'metadata.documentId': { $in: documentIds },
          status: 'active',
        })
        .sort({ 'metadata.documentId': 1, chunkIndex: 1 })
        .limit(limit)
        .lean()
        .exec();
      rows = loose.filter(
        (r: { metadata?: { userId?: unknown } }) =>
          String(r.metadata?.userId ?? '') === userIdStr,
      );
    }

    const documents: Document[] = rows.map(
      (row: Record<string, unknown> & { content?: string; metadata?: Record<string, unknown>; chunkIndex?: number; totalChunks?: number }) =>
        new Document({
          pageContent: String(row.content ?? ''),
          metadata: {
            ...(row.metadata ?? {}),
            chunkIndex: row.chunkIndex,
            totalChunks: row.totalChunks,
            score: 1, // direct fetch — no similarity score
          },
        }),
    );

    const sources = Array.from(
      new Set(
        rows
          .map((r: { metadata?: { fileName?: string; documentId?: string } }) =>
            r.metadata?.fileName ?? r.metadata?.documentId,
          )
          .filter((s: unknown): s is string => typeof s === 'string'),
      ),
    );

    this.logger.log('Direct-fetch retrieval by documentIds', {
      component: 'RagRetrievalService',
      operation: 'retrieveByDocumentIds',
      documentIds,
      chunksFound: rows.length,
    });

    return {
      documents,
      sources,
      totalResults: rows.length,
      cacheHit: false,
      retrievalTime: Date.now() - startTime,
      stats: {
        sources,
        cacheHit: false,
        retrievalTime: Date.now() - startTime,
      },
    };
  }

  private async initializeVectorStore(): Promise<void> {
    try {
      // Initialize embeddings using Bedrock directly
      const { BedrockEmbeddings } = await import('@langchain/aws');
      this.embeddings = new BedrockEmbeddings({
        model: 'amazon.titan-embed-text-v2:0',
        region: process.env.AWS_REGION ?? 'us-east-1',
      });

      this.logger.log('Vector store initialized');
    } catch (error) {
      this.logger.warn('Vector store initialization failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.embeddings = null;
    }
  }

  private async vectorSearch(
    query: string,
    limit: number,
    options: RetrievalOptions,
  ): Promise<Document[]> {
    try {
      // If embeddings not available, return empty results
      if (!this.embeddings) {
        this.logger.warn('Embeddings not available, returning empty results', {
          component: 'RagRetrievalService',
        });
        return [];
      }

      // Build filter for MongoDB
      const mongoFilters: MongoFilters = this.buildMongoFilters(options);

      // Use MongoDB aggregation for vector search
      const pipeline = [
        {
          $vectorSearch: {
            index: 'vector_index',
            path: 'embedding',
            queryVector: await this.getQueryEmbedding(query),
            numCandidates: limit * 2,
            limit: limit,
            filter: mongoFilters,
          },
        },
        {
          $project: {
            pageContent: 1,
            metadata: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      const results = await this.documentModel.aggregate(pipeline);

      return results.map(
        (item) =>
          new Document({
            pageContent: item.pageContent,
            metadata: {
              ...item.metadata,
              score: item.score,
            },
          }),
      );
    } catch (error) {
      this.logger.error('Vector search failed', {
        component: 'RagRetrievalService',
        operation: 'vectorSearch',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async getQueryEmbedding(query: string): Promise<number[]> {
    if (!this.embeddings) {
      throw new Error('Embeddings not initialized');
    }

    try {
      const embedding = await this.embeddings.embedQuery(query);
      return embedding;
    } catch (error) {
      this.logger.error('Query embedding failed', {
        component: 'RagRetrievalService',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * BM25-style lexical search via MongoDB $text index.
   * Rare, specific terms (e.g. incident IDs, model names) receive higher
   * TF-IDF weighting, complementing the semantic vector search.
   */
  private async lexicalSearch(
    query: string,
    limit: number,
    options: RetrievalOptions,
  ): Promise<Document[]> {
    try {
      const mongoFilters = this.buildMongoFilters(options);

      const pipeline: any[] = [
        {
          $match: {
            ...mongoFilters,
            $text: { $search: query },
          },
        },
        {
          $addFields: {
            textScore: { $meta: 'textScore' },
          },
        },
        { $sort: { textScore: -1 } },
        { $limit: limit },
        {
          $project: {
            pageContent: 1,
            metadata: 1,
            textScore: 1,
          },
        },
      ];

      const results = await this.documentModel.aggregate(pipeline);

      return results.map(
        (item) =>
          new Document({
            pageContent: item.pageContent,
            metadata: {
              ...item.metadata,
              score: item.textScore ?? 0,
              searchType: 'lexical',
            },
          }),
      );
    } catch (error) {
      // Lexical search can fail if the text index doesn't exist yet — degrade
      // gracefully so the vector path still returns results.
      this.logger.warn('Lexical search failed, falling back to vector-only', {
        component: 'RagRetrievalService',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion — merges two ranked lists without needing
   * their scores to be on the same scale.
   *
   * finalScore = vectorWeight × (1 / (RRF_K + vectorRank))
   *            + lexicalWeight × (1 / (RRF_K + lexicalRank))
   */
  private mergeWithRRF(
    vectorDocs: Document[],
    lexicalDocs: Document[],
    opts: { vectorWeight: number; lexicalWeight: number; limit: number },
  ): Document[] {
    const { vectorWeight, lexicalWeight, limit } = opts;

    // Map pageContent → combined score; keep best Document object per chunk
    const scoreMap = new Map<string, { doc: Document; rrfScore: number }>();

    const applyRank = (docs: Document[], weight: number) => {
      docs.forEach((doc, idx) => {
        const key = doc.pageContent;
        const rankScore = weight * (1 / (RRF_K + idx + 1));
        const existing = scoreMap.get(key);
        if (existing) {
          existing.rrfScore += rankScore;
        } else {
          scoreMap.set(key, { doc, rrfScore: rankScore });
        }
      });
    };

    applyRank(vectorDocs, vectorWeight);
    applyRank(lexicalDocs, lexicalWeight);

    return Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit)
      .map(
        ({ doc, rrfScore }) =>
          new Document({
            pageContent: doc.pageContent,
            metadata: {
              ...doc.metadata,
              score: rrfScore,
              searchType: 'hybrid',
            },
          }),
      );
  }

  private buildMongoFilters(options: RetrievalOptions): MongoFilters {
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

    if (
      options.filters?.documentIds &&
      options.filters.documentIds.length > 0
    ) {
      mongoFilters['metadata.documentId'] = {
        $in: options.filters.documentIds,
      };
    }

    if (options.filters?.dateRange) {
      mongoFilters.createdAt = {
        $gte: options.filters.dateRange.from,
        $lte: options.filters.dateRange.to,
      };
    }

    // Enhanced semantic metadata filters
    if (options.filters?.domain && options.filters.domain.length > 0) {
      mongoFilters['metadata.domain'] = { $in: options.filters.domain };
    }

    if (options.filters?.topics && options.filters.topics.length > 0) {
      mongoFilters['metadata.topics'] = { $in: options.filters.topics };
    }

    if (
      options.filters?.contentType &&
      options.filters.contentType.length > 0
    ) {
      mongoFilters['metadata.contentType'] = {
        $in: options.filters.contentType,
      };
    }

    if (
      options.filters?.technicalLevel &&
      options.filters.technicalLevel.length > 0
    ) {
      mongoFilters['metadata.technicalLevel'] = {
        $in: options.filters.technicalLevel,
      };
    }

    if (options.filters?.importance && options.filters.importance.length > 0) {
      mongoFilters['metadata.importance'] = { $in: options.filters.importance };
    }

    if (options.filters?.minQualityScore !== undefined) {
      mongoFilters['metadata.qualityScore'] = {
        $gte: options.filters.minQualityScore,
      };
    }

    if (options.filters?.maxAgeInDays !== undefined) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.filters.maxAgeInDays);
      mongoFilters['metadata.lastVerified'] = { $gte: cutoffDate };
    }

    if (options.filters?.excludeDeprecated) {
      mongoFilters['$or'] = [
        { 'metadata.deprecationDate': { $exists: false } },
        { 'metadata.deprecationDate': { $gt: new Date() } },
      ];
    }

    return mongoFilters;
  }

  private applyFilters(
    documents: Document[],
    options: RetrievalOptions,
  ): Document[] {
    let filtered = documents;

    // User isolation - CRITICAL for security
    if (options.userId) {
      filtered = filtered.filter((doc) => {
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

  private rerankResults(
    query: string,
    documents: Document[],
    limit: number,
    options?: RetrievalOptions,
  ): Document[] {
    try {
      // Simple re-ranking based on query term frequency and document metadata
      const queryTerms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length > 2);

      const scored: ScoredDocument[] = documents.map((doc) => {
        let score = (doc.metadata.score as number) ?? 0;

        // Boost score based on query term matches in content
        const content = doc.pageContent.toLowerCase();
        queryTerms.forEach((term) => {
          const matches = (content.match(new RegExp(term, 'g')) ?? []).length;
          score += matches * 0.1;
        });

        // Importance-based boosting
        const importanceWeight = this.getImportanceWeight(
          doc.metadata.importance as string,
        );
        score *= importanceWeight;

        // Quality score boosting
        if (doc.metadata.qualityScore) {
          score *= 0.8 + (doc.metadata.qualityScore as number) * 0.2;
        }

        // Freshness decay
        if (doc.metadata.lastVerified) {
          const daysSinceVerified = this.getDaysSince(
            doc.metadata.lastVerified as Date,
          );
          const freshnessScore = Math.exp(-daysSinceVerified / 30); // 30 day decay
          score *= 0.7 + freshnessScore * 0.3;
        }

        // User context matching
        if (
          options?.userContext?.technicalLevel &&
          doc.metadata.technicalLevel === options.userContext.technicalLevel
        ) {
          score *= 1.2;
        }

        // Topic relevance
        if (options?.userContext?.preferredTopics && doc.metadata.topics) {
          const docTopics = doc.metadata.topics as string[];
          const topicOverlap = options.userContext.preferredTopics.filter(
            (topic) => docTopics.includes(topic),
          ).length;
          score *= 1 + topicOverlap * 0.1;
        }

        return { doc, score };
      });

      // Sort by score and take top results
      scored.sort((a, b) => b.score - a.score);

      // Update document metadata with scores
      const rankedDocuments = scored.slice(0, limit).map((item) => ({
        ...item.doc,
        metadata: {
          ...item.doc.metadata,
          score: item.score,
          reranked: true,
        },
      }));

      return rankedDocuments;
    } catch (error) {
      this.logger.error('Re-ranking failed', {
        component: 'RagRetrievalService',
        operation: 'rerankResults',
        error: error instanceof Error ? error.message : String(error),
      });
      return documents.slice(0, limit);
    }
  }

  private getImportanceWeight(importance?: string): number {
    const weights: Record<string, number> = {
      low: 0.8,
      medium: 1.0,
      high: 1.2,
      critical: 1.3,
    };
    return weights[importance || 'medium'] || 1.0;
  }

  private getDaysSince(date: Date): number {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  private deduplicateResults(documents: Document[]): Document[] {
    const seen = new Set<string>();
    const deduplicated: Document[] = [];

    for (const doc of documents) {
      const key =
        (doc.metadata._id as string) ||
        (doc.metadata.documentId as string) ||
        doc.pageContent.substring(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(doc);
      }
    }

    return deduplicated;
  }

  private extractSources(documents: Document[]): string[] {
    const sources = new Set<string>();

    for (const doc of documents) {
      const source = doc.metadata?.fileName || doc.metadata?.source;
      if (source) {
        sources.add(source);
      }
    }

    return Array.from(sources);
  }

  private async getCachedResults(
    query: string,
    options: RetrievalOptions,
  ): Promise<RetrievalResult | null> {
    try {
      const cacheKey = `retrieval:${this.getCacheKey(query, options)}`;
      const cached =
        await RagServiceLocator.getCacheService().get<RetrievalResult>(
          cacheKey,
        );

      if (cached && cached.documents) {
        return cached;
      }
    } catch (error) {
      // Cache miss or error
    }
    return null;
  }

  private async cacheResults(
    query: string,
    options: RetrievalOptions,
    results: RetrievalResult,
  ): Promise<void> {
    try {
      const cacheKey = `retrieval:${this.getCacheKey(query, options)}`;
      await RagServiceLocator.getCacheService().set(cacheKey, results, 3600); // 1 hour
    } catch (error) {
      // Non-critical error
    }
  }

  private getCacheKey(query: string, options: RetrievalOptions): string {
    // Create a deterministic cache key based on query and options
    const optionsStr = JSON.stringify({
      userId: options.userId,
      limit: options.limit,
      filters: options.filters,
      userContext: options.userContext,
      hybridVectorWeight: options.hybridVectorWeight,
    });
    return `${query}:${optionsStr}`.substring(0, 200); // Limit key length
  }

  /**
   * Retrieve user-specific documents
   */
  async retrieveUserDocuments(
    userId: string,
    query: string,
    options: Omit<RetrievalOptions, 'userId'> = {},
  ): Promise<RetrievalResult> {
    return this.retrieve(query, {
      ...options,
      userId,
      filters: {
        ...options.filters,
        source: ['user-upload', 'user-generated'], // User-specific sources
      },
    });
  }

  /**
   * Retrieve from knowledge base
   */
  async retrieveKnowledgeBase(
    query: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult> {
    return this.retrieve(query, {
      ...options,
      filters: {
        ...options.filters,
        source: ['knowledge-base'], // Knowledge base sources only
      },
    });
  }

  /**
   * Retrieve with additional context
   */
  async retrieveWithContext(
    query: string,
    context: {
      conversationHistory?: string[];
      userPreferences?: Record<string, any>;
      domain?: string;
      technicalLevel?: string;
    },
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult> {
    // Enhance options based on context
    const enhancedOptions: RetrievalOptions = {
      ...options,
      filters: {
        ...options.filters,
      },
      userContext: {
        ...options.userContext,
      },
    };

    // Add domain filter if specified
    if (context.domain) {
      enhancedOptions.filters!.domain = [context.domain];
    }

    // Add technical level to user context
    if (context.technicalLevel) {
      enhancedOptions.userContext!.technicalLevel = context.technicalLevel;
    }

    // Add conversation history for better context
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      enhancedOptions.userContext!.recentQueries =
        context.conversationHistory.slice(-5); // Last 5 queries
    }

    // Add user preferences
    if (context.userPreferences?.preferredTopics) {
      enhancedOptions.userContext!.preferredTopics =
        context.userPreferences.preferredTopics;
    }

    return this.retrieve(query, enhancedOptions);
  }

  /**
   * Retrieve documents from Google Drive files
   */
  async retrieveWithGoogleDriveFiles(
    userId: string,
    query: string,
    options: Omit<RetrievalOptions, 'userId'> = {},
  ): Promise<RetrievalResult> {
    return this.retrieve(query, {
      ...options,
      userId,
      filters: {
        ...options.filters,
        source: ['google-drive'], // Google Drive sources only
      },
    });
  }

  /**
   * Clear retrieval cache
   */
  /**
   * Clear the retrieval cache.
   * If userId is provided, clear only that user's cache.
   * If no userId, clear all retrieval cache.
   */
  async clearCache(userId?: string): Promise<void> {
    // Step 1: Get the cache service from the service locator
    const cacheService = RagServiceLocator.getCacheService();

    try {
      if (!cacheService) {
        throw new Error('Cache service is not available');
      }

      if (userId) {
        const userCacheKeyPattern = `RAG:RETRIEVAL:${userId}:*`;

        this.logger.log('Clearing cache for user', {
          userId,
          pattern: userCacheKeyPattern,
        });

        // The cache service should implement deleteByPattern for a safe cache cleanup.
        if (
          typeof (
            cacheService as {
              deleteByPattern?: (pattern: string) => Promise<number>;
            }
          ).deleteByPattern === 'function'
        ) {
          await (
            cacheService as {
              deleteByPattern: (pattern: string) => Promise<number>;
            }
          ).deleteByPattern(userCacheKeyPattern);
        } else {
          this.logger.warn(
            'Cache service does not implement deleteByPattern. Skipping user cache clear.',
          );
        }
      } else {
        // Clear all retrieval cache, ideally only the RAG:RETRIEVAL namespace
        const allCachePattern = 'RAG:RETRIEVAL:*';
        this.logger.log('Clearing all retrieval cache', {
          pattern: allCachePattern,
        });
        if (
          typeof (
            cacheService as {
              deleteByPattern?: (pattern: string) => Promise<number>;
            }
          ).deleteByPattern === 'function'
        ) {
          await (
            cacheService as {
              deleteByPattern: (pattern: string) => Promise<number>;
            }
          ).deleteByPattern(allCachePattern);
        } else if (
          typeof (cacheService as { clearAll?: () => Promise<void> })
            .clearAll === 'function'
        ) {
          this.logger.warn(
            'Cache service not pattern-aware, falling back to clearAll.',
          );
          await (
            cacheService as unknown as { clearAll: () => Promise<void> }
          ).clearAll();
        } else {
          this.logger.warn(
            'Cache service does not support clearing by pattern or all. Skipping.',
          );
        }
      }

      this.logger.log('Cache cleared successfully', {
        userId: userId || 'all',
      });
    } catch (error) {
      this.logger.error('Failed to clear cache', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }
}
