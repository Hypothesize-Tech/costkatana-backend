import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { isRedisEnabled } from '../../config/redis';
import { JobsController } from './controllers/jobs.controller';
import { JobsService } from './services/jobs.service';
import { PerformanceAggregationJob } from './jobs/performance-aggregation.job';
import { SemanticClusteringJob } from './jobs/semantic-clustering.job';
import { GlobalBenchmarkUpdateJob } from './jobs/global-benchmark-update.job';
import { LearningLoopProcessorJob } from './jobs/learning-loop-processor.job';
import { ModelDiscoveryJob } from './jobs/model-discovery.job';
import { VectorizationJob } from './jobs/vectorization.job';
import { VectorMaintenanceJob } from './jobs/vector-maintenance.job';
import { DeadLetterQueue } from './queues/dead-letter.queue';
import { ReindexQueue } from './queues/reindex.queue';

// Import required services
import { DataNetworkEffectsModule } from '../data-network-effects/data-network-effects.module';
import { EmailModule } from '../email/email.module';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AccountClosureModule } from '../account-closure/account-closure.module';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  VectorizationDocument,
  VectorizationDocumentSchema,
} from '../../schemas/vectorization/vectorization-document.schema';
import {
  DeadLetterJob,
  DeadLetterJobSchema,
} from '../../schemas/core/dead-letter-job.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';

@Module({
  imports: [
    // Enable HTTP client for API calls
    HttpModule,

    // Enable scheduling
    ScheduleModule.forRoot(),

    // Bull queues (lazyConnect so Redis failure does not block app/MongoDB startup)
    // When Redis is disabled, use localhost to avoid connecting to unreachable AWS ElastiCache
    BullModule.forRoot({
      redis: isRedisEnabled()
        ? {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
            db: parseInt(process.env.REDIS_DB || '0'),
            lazyConnect: true, // do not connect at startup; connect on first use
            maxRetriesPerRequest: 3,
            retryStrategy: (times: number) =>
              times <= 3 ? Math.min(times * 500, 2000) : null,
          }
        : {
            host: '127.0.0.1',
            port: 6379,
            lazyConnect: true,
            connectTimeout: 100,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null, // no retries when Redis disabled
          },
    }),

    // Register queues
    BullModule.registerQueue({ name: 'dead-letter' }, { name: 'reindex' }),

    // Import required modules
    forwardRef(() => DataNetworkEffectsModule),
    EmailModule,
    GuardrailsModule,
    SubscriptionModule,
    AccountClosureModule,
    AuthModule,

    // Import User schema
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      {
        name: VectorizationDocument.name,
        schema: VectorizationDocumentSchema,
      },
      { name: DeadLetterJob.name, schema: DeadLetterJobSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    PerformanceAggregationJob,
    SemanticClusteringJob,
    GlobalBenchmarkUpdateJob,
    LearningLoopProcessorJob,
    ModelDiscoveryJob,
    VectorizationJob,
    VectorMaintenanceJob,
    DeadLetterQueue,
    ReindexQueue,
  ],
  exports: [
    JobsService,
    PerformanceAggregationJob,
    SemanticClusteringJob,
    GlobalBenchmarkUpdateJob,
    LearningLoopProcessorJob,
    ModelDiscoveryJob,
    VectorizationJob,
    VectorMaintenanceJob,
  ],
})
export class JobsModule {}
