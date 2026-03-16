import { IsOptional, IsString } from 'class-validator';

export class DetailedMetricsQueryDto {
  @IsString()
  service!: string;

  @IsString()
  model!: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  tags?: string;
}
