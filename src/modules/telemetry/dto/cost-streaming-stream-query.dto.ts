import { IsOptional, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for GET /api/cost-streaming/stream
 * Supports optional auth via query when no JWT is present (Express parity).
 */
export class CostStreamingStreamQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  eventTypes?: string; // comma-separated, e.g. "cost_tracked,cost_spike"

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minCost?: number;

  @IsOptional()
  @IsString()
  operations?: string; // comma-separated, e.g. "chat.completion,embedding"
}
