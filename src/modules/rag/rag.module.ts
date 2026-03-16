import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';

// Orchestrator
import { ModularRAGOrchestrator } from './orchestrator/modular-rag.orchestrator';

// Patterns
import { NaivePattern } from './patterns/naive.pattern';
import { RecursivePattern } from './patterns/recursive.pattern';
import { IterativePattern } from './patterns/iterative.pattern';
import { AdaptivePattern } from './patterns/adaptive.pattern';

// Modules
import { RetrieveModule } from './modules/retrieve.module';
import { RewriteModule } from './modules/rewrite.module';
import { RoutingModule } from './modules/routing.module';
import { MemoryModule } from './modules/memory.module';
import { DemonstrateModule } from './modules/demonstrate.module';
import { PredictModule } from './modules/predict.module';
import { RerankModule } from './modules/rerank.module';
import { ReadModule } from './modules/read.module';
import { FusionModule } from './modules/fusion.module';

// Evaluation
import { RAGEvaluationService } from './evaluation/metrics';

// Benchmark
import { RagBenchmarkService } from './rag-benchmark.service';

// Service Locator
import { RagServiceLocator } from './rag-service-locator';
import { RagLocatorRegistrationService } from './rag-locator-registration.service';

// Schemas
import {
  RAGExample,
  RAGExampleSchema,
} from '../../schemas/rag/rag-example.schema';

// External dependencies (forwardRef to break circular dependency with AgentModule)
import { AgentModule } from '../agent/agent.module'; // For VectorStoreService
import { BedrockModule } from '../bedrock/bedrock.module'; // For LLM services
import { Logger } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import {
  resolveRedisUrl,
  getRedisOptions,
  isRedisEnabled,
} from '../../config/redis';

const ragRedisLogger = new Logger('RagModule');

/** In-memory mock Redis for when Redis is unavailable (get/set/del only). */
function createMockRagRedis(): Redis {
  const map = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(map.get(key) ?? null),
    set: (key: string, value: string) => {
      map.set(key, value);
      return Promise.resolve('OK');
    },
    del: (...keys: string[]) => {
      let n = 0;
      for (const k of keys) {
        if (map.delete(k)) n++;
      }
      return Promise.resolve(n);
    },
    quit: () => Promise.resolve(),
    on: () => ({}) as Redis,
    status: 'ready',
  } as unknown as Redis;
}

@Module({
  imports: [
    HttpModule,
    forwardRef(() => AgentModule), // For VectorStoreService – forwardRef breaks AgentModule ↔ RagModule cycle
    BedrockModule, // For LLM services

    // Mongoose schemas
    MongooseModule.forFeature([
      { name: RAGExample.name, schema: RAGExampleSchema },
    ]),
  ],
  providers: [
    // Redis client for MemoryModule (conversation memory). If Redis disabled or config fails, use in-memory mock.
    {
      provide: 'REDIS_CLIENT',
      useFactory: (): Redis => {
        if (!isRedisEnabled()) {
          ragRedisLogger.log(
            'Redis disabled - RAG memory using in-memory fallback',
          );
          return createMockRagRedis();
        }
        try {
          const client = new Redis(
            resolveRedisUrl(),
            getRedisOptions() as RedisOptions,
          );
          client.on('error', (err: Error) => {
            ragRedisLogger.warn(
              `Redis error (RAG memory may use in-memory fallback): ${err?.message ?? err}`,
            );
          });
          return client;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          ragRedisLogger.warn(
            `Redis unavailable for RAG memory, using in-memory fallback: ${msg}`,
          );
          return createMockRagRedis();
        }
      },
    },
    // Orchestrator
    ModularRAGOrchestrator,

    // Patterns
    NaivePattern,
    RecursivePattern,
    IterativePattern,
    AdaptivePattern,

    // Modules
    RetrieveModule,
    RewriteModule,
    RoutingModule,
    MemoryModule,
    DemonstrateModule,
    PredictModule,
    RerankModule,
    ReadModule,
    FusionModule,

    // Evaluation
    RAGEvaluationService,

    // Benchmark
    RagBenchmarkService,

    // Service Locator
    RagServiceLocator,
    RagLocatorRegistrationService,
  ],
  exports: [
    ModularRAGOrchestrator,
    RAGEvaluationService,
    RagBenchmarkService,
    RagServiceLocator,
  ],
})
export class RagModule {}
