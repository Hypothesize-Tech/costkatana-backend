import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CommonModule } from '../../common/common.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { AuthModule } from '../auth/auth.module';
import { McpModule } from '../mcp/mcp.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TeamModule } from '../team/team.module';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { GitHubIntegrationService } from './github-integration.service';
import { GoogleIntegrationService } from './google-integration.service';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => CommonModule),
    SchemasModule,
    AuthModule,
    McpModule,
    SubscriptionModule,
    TeamModule,
  ],
  controllers: [OAuthController],
  providers: [OAuthService, GitHubIntegrationService, GoogleIntegrationService],
  exports: [OAuthService],
})
export class OAuthModule {}
