/**
 * MessagePersister
 *
 * Owns the user-message persistence step that the legacy
 * `ChatService.processChatRequest` performs inline. Extracted so the
 * pipeline's `UserMessagePersistenceStage` can run it before route
 * dispatch and roll it back if a downstream stage fails — closing the
 * "half-write" hole the legacy method has today.
 *
 * Behaviour mirrors the legacy block exactly:
 *   1. Open a Mongo session.
 *   2. Within `withTransaction`:
 *        a. Create the message via `chatMessageModel.create([...], { session })`.
 *        b. Emit a real-time `chat.message` event with the persisted shape.
 *   3. End the session.
 *   4. Return the unwrapped doc plus a rollback that hard-deletes the doc
 *      if the orchestrator decides to compensate.
 *
 * The rollback intentionally fires a Mongo `deleteOne` (not a soft-delete
 * flag) — the message was never visible to the user via the read API
 * because no event consumer should have processed it yet (rollback is
 * triggered before the response goes back to the controller).
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../../../schemas/chat/chat-message.schema';

/**
 * Structural contract for the chat events emitter. Same indirection trick
 * we use elsewhere — keeps this helper unit-testable without dragging the
 * full events factory transitive chain.
 */
export interface ChatMessageEmitter {
  emitMessage(chatId: string, userId: string, message: unknown): void;
}

export const CHAT_MESSAGE_EMITTER = Symbol('CHAT_MESSAGE_EMITTER');

export interface PersistUserMessageInput {
  conversationId: Types.ObjectId | string;
  userId: string;
  content: string;
  attachments?: any[];
  attachedDocuments?: any[];
  metadata?: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  };
}

export interface PersistedUserMessage {
  /** The full Mongo document. Downstream code reads `_id`, `createdAt`, etc. */
  doc: ChatMessageDocument;
  /** Convenience string id; same as `doc._id.toString()`. */
  id: string;
  /** Compensating action — call to remove the persisted message. */
  rollback: () => Promise<void>;
}

@Injectable()
export class MessagePersister {
  private readonly logger = new Logger(MessagePersister.name);

  constructor(
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @Inject(CHAT_MESSAGE_EMITTER)
    private readonly emitter: ChatMessageEmitter,
  ) {}

  async persistUserMessage(
    input: PersistUserMessageInput,
  ): Promise<PersistedUserMessage> {
    const session = await this.chatMessageModel.startSession();
    let createdDoc: ChatMessageDocument | undefined;
    try {
      await session.withTransaction(async () => {
        const created = await this.chatMessageModel.create(
          [
            {
              conversationId: input.conversationId,
              userId: input.userId,
              role: 'user',
              content: input.content,
              attachments: input.attachments ?? [],
              attachedDocuments: input.attachedDocuments ?? [],
              metadata: {
                temperature: input.metadata?.temperature,
                maxTokens: input.metadata?.maxTokens,
                ...input.metadata,
              },
            },
          ],
          { session },
        );
        createdDoc = created[0];
        // `create([...])` returns an array; if the array is empty we have no
        // doc to emit (extremely unusual but defensive). The post-transaction
        // check below converts this into a clear error.
        if (!createdDoc) return;

        // Emit the same payload shape the legacy code did — downstream SSE
        // consumers depend on this exact structure.
        this.emitter.emitMessage(
          input.conversationId.toString(),
          input.userId,
          {
            id: createdDoc._id.toString(),
            conversationId: input.conversationId.toString(),
            role: 'user',
            content: input.content,
            timestamp: (createdDoc as { createdAt?: Date }).createdAt,
            attachments: input.attachments ?? [],
            attachedDocuments: input.attachedDocuments ?? [],
            metadata: createdDoc.metadata,
          },
        );
      });
    } finally {
      await session.endSession();
    }

    if (!createdDoc) {
      throw new Error('User message creation failed silently');
    }
    const id = createdDoc._id.toString();
    const messageModel = this.chatMessageModel;
    const log = this.logger;
    return {
      doc: createdDoc,
      id,
      rollback: async () => {
        try {
          await messageModel.deleteOne({ _id: createdDoc!._id });
          log.warn('Rolled back user message persistence', {
            messageId: id,
          });
        } catch (err) {
          log.error('Failed to roll back user message', {
            messageId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    };
  }
}
