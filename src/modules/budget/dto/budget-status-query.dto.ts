import { IsOptional, IsString } from 'class-validator';

/**
 * Query DTO for budget status endpoint.
 * GET api/budget/status?project=
 */
export class BudgetStatusQueryDto {
  @IsOptional()
  @IsString()
  project?: string;
}
