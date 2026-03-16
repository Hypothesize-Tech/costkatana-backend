import { IsOptional, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { DateRangeQueryDto } from './date-range-query.dto';

export class ApiKeyStatsQueryDto {}

export class ApiKeyUsageQueryDto extends DateRangeQueryDto {}

export class TopApiKeysQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;
}

export class ExpiringApiKeysQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  days?: number = 30;
}

export class ApiKeysOverBudgetQueryDto {}
