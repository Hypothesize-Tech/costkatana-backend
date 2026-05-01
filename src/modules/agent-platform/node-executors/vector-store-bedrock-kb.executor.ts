import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

import {
  AgentKnowledgeBase,
  AgentKnowledgeBaseDocument,
} from '../../../schemas/agent-platform/agent-knowledge-base.schema';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

interface VectorStoreConfig {
  topK?: number;
  /** Override the org-default KB id from the canvas. */
  knowledgeBaseId?: string;
}

interface VectorStoreInput {
  message?: string;
  query?: string;
}

interface VectorStoreOutput {
  /** Original user message, passed through for downstream nodes. */
  message: string;
  chunks: Array<{ text: string; score: number; source?: string }>;
  /** Max chunk score — drives the if-else confidence check. */
  confidence: number;
  citations: Array<{ url?: string; source?: string }>;
}

@Injectable()
export class VectorStoreBedrockKbExecutor
  implements NodeExecutor<VectorStoreInput, VectorStoreOutput>
{
  private readonly logger = new Logger(VectorStoreBedrockKbExecutor.name);
  readonly type = 'vector-store-bedrock-kb' as const;
  private readonly client: BedrockAgentRuntimeClient;

  constructor(
    @InjectModel(AgentKnowledgeBase.name)
    private readonly kbModel: Model<AgentKnowledgeBaseDocument>,
  ) {
    this.client = new BedrockAgentRuntimeClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
  }

  async execute(
    ctx: RunContext,
    config: Record<string, unknown>,
    input: VectorStoreInput,
  ): Promise<NodeExecutorResult<VectorStoreOutput>> {
    const cfg = config as unknown as VectorStoreConfig;
    const query = (input?.query ?? input?.message ?? '').toString().trim();
    if (!query) {
      return {
        output: {
          message: '',
          chunks: [],
          confidence: 0,
          citations: [],
        },
        traceMeta: { skipped: 'empty_query' },
      };
    }

    let bedrockKbId = cfg.knowledgeBaseId;
    let kbDoc: AgentKnowledgeBaseDocument | null = null;
    if (!bedrockKbId) {
      kbDoc = await this.kbModel.findOne({
        organizationId: ctx.organizationId,
        status: 'ready',
      });
      bedrockKbId = kbDoc?.bedrockKbId ?? undefined;
    }

    if (!bedrockKbId) {
      this.logger.warn(
        `No ready Bedrock KB for org ${ctx.organizationId} — returning empty result.`,
      );
      return {
        output: {
          message: query,
          chunks: [],
          confidence: 0,
          citations: [],
        },
        traceMeta: {
          provider: 'bedrock-kb',
          skipped: 'no_kb_configured',
          orgId: ctx.organizationId,
        },
      };
    }

    try {
      const response = await this.client.send(
        new RetrieveCommand({
          knowledgeBaseId: bedrockKbId,
          retrievalQuery: { text: query },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: cfg.topK ?? 5,
            },
          },
        }),
      );

      const rawChunks = response.retrievalResults ?? [];
      const chunks = rawChunks.map((r) => ({
        text: r.content?.text ?? '',
        score: typeof r.score === 'number' ? r.score : 0,
        source: r.location?.s3Location?.uri,
      }));
      const confidence = chunks.reduce(
        (max, c) => (c.score > max ? c.score : max),
        0,
      );
      const citations = chunks
        .filter((c) => Boolean(c.source))
        .map((c) => ({ source: c.source, url: c.source }));

      return {
        output: {
          message: query,
          chunks,
          confidence,
          citations,
        },
        traceMeta: {
          provider: 'bedrock-kb',
          knowledgeBaseId: bedrockKbId,
          chunksReturned: chunks.length,
          maxScore: confidence,
        },
      };
    } catch (err) {
      this.logger.warn(
        `Bedrock KB retrieve failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        output: {
          message: query,
          chunks: [],
          confidence: 0,
          citations: [],
        },
        traceMeta: {
          provider: 'bedrock-kb',
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
