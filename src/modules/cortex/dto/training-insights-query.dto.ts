import { IsOptional, IsString, IsIn } from 'class-validator';

/**
 * Query DTO for GET /api/cortex-training-data/insights
 */
export class TrainingInsightsQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsIn(['simple', 'medium', 'complex'])
  complexity?: 'simple' | 'medium' | 'complex';
}
