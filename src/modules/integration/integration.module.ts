import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import {
  Integration,
  IntegrationSchema,
} from '../../schemas/integration/integration.schema';
import { Alert, AlertSchema } from '../../schemas/core/alert.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  GitHubConnection,
  GitHubConnectionSchema,
} from '../../schemas/integration/github-connection.schema';
import {
  GoogleConnection,
  GoogleConnectionSchema,
} from '../../schemas/integration/google-connection.schema';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { NotificationService } from './notification.service';
import { SlackService } from './services/slack.service';
import { DiscordService } from './services/discord.service';
import { LinearService } from './services/linear.service';
import { JiraService } from './services/jira.service';
import { GitHubService } from './services/github.service';
import { GoogleService } from './services/google.service';
import { CapabilityRouterService } from './services/capability-router.service';
import { IntegrationIntentRecognitionService } from './services/integration-intent-recognition.service';
import { IntegrationMcpMapperService } from './services/integration-mcp-mapper.service';
import { IntegrationObservabilityService } from './services/integration-observability.service';
import { IntegrationOptionProviderService } from './services/integration-option-provider.service';
import { IntegrationPrivacyService } from './services/integration-privacy.service';
import { IntegrationAccessControlService } from './services/integration-access-control.service';
import { IntegrationAgentService } from './services/integration-agent.service';
import { UtilsModule } from '../utils/utils.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    HttpModule,
    UtilsModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: Integration.name, schema: IntegrationSchema },
      { name: Alert.name, schema: AlertSchema },
      { name: User.name, schema: UserSchema },
      { name: GitHubConnection.name, schema: GitHubConnectionSchema },
      { name: GoogleConnection.name, schema: GoogleConnectionSchema },
    ]),
  ],
  controllers: [IntegrationController],
  providers: [
    IntegrationService,
    NotificationService,
    SlackService,
    DiscordService,
    LinearService,
    JiraService,
    GitHubService,
    GoogleService,
    CapabilityRouterService,
    IntegrationIntentRecognitionService,
    IntegrationMcpMapperService,
    IntegrationObservabilityService,
    IntegrationOptionProviderService,
    IntegrationPrivacyService,
    IntegrationAccessControlService,
    IntegrationAgentService,
  ],
  exports: [
    IntegrationService,
    NotificationService,
    SlackService,
    DiscordService,
    LinearService,
    JiraService,
    GitHubService,
    GoogleService,
    CapabilityRouterService,
    IntegrationIntentRecognitionService,
    IntegrationMcpMapperService,
    IntegrationObservabilityService,
    IntegrationOptionProviderService,
    IntegrationPrivacyService,
    IntegrationAccessControlService,
    IntegrationAgentService,
  ],
})
export class IntegrationModule {}
