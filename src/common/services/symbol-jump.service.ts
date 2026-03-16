/**
 * Symbol Jump Service - LSP-like jump-to-definition across codebase and multi-repo index.
 * Ported from Express symbolJump.service.ts.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MultiRepoIndex,
  MultiRepoIndexDocument,
} from '../../schemas/document/multi-repo-index.schema';
import { GitHubConnectionDocument } from '../../schemas/integration/github-connection.schema';
import { SymbolLocation } from '../../modules/github/interfaces/github.interfaces';
import { GitHubService } from '../../modules/github/github.service';

export interface SymbolDefinition {
  name: string;
  filePath: string;
  line: number;
  endLine: number;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'import';
  context?: string;
  repoFullName?: string;
}

export interface SymbolJumpCodebaseIndex {
  symbolTable?:
    | Map<string, SymbolLocation[]>
    | Record<string, SymbolLocation[]>;
}

@Injectable()
export class SymbolJumpService {
  private readonly logger = new Logger(SymbolJumpService.name);

  constructor(
    @InjectModel(MultiRepoIndex.name)
    private multiRepoIndexModel: Model<MultiRepoIndexDocument>,
    private readonly githubService: GitHubService,
  ) {}

  /**
   * Find symbol definition across codebase and multi-repo index.
   */
  async findSymbolDefinition(
    symbolName: string,
    codebaseIndex: SymbolJumpCodebaseIndex,
    userId?: string,
    repoFullName?: string,
  ): Promise<SymbolDefinition | null> {
    try {
      const symbolTable = codebaseIndex.symbolTable;
      const table =
        symbolTable instanceof Map
          ? symbolTable
          : symbolTable
            ? new Map(Object.entries(symbolTable))
            : null;

      if (table?.has(symbolName)) {
        const locations = table.get(symbolName) ?? [];
        if (locations.length > 0) {
          const loc = locations[0];
          return {
            name: symbolName,
            filePath: loc.filePath,
            line: loc.line,
            endLine: loc.endLine,
            type: loc.type,
            repoFullName,
          };
        }
      }

      if (userId) {
        const multiRepoIndex = await this.multiRepoIndexModel.findOne({
          userId,
        });
        if (multiRepoIndex?.sharedUtilities) {
          const matchingUtil = multiRepoIndex.sharedUtilities.find(
            (u) => u.name === symbolName,
          );
          if (matchingUtil) {
            return {
              name: symbolName,
              filePath: matchingUtil.filePath,
              line: 1,
              endLine: 1,
              type: matchingUtil.type as SymbolDefinition['type'],
              repoFullName: matchingUtil.repoFullName,
            };
          }

          const reposToSearch = repoFullName
            ? [
                ...multiRepoIndex.repositories.filter(
                  (r) => r.fullName === repoFullName,
                ),
                ...multiRepoIndex.repositories.filter(
                  (r) => r.fullName !== repoFullName,
                ),
              ]
            : multiRepoIndex.repositories;

          for (const repo of reposToSearch.slice(0, 5)) {
            const util = multiRepoIndex.sharedUtilities.find(
              (u) => u.repoFullName === repo.fullName && u.name === symbolName,
            );
            if (util) {
              return {
                name: symbolName,
                filePath: util.filePath,
                line: 1,
                endLine: 1,
                type: util.type as SymbolDefinition['type'],
                repoFullName: util.repoFullName,
              };
            }
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Symbol definition search failed', {
        symbolName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get symbol definition with surrounding code context by fetching file content.
   */
  async getSymbolDefinitionWithContext(
    symbolName: string,
    codebaseIndex: SymbolJumpCodebaseIndex,
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<SymbolDefinition | null> {
    const userId = connection.userId;
    const repoFullName = `${owner}/${repo}`;
    const definition = await this.findSymbolDefinition(
      symbolName,
      codebaseIndex,
      userId,
      repoFullName,
    );

    if (!definition) return null;

    try {
      const content = await this.githubService.getFileContent(
        connection,
        owner,
        repo,
        definition.filePath,
        ref,
      );
      if (content) {
        const lines = content.split('\n');
        const startLine = Math.max(0, definition.line - 21);
        const endLine = Math.min(lines.length, definition.endLine + 20);
        definition.context = lines.slice(startLine, endLine).join('\n');
      }
    } catch (error) {
      this.logger.warn('Failed to fetch context for symbol', {
        symbolName,
        filePath: definition.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return definition;
  }

  /**
   * Find all definitions of a symbol (e.g. overloaded functions).
   */
  async findAllDefinitions(
    symbolName: string,
    codebaseIndex: SymbolJumpCodebaseIndex,
    userId?: string,
  ): Promise<SymbolDefinition[]> {
    const definitions: SymbolDefinition[] = [];
    const symbolTable = codebaseIndex.symbolTable;
    const table =
      symbolTable instanceof Map
        ? symbolTable
        : symbolTable
          ? new Map(Object.entries(symbolTable))
          : null;

    if (table?.has(symbolName)) {
      const locations = table.get(symbolName) ?? [];
      for (const loc of locations) {
        definitions.push({
          name: symbolName,
          filePath: loc.filePath,
          line: loc.line,
          endLine: loc.endLine,
          type: loc.type,
        });
      }
    }

    if (userId) {
      try {
        const multiRepoIndex = await this.multiRepoIndexModel.findOne({
          userId,
        });
        if (multiRepoIndex?.sharedUtilities) {
          const matchingUtils = multiRepoIndex.sharedUtilities.filter(
            (u) => u.name === symbolName,
          );
          for (const util of matchingUtils) {
            definitions.push({
              name: symbolName,
              filePath: util.filePath,
              line: 1,
              endLine: 1,
              type: util.type as SymbolDefinition['type'],
              repoFullName: util.repoFullName,
            });
          }
        }
      } catch (error) {
        this.logger.warn('Failed to search multi-repo for definitions', {
          symbolName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return definitions;
  }
}
