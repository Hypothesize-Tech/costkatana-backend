/**
 * Exact Search Service for NestJS
 * Uses symbol index and regex matching for precise lookups of functions, classes, TODOs, etc.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Document } from '../../../schemas/document/document.schema';

export interface ExactSearchResult {
  chunkId: string;
  content: string;
  metadata: {
    repoFullName: string;
    filePath: string;
    startLine: number;
    endLine: number;
    commitSha: string;
    chunkType: string;
    language: string;
    symbolName?: string;
    symbolType?: 'function' | 'class' | 'method' | 'variable';
  };
}

export interface ExactSearchOptions {
  repoFullName?: string;
  language?: string;
  userId?: string;
  limit?: number;
}

@Injectable()
export class ExactSearchService {
  private readonly logger = new Logger(ExactSearchService.name);

  constructor(
    @InjectModel('Document') private documentModel: Model<Document>,
  ) {}

  /**
   * Search for exact function/class names
   */
  async searchSymbol(
    symbolName: string,
    symbolType: 'function' | 'class' | 'method',
    options: ExactSearchOptions = {},
  ): Promise<ExactSearchResult[]> {
    try {
      const limit = options.limit || 20;

      const query: any = {
        status: 'active',
      };

      if (options.repoFullName) {
        query['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.language) {
        query['metadata.language'] = options.language;
      }

      if (options.userId) {
        query['metadata.userId'] = options.userId;
      }

      // Search in AST metadata
      if (symbolType === 'function') {
        query['metadata.astMetadata.functionName'] = symbolName;
      } else if (symbolType === 'class') {
        query['metadata.astMetadata.className'] = symbolName;
      } else if (symbolType === 'method') {
        query['metadata.astMetadata.methodName'] = symbolName;
      }

      const results = await this.documentModel.find(query).limit(limit).lean();

      return results.map((doc: any) => ({
        chunkId: doc._id.toString(),
        content: doc.content,
        metadata: {
          repoFullName: doc.metadata.repoFullName,
          filePath: doc.metadata.filePath,
          startLine: doc.metadata.startLine,
          endLine: doc.metadata.endLine,
          commitSha: doc.metadata.commitSha,
          chunkType: doc.metadata.chunkType,
          language: doc.metadata.language,
          symbolName,
          symbolType,
        },
      }));
    } catch (error) {
      this.logger.error('Symbol search failed', {
        symbolName,
        symbolType,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Search for TODOs, FIXMEs, etc.
   */
  async searchTodos(
    options: ExactSearchOptions = {},
  ): Promise<ExactSearchResult[]> {
    try {
      const limit = options.limit || 50;
      const todoPattern = /(TODO|FIXME|XXX|HACK|NOTE|BUG):\s*(.+)/gi;

      const query: any = {
        status: 'active',
        content: todoPattern,
      };

      if (options.repoFullName) {
        query['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.language) {
        query['metadata.language'] = options.language;
      }

      if (options.userId) {
        query['metadata.userId'] = options.userId;
      }

      const results = await this.documentModel.find(query).limit(limit).lean();

      return results.map((doc: any) => ({
        chunkId: doc._id.toString(),
        content: doc.content,
        metadata: {
          repoFullName: doc.metadata.repoFullName,
          filePath: doc.metadata.filePath,
          startLine: doc.metadata.startLine,
          endLine: doc.metadata.endLine,
          commitSha: doc.metadata.commitSha,
          chunkType: doc.metadata.chunkType,
          language: doc.metadata.language,
        },
      }));
    } catch (error) {
      this.logger.error('TODO search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Search for config keys (e.g., in .env, config files)
   */
  async searchConfigKey(
    key: string,
    options: ExactSearchOptions = {},
  ): Promise<ExactSearchResult[]> {
    try {
      const limit = options.limit || 20;
      // Pattern: KEY=value or KEY: value or "KEY": value
      const keyPattern = new RegExp(
        `(^|\\s)${this.escapeRegex(key)}\\s*[=:]\\s*`,
        'i',
      );

      const query: any = {
        status: 'active',
        'metadata.chunkType': 'config',
        content: keyPattern,
      };

      if (options.repoFullName) {
        query['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.userId) {
        query['metadata.userId'] = options.userId;
      }

      const results = await this.documentModel.find(query).limit(limit).lean();

      return results.map((doc: any) => ({
        chunkId: doc._id.toString(),
        content: doc.content,
        metadata: {
          repoFullName: doc.metadata.repoFullName,
          filePath: doc.metadata.filePath,
          startLine: doc.metadata.startLine,
          endLine: doc.metadata.endLine,
          commitSha: doc.metadata.commitSha,
          chunkType: doc.metadata.chunkType,
          language: doc.metadata.language,
        },
      }));
    } catch (error) {
      this.logger.error('Config key search failed', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Search for hex IDs, UUIDs, etc. (exact pattern matching)
   */
  async searchPattern(
    pattern: string,
    options: ExactSearchOptions = {},
  ): Promise<ExactSearchResult[]> {
    try {
      const limit = options.limit || 20;
      let regex: RegExp;

      try {
        regex = new RegExp(pattern, 'i');
      } catch (error) {
        this.logger.warn('Invalid regex pattern', {
          pattern,
        });
        return [];
      }

      const query: any = {
        status: 'active',
        content: regex,
      };

      if (options.repoFullName) {
        query['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.language) {
        query['metadata.language'] = options.language;
      }

      if (options.userId) {
        query['metadata.userId'] = options.userId;
      }

      const results = await this.documentModel.find(query).limit(limit).lean();

      return results.map((doc: any) => ({
        chunkId: doc._id.toString(),
        content: doc.content,
        metadata: {
          repoFullName: doc.metadata.repoFullName,
          filePath: doc.metadata.filePath,
          startLine: doc.metadata.startLine,
          endLine: doc.metadata.endLine,
          commitSha: doc.metadata.commitSha,
          chunkType: doc.metadata.chunkType,
          language: doc.metadata.language,
        },
      }));
    } catch (error) {
      this.logger.error('Pattern search failed', {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Search for identifiers (functions, classes, variables)
   */
  async searchIdentifiers(
    identifiers: string[],
    options: ExactSearchOptions = {},
  ): Promise<ExactSearchResult[]> {
    try {
      const limit = options.limit || 20;

      const query: any = {
        status: 'active',
        $or: [
          // Search in content for exact matches
          { content: { $regex: identifiers.join('|'), $options: 'i' } },
          // Search in AST metadata
          {
            $or: identifiers.flatMap((id) => [
              { 'metadata.astMetadata.functionName': id },
              { 'metadata.astMetadata.className': id },
              { 'metadata.astMetadata.methodName': id },
              { 'metadata.astMetadata.variableName': id },
            ]),
          },
        ],
      };

      if (options.repoFullName) {
        query['metadata.repoFullName'] = options.repoFullName;
      }

      if (options.language) {
        query['metadata.language'] = options.language;
      }

      if (options.userId) {
        query['metadata.userId'] = options.userId;
      }

      const results = await this.documentModel.find(query).limit(limit).lean();

      return results.map((doc: any) => ({
        chunkId: doc._id.toString(),
        content: doc.content,
        metadata: {
          repoFullName: doc.metadata.repoFullName,
          filePath: doc.metadata.filePath,
          startLine: doc.metadata.startLine,
          endLine: doc.metadata.endLine,
          commitSha: doc.metadata.commitSha,
          chunkType: doc.metadata.chunkType,
          language: doc.metadata.language,
        },
      }));
    } catch (error) {
      this.logger.error('Identifier search failed', {
        identifiers: identifiers.join(','),
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
