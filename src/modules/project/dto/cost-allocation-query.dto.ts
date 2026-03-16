import { IsOptional, IsIn, IsISO8601 } from 'class-validator';

export class CostAllocationQueryDto {
  @IsOptional()
  @IsIn(['department', 'team', 'client', 'purpose'])
  groupBy?: 'department' | 'team' | 'client' | 'purpose';

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
