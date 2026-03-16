import { IsOptional, IsEnum, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class NotebookQueryDto {
  @IsOptional()
  @IsEnum(['active', 'archived', 'deleted'])
  status?: 'active' | 'archived' | 'deleted';

  @IsOptional()
  @IsEnum(['cost_spike', 'model_performance', 'usage_patterns', 'custom'])
  template_type?:
    | 'cost_spike'
    | 'model_performance'
    | 'usage_patterns'
    | 'custom';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsEnum(['created_at', 'updated_at', 'title'])
  sort_by?: 'created_at' | 'updated_at' | 'title' = 'created_at';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}
