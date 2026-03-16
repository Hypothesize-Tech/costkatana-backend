import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { extname } from 'path';

import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../schemas/integration/github-connection.schema';
import { GitHubService } from './github.service';
import { GitHubIndexingService } from './github-indexing.service';
import { TreeSitterService } from './tree-sitter.service';
import {
  IncrementalIndexOptions,
  IncrementalIndexResult,
  ChunkMetadata,
  ASTAnalysis,
} from './interfaces/github.interfaces';

@Injectable()
export class IncrementalIndexService {
  private readonly logger = new Logger(IncrementalIndexService.name);

  private readonly BATCH_SIZE = 10;
  private readonly BATCH_DELAY = 100; // ms

  constructor(
    @InjectModel(GitHubConnection.name)
    private gitHubConnectionModel: Model<GitHubConnectionDocument>,
    private gitHubService: GitHubService,
    private gitHubIndexingService: GitHubIndexingService,
    private treeSitterService: TreeSitterService,
  ) {}

  async indexChangedFiles(
    options: IncrementalIndexOptions,
  ): Promise<IncrementalIndexResult> {
    const result: IncrementalIndexResult = {
      filesIndexed: 0,
      filesSkipped: 0,
      totalChunksCreated: 0,
      totalChunksUpdated: 0,
      errors: [],
      warnings: [],
    };

    try {
      // Find all active GitHub connections for this repository
      const connections = await this.gitHubConnectionModel.find({
        isActive: true,
        $or: [
          { userId: options.userId },
          { organizationId: options.organizationId },
        ],
      });

      if (connections.length === 0) {
        result.warnings.push(
          `No active GitHub connections found for user ${options.userId}`,
        );
        return result;
      }

      // Process files in batches
      const batches = this.chunkArray(options.changedFiles, this.BATCH_SIZE);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.log(
          `Processing batch ${i + 1}/${batches.length} (${batch.length} files)`,
        );

        // Process batch in parallel
        const batchResults = await Promise.allSettled(
          batch.map((filePath) =>
            this.indexFile(filePath, options, connections),
          ),
        );

        // Aggregate results
        for (const batchResult of batchResults) {
          if (batchResult.status === 'fulfilled') {
            const fileResult = batchResult.value;
            result.filesIndexed++;
            result.totalChunksCreated += fileResult.chunksCreated;
            result.totalChunksUpdated += fileResult.chunksUpdated;
            result.errors.push(...fileResult.errors);
            result.warnings.push(...fileResult.warnings);
          } else {
            result.errors.push(`Failed to index file: ${batchResult.reason}`);
          }
        }

        // Add delay between batches (except for the last batch)
        if (i < batches.length - 1) {
          await this.delay(this.BATCH_DELAY);
        }
      }
    } catch (error) {
      result.errors.push(`Failed to index changed files: ${error.message}`);
      this.logger.error('Error in incremental indexing', error);
    }

    return result;
  }

  private async indexFile(
    filePath: string,
    options: IncrementalIndexOptions,
    connections: GitHubConnectionDocument[],
  ): Promise<any> {
    const result = {
      chunksCreated: 0,
      chunksUpdated: 0,
      chunksDeprecated: 0,
      errors: [] as string[],
      warnings: [] as string[],
    };

    try {
      // Get file content from the first available connection
      const connection = connections[0];
      const [owner, repo] = options.repoFullName.split('/');

      let content: string;
      try {
        content = await this.gitHubService.getFileContent(
          connection,
          owner,
          repo,
          filePath,
          options.commitSha,
        );
      } catch (error) {
        // File might have been deleted or moved
        result.warnings.push(
          `Could not fetch content for ${filePath}: ${error.message}`,
        );
        return result;
      }

      // Determine language from file extension
      const language = this.getLanguageFromExtension(filePath);
      const fileType = extname(filePath).substring(1); // Remove the leading dot

      // Parse AST for code files
      let astAnalysis: ASTAnalysis | undefined;
      if (this.isCodeFile(fileType)) {
        try {
          astAnalysis = this.treeSitterService.parseCode(
            content,
            language,
            filePath,
          );
        } catch (error) {
          result.warnings.push(
            `Failed to parse AST for ${filePath}: ${error.message}`,
          );
        }
      }

      // Index file for each connection (multi-user repositories)
      for (const conn of connections) {
        try {
          const metadata: ChunkMetadata = {
            repoFullName: options.repoFullName,
            filePath,
            commitSha: options.commitSha,
            branch: options.branch,
            language,
            fileType,
            userId: conn.userId,
            organizationId: conn.organizationId || options.organizationId,
          };

          const indexResult = await this.gitHubIndexingService.indexFile(
            content,
            metadata,
            astAnalysis,
          );

          result.chunksCreated += indexResult.chunksCreated;
          result.chunksUpdated += indexResult.chunksUpdated;
          result.errors.push(...indexResult.errors);
          result.warnings.push(...indexResult.warnings);
        } catch (error) {
          result.errors.push(
            `Failed to index ${filePath} for connection ${conn.userId}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      result.errors.push(`Failed to index file ${filePath}: ${error.message}`);
    }

    return result;
  }

  getLanguageFromExtension(filePath: string): string {
    const ext = extname(filePath).toLowerCase();

    const languageMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.cpp': 'cpp',
      '.cxx': 'cpp',
      '.cc': 'cpp',
      '.c': 'c',
      '.hpp': 'cpp',
      '.hxx': 'cpp',
      '.hh': 'cpp',
      '.h': 'c',
      '.rb': 'ruby',
      '.php': 'php',
      '.md': 'markdown',
      '.txt': 'text',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.xml': 'xml',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less',
      '.sql': 'sql',
      '.sh': 'bash',
      '.bash': 'bash',
      '.zsh': 'bash',
      '.fish': 'fish',
      '.ps1': 'powershell',
      '.bat': 'batch',
      '.cmd': 'batch',
      '.dockerfile': 'dockerfile',
      '.makefile': 'makefile',
      '.toml': 'toml',
      '.ini': 'ini',
      '.cfg': 'config',
      '.conf': 'config',
    };

    return languageMap[ext] || 'unknown';
  }

  isCodeFile(fileType: string): boolean {
    const codeExtensions = [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'java',
      'go',
      'rs',
      'cpp',
      'c',
      'php',
      'rb',
    ];
    return codeExtensions.includes(fileType.toLowerCase());
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
