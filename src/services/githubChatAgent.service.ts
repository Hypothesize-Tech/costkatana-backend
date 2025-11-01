import { TracedBedrockService as BedrockService } from './tracedBedrock.service';
import { GitHubIntegrationService } from './githubIntegration.service';
import { GitHubConnection, GitHubIntegration, Conversation, IGitHubContext, IGitHubConnection } from '../models';
import { loggingService } from './logging.service';
import { GitHubService } from './github.service';
import { VectorStoreService } from './vectorStore.service';
import * as fs from 'fs';
import * as path from 'path';

export interface GitHubChatContext {
    conversationId?: string;
    githubContext?: IGitHubContext;
    userId: string;
}

export interface GitHubCommand {
    action: 'start_integration' | 'update_pr' | 'check_status' | 'list_repos' | 'connect' | 'make_changes' | 'help';
    parameters?: Record<string, any>;
}

export interface GitHubChatResponse {
    message: string;
    data?: any;
    suggestions?: string[];
    requiresAction?: boolean;
    action?: GitHubCommand;
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
}

export class GitHubChatAgentService {
    // Caching for examples
    private static examplesCache: Map<string, { content: string; path: string; category: string }[]> = new Map();
    private static examplesCacheTime: number = 0;
    private static readonly EXAMPLES_CACHE_TTL = 600000; // 10 minutes
    
    // Caching for codebase indexes (Cursor-like local indexing)
    private static codebaseIndexCache: Map<string, { index: CodebaseIndex; timestamp: number }> = new Map();
    private static readonly CODEBASE_CACHE_TTL = 3600000; // 1 hour
    
    // Caching for file contents
    private static fileContentCache: Map<string, { content: string; timestamp: number }> = new Map();
    private static readonly FILE_CACHE_TTL = 1800000; // 30 minutes
    
    // Rate limiting state
    private static rateLimitState: Map<string, { count: number; resetTime: number }> = new Map();
    private static readonly MAX_REQUESTS_PER_MINUTE = 60;

    /**
     * Load costkatana-examples as knowledge base from GitHub repository
     */
    private static async loadCostKatanaExamples(): Promise<Array<{ content: string; path: string; category: string }>> {
        const now = Date.now();
        
        // Return cached if still valid
        if (this.examplesCache.has('all') && (now - this.examplesCacheTime) < this.EXAMPLES_CACHE_TTL) {
            return this.examplesCache.get('all') ?? [];
        }

        const examples: Array<{ content: string; path: string; category: string }> = [];
        
        try {
            const owner = 'Hypothesize-Tech';
            const repo = 'costkatana-examples';
            const branch = 'master'; // or 'master', adjust if needed
            
            loggingService.info('Loading costkatana-examples from GitHub', {
                repository: `${owner}/${repo}`,
                branch
            });

            // First, try to load from local filesystem (for development)
            const examplesPath = path.resolve(__dirname, '../../../costkatana-examples');
            if (fs.existsSync(examplesPath)) {
                loggingService.info('Found local costkatana-examples, loading from filesystem');
                
                const loadDirectory = (dirPath: string, category: string = ''): void => {
                    try {
                        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                        
                        for (const entry of entries) {
                            const fullPath = path.join(dirPath, entry.name);
                            
                            if (entry.isDirectory()) {
                                const newCategory = category ? `${category}/${entry.name}` : entry.name;
                                loadDirectory(fullPath, newCategory);
                            } else if (entry.isFile()) {
                                const ext = path.extname(entry.name);
                                if (['.ts', '.js', '.py', '.md', '.json', '.tsx', '.jsx'].includes(ext)) {
                                    try {
                                        const content = fs.readFileSync(fullPath, 'utf-8');
                                        const relativePath = path.relative(examplesPath, fullPath);
                                        
                                        examples.push({
                                            content,
                                            path: relativePath,
                                            category: category || 'general'
                                        });
                                    } catch (error) {
                                        loggingService.warn('Failed to read example file', {
                                            path: fullPath,
                                            error: error instanceof Error ? error.message : 'Unknown'
                                        });
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        loggingService.warn('Failed to load examples directory', {
                            path: dirPath,
                            error: error instanceof Error ? error.message : 'Unknown'
                        });
                    }
                };

                loadDirectory(examplesPath);
                
                if (examples.length > 0) {
                    this.examplesCache.set('all', examples);
                    this.examplesCacheTime = now;
                    return examples;
                }
            }

            // Fallback to GitHub API
            loggingService.info('Loading costkatana-examples from GitHub API');
            
            // Get the tree recursively using GitHub API
            const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
            
            const treeResponse = await fetch(treeUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'CostKatana-Backend'
                }
            });

            if (!treeResponse.ok) {
                throw new Error(`GitHub API error: ${treeResponse.status} ${treeResponse.statusText}`);
            }

            const treeData = await treeResponse.json() as { tree: Array<{ path: string; type: 'blob' | 'tree'; sha: string; size?: number }> };
            
            // Filter for relevant file types
            const allowedExtensions = ['.ts', '.js', '.py', '.md', '.json', '.tsx', '.jsx'];
            const filePaths = treeData.tree
                .filter(item => item.type === 'blob' && allowedExtensions.some(ext => item.path.endsWith(ext)))
                .map(item => item.path);

            loggingService.info('Found example files in GitHub repository', {
                count: filePaths.length
            });

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
                                'Accept': 'text/plain',
                                'User-Agent': 'CostKatana-Backend'
                            }
                        });

                        if (!contentResponse.ok) {
                            loggingService.warn('Failed to fetch file content', {
                                path: filePath,
                                status: contentResponse.status
                            });
                            return null;
                        }

                        const content = await contentResponse.text();
                        
                        // Extract category from path (directory structure)
                        const pathParts = filePath.split('/');
                        const category = pathParts.length > 1 
                            ? pathParts.slice(0, -1).join('/') 
                            : 'general';

                        return {
                            content,
                            path: filePath,
                            category
                        };
                    } catch (error) {
                        loggingService.warn('Error fetching example file', {
                            path: filePath,
                            error: error instanceof Error ? error.message : 'Unknown'
                        });
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
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            // Cache the results
            this.examplesCache.set('all', examples);
            this.examplesCacheTime = now;
            
            loggingService.info('Loaded costkatana-examples from GitHub', {
                count: examples.length,
                categories: [...new Set(examples.map(e => e.category))],
                source: 'github'
            });
        } catch (error) {
            loggingService.error('Failed to load costkatana-examples from GitHub', {
                error: error instanceof Error ? error.message : 'Unknown',
                stack: error instanceof Error ? error.stack : undefined
            });
            
            // Return cached version if available, even if expired
            const cached = this.examplesCache.get('all');
            if (cached) {
                loggingService.warn('Using expired cache due to fetch failure');
                return cached;
            }
        }
        
