import { GitHubService, RepositoryContent } from './github.service';
import { IGitHubConnection } from '../models';
import { loggingService } from './logging.service';

export interface AnalysisResult {
    language: string;
    framework?: string;
    entryPoints: string[];
    existingAIIntegrations: string[];
    projectType?: string;
    dependencies?: Record<string, string>;
    detectedPatterns?: string[];
    packageManager?: string;
    hasTests?: boolean;
    hasCI?: boolean;
    hasDocs?: boolean;
}

export interface FilePattern {
    pattern: RegExp;
    type: 'entry' | 'config' | 'dependency' | 'ai-integration';
    metadata?: Record<string, any>;
}

export class GitHubAnalysisService {
    // File patterns for detection
    private static readonly FILE_PATTERNS: Record<string, FilePattern[]> = {
        javascript: [
            { pattern: /^package\.json$/i, type: 'dependency' },
            { pattern: /^index\.(js|ts|jsx|tsx)$/i, type: 'entry' },
            { pattern: /^app\.(js|ts|jsx|tsx)$/i, type: 'entry' },
            { pattern: /^main\.(js|ts|jsx|tsx)$/i, type: 'entry' },
            { pattern: /^server\.(js|ts|jsx|tsx)$/i, type: 'entry' },
            { pattern: /^tsconfig\.json$/i, type: 'config' },
            { pattern: /^next\.config\.(js|ts)$/i, type: 'config' },
            { pattern: /^vite\.config\.(js|ts)$/i, type: 'config' }
        ],
        python: [
            { pattern: /^requirements\.txt$/i, type: 'dependency' },
            { pattern: /^pyproject\.toml$/i, type: 'dependency' },
            { pattern: /^Pipfile$/i, type: 'dependency' },
            { pattern: /^poetry\.lock$/i, type: 'dependency' },
            { pattern: /^setup\.py$/i, type: 'config' },
            { pattern: /^main\.py$/i, type: 'entry' },
            { pattern: /^app\.py$/i, type: 'entry' },
            { pattern: /^__init__\.py$/i, type: 'entry' },
            { pattern: /^manage\.py$/i, type: 'entry' }
        ]
    };

