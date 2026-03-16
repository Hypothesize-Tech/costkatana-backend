import {
  IsOptional,
  IsString,
  IsIn,
  IsInt,
  Min,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TelemetryQueryDto {
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  trace_id?: string;

  @IsOptional()
  @IsString()
  request_id?: string;

  @IsOptional()
  @IsString()
  service_name?: string;

  @IsOptional()
  @IsString()
  operation_name?: string;

  @IsOptional()
  @IsIn(['success', 'error', 'unset'])
  status?: 'success' | 'error' | 'unset';

  @IsOptional()
  @IsString()
  start_time?: string;

  @IsOptional()
  @IsString()
  end_time?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  min_duration?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  max_duration?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  min_cost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  max_cost?: number;

  @IsOptional()
  @IsString()
  http_route?: string;

  @IsOptional()
  @IsString()
  http_method?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  http_status_code?: number;

  @IsOptional()
  @IsString()
  gen_ai_model?: string;

  @IsOptional()
  @IsString()
  error_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
