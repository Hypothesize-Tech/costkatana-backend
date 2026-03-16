/**
 * Vector Health Service for NestJS
 * Provides startup checks, periodic validation, and monitoring capabilities for FAISS indices
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FaissVectorService } from './faiss-vector.service';

interface HealthCheckResult {
  healthy: boolean;
  globalIndexStatus: any;
  userIndicesChecked: number;
  corruptedIndices: string[];
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  recommendations: string[];
  timestamp: Date;
}

@Injectable()
export class VectorHealthService {
  private readonly logger = new Logger(VectorHealthService.name);
  private validationIntervalMs: number;
  private validationTimer?: NodeJS.Timeout;
  private memoryThresholdPercent = 80;
  private documentCountDiscrepancyThreshold = 0.05; // 5% difference triggers alert
  private lastValidation?: Date;
  private isMonitoring = false;

  constructor(
    private configService: ConfigService,
    private faissVectorService: FaissVectorService,
    @InjectModel('Document') private documentModel: Model<any>,
  ) {
    this.validationIntervalMs =
      parseInt(
        this.configService.get('FAISS_VALIDATION_INTERVAL_HOURS', '24'),
      ) *
      60 *
      60 *
      1000;
  }

  /**
   * Validate indices on startup
   */
  async validateStartup(): Promise<HealthCheckResult> {
    this.logger.log('Starting FAISS health check on startup');

    const result: HealthCheckResult = {
      healthy: true,
      globalIndexStatus: await this.faissVectorService.getIndexHealth(),
      userIndicesChecked: 0,
      corruptedIndices: [],
      memoryUsage: this.getMemoryUsage(),
      recommendations: [],
      timestamp: new Date(),
    };

    // Check global index
    if (
      !result.globalIndexStatus.isValid ||
      result.globalIndexStatus.needsRebuild
    ) {
      result.healthy = false;
      result.corruptedIndices.push('global');
      result.recommendations.push(
        'Global index needs rebuild - will rebuild in background',
      );
    }

    // Check last 5 recently accessed user indices
    const recentUsers = await this.documentModel.aggregate([
      {
        $match: {
          'metadata.userId': { $exists: true, $ne: null },
          'metadata.source': { $in: ['conversation', 'user-upload'] },
          status: 'active',
          lastAccessedAt: { $exists: true },
        },
      },
      {
        $group: {
          _id: '$metadata.userId',
          lastAccessed: { $max: '$lastAccessedAt' },
        },
      },
      { $sort: { lastAccessed: -1 } },
      { $limit: 5 },
    ]);

    for (const userDoc of recentUsers) {
      const userId = userDoc._id;
      try {
        const userHealth = await this.faissVectorService.getIndexHealth(userId);
        result.userIndicesChecked++;

        if (!userHealth.isValid || userHealth.needsRebuild) {
          result.healthy = false;
          result.corruptedIndices.push(`user-${userId}`);
          result.recommendations.push(`User ${userId} index needs rebuild`);
        }
      } catch (error) {
        this.logger.error('Failed to check user index health', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Check memory usage
    if (result.memoryUsage.percentage > this.memoryThresholdPercent) {
      result.recommendations.push(
        `Memory usage is high (${result.memoryUsage.percentage.toFixed(1)}%) - consider increasing memory or reducing cache size`,
      );
    }

    // Log results
    this.logger.log('Startup health check completed', {
      healthy: result.healthy,
      corruptedIndices: result.corruptedIndices.length,
      memoryUsage: `${result.memoryUsage.percentage.toFixed(1)}%`,
      recommendations: result.recommendations,
    });

    this.lastValidation = new Date();
    return result;
  }

  /**
   * Start periodic health monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      this.logger.warn('Health monitoring already started');
      return;
    }

    this.isMonitoring = true;

    // Schedule periodic validation
    this.validationTimer = setInterval(async () => {
      try {
        await this.performPeriodicValidation();
      } catch (error) {
        this.logger.error('Periodic validation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.validationIntervalMs);

    this.logger.log('Health monitoring started', {
      intervalHours: this.validationIntervalMs / (60 * 60 * 1000),
    });
  }

  /**
   * Stop periodic health monitoring
   */
  stopMonitoring(): void {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = undefined;
    }
    this.isMonitoring = false;

    this.logger.log('Health monitoring stopped');
  }

  /**
   * Perform periodic validation
   */
  private async performPeriodicValidation(): Promise<void> {
    this.logger.log('Starting periodic FAISS validation', {
      lastValidation: this.lastValidation,
    });

    // Basic validation - check if indices exist and are accessible
    try {
      const globalHealth = await this.faissVectorService.getIndexHealth();

      if (!globalHealth.isValid) {
        this.logger.warn('Global index validation failed', { globalHealth });
      }

      // Check memory usage
      const memoryUsage = this.getMemoryUsage();
      if (memoryUsage.percentage > this.memoryThresholdPercent) {
        this.logger.warn('High memory usage detected', {
          usedGB: (memoryUsage.used / 1024 / 1024 / 1024).toFixed(2),
          totalGB: (memoryUsage.total / 1024 / 1024 / 1024).toFixed(2),
          percentage: memoryUsage.percentage.toFixed(1),
        });
      } else {
        this.logger.log('Periodic validation completed successfully');
      }

      this.lastValidation = new Date();
    } catch (error) {
      this.logger.error('Periodic validation error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): {
    used: number;
    total: number;
    percentage: number;
  } {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const percentage = (used / total) * 100;

    return { used, total, percentage };
  }

  /**
   * Check if a specific index is healthy
   */
  async checkIndexHealth(userId?: string): Promise<boolean> {
    try {
      const health = await this.faissVectorService.getIndexHealth(userId);

      if (!health.isValid || health.needsRebuild) {
        return false;
      }

      // Check document count discrepancy
      const mongoCount = userId
        ? await this.documentModel.countDocuments({
            'metadata.userId': userId,
            'metadata.source': { $in: ['conversation', 'user-upload'] },
            status: 'active',
          })
        : await this.documentModel.countDocuments({
            'metadata.source': {
              $in: ['knowledge-base', 'telemetry', 'activity'],
            },
            status: 'active',
          });

      const discrepancy =
        Math.abs(health.documentCount - mongoCount) / mongoCount;

      return discrepancy <= this.documentCountDiscrepancyThreshold;
    } catch (error) {
      this.logger.error('Failed to check index health', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get health metrics for monitoring
   */
  async getHealthMetrics(): Promise<{
    indices: {
      globalHealthy: boolean;
    };
    memory: {
      usedGB: number;
      totalGB: number;
      percentage: number;
    };
    lastValidation?: Date;
    isMonitoring: boolean;
  }> {
    const globalHealth = await this.faissVectorService.getIndexHealth();
    const memory = this.getMemoryUsage();

    return {
      indices: {
        globalHealthy: globalHealth.isValid && !globalHealth.needsRebuild,
      },
      memory: {
        usedGB: memory.used / 1024 / 1024 / 1024,
        totalGB: memory.total / 1024 / 1024 / 1024,
        percentage: memory.percentage,
      },
      lastValidation: this.lastValidation,
      isMonitoring: this.isMonitoring,
    };
  }
}
