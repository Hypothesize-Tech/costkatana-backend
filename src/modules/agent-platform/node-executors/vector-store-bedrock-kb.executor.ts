import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  AgentKnowledgeBase,
  AgentKnowledgeBaseDocument,
} from '../../../schemas/agent-platform/agent-knowledge-base.schema';
import { SafeBedrockEmbeddings } from '../../agent/services/safe-bedrock-embeddings';
import { KbIndexService } from '../services/kb-index.service';
import { l2Normalize } from '../services/kb-text-extractor';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

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

    const kbDoc = await this.kbModel.findOne({
      organizationId: ctx.organizationId,
    });
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
      const raw = await this.embeddings.embedQuery(query);
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
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
