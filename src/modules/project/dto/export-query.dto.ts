import { IsOptional, IsIn, IsISO8601 } from 'class-validator';

export class ExportQueryDto {
  @IsOptional()
  @IsIn(['csv', 'json', 'excel'])
  format?: 'csv' | 'json' | 'excel';

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
