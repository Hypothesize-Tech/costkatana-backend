import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AIModelPricing,
  AIModelPricingSchema,
} from '../../schemas/ai/ai-model-pricing.schema';
import { UtilsModule } from '../utils/utils.module';
import { PricingModule } from '../pricing/pricing.module';
import { AuthModule } from '../auth/auth.module';
import { ModelDiscoveryController } from './model-discovery.controller';
import { ModelDiscoveryService } from './services/model-discovery.service';
import { ModelDiscoveryFallbackService } from './services/model-discovery-fallback.service';
import { ModelDiscoveryJobService } from './services/model-discovery-job.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AIModelPricing.name, schema: AIModelPricingSchema },
    ]),
    UtilsModule, // For GoogleSearchService
    PricingModule, // For WebScraperService
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [ModelDiscoveryController],
  providers: [
    ModelDiscoveryService,
    ModelDiscoveryFallbackService,
    ModelDiscoveryJobService,
  ],
  exports: [
    ModelDiscoveryService,
    ModelDiscoveryFallbackService,
    ModelDiscoveryJobService,
  ],
})
export class ModelDiscoveryModule {}
