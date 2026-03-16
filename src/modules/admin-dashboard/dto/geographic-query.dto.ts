import { IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from './date-range-query.dto';

export class GeographicUsageQueryDto extends DateRangeQueryDto {}

export class PeakUsageTimesQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  countryCode?: string;
}

export class UsagePatternsByTimezoneQueryDto extends DateRangeQueryDto {}

export class RegionalPerformanceQueryDto extends DateRangeQueryDto {}
