/**
 * Auto-Simulation Module DTOs
 *
 * Data Transfer Objects for all auto-simulation endpoints.
 * Uses class-validator for runtime validation.
 */

import {
  IsBoolean,
  IsOptional,
  IsArray,
  IsString,
  IsEnum,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for updating auto-simulation settings
 */
export class UpdateAutoSimulationSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  triggers?: {
    costThreshold?: number;
    tokenThreshold?: number;
    expensiveModels?: string[];
    allCalls?: boolean;
  };

  @IsOptional()
  autoOptimize?: {
    enabled?: boolean;
    approvalRequired?: boolean;
    maxSavingsThreshold?: number;
    riskTolerance?: 'low' | 'medium' | 'high';
  };

  @IsOptional()
  notifications?: {
    email?: boolean;
    dashboard?: boolean;
    slack?: boolean;
    slackWebhook?: string;
  };
}

const queueStatusEnum = [
  'pending',
  'processing',
  'completed',
  'failed',
  'approved',
  'rejected',
] as const;

/**
 * DTO for getting user queue with filters
 */
export class GetUserQueueQueryDto {
  @IsOptional()
  @IsEnum(queueStatusEnum)
  status?: (typeof queueStatusEnum)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * DTO for handling optimization approval
 */
export class HandleOptimizationApprovalDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  selectedOptimizations?: number[];
}

/**
 * DTO for triggering simulation parameters
 */
export class TriggerSimulationParamsDto {
  @IsString()
  usageId!: string;
}

/**
 * DTO for queue item parameters
 */
export class QueueItemParamsDto {
  @IsString()
  queueItemId!: string;
}
