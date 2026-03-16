import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { GitHubMcpService } from '../../mcp/services/integrations/github-mcp.service';
import { VercelMcpService } from '../../mcp/services/integrations/vercel-mcp.service';
import { JiraMcpService } from '../../mcp/services/integrations/jira-mcp.service';
import { GoogleMcpService } from '../../mcp/services/integrations/google-mcp.service';
import { MongoDbMcpService } from '../../mcp/services/integrations/mongodb-mcp.service';
import { AwsMcpService } from '../../mcp/services/integrations/aws-mcp.service';
import {
  IntegrationStep,
  ProgressUpdate,
  ChainResult,
} from '../interfaces/governed-agent.interfaces';

@Injectable()
export class IntegrationOrchestratorService {
  constructor(
    private readonly logger: LoggerService,
    private readonly githubService: GitHubMcpService,
    private readonly vercelService: VercelMcpService,
    private readonly jiraService: JiraMcpService,
    private readonly googleService: GoogleMcpService,
    private readonly mongoService: MongoDbMcpService,
    private readonly awsService: AwsMcpService,
  ) {}

  /**
   * Replace template variables in step parameters
   * Supports {{username}}, {{email}}, and references to previous step results
   */
  private replaceTemplateVariables(
    params: Record<string, any>,
    context: Record<string, any>,
  ): Record<string, any> {
    const replaced: Record<string, any> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        // Replace {{username}} with actual username from context
        let replacedValue = value.replace(
          /\{\{username\}\}/g,
          context.username || context.githubOwner || '',
        );
        // Replace {{email}} with actual email from context
        replacedValue = replacedValue.replace(
          /\{\{email\}\}/g,
          context.email || '',
        );

        // Special case: Replace "auto-detected" with actual GitHub owner
        if (
          key === 'owner' &&
          (replacedValue === 'auto-detected' ||
            replacedValue === '{{username}}')
        ) {
          replacedValue = context.username || context.githubOwner || '';
        }
        if (key === 'repo' && replacedValue.includes('auto-detected/')) {
          replacedValue = replacedValue.replace(
            'auto-detected/',
            `${context.username || context.githubOwner || ''}/`,
          );
        }

        // Replace references to previous step results like {{step_1.repoUrl}}
        replacedValue = replacedValue.replace(
          /\{\{([^}]+)\}\}/g,
          (match, path) => {
            const parts = path.split('.');
            let result: any = context;
            for (const part of parts) {
              result = result?.[part];
            }
            return result !== undefined ? String(result) : match;
          },
        );
        replaced[key] = replacedValue;
      } else if (Array.isArray(value)) {
        // Recursively replace in arrays
        replaced[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? this.replaceTemplateVariables(item, context)
            : item,
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
  async executeChain(
    steps: IntegrationStep[],
    userId: string,
    onProgress: (update: ProgressUpdate) => void,
  ): Promise<ChainResult> {
    const startTime = Date.now();
    const results: ChainResult['results'] = [];

    // Build context for template variable replacement
    const context: Record<string, any> = {
      userId,
    };

    // If we have GitHub steps, fetch the GitHub username upfront for template replacement
    const hasGitHubSteps = steps.some((s) => s.integration === 'github');
    if (hasGitHubSteps) {
      try {
        // Try to get GitHub username from connection (if available)
        // This would typically be done via the MCP service
        this.logger.log(
          'GitHub steps detected - context will be populated during execution',
          {
            component: 'IntegrationOrchestratorService',
            userId,
          },
        );
      } catch (error) {
        this.logger.warn('Failed to initialize GitHub context', {
          component: 'IntegrationOrchestratorService',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      this.logger.log('Starting integration chain execution', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeChain',
        userId,
        stepsCount: steps.length,
      });

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStartTime = Date.now();

        // Replace template variables in step params with context values
        const processedStep = {
          ...step,
          params: this.replaceTemplateVariables(step.params, context),
        };

        onProgress({
          step: i + 1,
          total: steps.length,
          status: 'running',
          action: processedStep.action,
          timestamp: new Date(),
        });

        this.logger.log(`Executing step ${i + 1}/${steps.length}`, {
          component: 'IntegrationOrchestratorService',
          operation: 'executeChain',
          step: processedStep.id,
          integration: processedStep.integration,
          action: processedStep.action,
        });

        try {
          let result: any;

          switch (processedStep.integration) {
            case 'mongodb':
              result = await this.executeMongoDBStep(processedStep, userId);
              break;

            case 'github':
              result = await this.executeGitHubStep(
                processedStep,
                userId,
                context,
              );
              break;

            case 'google':
              result = await this.executeGoogleStep(processedStep, userId);
              break;

            case 'jira':
              result = await this.executeJiraStep(processedStep, userId);
              break;

            case 'vercel':
              result = await this.executeVercelStep(
                processedStep,
                userId,
                context,
              );
              break;

            case 'aws':
              result = await this.executeAwsStep(processedStep, userId);
              break;

            default:
              throw new Error(
                `Unsupported integration: ${processedStep.integration}`,
              );
          }

          const stepDuration = Date.now() - stepStartTime;

          // Store result in context for future steps
          context[processedStep.id] = result;

          results.push({
            step: processedStep.id,
            result,
            success: true,
            duration: stepDuration,
          });

          onProgress({
            step: i + 1,
            total: steps.length,
            status: 'completed',
            action: processedStep.action,
            result,
            timestamp: new Date(),
          });

          this.logger.log(`Step completed`, {
            component: 'IntegrationOrchestratorService',
            operation: 'executeChain',
            step: processedStep.id,
            duration: stepDuration,
          });
        } catch (stepError) {
          const stepDuration = Date.now() - stepStartTime;
          const errorMessage =
            stepError instanceof Error ? stepError.message : String(stepError);

          results.push({
            step: processedStep.id,
            result: { error: errorMessage },
            success: false,
            duration: stepDuration,
          });

          onProgress({
            step: i + 1,
            total: steps.length,
            status: 'failed',
            action: processedStep.action,
            error: errorMessage,
            timestamp: new Date(),
          });

          this.logger.error(`Step failed`, {
            component: 'IntegrationOrchestratorService',
            operation: 'executeChain',
            step: processedStep.id,
            error: errorMessage,
          });

          // Stop execution on first failure
          throw new Error(`Step '${processedStep.id}' failed: ${errorMessage}`);
        }
      }

      const totalDuration = Date.now() - startTime;

      this.logger.log('Integration chain completed successfully', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeChain',
        stepsCount: steps.length,
        totalDuration,
      });

      return {
        success: true,
        results,
        totalDuration,
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error('Integration chain failed', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeChain',
        error: errorMessage,
        completedSteps: results.filter((r) => r.success).length,
        totalSteps: steps.length,
        totalDuration,
      });

      return {
        success: false,
        results,
        totalDuration,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute MongoDB integration step
   */
  private async executeMongoDBStep(
    step: IntegrationStep,
    userId: string,
  ): Promise<any> {
    try {
      this.logger.log('Executing MongoDB step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      // Use MCP MongoDB service
      const result = await this.mongoService.executeAction(
        userId,
        step.action,
        step.params,
      );

      this.logger.log('MongoDB step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
        recordsAffected: Array.isArray(result) ? result.length : 1,
      });

      return {
        integration: 'mongodb',
        action: step.action,
        result,
        recordCount: Array.isArray(result) ? result.length : 1,
      };
    } catch (error) {
      this.logger.error('MongoDB step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute GitHub integration step
   */
  private async executeGitHubStep(
    step: IntegrationStep,
    userId: string,
    context?: Record<string, any>,
  ): Promise<any> {
    try {
      this.logger.log('Executing GitHub step via MCP', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
        userId,
      });

      // Build natural language command from step
      let naturalCommand = '';
      const params = step.params || {};

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

      // Execute via MCP
      const result = await this.githubService.executeNaturalLanguageCommand(
        userId,
        naturalCommand,
      );

      this.logger.log('GitHub step executed successfully via MCP', {
        component: 'IntegrationOrchestratorService',
        stepId: step.id,
        action: step.action,
        resultKeys: Object.keys(result || {}),
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to execute GitHub step via MCP', {
        component: 'IntegrationOrchestratorService',
        stepId: step.id,
        action: step.action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute Google integration step
   */
  private async executeGoogleStep(
    step: IntegrationStep,
    userId: string,
  ): Promise<any> {
    try {
      this.logger.log('Executing Google step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      // Map actions to natural language commands
      let naturalCommand = '';
      const params = step.params || {};

      switch (step.action) {
        case 'list_files':
        case 'listDriveFiles':
          naturalCommand = `List files in Google Drive ${params.query ? `matching "${params.query}"` : ''}`;
          break;

        case 'get_file':
        case 'getDriveFile':
          naturalCommand = `Get Google Drive file with ID ${params.fileId}`;
          break;

        case 'create_sheet':
        case 'createSpreadsheet':
          naturalCommand = `Create a new Google Spreadsheet titled "${params.title || 'New Spreadsheet'}" ${params.headers ? `with headers ${JSON.stringify(params.headers)}` : ''}`;
          break;

        case 'append_sheet':
        case 'appendToSpreadsheet':
          naturalCommand = `Append data to Google Spreadsheet ${params.spreadsheetId} in range ${params.range || 'Sheet1'} with data ${JSON.stringify(params.data)}`;
          break;

        case 'read_sheet':
        case 'readSpreadsheet':
          naturalCommand = `Read data from Google Spreadsheet ${params.spreadsheetId} in range ${params.range || 'Sheet1!A1:Z1000'}`;
          break;

        case 'create_doc':
        case 'createDocument':
          naturalCommand = `Create a new Google Document titled "${params.title || 'New Document'}"`;
          break;

        case 'read_doc':
        case 'readDocument':
          naturalCommand = `Read content from Google Document ${params.documentId}`;
          break;

        case 'insert_text':
        case 'insertTextIntoDocument':
          naturalCommand = `Insert text "${params.text}" into Google Document ${params.documentId} at index ${params.index || 1}`;
          break;

        case 'upload_file':
        case 'uploadFileToDrive':
          naturalCommand = `Upload file "${params.fileName}" to Google Drive ${params.folderId ? `in folder ${params.folderId}` : ''}`;
          break;

        case 'share_file':
        case 'shareFile':
          naturalCommand = `Share Google Drive file ${params.fileId} with ${params.email} as ${params.role || 'reader'}`;
          break;

        case 'create_folder':
        case 'createFolder':
          naturalCommand = `Create a new folder named "${params.folderName}" in Google Drive ${params.parentFolderId ? `inside folder ${params.parentFolderId}` : ''}`;
          break;

        case 'list_docs':
        case 'listDocuments':
          naturalCommand = `List my Google Documents`;
          break;

        case 'list_sheets':
        case 'listSpreadsheets':
          naturalCommand = `List my Google Spreadsheets`;
          break;

        default:
          naturalCommand = `Execute Google action: ${step.action} with parameters ${JSON.stringify(params)}`;
      }

      const result = await this.googleService.executeNaturalLanguageCommand(
        userId,
        naturalCommand,
      );

      this.logger.log('Google step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      return {
        integration: 'google',
        action: step.action,
        result,
      };
    } catch (error) {
      this.logger.error('Google step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute JIRA integration step
   */
  private async executeJiraStep(
    step: IntegrationStep,
    userId: string,
  ): Promise<any> {
    try {
      this.logger.log('Executing JIRA step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      // Map actions to natural language commands
      let naturalCommand = '';
      const params = step.params || {};

      switch (step.action) {
        case 'list_projects':
        case 'listProjects':
          naturalCommand = `List all JIRA projects`;
          break;

        case 'create_issue':
        case 'createIssue':
          naturalCommand = `Create a JIRA issue in project ${params.projectKey} with summary "${params.summary}" and description "${params.description || ''}"`;
          break;

        case 'list_issues':
        case 'listIssues':
          naturalCommand = `List JIRA issues ${params.jql ? `matching JQL "${params.jql}"` : 'assigned to me'}`;
          break;

        case 'get_issue':
        case 'getIssue':
          naturalCommand = `Get JIRA issue ${params.issueKey}`;
          break;

        case 'update_issue':
        case 'updateIssue':
          naturalCommand = `Update JIRA issue ${params.issueKey} ${params.summary ? `with summary "${params.summary}"` : ''} ${params.description ? `and description "${params.description}"` : ''}`;
          break;

        case 'add_comment':
        case 'addComment':
          naturalCommand = `Add comment "${params.comment}" to JIRA issue ${params.issueKey}`;
          break;

        case 'get_issue_types':
        case 'getIssueTypes':
          naturalCommand = `Get issue types for JIRA project ${params.projectKey}`;
          break;

        case 'list_priorities':
        case 'listPriorities':
          naturalCommand = `List JIRA issue priorities`;
          break;

        default:
          naturalCommand = `Execute JIRA action: ${step.action} with parameters ${JSON.stringify(params)}`;
      }

      const result = await this.jiraService.executeNaturalLanguageCommand(
        userId,
        naturalCommand,
      );

      this.logger.log('JIRA step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      return {
        integration: 'jira',
        action: step.action,
        result,
      };
    } catch (error) {
      this.logger.error('JIRA step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute Vercel integration step
   */
  private async executeVercelStep(
    step: IntegrationStep,
    userId: string,
    context?: Record<string, any>,
  ): Promise<any> {
    try {
      this.logger.log('Executing Vercel step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      // Map actions to natural language commands
      let naturalCommand = '';
      const params = step.params || {};

      switch (step.action) {
        case 'list_projects':
        case 'listProjects':
          naturalCommand = `List Vercel projects`;
          break;

        case 'list_deployments':
        case 'listDeployments':
          naturalCommand = `List deployments for Vercel project ${params.projectId}`;
          break;

        case 'get_project':
        case 'getProjectDetails':
          naturalCommand = `Get details for Vercel project ${params.projectId}`;
          break;

        case 'get_deployment':
        case 'getDeploymentDetails':
          naturalCommand = `Get details for Vercel deployment ${params.deploymentId}`;
          break;

        case 'get_build_logs':
        case 'getDeploymentBuildLogs':
          naturalCommand = `Get build logs for Vercel deployment ${params.deploymentId}`;
          break;

        case 'list_domains':
        case 'listDomains':
          naturalCommand = `List domains for Vercel project ${params.projectId}`;
          break;

        case 'list_env_vars':
        case 'listEnvVars':
          naturalCommand = `List environment variables for Vercel project ${params.projectId}`;
          break;

        case 'set_env_var':
        case 'setEnvVar':
          naturalCommand = `Set environment variable ${params.key}=${params.value} for Vercel project ${params.projectId}`;
          break;

        case 'trigger_deployment':
        case 'triggerDeployment':
        case 'deploy':
        case 'connect':
          // If gitSource is provided but no projectId, we need to find or create the project
          const projectId = params.projectId;

          if (!projectId && params.gitSource) {
            this.logger.log(
              'No projectId provided, looking for existing project or creating new one',
              {
                component: 'IntegrationOrchestratorService',
                gitSource: params.gitSource,
              },
            );

            // Extract repo name and owner from gitSource
            const repoPath = params.gitSource.repo || '';
            const repoName = repoPath.split('/').pop() || '';

            if (repoName) {
              // Try to find existing project by name
              naturalCommand = `Deploy repository ${repoPath} to Vercel - create project if it doesn't exist`;
            } else {
              throw new Error(
                'Unable to determine repository name from gitSource',
              );
            }
          } else if (projectId) {
            naturalCommand = `Trigger deployment for Vercel project ${projectId}`;
          } else {
            throw new Error(
              'Vercel projectId or gitSource is required for deployment',
            );
          }
          break;

        case 'rollback':
        case 'rollbackDeployment':
          naturalCommand = `Rollback Vercel project ${params.projectId} to deployment ${params.deploymentId}`;
          break;

        case 'add_domain':
        case 'addDomain':
          naturalCommand = `Add domain ${params.domain} to Vercel project ${params.projectId}`;
          break;

        case 'remove_domain':
        case 'removeDomain':
          naturalCommand = `Remove domain ${params.domain} from Vercel project ${params.projectId}`;
          break;

        case 'check_health':
        case 'checkHealth':
          naturalCommand = `Check Vercel service health`;
          break;

        default:
          naturalCommand = `Execute Vercel action: ${step.action} with parameters ${JSON.stringify(params)}`;
      }

      const result = await this.vercelService.executeNaturalLanguageCommand(
        userId,
        naturalCommand,
      );

      this.logger.log('Vercel step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      // Extract important information from the result
      const extractedData: any = {
        integration: 'vercel',
        action: step.action,
        success: true,
      };

      // Extract URLs and important data based on action
      if (
        (step.action === 'deploy' ||
          step.action === 'connect' ||
          step.action === 'triggerDeployment') &&
        result
      ) {
        if (result.url) {
          extractedData.url = `https://${result.url}`;
          extractedData.deploymentId = result.uid;
          extractedData.state = result.state;
          extractedData.message =
            result.message ||
            `Deployment ${result.state || 'triggered'} successfully`;
        } else if (result.projectId) {
          // If no URL yet, provide project link
          extractedData.url = `https://vercel.com/dashboard/project/${result.projectId}`;
          extractedData.projectId = result.projectId;
          extractedData.message =
            result.message ||
            'Project configured for automatic Git deployments';
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
      this.logger.error('Vercel step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute AWS integration step
   */
  private async executeAwsStep(
    step: IntegrationStep,
    userId: string,
  ): Promise<any> {
    try {
      this.logger.log('Executing AWS step', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      // Map actions to natural language commands
      let naturalCommand = '';
      const params = step.params || {};

      switch (step.action) {
        case 'list_buckets':
          naturalCommand = `List S3 buckets`;
          break;

        case 'create_bucket':
          naturalCommand = `Create S3 bucket named ${params.bucketName}`;
          break;

        case 'upload_file':
          naturalCommand = `Upload file to S3 bucket ${params.bucketName}`;
          break;

        case 'list_lambda_functions':
          naturalCommand = `List Lambda functions`;
          break;

        case 'create_lambda_function':
          naturalCommand = `Create Lambda function ${params.functionName}`;
          break;

        case 'invoke_lambda':
          naturalCommand = `Invoke Lambda function ${params.functionName}`;
          break;

        case 'list_ec2_instances':
          naturalCommand = `List EC2 instances`;
          break;

        case 'start_ec2_instance':
          naturalCommand = `Start EC2 instance ${params.instanceId}`;
          break;

        case 'stop_ec2_instance':
          naturalCommand = `Stop EC2 instance ${params.instanceId}`;
          break;

        default:
          naturalCommand = `Execute AWS action: ${step.action} with parameters ${JSON.stringify(params)}`;
      }

      const result = await this.awsService.executeNaturalLanguageCommand(
        userId,
        naturalCommand,
      );

      this.logger.log('AWS step executed successfully', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        action: step.action,
      });

      return {
        integration: 'aws',
        action: step.action,
        result,
      };
    } catch (error) {
      this.logger.error('AWS step failed', {
        component: 'IntegrationOrchestratorService',
        step: step.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute steps in parallel (for independent steps)
   */
  async executeParallel(
    steps: IntegrationStep[],
    userId: string,
    onProgress: (update: ProgressUpdate) => void,
  ): Promise<ChainResult> {
    const startTime = Date.now();

    try {
      this.logger.log('Starting parallel integration execution', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeParallel',
        userId,
        stepsCount: steps.length,
      });

      const promises = steps.map(async (step, index) => {
        const stepStartTime = Date.now();

        onProgress({
          step: index + 1,
          total: steps.length,
          status: 'running',
          action: step.action,
          timestamp: new Date(),
        });

        try {
          let result: any;

          switch (step.integration) {
            case 'mongodb':
              result = await this.executeMongoDBStep(step, userId);
              break;
            case 'github':
              result = await this.executeGitHubStep(step, userId, {});
              break;
            case 'google':
              result = await this.executeGoogleStep(step, userId);
              break;
            case 'jira':
              result = await this.executeJiraStep(step, userId);
              break;
            case 'vercel':
              result = await this.executeVercelStep(step, userId, {});
              break;
            case 'aws':
              result = await this.executeAwsStep(step, userId);
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
            timestamp: new Date(),
          });

          return {
            step: step.id,
            result,
            success: true,
            duration,
          };
        } catch (error) {
          const duration = Date.now() - stepStartTime;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          onProgress({
            step: index + 1,
            total: steps.length,
            status: 'failed',
            action: step.action,
            error: errorMessage,
            timestamp: new Date(),
          });

          return {
            step: step.id,
            result: { error: errorMessage },
            success: false,
            duration,
          };
        }
      });

      const results = await Promise.all(promises);
      const totalDuration = Date.now() - startTime;
      const success = results.every((r) => r.success);

      this.logger.log('Parallel integration execution completed', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeParallel',
        success,
        successfulSteps: results.filter((r) => r.success).length,
        totalSteps: steps.length,
        totalDuration,
      });

      return {
        success,
        results,
        totalDuration,
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error('Parallel integration execution failed', {
        component: 'IntegrationOrchestratorService',
        operation: 'executeParallel',
        error: errorMessage,
        totalDuration,
      });

      return {
        success: false,
        results: [],
        totalDuration,
        error: errorMessage,
      };
    }
  }
}
