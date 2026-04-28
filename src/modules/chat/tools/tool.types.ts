/**
 * ChatTool — a pluggable tool the LLM can decide to call during a chat turn.
 *
 * Tools are registered in ToolRegistryService and exposed to Bedrock's
 * Converse API via the `toolConfig` field. When Claude emits a tool-use
 * content block, the backend looks up the tool by `name`, validates+executes
 * it, and feeds the `ToolResult` back as a `toolResult` content block so
 * Claude can produce its final answer.
 */

export interface ToolSource {
  title: string;
  url: string;
  description?: string;
}

export interface ToolResult {
  /** Plain text the LLM will read as the tool's output. */
  content: string;
  /** Optional structured citations (used for the UI's source chips). */
  sources?: ToolSource[];
  /** Arbitrary extra data the UI may want — not fed to the LLM. */
  data?: unknown;
}

export interface ToolExecutionContext {
  userId?: string;
  conversationId?: string;
  modelId?: string;
  /** Raw user message that kicked off this turn. */
  userMessage?: string;
}

/**
 * JSON-schema-like shape for tool inputs. We keep it loose so callers can
 * pass the subset Bedrock requires (`type: 'object'`, `properties`, `required`).
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      description?: string;
      enum?: Array<string | number>;
      items?: { type: string };
    }
  >;
  required?: string[];
}

export interface ChatTool<TInput = Record<string, unknown>> {
  /** Must match the regex `^[a-zA-Z0-9_-]{1,64}$`. Bedrock is strict. */
  name: string;
  /** Shown to the LLM; helps it pick when to invoke. */
  description: string;
  inputSchema: ToolInputSchema;
  execute(input: TInput, ctx: ToolExecutionContext): Promise<ToolResult>;
}
