import { Router } from 'express';
import { PerformanceCostAnalysisController } from '../controllers/performanceCostAnalysis.controller';
import { authenticate } from '../middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Cost-performance correlation analysis
router.post('/analyze', PerformanceCostAnalysisController.analyzeCostPerformanceCorrelation);
router.post('/compare', PerformanceCostAnalysisController.compareServices);

// Performance trends and metrics
router.get('/trends', PerformanceCostAnalysisController.getPerformanceTrends);
router.get('/detailed-metrics', PerformanceCostAnalysisController.getDetailedMetrics);
router.get('/efficiency-score', PerformanceCostAnalysisController.getEfficiencyScore);

// Optimization and visualization
router.post('/optimization-opportunities', PerformanceCostAnalysisController.identifyOptimizationOpportunities);
router.get('/heatmap', PerformanceCostAnalysisController.getPerformanceHeatmap);
router.post('/tradeoff-analysis', PerformanceCostAnalysisController.getTradeoffAnalysis);

export default router; 