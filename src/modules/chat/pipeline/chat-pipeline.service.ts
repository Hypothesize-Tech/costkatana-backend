/**
 * Chat-message processing pipeline.
 *
 * Orchestrates a fixed-order sequence of stages, threading a single
 * `StageContext` through them. Each stage reports its result via the
 * `StageResult` discriminated union; the orchestrator:
 *
 *  - **on success**: shallow-merges `mutates` into the context and pushes
 *    `rollback` onto a stack;
 *  - **on short-circuit**: stops running further stages but returns the
 *    accumulated context (e.g. an integration command was fully handled);
 *  - **on failure**: runs all accumulated rollbacks in reverse order and
 *    rethrows a structured error — never half-writes to DB.
 *
 * The pipeline does NOT contain business logic. Every concern (security,
 * attachments, integration routing, plan classification, handler dispatch,
 * persistence) lives inside a stage. New stages can be inserted without
 * touching the orchestrator.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PipelineStage } from './types/stage-result';
import type { StageContext, StageError } from './types/stage-context';

export class PipelineFailure extends Error {
  constructor(
    public readonly stageError: StageError,
    public readonly partialContext: StageContext,
  ) {
    super(
      `[${stageError.stage}] ${stageError.code}: ${stageError.message}`,
    );
    this.name = 'PipelineFailure';
  }
}

@Injectable()
export class ChatPipeline {
  private readonly logger = new Logger(ChatPipeline.name);

  /**
   * Run an ordered list of stages over a freshly-built context. Returns the
   * final (possibly short-circuited) context. Caller is responsible for
   * extracting `ctx.response` and turning it into the HTTP body.
   */
  async execute(
    stages: PipelineStage[],
    ctx: StageContext,
  ): Promise<StageContext> {
    for (const stage of stages) {
      const stageStart = Date.now();
      let result;
      try {
        result = await stage.run(ctx);
      } catch (err) {
        // A stage threw instead of returning a structured error — treat as
        // failure and roll back. We capture the original error as `cause` so
        // it surfaces in logs without leaking through to the user.
        this.logger.error('Stage threw an unhandled error', {
          stage: stage.name,
          requestId: ctx.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.rollback(ctx);
        throw new PipelineFailure(
          {
            stage: stage.name,
            code: 'unhandled_throw',
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          },
          ctx,
        );
      }

      const stageMs = Date.now() - stageStart;

      if (!result.success) {
        this.logger.warn('Stage returned a structured failure', {
          stage: stage.name,
          requestId: ctx.requestId,
          code: result.error.code,
          stageMs,
        });
        ctx.errors.push(result.error);
        await this.rollback(ctx);
        throw new PipelineFailure(result.error, ctx);
      }

      // Merge mutations + register rollback. We iterate keys explicitly to
      // avoid clobbering the bookkeeping fields the orchestrator owns.
      if (result.mutates) {
        const target = ctx as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(result.mutates)) {
          if (k === 'errors' || k === 'rollbacks') continue;
          target[k] = v;
        }
      }
      if (result.rollback) {
        ctx.rollbacks.push(result.rollback);
      }

      this.logger.debug('Stage completed', {
        stage: stage.name,
        requestId: ctx.requestId,
        stageMs,
        shortCircuit: !!result.shortCircuit,
        mutated: result.mutates ? Object.keys(result.mutates) : [],
      });

      if (result.shortCircuit) {
        this.logger.log('Pipeline short-circuited', {
          stage: stage.name,
          requestId: ctx.requestId,
          totalMs: Date.now() - ctx.startTime,
        });
        return ctx;
      }
    }

    this.logger.log('Pipeline completed', {
      requestId: ctx.requestId,
      totalMs: Date.now() - ctx.startTime,
    });
    return ctx;
  }

  /**
   * Run accumulated rollbacks in reverse order, swallowing rollback errors so
   * one bad compensator can't block the rest. Logs each failure.
   */
  private async rollback(ctx: StageContext): Promise<void> {
    if (ctx.rollbacks.length === 0) return;
    this.logger.warn('Pipeline failure — rolling back', {
      requestId: ctx.requestId,
      compensators: ctx.rollbacks.length,
    });
    while (ctx.rollbacks.length) {
      const fn = ctx.rollbacks.pop();
      if (!fn) continue;
      try {
        await fn();
      } catch (err) {
        this.logger.error('Rollback compensator failed', {
          requestId: ctx.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
