import { Router } from 'express';
import { InferenceScalingController } from '../controllers/inferenceScaling.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Demand Prediction Routes
router.get('/demand/predictions', InferenceScalingController.getDemandPredictions);
router.get('/demand/predictions/:modelId', InferenceScalingController.getModelDemandPrediction);
router.get('/demand/history/:modelId', InferenceScalingController.getModelDemandHistory);

// Cost-Performance Routes
router.get('/configurations/:modelType', InferenceScalingController.getServingConfigurations);
router.get('/configurations/model/:modelId', InferenceScalingController.getModelConfiguration);
router.post('/analyze/:modelId', InferenceScalingController.analyzeCostPerformance);
router.post('/cost/calculate', InferenceScalingController.calculateCost);

// Recommendation Routes
router.get('/recommendations', InferenceScalingController.getScalingRecommendations);
router.get('/alerts', InferenceScalingController.getAlerts);
router.post('/recommendations/:recommendationId/execute', InferenceScalingController.executeRecommendation);

// Dashboard Route
router.get('/dashboard', InferenceScalingController.getDashboardOverview);

export { router as inferenceScalingRoutes }; 