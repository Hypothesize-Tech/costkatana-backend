import { ASTAnalysis } from './treeSitter.service';
import { SecretScannerService } from './secretScanner.service';
import { GitHubCodeChunkModel } from '../models/GitHubCodeChunk';
import { loggingService } from './logging.service';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

export interface ChunkMetadata {
    repoFullName: string;
    filePath: string;
    commitSha: string;
    branch: string;
    language: string;
    fileType: string;
    userId: string;
    organizationId?: string;
}

export interface CodeChunk {
    content: string;
    startLine: number;
    endLine: number;
    chunkType: 'function' | 'class' | 'method' | 'doc' | 'config' | 'other';
    astMetadata?: {
        functionName?: string;
        className?: string;
        methodName?: string;
        signature?: string;
        parameters?: string[];
        returnType?: string;
        docstring?: string;
        imports?: string[];
        exports?: string[];
    };
}

export interface IndexingResult {
    chunksCreated: number;
    chunksUpdated: number;
    chunksDeprecated: number;
    errors: string[];
    warnings: string[];
}

export class GitHubIndexingService {
    private static readonly MAX_CHUNK_SIZE = 2000; // tokens (approximate)
    private static readonly CHUNK_OVERLAP = 200; // tokens
    private static readonly DOC_CHUNK_SIZE = 1000; // tokens for documentation
    private static readonly DOC_CHUNK_OVERLAP = 200; // tokens

