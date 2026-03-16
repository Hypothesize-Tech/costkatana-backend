import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class SimulateUsageDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsNumber()
  @Min(1)
  @Max(100)
  percentage: number;
}
