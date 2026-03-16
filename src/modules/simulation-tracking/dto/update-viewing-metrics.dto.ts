import { IsNumber, IsOptional, IsArray, Min } from 'class-validator';

export class UpdateViewingMetricsDto {
  @IsNumber()
  @Min(0)
  timeSpent: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  optionsViewed?: number[];
}
