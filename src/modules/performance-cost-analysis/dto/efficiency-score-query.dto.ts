import { IsOptional, IsString } from 'class-validator';

export class EfficiencyScoreQueryDto {
  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
