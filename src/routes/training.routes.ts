import { Router } from 'express';
import { RequestScoringController } from '../controllers/requestScoring.controller';
import { TrainingDatasetController } from '../controllers/trainingDataset.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All training routes require authentication
router.use(authenticate);

// ============================================
// REQUEST SCORING ROUTES
// ============================================

// Score a request for training quality
router.post('/score', asyncHandler(RequestScoringController.scoreRequest));

// Get score for a specific request
router.get('/score/:requestId', asyncHandler(RequestScoringController.getRequestScore));

// Get all scores for the authenticated user
router.get('/scores', asyncHandler(RequestScoringController.getUserScores));

// Get training candidates (high-scoring requests)
router.get('/candidates', asyncHandler(RequestScoringController.getTrainingCandidates));

// Get scoring analytics
router.get('/analytics', asyncHandler(RequestScoringController.getScoringAnalytics));

// Bulk score multiple requests
router.post('/score/bulk', asyncHandler(RequestScoringController.bulkScoreRequests));

// Delete a request score
router.delete('/score/:requestId', asyncHandler(RequestScoringController.deleteScore));

// ============================================
// TRAINING DATASET ROUTES
// ============================================

// Create a new training dataset
router.post('/datasets', asyncHandler(TrainingDatasetController.createDataset));

// Get all datasets for the authenticated user
router.get('/datasets', asyncHandler(TrainingDatasetController.getUserDatasets));

// Get a specific dataset
router.get('/datasets/:datasetId', asyncHandler(TrainingDatasetController.getDataset));

// Update dataset configuration
router.put('/datasets/:datasetId', asyncHandler(TrainingDatasetController.updateDataset));

// Delete a dataset
router.delete('/datasets/:datasetId', asyncHandler(TrainingDatasetController.deleteDataset));

// Auto-populate dataset with high-scoring requests
router.post('/datasets/:datasetId/populate', asyncHandler(TrainingDatasetController.populateDataset));

// Add requests to dataset manually
router.post('/datasets/:datasetId/requests', asyncHandler(TrainingDatasetController.addRequestsToDataset));

// Remove requests from dataset
router.delete('/datasets/:datasetId/requests', asyncHandler(TrainingDatasetController.removeRequestsFromDataset));

// Get dataset export preview
router.get('/datasets/:datasetId/preview', asyncHandler(TrainingDatasetController.previewDataset));

// Export dataset in specified format
router.post('/datasets/:datasetId/export', asyncHandler(TrainingDatasetController.exportDataset));

export default router;