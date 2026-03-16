import { IsOptional, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export class DateRangeQueryDto {
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  startDate?: Date;

  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  endDate?: Date;
}
