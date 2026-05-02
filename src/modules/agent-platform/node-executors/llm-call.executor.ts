import { Injectable } from '@nestjs/common';
import { BedrockService } from '../../bedrock/bedrock.service';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

interface LlmCallConfig {
  model: string;
  system?: string;
  promptTemplate?: string;
  temperature?: number;
  maxTokens?: number;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface LlmCallInput {
  message?: string;
  chunks?: Array<{ text?: string; content?: string; score?: number }>;
  citations?: unknown[];
  /** Anything else upstream nodes pass through. */
  [key: string]: unknown;
}

interface LlmCallOutput {
  text: string;
  /**
   * Confidence proxy used by downstream if-else nodes. v1: take max chunk
   * score from RAG when available; otherwise default to 0.85 (high) since
   * the model produced an answer without grounding.
   */
  confidence: number;
  citations: unknown[];
}

/**
 * Per-1M-token rates for tally. Numbers are deliberately approximate;
 * authoritative pricing lives in the Pricing module — this is a fast
 * heuristic for the per-step cost surfaced in the trace UI.
 */
const PRICING_USD_PER_M: Record<string, { in: number; out: number }> = {
  'anthropic.claude-3-5-sonnet-20240620-v1:0': { in: 3.0, out: 15.0 },
  'anthropic.claude-3-5-sonnet-20241022-v2:0': { in: 3.0, out: 15.0 },
  'anthropic.claude-sonnet-4-20250514-v1:0': { in: 3.0, out: 15.0 },
  'claude-3-5-sonnet': { in: 3.0, out: 15.0 },
  'claude-sonnet-4': { in: 3.0, out: 15.0 },
  'anthropic.claude-3-5-haiku-20241022-v1:0': { in: 0.8, out: 4.0 },
  'claude-3-5-haiku': { in: 0.8, out: 4.0 },
  'haiku-3.5': { in: 0.8, out: 4.0 },
  default: { in: 3.0, out: 15.0 },
};

@Injectable()
export class LlmCallExecutor
  implements NodeExecutor<LlmCallInput, LlmCallOutput>
{
  readonly type = 'llm-call' as const;

  async execute(
    ctx: RunContext,
    config: Record<string, unknown>,
    input: LlmCallInput,
  ): Promise<NodeExecutorResult<LlmCallOutput>> {
    const cfg = config as unknown as LlmCallConfig;
    if (!cfg?.model) {
      throw new Error('llm-call node requires a `model` config value.');
    }

    // Pull chat history injected by the widget controller (last N turns).
    const runInputObj =
      ctx.runInput && typeof ctx.runInput === 'object' && !Array.isArray(ctx.runInput)
        ? (ctx.runInput as Record<string, unknown>)
        : {};
    const chatHistory = Array.isArray(runInputObj.chatHistory)
      ? (runInputObj.chatHistory as ChatTurn[])
      : [];

    const message = this.buildUserMessage(cfg, input, chatHistory);
    const LLM_TIMEOUT_MS = 30_000;
    const { response, inputTokens, outputTokens } = await Promise.race([
      BedrockService.invokeConverseText(cfg.model, message, {
        system: cfg.system,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens ?? 1024,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`LLM call timed out after ${LLM_TIMEOUT_MS / 1000}s`)),
          LLM_TIMEOUT_MS,
        ),
      ),
    ]);

    const pricing = PRICING_USD_PER_M[cfg.model] ?? PRICING_USD_PER_M.default;
    const cost =
      (inputTokens * pricing.in) / 1_000_000 +
      (outputTokens * pricing.out) / 1_000_000;

    const confidence = this.computeConfidence(input);

    return {
      output: {
        text: response,
        confidence,
        citations: Array.isArray(input?.citations) ? input.citations : [],
      },
      cost: round(cost, 6),
      tokens: { in: inputTokens, out: outputTokens },
      traceMeta: {
        provider: 'bedrock',
        model: cfg.model,
        confidence,
      },
    };
  }

  /**
   * Render the prompt sent to the model.
   *
   * - If `promptTemplate` is set, interpolates `{{message}}`, `{{chunks}}`,
   *   `{{citations}}`, and `{{history}}`.
   * - Otherwise builds a default prompt that:
   *   1. Prepends any chat history (last N turns) so the LLM has conversation
   *      context and can handle follow-ups naturally.
   *   2. Includes retrieved KB chunks when available, but tells the LLM to
   *      decide whether they are relevant — so greetings and chit-chat get a
   *      natural response without forcing the model to cite documents.
   */
  private buildUserMessage(
    cfg: LlmCallConfig,
    input: LlmCallInput,
    chatHistory: ChatTurn[],
  ): string {
    const message = (input?.message ?? '').toString();
    const chunks = Array.isArray(input?.chunks) ? input.chunks : [];
    const formattedChunks = chunks
      .map((c, i) => `(${i + 1}) ${c.text ?? c.content ?? ''}`)
      .filter((s) => s.trim().length > 0)
      .join('\n');

    const formattedHistory = chatHistory
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n');

    if (cfg.promptTemplate) {
      return cfg.promptTemplate
        .replace(/\{\{\s*message\s*\}\}/g, message)
        .replace(/\{\{\s*chunks\s*\}\}/g, formattedChunks)
        .replace(/\{\{\s*citations\s*\}\}/g, formattedChunks)
        .replace(/\{\{\s*history\s*\}\}/g, formattedHistory);
    }

    const parts: string[] = [];

    if (formattedHistory) {
      parts.push('Conversation so far:', formattedHistory, '');
    }

    if (formattedChunks) {
      parts.push(
        'Relevant context from the knowledge base (use ONLY if it directly answers the question; for greetings or small talk, ignore and respond naturally):',
        formattedChunks,
        '',
      );
    }

    parts.push(`User: ${message || 'Hello.'}`);

    return parts.join('\n');
  }

  /**
   * v1 confidence: max retrieval score (when present, normalized to 0..1)
   * else 0.85 default. Bedrock KB returns scores in the 0..1 range already.
   */
  private computeConfidence(input: LlmCallInput): number {
    const chunks = Array.isArray(input?.chunks) ? input.chunks : [];
    if (chunks.length === 0) return 0.85;
    let max = 0;
    for (const chunk of chunks) {
      const score = typeof chunk.score === 'number' ? chunk.score : 0;
      if (score > max) max = score;
    }
    return clamp(max, 0, 1);
  }
}

function round(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
