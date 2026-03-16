import { Module } from '@nestjs/common';
import { SchemasModule } from '../../schemas/schemas.module';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { VisualComplianceController } from './visual-compliance.controller';
import { VisualComplianceOptimizedService } from './services/visual-compliance-optimized.service';
import { VisualComplianceBedrockService } from './services/visual-compliance-bedrock.service';
import { VisualComplianceS3Service } from './services/visual-compliance-s3.service';
import { MetaPromptPresetsService } from './services/meta-prompt-presets.service';
import { AiCostTrackingService } from './services/ai-cost-tracking.service';
import { BedrockService } from '../../services/bedrock.service';
import { GenAITelemetryService } from '../../utils/genaiTelemetry';

@Module({
  imports: [
    SchemasModule, // provides Optimization, Usage, PromptTemplate models
    CommonModule, // provides LoggerService, CacheService
    AuthModule, // provides JwtAuthGuard dependencies
  ],
  controllers: [VisualComplianceController],
  providers: [
    VisualComplianceOptimizedService,
    VisualComplianceBedrockService,
    VisualComplianceS3Service,
    MetaPromptPresetsService,
    AiCostTrackingService,
    BedrockService,
    GenAITelemetryService,
  ],
  exports: [VisualComplianceOptimizedService], // Export if needed by other modules
})
export class VisualComplianceModule {}
