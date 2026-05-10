/**
 * RoutingStage
 *
 * Decides which handler will produce the answer:
 *   knowledge_base | web_scraper | mcp | conversational_flow | multi_agent | fallback
 *
 * Calls the existing `RouteDecider.decide()` (which already includes our
 * Phase-1 freshness fast-path and the AI router with its tightened prompt).
 *
 * Adds Phase-2 top-N enrichment: the stage records up to two `alternatives`
 * so `ExecutionStage` can fall back to the next-best route on a retryable
 * handler failure (timeout, 5xx, no-results). The current `RouteDecider`
 * doesn't expose alternatives directly yet — we synthesise them here from
 * intent signals (integration hint, freshness signal, `documentIds`) until
 * `RouteDecider` is upgraded to return them natively.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RouteDecider } from '../../utils/route-decider';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok, fail } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';

@Injectable()
export class RoutingStage implements PipelineStage {
  readonly name = 'routing';
  private readonly logger = new Logger(RoutingStage.name);

  constructor(private readonly routeDecider: RouteDecider) {}

  async run(ctx: StageContext): Promise<StageResult> {
    if (!ctx.conversation) {
      // Routing depends on conversation context for `currentSubject` /
      // `lastDomain`. The orchestrator should have populated this earlier.
      return fail(
        this.name,
        'missing_conversation',
        'RoutingStage requires ctx.conversation; pipeline misconfigured.',
      );
    }

    try {
      const route = await this.routeDecider.decide(
        ctx.conversation as any,
        ctx.effectiveMessage ?? '',
        ctx.userId,
        ctx.dto.useWebSearch === true,
        ctx.dto.documentIds,
      );

      const alternatives = this.computeAlternatives(route, ctx);

      this.logger.debug('Route decided', {
        requestId: ctx.requestId,
        route,
        alternatives: alternatives.map((a) => a.route),
      });

      return ok({ route, alternatives });
    } catch (err) {
      // RouteDecider already has its own LLM/legacy fallback layer; if even
      // that throws, default to conversational_flow so the user gets *some*
      // response.
      this.logger.warn('RouteDecider threw; defaulting to conversational_flow', {
        requestId: ctx.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      return ok({
        route: 'conversational_flow',
        alternatives: [{ route: 'knowledge_base', confidence: 0.3 }],
      });
    }
  }

  /**
   * Synthesise up to two alternates from request signals. Heuristic: if the
   * primary route is `web_scraper` and we have no docs, a knowledge-base
   * retry doesn't help — fall back to conversational_flow. Conversely, if
   * the primary is `knowledge_base` and the message looks fresh-data-y,
   * `web_scraper` is the right second pick.
   */
  private computeAlternatives(
    primary: string,
    ctx: StageContext,
  ): Array<{ route: string; confidence: number }> {
    const message = ctx.effectiveMessage?.toLowerCase() ?? '';
    const looksFresh =
      /\b(latest|current|today|recent|news|pricing|price|cost)\b/.test(message);

    if (primary === 'mcp') {
      return [
        { route: 'knowledge_base', confidence: 0.5 },
        { route: 'web_scraper', confidence: 0.4 },
      ];
    }
    if (primary === 'web_scraper') {
      return [
        { route: 'knowledge_base', confidence: 0.5 },
        { route: 'conversational_flow', confidence: 0.3 },
      ];
    }
    if (primary === 'knowledge_base') {
      return looksFresh
        ? [
            { route: 'web_scraper', confidence: 0.6 },
            { route: 'conversational_flow', confidence: 0.3 },
          ]
        : [{ route: 'conversational_flow', confidence: 0.4 }];
    }
    if (primary === 'multi_agent') {
      return [
        { route: 'knowledge_base', confidence: 0.4 },
        { route: 'conversational_flow', confidence: 0.3 },
      ];
    }
    return [{ route: 'conversational_flow', confidence: 0.3 }];
  }
}
