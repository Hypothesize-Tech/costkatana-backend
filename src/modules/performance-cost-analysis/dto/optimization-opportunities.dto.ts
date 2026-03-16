import { IsOptional, IsArray, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class OptimizationOpportunitiesBodyDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minSavings?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
