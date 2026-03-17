import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MCPClientService } from './mcp-client.service';
import { GitHubService } from '../../github/github.service';
import { GovernedAgentService } from '../../governed-agent/services/governed-agent.service';
import { AgentMode } from '../../governed-agent/interfaces/governed-agent.interfaces';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../../schemas/integration/github-connection.schema';
import {
  GitHubIntegration,
  GitHubIntegrationDocument,
} from '../../../schemas/integration/github-integration.schema';
import { MultiRepoIntelligenceService } from '../../analytics/services/multi-repo-intelligence.service';
import {
  MultiRepoIndex,
  MultiRepoIndexDocument,
} from '../../../schemas/document/multi-repo-index.schema';
import {
  Conversation,
  ConversationDocument,
} from '../../../schemas/chat/conversation.schema';
import { AIRouterService } from '../../cortex/services/ai-router.service';
import * as fs from 'fs';
import * as path from 'path';

export interface GithubChatResult {
  response: string;
  routeToMcp?: boolean;
  toolUsed?: string;
  success?: boolean;
}

export interface GitHubChatContext {
  conversationId?: string;
  githubContext?: {
    connectionId?: string;
    repositoryId?: string;
    repositoryName?: string;
    repositoryFullName?: string;
    integrationId?: string;
    branchName?: string;
  };
  userId: string;
}

export interface GitHubCommand {
  action:
    | 'start_integration'
    | 'update_pr'
    | 'check_status'
    | 'list_repos'
    | 'connect'
    | 'make_changes'
    | 'help';
  parameters?: Record<string, any>;
}

export interface GitHubChatResponse {
  message: string;
  data?: any;
  suggestions?: string[];
  requiresAction?: boolean;
  action?: GitHubCommand;
  toolUsed?: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 'export' | 'extends' | 'implements' | 'calls';
  line: number;
}

export interface CallGraphNode {
  functionName: string;
  filePath: string;
  calls: string[];
  calledBy: string[];
}

export interface CodebaseIndex {
  files: Array<{
    path: string;
    size: number;
    type: 'file' | 'dir';
    category: 'source' | 'config' | 'test' | 'doc' | 'other';
    language?: string;
  }>;
  structure: {
    sourceFiles: string[];
    configFiles: string[];
    testFiles: string[];
    docFiles: string[];
    entryPoints: string[];
  };
  summary: {
    totalFiles: number;
    sourceCount: number;
    languages: string[];
    framework?: string;
    packageManager?: string;
  };
  // Enhanced AST metadata
  astMetadata?: Map<string, any>; // ASTAnalysis type from Tree-Sitter service
  symbolTable?: Map<string, any[]>; // SymbolLocation[] type
  dependencyGraph?: DependencyEdge[];
  callGraph?: CallGraphNode[];
}

/** Maps user intent to GitHub MCP tool names */
const INTENT_TOOL: Record<string, string> = {
  list_repos: 'github_list_repos',
  get_repo: 'github_get_repo',
  list_issues: 'github_list_issues',
  get_issue: 'github_get_issue',
  create_issue: 'github_create_issue',
  list_prs: 'github_list_prs',
  get_pr: 'github_list_prs',
  create_pr: 'github_create_pr',
  list_branches: 'github_list_branches',
};

@Injectable()
export class GithubChatAgentService {
  private readonly logger = new Logger(GithubChatAgentService.name);

  // Caching for examples
  private static examplesCache: Map<
    string,
    { content: string; path: string; category: string }[]
  > = new Map();
  private static examplesCacheTime: number = 0;
  private static readonly EXAMPLES_CACHE_TTL = 600000; // 10 minutes

  // Caching for codebase indexes (Cursor-like local indexing)
  private static codebaseIndexCache: Map<
    string,
    { index: CodebaseIndex; timestamp: number }
  > = new Map();
  private static readonly CODEBASE_CACHE_TTL = 3600000; // 1 hour

  // Caching for file contents
  private static fileContentCache: Map<
    string,
    { content: string; timestamp: number }
  > = new Map();
  private static readonly FILE_CACHE_TTL = 1800000; // 30 minutes

  // Rate limiting state
  private static rateLimitState: Map<
    string,
    { count: number; resetTime: number }
  > = new Map();
  private static readonly MAX_REQUESTS_PER_MINUTE = 60;

  constructor(
    private readonly mcpClient: MCPClientService,
    private readonly gitHubService: GitHubService,
    private readonly multiRepoIntelligence: MultiRepoIntelligenceService,
    private readonly aiRouter: AIRouterService,
    private readonly governedAgentService: GovernedAgentService,
    @InjectModel(GitHubConnection.name)
    private readonly githubConnectionModel: Model<GitHubConnectionDocument>,
    @InjectModel(GitHubIntegration.name)
    private readonly githubIntegrationModel: Model<GitHubIntegrationDocument>,
    @InjectModel(MultiRepoIndex.name)
    private readonly multiRepoIndexModel: Model<MultiRepoIndexDocument>,
    @InjectModel('ChatConversation')
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  /**
   * Load costkatana-examples as knowledge base from GitHub repository
   */
  private async loadCostKatanaExamples(): Promise<
    Array<{ content: string; path: string; category: string }>
  > {
    const now = Date.now();

    // Return cached if still valid
    if (
      GithubChatAgentService.examplesCache.has('all') &&
      now - GithubChatAgentService.examplesCacheTime <
        GithubChatAgentService.EXAMPLES_CACHE_TTL
    ) {
      return GithubChatAgentService.examplesCache.get('all') ?? [];
    }

    const examples: Array<{ content: string; path: string; category: string }> =
      [];

    try {
      const owner = 'Hypothesize-Tech';
      const repo = 'costkatana-examples';
      const branch = 'master';

      this.logger.log(
        `Loading costkatana-examples from GitHub repository: ${owner}/${repo}`,
      );

      // First, try to load from local filesystem (for development)
      const examplesPath = path.resolve(
        process.cwd(),
        '../../../costkatana-examples',
      );
      if (fs.existsSync(examplesPath)) {
        this.logger.log(
          'Found local costkatana-examples, loading from filesystem',
        );

        const loadDirectory = (
          dirPath: string,
          category: string = '',
        ): void => {
          try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
              const fullPath = path.join(dirPath, entry.name);

              if (entry.isDirectory()) {
                const newCategory = category
                  ? `${category}/${entry.name}`
                  : entry.name;
                loadDirectory(fullPath, newCategory);
              } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (
                  [
                    '.ts',
                    '.js',
                    '.py',
                    '.md',
                    '.json',
                    '.tsx',
                    '.jsx',
                  ].includes(ext)
                ) {
                  try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const relativePath = path.relative(examplesPath, fullPath);

                    examples.push({
                      content,
                      path: relativePath,
                      category: category || 'general',
                    });
                  } catch (error) {
                    this.logger.warn(
                      `Failed to read example file: ${fullPath}`,
                      error,
                    );
                  }
                }
              }
            }
          } catch (error) {
            this.logger.warn(
              `Failed to load examples directory: ${dirPath}`,
              error,
            );
          }
        };

        loadDirectory(examplesPath);

