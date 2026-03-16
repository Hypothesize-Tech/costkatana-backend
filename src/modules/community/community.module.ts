import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommunityController } from './community.controller';
import { LiveChatController } from './controllers/live-chat.controller';
import { CommunityService } from './community.service';
import { LiveChatService } from './services/live-chat.service';
import { AdminNotificationService } from './services/admin-notification.service';
import { AiChatAssistantService } from './services/ai-chat-assistant.service';
import { UserModule } from '../user/user.module';
import { SecurityModule } from '../security/security.module';
import { BedrockModule } from '../bedrock/bedrock.module';
import { AuthModule } from '../auth/auth.module';
import { DocsComment, DocsCommentSchema } from './schemas/docs-comment.schema';
import { UserExample, UserExampleSchema } from './schemas/user-example.schema';
import { Discussion, DiscussionSchema } from './schemas/discussion.schema';
import { ChatSession, ChatSessionSchema } from './schemas/chat-session.schema';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';

@Module({
  imports: [
    UserModule,
    SecurityModule,
    BedrockModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: DocsComment.name, schema: DocsCommentSchema },
      { name: UserExample.name, schema: UserExampleSchema },
      { name: Discussion.name, schema: DiscussionSchema },
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
  ],
  controllers: [CommunityController, LiveChatController],
  providers: [
    CommunityService,
    LiveChatService,
    AdminNotificationService,
    AiChatAssistantService,
  ],
  exports: [
    CommunityService,
    LiveChatService,
    AdminNotificationService,
    AiChatAssistantService,
  ],
})
export class CommunityModule {}
