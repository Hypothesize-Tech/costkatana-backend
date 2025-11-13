import { GitHubService, RepositoryContent } from './github.service';
import { IGitHubConnection } from '../models';
import { loggingService } from './logging.service';

export interface AnalysisResult {
    language: string;
    languageConfidence: number; // 0-100, how confident we are about the language detection
    isTypeScriptPrimary?: boolean; // For JS/TS projects, is TypeScript the primary language?
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
            const languageDetection = await this.detectLanguage(rootContents);
            const language = languageDetection.language;
            const languageConfidence = languageDetection.confidence;
            const isTypeScriptPrimary = languageDetection.isTypeScriptPrimary;
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
                languageConfidence,
                isTypeScriptPrimary,
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
                languageConfidence,
                isTypeScriptPrimary,
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
     * Detect primary programming language with confidence scoring
     */
    private static async detectLanguage(contents: RepositoryContent[]): Promise<{ language: string; confidence: number; isTypeScriptPrimary?: boolean }> {
        let confidence = 0;
        let detectedLanguage = 'unknown';
        let isTypeScriptPrimary = false;

        // Priority 1: Strong config file indicators (confidence: 90-100)
        const strongFileMap: Record<string, { language: string; confidence: number }> = {
            'tsconfig.json': { language: 'typescript', confidence: 95 },
            'Cargo.toml': { language: 'rust', confidence: 95 },
            'go.mod': { language: 'go', confidence: 95 },
            'pyproject.toml': { language: 'python', confidence: 90 },
            'pom.xml': { language: 'java', confidence: 90 },
            'build.gradle': { language: 'java', confidence: 90 }
        };

        // Priority 2: Medium config file indicators (confidence: 70-80)
        const mediumFileMap: Record<string, { language: string; confidence: number }> = {
            'package.json': { language: 'javascript', confidence: 70 },
            'requirements.txt': { language: 'python', confidence: 75 },
            'Pipfile': { language: 'python', confidence: 75 },
            'Gemfile': { language: 'ruby', confidence: 80 },
            'composer.json': { language: 'php', confidence: 80 }
        };

        // Check strong indicators first
        for (const content of contents) {
            if (content.type === 'file' && strongFileMap[content.name]) {
                const indicator = strongFileMap[content.name];
                detectedLanguage = indicator.language;
                confidence = indicator.confidence;
                
                // For TypeScript, check if it's truly TypeScript-primary
                if (indicator.language === 'typescript') {
                    isTypeScriptPrimary = true;
                }
                
                loggingService.info('Strong language indicator found', {
                    file: content.name,
                    language: detectedLanguage,
                    confidence
                });
                break;
            }
        }

        // If no strong indicator, check medium indicators
        if (confidence === 0) {
            for (const content of contents) {
                if (content.type === 'file' && mediumFileMap[content.name]) {
                    const indicator = mediumFileMap[content.name];
                    detectedLanguage = indicator.language;
                    confidence = indicator.confidence;
                    break;
                }
            }
        }

        // Enhanced TypeScript detection for package.json projects
        if (detectedLanguage === 'javascript' || detectedLanguage === 'typescript') {
            const tsIndicators = this.analyzeTypeScriptIndicators(contents);
            
            if (tsIndicators.score >= 70) {
                detectedLanguage = 'typescript';
                isTypeScriptPrimary = true;
                confidence = Math.max(confidence, tsIndicators.score);
                
                loggingService.info('TypeScript primary language detected', {
                    score: tsIndicators.score,
                    indicators: tsIndicators.reasons
                });
            } else if (tsIndicators.score >= 30) {
                // Mixed project - has some TypeScript but JavaScript dominant
                if (detectedLanguage === 'javascript') {
                    isTypeScriptPrimary = false;
                }
                loggingService.info('Mixed JS/TS project detected', {
                    primaryLanguage: detectedLanguage,
                    tsScore: tsIndicators.score
                });
            }
        }

        // Fallback: analyze file extensions
        if (confidence < 70) {
            const extensionAnalysis = this.analyzeFileExtensions(contents);
            if (extensionAnalysis.confidence > confidence) {
                detectedLanguage = extensionAnalysis.language;
                confidence = extensionAnalysis.confidence;
                
                if (extensionAnalysis.language === 'typescript') {
                    isTypeScriptPrimary = extensionAnalysis.isTypeScriptDominant || false;
                }
            }
        }

        return { 
            language: detectedLanguage, 
            confidence,
            isTypeScriptPrimary: detectedLanguage === 'typescript' ? isTypeScriptPrimary || false : undefined
        };
    }

