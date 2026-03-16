import {
  IsOptional,
  IsString,
  IsDateString,
  IsNumber,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class AdminUserAnalyticsFiltersDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  workflowId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  minCost?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  maxCost?: number;
}

export class AdminUserAnalyticsQueryDto extends AdminUserAnalyticsFiltersDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class SpendingTrendsQueryDto extends AdminUserAnalyticsFiltersDto {
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly'])
  timeRange?: 'daily' | 'weekly' | 'monthly' = 'daily';
}

export class ExportUserSpendingQueryDto extends AdminUserAnalyticsFiltersDto {
  @IsOptional()
  @IsEnum(['json', 'csv'])
  format?: 'json' | 'csv' = 'json';
}

export class UserDetailedSpendingResponseDto {
  userId: string;
  userEmail: string;
  userName: string;
  summary: {
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    averageCostPerRequest: number;
    firstActivity: Date;
    lastActivity: Date;
  };
  breakdown: {
    services: Array<{
      service: string;
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
    }>;
    models: Array<{
      model: string;
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
    }>;
    projects: Array<{
      projectId: string;
      projectName?: string;
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
    }>;
    workflows: Array<{
      workflowId: string;
      workflowName?: string;
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
    }>;
    features: Array<{
      feature: string;
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
    }>;
  };
  period: {
    startDate?: Date;
    endDate?: Date;
  };
}

export class UserSpendingSummaryDto {
  userId: string;
  userEmail: string;
  userName: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  averageCostPerRequest: number;
  firstActivity: Date;
  lastActivity: Date;
  services: Array<{
    service: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
  models: Array<{
    model: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
  projects: Array<{
    projectId: string;
    projectName?: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
  workflows: Array<{
    workflowId: string;
    workflowName?: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
  features: Array<{
    feature: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
}

export class SpendingTrendsResponseDto {
  date: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  userCount: number;
}

export class PlatformSummaryResponseDto {
  totalUsers: number;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  averageCostPerUser: number;
  topSpendingUsers: Array<{
    userId: string;
    userEmail: string;
    cost: number;
  }>;
}

export class PaginatedUserSpendingResponseDto {
  success: boolean;
  data: UserSpendingSummaryDto[];
  meta: {
    total: number;
    filters?: AdminUserAnalyticsFiltersDto;
  };
}

export class UserSpendingResponseDto {
  success: boolean;
  data: UserDetailedSpendingResponseDto;
}

export class UsersByServiceResponseDto {
  success: boolean;
  data: UserSpendingSummaryDto[];
  meta: {
    service: string;
    total: number;
  };
}

export class SpendingTrendsResponseWrapperDto {
  success: boolean;
  data: SpendingTrendsResponseDto[];
  meta: {
    timeRange: 'daily' | 'weekly' | 'monthly';
    total: number;
  };
}

export class PlatformSummaryResponseWrapperDto {
  success: boolean;
  data: PlatformSummaryResponseDto;
}

export class ExportUserSpendingResponseDto {
  success: boolean;
  data: UserSpendingSummaryDto[];
  meta: {
    exportedAt: string;
    total: number;
    filters?: AdminUserAnalyticsFiltersDto;
  };
}
