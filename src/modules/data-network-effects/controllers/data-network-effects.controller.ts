import {
  Controller,
  Get,
  Post,
  Put,
  Query,
  Param,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ModelPerformanceFingerprintService } from '../services/model-performance-fingerprint.service';
import { LearningLoopService } from '../services/learning-loop.service';
import { AgentBehaviorAnalyticsService } from '../services/agent-behavior-analytics.service';
import { SemanticPatternAnalyzerService } from '../services/semantic-pattern-analyzer.service';
import { GlobalBenchmarksService } from '../services/global-benchmarks.service';
import { JobsService } from '../../jobs/services/jobs.service';
import { Types } from 'mongoose';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { sanitizeModelIdsInObject } from '../../../utils/modelIdSanitizer';

@Controller('api/admin/data-network-effects')
@UseGuards(JwtAuthGuard, AdminGuard)
export class DataNetworkEffectsController {
  private readonly logger = new Logger(DataNetworkEffectsController.name);

  constructor(
    private readonly modelPerformanceService: ModelPerformanceFingerprintService,
    private readonly learningLoopService: LearningLoopService,
    private readonly agentAnalyticsService: AgentBehaviorAnalyticsService,
    private readonly semanticAnalyzerService: SemanticPatternAnalyzerService,
    private readonly globalBenchmarksService: GlobalBenchmarksService,
    private readonly jobsService: JobsService,
  ) {}

  // ============================================================================
  // MODEL PERFORMANCE FINGERPRINTS
  // ============================================================================

