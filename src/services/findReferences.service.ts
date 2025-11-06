import { CodebaseIndex, DependencyEdge } from './githubChatAgent.service';
import { MultiRepoIndex } from '../models/MultiRepoIndex';
import { loggingService } from './logging.service';

export interface SymbolReference {
    filePath: string;
    line: number;
    context: string; // Line of code where symbol is used
    type: 'import' | 'call' | 'type-reference' | 'extends' | 'implements';
    repoFullName?: string;
}

/**
 * Find References Service - Track symbol usage across codebase
 */
export class FindReferencesService {
    /**
     * Find all references to a symbol
     */
    static async findReferences(
        symbolName: string,
        codebaseIndex: CodebaseIndex,
        userId?: string
    ): Promise<SymbolReference[]> {
        const references: SymbolReference[] = [];

        try {
            // Find in dependency graph (imports, exports, extends, implements)
            if (codebaseIndex.dependencyGraph) {
                for (const edge of codebaseIndex.dependencyGraph) {
                    if (edge.to === symbolName || edge.from.includes(symbolName)) {
                        references.push({
                            filePath: edge.from,
                            line: edge.line,
                            context: `${edge.type}: ${edge.to}`,
                            type: this.mapDependencyTypeToReferenceType(edge.type)
                        });
                    }
                }
            }

            // Find in call graph
            if (codebaseIndex.callGraph) {
                for (const node of codebaseIndex.callGraph) {
                    if (node.functionName === symbolName) {
                        // This function is called by others
                        for (const caller of node.calledBy) {
                            references.push({
                                filePath: node.filePath,
                                line: 1, // Would need actual line from AST
                                context: `Called by: ${caller}`,
                                type: 'call'
                            });
                        }
                    }
                    if (node.calls.includes(symbolName)) {
                        // This function calls the symbol
                        references.push({
                            filePath: node.filePath,
                            line: 1,
                            context: `Calls: ${symbolName}`,
                            type: 'call'
                        });
                    }
                }
            }

            // Find in AST metadata (imports)
            if (codebaseIndex.astMetadata) {
                for (const [filePath, ast] of codebaseIndex.astMetadata.entries()) {
                    for (const imp of ast.imports) {
                        if (imp.imports.includes(symbolName) || imp.source.includes(symbolName)) {
                            references.push({
                                filePath,
                                line: imp.line,
                                context: `import ${symbolName} from ${imp.source}`,
                                type: 'import'
                            });
                        }
                    }
                }
            }

            // Find in multi-repo index
            if (userId) {
                try {
                    const multiRepoIndex = await MultiRepoIndex.findOne({ userId });
                    if (multiRepoIndex) {
                        const matchingUtils = multiRepoIndex.sharedUtilities.filter(
                            u => u.name === symbolName
                        );
                        for (const util of matchingUtils) {
                            for (const usedInRepo of util.usedInRepos) {
                                references.push({
                                    filePath: util.filePath,
                                    line: 1,
                                    context: `Used in repo: ${usedInRepo}`,
                                    type: 'import',
                                    repoFullName: usedInRepo
                                });
                            }
                        }
                    }
                } catch (error) {
                    loggingService.warn('Failed to search multi-repo for references', {
                        symbolName,
                        error: error instanceof Error ? error.message : 'Unknown'
                    });
                }
            }

            // Remove duplicates
            const uniqueReferences = references.filter((ref, index, self) =>
                index === self.findIndex(r => 
                    r.filePath === ref.filePath && 
                    r.line === ref.line &&
                    r.type === ref.type
                )
            );

            return uniqueReferences;
        } catch (error) {
            loggingService.error('Find references failed', {
                symbolName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Get usage statistics for a symbol
     */
    static async getUsageStats(
        symbolName: string,
        codebaseIndex: CodebaseIndex,
        userId?: string
    ): Promise<{
        totalReferences: number;
        filesCount: number;
        reposCount: number;
        referenceTypes: Record<string, number>;
    }> {
        const references = await this.findReferences(symbolName, codebaseIndex, userId);

        const files = new Set(references.map(r => r.filePath));
        const repos = new Set(references.map(r => r.repoFullName).filter(Boolean));
        const referenceTypes: Record<string, number> = {};

        for (const ref of references) {
            referenceTypes[ref.type] = (referenceTypes[ref.type] || 0) + 1;
        }

        return {
            totalReferences: references.length,
            filesCount: files.size,
            reposCount: repos.size,
            referenceTypes
        };
    }

    /**
     * Map dependency edge type to reference type
     */
    private static mapDependencyTypeToReferenceType(
        edgeType: DependencyEdge['type']
    ): SymbolReference['type'] {
        switch (edgeType) {
            case 'import':
                return 'import';
            case 'export':
                return 'import'; // Exports are referenced via imports
            case 'extends':
                return 'extends';
            case 'implements':
                return 'implements';
            case 'calls':
                return 'call';
            default:
                return 'type-reference';
        }
    }
}

