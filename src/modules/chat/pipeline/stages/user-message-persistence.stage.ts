/**
 * UserMessagePersistenceStage
 *
 * Persists the user-sent message before route execution. Runs AFTER
 * AttachmentStage (so processed attachments are on `ctx`) and BEFORE
 * RoutingStage (downstream code references `ctx.userMessageDoc._id`).
 *
 * Why this stage exists:
 *   - The legacy `processChatRequest` writes the user message inline,
 *     which means a downstream failure (route handler crash, persistence
 *     of the assistant message blowing up) can leave the user message
 *     committed without an associated assistant response. This stage
 *     registers a rollback that hard-deletes the message if any later
 *     stage in the pipeline fails — closing the half-write hole.
 *
 *   - It also gives stages after this one (RoutingStage, ExecutionStage,
 *     PersistenceStage) a stable handle on the persisted user message so
 *     they don't have to look it up by content.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok, fail } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';
import { MessagePersister } from '../helpers/message-persister.service';

@Injectable()
export class UserMessagePersistenceStage implements PipelineStage {
  readonly name = 'user-message-persistence';
  private readonly logger = new Logger(UserMessagePersistenceStage.name);

  constructor(private readonly messagePersister: MessagePersister) {}

  async run(ctx: StageContext): Promise<StageResult> {
    if (!ctx.conversation) {
      // ConversationStage didn't run or failed — nothing to anchor against.
      return fail(
        this.name,
        'missing_conversation',
        'UserMessagePersistenceStage requires ctx.conversation to be set.',
      );
    }

    // Skip when there's no message body (templateId-only or attachments-only
    // requests still need a placeholder in the convo, but the legacy method
    // ALWAYS persists, so we mirror that — empty strings are valid content).
    const content = ctx.originalMessage ?? ctx.dto.message ?? '';

    try {
      const persisted = await this.messagePersister.persistUserMessage({
        conversationId: (ctx.conversation as { _id: unknown })._id as
          | string
          | import('mongoose').Types.ObjectId,
        userId: ctx.userId,
        content,
        attachments: ctx.attachments ?? [],
        attachedDocuments: ctx.attachedDocuments ?? [],
        metadata: {
          temperature: ctx.dto.temperature,
          maxTokens: ctx.dto.maxTokens,
        },
      });

      this.logger.debug('User message persisted', {
        requestId: ctx.requestId,
        messageId: persisted.id,
      });

      return ok(
        {
          // Stash the full doc so downstream stages (and the legacy bridge
          // inside processChatRequest) can read `_id`, `createdAt`, etc.
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          ...({ userMessageDoc: persisted.doc, userMessageId: persisted.id } as any),
        },
        persisted.rollback,
      );
    } catch (err) {
      return fail(
        this.name,
        'persist_failed',
        'Failed to persist user message.',
        err,
      );
    }
  }
}
