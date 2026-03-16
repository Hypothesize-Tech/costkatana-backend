import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PredictiveIntelligenceQueryDto {
  @IsOptional()
  @IsString()
  scope?: 'user' | 'project' | 'team' = 'user';

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  timeHorizon?: number = 30;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeScenarios?: boolean = true;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeCrossPlatform?: boolean = true;
}

export class AlertsQueryDto {
  @IsOptional()
  @IsString()
  scope?: 'user' | 'project' | 'team' = 'user';

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @IsString()
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

export class BudgetProjectionsQueryDto {
  @IsOptional()
  @IsString()
  scope?: 'user' | 'project' | 'team' = 'user';

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  daysAhead?: number = 30;
}

export class OptimizationsQueryDto {
  @IsOptional()
  @IsString()
  scope?: 'user' | 'project' | 'team' = 'user';

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @Type(() => Number)
  minSavings?: number = 50;

  @IsOptional()
  @IsString()
  difficulty?: 'easy' | 'medium' | 'hard';

  @IsOptional()
  @IsString()
  type?:
    | 'model_switch'
    | 'prompt_optimization'
    | 'caching'
    | 'batch_processing'
    | 'parameter_tuning';
}

export class ScenariosQueryDto {
  @IsOptional()
  @IsString()
  scope?: 'user' | 'project' | 'team' = 'user';

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timeHorizon?: number = 90;

  @IsOptional()
  @IsString()
  timeframe?: '1_month' | '3_months' | '6_months' | '1_year';
}

export class DashboardQueryDto {
  @IsOptional()
  @IsString()
  scope?: 'user' | 'project' | 'team' = 'user';

  @IsOptional()
  @IsString()
  scopeId?: string;
}

export class ScopeQueryDto {
  @IsOptional()
  @IsString()
  scope?: 'user' | 'project' | 'team' = 'user';

  @IsOptional()
  @IsString()
  scopeId?: string;
}
