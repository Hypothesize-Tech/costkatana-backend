import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsObject,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const COST_TELEMETRY_EVENT_TYPES = [
  'cost_tracked',
  'cost_spike',
  'budget_warning',
  'optimization_opportunity',
  'cache_hit',
  'cache_miss',
] as const;

export type CostTelemetryEventType =
  (typeof COST_TELEMETRY_EVENT_TYPES)[number];

/**
 * Data payload for cost telemetry events (nestable for POST body).
 */
export class CostTelemetryEventDataDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tokens?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  latency?: number;

  @IsOptional()
  @IsString()
  operation?: string;

  @IsOptional()
  @IsString()
  template?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  cacheHit?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetRemaining?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimatedCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualCost?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Body DTO for POST /api/cost-streaming/test-event
 * Emits a cost telemetry event to all subscribed SSE clients.
 */
export class EmitTestEventDto {
  @IsOptional()
  @IsEnum(COST_TELEMETRY_EVENT_TYPES)
  eventType?: CostTelemetryEventType;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @Type(() => CostTelemetryEventDataDto)
  data?: CostTelemetryEventDataDto;
}
