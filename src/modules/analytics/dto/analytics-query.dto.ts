import { IsString, IsOptional, IsIn, IsDateString } from 'class-validator';

/**
 * Query DTO for analytics list/export (GET /, GET /projects/:projectId, GET /export).
 */
export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  period?: 'daily' | 'weekly' | 'monthly';

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(['service', 'model', 'date', 'hour'])
  groupBy?: 'service' | 'model' | 'date' | 'hour';

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class ComparativeAnalyticsQueryDto {
  @IsString()
  period1Start: string;

  @IsString()
  period1End: string;

  @IsString()
  period2Start: string;

  @IsString()
  period2End: string;
}

export class ProjectComparisonQueryDto {
  @IsString()
  projectIds: string | string[];

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  metric?: string;
}

export class InsightsQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  timeframe?: string;
}

export class DashboardQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  /** Rolling window for dashboard aggregates and charts (default: 30d server-side when omitted). */
  @IsOptional()
  @IsIn(['24h', '7d', '30d', '90d', '365d'])
  timeRange?: string;
}

export class RecentUsageQueryDto {
  @IsOptional()
  limit?: number;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class ExportQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}
