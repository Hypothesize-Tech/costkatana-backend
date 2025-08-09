import { Router } from 'express';
import { ForecastingController } from '../controllers/forecasting.controller';
import { authenticate } from '../middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Forecast generation
router.post('/generate', ForecastingController.generateCostForecast);
router.post('/budget-utilization', ForecastingController.getBudgetUtilizationForecast);

// Predictive alerts
router.post('/alerts', ForecastingController.getPredictiveAlerts);

// Pattern analysis
router.get('/patterns', ForecastingController.analyzeSpendingPatterns);
router.get('/seasonal', ForecastingController.getSeasonalAnalysis);
router.get('/anomalies', ForecastingController.getCostAnomalies);

// Model accuracy and reliability
router.get('/accuracy', ForecastingController.getForecastAccuracy);

export default router; 