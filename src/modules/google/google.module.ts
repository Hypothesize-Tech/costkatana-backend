import { Module } from '@nestjs/common';
import { SchemasModule } from '../../schemas/schemas.module';
import { OAuthModule } from '../oauth/oauth.module';
import { AuthModule } from '../auth/auth.module';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';
import { GoogleExportIntegrationService } from './google-export-integration.service';
import { GoogleCommandService } from './google-command.service';

@Module({
  imports: [
    SchemasModule,
    OAuthModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [GoogleController],
  providers: [
    GoogleService,
    GoogleExportIntegrationService,
    GoogleCommandService,
  ],
  exports: [
    GoogleService,
    GoogleExportIntegrationService,
    GoogleCommandService,
  ],
})
export class GoogleModule {}
