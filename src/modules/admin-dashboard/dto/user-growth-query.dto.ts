import { IsOptional, IsIn, IsEnum } from 'class-validator';
import { DateRangeQueryDto } from './date-range-query.dto';

export class UserGrowthQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly'])
  period?: 'daily' | 'weekly' | 'monthly' = 'daily';
}

export class UserEngagementQueryDto extends DateRangeQueryDto {}

export class UserSegmentsQueryDto extends DateRangeQueryDto {}

export class ActiveUsersQueryDto {
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly'])
  period?: 'daily' | 'weekly' | 'monthly' = 'daily';

  @IsOptional()
  days?: number = 30;
}
