/**
 * PersistenceStage
 *
 * Last stage. In land-safe Phase-2 mode this is a NO-OP because legacy
 * `ChatService.sendMessage` still owns the DB writes (user message,
 * assistant message, conversation update, event emission).
 *
 * What it WILL do once Phase 2.J flips the orchestrator on:
 *   1. Persist the assistant message produced by ExecutionStage.
 *   2. Update conversation timestamps + last-message metadata.
 *   3. Emit `chat.message` SSE/event-bus events.
 *   4. Provide a rollback that deletes the persisted message if a downstream
 *      hook (e.g. analytics flush) fails — preventing the half-write
 *      problem the legacy god-method has today.
 *
 * The stage is intentionally last so any earlier failure rolls back BEFORE
 * any DB write happens, never partway through.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok, fail } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';

export interface PersistenceAdapter {
  persistAssistantMessage(ctx: StageContext): Promise<{
    messageId: string;
    rollback: () => Promise<void>;
  }>;
  emitMessageEvent(ctx: StageContext, messageId: string): Promise<void>;
}

@Injectable()
export class PersistenceStage implements PipelineStage {
  readonly name = 'persistence';
  private readonly logger = new Logger(PersistenceStage.name);

  private adapter: PersistenceAdapter | null = null;

  setAdapter(adapter: PersistenceAdapter): void {
    this.adapter = adapter;
  }

  async run(ctx: StageContext): Promise<StageResult> {
    if (!this.adapter) {
      this.logger.debug(
        'No PersistenceAdapter registered — skipping (legacy path active)',
        { requestId: ctx.requestId },
      );
      return ok();
    }
    if (!ctx.response) {
      // Nothing to persist if execution didn't produce a response (likely a
      // short-circuit earlier or the legacy path is in charge).
      return ok();
    }

    try {
      const { messageId, rollback } =
        await this.adapter.persistAssistantMessage(ctx);
      // Emit AFTER persistence so consumers who hit the read path don't see
      // a missing message. Emit failure does NOT roll back the DB write
      // (the message is committed; redelivery is the caller's job).
      try {
        await this.adapter.emitMessageEvent(ctx, messageId);
      } catch (emitErr) {
        this.logger.warn('Event emission failed; message persisted regardless', {
          requestId: ctx.requestId,
          messageId,
          error: emitErr instanceof Error ? emitErr.message : String(emitErr),
        });
      }
      return ok({}, rollback);
    } catch (err) {
      return fail(
        this.name,
        'persistence_error',
        'Failed to persist assistant message.',
        err,
      );
    }
  }
}
