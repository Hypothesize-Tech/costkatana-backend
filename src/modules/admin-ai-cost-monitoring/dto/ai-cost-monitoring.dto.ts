import { IsDateString, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class SummaryRangeQueryDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

export class CleanupBodyDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  daysToKeep?: number = 30;
}
