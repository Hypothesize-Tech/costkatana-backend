import { Injectable, Logger } from '@nestjs/common';
import { GithubOAuthApiService } from './github-oauth-api.service';

export interface AnalysisResult {
  language: string;
  languageConfidence: number;
  isTypeScriptPrimary?: boolean;
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
  /** Optional language-specific details (e.g. Python version) */
  languageDetails?: { pythonVersion?: string };
  /** Display name of the project */
  projectName?: string;
  /** Detected framework (alias or detail of framework) */
  detectedFramework?: string;
  /** Project/repo description */
  description?: string;
  /** Python: main module name for generated package */
  pythonMainModuleName?: string;
  /** Python: SDK import name for generated code */
  pythonSDKImportName?: string;
}

@Injectable()
export class GithubAnalysisService {
  private readonly logger = new Logger(GithubAnalysisService.name);

  // Language detection patterns
  private readonly languagePatterns = {
    javascript: [
      'package.json',
      'jsconfig.json',
      'tsconfig.json',
      'webpack.config.js',
      'babel.config.js',
      'rollup.config.js',
      'vite.config.js',
    ],
    typescript: [
      'tsconfig.json',
      'tslint.json',
      'eslint.config.ts',
      'vitest.config.ts',
      'jest.config.ts',
    ],
    python: [
      'requirements.txt',
      'Pipfile',
      'Pipfile.lock',
      'setup.py',
      'setup.cfg',
      'pyproject.toml',
      'poetry.lock',
    ],
    java: [
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'src/main/java',
      'src/test/java',
    ],
    'c#': ['*.csproj', '*.sln', 'packages.config', 'Program.cs', 'Startup.cs'],
    go: ['go.mod', 'go.sum', 'main.go', 'cmd/', 'internal/', 'pkg/'],
    rust: ['Cargo.toml', 'Cargo.lock', 'src/main.rs', 'src/lib.rs'],
    ruby: ['Gemfile', 'Gemfile.lock', 'config.ru', 'app/', 'config/'],
    php: ['composer.json', 'composer.lock', 'index.php', 'app/', 'src/'],
  };

  // Framework detection patterns
  private readonly frameworkPatterns = {
    react: ['react', 'react-dom', 'next'],
    vue: ['vue', 'nuxt'],
    angular: ['@angular/core'],
    svelte: ['svelte'],
    express: ['express'],
    fastapi: ['fastapi'],
    django: ['django'],
    flask: ['flask'],
    spring: ['spring-boot', 'spring-framework'],
    dotnet: ['microsoft.aspnetcore', 'microsoft.entityframeworkcore'],
    laravel: ['laravel/framework'],
    rails: ['rails'],
  };

  // Package manager detection
  private readonly packageManagerFiles = {
    npm: 'package.json',
    yarn: 'yarn.lock',
    pnpm: 'pnpm-lock.yaml',
    poetry: 'poetry.lock',
    pip: 'requirements.txt',
    maven: 'pom.xml',
    gradle: 'build.gradle',
  };

  // Entry point patterns by language
  private readonly entryPointPatterns = {
    javascript: [
      'index.js',
      'main.js',
      'app.js',
      'server.js',
      'src/index.js',
      'src/main.js',
      'src/app.js',
      'src/server.js',
    ],
    typescript: [
      'index.ts',
      'main.ts',
      'app.ts',
      'server.ts',
      'src/index.ts',
      'src/main.ts',
      'src/app.ts',
      'src/server.ts',
    ],
    python: [
      'main.py',
      'app.py',
      'application.py',
      '__main__.py',
      'wsgi.py',
      'src/main.py',
      'src/app.py',
    ],
    java: [
      'src/main/java/**/Application.java',
      'src/main/java/**/Main.java',
      'src/main/java/**/App.java',
    ],
    'c#': ['Program.cs', 'Startup.cs', 'src/Program.cs'],
    go: ['main.go', 'cmd/**/*.go'],
    rust: ['src/main.rs'],
    ruby: ['config/application.rb', 'app.rb', 'config.ru'],
    php: ['index.php', 'public/index.php', 'src/index.php'],
  };

  // AI integration patterns to detect existing integrations
  private readonly aiIntegrationPatterns = [
    'openai',
    'anthropic',
    'claude',
    'gpt',
    'ai',
    'langchain',
    'llm',
    'cost-katana',
    'costkatana',
  ];

  constructor(private readonly githubOAuthApiService: GithubOAuthApiService) {}

