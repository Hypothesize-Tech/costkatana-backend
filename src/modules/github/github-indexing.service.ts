import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

import {
  GitHubCodeChunk,
  GitHubCodeChunkDocument,
} from '../../schemas/document/github-code-chunk.schema';
import { SecretScannerService } from './secret-scanner.service';
import { TreeSitterService } from './tree-sitter.service';
import {
  ChunkMetadata,
  CodeChunk,
  IndexingResult,
  ASTAnalysis,
} from './interfaces/github.interfaces';

@Injectable()
export class GitHubIndexingService {
  private readonly logger = new Logger(GitHubIndexingService.name);

  private readonly MAX_CHUNK_SIZE = 2000;
  private readonly CHUNK_OVERLAP = 200;
  private readonly DOC_CHUNK_SIZE = 1000;
  private readonly DOC_CHUNK_OVERLAP = 200;

  constructor(
    @InjectModel(GitHubCodeChunk.name)
    private gitHubCodeChunkModel: Model<GitHubCodeChunkDocument>,
    private secretScannerService: SecretScannerService,
    private treeSitterService: TreeSitterService,
  ) {}

  async indexFile(
    content: string,
    metadata: ChunkMetadata,
    astAnalysis?: ASTAnalysis,
  ): Promise<IndexingResult> {
    const result: IndexingResult = {
      chunksCreated: 0,
      chunksUpdated: 0,
      chunksDeprecated: 0,
      errors: [],
      warnings: [],
    };

    try {
      // Check if file should be excluded
      if (this.secretScannerService.shouldExcludeFile(metadata.filePath)) {
        result.warnings.push(
          `File ${metadata.filePath} excluded from indexing`,
        );
        return result;
      }

      // Scan and redact secrets
      const { redacted, secretsFound } =
        this.secretScannerService.redactSecrets(content);
      if (secretsFound.length > 0) {
        result.warnings.push(
          `Redacted secrets in ${metadata.filePath}: ${secretsFound.join(', ')}`,
        );
      }

      // Parse AST if not provided and it's a code file
      let analysis = astAnalysis;
      if (!analysis && this.isCodeFile(metadata.fileType)) {
        try {
          analysis = this.treeSitterService.parseCode(
            redacted,
            metadata.language,
            metadata.filePath,
          );
        } catch (error) {
          result.warnings.push(
            `Failed to parse AST for ${metadata.filePath}: ${error.message}`,
          );
        }
      }

      // Chunk the file based on type
      const chunks = await this.chunkFile(redacted, metadata, analysis);

      // Index each chunk
      for (const chunk of chunks) {
        try {
          const chunkResult = await this.indexChunk(chunk, metadata);
          if (chunkResult.created) {
            result.chunksCreated++;
          } else if (chunkResult.updated) {
            result.chunksUpdated++;
          }
        } catch (error) {
          result.errors.push(
            `Failed to index chunk for ${metadata.filePath}: ${error.message}`,
          );
        }
      }

      // Deprecate old chunks for this file
      const deprecatedCount = await this.deprecateOldChunks(metadata);
      result.chunksDeprecated += deprecatedCount;
    } catch (error) {
      result.errors.push(
        `Failed to index file ${metadata.filePath}: ${error.message}`,
      );
    }

    return result;
  }

  async chunkFile(
    content: string,
    metadata: ChunkMetadata,
    astAnalysis?: ASTAnalysis,
  ): Promise<CodeChunk[]> {
    if (this.isCodeFile(metadata.fileType) && astAnalysis) {
      return this.chunkByAST(content, astAnalysis);
    } else if (this.isDocFile(metadata.fileType)) {
      return this.chunkDocumentation(content);
    } else if (this.isConfigFile(metadata.fileType)) {
      return this.chunkConfigFile(content, metadata.fileType);
    } else {
      return await this.chunkBySize(content);
    }
  }

  async chunkByAST(
    content: string,
    astAnalysis: ASTAnalysis,
  ): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');

    // Create chunks for functions
    for (const func of astAnalysis.functions) {
      if (!this.isFunctionInClass(func, astAnalysis.classes)) {
        const chunkContent = this.extractChunkContent(
          lines,
          func.line - 1,
          func.endLine - 1,
        );
        const context = this.buildContext(
          astAnalysis,
          func.line - 1,
          func.endLine - 1,
        );

        chunks.push({
          content: context + '\n\n' + chunkContent,
          startLine: func.line,
          endLine: func.endLine,
          chunkType: 'function',
          astMetadata: {
            functionName: func.name,
            parameters: func.parameters,
            returnType: func.returnType,
            docstring: func.isAsync ? 'async ' + func.name : func.name,
            signature: `${func.isAsync ? 'async ' : ''}${func.name}(${func.parameters.join(', ')})${func.returnType ? ': ' + func.returnType : ''}`,
          },
        });
      }
    }

