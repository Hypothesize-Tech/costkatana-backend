import { IsOptional, IsDateString } from 'class-validator';

export class TagBreakdownQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
