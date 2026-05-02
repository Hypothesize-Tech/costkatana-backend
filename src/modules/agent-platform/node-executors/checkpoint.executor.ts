import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../../bedrock/bedrock.service';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

interface CheckpointConfig {
  reason?: string;
  notify?: {
    slackChannel?: string;
    email?: string;
  };
  timeoutSeconds?: number;
  /**
   * Static message used as a last-resort fallback if the widget LLM call
   * fails or returns nothing. Optional.
   */
  widgetFallbackMessage?: string;
  /**
   * Bedrock model used for the auto-skip widget reply. Defaults to Haiku
   * (fast, cheap) — DAGs that want a smarter reply can override.
   */
  widgetReplyModel?: string;
  /**
   * System prompt for the auto-skip widget reply. Override per-deployment
   * if you want the bot to take on a specific persona or voice.
   */
  widgetSystemPrompt?: string;
}

interface CheckpointOutput {
  paused: boolean;
  reason: string;
  upstream: unknown;
  /**
   * Reply text rendered by the chat widget. Set on the auto-skip path
   * (LLM-generated when in widget mode); omitted on the pause path.
   */
  text?: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface KbChunk {
  text?: string;
  content?: string;
  score?: number;
  source?: string;
}

const DEFAULT_WIDGET_FALLBACK =
  "Sorry, I'm having trouble responding right now. Could you try again in a moment?";
// Sonnet 4 — better grounding/conversation than Haiku for ~3x cost. At chat-widget
// volumes this is pennies/day. Override per-deployment via `widgetReplyModel`.
const DEFAULT_WIDGET_MODEL = 'anthropic.claude-sonnet-4-20250514-v1:0';
const WIDGET_LLM_TIMEOUT_MS = 25_000;
const DEFAULT_WIDGET_SYSTEM_PROMPT =
  "You are a friendly, helpful customer support assistant. Reply naturally and concisely. " +
  'If knowledge-base context is provided below, prefer answering from that context and cite specifics. ' +
  "If the context is empty or not relevant (e.g. the user is greeting you, saying thanks, or asking about something the knowledge base doesn't cover), respond conversationally from general knowledge. " +
  "Never invent specific facts about the company; if you don't know, say so politely and offer to help with something else.";

/**
 * Pauses the run for human approval — except when invoked from an embedded
 * chat widget (no human in the loop). In widget mode this becomes a
 * "fallback LLM" node: it takes the user's latest message, conversation
 * history, and any retrieved KB chunks, and asks Bedrock for a reply that
 * the widget can render directly. This unblocks DAGs that otherwise dead-end
 * at a checkpoint on the low-confidence branch.
 */
@Injectable()
export class CheckpointExecutor
  implements NodeExecutor<unknown, CheckpointOutput>
{
  private readonly logger = new Logger(CheckpointExecutor.name);
  readonly type = 'checkpoint' as const;

  async execute(
    ctx: RunContext,
    config: Record<string, unknown>,
    input: unknown,
  ): Promise<NodeExecutorResult<CheckpointOutput>> {
    const cfg = config as unknown as CheckpointConfig;
    const reason = cfg?.reason ?? 'human approval required';

    if (cfg?.notify?.slackChannel || cfg?.notify?.email) {
      this.logger.log(
        `Checkpoint notification queued (run=${ctx.runId}): ${JSON.stringify(
          cfg.notify,
        )}`,
      );
    }

    if (ctx.widgetSessionId) {
      this.logger.log(
        `Checkpoint auto-passed for widget session (run=${ctx.runId}, session=${ctx.widgetSessionId}) — generating LLM reply.`,
      );
      const text = await this.generateWidgetReply(ctx, input, cfg);
      return {
        output: {
          paused: false,
          reason,
          upstream: input,
          text,
        },
        traceMeta: {
          notify: cfg?.notify ?? null,
          timeoutSeconds: cfg?.timeoutSeconds ?? null,
          autoSkipped: 'widget_session',
        },
      };
    }

    return {
      output: {
        paused: true,
        reason,
        upstream: input,
      },
      pause: {
        reason,
        payload: input,
      },
      traceMeta: {
        notify: cfg?.notify ?? null,
        timeoutSeconds: cfg?.timeoutSeconds ?? null,
      },
    };
  }

  /**
   * Build a chat reply via Bedrock. Pulls user message + history from
   * runInput, finds any retrieved chunks in the run's outputs (KB nodes
   * surface them under `chunks`), and asks the model for a natural reply.
   * Falls back to a static message if the LLM call fails or times out.
   */
  private async generateWidgetReply(
    ctx: RunContext,
    upstreamInput: unknown,
    cfg: CheckpointConfig,
  ): Promise<string> {
    const fallback =
      cfg?.widgetFallbackMessage?.trim() || DEFAULT_WIDGET_FALLBACK;

    // Prefer text from the upstream node if it already produced a response
    // (e.g. an LLM call earlier in the DAG produced a `text` field).
    if (upstreamInput && typeof upstreamInput === 'object') {
      const upstreamText = (upstreamInput as { text?: unknown }).text;
      if (typeof upstreamText === 'string' && upstreamText.trim().length > 0) {
        return upstreamText;
      }
    }

    // Pull user message + history from the run's original input.
    let userMessage = '';
    let chatHistory: ChatTurn[] = [];
    const runInput = ctx.runInput;
    if (typeof runInput === 'string') {
      userMessage = runInput;
    } else if (runInput && typeof runInput === 'object') {
      const ri = runInput as { message?: unknown; chatHistory?: unknown };
      if (typeof ri.message === 'string') userMessage = ri.message;
      if (Array.isArray(ri.chatHistory)) {
        chatHistory = ri.chatHistory.filter(
          (t): t is ChatTurn =>
            !!t &&
            typeof t === 'object' &&
            (t as ChatTurn).role !== undefined &&
            typeof (t as ChatTurn).content === 'string',
        );
      }
    }

    if (!userMessage.trim()) {
      return fallback;
    }

    // Find retrieved chunks anywhere in the run's outputs (KB executors
    // surface them under `chunks`). First node with chunks wins.
    let chunks: KbChunk[] = [];
    for (const out of Object.values(ctx.outputs)) {
      if (out && typeof out === 'object' && Array.isArray((out as { chunks?: unknown }).chunks)) {
        const candidate = (out as { chunks: KbChunk[] }).chunks;
        if (candidate.length > 0) {
          chunks = candidate;
          break;
        }
      }
    }

    const formattedHistory = chatHistory
      .slice(-6)
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n');
    const formattedChunks = chunks
      .map((c, i) => `(${i + 1}) ${c.text ?? c.content ?? ''}`)
      .filter((s) => s.trim().length > 0)
      .join('\n');

    const promptParts: string[] = [];
    if (formattedHistory) {
      promptParts.push(`Conversation so far:\n${formattedHistory}\n`);
    }
    promptParts.push(
      formattedChunks
        ? `Knowledge-base context:\n${formattedChunks}\n`
        : 'Knowledge-base context: (none — answer from general knowledge or politely say you do not have specific info)',
    );
    promptParts.push(`User: ${userMessage}`);
    const userPrompt = promptParts.join('\n');

    const model = cfg?.widgetReplyModel?.trim() || DEFAULT_WIDGET_MODEL;
    const systemPrompt =
      cfg?.widgetSystemPrompt?.trim() || DEFAULT_WIDGET_SYSTEM_PROMPT;

    try {
      const result = await Promise.race([
        BedrockService.invokeConverseText(model, userPrompt, {
          system: systemPrompt,
          maxTokens: 512,
          temperature: 0.7,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`widget LLM timed out after ${WIDGET_LLM_TIMEOUT_MS}ms`)),
            WIDGET_LLM_TIMEOUT_MS,
          ),
        ),
      ]);
      const reply = result.response?.trim();
      return reply && reply.length > 0 ? reply : fallback;
    } catch (err) {
      this.logger.warn(
        `Widget LLM reply failed (run=${ctx.runId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }
  }
}
