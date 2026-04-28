import { Injectable, Logger } from '@nestjs/common';
import { WebSearchTool } from './web-search.tool';
import type { ChatTool, ToolExecutionContext } from './tool.types';

export interface ToolRegistrationContext {
  userId?: string;
  modelId?: string;
  /** User-facing flags that gate specific tools. */
  thinkingEnabled?: boolean;
}

/**
 * Central registry of chat tools. New tools plug in here and get exposed to
 * every LLM call automatically. `getAvailableTools(ctx)` filters the catalog
 * for the current request (e.g., only include `web_search` when the user
 * enabled thinking, which is the UX gate for tool use today).
 */
@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools: Map<string, ChatTool> = new Map();

  constructor(private readonly webSearchTool: WebSearchTool) {
    this.register(webSearchTool);
  }

  private register(tool: ChatTool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" already registered — overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Returns tools available for this request. Today: web_search is gated
   * behind `thinkingEnabled` (Thinking on = tool use on). Future tools can
   * add their own gates here.
   */
  getAvailableTools(ctx: ToolRegistrationContext): ChatTool[] {
    if (!ctx?.thinkingEnabled) return [];
    return Array.from(this.tools.values());
  }

  getTool(name: string): ChatTool | undefined {
    return this.tools.get(name);
  }

  async executeTool(
    name: string,
    input: unknown,
    execCtx: ToolExecutionContext,
  ): Promise<{ ok: true; result: Awaited<ReturnType<ChatTool['execute']>> } | { ok: false; error: string }> {
    const tool = this.getTool(name);
    if (!tool) {
      return { ok: false, error: `Unknown tool: "${name}"` };
    }
    try {
      const result = await tool.execute(
        input as Record<string, unknown>,
        execCtx,
      );
      return { ok: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tool "${name}" threw`, { message });
      return { ok: false, error: message };
    }
  }
}
