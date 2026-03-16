import { IsOptional, IsInt, Min, IsIn, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';
import { DateRangeQueryDto } from './date-range-query.dto';

export class IntegrationStatsQueryDto extends DateRangeQueryDto {}

export class IntegrationTrendsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsIn(['daily', 'hourly'])
  period?: string = 'daily';

  @IsOptional()
  service?: string;
}

export class IntegrationHealthQueryDto {}

export class TopIntegrationsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsIn(['requests', 'cost', 'tokens', 'users'])
  metric?: string = 'requests';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;
}

export class HighErrorIntegrationsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  threshold?: number = 10;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;
}

export class PerformanceIssuesQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseFloat(value))
  responseTimeThreshold?: number = 5000;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;
}
