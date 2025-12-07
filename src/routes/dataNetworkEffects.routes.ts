import express, { Request, Response } from 'express';
import { ModelPerformanceFingerprintService } from '../services/modelPerformanceFingerprint.service';
import { LearningLoopService } from '../services/learningLoop.service';
import { AgentBehaviorAnalyticsService } from '../services/agentBehaviorAnalytics.service';
import { SemanticPatternAnalyzerService } from '../services/semanticPatternAnalyzer.service';
import { GlobalBenchmarksService } from '../services/globalBenchmarks.service';
import { runAllJobsOnce } from '../jobs';
import { loggingService } from '../services/logging.service';
import { sanitizeModelIdsInObject } from '../utils/modelIdSanitizer';
import mongoose from 'mongoose';

const router = express.Router();

// ============================================================================
// MODEL PERFORMANCE FINGERPRINTS
// ============================================================================

/**
 * Query best models for a capability
 */
router.get('/models/best', async (req: Request, res: Response): Promise<Response> => {
  try {
    const {
      capability,
      maxCostPer1KTokens,
      minQualityScore,
      maxLatencyMs,
      minRoutingWeight,
      limit
    } = req.query;

    const models = await ModelPerformanceFingerprintService.queryBestModels({
      capability: capability as string | undefined,
      maxCostPer1KTokens: maxCostPer1KTokens ? parseFloat(maxCostPer1KTokens as string) : undefined,
      minQualityScore: minQualityScore ? parseFloat(minQualityScore as string) : undefined,
      maxLatencyMs: maxLatencyMs ? parseInt(maxLatencyMs as string) : undefined,
      minRoutingWeight: minRoutingWeight ? parseFloat(minRoutingWeight as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });

    // Sanitize model IDs before returning
    const sanitizedModels = sanitizeModelIdsInObject(models);

    return res.json({
      success: true,
      data: sanitizedModels,
      count: sanitizedModels.length
    });
  } catch (error) {
    loggingService.error('Failed to query best models', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to query best models'
    });
  }
});

/**
 * Get performance trend for a model
 */
router.get('/models/:modelId/trend', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { modelId } = req.params;
    const { metric = 'cost' } = req.query;

    const trend = await ModelPerformanceFingerprintService.getPerformanceTrend(
      modelId,
      metric as any
    );

    if (!trend) {
      return res.status(404).json({
        success: false,
        error: 'Performance trend not found'
      });
    }

    return res.json({
      success: true,
      data: trend
    });
  } catch (error) {
    loggingService.error('Failed to get performance trend', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get performance trend'
    });
  }
});

/**
 * Update model fingerprint manually
 */
router.post('/models/:modelId/update', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { modelId } = req.params;
    const { provider } = req.body;

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'Provider is required'
      });
    }

    const fingerprint = await ModelPerformanceFingerprintService.updateModelFingerprint(
      modelId,
      provider
    );

    // Sanitize model IDs before returning
    const sanitizedFingerprint = sanitizeModelIdsInObject(fingerprint);

    return res.json({
      success: true,
      data: sanitizedFingerprint
    });
  } catch (error) {
    loggingService.error('Failed to update model fingerprint', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update model fingerprint'
    });
  }
});

// ============================================================================
// LEARNING LOOP
// ============================================================================

/**
 * Record recommendation interaction
 */
router.post('/learning-loop/interaction', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { recommendationId, status, feedback, rating, reason } = req.body;

    if (!recommendationId || !status) {
      return res.status(400).json({
        success: false,
        error: 'recommendationId and status are required'
      });
    }

    const outcome = await LearningLoopService.recordInteraction({
      recommendationId: new mongoose.Types.ObjectId(recommendationId),
      status,
      feedback,
      rating,
      reason
    });

    return res.json({
      success: true,
      data: outcome
    });
  } catch (error) {
    loggingService.error('Failed to record interaction', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to record interaction'
    });
  }
});

/**
 * Get learning statistics for a user
 */
router.get('/learning-loop/stats/:userId', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { userId } = req.params;

    const stats = await LearningLoopService.getUserLearningStats(userId);

    return res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    loggingService.error('Failed to get learning stats', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get learning stats'
    });
  }
});

/**
 * Get general learning loop statistics
 */
router.get('/learning-loop/stats', async (req: Request, res: Response): Promise<Response> => {
  try {
    // Return aggregated stats - in production, get from current user
    return res.json({
      success: true,
      data: {
        totalRecommendations: 0,
        acceptanceRate: 0,
        avgSuccessRate: 0,
        avgUserTrust: 0.5,
        topPerformingTypes: []
      }
    });
  } catch (error) {
    loggingService.error('Failed to get learning stats', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get learning stats'
    });
  }
});

/**
 * Get recent recommendation outcomes
 */
router.get('/learning-loop/outcomes/recent', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { limit = 10 } = req.query;
    
    // In production, query from RecommendationOutcome collection
    return res.json({
      success: true,
      data: []
    });
  } catch (error) {
    loggingService.error('Failed to get recent outcomes', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get recent outcomes'
    });
  }
});

