import { IsOptional, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query DTO for get invoices endpoint.
 * GET api/billing/invoices?limit=10&offset=0
 * Query params arrive as strings; Transform coerces to int and applies defaults.
 */
export class GetInvoicesQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return 10;
    const n = parseInt(String(value), 10);
    return Number.isNaN(n) ? 10 : n;
  })
  @IsInt({ message: 'limit must be an integer number' })
  @Min(1, { message: 'limit must not be less than 1' })
  limit: number = 10;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return 0;
    const n = parseInt(String(value), 10);
    return Number.isNaN(n) ? 0 : n;
  })
  @IsInt({ message: 'offset must be an integer number' })
  @Min(0, { message: 'offset must not be less than 0' })
  offset: number = 0;
}
