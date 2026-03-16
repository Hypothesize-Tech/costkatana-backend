import { IsOptional, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

export class SecurityAnalyticsQueryDto {
  @IsOptional()
  @IsISO8601()
  @Type(() => Date)
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  @Type(() => Date)
  endDate?: string;
}
