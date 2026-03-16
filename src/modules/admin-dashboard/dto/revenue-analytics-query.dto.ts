import { IsOptional, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { DateRangeQueryDto } from './date-range-query.dto';

export class RevenueMetricsQueryDto extends DateRangeQueryDto {}

export class SubscriptionMetricsQueryDto extends DateRangeQueryDto {}

export class ConversionMetricsQueryDto extends DateRangeQueryDto {}

export class UpcomingRenewalsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  days?: number = 30;
}
