import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Observable } from 'rxjs';

/** Express-compatible mention shape with command text */
export interface Mention {
  type:
    | 'mongodb'
    | 'vercel'
    | 'github'
    | 'aws'
    | 'google'
    | 'slack'
    | 'jira'
    | 'linear'
    | 'discord';
  start: number;
  end: number;
  command?: string;
  rawText: string;
}

/** Parsed mention for NestJS services (integration, action, parameters) */
export interface ParsedMention {
  integration: string;
  entityType?: string;
  entityId?: string;
  subEntityType?: string;
  subEntityId?: string;
  action?: string;
  parameters?: Record<string, unknown>;
  originalMention: string;
  /** Command text after the mention (Express: command) */
  command?: string;
}

/** Express-compatible command shape */
export interface IntegrationCommand {
  integration: string;
  action: string;
  args: Record<string, unknown>;
  rawCommand: string;
}

export interface RequestWithMentions {
  body?: { message?: string };
  mentions?: ParsedMention[];
  mentionCommands?: IntegrationCommand[];
}

const MENTION_PATTERN =
  /@(mongodb|vercel|github|aws|google|slack|jira|linear|discord)\s*/gi;

@Injectable()
export class ChatMentionsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ChatMentionsInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithMentions>();
    const message = request.body?.message;

    if (message && typeof message === 'string') {
      try {
        const mentions = this.parseMentions(message);
        const mentionCommands = mentions
          .map((m) => this.extractCommand(m))
          .filter((cmd): cmd is IntegrationCommand => cmd !== null);

        const parsedMentions: ParsedMention[] = mentions.map((m) => {
          const cmd = this.extractCommand(m);
          return {
            integration: m.type,
            originalMention: m.rawText,
            command: m.command,
            action: cmd?.action,
            parameters: cmd
              ? { ...cmd.args, rawCommand: cmd.rawCommand }
              : undefined,
          };
        });

        request.mentions = parsedMentions;
        request.mentionCommands = mentionCommands;

        this.logger.debug?.(
          `Parsed mentions: ${mentions.length} mentions, ${mentionCommands.length} commands`,
        );
      } catch (error) {
        this.logger.warn(
          `Error parsing mentions: ${error instanceof Error ? error.message : String(error)}`,
        );
        request.mentions = [];
        request.mentionCommands = [];
      }
    } else {
      request.mentions = [];
      request.mentionCommands = [];
    }

    return next.handle();
  }

  /**
   * Validate mention syntax (Express: validateMentionSyntax)
   */
  static validateMentionSyntax(mention: Mention): {
    valid: boolean;
    error?: string;
  } {
    // Check if mention has a command
    if (!mention.command || mention.command.trim().length === 0) {
      return {
        valid: false,
        error: `@${mention.type} mention requires a command. Try @${mention.type} help`,
      };
    }

    // Check command length
    if (mention.command.length > 500) {
      return {
        valid: false,
        error: `Command too long (${mention.command.length} characters). Please keep it under 500 characters.`,
      };
    }

    return { valid: true };
  }

  /**
   * Extract all mentions from a message (Express: getAllMentions)
   */
  static getAllMentions(message: string): Mention[] {
    return ChatMentionsInterceptor.parseMentionsStatic(message);
  }

  /**
   * Check if message has any mentions (Express: hasMentions)
   */
  static hasMentions(message: string): boolean {
    return MENTION_PATTERN.test(message);
  }

  /**
   * Remove mentions from message (Express: removeMentions)
   */
  static removeMentions(message: string): string {
    return message.replace(MENTION_PATTERN, '').trim();
  }

  /**
   * Get mention by type (Express: getMentionByType)
   */
  static getMentionByType(
    message: string,
    type: Mention['type'],
  ): Mention | null {
    const mentions = ChatMentionsInterceptor.parseMentionsStatic(message);
    return mentions.find((m) => m.type === type) || null;
  }

  /**
   * Parse @mentions from chat message (Express: parseMentions)
   */
  private parseMentions(message: string): Mention[] {
    return ChatMentionsInterceptor.parseMentionsStatic(message);
  }

  /**
   * Static version of parseMentions for utility functions
   */
  static parseMentionsStatic(message: string): Mention[] {
    const mentions: Mention[] = [];
    const pattern = new RegExp(MENTION_PATTERN.source, 'gi');
    let match;

    while ((match = pattern.exec(message)) !== null) {
      const type = match[1].toLowerCase() as Mention['type'];
      const start = match.index;
      const end = start + match[0].length;

      const afterMention = message.substring(end);
      const nextMentionRegex =
        /@(mongodb|vercel|github|aws|google|slack|jira|linear|discord)/i;
      const nextMatch = nextMentionRegex.exec(afterMention);
      const commandEnd =
        nextMatch && nextMatch.index >= 0
          ? nextMatch.index
          : afterMention.length;
      const command = afterMention.substring(0, commandEnd).trim();

      mentions.push({
        type,
        start,
        end,
        command: command || undefined,
        rawText: match[0],
      });
    }

    return mentions;
  }

  /**
   * Extract command from mention (Express: extractCommand)
   */
  private extractCommand(mention: Mention): IntegrationCommand | null {
    if (!mention.command) return null;

    switch (mention.type) {
      case 'mongodb':
        return this.parseMongoDBCommand(mention.command, mention.type);
      case 'vercel':
        return this.parseVercelCommand(mention.command, mention.type);
      case 'github':
        return this.parseGitHubCommand(mention.command, mention.type);
      case 'jira':
        return this.parseJiraCommand(mention.command, mention.type);
      case 'linear':
        return this.parseLinearCommand(mention.command, mention.type);
      case 'slack':
        return this.parseSlackCommand(mention.command, mention.type);
      case 'discord':
        return this.parseDiscordCommand(mention.command, mention.type);
      case 'google':
        return this.parseGoogleCommand(mention.command, mention.type);
      case 'aws':
        return this.parseAWSCommand(mention.command, mention.type);
      default:
        return {
          integration: mention.type,
          action: 'unknown',
          args: {},
          rawCommand: mention.command,
        };
    }
  }

  private parseMongoDBCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();
    const collectionMatch = command.match(/(?:in|from|of)\s+([a-zA-Z0-9_]+)/i);

    if (lowerCommand.includes('list') && lowerCommand.includes('collection')) {
      return {
        integration,
        action: 'listCollections',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('database') && lowerCommand.includes('stat')) {
      return {
        integration,
        action: 'getDatabaseStats',
        args: {},
        rawCommand: command,
      };
    }

    const findMatch = command.match(/find|show|get|list|select/i);
    if (findMatch && collectionMatch) {
      const limitMatch = command.match(/limit\s+(\d+)/i);
      return {
        integration,
        action: 'find',
        args: {
          collection: collectionMatch[1],
          limit: limitMatch ? parseInt(limitMatch[1], 10) : 10,
          query: {},
        },
        rawCommand: command,
      };
    }

    if (lowerCommand.includes('count')) {
      return {
        integration,
        action: 'count',
        args: { collection: collectionMatch?.[1], query: {} },
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('schema') || lowerCommand.includes('analyze')) {
      return {
        integration,
        action: 'analyzeSchema',
        args: { collection: collectionMatch?.[1], sampleSize: 100 },
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('index') && lowerCommand.includes('list')) {
      return {
        integration,
        action: 'listIndexes',
        args: { collection: collectionMatch?.[1] },
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('stat') && collectionMatch) {
      return {
        integration,
        action: 'collectionStats',
        args: { collection: collectionMatch[1] },
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('help')) {
      return { integration, action: 'help', args: {}, rawCommand: command };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  private parseVercelCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('deploy')) {
      const projectMatch = command.match(
        /deploy\s+(?:to\s+)?["']?([a-zA-Z0-9-_]+)["']?/i,
      );
      return {
        integration,
        action: 'deploy',
        args: { projectName: projectMatch?.[1] },
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('project')) {
      return {
        integration,
        action: 'list_projects',
        args: {},
        rawCommand: command,
      };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  private parseGitHubCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('list') && lowerCommand.includes('repo')) {
      return {
        integration,
        action: 'list_repos',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('create') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'create_issue',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'list_issues',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('pull')) {
      return {
        integration,
        action: 'list_pull_requests',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('branch')) {
      return {
        integration,
        action: 'list_branches',
        args: {},
        rawCommand: command,
      };
    }
    if (
      lowerCommand.includes('create') &&
      (lowerCommand.includes('pr') || lowerCommand.includes('pull'))
    ) {
      return {
        integration,
        action: 'create_pull_request',
        args: {},
        rawCommand: command,
      };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  private parseJiraCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('list') && lowerCommand.includes('project')) {
      return {
        integration,
        action: 'list_projects',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('create') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'create_issue',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('get') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'get_issue',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'list_issues',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('update') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'update_issue',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('add') && lowerCommand.includes('comment')) {
      return {
        integration,
        action: 'add_comment',
        args: {},
        rawCommand: command,
      };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  private parseLinearCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('list') && lowerCommand.includes('team')) {
      return {
        integration,
        action: 'list_teams',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('project')) {
      return {
        integration,
        action: 'list_projects',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'list_issues',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('create') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'create_issue',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('get') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'get_issue',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('update') && lowerCommand.includes('issue')) {
      return {
        integration,
        action: 'update_issue',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('add') && lowerCommand.includes('comment')) {
      return {
        integration,
        action: 'add_comment',
        args: {},
        rawCommand: command,
      };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  private parseSlackCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('list') && lowerCommand.includes('channel')) {
      return {
        integration,
        action: 'list_channels',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('user')) {
      return {
        integration,
        action: 'list_users',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('send') && lowerCommand.includes('message')) {
      return {
        integration,
        action: 'send_message',
        args: {},
        rawCommand: command,
      };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  private parseDiscordCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('list') && lowerCommand.includes('channel')) {
      return {
        integration,
        action: 'list_channels',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('guild')) {
      return {
        integration,
        action: 'list_guilds',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('send') && lowerCommand.includes('message')) {
      return {
        integration,
        action: 'send_message',
        args: {},
        rawCommand: command,
      };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  private parseGoogleCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('list')) {
      return {
        integration,
        action: 'list',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('create')) {
      return {
        integration,
        action: 'create',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('export')) {
      return {
        integration,
        action: 'export',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('search') || lowerCommand.includes('find')) {
      return {
        integration,
        action: 'search',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('select')) {
      return {
        integration,
        action: 'select',
        args: {},
        rawCommand: command,
      };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  private parseAWSCommand(
    command: string,
    integration: string,
  ): IntegrationCommand {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('list') && lowerCommand.includes('bucket')) {
      return {
        integration,
        action: 'list_buckets',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('instance')) {
      return {
        integration,
        action: 'list_instances',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('list') && lowerCommand.includes('function')) {
      return {
        integration,
        action: 'list_functions',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('create') && lowerCommand.includes('bucket')) {
      return {
        integration,
        action: 'create_bucket',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('deploy') || lowerCommand.includes('update')) {
      return {
        integration,
        action: 'deploy',
        args: {},
        rawCommand: command,
      };
    }
    if (lowerCommand.includes('status') || lowerCommand.includes('info')) {
      return {
        integration,
        action: 'get_status',
        args: {},
        rawCommand: command,
      };
    }

    return {
      integration,
      action: 'parse',
      args: { message: command },
      rawCommand: command,
    };
  }

  /** Validate mention syntax (Express: validateMentionSyntax) */
  validateMentionSyntax(mention: { command?: string; type: string }): {
    valid: boolean;
    error?: string;
  } {
    if (!mention.command || mention.command.trim().length === 0) {
      return {
        valid: false,
        error: `@${mention.type} mention requires a command. Try @${mention.type} help`,
      };
    }
    if (mention.command.length > 500) {
      return {
        valid: false,
        error: `Command too long (${mention.command.length} characters). Please keep it under 500 characters.`,
      };
    }
    return { valid: true };
  }

  /** Get all mentions from message (Express: getAllMentions) */
  getAllMentions(message: string): Mention[] {
    return this.parseMentions(message);
  }

  /** Check if message has any mentions (Express: hasMentions) */
  hasMentions(message: string): boolean {
    return new RegExp(MENTION_PATTERN.source, 'i').test(message);
  }

  /** Remove mentions from message (Express: removeMentions) */
  removeMentions(message: string): string {
    return message.replace(MENTION_PATTERN, '').trim();
  }

  /** Get first mention by type (Express: getMentionByType) */
  getMentionByType(message: string, type: Mention['type']): Mention | null {
    const mentions = this.parseMentions(message);
    return mentions.find((m) => m.type === type) ?? null;
  }
}
