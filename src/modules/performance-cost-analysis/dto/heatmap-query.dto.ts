import { IsOptional, IsString, IsIn } from 'class-validator';

export class HeatmapQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsIn(['hour', 'day', 'week'])
  granularity?: 'hour' | 'day' | 'week';

  @IsOptional()
  @IsString()
  metric?: string;
}
