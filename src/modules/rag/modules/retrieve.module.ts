import { Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseRAGModule } from './base.module';
import { VectorStoreService } from '../../agent/services/vector-store.service';
import {
  OrchestratorInput,
  PatternResult,
  ModuleConfig,
  RAGDocument,
} from '../types/rag.types';
import { DEFAULT_RAG_CONFIG } from '../config/default.config';
import { generateSecureId } from '../../../common/utils/secure-id.util';
import {
  Document as IngestedDocument,
  DocumentDocument,
} from '../../../schemas/document/document.schema';

@Injectable()
export class RetrieveModule extends BaseRAGModule {
  constructor(
    @Inject(VectorStoreService)
    private readonly vectorStore: VectorStoreService,
    @InjectModel(IngestedDocument.name)
    private readonly documentModel: Model<DocumentDocument>,
  ) {
    super('RetrieveModule');
  }

  async execute(
    input: OrchestratorInput,
    previousResults?: any[],
  ): Promise<PatternResult> {
    try {
      const config = this.getConfig();
      const maxDocs = config.maxDocuments || 5;

      this.logger.debug('Executing retrieve module', {
        query: input.query.substring(0, 50),
        maxDocs,
        timeout: config.timeout,
      });

      // **Hard bypass**: when the chat carried `documentIds`, skip the vector
      // pipeline and pull every chunk of those documents directly from
      // MongoDB. Without this, vector search picks the closest match across
      // ALL the user's docs (FAISS often only has the pre-seeded KB items),
      // and the user's attached PDF is invisible — they get the
      // "I don't have enough information" fallback.
      const directIds = input.context?.documentIds;
      if (directIds && directIds.length > 0) {
        const userIdStr = String(input.context?.userId ?? '');
        this.logger.log(
          'RetrieveModule: documentIds bypass — direct fetch from MongoDB',
          {
            documentIds: directIds,
            userId: userIdStr,
          },
        );
        const baseFilter: Record<string, unknown> = {
          'metadata.documentId': { $in: directIds },
          status: 'active',
        };
        let rows = userIdStr
          ? await this.documentModel
              .find({ ...baseFilter, 'metadata.userId': userIdStr })
              .sort({ 'metadata.documentId': 1, chunkIndex: 1 })
              .limit(Math.max(maxDocs, directIds.length * 30))
              .lean()
              .exec()
          : await this.documentModel
              .find(baseFilter)
              .sort({ 'metadata.documentId': 1, chunkIndex: 1 })
              .limit(Math.max(maxDocs, directIds.length * 30))
              .lean()
              .exec();
        // Lenient fallback: legacy chunks may have stored userId as ObjectId
        // — coerce both sides to string and re-filter.
        if (rows.length === 0 && userIdStr) {
          const loose = await this.documentModel
            .find(baseFilter)
            .sort({ 'metadata.documentId': 1, chunkIndex: 1 })
            .limit(Math.max(maxDocs, directIds.length * 30))
            .lean()
            .exec();
          rows = loose.filter(
            (r: { metadata?: { userId?: unknown } }) =>
              String(r.metadata?.userId ?? '') === userIdStr,
          );
        }
        if (rows.length > 0) {
          const documents: RAGDocument[] = rows.map(
            (r: {
              content?: string;
              metadata?: Record<string, unknown>;
              chunkIndex?: number;
              totalChunks?: number;
            }, idx) => ({
              id: generateSecureId(`rag_doc_${idx}`),
              content: String(r.content ?? ''),
              metadata: {
                source: 'documentIds_direct',
                score: 1,
                relevanceRank: idx + 1,
                fileName:
                  (r.metadata as { fileName?: string } | undefined)?.fileName,
                documentId:
                  (r.metadata as { documentId?: string } | undefined)
                    ?.documentId,
                chunkIndex: r.chunkIndex,
                totalChunks: r.totalChunks,
                ...(r.metadata ?? {}),
              },
            }),
          );
          this.logger.log('RetrieveModule: documentIds bypass succeeded', {
            chunksLoaded: documents.length,
            documentIds: directIds,
          });
          return {
            documents,
            reasoning: `Loaded ${documents.length} chunks from ${directIds.length} attached document(s) directly by documentId.`,
            confidence: 1,
            metadata: {
              searchQuery: input.query,
              totalResults: documents.length,
              requestedResults: maxDocs,
              avgScore: 1,
              strategy: 'documentIds_direct',
              searchTime: Date.now(),
              hasCodeResults: false,
              hasStructuredResults: false,
            },
          };
        }
        this.logger.warn(
          'RetrieveModule: documentIds bypass found 0 chunks — falling through to vector search',
          { documentIds: directIds, userId: userIdStr },
        );
      }

      // Use vector store to search for relevant documents
      const searchResults = await Promise.race([
        this.vectorStore.search(input.query, maxDocs),
        this.createTimeoutPromise(config.timeout || 5000),
      ]);

      // Enhance results with RAG-specific processing
      const documents: RAGDocument[] = searchResults.map((result, index) => ({
        id: generateSecureId(`rag_doc_${index}`),
        content: result.content,
        metadata: {
          source: 'vector_store',
          score: result.score,
          relevanceRank: index + 1,
          querySimilarity: result.score,
          contentLength: result.content.length,
          hasCode:
            result.content.includes('```') || result.metadata?.type === 'code',
          hasStructuredData: this.detectStructuredData(result.content),
          timestamp: new Date().toISOString(),
          ...result.metadata,
        },
      }));

      // Calculate confidence based on result quality
      const avgScore =
        documents.length > 0
          ? documents.reduce((sum, doc) => sum + (doc.metadata.score || 0), 0) /
            documents.length
          : 0;

      const confidence = this.calculateConfidence(
        avgScore,
        documents.length,
        maxDocs,
      );

      return {
        documents,
        reasoning: `Retrieved ${documents.length} documents using vector similarity search. Average relevance score: ${avgScore.toFixed(3)}. ${this.generateRetrievalInsights(documents)}`,
        confidence,
        metadata: {
          searchQuery: input.query,
          totalResults: documents.length,
          requestedResults: maxDocs,
          avgScore: avgScore,
          strategy: 'vector_similarity',
          searchTime: Date.now(),
          hasCodeResults: documents.some((doc) => doc.metadata.hasCode),
          hasStructuredResults: documents.some(
            (doc) => doc.metadata.hasStructuredData,
          ),
        },
      };
    } catch (error: any) {
      this.logger.error('Retrieve module execution failed', {
        error: error.message,
      });
      return {
        documents: [],
        reasoning: `Failed to retrieve documents from vector store: ${error.message}`,
        confidence: 0,
        metadata: {
          error: error.message,
          searchQuery: input.query,
          strategy: 'vector_similarity',
        },
      };
    }
  }

