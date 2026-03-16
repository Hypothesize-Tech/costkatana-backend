import { IsOptional, IsEnum, IsString } from 'class-validator';

export class InsightsQueryDto {
  @IsOptional()
  @IsEnum(['1h', '24h', '7d', '30d'])
  timeframe?: '1h' | '24h' | '7d' | '30d' = '24h';

  @IsOptional()
  @IsString()
  filter_tenant?: string;

  @IsOptional()
  @IsString()
  filter_workspace?: string;

  @IsOptional()
  @IsString()
  filter_operation?: string;

  @IsOptional()
  @IsEnum(['cost', 'performance', 'usage', 'errors'])
  focus_area?: 'cost' | 'performance' | 'usage' | 'errors';
}
