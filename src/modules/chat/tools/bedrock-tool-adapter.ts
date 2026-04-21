import type { ChatTool } from './tool.types';

/**
 * Bedrock Converse `toolConfig` shape (subset we use). The full type lives in
 * `@aws-sdk/client-bedrock-runtime` as `ToolConfiguration` — we declare a
 * permissive local alias to avoid deep SDK typings in callers.
 */
export interface BedrockToolConfig {
  tools: Array<{
    toolSpec: {
      name: string;
      description: string;
      inputSchema: {
        json: Record<string, unknown>;
      };
    };
  }>;
  toolChoice?:
    | { auto: Record<string, never> }
    | { any: Record<string, never> }
    | { tool: { name: string } };
}

/**
 * Convert our internal ChatTool definitions into the `toolConfig.tools[]`
 * payload Bedrock's Converse API expects.
 */
export function toBedrockToolConfig(tools: ChatTool[]): BedrockToolConfig | undefined {
  if (!tools?.length) return undefined;
  return {
    tools: tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: {
          json: t.inputSchema as unknown as Record<string, unknown>,
        },
      },
    })),
    // `auto` — LLM decides whether to call tools or reply directly.
    toolChoice: { auto: {} },
  };
}

/**
 * Accumulator for partial tool-use input JSON streamed across
 * contentBlockDelta events. Bedrock chunks tool inputs as JSON text fragments
 * keyed by contentBlockIndex; we buffer and parse once contentBlockStop fires.
 */
export class ToolUseAccumulator {
  private readonly byIndex: Map<
    number,
    { toolUseId: string; name: string; buffer: string }
  > = new Map();

  start(index: number, toolUseId: string, name: string): void {
    this.byIndex.set(index, { toolUseId, name, buffer: '' });
  }

  appendInput(index: number, chunk: string): void {
    const entry = this.byIndex.get(index);
    if (entry) entry.buffer += chunk;
  }

  /**
   * Finalize a content block. Returns the parsed tool call or undefined if
   * this index wasn't a tool-use block.
   */
  finalize(index: number): { id: string; name: string; input: unknown } | undefined {
    const entry = this.byIndex.get(index);
    if (!entry) return undefined;
    this.byIndex.delete(index);
    let parsed: unknown = {};
    const trimmed = entry.buffer.trim();
    if (trimmed) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = { _raw: trimmed };
      }
    }
    return { id: entry.toolUseId, name: entry.name, input: parsed };
  }

  has(index: number): boolean {
    return this.byIndex.has(index);
  }

  /** Drain any still-open blocks (safety for malformed streams). */
  drain(): Array<{ id: string; name: string; input: unknown }> {
    const out: Array<{ id: string; name: string; input: unknown }> = [];
    for (const idx of Array.from(this.byIndex.keys())) {
      const f = this.finalize(idx);
      if (f) out.push(f);
    }
    return out;
  }
}
