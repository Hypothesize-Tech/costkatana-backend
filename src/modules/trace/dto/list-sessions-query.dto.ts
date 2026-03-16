import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ListSessionsQueryDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  from?: Date;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  to?: Date;

  @IsOptional()
  @IsEnum(['active', 'completed', 'error'])
  status?: 'active' | 'completed' | 'error';

  @IsOptional()
  @IsEnum(['telemetry', 'manual', 'unified', 'in-app', 'integration'])
  source?: 'telemetry' | 'manual' | 'unified' | 'in-app' | 'integration';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSpans?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSpans?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