  /**
   * Query best models for a capability
   */
  @Get('models/best')
  async queryBestModels(
    @Query('capability') capability?: string,
    @Query('maxCostPer1KTokens') maxCostPer1KTokens?: string,
    @Query('minQualityScore') minQualityScore?: string,
    @Query('maxLatencyMs') maxLatencyMs?: string,
    @Query('minRoutingWeight') minRoutingWeight?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const models = await this.modelPerformanceService.queryBestModels({
        capability,
        maxCostPer1KTokens: maxCostPer1KTokens
          ? parseFloat(maxCostPer1KTokens)
          : undefined,
        minQualityScore: minQualityScore
          ? parseFloat(minQualityScore)
          : undefined,
        maxLatencyMs: maxLatencyMs ? parseInt(maxLatencyMs) : undefined,
        minRoutingWeight: minRoutingWeight
          ? parseFloat(minRoutingWeight)
          : undefined,
        limit: limit ? parseInt(limit) : undefined,
      });

      return {
        success: true,
        data: models,
        count: models.length,
      };
    } catch (error) {
      this.logger.error('Failed to query best models', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to query best models',
      };
    }
  }

  /**
   * Get performance trend for a model
   */
  @Get('models/:modelId/trend')
  async getPerformanceTrend(
    @Param('modelId') modelId: string,
    @Query('metric')
    metric: 'latency' | 'cost' | 'failure_rate' | 'quality' = 'cost',
  ) {
    try {
      const trend = await this.modelPerformanceService.getPerformanceTrend(
        modelId,
        metric,
      );

      if (!trend) {
        return {
          success: false,
          error: 'Performance trend not found',
        };
      }

      return {
        success: true,
        data: trend,
      };
    } catch (error) {
      this.logger.error('Failed to get performance trend', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get performance trend',
      };
    }
  }

  /**
   * Update model fingerprint manually
   */
  @Post('models/:modelId/update')
  async updateModelFingerprint(
    @Param('modelId') modelId: string,
    @Body('provider') provider: string,
  ) {
    try {
      if (!provider) {
        return {
          success: false,
          error: 'Provider is required',
        };
      }

      const fingerprint =
        await this.modelPerformanceService.updateModelFingerprint(
          modelId,
          provider,
        );

      return {
        success: true,
        data: fingerprint,
      };
    } catch (error) {
      this.logger.error('Failed to update model fingerprint', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update model fingerprint',
      };
    }
  }

  // ============================================================================
  // LEARNING LOOP
  // ============================================================================

  /**
   * Record recommendation interaction
   */
  @Post('learning-loop/interaction')
  async recordInteraction(
    @Body()
    body: {
      recommendationId: string;
      status: 'viewed' | 'accepted' | 'rejected' | 'dismissed';
      feedback?: string;
      rating?: number;
      reason?: string;
    },
  ) {
    try {
      if (!body.recommendationId || !body.status) {
        return {
          success: false,
          error: 'recommendationId and status are required',
        };
      }

      const outcome = await this.learningLoopService.recordInteraction({
        recommendationId: new Types.ObjectId(body.recommendationId),
        status: body.status,
        feedback: body.feedback,
        rating: body.rating,
        reason: body.reason,
      });

      if (!outcome) {
        return {
          success: false,
          error: 'Recommendation outcome not found',
        };
      }

      return {
        success: true,
        data: outcome,
      };
    } catch (error) {
      this.logger.error('Failed to record interaction', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to record interaction',
      };
    }
  }

  /**
   * Get learning statistics for a user
   */
  @Get('learning-loop/stats/:userId')
  async getUserLearningStats(@Param('userId') userId: string) {
    try {
      const stats = await this.learningLoopService.getUserLearningStats(userId);

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      this.logger.error('Failed to get learning stats', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get learning stats',
      };
    }
  }

  /**
   * Get general learning loop statistics
   */
  @Get('learning-loop/stats')
  async getLearningStats() {
    try {
      return {
        success: true,
        data: {
          totalRecommendations: 0,
          acceptanceRate: 0,
          avgSuccessRate: 0,
          avgUserTrust: 0.5,
          topPerformingTypes: [],
        },
      };
    } catch (error) {
      this.logger.error('Failed to get learning stats', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get learning stats',
      };
    }
  }

  /**
   * Get recent recommendation outcomes
   */
  @Get('learning-loop/outcomes/recent')
  async getRecentRecommendationOutcomes(
    @Query('userId') userId?: string,
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    try {
      const limit = limitStr ? parseInt(limitStr) : 50;
      const start = startDateStr
        ? new Date(startDateStr)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const end = endDateStr ? new Date(endDateStr) : new Date();

      const outcomes =
        await this.learningLoopService.getRecentRecommendationOutcomes({
          userId,
          startDate: start,
          endDate: end,
          limit,
        });

      return {
        success: true,
        data: outcomes,
        count: outcomes.length,
      };
    } catch (error) {
      this.logger.error('Failed to get recent outcomes', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get recent outcomes',
      };
    }
  }

  // ============================================================================
  // AGENT BEHAVIOR ANALYTICS
  // ============================================================================

  /**
   * Get agent efficiency metrics
   */
  @Get('agents/efficiency')
  async getAgentEfficiencyMetrics(
    @Query('agentId') agentId?: string,
    @Query('agentType') agentType?: string,
    @Query('userId') userId?: string,
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
  ) {
    try {
      const start = startDateStr
        ? new Date(startDateStr)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDateStr ? new Date(endDateStr) : new Date();

      const metrics =
        await this.agentAnalyticsService.getAgentEfficiencyMetrics({
          agentId,
          agentType,
          userId,
          startDate: start,
          endDate: end,
        });

      return {
        success: true,
        data: metrics,
        count: metrics.length,
      };
    } catch (error) {
      this.logger.error('Failed to get agent efficiency metrics', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get agent efficiency metrics',
      };
    }
  }

  /**
   * Detect agent patterns
   */
  @Get('agents/patterns')
  async detectPatterns(
    @Query('agentId') agentId?: string,
    @Query('userId') userId?: string,
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
    @Query('minOccurrences') minOccurrencesStr?: string,
  ) {
    try {
      const start = startDateStr
        ? new Date(startDateStr)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDateStr ? new Date(endDateStr) : new Date();

      const patterns = await this.agentAnalyticsService.detectPatterns({
        agentId,
        userId,
        startDate: start,
        endDate: end,
        minOccurrences: minOccurrencesStr
          ? parseInt(minOccurrencesStr)
          : undefined,
      });

      return {
        success: true,
        data: patterns,
        count: patterns.length,
      };
    } catch (error) {
      this.logger.error('Failed to detect agent patterns', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to detect agent patterns',
      };
    }
  }

  /**
   * Get top inefficient agents
   */
  @Get('agents/inefficient')
  async getTopInefficientAgents(@Query('limit') limitStr?: string) {
    try {
      const limit = limitStr ? parseInt(limitStr) : 10;
      const agents =
        await this.agentAnalyticsService.getTopInefficientAgents(limit);

      return {
        success: true,
        data: agents,
        count: agents.length,
      };
    } catch (error) {
      this.logger.error('Failed to get inefficient agents', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get inefficient agents',
      };
    }
  }

  /**
   * Get agent analytics summary
   */
  @Get('agents/analytics')
  async getAgentAnalytics(@Query('userId') userId?: string) {
    try {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const metrics =
        await this.agentAnalyticsService.getAgentEfficiencyMetrics({
          userId,
          startDate,
          endDate,
        });

      const totalActions = metrics.reduce(
        (sum, m) => sum + m.sampleSize * m.avgActionsPerSession,
        0,
      );
      const totalCost = metrics.reduce((sum, m) => sum + m.totalCost, 0);
      const avgSuccessRate =
        metrics.length > 0
          ? metrics.reduce((sum, m) => sum + m.avgSuccessRate, 0) /
            metrics.length
          : 0;
      const avgCostPerAction = totalActions > 0 ? totalCost / totalActions : 0;

      const byAgentType: Record<string, any> = {};
      for (const metric of metrics) {
        if (!byAgentType[metric.agentType]) {
          byAgentType[metric.agentType] = {
            totalActions: 0,
            totalCost: 0,
            successRate: 0,
            avgLatency: 0,
            count: 0,
          };
        }
        const typeData = byAgentType[metric.agentType];
        typeData.totalActions +=
          metric.sampleSize * metric.avgActionsPerSession;
        typeData.totalCost += metric.totalCost;
        typeData.successRate += metric.avgSuccessRate;
        typeData.avgLatency += metric.avgDurationMs;
        typeData.count += 1;
      }

      // Average the aggregated values
      for (const type in byAgentType) {
        const data = byAgentType[type];
        data.successRate /= data.count;
        data.avgLatency /= data.count;
      }

      return {
        success: true,
        data: {
          totalActions,
          successRate: avgSuccessRate,
          avgCostPerAction,
          patternsDetected: 0,
          byAgentType,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get agent analytics', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get agent analytics',
      };
    }
  }

  // ============================================================================
  // SEMANTIC PATTERNS
  // ============================================================================

  /**
   * Run clustering analysis
   */
  @Post('semantic/cluster')
  async runClusteringAnalysis(
    @Body()
    body: {
      startDate: string;
      endDate: string;
      userId?: string;
      tenantId?: string;
      numClusters?: number;
    },
  ) {
    try {
      const startDate = new Date(body.startDate);
      const endDate = new Date(body.endDate);

      const clusters = await this.semanticAnalyzerService.runClusteringAnalysis(
        {
          startDate,
          endDate,
          userId: body.userId,
          tenantId: body.tenantId,
          numClusters: body.numClusters,
        },
      );

      return {
        success: true,
        data: clusters,
        count: clusters.length,
      };
    } catch (error) {
      this.logger.error('Failed to run clustering analysis', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to run clustering analysis',
      };
    }
  }

  /**
   * Get high-cost clusters
   */
  @Get('semantic/high-cost')
  async getHighCostClusters(@Query('limit') limitStr?: string) {
    try {
      const limit = limitStr ? parseInt(limitStr) : 10;
      const clusters =
        await this.semanticAnalyzerService.getHighCostClusters(limit);

      return {
        success: true,
        data: clusters,
        count: clusters.length,
      };
    } catch (error) {
      this.logger.error('Failed to get high-cost clusters', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get high-cost clusters',
      };
    }
  }

  /**
   * Get clusters with high optimization potential
   */
  @Get('semantic/optimization-potential')
  async getClustersWithHighOptimizationPotential(
    @Query('limit') limitStr?: string,
  ) {
    try {
      const limit = limitStr ? parseInt(limitStr) : 10;
      const clusters =
        await this.semanticAnalyzerService.getClustersWithHighOptimizationPotential(
          limit,
        );

      return {
        success: true,
        data: clusters,
        count: clusters.length,
      };
    } catch (error) {
      this.logger.error(
        'Failed to get clusters with optimization potential',
        error,
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get optimization potential clusters',
      };
    }
  }

  /**
   * Get all semantic clusters
   */
  @Get('semantic/clusters')
  async getAllClusters() {
    try {
      const clusters = await this.semanticAnalyzerService.getAllClusters();

      return {
        success: true,
        data: clusters,
        count: clusters.length,
      };
    } catch (error) {
      this.logger.error('Failed to get semantic clusters', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get semantic clusters',
      };
    }
  }

  // ============================================================================
  // GLOBAL BENCHMARKS
  // ============================================================================

  /**
   * Get latest global benchmark
   */
  @Get('benchmarks/global')
  async getLatestGlobalBenchmark() {
    try {
      const benchmark =
        await this.globalBenchmarksService.getLatestGlobalBenchmark();

      if (!benchmark) {
        return {
          success: true,
          data: {
            metrics: {
              totalRequests: 0,
              uniqueTenants: 0,
              p50Latency: 0,
              p90Latency: 0,
              p95Latency: 0,
              avgCostPerRequest: 0,
              avgCostPer1KTokens: 0,
              successRate: 0,
              avgCacheHitRate: 0,
            },
            modelComparisons: [],
            bestPractices: [],
            timestamp: new Date().toISOString(),
          },
        };
      }

      return {
        success: true,
        data: sanitizeModelIdsInObject(benchmark),
      };
    } catch (error) {
      this.logger.error('Failed to get global benchmark', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get global benchmark',
      };
    }
  }

  /**
   * Get benchmark for a specific model
   */
  @Get('benchmarks/model/:modelId')
  async getModelBenchmark(@Param('modelId') modelId: string) {
    try {
      const benchmark =
        await this.globalBenchmarksService.getModelBenchmark(modelId);

      if (!benchmark) {
        return {
          success: false,
          error: 'Model benchmark not found',
        };
      }

      return {
        success: true,
        data: benchmark,
      };
    } catch (error) {
      this.logger.error('Failed to get model benchmark', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get model benchmark',
      };
    }
  }

  /**
   * Generate benchmarks manually
   */
  @Post('benchmarks/generate')
  async generateBenchmarks() {
    try {
      await this.globalBenchmarksService.generateAllBenchmarks();

      return {
        success: true,
        message: 'Benchmark generation started in background',
      };
    } catch (error) {
      this.logger.error('Failed to start benchmark generation', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start benchmark generation',
      };
    }
  }

  /**
   * Get all global benchmarks
   */
  @Get('benchmarks/global/all')
  async getAllGlobalBenchmarks() {
    try {
      const benchmarks =
        await this.globalBenchmarksService.getAllGlobalBenchmarks();

      return {
        success: true,
        data: benchmarks,
        count: benchmarks.length,
      };
    } catch (error) {
      this.logger.error('Failed to get global benchmarks', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get global benchmarks',
      };
    }
  }

  /**
   * Get best practices
   */
  @Get('benchmarks/best-practices')
  async getBestPractices(
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
  ) {
    try {
      const endDate = endDateStr ? new Date(endDateStr) : new Date();
      const startDate = startDateStr
        ? new Date(startDateStr)
        : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const bestPractices = await this.globalBenchmarksService.getBestPractices(
        startDate,
        endDate,
      );

      return {
        success: true,
        data: bestPractices,
      };
    } catch (error) {
      this.logger.error('Failed to get best practices', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get best practices',
      };
    }
  }

  /**
   * Compare models
   */
  @Get('benchmarks/compare')
  async compareModels(
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
  ) {
    try {
      const endDate = endDateStr ? new Date(endDateStr) : new Date();
      const startDate = startDateStr
        ? new Date(startDateStr)
        : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const modelComparisons =
        await this.globalBenchmarksService.getModelComparisons(
          startDate,
          endDate,
        );
      const benchmark =
        await this.globalBenchmarksService.getLatestGlobalBenchmark();

      return {
        success: true,
        data: {
          comparisons: modelComparisons,
          totalRequests: benchmark?.metrics?.totalRequests || 0,
          avgLatency: benchmark?.metrics?.p50Latency || 0,
          metrics: benchmark?.metrics || {
            totalRequests: 0,
            uniqueTenants: 0,
            p50Latency: 0,
            p90Latency: 0,
            p95Latency: 0,
            avgCostPerRequest: 0,
            avgCostPer1KTokens: 0,
            successRate: 0,
            avgCacheHitRate: 0,
          },
        },
      };
    } catch (error) {
      this.logger.error('Failed to compare models', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to compare models',
      };
    }
  }

  // ============================================================================
  // ADMIN / UTILITIES
  // ============================================================================

  /**
   * Run all background jobs once (admin only)
   */
  @Post('run-jobs')
  async runAllJobs() {
    try {
      this.logger.log('🔄 Triggering all background jobs manually');

      await this.jobsService.runAllJobsOnce();

      return {
        success: true,
        message: 'All jobs triggered successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to run jobs', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run jobs',
      };
    }
  }

  /**
   * Health check for Data Network Effects system
   */
  @Get('health')
  async getHealth() {
    try {
      const checks = {
        modelPerformance: true,
        learningLoop: true,
        agentAnalytics: true,
        semanticClustering: true,
        globalBenchmarks: true,
      };

      const allHealthy = Object.values(checks).every((v) => v);

      return {
        success: true,
        healthy: allHealthy,
        checks,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        healthy: false,
        error: error instanceof Error ? error.message : 'Health check failed',
      };
    }
  }
}
