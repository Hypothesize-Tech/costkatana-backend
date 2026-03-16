import {
  IsOptional,
  IsString,
  IsArray,
  IsEnum,
  IsInt,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class ActivityFeedQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 50;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  types?: string[];

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  errorType?: string;
}

export class ActivityFeedFiltersDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  errorType?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(
    [
      'request',
      'error',
      'high_cost',
      'budget_warning',
      'anomaly',
      'user_action',
    ],
    { each: true },
  )
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  types?: (
    | 'request'
    | 'error'
    | 'high_cost'
    | 'budget_warning'
    | 'anomaly'
    | 'user_action'
  )[];

  @IsOptional()
  @IsArray()
  @IsEnum(['low', 'medium', 'high', 'critical'], { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  severities?: ('low' | 'medium' | 'high' | 'critical')[];
}
