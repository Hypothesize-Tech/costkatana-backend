import { IsOptional, IsString, IsIn } from 'class-validator';
import { DateRangeQueryDto } from './date-range-query.dto';

export class BudgetOverviewQueryDto extends DateRangeQueryDto {}

export class ProjectBudgetStatusQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;
}

export class BudgetAlertsQueryDto {}

export class BudgetTrendsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsIn(['project', 'workspace'])
  entityType?: 'project' | 'workspace';
}

export class SendBudgetAlertsQueryDto {}