    /**
     * Index a file with AST-aware chunking
     */
    static async indexFile(
        content: string,
        metadata: ChunkMetadata,
        astAnalysis?: ASTAnalysis
    ): Promise<IndexingResult> {
        const result: IndexingResult = {
            chunksCreated: 0,
            chunksUpdated: 0,
            chunksDeprecated: 0,
            errors: [],
            warnings: []
        };

        try {
            // Check if file should be excluded
            if (SecretScannerService.shouldExcludeFile(metadata.filePath)) {
                loggingService.info('File excluded from indexing', {
                    component: 'GitHubIndexingService',
                    filePath: metadata.filePath
                });
                return result;
            }

            // Scan and redact secrets
            const scanResult = SecretScannerService.scanAndRedact(content, metadata.filePath);
            const safeContent = scanResult.content;

            if (scanResult.hasSecrets) {
                result.warnings.push(
                    `Secrets detected and redacted in ${metadata.filePath} (${scanResult.detectionCount} detections)`
                );
            }

            // Determine chunking strategy based on file type
            const chunks = await this.chunkFile(safeContent, metadata, astAnalysis);

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
                    const errorMsg = `Failed to index chunk at lines ${chunk.startLine}-${chunk.endLine}: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    result.errors.push(errorMsg);
                    loggingService.error('Failed to index chunk', {
                        component: 'GitHubIndexingService',
                        filePath: metadata.filePath,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        error: error instanceof Error ? error.message : 'Unknown'
                    });
                }
            }

            // Deprecate old chunks for this file (if commit SHA changed)
            if (chunks.length > 0) {
                await this.deprecateOldChunks(metadata);
            }

            loggingService.info('File indexed successfully', {
                component: 'GitHubIndexingService',
                filePath: metadata.filePath,
                chunksCreated: result.chunksCreated,
                chunksUpdated: result.chunksUpdated
            });

            return result;
        } catch (error) {
            const errorMsg = `Failed to index file ${metadata.filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            result.errors.push(errorMsg);
            loggingService.error('File indexing failed', {
                component: 'GitHubIndexingService',
                filePath: metadata.filePath,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return result;
        }
    }

    /**
     * Chunk file using AST-aware strategy
     */
    private static async chunkFile(
        content: string,
        metadata: ChunkMetadata,
        astAnalysis?: ASTAnalysis
    ): Promise<CodeChunk[]> {
        const chunks: CodeChunk[] = [];

        // For code files with AST analysis, chunk by functions/classes
        if (astAnalysis && this.isCodeFile(metadata.fileType)) {
            chunks.push(...this.chunkByAST(content, astAnalysis));
        }

        // For documentation files, chunk by paragraphs
        if (this.isDocFile(metadata.fileType)) {
            chunks.push(...await this.chunkDocumentation(content));
        }

        // For config files, chunk as single unit or by sections
        if (this.isConfigFile(metadata.fileType)) {
            chunks.push(...this.chunkConfigFile(content, metadata.fileType));
        }

        // Fallback: if no chunks created, use fixed-size chunking
        if (chunks.length === 0) {
            chunks.push(...await this.chunkBySize(content));
        }

        return chunks;
    }

    /**
     * Chunk code by AST units (functions, classes)
     */
    private static chunkByAST(
        content: string,
        astAnalysis: ASTAnalysis,
    ): CodeChunk[] {
        const chunks: CodeChunk[] = [];
        const lines = content.split('\n');

        // Chunk classes with their methods
        for (const classInfo of astAnalysis.classes) {
            const classStart = classInfo.line - 1; // Convert to 0-indexed
            const classEnd = classInfo.endLine;
            const classContent = lines.slice(classStart, classEnd).join('\n');

            // Include imports and docstrings if available
            const context = this.buildContext(astAnalysis, classInfo.line, classInfo.endLine);

            chunks.push({
                content: context + '\n' + classContent,
                startLine: classInfo.line,
                endLine: classInfo.endLine,
                chunkType: 'class',
                astMetadata: {
                    className: classInfo.name,
                    signature: `class ${classInfo.name}${classInfo.extends ? ` extends ${classInfo.extends}` : ''}${classInfo.implements && classInfo.implements.length > 0 ? ` implements ${classInfo.implements.join(', ')}` : ''}`,
                    imports: astAnalysis.imports.map(imp => imp.source),
                    exports: astAnalysis.exports.filter(exp => exp.name === classInfo.name).map(exp => exp.name)
                }
            });
        }

        // Chunk standalone functions (not part of classes)
        for (const funcInfo of astAnalysis.functions) {
            // Skip if function is part of a class (check if it's within any class range)
            const isInClass = astAnalysis.classes.some(
                cls => funcInfo.line >= cls.line && funcInfo.line <= cls.endLine
            );

            if (isInClass) {
                continue; // Already included in class chunk
            }

            const funcStart = funcInfo.line - 1;
            const funcEnd = funcInfo.endLine;
            const funcContent = lines.slice(funcStart, funcEnd).join('\n');

            // Include imports and docstrings
            const context = this.buildContext(astAnalysis, funcInfo.line, funcInfo.endLine);

            chunks.push({
                content: context + '\n' + funcContent,
                startLine: funcInfo.line,
                endLine: funcInfo.endLine,
                chunkType: 'function',
                astMetadata: {
                    functionName: funcInfo.name,
                    signature: `${funcInfo.name}(${funcInfo.parameters.join(', ')})${funcInfo.returnType ? `: ${funcInfo.returnType}` : ''}`,
                    parameters: funcInfo.parameters,
                    returnType: funcInfo.returnType,
                    imports: astAnalysis.imports.map(imp => imp.source),
                    exports: astAnalysis.exports.filter(exp => exp.name === funcInfo.name).map(exp => exp.name)
                }
            });
        }

        return chunks;
    }

    /**
     * Build context (imports, docstrings) for a code chunk
     */
    private static buildContext(
        astAnalysis: ASTAnalysis,
        startLine: number,
        _endLine: number
    ): string {
        const contextParts: string[] = [];

        // Include relevant imports (those used in this chunk)
        const relevantImports = astAnalysis.imports
            .filter(imp => imp.line < startLine)
            .map(imp => `import ${imp.imports.join(', ')} from '${imp.source}';`)
            .join('\n');

        if (relevantImports) {
            contextParts.push(relevantImports);
        }

        // Include docstrings/comments before the chunk
        const relevantComments = astAnalysis.comments
            .filter(comment => comment.line >= startLine - 5 && comment.line < startLine)
            .map(comment => comment.text)
            .join('\n');

        if (relevantComments) {
            contextParts.push(relevantComments);
        }

        return contextParts.join('\n');
    }

    /**
     * Chunk documentation files by paragraphs
     */
    private static async chunkDocumentation(content: string): Promise<CodeChunk[]> {
        const chunks: CodeChunk[] = [];
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: this.DOC_CHUNK_SIZE,
            chunkOverlap: this.DOC_CHUNK_OVERLAP
        });

        const docs = await textSplitter.createDocuments([content]);
        let currentLine = 1;

        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            const chunkLines = doc.pageContent.split('\n').length;
            const endLine = currentLine + chunkLines - 1;

            chunks.push({
                content: doc.pageContent,
                startLine: currentLine,
                endLine: endLine,
                chunkType: 'doc',
                astMetadata: {
                    docstring: doc.pageContent.substring(0, 200) // Preview
                }
            });

            currentLine = endLine - this.DOC_CHUNK_OVERLAP + 1; // Account for overlap
        }

        return chunks;
    }

