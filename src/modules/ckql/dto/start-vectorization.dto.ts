import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for POST /ckql/vectorization/start - Start telemetry vectorization job.
 */
export class StartVectorizationDto {
  @IsOptional()
  @IsString()
  timeframe?: string;

  @IsOptional()
  @IsString()
  tenant_id?: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force_reprocess?: boolean = false;
}
