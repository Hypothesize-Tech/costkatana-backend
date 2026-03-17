import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Usage, UsageSchema } from '@/schemas/analytics/usage.schema';
import {
  TagHierarchy,
  TagHierarchySchema,
} from '@/schemas/tagging/tag-hierarchy.schema';
import {
  CostAllocationRule,
  CostAllocationRuleSchema,
} from '@/schemas/tagging/cost-allocation-rule.schema';
import { TaggingController } from './tagging.controller';
import { TaggingService } from './tagging.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: TagHierarchy.name, schema: TagHierarchySchema },
      { name: CostAllocationRule.name, schema: CostAllocationRuleSchema },
    ]),
  ],
  controllers: [TaggingController],
  providers: [TaggingService],
  exports: [TaggingService],
})
export class TaggingModule {}
