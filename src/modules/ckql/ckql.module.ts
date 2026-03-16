import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotebookModule } from '../notebook/notebook.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { CkqlController } from './ckql.controller';
import { CkqlAiRateLimitGuard } from './guards/ckql-ai-rate-limit.guard';
import { TelemetryVectorizationService } from './services/telemetry-vectorization.service';
import { CostNarrativesService } from './services/cost-narratives.service';

@Module({
  imports: [AuthModule, NotebookModule, SchemasModule],
  controllers: [CkqlController],
  providers: [
    CkqlAiRateLimitGuard,
    TelemetryVectorizationService,
    CostNarrativesService,
  ],
  exports: [TelemetryVectorizationService, CostNarrativesService],
})
export class CkqlModule {}
