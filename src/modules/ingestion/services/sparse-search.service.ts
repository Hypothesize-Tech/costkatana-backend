/**
 * Sparse Search Service for NestJS
 * BM25/TF-IDF based sparse search using MongoDB text indexes for keyword matching
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Document } from '../../../schemas/document/document.schema';

export interface SparseSearchResult {
  chunkId: string;
  score: number;
  content: string;
  metadata: {
    repoFullName: string;
    filePath: string;
    startLine: number;
    endLine: number;
    commitSha: string;
    chunkType: string;
    language: string;
    indexedAt?: Date;
  };
}

export interface SparseSearchOptions {
  repoFullName?: string;
  language?: string;
  chunkType?: string;
  filePath?: string;
  userId?: string;
  limit?: number;
  minScore?: number;
}

@Injectable()
export class SparseSearchService {
  private readonly logger = new Logger(SparseSearchService.name);

  constructor(
    @InjectModel('Document') private documentModel: Model<Document>,
  ) {}

  /**
   * Search using MongoDB text index (BM25-like scoring)
   */
  async search(
    query: string,
    options: SparseSearchOptions = {},
  ): Promise<SparseSearchResult[]> {
    try {
      const limit = options.limit || 50;
      const minScore = options.minScore || 0.1;

      // Build query with filters
      const mongoQuery: any = {
        status: 'active',
        $text: { $search: query },
      };

      if (options.repoFullName) {
        mongoQuery['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.language) {
        mongoQuery['metadata.language'] = options.language;
      }

      if (options.chunkType) {
        mongoQuery['metadata.chunkType'] = options.chunkType;
      }

      if (options.filePath) {
        mongoQuery['metadata.filePath'] = options.filePath;
      }

      if (options.userId) {
        mongoQuery['metadata.userId'] = options.userId;
      }

      // Perform text search with score
      const results = await this.documentModel
        .find(mongoQuery, {
          score: { $meta: 'textScore' },
        })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit * 2) // Get more to filter by minScore
        .lean();

      // Filter by minScore and convert to result format
      const searchResults: SparseSearchResult[] = results
        .filter((doc: any) => (doc.score || 0) >= minScore)
        .slice(0, limit)
        .map((doc: any) => ({
          chunkId: doc._id.toString(),
          score: doc.score || 0,
          content: doc.content,
          metadata: {
            repoFullName: doc.metadata.repoFullName,
            filePath: doc.metadata.filePath,
            startLine: doc.metadata.startLine,
            endLine: doc.metadata.endLine,
            commitSha: doc.metadata.commitSha,
            chunkType: doc.metadata.chunkType,
            language: doc.metadata.language,
            indexedAt: doc.createdAt,
          },
        }));

      this.logger.log('Sparse search completed', {
        query: query.substring(0, 100),
        resultsCount: searchResults.length,
        options,
      });

      return searchResults;
    } catch (error) {
      this.logger.error('Sparse search failed', {
        query: query.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to regex search if text index fails
      return this.fallbackRegexSearch(query, options);
    }
  }

  /**
   * Exact identifier matching (function names, class names, etc.)
   */
  async searchExactIdentifiers(
    identifiers: string[],
    options: SparseSearchOptions = {},
  ): Promise<SparseSearchResult[]> {
    try {
      const limit = options.limit || 20;

      // Build query for exact matches in AST metadata
      const orConditions: any[] = [];

      for (const identifier of identifiers) {
        orConditions.push(
          { 'metadata.astMetadata.functionName': identifier },
          { 'metadata.astMetadata.className': identifier },
          { 'metadata.astMetadata.methodName': identifier },
          { content: new RegExp(`\\b${this.escapeRegex(identifier)}\\b`, 'i') },
        );
      }

      const mongoQuery: any = {
        status: 'active',
        $or: orConditions,
      };

      if (options.repoFullName) {
        mongoQuery['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.language) {
        mongoQuery['metadata.language'] = options.language;
      }

      if (options.userId) {
        mongoQuery['metadata.userId'] = options.userId;
      }

      const results = await this.documentModel
        .find(mongoQuery)
        .limit(limit)
        .lean();

      const searchResults: SparseSearchResult[] = results.map((doc: any) => ({
        chunkId: doc._id.toString(),
        score: 1.0, // Exact match gets max score
        content: doc.content,
        metadata: {
          repoFullName: doc.metadata.repoFullName,
          filePath: doc.metadata.filePath,
          startLine: doc.metadata.startLine,
          endLine: doc.metadata.endLine,
          commitSha: doc.metadata.commitSha,
          chunkType: doc.metadata.chunkType,
          language: doc.metadata.language,
          indexedAt: doc.createdAt,
        },
      }));

      this.logger.log('Exact identifier search completed', {
        identifiers,
        resultsCount: searchResults.length,
      });

      return searchResults;
    } catch (error) {
      this.logger.error('Exact identifier search failed', {
        identifiers,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Regex pattern matching
   */
  async searchRegex(
    pattern: string,
    options: SparseSearchOptions = {},
  ): Promise<SparseSearchResult[]> {
    try {
      const limit = options.limit || 20;
      const regex = new RegExp(pattern, 'i');

      const mongoQuery: any = {
        status: 'active',
        content: regex,
      };

      if (options.repoFullName) {
        mongoQuery['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.language) {
        mongoQuery['metadata.language'] = options.language;
      }

      if (options.userId) {
        mongoQuery['metadata.userId'] = options.userId;
      }

      const results = await this.documentModel
        .find(mongoQuery)
        .limit(limit)
        .lean();

      const searchResults: SparseSearchResult[] = results.map((doc: any) => ({
        chunkId: doc._id.toString(),
        score: 0.8, // Regex match score
        content: doc.content,
        metadata: {
          repoFullName: doc.metadata.repoFullName,
          filePath: doc.metadata.filePath,
          startLine: doc.metadata.startLine,
          endLine: doc.metadata.endLine,
          commitSha: doc.metadata.commitSha,
          chunkType: doc.metadata.chunkType,
          language: doc.metadata.language,
          indexedAt: doc.createdAt,
        },
      }));

      return searchResults;
    } catch (error) {
      this.logger.error('Regex search failed', {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Fallback regex search when text index is unavailable
   */
  private async fallbackRegexSearch(
    query: string,
    options: SparseSearchOptions = {},
  ): Promise<SparseSearchResult[]> {
    try {
      const limit = options.limit || 20;
      const queryTerms = query.split(/\s+/).filter((term) => term.length > 2);

      if (queryTerms.length === 0) {
        return [];
      }

      // Build regex pattern from query terms
      const regexPattern = queryTerms
        .map((term) => this.escapeRegex(term))
        .join('|');
      const regex = new RegExp(regexPattern, 'i');

      const mongoQuery: any = {
        status: 'active',
        content: regex,
      };

      if (options.repoFullName) {
        mongoQuery['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.language) {
        mongoQuery['metadata.language'] = options.language;
      }

      if (options.userId) {
        mongoQuery['metadata.userId'] = options.userId;
      }

      const results = await this.documentModel
        .find(mongoQuery)
        .limit(limit)
        .lean();

      // Calculate simple TF score
      const searchResults: SparseSearchResult[] = results
        .map((doc: any) => {
          const content = doc.content.toLowerCase();
          let score = 0;

          for (const term of queryTerms) {
            const matches = (
              content.match(new RegExp(this.escapeRegex(term), 'gi')) || []
            ).length;
            score += matches / Math.max(content.length / 1000, 1); // Normalize by content length
          }

          score = Math.min(score / queryTerms.length, 1.0); // Normalize to 0-1

          return {
            chunkId: doc._id.toString(),
            score,
            content: doc.content,
            metadata: {
              repoFullName: doc.metadata.repoFullName,
              filePath: doc.metadata.filePath,
              startLine: doc.metadata.startLine,
              endLine: doc.metadata.endLine,
              commitSha: doc.metadata.commitSha,
              chunkType: doc.metadata.chunkType,
              language: doc.metadata.language,
              indexedAt: doc.createdAt,
            },
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return searchResults;
    } catch (error) {
      this.logger.error('Fallback regex search failed', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Extract identifiers from query (function names, class names, etc.)
   */
  static extractIdentifiers(query: string): string[] {
    // Match common identifier patterns
    const patterns = [
      /[A-Z][a-zA-Z0-9]*/g, // PascalCase (classes)
      /[a-z][a-zA-Z0-9]*/g, // camelCase (functions, variables)
      /[A-Z_][A-Z0-9_]*/g, // UPPER_CASE (constants)
    ];

    const identifiers = new Set<string>();

    for (const pattern of patterns) {
      const matches = query.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          if (match.length > 2 && match.length < 50) {
            identifiers.add(match);
          }
        });
      }
    }

    return Array.from(identifiers);
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