        return examples;
    }

    /**
     * Find relevant examples based on user request and codebase context
     */
    private static async findRelevantExamples(
        userRequest: string,
        codebaseIndex?: CodebaseIndex
    ): Promise<Array<{ content: string; path: string; category: string }>> {
        const allExamples = await this.loadCostKatanaExamples();
        
        if (allExamples.length === 0) {
            return [];
        }

        // Use AI to find relevant examples
        const examplesSummary = allExamples.slice(0, 50).map(e => ({
            path: e.path,
            category: e.category,
            preview: e.content.substring(0, 200)
        }));

        const searchPrompt = `Find relevant CostKatana integration examples for this request:

User Request: ${userRequest}

Codebase Context:
${codebaseIndex ? `
- Languages: ${codebaseIndex.summary.languages.join(', ')}
- Framework: ${codebaseIndex.summary.framework || 'Unknown'}
- Package Manager: ${codebaseIndex.summary.packageManager || 'Unknown'}
` : ''}

Available Examples:
${JSON.stringify(examplesSummary, null, 2)}

Return a JSON array of example file paths that are most relevant:
{
  "relevantExamples": ["path/to/example1.ts", "path/to/example2.py", ...]
}`;

        try {
            const response = await BedrockService.invokeModel(
                searchPrompt,
                'amazon.nova-pro-v1:0',
                { useSystemPrompt: false }
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]) as { relevantExamples?: string[] };
                const relevantPaths = result.relevantExamples || [];
                
                // Get full content of relevant examples
                const relevant = allExamples.filter(e => relevantPaths.includes(e.path));
                return relevant.slice(0, 10); // Limit to 10 examples
            }
        } catch (error) {
            loggingService.warn('Failed to find relevant examples, using keyword matching', {
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }

        // Fallback: keyword-based matching
        const lowerRequest = userRequest.toLowerCase();
        const keywords = lowerRequest.split(/\s+/).filter(w => w.length > 3);
        
        return allExamples
            .filter(example => {
                const content = example.content.toLowerCase();
                const pathLower = example.path.toLowerCase();
                return keywords.some(keyword => 
                    content.includes(keyword) || pathLower.includes(keyword)
                );
            })
            .slice(0, 10);
    }

    /**
     * Find semantically relevant files using embeddings (Cursor-like semantic search)
     */
    private static async findSemanticallyRelevantFiles(
        userRequest: string,
        codebaseIndex: CodebaseIndex
    ): Promise<string[]> {
        try {
            // Use vector store for semantic search
            const vectorStoreService = new VectorStoreService();
            await vectorStoreService.initialize();
            
            // Create semantic search query from file paths and user request
            const searchQuery = `${userRequest}. Codebase files: ${codebaseIndex.structure.sourceFiles.slice(0, 50).join(', ')}`;
            
            // Search for relevant code snippets
            const results = await vectorStoreService.search(searchQuery, 20);
            
            // Extract file paths from results
            const relevantPaths = results
                .map(r => r.metadata?.source || r.metadata?.filePath)
                .filter((path): path is string => typeof path === 'string')
                .filter(path => codebaseIndex.files.some(f => f.path === path));
            
            // If vector search found results, return them
            if (relevantPaths.length > 0) {
                return relevantPaths;
            }
        } catch (error) {
            loggingService.warn('Semantic search failed, using fallback', {
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
        
        // Fallback: AI-powered relevance detection
        try {
            const fileList = codebaseIndex.structure.sourceFiles.slice(0, 100)
                .map(f => ({ path: f, category: codebaseIndex.files.find(cf => cf.path === f)?.category || 'unknown' }));
            
            const relevancePrompt = `Analyze this code change request and identify which files are most relevant:

User Request: ${userRequest}

Available Files:
${JSON.stringify(fileList, null, 2)}

Return a JSON object with the most relevant file paths (top 20):
{
  "relevantFiles": ["path/to/file1", "path/to/file2", ...]
}`;

            const response = await BedrockService.invokeModel(
                relevancePrompt,
                'anthropic.claude-opus-4-1-20250805-v1:0',
                { useSystemPrompt: false }
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]) as { relevantFiles?: string[] };
                return result.relevantFiles || [];
            }
        } catch (error) {
            loggingService.warn('AI relevance detection failed', {
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
        
        // Final fallback: return entry points and some source files
        return [
            ...codebaseIndex.structure.entryPoints,
            ...codebaseIndex.structure.sourceFiles.slice(0, 20)
        ];
    }

    /**
     * Analyze code structure (AST-like analysis) for key files
     */
    private static analyzeCodeStructure(
        files: Record<string, string>,
        codebaseIndex: CodebaseIndex
    ): Record<string, string> {
        const structure: Record<string, string> = {};
        
        for (const [path, content] of Object.entries(files)) {
            const fileInfo = codebaseIndex.files.find(f => f.path === path);
            if (!fileInfo || fileInfo.type !== 'file') continue;
            
            try {
                // Extract key structural elements (AST-like parsing via regex for speed)
                const language = fileInfo.language || '';
                let structureInfo = '';
                
                if (language === 'typescript' || language === 'javascript') {
                    // Extract functions, classes, exports
                    const functions = (content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g) || []).length;
                    const classes = (content.match(/class\s+\w+/g) || []).length;
                    const imports = (content.match(/import\s+.*from/g) || []).length;
                    const exports = (content.match(/export\s+(?:const|function|class|default)/g) || []).length;
                    
                    structureInfo = `${functions} functions, ${classes} classes, ${imports} imports, ${exports} exports`;
                } else if (language === 'python') {
                    const functions = (content.match(/def\s+\w+/g) || []).length;
                    const classes = (content.match(/class\s+\w+/g) || []).length;
                    const imports = (content.match(/^import\s+|^from\s+/gm) || []).length;
                    
                    structureInfo = `${functions} functions, ${classes} classes, ${imports} imports`;
                }
                
                if (structureInfo) {
                    structure[path] = structureInfo;
                }
            } catch (error) {
                // Skip if analysis fails
            }
        }
        
        return structure;
    }

    /**
     * Check rate limit and throttle if needed
     */
    private static async checkRateLimit(key: string): Promise<void> {
        const now = Date.now();
        const state = this.rateLimitState.get(key);
        
        if (!state || now > state.resetTime) {
            // Reset or initialize
            this.rateLimitState.set(key, {
                count: 1,
                resetTime: now + 60000 // 1 minute window
            });
            return;
        }
        
        if (state.count >= this.MAX_REQUESTS_PER_MINUTE) {
            // Rate limit exceeded, wait
            const waitTime = state.resetTime - now;
            if (waitTime > 0) {
                loggingService.warn('Rate limit reached, throttling', { key, waitTime });
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            // Reset
            this.rateLimitState.set(key, {
                count: 1,
                resetTime: Date.now() + 60000
            });
        } else {
            state.count++;
        }
    }

    /**
     * Get cached file content or fetch and cache
     */
    private static async getFileContentWithCache(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        filePath: string,
        ref: string
    ): Promise<string | null> {
        const cacheKey = `${owner}/${repo}/${ref}/${filePath}`;
        const now = Date.now();
        
        // Check cache
        const cached = this.fileContentCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < this.FILE_CACHE_TTL) {
            return cached.content;
        }
        
        // Check rate limit
        await this.checkRateLimit(`${owner}/${repo}`);
        
        // Fetch and cache
        try {
            const content = await GitHubService.getFileContent(connection, owner, repo, filePath, ref);
            this.fileContentCache.set(cacheKey, { content, timestamp: now });
            return content;
        } catch (error) {
            // Don't cache errors, but log them
            loggingService.warn('Failed to fetch file content', {
                filePath,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return null;
        }
    }

    /**
     * Build codebase index for comprehensive understanding (with caching)
     */
    private static async buildCodebaseIndex(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        ref?: string
    ): Promise<CodebaseIndex> {
        const cacheKey = `${owner}/${repo}/${ref || 'default'}`;
        const now = Date.now();
        
        // Check cache
        const cached = this.codebaseIndexCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < this.CODEBASE_CACHE_TTL) {
            loggingService.info('Using cached codebase index', { repository: `${owner}/${repo}` });
            return cached.index;
        }
        
        loggingService.info('Building new codebase index', { repository: `${owner}/${repo}` });
        
        // Get all repository files
        const allFiles = await GitHubService.getAllRepositoryFiles(connection, owner, repo, ref);
        
        // File extensions to categorize
        const sourceExtensions = {
            'javascript': ['.js', '.jsx', '.mjs', '.cjs'],
            'typescript': ['.ts', '.tsx'],
            'python': ['.py', '.pyw'],
            'java': ['.java'],
            'go': ['.go'],
            'rust': ['.rs'],
            'cpp': ['.cpp', '.cc', '.cxx', '.hpp', '.h'],
            'c': ['.c', '.h'],
            'ruby': ['.rb'],
            'php': ['.php'],
            'swift': ['.swift'],
            'kotlin': ['.kt', '.kts']
        };
        
        const configExtensions = ['.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.env', '.gitignore'];
        const testExtensions = ['.test.', '.spec.', '.__test__', '__tests__'];
        const docExtensions = ['.md', '.txt', '.rst', '.adoc'];
        
        const index: CodebaseIndex = {
            files: [],
            structure: {
                sourceFiles: [],
                configFiles: [],
                testFiles: [],
                docFiles: [],
                entryPoints: []
            },
            summary: {
                totalFiles: 0,
                sourceCount: 0,
                languages: [],
                framework: undefined,
                packageManager: undefined
            }
        };
        
        const detectedLanguages = new Set<string>();
        const entryPointPatterns = [
            'index', 'main', 'app', 'server', 'entry', 'start',
            'package.json', 'requirements.txt', 'setup.py', 'Pipfile', 'pyproject.toml',
            'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle'
        ];
        
        for (const file of allFiles) {
            if (file.type === 'dir') continue;
            
            const path = file.path;
            const fileName = path.substring(path.lastIndexOf('/') + 1);
            
            let category: 'source' | 'config' | 'test' | 'doc' | 'other' = 'other';
            let language: string | undefined;
            
            // Detect language and category
            for (const [lang, exts] of Object.entries(sourceExtensions)) {
                if (exts.some(ext => path.endsWith(ext))) {
                    category = 'source';
                    language = lang;
                    detectedLanguages.add(lang);
                    index.structure.sourceFiles.push(path);
                    index.summary.sourceCount++;
                    break;
                }
            }
            
            if (!language) {
                if (configExtensions.some(ext => path.endsWith(ext))) {
                    category = 'config';
                    index.structure.configFiles.push(path);
                } else if (testExtensions.some(pattern => path.includes(pattern))) {
                    category = 'test';
                    index.structure.testFiles.push(path);
                } else if (docExtensions.some(ext => path.endsWith(ext))) {
                    category = 'doc';
                    index.structure.docFiles.push(path);
                }
            }
            
            // Detect entry points
            if (entryPointPatterns.some(pattern => 
                fileName.toLowerCase().includes(pattern) || path.includes(pattern)
            )) {
                index.structure.entryPoints.push(path);
            }
            
            index.files.push({
                path,
                size: file.size,
                type: 'file',
                category,
                language
            });
        }
        
        index.summary.totalFiles = index.files.length;
        index.summary.languages = Array.from(detectedLanguages);
        
        // Detect package manager
        if (index.structure.configFiles.some(f => f.includes('package.json'))) {
            index.summary.packageManager = 'npm';
        } else if (index.structure.configFiles.some(f => f.includes('requirements.txt') || f.includes('Pipfile'))) {
            index.summary.packageManager = 'pip';
        } else if (index.structure.configFiles.some(f => f.includes('Cargo.toml'))) {
            index.summary.packageManager = 'cargo';
        } else if (index.structure.configFiles.some(f => f.includes('go.mod'))) {
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
        
        loggingService.info('Built codebase index', {
            repository: `${owner}/${repo}`,
            totalFiles: index.summary.totalFiles,
            sourceCount: index.summary.sourceCount,
            languages: index.summary.languages
        });
        
        // Cache the index
        this.codebaseIndexCache.set(cacheKey, { index, timestamp: now });
        
        // Clean old cache entries (keep max 50)
        if (this.codebaseIndexCache.size > 50) {
            const entries = Array.from(this.codebaseIndexCache.entries())
                .sort((a, b) => b[1].timestamp - a[1].timestamp)
                .slice(0, 50);
            this.codebaseIndexCache = new Map(entries);
        }
        
        return index;
    }

    /**
     * Process GitHub-related chat messages
     */
    static async processChatMessage(
        context: GitHubChatContext,
        userMessage: string
    ): Promise<GitHubChatResponse> {
        try {
            loggingService.info('Processing GitHub chat message', {
                userId: context.userId,
                conversationId: context.conversationId,
                hasGitHubContext: !!context.githubContext
            });

            // Detect intent and extract command
            const command = await this.detectIntent(userMessage, context);

            // Execute command
            const response = await this.executeCommand(command, context);

            return response;
        } catch (error: any) {
            loggingService.error('GitHub chat message processing failed', {
                userId: context.userId,
                error: error.message,
                stack: error.stack
            });

            return {
                message: `I encountered an error: ${error.message}. Please try again or contact support if the issue persists.`,
                suggestions: ['Check status', 'List repositories', 'Help']
            };
        }
    }

    /**
     * Detect user intent and extract command
     */
    private static async detectIntent(
        message: string,
        context: GitHubChatContext
    ): Promise<GitHubCommand> {
        // Simple keyword-based intent detection
        const lowerMessage = message.toLowerCase();

        // Connect GitHub
        if (lowerMessage.includes('connect') && lowerMessage.includes('github')) {
            return { action: 'connect' };
        }

        // List repositories
        if (lowerMessage.includes('list') && (lowerMessage.includes('repo') || lowerMessage.includes('repository'))) {
            return { action: 'list_repos' };
        }

        // Start integration
        if ((lowerMessage.includes('integrate') || lowerMessage.includes('add') || lowerMessage.includes('setup')) &&
            (lowerMessage.includes('costkatana') || lowerMessage.includes('cost katana'))) {
            return {
                action: 'start_integration',
                parameters: {
                    integrationType: this.detectIntegrationType(message),
                    features: this.detectFeatures(message)
                }
            };
        }

        // Check status
        if (lowerMessage.includes('status') || lowerMessage.includes('progress') || lowerMessage.includes('check')) {
            return { action: 'check_status' };
        }

        // Update PR (for existing integrations)
        if ((lowerMessage.includes('update') || lowerMessage.includes('change') || lowerMessage.includes('modify')) &&
            context.githubContext?.integrationId) {
            return {
                action: 'update_pr',
                parameters: {
                    changes: message
                }
            };
        }

        // Make changes to repository (when repo is selected but no integration)
        if (context.githubContext && !context.githubContext.integrationId &&
            (lowerMessage.includes('add') || lowerMessage.includes('create') || lowerMessage.includes('update') || 
             lowerMessage.includes('change') || lowerMessage.includes('modify') || lowerMessage.includes('fix') ||
             lowerMessage.includes('implement') || lowerMessage.includes('remove') || lowerMessage.includes('delete'))) {
            return {
                action: 'make_changes',
                parameters: {
                    request: message
                }
            };
        }

        // Help
        if (lowerMessage.includes('help') || lowerMessage.includes('what can you do')) {
            return { action: 'help' };
        }

        // Default: Use AI to understand intent
        return await this.detectIntentWithAI(message, context);
    }

    /**
     * Detect integration type from message
     */
    private static detectIntegrationType(message: string): 'npm' | 'cli' | 'python' {
        const lower = message.toLowerCase();
        
        if (lower.includes('python') || lower.includes('py') || lower.includes('pip')) {
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
    private static detectFeatures(message: string): string[] {
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
    private static buildFileTree(files: CodebaseIndex['files']): string {
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
                        size: file.size
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
        
        const renderTree = (node: any, prefix = '', isLast = true): string => {
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
                    output += renderTree(value as Record<string, any>, nextPrefix, isLastItem);
                } else if (value && typeof value === 'object' && 'type' in value) {
                    // File
                    const fileInfo = value as { type: string; category: string; language?: string; size: number };
                    const category = fileInfo.category !== 'other' ? ` [${fileInfo.category}]` : '';
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
    private static async detectIntentWithAI(
        message: string,
        context: GitHubChatContext
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
            const response = await BedrockService.invokeModel(
                prompt,
                'anthropic.claude-opus-4-1-20250805-v1:0',
                { useSystemPrompt: false }
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as GitHubCommand;
            }
        } catch (error) {
            loggingService.warn('AI intent detection failed, using fallback', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        return { action: 'help' };
    }

    /**
     * Execute detected command
     */
    private static async executeCommand(
        command: GitHubCommand,
        context: GitHubChatContext
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
                    message: "I'm not sure what you'd like to do. Would you like to connect your GitHub repository or check the status of an existing integration?",
                    suggestions: ['Connect GitHub', 'List repositories', 'Check status', 'Help']
                };
        }
    }

    /**
     * Handle connect command
     */
    private static async handleConnectCommand(context: GitHubChatContext): Promise<GitHubChatResponse> {
        // Check if already connected
        const connections = await GitHubConnection.find({
            userId: context.userId,
            isActive: true
        });

        if (connections.length > 0) {
            return {
                message: `You already have ${connections.length} GitHub connection(s). Would you like to connect another account or work with an existing one?`,
                data: { connections },
                suggestions: ['List my repositories', 'Start integration', 'Disconnect']
            };
        }

        const authUrl = `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/github/auth`;

        return {
            message: "Great! Let's connect your GitHub account. Please click the button below to authorize CostKatana.",
            requiresAction: true,
            action: {
                action: 'connect',
                parameters: { authUrl }
            },
            suggestions: ['What can you do?', 'Help']
        };
    }

    /**
     * Handle list repositories command
     */
    private static async handleListReposCommand(context: GitHubChatContext): Promise<GitHubChatResponse> {
        const connections = await GitHubConnection.find({
            userId: context.userId,
            isActive: true
        });

        if (connections.length === 0) {
            return {
                message: "You haven't connected any GitHub accounts yet. Would you like to connect one now?",
                suggestions: ['Connect GitHub', 'Help']
            };
        }

        const repositories = connections.flatMap(conn => conn.repositories);

        return {
            message: `I found ${repositories.length} repositories across ${connections.length} GitHub account(s). Which repository would you like to integrate CostKatana into?`,
            data: { repositories, connections },
            suggestions: repositories.slice(0, 5).map(r => `Integrate into ${r.name}`)
        };
    }

    /**
     * Handle start integration command
     */
    private static async handleStartIntegrationCommand(
        context: GitHubChatContext,
        parameters?: Record<string, any>
    ): Promise<GitHubChatResponse> {
        if (!context.githubContext?.repositoryId) {
            return {
                message: "Which repository would you like to integrate CostKatana into? Please select one from your repositories.",
                suggestions: ['List my repositories']
            };
        }

        // Default features if not specified
        const features = parameters?.features || ['cost-tracking', 'telemetry'];
        const integrationType = parameters?.integrationType || 'npm';

        const connection = await GitHubConnection.findById(context.githubContext.connectionId);
        if (!connection) {
            return {
                message: "I couldn't find your GitHub connection. Please reconnect your account.",
                suggestions: ['Connect GitHub']
            };
        }

        const repository = connection.repositories.find(r => r.id === context.githubContext?.repositoryId);
        if (!repository) {
            return {
                message: "I couldn't find that repository. Please select a valid repository.",
                suggestions: ['List my repositories']
            };
        }

        // Start integration
        const integration = await GitHubIntegrationService.startIntegration({
            userId: context.userId,
            connectionId: connection._id.toString(),
            repositoryId: repository.id,
            repositoryName: repository.name,
            repositoryFullName: repository.fullName,
            integrationType: integrationType as 'npm' | 'cli' | 'python',
            selectedFeatures: features.map((name: string) => ({ name, enabled: true })),
            conversationId: context.conversationId
        });

        // Update conversation with GitHub context
        if (context.conversationId) {
            await Conversation.findByIdAndUpdate(context.conversationId, {
                githubContext: {
                    connectionId: connection._id,
                    repositoryId: repository.id,
                    repositoryName: repository.name,
                    repositoryFullName: repository.fullName,
                    integrationId: integration._id,
                    branchName: integration.branchName
                }
            });
        }

        return {
            message: `🚀 **Starting Integration Process**\n\nI'm integrating CostKatana into **${repository.fullName}**.\n\n**Progress Steps:**\n⏳ Step 1: Analyzing repository structure...\n⏳ Step 2: Detecting frameworks and dependencies...\n⏳ Step 3: Generating integration code with AI...\n⏳ Step 4: Creating pull request...\n\n*This usually takes 1-2 minutes. I'll update you when each step completes!*\n\n💡 **Tip:** You can check the status anytime by asking "check status" or just wait for updates!`,
            data: { 
                integrationId: integration._id.toString(),
                status: 'initializing',
                progress: 10,
                currentStep: 'Starting integration process...'
            },
            requiresAction: true,
            suggestions: ['Check status', 'What happens next?']
        };
    }

    /**
     * Handle check status command
     */
    private static async handleCheckStatusCommand(context: GitHubChatContext): Promise<GitHubChatResponse> {
        if (!context.githubContext?.integrationId) {
            const integrations = await GitHubIntegration.find({ userId: context.userId })
                .sort({ createdAt: -1 })
                .limit(5);

            if (integrations.length === 0) {
                return {
                    message: "You don't have any active integrations. Would you like to start one?",
                    suggestions: ['Start integration', 'List repositories']
                };
            }

            return {
                message: `You have ${integrations.length} integration(s). Here are the most recent:`,
                data: { integrations },
                suggestions: integrations.map(i => `Check ${i.repositoryName}`)
            };
        }

        const progress = await GitHubIntegrationService.getIntegrationStatus(
            context.githubContext.integrationId.toString()
        );

        // Build comprehensive status message with progress indicators
        const statusEmojis: Record<string, string> = {
            'initializing': '⚙️',
            'analyzing': '🔍',
            'generating': '✨',
            'draft': '📝',
            'open': '✅',
            'merged': '🎉',
            'failed': '❌',
            'closed': '🔒'
        };

        const emoji = statusEmojis[progress.status] || '⏳';
        let statusMessage = `${emoji} **Integration Status**: ${progress.status.toUpperCase()}\n📊 **Progress**: ${progress.progress}%\n\n**Current Step**: ${progress.currentStep}`;

        // Add step-by-step progress visualization
        const steps = [
            { name: 'Analyzing repository', status: ['initializing', 'analyzing'], emoji: progress.status === 'analyzing' ? '🔍' : (['open', 'merged'].includes(progress.status) ? '✅' : '⏳') },
            { name: 'Generating integration code', status: ['generating'], emoji: progress.status === 'generating' ? '✨' : (['open', 'merged'].includes(progress.status) ? '✅' : '⏳') },
            { name: 'Creating pull request', status: ['draft'], emoji: progress.status === 'draft' ? '📝' : (['open', 'merged'].includes(progress.status) ? '✅' : '⏳') },
            { name: 'Pull request ready', status: ['open', 'merged'], emoji: progress.status === 'open' || progress.status === 'merged' ? '🎉' : '⏳' }
        ];

        statusMessage += `\n\n**Progress Steps:**\n`;
        steps.forEach((step, index) => {
            const isCompleted = ['open', 'merged'].includes(progress.status) && index < steps.length - 1;
            const isCurrent = step.status.includes(progress.status);
            const prefix = isCompleted ? '✅' : (isCurrent ? step.emoji : '⏳');
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
            suggestions: progress.status === 'open' || progress.status === 'merged' 
                ? ['View PR', 'Check changes', 'What next?'] 
                : progress.status === 'failed'
                ? ['Try again', 'Contact support']
                : ['Check status again']
        };
    }

    /**
     * Handle update PR command
     */
    private static async handleUpdatePRCommand(
        context: GitHubChatContext,
        parameters?: Record<string, any>
    ): Promise<GitHubChatResponse> {
        if (!context.githubContext?.integrationId) {
            return {
                message: "I don't see an active integration to update. Please start an integration first.",
                suggestions: ['Start integration', 'List integrations']
            };
        }

        const changes = parameters?.changes || '';
        if (!changes) {
            return {
                message: "What changes would you like me to make to the integration? Please describe what you'd like to update.",
                suggestions: ['Add feature X', 'Change configuration', 'Update dependencies']
            };
        }

        await GitHubIntegrationService.updateIntegrationFromChat(
            context.githubContext.integrationId.toString(),
            changes
        );

        return {
            message: `I'm updating the pull request with your requested changes. This may take a moment...\n\nChanges requested: ${changes}`,
            suggestions: ['Check status', 'View PR']
        };
    }

    /**
     * Handle make changes command - make arbitrary changes to repository
     */
    private static async handleMakeChangesCommand(
        context: GitHubChatContext,
        parameters?: Record<string, any>
    ): Promise<GitHubChatResponse> {
        if (!context.githubContext) {
            return {
                message: "No repository selected. Please select a repository first.",
                suggestions: ['Select repository', 'List repositories']
            };
        }

        const changeRequest = parameters?.request || '';
        if (!changeRequest) {
            return {
                message: "What changes would you like me to make? Please describe what you'd like to add, modify, or fix.",
                suggestions: ['Add a feature', 'Fix a bug', 'Update dependencies']
            };
        }

        try {
            const { GitHubConnection } = await import('../models');

            // Get connection
            const connection = await GitHubConnection.findById(context.githubContext.connectionId);
            if (!connection || !connection.isActive) {
                return {
                    message: "GitHub connection not found or inactive. Please reconnect your GitHub account.",
                    suggestions: ['Reconnect GitHub', 'Check connections']
                };
            }

            // Initialize GitHub service
            await GitHubService.initialize();

            // Get repository details to find default branch
            const repositoryFullName = context.githubContext?.repositoryFullName;
            if (!repositoryFullName) {
                return {
                    message: "No repository selected. Please select a repository first.",
                    suggestions: ['Select repository', 'List repositories']
                };
            }
            const [owner, repoName] = repositoryFullName.split('/');
            const repoDetails = await GitHubService.getRepository(connection as any, owner, repoName);
            const defaultBranch = repoDetails.default_branch || 'main';

            // Build comprehensive codebase index (Cursor-like indexing)
            loggingService.info('Building codebase index for repository', {
                repository: context.githubContext.repositoryFullName
            });
            
            const codebaseIndex = await this.buildCodebaseIndex(connection as any, owner, repoName, defaultBranch);
            
            // Load relevant examples from costkatana-examples
            const relevantExamples = await this.findRelevantExamples(changeRequest, codebaseIndex);
            
            // Use semantic search to find most relevant files for the request
            const semanticallyRelevantFiles = await this.findSemanticallyRelevantFiles(
                changeRequest,
                codebaseIndex
            );

            // Fetch file contents intelligently - prioritize semantically relevant files
            const filesToFetch: string[] = [];
            
            // Priority 1: Semantically relevant files (most important)
            filesToFetch.push(...semanticallyRelevantFiles.slice(0, 30));
            
            // Priority 2: Entry points (always important)
            filesToFetch.push(...codebaseIndex.structure.entryPoints);
            
            // Priority 3: Source files (limit to prevent overload)
            filesToFetch.push(...codebaseIndex.structure.sourceFiles.slice(0, 70));
            
            // Priority 4: Config files (needed for dependency updates)
            filesToFetch.push(...codebaseIndex.structure.configFiles.slice(0, 20));
            
            // Remove duplicates and limit total
            const uniqueFiles = Array.from(new Set(filesToFetch)).slice(0, 150);
            
            loggingService.info('Fetching file contents', {
                repository: context.githubContext.repositoryFullName,
                fileCount: uniqueFiles.length
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
                            defaultBranch
                        );
                        
                        if (!content) return; // Skip if fetch failed
                        
                        // Smart truncation: full content for files <50KB, truncated for larger
                        if (content.length > 50000) {
                            existingFiles[filePath] = content.substring(0, 25000) + '\n\n[... file truncated for size ...]\n\n' + content.substring(content.length - 25000);
                        } else {
                            existingFiles[filePath] = content;
                        }
                    } catch (error) {
                        // File doesn't exist or can't be read, that's okay
                        loggingService.warn('Failed to fetch file', {
                            filePath,
                            error: error instanceof Error ? error.message : 'Unknown'
                        });
                    }
                });
                
                // Wait for batch to complete
                await Promise.allSettled(fetchPromises);
                
                // Intelligent rate limiting: adaptive delay based on batch size
                // Larger delay for larger repositories to respect GitHub rate limits
                if (i + batchSize < uniqueFiles.length) {
                    const delay = codebaseIndex.summary.totalFiles > 1000 ? 300 : 150;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            loggingService.info('Completed file fetching', {
                repository: context.githubContext.repositoryFullName,
                filesFetched: Object.keys(existingFiles).length,
                totalRequested: uniqueFiles.length
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
            const codeStructure = this.analyzeCodeStructure(
                existingFiles,
                codebaseIndex
            );

            // Build file contents context with semantic relevance indicators
            const existingFilesContext = Object.keys(existingFiles).length > 0 
                ? '\n\n=== REPOSITORY CODEBASE (Complete File Contents - Prioritized by Relevance) ===\n' + 
                  Object.entries(existingFiles)
                    .sort(([a], [b]) => {
                        // Sort: semantically relevant first, then entry points, then source files, then config
                        const aIsSemantic = semanticallyRelevantFiles.includes(a);
                        const bIsSemantic = semanticallyRelevantFiles.includes(b);
                        if (aIsSemantic && !bIsSemantic) return -1;
                        if (!aIsSemantic && bIsSemantic) return 1;
                        
                        const aIsEntry = codebaseIndex.structure.entryPoints.includes(a);
                        const bIsEntry = codebaseIndex.structure.entryPoints.includes(b);
                        if (aIsEntry && !bIsEntry) return -1;
                        if (!aIsEntry && bIsEntry) return 1;
                        return a.localeCompare(b);
                    })
                    .map(([path, content]) => {
                        const fileInfo = codebaseIndex.files.find(f => f.path === path);
                        const language = fileInfo?.language ? ` (${fileInfo.language})` : '';
                        const isSemantic = semanticallyRelevantFiles.includes(path) ? ' 🔍 [SEMANTICALLY RELEVANT]' : '';
                        const structureInfo = codeStructure[path] ? `\n[Structure: ${codeStructure[path]}]` : '';
                        return `\n=== FILE: ${path}${language}${isSemantic}${structureInfo} ===\n${content}\n`;
                    }).join('\n')
                : '';

            // Build examples context
            const examplesContext = relevantExamples.length > 0
                ? '\n\n=== RELEVANT COSTKATANA EXAMPLES ===\n' +
                  relevantExamples.map(ex => {
                      return `\n--- EXAMPLE: ${ex.path} (Category: ${ex.category}) ---\n${ex.content.substring(0, 3000)}${ex.content.length > 3000 ? '\n[... truncated ...]' : ''}\n`;
                  }).join('\n\n')
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

2. **Semantic Understanding**: Use the semantically relevant files (marked with 🔍) as your primary focus, but maintain context of the entire codebase

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
- If adding dependencies, update the appropriate package manager file
- Think like Cursor: understand relationships, not just individual files`;

            const aiResponse = await BedrockService.invokeModel(
                prompt,
                'anthropic.claude-opus-4-1-20250805-v1:0',
                { useSystemPrompt: false }
            );

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
            await GitHubService.createBranch(
                connection as any,
                {
                    owner,
                    repo: repoName,
                    branchName,
                    fromBranch: defaultBranch
                }
            );

            // Make changes
            for (const file of changes.files) {
                if (file.action === 'create' || file.action === 'update') {
                    await GitHubService.createOrUpdateFile(
                        connection as any,
                        {
                            owner,
                            repo: repoName,
                            path: file.path,
                            content: file.content || '',
                            message: `Chat: ${file.action === 'create' ? 'Create' : 'Update'} ${file.path}`,
                            branch: branchName
                        }
                    );
                } else if (file.action === 'delete') {
                    // For deletion, we need to get the file SHA first and then delete it
                    await GitHubService.initialize();
                    
                    // Get Octokit instance using the connection
                    const decryptedToken = connection.decryptToken();
                    const { Octokit } = await import('@octokit/rest');
                    const octokit = new Octokit({ auth: decryptedToken });
                    
                    try {
                        const { data } = await octokit.rest.repos.getContent({
                            owner,
                            repo: repoName,
                            path: file.path,
                            ref: branchName
                        }) as { data: { sha: string } };
                        
                        await octokit.rest.repos.deleteFile({
                            owner,
                            repo: repoName,
                            path: file.path,
                            message: `Chat: Delete ${file.path}`,
                            sha: data.sha,
                            branch: branchName
                        });
                        
                        loggingService.info('Deleted file from repository', {
                            repository: `${owner}/${repoName}`,
                            path: file.path,
                            branch: branchName
                        });
                        } catch (error: any) {
                        if (error.status !== 404) {
                            loggingService.error('Failed to delete file', {
                                repository: `${owner}/${repoName}`,
                                path: file.path,
                                error: error instanceof Error ? error.message : String(error)
                            });
                            throw error;
                        }
                        // File doesn't exist, skip deletion
                        loggingService.warn('File not found for deletion, skipping', {
                            repository: `${owner}/${repoName}`,
                            path: file.path
                        });
                    }
                }
            }

            // Create PR
            const pr = await GitHubService.createPullRequest(
                connection as any,
                {
                    owner,
                    repo: repoName,
                    title: `Chat Request: ${changes.commitMessage}`,
                    body: `This PR was created from a chat request:\n\n**Request:** ${changeRequest}\n\n**Changes:**\n${changes.files.map(f => `- ${f.action}: ${f.path}`).join('\n')}`,
                    head: branchName,
                    base: defaultBranch
                }
            );

            return {
                message: `✅ Changes applied successfully!\n\n📝 **Commit Message**: ${changes.commitMessage}\n🌿 **Branch**: ${branchName}\n📁 **Files Changed**: ${changes.files.length}\n\n🔗 [View Pull Request](${pr.html_url})\n\nYou can review and merge the changes when ready!`,
                data: {
                    prUrl: pr.html_url,
                    prNumber: pr.number,
                    branchName,
                    filesChanged: changes.files.length
                },
                suggestions: ['View PR', 'Check status', 'Make more changes']
            };
        } catch (error: any) {
            loggingService.error('Failed to make repository changes', {
                userId: context.userId,
                error: error.message,
                stack: error.stack
            });

            return {
                message: `❌ I encountered an error making changes: ${error.message}\n\nPlease try again or describe the changes more specifically.`,
                suggestions: ['Try again', 'Help', 'Check repository access']
            };
        }
    }

    /**
     * Handle help command
     */
    private static handleHelpCommand(): GitHubChatResponse {
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
            suggestions: ['Connect GitHub', 'List repositories', 'Start integration', 'Make changes']
        };
    }
}

export default GitHubChatAgentService;



