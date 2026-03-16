import { IsOptional, IsMongoId } from 'class-validator';
import { DateRangeQueryDto } from './date-range-query.dto';

export class FeatureUsageStatsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsMongoId()
  userId?: string;
}

export class FeatureAdoptionRatesQueryDto extends DateRangeQueryDto {}

export class FeatureCostAnalysisQueryDto extends DateRangeQueryDto {}