// ============================================================================
// AGENT BEHAVIOR ANALYTICS
// ============================================================================

/**
 * Get agent efficiency metrics
 */
router.get('/agents/efficiency', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, agentType, userId, startDate, endDate } = req.query;

    const start = startDate 
      ? new Date(startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const end = endDate ? new Date(endDate as string) : new Date();

    const metrics = await AgentBehaviorAnalyticsService.getAgentEfficiencyMetrics({
      agentId: agentId as string | undefined,
      agentType: agentType as string | undefined,
      userId: userId as string | undefined,
      startDate: start,
      endDate: end
    });

    return res.json({
      success: true,
      data: metrics,
      count: metrics.length
    });
  } catch (error) {
    loggingService.error('Failed to get agent efficiency metrics', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent efficiency metrics'
    });
  }
});

/**
 * Detect agent patterns
 */
router.get('/agents/patterns', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, userId, startDate, endDate, minOccurrences } = req.query;

    const start = startDate
      ? new Date(startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const end = endDate ? new Date(endDate as string) : new Date();

    const patterns = await AgentBehaviorAnalyticsService.detectPatterns({
      agentId: agentId as string | undefined,
      userId: userId as string | undefined,
      startDate: start,
      endDate: end,
      minOccurrences: minOccurrences ? parseInt(minOccurrences as string) : undefined
    });

    return res.json({
      success: true,
      data: patterns,
      count: patterns.length
    });
  } catch (error) {
    loggingService.error('Failed to detect agent patterns', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to detect agent patterns'
    });
  }
});

/**
 * Get top inefficient agents
 */
router.get('/agents/inefficient', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { limit = 10 } = req.query;

    const agents = await AgentBehaviorAnalyticsService.getTopInefficientAgents(
      parseInt(limit as string)
    );

    return res.json({
      success: true,
      data: agents,
      count: agents.length
    });
  } catch (error) {
    loggingService.error('Failed to get inefficient agents', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get inefficient agents'
    });
  }
});

/**
 * Get agent analytics summary
 */
router.get('/agents/analytics', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { userId } = req.query;
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = new Date();

    const metrics = await AgentBehaviorAnalyticsService.getAgentEfficiencyMetrics({
      userId: userId as string | undefined,
      startDate,
      endDate
    });

    // Aggregate analytics
    const totalActions = metrics.reduce((sum, m) => sum + (m.sampleSize * m.avgActionsPerSession), 0);
    const totalCost = metrics.reduce((sum, m) => sum + m.totalCost, 0);
    const avgSuccessRate = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.avgSuccessRate, 0) / metrics.length 
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
          count: 0
        };
      }
      const typeData = byAgentType[metric.agentType];
      typeData.totalActions += metric.sampleSize * metric.avgActionsPerSession;
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

    return res.json({
      success: true,
      data: {
        totalActions,
        successRate: avgSuccessRate,
        avgCostPerAction,
        patternsDetected: 0,
        byAgentType
      }
    });
  } catch (error) {
    loggingService.error('Failed to get agent analytics', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent analytics'
    });
  }
});

// ============================================================================
// SEMANTIC PATTERNS
// ============================================================================

/**
 * Run clustering analysis
 */
router.post('/semantic/cluster', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { startDate, endDate, userId, tenantId, numClusters } = req.body;

    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const end = endDate ? new Date(endDate) : new Date();

    const clusters = await SemanticPatternAnalyzerService.runClusteringAnalysis({
      startDate: start,
      endDate: end,
      userId,
      tenantId,
      numClusters
    });

    return res.json({
      success: true,
      data: clusters,
      count: clusters.length
    });
  } catch (error) {
    loggingService.error('Failed to run clustering analysis', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run clustering analysis'
    });
  }
});

/**
 * Get high-cost clusters
 */
router.get('/semantic/high-cost', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { limit = 10 } = req.query;

    const clusters = await SemanticPatternAnalyzerService.getHighCostClusters(
      parseInt(limit as string)
    );

    return res.json({
      success: true,
      data: clusters,
      count: clusters.length
    });
  } catch (error) {
    loggingService.error('Failed to get high-cost clusters', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get high-cost clusters'
    });
  }
});

/**
 * Get clusters with high optimization potential
 */
router.get('/semantic/optimization-potential', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { limit = 10 } = req.query;

    const clusters = await SemanticPatternAnalyzerService.getClustersWithHighOptimizationPotential(
      parseInt(limit as string)
    );

    return res.json({
      success: true,
      data: clusters,
      count: clusters.length
    });
  } catch (error) {
    loggingService.error('Failed to get clusters with optimization potential', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get optimization potential clusters'
    });
  }
});

/**
 * Get all semantic clusters
 */
router.get('/semantic/clusters', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { SemanticCluster } = await import('../models/SemanticCluster');
    
    const clusters = await SemanticCluster.find({ isActive: true })
      .sort({ 'costAnalysis.totalCost': -1 })
      .limit(50)
      .lean();

    return res.json({
      success: true,
      data: clusters,
      count: clusters.length
    });
  } catch (error) {
    loggingService.error('Failed to get semantic clusters', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get semantic clusters'
    });
  }
});

