/**
 * Health Monitoring Service for FAISS Indices
 * Provides startup checks, periodic validation, and monitoring capabilities
 */

import * as os from 'os';
import { loggingService } from '../logging.service';
import { faissVectorService } from './faiss.service';
import { recoveryService } from './recovery.service';
import { DocumentModel } from '../../models/Document';
import {
  IndexHealthStatus,
  ValidationReport,
  GLOBAL_INDEX_SOURCES,
  USER_INDEX_SOURCES
} from './types';

interface HealthCheckResult {
  healthy: boolean;
  globalIndexStatus: IndexHealthStatus;
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

export class HealthService {
  private validationIntervalMs: number;
  private validationTimer?: NodeJS.Timeout;
  private memoryThresholdPercent = 80;
  private documentCountDiscrepancyThreshold = 0.05; // 5% difference triggers alert
  private lastValidation?: Date;
  private isMonitoring = false;

  constructor() {
    this.validationIntervalMs = parseInt('24') * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Validate indices on startup
   */
  async validateStartup(): Promise<HealthCheckResult> {
    loggingService.info('Starting FAISS health check on startup', {
      component: 'HealthService'
    });

    const result: HealthCheckResult = {
      healthy: true,
      globalIndexStatus: await faissVectorService.getIndexHealth(),
      userIndicesChecked: 0,
      corruptedIndices: [],
      memoryUsage: this.getMemoryUsage(),
      recommendations: [],
      timestamp: new Date()
    };

    // Check global index
    if (!result.globalIndexStatus.isValid || result.globalIndexStatus.needsRebuild) {
      result.healthy = false;
      result.corruptedIndices.push('global');
      result.recommendations.push('Global index needs rebuild - will rebuild in background');
    }

    // Check last 5 recently accessed user indices
    const recentUsers = await DocumentModel.aggregate([
      {
        $match: {
          'metadata.userId': { $exists: true, $ne: null },
          'metadata.source': { $in: USER_INDEX_SOURCES },
          status: 'active',
          lastAccessedAt: { $exists: true }
        }
      },
      {
        $group: {
          _id: '$metadata.userId',
          lastAccessed: { $max: '$lastAccessedAt' }
        }
      },
      { $sort: { lastAccessed: -1 } },
      { $limit: 5 }
    ]);

    for (const userDoc of recentUsers) {
      const userId = userDoc._id;
      try {
        const userHealth = await faissVectorService.getIndexHealth(userId);
        result.userIndicesChecked++;
        
        if (!userHealth.isValid || userHealth.needsRebuild) {
          result.healthy = false;
          result.corruptedIndices.push(`user-${userId}`);
          result.recommendations.push(`User ${userId} index needs rebuild`);
        }
      } catch (error) {
        loggingService.error('Failed to check user index health', {
          component: 'HealthService',
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Check memory usage
    if (result.memoryUsage.percentage > this.memoryThresholdPercent) {
      result.recommendations.push(
        `Memory usage is high (${result.memoryUsage.percentage.toFixed(1)}%) - consider increasing memory or reducing cache size`
      );
    }

    // Log results
    loggingService.info('Startup health check completed', {
      component: 'HealthService',
      healthy: result.healthy,
      corruptedIndices: result.corruptedIndices.length,
      memoryUsage: `${result.memoryUsage.percentage.toFixed(1)}%`,
      recommendations: result.recommendations
    });

    this.lastValidation = new Date();
    return result;
  }

  /**
   * Start periodic health monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      loggingService.warn('Health monitoring already started', {
        component: 'HealthService'
      });
      return;
    }

    this.isMonitoring = true;
    
    // Schedule periodic validation
    this.validationTimer = setInterval(async () => {
      try {
        await this.performPeriodicValidation();
      } catch (error) {
        loggingService.error('Periodic validation failed', {
          component: 'HealthService',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, this.validationIntervalMs);

    loggingService.info('Health monitoring started', {
      component: 'HealthService',
      intervalHours: this.validationIntervalMs / (60 * 60 * 1000)
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
    
    loggingService.info('Health monitoring stopped', {
      component: 'HealthService'
    });
  }

  /**
   * Perform periodic validation
   */
  private async performPeriodicValidation(): Promise<void> {
    loggingService.info('Starting periodic FAISS validation', {
      component: 'HealthService',
      lastValidation: this.lastValidation
    });

    const report = await recoveryService.validateAllIndices();
    
    // Check for discrepancies
    const issues: string[] = [];
    
    // Check global index document count
    const globalMongoCount = await DocumentModel.countDocuments({
      'metadata.source': { $in: GLOBAL_INDEX_SOURCES },
      status: 'active'
    });
    
    const globalDiscrepancy = Math.abs(
      report.globalIndex.documentCount - globalMongoCount
    ) / globalMongoCount;
    
    if (globalDiscrepancy > this.documentCountDiscrepancyThreshold) {
      issues.push(
        `Global index document count mismatch: FAISS=${report.globalIndex.documentCount}, MongoDB=${globalMongoCount}`
      );
      
      // Trigger rebuild if discrepancy is significant
      if (globalDiscrepancy > 0.1) { // 10% threshold for auto-rebuild
        loggingService.warn('Triggering global index rebuild due to document count mismatch', {
          component: 'HealthService',
          faissCount: report.globalIndex.documentCount,
          mongoCount: globalMongoCount,
          discrepancy: `${(globalDiscrepancy * 100).toFixed(1)}%`
        });
        
        recoveryService.rebuildGlobalIndex().catch(error => {
          loggingService.error('Failed to rebuild global index', {
            component: 'HealthService',
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }

    // Check user indices
    for (const [userId, health] of report.userIndices) {
      const userMongoCount = await DocumentModel.countDocuments({
        'metadata.userId': userId,
        'metadata.source': { $in: USER_INDEX_SOURCES },
        status: 'active'
      });
      
      const userDiscrepancy = Math.abs(
        health.documentCount - userMongoCount
      ) / userMongoCount;
      
      if (userDiscrepancy > this.documentCountDiscrepancyThreshold) {
        issues.push(
          `User ${userId} index document count mismatch: FAISS=${health.documentCount}, MongoDB=${userMongoCount}`
        );
        
        // Trigger rebuild if discrepancy is significant
        if (userDiscrepancy > 0.1) {
          loggingService.warn('Triggering user index rebuild due to document count mismatch', {
            component: 'HealthService',
            userId,
            faissCount: health.documentCount,
            mongoCount: userMongoCount,
            discrepancy: `${(userDiscrepancy * 100).toFixed(1)}%`
          });
          
          recoveryService.rebuildUserIndex(userId).catch(error => {
            loggingService.error('Failed to rebuild user index', {
              component: 'HealthService',
              userId,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
      }
    }

    // Check memory usage
    const memoryUsage = this.getMemoryUsage();
    if (memoryUsage.percentage > this.memoryThresholdPercent) {
      issues.push(
        `Memory usage is high: ${memoryUsage.percentage.toFixed(1)}%`
      );
      
      // Alert but don't take action
      loggingService.warn('High memory usage detected', {
        component: 'HealthService',
        usedGB: (memoryUsage.used / 1024 / 1024 / 1024).toFixed(2),
        totalGB: (memoryUsage.total / 1024 / 1024 / 1024).toFixed(2),
        percentage: memoryUsage.percentage.toFixed(1)
      });
    }

    // Log validation results
    if (issues.length > 0) {
      loggingService.warn('Periodic validation found issues', {
        component: 'HealthService',
        issueCount: issues.length,
        issues
      });
    } else {
      loggingService.info('Periodic validation completed successfully', {
        component: 'HealthService',
        totalIndices: report.totalIndices,
        healthyIndices: report.healthyIndices
      });
    }

    this.lastValidation = new Date();
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): { used: number; total: number; percentage: number } {
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
      const health = await faissVectorService.getIndexHealth(userId);
      
      if (!health.isValid || health.needsRebuild) {
        return false;
      }
      
      // Check document count discrepancy
      const mongoCount = userId
        ? await DocumentModel.countDocuments({
            'metadata.userId': userId,
            'metadata.source': { $in: USER_INDEX_SOURCES },
            status: 'active'
          })
        : await DocumentModel.countDocuments({
            'metadata.source': { $in: GLOBAL_INDEX_SOURCES },
            status: 'active'
          });
      
      const discrepancy = Math.abs(health.documentCount - mongoCount) / mongoCount;
      
      return discrepancy <= this.documentCountDiscrepancyThreshold;
    } catch (error) {
      loggingService.error('Failed to check index health', {
        component: 'HealthService',
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get health metrics for monitoring
   */
  async getHealthMetrics(): Promise<{
    indices: {
      total: number;
      healthy: number;
      corrupted: number;
    };
    memory: {
      usedGB: number;
      totalGB: number;
      percentage: number;
    };
    lastValidation?: Date;
    isMonitoring: boolean;
  }> {
    const report = await recoveryService.validateAllIndices();
    const memory = this.getMemoryUsage();
    
    return {
      indices: {
        total: report.totalIndices,
        healthy: report.healthyIndices,
        corrupted: report.corruptedIndices.length
      },
      memory: {
        usedGB: memory.used / 1024 / 1024 / 1024,
        totalGB: memory.total / 1024 / 1024 / 1024,
        percentage: memory.percentage
      },
      lastValidation: this.lastValidation,
      isMonitoring: this.isMonitoring
    };
  }

  /**
   * Trigger manual validation
   */
  async triggerValidation(): Promise<ValidationReport> {
    loggingService.info('Manual validation triggered', {
      component: 'HealthService'
    });
    
    const report = await recoveryService.validateAllIndices();
    this.lastValidation = new Date();
    
    // Trigger rebuilds for corrupted indices if auto-recovery is enabled
    if (process.env.FAISS_AUTO_RECOVERY === 'true' && report.corruptedIndices.length > 0) {
      loggingService.info('Auto-recovery triggered for corrupted indices', {
        component: 'HealthService',
        corruptedCount: report.corruptedIndices.length
      });
      
      recoveryService.rebuildInBackground().catch(error => {
        loggingService.error('Auto-recovery failed', {
          component: 'HealthService',
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
    
    return report;
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    this.stopMonitoring();
    loggingService.info('Health service shut down', {
      component: 'HealthService'
    });
  }
}

// Export singleton instance
export const healthService = new HealthService();