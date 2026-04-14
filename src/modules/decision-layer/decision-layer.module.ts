import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ProactiveSuggestion,
  ProactiveSuggestionSchema,
} from '../../schemas/analytics/proactive-suggestion.schema';
import {
  Activity,
  ActivitySchema,
} from '../../schemas/core/activity.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  CostAnomalyHistory,
  CostAnomalyHistorySchema,
} from '../../schemas/cost/cost-anomaly-history.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  CostChangeExplanation,
  CostChangeExplanationSchema,
} from './schemas/cost-change-explanation.schema';
import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';
import { NotebookModule } from '../notebook/notebook.module';
import { EmailModule } from '../email/email.module';
import { WebhookModule } from '../webhook/webhook.module';
import { ProactiveSuggestionsModule } from '../proactive-suggestions/proactive-suggestions.module';
import { CostChangeExplainerService } from './services/cost-change-explainer.service';
import { TopActionService } from './services/top-action.service';
import { DecisionDigestService } from './services/decision-digest.service';
import { SlackNotifierService } from './services/slack-notifier.service';
import { ProofMomentsService } from './services/proof-moments.service';
import { DecisionLayerController } from './decision-layer.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: ProactiveSuggestion.name, schema: ProactiveSuggestionSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: Usage.name, schema: UsageSchema },
      { name: CostAnomalyHistory.name, schema: CostAnomalyHistorySchema },
      { name: User.name, schema: UserSchema },
      {
        name: CostChangeExplanation.name,
        schema: CostChangeExplanationSchema,
      },
    ]),
    AuthModule,
    BudgetModule,
    NotebookModule,
    EmailModule,
    WebhookModule,
    ProactiveSuggestionsModule,
  ],
  controllers: [DecisionLayerController],
  providers: [
    CostChangeExplainerService,
    TopActionService,
    DecisionDigestService,
    SlackNotifierService,
    ProofMomentsService,
  ],
  exports: [
    CostChangeExplainerService,
    TopActionService,
    DecisionDigestService,
    SlackNotifierService,
    ProofMomentsService,
  ],
})
export class DecisionLayerModule {}
