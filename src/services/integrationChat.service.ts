import { loggingService } from './logging.service';
import { IntegrationService } from './integration.service';
import { JiraService } from './jira.service';
import { LinearService } from './linear.service';
import { SlackService } from './slack.service';
import { DiscordService } from './discord.service';
import { GitHubService } from './github.service';
import { IIntegration, IntegrationCredentials } from '../models/Integration';
import { IGitHubConnection } from '../models';
import { IntegrationIntentRecognitionService } from './integrationIntentRecognition.service';

export interface ParsedMention {
  integration: string;
  entityType?: string;
  entityId?: string;
  subEntityType?: string;
  subEntityId?: string;
}

export interface IntegrationCommand {
  type: 'create' | 'get' | 'list' | 'update' | 'delete' | 'send' | 'add' | 'assign' | 'remove' | 'ban' | 'unban' | 'kick';
  entity: string;
  mention: ParsedMention;
  params: Record<string, any>;
  naturalLanguage?: string;
}

export interface IntegrationCommandResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export class IntegrationChatService {
  /**
   * Parse natural language command with integration mentions
   * Uses AI recognition first, then falls back to manual parsing
   */
  static async parseCommand(message: string, mentions: ParsedMention[]): Promise<IntegrationCommand | null> {
    if (mentions.length === 0) {
      return null;
    }

    const mention = mentions[0]; // Use first mention

    // Try AI recognition first (using cheapest model)
    try {
      const recognizedIntent = await IntegrationIntentRecognitionService.recognizeIntent(message, mentions);
      
      if (recognizedIntent && recognizedIntent.confidence >= 0.7) {
        loggingService.info('Using AI-recognized intent', {
          component: 'IntegrationChatService',
          operation: 'parseCommand',
          integration: mention.integration,
          commandType: recognizedIntent.commandType,
          entity: recognizedIntent.entity,
          confidence: recognizedIntent.confidence
        });

        // Convert intent to command
        // NEVER use MCP for integration data - always use APIs
        const command = IntegrationIntentRecognitionService.intentToCommand(recognizedIntent, mention);
        
        return command;
      } else if (recognizedIntent && recognizedIntent.confidence < 0.7) {
        loggingService.info('AI recognition confidence too low, falling back to manual parsing', {
          component: 'IntegrationChatService',
          operation: 'parseCommand',
          confidence: recognizedIntent.confidence
        });
      }
    } catch (error: any) {
      loggingService.warn('AI recognition failed, falling back to manual parsing', {
        component: 'IntegrationChatService',
        operation: 'parseCommand',
        error: error.message
      });
    }

    // Fallback to manual parsing
    return this.parseCommandManual(message, mentions);
  }

