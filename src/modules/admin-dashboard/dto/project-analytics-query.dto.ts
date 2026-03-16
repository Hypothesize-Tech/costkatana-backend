import {
  IsOptional,
  IsString,
  IsBoolean,
  IsEnum,
  IsMongoId,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DateRangeQueryDto } from './date-range-query.dto';

export class ProjectAnalyticsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;
}

export class WorkspaceAnalyticsQueryDto extends DateRangeQueryDto {}

export class ProjectTrendsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly'])
  period?: 'daily' | 'weekly' | 'monthly' = 'daily';

  @IsOptional()
  @IsMongoId()
  projectId?: string;
}
