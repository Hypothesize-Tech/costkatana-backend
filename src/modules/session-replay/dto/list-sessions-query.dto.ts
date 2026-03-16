import {
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListSessionsQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsIn(['telemetry', 'manual', 'unified', 'in-app', 'integration'])
  source?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(['active', 'completed', 'error'])
  status?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasErrors?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minTokens?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxTokens?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minDuration?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxDuration?: number;

  @IsOptional()
  @IsString()
  aiModel?: string;

  @IsOptional()
  @IsString()
  searchQuery?: string;

  @IsOptional()
  @IsString()
  appFeature?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['startedAt', 'totalCost', 'totalTokens', 'duration'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;
}
