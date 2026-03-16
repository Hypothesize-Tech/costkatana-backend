import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { SchemasModule } from '../../schemas/schemas.module';
import { CommonModule } from '../../common/common.module';
import { ActivityModule } from '../activity/activity.module';
import { TeamModule } from '../team/team.module';
import { VisualComplianceModule } from '../visual-compliance/visual-compliance.module';
import { ReferenceImageModule } from '../reference-image/reference-image.module';
import { AwsModule } from '../aws/aws.module';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import {
  PromptTemplate,
  PromptTemplateSchema,
} from '../../schemas/prompt/prompt-template.schema';
import {
  TemplateExecution,
  TemplateExecutionSchema,
} from '../../schemas/prompt/template-execution.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';
import { Usage, UsageSchema } from '../../schemas/analytics/usage.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  GeminiCache,
  GeminiCacheSchema,
} from '../../schemas/prompt-template/gemini-cache.schema';
import { PromptTemplateController } from './prompt-template.controller';
import { PromptTemplateService } from './services/prompt-template.service';
import { ModelRecommendationService } from './services/model-recommendation.service';
import { AITemplateEngineService } from './services/ai-template-engine.service';
import { TemplateExecutionService } from './services/template-execution.service';
import { PromptCachingService } from './services/prompt-caching.service';
import { AnthropicPromptCachingService } from './services/providers/anthropic-prompt-caching.service';
import { OpenAIPromptCachingService } from './services/providers/openai-prompt-caching.service';
import { GooglePromptCachingService } from './services/providers/google-prompt-caching.service';

@Module({
  imports: [
    // Core modules
    SchemasModule,
    CommonModule,

    // Feature modules
    ActivityModule,
    TeamModule,
    VisualComplianceModule,
    ReferenceImageModule,
    AwsModule,
    AgentModule,
    AuthModule,

    // Mongoose models
    MongooseModule.forFeature([
      { name: PromptTemplate.name, schema: PromptTemplateSchema },
      { name: TemplateExecution.name, schema: TemplateExecutionSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: User.name, schema: UserSchema },
      { name: GeminiCache.name, schema: GeminiCacheSchema },
    ]),

    // File upload support
    MulterModule.register({
      dest: './uploads/templates',
    }),
  ],
  controllers: [PromptTemplateController],
  providers: [
    PromptTemplateService,
    ModelRecommendationService,
    AITemplateEngineService,
    TemplateExecutionService,
    PromptCachingService,
    AnthropicPromptCachingService,
    OpenAIPromptCachingService,
    GooglePromptCachingService,
  ],
  exports: [
    PromptTemplateService,
    ModelRecommendationService,
    AITemplateEngineService,
    TemplateExecutionService,
    PromptCachingService,
    AnthropicPromptCachingService,
    OpenAIPromptCachingService,
    GooglePromptCachingService,
  ],
})
export class PromptTemplateModule {}
