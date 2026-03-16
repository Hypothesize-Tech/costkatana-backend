import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { WebhookModule } from '../webhook/webhook.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Budget Module (NestJS)
 *
 * Provides budget status API: overall and per-project usage, alerts, recommendations.
 * Full parity with Express budget.controller and budget.routes.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
    WebhookModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [BudgetController],
  providers: [BudgetService],
  exports: [BudgetService],
})
export class BudgetModule {}
