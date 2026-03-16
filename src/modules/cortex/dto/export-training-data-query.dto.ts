import {
  IsOptional,
  IsString,
  IsNumber,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for GET /api/cortex-training-data/export
 * Matches Express req.query parsing.
 */
export class ExportTrainingDataQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsIn(['simple', 'medium', 'complex'])
  complexity?: 'simple' | 'medium' | 'complex';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minTokenReduction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10000)
  limit?: number;
}
