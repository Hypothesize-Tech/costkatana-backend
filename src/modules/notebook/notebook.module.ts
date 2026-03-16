import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';

// Import existing modules
import { CommonModule } from '../../common/common.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { CortexModule } from '../cortex/cortex.module';
import { UtilsModule } from '../utils/utils.module';
import { AuthModule } from '../auth/auth.module';

// Import schemas
import {
  Notebook,
  NotebookSchema,
} from '../../schemas/notebook/notebook.schema';
import {
  NotebookExecution,
  NotebookExecutionSchema,
} from '../../schemas/notebook/notebook-execution.schema';

// Import services
import { CKQLService } from './services/ckql.service';
import { EmbeddingsService } from './services/embeddings.service';
import { AIInsightsService } from './services/ai-insights.service';
import { NotebookService } from './services/notebook.service';

// Import guards
import { AIRateLimitGuard } from './guards/ai-rate-limit.guard';

// Import controller
import { NotebookController } from './notebook.controller';

@Module({
  imports: [
    // HTTP module for external API calls (Bedrock)
    HttpModule,

    // Common module for CacheService
    CommonModule,

    // Schemas module for MongoDB schemas
    SchemasModule,

    // Cortex module for AI routing and advanced AI features
    CortexModule,

    // Utils module for TelemetryService
    UtilsModule,

    // Auth module for JwtAuthGuard
    AuthModule,

    // Mongoose schemas specific to notebook module
    MongooseModule.forFeature([
      { name: Notebook.name, schema: NotebookSchema },
      { name: NotebookExecution.name, schema: NotebookExecutionSchema },
    ]),
  ],
  controllers: [NotebookController],
  providers: [
    // Core notebook services
    NotebookService,
    AIInsightsService,
    CKQLService,
    EmbeddingsService,

    // Guards
    AIRateLimitGuard,
  ],
  exports: [
    // Export services for use by other modules
    NotebookService,
    AIInsightsService,
    CKQLService,
    EmbeddingsService,

    // Export guard for potential use elsewhere
    AIRateLimitGuard,
  ],
})
export class NotebookModule {}
