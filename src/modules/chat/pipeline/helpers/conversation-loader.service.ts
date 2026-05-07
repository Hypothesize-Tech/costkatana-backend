/**
 * Loads or creates a chat conversation. Extracted from
 * `ChatService.getOrCreateConversation` so the pipeline's `ConversationStage`
 * can call it without a forwardRef-ed dependency on ChatService.
 *
 * Same semantics as the legacy method:
 *  - If `dto.conversationId` is set, find the matching `(_id, userId)` doc
 *    or throw "Conversation not found".
 *  - Otherwise create a new conversation with a title derived from the
 *    first message (or "New Chat" when no message body).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatConversationDocument } from '../../../../schemas/chat/conversation.schema';
import { SendMessageDto } from '../../dto/send-message.dto';

@Injectable()
export class ConversationLoader {
  constructor(
    @InjectModel('ChatConversation')
    private readonly conversationModel: Model<ChatConversationDocument>,
  ) {}

  async loadOrCreate(
    userId: string,
    dto: SendMessageDto,
  ): Promise<ChatConversationDocument> {
    if (dto.conversationId) {
      const existing = await this.conversationModel.findOne({
        _id: dto.conversationId,
        userId,
      });
      if (!existing) throw new NotFoundException('Conversation not found');
      return existing;
    }

    const title = dto.message
      ? this.simpleTitle(dto.message)
      : 'New Chat';

    return this.conversationModel.create({
      userId,
      title,
      modelId: dto.modelId,
    });
  }

  /**
   * Title from the first ~50 chars of the first message — same heuristic as
   * the legacy `generateSimpleTitle`. Kept inline so this helper has zero
   * other deps.
   */
  private simpleTitle(message: string): string {
    const trimmed = message.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= 50) return trimmed || 'New Chat';
    return trimmed.slice(0, 47) + '…';
  }
}
