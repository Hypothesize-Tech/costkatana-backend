/**
 * DTO for optimization feedback (POST /optimizations/:id/feedback)
 * Captures user feedback on an optimization result.
 */

import { IsOptional, IsNumber, IsString, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class OptimizationFeedbackDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  helpful?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  appliedResult?: string;
}
