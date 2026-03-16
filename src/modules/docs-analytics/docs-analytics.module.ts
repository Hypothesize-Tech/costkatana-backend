import { Module } from '@nestjs/common';
import { SchemasModule } from '../../schemas/schemas.module';
import { CortexModule } from '../cortex/cortex.module';
import { CommonModule } from '../../common/common.module';
import { DocsAnalyticsController } from './docs-analytics.controller';
import { DocsAnalyticsService } from './docs-analytics.service';

@Module({
  imports: [
    // Import schemas for Mongoose models
    SchemasModule,
    // Import CortexModule for AIRouterService
    CortexModule,
    // Import CommonModule for LoggerService
    CommonModule,
  ],
  controllers: [DocsAnalyticsController],
  providers: [DocsAnalyticsService],
  exports: [DocsAnalyticsService],
})
export class DocsAnalyticsModule {}
