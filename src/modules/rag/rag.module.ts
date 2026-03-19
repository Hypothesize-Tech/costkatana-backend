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

const RAG_MOCK_REDIS_MAX_ENTRIES = 10_000;
const RAG_MOCK_REDIS_TTL_MS = 3600_000; // 1 hour

/** In-memory mock Redis for when Redis is unavailable (get/set/del only). Used as fallback in all envs when Redis fails. */
function createMockRagRedis(): Redis {
  const map = new Map<string, string>();
  const expiryMap = new Map<string, number>();

  const evictIfNeeded = () => {
    const now = Date.now();
    for (const [k, exp] of Array.from(expiryMap.entries())) {
      if (exp < now) {
        map.delete(k);
        expiryMap.delete(k);
      }
    }
    while (map.size > RAG_MOCK_REDIS_MAX_ENTRIES && map.size > 0) {
      const first = map.keys().next().value;
      if (first) {
        map.delete(first);
        expiryMap.delete(first);
      }
    }
  };

  return {
    get: (key: string) => {
      const exp = expiryMap.get(key);
      if (exp !== undefined && exp < Date.now()) {
        map.delete(key);
        expiryMap.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(map.get(key) ?? null);
    },
    set: (key: string, value: string) => {
      map.set(key, value);
      expiryMap.set(key, Date.now() + RAG_MOCK_REDIS_TTL_MS);
      evictIfNeeded();
      return Promise.resolve('OK');
    },
    del: (...keys: string[]) => {
      let n = 0;
      for (const k of keys) {
        if (map.delete(k)) {
          expiryMap.delete(k);
          n++;
        }
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
    // Redis client for MemoryModule (conversation memory). If Redis disabled or connection fails, use in-memory fallback.
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (): Promise<Redis> => {
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
              `Redis error (RAG memory): ${err?.message ?? err}`,
            );
          });
          await client.ping();
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
