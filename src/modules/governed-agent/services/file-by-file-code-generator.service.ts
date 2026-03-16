import { Injectable } from '@nestjs/common';
import { BedrockService } from '../../../services/bedrock.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { GovernedAgentSseService } from './governed-agent-sse.service';
import { GitHubMcpService } from '../../mcp/services/integrations/github-mcp.service';

interface GeneratedFile {
  path: string;
  content: string;
  repository: string;
  commitMessage: string;
}

interface RepositoryInfo {
  name: string;
  owner: string;
  fullName: string;
}

interface CodeGenerationResult {
  success: boolean;
  files: GeneratedFile[];
  repositories: RepositoryInfo[];
  errors: string[];
}

@Injectable()
export class FileByFileCodeGeneratorService {
  constructor(
    private readonly bedrockService: BedrockService,
    private readonly logger: LoggerService,
    private readonly sseService: GovernedAgentSseService,
    private readonly githubService: GitHubMcpService,
  ) {}

  /**
   * Generate code incrementally, file by file, and commit to GitHub immediately
   */
  async generateCodeIncrementally(
    taskId: string,
    userId: string,
    userRequest: string,
    clarifyingAnswers: Record<string, any> | undefined,
    githubToken: string | undefined,
    repositoryNames?: { backend?: string; frontend?: string },
  ): Promise<CodeGenerationResult> {
    const startTime = Date.now();
    const result: CodeGenerationResult = {
      success: true,
      files: [],
      repositories: [],
      errors: [],
    };

    try {
      this.logger.log('Starting incremental code generation', {
        component: 'FileByFileCodeGeneratorService',
        operation: 'generateCodeIncrementally',
        taskId,
        userId,
        hasToken: !!githubToken,
        repositoryNames,
      });

      // Send initial progress update
      this.sseService.sendEvent(taskId, 'code_generation_started', {
        message: 'Starting code generation...',
        timestamp: new Date().toISOString(),
      });

      // Step 1: Plan the file structure
      const filePlan = await this.planFileStructure(
        userRequest,
        clarifyingAnswers,
        repositoryNames,
      );

      this.sseService.sendEvent(taskId, 'file_structure_planned', {
        message: `Planned ${filePlan.totalFiles} files across ${filePlan.repositories.length} repositories`,
        filePlan,
        timestamp: new Date().toISOString(),
      });

      // Step 2: Generate and commit files one by one
      for (const repo of filePlan.repositories) {
        await this.processRepository(
          repo,
          filePlan,
          taskId,
          userId,
          userRequest,
          result,
        );
      }

      // Step 3: Final verification
      const verificationResult = await this.verifyGeneration(result);

      result.success = verificationResult.success;
      if (!verificationResult.success) {
        result.errors.push(...verificationResult.errors);
      }

      const generationTime = Date.now() - startTime;

      this.logger.log('Code generation completed', {
        component: 'FileByFileCodeGeneratorService',
        operation: 'generateCodeIncrementally',
        taskId,
        filesGenerated: result.files.length,
        repositories: result.repositories.length,
        errors: result.errors.length,
        generationTime,
      });

      // Send completion event
      this.sseService.sendEvent(taskId, 'code_generation_completed', {
        success: result.success,
        filesGenerated: result.files.length,
        repositories: result.repositories.length,
        errors: result.errors.length,
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error),
      );

      this.logger.error('Code generation failed', {
        component: 'FileByFileCodeGeneratorService',
        operation: 'generateCodeIncrementally',
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Send error event
      this.sseService.sendEvent(taskId, 'code_generation_failed', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });

      return result;
    }
  }

  /**
   * Plan the file structure using AI
   */
  private async planFileStructure(
    userRequest: string,
    clarifyingAnswers: Record<string, any> | undefined,
    repositoryNames?: { backend?: string; frontend?: string },
  ): Promise<{
    repositories: Array<{
      name: string;
      type: 'backend' | 'frontend' | 'fullstack';
      files: Array<{
        path: string;
        description: string;
        priority: number;
      }>;
    }>;
    totalFiles: number;
  }> {
    try {
      // Build context from clarifying answers
      const context = clarifyingAnswers
        ? `\n\nClarifications:\n${Object.entries(clarifyingAnswers)
            .map(([q, a]) => `Q: ${q}\nA: ${a}`)
            .join('\n')}`
        : '';

      const repoInfo = repositoryNames
        ? `\n\nRepository names:\n- Backend: ${repositoryNames.backend || 'auto-generated'}\n- Frontend: ${repositoryNames.frontend || 'auto-generated'}`
        : '';

      const prompt = `Plan a complete file structure for this application:

User Request: "${userRequest}"${context}${repoInfo}

Create a detailed file structure with:
1. Separate repositories for backend/frontend if full-stack
2. All necessary files for production deployment
3. Proper folder structure and naming conventions
4. Configuration files, dependencies, documentation

Respond with JSON:
{
  "repositories": [
    {
      "name": "repository-name",
      "type": "backend|frontend|fullstack",
      "files": [
        {
          "path": "src/index.js",
          "description": "Main application entry point",
          "priority": 1
        }
      ]
    }
  ]
}

Prioritize files by creation order (1 = highest priority).`;

      const result = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const response = result.response;
      const plan = this.extractJsonFromAiResponse<{ repositories: any[] }>(
        response,
      );

      // Validate and enhance the plan
      const enhancedPlan = this.enhanceFilePlan(plan, repositoryNames);

      return {
        repositories: enhancedPlan.repositories,
        totalFiles: enhancedPlan.repositories.reduce(
          (sum, repo) => sum + repo.files.length,
          0,
        ),
      };
    } catch (error) {
      this.logger.warn('AI file planning failed, using fallback', {
        component: 'FileByFileCodeGeneratorService',
        operation: 'planFileStructure',
        error: error instanceof Error ? error.message : String(error),
      });

      return this.getFallbackFilePlan(userRequest, repositoryNames);
    }
  }

  /**
   * Extract and parse JSON from AI response, handling common LLM output quirks
   * (e.g. ```json:, ```json, markdown, leading colons)
   */
  private extractJsonFromAiResponse<T = unknown>(response: string): T {
    let cleaned = response
      .replace(/```json:\s*\n?/gi, '')
      .replace(/```json\s*\n?/gi, '')
      .replace(/```\s*\n?/g, '')
      .trim();
    // Remove leading colon or other non-JSON prefix that some models add
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    const jsonStart =
      firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
        ? firstBrace
        : firstBracket;
    if (jsonStart > 0) {
      cleaned = cleaned.slice(jsonStart);
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Fallback: extract balanced JSON between first { and matching }
      const open = cleaned.indexOf('{');
      if (open >= 0) {
        let depth = 0;
        let end = -1;
        for (let i = open; i < cleaned.length; i++) {
          if (cleaned[i] === '{') depth++;
          if (cleaned[i] === '}') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end >= 0) {
          return JSON.parse(cleaned.slice(open, end + 1)) as T;
        }
      }
      throw new Error('Could not extract valid JSON from AI response');
    }
  }

  /**
   * Enhance and validate the AI-generated file plan
   */
  private enhanceFilePlan(
    plan: any,
    repositoryNames?: { backend?: string; frontend?: string },
  ): {
    repositories: Array<{
      name: string;
      type: 'backend' | 'frontend' | 'fullstack';
      files: Array<{
        path: string;
        description: string;
        priority: number;
      }>;
    }>;
  } {
    if (!plan.repositories || !Array.isArray(plan.repositories)) {
      throw new Error('Invalid file plan structure');
    }

    return {
      repositories: plan.repositories.map((repo: any, index: number) => ({
        name:
          repositoryNames?.[repo.type === 'backend' ? 'backend' : 'frontend'] ||
          repo.name ||
          `app-${repo.type}-${index + 1}`,
        type: repo.type || 'fullstack',
        files: (repo.files || []).map((file: any, fileIndex: number) => ({
          path: file.path || `file-${fileIndex + 1}.txt`,
          description: file.description || 'Generated file',
          priority: file.priority || fileIndex + 1,
        })),
      })),
    };
  }

  /**
   * Get fallback file plan for error cases
   */
  private getFallbackFilePlan(
    userRequest: string,
    repositoryNames?: { backend?: string; frontend?: string },
  ): {
    repositories: Array<{
      name: string;
      type: 'backend' | 'frontend' | 'fullstack';
      files: Array<{
        path: string;
        description: string;
        priority: number;
      }>;
    }>;
    totalFiles: number;
  } {
    const isFullStack =
      userRequest.toLowerCase().includes('backend') &&
      userRequest.toLowerCase().includes('frontend');

    const repositories = [];

    if (isFullStack) {
      // Backend repository
      repositories.push({
        name: repositoryNames?.backend || 'backend-app',
        type: 'backend' as const,
        files: [
          {
            path: 'package.json',
            description: 'Node.js dependencies and scripts',
            priority: 1,
          },
          {
            path: 'src/index.js',
            description: 'Main server entry point',
            priority: 2,
          },
          { path: 'src/routes/api.js', description: 'API routes', priority: 3 },
          {
            path: 'README.md',
            description: 'Project documentation',
            priority: 4,
          },
        ],
      });

      // Frontend repository
      repositories.push({
        name: repositoryNames?.frontend || 'frontend-app',
        type: 'frontend' as const,
        files: [
          {
            path: 'package.json',
            description: 'React dependencies and scripts',
            priority: 1,
          },
          {
            path: 'src/App.js',
            description: 'Main React component',
            priority: 2,
          },
          {
            path: 'src/index.js',
            description: 'React application entry point',
            priority: 3,
          },
          {
            path: 'public/index.html',
            description: 'HTML template',
            priority: 4,
          },
          {
            path: 'README.md',
            description: 'Project documentation',
            priority: 5,
          },
        ],
      });
    } else {
      // Single repository
      repositories.push({
        name: repositoryNames?.frontend || repositoryNames?.backend || 'app',
        type: 'fullstack' as const,
        files: [
          {
            path: 'package.json',
            description: 'Project dependencies and scripts',
            priority: 1,
          },
          {
            path: 'src/index.js',
            description: 'Main application entry point',
            priority: 2,
          },
          {
            path: 'README.md',
            description: 'Project documentation',
            priority: 3,
          },
        ],
      });
    }

    return {
      repositories,
      totalFiles: repositories.reduce(
        (sum, repo) => sum + repo.files.length,
        0,
      ),
    };
  }

  /**
   * Process a single repository
   */
  private async processRepository(
    repo: any,
    filePlan: any,
    taskId: string,
    userId: string,
    userRequest: string,
    result: CodeGenerationResult,
  ): Promise<void> {
    try {
      // Sort files by priority
      const sortedFiles = repo.files.sort(
        (a: any, b: any) => a.priority - b.priority,
      );

      const repoInfo: RepositoryInfo = {
        name: repo.name,
        owner: 'auto-detected', // Will be resolved during GitHub operations
        fullName: `${'auto-detected'}/${repo.name}`,
      };

      result.repositories.push(repoInfo);

      this.sseService.sendEvent(taskId, 'repository_started', {
        repository: repo.name,
        type: repo.type,
        filesCount: sortedFiles.length,
        timestamp: new Date().toISOString(),
      });

      // Generate and commit each file
      for (const file of sortedFiles) {
        try {
          await this.generateAndCommitFile(
            file,
            repo,
            repoInfo,
            taskId,
            userId,
            userRequest,
            result,
          );
        } catch (error) {
          const errorMsg = `Failed to generate ${file.path}: ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMsg);

          this.logger.error('File generation failed', {
            component: 'FileByFileCodeGeneratorService',
            operation: 'processRepository',
            taskId,
            repository: repo.name,
            file: file.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.sseService.sendEvent(taskId, 'repository_completed', {
        repository: repo.name,
        filesGenerated: sortedFiles.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const errorMsg = `Repository ${repo.name} processing failed: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);

      this.logger.error('Repository processing failed', {
        component: 'FileByFileCodeGeneratorService',
        operation: 'processRepository',
        taskId,
        repository: repo.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generate and commit a single file
   */
  private async generateAndCommitFile(
    file: any,
    repo: any,
    repoInfo: RepositoryInfo,
    taskId: string,
    userId: string,
    userRequest: string,
    result: CodeGenerationResult,
  ): Promise<void> {
    // Generate file content
    const content = await this.generateFileContent(
      file,
      repo,
      userRequest,
      taskId,
    );

    // Commit to GitHub
    const commitResult = await this.commitFileToGitHub(
      repoInfo,
      file.path,
      content,
      `Add ${file.path}: ${file.description}`,
      userId,
    );

    const generatedFile: GeneratedFile = {
      path: file.path,
      content,
      repository: repoInfo.name,
      commitMessage: `Add ${file.path}: ${file.description}`,
    };

    result.files.push(generatedFile);

    this.sseService.sendEvent(taskId, 'file_generated', {
      repository: repo.name,
      file: file.path,
      commitUrl: commitResult?.commitUrl,
      timestamp: new Date().toISOString(),
    });

    this.logger.log('File generated and committed', {
      component: 'FileByFileCodeGeneratorService',
      operation: 'generateAndCommitFile',
      taskId,
      repository: repo.name,
      file: file.path,
      contentLength: content.length,
    });
  }

  /**
   * Generate content for a specific file
   */
  private async generateFileContent(
    file: any,
    repo: any,
    userRequest: string,
    taskId: string,
  ): Promise<string> {
    try {
      const prompt = `Task ID: ${taskId}

Generate production-ready code for this file:

File: ${file.path}
Description: ${file.description}
Repository: ${repo.name} (${repo.type})
Project: ${userRequest}

Generate complete, functional code that follows best practices. Include proper imports, error handling, and documentation.

${this.getFileSpecificInstructions(file.path, repo.type)}`;

      const result = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const response = result.response;

      // Clean up the response
      const cleaned = response.replace(/```[\w]*\n?/g, '').trim();

      return cleaned;
    } catch (error) {
      this.logger.warn('AI file generation failed, using template', {
        component: 'FileByFileCodeGeneratorService',
        operation: 'generateFileContent',
        file: file.path,
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.getFileTemplate(file.path, repo.type);
    }
  }

  /**
   * Get file-specific generation instructions
   */
  private getFileSpecificInstructions(
    filePath: string,
    repoType: string,
  ): string {
    const instructions: Record<string, (repoType: string) => string> = {
      'package.json': (repoType) =>
        `Generate a complete package.json for a ${repoType} application with all necessary dependencies, scripts, and metadata for a production-ready project.`,
      'src/index.js': (repoType) =>
        `Generate the main application entry point for a ${repoType} app with proper initialization, error handling, and startup logic.`,
      'README.md': (repoType) =>
        `Generate comprehensive documentation for a ${repoType} project including setup instructions, API usage, and deployment guide.`,
      'src/App.js': (repoType) =>
        `Generate a React component with modern hooks, proper structure, and responsive design, suitable for a ${repoType} project.`,
      '.env.example': (repoType) =>
        `Generate an environment variables template for a ${repoType} application, with descriptions for all required configuration.`,
      'docker-compose.yml': (repoType) =>
        `Generate Docker Compose configuration for local development and production deployment of a ${repoType} service.`,
    };

    const instructionGenerator =
      instructions[filePath] ||
      ((repoType: string) =>
        `Generate complete, functional code for a ${repoType} project following industry best practices.`);

    return instructionGenerator(repoType);
  }

  /**
   * Get template content for common files
   */
  private getFileTemplate(filePath: string, repoType: string): string {
    const templates: Record<string, string> = {
      'package.json': `{
  "name": "${repoType}-app",
  "version": "1.0.0",
  "description": "Generated application",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0",
    "jest": "^29.0.0"
  }
}`,
      'README.md': `# ${repoType.charAt(0).toUpperCase() + repoType.slice(1)} Application

This application was generated automatically.

## Setup

1. Install dependencies: \`npm install\`
2. Start development server: \`npm run dev\`
3. Run tests: \`npm test\`

## Deployment

Deploy to production using your preferred hosting platform.
`,
      'src/index.js': `const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});`,
    };

    return (
      templates[filePath] ||
      `/** Generated file: ${filePath} - add implementation as needed */\n`
    );
  }

  /**
   * Commit a file to GitHub using the GitHubMcpService.
   * All parameters are required.
   *
   * @param repoInfo - Repository information (must have 'fullName', 'name')
   * @param filePath - Path to the file in the repository
   * @param content - File content to commit (as string)
   * @param commitMessage - Commit message for this operation
   * @param userId - The user ID performing the operation
   * @returns The commit URL (if available)
   */
  private async commitFileToGitHub(
    repoInfo: RepositoryInfo,
    filePath: string,
    content: string,
    commitMessage: string,
    userId: string,
  ): Promise<{ commitUrl?: string }> {
    try {
      // Attempt GitHub file commit via GitHubMcpService (MCP Multi-Cloud Provider abstraction)
      const commitResult = await this.githubService.createOrUpdateFile({
        owner: repoInfo.owner,
        repo: repoInfo.name,
        path: filePath,
        content,
        commitMessage,
        userId,
      });

      this.logger.log('File committed to GitHub', {
        component: 'FileByFileCodeGeneratorService',
        operation: 'commitFileToGitHub',
        repository: repoInfo.name,
        file: filePath,
        commitMessage,
        userId,
        commitResult,
      });

      return {
        commitUrl:
          commitResult?.commitUrl ||
          `https://github.com/${repoInfo.fullName}/commit/auto-generated-commit`,
      };
    } catch (error) {
      this.logger.error('GitHub commit failed', {
        component: 'FileByFileCodeGeneratorService',
        operation: 'commitFileToGitHub',
        repository: repoInfo.name,
        file: filePath,
        commitMessage,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Verify the generation was successful
   */
  private async verifyGeneration(result: CodeGenerationResult): Promise<{
    success: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Check if we have generated files
    if (result.files.length === 0) {
      errors.push('No files were generated');
    }

    // Check if all repositories have files
    for (const repo of result.repositories) {
      const repoFiles = result.files.filter((f) => f.repository === repo.name);
      if (repoFiles.length === 0) {
        errors.push(`Repository ${repo.name} has no generated files`);
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }
}
