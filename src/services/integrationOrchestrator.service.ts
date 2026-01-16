import { loggingService } from './logging.service';
import { GoogleService } from './google.service';
import { JiraService } from './jira.service';
import { VercelMCPService } from './vercelMcp.service';
import { PlanStep } from './governedAgent.service';
import { Integration } from '../models/Integration';
import { GitHubConnection } from '../models/GitHubConnection';
import mongoose from 'mongoose';

export interface IntegrationStep extends PlanStep {
  integration: string; // github, google, mongodb, jira, vercel, aws
}

export interface ProgressUpdate {
  step: number;
  total: number;
  status: 'running' | 'completed' | 'failed';
  action?: string;
  error?: string;
  result?: any;
  timestamp: Date;
}

export interface ChainResult {
  success: boolean;
  results: Array<{
    step: string;
    result: any;
    success: boolean;
    duration: number;
  }>;
  totalDuration: number;
  error?: string;
}

export class IntegrationOrchestratorService {
  /**
   * Replace template variables in step parameters
   * Supports {{username}}, {{email}}, and references to previous step results
   */
  private static replaceTemplateVariables(
    params: Record<string, any>,
    context: Record<string, any>
  ): Record<string, any> {
    const replaced: Record<string, any> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        // Replace {{username}} with actual username from context
        let replacedValue = value.replace(/\{\{username\}\}/g, context.username || context.githubOwner || '');
        // Replace {{email}} with actual email from context
        replacedValue = replacedValue.replace(/\{\{email\}\}/g, context.email || '');
        
        // Special case: Replace "auto-detected" with actual GitHub owner
        if (key === 'owner' && (replacedValue === 'auto-detected' || replacedValue === '{{username}}')) {
          replacedValue = context.username || context.githubOwner || '';
        }
        if (key === 'repo' && replacedValue.includes('auto-detected/')) {
          replacedValue = replacedValue.replace('auto-detected/', `${context.username || context.githubOwner || ''}/`);
        }
        
        // Replace references to previous step results like {{step_1.repoUrl}}
        replacedValue = replacedValue.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
          const parts = path.split('.');
          let result: any = context;
          for (const part of parts) {
            result = result?.[part];
          }
          return result !== undefined ? String(result) : match;
        });
        replaced[key] = replacedValue;
      } else if (Array.isArray(value)) {
        // Recursively replace in arrays
        replaced[key] = value.map(item => 
          typeof item === 'object' && item !== null 
            ? this.replaceTemplateVariables(item, context)
            : item
        );
      } else if (typeof value === 'object' && value !== null) {
        // Recursively replace in nested objects
        replaced[key] = this.replaceTemplateVariables(value, context);
      } else {
        replaced[key] = value;
      }
    }

    return replaced;
  }

  /**
   * Execute a chain of integration steps
   * Supports: MongoDB, GitHub, Google, JIRA, Vercel
   */
  static async executeChain(
    steps: IntegrationStep[],
    userId: string,
    onProgress: (update: ProgressUpdate) => void
  ): Promise<ChainResult> {
    const startTime = Date.now();
    const results: ChainResult['results'] = [];
    
    // Build context for template variable replacement
    const context: Record<string, any> = {
      userId
    };
    
    // If we have GitHub steps, fetch the GitHub username upfront for template replacement
    const hasGitHubSteps = steps.some(s => s.integration === 'github');
    if (hasGitHubSteps) {
      try {
        const { GitHubConnection } = await import('../models/GitHubConnection');
        const githubConnection = await GitHubConnection.findOne({
          userId,
          isActive: true
        }).select('+accessToken +refreshToken');
        
        if (githubConnection) {
          // Get the authenticated user's info to populate context
          const { GitHubService } = await import('./github.service');
          const octokit = await (GitHubService as any).createOctokitFromToken(
            githubConnection.get('accessToken') || ''
          );
          
          try {
            const { data: user } = await octokit.rest.users.getAuthenticated();
            
            // Populate context with GitHub user info
            context.username = user.login;
            context.email = user.email || '';
            
            loggingService.info('GitHub context populated for template replacement', {
              component: 'IntegrationOrchestratorService',
              username: user.login
            });
          } catch (authError: any) {
            // If we can't get user info now, that's okay - we'll get it during step execution
            loggingService.warn('Could not fetch GitHub user info upfront, will resolve during step execution', {
              component: 'IntegrationOrchestratorService',
              error: authError.message
            });
          }
        }
      } catch (error) {
        loggingService.warn('Failed to initialize GitHub context', {
          component: 'IntegrationOrchestratorService',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    try {
      loggingService.info('🔗 Starting integration chain execution', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeChain',
        userId,
        stepsCount: steps.length
      });

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStartTime = Date.now();
        
        // Replace template variables in step params with context values
        const processedStep = {
          ...step,
          params: this.replaceTemplateVariables(step.params, context)
        };

        onProgress({
          step: i + 1,
          total: steps.length,
          status: 'running',
          action: processedStep.action,
          timestamp: new Date()
        });

        loggingService.info(`▶️  Executing step ${i + 1}/${steps.length}`, {
          component: 'IntegrationOrchestratorService',
          operation: 'executeChain',
          step: processedStep.id,
          integration: processedStep.integration,
          action: processedStep.action
        });

        try {
          let result: any;

          switch (processedStep.integration) {
            case 'mongodb':
              result = await this.executeMongoDBStep(processedStep, userId);
              break;

            case 'github':
              result = await this.executeGitHubStep(processedStep, userId, context);
              break;

            case 'google':
              result = await this.executeGoogleStep(processedStep, userId);
              break;

            case 'jira':
              result = await this.executeJiraStep(processedStep, userId);
              break;

            case 'vercel':
              result = await this.executeVercelStep(processedStep, userId, context);
              break;

            default:
              throw new Error(`Unsupported integration: ${processedStep.integration}`);
          }

          const stepDuration = Date.now() - stepStartTime;
          
          // Store result in context for future steps
          context[processedStep.id] = result;

          results.push({
            step: processedStep.id,
            result,
            success: true,
            duration: stepDuration
          });

          onProgress({
            step: i + 1,
            total: steps.length,
            status: 'completed',
            action: processedStep.action,
            result,
            timestamp: new Date()
          });

          loggingService.info(`✅ Step completed`, {
            component: 'IntegrationOrchestratorService',
            operation: 'executeChain',
            step: processedStep.id,
            duration: stepDuration
          });

        } catch (stepError) {
          const stepDuration = Date.now() - stepStartTime;
          const errorMessage = stepError instanceof Error ? stepError.message : String(stepError);

          results.push({
            step: processedStep.id,
            result: { error: errorMessage },
            success: false,
            duration: stepDuration
          });

          onProgress({
            step: i + 1,
            total: steps.length,
            status: 'failed',
            action: processedStep.action,
            error: errorMessage,
            timestamp: new Date()
          });

          loggingService.error(`❌ Step failed`, {
            component: 'IntegrationOrchestratorService',
            operation: 'executeChain',
            step: processedStep.id,
            error: errorMessage
          });

          // Stop execution on first failure
          throw new Error(`Step '${processedStep.id}' failed: ${errorMessage}`);
        }
      }

      const totalDuration = Date.now() - startTime;

      loggingService.info('✅ Integration chain completed successfully', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeChain',
        stepsCount: steps.length,
        totalDuration
      });

      return {
        success: true,
        results,
        totalDuration
      };

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      loggingService.error('❌ Integration chain failed', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeChain',
        error: errorMessage,
        completedSteps: results.filter(r => r.success).length,
        totalSteps: steps.length,
        totalDuration
      });

      return {
        success: false,
        results,
        totalDuration,
        error: errorMessage
      };
    }
  }

  /**
   * Execute MongoDB integration step
   */
  private static async executeMongoDBStep(step: IntegrationStep, userId: string): Promise<any> {
    try {
      loggingService.info('Executing MongoDB step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action
      });

      // Get MongoDB connection for the user
      const mongoConnection = await Integration.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        type: 'mongodb',
        status: 'active'
      });

      if (!mongoConnection) {
        throw new Error(
          'MongoDB integration not connected. ' +
          'Please connect MongoDB from the Integrations page or skip MongoDB-related steps.'
        );
      }

      // Import mongoose to query the database directly
      const db = mongoose.connection.db;
      const collection = db?.collection(step.params.collection || 'users');

      let result: any;

      switch (step.action) {
        case 'query':
        case 'find':
          result = await collection?.find(step.params.query || {}).limit(step.params.limit || 100).toArray();
          break;

        case 'findOne':
          result = await collection?.findOne(step.params.query || {});
          break;

        case 'insert':
        case 'insertOne':
          result = await collection?.insertOne(step.params.document);
          break;

        case 'insertMany':
          result = await collection?.insertMany(step.params.documents);
          break;

        case 'update':
        case 'updateOne':
          result = await collection?.updateOne(step.params.filter || {}, step.params.update);
          break;

        case 'updateMany':
          result = await collection?.updateMany(step.params.filter || {}, step.params.update);
          break;

        case 'delete':
        case 'deleteOne':
          result = await collection?.deleteOne(step.params.filter || {});
          break;

        case 'deleteMany':
          result = await collection?.deleteMany(step.params.filter || {});
          break;

        case 'count':
        case 'countDocuments':
          result = await collection?.countDocuments(step.params.query || {});
          break;

        case 'aggregate':
          result = await collection?.aggregate(step.params.pipeline || []).toArray();
          break;

        default:
          throw new Error(`Unsupported MongoDB action: ${step.action}`);
      }

      loggingService.info('MongoDB step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
        recordsAffected: Array.isArray(result) ? result.length : 1
      });

      return {
        integration: 'mongodb',
        action: step.action,
        result,
        recordCount: Array.isArray(result) ? result.length : 1
      };
    } catch (error) {
      loggingService.error('MongoDB step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Execute GitHub integration step
   */
  private static async executeGitHubStep(step: IntegrationStep, userId: string, context?: Record<string, any>): Promise<any> {
    try {
      loggingService.info('Executing GitHub step via MCP', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
        userId
      });

      // Use MCP instead of direct GitHub API calls
      const { MCPClientService } = await import('./mcp-client.service');
      
      const initialized = await MCPClientService.initialize(userId);
      if (!initialized) {
        throw new Error('Failed to initialize MCP');
      }
      
      // Build natural language command from step
      let naturalCommand = '';
      const params = (step as any).params || (step as any).parameters || {};
      
      switch (step.action) {
        case 'create_issue':
          naturalCommand = `Create a GitHub issue in repository ${params.repository || context?.repository} with title "${params.title}" and body "${params.body}"`;
          break;
          
        case 'create_pull_request':
          naturalCommand = `Create a pull request in repository ${params.repository || context?.repository} from branch "${params.head}" to "${params.base}" with title "${params.title}" and body "${params.body}"`;
          break;
          
        case 'list_issues':
          naturalCommand = `List GitHub issues in repository ${params.repository || context?.repository} ${params.state ? `with state ${params.state}` : ''}`;
          break;
          
        case 'list_pull_requests':
          naturalCommand = `List pull requests in repository ${params.repository || context?.repository} ${params.state ? `with state ${params.state}` : ''}`;
          break;
          
        case 'get_issue':
          naturalCommand = `Get GitHub issue #${params.issue_number} from repository ${params.repository || context?.repository}`;
          break;
          
        case 'update_issue':
          naturalCommand = `Update GitHub issue #${params.issue_number} in repository ${params.repository || context?.repository} ${params.state ? `to state ${params.state}` : ''} ${params.title ? `with title "${params.title}"` : ''} ${params.body ? `and body "${params.body}"` : ''}`;
          break;
          
        case 'merge_pull_request':
          naturalCommand = `Merge pull request #${params.pull_number} in repository ${params.repository || context?.repository}`;
          break;
          
        case 'create_repository':
          naturalCommand = `Create a new GitHub repository named "${params.name}" ${params.description ? `with description "${params.description}"` : ''} ${params.private ? 'as private' : 'as public'}`;
          break;
          
        case 'list_repositories':
          naturalCommand = `List my GitHub repositories`;
          break;
          
        case 'get_repository':
          naturalCommand = `Get information about GitHub repository ${params.repository || context?.repository}`;
          break;
          
        case 'create_branch':
          naturalCommand = `Create a new branch "${params.branch}" in repository ${params.repository || context?.repository}`;
          break;
          
        case 'list_branches':
          naturalCommand = `List branches in repository ${params.repository || context?.repository}`;
          break;
          
        case 'commit_files':
          naturalCommand = `Commit files to repository ${params.repository || context?.repository} on branch "${params.branch}" with message "${params.message}"`;
          break;
          
        default:
          naturalCommand = `Execute GitHub action: ${step.action} with parameters ${JSON.stringify(params)}`;
      }
      
      // Find relevant GitHub tools
      const tools = await MCPClientService.findToolsForIntent(userId, naturalCommand, ['github']);
      
      if (tools.length === 0) {
        throw new Error(`No GitHub tools available for action: ${step.action}`);
      }
      
      // Execute via MCP
      const result = await MCPClientService.executeWithAI(
        userId,
        tools[0].name,
        naturalCommand,
        {
          step,
          context,
          parameters: params
        }
      );
      
      if (!result.success) {
        throw new Error(result.error?.message || `Failed to execute GitHub action: ${step.action}`);
      }
      
      loggingService.info('GitHub step executed successfully via MCP', {
        component: 'IntegrationOrchestratorService',
        stepId: step.id,
        action: step.action,
        tool: tools[0].name,
        resultKeys: Object.keys(result.data || {})
      });
      
      return result.data;
    } catch (error) {
      loggingService.error('Failed to execute GitHub step via MCP', {
        component: 'IntegrationOrchestratorService',
        stepId: step.id,
        action: step.action,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Execute Google integration step
   */
  private static async executeGoogleStep(step: IntegrationStep, userId: string): Promise<any> {
    try {
      loggingService.info('Executing Google step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action
      });

      // Get Google connection for the user
      const googleConnection = await Integration.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        type: 'google_oauth',
        status: 'active'
      }).select('+credentials.encryptedAccessToken +credentials.encryptedRefreshToken +credentials.iv');

      if (!googleConnection) {
        throw new Error(
          'Google integration not connected. ' +
          'Please connect Google from the Integrations page to enable Google Docs and Drive operations.'
        );
      }

      // Add decryptToken method
      const connectionWithDecrypt = Object.assign(googleConnection.toObject(), {
        decryptToken: () => googleConnection.get('credentials.accessToken') || googleConnection.get('credentials.encryptedAccessToken') || '',
        decryptRefreshToken: () => googleConnection.get('credentials.refreshToken') || googleConnection.get('credentials.encryptedRefreshToken') || ''
      });

      let result: any;

      switch (step.action) {
        case 'list_files':
        case 'listDriveFiles':
          result = await GoogleService.listDriveFiles(
            connectionWithDecrypt as any,
            {
              query: step.params.query,
              pageSize: step.params.maxResults || 100,
              pageToken: step.params.pageToken,
              orderBy: step.params.orderBy
            }
          );
          break;

        case 'get_file':
        case 'getDriveFile':
          result = await GoogleService.getDriveFile(
            connectionWithDecrypt as any,
            step.params.fileId
          );
          break;

        case 'create_sheet':
        case 'createSpreadsheet':
          result = await GoogleService.createSpreadsheet(
            connectionWithDecrypt as any,
            step.params.title || 'New Spreadsheet',
            step.params.headers || []
          );
          break;

        case 'append_sheet':
        case 'appendToSpreadsheet':
          result = await GoogleService.appendToSpreadsheet(
            connectionWithDecrypt as any,
            step.params.spreadsheetId,
            step.params.range || 'Sheet1',
            step.params.data
          );
          break;

        case 'read_sheet':
        case 'readSpreadsheet':
          result = await GoogleService.readSpreadsheet(
            connectionWithDecrypt as any,
            step.params.spreadsheetId,
            step.params.range || 'Sheet1!A1:Z1000'
          );
          break;

        case 'create_doc':
        case 'createDocument':
          result = await GoogleService.createDocument(
            connectionWithDecrypt as any,
            step.params.title || 'New Document'
          );
          // If content is provided, insert it after creation
          if (step.params.content && result.documentId) {
            await GoogleService.insertTextIntoDocument(
              connectionWithDecrypt as any,
              result.documentId,
              step.params.content,
              1
            );
          }
          break;

        case 'read_doc':
        case 'readDocument':
          result = await GoogleService.readDocument(
            connectionWithDecrypt as any,
            step.params.documentId
          );
          break;

        case 'insert_text':
        case 'insertTextIntoDocument':
          result = await GoogleService.insertTextIntoDocument(
            connectionWithDecrypt as any,
            step.params.documentId,
            step.params.text,
            step.params.index || 1
          );
          break;

        case 'upload_file':
        case 'uploadFileToDrive':
          result = await GoogleService.uploadFileToDrive(
            connectionWithDecrypt as any,
            step.params.fileName,
            step.params.mimeType,
            step.params.fileBuffer,
            step.params.folderId
          );
          break;

        case 'share_file':
        case 'shareFile':
          result = await GoogleService.shareFile(
            connectionWithDecrypt as any,
            step.params.fileId,
            step.params.email,
            step.params.role || 'reader'
          );
          break;

        case 'create_folder':
        case 'createFolder':
          result = await GoogleService.createFolder(
            connectionWithDecrypt as any,
            step.params.folderName,
            step.params.parentFolderId
          );
          break;

        case 'list_docs':
        case 'listDocuments':
          result = await GoogleService.listDocuments(
            connectionWithDecrypt as any,
            step.params.maxResults || 100
          );
          break;

        case 'list_sheets':
        case 'listSpreadsheets':
          result = await GoogleService.listSpreadsheets(
            connectionWithDecrypt as any,
            step.params.maxResults || 100
          );
          break;

        default:
          throw new Error(`Unsupported Google action: ${step.action}`);
      }

      loggingService.info('Google step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action
      });

      return {
        integration: 'google',
        action: step.action,
        result
      };
    } catch (error) {
      loggingService.error('Google step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Execute JIRA integration step
   */
  private static async executeJiraStep(step: IntegrationStep, userId: string): Promise<any> {
    try {
      loggingService.info('Executing JIRA step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action
      });

      // Get JIRA connection for the user
      const jiraConnection = await Integration.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        type: 'jira_webhook',
        status: 'active'
      }).select('+credentials.encryptedAccessToken +credentials.iv');

      if (!jiraConnection) {
        throw new Error(
          'JIRA integration not connected. ' +
          'Please connect JIRA from the Integrations page to enable issue management.'
        );
      }

      const siteUrl = jiraConnection.get('credentials.siteUrl') || '';
      const accessToken = jiraConnection.get('credentials.accessToken') || jiraConnection.get('credentials.encryptedAccessToken') || '';

      let result: any;

      switch (step.action) {
        case 'list_projects':
        case 'listProjects':
          result = await JiraService.listProjects(siteUrl, accessToken);
          break;

        case 'create_issue':
        case 'createIssue':
          result = await JiraService.createIssue(
            siteUrl,
            accessToken,
            {
              projectKey: step.params.projectKey,
              title: step.params.summary,
              description: step.params.description || '',
              issueTypeId: step.params.issueTypeId || 'Task',
              priorityId: step.params.priorityId,
              labels: step.params.labels,
              components: step.params.components
            }
          );
          break;

        case 'list_issues':
        case 'listIssues':
          result = await JiraService.listIssues(
            siteUrl,
            accessToken,
            step.params.jql || 'assignee = currentUser() ORDER BY created DESC',
            step.params.maxResults || 50
          );
          break;

        case 'get_issue':
        case 'getIssue':
          result = await JiraService.getIssue(siteUrl, accessToken, step.params.issueKey);
          break;

        case 'update_issue':
        case 'updateIssue':
          result = await JiraService.updateIssue(
            siteUrl,
            accessToken,
            step.params.issueKey,
            {
              summary: step.params.summary,
              description: step.params.description,
              priorityId: step.params.priorityId,
              labels: step.params.labels
            }
          );
          break;

        case 'add_comment':
        case 'addComment':
          result = await JiraService.addComment(
            siteUrl,
            accessToken,
            step.params.issueKey,
            step.params.comment
          );
          break;

        case 'get_issue_types':
        case 'getIssueTypes':
          result = await JiraService.getIssueTypes(siteUrl, accessToken, step.params.projectKey);
          break;

        case 'list_priorities':
        case 'listPriorities':
          result = await JiraService.listPriorities(siteUrl, accessToken);
          break;

        default:
          throw new Error(`Unsupported JIRA action: ${step.action}`);
      }

      loggingService.info('JIRA step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action
      });

      return {
        integration: 'jira',
        action: step.action,
        result
      };
    } catch (error) {
      loggingService.error('JIRA step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Execute Vercel integration step
   */
  private static async executeVercelStep(
    step: IntegrationStep, 
    userId: string,
    context?: Record<string, any>
  ): Promise<any> {
    try {
      loggingService.info('Executing Vercel step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action
      });

      // Import VercelConnection model
      const { VercelConnection } = await import('../models/VercelConnection');
      
      const vercelConnection = await VercelConnection.findOne({
        userId: userId,
        isActive: true
      });

      if (!vercelConnection) {
        throw new Error(
          'Vercel integration not connected. ' +
          'Please connect Vercel from the Integrations page to enable deployments.'
        );
      }

      const connectionId = (vercelConnection._id as mongoose.Types.ObjectId).toString();

      let result: any;

      switch (step.action) {
        case 'list_projects':
        case 'listProjects':
          result = await VercelMCPService.listProjects(connectionId, step.params.limit || 100);
          break;

        case 'list_deployments':
        case 'listDeployments':
          result = await VercelMCPService.listDeployments(
            connectionId,
            step.params.projectId,
            step.params.limit || 20
          );
          break;

        case 'get_project':
        case 'getProjectDetails':
          result = await VercelMCPService.getProjectDetails(connectionId, step.params.projectId);
          break;

        case 'get_deployment':
        case 'getDeploymentDetails':
          result = await VercelMCPService.getDeploymentDetails(connectionId, step.params.deploymentId);
          break;

        case 'get_build_logs':
        case 'getDeploymentBuildLogs':
          result = await VercelMCPService.getDeploymentBuildLogs(connectionId, step.params.deploymentId);
          break;

        case 'list_domains':
        case 'listDomains':
          result = await VercelMCPService.listDomains(connectionId, step.params.projectId);
          break;

        case 'list_env_vars':
        case 'listEnvVars':
          result = await VercelMCPService.listEnvVars(connectionId, step.params.projectId);
          break;

        case 'set_env_var':
        case 'setEnvVar':
          result = await VercelMCPService.setEnvVar(
            connectionId,
            step.params.projectId,
            step.params.key,
            step.params.value,
            step.params.target || ['production', 'preview', 'development']
          );
          break;

        case 'trigger_deployment':
        case 'triggerDeployment':
        case 'deploy':
        case 'connect':
          // If gitSource is provided but no projectId, we need to find or create the project
          let projectId = step.params.projectId;
          
          if (!projectId && step.params.gitSource) {
            loggingService.info('No projectId provided, looking for existing project or creating new one', {
              component: 'IntegrationOrchestratorService',
              gitSource: step.params.gitSource
            });
            
            // Extract repo name and owner from gitSource
            const repoPath = step.params.gitSource.repo || '';
            const repoMatch = repoPath.match(/([^\/]+)$/);
            const repoName = repoMatch ? repoMatch[1] : null;
            
            if (repoName) {
              // Try to find existing project by name
              try {
                const projects = await VercelMCPService.listProjects(connectionId, 100);
                let existingProject = projects.find((p: any) => 
                  p.name === repoName || 
                  p.name === repoName.toLowerCase() ||
                  p.name === repoName.replace(/[^a-z0-9-]/g, '-')
                );
                
                if (existingProject) {
                  // Check if the project has a Git connection
                  const projectDetails = await VercelMCPService.getProject(connectionId, existingProject.id);
                  
                  if (!projectDetails.link) {
                    loggingService.warn('Found existing Vercel project without Git connection, will delete and recreate', {
                      component: 'IntegrationOrchestratorService',
                      projectId: existingProject.id,
                      projectName: existingProject.name
                    });
                    
                    // Delete the project without Git connection
                    try {
                      await VercelMCPService.deleteProject(connectionId, existingProject.id);
                      loggingService.info('Deleted Vercel project without Git connection', {
                        component: 'IntegrationOrchestratorService',
                        projectId: existingProject.id,
                        projectName: existingProject.name
                      });
                      
                      // Force creation of new project with Git link
                      existingProject = null;
                    } catch (deleteError: any) {
                      loggingService.error('Failed to delete Vercel project', {
                        component: 'IntegrationOrchestratorService',
                        projectId: existingProject.id,
                        error: deleteError.message
                      });
                      // Continue with the existing project
                      projectId = existingProject.id;
                    }
                  } else {
                    projectId = existingProject.id;
                    loggingService.info('Found existing Vercel project with Git connection', {
                      component: 'IntegrationOrchestratorService',
                      projectId,
                      projectName: existingProject.name,
                      gitRepo: projectDetails.link.repo
                    });
                  }
                }
                
                if (!existingProject) {
                  // Create new Vercel project
                  loggingService.info('Creating new Vercel project for repository', {
                    component: 'IntegrationOrchestratorService',
                    repoName,
                    gitSource: step.params.gitSource
                  });
                  
                  // Get GitHub username from context if available
                  let githubOwner = (context as any).username || (context as any).githubOwner;
                  
                  // If not in context, try to get it from previous GitHub step results
                  if (!githubOwner || githubOwner === 'owner') {
                    // Look for username from step_1 or step_2 results (GitHub create steps)
                    for (const stepKey of ['step_1', 'step_2']) {
                      const githubStepResult = (context as any)[stepKey];
                      if (githubStepResult) {
                        // Try multiple ways to extract owner
                        if (githubStepResult.owner && githubStepResult.owner.login) {
                          githubOwner = githubStepResult.owner.login;
                          break;
                        } else if (typeof githubStepResult.html_url === 'string') {
                          const urlMatch = githubStepResult.html_url.match(/github\.com\/([^\/]+)\//);
                          if (urlMatch) {
                            githubOwner = urlMatch[1];
                            break;
                          }
                        } else if (typeof githubStepResult.full_name === 'string') {
                          const nameMatch = githubStepResult.full_name.split('/')[0];
                          if (nameMatch) {
                            githubOwner = nameMatch;
                            break;
                          }
                        }
                      }
                    }
                    
                    if (githubOwner && githubOwner !== 'owner') {
                      loggingService.info('Extracted GitHub owner from previous step result', {
                        component: 'IntegrationOrchestratorService',
                        githubOwner
                      });
                    }
                  }
                  
                  // If still not found, try to extract from the repo path itself
                  if (!githubOwner || githubOwner === 'owner') {
                    // Check if the repoPath already contains owner info (e.g., "abdulgeek/todo-frontend")
                    if (repoPath.includes('/')) {
                      const pathParts = repoPath.split('/');
                      if (pathParts.length >= 2 && pathParts[0] && !pathParts[0].startsWith('.')) {
                        githubOwner = pathParts[0];
                        loggingService.info('Extracted GitHub owner from repo path', {
                          component: 'IntegrationOrchestratorService',
                          githubOwner,
                          repoPath
                        });
                      }
                    }
                  }
                  
                  // Always try to get GitHub username dynamically from connected account
                  if (!githubOwner || githubOwner === 'owner') {
                    try {
                      // Get GitHub connection for this user
                      const githubConnection = await GitHubConnection.findOne({
                        userId,
                        isActive: true
                      });
                      
                      if (githubConnection) {
                        // First check if we have stored username
                        if (githubConnection.githubUsername) {
                          githubOwner = githubConnection.githubUsername;
                          loggingService.info('Retrieved GitHub owner from stored connection', {
                            component: 'IntegrationOrchestratorService',
                            githubOwner
                          });
                        } else {
                          // Fetch from GitHub API
                          const { GitHubService } = await import('./github.service');
                          const octokit = await (GitHubService as any).createOctokitFromToken(
                            githubConnection.decryptToken()
                          );
                          const { data: user } = await octokit.rest.users.getAuthenticated();
                          githubOwner = user.login;
                          
                          // Store username for future use
                          await GitHubConnection.findByIdAndUpdate(
                            githubConnection._id,
                            { 
                              $set: { 
                                githubUsername: user.login,
                                githubUserId: user.id,
                                avatarUrl: user.avatar_url
                              } 
                            },
                            { new: true }
                          );
                          
                          loggingService.info('Retrieved and stored GitHub owner from API', {
                            component: 'IntegrationOrchestratorService',
                            githubOwner
                          });
                        }
                      } else {
                        loggingService.error('No active GitHub connection found for user', {
                          component: 'IntegrationOrchestratorService',
                          userId
                        });
                      }
                    } catch (apiError: any) {
                      loggingService.error('Failed to get GitHub owner from connection', {
                        component: 'IntegrationOrchestratorService',
                        error: apiError.message,
                        stack: apiError.stack
                      });
                    }
                  }
                  
                  // Try one more approach - check if step params has owner info
                  if ((!githubOwner || githubOwner === 'owner') && step.params.owner) {
                    githubOwner = step.params.owner;
                    loggingService.info('Using GitHub owner from step params', {
                      component: 'IntegrationOrchestratorService',
                      githubOwner
                    });
                  }
                  
                  // Final fallback - if we still don't have owner, it's a critical error
                  if (!githubOwner || githubOwner === 'owner') {
                    const errorMsg = 'Could not determine GitHub owner. Please reconnect your GitHub account.';
                    loggingService.error(errorMsg, {
                      component: 'IntegrationOrchestratorService',
                      contextKeys: Object.keys(context || {}),
                      step1: (context as any).step_1,
                      step2: (context as any).step_2,
                      repoPath,
                      stepParams: step.params,
                      userId
                    });
                    throw new Error(errorMsg);
                  }
                  
                  // Clean up repo path and construct full path with owner
                  const cleanRepoPath = repoPath.replace(/^\/+/, ''); // Remove leading slashes
                  const fullRepoPath = cleanRepoPath.includes('/') ? cleanRepoPath : `${githubOwner}/${cleanRepoPath}`;
                  
                  loggingService.info('Preparing Vercel project creation with Git link', {
                    component: 'IntegrationOrchestratorService',
                    repoName,
                    githubOwner,
                    fullRepoPath,
                    framework: step.params.framework || null
                  });
                  
                  try {
                    const newProject = await VercelMCPService.createProject(
                      connectionId,
                      repoName,
                      {
                        framework: step.params.framework || null,
                        gitRepository: {
                          type: 'github',
                          repo: fullRepoPath
                        }
                      }
                    );
                    
                    projectId = newProject.id;
                    loggingService.info('Created new Vercel project with Git link', {
                      component: 'IntegrationOrchestratorService',
                      projectId,
                      projectName: newProject.name
                    });
                  } catch (gitLinkError: any) {
                    // If GitHub app not installed, create project without Git link
                    const errorMessage = gitLinkError.message || '';
                    const originalMessage = gitLinkError.originalMessage || '';
                    
                    // Safely stringify error without circular references
                    let errorString = '';
                    try {
                      errorString = JSON.stringify({
                        message: gitLinkError.message,
                        originalMessage: gitLinkError.originalMessage,
                        errorCode: gitLinkError.errorCode,
                        stack: gitLinkError.stack
                      });
                    } catch (stringifyError) {
                      errorString = errorMessage + ' ' + originalMessage;
                    }
                    
                    // Check all possible places where the GitHub App error might be
                    const isGitHubAppError = errorMessage.includes('GitHub integration') || 
                                           errorMessage.includes('Install GitHub') ||
                                           errorMessage.includes('install the GitHub integration') ||
                                           errorMessage.includes('link a GitHub repository') ||
                                           originalMessage.includes('GitHub integration') ||
                                           originalMessage.includes('Install GitHub') ||
                                           originalMessage.includes('install the GitHub integration') ||
                                           originalMessage.includes('link a GitHub repository') ||
                                           errorString.includes('GitHub integration') ||
                                           errorString.includes('Install GitHub');
                    
                    loggingService.warn('Vercel project creation with Git link failed', {
                      component: 'IntegrationOrchestratorService',
                      repoName,
                      error: errorMessage,
                      originalMessage,
                      fullRepoPath,
                      isGitHubAppError
                    });
                    
                    if (isGitHubAppError) {
                      loggingService.info('Detected GitHub App not installed, creating project without Git link', {
                        component: 'IntegrationOrchestratorService',
                        repoName
                      });
                      
                      // Create project without Git repository link
                      const newProject = await VercelMCPService.createProject(
                        connectionId,
                        repoName,
                        {
                          framework: step.params.framework || null
                        }
                      );
                      
                      projectId = newProject.id;
                      loggingService.info('Created new Vercel project (without Git link)', {
                        component: 'IntegrationOrchestratorService',
                        projectId,
                        projectName: newProject.name,
                        note: 'Install Vercel GitHub App at https://github.com/apps/vercel to enable Git linking'
                      });
                      
                      // Get teamId from connection for dashboard URL
                      const vercelConnection = await Integration.findById(connectionId);
                      const teamId = (vercelConnection as any)?.teamId;
                      
                      // Return early with a message about manual deployment needed
                      return {
                        success: true,
                        projectId,
                        projectName: newProject.name,
                        message: `Vercel project "${newProject.name}" created successfully, but without Git integration. ` +
                                `To deploy: 1) Install the Vercel GitHub App at https://github.com/apps/vercel, ` +
                                `2) Link your GitHub repository "${repoName}" to this project in Vercel dashboard, ` +
                                `3) Push code to trigger automatic deployment.`,
                        requiresManualSetup: true,
                        dashboardUrl: `https://vercel.com/${teamId ? `${teamId}/` : ''}${newProject.name}/settings/git`
                      };
                    } else {
                      throw gitLinkError;
                    }
                  }
                }
              } catch (error: any) {
                loggingService.error('Failed to find or create Vercel project', {
                  component: 'IntegrationOrchestratorService',
                  repoName,
                  error: error.message
                });
                throw new Error(
                  `Failed to prepare Vercel project for deployment: ${error.message}. ` +
                  `Please install the Vercel GitHub App at https://github.com/apps/vercel ` +
                  `or manually create a Vercel project at vercel.com/new ` +
                  `and link it to your GitHub repository "${repoName}".`
                );
              }
            } else {
              throw new Error(
                'Unable to determine repository name from gitSource. ' +
                'Please provide projectId or valid gitSource.repo parameter.'
              );
            }
          }
          
          if (!projectId) {
            throw new Error(
              'Vercel projectId is required. Either provide projectId parameter or ' +
              'create a Vercel project at vercel.com/new and link it to your GitHub repository.'
            );
          }
          
          // Trigger deployment
          result = await VercelMCPService.triggerDeployment(
            connectionId,
            projectId,
            step.params.target || 'preview'
          );
          break;

        case 'rollback':
        case 'rollbackDeployment':
          result = await VercelMCPService.rollbackDeployment(
            connectionId,
            step.params.projectId,
            step.params.deploymentId
          );
          break;

        case 'add_domain':
        case 'addDomain':
          result = await VercelMCPService.addDomain(
            connectionId,
            step.params.projectId,
            step.params.domain
          );
          break;

        case 'remove_domain':
        case 'removeDomain':
          result = await VercelMCPService.removeDomain(
            connectionId,
            step.params.projectId,
            step.params.domain
          );
          break;

        case 'check_health':
        case 'checkHealth':
          result = await VercelMCPService.checkHealth(connectionId);
          break;

        default:
          throw new Error(`Unsupported Vercel action: ${step.action}`);
      }

      loggingService.info('Vercel step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action
      });

      // Extract important information from the result
      let extractedData: any = {
        integration: 'vercel',
        action: step.action,
        success: true
      };

      // Extract URLs and important data based on action
      if ((step.action === 'deploy' || step.action === 'connect' || step.action === 'triggerDeployment') && result) {
        if (result.url) {
          extractedData.url = `https://${result.url}`;
          extractedData.deploymentId = result.uid;
          extractedData.state = result.state;
          extractedData.message = result.message || `Deployment ${result.state || 'triggered'} successfully`;
        } else if (result.projectId) {
          // If no URL yet, provide project link
          extractedData.url = `https://vercel.com/dashboard/project/${result.projectId}`;
          extractedData.projectId = result.projectId;
          extractedData.message = result.message || 'Project configured for automatic Git deployments';
        }
        
        // Add instructions if present
        if (result.instructions) {
          extractedData.instructions = result.instructions;
        }
      }

      // Include the full result for reference
      extractedData.fullResult = result;

      return extractedData;
    } catch (error) {
      loggingService.error('Vercel step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Execute steps in parallel (for independent steps)
   */
  static async executeParallel(
    steps: IntegrationStep[],
    userId: string,
    onProgress: (update: ProgressUpdate) => void
  ): Promise<ChainResult> {
    const startTime = Date.now();

    try {
      loggingService.info('⚡ Starting parallel integration execution', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeParallel',
        userId,
        stepsCount: steps.length
      });

      const promises = steps.map(async (step, index) => {
        const stepStartTime = Date.now();

        onProgress({
          step: index + 1,
          total: steps.length,
          status: 'running',
          action: step.action,
          timestamp: new Date()
        });

        try {
          let result: any;

          switch (step.integration) {
            case 'mongodb':
              result = await this.executeMongoDBStep(step, userId);
              break;
            case 'github':
              result = await this.executeGitHubStep(step, userId, undefined);
              break;
            case 'google':
              result = await this.executeGoogleStep(step, userId);
              break;
            case 'jira':
              result = await this.executeJiraStep(step, userId);
              break;
            case 'vercel':
              result = await this.executeVercelStep(step, userId, undefined);
              break;
            default:
              throw new Error(`Unsupported integration: ${step.integration}`);
          }

          const duration = Date.now() - stepStartTime;

          onProgress({
            step: index + 1,
            total: steps.length,
            status: 'completed',
            action: step.action,
            result,
            timestamp: new Date()
          });

          return {
            step: step.id,
            result,
            success: true,
            duration
          };

        } catch (error) {
          const duration = Date.now() - stepStartTime;
          const errorMessage = error instanceof Error ? error.message : String(error);

          onProgress({
            step: index + 1,
            total: steps.length,
            status: 'failed',
            action: step.action,
            error: errorMessage,
            timestamp: new Date()
          });

          return {
            step: step.id,
            result: { error: errorMessage },
            success: false,
            duration
          };
        }
      });

      const results = await Promise.all(promises);
      const totalDuration = Date.now() - startTime;
      const success = results.every(r => r.success);

      loggingService.info('✅ Parallel integration execution completed', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeParallel',
        success,
        successfulSteps: results.filter(r => r.success).length,
        totalSteps: steps.length,
        totalDuration
      });

      return {
        success,
        results,
        totalDuration
      };

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      loggingService.error('❌ Parallel integration execution failed', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeParallel',
        error: errorMessage,
        totalDuration
      });

      return {
        success: false,
        results: [],
        totalDuration,
        error: errorMessage
      };
    }
  }
}
