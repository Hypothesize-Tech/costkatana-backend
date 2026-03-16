import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Usage, UsageSchema } from '@/schemas/analytics/usage.schema';
import { TemplateAnalyticsController } from './template-analytics.controller';
import { TemplateAnalyticsService } from './template-analytics.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: Usage.name, schema: UsageSchema }]),
  ],
  controllers: [TemplateAnalyticsController],
  providers: [TemplateAnalyticsService],
  exports: [TemplateAnalyticsService],
})
export class TemplateAnalyticsModule {}