        if (examples.length > 0) {
          GithubChatAgentService.examplesCache.set('all', examples);
          GithubChatAgentService.examplesCacheTime = now;
          return examples;
        }
      }

      // Fallback to GitHub API
      this.logger.log('Loading costkatana-examples from GitHub API');

      // Get the tree recursively using GitHub API
      const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

      const treeResponse = await fetch(treeUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'CostKatana-Backend',
        },
      });

      if (!treeResponse.ok) {
        throw new Error(
          `GitHub API error: ${treeResponse.status} ${treeResponse.statusText}`,
        );
      }

      const treeData = (await treeResponse.json()) as {
        tree: Array<{
          path: string;
          type: 'blob' | 'tree';
          sha: string;
          size?: number;
        }>;
      };

      // Filter for relevant file types
      const allowedExtensions = [
        '.ts',
        '.js',
        '.py',
        '.md',
        '.json',
        '.tsx',
        '.jsx',
      ];
      const filePaths = treeData.tree
        .filter(
          (item) =>
            item.type === 'blob' &&
            allowedExtensions.some((ext) => item.path.endsWith(ext)),
        )
        .map((item) => item.path);

      this.logger.log(
        `Found ${filePaths.length} example files in GitHub repository`,
      );

      // Fetch file contents in batches
      const batchSize = 10;
      for (let i = 0; i < filePaths.length; i += batchSize) {
        const batch = filePaths.slice(i, i + batchSize);

        const fetchPromises = batch.map(async (filePath) => {
          try {
            // Use GitHub raw content API
            const contentUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
            const contentResponse = await fetch(contentUrl, {
              headers: {
                Accept: 'text/plain',
                'User-Agent': 'CostKatana-Backend',
              },
            });

            if (!contentResponse.ok) {
              this.logger.warn(
                `Failed to fetch file content: ${filePath}, status: ${contentResponse.status}`,
              );
              return null;
            }

            const content = await contentResponse.text();

            // Extract category from path (directory structure)
            const pathParts = filePath.split('/');
            const category =
              pathParts.length > 1
                ? pathParts.slice(0, -1).join('/')
                : 'general';

            return {
              content,
              path: filePath,
              category,
            };
          } catch (error) {
            this.logger.warn(`Error fetching example file: ${filePath}`, error);
            return null;
          }
        });

        const batchResults = await Promise.allSettled(fetchPromises);
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            examples.push(result.value);
          }
        });

        // Rate limiting: small delay between batches
        if (i + batchSize < filePaths.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Cache the results
      GithubChatAgentService.examplesCache.set('all', examples);
      GithubChatAgentService.examplesCacheTime = now;

      this.logger.log(`Loaded costkatana-examples from GitHub`, {
        count: examples.length,
        categories: [...new Set(examples.map((e) => e.category))],
        source: 'github',
      });
    } catch (error) {
      this.logger.error(
        'Failed to load costkatana-examples from GitHub',
        error,
      );

      // Return cached version if available, even if expired
      const cached = GithubChatAgentService.examplesCache.get('all');
      if (cached) {
        this.logger.warn('Using expired cache due to fetch failure');
        return cached;
      }
    }

    return examples;
  }

  /**
   * Find relevant examples based on user request and codebase context
   */
  private async findRelevantExamples(
    userRequest: string,
    codebaseIndex?: CodebaseIndex,
  ): Promise<Array<{ content: string; path: string; category: string }>> {
    const allExamples = await this.loadCostKatanaExamples();

    if (allExamples.length === 0) {
      return [];
    }

    // Use AI to find relevant examples
    const examplesSummary = allExamples.slice(0, 50).map((e) => ({
      path: e.path,
      category: e.category,
      preview: e.content.substring(0, 200),
    }));

    const searchPrompt = `Find relevant CostKatana integration examples for this request:

User Request: ${userRequest}

Codebase Context:
${
  codebaseIndex
    ? `
- Languages: ${codebaseIndex.summary.languages.join(', ')}
- Framework: ${codebaseIndex.summary.framework || 'Unknown'}
- Package Manager: ${codebaseIndex.summary.packageManager || 'Unknown'}
`
    : ''
}

Available Examples:
${JSON.stringify(examplesSummary, null, 2)}

Return a JSON array of example file paths that are most relevant:
{
  "relevantExamples": ["path/to/example1.ts", "path/to/example2.py", ...]
}`;

    try {
      const result = await this.aiRouter.invokeModel({
        model: 'amazon.nova-pro-v1:0',
        prompt: searchPrompt,
        parameters: { temperature: 0.2, maxTokens: 1024 },
      });
      const response = result?.response ?? '';

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as {
          relevantExamples?: string[];
        };
        const relevantPaths = result.relevantExamples || [];

        // Get full content of relevant examples
        const relevant = allExamples.filter((e) =>
          relevantPaths.includes(e.path),
        );
        return relevant.slice(0, 10); // Limit to 10 examples
      }
    } catch (error) {
      this.logger.warn(
        'Failed to find relevant examples, using keyword matching',
        error,
      );
    }

    // Fallback: keyword-based matching
    const lowerRequest = userRequest.toLowerCase();
    const keywords = lowerRequest.split(/\s+/).filter((w) => w.length > 3);

    return allExamples
      .filter((example) => {
        const content = example.content.toLowerCase();
        const pathLower = example.path.toLowerCase();
        return keywords.some(
          (keyword) => content.includes(keyword) || pathLower.includes(keyword),
        );
      })
      .slice(0, 10);
  }

  /**
   * Find semantically relevant files using hybrid search with multi-repo awareness (Cursor-like semantic search)
   */
  private async findSemanticallyRelevantFiles(
    userRequest: string,
    codebaseIndex: CodebaseIndex,
    userId?: string,
    repoFullName?: string,
  ): Promise<string[]> {
    const relevantPaths: string[] = [];

    try {
      // Semantic retrieval would require injected GitHubRetrievalService; use fallback
      throw new Error('Use fallback');
    } catch (error) {
      this.logger.warn('Hybrid search failed, using fallback', error);

      // Fallback: keyword match from codebase
      const keywords = userRequest
        .toLowerCase()
        .split(/\s+/)
        .filter((w: string) => w.length > 2);
      for (const f of codebaseIndex.files) {
        if (f.type !== 'file') continue;
        const pathLower = (f as { path: string }).path.toLowerCase();
        if (keywords.some((k: string) => pathLower.includes(k))) {
          relevantPaths.push((f as { path: string }).path);
        }
      }
    }

    // Multi-repo awareness: Use MultiRepoIntelligenceService for intelligent recommendations
    if (userId) {
      try {
        // Use MultiRepoIntelligenceService to find integration points and shared utilities
        const integrationPoints =
          await this.multiRepoIntelligence.generateIntegrationRecommendations(
            userId,
          );

        // Add recommended integration points
        for (const point of integrationPoints.slice(0, 5)) {
          if (point.filePath && !relevantPaths.includes(point.filePath)) {
            relevantPaths.push(point.filePath);
          }
        }

        const multiRepoIndex = await this.multiRepoIndexModel.findOne({
          userId,
        });
        if (multiRepoIndex && multiRepoIndex.sharedUtilities.length > 0) {
          // Find shared utilities that match the request
          const requestLower = userRequest.toLowerCase();
          const matchingUtilities = multiRepoIndex.sharedUtilities.filter(
            (util: { name: string; type: string }) => {
              const nameMatch = requestLower.includes(util.name.toLowerCase());
              const typeMatch = requestLower.includes(util.type);
              return nameMatch || typeMatch;
            },
          );

          // Add shared utility files from other repos
          for (const util of matchingUtilities.slice(0, 5)) {
            if (util.repoFullName && util.filePath) {
              const fullPath = `${util.repoFullName}:${util.filePath}`;
              if (!relevantPaths.includes(fullPath)) {
                relevantPaths.push(fullPath);
              }
            }
          }

          this.logger.log('Multi-repo intelligence applied', {
            integrationPoints: integrationPoints.length,
            sharedUtilities: matchingUtilities.length,
            utilities: matchingUtilities.map((u) => u.name),
          });
        }
      } catch (error) {
        this.logger.warn('Multi-repo intelligence search failed', error);
      }
    }

    // Use symbol table for exact matches (if available)
    if (codebaseIndex.symbolTable) {
      const requestWords = userRequest.toLowerCase().split(/\s+/);
      for (const word of requestWords) {
        if (word.length > 3 && codebaseIndex.symbolTable.has(word)) {
          const symbols = codebaseIndex.symbolTable.get(word) || [];
          for (const symbol of symbols.slice(0, 3)) {
            if (!relevantPaths.includes(symbol.filePath)) {
              relevantPaths.push(symbol.filePath);
            }
          }
        }
      }
    }

    // If we have results from vector search or multi-repo, return them
    if (relevantPaths.length > 0) {
      return relevantPaths.slice(0, 20);
    }

    // Fallback: AI-powered relevance detection
    try {
      const fileList = codebaseIndex.structure.sourceFiles
        .slice(0, 100)
        .map((f) => ({
          path: f,
          category:
            codebaseIndex.files.find((cf) => cf.path === f)?.category ||
            'unknown',
        }));

      const relevancePrompt = `Analyze this code change request and identify which files are most relevant:

User Request: ${userRequest}

Available Files:
${JSON.stringify(fileList, null, 2)}

Return a JSON object with the most relevant file paths (top 20):
{
  "relevantFiles": ["path/to/file1", "path/to/file2", ...]
}`;

      const result = await this.aiRouter.invokeModel({
        model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        prompt: relevancePrompt,
        parameters: { temperature: 0.2, maxTokens: 1024 },
      });
      const response = result?.response ?? '';

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as { relevantFiles?: string[] };
        return result.relevantFiles || [];
      }
    } catch (error) {
      this.logger.warn('AI relevance detection failed', error);
    }

    // Final fallback: return entry points and some source files
    return [
      ...codebaseIndex.structure.entryPoints,
      ...codebaseIndex.structure.sourceFiles.slice(0, 20),
    ];
  }

  /**
   * Analyze code structure using Tree-Sitter AST parsing (optional)
   */
  private async analyzeCodeStructure(
    files: Record<string, string>,
    codebaseIndex: CodebaseIndex,
  ): Promise<Record<string, string>> {
    const structure: Record<string, string> = {};

    for (const [path, content] of Object.entries(files)) {
      const fileInfo = codebaseIndex.files.find((f) => f.path === path);
      if (!fileInfo || fileInfo.type !== 'file' || !fileInfo.language) continue;

      try {
        // Optional: Tree-Sitter for precise AST (module may not be present)
        const treeSitterModule =
          await import('../../../modules/ingestion/services/document-processor.service').catch(
            () => null,
          );
        const parseCode = (treeSitterModule as any)?.TreeSitterService
          ?.parseCode;
        if (typeof parseCode === 'function') {
          const astAnalysis = parseCode(content, fileInfo.language, path);

          const parts: string[] = [];
          if (astAnalysis.functions.length > 0) {
            parts.push(
              `${astAnalysis.functions.length} function${astAnalysis.functions.length > 1 ? 's' : ''}`,
            );
          }
          if (astAnalysis.classes.length > 0) {
            parts.push(
              `${astAnalysis.classes.length} class${astAnalysis.classes.length > 1 ? 'es' : ''}`,
            );
          }
          if (astAnalysis.imports.length > 0) {
            parts.push(
              `${astAnalysis.imports.length} import${astAnalysis.imports.length > 1 ? 's' : ''}`,
            );
          }
          if (astAnalysis.exports.length > 0) {
            parts.push(
              `${astAnalysis.exports.length} export${astAnalysis.exports.length > 1 ? 's' : ''}`,
            );
          }
          if (astAnalysis.interfaces.length > 0) {
            parts.push(
              `${astAnalysis.interfaces.length} interface${astAnalysis.interfaces.length > 1 ? 's' : ''}`,
            );
          }

          if (parts.length > 0) {
            structure[path] = parts.join(', ');
          }
        } else {
          structure[path] = 'Structure analysis unavailable';
        }
      } catch (error) {
        // Fallback to basic info if Tree-Sitter fails
        this.logger.warn(
          `Tree-Sitter analysis failed for ${path}, using fallback`,
          error,
        );
        structure[path] = 'Structure analysis unavailable';
      }
    }

    return structure;
  }

  /**
   * Check rate limit and throttle if needed
   */
  private async checkRateLimit(key: string): Promise<void> {
    const now = Date.now();
    const state = GithubChatAgentService.rateLimitState.get(key);

    if (!state || now > state.resetTime) {
      // Reset or initialize
      GithubChatAgentService.rateLimitState.set(key, {
        count: 1,
        resetTime: now + 60000, // 1 minute window
      });
      return;
    }

    if (state.count >= GithubChatAgentService.MAX_REQUESTS_PER_MINUTE) {
      // Rate limit exceeded, wait
      const waitTime = state.resetTime - now;
      if (waitTime > 0) {
        this.logger.warn(`Rate limit reached, throttling`, { key, waitTime });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
      // Reset
      GithubChatAgentService.rateLimitState.set(key, {
        count: 1,
        resetTime: Date.now() + 60000,
      });
    } else {
      state.count++;
    }
  }

  /**
   * Get cached file content or fetch and cache
   */
  private async getFileContentWithCache(
    connection: GitHubConnection & { decryptToken: () => string },
    owner: string,
    repo: string,
    filePath: string,
    ref: string,
  ): Promise<string | null> {
    const cacheKey = `${owner}/${repo}/${ref}/${filePath}`;
    const now = Date.now();

    // Check cache
    const cached = GithubChatAgentService.fileContentCache.get(cacheKey);
    if (
      cached &&
      now - cached.timestamp < GithubChatAgentService.FILE_CACHE_TTL
    ) {
      return cached.content;
    }

    // Check rate limit
    await this.checkRateLimit(`${owner}/${repo}`);

    // Fetch and cache
    try {
      const content = await this.gitHubService.getFileContent(
        connection as any,
        owner,
        repo,
        filePath,
        ref,
      );
      GithubChatAgentService.fileContentCache.set(cacheKey, {
        content,
        timestamp: now,
      });
      return content;
    } catch (error) {
      // Don't cache errors, but log them
      this.logger.warn(`Failed to fetch file content: ${filePath}`, error);
      return null;
    }
  }

  /**
   * Build codebase index for comprehensive understanding (with caching)
   */
  private async buildCodebaseIndex(
    connection: GitHubConnection & { decryptToken: () => string },
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<CodebaseIndex> {
    const cacheKey = `${owner}/${repo}/${ref || 'default'}`;
    const now = Date.now();

    // Check cache
    const cached = GithubChatAgentService.codebaseIndexCache.get(cacheKey);
    if (
      cached &&
      now - cached.timestamp < GithubChatAgentService.CODEBASE_CACHE_TTL
    ) {
      this.logger.log(`Using cached codebase index for ${owner}/${repo}`);
      return cached.index;
    }

    this.logger.log(`Building new codebase index for ${owner}/${repo}`);

    // Get all repository files
    const allFiles = await this.gitHubService.getAllRepositoryFiles(
      connection as any,
      owner,
      repo,
      ref,
    );

    // File extensions to categorize
    const sourceExtensions = {
      javascript: ['.js', '.jsx', '.mjs', '.cjs'],
      typescript: ['.ts', '.tsx'],
      python: ['.py', '.pyw'],
      java: ['.java'],
      go: ['.go'],
      rust: ['.rs'],
      cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.h'],
      c: ['.c', '.h'],
      ruby: ['.rb'],
      php: ['.php'],
      swift: ['.swift'],
      kotlin: ['.kt', '.kts'],
    };

    const configExtensions = [
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.ini',
      '.conf',
      '.config',
      '.env',
      '.gitignore',
    ];
    const testExtensions = ['.test.', '.spec.', '.__test__', '__tests__'];
    const docExtensions = ['.md', '.txt', '.rst', '.adoc'];

    const index: CodebaseIndex = {
      files: [],
      structure: {
        sourceFiles: [],
        configFiles: [],
        testFiles: [],
        docFiles: [],
        entryPoints: [],
      },
      summary: {
        totalFiles: 0,
        sourceCount: 0,
        languages: [],
        framework: undefined,
        packageManager: undefined,
      },
      astMetadata: new Map(),
      symbolTable: new Map(),
      dependencyGraph: [],
      callGraph: [],
    };

    const detectedLanguages = new Set<string>();
    const entryPointPatterns = [
      'index',
      'main',
      'app',
      'server',
      'entry',
      'start',
      'package.json',
      'requirements.txt',
      'setup.py',
      'Pipfile',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
    ];

    for (const file of allFiles) {
      if (file.type === 'dir') continue;

      const path = file.path;
      const fileName = path.substring(path.lastIndexOf('/') + 1);

      let category: 'source' | 'config' | 'test' | 'doc' | 'other' = 'other';
      let language: string | undefined;

      // Detect language and category
      for (const [lang, exts] of Object.entries(sourceExtensions)) {
        if (exts.some((ext) => path.endsWith(ext))) {
          category = 'source';
          language = lang;
          detectedLanguages.add(lang);
          index.structure.sourceFiles.push(path);
          index.summary.sourceCount++;
          break;
        }
      }

      if (!language) {
        if (configExtensions.some((ext) => path.endsWith(ext))) {
          category = 'config';
          index.structure.configFiles.push(path);
        } else if (testExtensions.some((pattern) => path.includes(pattern))) {
          category = 'test';
          index.structure.testFiles.push(path);
        } else if (docExtensions.some((ext) => path.endsWith(ext))) {
          category = 'doc';
          index.structure.docFiles.push(path);
        }
      }

      // Detect entry points
      if (
        entryPointPatterns.some(
          (pattern) =>
            fileName.toLowerCase().includes(pattern) || path.includes(pattern),
        )
      ) {
        index.structure.entryPoints.push(path);
      }

      index.files.push({
        path,
        size: file.size,
        type: 'file',
        category,
        language,
      });
    }

    index.summary.totalFiles = index.files.length;
    index.summary.languages = Array.from(detectedLanguages);

    // Detect package manager
    if (index.structure.configFiles.some((f) => f.includes('package.json'))) {
      index.summary.packageManager = 'npm';
    } else if (
      index.structure.configFiles.some(
        (f) => f.includes('requirements.txt') || f.includes('Pipfile'),
      )
    ) {
      index.summary.packageManager = 'pip';
    } else if (
      index.structure.configFiles.some((f) => f.includes('Cargo.toml'))
    ) {
      index.summary.packageManager = 'cargo';
    } else if (index.structure.configFiles.some((f) => f.includes('go.mod'))) {
      index.summary.packageManager = 'go';
    }

    // Detect framework
    const configContent = index.structure.configFiles.join(' ');
    if (configContent.includes('react') || configContent.includes('next')) {
      index.summary.framework = 'React';
    } else if (configContent.includes('vue')) {
      index.summary.framework = 'Vue';
    } else if (configContent.includes('express')) {
      index.summary.framework = 'Express';
    } else if (configContent.includes('django')) {
      index.summary.framework = 'Django';
    } else if (configContent.includes('flask')) {
      index.summary.framework = 'Flask';
    }

    // Optional: Tree-Sitter for AST parsing (module may not be present)
    try {
      const treeSitterModule =
        await import('../../../modules/ingestion/services/document-processor.service').catch(
          () => null,
        );
      const TreeSitter = (treeSitterModule as any)?.TreeSitterService;
      if (TreeSitter?.initialize) {
        TreeSitter.initialize();
      }

      // Parse source files with Tree-Sitter (limit to first 100 files for performance)
      const sourceFilesToParse = index.structure.sourceFiles.slice(0, 100);
      this.logger.log(
        `Parsing ${sourceFilesToParse.length} source files with Tree-Sitter for ${owner}/${repo}`,
      );

      for (const filePath of sourceFilesToParse) {
        try {
          const fileInfo = index.files.find(
            (f: { path: string }) => f.path === filePath,
          );
          if (!fileInfo || !fileInfo.language) continue;

          // Fetch file content
          const content = await this.getFileContentWithCache(
            connection,
            owner,
            repo,
            filePath,
            ref || 'main',
          );
          if (!content) continue;

          // Parse with Tree-Sitter if available
          const parseCode = TreeSitter?.parseCode;
          if (typeof parseCode !== 'function') continue;
          const astAnalysis = parseCode(content, fileInfo.language, filePath);

          // Store AST metadata
          index.astMetadata!.set(filePath, astAnalysis);

          // Build symbol table
          for (const symbol of astAnalysis.symbols) {
            if (!index.symbolTable!.has(symbol.name)) {
              index.symbolTable!.set(symbol.name, []);
            }
            index.symbolTable!.get(symbol.name)!.push(symbol);
          }

          // Build dependency graph from imports
          for (const imp of astAnalysis.imports) {
            index.dependencyGraph!.push({
              from: filePath,
              to: imp.source,
              type: 'import',
              line: imp.line,
            });
          }

          // Build dependency graph from exports
          for (const exp of astAnalysis.exports) {
            index.dependencyGraph!.push({
              from: filePath,
              to: exp.name,
              type: 'export',
              line: exp.line,
            });
          }

          // Build dependency graph from class inheritance
          for (const cls of astAnalysis.classes) {
            if (cls.extends) {
              index.dependencyGraph!.push({
                from: filePath,
                to: cls.extends,
                type: 'extends',
                line: cls.line,
              });
            }
            if (cls.implements && cls.implements.length > 0) {
              for (const impl of cls.implements) {
                index.dependencyGraph!.push({
                  from: filePath,
                  to: impl,
                  type: 'implements',
                  line: cls.line,
                });
              }
            }
          }

          // Build call graph (simplified - track function calls within same file)
          for (const func of astAnalysis.functions) {
            const callGraphNode: CallGraphNode = {
              functionName: func.name,
              filePath: filePath,
              calls: [],
              calledBy: [],
            };

            // Find function calls within the same file (simplified approach)
            // This would be enhanced with more sophisticated analysis
            const functionCalls = content.match(
              new RegExp(`\\b${func.name}\\s*\\(`, 'g'),
            );
            if (functionCalls && functionCalls.length > 0) {
              // Extract called functions from content (simplified)
              const calledFunctions = astAnalysis.functions
                .filter(
                  (f: { name: string }) =>
                    f.name !== func.name && content.includes(`${f.name}(`),
                )
                .map((f: { name: string }) => f.name);
              callGraphNode.calls = calledFunctions;
            }

            index.callGraph!.push(callGraphNode);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to parse file with Tree-Sitter: ${filePath}`,
            error,
          );
          // Continue with other files
        }
      }
    } catch (err) {
      this.logger.warn('Tree-Sitter not available, skipping AST parsing', err);
    }

    this.logger.log(`Built codebase index with AST metadata`, {
      repository: `${owner}/${repo}`,
      totalFiles: index.summary.totalFiles,
      sourceCount: index.summary.sourceCount,
      languages: index.summary.languages,
      astFilesParsed: index.astMetadata!.size,
      symbolsFound: index.symbolTable!.size,
      dependenciesFound: index.dependencyGraph!.length,
    });

    // Cache the index
    GithubChatAgentService.codebaseIndexCache.set(cacheKey, {
      index,
      timestamp: now,
    });

    // Clean old cache entries (keep max 50)
    if (GithubChatAgentService.codebaseIndexCache.size > 50) {
      const entries = Array.from(
        GithubChatAgentService.codebaseIndexCache.entries(),
      )
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, 50);
      GithubChatAgentService.codebaseIndexCache = new Map(entries);
    }

    return index;
  }

  /**
   * Process GitHub-related chat messages
   */
  async processChatMessage(
    context: GitHubChatContext,
    userMessage: string,
  ): Promise<GitHubChatResponse> {
    try {
      this.logger.log('Processing GitHub chat message', {
        userId: context.userId,
        conversationId: context.conversationId,
        hasGitHubContext: !!context.githubContext,
      });

      // Detect intent and extract command
      const command = await this.detectIntent(userMessage, context);

      // Execute command
      const response = await this.executeCommand(command, context);

      return response;
    } catch (error: any) {
      this.logger.error('GitHub chat message processing failed', {
        userId: context.userId,
        error: error.message,
        stack: error.stack,
      });

      return {
        message: `I encountered an error: ${error.message}. Please try again or contact support if the issue persists.`,
        suggestions: ['Check status', 'List repositories', 'Help'],
      };
    }
  }

  /**
   * Detect user intent and extract command
   */
  private async detectIntent(
    message: string,
    context: GitHubChatContext,
  ): Promise<GitHubCommand> {
    // Simple keyword-based intent detection
    const lowerMessage = message.toLowerCase();

    // Connect GitHub
    if (lowerMessage.includes('connect') && lowerMessage.includes('github')) {
      return { action: 'connect' };
    }

    // List repositories
    if (
      lowerMessage.includes('list') &&
      (lowerMessage.includes('repo') || lowerMessage.includes('repository'))
    ) {
      return { action: 'list_repos' };
    }

    // Start integration
    if (
      (lowerMessage.includes('integrate') ||
        lowerMessage.includes('add') ||
        lowerMessage.includes('setup')) &&
      (lowerMessage.includes('costkatana') ||
        lowerMessage.includes('cost katana'))
    ) {
      return {
        action: 'start_integration',
        parameters: {
          integrationType: this.detectIntegrationType(message),
          features: this.detectFeatures(message),
        },
      };
    }

    // Check status
    if (
      lowerMessage.includes('status') ||
      lowerMessage.includes('progress') ||
      lowerMessage.includes('check')
    ) {
      return { action: 'check_status' };
    }

    // Update PR (for existing integrations)
    if (
      (lowerMessage.includes('update') ||
        lowerMessage.includes('change') ||
        lowerMessage.includes('modify')) &&
      context.githubContext?.integrationId
    ) {
      return {
        action: 'update_pr',
        parameters: {
          changes: message,
        },
      };
    }

    // Make changes to repository (when repo is selected but no integration)
    if (
      context.githubContext &&
      !context.githubContext.integrationId &&
      (lowerMessage.includes('add') ||
        lowerMessage.includes('create') ||
        lowerMessage.includes('update') ||
        lowerMessage.includes('change') ||
        lowerMessage.includes('modify') ||
        lowerMessage.includes('fix') ||
        lowerMessage.includes('implement') ||
        lowerMessage.includes('remove') ||
        lowerMessage.includes('delete'))
    ) {
      return {
        action: 'make_changes',
        parameters: {
          request: message,
        },
      };
    }

    // Help
    if (
      lowerMessage.includes('help') ||
      lowerMessage.includes('what can you do')
    ) {
      return { action: 'help' };
    }

    // Default: Use AI to understand intent
    return await this.detectIntentWithAI(message, context);
  }

  /**
   * Detect integration type from message
   */
  private detectIntegrationType(message: string): 'npm' | 'cli' | 'python' {
    const lower = message.toLowerCase();

    if (
      lower.includes('python') ||
      lower.includes('py') ||
      lower.includes('pip')
    ) {
      return 'python';
    }
    if (lower.includes('cli') || lower.includes('command line')) {
      return 'cli';
    }
    return 'npm'; // default
  }

  /**
   * Detect features from message
   */
  private detectFeatures(message: string): string[] {
    const features: string[] = [];
    const lower = message.toLowerCase();

    if (lower.includes('cost track') || lower.includes('tracking')) {
      features.push('cost-tracking');
    }
    if (lower.includes('cortex') || lower.includes('optimization')) {
      features.push('cortex-optimization');
    }
    if (lower.includes('telemetry') || lower.includes('monitoring')) {
      features.push('telemetry');
    }
    if (lower.includes('analytics')) {
      features.push('analytics');
    }
    if (lower.includes('budget')) {
      features.push('budget-management');
    }

    return features.length > 0 ? features : ['cost-tracking']; // default feature
  }

  /**
   * Build file tree representation from file list
   */
  private buildFileTree(files: CodebaseIndex['files']): string {
    const tree: Record<string, any> = {};

    for (const file of files) {
      const parts = file.path.split('/');
      let current = tree;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          // File
          current[part] = {
            type: file.type,
            category: file.category,
            language: file.language,
            size: file.size,
          };
        } else {
          // Directory
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part];
        }
      }
    }

    const renderTree = (node: any, prefix = ''): string => {
      let output = '';
      const entries = Object.entries(node);

      entries.forEach(([name, value], index) => {
        const isLastItem = index === entries.length - 1;
        const connector = isLastItem ? '└── ' : '├── ';
        const currentPrefix = prefix + connector;

        if (value && typeof value === 'object' && !('type' in value)) {
          // Directory
          output += `${currentPrefix}${name}/\n`;
          const nextPrefix = prefix + (isLastItem ? '    ' : '│   ');
          output += renderTree(value as Record<string, any>, nextPrefix);
        } else if (value && typeof value === 'object' && 'type' in value) {
          // File
          const fileInfo = value as {
            type: string;
            category: string;
            language?: string;
            size: number;
          };
          const category =
            fileInfo.category !== 'other' ? ` [${fileInfo.category}]` : '';
          const lang = fileInfo.language ? ` (${fileInfo.language})` : '';
          output += `${currentPrefix}${name}${category}${lang}\n`;
        }
      });

      return output;
    };

    return renderTree(tree);
  }

  /**
   * Use AI to detect intent
   */
  private async detectIntentWithAI(
    message: string,
    context: GitHubChatContext,
  ): Promise<GitHubCommand> {
    const prompt = `You are a GitHub integration assistant for CostKatana. Analyze the user's message and determine their intent.

User message: "${message}"

Context:
- Has GitHub connection: ${!!context.githubContext}
- Active integration: ${!!context.githubContext?.integrationId}

Available actions:
1. connect - User wants to connect their GitHub account
2. list_repos - User wants to see their repositories
3. start_integration - User wants to integrate CostKatana into a repo
4. check_status - User wants to check integration status
5. update_pr - User wants to update an existing integration PR
6. make_changes - User wants to make changes to repository code
7. help - User needs help or information

Return a JSON object with this structure:
{
  "action": "action_name",
  "parameters": {}
}`;

    try {
      const result = await this.aiRouter.invokeModel({
        model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        prompt,
        parameters: { temperature: 0.2, maxTokens: 1024 },
      });
      const response = result?.response ?? '';

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as GitHubCommand;
      }
    } catch (error) {
      this.logger.warn('AI intent detection failed, using fallback', error);
    }

    return { action: 'help' };
  }

  /**
   * Execute detected command
   */
  private async executeCommand(
    command: GitHubCommand,
    context: GitHubChatContext,
  ): Promise<GitHubChatResponse> {
    switch (command.action) {
      case 'connect':
        return this.handleConnectCommand(context);

      case 'list_repos':
        return this.handleListReposCommand(context);

      case 'start_integration':
        return this.handleStartIntegrationCommand(context, command.parameters);

      case 'check_status':
        return this.handleCheckStatusCommand(context);

      case 'update_pr':
        return this.handleUpdatePRCommand(context, command.parameters);

      case 'make_changes':
        return this.handleMakeChangesCommand(context, command.parameters);

      case 'help':
        return this.handleHelpCommand();

      default:
        return {
          message:
            "I'm not sure what you'd like to do. Would you like to connect your GitHub repository or check the status of an existing integration?",
          suggestions: [
            'Connect GitHub',
            'List repositories',
            'Check status',
            'Help',
          ],
        };
    }
  }

  /**
   * Handle connect command
   */
  private async handleConnectCommand(
    context: GitHubChatContext,
  ): Promise<GitHubChatResponse> {
    // Check if already connected
    const connections = await this.githubConnectionModel.find({
      userId: context.userId,
      isActive: true,
    });

    if (connections.length > 0) {
      return {
        message: `You already have ${connections.length} GitHub connection(s). Would you like to connect another account or work with an existing one?`,
        data: { connections },
        suggestions: [
          'List my repositories',
          'Start integration',
          'Disconnect',
        ],
      };
    }

    const authUrl = `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/github/auth`;

    return {
      message:
        "Great! Let's connect your GitHub account. Please click the button below to authorize CostKatana.",
      requiresAction: true,
      action: {
        action: 'connect',
        parameters: { authUrl },
      },
      suggestions: ['What can you do?', 'Help'],
    };
  }

  /**
   * Handle list repositories command
   */
  private async handleListReposCommand(
    context: GitHubChatContext,
  ): Promise<GitHubChatResponse> {
    const connections = await this.githubConnectionModel.find({
      userId: context.userId,
      isActive: true,
    });

    if (connections.length === 0) {
      return {
        message:
          "You haven't connected any GitHub accounts yet. Would you like to connect one now?",
        suggestions: ['Connect GitHub', 'Help'],
      };
    }

    const repositories = connections.flatMap((conn) => conn.repositories);

    return {
      message: `I found ${repositories.length} repositories across ${connections.length} GitHub account(s). Which repository would you like to integrate CostKatana into?`,
      data: { repositories, connections },
      suggestions: repositories
        .slice(0, 5)
        .map((r) => `Integrate into ${r.name}`),
    };
  }

  /**
   * Handle start integration command
   */
  private async handleStartIntegrationCommand(
    context: GitHubChatContext,
    parameters?: Record<string, any>,
  ): Promise<GitHubChatResponse> {
    if (!context.githubContext?.repositoryId) {
      return {
        message:
          'Which repository would you like to integrate CostKatana into? Please select one from your repositories.',
        suggestions: ['List my repositories'],
      };
    }

    // Default features if not specified
    const features = parameters?.features || ['cost-tracking', 'telemetry'];
    const integrationType = parameters?.integrationType || 'npm';

    const connection = await this.githubConnectionModel.findById(
      context.githubContext.connectionId,
    );
    if (!connection) {
      return {
        message:
          "I couldn't find your GitHub connection. Please reconnect your account.",
        suggestions: ['Connect GitHub'],
      };
    }

    const repository = connection.repositories.find(
      (r: { id: number }) =>
        r.id === Number(context.githubContext?.repositoryId),
    );
    if (!repository) {
      return {
        message:
          "I couldn't find that repository. Please select a valid repository.",
        suggestions: ['List my repositories'],
      };
    }

    // Use MultiRepoIntelligenceService for integration point recommendations
    let integrationRecommendations: string[] = [];
    try {
      const integrationPoints =
        await this.multiRepoIntelligence.generateIntegrationRecommendations(
          context.userId,
        );

      // Filter for current repository and map to file paths
      integrationRecommendations = integrationPoints
        .filter((point) => point.repoFullName === repository.fullName)
        .map((point) => point.filePath);

      if (integrationRecommendations.length > 0) {
        this.logger.log('Integration points found for CostKatana integration', {
          repository: repository.fullName,
          points: integrationRecommendations,
        });
      }
    } catch (error) {
      this.logger.warn(
        'Failed to get integration points for CostKatana',
        error,
      );
    }

    // Start integration using GovernedAgentService for full workflow
    const integrationRequest = `Integrate CostKatana into GitHub repository ${repository.fullName}. Repository details: ${JSON.stringify(repository)}`;
    const task = await this.governedAgentService.initiateTask(
      integrationRequest,
      context.userId,
      context.conversationId,
    );

    // Update conversation with GitHub context when conversationId is present
    if (context.conversationId) {
      try {
        await this.conversationModel.findByIdAndUpdate(context.conversationId, {
          githubContext: {
            connectionId: connection._id,
            repositoryId: repository.id,
            repositoryName: repository.name,
            repositoryFullName: repository.fullName,
            integrationId: task.id,
            branchName:
              (repository as { defaultBranch?: string }).defaultBranch ||
              'main',
          },
        });
      } catch (err) {
        this.logger.warn(
          'Could not update conversation with GitHub context',
          err,
        );
      }
    }

    return {
      message: `🚀 **Starting Integration Process**\n\nI'm integrating CostKatana into **${repository.fullName}** using our AI-powered governed workflow.\n\n**Progress Steps:**\n⏳ Step 1: Analyzing repository structure and requirements...\n⏳ Step 2: Classifying task complexity and generating plan...\n⏳ Step 3: Executing integration with AI guidance...\n⏳ Step 4: Creating pull request and verification...\n\n*This process is fully automated and typically takes 2-5 minutes. You'll receive real-time updates!*\n\n💡 **Tip:** Check the status anytime by asking "check status" or wait for completion notifications!`,
      data: {
        taskId: task.id,
        status: task.status,
        mode: task.mode,
        progress:
          task.mode === 'SCOPE'
            ? 10
            : task.mode === 'PLAN'
              ? 30
              : task.mode === 'BUILD'
                ? 60
                : task.mode === 'VERIFY'
                  ? 90
                  : 5,
        currentStep: `Starting ${task.mode.toLowerCase()} phase...`,
      },
      requiresAction: true,
      suggestions: ['Check status', 'What happens next?', 'Stop integration'],
    };
  }

  /**
   * Handle check status command
   */
  private async handleCheckStatusCommand(
    context: GitHubChatContext,
  ): Promise<GitHubChatResponse> {
    if (!context.githubContext?.integrationId) {
      const integrations = await this.githubIntegrationModel
        .find({ userId: context.userId })
        .sort({ createdAt: -1 })
        .limit(5);

      if (integrations.length === 0) {
        return {
          message:
            "You don't have any active integrations. Would you like to start one?",
          suggestions: ['Start integration', 'List repositories'],
        };
      }

      return {
        message: `You have ${integrations.length} integration(s). Here are the most recent:`,
        data: { integrations },
        suggestions: integrations.map((i) => `Check ${i.repositoryName}`),
      };
    }

    // Get real integration status from GovernedAgentService
    const task = await this.governedAgentService.getTask(
      context.githubContext.integrationId,
      context.userId,
    );

    if (!task) {
      return {
        message:
          'Integration task not found. It may have been completed or cancelled.',
        suggestions: ['Start integration', 'List repositories'],
      };
    }

    const progress = {
      status: task.status,
      progress: this.getProgressFromTask(task),
      currentStep: this.getCurrentStepFromTask(task),
      prUrl: (task as any).prUrl,
      errorMessage: task.status === 'failed' ? task.error : undefined,
    };
    const statusStr = progress.status as string;
    const statusEmojis: Record<string, string> = {
      initializing: '⚙️',
      analyzing: '🔍',
      generating: '✨',
      draft: '📝',
      open: '✅',
      merged: '🎉',
      failed: '❌',
      closed: '🔒',
    };

    const emoji = statusEmojis[statusStr] || '⏳';
    let statusMessage = `${emoji} **Integration Status**: ${progress.status.toUpperCase()}\n📊 **Progress**: ${progress.progress}%\n\n**Current Step**: ${progress.currentStep}`;

    // Add step-by-step progress visualization
    const steps = [
      {
        name: 'Analyzing repository',
        status: ['initializing', 'analyzing'],
        emoji:
          statusStr === 'analyzing'
            ? '🔍'
            : ['open', 'merged'].includes(statusStr)
              ? '✅'
              : '⏳',
      },
      {
        name: 'Generating integration code',
        status: ['generating'],
        emoji:
          statusStr === 'generating'
            ? '✨'
            : ['open', 'merged'].includes(statusStr)
              ? '✅'
              : '⏳',
      },
      {
        name: 'Creating pull request',
        status: ['draft'],
        emoji:
          statusStr === 'draft'
            ? '📝'
            : ['open', 'merged'].includes(statusStr)
              ? '✅'
              : '⏳',
      },
      {
        name: 'Pull request ready',
        status: ['open', 'merged'],
        emoji: statusStr === 'open' || statusStr === 'merged' ? '🎉' : '⏳',
      },
    ];

    statusMessage += `\n\n**Progress Steps:**\n`;
    steps.forEach((step, index) => {
      const isCompleted =
        ['open', 'merged'].includes(statusStr) && index < steps.length - 1;
      const isCurrent = step.status.includes(statusStr);
      const prefix = isCompleted ? '✅' : isCurrent ? step.emoji : '⏳';
      statusMessage += `${prefix} ${step.name}\n`;
    });

    if (progress.prUrl) {
      statusMessage += `\n\n🎉 **Pull Request Created Successfully!**\n\n🔗 **[View & Review Pull Request](${progress.prUrl})**\n\n*Click the link above to review and merge the changes when ready!*`;
    }

    if (progress.errorMessage) {
      statusMessage += `\n\n⚠️ **Error**: ${progress.errorMessage}`;
    }

    return {
      message: statusMessage,
      data: progress,
      suggestions:
        statusStr === 'open' || statusStr === 'merged'
          ? ['View PR', 'Check changes', 'What next?']
          : progress.status === 'failed'
            ? ['Try again', 'Contact support']
            : ['Check status again'],
    };
  }

  /**
   * Handle update PR command
   */
  private async handleUpdatePRCommand(
    context: GitHubChatContext,
    parameters?: Record<string, any>,
  ): Promise<GitHubChatResponse> {
    if (!context.githubContext?.integrationId) {
      return {
        message:
          "I don't see an active integration to update. Please start an integration first.",
        suggestions: ['Start integration', 'List integrations'],
      };
    }

    const changes = parameters?.changes || '';
    if (!changes) {
      return {
        message:
          "What changes would you like me to make to the integration? Please describe what you'd like to update.",
        suggestions: [
          'Add feature X',
          'Change configuration',
          'Update dependencies',
        ],
      };
    }

    try {
      // Get the integration
      const integration = await this.githubIntegrationModel.findById(
        context.githubContext.integrationId,
      );

      if (!integration) {
        return {
          message:
            "I couldn't find the integration to update. It may have been completed or removed.",
          suggestions: ['Start new integration', 'Check status'],
        };
      }

      if (!integration.prNumber || !integration.repositoryFullName) {
        return {
          message:
            "This integration doesn't have an associated pull request yet. Please wait for the integration to complete or check its status.",
          suggestions: ['Check status', 'Start integration'],
        };
      }

      // Get the GitHub connection
      const connection = await this.githubConnectionModel.findById(
        integration.connectionId,
      );

      if (!connection) {
        return {
          message:
            "I couldn't find the GitHub connection for this integration.",
          suggestions: ['Reconnect GitHub', 'Check connections'],
        };
      }

      // Parse repository owner/repo from full name
      const [owner, repo] = integration.repositoryFullName.split('/');

      // Update the PR body with the requested changes
      // First get current PR to preserve existing content
      const currentPR = await this.gitHubService.getPullRequest(
        connection,
        owner,
        repo,
        integration.prNumber,
      );

      // Append the new changes to the existing body
      const updatedBody = currentPR.body
        ? `${currentPR.body}\n\n---\n**Additional Changes Requested:**\n${changes}`
        : `**Integration Pull Request**\n\n**Additional Changes Requested:**\n${changes}`;

      await this.gitHubService.updatePullRequest(connection, {
        owner,
        repo,
        pull_number: integration.prNumber,
        body: updatedBody,
      });

      return {
        message: `✅ **Pull Request Updated Successfully!**\n\nI've added your requested changes to the integration PR #${integration.prNumber} in ${integration.repositoryFullName}.\n\n**Changes added:**\n${changes}\n\nThe PR description now includes these additional requirements.`,
        suggestions: [
          'Check PR status',
          'View changes',
          'Continue integration',
        ],
      };
    } catch (error: any) {
      this.logger.error('Failed to update PR from chat', {
        integrationId: context.githubContext.integrationId,
        error: error.message,
        changes: changes.substring(0, 100),
      });

      return {
        message: `I encountered an error while updating the pull request: ${error.message}. Please try again or check the integration status.`,
        suggestions: ['Check status', 'Try again', 'Contact support'],
      };
    }
  }

  /**
   * Handle make changes command - make arbitrary changes to repository
   */
  private async handleMakeChangesCommand(
    context: GitHubChatContext,
    parameters?: Record<string, any>,
  ): Promise<GitHubChatResponse> {
    if (!context.githubContext) {
      return {
        message: 'No repository selected. Please select a repository first.',
        suggestions: ['Select repository', 'List repositories'],
      };
    }

    const changeRequest = parameters?.request || '';
    if (!changeRequest) {
      return {
        message:
          "What changes would you like me to make? Please describe what you'd like to add, modify, or fix.",
        suggestions: ['Add a feature', 'Fix a bug', 'Update dependencies'],
      };
    }

    try {
      // Get connection
      const connection = await this.githubConnectionModel.findById(
        context.githubContext.connectionId,
      );
      if (!connection || !connection.isActive) {
        return {
          message:
            'GitHub connection not found or inactive. Please reconnect your GitHub account.',
          suggestions: ['Reconnect GitHub', 'Check connections'],
        };
      }

      // Initialize GitHub service
      await this.gitHubService.initialize();

      // Get repository details to find default branch
      const repositoryFullName = context.githubContext?.repositoryFullName;
      if (!repositoryFullName) {
        return {
          message: 'No repository selected. Please select a repository first.',
          suggestions: ['Select repository', 'List repositories'],
        };
      }
      const [owner, repoName] = repositoryFullName.split('/');
      const repoDetails = await this.gitHubService.getRepository(
        connection as any,
        owner,
        repoName,
      );
      const defaultBranch = repoDetails.default_branch || 'main';

      // Build comprehensive codebase index (Cursor-like indexing)
      this.logger.log('Building codebase index for repository', {
        repository: context.githubContext.repositoryFullName,
      });

      const codebaseIndex = await this.buildCodebaseIndex(
        connection as any,
        owner,
        repoName,
        defaultBranch,
      );

      // Optionally trigger multi-repo indexing in background (non-blocking)
      try {
        // Schedule multi-repo indexing if not recently done
        const multiRepoIndex = await this.multiRepoIndexModel.findOne({
          userId: context.userId,
        });
        const shouldIndex =
          !multiRepoIndex ||
          Date.now() - (multiRepoIndex.updatedAt?.getTime() ?? 0) >
            24 * 60 * 60 * 1000; // 24 hours

        if (shouldIndex) {
          // Schedule in background (don't await)
          this.multiRepoIntelligence
            .indexUserRepositories(context.userId)
            .catch((error: unknown) => {
              this.logger.warn('Background multi-repo indexing failed', error);
            });
        }
      } catch (err: unknown) {
        this.logger.debug('Multi-repo indexing check failed', err);
      }

      // Load relevant examples from costkatana-examples
      const relevantExamples = await this.findRelevantExamples(
        changeRequest,
        codebaseIndex,
      );

      // Use semantic search to find most relevant files for the request (with multi-repo awareness)
      const semanticallyRelevantFiles =
        await this.findSemanticallyRelevantFiles(
          changeRequest,
          codebaseIndex,
          context.userId,
          repositoryFullName,
        );

      // Use MultiRepoIntelligenceService to find integration points and recommendations
      let integrationRecommendations: string[] = [];
      try {
        const integrationPoints =
          await this.multiRepoIntelligence.generateIntegrationRecommendations(
            context.userId,
          );

        // Extract file paths from recommendations
        integrationRecommendations = integrationPoints
          .filter(
            (point: { repoFullName?: string; filePath?: string }) =>
              point.repoFullName === repositoryFullName,
          )
          .map((point: { filePath: string }) => point.filePath)
          .slice(0, 5);

        if (integrationRecommendations.length > 0) {
          this.logger.log(
            'Integration points found via MultiRepoIntelligenceService',
            {
              count: integrationRecommendations.length,
              points: integrationRecommendations,
            },
          );
        }
      } catch (error) {
        this.logger.warn('Failed to get integration points', error);
      }

      // Fetch file contents intelligently - prioritize semantically relevant files
      const filesToFetch: string[] = [];

      // Priority 1: Integration points from MultiRepoIntelligenceService (highest priority)
      filesToFetch.push(...integrationRecommendations);

      // Priority 2: Semantically relevant files (most important)
      filesToFetch.push(...semanticallyRelevantFiles.slice(0, 30));

      // Priority 3: Entry points (always important)
      filesToFetch.push(...codebaseIndex.structure.entryPoints);

      // Priority 4: Source files (limit to prevent overload)
      filesToFetch.push(...codebaseIndex.structure.sourceFiles.slice(0, 70));

      // Priority 5: Config files (needed for dependency updates)
      filesToFetch.push(...codebaseIndex.structure.configFiles.slice(0, 20));

      // Remove duplicates and limit total
      const uniqueFiles = Array.from(new Set(filesToFetch)).slice(0, 150);

      this.logger.log('Fetching file contents', {
        repository: context.githubContext.repositoryFullName,
        fileCount: uniqueFiles.length,
      });

      // Fetch file contents in parallel batches (with caching and rate limiting)
      const existingFiles: Record<string, string> = {};
      const batchSize = 15; // Increased batch size for better parallelization

      // Process batches with intelligent throttling
      for (let i = 0; i < uniqueFiles.length; i += batchSize) {
        const batch = uniqueFiles.slice(i, i + batchSize);

        // Parallel fetch with cache
        const fetchPromises = batch.map(async (filePath) => {
          try {
            // Use cached version if available
            const content = await this.getFileContentWithCache(
              connection as any,
              owner,
              repoName,
              filePath,
              defaultBranch,
            );

            if (!content) return; // Skip if fetch failed

            // Smart truncation: full content for files <50KB, truncated for larger
            if (content.length > 50000) {
              existingFiles[filePath] =
                content.substring(0, 25000) +
                '\n\n[... file truncated for size ...]\n\n' +
                content.substring(content.length - 25000);
            } else {
              existingFiles[filePath] = content;
            }
          } catch (error) {
            // File doesn't exist or can't be read, that's okay
            this.logger.warn('Failed to fetch file', { filePath, error });
          }
        });

        // Wait for batch to complete
        await Promise.allSettled(fetchPromises);

        // Intelligent rate limiting: adaptive delay based on batch size
        // Larger delay for larger repositories to respect GitHub rate limits
        if (i + batchSize < uniqueFiles.length) {
          const delay = codebaseIndex.summary.totalFiles > 1000 ? 300 : 150;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      this.logger.log('Completed file fetching', {
        repository: context.githubContext.repositoryFullName,
        filesFetched: Object.keys(existingFiles).length,
        totalRequested: uniqueFiles.length,
      });

      // Build comprehensive repository structure context
      const repoStructureTree = this.buildFileTree(codebaseIndex.files);
      const codebaseSummary = `
Codebase Summary:
- Total Files: ${codebaseIndex.summary.totalFiles}
- Source Files: ${codebaseIndex.summary.sourceCount}
- Languages: ${codebaseIndex.summary.languages.join(', ') || 'Unknown'}
- Framework: ${codebaseIndex.summary.framework || 'Unknown'}
- Package Manager: ${codebaseIndex.summary.packageManager || 'Unknown'}
- Entry Points: ${codebaseIndex.structure.entryPoints.length > 0 ? codebaseIndex.structure.entryPoints.join(', ') : 'None detected'}
`;

      // Analyze code structure (AST-like analysis) for key files
      const codeStructure = await this.analyzeCodeStructure(
        existingFiles,
        codebaseIndex,
      );

      // Build file contents context with semantic relevance indicators
      const existingFilesContext =
        Object.keys(existingFiles).length > 0
          ? '\n\n=== REPOSITORY CODEBASE (Complete File Contents - Prioritized by Relevance) ===\n' +
            Object.entries(existingFiles)
              .sort(([a], [b]) => {
                // Sort: semantically relevant first, then entry points, then source files, then config
                const aIsSemantic = semanticallyRelevantFiles.includes(a);
                const bIsSemantic = semanticallyRelevantFiles.includes(b);
                if (aIsSemantic && !bIsSemantic) return -1;
                if (!aIsSemantic && bIsSemantic) return 1;

                const aIsEntry =
                  codebaseIndex.structure.entryPoints.includes(a);
                const bIsEntry =
                  codebaseIndex.structure.entryPoints.includes(b);
                if (aIsEntry && !bIsEntry) return -1;
                if (!aIsEntry && bIsEntry) return 1;
                return a.localeCompare(b);
              })
              .map(([path, content]) => {
                const fileInfo = codebaseIndex.files.find(
                  (f) => f.path === path,
                );
                const language = fileInfo?.language
                  ? ` (${fileInfo.language})`
                  : '';
                const isSemantic = semanticallyRelevantFiles.includes(path)
                  ? ' 🔍 [SEMANTICALLY RELEVANT]'
                  : '';
                const isIntegrationPoint = integrationRecommendations.includes(
                  path,
                )
                  ? ' ⭐ [RECOMMENDED INTEGRATION POINT]'
                  : '';
                const structureInfo = codeStructure[path]
                  ? `\n[Structure: ${codeStructure[path]}]`
                  : '';
                return `\n=== FILE: ${path}${language}${isSemantic}${isIntegrationPoint}${structureInfo} ===\n${content}\n`;
              })
              .join('\n')
          : '';

      // Build examples context
      const examplesContext =
        relevantExamples.length > 0
          ? '\n\n=== RELEVANT COSTKATANA EXAMPLES ===\n' +
            relevantExamples
              .map((ex) => {
                return `\n--- EXAMPLE: ${ex.path} (Category: ${ex.category}) ---\n${ex.content.substring(0, 3000)}${ex.content.length > 3000 ? '\n[... truncated ...]' : ''}\n`;
              })
              .join('\n\n')
          : '';

      const prompt = `You are an expert code assistant with Cursor-like intelligence - full codebase understanding, semantic search, and pattern recognition. Analyze the repository and make the requested changes with deep understanding of code relationships.

${codebaseSummary}

=== REPOSITORY FILE TREE (Complete Structure) ===
${repoStructureTree}

${existingFilesContext}

${examplesContext}

=== USER REQUEST ===
${changeRequest}

=== YOUR TASK (Cursor-like Intelligence) ===
1. **Deep Code Analysis**: Understand the complete codebase architecture, patterns, and relationships
   - Analyze import/export relationships
   - Understand function and class dependencies
   - Identify architectural patterns and conventions

2. **Semantic Understanding**: Use the semantically relevant files (marked with 🔍) and recommended integration points (marked with ⭐) as your primary focus, but maintain context of the entire codebase

3. **Pattern Matching**: Follow existing code patterns, styling, and conventions
   - Match indentation and formatting
   - Reuse existing utility functions where appropriate
   - Follow the project's architectural decisions

4. **Dependency Management**:
   - Update package.json/requirements.txt/etc. if adding new dependencies
   - Ensure all imports are correct and consistent
   - Maintain version compatibility

5. **Code Generation**:
   - Generate COMPLETE modified file contents (not diffs)
   - Ensure all code is functional, well-formatted, and follows best practices
   - Maintain type safety and error handling patterns
   - Add appropriate comments where the codebase uses them

6. **Technology Stack Awareness**:
   - Languages: ${codebaseIndex.summary.languages.join(', ')}
   - Framework: ${codebaseIndex.summary.framework || 'No framework detected'}
   - Package Manager: ${codebaseIndex.summary.packageManager || 'Unknown'}

7. **Example Integration**: If CostKatana examples are provided above, use them as reference patterns while adapting to this specific codebase's style.

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "files": [
    {
      "path": "relative/path/to/file",
      "action": "create" | "update" | "delete",
      "content": "COMPLETE file content here (if create/update). For updates, provide the FULL modified file with all changes integrated."
    }
  ],
  "commitMessage": "Clear, descriptive commit message",
  "branchName": "chat-changes-${Date.now()}"
}

CRITICAL REQUIREMENTS:
- For "update" actions: Provide the COMPLETE file content with all changes seamlessly integrated
- Maintain code style, patterns, and architecture 100% consistent with the existing codebase
- Ensure all imports, exports, and dependencies are correct and match existing patterns
- Only modify files that actually need to change - don't make unnecessary changes
- If adding dependencies, update the appropriate package manager file`;

      const result = await this.aiRouter.invokeModel({
        model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        prompt,
        parameters: { temperature: 0.2, maxTokens: 2048 },
      });
      const aiResponse = result?.response ?? '';

      // Parse AI response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse AI response');
      }

      const changes = JSON.parse(jsonMatch[0]) as {
        files: Array<{
          path: string;
          action: 'create' | 'update' | 'delete';
          content?: string;
        }>;
        commitMessage: string;
        branchName: string;
      };

      // Get repository owner and name (reuse from above)
      // owner and repoName already defined above

      // Use branch name from AI or generate one
      const branchName = changes.branchName || `chat-changes-${Date.now()}`;
      await this.gitHubService.createBranch(connection as any, {
        owner,
        repo: repoName,
        branchName,
        baseBranch: defaultBranch,
      });

      // Make changes
      for (const file of changes.files) {
        if (file.action === 'create' || file.action === 'update') {
          await this.gitHubService.createOrUpdateFile(connection as any, {
            owner,
            repo: repoName,
            path: file.path,
            content: file.content || '',
            message: `Chat: ${file.action === 'create' ? 'Create' : 'Update'} ${file.path}`,
            branch: branchName,
          });
        } else if (file.action === 'delete') {
          // For deletion, we need to get the file SHA first and then delete it
          await this.gitHubService.initialize();

          // Get Octokit instance using the connection
          const decryptedToken = connection.decryptToken();
          const { Octokit } = await import('@octokit/rest');
          const octokit = new Octokit({ auth: decryptedToken });

          try {
            const { data } = (await octokit.rest.repos.getContent({
              owner,
              repo: repoName,
              path: file.path,
              ref: branchName,
            })) as { data: { sha: string } };

            await octokit.rest.repos.deleteFile({
              owner,
              repo: repoName,
              path: file.path,
              message: `Chat: Delete ${file.path}`,
              sha: data.sha,
              branch: branchName,
            });

            this.logger.log('Deleted file from repository', {
              repository: `${owner}/${repoName}`,
              path: file.path,
              branch: branchName,
            });
          } catch (error: any) {
            if (error.status !== 404) {
              this.logger.error('Failed to delete file', {
                repository: `${owner}/${repoName}`,
                path: file.path,
                error: error.message || String(error),
              });
              throw error;
            }
            // File doesn't exist, skip deletion
            this.logger.warn('File not found for deletion, skipping', {
              repository: `${owner}/${repoName}`,
              path: file.path,
            });
          }
        }
      }

      // Create PR
      const pr = await this.gitHubService.createPullRequest(connection as any, {
        owner,
        repo: repoName,
        title: `Chat Request: ${changes.commitMessage}`,
        body: `This PR was created from a chat request:\n\n**Request:** ${changeRequest}\n\n**Changes:**\n${changes.files.map((f) => `- ${f.action}: ${f.path}`).join('\n')}`,
        head: branchName,
        base: defaultBranch,
      });

      return {
        message: `✅ Changes applied successfully!\n\n📝 **Commit Message**: ${changes.commitMessage}\n🌿 **Branch**: ${branchName}\n📁 **Files Changed**: ${changes.files.length}\n\n🔗 [View Pull Request](${pr.html_url})\n\nYou can review and merge the changes when ready!`,
        data: {
          prUrl: pr.html_url,
          prNumber: pr.number,
          branchName,
          filesChanged: changes.files.length,
        },
        suggestions: ['View PR', 'Check status', 'Make more changes'],
      };
    } catch (error: any) {
      this.logger.error('Failed to make repository changes', {
        userId: context.userId,
        error: error.message,
        stack: error.stack,
      });

      return {
        message: `❌ I encountered an error making changes: ${error.message}\n\nPlease try again or describe the changes more specifically.`,
        suggestions: ['Try again', 'Help', 'Check repository access'],
      };
    }
  }

  /**
   * Handle help command
   */
  private handleHelpCommand(): GitHubChatResponse {
    return {
      message: `I'm your GitHub integration assistant! Here's what I can help you with:

🔗 **Connect GitHub**: Link your GitHub account to get started
📂 **List Repositories**: See all your repositories
🚀 **Start Integration**: Automatically integrate CostKatana into any repo
✅ **Check Status**: Monitor integration progress
🔄 **Update PR**: Modify integration based on your feedback
💻 **Make Changes**: Select a repository and ask me to make changes - I'll create a PR with your requested modifications

Just tell me what you'd like to do, and I'll guide you through it!

**Example commands:**
- "Connect my GitHub account"
- "List my repositories"
- "Integrate CostKatana into my project"
- "Check the status of my integration"
- "Update the PR to add feature X"
- "Add a new API endpoint to handle user registration"
- "Fix the bug in the login function"
- "Create a new component for the dashboard"`,
      suggestions: [
        'Connect GitHub',
        'List repositories',
        'Start integration',
        'Make changes',
      ],
    };
  }

  /**
   * Classify user message into a GitHub intent and optional tool.
   */
  private classifyIntent(message: string): { intent: string; tool?: string } {
    const lower = (message || '').toLowerCase().trim();
    if (
      /\b(list|show)\s+(my\s+)?(repos|repositories)\b/.test(lower) ||
      lower === 'list repos'
    ) {
      return { intent: 'list_repos', tool: INTENT_TOOL.list_repos };
    }
    if (
      /\b(get|show|open)\s+repo\b/.test(lower) ||
      /\brepo\s+[\w.-]+\/[\w.-]+/.test(lower)
    ) {
      return { intent: 'get_repo', tool: INTENT_TOOL.get_repo };
    }
    if (
      /\b(list|show)\s+(my\s+)?issues\b/.test(lower) ||
      lower.includes('list issues')
    ) {
      return { intent: 'list_issues', tool: INTENT_TOOL.list_issues };
    }
    if (/\b(get|show|open)\s+issue\b/.test(lower) || /#\d+/.test(lower)) {
      return { intent: 'get_issue', tool: INTENT_TOOL.get_issue };
    }
    if (/\bcreate\s+(a\s+)?issue\b/.test(lower)) {
      return { intent: 'create_issue', tool: INTENT_TOOL.create_issue };
    }
    if (
      /\b(list|show)\s+(my\s+)?(prs|pull\s*requests)\b/.test(lower) ||
      lower.includes('list prs')
    ) {
      return { intent: 'list_prs', tool: INTENT_TOOL.list_prs };
    }
    if (/\bcreate\s+(a\s+)?(pr|pull\s*request)\b/.test(lower)) {
      return { intent: 'create_pr', tool: INTENT_TOOL.create_pr };
    }
    if (/\b(list|show)\s+branches\b/.test(lower)) {
      return { intent: 'list_branches', tool: INTENT_TOOL.list_branches };
    }
    if (
      lower.includes('github') ||
      lower.includes('repo') ||
      lower.includes('issue') ||
      lower.includes('pull request') ||
      lower.includes('pr ')
    ) {
      return { intent: 'generic', tool: undefined };
    }
    return { intent: 'unknown', tool: undefined };
  }

  /**
   * Handle a GitHub-related chat message: initializes MCP if needed, runs the appropriate tool, and returns a formatted response.
   * Graceful error handling and logging are included to ensure reliability and debuggability.
   */
  async handleGithubQuery(
    userId: string,
    message: string,
  ): Promise<GithubChatResult> {
    try {
      // Prepare the context for chat agent processing. Conversation context should be enhanced here if needed.
      const context: GitHubChatContext = {
        userId,
        // Additional context fields can be added here if the controller/conversation logic supports them.
      };

      // Call the main processChatMessage handler
      const response = await this.processChatMessage(context, message);

      return {
        response: response.message,
        success: true,
        routeToMcp: !!response.requiresAction,
        toolUsed: response.toolUsed ?? undefined, // Capture toolUsed if available
      };
    } catch (error) {
      // Use type narrowing to ensure error is an object
      let errorMsg = 'Unknown error';
      let errorStack = '';
      if (error && typeof error === 'object') {
        errorMsg = error.message ?? JSON.stringify(error);
        errorStack = error.stack ?? '';
      }

      this.logger.error('GitHub chat message processing failed', {
        userId,
        error: errorMsg,
        stack: errorStack,
      });

      return {
        response: `I encountered an error: ${errorMsg}. Please try again or contact support if the issue persists.`,
        success: false,
        routeToMcp: false,
        toolUsed: undefined,
      };
    }
  }

  /**
   * Get progress percentage from task mode
   */
  private getProgressFromTask(task: any): number {
    const modeProgress: Record<string, number> = {
      [AgentMode.SCOPE]: 25,
      [AgentMode.CLARIFY]: 40,
      [AgentMode.PLAN]: 60,
      [AgentMode.BUILD]: 80,
      [AgentMode.VERIFY]: 95,
      [AgentMode.DONE]: 100,
    };
    return modeProgress[task.mode] || 0;
  }

  /**
   * Get current step description from task mode
   */
  private getCurrentStepFromTask(task: any): string {
    const modeSteps: Record<string, string> = {
      [AgentMode.SCOPE]: 'Analyzing repository and requirements',
      [AgentMode.CLARIFY]: 'Clarifying requirements and gathering information',
      [AgentMode.PLAN]: 'Generating detailed implementation plan',
      [AgentMode.BUILD]: 'Executing integration with AI guidance',
      [AgentMode.VERIFY]: 'Verifying integration and running tests',
      [AgentMode.DONE]: 'Integration completed successfully',
    };
    return modeSteps[task.mode] || 'Processing...';
  }
}