  /**
   * Analyze repository structure and return comprehensive analysis
   */
  async analyzeRepository(
    connection: any,
    repositoryFullName: string,
    branch?: string,
  ): Promise<AnalysisResult> {
    try {
      const [owner, repo] = repositoryFullName.split('/');

      this.logger.log('Starting repository analysis', {
        repository: repositoryFullName,
        branch: branch || 'default',
      });

      // Get repository structure
      const files = await this.githubOAuthApiService.getAllRepositoryFiles(
        connection,
        owner,
        repo,
        branch,
        { maxFiles: 5000 },
      );

      // Analyze language and framework
      const languageAnalysis = this.detectLanguage(files);
      const frameworkAnalysis = this.detectFramework(files);
      const entryPoints = this.findEntryPoints(
        files,
        languageAnalysis.language,
      );
      const existingIntegrations = this.detectAIIntegrations(files);
      const projectType = this.determineProjectType(files, languageAnalysis);
      const dependencies = await this.extractDependencies(
        connection,
        owner,
        repo,
        files,
        branch,
      );
      const packageManager = this.detectPackageManager(files);
      const hasTests = this.detectTests(files);
      const hasCI = this.detectCI(files);
      const hasDocs = this.detectDocs(files);
      const detectedPatterns = this.detectPatterns(files);

      const result: AnalysisResult = {
        language: languageAnalysis.language,
        languageConfidence: languageAnalysis.confidence,
        isTypeScriptPrimary: languageAnalysis.isTypeScriptPrimary,
        framework: frameworkAnalysis,
        entryPoints,
        existingAIIntegrations: existingIntegrations,
        projectType,
        dependencies,
        detectedPatterns,
        packageManager,
        hasTests,
        hasCI,
        hasDocs,
      };

      this.logger.log('Repository analysis completed', {
        repository: repositoryFullName,
        language: result.language,
        framework: result.framework,
        entryPointsCount: result.entryPoints.length,
        existingIntegrationsCount: result.existingAIIntegrations.length,
      });

      return result;
    } catch (error: any) {
      this.logger.error('Repository analysis failed', {
        repository: repositoryFullName,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Detect primary language of the repository
   */
  private detectLanguage(
    files: Array<{ path: string; size: number; type: string }>,
  ): {
    language: string;
    confidence: number;
    isTypeScriptPrimary?: boolean;
  } {
    const fileExtensions: Record<string, number> = {};
    const fileCounts: Record<string, number> = {};

    // Count files by extension and type
    files.forEach((file) => {
      if (file.type !== 'file') return;

      const ext = this.getFileExtension(file.path);
      fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
    });

    // Detect language based on file patterns
    let maxScore = 0;
    let detectedLanguage = 'unknown';
    let isTypeScriptPrimary = false;

    for (const [language, patterns] of Object.entries(this.languagePatterns)) {
      let score = 0;

      if (language === 'javascript') {
        score += (fileExtensions['js'] || 0) * 2;
        score += (fileExtensions['jsx'] || 0) * 3;
        score += (fileExtensions['mjs'] || 0) * 2;
      } else if (language === 'typescript') {
        score += (fileExtensions['ts'] || 0) * 3;
        score += (fileExtensions['tsx'] || 0) * 4;
        score += (fileExtensions['d.ts'] || 0) * 2;
      } else if (language === 'python') {
        score += (fileExtensions['py'] || 0) * 2;
        score += (fileExtensions['pyw'] || 0) * 2;
      } else if (language === 'java') {
        score += (fileExtensions['java'] || 0) * 2;
      } else if (language === 'c#') {
        score += (fileExtensions['cs'] || 0) * 2;
      } else if (language === 'go') {
        score += (fileExtensions['go'] || 0) * 2;
      } else if (language === 'rust') {
        score += (fileExtensions['rs'] || 0) * 2;
      } else if (language === 'ruby') {
        score += (fileExtensions['rb'] || 0) * 2;
      } else if (language === 'php') {
        score += (fileExtensions['php'] || 0) * 2;
      }

      // Check for language-specific files
      patterns.forEach((pattern) => {
        if (files.some((file) => this.matchesPattern(file.path, pattern))) {
          score += 10;
        }
      });

      if (score > maxScore) {
        maxScore = score;
        detectedLanguage = language;
      }
    }

    // Special handling for TypeScript vs JavaScript
    if (
      detectedLanguage === 'typescript' ||
      (detectedLanguage === 'javascript' &&
        (fileExtensions['ts'] || fileExtensions['tsx']))
    ) {
      isTypeScriptPrimary =
        (fileExtensions['ts'] || 0) + (fileExtensions['tsx'] || 0) >
        (fileExtensions['js'] || 0) + (fileExtensions['jsx'] || 0);
      if (isTypeScriptPrimary) {
        detectedLanguage = 'typescript';
      }
    }

    const totalFiles = Object.values(fileExtensions).reduce(
      (sum, count) => sum + count,
      0,
    );
    const confidence =
      totalFiles > 0 ? Math.min((maxScore / totalFiles) * 10, 1) : 0;

    return {
      language: detectedLanguage,
      confidence,
      isTypeScriptPrimary,
    };
  }

  /**
   * Detect framework from project structure (config files, conventions).
   * For JS/TS: next, nuxt, vue, angular, svelte, vite, express (from package.json handled by extractDependencies).
   * For Python: django, flask, fastapi. For Ruby: rails. For PHP: laravel. For Go/Rust: inferred from language.
   */
  private detectFramework(
    files: Array<{ path: string; size: number; type: string }>,
  ): string | undefined {
    const paths = new Set(
      files.filter((f) => f.type === 'file').map((f) => f.path.toLowerCase()),
    );

    const hasPath = (p: string) =>
      Array.from(paths).some(
        (path) => path === p || path.endsWith('/' + p) || path.includes('/' + p + '/'),
      );

    if (hasPath('next.config.js') || hasPath('next.config.ts') || hasPath('next.config.mjs')) {
      return 'next';
    }
    if (hasPath('nuxt.config.ts') || hasPath('nuxt.config.js')) return 'nuxt';
    if (hasPath('angular.json')) return 'angular';
    if (hasPath('svelte.config.js') || hasPath('svelte.config.cjs')) return 'svelte';
    if (hasPath('vue.config.js')) return 'vue';
    if (hasPath('vite.config.ts') || hasPath('vite.config.js')) return 'vite';
    if (hasPath('manage.py')) return 'django';
    if (hasPath('requirements.txt')) {
      if (hasPath('main.py') || hasPath('app/main.py')) return 'fastapi';
      if (hasPath('app.py') || hasPath('application.py')) return 'flask';
    }
    if (hasPath('artisan') || hasPath('artisan.php')) return 'laravel';
    if (hasPath('config/routes.rb') || hasPath('config/application.rb')) return 'rails';
    if (hasPath('go.mod')) return 'go';
    if (hasPath('cargo.toml')) return 'rust';
    if (hasPath('pom.xml')) return 'spring';
    if (hasPath('composer.json')) return 'php';

    return undefined;
  }

  /**
   * Find entry points for the project
   */
  private findEntryPoints(
    files: Array<{ path: string; size: number; type: string }>,
    language: string,
  ): string[] {
    const entryPoints: string[] = [];
    const patterns =
      this.entryPointPatterns[
        language as keyof typeof this.entryPointPatterns
      ] || [];

    files.forEach((file) => {
      if (file.type !== 'file') return;

      // Check if file matches entry point patterns
      const matches = patterns.some((pattern) => {
        if (pattern.includes('**')) {
          // Glob-style pattern matching for file paths
          const regex = new RegExp(
            pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'),
          );
          return regex.test(file.path);
        }
        return file.path === pattern || file.path.endsWith('/' + pattern);
      });

      if (matches) {
        entryPoints.push(file.path);
      }
    });

    return entryPoints;
  }

  /**
   * Detect existing AI integrations
   */
  private detectAIIntegrations(
    files: Array<{ path: string; size: number; type: string }>,
  ): string[] {
    const integrations: string[] = [];

    files.forEach((file) => {
      if (file.type !== 'file') return;

      const fileName = file.path.toLowerCase();
      this.aiIntegrationPatterns.forEach((pattern) => {
        if (fileName.includes(pattern)) {
          if (!integrations.includes(pattern)) {
            integrations.push(pattern);
          }
        }
      });
    });

    return integrations;
  }

  /**
   * Determine project type based on structure and files
   */
  private determineProjectType(
    files: Array<{ path: string; size: number; type: string }>,
    languageAnalysis: {
      language: string;
      confidence: number;
      isTypeScriptPrimary?: boolean;
    },
  ): string | undefined {
    const hasWebConfig = files.some(
      (file) =>
        file.path.includes('webpack.config') ||
        file.path.includes('vite.config') ||
        file.path.includes('rollup.config') ||
        file.path.includes('next.config'),
    );

    const hasApiFiles = files.some(
      (file) =>
        file.path.includes('server') ||
        file.path.includes('api') ||
        file.path.includes('routes'),
    );

    const hasFrontendStructure = files.some(
      (file) =>
        file.path.startsWith('src/') ||
        file.path.startsWith('public/') ||
        file.path.startsWith('components/') ||
        file.path.includes('index.html'),
    );

    if (hasWebConfig && hasFrontendStructure) {
      return 'web';
    } else if (hasApiFiles) {
      return 'api';
    } else if (
      languageAnalysis.language === 'python' ||
      languageAnalysis.language === 'java'
    ) {
      return 'backend';
    }

    return 'unknown';
  }

  /**
   * Extract dependencies from package files
   */
  private async extractDependencies(
    connection: any,
    owner: string,
    repo: string,
    files: Array<{ path: string; size: number; type: string }>,
    branch?: string,
  ): Promise<Record<string, string> | undefined> {
    try {
      // Try to read package.json for Node.js projects
      const packageJsonFile = files.find(
        (file) => file.path === 'package.json',
      );
      if (packageJsonFile) {
        const content = await this.githubOAuthApiService.getFileContent(
          connection,
          owner,
          repo,
          packageJsonFile.path,
          branch,
        );
        const packageJson = JSON.parse(content);

        const dependencies = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        return dependencies;
      }

      // Try to read requirements.txt for Python projects
      const requirementsFile = files.find(
        (file) => file.path === 'requirements.txt',
      );
      if (requirementsFile) {
        const content = await this.githubOAuthApiService.getFileContent(
          connection,
          owner,
          repo,
          requirementsFile.path,
          branch,
        );

        const dependencies: Record<string, string> = {};
        content.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [name, version] = trimmed.split('==');
            if (name) {
              dependencies[name.trim()] = version?.trim() || '*';
            }
          }
        });

        return dependencies;
      }

      // Unsupported language: return empty dependencies
      return {};
    } catch (error: any) {
      this.logger.warn('Failed to extract dependencies', {
        repository: `${owner}/${repo}`,
        error: error.message,
      });
      return {};
    }
  }

  /**
   * Detect package manager
   */
  private detectPackageManager(
    files: Array<{ path: string; size: number; type: string }>,
  ): string | undefined {
    for (const [manager, file] of Object.entries(this.packageManagerFiles)) {
      if (files.some((f) => f.path === file)) {
        return manager;
      }
    }
    return undefined;
  }

  /**
   * Detect if project has tests
   */
  private detectTests(
    files: Array<{ path: string; size: number; type: string }>,
  ): boolean {
    return files.some((file) => {
      const path = file.path.toLowerCase();
      return (
        path.includes('test') ||
        path.includes('spec') ||
        path.includes('__tests__') ||
        path.includes('.test.') ||
        path.includes('.spec.')
      );
    });
  }

  /**
   * Detect if project has CI configuration
   */
  private detectCI(
    files: Array<{ path: string; size: number; type: string }>,
  ): boolean {
    const ciFiles = [
      '.github/workflows',
      '.gitlab-ci.yml',
      'Jenkinsfile',
      '.travis.yml',
      'azure-pipelines.yml',
      'circle.yml',
      'bitbucket-pipelines.yml',
    ];

    return files.some((file) =>
      ciFiles.some((ciFile) => file.path.startsWith(ciFile)),
    );
  }

  /**
   * Detect if project has documentation
   */
  private detectDocs(
    files: Array<{ path: string; size: number; type: string }>,
  ): boolean {
    return files.some((file) => {
      const path = file.path.toLowerCase();
      return (
        path === 'readme.md' ||
        path === 'readme.txt' ||
        path === 'docs/' ||
        path.includes('readme') ||
        path.includes('documentation')
      );
    });
  }

  /**
   * Detect patterns in the codebase
   */
  private detectPatterns(
    files: Array<{ path: string; size: number; type: string }>,
  ): string[] {
    const patterns: string[] = [];

    // MVC pattern
    if (
      files.some(
        (f) =>
          f.path.includes('controllers/') ||
          f.path.includes('models/') ||
          f.path.includes('views/'),
      )
    ) {
      patterns.push('MVC');
    }

    // Microservices pattern
    if (
      files.some(
        (f) =>
          f.path.includes('services/') || f.path.includes('microservices/'),
      )
    ) {
      patterns.push('Microservices');
    }

    // API pattern
    if (
      files.some(
        (f) =>
          f.path.includes('api/') ||
          f.path.includes('routes/') ||
          f.path.includes('endpoints/'),
      )
    ) {
      patterns.push('API');
    }

    // Monorepo pattern
    if (
      files.some(
        (f) => f.path.includes('packages/') || f.path.includes('apps/'),
      )
    ) {
      patterns.push('Monorepo');
    }

    return patterns;
  }

  /**
   * Get file extension
   */
  private getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }

  /**
   * Check if file path matches a pattern
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(filePath);
    }
    return filePath === pattern;
  }
}
