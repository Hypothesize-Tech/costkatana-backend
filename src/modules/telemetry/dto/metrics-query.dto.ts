import { IsOptional, IsString } from 'class-validator';

export class MetricsQueryDto {
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;

  @IsOptional()
  @IsString()
  timeframe?: string;
}
