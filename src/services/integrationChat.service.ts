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
  viewLinks?: Array<{
    label: string;
    url: string;
    type: 'document' | 'spreadsheet' | 'presentation' | 'file' | 'email' | 'calendar' | 'form';
  }>;
  metadata?: {
    type: string;
    count?: number;
    service?: 'gmail' | 'calendar' | 'drive' | 'gdocs' | 'sheets';
  };
}

export class IntegrationChatService {
  /**
   * Parse email recipients from natural language
   * Handles: "to user@example.com", "to user@example.com and user2@example.com", 
   * "to user@example.com, user2@example.com", "to user@example.com; user2@example.com"
   */
  private static parseEmailRecipients(text: string): string[] {
    const emails: string[] = [];
    
    // First, extract the section after "to" until we hit "subject", "saying", "body", etc.
    const toSectionMatch = text.match(/\bto\s+(.*?)(?:\s+(?:subject|saying|body|message|with\s+subject|$))/i);
    
    if (toSectionMatch) {
      const toSection = toSectionMatch[1];
      
      // Extract all emails from the "to" section
      const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
      let match;
      while ((match = emailPattern.exec(toSection)) !== null) {
        emails.push(match[1].toLowerCase());
      }
    }
    
    // Fallback: Find all emails in entire text if nothing found
    if (emails.length === 0) {
      const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
      const matches = text.match(emailPattern);
      if (matches) {
        emails.push(...matches.map(e => e.toLowerCase()));
      }
    }
    
    // Remove duplicates
    return [...new Set(emails)];
  }

  /**
   * Validate email addresses
   */
  private static validateEmailAddresses(emails: string[]): { valid: string[]; invalid: string[] } {
    const valid: string[] = [];
    const invalid: string[] = [];
    
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    
    for (const email of emails) {
      if (emailRegex.test(email)) {
        valid.push(email);
      } else {
        invalid.push(email);
      }
    }
    
    return { valid, invalid };
  }

  /**
   * Extract subject from natural language
   * Handles: "subject: Test", "with subject Test", "as Test"
   */
  private static extractSubjectFromNaturalLanguage(text: string): string | null {
    // Pattern 1: "subject: " or "subject "
    let match = text.match(/subject:?\s+["']?([^"']+?)["']?(?:\s+(?:saying|with|body|message|and)|$)/i);
    if (match) return match[1].trim();
    
    // Pattern 2: "with subject"
    match = text.match(/with\s+subject\s+["']?([^"']+?)["']?(?:\s+(?:saying|body|message|and)|$)/i);
    if (match) return match[1].trim();
    
    // Pattern 3: "as subject"
    match = text.match(/as\s+["']?([^"']+?)["']?(?:\s+(?:saying|with|body|message|and)|$)/i);
    if (match) return match[1].trim();
    
    return null;
  }

  /**
   * Extract body from natural language
   * Handles: "saying hello", "message: hello", "body: hello", "with message hello"
   * Also handles: remaining text after recipients if no "saying"
   */
  private static extractBodyFromNaturalLanguage(text: string): string | null {
    // Pattern 1: "saying" followed by text (with or without quotes)
    let match = text.match(/saying\s+["']([^"']+)["']/i);
    if (match) return match[1].trim();
    
    match = text.match(/saying\s+(.+?)(?:\s*$)/i);
    if (match) return match[1].trim();
    
    // Pattern 2: "message:" or "body:"
    match = text.match(/(?:message|body):?\s+["']?([^"']+?)["']?$/i);
    if (match) return match[1].trim();
    
    // Pattern 3: "with message" or "with body"
    match = text.match(/with\s+(?:message|body)\s+["']?([^"']+?)["']?$/i);
    if (match) return match[1].trim();
    
    // Pattern 4: Everything after subject if subject exists
    const subjectMatch = text.match(/(?:subject:?|with\s+subject)\s+["']?([^"']+?)["']?\s+saying\s+["']?([^"']+?)["']?$/i);
    if (subjectMatch) return subjectMatch[2].trim();
    
    // Pattern 5: If no "saying" keyword, treat remaining text after recipients as body
    const afterRecipientsMatch = text.match(/\bto\s+[a-zA-Z0-9._%+\-@,;\s]+(?:and\s+[a-zA-Z0-9._%+\-@]+)?\s+(?!subject)(.+?)$/i);
    if (afterRecipientsMatch && !text.match(/\bsaying\b/i) && !text.match(/\bsubject\b/i)) {
      return afterRecipientsMatch[1].trim();
    }
    
    return null;
  }