    // AI provider patterns
    private static readonly AI_INTEGRATION_PATTERNS = {
        openai: [
            /import\s+openai/i,
            /from\s+openai\s+import/i,
            /require\(['"]openai['"]\)/i,
            /import.*from\s+['"]openai['"]/i
        ],
        anthropic: [
            /import\s+anthropic/i,
            /from\s+anthropic\s+import/i,
            /require\(['"]@anthropic-ai\/sdk['"]\)/i,
            /import.*from\s+['"]@anthropic-ai\/sdk['"]/i
        ],
        google: [
            /import.*vertexai/i,
            /from\s+google\.generativeai\s+import/i,
            /require\(['"]@google-ai\/generativelanguage['"]\)/i
        ],
        aws: [
            /import.*BedrockRuntime/i,
            /from\s+boto3\s+import/i,
            /require\(['"]@aws-sdk\/client-bedrock['"]\)/i
        ]
    };

    /**
     * Analyze repository structure and detect technology stack
     */
    static async analyzeRepository(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string
    ): Promise<AnalysisResult> {
        try {
            loggingService.info('Starting repository analysis', {
                repository: `${owner}/${repo}`
            });

            // Get root directory contents
            const rootContents = await GitHubService.listDirectoryContents(
                connection,
                owner,
                repo,
                ''
            );

            // Detect language and project type
            const language = await this.detectLanguage(rootContents);
            const projectType = await this.detectProjectType(rootContents, language);
            const packageManager = this.detectPackageManager(rootContents);

            // Find entry points
            const entryPoints = await this.findEntryPoints(
                connection,
                owner,
                repo,
                rootContents,
                language
            );

            // Parse dependencies
            const dependencies = await this.parseDependencies(
                connection,
                owner,
                repo,
                rootContents,
                language
            );

            // Detect existing AI integrations
            const existingAIIntegrations = await this.detectAIIntegrations(
                connection,
                owner,
                repo,
                entryPoints,
                language
            );

            // Detect patterns
            const detectedPatterns = this.detectPatterns(rootContents, language);

            // Check for tests, CI, and docs
            const hasTests = this.hasTests(rootContents);
            const hasCI = this.hasCI(rootContents);
            const hasDocs = this.hasDocs(rootContents);

            // Detect framework
            const framework = await this.detectFramework(dependencies, rootContents, language);

            const result: AnalysisResult = {
                language,
                framework,
                entryPoints,
                existingAIIntegrations,
                projectType: projectType || language,
                dependencies,
                detectedPatterns,
                packageManager,
                hasTests,
                hasCI,
                hasDocs
            };

            loggingService.info('Repository analysis completed', {
                repository: `${owner}/${repo}`,
                language,
                framework,
                projectType,
                entryPointCount: entryPoints.length,
                aiIntegrations: existingAIIntegrations.length
            });

            return result;
        } catch (error: any) {
            loggingService.error('Repository analysis failed', {
                repository: `${owner}/${repo}`,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Detect primary programming language
     */
    private static async detectLanguage(contents: RepositoryContent[]): Promise<string> {
        const fileMap: Record<string, string> = {
            'package.json': 'javascript',
            'tsconfig.json': 'typescript',
            'requirements.txt': 'python',
            'pyproject.toml': 'python',
            'Pipfile': 'python',
            'Cargo.toml': 'rust',
            'go.mod': 'go',
            'pom.xml': 'java',
            'build.gradle': 'java',
            'Gemfile': 'ruby',
            'composer.json': 'php'
        };

        for (const content of contents) {
            if (content.type === 'file' && fileMap[content.name]) {
                return fileMap[content.name];
            }
        }

        // Fallback: check file extensions
        const extensions: Record<string, number> = {};
        for (const content of contents) {
            if (content.type === 'file') {
                const ext = content.name.split('.').pop()?.toLowerCase();
                if (ext) {
                    extensions[ext] = (extensions[ext] || 0) + 1;
                }
            }
        }

        const extMap: Record<string, string> = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'py': 'python',
            'rs': 'rust',
            'go': 'go',
            'java': 'java',
            'rb': 'ruby',
            'php': 'php'
        };

        const mostCommonExt = Object.entries(extensions)
            .sort(([, a], [, b]) => b - a)[0]?.[0];

        return extMap[mostCommonExt] || 'unknown';
    }

    /**
     * Detect project type
     */
    private static async detectProjectType(
        contents: RepositoryContent[],
        language: string
    ): Promise<string> {
        const fileNames = contents.map(c => c.name.toLowerCase());

        // Check for specific frameworks/types
        if (fileNames.includes('package.json')) {
            if (fileNames.includes('next.config.js') || fileNames.includes('next.config.ts')) {
                return 'next.js';
            }
            if (fileNames.includes('vite.config.js') || fileNames.includes('vite.config.ts')) {
                return 'vite';
            }
            if (fileNames.includes('angular.json')) {
                return 'angular';
            }
            if (fileNames.some(f => f.includes('gatsby'))) {
                return 'gatsby';
            }
        }

        if (language === 'python') {
            if (fileNames.includes('manage.py')) {
                return 'django';
            }
            if (fileNames.includes('app.py') || fileNames.includes('main.py')) {
                return 'flask/fastapi';
            }
        }

        return language === 'javascript' || language === 'typescript' ? 'node.js' : language;
    }

    /**
     * Detect package manager
     */
    private static detectPackageManager(contents: RepositoryContent[]): string | undefined {
        const fileNames = contents.map(c => c.name.toLowerCase());

        if (fileNames.includes('pnpm-lock.yaml')) return 'pnpm';
        if (fileNames.includes('yarn.lock')) return 'yarn';
        if (fileNames.includes('package-lock.json')) return 'npm';
        if (fileNames.includes('poetry.lock')) return 'poetry';
        if (fileNames.includes('pipfile.lock')) return 'pipenv';
        if (fileNames.includes('requirements.txt')) return 'pip';

        return undefined;
    }

    /**
     * Find entry points
     */
    private static async findEntryPoints(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        contents: RepositoryContent[],
        language: string
    ): Promise<string[]> {
        const entryPoints: string[] = [];
        const patterns = this.FILE_PATTERNS[language] || [];

        for (const content of contents) {
            if (content.type === 'file') {
                for (const { pattern, type } of patterns) {
                    if (type === 'entry' && pattern.test(content.name)) {
                        entryPoints.push(content.path);
                    }
                }
            }
        }

        // Check package.json for main entry
        if (language === 'javascript' || language === 'typescript') {
            try {
                const packageJson = await GitHubService.getFileContent(
                    connection,
                    owner,
                    repo,
                    'package.json'
                );
                const pkg = JSON.parse(packageJson);
                if (pkg.main && !entryPoints.includes(pkg.main)) {
                    entryPoints.push(pkg.main);
                }
            } catch (error) {
                // package.json not found or invalid
            }
        }

        // Check for src directory
        const hasSrc = contents.some(c => c.name.toLowerCase() === 'src' && c.type === 'dir');
        if (hasSrc && entryPoints.length === 0) {
            const srcContents = await GitHubService.listDirectoryContents(
                connection,
                owner,
                repo,
                'src'
            );
            
            for (const content of srcContents) {
                if (content.type === 'file') {
                    for (const { pattern, type } of patterns) {
                        if (type === 'entry' && pattern.test(content.name)) {
                            entryPoints.push(content.path);
                        }
                    }
                }
            }
        }

        return entryPoints.length > 0 ? entryPoints : ['src/index.js'];
    }

    /**
     * Parse dependencies from package files
     */
    private static async parseDependencies(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        contents: RepositoryContent[],
        language: string
    ): Promise<Record<string, string>> {
        try {
            if (language === 'javascript' || language === 'typescript') {
                const packageJson = await GitHubService.getFileContent(
                    connection,
                    owner,
                    repo,
                    'package.json'
                );
                const pkg = JSON.parse(packageJson);
                return {
                    ...pkg.dependencies,
                    ...pkg.devDependencies
                };
            }

            if (language === 'python') {
                // Try requirements.txt
                try {
                    const requirements = await GitHubService.getFileContent(
                        connection,
                        owner,
                        repo,
                        'requirements.txt'
                    );
                    const deps: Record<string, string> = {};
                    requirements.split('\n').forEach(line => {
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith('#')) {
                            const [pkg, version] = trimmed.split(/[=><~]+/);
                            deps[pkg.trim()] = version?.trim() || '*';
                        }
                    });
                    return deps;
                } catch (error) {
                    // Try pyproject.toml
                    const pyproject = await GitHubService.getFileContent(
                        connection,
                        owner,
                        repo,
                        'pyproject.toml'
                    );
                    // Basic TOML parsing for dependencies
                    const deps: Record<string, string> = {};
                    const matches = pyproject.matchAll(/^\s*([a-zA-Z0-9-_]+)\s*=\s*"([^"]+)"/gm);
                    for (const match of matches) {
                        deps[match[1]] = match[2];
                    }
                    return deps;
                }
            }
        } catch (error: any) {
            loggingService.warn('Failed to parse dependencies', {
                repository: `${owner}/${repo}`,
                error: error.message
            });
        }

        return {};
    }

    /**
     * Detect existing AI integrations
     */
    private static async detectAIIntegrations(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        entryPoints: string[],
        language: string
    ): Promise<string[]> {
        const integrations: Set<string> = new Set();

        for (const entryPoint of entryPoints.slice(0, 5)) { // Check first 5 entry points
            try {
                const content = await GitHubService.getFileContent(
                    connection,
                    owner,
                    repo,
                    entryPoint
                );

                // Check for each AI provider
                for (const [provider, patterns] of Object.entries(this.AI_INTEGRATION_PATTERNS)) {
                    if (patterns.some(pattern => pattern.test(content))) {
                        integrations.add(provider);
                    }
                }
            } catch (error) {
                // File not accessible, skip
            }
        }

        return Array.from(integrations);
    }

    /**
     * Detect architectural patterns
     */
    private static detectPatterns(contents: RepositoryContent[], language: string): string[] {
        const patterns: string[] = [];
        const fileNames = contents.map(c => c.name.toLowerCase());
        const dirNames = contents.filter(c => c.type === 'dir').map(c => c.name.toLowerCase());

        // Check for common patterns
        if (dirNames.includes('components') || dirNames.includes('views')) {
            patterns.push('component-based');
        }
        if (dirNames.includes('controllers') && dirNames.includes('models')) {
            patterns.push('mvc');
        }
        if (dirNames.includes('services') || dirNames.includes('lib')) {
            patterns.push('service-layer');
        }
        if (fileNames.includes('dockerfile') || fileNames.includes('docker-compose.yml')) {
            patterns.push('containerized');
        }
        if (dirNames.includes('tests') || dirNames.includes('test') || dirNames.includes('__tests__')) {
            patterns.push('tested');
        }
        if (fileNames.includes('.env.example') || fileNames.includes('.env.sample')) {
            patterns.push('env-config');
        }

        return patterns;
    }

    /**
     * Check if repository has tests
     */
    private static hasTests(contents: RepositoryContent[]): boolean {
        const names = contents.map(c => c.name.toLowerCase());
        return names.some(name => 
            name.includes('test') || 
            name.includes('spec') || 
            name === '__tests__' ||
            name === 'tests'
        );
    }

    /**
     * Check if repository has CI/CD
     */
    private static hasCI(contents: RepositoryContent[]): boolean {
        const names = contents.map(c => c.name.toLowerCase());
        return names.some(name => 
            name === '.github' ||
            name === '.gitlab-ci.yml' ||
            name === '.travis.yml' ||
            name === 'jenkinsfile' ||
            name === '.circleci'
        );
    }

    /**
     * Check if repository has documentation
     */
    private static hasDocs(contents: RepositoryContent[]): boolean {
        const names = contents.map(c => c.name.toLowerCase());
        return names.some(name => 
            name === 'readme.md' ||
            name === 'docs' ||
            name === 'documentation' ||
            name.startsWith('readme')
        );
    }

    /**
     * Detect framework from dependencies and files
     */
    private static async detectFramework(
        dependencies: Record<string, string>,
        contents: RepositoryContent[],
        language: string
    ): Promise<string | undefined> {
        const depKeys = Object.keys(dependencies).map(k => k.toLowerCase());
        const fileNames = contents.map(c => c.name.toLowerCase());

        // JavaScript/TypeScript frameworks
        if (language === 'javascript' || language === 'typescript') {
            if (depKeys.includes('next')) return 'Next.js';
            if (depKeys.includes('react')) return 'React';
            if (depKeys.includes('vue')) return 'Vue.js';
            if (depKeys.includes('@angular/core')) return 'Angular';
            if (depKeys.includes('express')) return 'Express';
            if (depKeys.includes('fastify')) return 'Fastify';
            if (depKeys.includes('nestjs')) return 'NestJS';
            if (depKeys.includes('svelte')) return 'Svelte';
        }

        // Python frameworks
        if (language === 'python') {
            if (depKeys.includes('django')) return 'Django';
            if (depKeys.includes('flask')) return 'Flask';
            if (depKeys.includes('fastapi')) return 'FastAPI';
            if (fileNames.includes('manage.py')) return 'Django';
        }

        return undefined;
    }
}

export default GitHubAnalysisService;



