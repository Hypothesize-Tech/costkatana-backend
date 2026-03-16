import { Injectable, Logger } from '@nestjs/common';
import { MongodbMcpService } from './mongodb-mcp.service';
import { MongodbSuggestionsService } from './mongodb-suggestions.service';
import { MongodbResultFormatterService } from './mongodb-result-formatter.service';

export interface MongodbChatContext {
  connectionId: string;
  userId: string;
  suggestedCollections?: string[];
  queryHints?: string[];
}

/**
 * Chat-oriented agent that provides MongoDB MCP context and can run read-only queries for the user.
 */
@Injectable()
export class MongodbChatAgentService {
  private readonly logger = new Logger(MongodbChatAgentService.name);

  constructor(
    private readonly mongodbMcp: MongodbMcpService,
    private readonly suggestions: MongodbSuggestionsService,
    private readonly formatter: MongodbResultFormatterService,
  ) {}

  getContext(connectionId: string, userId: string): MongodbChatContext {
    const suggestedCollections = this.suggestions
      .suggestCollections()
      .map((c) => c.name);
    return {
      connectionId,
      userId,
      suggestedCollections,
    };
  }

  async runQuery(
    userId: string,
    connectionId: string,
    toolName: 'find' | 'count' | 'listCollections',
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.mongodbMcp.executeToolCall(
      userId,
      connectionId,
      toolName,
      args,
    );
    const content = result?.content ?? [];
    const text = content
      .filter((c) => c.type === 'text' && (c as { text?: string }).text != null)
      .map((c) => (c as { text: string }).text)
      .join('\n');
    return text || this.formatter.formatAsText([]);
  }
}
