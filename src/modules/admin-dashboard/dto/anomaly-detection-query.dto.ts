import { IsOptional, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class SpendingAnomalyQueryDto {
  @IsOptional()
  @IsEnum(['hour', 'day', 'week'])
  timeWindow?: 'hour' | 'day' | 'week' = 'day';

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  @Transform(({ value }) => parseFloat(value))
  threshold?: number = 2.0;
}

export class ErrorAnomalyQueryDto {
  @IsOptional()
  @IsEnum(['hour', 'day', 'week'])
  timeWindow?: 'hour' | 'day' | 'week' = 'day';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Transform(({ value }) => parseFloat(value))
  threshold?: number = 0.1;
}

export class AlertsQueryDto {}
