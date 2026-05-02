import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  AgentKnowledgeBase,
  AgentKnowledgeBaseDocument,
} from '../../../schemas/agent-platform/agent-knowledge-base.schema';
import { SafeBedrockEmbeddings } from '../../agent/services/safe-bedrock-embeddings';
import { BedrockService } from '../../bedrock/bedrock.service';
import { KbIndexService } from '../services/kb-index.service';
import { l2Normalize } from '../services/kb-text-extractor';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
const EMBEDDING_TIMEOUT_MS = 8_000;

// Cheap, fast model used purely to decide whether the user's message warrants
// a KB lookup. Same pattern as `chat/routing/ai.router.ts`.
const ROUTER_MODEL = 'anthropic.claude-3-5-haiku-20241022-v1:0';
const ROUTER_TIMEOUT_MS = 3_000;
const MAX_HISTORY_TURNS_FOR_ROUTING = 4;

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Super-fast path: skip the router LLM call for obvious 1–2 word non-questions.
 * "hi", "hello", "thanks", "bye" — calling Haiku to be told "no, don't lookup"
 * would just add latency. Anything 3+ words or containing "?" goes to the
 * router so the model can decide.
 */
const isTrivialChat = (query: string): boolean =>
  !query.includes('?') && query.split(/\s+/).filter(Boolean).length <= 2;

interface VectorStoreConfig {
  topK?: number;
}

interface VectorStoreInput {
  message?: string;
  query?: string;
}

interface VectorStoreOutput {
  /** Original user message, passed through for downstream nodes. */
  message: string;
  chunks: Array<{ text: string; score: number; source?: string; ordinal?: number }>;
  /** Max chunk score — drives the if-else confidence check. */
  confidence: number;
  citations: Array<{ source: string }>;
}

/**
 * Retrieval node. Embeds the query with Bedrock Titan v2, then asks
 * `KbIndexService` for the top-k matching chunks (FAISS in-memory, Mongo
 * fallback). Tenancy: queries the org's `AgentKnowledgeBase` row.
 *
 * Type id stays `vector-store-bedrock-kb` for backwards compatibility with
 * the canvas DAGs that already reference it.
 */
