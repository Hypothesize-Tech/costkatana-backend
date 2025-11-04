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
  type: 'create' | 'get' | 'list' | 'update' | 'delete' | 'send' | 'add';
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
        if (integrationType === 'slack') return i.type === 'slack_oauth';
        if (integrationType === 'discord') return i.type === 'discord_oauth';
        if (integrationType === 'github') return i.type === 'github_oauth';
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
    const channelId = command.mention.entityId || credentials.channelId || '';

    if (!accessToken) {
      return {
        success: false,
        message: 'Slack credentials not configured',
        error: 'MISSING_CREDENTIALS'
      };
    }

    try {
      switch (command.type) {
        case 'send':
          if (command.entity === 'message') {
            if (!channelId) {
              return {
                success: false,
                message: 'Channel ID is required. Use @slack:channel:CHANNEL-ID',
                error: 'MISSING_CHANNEL_ID'
              };
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
        message: `Command not supported: ${command.type} ${command.entity}`,
        error: 'UNSUPPORTED_COMMAND'
      };
    } catch (error: any) {
      loggingService.error('Failed to execute Slack command', {
        error: error.message,
        command
      });
      return {
        success: false,
        message: `Slack command failed: ${error.message}`,
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
    const channelId = command.mention.entityId || credentials.channelId || '';

    if (!botToken) {
      return {
        success: false,
        message: 'Discord credentials not configured',
        error: 'MISSING_CREDENTIALS'
      };
    }

      try {
        switch (command.type) {
          case 'send':
            if (command.entity === 'message') {
              if (!channelId) {
                return {
                  success: false,
                  message: 'Channel ID is required. Use @discord:channel:CHANNEL-ID',
                  error: 'MISSING_CHANNEL_ID'
                };
              }

              await DiscordService.sendMessage(botToken, channelId, command.params.message || '');
              return {
                success: true,
                message: `✅ Message sent to Discord channel`,
                data: { channelId }
              };
            }
            break;

          case 'list':
            if (command.entity === 'channel') {
              const guildId = credentials.guildId || '';
              if (!guildId) {
                return {
                  success: false,
                  message: 'Guild ID is required in integration credentials',
                  error: 'MISSING_GUILD_ID'
                };
              }

              const channels = await DiscordService.listChannels(botToken, guildId);
              return {
                success: true,
                message: `Found ${channels.length} channels`,
                data: channels.map((ch: any) => ({
                  id: ch.id,
                  name: ch.name || ch.id,
                  type: ch.type
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
            }
            break;
      }

      return {
        success: false,
        message: `Command not supported: ${command.type} ${command.entity}`,
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
        message: `Command not supported: ${command.type} ${command.entity}`,
        error: 'UNSUPPORTED_COMMAND'
      };
    } catch (error: any) {
      loggingService.error('Failed to execute GitHub command', {
        error: error.message,
        command
      });
      return {
        success: false,
        message: `GitHub command failed: ${error.message}`,
        error: error.message
      };
    }
  }

}

