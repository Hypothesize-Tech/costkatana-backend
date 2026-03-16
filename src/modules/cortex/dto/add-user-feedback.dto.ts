import {
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body DTO for POST /api/cortex-training-data/feedback/:sessionId
 * Matches Express req.body for addUserFeedback.
 */
export class AddUserFeedbackDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isSuccessful?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  improvementSuggestions?: string[];
}
