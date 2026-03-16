import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ConversationMemory,
  ConversationMemoryDocument,
  UserMemory,
  UserMemoryDocument,
  UserPreference,
  UserPreferenceDocument,
} from '../../../schemas/agent/memory.schema';

/**
 * Database service for memory operations to avoid circular dependencies
 */
@Injectable()
export class MemoryDatabaseService {
  constructor(
    @InjectModel(ConversationMemory.name)
    private conversationMemoryModel: Model<ConversationMemoryDocument>,
    @InjectModel(UserMemory.name)
    private userMemoryModel: Model<UserMemoryDocument>,
    @InjectModel(UserPreference.name)
    private userPreferenceModel: Model<UserPreferenceDocument>,
  ) {}

  // Conversation operations
  async findConversations(query: any) {
    return this.conversationMemoryModel
      .find(query)
      .sort({ createdAt: -1 })
      .lean();
  }

  async countConversations(query: any) {
    return this.conversationMemoryModel.countDocuments(query);
  }

  async findOneAndUpdateConversation(
    filter: any,
    update: any,
    options: any = {},
  ) {
    return this.conversationMemoryModel.findOneAndUpdate(filter, update, {
      new: true,
      ...options,
    });
  }

  async findOneAndDeleteConversation(filter: any) {
    return this.conversationMemoryModel.findOneAndDelete(filter).lean();
  }

  // User memory operations
  async findUserMemories(query: any) {
    return this.userMemoryModel
      .find(query)
      .select('-semanticEmbedding -__v')
      .lean()
      .limit(1000);
  }

  // Aggregation operations
  async aggregateConversations(pipeline: any[]) {
    return this.conversationMemoryModel.aggregate(pipeline);
  }

  async aggregateUserMemories(pipeline: any[]) {
    return this.userMemoryModel.aggregate(pipeline);
  }

  async existsUserPreference(query: any) {
    return this.userPreferenceModel.exists(query);
  }
}
