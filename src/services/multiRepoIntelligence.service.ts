import { IGitHubConnection } from '../models';
import { MultiRepoIndex, IMultiRepoIndex, RepoMetadata, SharedUtilityReference, CrossRepoDependency } from '../models/MultiRepoIndex';
import { GitHubService } from './github.service';
import { GitHubChatAgentService, CodebaseIndex } from './githubChatAgent.service';
import { TreeSitterService, ASTAnalysis } from './treeSitter.service';
import { VectorStoreService } from './vectorStore.service';
import { SymbolJumpService } from './symbolJump.service';
import { loggingService } from './logging.service';

export interface SharedUtility {
    name: string;
    filePath: string;
    repoFullName: string;
    type: 'function' | 'class' | 'module' | 'utility';
    signature?: string;
    usedInRepos: string[];
    similarityScore: number;
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

/**
 * Multi-Repository Intelligence Service
 * Provides cross-repo analysis and recommendations
 */
export class MultiRepoIntelligenceService {
    private static readonly UTILITY_DIRECTORIES = ['utils', 'shared', 'lib', 'common', 'helpers', 'utilities'];

    /**
     * Index all user repositories and build cross-repo knowledge graph
     */
    static async indexUserRepositories(
        connection: IGitHubConnection & { decryptToken: () => string },
        userId: string
    ): Promise<IMultiRepoIndex> {
        try {
            loggingService.info('Starting multi-repo indexing', { userId });

            // Get all user repositories
            const repositories = await GitHubService.listUserRepositories(connection);
            
            // Get or create multi-repo index
            let multiRepoIndex = await MultiRepoIndex.findOne({ userId });
            
            if (!multiRepoIndex) {
                multiRepoIndex = new MultiRepoIndex({
                    userId,
                    repositories: [],
                    sharedUtilities: [],
                    crossRepoDependencies: [],
                    lastSyncedAt: new Date()
                });
            }

            // Update repository metadata
            const repoMetadata: RepoMetadata[] = [];
            for (const repo of repositories) {
                const [owner, name] = repo.fullName.split('/');
                
                // Get latest commit SHA
                let commitSha: string | undefined;
                try {
                    const octokit = await GitHubService['getOctokitFromConnection'](connection) as {
                        rest: {
                            repos: {
                                listCommits: (params: { owner: string; repo: string; per_page: number }) => Promise<{
                                    data: Array<{ sha?: string }>;
                                }>;
                            };
                        };
                    };
                    const { data: commits } = await octokit.rest.repos.listCommits({
                        owner,
                        repo: name,
                        per_page: 1
                    });
                    commitSha = commits[0]?.sha;
                } catch (error) {
                    loggingService.warn('Failed to get commit SHA', {
                        repo: repo.fullName,
                        error: error instanceof Error ? error.message : 'Unknown'
                    });
                }

                repoMetadata.push({
                    fullName: repo.fullName,
                    owner,
                    name,
                    language: repo.language,
                    lastIndexedAt: new Date(),
                    commitSha,
                    branch: repo.defaultBranch || 'main'
                });
            }

            multiRepoIndex.repositories = repoMetadata;

            // Find shared utilities
            const sharedUtilities = await this.findSharedUtilities(
                connection,
                repositories.map(r => r.fullName)
            );
            multiRepoIndex.sharedUtilities = sharedUtilities;

            // Build dependency graph
            const dependencies = await this.buildDependencyGraph(
                connection,
                repositories.map(r => r.fullName)
            );
            multiRepoIndex.crossRepoDependencies = dependencies;

            multiRepoIndex.lastSyncedAt = new Date();
            await multiRepoIndex.save();

            loggingService.info('Multi-repo indexing completed', {
                userId,
                repoCount: repositories.length,
                sharedUtilitiesCount: sharedUtilities.length,
                dependenciesCount: dependencies.length
            });

            return multiRepoIndex;
        } catch (error) {
            loggingService.error('Multi-repo indexing failed', {
                userId,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error;
        }
    }

    /**
     * Find shared utilities across repositories
     */
    static async findSharedUtilities(
        connection: IGitHubConnection & { decryptToken: () => string },
        repoFullNames: string[]
    ): Promise<SharedUtilityReference[]> {
        const sharedUtilities: SharedUtilityReference[] = [];
        const utilityMap = new Map<string, Array<{ repo: string; filePath: string; ast: ASTAnalysis }>>();

        loggingService.info('Finding shared utilities', { repoCount: repoFullNames.length });

        // Scan each repository for utilities
        for (const repoFullName of repoFullNames) {
            try {
                const [owner, repo] = repoFullName.split('/');
                
                // Build codebase index
                const codebaseIndex = await GitHubChatAgentService['buildCodebaseIndex'](
                    connection,
                    owner,
                    repo
                );

                // Find utility files
                const utilityFiles = codebaseIndex.structure.sourceFiles.filter(filePath =>
                    this.UTILITY_DIRECTORIES.some(dir => filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`))
                );

                // Parse utility files with Tree-Sitter
                for (const filePath of utilityFiles.slice(0, 20)) { // Limit to 20 files per repo
                    try {
                        const fileInfo = codebaseIndex.files.find(f => f.path === filePath);
                        if (!fileInfo?.language) continue;

                        const content = await GitHubChatAgentService['getFileContentWithCache'](
                            connection,
                            owner,
                            repo,
                            filePath,
                            codebaseIndex.summary.packageManager === 'npm' ? 'main' : 'master'
                        );

                        if (!content) continue;

                        const ast = TreeSitterService.parseCode(content, fileInfo.language, filePath);

                        // Extract functions and classes as potential utilities
                        for (const func of ast.functions) {
                            const key = `function:${func.name}`;
                            if (!utilityMap.has(key)) {
                                utilityMap.set(key, []);
                            }
                            const existing = utilityMap.get(key);
                            if (existing) {
                                existing.push({ repo: repoFullName, filePath, ast });
                            }
                        }

                        for (const cls of ast.classes) {
                            const key = `class:${cls.name}`;
                            if (!utilityMap.has(key)) {
                                utilityMap.set(key, []);
                            }
                            const existing = utilityMap.get(key);
                            if (existing) {
                                existing.push({ repo: repoFullName, filePath, ast });
                            }
                        }
                    } catch (error) {
                        loggingService.warn('Failed to parse utility file', {
                            repo: repoFullName,
                            filePath,
                            error: error instanceof Error ? error.message : 'Unknown'
                        });
                    }
                }
            } catch (error) {
                loggingService.warn('Failed to scan repository for utilities', {
                    repo: repoFullName,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
            }
        }

        // Find utilities used in multiple repos
        for (const [key, occurrences] of utilityMap.entries()) {
            if (occurrences.length > 1) {
                const [type, name] = key.split(':');
                const repos = [...new Set(occurrences.map(o => o.repo))];

                // Calculate similarity score (simplified - based on signature similarity)
                let similarityScore = 0.8; // Default for same name
                
                if (occurrences.length > 2) {
                    // Multiple occurrences increase confidence
                    similarityScore = Math.min(0.95, 0.7 + (occurrences.length - 2) * 0.1);
                }

                // Get signature from first occurrence
                const firstOccurrence = occurrences[0];
                const ast = firstOccurrence.ast;
                let signature: string | undefined;
                
                if (type === 'function') {
                    const func = ast.functions.find(f => f.name === name);
                    if (func) {
                        signature = `${func.name}(${func.parameters.join(', ')})`;
                    }
                } else if (type === 'class') {
                    const cls = ast.classes.find(c => c.name === name);
                    if (cls) {
                        signature = `class ${cls.name}`;
                    }
                }

                sharedUtilities.push({
                    name,
                    filePath: firstOccurrence.filePath,
                    repoFullName: firstOccurrence.repo,
                    type: type as 'function' | 'class' | 'module' | 'utility',
                    signature,
                    usedInRepos: repos,
                    similarityScore
                });
            }
        }

        loggingService.info('Shared utilities found', {
            count: sharedUtilities.length,
            utilities: sharedUtilities.map(u => u.name)
        });

        return sharedUtilities;
    }

    /**
     * Build dependency graph across repositories
     */
    static async buildDependencyGraph(
        connection: IGitHubConnection & { decryptToken: () => string },
        repoFullNames: string[]
    ): Promise<CrossRepoDependency[]> {
        const dependencies: CrossRepoDependency[] = [];
        const packageMap = new Map<string, Set<string>>(); // package -> repos using it

        loggingService.info('Building dependency graph', { repoCount: repoFullNames.length });

        // Scan each repository for dependencies
        for (const repoFullName of repoFullNames) {
            try {
                const [owner, repo] = repoFullName.split('/');
                
                // Get package.json, requirements.txt, go.mod, etc.
                const configFiles = [
                    'package.json',
                    'requirements.txt',
                    'go.mod',
                    'Cargo.toml',
                    'pom.xml',
                    'build.gradle'
                ];

                for (const configFile of configFiles) {
                    try {
                        const content = await GitHubService.getFileContent(
                            connection,
                            owner,
                            repo,
                            configFile
                        );

                        if (!content) continue;

                        // Parse dependencies based on file type
                        const deps = this.parseDependenciesFromConfig(configFile, content);
                        
                        for (const dep of deps) {
                        if (!packageMap.has(dep)) {
                            packageMap.set(dep, new Set());
                        }
                        const depSet = packageMap.get(dep);
                        if (depSet) {
                            depSet.add(repoFullName);
                        }
                        }
                    } catch (error) {
                        // Config file doesn't exist, skip
                    }
                }

                // Check for monorepo patterns
                const isMonorepo = await this.detectMonorepo(connection, owner, repo);
                if (isMonorepo) {
                    // Add monorepo dependencies
                    for (const otherRepo of repoFullNames) {
                        if (otherRepo !== repoFullName && otherRepo.startsWith(owner + '/')) {
                            dependencies.push({
                                fromRepo: repoFullName,
                                toRepo: otherRepo,
                                type: 'monorepo',
                                dependencyName: otherRepo.split('/')[1]
                            });
                        }
                    }
                }
            } catch (error) {
                loggingService.warn('Failed to scan repository for dependencies', {
                    repo: repoFullName,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
            }
        }

        // Build cross-repo dependencies from shared packages
        for (const [packageName, repos] of packageMap.entries()) {
            if (repos.size > 1) {
                const repoArray = Array.from(repos);
                // Create dependencies between repos using same package
                for (let i = 0; i < repoArray.length; i++) {
                    for (let j = i + 1; j < repoArray.length; j++) {
                        dependencies.push({
                            fromRepo: repoArray[i],
                            toRepo: repoArray[j],
                            type: 'package',
                            dependencyName: packageName
                        });
                    }
                }
            }
        }

        loggingService.info('Dependency graph built', {
            dependencyCount: dependencies.length
        });

        return dependencies;
    }

    /**
     * Parse dependencies from config files
     */
    private static parseDependenciesFromConfig(configFile: string, content: string): string[] {
        const dependencies: string[] = [];

        try {
            if (configFile === 'package.json') {
                const pkg = JSON.parse(content) as {
                    dependencies?: Record<string, string>;
                    devDependencies?: Record<string, string>;
                    peerDependencies?: Record<string, string>;
                };
                const deps = {
                    ...(pkg.dependencies ?? {}),
                    ...(pkg.devDependencies ?? {}),
                    ...(pkg.peerDependencies ?? {})
                };
                dependencies.push(...Object.keys(deps));
            } else if (configFile === 'requirements.txt') {
                const lines = content.split('\n');
                for (const line of lines) {
                    const match = line.match(/^([a-zA-Z0-9_-]+)/);
                    if (match) {
                        dependencies.push(match[1]);
                    }
                }
            } else if (configFile === 'go.mod') {
                const matches = content.matchAll(/require\s+([^\s]+)/g);
                for (const match of matches) {
                    dependencies.push(match[1]);
                }
            } else if (configFile === 'Cargo.toml') {
                const matches = content.matchAll(/\[dependencies\.([^\]]+)\]/g);
                for (const match of matches) {
                    dependencies.push(match[1]);
                }
            }
        } catch (error) {
            loggingService.warn('Failed to parse dependencies', {
                configFile,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }

        return dependencies;
    }

    /**
     * Detect if repository is part of a monorepo
     */
    private static async detectMonorepo(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string
    ): Promise<boolean> {
        try {
            const configFiles = ['lerna.json', 'nx.json', 'turbo.json', 'pnpm-workspace.yaml'];
            
            for (const configFile of configFiles) {
                try {
                    const content = await GitHubService.getFileContent(connection, owner, repo, configFile);
                    if (content) {
                        return true;
                    }
                } catch {
                    // File doesn't exist
                }
            }
        } catch {
            // Error checking, assume not monorepo
        }

        return false;
    }

    /**
     * Find integration points for a feature across user's repositories
     */
    static async findIntegrationPoints(
        userId: string,
        feature: string,
        connection?: IGitHubConnection & { decryptToken: () => string }
    ): Promise<IntegrationPointRecommendation[]> {
        try {
            const multiRepoIndex = await MultiRepoIndex.findOne({ userId });
            if (!multiRepoIndex || multiRepoIndex.repositories.length === 0) {
                return [];
            }

            const recommendations: IntegrationPointRecommendation[] = [];

            // Analyze each repository
            for (const repo of multiRepoIndex.repositories) {
                try {
                    // Build codebase index if connection is available
                    let codebaseIndex: CodebaseIndex | undefined;
                    if (connection) {
                        try {
                            const [owner, name] = repo.fullName.split('/');
                            codebaseIndex = await GitHubChatAgentService['buildCodebaseIndex'](
                                connection,
                                owner,
                                name,
                                repo.branch
                            );
                        } catch (error) {
                            loggingService.warn('Failed to build codebase index for integration points', {
                                repo: repo.fullName,
                                error: error instanceof Error ? error.message : 'Unknown'
                            });
                        }
                    }

                    // Use feature parameter to filter/prioritize repositories
                    const featureLower = feature.toLowerCase();
                    const repoMatchesFeature = 
                        (repo.language?.toLowerCase().includes(featureLower) ?? false) ||
                        (repo.framework?.toLowerCase().includes(featureLower) ?? false) ||
                        repo.fullName.toLowerCase().includes(featureLower) ||
                        multiRepoIndex.sharedUtilities.some(u => 
                            u.repoFullName === repo.fullName && 
                            (u.name.toLowerCase().includes(featureLower) || 
                             u.filePath.toLowerCase().includes(featureLower))
                        );

                    // Find entry points using codebase index if available
                    const entryPoints = this.findEntryPointsForRepo(
                        repo.fullName,
                        codebaseIndex
                    );
                    
                    // Check for existing AI integrations with full analysis
                    const existingIntegrations = await this.findExistingAIIntegrations(
                        repo.fullName,
                        connection,
                        codebaseIndex
                    );

                    // Check for shared utilities that match the feature
                    const sharedUtils = multiRepoIndex.sharedUtilities.filter(
                        u => u.repoFullName === repo.fullName &&
                             (featureLower.length === 0 || 
                              u.name.toLowerCase().includes(featureLower) ||
                              u.filePath.toLowerCase().includes(featureLower))
                    );

                    // Recommend based on patterns and feature relevance
                    if (entryPoints.length > 0) {
                        const bestEntryPoint = entryPoints[0];
                        let confidence = this.calculateConfidence(
                            bestEntryPoint,
                            existingIntegrations,
                            sharedUtils
                        );

                        // Boost confidence if repo matches feature
                        if (repoMatchesFeature) {
                            confidence = Math.min(1.0, confidence + 0.2);
                        }

                        recommendations.push({
                            repoFullName: repo.fullName,
                            filePath: bestEntryPoint,
                            reason: this.generateRecommendationReason(
                                bestEntryPoint,
                                existingIntegrations,
                                sharedUtils,
                                feature
                            ),
                            confidence,
                            existingPatterns: existingIntegrations,
                            relatedRepos: sharedUtils.length > 0 
                                ? sharedUtils[0].usedInRepos.filter(r => r !== repo.fullName)
                                : []
                        });
                    }
                } catch (error) {
                    loggingService.warn('Failed to analyze repo for integration points', {
                        repo: repo.fullName,
                        error: error instanceof Error ? error.message : 'Unknown'
                    });
                }
            }

            // Sort by confidence
            recommendations.sort((a, b) => b.confidence - a.confidence);

            return recommendations.slice(0, 10); // Top 10 recommendations
        } catch (error) {
            loggingService.error('Failed to find integration points', {
                userId,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Find entry points for a repository using codebase index and repoFullName
     */
    private static findEntryPointsForRepo(
        repoFullName: string,
        codebaseIndex?: CodebaseIndex
    ): string[] {
        const entryPoints: string[] = [];

        // If codebase index is provided, use its entry points
        if (codebaseIndex && codebaseIndex.structure.entryPoints.length > 0) {
            // Filter entry points that actually exist in the repo
            const validEntryPoints = codebaseIndex.structure.entryPoints.filter(ep => 
                codebaseIndex.files.some(f => f.path === ep)
            );
            if (validEntryPoints.length > 0) {
                entryPoints.push(...validEntryPoints);
            }
        }

        // Also check for entry points based on repo structure
        if (codebaseIndex) {
            // Look for common entry point patterns in the actual files
            const commonPatterns = ['index', 'main', 'app', 'server', 'entry', 'start'];
            for (const file of codebaseIndex.files) {
                if (file.type === 'file' && file.category === 'source') {
                    const fileName = file.path.split('/').pop()?.toLowerCase() ?? '';
                    const fileNameWithoutExt = fileName.split('.')[0];
                    if (commonPatterns.some(pattern => fileNameWithoutExt.includes(pattern))) {
                        if (!entryPoints.includes(file.path)) {
                            entryPoints.push(file.path);
                        }
                    }
                }
            }
        }

        // Fallback: return common entry point patterns based on repo name
        if (entryPoints.length === 0) {
            const repoNameParts = repoFullName.split('/');
            const repoName = (repoNameParts[1]?.toLowerCase()) ?? '';
            const fallbackPatterns = [
                'src/index.ts',
                'src/main.ts',
                'src/app.ts',
                'index.js',
                'main.js',
                'app.js',
                `${repoName}/index.ts`,
                `${repoName}/main.ts`
            ];
            entryPoints.push(...fallbackPatterns);
        }

        return entryPoints;
    }

    /**
     * Find existing AI integrations in a repository using CodebaseIndex, Tree-Sitter, and VectorStore
     */
    private static async findExistingAIIntegrations(
        repoFullName: string,
        connection?: IGitHubConnection & { decryptToken: () => string },
        codebaseIndex?: CodebaseIndex
    ): Promise<string[]> {
        const integrations: Set<string> = new Set();
        const aiProviderPatterns = {
            openai: ['openai', 'OpenAI', 'gpt-3', 'gpt-4', 'chatgpt'],
            anthropic: ['anthropic', 'claude', '@anthropic-ai/sdk'],
            google: ['google.generativeai', 'vertexai', '@google-ai/generativelanguage'],
            aws: ['@aws-sdk/client-bedrock', 'BedrockRuntime', 'boto3', 'bedrock'],
            cohere: ['cohere', '@cohere-ai/sdk'],
            mistral: ['mistral', '@mistralai/mistralai'],
            huggingface: ['@huggingface/inference', 'transformers', 'huggingface']
        };

        try {
            // If codebase index is provided, use it directly
            let index = codebaseIndex;
            
            // If not provided and connection is available, build it
            if (!index && connection) {
                const [owner, repo] = repoFullName.split('/');
                index = await GitHubChatAgentService['buildCodebaseIndex'](
                    connection,
                    owner,
                    repo
                );
            }

            if (!index) {
                loggingService.warn('Cannot find AI integrations - no codebase index available', {
                    repoFullName
                });
                return [];
            }

            // Method 1: Use Tree-Sitter AST to find AI imports
            if (index.astMetadata) {
                for (const [filePath, ast] of index.astMetadata.entries()) {
                    // Check imports for AI providers
                    for (const imp of ast.imports) {
                        const importSource = imp.source.toLowerCase();
                        for (const [provider, keywords] of Object.entries(aiProviderPatterns)) {
                            if (keywords.some(keyword => importSource.includes(keyword.toLowerCase()))) {
                                integrations.add(provider);
                                loggingService.debug('AI integration found via AST import', {
                                    repoFullName,
                                    provider,
                                    filePath,
                                    importSource: imp.source
                                });
                            }
                        }
                    }

                    // Check for AI-related function/class names
                    for (const func of ast.functions) {
                        const funcName = func.name.toLowerCase();
                        if (funcName.includes('ai') || funcName.includes('llm') || 
                            funcName.includes('gpt') || funcName.includes('claude') ||
                            funcName.includes('bedrock') || funcName.includes('anthropic')) {
                            // Try to find which provider by checking imports in same file
                            for (const imp of ast.imports) {
                                const importSource = imp.source.toLowerCase();
                                for (const [provider, keywords] of Object.entries(aiProviderPatterns)) {
                                    if (keywords.some(keyword => importSource.includes(keyword.toLowerCase()))) {
                                        integrations.add(provider);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Method 2: Use SymbolJumpService to find AI-related symbols
            if (index.symbolTable) {
                const aiSymbols = ['openai', 'anthropic', 'claude', 'gpt', 'bedrock', 'cohere', 'mistral', 'huggingface'];
                
                // Use SymbolJumpService to find definitions
                for (const symbolName of aiSymbols) {
                    try {
                        const definition = await SymbolJumpService.findSymbolDefinition(
                            symbolName,
                            index
                        );
                        
                        if (definition) {
                            // Determine provider from symbol name
                            const nameLower = symbolName.toLowerCase();
                            if (nameLower.includes('openai') || nameLower.includes('gpt')) {
                                integrations.add('openai');
                            } else if (nameLower.includes('anthropic') || nameLower.includes('claude')) {
                                integrations.add('anthropic');
                            } else if (nameLower.includes('bedrock') || nameLower.includes('aws')) {
                                integrations.add('aws');
                            } else if (nameLower.includes('cohere')) {
                                integrations.add('cohere');
                            } else if (nameLower.includes('mistral')) {
                                integrations.add('mistral');
                            } else if (nameLower.includes('huggingface')) {
                                integrations.add('huggingface');
                            }
                            
                            loggingService.debug('AI integration found via SymbolJumpService', {
                                repoFullName,
                                symbolName,
                                filePath: definition.filePath,
                                line: definition.line
                            });
                        }
                    } catch (error) {
                        // Symbol not found, continue
                    }
                }

                // Also check symbol table directly for partial matches
                for (const [symbolName] of index.symbolTable.entries()) {
                    const nameLower = symbolName.toLowerCase();
                    if (nameLower.includes('ai') || nameLower.includes('llm') || 
                        nameLower.includes('gpt') || nameLower.includes('claude') ||
                        nameLower.includes('bedrock') || nameLower.includes('anthropic')) {
                        // Determine provider from symbol name
                        if (nameLower.includes('openai') || nameLower.includes('gpt')) {
                            integrations.add('openai');
                        } else if (nameLower.includes('anthropic') || nameLower.includes('claude')) {
                            integrations.add('anthropic');
                        } else if (nameLower.includes('bedrock') || nameLower.includes('aws')) {
                            integrations.add('aws');
                        } else if (nameLower.includes('cohere')) {
                            integrations.add('cohere');
                        } else if (nameLower.includes('mistral')) {
                            integrations.add('mistral');
                        }
                    }
                }
            }

            // Method 3: Use VectorStoreService for semantic search
            try {
                const vectorStore = new VectorStoreService();
                await vectorStore.initialize();

                // Search for AI-related code snippets
                const aiQueries = [
                    'openai API integration',
                    'anthropic claude API',
                    'AWS Bedrock integration',
                    'Google AI API',
                    'Cohere API',
                    'Mistral AI'
                ];

                for (const query of aiQueries) {
                    const results = await vectorStore.searchCodeSnippets(
                        query,
                        { repo: repoFullName },
                        5
                    );

                    for (const result of results) {
                        // Type-safe access to pageContent
                        const pageContent: unknown = (result as { pageContent?: unknown }).pageContent;
                        const content = (typeof pageContent === 'string' ? pageContent : String(pageContent ?? '')).toLowerCase();
                        for (const [provider, keywords] of Object.entries(aiProviderPatterns)) {
                            if (keywords.some(keyword => content.includes(keyword.toLowerCase()))) {
                                integrations.add(provider);
                            }
                        }
                    }
                }
            } catch (error) {
                loggingService.warn('Vector search for AI integrations failed', {
                    repoFullName,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
            }

            // Method 4: Check dependency graph for AI packages
            if (index.dependencyGraph) {
                for (const edge of index.dependencyGraph) {
                    const depName = edge.to.toLowerCase();
                    for (const [provider, keywords] of Object.entries(aiProviderPatterns)) {
                        if (keywords.some(keyword => depName.includes(keyword.toLowerCase()))) {
                            integrations.add(provider);
                        }
                    }
                }
            }

            // Method 5: Check config files for AI dependencies
            if (index.structure.configFiles) {
                for (const configFile of index.structure.configFiles.slice(0, 10)) {
                    if (configFile.includes('package.json') || configFile.includes('requirements.txt') ||
                        configFile.includes('go.mod') || configFile.includes('Cargo.toml')) {
                        try {
                            if (connection) {
                                const [owner, repo] = repoFullName.split('/');
                                const content = await GitHubService.getFileContent(
                                    connection,
                                    owner,
                                    repo,
                                    configFile
                                );

                                if (content) {
                                    const contentLower = content.toLowerCase();
                                    for (const [provider, keywords] of Object.entries(aiProviderPatterns)) {
                                        if (keywords.some(keyword => contentLower.includes(keyword.toLowerCase()))) {
                                            integrations.add(provider);
                                        }
                                    }
                                }
                            }
                        } catch (error) {
                            // Config file not accessible, skip
                        }
                    }
                }
            }

            // Method 6: Check multi-repo index for shared AI utilities
            if (connection) {
                try {
                    const userId = connection.userId;
                    const multiRepoIndex = await MultiRepoIndex.findOne({ userId });
                    if (multiRepoIndex) {
                        // Find shared utilities that might be AI-related
                        const aiUtilities = multiRepoIndex.sharedUtilities.filter(util => {
                            const nameLower = util.name.toLowerCase();
                            const pathLower = util.filePath.toLowerCase();
                            return nameLower.includes('ai') || nameLower.includes('llm') ||
                                   nameLower.includes('gpt') || nameLower.includes('claude') ||
                                   pathLower.includes('ai') || pathLower.includes('llm');
                        });

                        // If shared AI utilities exist in this repo, it likely has AI integration
                        const repoHasAIUtils = aiUtilities.some(util => util.repoFullName === repoFullName);
                        if (repoHasAIUtils) {
                            // Try to determine provider from utility names
                            for (const util of aiUtilities) {
                                const nameLower = util.name.toLowerCase();
                                if (nameLower.includes('openai') || nameLower.includes('gpt')) {
                                    integrations.add('openai');
                                } else if (nameLower.includes('anthropic') || nameLower.includes('claude')) {
                                    integrations.add('anthropic');
                                } else if (nameLower.includes('bedrock')) {
                                    integrations.add('aws');
                                }
                            }
                        }
                    }
                } catch (error) {
                    loggingService.warn('Failed to check multi-repo index for AI integrations', {
                        repoFullName,
                        error: error instanceof Error ? error.message : 'Unknown'
                    });
                }
            }

            const integrationList = Array.from(integrations);
            loggingService.info('AI integrations found', {
                repoFullName,
                integrations: integrationList,
                count: integrationList.length
            });

            return integrationList;
        } catch (error) {
            loggingService.error('Failed to find existing AI integrations', {
                repoFullName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Calculate confidence score for integration point
     */
    private static calculateConfidence(
        entryPoint: string,
        existingIntegrations: string[],
        sharedUtils: SharedUtilityReference[]
    ): number {
        let confidence = 0.5; // Base confidence

        // Higher confidence if entry point is in common location
        if (entryPoint.includes('index') || entryPoint.includes('main') || entryPoint.includes('app')) {
            confidence += 0.2;
        }

        // Higher confidence if shared utilities exist
        if (sharedUtils.length > 0) {
            confidence += 0.2;
        }

        // Lower confidence if many existing integrations (might be cluttered)
        if (existingIntegrations.length > 3) {
            confidence -= 0.1;
        }

        return Math.min(1.0, Math.max(0.0, confidence));
    }

    /**
     * Generate recommendation reason
     */
    private static generateRecommendationReason(
        entryPoint: string,
        existingIntegrations: string[],
        sharedUtils: SharedUtilityReference[],
        feature?: string
    ): string {
        const reasons: string[] = [];

        if (entryPoint.includes('index') || entryPoint.includes('main')) {
            reasons.push('Primary entry point');
        }

        if (sharedUtils.length > 0) {
            const usedInCount = sharedUtils[0].usedInRepos.length;
            reasons.push(`Shared utility pattern (used in ${usedInCount} repos)`);
        }

        if (existingIntegrations.length === 0) {
            reasons.push('No existing AI integrations');
        }

        if (feature && feature.length > 0) {
            reasons.push(`Feature-specific: ${feature}`);
        }

        return reasons.join('. ') || 'Standard integration point';
    }

    /**
     * Reindex a specific repository
     */
    static async reindexRepository(
        connection: IGitHubConnection & { decryptToken: () => string },
        repoFullName: string,
        branch?: string
    ): Promise<void> {
        try {
            const [owner, repo] = repoFullName.split('/');
            
            // Rebuild codebase index
            await GitHubChatAgentService['buildCodebaseIndex'](
                connection,
                owner,
                repo,
                branch
            );

            // Update multi-repo index if exists
            const userId = connection.userId;
            const multiRepoIndex = await MultiRepoIndex.findOne({ userId });
            if (multiRepoIndex) {
                const repoMeta = multiRepoIndex.repositories.find(r => r.fullName === repoFullName);
                if (repoMeta) {
                    repoMeta.lastIndexedAt = new Date();
                    await multiRepoIndex.save();
                }
            }

            loggingService.info('Repository reindexed', { repoFullName });
        } catch (error) {
            loggingService.error('Repository reindexing failed', {
                repoFullName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error;
        }
    }

    /**
     * Schedule reindexing for a repository (for queue processing)
     */
    static async scheduleReindex(
        repoFullName: string,
        userId?: string,
        connectionId?: string,
        branch?: string,
        priority: 'high' | 'medium' | 'low' = 'medium'
    ): Promise<void> {
        try {
            if (!userId || !connectionId) {
                loggingService.warn('Cannot schedule reindex - missing userId or connectionId', {
                    repoFullName
                });
                return;
            }

            const { ReindexQueue } = await import('../queues/reindex.queue');
            await ReindexQueue.addReindexJob({
                repoFullName,
                branch,
                userId,
                connectionId,
                priority
            });

            loggingService.info('Reindex scheduled', {
                repoFullName,
                priority
            });
        } catch (error) {
            loggingService.error('Failed to schedule reindex', {
                repoFullName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }
}
