/**
 * Context File Manager Service for NestJS
 * Manages context files for AI conversations and code generation
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ContextFile {
  fileId: string;
  name: string;
  path: string;
  content: string;
  type: 'code' | 'config' | 'documentation' | 'data' | 'other';
  language?: string;
  size: number;
  lastModified: Date;
  checksum: string;
  metadata: {
    tags: string[];
    description?: string;
    relatedFiles: string[];
    usage: {
      readCount: number;
      lastRead: Date;
      contextsUsed: number;
    };
  };
}

export interface ContextBundle {
  bundleId: string;
  name: string;
  description: string;
  files: ContextFile[];
  createdAt: Date;
  lastUsed?: Date;
  usageCount: number;
  totalSize: number;
  tags: string[];
}

@Injectable()
export class ContextFileManagerService {
  private readonly logger = new Logger(ContextFileManagerService.name);

  private contextFiles: Map<string, ContextFile> = new Map();
  private contextBundles: Map<string, ContextBundle> = new Map();
  private readonly contextDir: string;

  constructor(private readonly configService: ConfigService) {
    this.contextDir = this.configService.get<string>(
      'CONTEXT_FILES_DIR',
      './context-files',
    );
    this.initializeContextDirectory();
  }

  /**
   * Initialize context directory
   */
  private async initializeContextDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.contextDir, { recursive: true });
      this.logger.log('Context directory initialized', {
        path: this.contextDir,
      });
    } catch (error) {
      this.logger.error('Failed to initialize context directory', {
        path: this.contextDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Add a context file
   */
  async addContextFile(
    name: string,
    content: string,
    type: ContextFile['type'] = 'code',
    metadata?: {
      language?: string;
      tags?: string[];
      description?: string;
      relatedFiles?: string[];
    },
  ): Promise<string> {
    const fileId = this.generateFileId();
    const filePath = path.join(this.contextDir, `${fileId}.ctx`);

    try {
      const checksum = this.calculateChecksum(content);
      const contextFile: ContextFile = {
        fileId,
        name,
        path: filePath,
        content,
        type,
        language: metadata?.language,
        size: Buffer.byteLength(content, 'utf8'),
        lastModified: new Date(),
        checksum,
        metadata: {
          tags: metadata?.tags || [],
          description: metadata?.description,
          relatedFiles: metadata?.relatedFiles || [],
          usage: {
            readCount: 0,
            lastRead: new Date(),
            contextsUsed: 0,
          },
        },
      };

      // Save to disk
      await fs.writeFile(
        filePath,
        JSON.stringify(contextFile, null, 2),
        'utf8',
      );

      // Add to memory
      this.contextFiles.set(fileId, contextFile);

      this.logger.log('Context file added', {
        fileId,
        name,
        type,
        size: contextFile.size,
      });

      return fileId;
    } catch (error) {
      this.logger.error('Failed to add context file', {
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a context file by ID
   */
  async getContextFile(fileId: string): Promise<ContextFile | null> {
    // Check memory first
    let contextFile = this.contextFiles.get(fileId);

    if (!contextFile) {
      // Try to load from disk
      try {
        const filePath = path.join(this.contextDir, `${fileId}.ctx`);
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content) as ContextFile;
        contextFile = parsed;
        this.contextFiles.set(fileId, parsed);
      } catch (error) {
        this.logger.warn('Context file not found', {
          fileId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }

    // Update usage statistics
    if (contextFile) {
      contextFile.metadata.usage.readCount++;
      contextFile.metadata.usage.lastRead = new Date();
      await this.saveContextFile(contextFile);
    }

    return contextFile ?? null;
  }

  /**
   * Update a context file
   */
  async updateContextFile(
    fileId: string,
    updates: {
      name?: string;
      content?: string;
      type?: ContextFile['type'];
      language?: string;
      tags?: string[];
      description?: string;
    },
  ): Promise<void> {
    const contextFile = await this.getContextFile(fileId);
    if (!contextFile) {
      throw new Error(`Context file ${fileId} not found`);
    }

    // Update fields
    if (updates.name) contextFile.name = updates.name;
    if (updates.content) {
      contextFile.content = updates.content;
      contextFile.size = Buffer.byteLength(updates.content, 'utf8');
      contextFile.checksum = this.calculateChecksum(updates.content);
    }
    if (updates.type) contextFile.type = updates.type;
    if (updates.language) contextFile.language = updates.language;
    if (updates.tags) contextFile.metadata.tags = updates.tags;
    if (updates.description)
      contextFile.metadata.description = updates.description;

    contextFile.lastModified = new Date();

    await this.saveContextFile(contextFile);
    this.contextFiles.set(fileId, contextFile);

    this.logger.log('Context file updated', {
      fileId,
      updates: Object.keys(updates),
    });
  }

  /**
   * Delete a context file
   */
  async deleteContextFile(fileId: string): Promise<void> {
    const contextFile = this.contextFiles.get(fileId);
    if (!contextFile) {
      throw new Error(`Context file ${fileId} not found`);
    }

    try {
      // Remove from disk
      await fs.unlink(contextFile.path);

      // Remove from memory
      this.contextFiles.delete(fileId);

      this.logger.log('Context file deleted', {
        fileId,
        name: contextFile.name,
      });
    } catch (error) {
      this.logger.error('Failed to delete context file', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Search context files
   */
  async searchContextFiles(query: {
    name?: string;
    type?: ContextFile['type'];
    language?: string;
    tags?: string[];
    content?: string;
  }): Promise<ContextFile[]> {
    const results: ContextFile[] = [];

    for (const contextFile of this.contextFiles.values()) {
      let matches = true;

      if (
        query.name &&
        !contextFile.name.toLowerCase().includes(query.name.toLowerCase())
      ) {
        matches = false;
      }

      if (query.type && contextFile.type !== query.type) {
        matches = false;
      }

      if (query.language && contextFile.language !== query.language) {
        matches = false;
      }

      if (query.tags && query.tags.length > 0) {
        const hasAllTags = query.tags.every((tag) =>
          contextFile.metadata.tags.some((fileTag) =>
            fileTag.toLowerCase().includes(tag.toLowerCase()),
          ),
        );
        if (!hasAllTags) matches = false;
      }

      if (
        query.content &&
        !contextFile.content.toLowerCase().includes(query.content.toLowerCase())
      ) {
        matches = false;
      }

      if (matches) {
        results.push(contextFile);
      }
    }

    return results;
  }

  /**
   * Create a context bundle
   */
  async createContextBundle(
    name: string,
    description: string,
    fileIds: string[],
    tags: string[] = [],
  ): Promise<string> {
    const bundleId = this.generateBundleId();
    const files: ContextFile[] = [];

    for (const fileId of fileIds) {
      const file = await this.getContextFile(fileId);
      if (file) {
        files.push(file);
        file.metadata.usage.contextsUsed++;
        await this.saveContextFile(file);
      }
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    const bundle: ContextBundle = {
      bundleId,
      name,
      description,
      files,
      createdAt: new Date(),
      usageCount: 0,
      totalSize,
      tags,
    };

    this.contextBundles.set(bundleId, bundle);

    this.logger.log('Context bundle created', {
      bundleId,
      name,
      fileCount: files.length,
      totalSize,
    });

    return bundleId;
  }

  /**
   * Get a context bundle
   */
  getContextBundle(bundleId: string): ContextBundle | null {
    return this.contextBundles.get(bundleId) || null;
  }

  /**
   * Use a context bundle (increment usage count)
   */
  async useContextBundle(bundleId: string): Promise<ContextBundle | null> {
    const bundle = this.contextBundles.get(bundleId);
    if (bundle) {
      bundle.usageCount++;
      bundle.lastUsed = new Date();
      return bundle;
    }
    return null;
  }

  /**
   * Get context files by type
   */
  getContextFilesByType(type: ContextFile['type']): ContextFile[] {
    return Array.from(this.contextFiles.values()).filter(
      (file) => file.type === type,
    );
  }

  /**
   * Get most used context files
   */
  getMostUsedContextFiles(limit: number = 10): ContextFile[] {
    return Array.from(this.contextFiles.values())
      .sort((a, b) => b.metadata.usage.readCount - a.metadata.usage.readCount)
      .slice(0, limit);
  }

  /**
   * Clean up old/unused context files
   */
  async cleanupUnusedFiles(maxAgeDays: number = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    const toDelete: string[] = [];

    for (const [fileId, contextFile] of this.contextFiles.entries()) {
      if (
        contextFile.metadata.usage.lastRead < cutoff &&
        contextFile.metadata.usage.readCount === 0
      ) {
        toDelete.push(fileId);
      }
    }

    for (const fileId of toDelete) {
      await this.deleteContextFile(fileId);
    }

    this.logger.log('Context files cleanup completed', {
      deleted: toDelete.length,
      maxAgeDays,
    });

    return toDelete.length;
  }

  /**
   * Get storage statistics
   */
  getStorageStatistics(): {
    totalFiles: number;
    totalSize: number;
    filesByType: Record<string, number>;
    filesByLanguage: Record<string, number>;
    averageFileSize: number;
    totalBundles: number;
  } {
    const files = Array.from(this.contextFiles.values());
    const totalFiles = files.length;
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const averageFileSize = totalFiles > 0 ? totalSize / totalFiles : 0;

    const filesByType: Record<string, number> = {};
    const filesByLanguage: Record<string, number> = {};

    for (const file of files) {
      filesByType[file.type] = (filesByType[file.type] || 0) + 1;
      if (file.language) {
        filesByLanguage[file.language] =
          (filesByLanguage[file.language] || 0) + 1;
      }
    }

    return {
      totalFiles,
      totalSize,
      filesByType,
      filesByLanguage,
      averageFileSize: Math.round(averageFileSize),
      totalBundles: this.contextBundles.size,
    };
  }

  // Private helper methods
  private generateFileId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateBundleId(): string {
    return `bundle_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private calculateChecksum(content: string): string {
    // Use proper SHA-256 hashing for security and reliability
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private async saveContextFile(contextFile: ContextFile): Promise<void> {
    try {
      await fs.writeFile(
        contextFile.path,
        JSON.stringify(contextFile, null, 2),
        'utf8',
      );
    } catch (error) {
      this.logger.error('Failed to save context file', {
        fileId: contextFile.fileId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