    /**
     * Analyze TypeScript indicators in a project
     */
    private static analyzeTypeScriptIndicators(contents: RepositoryContent[]): { score: number; reasons: string[] } {
        let score = 0;
        const reasons: string[] = [];

        // Check for tsconfig.json (strong indicator)
        if (contents.some(c => c.name === 'tsconfig.json')) {
            score += 40;
            reasons.push('tsconfig.json present');
        }

        // Check for TypeScript files
        const tsFiles = contents.filter(c => 
            c.type === 'file' && 
            (c.name.endsWith('.ts') || c.name.endsWith('.tsx'))
        ).length;
        
        const jsFiles = contents.filter(c => 
            c.type === 'file' && 
            (c.name.endsWith('.js') || c.name.endsWith('.jsx')) &&
            !c.name.includes('.config.') &&
            !c.name.includes('.test.')
        ).length;

        // Calculate TypeScript file ratio
        const totalFiles = tsFiles + jsFiles;
        if (totalFiles > 0) {
            const tsRatio = tsFiles / totalFiles;
            if (tsRatio >= 0.8) {
                score += 30;
                reasons.push(`${Math.round(tsRatio * 100)}% TypeScript files`);
            } else if (tsRatio >= 0.5) {
                score += 20;
                reasons.push(`${Math.round(tsRatio * 100)}% TypeScript files (majority)`);
            } else if (tsRatio > 0) {
                score += 10;
                reasons.push(`${Math.round(tsRatio * 100)}% TypeScript files (minority)`);
            }
        }

        // Check for @types/* dependencies in package.json
        const hasPackageJson = contents.some(c => c.name === 'package.json');
        if (hasPackageJson && tsFiles > 0) {
            score += 15;
            reasons.push('Has TypeScript type definitions');
        }

        // Check for common TypeScript directories
        const hasSrcTs = contents.some(c => 
            c.type === 'dir' && 
            c.name === 'src' &&
            contents.some(f => f.path?.startsWith('src/') && (f.name.endsWith('.ts') || f.name.endsWith('.tsx')))
        );
        if (hasSrcTs) {
            score += 15;
            reasons.push('TypeScript files in src/ directory');
        }

        return { score: Math.min(score, 100), reasons };
    }

