import { loggingService } from './logging.service';
import { AIRouterService } from './aiRouter.service';
import { SSEService } from './sse.service';
import { GitHubService } from './github.service';

export interface FileToGenerate {
  path: string;
  description: string;
  repository?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  description: string;
  repository?: string;
  githubUrl?: string;
}

export class FileByFileCodeGenerator {
  /**
   * Generate code file by file and commit to GitHub immediately
   */
  static async generateCodeIncrementally(
    taskId: string,
    userId: string,
    userRequest: string,
    clarifyingAnswers?: Record<string, string>,
    githubToken?: string,
    repositoryNames?: { backend?: string; frontend?: string }
  ): Promise<{
    success: boolean;
    files: GeneratedFile[];
    repositories: string[];
    errors: any[];
  }> {
    const model = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';
    const generatedFiles: GeneratedFile[] = [];
    const errors: any[] = [];
    const repositories: string[] = [];

    try {
      // Step 1: Plan the file structure
      await SSEService.sendEvent(
        `task_${taskId}`,
        'file_generation',
        {
          phase: 'planning',
          message: '📋 Planning file structure...'
        }
      );

      // Use provided repository names or determine from request
      const backendRepo = repositoryNames?.backend || 'app-backend';
      const frontendRepo = repositoryNames?.frontend || 'app-frontend';
      
      const fileStructurePrompt = `You are an expert software engineer. Plan the complete file structure for:

USER REQUEST: ${userRequest}
${clarifyingAnswers ? `\nClarifying Answers:\n${JSON.stringify(clarifyingAnswers, null, 2)}` : ''}

Generate a list of ALL files needed for a complete MERN stack application.
Include backend (Express/Node.js), frontend (React), and configuration files.

IMPORTANT: Use these exact repository names:
- Backend repository: "${backendRepo}"
- Frontend repository: "${frontendRepo}"

Return JSON with this structure:
{
  "files": [
    { "path": "backend/package.json", "description": "Backend dependencies and scripts", "repository": "${backendRepo}" },
    { "path": "backend/server.js", "description": "Express server entry point", "repository": "${backendRepo}" },
    { "path": "backend/models/Todo.js", "description": "Mongoose Todo model", "repository": "${backendRepo}" },
    { "path": "backend/routes/todos.js", "description": "Todo CRUD API routes", "repository": "${backendRepo}" },
    { "path": "backend/.env.example", "description": "Environment variables template", "repository": "${backendRepo}" },
    { "path": "frontend/package.json", "description": "Frontend dependencies", "repository": "${frontendRepo}" },
    { "path": "frontend/src/App.js", "description": "Main React component", "repository": "${frontendRepo}" },
    { "path": "frontend/src/components/TodoList.js", "description": "Todo list component", "repository": "${frontendRepo}" },
    { "path": "frontend/src/components/TodoItem.js", "description": "Individual todo component", "repository": "${frontendRepo}" },
    { "path": "frontend/src/api/todos.js", "description": "API client for backend", "repository": "${frontendRepo}" },
    { "path": "README.md", "description": "Setup and usage instructions", "repository": "${backendRepo}" }
  ],
  "repositories": ["${backendRepo}", "${frontendRepo}"]
}`;

      const structureResponse = await AIRouterService.invokeModel(
        fileStructurePrompt,
        model,
        userId,
        {
          temperature: 0.3,
          maxTokens: 2000
        }
      );

      const structureJson = await AIRouterService.extractJson(structureResponse);
      const fileStructure = JSON.parse(structureJson);
      
      const filesToGenerate: FileToGenerate[] = fileStructure.files || [];
      repositories.push(...(fileStructure.repositories || []));

      loggingService.info('File structure planned', {
        component: 'FileByFileCodeGenerator',
        taskId,
        filesCount: filesToGenerate.length,
        repositories
      });

      await SSEService.sendEvent(
        `task_${taskId}`,
        'file_generation',
        {
          phase: 'structure_complete',
          message: `📂 Planning complete: ${filesToGenerate.length} files to generate`,
          totalFiles: filesToGenerate.length,
          repositories
        }
      );

      // Step 2: Generate each file one by one
      for (let i = 0; i < filesToGenerate.length; i++) {
        const file = filesToGenerate[i];
        
        try {
          // Send progress update
          await SSEService.sendEvent(
            `task_${taskId}`,
            'file_generation',
            {
              phase: 'generating_file',
              message: `📝 Generating file ${i + 1}/${filesToGenerate.length}: ${file.path}`,
              currentFile: file.path,
              progress: Math.round((i / filesToGenerate.length) * 100)
            }
          );

          // Generate the file content
          const fileContent = await this.generateSingleFile(
            file,
            userRequest,
            clarifyingAnswers,
            model,
            userId
          );

          // Store the generated file
          const generatedFile: GeneratedFile = {
            path: file.path,
            content: fileContent,
            description: file.description,
            repository: file.repository
          };

          // If GitHub token is available, commit immediately
          if (githubToken && file.repository) {
            try {
              const githubUrl = await this.commitFileToGitHub(
                githubToken,
                file.repository,
                file.path,
                fileContent,
                `Add ${file.path}`
              );
              generatedFile.githubUrl = githubUrl;
              
              await SSEService.sendEvent(
                `task_${taskId}`,
                'file_generation',
                {
                  phase: 'file_committed',
                  message: `✅ Committed to GitHub: ${file.path}`,
                  file: file.path,
                  githubUrl
                }
              );
            } catch (gitError: any) {
              loggingService.warn('Failed to commit file to GitHub', {
                component: 'FileByFileCodeGenerator',
                taskId,
                file: file.path,
                error: gitError.message
              });
            }
          }

          generatedFiles.push(generatedFile);

          // Send success update
          await SSEService.sendEvent(
            `task_${taskId}`,
            'file_generation',
            {
              phase: 'file_complete',
              message: `✅ Generated: ${file.path}`,
              completedFiles: generatedFiles.length,
              totalFiles: filesToGenerate.length,
              progress: Math.round(((i + 1) / filesToGenerate.length) * 100)
            }
          );

        } catch (fileError: any) {
          loggingService.error('Failed to generate file', {
            component: 'FileByFileCodeGenerator',
            taskId,
            file: file.path,
            error: fileError.message
          });
          
          errors.push({
            file: file.path,
            error: fileError.message
          });

          await SSEService.sendEvent(
            `task_${taskId}`,
            'file_generation',
            {
              phase: 'file_error',
              message: `❌ Failed: ${file.path}`,
              error: fileError.message
            }
          );
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Send completion update
      await SSEService.sendEvent(
        `task_${taskId}`,
        'file_generation',
        {
          phase: 'complete',
          message: `✅ Code generation complete: ${generatedFiles.length}/${filesToGenerate.length} files`,
          generatedFiles: generatedFiles.length,
          totalFiles: filesToGenerate.length,
          errors: errors.length
        }
      );

      return {
        success: generatedFiles.length > 0,
        files: generatedFiles,
        repositories,
        errors
      };

    } catch (error: any) {
      loggingService.error('Code generation failed', {
        component: 'FileByFileCodeGenerator',
        taskId,
        error: error.message
      });

      await SSEService.sendEvent(
        `task_${taskId}`,
        'file_generation',
        {
          phase: 'error',
          message: `❌ Code generation failed: ${error.message}`,
          error: error.message
        }
      );

      throw error;
    }
  }

  /**
   * Generate a single file
   */
  private static async generateSingleFile(
    file: FileToGenerate,
    userRequest: string,
    clarifyingAnswers: Record<string, string> | undefined,
    model: string,
    userId: string
  ): Promise<string> {
    const filePrompt = `Generate COMPLETE, production-ready code for this file:

File: ${file.path}
Description: ${file.description}
Project: ${userRequest}
${clarifyingAnswers ? `\nProject Details:\n${JSON.stringify(clarifyingAnswers, null, 2)}` : ''}

Rules:
1. Generate COMPLETE file content - no placeholders, no TODOs, no "// ... rest of code"
2. Include ALL necessary imports and exports
3. Add proper error handling and validation
4. Follow best practices for ${this.getFileType(file.path)}
5. Make it production-ready
6. For package.json files, include all necessary dependencies with specific versions
7. For React components, use modern hooks and functional components
8. For Express routes, include proper middleware and error handling
9. For models, include proper validation and schemas

Return ONLY the file content, no JSON wrapper, no markdown code blocks, no explanations.`;

    const response = await AIRouterService.invokeModel(
      filePrompt,
      model,
      userId,
      {
        temperature: 0.2,
        maxTokens: 4000 // Reasonable size for single file
      }
    );

    // Clean the response (remove markdown if present)
    let cleanContent = response;
    
    // Remove markdown code blocks if present
    if (cleanContent.includes('```')) {
      cleanContent = cleanContent.replace(/```[^\n]*\n/g, '').replace(/\n```/g, '');
    }
    
    // Trim whitespace
    cleanContent = cleanContent.trim();

    return cleanContent;
  }

  /**
   * Get file type for better prompt context
   */
  private static getFileType(filePath: string): string {
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
      return 'JavaScript/React';
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      return 'TypeScript/React';
    } else if (filePath.endsWith('.json')) {
      return 'JSON configuration';
    } else if (filePath.endsWith('.md')) {
      return 'Markdown documentation';
    } else if (filePath.endsWith('.env') || filePath.endsWith('.env.example')) {
      return 'Environment variables';
    } else if (filePath.endsWith('.css') || filePath.endsWith('.scss')) {
      return 'CSS/SCSS styling';
    } else if (filePath.includes('Dockerfile')) {
      return 'Docker configuration';
    } else if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
      return 'YAML configuration';
    }
    return 'this file type';
  }

  /**
   * Commit a file to GitHub
   */
  private static async commitFileToGitHub(
    token: string,
    repository: string,
    filePath: string,
    content: string,
    message: string
  ): Promise<string> {
    try {
      const octokit = await (GitHubService as any).createOctokitFromToken(token);
      
      // Get the authenticated user
      const { data: user } = await octokit.rest.users.getAuthenticated();
      const owner = user.login;

      // Remove repository prefix from file path if present
      const cleanPath = filePath.replace(/^(backend|frontend)\//, '');

      // Create or update the file
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo: repository,
        path: cleanPath,
        message,
        content: Buffer.from(content).toString('base64'),
        committer: {
          name: user.name || user.login,
          email: user.email || `${user.login}@users.noreply.github.com`
        }
      });

      return response.data.content?.html_url || '';
    } catch (error: any) {
      // If repo doesn't exist, we'll handle it later
      if (error.status === 404) {
        loggingService.warn('Repository not found, will create later', {
          repository,
          error: error.message
        });
        return '';
      }
      throw error;
    }
  }
}