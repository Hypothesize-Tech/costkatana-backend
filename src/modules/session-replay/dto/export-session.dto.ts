import { IsIn, IsOptional } from 'class-validator';

export class ExportSessionDto {
  @IsIn(['json', 'csv'], {
    message: 'format must be "json" or "csv"',
  })
  format: 'json' | 'csv';
}
