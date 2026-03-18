/**
 * Ingestion Module
 * Provides document ingestion, processing, and vector storage capabilities
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageModule } from '../storage/storage.module';
import { BedrockModule } from '../bedrock/bedrock.module';
import { AuthModule } from '../auth/auth.module';
import { UsageModule } from '../usage/usage.module';

// Schemas
import {
  Document,
  DocumentSchema,
} from '../../schemas/document/document.schema';
import {
  Conversation,
  ConversationSchema,
} from '../../schemas/chat/conversation.schema';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../../schemas/chat/chat-message.schema';
import {
  Telemetry,
  TelemetrySchema,
} from '../../schemas/core/telemetry.schema';
import {
  UserBehaviorPattern,
  UserBehaviorPatternSchema,
} from '../../schemas/recommendation/user-behavior-pattern.schema';
import {
  AIRecommendation,
  AIRecommendationSchema,
} from '../../schemas/recommendation/ai-recommendation.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';

// Controllers
import { IngestionController } from './ingestion.controller';

// Services
import { IngestionService } from './services/ingestion.service';
import { DocumentProcessorService } from './services/document-processor.service';
import { SafeBedrockEmbeddingsService } from './services/safe-bedrock-embeddings.service';
import { MetadataEnrichmentService } from './services/metadata-enrichment.service';
import { LangchainVectorStoreService } from './services/langchain-vector-store.service';
import { FaissVectorService } from './services/faiss-vector.service';
import { VectorStrategyService } from './services/vector-strategy.service';
import { VectorWriteQueueService } from './services/vector-write-queue.service';
import { VectorHealthService } from './services/vector-health.service';
import { VectorRecoveryService } from './services/vector-recovery.service';

// Search and retrieval services
import { HybridSearchService } from './services/hybrid-search.service';
import { IntelligentSearchStrategyService } from './services/intelligent-search-strategy.service';
import { ExactSearchService } from './services/exact-search.service';
import { SparseSearchService } from './services/sparse-search.service';
import { FallbackVectorStoreService } from './services/fallback-vector-store.service';
import { RerankerService } from './services/reranker.service';
import { SemanticCacheService } from './services/semantic-cache.service';

// Model intelligence services
import { ModelRegistryService } from './services/model-registry.service';
import { ModelCapabilityRegistryService } from './services/model-capability-registry.service';
import { AutoRecommendationAgentService } from './services/auto-recommendation-agent.service';
import { IntelligentRouterService } from './services/intelligent-router.service';

@Module({
  imports: [
    CacheModule.register() as DynamicModule,
    // External modules
    StorageModule,
    BedrockModule,
    AuthModule,
    UsageModule,

    // Mongoose schemas for database operations
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: Telemetry.name, schema: TelemetrySchema },
      { name: UserBehaviorPattern.name, schema: UserBehaviorPatternSchema },
      { name: AIRecommendation.name, schema: AIRecommendationSchema },
      { name: Usage.name, schema: UsageSchema },
    ]),
  ],
  controllers: [IngestionController],
  providers: [
    // Core ingestion services
    IngestionService,
    DocumentProcessorService,

    // AI/ML services
    SafeBedrockEmbeddingsService,
    MetadataEnrichmentService,

    // Vector storage services
    LangchainVectorStoreService,
    FaissVectorService,
    VectorStrategyService,
    VectorWriteQueueService,
    VectorHealthService,
    VectorRecoveryService,

    // Search and retrieval services
    HybridSearchService,
    IntelligentSearchStrategyService,
    ExactSearchService,
    SparseSearchService,
    FallbackVectorStoreService,
    RerankerService,
    SemanticCacheService,

    // Model intelligence services
    ModelRegistryService,
    ModelCapabilityRegistryService,
    AutoRecommendationAgentService,
    IntelligentRouterService,
  ],
  exports: [
    // Export services that other modules might need
    IngestionService,
    DocumentProcessorService,
    VectorStrategyService,
    LangchainVectorStoreService,
    FaissVectorService,
    VectorWriteQueueService,
    VectorHealthService,
    VectorRecoveryService,
    MetadataEnrichmentService,

    // Export search and retrieval services
    HybridSearchService,
    IntelligentSearchStrategyService,
    ExactSearchService,
    SparseSearchService,
    FallbackVectorStoreService,
    RerankerService,
    SemanticCacheService,

    // Export model intelligence services
    ModelRegistryService,
    ModelCapabilityRegistryService,
    AutoRecommendationAgentService,
    IntelligentRouterService,
  ],
})
export class IngestionModule {}
