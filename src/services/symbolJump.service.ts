import { CodebaseIndex, GitHubChatAgentService } from './githubChatAgent.service';
import { SymbolLocation } from './treeSitter.service';
import { MultiRepoIndex } from '../models/MultiRepoIndex';
import { loggingService } from './logging.service';
import { GitHubService } from './github.service';
import { IGitHubConnection } from '../models';

export interface SymbolDefinition {
    name: string;
    filePath: string;
    line: number;
    endLine: number;
    type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'import';
    context?: string; // Surrounding code context
    repoFullName?: string;
}

/**
 * Symbol Jump Service - LSP-like jump-to-definition
 */
export class SymbolJumpService {
    /**
     * Find symbol definition across codebase
     */
    static async findSymbolDefinition(
        symbolName: string,
        codebaseIndex: CodebaseIndex,
        userId?: string,
        repoFullName?: string,
        connection?: IGitHubConnection & { decryptToken: () => string }
    ): Promise<SymbolDefinition | null> {
        try {
            // First, check symbol table in current codebase
            if (codebaseIndex.symbolTable && codebaseIndex.symbolTable.has(symbolName)) {
                const locations: SymbolLocation[] = codebaseIndex.symbolTable.get(symbolName) ?? [];
                if (locations.length > 0) {
                    const location = locations[0]; // Get first definition
                    return {
                        name: symbolName,
                        filePath: location.filePath,
                        line: location.line,
                        endLine: location.endLine,
                        type: location.type,
                        repoFullName
                    };
                }
            }

            // If not found, check multi-repo index
            if (userId) {
                const multiRepoIndex = await MultiRepoIndex.findOne({ userId });
                if (multiRepoIndex) {
                    // First, check shared utilities (fast path)
                    const matchingUtil = multiRepoIndex.sharedUtilities.find(
                        u => u.name === symbolName
                    );
                    if (matchingUtil) {
                        // Try to get actual line number from codebase index if available
                        let line = 1;
                        let endLine = 1;
                        let symbolType: SymbolDefinition['type'] = matchingUtil.type as SymbolDefinition['type'];
                        
                        // If we have a connection, try to load the codebase index for accurate line numbers
                        if (connection) {
                            try {
                                const [owner, repo] = matchingUtil.repoFullName.split('/');
                                const utilCodebaseIndex = await GitHubChatAgentService['buildCodebaseIndex'](
                                    connection,
                                    owner,
                                    repo
                                );
                                
                                // Try to find the symbol in the codebase index for accurate line numbers
                                if (utilCodebaseIndex.symbolTable && utilCodebaseIndex.symbolTable.has(symbolName)) {
                                    const symbolLocations: SymbolLocation[] = utilCodebaseIndex.symbolTable.get(symbolName) ?? [];
                                    const matchingLocation = symbolLocations.find(
                                        loc => loc.filePath === matchingUtil.filePath
                                    );
                                    if (matchingLocation) {
                                        line = matchingLocation.line;
                                        endLine = matchingLocation.endLine;
                                        symbolType = matchingLocation.type;
                                    }
                                }
                            } catch (error) {
                                loggingService.debug('Failed to load codebase index for accurate line numbers', {
                                    repo: matchingUtil.repoFullName,
                                    symbolName,
                                    error: error instanceof Error ? error.message : 'Unknown'
                                });
                                // Fall back to default line 1
                            }
                        }
                        
                        return {
                            name: symbolName,
                            filePath: matchingUtil.filePath,
                            line,
                            endLine,
                            type: symbolType,
                            repoFullName: matchingUtil.repoFullName
                        };
                    }

                    // Search across all repos by loading codebase indexes
                    // Prioritize repos that match the current repoFullName if provided
                    const reposToSearch = repoFullName
                        ? multiRepoIndex.repositories.filter(r => r.fullName === repoFullName)
                            .concat(multiRepoIndex.repositories.filter(r => r.fullName !== repoFullName))
                        : multiRepoIndex.repositories;

                    for (const repo of reposToSearch.slice(0, 5)) { // Limit to 5 repos to avoid performance issues
                        try {
                            // Check if symbol might be in this repo based on shared utilities
                            const repoHasSymbol = multiRepoIndex.sharedUtilities.some(
                                u => u.repoFullName === repo.fullName && u.name === symbolName
                            );
                            
                            if (repoHasSymbol) {
                                const util = multiRepoIndex.sharedUtilities.find(
                                    u => u.repoFullName === repo.fullName && u.name === symbolName
                                );
                                if (util) {
                                    let line = 1;
                                    let endLine = 1;
                                    let symbolType: SymbolDefinition['type'] = util.type as SymbolDefinition['type'];
                                    
                                    // Use GitHubChatAgentService to get accurate line numbers if connection is available
                                    if (connection) {
                                        try {
                                            const [owner, repoName] = util.repoFullName.split('/');
                                            const utilCodebaseIndex = await GitHubChatAgentService['buildCodebaseIndex'](
                                                connection,
                                                owner,
                                                repoName,
                                                repo.branch
                                            );
                                            
                                            // Find the symbol in the codebase index for accurate line numbers
                                            if (utilCodebaseIndex.symbolTable && utilCodebaseIndex.symbolTable.has(symbolName)) {
                                                const symbolLocations: SymbolLocation[] = utilCodebaseIndex.symbolTable.get(symbolName) ?? [];
                                                const matchingLocation = symbolLocations.find(
                                                    loc => loc.filePath === util.filePath
                                                );
                                                if (matchingLocation) {
                                                    line = matchingLocation.line;
                                                    endLine = matchingLocation.endLine;
                                                    symbolType = matchingLocation.type;
                                                }
                                            }
                                        } catch (error) {
                                            loggingService.debug('Failed to load codebase index for symbol line numbers', {
                                                repo: util.repoFullName,
                                                symbolName,
                                                error: error instanceof Error ? error.message : 'Unknown'
                                            });
                                            // Fall back to default line 1
                                        }
                                    }
                                    
                                    return {
                                        name: symbolName,
                                        filePath: util.filePath,
                                        line,
                                        endLine,
                                        type: symbolType,
                                        repoFullName: util.repoFullName
                                    };
                                }
                            }
                        } catch (error) {
                            loggingService.debug('Failed to search repo for symbol', {
                                repo: repo.fullName,
                                symbolName,
                                error: error instanceof Error ? error.message : 'Unknown'
                            });
                            // Continue to next repo
                        }
                    }
                }
            }

            return null;
        } catch (error) {
            loggingService.error('Symbol definition search failed', {
                symbolName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return null;
        }
    }

    /**
     * Get symbol definition with context (surrounding code)
     */
    static async getSymbolDefinitionWithContext(
        symbolName: string,
        codebaseIndex: CodebaseIndex,
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        ref?: string
    ): Promise<SymbolDefinition | null> {
        // Pass connection to findSymbolDefinition for accurate line numbers across repos
        const userId = connection.userId;
        const repoFullName = `${owner}/${repo}`;
        const definition = await this.findSymbolDefinition(
            symbolName, 
            codebaseIndex, 
            userId, 
            repoFullName, 
            connection
        );
        
        if (!definition) {
            return null;
        }

        try {
            // Fetch file content to get context
            const content = await GitHubService.getFileContent(
                connection,
                owner,
                repo,
                definition.filePath,
                ref
            );

            if (content) {
                const lines = content.split('\n');
                const startLine = Math.max(0, definition.line - 21); // 20 lines before
                const endLine = Math.min(lines.length, definition.endLine + 20); // 20 lines after
                
                definition.context = lines.slice(startLine, endLine).join('\n');
            }
        } catch (error) {
            loggingService.warn('Failed to fetch context for symbol', {
                symbolName,
                filePath: definition.filePath,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }

        return definition;
    }

    /**
     * Find all definitions of a symbol (for overloaded functions, etc.)
     */
    static async findAllDefinitions(
        symbolName: string,
        codebaseIndex: CodebaseIndex,
        userId?: string
    ): Promise<SymbolDefinition[]> {
        const definitions: SymbolDefinition[] = [];

        // Get from current codebase
        if (codebaseIndex.symbolTable && codebaseIndex.symbolTable.has(symbolName)) {
            const locations: SymbolLocation[] = codebaseIndex.symbolTable.get(symbolName) ?? [];
            for (const location of locations) {
                definitions.push({
                    name: symbolName,
                    filePath: location.filePath,
                    line: location.line,
                    endLine: location.endLine,
                    type: location.type
                });
            }
        }

        // Get from multi-repo index
        if (userId) {
            try {
                const multiRepoIndex = await MultiRepoIndex.findOne({ userId });
                if (multiRepoIndex) {
                    const matchingUtils = multiRepoIndex.sharedUtilities.filter(
                        u => u.name === symbolName
                    );
                    for (const util of matchingUtils) {
                        definitions.push({
                            name: symbolName,
                            filePath: util.filePath,
                            line: 1,
                            endLine: 1,
                            type: util.type as SymbolDefinition['type'],
                            repoFullName: util.repoFullName
                        });
                    }
                }
            } catch (error) {
                loggingService.warn('Failed to search multi-repo for definitions', {
                    symbolName,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
            }
        }

        return definitions;
    }
}

