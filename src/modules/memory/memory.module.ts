import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  UserMemory,
  UserMemorySchema,
  ConversationMemory,
  ConversationMemorySchema,
  UserPreference,
  UserPreferenceSchema,
  MemoryAnalytics,
  MemoryAnalyticsSchema,
} from '../../schemas/agent/memory.schema';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../../schemas/chat/chat-message.schema';
import { MemoryController } from './memory.controller';
import { MemoryService } from './services/memory.service';
import { UserPreferenceService } from './services/user-preference.service';
import { VectorMemoryService } from './services/vector-memory.service';
import { MemoryDatabaseService } from './services/memory-database.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: UserMemory.name, schema: UserMemorySchema },
      { name: ConversationMemory.name, schema: ConversationMemorySchema },
      { name: UserPreference.name, schema: UserPreferenceSchema },
      { name: MemoryAnalytics.name, schema: MemoryAnalyticsSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
  ],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    UserPreferenceService,
    VectorMemoryService,
    MemoryDatabaseService,
  ],
  exports: [MemoryService, UserPreferenceService, VectorMemoryService],
})
export class MemoryModule {}
