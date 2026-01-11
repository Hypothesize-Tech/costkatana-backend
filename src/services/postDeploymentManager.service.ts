import { loggingService } from './logging.service';
import { GitHubService } from './github.service';
import { VercelMCPService } from './vercelMcp.service';
import { AIRouterService } from './aiRouter.service';
import mongoose from 'mongoose';

export interface CodeModificationRequest {
  userId: string;
  taskId: string;
  modificationRequest: string; // User's natural language request
  affectedFiles?: string[]; // Optional: which files to modify
}

export interface CodeModificationDiff {
  file: string;
  oldContent: string;
  newContent: string;
  diff: string; // Unified diff format
}

export interface CodeModificationResult {
  success: boolean;
  diffs: CodeModificationDiff[];
  commitUrl?: string;
  message: string;
}

export class PostDeploymentManagerService {
  /**
   * Handle code modification request from chat
   */
  static async modifyDeployedCode(
    request: CodeModificationRequest
  ): Promise<CodeModificationResult> {
    try {
      loggingService.info('Processing code modification request', {
        component: 'PostDeploymentManagerService',
        operation: 'modifyDeployedCode',
        userId: request.userId,
        taskId: request.taskId,
        request: request.modificationRequest
      });

      // 1. Get task and extract repository info
      const { GovernedTaskModel } = await import('./governedAgent.service');
      const task = await GovernedTaskModel.findOne({ 
        _id: request.taskId,
        userId: new mongoose.Types.ObjectId(request.userId)
      });

      if (!task) {
        throw new Error('Task not found');
      }

      // 2. Extract GitHub repositories from task results
      const repos = this.extractRepositoriesFromTask(task);
      
      if (repos.length === 0) {
        throw new Error('No GitHub repositories found in task');
      }

      // 3. Use AI to understand what needs to be modified
      const modifications = await this.analyzeModificationRequest(
        request.modificationRequest,
        task.userRequest,
        repos,
        request.userId
      );

      // 4. Generate code diffs
      const diffs: CodeModificationDiff[] = [];
      
      for (const mod of modifications) {
        const diff = await this.generateCodeDiff(
          mod.repo,
          mod.file,
          mod.changes,
          request.userId
        );
        diffs.push(diff);
      }

      return {
        success: true,
        diffs,
        message: `Generated ${diffs.length} file modification(s). Review and approve to commit.`
      };

    } catch (error) {
      loggingService.error('Code modification failed', {
        component: 'PostDeploymentManagerService',
        operation: 'modifyDeployedCode',
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        success: false,
        diffs: [],
        message: error instanceof Error ? error.message : 'Code modification failed'
      };
    }
  }

  /**
   * Apply approved code modifications
   */
  static async applyCodeModifications(
    userId: string,
    diffs: CodeModificationDiff[],
    commitMessage: string
  ): Promise<{ success: boolean; commitUrls: string[]; message: string }> {
    const commitUrls: string[] = [];

    try {
      for (const diff of diffs) {
        // Parse repo info from file path
        const [owner, repo] = this.parseRepoFromPath(diff.file);
        
        // Get GitHub connection
        const { GitHubConnection } = await import('../models/GitHubConnection');
        const connection = await GitHubConnection.findOne({
          userId: new mongoose.Types.ObjectId(userId),
          isActive: true
        });

        if (!connection) {
          throw new Error('GitHub connection not found');
        }

        // Push changes
        const result = await GitHubService.createOrUpdateFile(
          connection,
          {
            owner,
            repo,
            path: diff.file,
            content: diff.newContent,
            message: commitMessage,
            branch: 'main'
          }
        );

        // Construct the commit URL manually
        const commitUrl = `https://github.com/${owner}/${repo}/commit/${result.commit}`;
        commitUrls.push(commitUrl);
      }

      loggingService.info('Code modifications applied successfully', {
        component: 'PostDeploymentManagerService',
        operation: 'applyCodeModifications',
        userId,
        filesModified: diffs.length
      });

      return {
        success: true,
        commitUrls,
        message: `Successfully committed ${diffs.length} file(s)`
      };

    } catch (error) {
      loggingService.error('Failed to apply code modifications', {
        component: 'PostDeploymentManagerService',
        operation: 'applyCodeModifications',
        userId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        commitUrls,
        message: error instanceof Error ? error.message : 'Failed to commit changes'
      };
    }
  }

  /**
   * Redeploy application on Vercel
   */
  static async triggerRedeployment(
    userId: string,
    projectId: string
  ): Promise<{ success: boolean; deploymentUrl?: string; message: string }> {
    try {
      const { VercelConnection } = await import('../models/VercelConnection');
      const connection = await VercelConnection.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        isActive: true
      });

      if (!connection) {
        throw new Error('Vercel connection not found');
      }

      const result = await VercelMCPService.triggerDeployment(
        connection._id.toString(),
        projectId,
        'production'
      );

      loggingService.info('Redeployment triggered successfully', {
        component: 'PostDeploymentManagerService',
        operation: 'triggerRedeployment',
        userId,
        projectId
      });

      return {
        success: true,
        deploymentUrl: result.url,
        message: 'Redeployment triggered successfully'
      };

    } catch (error) {
      loggingService.error('Redeployment failed', {
        component: 'PostDeploymentManagerService',
        operation: 'triggerRedeployment',
        userId,
        projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Redeployment failed'
      };
    }
  }

  // Helper methods
  private static extractRepositoriesFromTask(task: any): any[] {
    const repos: any[] = [];
    
    if (task.executionResults) {
      task.executionResults.forEach((result: any) => {
        if (result.result?.output?.link?.includes('github.com')) {
          repos.push({
            url: result.result.output.link,
            name: result.result.output.link.split('/').slice(-1)[0],
            owner: result.result.output.link.split('/').slice(-2, -1)[0]
          });
        }
      });
    }
    
    return repos;
  }

  private static async analyzeModificationRequest(
    request: string,
    originalRequest: string,
    repos: any[],
    userId: string
  ): Promise<any[]> {
    const prompt = `Analyze this code modification request:

Original Project: ${originalRequest}
Repositories: ${repos.map(r => `${r.name} (${r.url})`).join(', ')}
Modification Request: ${request}

Determine:
1. Which repository (backend/frontend)?
2. Which file(s) need modification?
3. What specific changes are needed?

Return JSON:
{
  "modifications": [
    {
      "repo": "repo-name",
      "file": "path/to/file.js",
      "changes": "Description of changes needed"
    }
  ]
}`;

    const response = await AIRouterService.invokeModel(
      prompt,
      'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      userId,
      { temperature: 0.2, maxTokens: 2000 }
    );

    const jsonStr = await AIRouterService.extractJson(response);
    const result = JSON.parse(jsonStr);
    
    return result.modifications || [];
  }

  private static async generateCodeDiff(
    repo: string,
    file: string,
    changes: string,
    userId: string
  ): Promise<CodeModificationDiff> {
    try {
      loggingService.info('Generating code diff', {
        component: 'PostDeploymentManagerService',
        operation: 'generateCodeDiff',
        repo,
        file,
        userId
      });

      // Step 1: Get current file content from GitHub
      const [owner, repoName] = this.parseRepoFromPath(repo);
      let currentContent = '';
      
      try {
        // Attempt to fetch current file content
        // This would require GitHub API integration
        currentContent = await this.fetchFileContent(owner, repoName, file, userId);
      } catch (error: any) {
        loggingService.warn('Could not fetch current file content, using placeholder', {
          component: 'PostDeploymentManagerService',
          error: error?.message || String(error),
          repo,
          file
        });
        currentContent = '// Could not fetch current content';
      }

      // Step 2: Generate modified version using AI
      const modificationPrompt = `Given this file content and requested changes, generate the modified version:

Current file: ${file}
Current content:
${currentContent}

Requested changes: ${changes}

Please provide the complete modified file content that incorporates these changes while maintaining proper code structure and formatting.`;

        const aiResponse = await AIRouterService.invokeModel(
          modificationPrompt,
          'global.anthropic.claude-sonnet-4-5-20250929-v1:0', // Claude Sonnet 4.5 (global profile with Converse API)
          userId
        );

      const modifiedContent = aiResponse.trim();

      // Step 3: Create unified diff
      const diff = this.createUnifiedDiff(file, currentContent, modifiedContent);

      return {
        file: `${repo}/${file}`,
        oldContent: currentContent,
        newContent: modifiedContent,
        diff
      };

    } catch (error: any) {
      loggingService.error('Error generating code diff', {
        component: 'PostDeploymentManagerService',
        operation: 'generateCodeDiff',
        error: error?.message || String(error),
        repo,
        file,
        userId
      });

      // Return fallback diff
      return {
        file: `${repo}/${file}`,
        oldContent: '// Error fetching content',
        newContent: `// Modified with changes: ${changes}`,
        diff: `--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,1 @@\n-// Error fetching content\n+// Modified with changes: ${changes}`
      };
    }
  }

  private static async fetchFileContent(owner: string, repo: string, filePath: string, userId: string): Promise<string> {
    try {
      loggingService.info('Fetching file content from GitHub', {
        component: 'PostDeploymentManagerService',
        operation: 'fetchFileContent',
        owner,
        repo,
        filePath
      });

      // Get GitHub connection for the user
      const { GitHubConnection } = await import('../models/GitHubConnection');
      const connection = await GitHubConnection.findOne({
        userId,
        status: 'active'
      });

      if (!connection) {
        throw new Error('GitHub connection not found. Please connect your GitHub account.');
      }

      // Use GitHub service to fetch file content
      const content = await GitHubService.getFileContent(connection, owner, repo, filePath);
      
      if (!content) {
        throw new Error(`File not found: ${filePath}`);
      }

      return content;
    } catch (error: any) {
      loggingService.error('Error fetching file content from GitHub', {
        component: 'PostDeploymentManagerService',
        operation: 'fetchFileContent',
        error: error?.message || String(error),
        owner,
        repo,
        filePath
      });

      // Return empty content as fallback
      return `// Error: Could not fetch content for ${filePath}\n// ${error?.message || String(error)}`;
    }
  }

  private static createUnifiedDiff(filename: string, oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    // Simple diff implementation - in production, use a proper diff library
    let diff = `--- a/${filename}\n+++ b/${filename}\n`;
    
    const maxLines = Math.max(oldLines.length, newLines.length);
    let hunkStart = 1;
    let addedLines = 0;
    let removedLines = 0;
    
    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i] || '';
      const newLine = newLines[i] || '';
      
      if (oldLine !== newLine) {
        if (addedLines === 0 && removedLines === 0) {
          diff += `@@ -${hunkStart},${oldLines.length} +${hunkStart},${newLines.length} @@\n`;
        }
        
        if (oldLine && oldLines[i] !== undefined) {
          diff += `-${oldLine}\n`;
          removedLines++;
        }
        if (newLine && newLines[i] !== undefined) {
          diff += `+${newLine}\n`;
          addedLines++;
        }
      } else if (oldLine) {
        diff += ` ${oldLine}\n`;
      }
    }
    
    return diff;
  }

  private static parseRepoFromPath(path: string): [string, string] {
    // Extract owner and repo from file path (format: "owner/repo/file")
    const parts = path.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid file path format: ${path}`);
    }
    return [parts[0], parts[1]];
  }
}