  private detectStructuredData(content: string): boolean {
    // Check for structured data patterns
    const patterns = [
      /\d+\./g, // Numbered lists
      /[•●○▪]/g, // Bullet points
      /\|.*\|.*\|/g, // Tables
      /\{.*\}/g, // JSON-like structures
      /<.*>/g, // HTML tags
      /\$\$[\s\S]*?\$\$/g, // Math expressions
    ];

    return patterns.some((pattern) => pattern.test(content));
  }

  private calculateConfidence(
    avgScore: number,
    retrievedCount: number,
    requestedCount: number,
  ): number {
    let confidence = avgScore * 0.8; // Base confidence from relevance

    // Boost confidence if we got requested number of results
    if (retrievedCount >= requestedCount) {
      confidence += 0.1;
    }

    // Boost confidence for diverse, high-quality results
    if (retrievedCount >= 3 && avgScore > 0.7) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  private generateRetrievalInsights(documents: RAGDocument[]): string {
    if (documents.length === 0) return 'No documents retrieved.';

    const insights = [];
    const codeDocs = documents.filter((doc) => doc.metadata.hasCode).length;
    const structuredDocs = documents.filter(
      (doc) => doc.metadata.hasStructuredData,
    ).length;
    const avgLength =
      documents.reduce((sum, doc) => sum + doc.content.length, 0) /
      documents.length;

    if (codeDocs > 0) {
      insights.push(`${codeDocs} code-related documents`);
    }

    if (structuredDocs > 0) {
      insights.push(`${structuredDocs} structured data documents`);
    }

    if (avgLength > 1000) {
      insights.push('Long-form content available');
    } else if (avgLength < 200) {
      insights.push('Concise content snippets');
    }

    return insights.length > 0
      ? `Additional insights: ${insights.join(', ')}.`
      : '';
  }

  isApplicable(input: OrchestratorInput): boolean {
    // The retrieve module is always applicable as it's the core retrieval component
    // However, we can add more sophisticated applicability checks

    // Check if the query is valid and not empty
    if (!input.query || input.query.trim().length === 0) {
      this.logger.warn('Retrieve module: Query is empty or invalid');
      return false;
    }

    // Check if query is too short (might not provide enough context for retrieval)
    if (input.query.trim().length < 3) {
      this.logger.warn(
        'Retrieve module: Query too short for effective retrieval',
      );
      return false;
    }

    // Check for specific patterns that might benefit from retrieval
    const queryLower = input.query.toLowerCase();

    // Always applicable for these patterns
    const alwaysApplicablePatterns = [
      /\b(what|how|why|when|where|who)\b/i, // Question words
      /\b(find|search|get|show|list)\b/i, // Action words
      /\b(cost|price|pricing|usage|analytics)\b/i, // Domain-specific terms
      /\b(help|guide|documentation|docs)\b/i, // Help-related terms
    ];

    const hasApplicablePattern = alwaysApplicablePatterns.some((pattern) =>
      pattern.test(queryLower),
    );

    // Check for technical content indicators
    const technicalIndicators = [
      /\b(api|function|class|method|variable|database|server|client)\b/i,
      /\b(error|debug|log|trace|exception)\b/i,
      /\b(config|setting|parameter|option)\b/i,
    ];

    const hasTechnicalContent = technicalIndicators.some((pattern) =>
      pattern.test(queryLower),
    );

    // Retrieval is highly beneficial for technical queries or when asking questions
    if (hasApplicablePattern || hasTechnicalContent) {
      this.logger.debug('Retrieve module applicable', {
        hasApplicablePattern,
        hasTechnicalContent,
        queryLength: input.query.length,
      });
      return true;
    }

    // For other queries, still apply retrieval but with lower priority
    // This ensures we always try to provide relevant context
    this.logger.debug('Retrieve module applicable (fallback)', {
      queryLength: input.query.length,
    });

    return true;
  }

  getConfig(): ModuleConfig {
    return DEFAULT_RAG_CONFIG.modules.retrieve;
  }
}
