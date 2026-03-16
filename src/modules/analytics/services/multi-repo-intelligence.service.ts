/**
 * Multi-Repository Intelligence Service for NestJS
 *
 * Provides cross-repository analysis, shared utility discovery, and dependency graph analysis.
 * Enables intelligent code reuse recommendations across multiple repositories.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GitHubService } from '../../github/github.service';
import {
  MultiRepoIndex,
  MultiRepoIndexDocument,
  IRepoMetadata,
  ISharedUtilityReference,
  ICrossRepoDependency,
} from '../../../schemas/document/multi-repo-index.schema';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../../schemas/integration/github-connection.schema';

export interface RepoMetadata {
  fullName: string;
  owner: string;
  name: string;
  language: string;
  lastIndexedAt: Date;
  commitSha?: string;
  branch: string;
}

export interface SharedUtility {
  name: string;
  filePath: string;
  repoFullName: string;
  type: 'function' | 'class' | 'module' | 'utility';
  signature?: string;
  usedInRepos: string[];
  similarityScore: number;
}

export interface CrossRepoDependency {
  fromRepo: string;
  toRepo: string;
  dependencyType: 'package' | 'module' | 'shared-code' | 'monorepo';
  confidence: number;
  lastDetected: Date;
}

export interface DependencyGraph {
  nodes: Array<{
    repo: string;
    dependencies: string[];
    dependents: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: 'package' | 'module' | 'shared-code' | 'monorepo';
  }>;
}

export interface IntegrationPointRecommendation {
  repoFullName: string;
  filePath: string;
  reason: string;
  confidence: number;
  existingPatterns?: string[];
  relatedRepos?: string[];
}

interface ParsedUtility {
  name: string;
  filePath: string;
  repoFullName: string;
  type: 'function' | 'class' | 'module' | 'utility';
  signature?: string;
}

@Injectable()
export class MultiRepoIntelligenceService {
  private readonly logger = new Logger(MultiRepoIntelligenceService.name);
  private readonly UTILITY_DIRECTORIES = [
    'utils',
    'shared',
    'lib',
    'common',
    'helpers',
    'utilities',
  ];

  /** In-memory TTL cache: key -> { value, expiresAt } */
  private readonly memCache = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();

  constructor(
    @InjectModel(MultiRepoIndex.name)
    private multiRepoIndexModel: Model<MultiRepoIndexDocument>,
    @InjectModel(GitHubConnection.name)
    private gitHubConnectionModel: Model<GitHubConnectionDocument>,
    private readonly configService: ConfigService,
    private readonly githubService: GitHubService,
  ) {}

  private cacheGet<T>(key: string): T | undefined {
    const entry = this.memCache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.memCache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  private cacheSet(key: string, value: unknown, ttlMs: number): void {
    this.memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Index all user repositories and build cross-repo knowledge graph
   */
  async indexUserRepositories(userId: string): Promise<MultiRepoIndexDocument> {
    try {
      this.logger.log('Starting multi-repo indexing', { userId });

      let multiRepoIndex = await this.multiRepoIndexModel.findOne({ userId });

      if (!multiRepoIndex) {
        multiRepoIndex = new this.multiRepoIndexModel({
          userId,
          repositories: [],
          sharedUtilities: [],
          crossRepoDependencies: [],
        });
      }

      // Fetch real repositories from GitHub
      const repositories = await this.getUserRepositories(userId);

      // Map to schema-compatible metadata
      const repoMetadata: IRepoMetadata[] = repositories.map((repo) => ({
        fullName: repo.fullName,
        owner: repo.owner,
        name: repo.name,
        language: repo.language,
        lastIndexedAt: new Date(),
        commitSha: repo.commitSha,
        branch: repo.branch || 'main',
      }));

      multiRepoIndex.repositories = repoMetadata;

      // Find shared utilities by scanning repo file contents
      const sharedUtilities = await this.findSharedUtilities(repositories);
      multiRepoIndex.sharedUtilities = sharedUtilities;

      // Build dependency graph by analyzing package.json files
      const dependencies = await this.buildDependencyGraph(repositories);
      multiRepoIndex.crossRepoDependencies = dependencies;

      await multiRepoIndex.save();

      // Cache the index for 1 hour
      this.cacheSet(`multi-repo:${userId}`, multiRepoIndex, 3_600_000);

      this.logger.log('Multi-repo indexing completed', {
        userId,
        repoCount: repositories.length,
        sharedUtilitiesCount: sharedUtilities.length,
        dependenciesCount: dependencies.length,
      });

      return multiRepoIndex;
    } catch (error) {
      this.logger.error('Multi-repo indexing failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch user's repositories from GitHub via their stored OAuth connection
   */
  private async getUserRepositories(userId: string): Promise<
    Array<{
      fullName: string;
      owner: string;
      name: string;
      language: string;
      commitSha?: string;
      branch?: string;
    }>
  > {
    type RepoEntry = {
      fullName: string;
      owner: string;
      name: string;
      language: string;
      commitSha?: string;
      branch?: string;
    };

    const cacheKey = `user-repos:${userId}`;
    const cached = this.cacheGet<RepoEntry[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const connection = await this.gitHubConnectionModel.findOne({
      userId,
      isActive: true,
    });
    if (!connection) {
      this.logger.warn('No active GitHub connection found for user', {
        userId,
      });
      return [];
    }

    const githubRepos =
      await this.githubService.listUserRepositories(connection);

    const repos: RepoEntry[] = (githubRepos as Record<string, unknown>[]).map(
      (repo) => ({
        fullName:
          (repo['fullName'] as string) || (repo['full_name'] as string) || '',
        owner:
          (
            (repo['fullName'] as string) ||
            (repo['full_name'] as string) ||
            ''
          ).split('/')[0] || '',
        name: repo['name'] as string,
        language: (repo['language'] as string) || 'unknown',
        branch:
          (repo['defaultBranch'] as string) ||
          (repo['default_branch'] as string) ||
          'main',
      }),
    );

    // Cache for 30 minutes
    this.cacheSet(cacheKey, repos, 1_800_000);
    return repos;
  }

  /**
   * Find shared utilities across all repositories
   */
  private async findSharedUtilities(
    repositories: any[],
  ): Promise<ISharedUtilityReference[]> {
    try {
      const allUtilities: ParsedUtility[] = [];

      for (const repo of repositories) {
        try {
          const utilities = await this.extractUtilitiesFromRepo(repo);
          allUtilities.push(...utilities);
        } catch (repoError) {
          this.logger.warn(
            `Skipping repo ${repo.fullName} during utility scan`,
            {
              error:
                repoError instanceof Error
                  ? repoError.message
                  : String(repoError),
            },
          );
        }
      }

      // Group by name+type to find cross-repo duplicates
      const groupedUtilities = this.groupSimilarUtilities(allUtilities);

      const result: ISharedUtilityReference[] = [];
      for (const [, utilities] of groupedUtilities.entries()) {
        if (utilities.length > 1) {
          const primaryUtility = utilities[0];
          result.push({
            name: primaryUtility.name,
            filePath: primaryUtility.filePath,
            repoFullName: primaryUtility.repoFullName,
            type: primaryUtility.type,
            signature: primaryUtility.signature,
            usedInRepos: utilities.map((u) => u.repoFullName),
            similarityScore: this.calculateSimilarityScore(utilities),
          });
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Error finding shared utilities', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Extract exported functions, classes, and utilities from a repository's utility directories
   */
  private async extractUtilitiesFromRepo(repo: any): Promise<ParsedUtility[]> {
    const utilities: ParsedUtility[] = [];

    const connection = await this.gitHubConnectionModel.findOne({
      $or: [{ 'repositories.fullName': repo.fullName }, { login: repo.owner }],
      isActive: true,
    });

    if (!connection) {
      return utilities;
    }

    for (const utilDir of this.UTILITY_DIRECTORIES) {
      for (const baseDir of [`src/${utilDir}`, utilDir]) {
        try {
          const dirContents = await this.githubService.listDirectoryContents(
            connection,
            repo.owner,
            repo.name,
            baseDir,
          );

          for (const file of dirContents) {
            if (
              file.type !== 'file' ||
              !file.name.match(/\.(ts|js|tsx|jsx)$/)
            ) {
              continue;
            }

            try {
              const content = await this.githubService.getFileContent(
                connection,
                repo.owner,
                repo.name,
                file.path,
              );

              const parsed = this.parseFileForUtilities(
                content,
                file.path,
                repo.fullName,
              );
              utilities.push(...parsed);
            } catch {
              // Skip individual files that fail
            }
          }
          break; // Found the directory, no need to try alternative base
        } catch {
          // Directory doesn't exist at this path, try next
        }
      }
    }

    return utilities;
  }

  /**
   * Parse TypeScript/JavaScript file content for exported symbols
   */
  private parseFileForUtilities(
    content: string,
    filePath: string,
    repoFullName: string,
  ): ParsedUtility[] {
    const utilities: ParsedUtility[] = [];

    // Exported named functions
    const namedFunctionPattern =
      /export\s+(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)/g;
    let match: RegExpExecArray | null;

    while ((match = namedFunctionPattern.exec(content)) !== null) {
      utilities.push({
        name: match[1],
        filePath,
        repoFullName,
        type: 'function',
        signature: `function ${match[1]}(${match[2].trim()})`,
      });
    }

    // Exported arrow functions (const fn = () => ...)
    const arrowFunctionPattern =
      /export\s+const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*[^=>{]+)?\s*=>/g;
    while ((match = arrowFunctionPattern.exec(content)) !== null) {
      utilities.push({
        name: match[1],
        filePath,
        repoFullName,
        type: 'function',
        signature: `const ${match[1]} = (${match[2].trim()}) =>`,
      });
    }

    // Exported classes
    const classPattern =
      /export\s+(?:abstract\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    while ((match = classPattern.exec(content)) !== null) {
      utilities.push({
        name: match[1],
        filePath,
        repoFullName,
        type: 'class',
        signature: `class ${match[1]}`,
      });
    }

    // Export default function
    const defaultFnPattern =
      /export\s+default\s+(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    while ((match = defaultFnPattern.exec(content)) !== null) {
      utilities.push({
        name: match[1],
        filePath,
        repoFullName,
        type: 'utility',
        signature: `export default function ${match[1]}`,
      });
    }

    return utilities;
  }

  /**
   * Group utilities by name and type to identify cross-repo duplicates
   */
  private groupSimilarUtilities(
    utilities: ParsedUtility[],
  ): Map<string, ParsedUtility[]> {
    const groups = new Map<string, ParsedUtility[]>();

    for (const utility of utilities) {
      const key = `${utility.name}:${utility.type}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key)!.push(utility);
    }

    return groups;
  }

  /**
   * Calculate signature similarity score for a group of utilities
   */
  private calculateSimilarityScore(
    utilities: Array<{ name: string; signature?: string }>,
  ): number {
    if (utilities.length <= 1) return 1.0;

    const signatures = utilities
      .map((u) => u.signature || '')
      .filter((s) => s.length > 0);
    if (signatures.length === 0) return 0.5;

    const firstSignature = signatures[0];
    const identicalCount = signatures.filter(
      (s) => s === firstSignature,
    ).length;

    return identicalCount / signatures.length;
  }

  /**
   * Build cross-repository dependency graph from package.json analysis
   */
  private async buildDependencyGraph(
    repositories: any[],
  ): Promise<ICrossRepoDependency[]> {
    const dependencies: ICrossRepoDependency[] = [];

    try {
      for (const repo of repositories) {
        try {
          const packageDeps = await this.analyzePackageDependencies(repo);

          for (const dep of packageDeps) {
            const matchedRepo = repositories.find(
              (r) =>
                r.name === dep.name ||
                r.fullName === dep.name ||
                dep.name.endsWith(`/${r.name}`),
            );

            if (matchedRepo) {
              dependencies.push({
                fromRepo: repo.fullName,
                toRepo: matchedRepo.fullName,
                type: 'package',
                dependencyName: dep.name,
                version: dep.version,
              });
            }
          }
        } catch (repoError) {
          this.logger.warn(`Skipping package analysis for ${repo.fullName}`, {
            error:
              repoError instanceof Error
                ? repoError.message
                : String(repoError),
          });
        }
      }

      // Detect shared-code usage via package.json import scanning
      const sharedCodeDeps = await this.analyzeSharedCodeUsage(repositories);
      dependencies.push(...sharedCodeDeps);
    } catch (error) {
      this.logger.error('Error building dependency graph', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return dependencies;
  }

  /**
   * Fetch and parse package.json to extract external dependencies
   */
  private async analyzePackageDependencies(repo: any): Promise<
    Array<{
      name: string;
      version?: string;
      confidence: number;
    }>
  > {
    const connection = await this.gitHubConnectionModel.findOne({
      $or: [{ 'repositories.fullName': repo.fullName }, { login: repo.owner }],
      isActive: true,
    });

    if (!connection) {
      return [];
    }

    let packageJsonContent: string;
    try {
      packageJsonContent = await this.githubService.getFileContent(
        connection,
        repo.owner,
        repo.name,
        'package.json',
      );
    } catch {
      // No package.json found in this repo
      return [];
    }

    try {
      const parsed = JSON.parse(packageJsonContent);

      const allDeps: Record<string, string> = {
        ...(parsed.dependencies || {}),
        ...(parsed.devDependencies || {}),
        ...(parsed.peerDependencies || {}),
      };

      const deps = Object.entries(allDeps).map(([name, version]) => ({
        name,
        version: typeof version === 'string' ? version : undefined,
        confidence: parsed.dependencies?.[name] ? 0.95 : 0.7,
      }));

      // Also handle workspaces (monorepo packages)
      if (parsed.workspaces) {
        const workspaces: string[] = Array.isArray(parsed.workspaces)
          ? parsed.workspaces
          : parsed.workspaces.packages || [];

        for (const ws of workspaces) {
          deps.push({
            name: ws.replace(/\/\*$/, '').replace(/^packages\//, ''),
            version: undefined,
            confidence: 1.0,
          });
        }
      }

      return deps;
    } catch {
      return [];
    }
  }

  /**
   * Detect shared-code usage by checking if repos reference each other in package.json
   */
  private async analyzeSharedCodeUsage(
    repositories: any[],
  ): Promise<ICrossRepoDependency[]> {
    const dependencies: ICrossRepoDependency[] = [];

    for (const repo of repositories) {
      for (const otherRepo of repositories) {
        if (repo.fullName === otherRepo.fullName) continue;

        try {
          const hasImport = await this.checkForCrossRepoImports(
            repo,
            otherRepo,
          );
          if (hasImport) {
            dependencies.push({
              fromRepo: repo.fullName,
              toRepo: otherRepo.fullName,
              type: 'shared-code',
              dependencyName: otherRepo.name,
            });
          }
        } catch {
          // Skip failed pairwise checks silently
        }
      }
    }

    return dependencies;
  }

  /**
   * Check if fromRepo has a dependency on toRepo by inspecting its package.json
   */
  private async checkForCrossRepoImports(
    fromRepo: any,
    toRepo: any,
  ): Promise<boolean> {
    const connection = await this.gitHubConnectionModel.findOne({
      $or: [
        { 'repositories.fullName': fromRepo.fullName },
        { login: fromRepo.owner },
      ],
      isActive: true,
    });

    if (!connection) {
      return false;
    }

    try {
      const packageJsonContent = await this.githubService.getFileContent(
        connection,
        fromRepo.owner,
        fromRepo.name,
        'package.json',
      );

      const parsed = JSON.parse(packageJsonContent);
      const allDeps = {
        ...(parsed.dependencies || {}),
        ...(parsed.devDependencies || {}),
      };

      const toRepoName = toRepo.name.toLowerCase();
      const toRepoFullName = toRepo.fullName.toLowerCase();

      return Object.keys(allDeps).some((dep) => {
        const depLower = dep.toLowerCase();
        return (
          depLower === toRepoName ||
          depLower.includes(toRepoName) ||
          depLower === toRepoFullName
        );
      });
    } catch {
      return false;
    }
  }

  /**
   * Generate integration point recommendations based on shared utility and dependency data
   */
  async generateIntegrationRecommendations(
    userId: string,
  ): Promise<IntegrationPointRecommendation[]> {
    try {
      const index = await this.multiRepoIndexModel.findOne({ userId });
      if (!index) {
        return [];
      }

      const recommendations: IntegrationPointRecommendation[] = [];

      // Recommend extracting utilities used across multiple repos
      for (const utility of index.sharedUtilities) {
        if (utility.usedInRepos.length > 1) {
          recommendations.push({
            repoFullName: utility.repoFullName,
            filePath: utility.filePath,
            reason: `Utility "${utility.name}" is used in ${utility.usedInRepos.length} repositories. Consider extracting to shared library.`,
            confidence: utility.similarityScore ?? 0.8,
            existingPatterns: utility.usedInRepos,
            relatedRepos: utility.usedInRepos.filter(
              (r) => r !== utility.repoFullName,
            ),
          });
        }
      }

      // Recommend monorepo structure when many shared-code dependencies exist
      const dependencyGroups = this.groupDependenciesByType(
        index.crossRepoDependencies,
      );

      for (const [repo, deps] of dependencyGroups.entries()) {
        const sharedDeps = deps.filter((d) => d.type === 'shared-code');

        if (sharedDeps.length > 2) {
          recommendations.push({
            repoFullName: repo,
            filePath: 'package.json',
            reason: `${sharedDeps.length} shared code dependencies detected. Consider adopting a monorepo structure.`,
            confidence: 0.7,
            existingPatterns: sharedDeps.map((d) => d.toRepo),
            relatedRepos: sharedDeps.map((d) => d.toRepo),
          });
        }
      }

      return recommendations;
    } catch (error) {
      this.logger.error('Error generating integration recommendations', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Group dependencies by source repository
   */
  private groupDependenciesByType(
    dependencies: ICrossRepoDependency[],
  ): Map<string, ICrossRepoDependency[]> {
    const groups = new Map<string, ICrossRepoDependency[]>();

    for (const dep of dependencies) {
      if (!groups.has(dep.fromRepo)) {
        groups.set(dep.fromRepo, []);
      }
      groups.get(dep.fromRepo)!.push(dep);
    }

    return groups;
  }

  /**
   * Get dependency graph for visualization
   */
  async getDependencyGraph(userId: string): Promise<DependencyGraph> {
    try {
      const index = await this.multiRepoIndexModel.findOne({ userId });
      if (!index) {
        return { nodes: [], edges: [] };
      }

      const nodes = index.repositories.map((repo) => ({
        repo: repo.fullName,
        dependencies: index.crossRepoDependencies
          .filter((d) => d.fromRepo === repo.fullName)
          .map((d) => d.toRepo),
        dependents: index.crossRepoDependencies
          .filter((d) => d.toRepo === repo.fullName)
          .map((d) => d.fromRepo),
      }));

      const edges = index.crossRepoDependencies.map((dep) => ({
        from: dep.fromRepo,
        to: dep.toRepo,
        type: dep.type,
      }));

      return { nodes, edges };
    } catch (error) {
      this.logger.error('Error getting dependency graph', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Get shared utilities across repositories
   */
  async getSharedUtilities(userId: string): Promise<SharedUtility[]> {
    try {
      const index = await this.multiRepoIndexModel.findOne({ userId });
      return (index?.sharedUtilities || []).map((u) => ({
        name: u.name,
        filePath: u.filePath,
        repoFullName: u.repoFullName,
        type: u.type,
        signature: u.signature,
        usedInRepos: u.usedInRepos,
        similarityScore: u.similarityScore ?? 1.0,
      }));
    } catch (error) {
      this.logger.error('Error getting shared utilities', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find repositories that could benefit from adopting a specific shared utility
   */
  async findUtilityCandidates(
    userId: string,
    utilityName: string,
  ): Promise<string[]> {
    try {
      const index = await this.multiRepoIndexModel.findOne({ userId });
      if (!index) return [];

      const candidates: string[] = [];

      for (const repo of index.repositories) {
        const hasUtility = index.sharedUtilities.some(
          (u) =>
            u.name === utilityName && u.usedInRepos.includes(repo.fullName),
        );

        if (
          !hasUtility &&
          this.analyzeUtilityBenefit(repo, utilityName, index)
        ) {
          candidates.push(repo.fullName);
        }
      }

      return candidates;
    } catch (error) {
      this.logger.error('Error finding utility candidates', {
        userId,
        utilityName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Determine if a repository would benefit from a utility based on indexed signals
   */
  private analyzeUtilityBenefit(
    repo: IRepoMetadata,
    utilityName: string,
    index: MultiRepoIndexDocument,
  ): boolean {
    // Repos that already use similarly-named utilities are likely to benefit
    const hasSimilarUtility = index.sharedUtilities.some((u) => {
      const similarity = this.calculateNameSimilarity(u.name, utilityName);
      return similarity > 0.5 && u.usedInRepos.includes(repo.fullName);
    });

    if (hasSimilarUtility) {
      return true;
    }

    // TypeScript/JavaScript repos with existing cross-repo dependencies benefit most
    const isJsRepo = ['TypeScript', 'JavaScript'].includes(repo.language || '');
    if (isJsRepo) {
      const hasCrossRepoDeps = index.crossRepoDependencies.some(
        (d) => d.fromRepo === repo.fullName,
      );
      return hasCrossRepoDeps;
    }

    return false;
  }

  /**
   * Calculate Dice-coefficient name similarity between two strings
   */
  private calculateNameSimilarity(a: string, b: string): number {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();

    if (lowerA === lowerB) return 1.0;
    if (lowerA.includes(lowerB) || lowerB.includes(lowerA)) return 0.8;

    const setA = new Set(lowerA.split(''));
    const setB = new Set(lowerB.split(''));
    const intersection = new Set([...setA].filter((c) => setB.has(c)));

    return (2 * intersection.size) / (setA.size + setB.size);
  }

  /**
   * Get multi-repo intelligence statistics for a user
   */
  async getStats(userId: string): Promise<{
    totalRepos: number;
    sharedUtilities: number;
    crossRepoDependencies: number;
    lastSyncedAt?: Date;
  }> {
    try {
      const index = await this.multiRepoIndexModel.findOne({ userId });
      if (!index) {
        return { totalRepos: 0, sharedUtilities: 0, crossRepoDependencies: 0 };
      }

      return {
        totalRepos: index.repositories.length,
        sharedUtilities: index.sharedUtilities.length,
        crossRepoDependencies: index.crossRepoDependencies.length,
        lastSyncedAt: index.updatedAt,
      };
    } catch (error) {
      this.logger.error('Error getting multi-repo stats', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return { totalRepos: 0, sharedUtilities: 0, crossRepoDependencies: 0 };
    }
  }
}
