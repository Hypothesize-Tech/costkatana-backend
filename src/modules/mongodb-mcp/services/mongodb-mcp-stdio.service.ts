import { Injectable, Logger } from '@nestjs/common';
import { MongodbMcpService } from './mongodb-mcp.service';
import { MongodbResultFormatterService } from './mongodb-result-formatter.service';

export interface StdioToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Handles MCP-style tool calls over stdio (e.g. from CLI). Parses input, invokes MongodbMcpService, formats output for stdout.
 */
@Injectable()
export class MongodbMcpStdioService {
  private readonly logger = new Logger(MongodbMcpStdioService.name);

  constructor(
    private readonly mongodbMcp: MongodbMcpService,
    private readonly formatter: MongodbResultFormatterService,
  ) {}

  /**
   * Parse a line of JSON as a tool call and return a string result for stdout.
   */
  async handleStdinLine(
    connectionId: string,
    userId: string,
    line: string,
  ): Promise<string> {
    let payload: {
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    try {
      payload = JSON.parse(line) as {
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
    } catch {
      return JSON.stringify({ error: 'Invalid JSON input' });
    }
    const method = payload.method ?? 'tools/call';
    const toolName = payload.params?.name;
    const args = payload.params?.arguments ?? {};
    if (method !== 'tools/call' || !toolName) {
      return JSON.stringify({
        error: 'Expected method: tools/call with params.name',
      });
    }
    try {
      const result = await this.mongodbMcp.executeToolCall(
        userId,
        connectionId,
        toolName,
        args,
      );
      const content = result?.content ?? [];
      const text = content
        .filter(
          (c) => c.type === 'text' && (c as { text?: string }).text != null,
        )
        .map((c) => (c as { text: string }).text)
        .join('\n');
      const formatted = text || this.formatter.formatAsText([]);
      return JSON.stringify({ content: [{ type: 'text', text: formatted }] });
    } catch (e) {
      this.logger.warn('Stdio tool call failed', {
        toolName,
        error: e instanceof Error ? e.message : String(e),
      });
      return JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        content: [],
      });
    }
  }
}
