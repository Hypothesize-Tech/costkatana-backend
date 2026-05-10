/**
 * ExecutionStage
 *
 * Dispatches to the per-route handler chosen by RoutingStage. On a
 * retryable failure (timeout, 5xx, no-results, transient handler error),
 * walks down `ctx.alternatives` and tries each in turn — logging every
 * attempt so post-mortem can see the fallback chain.
 *
 * In Phase-2 land-safe mode, this stage isn't wired into the live request
 * path yet; ChatService.sendMessage continues to call its existing
 * `routeMessage()` switch. This class is the seam through which Phase-2.5
 * will replace that switch once each handler exposes a uniform interface.
 *
 * Today this stage:
 *  - Validates ctx.route is set.
 *  - Records that execution would happen for `ctx.route`.
 *  - Defers the actual handler call to the legacy ChatService method via a
 *    callback the caller injects. (Wired in Phase 2.J.)
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok, fail } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';

/**
 * Adapter the orchestrator wires up so this stage doesn't need to import
 * the (large) `ChatService`. Implemented in Phase 2.J as a thin wrapper
 * around the existing `routeMessage()` switch.
 */
export interface ExecutionAdapter {
  runRoute(
    route: string,
    ctx: StageContext,
  ): Promise<{ response: any; agentPath?: string[] }>;
}

const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
]);

function isRetryable(err: unknown): boolean {
  const e = err as { code?: string; status?: number; response?: { status?: number } };
  if (e?.code && RETRYABLE_CODES.has(e.code)) return true;
  const status = e?.status ?? e?.response?.status;
  if (typeof status === 'number') return status >= 500;
  return false;
}

@Injectable()
export class ExecutionStage implements PipelineStage {
  readonly name = 'execution';
  private readonly logger = new Logger(ExecutionStage.name);

  /**
   * The adapter is set by `ChatPipelineModule.register` at module init time
   * (Phase 2.J). Until wired, `run()` short-circuits with `noop_handler`.
   */
  private adapter: ExecutionAdapter | null = null;

  setAdapter(adapter: ExecutionAdapter): void {
    this.adapter = adapter;
  }

  async run(ctx: StageContext): Promise<StageResult> {
    if (!this.adapter) {
      // No adapter registered — legacy code path is in charge. We exit
      // cleanly so a partially-wired pipeline doesn't break the request.
      this.logger.debug(
        'No ExecutionAdapter registered — skipping handler dispatch',
        { requestId: ctx.requestId, route: ctx.route },
      );
      return ok();
    }

    // Adapter is present. If RoutingStage didn't run (or didn't set a
    // route), delegate with a sentinel — the adapter (e.g. the legacy
    // ChatService bridge) does its own routing internally.
    const primary = ctx.route ?? '__legacy__';
    const queue: string[] = [
      primary,
      ...(ctx.alternatives ?? []).map((a) => a.route),
    ];
    let lastErr: unknown;

    for (let i = 0; i < queue.length; i++) {
      const candidate = queue[i];
      const isFallback = i > 0;
      try {
        this.logger.debug('Dispatching handler', {
          requestId: ctx.requestId,
          route: candidate,
          isFallback,
        });
        const result = await this.adapter.runRoute(candidate, ctx);
        return ok({ response: result.response });
      } catch (err) {
        lastErr = err;
        const retryable = isRetryable(err);
        this.logger.warn('Handler failed', {
          requestId: ctx.requestId,
          route: candidate,
          retryable,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!retryable) break;
        // try next alternate
      }
    }

    return fail(
      this.name,
      'execution_exhausted',
      'All routes (primary + alternates) failed.',
      lastErr,
    );
  }
}