    // Create chunks for classes
    for (const cls of astAnalysis.classes) {
      const chunkContent = this.extractChunkContent(
        lines,
        cls.line - 1,
        cls.endLine - 1,
      );
      const context = this.buildContext(
        astAnalysis,
        cls.line - 1,
        cls.endLine - 1,
      );

      chunks.push({
        content: context + '\n\n' + chunkContent,
        startLine: cls.line,
        endLine: cls.endLine,
        chunkType: 'class',
        astMetadata: {
          className: cls.name,
          docstring: cls.name,
        },
      });
    }

    // Fallback to size-based chunking if no AST chunks created
    if (chunks.length === 0) {
      return await this.chunkBySize(content);
    }

    return chunks;
  }

  buildContext(
    astAnalysis: ASTAnalysis,
    startLine: number,
    endLine: number,
  ): string {
    let context = '';

    // Add imports
    const relevantImports = astAnalysis.imports.filter(
      (imp) => imp.line <= startLine + 10, // Include imports within 10 lines before
    );

    if (relevantImports.length > 0) {
      context +=
        relevantImports
          .map((imp) => `import ${imp.imports.join(', ')} from ${imp.module}`)
          .join('\n') + '\n\n';
    }

    // Add class context if within a class
    const containingClass = astAnalysis.classes.find(
      (cls) => startLine >= cls.line - 1 && endLine <= cls.endLine - 1,
    );

    if (containingClass) {
      context += `class ${containingClass.name} {\n`;
    }

    return context;
  }

  async chunkDocumentation(content: string): Promise<CodeChunk[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.DOC_CHUNK_SIZE,
      chunkOverlap: this.DOC_CHUNK_OVERLAP,
      separators: [
        '\n## ',
        '\n### ',
        '\n#### ',
        '\n##### ',
        '\n\n',
        '\n',
        ' ',
        '',
      ],
    });

    const docs = await splitter.splitText(content);
    const chunks: CodeChunk[] = [];

    let currentLine = 0;
    for (const doc of docs) {
      const lineCount = doc.split('\n').length;
      chunks.push({
        content: doc,
        startLine: currentLine + 1,
        endLine: currentLine + lineCount,
        chunkType: 'doc',
      });
      currentLine += lineCount;
    }

    return chunks;
  }

  chunkConfigFile(content: string, fileType: string): CodeChunk[] {
    // For small config files, create single chunk
    if (content.length < this.MAX_CHUNK_SIZE) {
      return [
        {
          content,
          startLine: 1,
          endLine: content.split('\n').length,
          chunkType: 'config',
        },
      ];
    }

    // For large config files, chunk by sections
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    let currentChunk = '';
    let startLine = 1;
    let currentLine = 0;

    for (const line of lines) {
      currentLine++;
      currentChunk += line + '\n';

      // Check if we've hit a section boundary or size limit
      if (
        currentChunk.length >= this.MAX_CHUNK_SIZE ||
        (line.trim().startsWith('[') && currentChunk.length > 100)
      ) {
        chunks.push({
          content: currentChunk.trim(),
          startLine,
          endLine: currentLine,
          chunkType: 'config',
        });

        currentChunk = '';
        startLine = currentLine + 1;
      }
    }

    // Add remaining content
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        startLine,
        endLine: currentLine,
        chunkType: 'config',
      });
    }

    return chunks;
  }

  async chunkBySize(content: string): Promise<CodeChunk[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.MAX_CHUNK_SIZE,
      chunkOverlap: this.CHUNK_OVERLAP,
      separators: [
        '\nclass ',
        '\nfunction ',
        '\nconst ',
        '\nlet ',
        '\nvar ',
        '\n\n',
        '\n',
        ' ',
        '',
      ],
    });

    const texts = await splitter.splitText(content);
    const chunks: CodeChunk[] = [];

    let currentLine = 0;
    for (const text of texts) {
      const lineCount = text.split('\n').length;
      chunks.push({
        content: text,
        startLine: currentLine + 1,
        endLine: currentLine + lineCount,
        chunkType: 'other',
      });
      currentLine += lineCount;
    }

    return chunks;
  }

  async indexChunk(
    chunk: CodeChunk,
    metadata: ChunkMetadata,
  ): Promise<{ created: boolean; updated: boolean }> {
    const chunkId = this.generateChunkId(metadata, chunk);
    const contentHash = this.secretScannerService.generateContentHash(
      chunk.content,
    );

    // Check if chunk already exists
    const existingChunk = await this.gitHubCodeChunkModel.findOne({
      chunkId,
      repoFullName: metadata.repoFullName,
      filePath: metadata.filePath,
      commitSha: metadata.commitSha,
    });

    const chunkData = {
      chunkId,
      repositoryId: metadata.repoFullName, // Using repoFullName as repositoryId for simplicity
      repoFullName: metadata.repoFullName,
      filePath: metadata.filePath,
      commitSha: metadata.commitSha,
      branch: metadata.branch,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
      language: metadata.language,
      fileType: metadata.fileType,
      embedding: [], // Will be populated by embedding service
      contentHash,
      status: 'active' as const,
      chunkType: chunk.chunkType,
      userId: metadata.userId,
      organizationId: metadata.organizationId,
      metadata: {
        functionName: chunk.astMetadata?.functionName,
        className: chunk.astMetadata?.className,
        methodName: chunk.astMetadata?.methodName,
        signature: chunk.astMetadata?.signature,
        parameters: chunk.astMetadata?.parameters,
        returnType: chunk.astMetadata?.returnType,
        docstring: chunk.astMetadata?.docstring,
        imports: chunk.astMetadata?.imports,
        exports: chunk.astMetadata?.exports,
      },
      astMetadata: chunk.astMetadata,
      semanticTags: this.extractSemanticTags(chunk),
      accessCount: 0,
    };

    if (existingChunk) {
      // Update existing chunk
      await this.gitHubCodeChunkModel.updateOne(
        { chunkId },
        { ...chunkData, updatedAt: new Date() },
      );
      return { created: false, updated: true };
    } else {
      // Create new chunk
      await this.gitHubCodeChunkModel.create(chunkData);
      return { created: true, updated: false };
    }
  }

  async deprecateOldChunks(metadata: ChunkMetadata): Promise<number> {
    const result = await this.gitHubCodeChunkModel.updateMany(
      {
        repoFullName: metadata.repoFullName,
        filePath: metadata.filePath,
        status: 'active',
        $or: [
          { commitSha: { $ne: metadata.commitSha } },
          { branch: { $ne: metadata.branch } },
        ],
      },
      { status: 'deprecated' },
    );

    return result.modifiedCount;
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
    return codeExtensions.some((ext) => fileType.toLowerCase().endsWith(ext));
  }

  isDocFile(fileType: string): boolean {
    const docExtensions = ['md', 'txt', 'rst', 'adoc'];
    return docExtensions.some((ext) => fileType.toLowerCase().endsWith(ext));
  }

  isConfigFile(fileType: string): boolean {
    const configExtensions = [
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
      'ini',
      'cfg',
      'conf',
    ];
    return configExtensions.some((ext) => fileType.toLowerCase().endsWith(ext));
  }

  private extractChunkContent(
    lines: string[],
    startLine: number,
    endLine: number,
  ): string {
    return lines.slice(startLine, endLine + 1).join('\n');
  }

  private isFunctionInClass(func: any, classes: any[]): boolean {
    return classes.some(
      (cls) => func.line >= cls.line && func.endLine <= cls.endLine,
    );
  }

  private generateChunkId(metadata: ChunkMetadata, chunk: CodeChunk): string {
    const content = `${metadata.repoFullName}:${metadata.filePath}:${chunk.startLine}-${chunk.endLine}`;
    return this.secretScannerService.generateContentHash(content);
  }

  private extractSemanticTags(chunk: CodeChunk): string[] {
    const tags: string[] = [];

    if (chunk.astMetadata?.functionName) {
      tags.push(chunk.astMetadata.functionName);
    }
    if (chunk.astMetadata?.className) {
      tags.push(chunk.astMetadata.className);
    }
    if (chunk.astMetadata?.methodName) {
      tags.push(chunk.astMetadata.methodName);
    }

    // Add language-specific keywords
    const content = chunk.content.toLowerCase();
    if (content.includes('async') || content.includes('await')) {
      tags.push('async');
    }
    if (content.includes('export')) {
      tags.push('export');
    }
    if (content.includes('import')) {
      tags.push('import');
    }

    return [...new Set(tags)]; // Remove duplicates
  }
}
