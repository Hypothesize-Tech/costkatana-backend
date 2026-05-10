import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BedrockService } from '../../bedrock/bedrock.service';
import type {
  AgentDag,
  DagValidationResult,
} from '../interfaces/dag.interface';
import { AgentCompilerService } from './agent-compiler.service';

export interface TextToAgentContext {
  userId?: string;
  projectId?: string;
  traceId?: string;
  /** Pass an existing builderSessionId to group iterative builder calls. */
  builderSessionId?: string;
}

interface TextToAgentResult {
  dag: AgentDag;
  validation: DagValidationResult;
  suggestedName: string;
  /** UUID grouping every LLM call for this build attempt; echo back on agent save. */
  builderSessionId: string;
}

const BUILDER_MODEL = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

const SYSTEM_PROMPT = `You convert plain-English agent descriptions into a JSON DAG for the CostKatana Agent Builder.

Rules:
- Output ONLY a JSON object matching this shape: {"name": string, "dag": {"nodes": [...], "edges": [...]}}.
- Each node has fields: id (unique kebab-case), type, position {x, y}, data {label, config}.
- Available node types: user-message-input, llm-call, web-search, vector-store-bedrock-kb, if-else, checkpoint, response-output.
- Every flow MUST start with user-message-input and end with response-output.
- llm-call requires { model: "anthropic.claude-3-5-sonnet-20241022-v2:0" } in config (use Haiku ids only when explicitly told).
- if-else uses { simple: { path, op, value } } where op is one of eq/neq/gt/gte/lt/lte/truthy.
- Edges connect node ids and may carry an optional label ("true"/"false") for if-else branches.
- Lay nodes out left-to-right with x increments of 240, y around 200, branching nodes offset by ±100 vertically.
- Don't add commentary; emit JSON only.`;

const FALLBACK_DAG: AgentDag = {
  nodes: [
    {
      id: 'n_input',
      type: 'user-message-input',
      position: { x: 80, y: 200 },
      data: { label: 'User message', config: {} },
    },
    {
      id: 'n_llm',
      type: 'llm-call',
      position: { x: 320, y: 200 },
      data: {
        label: 'Reply',
        config: {
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          temperature: 0.3,
          maxTokens: 1024,
        },
      },
    },
    {
      id: 'n_out',
      type: 'response-output',
      position: { x: 600, y: 200 },
      data: { label: 'Reply', config: {} },
    },
  ],
  edges: [
    { id: 'e1', source: 'n_input', target: 'n_llm' },
    { id: 'e2', source: 'n_llm', target: 'n_out' },
  ],
};

@Injectable()
export class TextToAgentService {
  private readonly logger = new Logger(TextToAgentService.name);

  constructor(private readonly compiler: AgentCompilerService) {}

  async generate(
    description: string,
    ctx: TextToAgentContext = {},
  ): Promise<TextToAgentResult> {
    const trimmed = description?.trim() ?? '';
    if (!trimmed) {
      throw new BadRequestException('description is required');
    }

    const builderSessionId = ctx.builderSessionId ?? randomUUID();
    const userPrompt = `Description:\n${trimmed}\n\nReturn JSON now.`;
    let parsed: { name?: string; dag?: AgentDag } | undefined;

    try {
      const { response } = await BedrockService.invokeConverseText(
        BUILDER_MODEL,
        userPrompt,
        {
          system: SYSTEM_PROMPT,
          temperature: 0,
          maxTokens: 2048,
          telemetry: {
            operationName: 'agent.builder.text_to_agent',
            eventCategory: 'builder',
            source: 'agent-builder',
            userId: ctx.userId,
            sessionId: builderSessionId,
            requestId: ctx.traceId,
            metadata: {
              projectId: ctx.projectId,
              descriptionLength: trimmed.length,
            },
          },
        },
      );
      parsed = extractJsonObject(response);
    } catch (err) {
      this.logger.warn(
        `text-to-agent generation failed: ${err instanceof Error ? err.message : String(err)} — falling back to skeleton DAG.`,
      );
    }

    const dag =
      (parsed?.dag && Array.isArray(parsed.dag.nodes) ? parsed.dag : null) ??
      FALLBACK_DAG;
    const validation = this.compiler.compile(dag);
    const suggestedName =
      (parsed?.name ?? '').trim() || this.deriveNameFromDescription(trimmed);

    if (!validation.ok) {
      this.logger.warn(
        `Generated DAG failed validation; returning anyway with issues for the UI to surface.`,
      );
    }

    return {
      dag,
      validation,
      suggestedName,
      builderSessionId,
    };
  }

  private deriveNameFromDescription(description: string): string {
    const first = description.split(/[.!?\n]/)[0] ?? description;
    return first.length > 60 ? first.substring(0, 57) + '...' : first;
  }
}

function extractJsonObject(text: string): { name?: string; dag?: AgentDag } | undefined {
  if (!text) return undefined;
  // Strip ```json fences if present.
  const cleaned = text
    .replace(/```\s*json\s*/i, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return undefined;
  try {
    return JSON.parse(cleaned.substring(start, end + 1));
  } catch {
    return undefined;
  }
}