  /**
   * Manual parsing (original implementation)
   */
  private static parseCommandManual(message: string, mentions: ParsedMention[]): IntegrationCommand | null {
    if (mentions.length === 0) {
      return null;
    }

    const mention = mentions[0]; // Use first mention
    let lowerMessage = message.toLowerCase().trim();
    
    // Extract command from mention pattern (e.g., @linear:list-issues -> list-issues)
    // Pattern: @integration:command-with-dashes
    const mentionMatch = message.match(new RegExp(`@${mention.integration}(?::([a-z]+(?:-[a-z]+)*))?`, 'i'));
    let extractedCommand = '';
    if (mentionMatch && mentionMatch[1]) {
      extractedCommand = mentionMatch[1].toLowerCase();
      // If we extracted a command, add it to the message context for parsing
      if (extractedCommand && !lowerMessage.includes(extractedCommand.replace(/-/g, ' '))) {
        // Command was in the mention but not in the full message, add it for parsing
        // Replace dashes with spaces so "list-issues" becomes "list issues" for parsing
        lowerMessage = `${extractedCommand.replace(/-/g, ' ')} ${lowerMessage}`;
      }
    }

      // Extract command type and parameters
      let commandType: IntegrationCommand['type'] | null = null;
      let entity = '';
      const params: Record<string, any> = {};
      
      // Also check the extractedCommand directly for dashed commands
      if (extractedCommand) {
        if (extractedCommand.startsWith('list-')) {
          commandType = 'list';
          if (extractedCommand === 'list-issues') {
            entity = 'issue';
          } else if (extractedCommand === 'list-projects') {
            entity = 'project';
          } else if (extractedCommand === 'list-channels') {
            entity = 'channel';
          } else if (extractedCommand === 'list-users') {
            entity = 'user';
          } else if (extractedCommand === 'list-teams') {
            entity = 'team';
          } else if (extractedCommand === 'list-workflows') {
            entity = 'workflow';
          } else if (extractedCommand === 'list-tags') {
            entity = 'tag';
          } else if (extractedCommand === 'list-iterations') {
            entity = 'iteration';
          } else if (extractedCommand === 'list-epics') {
            entity = 'epic';
          } else if (extractedCommand === 'list-prs' || extractedCommand === 'list-pull-requests') {
            entity = 'pullrequest';
          } else if (extractedCommand === 'list-branches') {
            entity = 'branch';
          }
        } else if (extractedCommand.startsWith('create-')) {
          commandType = 'create';
          if (extractedCommand === 'create-issue') {
            entity = 'issue';
          } else if (extractedCommand === 'create-pr' || extractedCommand === 'create-pull-request') {
            entity = 'pullrequest';
          }
        } else if (extractedCommand.startsWith('get-')) {
          commandType = 'get';
          if (extractedCommand === 'get-issue') {
            entity = 'issue';
          }
        } else if (extractedCommand.startsWith('update-')) {
          commandType = 'update';
          if (extractedCommand === 'update-issue') {
            entity = 'issue';
          }
        } else if (extractedCommand === 'add-comment') {
          commandType = 'add';
          entity = 'comment';
        } else if (extractedCommand === 'send-message') {
          commandType = 'send';
          entity = 'message';
        }
        
        // If we successfully parsed from extractedCommand, skip the rest
        if (commandType && entity) {
          return {
            type: commandType,
            entity,
            mention,
            params,
            naturalLanguage: message
          };
        }
      }

      // Extract title and description from the message more intelligently
      // Look for patterns like "create issue with title 'X' and description 'Y'"
      // or "create issue titled 'X' description 'Y'"
      const titlePatterns = [
        /(?:title|summary|subject|titled?)[: ]+['"]([^'"]+)['"]/i,
        /(?:title|summary|subject|titled?)[: ]+(\S+(?:\s+\S+)*?)(?:\s+and|\s+description|$)/i,
        /(?:with\s+)?title\s+['"]([^'"]+)['"]/i,
        /(?:titled?)\s+['"]([^'"]+)['"]/i
      ];

      const descPatterns = [
        /(?:description|desc|body|details?)[: ]+['"]([^'"]+)['"]/i,
        /(?:description|desc|body|details?)[: ]+(\S+(?:\s+\S+)*)/i,
        /(?:with\s+)?description\s+['"]([^'"]+)['"]/i
      ];

    // Detect command patterns - check for dashed commands first
    if (lowerMessage.includes('create-issue') || lowerMessage.match(/create\s+issue/)) {
      commandType = 'create';
      entity = 'issue';
    } else if (lowerMessage.includes('create-pr') || lowerMessage.includes('create-pull-request') || lowerMessage.match(/create\s+(pull\s+request|pr)/)) {
      commandType = 'create';
      entity = 'pullrequest';
    } else if (lowerMessage.includes('create') || lowerMessage.includes('new') || lowerMessage.includes('add')) {
      commandType = 'create';
      
      if (mention.integration === 'jira' && (lowerMessage.includes('issue') || lowerMessage.includes('ticket'))) {
        entity = 'issue';
        // Try multiple title patterns
        for (const pattern of titlePatterns) {
          const match = lowerMessage.match(pattern);
          if (match && match[1]) {
            params.title = match[1].trim();
            break;
          }
        }
        // Try multiple description patterns
        for (const pattern of descPatterns) {
          const match = lowerMessage.match(pattern);
          if (match && match[1]) {
            params.description = match[1].trim();
            break;
          }
        }
        // If no title found, try to extract from "create issue X" pattern
        if (!params.title) {
          const createMatch = lowerMessage.match(/create\s+issue\s+(?:with\s+)?(?:title\s+)?['"]?([^'"]+?)['"]?(?:\s+and|\s+description|$)/i);
          if (createMatch && createMatch[1]) {
            params.title = createMatch[1].trim();
          }
        }
      } else if (mention.integration === 'linear' && (lowerMessage.includes('issue') || lowerMessage.includes('ticket'))) {
        entity = 'issue';
        // Try multiple title patterns
        for (const pattern of titlePatterns) {
          const match = lowerMessage.match(pattern);
          if (match && match[1]) {
            params.title = match[1].trim();
            break;
          }
        }
        // Try multiple description patterns
        for (const pattern of descPatterns) {
          const match = lowerMessage.match(pattern);
          if (match && match[1]) {
            params.description = match[1].trim();
            break;
          }
        }
        // If no title found, try to extract from "create issue X" pattern
        if (!params.title) {
          const createMatch = lowerMessage.match(/create\s+issue\s+(?:with\s+)?(?:title\s+)?['"]?([^'"]+?)['"]?(?:\s+and|\s+description|$)/i);
          if (createMatch && createMatch[1]) {
            params.title = createMatch[1].trim();
          }
        }
      } else if (mention.integration === 'github') {
        if (lowerMessage.includes('repository') || lowerMessage.includes('repo')) {
          entity = 'repository';
          // Extract repository name
          const repoMatch = lowerMessage.match(/(?:repository|repo)[: ]+['"]?([a-zA-Z0-9_.-]+)['"]?/i);
          if (repoMatch) {
            params.name = repoMatch[1];
          }
          // Extract description
          for (const pattern of descPatterns) {
            const match = lowerMessage.match(pattern);
            if (match && match[1]) {
              params.description = match[1].trim();
              break;
            }
          }
          // Extract private/public
          if (lowerMessage.includes('private')) {
            params.private = true;
          }
        } else if (lowerMessage.includes('issue')) {
          entity = 'issue';
          // Try multiple title patterns
          for (const pattern of titlePatterns) {
            const match = lowerMessage.match(pattern);
            if (match && match[1]) {
              params.title = match[1].trim();
              break;
            }
          }
          // Try multiple description patterns
          for (const pattern of descPatterns) {
            const match = lowerMessage.match(pattern);
            if (match && match[1]) {
              params.body = match[1].trim();
              break;
            }
          }
        } else if (lowerMessage.includes('pull request') || lowerMessage.includes('pr')) {
          entity = 'pullrequest';
          // Try multiple title patterns
          for (const pattern of titlePatterns) {
            const match = lowerMessage.match(pattern);
            if (match && match[1]) {
              params.title = match[1].trim();
              break;
            }
          }
          // Try multiple description patterns
          for (const pattern of descPatterns) {
            const match = lowerMessage.match(pattern);
            if (match && match[1]) {
              params.body = match[1].trim();
              break;
            }
          }
          // Extract head and base branches
          const headMatch = lowerMessage.match(/(?:head|from|branch)[: ]+['"]?([a-zA-Z0-9_.-]+)['"]?/i);
          if (headMatch) {
            params.head = headMatch[1];
          }
          const baseMatch = lowerMessage.match(/(?:base|to|target)[: ]+['"]?([a-zA-Z0-9_.-]+)['"]?/i);
          if (baseMatch) {
            params.base = baseMatch[1];
          }
        } else if (lowerMessage.includes('branch')) {
          entity = 'branch';
          // Extract branch name
          const branchMatch = lowerMessage.match(/(?:branch)[: ]+['"]?([a-zA-Z0-9_.-]+)['"]?/i);
          if (branchMatch) {
            params.branchName = branchMatch[1];
          }
          // Extract from branch
          const fromMatch = lowerMessage.match(/(?:from|based on)[: ]+['"]?([a-zA-Z0-9_.-]+)['"]?/i);
          if (fromMatch) {
            params.fromBranch = fromMatch[1];
          }
        }
      }
    } else if (lowerMessage.includes('list') || lowerMessage.includes('show') || lowerMessage.includes('get all')) {
      commandType = 'list';
      // Check for dashed commands first (e.g., list-issues, list-projects)
      // Use word boundaries to match exact commands
      if (lowerMessage.includes('list-issues') || lowerMessage.match(/\blist\s+issues\b/)) {
        entity = 'issue';
      } else if (lowerMessage.includes('list-projects') || lowerMessage.match(/\blist\s+projects\b/)) {
        entity = 'project';
      } else if (lowerMessage.includes('list-channels') || lowerMessage.match(/\blist\s+channels\b/)) {
        entity = 'channel';
      } else if (lowerMessage.includes('list-users') || lowerMessage.match(/\blist\s+users\b/)) {
        entity = 'user';
      } else if (lowerMessage.includes('list-teams') || lowerMessage.match(/\blist\s+teams\b/)) {
        entity = 'team';
      } else if (lowerMessage.includes('list-workflows') || lowerMessage.match(/\blist\s+workflows\b/)) {
        entity = 'workflow';
      } else if (lowerMessage.includes('list-tags') || lowerMessage.match(/\blist\s+tags\b/)) {
        entity = 'tag';
      } else if (lowerMessage.includes('list-iterations') || lowerMessage.match(/\blist\s+iterations\b/)) {
        entity = 'iteration';
      } else if (lowerMessage.includes('list-epics') || lowerMessage.match(/\blist\s+epics\b/)) {
        entity = 'epic';
      } else if (lowerMessage.includes('list-prs') || lowerMessage.includes('list-pull-requests') || lowerMessage.match(/\blist\s+(pull\s+requests?|prs?)\b/)) {
        entity = 'pullrequest';
      } else if (lowerMessage.includes('list-branches') || lowerMessage.match(/\blist\s+branches\b/)) {
        entity = 'branch';
      } else if (lowerMessage.includes('issue')) {
        entity = 'issue';
      } else if (lowerMessage.includes('project')) {
        entity = 'project';
      } else if (lowerMessage.includes('channel')) {
        entity = 'channel';
      } else if (lowerMessage.includes('team')) {
        entity = 'team';
      } else if (lowerMessage.includes('workflow')) {
        entity = 'workflow';
      } else if (lowerMessage.includes('tag') || lowerMessage.includes('label')) {
        entity = 'tag';
      } else if (lowerMessage.includes('iteration') || lowerMessage.includes('cycle')) {
        entity = 'iteration';
      } else if (lowerMessage.includes('epic')) {
        entity = 'epic';
      } else if (lowerMessage.includes('repository') || lowerMessage.includes('repo')) {
        entity = 'repository';
      } else if (lowerMessage.includes('pull request') || lowerMessage.includes('pr')) {
        entity = 'pullrequest';
      } else if (lowerMessage.includes('branch')) {
        entity = 'branch';
      }
    } else if (lowerMessage.includes('get') || lowerMessage.includes('fetch') || lowerMessage.includes('retrieve')) {
      commandType = 'get';
      if (lowerMessage.includes('issue')) {
        entity = 'issue';
        // Extract issue key/ID
        const issueMatch = lowerMessage.match(/(?:issue|key|id)[: ]+(\S+)/i);
        if (issueMatch) {
          params.issueKey = issueMatch[1];
        }
      }
    } else if (lowerMessage.includes('update') || lowerMessage.includes('edit') || lowerMessage.includes('modify')) {
      commandType = 'update';
      if (lowerMessage.includes('issue')) {
        entity = 'issue';
        // Extract issue key/ID
        const issueMatch = lowerMessage.match(/(?:issue|key|id)[: ]+(\S+)/i);
        if (issueMatch) {
          params.issueKey = issueMatch[1];
        }
        // Extract updates - try multiple title patterns
        for (const pattern of titlePatterns) {
          const match = lowerMessage.match(pattern);
          if (match && match[1]) {
            params.title = match[1].trim();
            break;
          }
        }
        // Extract updates - try multiple description patterns
        for (const pattern of descPatterns) {
          const match = lowerMessage.match(pattern);
          if (match && match[1]) {
            params.description = match[1].trim();
            break;
          }
        }
      }
    } else if (lowerMessage.includes('comment') || lowerMessage.includes('add comment')) {
      commandType = 'add';
      entity = 'comment';
      // Extract comment text - try to get everything after "comment" or "add comment"
      const commentIndex = lowerMessage.indexOf('comment');
      if (commentIndex !== -1) {
        const afterComment = lowerMessage.substring(commentIndex + 7).trim();
        // Remove common words like "with", "to", "on"
        const cleaned = afterComment.replace(/^(with|to|on|in|for)\s+/i, '').trim();
        if (cleaned) {
          // Try to extract quoted text or use the rest of the message
          const quotedMatch = cleaned.match(/['"]([^'"]+)['"]/);
          params.comment = quotedMatch ? quotedMatch[1] : cleaned;
        }
      }
      // Fallback: extract from message pattern
      if (!params.comment) {
        const commentMatch = lowerMessage.match(/(?:comment|message|text)[: ]+['"]([^'"]+)['"]|(?:comment|message|text)[: ]+(\S+(?:\s+\S+)*)/i);
        if (commentMatch) {
          params.comment = commentMatch[1] || commentMatch[2];
        }
      }
    } else if (lowerMessage.includes('send') || lowerMessage.includes('message')) {
      commandType = 'send';
      entity = 'message';
      // Extract message text - try to get everything after "send" or "message"
      const sendIndex = Math.max(
        lowerMessage.indexOf('send'),
        lowerMessage.indexOf('message')
      );
      if (sendIndex !== -1) {
        const afterSend = lowerMessage.substring(sendIndex + (lowerMessage.includes('send') ? 4 : 7)).trim();
        // Remove common words
        const cleaned = afterSend.replace(/^(with|to|on|in|for|a|an|the)\s+/i, '').trim();
        if (cleaned) {
          // Try to extract quoted text or use the rest of the message
          const quotedMatch = cleaned.match(/['"]([^'"]+)['"]/);
          params.message = quotedMatch ? quotedMatch[1] : cleaned;
        }
      }
      // Fallback: extract from message pattern
      if (!params.message) {
        const messageMatch = lowerMessage.match(/(?:message|text|content)[: ]+['"]([^'"]+)['"]|(?:message|text|content)[: ]+(\S+(?:\s+\S+)*)/i);
        if (messageMatch) {
          params.message = messageMatch[1] || messageMatch[2];
        }
      }
    }

    if (!commandType || !entity) {
      return null;
    }

    return {
      type: commandType,
      entity,
      mention,
      params,
      naturalLanguage: message
    };
  }

  /**
   * Execute integration command
   */
  static async executeCommand(
    userId: string,
    command: IntegrationCommand
  ): Promise<IntegrationCommandResult> {
    try {
      // Get user's integrations
      const integrations = await IntegrationService.getUserIntegrations(userId, {
        status: 'active'
      });

      // Find matching integration
      const integration = integrations.find(i => {
        const integrationType = command.mention.integration;
        if (integrationType === 'jira') return i.type === 'jira_oauth';
        if (integrationType === 'linear') return i.type === 'linear_oauth';
        if (integrationType === 'slack') return i.type === 'slack_oauth' || i.type === 'slack_webhook';
        if (integrationType === 'discord') return i.type === 'discord_oauth' || i.type === 'discord_webhook';
        if (integrationType === 'github') return i.type === 'github_oauth';
        if (integrationType === 'webhook') return i.type === 'custom_webhook';
        return false;
      });

      if (!integration) {
        return {
          success: false,
          message: `No active ${command.mention.integration} integration found. Please set up an integration first.`,
          error: 'INTEGRATION_NOT_FOUND'
        };
      }

      const credentials = integration.getCredentials();

      // Route to appropriate service
      switch (command.mention.integration) {
        case 'jira':
          return await this.executeJiraCommand(command, integration, credentials);
        case 'linear':
          return await this.executeLinearCommand(command, integration, credentials);
        case 'slack':
          return await this.executeSlackCommand(command, integration, credentials);
        case 'discord':
          return await this.executeDiscordCommand(command, integration, credentials);
        case 'github':
          return await this.executeGitHubCommand(command, integration, credentials);
        case 'google':
          return await this.executeGoogleCommand(command, integration, credentials);
        default:
          return {
            success: false,
            message: `Integration ${command.mention.integration} is not yet supported for chat commands.`,
            error: 'UNSUPPORTED_INTEGRATION'
          };
      }
    } catch (error: any) {
      loggingService.error('Failed to execute integration command', {
        error: error.message,
        userId,
        command
      });
      return {
        success: false,
        message: `Failed to execute command: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Execute JIRA command
   */
  private static async executeJiraCommand(
    command: IntegrationCommand,
    integration: IIntegration,
    credentials: IntegrationCredentials
  ): Promise<IntegrationCommandResult> {
    const siteUrlOrCloudId = credentials.cloudId || credentials.siteUrl || '';
    const accessToken = credentials.accessToken || '';
    const useCloudId = !!credentials.cloudId;

    if (!siteUrlOrCloudId || !accessToken) {
      return {
        success: false,
        message: 'JIRA credentials not configured',
        error: 'MISSING_CREDENTIALS'
      };
    }

    try {
      switch (command.type) {
        case 'create':
          if (command.entity === 'issue') {
            const projectKey = command.mention.entityId || command.params.projectKey;
            if (!projectKey) {
              return {
                success: false,
                message: 'Project key is required. Use @jira:project:PROJECT-KEY',
                error: 'MISSING_PROJECT_KEY'
              };
            }

            // Get issue types for project
            const issueTypes = await JiraService.getIssueTypes(siteUrlOrCloudId, accessToken, projectKey, useCloudId);
            if (issueTypes.length === 0) {
              return {
                success: false,
                message: 'No issue types found for project',
                error: 'NO_ISSUE_TYPES'
              };
            }

            // Create issue
            const issue = await JiraService.createIssue(siteUrlOrCloudId, accessToken, {
              projectKey,
              title: command.params.title || 'Untitled Issue',
              description: command.params.description,
              issueTypeId: issueTypes[0].id,
              useCloudId
            });

            return {
              success: true,
              message: `✅ Created JIRA issue ${issue.key}`,
              data: issue
            };
          }
          break;

        case 'get':
          if (command.entity === 'issue') {
            // Try to extract issue key from mention or params
            let issueKey = command.params.issueKey;
            
            // If mention has entityId and entityType is 'issue', use that
            if (!issueKey && command.mention.entityType === 'issue' && command.mention.entityId) {
              issueKey = command.mention.entityId;
            }
            // If mention has subEntityId, use that
            if (!issueKey && command.mention.subEntityId) {
              issueKey = command.mention.subEntityId;
            }
            
            if (!issueKey) {
              return {
                success: false,
                message: 'Issue key is required. Use @jira:issue:ISSUE-KEY or specify in message',
                error: 'MISSING_ISSUE_KEY'
              };
            }

            const issue = await JiraService.getIssue(siteUrlOrCloudId, accessToken, issueKey, useCloudId);
            if (!issue) {
              return {
                success: false,
                message: `Issue ${issueKey} not found`,
                error: 'ISSUE_NOT_FOUND'
              };
            }

            return {
              success: true,
              message: `Issue ${issue.key}: ${issue.fields.summary}`,
              data: issue
            };
          } else if (command.entity === 'project') {
            const projects = await JiraService.listProjects(siteUrlOrCloudId, accessToken, useCloudId);
            return {
              success: true,
              message: `Found ${projects.length} projects`,
              data: projects
            };
          }
          break;

        case 'update':
          if (command.entity === 'issue') {
            // Try to extract issue key from mention or params
            let issueKey = command.params.issueKey;
            
            // If mention has entityId and entityType is 'issue', use that
            if (!issueKey && command.mention.entityType === 'issue' && command.mention.entityId) {
              issueKey = command.mention.entityId;
            }
            // If mention has subEntityId, use that
            if (!issueKey && command.mention.subEntityId) {
              issueKey = command.mention.subEntityId;
            }
            
            if (!issueKey) {
              return {
                success: false,
                message: 'Issue key is required. Use @jira:issue:ISSUE-KEY or specify in message',
                error: 'MISSING_ISSUE_KEY'
              };
            }

            const updates: {
              summary?: string;
              description?: string;
              priorityId?: string;
              labels?: string[];
            } = {};

            if (command.params.title) {
              updates.summary = command.params.title;
            }
            if (command.params.description) {
              updates.description = command.params.description;
            }

            if (Object.keys(updates).length === 0) {
              return {
                success: false,
                message: 'No updates provided. Specify title or description to update',
                error: 'NO_UPDATES'
              };
            }

            await JiraService.updateIssue(
              siteUrlOrCloudId,
              accessToken,
              issueKey,
              updates,
              useCloudId
            );

            return {
              success: true,
              message: `✅ Updated issue ${issueKey}`,
              data: { issueKey }
            };
          }
          break;

        case 'list':
          if (command.entity === 'issue') {
            const projectKey = command.mention.entityId;
            if (!projectKey) {
              return {
                success: false,
                message: 'Project key is required. Use @jira:project:PROJECT-KEY',
                error: 'MISSING_PROJECT_KEY'
              };
            }

            const result = await JiraService.listIssues(
              siteUrlOrCloudId,
              accessToken,
              projectKey,
              undefined,
              useCloudId
            );
            return {
              success: true,
              message: `Found ${result.total} issues in project ${projectKey}`,
              data: result.issues
            };
          } else if (command.entity === 'project') {
            const projects = await JiraService.listProjects(siteUrlOrCloudId, accessToken, useCloudId);
            return {
              success: true,
              message: `Found ${projects.length} projects`,
              data: projects
            };
          }
          break;

        case 'add':
          if (command.entity === 'comment') {
            // Try to extract issue key from mention or params
            let issueKey = command.params.issueKey;
            
            // If mention has entityId and entityType is 'issue', use that
            if (!issueKey && command.mention.entityType === 'issue' && command.mention.entityId) {
              issueKey = command.mention.entityId;
            }
            // If mention has subEntityId, use that
            if (!issueKey && command.mention.subEntityId) {
              issueKey = command.mention.subEntityId;
            }
            
            if (!issueKey) {
              return {
                success: false,
                message: 'Issue key is required. Use @jira:issue:ISSUE-KEY or specify in message',
                error: 'MISSING_ISSUE_KEY'
              };
            }

            const commentText = command.params.comment || 'No comment provided';
            const result = await JiraService.addComment(
              siteUrlOrCloudId,
              accessToken,
              issueKey,
              commentText,
              useCloudId
            );

            return {
              success: true,
              message: `✅ Comment added to issue ${issueKey}`,
              data: { commentId: result.commentId }
            };
          }
          break;
      }

      return {
        success: false,
        message: `Command not supported: ${command.type} ${command.entity}`,
        error: 'UNSUPPORTED_COMMAND'
      };
    } catch (error: any) {
      loggingService.error('Failed to execute JIRA command', {
        error: error.message,
        command
      });
      return {
        success: false,
        message: `JIRA command failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Execute Linear command
   */
  private static async executeLinearCommand(
    command: IntegrationCommand,
    integration: IIntegration,
    credentials: IntegrationCredentials
  ): Promise<IntegrationCommandResult> {
    const accessToken = credentials.accessToken || '';

    if (!accessToken) {
      return {
        success: false,
        message: 'Linear credentials not configured',
        error: 'MISSING_CREDENTIALS'
      };
    }

    try {
      switch (command.type) {
        case 'create':
          if (command.entity === 'issue') {
            const teamId = command.mention.entityId || credentials.teamId;
            if (!teamId) {
              return {
                success: false,
                message: 'Team ID is required. Use @linear:team:TEAM-ID',
                error: 'MISSING_TEAM_ID'
              };
            }

            const projectId = command.mention.subEntityType === 'project' && command.mention.subEntityId 
              ? command.mention.subEntityId 
              : undefined;

            const issue = await LinearService.createIssue(accessToken, {
              teamId,
              title: command.params.title || 'Untitled Issue',
              description: command.params.description,
              projectId
            });

            return {
              success: true,
              message: `✅ Created Linear issue ${issue.identifier}`,
              data: issue
            };
          }
          break;

        case 'get':
          if (command.entity === 'issue') {
            // Try to extract issue ID from mention or params
            let issueId = command.params.issueId;
            
            // If mention has entityId and entityType is 'issue', use that
            if (!issueId && command.mention.entityType === 'issue' && command.mention.entityId) {
              issueId = command.mention.entityId;
            }
            // If mention has subEntityId, use that
            if (!issueId && command.mention.subEntityId) {
              issueId = command.mention.subEntityId;
            }
            
            if (!issueId) {
              return {
                success: false,
                message: 'Issue ID is required. Use @linear:issue:ISSUE-ID or specify in message',
                error: 'MISSING_ISSUE_ID'
              };
            }

            const issue = await LinearService.getIssue(accessToken, issueId);
            if (!issue) {
              return {
                success: false,
                message: `Issue ${issueId} not found`,
                error: 'ISSUE_NOT_FOUND'
              };
            }

            return {
              success: true,
              message: `Issue ${issue.identifier}: ${issue.title}`,
              data: issue
            };
          }
          break;

        case 'list':
          if (command.entity === 'team') {
            const teams = await LinearService.listTeams(accessToken);
            return {
              success: true,
              message: `Found ${teams.length} teams`,
              data: teams
            };
          } else if (command.entity === 'user') {
            // List users requires organization context
            const users = await LinearService.listUsers(accessToken);
            return {
              success: true,
              message: `Found ${users.length} users`,
              data: users
            };
          } else if (command.entity === 'workflow' || command.entity === 'channel') {
            // List workflows (states) - Linear doesn't have channels, so map to workflows
            let teamId = command.mention.entityId;
            
            if (!teamId) {
              const teams = await LinearService.listTeams(accessToken);
              if (teams.length > 0) {
                teamId = teams[0].id;
              } else {
                return {
                  success: false,
                  message: 'Team ID is required. Use @linear:team:TEAM-ID or ensure you have at least one team',
                  error: 'MISSING_TEAM_ID'
                };
              }
            }

            const workflows = await LinearService.listWorkflows(accessToken, teamId);
            return {
              success: true,
              message: `Found ${workflows.length} workflows in team`,
              data: workflows
            };
          } else if (command.entity === 'tag' || command.entity === 'label') {
            // List labels (tags)
            let teamId = command.mention.entityId;
            
            if (!teamId) {
              const teams = await LinearService.listTeams(accessToken);
              if (teams.length > 0) {
                teamId = teams[0].id;
              } else {
                return {
                  success: false,
                  message: 'Team ID is required. Use @linear:team:TEAM-ID or ensure you have at least one team',
                  error: 'MISSING_TEAM_ID'
                };
              }
            }

            const labels = await LinearService.listLabels(accessToken, teamId);
            return {
              success: true,
              message: `Found ${labels.length} labels in team`,
              data: labels
            };
          } else if (command.entity === 'iteration' || command.entity === 'cycle') {
            // List cycles (iterations)
            let teamId = command.mention.entityId;
            
            if (!teamId) {
              const teams = await LinearService.listTeams(accessToken);
              if (teams.length > 0) {
                teamId = teams[0].id;
              } else {
                return {
                  success: false,
                  message: 'Team ID is required. Use @linear:team:TEAM-ID or ensure you have at least one team',
                  error: 'MISSING_TEAM_ID'
                };
              }
            }

            const cycles = await LinearService.listCycles(accessToken, teamId);
            return {
              success: true,
              message: `Found ${cycles.length} cycles in team`,
              data: cycles
            };
          } else if (command.entity === 'epic') {
            // Linear doesn't have epics, map to projects
            let teamId = command.mention.entityId;
            
            if (!teamId) {
              const teams = await LinearService.listTeams(accessToken);
              if (teams.length > 0) {
                teamId = teams[0].id;
              } else {
                return {
                  success: false,
                  message: 'Team ID is required. Use @linear:team:TEAM-ID or ensure you have at least one team',
                  error: 'MISSING_TEAM_ID'
                };
              }
            }

            const projects = await LinearService.listProjects(accessToken, teamId);
            return {
              success: true,
              message: `Found ${projects.length} projects (epics) in team`,
              data: projects
            };
          } else if (command.entity === 'project') {
            // For list projects, we need a team ID. Try to get from mention or use first team
            let teamId = command.mention.entityId;
            
            // If no team ID specified, try to get the first team
            if (!teamId) {
              const teams = await LinearService.listTeams(accessToken);
              if (teams.length > 0) {
                teamId = teams[0].id;
              } else {
                return {
                  success: false,
                  message: 'Team ID is required. Use @linear:team:TEAM-ID or ensure you have at least one team',
                  error: 'MISSING_TEAM_ID'
                };
              }
            }

            const projects = await LinearService.listProjects(accessToken, teamId);
            return {
              success: true,
              message: `Found ${projects.length} projects${teamId ? ` in team ${teamId}` : ''}`,
              data: projects
            };
          } else if (command.entity === 'issue') {
            const teamId = command.mention.entityId;
            if (!teamId) {
              // Try to get the first team if no team ID specified
              const teams = await LinearService.listTeams(accessToken);
              if (teams.length > 0) {
                const firstTeamId = teams[0].id;
                const result = await LinearService.listIssues(accessToken, firstTeamId);
                return {
                  success: true,
                  message: `Found ${result.total} issues in team ${teams[0].name}`,
                  data: result.issues
                };
              } else {
                return {
                  success: false,
                  message: 'Team ID is required. Use @linear:team:TEAM-ID or ensure you have at least one team',
                  error: 'MISSING_TEAM_ID'
                };
              }
            }

            const result = await LinearService.listIssues(accessToken, teamId);
            return {
              success: true,
              message: `Found ${result.total} issues in team`,
              data: result.issues
            };
          }
          break;

        case 'update':
          if (command.entity === 'issue') {
            // Try to extract issue ID from mention or params
            let issueId = command.params.issueId;
            
            // If mention has entityId and entityType is 'issue', use that
            if (!issueId && command.mention.entityType === 'issue' && command.mention.entityId) {
              issueId = command.mention.entityId;
            }
            // If mention has subEntityId, use that
            if (!issueId && command.mention.subEntityId) {
              issueId = command.mention.subEntityId;
            }
            
            if (!issueId) {
              return {
                success: false,
                message: 'Issue ID is required. Use @linear:issue:ISSUE-ID or specify in message',
                error: 'MISSING_ISSUE_ID'
              };
            }

            const updates: {
              title?: string;
              description?: string;
              stateId?: string;
              priority?: number;
            } = {};

            if (command.params.title) {
              updates.title = command.params.title;
            }
            if (command.params.description) {
              updates.description = command.params.description;
            }

            if (Object.keys(updates).length === 0) {
              return {
                success: false,
                message: 'No updates provided. Specify title or description to update',
                error: 'NO_UPDATES'
              };
            }

            await LinearService.updateIssue(accessToken, issueId, updates);

            return {
              success: true,
              message: `✅ Updated Linear issue`,
              data: { issueId }
            };
          }
          break;
      }

      return {
        success: false,
        message: `Command not supported: ${command.type} ${command.entity}`,
        error: 'UNSUPPORTED_COMMAND'
      };
    } catch (error: any) {
      loggingService.error('Failed to execute Linear command', {
        error: error.message,
        command
      });
      return {
        success: false,
        message: `Linear command failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Execute Slack command
   */
  private static async executeSlackCommand(
    command: IntegrationCommand,
    integration: IIntegration,
    credentials: IntegrationCredentials
  ): Promise<IntegrationCommandResult> {
    const accessToken = credentials.accessToken || '';
    let channelId = command.mention.entityId || credentials.channelId || '';

    if (!accessToken) {
      // Check integration type to provide specific guidance
      const integrationType = integration.type;
      const isWebhook = integrationType === 'slack_webhook';
      const isOAuth = integrationType === 'slack_oauth';

      let errorMessage = '❌ Slack access token is missing. ';
      
      if (isWebhook) {
        errorMessage += 'Your Slack webhook integration requires an access token to list channels and perform operations. Please go to Settings → Integrations → Slack and add your access token or switch to OAuth integration.';
      } else if (isOAuth) {
        errorMessage += 'Your Slack OAuth integration is missing the access token. Please reconnect your Slack integration from Settings → Integrations.';
      } else {
        errorMessage += 'Please configure your Slack integration with a valid access token from Settings → Integrations.';
      }

      return {
        success: false,
        message: errorMessage,
        error: 'MISSING_ACCESS_TOKEN'
      };
    }

    try {
      switch (command.type) {
        case 'send':
          if (command.entity === 'message') {
            // If no channelId provided, try to lookup by name or use first available channel
            if (!channelId) {
              const channelName = command.params.channelName;
              
              if (channelName) {
                // Lookup channel by name
                loggingService.info('Looking up Slack channel by name', { channelName });
                const channels = await SlackService.listChannels(accessToken);
                const channel = channels.find((ch: any) => 
                  ch.name === channelName.replace(/^#/, '') || // Remove # prefix if present
                  ch.name === channelName
                );
                
                if (channel) {
                  channelId = channel.id;
                  loggingService.info('Found Slack channel by name', { channelName, channelId });
                } else {
                  return {
                    success: false,
                    message: `❌ Channel "${channelName}" not found. Use @slack list-channels to see available channels.`,
                    error: 'CHANNEL_NOT_FOUND'
                  };
                }
              } else {
                // No channel specified - use first available text channel as default
                loggingService.info('No channel specified, using first available Slack channel');
                const channels = await SlackService.listChannels(accessToken);
                const textChannels = channels.filter((ch: any) => !ch.is_archived);
                
                if (textChannels.length > 0) {
                  channelId = textChannels[0].id;
                  loggingService.info('Using first available Slack channel', { 
                    channelId, 
                    channelName: textChannels[0].name 
                  });
                } else {
                  return {
                    success: false,
                    message: '❌ No available channels found. Please create a channel or specify a channel ID.',
                    error: 'NO_CHANNELS_AVAILABLE'
                  };
                }
              }
            }

            await SlackService.sendMessage(accessToken, channelId, command.params.message || '');
            return {
              success: true,
              message: `✅ Message sent to Slack channel`,
              data: { channelId }
            };
          }
          break;

        case 'list':
          if (command.entity === 'channel') {
            const channels = await SlackService.listChannels(accessToken);
            return {
              success: true,
              message: `Found ${channels.length} channels`,
              data: channels.map((ch: any) => ({
                id: ch.id,
                name: ch.name,
                isPrivate: ch.is_private,
                isArchived: ch.is_archived
              }))
            };
          } else if (command.entity === 'user') {
            const users = await SlackService.listUsers(accessToken);
            return {
              success: true,
              message: `Found ${users.length} users`,
              data: users.map((user: any) => ({
                id: user.id,
                name: user.name,
                realName: user.real_name,
                displayName: user.profile?.display_name,
                isBot: user.is_bot,
                deleted: user.deleted
              }))
            };
          }
          break;

        case 'create':
          if (command.entity === 'channel') {
            const channelName = command.params.name || command.params.channelName;
            if (!channelName) {
              return {
                success: false,
                message: 'Channel name is required',
                error: 'MISSING_CHANNEL_NAME'
              };
            }

            const result = await SlackService.createChannel(
              accessToken,
              channelName,
              command.params.isPrivate || false
            );

            return {
              success: true,
              message: `✅ Created Slack channel ${channelName}`,
              data: { channelId: result.channelId }
            };
          }
          break;
      }

      return {
        success: false,
        message: `❌ Slack command not supported: ${command.type} ${command.entity}. Available commands: send-message, list-channels, list-users`,
        error: 'UNSUPPORTED_COMMAND'
      };
    } catch (error: any) {
      loggingService.error('Failed to execute Slack command', {
        error: error.message,
        command
      });
      return {
        success: false,
        message: `❌ Slack command failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Execute Discord command
   */
  private static async executeDiscordCommand(
    command: IntegrationCommand,
    integration: IIntegration,
    credentials: IntegrationCredentials
  ): Promise<IntegrationCommandResult> {
    const botToken = credentials.botToken || '';
    const webhookUrl = credentials.webhookUrl || '';
    let channelId = command.mention.entityId || credentials.channelId || '';
    const integrationType = integration.type;
    const isWebhook = integrationType === 'discord_webhook';

    // For webhook integrations, only certain operations are supported
    if (isWebhook && !botToken) {
      // Check if this is a send operation that can use webhook
      if (command.type === 'send' && command.entity === 'message' && webhookUrl) {
        // Webhook can send messages without bot token
        try {
          const discordMessage: any = {
            content: command.params.message || ''
          };
          await DiscordService.sendWebhookMessage(webhookUrl, discordMessage);
          return {
            success: true,
            message: `✅ Message sent to Discord via webhook`,
            data: { method: 'webhook' }
          };
        } catch (error: any) {
          return {
            success: false,
            message: `❌ Failed to send Discord message: ${error.message}`,
            error: 'WEBHOOK_SEND_FAILED'
          };
        }
      }

      // For other operations, bot token is required
      return {
        success: false,
        message: `❌ This operation requires a Discord bot token. Your current webhook integration can only send messages to the pre-configured channel. To use commands like listing channels, please add a bot token in Settings → Integrations → Discord, or switch to OAuth integration. Get a bot token from: https://discord.com/developers/applications`,
        error: 'WEBHOOK_LIMITATION'
      };
    }

    // For OAuth or webhook with bot token
    if (!botToken) {
      return {
        success: false,
        message: '❌ Discord bot token is missing. Please reconnect your Discord integration from Settings → Integrations.',
        error: 'MISSING_BOT_TOKEN'
      };
    }

      try {
        switch (command.type) {
          case 'send':
            if (command.entity === 'message') {
              const guildId = credentials.guildId || '';
              const channelName = command.params.channelName || command.params.channel;
              
              // If no channel ID but name provided, look up channel by name
              if (!channelId && channelName) {
                if (!guildId) {
                  return {
                    success: false,
                    message: '❌ Guild ID is required to look up channel by name',
                    error: 'MISSING_GUILD_ID'
                  };
                }

                try {
                  const channels = await DiscordService.listChannels(botToken, guildId);
                  const matchedChannel = channels.find((ch: any) => 
                    ch.name?.toLowerCase() === channelName.toLowerCase()
                  );

                  if (!matchedChannel) {
                    return {
                      success: false,
                      message: `❌ Channel "${channelName}" not found. Use @discord list-channels to see available channels.`,
                      error: 'CHANNEL_NOT_FOUND'
                    };
                  }

                  channelId = matchedChannel.id;
                } catch (error: any) {
                  return {
                    success: false,
                    message: `❌ Failed to lookup channel: ${error.message}`,
                    error: 'CHANNEL_LOOKUP_FAILED'
                  };
                }
              }

              // If still no channel ID, try to use first available text channel
              if (!channelId && guildId) {
                try {
                  const channels = await DiscordService.listChannels(botToken, guildId);
                  // Find first text channel (type 0)
                  const textChannel = channels.find((ch: any) => ch.type === 0);
                  
                  if (textChannel) {
                    channelId = textChannel.id;
                    loggingService.info('Using first available text channel', {
                      channelId,
                      channelName: textChannel.name
                    });
                  }
                } catch (error: any) {
                  loggingService.warn('Failed to fetch channels for default channel', {
                    error: error.message
                  });
                }
              }
              
              if (!channelId) {
                return {
                  success: false,
                  message: '❌ Channel not specified. Example: @discord send hi to general',
                  error: 'MISSING_CHANNEL_ID'
                };
              }

              await DiscordService.sendMessage(botToken, channelId, command.params.message || '');
              return {
                success: true,
                message: `✅ Message sent to Discord channel${channelName ? ` #${channelName}` : ''}`,
                data: { channelId, channelName }
              };
            }
            break;

          case 'list':
            if (command.entity === 'channel') {
              const guildId = credentials.guildId || '';
              
              loggingService.info('Executing Discord list channels command', {
                hasGuildId: !!guildId,
                hasBotToken: !!botToken,
                botTokenLength: botToken?.length,
                guildId,
                credentialsKeys: Object.keys(credentials)
              });

              if (!guildId) {
                return {
                  success: false,
                  message: '❌ Discord Guild (Server) ID is missing. Please go to Settings → Integrations → Discord and add your Guild ID. You can find your Guild ID by right-clicking your Discord server and selecting "Copy Server ID" (Developer Mode must be enabled in Discord settings).',
                  error: 'MISSING_GUILD_ID'
                };
              }

              const channels = await DiscordService.listChannels(botToken, guildId);
              return {
                success: true,
                message: `✅ Found ${channels.length} Discord channels`,
                data: channels.map((ch: any) => ({
                  id: ch.id,
                  name: ch.name || ch.id,
                  type: ch.type
                }))
              };
            } else if (command.entity === 'user') {
              const guildId = credentials.guildId || '';
              if (!guildId) {
                return {
                  success: false,
                  message: 'Guild ID is required in integration credentials',
                  error: 'MISSING_GUILD_ID'
                };
              }

              const members = await DiscordService.listGuildMembers(botToken, guildId);
              return {
                success: true,
                message: `Found ${members.length} users`,
                data: members.map((member: any) => ({
                  id: member.user?.id,
                  username: member.user?.username,
                  displayName: member.nick || member.user?.global_name || member.user?.username,
                  roles: member.roles
                }))
              };
            }
            break;

          case 'create':
            if (command.entity === 'channel') {
              const guildId = credentials.guildId || '';
              const channelName = command.params.name || command.params.channelName;
              
              if (!guildId) {
                return {
                  success: false,
                  message: 'Guild ID is required in integration credentials',
                  error: 'MISSING_GUILD_ID'
                };
              }

              if (!channelName) {
                return {
                  success: false,
                  message: 'Channel name is required',
                  error: 'MISSING_CHANNEL_NAME'
                };
              }

              const result = await DiscordService.createChannel(
                botToken,
                guildId,
                channelName,
                command.params.type || 0
              );

              return {
                success: true,
                message: `✅ Created Discord channel ${channelName}`,
                data: { channelId: result.channelId }
              };
            } else if (command.entity === 'role') {
              const guildId = credentials.guildId || '';
              const roleName = command.params.name || command.params.roleName;
              
              if (!guildId) {
                return {
                  success: false,
                  message: '❌ Guild ID is required',
                  error: 'MISSING_GUILD_ID'
                };
              }

              if (!roleName) {
                return {
                  success: false,
                  message: '❌ Role name is required. Use: @discord create role "Role Name"',
                  error: 'MISSING_ROLE_NAME'
                };
              }

              const result = await DiscordService.createRole(
                botToken,
                guildId,
                roleName,
                command.params.color,
                command.params.permissions,
                command.params.hoist
              );

              return {
                success: true,
                message: `✅ Created Discord role "${roleName}"`,
                data: { roleId: result.id, roleName: result.name }
              };
            }
            break;

          case 'delete':
            if (command.entity === 'channel') {
              const guildId = credentials.guildId || '';
              let channelId = command.mention.entityId || command.params.channelId;
              const channelName = command.params.name || command.params.channelName;
              
              // If no channel ID but name provided, look up channel by name
              if (!channelId && channelName) {
                if (!guildId) {
                  return {
                    success: false,
                    message: '❌ Guild ID is required to look up channel by name',
                    error: 'MISSING_GUILD_ID'
                  };
                }

                try {
                  const channels = await DiscordService.listChannels(botToken, guildId);
                  const matchedChannel = channels.find((ch: any) => 
                    ch.name?.toLowerCase() === channelName.toLowerCase()
                  );

                  if (!matchedChannel) {
                    return {
                      success: false,
                      message: `❌ Channel "${channelName}" not found. Use @discord list-channels to see available channels.`,
                      error: 'CHANNEL_NOT_FOUND'
                    };
                  }

                  channelId = matchedChannel.id;
                } catch (error: any) {
                  return {
                    success: false,
                    message: `❌ Failed to lookup channel: ${error.message}`,
                    error: 'CHANNEL_LOOKUP_FAILED'
                  };
                }
              }
              
              if (!channelId) {
                return {
                  success: false,
                  message: '❌ Channel ID or name is required. Example: @discord delete channel QA',
                  error: 'MISSING_CHANNEL_ID'
                };
              }

              await DiscordService.deleteChannel(
                botToken,
                channelId,
                command.params.reason
              );

              return {
                success: true,
                message: `✅ Deleted Discord channel${channelName ? ` "${channelName}"` : ''}`,
                data: { channelId, channelName }
              };
            }
            break;

          case 'assign':
            if (command.entity === 'role') {
              const guildId = credentials.guildId || '';
              const userId = command.params.userId || command.params.user;
              const roleId = command.params.roleId || command.params.role;
              
              if (!guildId || !userId || !roleId) {
                return {
                  success: false,
                  message: '❌ Guild ID, User ID, and Role ID are required',
                  error: 'MISSING_PARAMETERS'
                };
              }

              await DiscordService.assignRole(botToken, guildId, userId, roleId);

              return {
                success: true,
                message: `✅ Assigned role to user`,
                data: { userId, roleId }
              };
            }
            break;

          case 'remove':
            if (command.entity === 'role') {
              const guildId = credentials.guildId || '';
              const userId = command.params.userId || command.params.user;
              const roleId = command.params.roleId || command.params.role;
              
              if (!guildId || !userId || !roleId) {
                return {
                  success: false,
                  message: '❌ Guild ID, User ID, and Role ID are required',
                  error: 'MISSING_PARAMETERS'
                };
              }

              await DiscordService.removeRole(botToken, guildId, userId, roleId);

              return {
                success: true,
                message: `✅ Removed role from user`,
                data: { userId, roleId }
              };
            }
            break;

          case 'ban':
            if (command.entity === 'user') {
              const guildId = credentials.guildId || '';
              const userId = command.params.userId || command.params.user || command.mention.entityId;
              const reason = command.params.reason;
              const deleteMessageDays = command.params.deleteMessageDays || 0;
              
              if (!guildId || !userId) {
                return {
                  success: false,
                  message: '❌ Guild ID and User ID are required. Use: @discord:user:USER_ID ban',
                  error: 'MISSING_PARAMETERS'
                };
              }

              await DiscordService.banUser(botToken, guildId, userId, reason, deleteMessageDays);

              return {
                success: true,
                message: `✅ Banned user from Discord server`,
                data: { userId, reason }
              };
            }
            break;

          case 'unban':
            if (command.entity === 'user') {
              const guildId = credentials.guildId || '';
              const userId = command.params.userId || command.params.user || command.mention.entityId;
              
              if (!guildId || !userId) {
                return {
                  success: false,
                  message: '❌ Guild ID and User ID are required. Use: @discord:user:USER_ID unban',
                  error: 'MISSING_PARAMETERS'
                };
              }

              await DiscordService.unbanUser(botToken, guildId, userId);

              return {
                success: true,
                message: `✅ Unbanned user from Discord server`,
                data: { userId }
              };
            }
            break;

          case 'kick':
            if (command.entity === 'user') {
              const guildId = credentials.guildId || '';
              const userId = command.params.userId || command.params.user || command.mention.entityId;
              const reason = command.params.reason;
              
              if (!guildId || !userId) {
                return {
                  success: false,
                  message: '❌ Guild ID and User ID are required. Use: @discord:user:USER_ID kick',
                  error: 'MISSING_PARAMETERS'
                };
              }

              await DiscordService.kickUser(botToken, guildId, userId, reason);

              return {
                success: true,
                message: `✅ Kicked user from Discord server`,
                data: { userId, reason }
              };
            }
            break;

          case 'get':
          case 'list':
            if (command.entity === 'role' || command.entity === 'roles') {
              const guildId = credentials.guildId || '';
              
              if (!guildId) {
                return {
                  success: false,
                  message: '❌ Guild ID is required',
                  error: 'MISSING_GUILD_ID'
                };
              }

              const roles = await DiscordService.listGuildRoles(botToken, guildId);

              return {
                success: true,
                message: `✅ Found ${roles.length} Discord roles`,
                data: roles.map((role: any) => ({
                  id: role.id,
                  name: role.name,
                  color: role.color,
                  position: role.position,
                  permissions: role.permissions,
                  managed: role.managed
                }))
              };
            }
            break;
      }

      return {
        success: false,
        message: `❌ Command not supported: ${command.type} ${command.entity}. Available commands: list channels/users/roles, send message, create channel/role, delete channel, ban/unban/kick user, assign/remove role`,
        error: 'UNSUPPORTED_COMMAND'
      };
    } catch (error: any) {
      loggingService.error('Failed to execute Discord command', {
        error: error.message,
        command
      });
      return {
        success: false,
        message: `Discord command failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Execute GitHub command
   */
  private static async executeGitHubCommand(
    command: IntegrationCommand,
    integration: IIntegration,
    credentials: IntegrationCredentials
  ): Promise<IntegrationCommandResult> {
    const accessToken = credentials.accessToken || '';
    const connection = integration as unknown as IGitHubConnection & { decryptToken: () => string };

    if (!accessToken) {
      return {
        success: false,
        message: 'GitHub credentials not configured',
        error: 'MISSING_CREDENTIALS'
      };
    }

    try {
      // Parse repository from mention (format: owner/repo or just repo)
      const repoParts = command.mention.entityId?.split('/') || [];
      let owner = repoParts[0] || '';
      let repo = repoParts[1] || repoParts[0] || '';

      // If we have a repository mention, extract owner/repo
      if (command.mention.entityType === 'repository' && command.mention.entityId) {
        const parts = command.mention.entityId.split('/');
        if (parts.length === 2) {
          owner = parts[0];
          repo = parts[1];
        } else {
          // Try to get owner from authenticated user
          const user = await GitHubService.getAuthenticatedUser(connection.decryptToken());
          owner = user.login;
          repo = parts[0];
        }
      }

      switch (command.type) {
        case 'create':
          if (command.entity === 'repository') {
            const repoName = command.params.name || repo;
            if (!repoName) {
              return {
                success: false,
                message: 'Repository name is required',
                error: 'MISSING_REPO_NAME'
              };
            }

            const octokit = await GitHubService['getOctokitFromConnection'](connection);
            const { data } = await octokit.rest.repos.createForAuthenticatedUser({
              name: repoName,
              description: command.params.description,
              private: command.params.private || false
            });

            return {
              success: true,
              message: `✅ Created GitHub repository ${data.full_name}`,
              data: {
                id: data.id,
                name: data.name,
                fullName: data.full_name,
                url: data.html_url
              }
            };
          } else if (command.entity === 'issue') {
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Repository is required. Use @github:repository:owner/repo',
                error: 'MISSING_REPOSITORY'
              };
            }

            const octokit = await GitHubService['getOctokitFromConnection'](connection);
            const { data } = await octokit.rest.issues.create({
              owner,
              repo,
              title: command.params.title || 'Untitled Issue',
              body: command.params.body || command.params.description
            });

            return {
              success: true,
              message: `✅ Created GitHub issue #${data.number} in ${owner}/${repo}`,
              data: {
                number: data.number,
                title: data.title,
                url: data.html_url
              }
            };
          } else if (command.entity === 'pullrequest') {
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Repository is required. Use @github:repository:owner/repo',
                error: 'MISSING_REPOSITORY'
              };
            }

            const head = command.params.head || command.mention.subEntityId || 'main';
            const base = command.params.base || 'main';

            const pr = await GitHubService.createPullRequest(connection, {
              owner,
              repo,
              title: command.params.title || 'Untitled Pull Request',
              body: command.params.body || command.params.description || '',
              head,
              base,
              draft: command.params.draft || false
            });

            return {
              success: true,
              message: `✅ Created pull request #${pr.number} in ${owner}/${repo}`,
              data: {
                number: pr.number,
                url: pr.html_url
              }
            };
          } else if (command.entity === 'branch') {
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Repository is required. Use @github:repository:owner/repo',
                error: 'MISSING_REPOSITORY'
              };
            }

            const branchName = command.params.branchName || command.mention.subEntityId;
            if (!branchName) {
              return {
                success: false,
                message: 'Branch name is required',
                error: 'MISSING_BRANCH_NAME'
              };
            }

            const fromBranch = command.params.fromBranch || 'main';
            await GitHubService.createBranch(connection, {
              owner,
              repo,
              branchName,
              fromBranch
            });

            return {
              success: true,
              message: `✅ Created branch ${branchName} in ${owner}/${repo}`,
              data: { branchName }
            };
          }
          break;

        case 'list':
          if (command.entity === 'repository') {
            const repos = await GitHubService.listUserRepositories(connection);
            return {
              success: true,
              message: `Found ${repos.length} repositories`,
              data: repos.map(r => ({
                id: r.fullName,
                name: r.fullName,
                url: r.url
              }))
            };
          } else if (command.entity === 'issue') {
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Repository is required. Use @github:repository:owner/repo',
                error: 'MISSING_REPOSITORY'
              };
            }

            const octokit = await GitHubService['getOctokitFromConnection'](connection);
            const { data } = await octokit.rest.issues.listForRepo({
              owner,
              repo,
              state: 'open',
              per_page: 50
            });

            return {
              success: true,
              message: `Found ${data.length} open issues in ${owner}/${repo}`,
              data: data.map((issue: { number: number; title: string; html_url: string; state: string }) => ({
                number: issue.number,
                title: issue.title,
                url: issue.html_url,
                state: issue.state
              }))
            };
          } else if (command.entity === 'pullrequest') {
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Repository is required. Use @github:repository:owner/repo',
                error: 'MISSING_REPOSITORY'
              };
            }

            const prNumber = parseInt(command.params.prNumber || command.mention.subEntityId || '0');
            if (prNumber > 0) {
              const pr = await GitHubService.getPullRequest(connection, owner, repo, prNumber);
              if (!pr) {
                return {
                  success: false,
                  message: 'Pull request not found',
                  error: 'PR_NOT_FOUND'
                };
              }

              return {
                success: true,
                message: `PR #${pr.number}: ${pr.title}`,
                data: pr
              };
            } else {
              // List all PRs
              const octokit = await GitHubService['getOctokitFromConnection'](connection);
              const { data } = await octokit.rest.pulls.list({
                owner,
                repo,
                state: 'open',
                per_page: 50
              });

              return {
                success: true,
                message: `Found ${data.length} open pull requests in ${owner}/${repo}`,
                data: data.map((pr: { number: number; title: string; html_url: string; state: string }) => ({
                  number: pr.number,
                  title: pr.title,
                  url: pr.html_url,
                  state: pr.state
                }))
              };
            }
          } else if (command.entity === 'branch') {
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Repository is required. Use @github:repository:owner/repo',
                error: 'MISSING_REPOSITORY'
              };
            }

            const octokit = await GitHubService['getOctokitFromConnection'](connection);
            const { data } = await octokit.rest.repos.listBranches({
              owner,
              repo,
              per_page: 50
            });

            return {
              success: true,
              message: `Found ${data.length} branches in ${owner}/${repo}`,
              data: data.map((branch: { name: string; protected: boolean }) => ({
                name: branch.name,
                protected: branch.protected
              }))
            };
          }
          break;

        case 'get':
          if (command.entity === 'repository') {
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Repository is required. Use @github:repository:owner/repo',
                error: 'MISSING_REPOSITORY'
              };
            }

            const repoData = await GitHubService.getRepository(connection, owner, repo);
            return {
              success: true,
              message: `Repository: ${repoData.full_name}`,
              data: repoData
            };
          }
          break;

        case 'update':
          if (command.entity === 'pullrequest') {
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Repository is required. Use @github:repository:owner/repo',
                error: 'MISSING_REPOSITORY'
              };
            }

            const prNumber = parseInt(command.params.prNumber || command.mention.subEntityId || '0');
            if (!prNumber) {
              return {
                success: false,
                message: 'Pull request number is required',
                error: 'MISSING_PR_NUMBER'
              };
            }

            await GitHubService.updatePullRequest(connection, {
              owner,
              repo,
              prNumber,
              title: command.params.title,
              body: command.params.body || command.params.description,
              state: command.params.state as 'open' | 'closed' | undefined
            });

            return {
              success: true,
              message: `✅ Updated pull request #${prNumber}`,
              data: { prNumber }
            };
          }
          break;
      }

      return {
        success: false,
        message: `❌ GitHub command not supported: ${command.type} ${command.entity}. Available commands: create-issue, create-pr, list-issues, list-prs, list-branches, get-issue, add-comment`,
        error: 'UNSUPPORTED_COMMAND'
      };
    } catch (error: any) {
      loggingService.error('Failed to execute GitHub command', {
        error: error.message,
        command
      });
      return {
        success: false,
        message: `❌ GitHub command failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Execute Google command
   */
  private static async executeGoogleCommand(
    command: IntegrationCommand,
    integration: IIntegration,
    credentials: IntegrationCredentials
  ): Promise<IntegrationCommandResult> {
    try {
      const { GoogleService } = await import('./google.service');
      const { GoogleIntegrationService } = await import('./googleIntegration.service');
      const { GoogleConnection } = await import('../models/GoogleConnection');

      // Get Google connection from metadata or credentials
      let connectionId = integration.metadata?.connectionId;
      
      // Fallback: try to get connectionId from credentials if not in metadata
      if (!connectionId && (credentials as any).connectionId) {
        connectionId = (credentials as any).connectionId;
      }

      // If we have connectionId, fetch the connection
      let connection = null;
      if (connectionId) {
        connection = await GoogleConnection.findOne({
          _id: connectionId,
          userId: integration.userId.toString(),
          isActive: true
        }).select('+accessToken +refreshToken');
      }

      // Fallback: If no connection found but we have accessToken in credentials, 
      // try to find connection by userId and validate token
      if (!connection && credentials.accessToken) {
        // Try to find any active Google connection for this user
        const connections = await GoogleConnection.find({
          userId: integration.userId.toString(),
          isActive: true
        }).select('+accessToken +refreshToken').limit(1);

        if (connections.length > 0) {
          connection = connections[0];
          // Validate that the token matches (optional check)
          try {
            const decryptedToken = connection.decryptToken();
            if (decryptedToken !== credentials.accessToken) {
              // Token mismatch, but still use the connection from DB
              loggingService.warn('Google access token mismatch between credentials and connection', {
                userId: integration.userId.toString(),
                connectionId: connection._id
              });
            }
          } catch (error) {
            // Token decryption failed, continue with connection anyway
            loggingService.warn('Failed to decrypt Google token for validation', {
              userId: integration.userId.toString(),
              connectionId: connection._id
            });
          }
        }
      }

      if (!connection) {
        return {
          success: false,
          message: '❌ Google connection not found. Please connect your Google account from Settings → Integrations.',
          error: 'No active Google connection found'
        };
      }

      // Use connectionId from the found connection
      const finalConnectionId = connection._id.toString();

      const mention = command.mention;
      const action = mention.entityType; // sheets, docs, drive, etc.
      const subAction = mention.subEntityType; // export, create, list, etc.

      // Handle different Google product actions
      if (action === 'sheets') {
        if (subAction === 'export' || command.params?.export) {
          // Export cost data to Google Sheets
          const result = await GoogleIntegrationService.exportCostDataToSheets(connection, {
            userId: integration.userId.toString(),
            connectionId: finalConnectionId,
            startDate: command.params?.startDate ? new Date(command.params.startDate) : undefined,
            endDate: command.params?.endDate ? new Date(command.params.endDate) : undefined,
            projectId: command.params?.projectId,
            redactionOptions: command.params?.redactionOptions
          });

          return {
            success: true,
            message: `✅ Exported cost data to Google Sheets`,
            data: {
              spreadsheetUrl: result.spreadsheetUrl,
              spreadsheetId: result.spreadsheetId
            }
          };
        } else if (subAction === 'list') {
          // List sheets
          const { files } = await GoogleService.listDriveFiles(connection, {
            query: "mimeType='application/vnd.google-apps.spreadsheet'"
          });

          return {
            success: true,
            message: `📊 Found ${files.length} Google Sheets`,
            data: files
          };
        }
      } else if (action === 'docs') {
        if (subAction === 'report' || command.params?.report) {
          // Create cost report in Google Docs
          const result = await GoogleIntegrationService.createCostReportInDocs(connection, {
            userId: integration.userId.toString(),
            connectionId: finalConnectionId,
            startDate: command.params?.startDate ? new Date(command.params.startDate) : undefined,
            endDate: command.params?.endDate ? new Date(command.params.endDate) : undefined,
            projectId: command.params?.projectId,
            includeTopModels: true,
            includeRecommendations: true
          });

          return {
            success: true,
            message: `✅ Created cost report in Google Docs`,
            data: {
              documentUrl: result.documentUrl,
              documentId: result.documentId
            }
          };
        } else if (subAction === 'list') {
          // List docs
          const { files } = await GoogleService.listDriveFiles(connection, {
            query: "mimeType='application/vnd.google-apps.document'"
          });

          return {
            success: true,
            message: `📄 Found ${files.length} Google Docs`,
            data: files
          };
        }
      } else if (action === 'drive') {
        if (subAction === 'list' || command.type === 'list') {
          // List all Drive files
          const { files } = await GoogleService.listDriveFiles(connection, {
            pageSize: command.params?.limit ?? 20
          });

          return {
            success: true,
            message: `📁 Found ${files.length} files in Google Drive`,
            data: files
          };
        } else if (subAction === 'upload') {
          // Upload file to Drive
          const result = await GoogleService.uploadFileToDrive(
            connection,
            command.params?.fileName || 'file.txt',
            command.params?.mimeType || 'text/plain',
            command.params?.content || '',
            command.params?.folderId
          );

          return {
            success: true,
            message: `✅ Uploaded file to Google Drive`,
            data: result
          };
        } else if (subAction === 'folder' || subAction === 'create-folder') {
          // Create folder in Drive
          const result = await GoogleService.createFolder(
            connection,
            command.params?.folderName || 'New Folder',
            command.params?.parentFolderId
          );

          return {
            success: true,
            message: `✅ Created folder in Google Drive`,
            data: result
          };
        } else if (subAction === 'share') {
          // Share Drive file
          const result = await GoogleService.shareFile(
            connection,
            command.params?.fileId || '',
            command.params?.email || '',
            command.params?.role || 'reader'
          );

          return {
            success: true,
            message: `✅ Shared file with ${command.params?.email}`,
            data: result
          };
        }
      } else if (action === 'gmail' || action === 'email') {
        if (subAction === 'send') {
          // Send email via Gmail
          const result = await GoogleService.sendEmail(
            connection,
            command.params?.to || [],
            command.params?.subject || 'Cost Analysis Update',
            command.params?.body || '',
            command.params?.isHtml || false
          );

          return {
            success: true,
            message: `✅ Email sent successfully`,
            data: result
          };
        } else if (subAction === 'search' || subAction === 'find') {
          // Search Gmail messages
          const messages = await GoogleService.searchGmailMessages(
            connection,
            command.params?.query || 'cost',
            command.params?.maxResults || 10
          );

          return {
            success: true,
            message: `📧 Found ${messages.length} emails`,
            data: { messages }
          };
        } else if (subAction === 'list') {
          // List Gmail messages (unread or recent)
          const messages = await GoogleService.listGmailMessages(
            connection,
            command.params?.query || 'is:unread',
            command.params?.maxResults || 10
          );

          return {
            success: true,
            message: `📧 Found ${messages.length} messages`,
            data: { messages }
          };
        }
      } else if (action === 'calendar') {
        if (subAction === 'list' || subAction === 'events') {
          // List calendar events
          const events = await GoogleService.listCalendarEvents(
            connection,
            command.params?.startDate ? new Date(command.params.startDate) : undefined,
            command.params?.endDate ? new Date(command.params.endDate) : undefined,
            command.params?.maxResults || 10
          );

          return {
            success: true,
            message: `📅 Found ${events.length} calendar events`,
            data: { events }
          };
        } else if (subAction === 'create' || subAction === 'add') {
          // Create calendar event
          const result = await GoogleService.createCalendarEvent(
            connection,
            command.params?.summary || 'Budget Review Meeting',
            command.params?.start ? new Date(command.params.start) : new Date(),
            command.params?.end ? new Date(command.params.end) : new Date(Date.now() + 3600000),
            command.params?.description,
            command.params?.attendees
          );

          return {
            success: true,
            message: `✅ Created calendar event`,
            data: result
          };
        } else if (subAction === 'update') {
          // Update calendar event
          const result = await GoogleService.updateCalendarEvent(
            connection,
            command.params?.eventId || '',
            {
              summary: command.params?.summary,
              description: command.params?.description,
              start: command.params?.start ? new Date(command.params.start) : undefined,
              end: command.params?.end ? new Date(command.params.end) : undefined,
              attendees: command.params?.attendees
            }
          );

          return {
            success: true,
            message: `✅ Updated calendar event`,
            data: result
          };
        } else if (subAction === 'delete') {
          // Delete calendar event
          const result = await GoogleService.deleteCalendarEvent(
            connection,
            command.params?.eventId || ''
          );

          return {
            success: true,
            message: `✅ Deleted calendar event`,
            data: result
          };
        }
      } else if (action === 'forms' || action === 'form') {
        if (subAction === 'create') {
          // Create form
          const result = await GoogleService.createForm(
            connection,
            command.params?.title || 'Cost Feedback Form',
            command.params?.description
          );

          return {
            success: true,
            message: `✅ Created Google Form`,
            data: result
          };
        } else if (subAction === 'question' || subAction === 'add-question') {
          // Add question to form
          const result = await GoogleService.addFormQuestion(
            connection,
            command.params?.formId || '',
            command.params?.questionText || '',
            command.params?.questionType || 'TEXT',
            command.params?.options
          );

          return {
            success: true,
            message: `✅ Added question to form`,
            data: result
          };
        } else if (subAction === 'responses' || subAction === 'results') {
          // Get form responses
          const responses = await GoogleService.getFormResponses(
            connection,
            command.params?.formId || ''
          );

          return {
            success: true,
            message: `📋 Found ${responses.length} form responses`,
            data: { responses }
          };
        }
      } else if (action === 'slides' || action === 'presentation') {
        if (subAction === 'create') {
          // Create presentation
          const result = await GoogleService.createPresentation(
            connection,
            command.params?.title || 'Cost Analysis Presentation'
          );

          return {
            success: true,
            message: `✅ Created Google Slides presentation`,
            data: result
          };
        } else if (subAction === 'add-slide') {
          // Add slide to presentation
          const result = await GoogleService.addSlideWithText(
            connection,
            command.params?.presentationId || '',
            command.params?.title || 'New Slide',
            command.params?.content || ''
          );

          return {
            success: true,
            message: `✅ Added slide to presentation`,
            data: result
          };
        } else if (subAction === 'export' || subAction === 'pdf') {
          // Export presentation to PDF
          const result = await GoogleService.exportPresentationToPDF(
            connection,
            command.params?.presentationId || ''
          );

          return {
            success: true,
            message: `✅ Exported presentation to PDF`,
            data: result
          };
        }
      }

      return {
        success: false,
        message: `❌ Unknown Google command: ${action}:${subAction}`,
        error: 'Command not recognized'
      };
    } catch (error: any) {
      loggingService.error('Failed to execute Google command', {
        error: error?.message,
        command
      });
      return {
        success: false,
        message: `❌ Google command failed: ${error?.message}`,
        error: error?.message
      };
    }
  }

}

