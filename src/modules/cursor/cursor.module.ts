import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CursorController } from './controllers/cursor.controller';
import { CursorService } from './services/cursor.service';

// Import required modules for dependencies
import { AdminAiCostMonitoringModule } from '../admin-ai-cost-monitoring/admin-ai-cost-monitoring.module';
import { UsageModule } from '../usage/usage.module';
import { ProactiveSuggestionsModule } from '../proactive-suggestions/proactive-suggestions.module';
import { AuthModule } from '../auth/auth.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import {
  Workspace,
  WorkspaceSchema,
} from '../../schemas/user/workspace.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
    forwardRef(() => AdminAiCostMonitoringModule),
    forwardRef(() => UsageModule),
    forwardRef(() => ProactiveSuggestionsModule),
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
    OnboardingModule, // MagicLinkService for secure magic link generation
  ],
  controllers: [CursorController],
  providers: [CursorService],
  exports: [CursorService],
})
export class CursorModule {}
