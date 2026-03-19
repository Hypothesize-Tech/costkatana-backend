import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import {
  AIModelPricing,
  AIModelPricingSchema,
} from '../../schemas/ai/ai-model-pricing.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { GenAITelemetryService } from '@/utils/genaiTelemetry';
import { BedrockService } from '@/modules/bedrock/bedrock.service';

// Controllers
import { PricingController } from './pricing.controller';
import { PricingComparisonController } from './pricing-comparison.controller';
import { PricingRealtimeController } from './pricing-realtime.controller';

// Services
import { PricingRegistryService } from './services/pricing-registry.service';
import { RealtimePricingService } from './services/realtime-pricing.service';
import { WebScraperService } from './services/web-scraper.service';

/**
 * Pricing Module
 *
 * Provides comprehensive AI model pricing functionality including:
 * - Cost calculations and analysis
 * - Model comparisons and benchmarks
 * - Real-time pricing updates
 * - Web scraping for pricing data
 *
 * This module integrates with the AIModelPricing schema and provides
 * RESTful endpoints for pricing operations.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => require('../utils/utils.module').UtilsModule), // Lazy require breaks cycle
    // Register AIModelPricing schema for MongoDB operations
    MongooseModule.forFeature([
      { name: AIModelPricing.name, schema: AIModelPricingSchema },
      { name: Usage.name, schema: UsageSchema },
    ]),
  ],
  controllers: [
    PricingController,
    PricingComparisonController,
    PricingRealtimeController,
  ],
  providers: [
    GenAITelemetryService,
    BedrockService,
    PricingRegistryService,
    RealtimePricingService,
    WebScraperService,
  ],
  exports: [PricingRegistryService, RealtimePricingService, WebScraperService],
})
export class PricingModule {}
