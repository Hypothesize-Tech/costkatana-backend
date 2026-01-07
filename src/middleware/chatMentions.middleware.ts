import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';

/**
 * Chat Mentions Middleware
 * 
 * Parses @mentions in chat messages and extracts commands
 */

export interface Mention {
    type: 'mongodb' | 'vercel' | 'github' | 'google' | 'slack' | 'jira' | 'linear' | 'discord';
    start: number;
    end: number;
    command?: string;
    rawText: string;
}

export interface Command {
    integration: string;
    action: string;
    args: Record<string, any>;
    rawCommand: string;
}

/**
 * Parse @mentions from chat message
 */
export function parseMentions(message: string): Mention[] {
    const mentions: Mention[] = [];
    
    // Regex to match @integration mentions
    const mentionPattern = /@(mongodb|vercel|github|google|slack|jira|linear|discord)\s*/gi;
    
    let match;
    while ((match = mentionPattern.exec(message)) !== null) {
        const type = match[1].toLowerCase() as Mention['type'];
        const start = match.index;
        const end = start + match[0].length;
        
        // Extract command after mention (until next mention or end of message)
        const afterMention = message.substring(end);
        const nextMentionIndex = afterMention.search(/@(mongodb|vercel|github|google|slack|jira|linear|discord)/i);
        const commandEnd = nextMentionIndex > 0 ? nextMentionIndex : afterMention.length;
        const command = afterMention.substring(0, commandEnd).trim();
        
        mentions.push({
            type,
            start,
            end,
            command,
            rawText: match[0],
        });
    }
    
    return mentions;
}

/**
 * Extract command from mention
 */
export function extractCommand(mention: Mention): Command | null {
    if (!mention.command) {
        return null;
    }

    // Parse based on integration type
    switch (mention.type) {
        case 'mongodb':
            return parseMongoDBCommand(mention.command, mention.type);
        
        case 'vercel':
            return parseVercelCommand(mention.command, mention.type);
        
        case 'github':
            return parseGitHubCommand(mention.command, mention.type);
        
        default:
            return {
                integration: mention.type,
                action: 'unknown',
                args: {},
                rawCommand: mention.command,
            };
    }
}

/**
 * Parse MongoDB command
 */
function parseMongoDBCommand(command: string, integration: string): Command {
    const lowerCommand = command.toLowerCase();
    
    // List collections
    if (lowerCommand.includes('list') && lowerCommand.includes('collection')) {
        return {
            integration,
            action: 'listCollections',
            args: {},
            rawCommand: command,
        };
    }
    
    // Database stats
    if (lowerCommand.includes('database') && lowerCommand.includes('stat')) {
        return {
            integration,
            action: 'getDatabaseStats',
            args: {},
            rawCommand: command,
        };
    }
    
    // Find documents
    const findMatch = command.match(/find|show|get|list|select/i);
    const collectionMatch = command.match(/(?:in|from|of)\s+([a-zA-Z0-9_]+)/i);
    if (findMatch && collectionMatch) {
        const limitMatch = command.match(/limit\s+(\d+)/i);
        return {
            integration,
            action: 'find',
            args: {
                collection: collectionMatch[1],
                limit: limitMatch ? parseInt(limitMatch[1]) : 10,
                query: {},
            },
            rawCommand: command,
        };
    }
    
    // Count documents
    if (lowerCommand.includes('count')) {
        const collection = collectionMatch?.[1];
        return {
            integration,
            action: 'count',
            args: {
                collection,
                query: {},
            },
            rawCommand: command,
        };
    }
    
    // Analyze schema
    if (lowerCommand.includes('schema') || lowerCommand.includes('analyze')) {
        const collection = collectionMatch?.[1];
        return {
            integration,
            action: 'analyzeSchema',
            args: {
                collection,
                sampleSize: 100,
            },
            rawCommand: command,
        };
    }
    
    // List indexes
    if (lowerCommand.includes('index') && lowerCommand.includes('list')) {
        const collection = collectionMatch?.[1];
        return {
            integration,
            action: 'listIndexes',
            args: {
                collection,
            },
            rawCommand: command,
        };
    }
    
    // Collection stats
    if (lowerCommand.includes('stat') && collectionMatch) {
        return {
            integration,
            action: 'collectionStats',
            args: {
                collection: collectionMatch[1],
            },
            rawCommand: command,
        };
    }
    
    // Help
    if (lowerCommand.includes('help')) {
        return {
            integration,
            action: 'help',
            args: {},
            rawCommand: command,
        };
    }
    
    // Default to natural language parsing
    return {
        integration,
        action: 'parse',
        args: {
            message: command,
        },
        rawCommand: command,
    };
}

/**
 * Parse Vercel command
 */
function parseVercelCommand(command: string, integration: string): Command {
    const lowerCommand = command.toLowerCase();
    
    if (lowerCommand.includes('deploy')) {
        const projectMatch = command.match(/deploy\s+(?:to\s+)?["']?([a-zA-Z0-9-_]+)["']?/i);
        return {
            integration,
            action: 'deploy',
            args: {
                projectName: projectMatch?.[1],
            },
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
        args: {
            message: command,
        },
        rawCommand: command,
    };
}

/**
 * Parse GitHub command
 */
function parseGitHubCommand(command: string, integration: string): Command {
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
    
    return {
        integration,
        action: 'parse',
        args: {
            message: command,
        },
        rawCommand: command,
    };
}

/**
 * Middleware to parse mentions in request body
 */
export function chatMentionsMiddleware(req: Request, res: Response, next: NextFunction): void {
    try {
        const { message } = req.body;
        
        if (!message || typeof message !== 'string') {
            return next();
        }
        
        // Parse mentions from message
        const mentions = parseMentions(message);
        
        // Extract commands from mentions
        const commands = mentions
            .map(mention => extractCommand(mention))
            .filter((cmd): cmd is Command => cmd !== null);
        
        // Attach to request
        (req as any).mentions = mentions;
        (req as any).mentionCommands = commands;
        
        loggingService.debug('Parsed mentions from message', {
            component: 'chatMentionsMiddleware',
            mentionCount: mentions.length,
            commandCount: commands.length,
            mentions: mentions.map(m => m.type),
        });
        
        next();
    } catch (error) {
        loggingService.error('Error parsing mentions', {
            component: 'chatMentionsMiddleware',
            error: error instanceof Error ? error.message : String(error),
        });
        
        // Continue without mentions on error
        next();
    }
}

/**
 * Validate mention syntax
 */
export function validateMentionSyntax(mention: Mention): { valid: boolean; error?: string } {
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
 * Extract all mentions from a message
 */
export function getAllMentions(message: string): Mention[] {
    return parseMentions(message);
}

/**
 * Check if message has any mentions
 */
export function hasMentions(message: string): boolean {
    return /@(mongodb|vercel|github|google|slack|jira|linear|discord)/i.test(message);
}

/**
 * Remove mentions from message
 */
export function removeMentions(message: string): string {
    return message.replace(/@(mongodb|vercel|github|google|slack|jira|linear|discord)\s*/gi, '').trim();
}

/**
 * Get mention by type
 */
export function getMentionByType(message: string, type: Mention['type']): Mention | null {
    const mentions = parseMentions(message);
    return mentions.find(m => m.type === type) || null;
}
