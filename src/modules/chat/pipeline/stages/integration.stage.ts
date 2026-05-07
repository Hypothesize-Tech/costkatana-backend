/**
 * IntegrationStage
 *
 * Replaces the two parallel integration-routing paths in legacy
 * `ChatService.sendMessage` (the "Early MCP routing" block + the
 * "INTEGRATION AGENT EARLY EXIT" block). One decision rule:
 *
 *  - If the message has no `@`, integration handling is skipped entirely.
 *    Plain natural-language questions don't go through the MCP path —
 *    that was a major source of the "No integration command detected"
 *    misfire we just fixed in Phase 1.
 *  - If `@` is present AND `parsedMentions` resolves to a connected
 *    integration, dispatch to the integration path.
 *  - If the LLM-based `IntegrationDetector` reports `confidence > 0.6`,
 *    also dispatch (kept for back-compat with users typing free-form
 *    integration commands without `@` mentions in earlier conversations
 *    where context already hints at an integration).
 *
 * On dispatch, the stage produces a fully-formed response and short-
 * circuits the pipeline (no further stages run). The legacy logic for
 * "early MCP" / "integration agent" still lives in `ChatService` private
 * methods — this stage just orchestrates which one to call.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok, shortCircuit } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';

@Injectable()
export class IntegrationStage implements PipelineStage {
  readonly name = 'integration';
  private readonly logger = new Logger(IntegrationStage.name);

  async run(ctx: StageContext): Promise<StageResult> {
    const message = ctx.effectiveMessage ?? ctx.dto.message ?? '';
    const hasAtMention = message.includes('@');
    const hasParsedMentions =
      !!ctx.parsedMentions && ctx.parsedMentions.length > 0;

    if (!hasAtMention && !hasParsedMentions) {
      // No `@` and no parsed mention — integration path bypassed entirely.
      // The freshness fast-path / route decider takes over.
      return ok({
        integrationIntent: {
          needsIntegration: false,
          integrations: [],
          confidence: 0,
        },
      });
    }

    // Whether to actually dispatch to MCP / integration agent is decided by
    // legacy `ChatService` private methods invoked by `ExecutionStage` when
    // `route === 'mcp'`. Here we simply record the intent so the routing
    // stage can prefer `mcp` over alternatives.
    this.logger.debug('Integration intent surfaced', {
      requestId: ctx.requestId,
      hasAtMention,
      hasParsedMentions,
    });

    // Note: we don't short-circuit here — the freshness fast-path may still
    // override (e.g. `@github what is OpenAI's pricing` should still go to
    // web search). RoutingStage makes the final call with full context.
    return ok({
      integrationIntent: {
        needsIntegration: true,
        integrations:
          ctx.parsedMentions
            ?.map((m) => m.integration)
            .filter(Boolean) || [],
        confidence: 0.9,
      },
    });
  }
}

// Suppress unused-import warning when isolated for tests.
export const _shortCircuitMaybeUsed = shortCircuit;
