/**
 * LangChain Vector Store Service
 *
 * MongoDB-based vector store implementation for LangChain integration.
 * Provides vector search, similarity matching, and intelligent retrieval strategies.
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { VectorStore } from '@langchain/core/vectorstores';
import { Document as LangchainDocument } from '@langchain/core/documents';
import {
  Document,
  IDocument,
  DocumentDocument,
} from '../../../schemas/document/document.schema';
import { SafeBedrockEmbeddingsService } from './safe-bedrock-embeddings.service';
import { Model } from 'mongoose';
import * as crypto from 'crypto';

@Injectable()
export class LangchainVectorStoreService extends VectorStore {
  private readonly logger = new Logger(LangchainVectorStoreService.name);
  _vectorstoreType(): string {
    return 'mongodb';
  }

  vectorstoreType(): string {
    return 'mongodb';
  }

  constructor(
    @InjectModel(Document.name)
    private readonly documentModel: Model<DocumentDocument>,
    private readonly embeddingsService: SafeBedrockEmbeddingsService,
  ) {
    super(embeddingsService, {});
  }

  /**
   * Add documents to MongoDB with embeddings
   */
  async addDocuments(
    documents: LangchainDocument[],
    options?: {
      ids?: string[];
      userId?: string;
      projectId?: string;
      documentId?: string;
    },
  ): Promise<string[]> {
    const startTime = Date.now();
    const ids: string[] = [];

    try {
      this.logger.log('Adding documents to MongoDB VectorStore', {
        documentCount: documents.length,
        userId: options?.userId,
      });

      // Generate embeddings for all documents
      // Filter out empty documents to prevent embedding validation errors
      const texts = documents.map((doc) => doc.pageContent);
      const validIndices: number[] = [];
      const validTexts: string[] = [];

      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        if (text && text.trim().length > 0) {
          validIndices.push(i);
          validTexts.push(text.trim());
        }
      }

      if (validTexts.length === 0) {
        this.logger.warn(
          'No valid documents to embed, all documents are empty',
        );
        // Return empty IDs for all documents
        documents.forEach(() => {
          ids.push('');
        });
        return ids;
      }

      // Generate embeddings only for valid documents
      const validEmbeddings =
        await this.embeddingsService.embedDocuments(validTexts);

      // Map embeddings back to original document positions
      const embeddings: number[][] = texts.map(() => []);
      for (let i = 0; i < validIndices.length; i++) {
        embeddings[validIndices[i]] = validEmbeddings[i];
      }

      // Prepare documents for insertion
      const docsToInsert: Partial<IDocument>[] = documents.map((doc, idx) => {
        const contentHash = this.generateContentHash(doc.pageContent);
        const docId = options?.ids?.[idx] || crypto.randomUUID();
        ids.push(docId);

        // Merge metadata with options
        // IMPORTANT: Don't spread doc.metadata.source - it contains file path, not enum value
        const { source: _sourceIgnored, ...restMetadata } = doc.metadata || {};
        const metadata: IDocument['metadata'] = {
          userId: options?.userId ?? doc.metadata?.userId ?? '',
          projectId: options?.projectId ?? doc.metadata?.projectId,
          documentId: options?.documentId ?? doc.metadata?.documentId,
          source: 'user-upload' as const, // Always use enum value, not file path
          sourceType: doc.metadata?.sourceType ?? 'text',
          fileName: restMetadata.fileName,
          fileType: restMetadata.fileType,
          fileSize: restMetadata.fileSize,
          tags: restMetadata.tags ?? [],
          language: restMetadata.language,
          customMetadata: restMetadata.customMetadata,
          ...restMetadata, // Include any additional metadata fields
        };

        return {
          _id: docId,
          content: doc.pageContent,
          contentHash,
          embedding: embeddings[idx],
          metadata,
          chunkIndex: doc.metadata?.chunkIndex ?? idx,
          totalChunks: doc.metadata?.totalChunks ?? documents.length,
          ingestedAt: new Date(),
          status: 'active' as const,
          accessCount: 0,
        };
      });

      // Debug logging
      this.logger.log('About to insert documents into MongoDB', {
        documentsCount: docsToInsert.length,
        firstDocument: docsToInsert[0]
          ? {
              _id: docsToInsert[0]._id,
              userId: docsToInsert[0].metadata?.userId,
              documentId: docsToInsert[0].metadata?.documentId,
              fileName: docsToInsert[0].metadata?.fileName,
              source: docsToInsert[0].metadata?.source,
              embeddingLength: docsToInsert[0].embedding?.length,
              contentLength: docsToInsert[0].content?.length,
            }
          : null,
      });

      // Insert documents with duplicate handling
      try {
        const result = await this.documentModel.insertMany(docsToInsert, {
          ordered: false,
        });

        // Verify insertion
        if (result.length > 0 && result[0]?.metadata?.documentId) {
          const verifyQuery = {
            'metadata.documentId': result[0].metadata.documentId,
            'metadata.userId': result[0].metadata.userId,
            status: 'active',
          };

          const verifyCount =
            await this.documentModel.countDocuments(verifyQuery);

          if (verifyCount === result.length) {
            this.logger.log('Documents inserted and verified successfully', {
              expectedCount: result.length,
              foundCount: verifyCount,
              documentId: result[0]?.metadata?.documentId,
              userId: result[0]?.metadata?.userId,
            });
          } else {
            this.logger.error('Document verification failed', {
              expectedCount: result.length,
              foundCount: verifyCount,
              documentId: result[0]?.metadata?.documentId,
              userId: result[0]?.metadata?.userId,
            });
          }
        }

        this.logger.log('Documents added successfully', {
          documentCount: documents.length,
          duration: Date.now() - startTime,
          sampleMetadata:
            docsToInsert.length > 0
              ? {
                  documentId: docsToInsert[0]?.metadata?.documentId,
                  userId: docsToInsert[0]?.metadata?.userId,
                  source: docsToInsert[0]?.metadata?.source,
                }
              : 'none',
        });

        return ids;
      } catch (error: any) {
        // Handle duplicate key errors gracefully
        if (error.code === 11000 || error.writeErrors) {
          const writeErrors = error.writeErrors || [];
          const successfulInserts = docsToInsert.length - writeErrors.length;

          this.logger.warn('Duplicate key errors during insertion', {
            totalAttempted: docsToInsert.length,
            successfulInserts,
            duplicates: writeErrors.length,
          });

          // Return IDs for successful inserts, empty strings for duplicates
          return ids.map((id, index) => {
            const isDuplicate = writeErrors.some(
              (err: any) => err.index === index,
            );
            return isDuplicate ? '' : id;
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      this.logger.error('Failed to add documents', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add vectors directly (when embeddings are pre-computed)
   */
  async addVectors(
    vectors: number[][],
    documents: LangchainDocument[],
    options?: {
      ids?: string[];
      userId?: string;
      projectId?: string;
    },
  ): Promise<string[]> {
    const ids: string[] = [];

    try {
      const docsToInsert: Partial<IDocument>[] = documents.map((doc, idx) => {
        const contentHash = this.generateContentHash(doc.pageContent);
        const docId = options?.ids?.[idx] ?? crypto.randomUUID();
        ids.push(docId);

        const metadata = {
          ...doc.metadata,
          userId: options?.userId ?? doc.metadata?.userId,
          projectId: options?.projectId ?? doc.metadata?.projectId,
          source: doc.metadata?.source ?? 'user-upload',
          sourceType: doc.metadata?.sourceType ?? 'text',
        };

        return {
          _id: docId,
          content: doc.pageContent,
          contentHash,
          embedding: vectors[idx],
          metadata,
          chunkIndex: doc.metadata?.chunkIndex ?? idx,
          totalChunks: doc.metadata?.totalChunks ?? documents.length,
          ingestedAt: new Date(),
          status: 'active',
          accessCount: 0,
        };
      });

      await this.documentModel.insertMany(docsToInsert, { ordered: false });
      return ids;
    } catch (error) {
      this.logger.error('Failed to add vectors', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Intelligent search that automatically chooses between MMR and Cosine Similarity
   * based on query complexity and specificity
   */
  async intelligentSearch(
    query: string,
    k: number = 4,
    filter?: any,
  ): Promise<[LangchainDocument, number][]> {
    try {
      this.logger.log(
        'Performing intelligent search with autonomous strategy selection',
        {
          query: query.substring(0, 100),
          limit: k,
        },
      );

      // Validate query
      if (!query || query.trim().length === 0) {
        this.logger.warn(
          'Empty query provided to intelligentSearch, returning empty results',
        );
        return [];
      }

      // Analyze query to determine optimal strategy
      const analysis = await this.analyzeQuery(query);

      this.logger.log('Query analysis completed', {
        complexity: analysis.complexity,
        specificity: analysis.specificity,
        strategy: analysis.recommendedStrategy,
        confidence: analysis.confidence,
      });

      // Get search configuration based on strategy
      const searchConfig = this.getSearchConfig(
        analysis.recommendedStrategy,
        analysis.complexity,
      );

      // Execute search based on selected strategy
      let results: [LangchainDocument, number][];

      switch (analysis.recommendedStrategy) {
        case 'MMR':
          this.logger.log('Executing MMR search for diverse results', {
            k: searchConfig.k,
            fetchK: searchConfig.fetchK,
            lambda: searchConfig.lambda,
          });

          results = await this.maxMarginalRelevanceSearchWithScores(query, {
            k: searchConfig.k,
            fetchK: searchConfig.fetchK,
            lambda: searchConfig.lambda,
            filter,
          });
          break;

        case 'COSINE':
          this.logger.log('Executing Cosine Similarity search for precision', {
            k: searchConfig.k,
            threshold: searchConfig.threshold,
          });

          results = await this.similaritySearchWithScore(
            query,
            searchConfig.k,
            filter,
          );

          // Filter by threshold if specified
          if (searchConfig.threshold) {
            results = results.filter(
              ([, score]) => score >= searchConfig.threshold,
            );
          }
          break;

        case 'HYBRID':
          this.logger.log('Executing Hybrid search', {
            k: searchConfig.k,
          });

          // Hybrid: Get both MMR and Cosine results, merge intelligently
          const mmrResults = await this.maxMarginalRelevanceSearchWithScores(
            query,
            {
              k: Math.ceil(searchConfig.k / 2),
              fetchK: searchConfig.fetchK,
              lambda: searchConfig.lambda,
              filter,
            },
          );

          const cosineResults = await this.similaritySearchWithScore(
            query,
            Math.ceil(searchConfig.k / 2),
            filter,
          );

          // Merge and deduplicate
          results = this.mergeSearchResults(
            mmrResults,
            cosineResults,
            searchConfig.k,
          );
          break;

        default:
          // Fallback to cosine
          results = await this.similaritySearchWithScore(query, k, filter);
      }

      this.logger.log('Intelligent search completed', {
        strategy: analysis.recommendedStrategy,
        resultsFound: results.length,
        confidence: analysis.confidence,
      });

      // Add strategy metadata to results
      results.forEach(([doc]) => {
        doc.metadata = {
          ...doc.metadata,
          _searchStrategy: analysis.recommendedStrategy,
          _searchConfidence: analysis.confidence,
          _queryComplexity: analysis.complexity,
          _querySpecificity: analysis.specificity,
        };
      });

      return results;
    } catch (error) {
      this.logger.error('Intelligent search failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to traditional cosine similarity
      this.logger.log('Falling back to traditional cosine similarity search');
      return this.similaritySearchWithScore(query, k, filter);
    }
  }

  /**
   * Similarity search by pre-computed vector (required by LangChain VectorStore base class)
   */
  async similaritySearchVectorWithScore(
    queryVector: number[],
    k: number = 4,
    filter?: any,
  ): Promise<[LangchainDocument, number][]> {
    const pipeline: any[] = [
      {
        $vectorSearch: {
          index: 'document_vector_index',
          path: 'embedding',
          queryVector,
          numCandidates: k * 10,
          limit: k,
          filter: {
            status: { $eq: 'active' },
            ...filter,
          },
        },
      },
      {
        $project: {
          content: 1,
          metadata: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ];

    const results = await this.documentModel.aggregate(pipeline);
    return results.map((doc: any) => {
      const langchainDoc = new LangchainDocument({
        pageContent: doc.content,
        metadata: doc.metadata ?? {},
      });
      return [langchainDoc, doc.score ?? 0];
    });
  }

  /**
   * Similarity search with scores using MongoDB Atlas Vector Search
   * (Traditional Cosine Similarity approach)
   */
  async similaritySearchWithScore(
    query: string,
    k: number = 4,
    filter?: any,
  ): Promise<[LangchainDocument, number][]> {
    try {
      this.logger.log('Performing similarity search', {
        query: query.substring(0, 100),
        limit: k,
        filter,
      });

      // Validate query before embedding
      if (!query || query.trim().length === 0) {
        this.logger.warn(
          'Empty query provided to similaritySearchWithScore, returning empty results',
        );
        return [];
      }

      // Generate query embedding
      const queryEmbedding = await this.embeddingsService.embedQuery(
        query.trim(),
      );

      // Build MongoDB aggregation pipeline
      const pipeline: any[] = [
        {
          $vectorSearch: {
            index: 'document_vector_index',
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: k * 10,
            limit: k,
            filter: {
              status: { $eq: 'active' },
              ...filter,
            },
          },
        },
        {
          $project: {
            content: 1,
            metadata: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      const results = await this.documentModel.aggregate(pipeline);

      // Convert to LangChain Document format
      const documents: [LangchainDocument, number][] = results.map((doc) => {
        const langchainDoc = new LangchainDocument({
          pageContent: doc.content,
          metadata: doc.metadata,
        });
        return [langchainDoc, doc.score];
      });

      this.logger.log('Similarity search completed', {
        resultsFound: documents.length,
      });

      return documents;
    } catch (error) {
      this.logger.error('Similarity search failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to empty results if vector search fails
      return [];
    }
  }

  /**
   * Similarity search without scores
   */
  async similaritySearch(
    query: string,
    k: number = 4,
    filter?: any,
  ): Promise<LangchainDocument[]> {
    const results = await this.similaritySearchWithScore(query, k, filter);
    return results.map(([doc]) => doc);
  }

  /**
   * Max marginal relevance search - balances relevance and diversity
   * Returns documents with scores
   */
  async maxMarginalRelevanceSearchWithScores(
    query: string,
    options: {
      k?: number;
      fetchK?: number;
      lambda?: number;
      filter?: any;
    } = {},
  ): Promise<[LangchainDocument, number][]> {
    const { k = 4, fetchK = 20, lambda = 0.5, filter } = options;

    // Fetch more candidates than needed
    const candidatesWithScores = await this.similaritySearchWithScore(
      query,
      fetchK,
      filter,
    );

    if (candidatesWithScores.length === 0) return [];

    // Get embeddings for all candidate documents
    const candidateEmbeddings: number[][] = [];
    for (const [doc] of candidatesWithScores) {
      // Fetch the actual embedding from the database
      const docRecord = await this.documentModel
        .findOne({
          content: doc.pageContent,
          'metadata.userId': doc.metadata?.userId,
        })
        .select('embedding');

      if (docRecord?.embedding) {
        candidateEmbeddings.push(docRecord.embedding);
      } else {
        // Fallback: generate embedding if not found
        // Validate content before embedding
        if (doc.pageContent && doc.pageContent.trim().length > 0) {
          const embedding = await this.embeddingsService.embedQuery(
            doc.pageContent.trim(),
          );
          candidateEmbeddings.push(embedding);
        } else {
          // Skip empty documents
          candidateEmbeddings.push([]);
        }
      }
    }

    // Get query embedding
    // Validate query before embedding
    if (!query || query.trim().length === 0) {
      this.logger.warn(
        'Empty query provided to maxMarginalRelevanceSearchWithScores',
      );
      return [];
    }

    const queryEmbedding = await this.embeddingsService.embedQuery(
      query.trim(),
    );

    // MMR algorithm implementation with proper diversity calculation
    const selected: [LangchainDocument, number][] = [];
    const selectedEmbeddings: number[][] = [];
    const selectedIndices = new Set<number>();

    while (
      selected.length < k &&
      selectedIndices.size < candidatesWithScores.length
    ) {
      let bestScore = -Infinity;
      let bestIdx = -1;

      for (let i = 0; i < candidatesWithScores.length; i++) {
        if (selectedIndices.has(i)) continue;

        const [, originalScore] = candidatesWithScores[i];
        const candidateEmbedding = candidateEmbeddings[i];

        // Calculate relevance score (similarity to query)
        const relevanceScore = this.cosineSimilarity(
          queryEmbedding,
          candidateEmbedding,
        );

        // Calculate diversity score (minimum similarity to already selected docs)
        let diversityScore = 1.0;
        if (selectedEmbeddings.length > 0) {
          const similarities = selectedEmbeddings.map((selectedEmb) =>
            this.cosineSimilarity(candidateEmbedding, selectedEmb),
          );
          // Diversity is inverse of max similarity to selected docs
          diversityScore = 1.0 - Math.max(...similarities);
        }

        // MMR score = λ * relevance + (1 - λ) * diversity
        const mmrScore =
          lambda * relevanceScore + (1 - lambda) * diversityScore;

        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      if (bestIdx !== -1) {
        const [doc, originalScore] = candidatesWithScores[bestIdx];
        // Return MMR score instead of original similarity score
        selected.push([doc, bestScore]);
        selectedEmbeddings.push(candidateEmbeddings[bestIdx]);
        selectedIndices.add(bestIdx);
      } else {
        break;
      }
    }

    this.logger.log('MMR search with scores completed', {
      candidatesCount: candidatesWithScores.length,
      selectedCount: selected.length,
      lambda,
    });

    return selected;
  }

  /**
   * Max marginal relevance search - balances relevance and diversity
   */
  async maxMarginalRelevanceSearch(
    query: string,
    options: {
      k?: number;
      fetchK?: number;
      lambda?: number;
      filter?: any;
    } = {},
  ): Promise<LangchainDocument[]> {
    const results = await this.maxMarginalRelevanceSearchWithScores(
      query,
      options,
    );
    return results.map(([doc]) => doc);
  }

  /**
   * Merge MMR and Cosine results intelligently
   */
  private mergeSearchResults(
    mmrResults: [LangchainDocument, number][],
    cosineResults: [LangchainDocument, number][],
    k: number,
  ): [LangchainDocument, number][] {
    // Create a map to track unique documents by content hash
    const seenContent = new Set<string>();
    const merged: [LangchainDocument, number][] = [];

    // Interleave results - alternate between MMR (diversity) and Cosine (precision)
    const maxLen = Math.max(mmrResults.length, cosineResults.length);

    for (let i = 0; i < maxLen && merged.length < k; i++) {
      // Add MMR result if available
      if (i < mmrResults.length) {
        const [doc, score] = mmrResults[i];
        const contentHash = crypto
          .createHash('sha256')
          .update(doc.pageContent)
          .digest('hex');

        if (!seenContent.has(contentHash)) {
          seenContent.add(contentHash);
          // Boost MMR scores slightly for diversity preference
          merged.push([doc, score * 1.05]);
        }
      }

      // Add Cosine result if available
      if (i < cosineResults.length && merged.length < k) {
        const [doc, score] = cosineResults[i];
        const contentHash = crypto
          .createHash('sha256')
          .update(doc.pageContent)
          .digest('hex');

        if (!seenContent.has(contentHash)) {
          seenContent.add(contentHash);
          merged.push([doc, score]);
        }
      }
    }

    // Sort by score (descending)
    merged.sort((a, b) => b[1] - a[1]);

    // Limit to k results
    return merged.slice(0, k);
  }

  /**
   * Analyze query to determine optimal search strategy
   */
  private async analyzeQuery(query: string): Promise<{
    complexity: 'simple' | 'medium' | 'complex';
    specificity: 'general' | 'specific' | 'very_specific';
    recommendedStrategy: 'COSINE' | 'MMR' | 'HYBRID';
    confidence: number;
  }> {
    // Simple heuristic-based analysis
    const words = query.trim().split(/\s+/);
    const wordCount = words.length;

    // Complexity based on length and structure
    let complexity: 'simple' | 'medium' | 'complex';
    if (wordCount <= 3) complexity = 'simple';
    else if (wordCount <= 7) complexity = 'medium';
    else complexity = 'complex';

    // Specificity based on presence of specific terms
    const specificIndicators = [
      'function',
      'class',
      'method',
      'error',
      'bug',
      'fix',
      'api',
      'endpoint',
      'database',
    ];
    const specificWords = words.filter((word) =>
      specificIndicators.includes(word.toLowerCase()),
    );
    let specificity: 'general' | 'specific' | 'very_specific';
    if (specificWords.length >= 2) specificity = 'very_specific';
    else if (specificWords.length === 1) specificity = 'specific';
    else specificity = 'general';

    // Strategy recommendation
    let recommendedStrategy: 'COSINE' | 'MMR' | 'HYBRID';
    let confidence: number;

    if (complexity === 'simple' && specificity === 'very_specific') {
      recommendedStrategy = 'COSINE';
      confidence = 0.9;
    } else if (complexity === 'complex' && specificity === 'general') {
      recommendedStrategy = 'MMR';
      confidence = 0.8;
    } else {
      recommendedStrategy = 'HYBRID';
      confidence = 0.7;
    }

    return {
      complexity,
      specificity,
      recommendedStrategy,
      confidence,
    };
  }

  /**
   * Get search configuration based on strategy
   */
  private getSearchConfig(
    strategy: 'COSINE' | 'MMR' | 'HYBRID',
    complexity: 'simple' | 'medium' | 'complex',
  ) {
    switch (strategy) {
      case 'COSINE':
        return {
          k: complexity === 'simple' ? 3 : complexity === 'medium' ? 4 : 5,
          threshold: 0.7,
        };

      case 'MMR':
        return {
          k: complexity === 'simple' ? 3 : complexity === 'medium' ? 4 : 5,
          fetchK: 20,
          lambda: 0.5,
        };

      case 'HYBRID':
        return {
          k: complexity === 'simple' ? 4 : complexity === 'medium' ? 6 : 8,
          fetchK: 20,
          lambda: 0.5,
        };
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }

  /**
   * Generate content hash for deduplication
   */
  private generateContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
