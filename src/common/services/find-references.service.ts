/**
 * Find References Service (NestJS)
 * Finds all references to a symbol across a codebase index and optional multi-repo data.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MultiRepoIndex,
  MultiRepoIndexDocument,
} from '../../schemas/document/multi-repo-index.schema';

export interface SymbolReference {
  filePath: string;
  line: number;
  context: string;
  type: 'import' | 'call' | 'type-reference' | 'extends' | 'implements';
  repoFullName?: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: string;
  line?: number;
}

export interface CallGraphNode {
  filePath: string;
  functionName: string;
  calls: string[];
  calledBy: string[];
}

export interface AstImport {
  source: string;
  imports: string[];
  line: number;
}

export interface CodebaseIndex {
  dependencyGraph?: DependencyEdge[];
  callGraph?: CallGraphNode[];
  astMetadata?:
    | Map<string, { imports: AstImport[] }>
    | Record<string, { imports: AstImport[] }>;
}

@Injectable()
export class FindReferencesService {
  private readonly logger = new Logger(FindReferencesService.name);

  constructor(
    @InjectModel(MultiRepoIndex.name)
    private multiRepoIndexModel: Model<MultiRepoIndexDocument>,
  ) {}

  async findReferences(
    symbolName: string,
    codebaseIndex: CodebaseIndex,
    userId?: string,
  ): Promise<SymbolReference[]> {
    const references: SymbolReference[] = [];

    try {
      if (codebaseIndex.dependencyGraph) {
        for (const edge of codebaseIndex.dependencyGraph) {
          if (edge.to === symbolName || edge.from.includes(symbolName)) {
            references.push({
              filePath: edge.from,
              line: edge.line ?? 1,
              context: `${edge.type}: ${edge.to}`,
              type: this.mapDependencyTypeToReferenceType(edge.type),
            });
          }
        }
      }

      if (codebaseIndex.callGraph) {
        for (const node of codebaseIndex.callGraph) {
          if (node.functionName === symbolName) {
            for (const caller of node.calledBy) {
              references.push({
                filePath: node.filePath,
                line: 1,
                context: `Called by: ${caller}`,
                type: 'call',
              });
            }
          }
          if (node.calls.includes(symbolName)) {
            references.push({
              filePath: node.filePath,
              line: 1,
              context: `Calls: ${symbolName}`,
              type: 'call',
            });
          }
        }
      }

      if (codebaseIndex.astMetadata) {
        const entries =
          codebaseIndex.astMetadata instanceof Map
            ? codebaseIndex.astMetadata.entries()
            : Object.entries(codebaseIndex.astMetadata);
        for (const [filePath, ast] of entries) {
          for (const imp of ast.imports) {
            if (
              imp.imports.includes(symbolName) ||
              imp.source.includes(symbolName)
            ) {
              references.push({
                filePath,
                line: imp.line,
                context: `import ${symbolName} from ${imp.source}`,
                type: 'import',
              });
            }
          }
        }
      }

      if (userId) {
        try {
          const multiRepoIndex = await this.multiRepoIndexModel.findOne({
            userId,
          });
          if (multiRepoIndex?.sharedUtilities) {
            const matching = multiRepoIndex.sharedUtilities.filter(
              (u) => u.name === symbolName,
            );
            for (const util of matching) {
              for (const usedInRepo of util.usedInRepos) {
                references.push({
                  filePath: util.filePath,
                  line: 1,
                  context: `Used in repo: ${usedInRepo}`,
                  type: 'import',
                  repoFullName: usedInRepo,
                });
              }
            }
          }
        } catch (err) {
          this.logger.warn('Failed to search multi-repo for references', {
            symbolName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const seen = new Set<string>();
      return references.filter((ref) => {
        const key = `${ref.filePath}:${ref.line}:${ref.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (error) {
      this.logger.error('Find references failed', {
        symbolName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getUsageStats(
    symbolName: string,
    codebaseIndex: CodebaseIndex,
    userId?: string,
  ): Promise<{
    totalReferences: number;
    filesCount: number;
    reposCount: number;
    referenceTypes: Record<string, number>;
  }> {
    const references = await this.findReferences(
      symbolName,
      codebaseIndex,
      userId,
    );
    const files = new Set(references.map((r) => r.filePath));
    const repos = new Set(
      references.map((r) => r.repoFullName).filter(Boolean) as string[],
    );
    const referenceTypes: Record<string, number> = {};
    for (const ref of references) {
      referenceTypes[ref.type] = (referenceTypes[ref.type] ?? 0) + 1;
    }
    return {
      totalReferences: references.length,
      filesCount: files.size,
      reposCount: repos.size,
      referenceTypes,
    };
  }

  private mapDependencyTypeToReferenceType(
    edgeType: string,
  ): SymbolReference['type'] {
    switch (edgeType) {
      case 'import':
        return 'import';
      case 'export':
        return 'import';
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
