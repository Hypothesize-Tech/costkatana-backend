/**
 * AssistantMessagePersister
 *
 * Centralised persistence for assistant-side chat messages. The legacy
 * `ChatService.processChatRequest` has 10+ inline `chatMessageModel.create`
 * + `updateConversationAfterMessage` + `chatEventsService.emitMessage`
 * triplets — one per route / handler branch. Each repeats the same shape
 * with minor variation (different agentPath, optimizationsApplied,
 * metadata). This helper consolidates that into one method.
 *
 * Migration plan: each legacy inline block in `processChatRequest`
 * becomes a single call to `persistAssistantMessage`. The branches that
 * have already been migrated read uniform behaviour from here, so a bug
 * fix in one place benefits all paths.
 *
 * The helper does NOT yet plug into a `PersistenceStage` — that would
 * require restructuring every handler branch to RETURN data instead of
 * persisting inline. Doing it incrementally (one branch at a time) is
 * safer than the big-bang refactor.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../../../schemas/chat/chat-message.schema';
import { ChatConversationDocument } from '../../../../schemas/chat/conversation.schema';
import {
  CHAT_MESSAGE_EMITTER,
  type ChatMessageEmitter,
} from './message-persister.service';

export interface PersistAssistantMessageInput {
  conversation: ChatConversationDocument;
  userId: string;
  content: string;
  modelId?: string;
  agentPath?: string[];
  optimizationsApplied?: string[];
  cacheHit?: boolean;
  riskLevel?: string;
  metadata?: Record<string, unknown>;
  /**
   * Extra event-payload fields some legacy branches set on the response
   * (integration data, formattedResult, etc.). Passed through to the
   * emitted event verbatim so SSE consumers see the same shape.
   */
  extraEventFields?: Record<string, unknown>;
}

export interface PersistAssistantMessageResult {
  doc: ChatMessageDocument;
  /** Convenience id; same as doc._id.toString(). */
  id: string;
  /** Pre-built ChatMessageResponse-shaped object for the controller. */
  responsePayload: Record<string, unknown>;
}

@Injectable()
export class AssistantMessagePersister {
  private readonly logger = new Logger(AssistantMessagePersister.name);

  constructor(
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @Inject(CHAT_MESSAGE_EMITTER)
    private readonly emitter: ChatMessageEmitter,
  ) {}

  /**
   * Persist the assistant-side message, bump the conversation's
   * lastMessage / lastMessageAt / messageCount / totalCost, and emit the
   * `chat.message` event for SSE consumers.
   *
   * Returns the created doc + a controller-ready ChatMessageResponse-shaped
   * payload. The caller can layer additional fields on top before sending.
   */
  async persistAssistantMessage(
    input: PersistAssistantMessageInput,
  ): Promise<PersistAssistantMessageResult> {
    const { conversation } = input;
    const created = await this.chatMessageModel.create({
      conversationId: conversation._id,
      userId: input.userId,
      role: 'assistant',
      content: input.content,
      modelId: input.modelId,
      agentPath: input.agentPath ?? [],
      optimizationsApplied: input.optimizationsApplied ?? [],
      cacheHit: input.cacheHit,
      riskLevel: input.riskLevel,
      metadata: input.metadata ?? {},
    });

    // Conversation roll-up — same calculation as the legacy
    // `updateConversationAfterMessage` private helper.
    conversation.messageCount = (conversation.messageCount || 0) + 2; // user + assistant
    conversation.lastMessage = (created.content ?? '').substring(0, 49999);
    conversation.lastMessageAt = (created as { createdAt?: Date }).createdAt;
    conversation.totalCost =
      (conversation.totalCost || 0) +
      (((created.metadata as { cost?: number } | undefined)?.cost ?? 0) || 0);
    await conversation.save();

    const id = created._id.toString();
    const responsePayload: Record<string, unknown> = {
      id,
      messageId: id, // legacy alias for Express-shaped clients
      conversationId: conversation._id.toString(),
      role: 'assistant',
      content: created.content,
      modelId: input.modelId,
      timestamp: (created as { createdAt?: Date }).createdAt,
      agentPath: input.agentPath ?? [],
      optimizationsApplied: input.optimizationsApplied ?? [],
      cacheHit: input.cacheHit,
      riskLevel: input.riskLevel,
      metadata: created.metadata,
      ...(input.extraEventFields ?? {}),
    };

    try {
      this.emitter.emitMessage(
        conversation._id.toString(),
        input.userId,
        responsePayload,
      );
    } catch (err) {
      // Event emission must never block persistence — it's best-effort.
      this.logger.warn('Assistant message emit failed; persistence committed', {
        messageId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { doc: created, id, responsePayload };
  }
}