    /**
     * Chunk config files (JSON, YAML, etc.)
     */
    private static chunkConfigFile(content: string, _fileType: string): CodeChunk[] {
        // For small config files, chunk as single unit
        if (content.length < this.MAX_CHUNK_SIZE) {
            return [{
                content,
                startLine: 1,
                endLine: content.split('\n').length,
                chunkType: 'config'
            }];
        }

        // For large config files, try to chunk by sections
        // This is a simplified approach - could be enhanced with YAML/JSON parsing
        const chunks: CodeChunk[] = [];
        const lines = content.split('\n');
        let currentChunk: string[] = [];
        let startLine = 1;
        let currentLine = 1;

        for (const line of lines) {
            currentChunk.push(line);
            currentLine++;

            // Chunk at section boundaries (empty lines or top-level keys)
            if (line.trim() === '' || (line.match(/^[a-zA-Z_][a-zA-Z0-9_]*:/) && currentChunk.length > 50)) {
                if (currentChunk.length > 0) {
                    chunks.push({
                        content: currentChunk.join('\n'),
                        startLine,
                        endLine: currentLine - 1,
                        chunkType: 'config'
                    });
                    currentChunk = [];
                    startLine = currentLine;
                }
            }
        }

        // Add remaining chunk
        if (currentChunk.length > 0) {
            chunks.push({
                content: currentChunk.join('\n'),
                startLine,
                endLine: currentLine,
                chunkType: 'config'
            });
        }

        return chunks;
    }

    /**
     * Fallback: chunk by fixed size
     */
    private static async chunkBySize(content: string): Promise<CodeChunk[]> {
        const chunks: CodeChunk[] = [];
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: this.MAX_CHUNK_SIZE,
            chunkOverlap: this.CHUNK_OVERLAP
        });

        const docs = await textSplitter.createDocuments([content]);

        let currentLine = 1;

        for (const doc of docs) {
            const chunkLines = doc.pageContent.split('\n').length;
            const endLine = currentLine + chunkLines - 1;

            chunks.push({
                content: doc.pageContent,
                startLine: currentLine,
                endLine: endLine,
                chunkType: 'other'
            });

            // Calculate overlap in lines
            const overlapLines = Math.floor((this.CHUNK_OVERLAP / this.MAX_CHUNK_SIZE) * chunkLines);
            currentLine = endLine - overlapLines + 1;
        }

        return chunks;
    }

    /**
     * Index a single chunk
     */
    private static async indexChunk(
        chunk: CodeChunk,
        metadata: ChunkMetadata
    ): Promise<{ created: boolean; updated: boolean }> {
        const contentHash = SecretScannerService.generateContentHash(chunk.content);

        // Check if chunk already exists
        const existing = await GitHubCodeChunkModel.findOne({
            repoFullName: metadata.repoFullName,
            filePath: metadata.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            commitSha: metadata.commitSha,
            contentHash
        });

        if (existing) {
            // Update access time - use updateOne to avoid type issues
            await GitHubCodeChunkModel.updateOne(
                { _id: existing._id },
                {
                    $set: {
                        lastAccessedAt: new Date()
                    },
                    $inc: {
                        accessCount: 1
                    }
                }
            );
            return { created: false, updated: false };
        }

        // Create new chunk (embedding will be added later by embedding service)
        const codeChunk = new GitHubCodeChunkModel({
            content: chunk.content,
            contentHash,
            embedding: [], // Will be populated by embedding service
            repoFullName: metadata.repoFullName,
            filePath: metadata.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            commitSha: metadata.commitSha,
            branch: metadata.branch,
            chunkType: chunk.chunkType,
            astMetadata: chunk.astMetadata,
            language: metadata.language,
            fileType: metadata.fileType,
            userId: metadata.userId,
            organizationId: metadata.organizationId,
            status: 'active',
            indexedAt: new Date()
        });

        await codeChunk.save();
        return { created: true, updated: false };
    }

    /**
     * Deprecate old chunks for a file (when new version is indexed)
     */
    private static async deprecateOldChunks(metadata: ChunkMetadata): Promise<void> {
        try {
            const result = await GitHubCodeChunkModel.updateMany(
                {
                    repoFullName: metadata.repoFullName,
                    filePath: metadata.filePath,
                    commitSha: { $ne: metadata.commitSha },
                    status: 'active'
                },
                {
                    $set: {
                        status: 'deprecated',
                        deprecatedAt: new Date()
                    }
                }
            );

            if (result.modifiedCount > 0) {
                loggingService.info('Deprecated old chunks', {
                    component: 'GitHubIndexingService',
                    filePath: metadata.filePath,
                    deprecatedCount: result.modifiedCount
                });
            }
        } catch (error) {
            loggingService.error('Failed to deprecate old chunks', {
                component: 'GitHubIndexingService',
                filePath: metadata.filePath,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }

    /**
     * Check if file is a code file
     */
    private static isCodeFile(fileType: string): boolean {
        const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.rb', '.php', '.swift', '.kt'];
        return codeExtensions.some(ext => fileType.includes(ext));
    }

    /**
     * Check if file is a documentation file
     */
    private static isDocFile(fileType: string): boolean {
        const docExtensions = ['.md', '.txt', '.rst', '.adoc', '.mdx'];
        return docExtensions.some(ext => fileType.includes(ext));
    }

    /**
     * Check if file is a config file
     */
    private static isConfigFile(fileType: string): boolean {
        const configExtensions = ['.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config'];
        return configExtensions.some(ext => fileType.includes(ext));
    }
}