  /**
   * Extract search query from natural language
   * Handles: "search for X", "find X", "look for X", "X file", "X document"
   */
  private static extractSearchQueryFromNaturalLanguage(text: string): string | null {
    // Remove @service:command prefix
    const cleaned = text.replace(/@\w+:\w+\s+/, '');
    
    // Pattern 1: "search for X", "find X", "look for X"
    let m = cleaned.match(/(?:search|find|look)\s+(?:for\s+)?(.+)/i);
    if (m) return m[1].trim();
    
    // Pattern 2: "X file", "X document", "X folder"
    m = cleaned.match(/(.+?)\s+(?:file|document|folder)/i);
    if (m) return m[1].trim();
    
    // Pattern 3: Everything after command
    return cleaned.trim() || null;
  }

  /**
   * Parse natural language command with integration mentions
   * Uses AI recognition first, then falls back to manual parsing
   * Also detects Google intents without @ mentions
   */
  static async parseCommand(message: string, mentions: ParsedMention[]): Promise<IntegrationCommand | null> {
    // If no mentions, try detecting Google intent from natural language
    if (mentions.length === 0) {
      const { detectGoogleIntent } = await import('../utils/googleIntentClassifier');
      const intent = detectGoogleIntent(message);
      
      if (intent.service && intent.confidence >= 0.7) {
        loggingService.info('Detected Google intent from natural language', {
          component: 'IntegrationChatService',
          operation: 'parseCommand',
          service: intent.service,
          action: intent.action,
          confidence: intent.confidence
        });

        // Create a synthetic mention for the detected intent
        const syntheticMention: ParsedMention = {
          integration: intent.service,
          entityType: intent.action,
          subEntityType: intent.action
        };

        // Build command from detected intent
        return {
          type: intent.action as any,
          entity: intent.service,
          mention: syntheticMention,
          params: intent.params,
          naturalLanguage: message
        };
      }
      
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

      // Google Workspace services use GoogleConnection, not Integration model
      const googleServices = ['gmail', 'calendar', 'drive', 'sheets', 'gdocs', 'google'];
      
      if (googleServices.includes(command.mention.integration)) {
        // Handle Google Workspace services directly
        const { GoogleConnection } = await import('../models/GoogleConnection');
        const googleConnection = await GoogleConnection.findOne({
          userId,
          isActive: true
        }).select('+accessToken +refreshToken');

        if (!googleConnection) {
          return {
            success: false,
            message: `❌ No active Google account connected. Please connect your Google account from Settings → Integrations → Google Workspace.`,
            error: 'GOOGLE_CONNECTION_NOT_FOUND'
          };
        }

        // Create a mock integration object for Google services
        const mockGoogleIntegration: any = {
          _id: googleConnection._id,
          userId,
          type: 'google_oauth',
          status: 'active',
          metadata: {
            connectionId: googleConnection._id.toString()
          },
          getCredentials: () => ({
            accessToken: googleConnection.decryptToken(),
            refreshToken: googleConnection.decryptRefreshToken?.() || undefined,
            connectionId: googleConnection._id.toString()
          })
        };

        return await this.executeGoogleCommand(command, mockGoogleIntegration, mockGoogleIntegration.getCredentials());
      }

      // Find matching integration for non-Google services
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
          message: `❌ No active ${command.mention.integration} integration found. Please set up an integration first.`,
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
    // Declare these outside try block so they're accessible in catch
    let rawAction = '';
    let subAction = '';
    
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
      // Determine the action - could be from mention.integration (e.g., @gmail), mention.entityType, or command.entity
      // Normalize to lowercase for case-insensitive matching
      const action = (mention.integration === 'google' 
        ? (mention.entityType || command.entity)
        : mention.integration)?.toLowerCase(); // For @gmail, @drive, etc., use the integration name as action
      subAction = (mention.subEntityType || command.type)?.toLowerCase(); // export, create, list, send, search, etc.

      // Validate service
      rawAction = action?.toLowerCase().trim();

      if (!rawAction) {
        return {
          success: false,
          message: '❌ Could not determine Google service. Please use format: @gmail:send, @drive:search, etc.',
          error: 'UNDEFINED_SERVICE'
        };
      }

      const SUPPORTED_GOOGLE_SERVICES = ['gmail', 'calendar', 'drive', 'gdocs', 'sheets'];

      if (!SUPPORTED_GOOGLE_SERVICES.includes(rawAction)) {
        // Check if it's a removed service (slides/forms)
        if (rawAction === 'slides' || rawAction === 'forms') {
          return {
            success: false,
            message: `❌ ${rawAction.charAt(0).toUpperCase() + rawAction.slice(1)} integration is not available in this workspace.`,
            error: 'SERVICE_NOT_AVAILABLE'
          };
        }
        
        return {
          success: false,
          message: `❌ The service '@${rawAction}' is not supported. Available: ${SUPPORTED_GOOGLE_SERVICES.join(', ')}`,
          error: 'UNSUPPORTED_SERVICE'
        };
      }

      loggingService.info('Executing Google command', {
        component: 'IntegrationChatService',
        userId: integration.userId.toString(),
        integration: mention.integration,
        action: rawAction,
        subAction,
        commandType: command.type,
        params: command.params
      });

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
      } else if (action === 'gdocs') {
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

          const { formatGoogleServiceResponse } = await import('../utils/googleResponseFormatter');
          const formatted = formatGoogleServiceResponse('gdocs', 'create', {
            success: true,
            message: '✅ Created cost report in Google Docs',
            data: {
              documentUrl: result.documentUrl,
              documentId: result.documentId
            }
          });

          return {
            success: true,
            message: formatted.message,
            data: formatted.data,
            viewLinks: formatted.viewLinks,
            metadata: formatted.metadata
          };
        } else if (subAction === 'list') {
          // List docs
          const { files } = await GoogleService.listDriveFiles(connection, {
            query: "mimeType='application/vnd.google-apps.document'"
          });

          const { formatGoogleServiceResponse } = await import('../utils/googleResponseFormatter');
          const formatted = formatGoogleServiceResponse('gdocs', 'list', {
            success: true,
            data: files
          });

          return {
            success: true,
            message: formatted.message,
            data: formatted.data,
            viewLinks: formatted.viewLinks,
            metadata: formatted.metadata
          };
        } else if (subAction === 'read' || subAction === 'view' || subAction === 'get' || subAction === 'open') {
          // Read/view a specific document
          let documentId = command.params?.documentId || command.params?.docId || command.params?.id;
          
          // If no ID is provided, try to find document by name
          if (!documentId && (command.params?.name || command.params?.title || command.params?.query)) {
            const searchName = command.params?.name || command.params?.title || command.params?.query;
            const { files } = await GoogleService.listDriveFiles(connection, {
              query: `mimeType='application/vnd.google-apps.document' and name='${searchName}'`
            });
            
            if (files.length > 0) {
              documentId = files[0].id;
              loggingService.info('Found document by name', {
                component: 'IntegrationChatService',
                searchName,
                documentId,
                documentName: files[0].name
              });
            } else {
              return {
                success: false,
                message: `❌ Could not find a document named "${searchName}". Please provide the exact document name or document ID.`,
                error: 'DOCUMENT_NOT_FOUND'
              };
            }
          }
          
          if (!documentId) {
            return {
              success: false,
              message: `❌ Please provide a document name or ID. Example: @docs:read "Cost Katana Documentation"`,
              error: 'MISSING_DOCUMENT_ID'
            };
          }

          // Read the document content
          const content = await GoogleService.readDocument(connection, documentId);

          const { formatGoogleServiceResponse } = await import('../utils/googleResponseFormatter');
          const formatted = formatGoogleServiceResponse('gdocs', 'read', {
            success: true,
            data: { documentId, content, characterCount: content.length }
          });

          return {
            success: true,
            message: formatted.message,
            data: formatted.data,
            viewLinks: formatted.viewLinks,
            metadata: formatted.metadata
          };
        }
      } else if (action === 'drive') {
        if (subAction === 'list' || command.type === 'list') {
          // List all Drive files
          const { files } = await GoogleService.listDriveFiles(connection, {
            pageSize: command.params?.limit ?? 20
          });

          const { formatGoogleServiceResponse } = await import('../utils/googleResponseFormatter');
          const formatted = formatGoogleServiceResponse('drive', 'list', {
            success: true,
            data: files
          });

          return {
            success: true,
            message: formatted.message,
            data: formatted.data,
            viewLinks: formatted.viewLinks,
            metadata: formatted.metadata
          };
        } else if (subAction === 'search' || subAction === 'find') {
          // Search Drive files by name or content
          let searchQuery = command.params?.query || command.params?.searchQuery || '';
          
          // Try to extract from natural language if not provided
          if (!searchQuery && command.naturalLanguage) {
            searchQuery = this.extractSearchQueryFromNaturalLanguage(command.naturalLanguage) || '';
          }
          
          if (!searchQuery) {
            return {
              success: false,
              message: '❌ Please specify a search query. Example: @drive:search budget report',
              error: 'No search query provided'
            };
          }

          // Build Google Drive query by splitting words and AND'ing them
          const words = searchQuery.split(/\s+/).filter((w: string) => w.length > 0);
          const nameQueries = words.map((w: string) => `name contains '${w}'`).join(' and ');
          const driveQuery = `(${nameQueries}) and trashed = false`;
          
          const { files } = await GoogleService.listDriveFiles(connection, {
            query: driveQuery,
            pageSize: command.params?.limit ?? 20
          });

          const { formatGoogleServiceResponse } = await import('../utils/googleResponseFormatter');
          
          // If no results, provide helpful message
          if (files.length === 0) {
            return {
              success: true,
              message: `❌ No Drive files matched "${searchQuery}".`,
              data: [],
              metadata: { type: 'drive_search', count: 0, service: 'drive' }
            };
          }

          const formatted = formatGoogleServiceResponse('drive', 'search', {
            success: true,
            data: files
          });

          return {
            success: true,
            message: formatted.message,
            data: formatted.data,
            viewLinks: formatted.viewLinks,
            metadata: formatted.metadata
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
          // Parse email parameters from the message or command params
          let toEmails: string[] = [];
          let subject = command.params?.subject || null;
          let body = command.params?.body || command.params?.message || null;

          // Extract 'to' emails - handle both string and array
          if (command.params?.to) {
            if (Array.isArray(command.params.to)) {
              toEmails = command.params.to;
            } else if (typeof command.params.to === 'string') {
              // Split by comma, semicolon, or "and"
              toEmails = command.params.to.split(/[,;]|\s+and\s+/).map((e: string) => e.trim());
            }
          }

          // Try to extract from natural language if not found
          if (toEmails.length === 0 && command.naturalLanguage) {
            toEmails = this.parseEmailRecipients(command.naturalLanguage);
          }

          // Validate email addresses
          const { valid, invalid } = this.validateEmailAddresses(toEmails);
          
          if (invalid.length > 0) {
            return {
              success: false,
              message: `❌ Invalid email address(es): ${invalid.join(', ')}. Please check the email format.`,
              error: 'Invalid email format'
            };
          }

          if (valid.length === 0) {
            return {
              success: false,
              message: `❌ I couldn't parse any valid recipient(s). Example:\n@gmail:send send email to user@example.com subject "Hello" saying "Body"`,
              error: 'Missing recipient'
            };
          }

          // Extract subject from natural language if not provided
          if (!subject && command.naturalLanguage) {
            subject = this.extractSubjectFromNaturalLanguage(command.naturalLanguage);
          }
          
          // Extract body from natural language if not provided
          if (!body && command.naturalLanguage) {
            body = this.extractBodyFromNaturalLanguage(command.naturalLanguage);
          }

          // Use safe defaults
          if (!subject) {
            subject = 'Message from CostKatana';
          }
          if (!body) {
            body = 'This message was sent via CostKatana.';
          }

          // Send email via Gmail
          const result = await GoogleService.sendEmail(
            connection,
            valid,
            subject,
            body,
            command.params?.isHtml || false
          );

          return {
            success: true,
            message: `✅ Email sent successfully to ${valid.join(', ')}\n\n**Subject:** ${subject}\n**Message:** ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`,
            data: result
          };
        } else if (subAction === 'search' || subAction === 'find') {
          // Search Gmail messages
          const messages = await GoogleService.searchGmailMessages(
            connection,
            command.params?.query || 'cost',
            command.params?.maxResults || 10
          );

          const { formatGoogleServiceResponse } = await import('../utils/googleResponseFormatter');
          const formatted = formatGoogleServiceResponse('gmail', 'search', {
            success: true,
            data: { messages }
          });

          return {
            success: true,
            message: formatted.message,
            data: formatted.data,
            viewLinks: formatted.viewLinks,
            metadata: formatted.metadata
          };
        } else if (subAction === 'list') {
          // List Gmail messages (unread or recent)
          const messages = await GoogleService.listGmailMessages(
            connection,
            command.params?.query || 'is:unread',
            command.params?.maxResults || 10
          );

          const { formatGoogleServiceResponse } = await import('../utils/googleResponseFormatter');
          const formatted = formatGoogleServiceResponse('gmail', 'list', {
            success: true,
            data: { messages }
          });

          return {
            success: true,
            message: formatted.message,
            data: formatted.data,
            viewLinks: formatted.viewLinks,
            metadata: formatted.metadata
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

          const { formatGoogleServiceResponse } = await import('../utils/googleResponseFormatter');
          const formatted = formatGoogleServiceResponse('calendar', 'list', {
            success: true,
            data: events
          });

          return {
            success: true,
            message: formatted.message,
            data: formatted.data,
            viewLinks: formatted.viewLinks,
            metadata: formatted.metadata
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

          // Format the response with view link
          const viewLinks = result.eventLink ? [{
            label: `View Event in Calendar`,
            url: result.eventLink,
            type: 'calendar' as const
          }] : [];

          return {
            success: true,
            message: `✅ Created calendar event\n\n**Event Id:** ${result.eventId}\n**Event Link:** ${result.eventLink || 'N/A'}`,
            data: result,
            viewLinks,
            metadata: { type: 'calendar_create', service: 'calendar' }
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
      }

      // If no structured command matched, try natural language parsing via GoogleCommandService
      try {
        const { GoogleCommandService } = await import('./googleCommand.service');
        const originalMessage = command.naturalLanguage || `@${command.mention.integration} ${action || ''} ${subAction || ''}`.trim();
        
        loggingService.info('Attempting natural language Google command', {
          userId: integration.userId.toString(),
          integration: command.mention.integration,
          message: originalMessage
        });
        
        const result = await GoogleCommandService.executeCommand(
          integration.userId.toString(),
          command,
          originalMessage
        );
        
        return {
          success: true,
          message: result,
          data: null
        };
      } catch (nlpError: any) {
        loggingService.warn('Natural language Google command also failed', {
          error: nlpError.message,
          integration: command.mention.integration,
          action,
          subAction
        });
      }

      return {
        success: false,
        message: `❌ The action '${subAction}' for '@${rawAction}' is not supported yet.`,
        error: 'UNSUPPORTED_ACTION'
      };
    } catch (error: any) {
      const { parseGoogleApiError, GoogleErrorType } = await import('../utils/googleErrorHandler');
      const googleError = parseGoogleApiError(error, rawAction || 'google', subAction || 'command');
      
      let userMessage = '';
      switch (googleError.type) {
        case GoogleErrorType.AUTH_EXPIRED:
        case GoogleErrorType.AUTH_REVOKED:
          userMessage = 'Your Google session expired. Please reconnect in Settings → Integrations.';
          break;
        case GoogleErrorType.SCOPE_MISSING:
        case GoogleErrorType.PERMISSION_DENIED:
          userMessage = 'Missing permissions for this operation. Please reconnect your Google account with required permissions.';
          break;
        case GoogleErrorType.RATE_LIMIT:
        case GoogleErrorType.QUOTA_EXCEEDED:
          userMessage = 'Google API rate limit reached. Please try again in a few minutes.';
          break;
        case GoogleErrorType.NOT_FOUND:
          userMessage = 'Resource not found. Please check the ID or name and try again.';
          break;
        default:
          userMessage = googleError.userMessage || googleError.message;
      }
      
      loggingService.error('Google command failed', {
        error: error?.message,
        command,
        googleErrorType: googleError.type
      });
      
      return {
        success: false,
        message: `❌ ${userMessage}`,
        error: googleError.type
      };
    }
  }

}

