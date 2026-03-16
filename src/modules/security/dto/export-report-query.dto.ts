import { IsOptional, IsIn, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

export class ExportReportQueryDto {
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';

  @IsOptional()
  @IsISO8601()
  @Type(() => Date)
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  @Type(() => Date)
  endDate?: string;
}
