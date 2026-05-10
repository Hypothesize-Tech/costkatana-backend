/**
 * ConversationStage
 *
 * Loads (or creates) the chat conversation and prefetches recent messages
 * for context. Sets `ctx.conversation` and `ctx.recentMessages` so every
 * downstream stage — including `processChatRequest` once it's
 * pipeline-aware — reads pre-computed values instead of running the same
 * Mongo queries again.
 *
 * Belongs at the top of the pipeline (right after SecurityStage) because:
 *   - RoutingStage needs `ctx.conversation` for `currentSubject` /
 *     `lastDomain` heuristics.
 *   - IntegrationStage needs `ctx.conversation.{github,vercel,mongodb}Context`
 *     to know which integrations have a tied resource.
 *   - PersistenceStage will reuse the same handle to update timestamps.
 *
 * Failure mode: a missing-conversation error from `ConversationLoader` is
 * a user-facing 404. We re-throw it so the controller maps to the right
 * HTTP status; the pipeline orchestrator's rollback runs because `errors`
 * is recorded by the orchestrator on the throw.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok, fail } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';
import { ConversationLoader } from '../helpers/conversation-loader.service';
import { ContextOptimizer } from '../../utils/context-optimizer';

@Injectable()
export class ConversationStage implements PipelineStage {
  readonly name = 'conversation';
  private readonly logger = new Logger(ConversationStage.name);

  constructor(
    private readonly conversationLoader: ConversationLoader,
    private readonly contextOptimizer: ContextOptimizer,
  ) {}

  async run(ctx: StageContext): Promise<StageResult> {
    try {
      const conversation = await this.conversationLoader.loadOrCreate(
        ctx.userId,
        ctx.dto,
      );

      const messageLength = (ctx.dto.message ?? '').length;
      const recentMessages = await this.contextOptimizer.fetchOptimalContext(
        (conversation as { _id: { toString(): string } })._id.toString(),
        messageLength,
      );

      this.logger.debug('Conversation prepared', {
        requestId: ctx.requestId,
        conversationId: (conversation as { _id: { toString(): string } })._id.toString(),
        recentCount: recentMessages.length,
      });

      return ok({
        conversation: conversation as any,
        recentMessages: recentMessages as Array<{ role: string; content: string }>,
      });
    } catch (err) {
      // 404 propagates as a controller-level NotFoundException, but we
      // record it in the pipeline's structured failure path too so any
      // accumulated rollbacks (none yet at this stage, but future-safe)
      // get invoked.
      if (err instanceof NotFoundException) throw err;
      return fail(
        this.name,
        'conversation_load_error',
        'Failed to load or create conversation.',
        err,
      );
    }
  }
}
