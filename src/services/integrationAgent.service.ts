/**
 * Integration Agent Service
 * 
 * AI-powered service that handles integration commands using:
 * 1. Nova Pro LLM for parameter extraction from natural language
 * 2. Zod schemas for validation
 * 3. Interactive selection UI when parameters are missing
 */

import { ChatBedrockConverse } from '@langchain/aws';
import { ZodError, ZodObject, ZodTypeAny } from 'zod';
import { 
  IntegrationAgentResponse, 
  IntegrationAgentRequest
} from '../types/integrationAgent.types';
import { 
  getSchema, 
  getActionsForIntegration,
  getQuestionForParameter,
  AWSAction
} from '../schemas/integrationTools.schema';
import { IntegrationOptionProviderService } from './integrationOptionProvider.service';
import { loggingService } from './logging.service';
import { IntegrationCommand } from './integrationChat.service';

export class IntegrationAgentService {
  private static llm: ChatBedrockConverse | null = null;

  /**
   * Initialize the Nova Pro LLM for parameter extraction
   */
  private static getLLM(): ChatBedrockConverse {
    if (!this.llm) {
      this.llm = new ChatBedrockConverse({
        region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
        model: 'us.amazon.nova-pro-v1:0',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
        },
        temperature: 0.1, // Low temperature for accurate extraction
        maxTokens: 1000,
      });
    }
    return this.llm;
  }

  /**
   * Main entry point - process an integration command
   */
  static async processIntegrationCommand(
    request: IntegrationAgentRequest
  ): Promise<IntegrationAgentResponse> {
    const startTime = Date.now();
    
    try {
      loggingService.info('Processing integration command', {
        component: 'IntegrationAgent',
        userId: request.userId,
        integration: request.integration,
        messagePreview: request.message.substring(0, 100),
        hasSelectionResponse: !!request.selectionResponse,
      });

      // 1. Detect the action from the message
      const action = await this.detectAction(request.message, request.integration);
      
      if (!action) {
        return {
          success: false,
          message: `I couldn't understand what you want to do with ${request.integration}. Available actions: ${getActionsForIntegration(request.integration).join(', ')}`,
          error: 'ACTION_NOT_DETECTED',
        };
      }

      // 2. Get the schema for this action
      const schema = getSchema(request.integration, action);
      
      if (!schema) {
        return {
          success: false,
          message: `Action "${action}" is not supported for ${request.integration}.`,
          error: 'UNSUPPORTED_ACTION',
        };
      }

      // 3. Extract parameters from the message using AI
      let extractedParams: Record<string, unknown> = await this.extractParameters(
        request.message, 
        request.integration, 
        action, 
        schema as ZodObject<Record<string, ZodTypeAny>>
      );

      // 4. Merge with any previous selection response
      if (request.selectionResponse) {
        const collectedParams = request.selectionResponse.collectedParams;
        extractedParams = {
          ...(typeof collectedParams === 'object' && collectedParams !== null ? collectedParams : {}),
          [request.selectionResponse.parameterName]: request.selectionResponse.value,
        };
      }

      // Always add the action
      extractedParams.action = action;

      // 5. Validate with Zod
      const validation = schema.safeParse(extractedParams);

      if (!validation.success) {
        // 6. Find the first missing required parameter
        const missingParam = this.getFirstMissingParam(validation.error, extractedParams);
        
        if (missingParam) {
          // 7. Fetch options for that parameter
          const options = await IntegrationOptionProviderService.getOptionsForParameter(
            request.userId,
            request.integration,
            missingParam,
            extractedParams
          );

          // 8. Generate the question
          const { question, placeholder } = getQuestionForParameter(missingParam);

          // 9. Return interactive selection response
          return {
            success: false,
            message: question,
            requiresSelection: true,
            selection: {
              parameterName: missingParam,
              question,
              options,
              allowCustom: true,
              customPlaceholder: placeholder,
              integration: request.integration,
              pendingAction: action,
              collectedParams: extractedParams,
              originalMessage: request.message,
            },
            metadata: {
              integration: request.integration,
              action,
              executionTimeMs: Date.now() - startTime,
              modelUsed: 'nova-pro',
            },
          };
        }

        // If we can't identify a missing param, return validation error
        return {
          success: false,
          message: `Invalid parameters: ${validation.error.errors.map(e => e.message).join(', ')}`,
          error: 'VALIDATION_ERROR',
        };
      }

      // 10. Execute the integration command with validated params
      const result = await this.executeIntegrationCommand(
        request.integration,
        action,
        validation.data,
        request.userId
      );

      return {
        ...result,
        metadata: {
          integration: request.integration,
          action,
          executionTimeMs: Date.now() - startTime,
          modelUsed: 'nova-pro',
        },
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Integration agent error', {
        component: 'IntegrationAgent',
        error: errorMessage,
        userId: request.userId,
        integration: request.integration,
      });

      return {
        success: false,
        message: `Failed to process ${request.integration} command: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Detect the action from the user's message
   */
  private static async detectAction(
    message: string,
    integration: string
  ): Promise<string | null> {
    const lowerMessage = message.toLowerCase();
    const availableActions = getActionsForIntegration(integration);

    // First, try to detect from explicit command patterns like @vercel:list-deployments
    const commandMatch = message.match(new RegExp(`@${integration}:([a-z_-]+)`, 'i'));
    if (commandMatch) {
      const extractedAction = commandMatch[1].replace(/-/g, '_');
      if (availableActions.includes(extractedAction)) {
        return extractedAction;
      }
    }

    // Try common keyword patterns
    const actionPatterns: Record<string, string[]> = {
      list_projects: ['list project', 'show project', 'my project', 'all project'],
      list_deployments: ['list deployment', 'show deployment', 'deployment history', 'deployments for'],
      get_logs: ['get log', 'show log', 'deployment log', 'build log'],
      list_domains: ['list domain', 'show domain', 'domains for'],
      add_domain: ['add domain', 'create domain', 'new domain', 'domain to'],
      list_env: ['list env', 'show env', 'environment variable', 'env var'],
      set_env: ['set env', 'add env', 'create env', 'update env'],
      deploy: ['deploy', 'trigger deploy', 'redeploy', 'push'],
      rollback: ['rollback', 'revert', 'go back'],
      send: ['send email', 'send message', 'send to'],
      send_message: ['send message', 'post message', 'message to'],
      list_channels: ['list channel', 'show channel', 'all channel'],
      list_users: ['list user', 'show user', 'all user', 'members'],
      create_issue: ['create issue', 'new issue', 'add issue', 'create ticket'],
      list_issues: ['list issue', 'show issue', 'all issue', 'issues in'],
      get_issue: ['get issue', 'show issue', 'issue detail'],
      update_issue: ['update issue', 'edit issue', 'modify issue'],
      list_teams: ['list team', 'show team', 'all team'],
      list_repos: ['list repo', 'show repo', 'my repo', 'repositories'],
      create_pr: ['create pr', 'new pr', 'pull request', 'create pull'],
      list_prs: ['list pr', 'show pr', 'pull request'],
      list_branches: ['list branch', 'show branch', 'branches'],
      list: ['list', 'show all', 'get all'],
      search: ['search', 'find', 'look for'],
      create: ['create', 'new', 'add'],
      delete: ['delete', 'remove'],
      costs: ['cost', 'spending', 'bill', 'how much', 'usage cost', 'aws cost'],
      cost_breakdown: ['cost breakdown', 'breakdown by service', 'service cost', 'which service'],
      cost_forecast: ['forecast', 'predict', 'future cost', 'next month cost'],
      cost_anomalies: ['anomal', 'unusual spending', 'spike', 'unexpected cost'],
      list_ec2: ['list ec2', 'show ec2', 'ec2 instance', 'my instance', 'running instance', 'server'],
      stop_ec2: ['stop ec2', 'stop instance', 'shutdown', 'turn off'],
      start_ec2: ['start ec2', 'start instance', 'turn on', 'boot'],
      idle_instances: ['idle', 'underutilized', 'unused', 'not used', 'waste'],
      list_s3: ['list s3', 'show s3', 's3 bucket', 'bucket', 'storage'],
      list_rds: ['list rds', 'show rds', 'database', 'rds instance'],
      list_lambda: ['list lambda', 'show lambda', 'lambda function', 'serverless'],
      optimize: ['optimize', 'recommendation', 'savings', 'reduce cost', 'save money'],
      status: ['status', 'connection', 'overview', 'health'],
    };

    // Check each pattern
    for (const [action, patterns] of Object.entries(actionPatterns)) {
      if (availableActions.includes(action)) {
        for (const pattern of patterns) {
          if (lowerMessage.includes(pattern)) {
            return action;
          }
        }
      }
    }

    // If no pattern matched, use AI to detect
    try {
      const llm = this.getLLM();
      const prompt = `Given this user message for ${integration} integration: "${message}"

Available actions: ${availableActions.join(', ')}

What action is the user trying to perform? Respond with ONLY the action name, nothing else.
If you can't determine the action, respond with "unknown".`;

      const response = await llm.invoke([{ role: 'user', content: prompt }]);
      const detectedAction = (response.content as string).trim().toLowerCase().replace(/-/g, '_');
      
      if (availableActions.includes(detectedAction)) {
        return detectedAction;
      }
    } catch (error) {
      loggingService.warn('AI action detection failed, using fallback', {
        component: 'IntegrationAgent',
        error: (error as Error).message,
      });
    }

    // Default actions based on integration
    const defaultActions: Record<string, string> = {
      vercel: 'list_projects',
      slack: 'list_channels',
      discord: 'list_channels',
      jira: 'list_projects',
      linear: 'list_teams',
      github: 'list_repos',
      gmail: 'list',
      drive: 'list',
      calendar: 'list',
      aws: 'status',
    };

    return defaultActions[integration] || null;
  }

  /**
   * Extract parameters from the message using AI
   */
  private static async extractParameters(
    message: string,
    integration: string,
    action: string,
    schema: ZodObject<Record<string, ZodTypeAny>>
  ): Promise<Record<string, unknown>> {
    // Get schema shape to understand what parameters we need
    const shape = schema.shape;
    const paramNames = Object.keys(shape).filter(k => k !== 'action');
    
    if (paramNames.length === 0) {
      return {};
    }

    // Build parameter descriptions from schema
    const paramDescriptions = paramNames.map(name => {
      const field = shape[name];
      const description = field.description ?? name;
      const isOptional = field.isOptional();
      return `- ${name}: ${description}${isOptional ? ' (optional)' : ' (required)'}`;
    }).join('\n');

    try {
      const llm = this.getLLM();
      const prompt = `Extract parameters from this user message for the ${integration} ${action} action.

User message: "${message}"

Parameters to extract:
${paramDescriptions}

Respond with a JSON object containing ONLY the parameters you can extract from the message.
Do not include parameters that are not mentioned or cannot be inferred.
If extracting an email, ensure it's a valid email format.
If extracting a project name, look for words after "for" or project names in quotes.

Example response: {"projectName": "my-app", "key": "API_KEY"}

JSON response:`;

      const response = await llm.invoke([{ role: 'user', content: prompt }]);
      let responseText = (response.content as string).trim();
      
      // Clean up response - remove markdown code blocks if present
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Try to parse JSON
      try {
        const extracted = JSON.parse(responseText) as Record<string, unknown>;
        
        loggingService.info('Parameters extracted by AI', {
          component: 'IntegrationAgent',
          integration,
          action,
          extractedParams: extracted,
        });
        
        return extracted;
      } catch {
        loggingService.warn('Failed to parse AI response as JSON', {
          component: 'IntegrationAgent',
          response: responseText,
        });
      }
    } catch (error) {
      loggingService.warn('AI parameter extraction failed', {
        component: 'IntegrationAgent',
        error: (error as Error).message,
      });
    }

    // Fallback: Try to extract common patterns manually
    return this.extractParametersManually(message, paramNames);
  }

  /**
   * Manual parameter extraction as fallback
   */
  private static extractParametersManually(
    message: string,
    paramNames: string[]
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    for (const paramName of paramNames) {
      switch (paramName) {
        case 'projectName':
        case 'project': {
          // Look for "for project-name" or "project-name" patterns
          const forMatch = message.match(/for\s+["']?([a-zA-Z0-9_-]+)["']?/i);
          if (forMatch) {
            params.projectName = forMatch[1];
          }
          break;
        }

        case 'to': {
          // Extract email addresses
          const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
          const emails = message.match(emailRegex);
          if (emails && emails.length > 0) {
            params.to = emails;
          }
          break;
        }

        case 'subject': {
          // Look for "subject: X" or "subject X"
          const subjectMatch = message.match(/subject:?\s+["']([^"']+)["']|subject:?\s+(\S+)/i);
          if (subjectMatch) {
            params.subject = subjectMatch[1] || subjectMatch[2];
          }
          break;
        }

        case 'message':
        case 'body': {
          // Look for "saying X" or "message: X"
          const bodyMatch = message.match(/(?:saying|message|body):?\s+["']([^"']+)["']|(?:saying|message|body):?\s+(.+?)$/i);
          if (bodyMatch) {
            params[paramName] = bodyMatch[1] || bodyMatch[2];
          }
          break;
        }

        case 'channelId':
        case 'channel': {
          // Look for "#channel" or "channel name"
          const channelMatch = message.match(/#([a-zA-Z0-9_-]+)|to\s+([a-zA-Z0-9_-]+)/i);
          if (channelMatch) {
            params.channelId = channelMatch[1] || channelMatch[2];
          }
          break;
        }

        case 'title': {
          // Look for "title: X" or text in quotes
          const titleMatch = message.match(/title:?\s+["']([^"']+)["']|["']([^"']+)["']/i);
          if (titleMatch) {
            params.title = titleMatch[1] || titleMatch[2];
          }
          break;
        }

        case 'query': {
          // Use the message content after the command as the query
          const queryMatch = message.match(/@\w+:\w+\s+(.+)/);
          if (queryMatch) {
            params.query = queryMatch[1].trim();
          }
          break;
        }
      }
    }

    return params;
  }

  /**
   * Get the first missing required parameter from validation error
   */
  private static getFirstMissingParam(
    error: ZodError,
    currentParams: Record<string, unknown>
  ): string | null {
    // Find the first error that's about a missing required field
    for (const issue of error.errors) {
      if (issue.code === 'invalid_type' && issue.received === 'undefined') {
        const paramName = issue.path[0] as string;
        if (paramName !== 'action' && !currentParams[paramName]) {
          return paramName;
        }
      }
      if (issue.code === 'too_small' && 'minimum' in issue && issue.minimum === 1) {
        const paramName = issue.path[0] as string;
        if (paramName !== 'action') {
          return paramName;
        }
      }
    }

    // If no specific missing param found, return the first error path
    if (error.errors.length > 0) {
      const firstPath = error.errors[0].path[0] as string;
      if (firstPath !== 'action') {
        return firstPath;
      }
    }

    return null;
  }

  /**
   * Execute the integration command with validated parameters
   */
  private static async executeIntegrationCommand(
    integration: string,
    action: string,
    params: Record<string, unknown>,
    userId: string
  ): Promise<IntegrationAgentResponse> {
    try {
      // Handle AWS commands through the dedicated AWS chat handler
      if (integration === 'aws') {
        const { awsChatHandlerService } = await import('./aws/awsChatHandler.service');
        
        const result = await awsChatHandlerService.processCommand({
          userId,
          action: action as AWSAction,
          params,
        });

        return {
          success: result.success,
          message: result.message,
          data: result.data as Record<string, unknown> | undefined,
          error: result.error,
        };
      }

      // Import the IntegrationChatService to reuse existing execution logic
      const { IntegrationChatService } = await import('./integrationChat.service');

      // Convert to the format expected by IntegrationChatService
      const commandType = this.mapActionToCommandType(action) as IntegrationCommand['type'];
      const entityId = params.projectName ?? params.projectKey ?? params.teamId;
      const command: IntegrationCommand = {
        type: commandType,
        entity: this.mapActionToEntity(action),
        mention: {
          integration,
          entityType: this.mapActionToEntity(action),
          entityId: typeof entityId === 'string' ? entityId : undefined,
        },
        params: params,
        naturalLanguage: '',
      };

      const result = await IntegrationChatService.executeCommand(userId, command);

      return {
        success: result.success,
        message: result.message,
        data: result.data as Record<string, unknown> | undefined,
        error: result.error,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to execute integration command', {
        component: 'IntegrationAgent',
        error: errorMessage,
        integration,
        action,
      });

      return {
        success: false,
        message: `Failed to execute ${action}: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Map action name to command type
   */
  private static mapActionToCommandType(action: string): string {
    if (action.startsWith('list_')) return 'list';
    if (action.startsWith('get_')) return 'get';
    if (action.startsWith('create_') || action === 'deploy' || action === 'send' || action === 'add_domain') return 'create';
    if (action.startsWith('update_') || action === 'set_env') return 'update';
    if (action.startsWith('delete_') || action === 'rollback') return 'delete';
    if (action === 'send_message') return 'send';
    if (action === 'add_comment') return 'add';
    if (action.startsWith('ban_') || action.startsWith('kick_')) return action.split('_')[0];
    return 'get';
  }

  /**
   * Map action name to entity
   */
  private static mapActionToEntity(action: string): string {
    const actionEntityMap: Record<string, string> = {
      list_projects: 'project',
      list_deployments: 'deployment',
      get_logs: 'logs',
      list_domains: 'domain',
      add_domain: 'domain',
      list_env: 'env',
      set_env: 'env',
      deploy: 'deployment',
      rollback: 'deployment',
      get_project: 'project',
      send: 'message',
      send_message: 'message',
      list_channels: 'channel',
      list_users: 'user',
      create_channel: 'channel',
      create_issue: 'issue',
      list_issues: 'issue',
      get_issue: 'issue',
      update_issue: 'issue',
      add_comment: 'comment',
      list_teams: 'team',
      list_repos: 'repository',
      create_pr: 'pullrequest',
      list_prs: 'pullrequest',
      list_branches: 'branch',
      create_branch: 'branch',
      list: 'file',
      search: 'file',
      upload: 'file',
      create_folder: 'folder',
      share: 'file',
      create: 'event',
      update: 'event',
      delete: 'event',
    };

    return actionEntityMap[action] || action.replace(/^(list_|get_|create_|update_|delete_)/, '');
  }
}
