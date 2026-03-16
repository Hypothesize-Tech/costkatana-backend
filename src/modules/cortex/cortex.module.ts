/**
 * Cortex Module (NestJS)
 *
 * Main module that orchestrates all Cortex-related services and functionality.
 * Provides comprehensive AI optimization capabilities including semantic processing,
 * caching, hybrid execution, and advanced AI routing.
 */

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';

// Schemas
import {
  CortexTrainingData,
  CortexTrainingDataSchema,
} from '../../schemas/core/cortex-training-data.schema';
import {
  ContinuityCheckpoint,
  ContinuityCheckpointSchema,
} from '../../schemas/cortex/continuity-checkpoint.schema';
import {
  LearnedPrimitive,
  LearnedPrimitiveSchema,
} from '../../schemas/cortex/learned-primitive.schema';

// Services
import { CortexService } from './services/cortex.service';
import { CortexCoreService } from './services/cortex-core.service';
import { CortexEncoderService } from './services/cortex-encoder.service';
import { CortexDecoderService } from './services/cortex-decoder.service';
import { CortexVocabularyService } from './services/cortex-vocabulary.service';
import { CortexCacheService } from './services/cortex-cache.service';
import { CortexLispInstructionGeneratorService } from './services/cortex-lisp-instruction-generator.service';
import { AIRouterService } from './services/ai-router.service';
import { CortexModelRouterService } from './services/cortex-model-router.service';
import { CortexSchemaValidatorService } from './services/cortex-schema-validator.service';
import { CortexAnalyticsService } from './services/cortex-analytics.service';
import { CortexContextManagerService } from './services/cortex-context-manager.service';
import { CortexControlFlowService } from './services/cortex-control-flow.service';
import { CortexHybridEngineService } from './services/cortex-hybrid-engine.service';
import { CortexBinarySerializerService } from './services/cortex-binary-serializer.service';
import { CortexFragmentCacheService } from './services/cortex-fragment-cache.service';
import { CortexStreamingOrchestratorService } from './services/cortex-streaming-orchestrator.service';
import { CortexStreamingLoggerService } from './services/cortex-streaming-logger.service';
import { CortexContinuityService } from './services/cortex-continuity.service';
import { CortexLongHandshakeService } from './services/cortex-long-handshake.service';
import { CortexTrainingDataCollectorService } from './services/cortex-training-data-collector.service';
import { CortexTrainingDataStoreService } from './services/cortex-training-data-store.service';
import { CortexTrainingDataPersistenceService } from './services/cortex-training-data-persistence.service';
import { CortexRelayService } from './services/cortex-relay.service';
import { CortexPrimitiveLearnerService } from './services/cortex-primitive-learner.service';

// Utils
import { UtilsModule } from '../utils/utils.module';
import { CompilerModule } from '../compiler/compiler.module';
import { BedrockModule } from '../bedrock/bedrock.module';
import { PricingModule } from '../pricing/pricing.module';
import { AuthModule } from '../auth/auth.module';
import { CortexTrainingDataController } from './cortex-training-data.controller';
import { CortexStreamingController } from './cortex-streaming.controller';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => UtilsModule),
    CompilerModule,
    BedrockModule,
    PricingModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: CortexTrainingData.name, schema: CortexTrainingDataSchema },
      { name: ContinuityCheckpoint.name, schema: ContinuityCheckpointSchema },
      { name: LearnedPrimitive.name, schema: LearnedPrimitiveSchema },
    ]),
  ],
  controllers: [CortexTrainingDataController, CortexStreamingController],
  providers: [
    // Main Cortex Service
    CortexService,

    // Core Cortex Services
    CortexCoreService,
    CortexEncoderService,
    CortexDecoderService,
    CortexVocabularyService,
    CortexCacheService,
    CortexLispInstructionGeneratorService,
    AIRouterService,

    // Advanced Cortex Services
    CortexModelRouterService,
    CortexSchemaValidatorService,
    CortexAnalyticsService,
    CortexContextManagerService,
    CortexControlFlowService,
    CortexHybridEngineService,
    CortexBinarySerializerService,
    CortexFragmentCacheService,

    // Streaming Services
    CortexStreamingOrchestratorService,
    CortexStreamingLoggerService,
    CortexContinuityService,
    CortexLongHandshakeService,
    CortexTrainingDataCollectorService,
    CortexTrainingDataStoreService,
    CortexTrainingDataPersistenceService,
    CortexRelayService,
    CortexPrimitiveLearnerService,
  ],
  exports: [
    // Main Cortex Service
    CortexService,

    // Export all services for use by other modules
    CortexCoreService,
    CortexEncoderService,
    CortexDecoderService,
    CortexVocabularyService,
    CortexCacheService,
    CortexLispInstructionGeneratorService,
    AIRouterService,
    CortexModelRouterService,
    CortexSchemaValidatorService,
    CortexAnalyticsService,
    CortexContextManagerService,
    CortexControlFlowService,
    CortexHybridEngineService,
    CortexBinarySerializerService,
    CortexFragmentCacheService,
    CortexStreamingOrchestratorService,
    CortexStreamingLoggerService,
    CortexContinuityService,
    CortexLongHandshakeService,
    CortexTrainingDataCollectorService,
    CortexTrainingDataStoreService,
    CortexTrainingDataPersistenceService,
    CortexRelayService,
    CortexPrimitiveLearnerService,
  ],
})
export class CortexModule {}
