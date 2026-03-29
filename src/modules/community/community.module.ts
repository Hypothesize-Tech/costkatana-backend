import { Module } from '@nestjs/common';
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
import { SchemasModule } from '../../schemas/schemas.module';

@Module({
  imports: [
    UserModule,
    SecurityModule,
    BedrockModule,
    AuthModule,
    SchemasModule,
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
