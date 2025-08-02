import { Router } from 'express';
import { ExperimentationController } from '../controllers/experimentation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// SSE endpoint (no auth required for EventSource)
router.get('/comparison-progress/:sessionId', ExperimentationController.streamComparisonProgress);

// Apply authentication middleware to all other routes
router.use(authenticate);

// Available models
router.get('/available-models', ExperimentationController.getAvailableModels);

// Experiment history
router.get('/history', ExperimentationController.getExperimentHistory);

// Model comparison
router.post('/model-comparison', ExperimentationController.runModelComparison);

// Real-time model comparison with Bedrock
router.post('/real-time-comparison', ExperimentationController.startRealTimeComparison);

// Cost estimation
router.post('/estimate-cost', ExperimentationController.estimateExperimentCost);

// Experiment recommendations (userId from req.user)
router.get('/recommendations', ExperimentationController.getExperimentRecommendations);

// What-If Scenarios routes
router.get('/what-if-scenarios', ExperimentationController.getWhatIfScenarios);
router.post('/what-if-scenarios', ExperimentationController.createWhatIfScenario);
router.post('/what-if-scenarios/:scenarioName/analyze', ExperimentationController.runWhatIfAnalysis);
router.delete('/what-if-scenarios/:scenarioName', ExperimentationController.deleteWhatIfScenario);

// Real-time What-If Cost Simulator
router.post('/real-time-simulation', ExperimentationController.runRealTimeSimulation);

// Individual experiment operations (keep these last to avoid route conflicts)
router.get('/:experimentId', ExperimentationController.getExperimentById);
router.delete('/:experimentId', ExperimentationController.deleteExperiment);

export default router; 