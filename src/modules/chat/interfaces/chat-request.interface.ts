import { AttachmentDto } from '../dto/send-message.dto';

export interface ChatSendMessageRequest {
  message?: string;
  modelId: string;
  conversationId?: string;
  temperature?: number;
  maxTokens?: number;
  attachments?: AttachmentDto[];
  templateId?: string;
  templateVariables?: Record<string, any>;
  documentIds?: string[];
}

export interface ChatSendMessageResponse {
  success: boolean;
  data: {
    messageId: string;
    conversationId: string;
    response: string;
    modelUsed: string;
    tokensUsed: number;
    cost: number;
    attachments?: AttachmentDto[];
    metadata?: Record<string, any>;
  };
  message: string;
}

export interface ConversationListResponse {
  success: boolean;
  data: {
    conversations: Array<{
      id: string;
      title: string;
      modelId: string;
      messageCount: number;
      totalCost: number;
      lastMessage: string;
      lastMessageAt: Date;
      isActive: boolean;
      isPinned: boolean;
      isArchived: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
}

export interface ConversationHistoryResponse {
  success: boolean;
  data: {
    conversation: {
      id: string;
      title: string;
      modelId: string;
    };
    messages: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      modelId?: string;
      tokensUsed?: number;
      cost?: number;
      attachments?: AttachmentDto[];
      metadata?: Record<string, any>;
      createdAt: Date;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
}

export interface AvailableModelsResponse {
  success: boolean;
  data: {
    models: Array<{
      id: string;
      name: string;
      provider: string;
      contextLength: number;
      costPerToken: number;
      capabilities: string[];
      isAvailable: boolean;
    }>;
  };
}
