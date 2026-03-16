import { IsOptional, IsDateString, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class SimulationStatsQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  global?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
