import { CodebaseIndex } from './githubChatAgent.service';
import { SymbolJumpService } from './symbolJump.service';
import { FindReferencesService } from './findReferences.service';
import { VectorStoreService } from './vectorStore.service';
import { TreeSitterService } from './treeSitter.service';
import { loggingService } from './logging.service';

export interface AssembledContext {
    relevantFiles: Array<{
        path: string;
        content: string;
        relevance: number;
        reason: string;
    }>;
    symbols: Array<{
        name: string;
        definition: string;
        references: number;
    }>;
    totalTokens: number;
    compressedTokens?: number; // After Cortex compression
}

/**
 * Context Assembler Service
 * Smart context filtering with pre-LLM pipeline
 */
export class ContextAssemblerService {
    private static readonly MAX_TOKENS = 8000;
    private static readonly MAX_FILES = 30;
    private static readonly TOKEN_ESTIMATE_PER_LINE = 4; // Rough estimate

    /**
     * Assemble context for LLM with smart filtering
     */
    static async assembleContext(
        userRequest: string,
        codebaseIndex: CodebaseIndex,
        fileContents: Record<string, string>,
        userId?: string
    ): Promise<AssembledContext> {
        const context: AssembledContext = {
            relevantFiles: [],
            symbols: [],
            totalTokens: 0
        };

        try {
            // Initialize TreeSitterService for on-the-fly parsing if needed
            TreeSitterService.initialize();

            // Stage 1: Symbol table exact match (fastest) - using SymbolJumpService
            const repoFullName = codebaseIndex.files[0]?.path ? 
                codebaseIndex.files[0].path.split('/').slice(0, 2).join('/') : undefined;
            const symbolMatches = await this.findSymbolMatches(
                userRequest, 
                codebaseIndex, 
                userId,
                repoFullName
            );
            for (const match of symbolMatches.slice(0, 10)) {
                const content = fileContents[match.filePath];
                if (content) {
                    context.relevantFiles.push({
                        path: match.filePath,
                        content: this.truncateFileContent(content, match.line),
                        relevance: 0.9,
                        reason: `Exact symbol match: ${match.name}`
                    });
                }
            }

            // Stage 2: AST-based structural search (using TreeSitterService)
            const structuralMatches = this.findStructuralMatches(
                userRequest, 
                codebaseIndex,
                fileContents
            );
            for (const match of structuralMatches.slice(0, 10)) {
                if (!context.relevantFiles.some(f => f.path === match.path)) {
                    const content = fileContents[match.path];
                    if (content) {
                        context.relevantFiles.push({
                            path: match.path,
                            content: this.truncateFileContent(content),
                            relevance: 0.7,
                            reason: match.reason
                        });
                    }
                }
            }

            // Stage 3: Vector search for semantic similarity
            const semanticMatches = await this.findSemanticMatches(userRequest, codebaseIndex);
            for (const match of semanticMatches.slice(0, 10)) {
                if (!context.relevantFiles.some(f => f.path === match.path)) {
                    const content = fileContents[match.path];
                    if (content) {
                        context.relevantFiles.push({
                            path: match.path,
                            content: this.truncateFileContent(content),
                            relevance: 0.6,
                            reason: 'Semantic similarity'
                        });
                    }
                }
            }

            // Stage 4: Prioritize entry points
            for (const entryPoint of codebaseIndex.structure.entryPoints.slice(0, 5)) {
                if (!context.relevantFiles.some(f => f.path === entryPoint)) {
                    const content = fileContents[entryPoint];
                    if (content) {
                        context.relevantFiles.push({
                            path: entryPoint,
                            content: this.truncateFileContent(content),
                            relevance: 0.8,
                            reason: 'Entry point'
                        });
                    }
                }
            }

            // Sort by relevance and limit
            context.relevantFiles.sort((a, b) => b.relevance - a.relevance);
            context.relevantFiles = context.relevantFiles.slice(0, this.MAX_FILES);

            // Extract symbols
            context.symbols = await this.extractRelevantSymbols(userRequest, codebaseIndex);

            // Calculate token count
            context.totalTokens = this.estimateTokens(context);

            // Truncate if over limit
            if (context.totalTokens > this.MAX_TOKENS) {
                context.relevantFiles = this.truncateToTokenLimit(context.relevantFiles, this.MAX_TOKENS);
                context.totalTokens = this.estimateTokens(context);
            }

            loggingService.info('Context assembled', {
                fileCount: context.relevantFiles.length,
                symbolCount: context.symbols.length,
                totalTokens: context.totalTokens
            });

            return context;
        } catch (error) {
            loggingService.error('Context assembly failed', {
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return context;
        }
    }

    /**
     * Find symbol matches from symbol table using SymbolJumpService
     */
    private static async findSymbolMatches(
        userRequest: string,
        codebaseIndex: CodebaseIndex,
        userId?: string,
        repoFullName?: string
    ): Promise<Array<{ name: string; filePath: string; line: number }>> {
        const matches: Array<{ name: string; filePath: string; line: number }> = [];
        const words = userRequest.toLowerCase().split(/\s+/).filter(w => w.length > 3);

        // First, try direct symbol table lookup (fastest)
        if (codebaseIndex.symbolTable) {
            for (const word of words) {
                if (codebaseIndex.symbolTable.has(word)) {
                    const locations = codebaseIndex.symbolTable.get(word) ?? [];
                    for (const location of locations) {
                        matches.push({
                            name: word,
                            filePath: location.filePath,
                            line: location.line
                        });
                    }
                }
            }
        }

        // If we have userId, use SymbolJumpService for multi-repo search
        if (userId && matches.length === 0) {
            for (const word of words) {
                try {
                    const definition = await SymbolJumpService.findSymbolDefinition(
                        word,
                        codebaseIndex,
                        userId,
                        repoFullName
                    );
                    if (definition) {
                        matches.push({
                            name: word,
                            filePath: definition.filePath,
                            line: definition.line
                        });
                    }
                } catch (error) {
                    loggingService.debug('SymbolJumpService search failed', {
                        symbol: word,
                        error: error instanceof Error ? error.message : 'Unknown'
                    });
                }
            }
        }

        return matches;
    }

    /**
     * Find structural matches using AST (TreeSitterService)
     */
    private static findStructuralMatches(
        userRequest: string,
        codebaseIndex: CodebaseIndex,
        fileContents: Record<string, string>
    ): Array<{ path: string; reason: string }> {
        const matches: Array<{ path: string; reason: string }> = [];
        const requestLower = userRequest.toLowerCase();

        // Use AST metadata if available (from TreeSitterService)
        if (codebaseIndex.astMetadata) {
            for (const [filePath, ast] of codebaseIndex.astMetadata.entries()) {
                // Check for function/class name matches
                for (const func of ast.functions) {
                    if (requestLower.includes(func.name.toLowerCase())) {
                        matches.push({
                            path: filePath,
                            reason: `Contains function: ${func.name} (via Tree-Sitter AST)`
                        });
                        break;
                    }
                }

                for (const cls of ast.classes) {
                    if (requestLower.includes(cls.name.toLowerCase())) {
                        matches.push({
                            path: filePath,
                            reason: `Contains class: ${cls.name} (via Tree-Sitter AST)`
                        });
                        break;
                    }
                }

                // Also check imports/exports for relevance
                for (const imp of ast.imports) {
                    const importMatches = requestLower.includes(imp.source.toLowerCase()) ||
                        imp.imports.some(importName => requestLower.includes(importName.toLowerCase()));
                    if (importMatches) {
                        matches.push({
                            path: filePath,
                            reason: `Contains import: ${imp.source} (via Tree-Sitter AST)`
                        });
                        break;
                    }
                }
            }
        }

        // For files without AST metadata, use TreeSitterService to parse on-the-fly
        const filesWithoutAST = codebaseIndex.structure.sourceFiles.filter(
            filePath => !codebaseIndex.astMetadata?.has(filePath) && fileContents[filePath]
        );

        for (const filePath of filesWithoutAST.slice(0, 10)) { // Limit to 10 files for performance
            try {
                const fileInfo = codebaseIndex.files.find(f => f.path === filePath);
                if (!fileInfo?.language) continue;

                const content = fileContents[filePath];
                if (!content) continue;

                // Use TreeSitterService to parse the file
                const ast = TreeSitterService.parseCode(content, fileInfo.language, filePath);

                // Check for function/class name matches
                for (const func of ast.functions) {
                    if (requestLower.includes(func.name.toLowerCase())) {
                        matches.push({
                            path: filePath,
                            reason: `Contains function: ${func.name} (parsed on-the-fly via Tree-Sitter)`
                        });
                        break;
                    }
                }

                for (const cls of ast.classes) {
                    if (requestLower.includes(cls.name.toLowerCase())) {
                        matches.push({
                            path: filePath,
                            reason: `Contains class: ${cls.name} (parsed on-the-fly via Tree-Sitter)`
                        });
                        break;
                    }
                }

                // Check imports/exports
                for (const imp of ast.imports) {
                    const importMatches = requestLower.includes(imp.source.toLowerCase()) ||
                        imp.imports.some(importName => requestLower.includes(importName.toLowerCase()));
                    if (importMatches) {
                        matches.push({
                            path: filePath,
                            reason: `Contains import: ${imp.source} (parsed on-the-fly via Tree-Sitter)`
                        });
                        break;
                    }
                }
            } catch (error) {
                loggingService.debug('Failed to parse file with TreeSitterService', {
                    filePath,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
                // Continue with other files
            }
        }

        return matches;
    }

    /**
     * Find semantic matches using vector search
     */
    private static async findSemanticMatches(
        userRequest: string,
        codebaseIndex: CodebaseIndex
    ): Promise<Array<{ path: string }>> {
        try {
            const vectorStore = new VectorStoreService();
            await vectorStore.initialize();

            const results = await vectorStore.search(userRequest, 20); // Get more results to filter
            
            // Extract and validate paths using codebase index
            const validPaths = results
                .map(r => {
                    const result = r as { metadata?: { source?: string; filePath?: string } };
                    const metadata = result.metadata;
                    return metadata?.source ?? metadata?.filePath;
                })
                .filter((path): path is string => typeof path === 'string')
                .filter(path => {
                    // Validate that the path exists in the codebase index
                    const fileExists = codebaseIndex.files.some(f => f.path === path);
                    // Prioritize source files over config/test/doc files
                    const isSourceFile = codebaseIndex.structure.sourceFiles.includes(path);
                    return fileExists && isSourceFile;
                })
                .map(path => ({ path }));

            // If we have valid paths, return them (limit to 10)
            if (validPaths.length > 0) {
                return validPaths.slice(0, 10);
            }

            // Fallback: return any valid paths from codebase (even if not source files)
            const fallbackPaths = results
                .map(r => {
                    const result = r as { metadata?: { source?: string; filePath?: string } };
                    const metadata = result.metadata;
                    return metadata?.source ?? metadata?.filePath;
                })
                .filter((path): path is string => typeof path === 'string')
                .filter(path => codebaseIndex.files.some(f => f.path === path))
                .map(path => ({ path }))
                .slice(0, 10);

            return fallbackPaths;
        } catch (error) {
            loggingService.warn('Semantic search failed in context assembler', {
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Extract relevant symbols from request
     */
    private static async extractRelevantSymbols(
        userRequest: string,
        codebaseIndex: CodebaseIndex
    ): Promise<Array<{ name: string; definition: string; references: number }>> {
        const symbols: Array<{ name: string; definition: string; references: number }> = [];
        const words = userRequest.toLowerCase().split(/\s+/).filter(w => w.length > 3);

        if (!codebaseIndex.symbolTable) {
            return symbols;
        }

        for (const word of words) {
            if (codebaseIndex.symbolTable.has(word)) {
                const locations = codebaseIndex.symbolTable.get(word) ?? [];
                const definition = locations[0];
                
                // Get reference count
                const references = await FindReferencesService.findReferences(word, codebaseIndex);

                symbols.push({
                    name: word,
                    definition: `${definition.type} at ${definition.filePath}:${definition.line}`,
                    references: references.length
                });
            }
        }

        return symbols.slice(0, 10);
    }

    /**
     * Truncate file content to relevant portion
     */
    private static truncateFileContent(
        content: string,
        focusLine?: number
    ): string {
        const lines = content.split('\n');
        
        if (focusLine) {
            // Show 50 lines around focus line
            const start = Math.max(0, focusLine - 25);
            const end = Math.min(lines.length, focusLine + 25);
            return lines.slice(start, end).join('\n');
        }

        // Show first 100 lines for large files
        if (lines.length > 100) {
            return lines.slice(0, 100).join('\n') + '\n// ... (truncated)';
        }

        return content;
    }

    /**
     * Estimate token count
     */
    private static estimateTokens(context: AssembledContext): number {
        let tokens = 0;

        for (const file of context.relevantFiles) {
            tokens += file.content.split('\n').length * this.TOKEN_ESTIMATE_PER_LINE;
        }

        for (const symbol of context.symbols) {
            tokens += symbol.definition.split(' ').length;
        }

        return tokens;
    }

    /**
     * Truncate files to fit token limit
     */
    private static truncateToTokenLimit(
        files: AssembledContext['relevantFiles'],
        maxTokens: number
    ): AssembledContext['relevantFiles'] {
        const truncated: AssembledContext['relevantFiles'] = [];
        let currentTokens = 0;

        for (const file of files) {
            const fileTokens = file.content.split('\n').length * this.TOKEN_ESTIMATE_PER_LINE;
            
            if (currentTokens + fileTokens <= maxTokens) {
                truncated.push(file);
                currentTokens += fileTokens;
            } else {
                // Truncate this file to fit
                const remainingTokens = maxTokens - currentTokens;
                const remainingLines = Math.floor(remainingTokens / this.TOKEN_ESTIMATE_PER_LINE);
                
                if (remainingLines > 10) {
                    const lines = file.content.split('\n');
                    truncated.push({
                        ...file,
                        content: lines.slice(0, remainingLines).join('\n') + '\n// ... (truncated)'
                    });
                }
                break;
            }
        }

        return truncated;
    }
}