@Injectable()
export class VectorStoreBedrockKbExecutor
  implements NodeExecutor<VectorStoreInput, VectorStoreOutput>
{
  private readonly logger = new Logger(VectorStoreBedrockKbExecutor.name);
  readonly type = 'vector-store-bedrock-kb' as const;

  private readonly embeddings = new SafeBedrockEmbeddings({
    region: REGION,
    model: EMBEDDING_MODEL,
  });

  constructor(
    @InjectModel(AgentKnowledgeBase.name)
    private readonly kbModel: Model<AgentKnowledgeBaseDocument>,
    private readonly kbIndex: KbIndexService,
  ) {}

  async execute(
    ctx: RunContext,
    config: Record<string, unknown>,
    input: VectorStoreInput,
  ): Promise<NodeExecutorResult<VectorStoreOutput>> {
    const cfg = config as unknown as VectorStoreConfig;
    const query = (input?.query ?? input?.message ?? '').toString().trim();
    if (!query) {
      return {
        output: { message: '', chunks: [], confidence: 0, citations: [] },
        traceMeta: { skipped: 'empty_query' },
      };
    }

    // Fast path: obvious greetings / one-word replies skip the router entirely.
    if (isTrivialChat(query)) {
      return {
        output: { message: query, chunks: [], confidence: 0, citations: [] },
        traceMeta: { skipped: 'trivial_chat' },
      };
    }

    // LLM-as-router: ask Haiku whether this message actually needs KB lookup.
    // Pulls last few turns from runInput so the router has conversation context
    // (e.g. "yes, tell me more" depends on what came before).
    const chatHistory = this.extractChatHistory(ctx);
    const decision = await this.shouldUseKb(query, chatHistory);
    if (!decision.useKb) {
      return {
        output: { message: query, chunks: [], confidence: 0, citations: [] },
        traceMeta: { skipped: 'router_no_kb', reason: decision.reason },
      };
    }

    const kbDoc = await this.kbModel
      .findOne({ organizationId: ctx.organizationId })
      .maxTimeMS(4_000)
      .catch(() => null);
    if (!kbDoc || kbDoc.status === 'failed') {
      this.logger.debug(
        `No usable KB for org ${ctx.organizationId} — returning empty result.`,
      );
      return {
        output: { message: query, chunks: [], confidence: 0, citations: [] },
        traceMeta: {
          skipped: 'no_kb_configured',
          orgId: ctx.organizationId,
        },
      };
    }

    let queryVector: number[];
    try {
      const raw = await Promise.race([
        this.embeddings.embedQuery(query),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Bedrock embedding timed out after ${EMBEDDING_TIMEOUT_MS}ms`)),
            EMBEDDING_TIMEOUT_MS,
          ),
        ),
      ]);
      queryVector = l2Normalize(raw);
    } catch (err) {
      this.logger.warn(
        `Embedding query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        output: { message: query, chunks: [], confidence: 0, citations: [] },
        traceMeta: {
          provider: 'bedrock-titan',
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }

    const topK = Math.max(1, Math.min(cfg.topK ?? 5, 20));
    const results = await this.kbIndex.search(
      String(kbDoc._id),
      queryVector,
      topK,
    );

    const chunks = results.map((r) => ({
      text: r.text,
      score: clamp(r.score, 0, 1),
      source: r.source,
      ordinal: r.ordinal,
    }));
    const confidence = chunks.reduce(
      (max, c) => (c.score > max ? c.score : max),
      0,
    );
    const seen = new Set<string>();
    const citations = chunks
      .filter((c) => {
        if (!c.source || seen.has(c.source)) return false;
        seen.add(c.source);
        return true;
      })
      .map((c) => ({ source: c.source! }));

    return {
      output: { message: query, chunks, confidence, citations },
      traceMeta: {
        provider: 'kb-faiss',
        knowledgeBaseId: String(kbDoc._id),
        chunksReturned: chunks.length,
        maxScore: confidence,
      },
    };
  }

  /**
   * Read the last few conversation turns out of the run input so the router
   * has context. The widget controller stuffs `chatHistory` into `runInput`
   * before starting the run.
   */
  private extractChatHistory(ctx: RunContext): ChatTurn[] {
    if (!ctx.runInput || typeof ctx.runInput !== 'object' || Array.isArray(ctx.runInput)) {
      return [];
    }
    const raw = (ctx.runInput as Record<string, unknown>).chatHistory;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (t): t is ChatTurn =>
          !!t &&
          typeof t === 'object' &&
          (t as ChatTurn).role !== undefined &&
          typeof (t as ChatTurn).content === 'string',
      )
      .slice(-MAX_HISTORY_TURNS_FOR_ROUTING);
  }

  /**
   * Ask Haiku whether this query needs a KB lookup. Same pattern as the chat
   * module's `AIRouter`: small focused prompt, JSON response, tight timeout.
   *
   * Failure modes (timeout, parse error, Bedrock error) all default to
   * `useKb: false` so the chat stays responsive — if the router is broken,
   * we'd rather give the user a fast LLM-only reply than hang waiting on
   * retrieval that's also likely broken.
   */
  private async shouldUseKb(
    query: string,
    chatHistory: ChatTurn[],
  ): Promise<{ useKb: boolean; reason: string }> {
    const historyBlock = chatHistory.length
      ? `\nRecent conversation:\n${chatHistory
          .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
          .join('\n')}\n`
      : '';

    const prompt = `You are a routing assistant for a customer support chat widget. Decide whether the user's latest message needs information from a knowledge base of company documents.
${historyBlock}
Latest user message: "${query}"

Respond with JSON only (no markdown, no other text):
{"useKb": true | false, "reason": "<one-line reason>"}

Set useKb=true when the user:
- Asks about products, features, pricing, policies, or company-specific topics
- Wants documentation, how-to guides, or specific factual answers
- References something from earlier turns that needs a factual lookup

Set useKb=false when the user:
- Greets, thanks, says goodbye, or makes small talk
- Acknowledges briefly ("ok", "got it", "sure", "thanks")
- Asks meta questions about the bot ("are you human", "what can you do")
- Sends a one-word reply or filler`;

    try {
      const result = await Promise.race([
        BedrockService.invokeConverseText(ROUTER_MODEL, prompt, {
          maxTokens: 80,
          temperature: 0,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Router timed out after ${ROUTER_TIMEOUT_MS}ms`)),
            ROUTER_TIMEOUT_MS,
          ),
        ),
      ]);

      const match = result.response.match(/\{[\s\S]*?\}/);
      if (!match) {
        return { useKb: false, reason: 'router_parse_failed' };
      }
      const parsed = JSON.parse(match[0]) as {
        useKb?: unknown;
        reason?: unknown;
      };
      const useKb = parsed.useKb === true;
      const reason =
        typeof parsed.reason === 'string' ? parsed.reason : 'no_reason';
      return { useKb, reason };
    } catch (err) {
      this.logger.warn(
        `KB router failed, defaulting to useKb=false: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { useKb: false, reason: 'router_error' };
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
