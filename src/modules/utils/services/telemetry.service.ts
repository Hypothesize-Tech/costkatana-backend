import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';

/** Response shape for Cortex model router routing decisions */
export interface CortexPerformanceMetrics {
  cost_by_model?: Array<{
    model: string;
    request_count: number;
    total_cost: number;
  }>;
  avg_duration_ms: number;
  p95_duration_ms: number;
  error_rate: number;
}

const DEFAULT_TIMEFRAME_MS = 60 * 60 * 1000; // 1h

/**
 * Parses a human-readable timeframe string into milliseconds.
 * Supports: 1h, 24h, 7d, 30d (case-insensitive).
 */
function parseTimeframeToMs(timeframe: string | undefined): number {
  if (!timeframe || typeof timeframe !== 'string') return DEFAULT_TIMEFRAME_MS;
  const normalized = timeframe.trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(h|d|m)$/);
  if (!match) return DEFAULT_TIMEFRAME_MS;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (value <= 0 || !Number.isFinite(value)) return DEFAULT_TIMEFRAME_MS;
  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return DEFAULT_TIMEFRAME_MS;
  }
}

/**
 * Telemetry service for Cortex model router (performance metrics).
 * Provides getPerformanceMetrics for routing decisions using Usage data.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    @InjectModel(Usage.name)
    private readonly usageModel: Model<UsageDocument>,
  ) {}

  /**
   * Returns performance metrics for the given workspace and timeframe.
   * Used by Cortex model router for cost- and latency-aware routing.
   *
   * @param options.workspace_id - Optional project/workspace ID (maps to Usage.projectId)
   * @param options.timeframe - Optional window, e.g. '1h', '24h', '7d'
   */
  async getPerformanceMetrics(options?: {
    workspace_id?: string;
    timeframe?: string;
  }): Promise<CortexPerformanceMetrics> {
    try {
      const startDate = new Date(
        Date.now() - parseTimeframeToMs(options?.timeframe),
      );

      const match: Record<string, unknown> = {
        createdAt: { $gte: startDate },
      };

      if (options?.workspace_id) {
        try {
          const { default: mongoose } = await import('mongoose');
          if (mongoose.Types.ObjectId.isValid(options.workspace_id)) {
            match.projectId = new mongoose.Types.ObjectId(options.workspace_id);
          }
        } catch {
          // leave projectId unfiltered if ObjectId fails
        }
      }

      const pipeline: PipelineStage[] = [
        { $match: match },
        {
          $facet: {
            byModel: [
              {
                $group: {
                  _id: '$model',
                  request_count: { $sum: 1 },
                  total_cost: { $sum: { $ifNull: ['$cost', 0] } },
                },
              },
              {
                $project: {
                  _id: 0,
                  model: '$_id',
                  request_count: 1,
                  total_cost: 1,
                },
              },
            ],
            global: [
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  avg_duration_ms: { $avg: '$responseTime' },
                  durations: { $push: '$responseTime' },
                  errors: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
                },
              },
            ],
          },
        },
      ];

      interface FacetResult {
        byModel: Array<{
          model: string;
          request_count: number;
          total_cost: number;
        }>;
        global: Array<{
          count: number;
          avg_duration_ms: number;
          durations: number[];
          errors: number;
        }>;
      }

      const result = await this.usageModel.aggregate<FacetResult>(pipeline);

      if (!result?.length) {
        return {
          avg_duration_ms: 0,
          p95_duration_ms: 0,
          error_rate: 0,
        };
      }

      const first = result[0];
      const byModel = first?.byModel ?? [];
      const global = first?.global?.[0];

      if (!global || global.count === 0) {
        return {
          cost_by_model: byModel,
          avg_duration_ms: 0,
          p95_duration_ms: 0,
          error_rate: 0,
        };
      }

      const durations = (global.durations ?? []).filter(
        (d): d is number => typeof d === 'number' && Number.isFinite(d),
      );
      durations.sort((a, b) => a - b);
      const p95Index = Math.min(
        Math.ceil(durations.length * 0.95) - 1,
        durations.length - 1,
      );
      const p95_duration_ms =
        durations.length > 0 && p95Index >= 0 ? (durations[p95Index] ?? 0) : 0;

      return {
        cost_by_model: byModel,
        avg_duration_ms: Number(global.avg_duration_ms) || 0,
        p95_duration_ms,
        error_rate: global.errors / global.count,
      };
    } catch (error) {
      this.logger.warn(
        `getPerformanceMetrics failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        avg_duration_ms: 0,
        p95_duration_ms: 0,
        error_rate: 0,
      };
    }
  }
}