    /**
     * Analyze file extensions to detect language
     */
    private static analyzeFileExtensions(contents: RepositoryContent[]): { 
        language: string; 
        confidence: number; 
        isTypeScriptDominant?: boolean 
    } {
        const extensions: Record<string, number> = {};
        
        // Count file extensions (excluding common non-source files)
        for (const content of contents) {
            if (content.type === 'file') {
                const ext = content.name.split('.').pop()?.toLowerCase();
                if (ext && !['md', 'txt', 'json', 'yml', 'yaml', 'xml'].includes(ext)) {
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

        // Get TypeScript and JavaScript counts
        const tsCount = (extensions['ts'] || 0) + (extensions['tsx'] || 0);
        const jsCount = (extensions['js'] || 0) + (extensions['jsx'] || 0);
        const totalJsTsCount = tsCount + jsCount;

        // Sort extensions by count
        const sortedExts = Object.entries(extensions)
            .sort(([, a], [, b]) => b - a);

        const mostCommonExt = sortedExts[0]?.[0];
        const mostCommonCount = sortedExts[0]?.[1] || 0;
        const totalFiles = Object.values(extensions).reduce((sum, count) => sum + count, 0);

        const language = extMap[mostCommonExt] || 'unknown';
        
        // Calculate confidence based on dominance
        const dominanceRatio = totalFiles > 0 ? mostCommonCount / totalFiles : 0;
        let confidence = Math.round(dominanceRatio * 100);

        // Adjust confidence for JS/TS
        let isTypeScriptDominant = false;
        if (language === 'typescript' || language === 'javascript') {
            if (totalJsTsCount > 0) {
                const tsRatio = tsCount / totalJsTsCount;
                if (tsRatio >= 0.7) {
                    isTypeScriptDominant = true;
                    confidence = Math.max(confidence, 85);
                } else if (tsRatio >= 0.5) {
                    isTypeScriptDominant = true;
                    confidence = Math.max(confidence, 70);
                }
            }
        }

        return { 
            language, 
            confidence: Math.min(confidence, 100),
            isTypeScriptDominant: language === 'typescript' ? isTypeScriptDominant : undefined
        };
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
        
        // Directories to exclude (build outputs)
        const excludedDirs = ['dist', 'build', 'out', 'lib', '.next', '.nuxt', 'node_modules', '.cache'];
        
        // Helper to check if path is in excluded directory
        const isExcludedPath = (path: string): boolean => {
            const pathLower = path.toLowerCase();
            return excludedDirs.some(dir => pathLower.includes(`/${dir}/`) || pathLower.startsWith(`${dir}/`));
        };

        for (const content of contents) {
            if (content.type === 'file' && !isExcludedPath(content.path)) {
                for (const { pattern, type } of patterns) {
                    if (type === 'entry' && pattern.test(content.name)) {
                        // For TypeScript projects, prefer .ts/.tsx over .js/.jsx
                        if (language === 'typescript') {
                            const ext = content.name.split('.').pop()?.toLowerCase();
                            if (ext === 'ts' || ext === 'tsx') {
                                entryPoints.push(content.path);
                            }
                        } else {
                            entryPoints.push(content.path);
                        }
                    }
                }
            }
        }

        // Check package.json for main entry, but prefer source files
        if (language === 'javascript' || language === 'typescript') {
            try {
                const packageJson = await GitHubService.getFileContent(
                    connection,
                    owner,
                    repo,
                    'package.json'
                );
                const pkg = JSON.parse(packageJson);
                
                // If there's a main field, check if it's a source file or build output
                if (pkg.main && !isExcludedPath(pkg.main)) {
                    // For TypeScript, try to find corresponding .ts source file
                    if (language === 'typescript' && pkg.main.endsWith('.js')) {
                        // Check if corresponding .ts file exists in src/
                        const tsPath = pkg.main.replace(/\.js$/, '.ts').replace(/^dist\//, 'src/').replace(/^build\//, 'src/').replace(/^lib\//, 'src/');
                        if (!entryPoints.includes(tsPath)) {
                            // Try to verify if source file exists
                            try {
                                await GitHubService.getFileContent(connection, owner, repo, tsPath);
                                entryPoints.push(tsPath);
                            } catch {
                                // Source not found, skip main if it's in dist/build
                                if (!pkg.main.includes('dist/') && !pkg.main.includes('build/')) {
                                    entryPoints.push(pkg.main);
                                }
                            }
                        }
                    } else if (!entryPoints.includes(pkg.main)) {
                        entryPoints.push(pkg.main);
                    }
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
                if (content.type === 'file' && !isExcludedPath(content.path)) {
                    for (const { pattern, type } of patterns) {
                        if (type === 'entry' && pattern.test(content.name)) {
                            // For TypeScript projects, prefer .ts/.tsx
                            if (language === 'typescript') {
                                const ext = content.name.split('.').pop()?.toLowerCase();
                                if (ext === 'ts' || ext === 'tsx') {
                                    entryPoints.push(content.path);
                                }
                            } else {
                                entryPoints.push(content.path);
                            }
                        }
                    }
                }
            }
        }

        // Default fallback based on language
        const defaultEntry = language === 'typescript' 
            ? 'src/index.ts' 
            : language === 'javascript'
            ? 'src/index.js'
            : 'src/index.js';

        return entryPoints.length > 0 ? entryPoints : [defaultEntry];
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



