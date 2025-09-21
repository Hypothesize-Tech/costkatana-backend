import { Router } from 'express';
import { EvaluationJobController } from '../controllers/evaluationJob.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Evaluation job routes
router.post('/jobs', asyncHandler(EvaluationJobController.createEvaluationJob));
router.get('/jobs', asyncHandler(EvaluationJobController.getUserEvaluationJobs));
router.get('/jobs/fine-tune/:fineTuneJobId', asyncHandler(EvaluationJobController.getEvaluationsByFineTuneJob));
router.get('/jobs/:jobId', asyncHandler(EvaluationJobController.getEvaluationJob));
router.delete('/jobs/:jobId', asyncHandler(EvaluationJobController.deleteEvaluationJob));

export default router;