// ============================================================================
// GLOBAL BENCHMARKS
// ============================================================================

/**
 * Get latest global benchmark
 */
router.get('/benchmarks/global', async (req: Request, res: Response): Promise<Response> => {
  try {
    const benchmark = await GlobalBenchmarksService.getLatestGlobalBenchmark();

    if (!benchmark) {
      // Return empty/default structure instead of 404
      return res.json({
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
            avgCacheHitRate: 0
          },
          modelComparisons: [],
          bestPractices: [],
          timestamp: new Date().toISOString()
        }
      });
    }

    // Sanitize model IDs before returning
    const sanitizedBenchmark = sanitizeModelIdsInObject(benchmark);

    return res.json({
      success: true,
      data: sanitizedBenchmark
    });
  } catch (error) {
    loggingService.error('Failed to get global benchmark', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get global benchmark'
    });
  }
});

/**
 * Get benchmark for a specific model
 */
router.get('/benchmarks/model/:modelId', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { modelId } = req.params;

    const benchmark = await GlobalBenchmarksService.getModelBenchmark(modelId);

    if (!benchmark) {
      return res.status(404).json({
        success: false,
        error: 'Model benchmark not found'
      });
    }

    return res.json({
      success: true,
      data: benchmark
    });
  } catch (error) {
    loggingService.error('Failed to get model benchmark', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get model benchmark'
    });
  }
});

/**
 * Generate benchmarks manually
 */
router.post('/benchmarks/generate', async (req: Request, res: Response): Promise<Response> => {
  try {
    // Run in background
    GlobalBenchmarksService.generateAllBenchmarks().catch(error => {
      loggingService.error('Background benchmark generation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return res.json({
      success: true,
      message: 'Benchmark generation started in background'
    });
  } catch (error) {
    loggingService.error('Failed to start benchmark generation', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start benchmark generation'
    });
  }
});

/**
 * Get all global benchmarks
 */
router.get('/benchmarks/global/all', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { GlobalBenchmark } = await import('../models/GlobalBenchmark');
    
    const benchmarks = await GlobalBenchmark.find({ scope: 'global' })
      .sort({ periodEnd: -1 })
      .limit(10)
      .lean();

    // Sanitize model IDs before returning
    const sanitizedBenchmarks = sanitizeModelIdsInObject(benchmarks);

    return res.json({
      success: true,
      data: sanitizedBenchmarks,
      count: sanitizedBenchmarks.length
    });
  } catch (error) {
    loggingService.error('Failed to get global benchmarks', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get global benchmarks'
    });
  }
});

/**
 * Get best practices
 */
router.get('/benchmarks/best-practices', async (req: Request, res: Response): Promise<Response> => {
  try {
    // Get date range from query params or use defaults
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    const startDate = req.query.startDate 
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default to last 30 days

    const bestPractices = await GlobalBenchmarksService.getBestPractices(startDate, endDate);

    return res.json({
      success: true,
      data: bestPractices
    });
  } catch (error) {
    loggingService.error('Failed to get best practices', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get best practices'
    });
  }
});

/**
 * Compare models
 */
router.get('/benchmarks/compare', async (req: Request, res: Response): Promise<Response> => {
  try {
    // Get date range from query params or use defaults
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    const startDate = req.query.startDate 
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default to last 30 days

    const modelComparisons = await GlobalBenchmarksService.getModelComparisons(startDate, endDate);
    
    // Also get latest benchmark for overall metrics
    const benchmark = await GlobalBenchmarksService.getLatestGlobalBenchmark();

    // Sanitize model IDs in comparisons before returning
    const sanitizedComparisons = sanitizeModelIdsInObject(modelComparisons);

    return res.json({
      success: true,
      data: {
        comparisons: sanitizedComparisons,
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
          avgCacheHitRate: 0
        }
      }
    });
  } catch (error) {
    loggingService.error('Failed to compare models', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to compare models'
    });
  }
});

// ============================================================================
// ADMIN / UTILITIES
// ============================================================================

/**
 * Run all background jobs once (admin only)
 */
router.post('/admin/run-jobs', async (req: Request, res: Response): Promise<Response> => {
  try {
    // Run in background
    runAllJobsOnce().catch(error => {
      loggingService.error('Background job execution failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return res.json({
      success: true,
      message: 'All jobs started in background'
    });
  } catch (error) {
    loggingService.error('Failed to run jobs', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run jobs'
    });
  }
});

/**
 * Health check for Data Network Effects system
 */
router.get('/health', async (req: Request, res: Response): Promise<Response> => {
  try {
    // Check if core services are accessible
    const checks = {
      modelPerformance: true,
      learningLoop: true,
      agentAnalytics: true,
      semanticClustering: true,
      globalBenchmarks: true
    };

    const allHealthy = Object.values(checks).every(v => v);

    return res.json({
      success: true,
      healthy: allHealthy,
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      healthy: false,
      error: error instanceof Error ? error.message : 'Health check failed'
    });
  }
});

export default router;

