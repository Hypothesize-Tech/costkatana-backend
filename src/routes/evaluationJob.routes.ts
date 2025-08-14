import { Router } from 'express';
import { EvaluationJobController } from '../controllers/evaluationJob.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Evaluation job routes
router.post('/', asyncHandler(EvaluationJobController.createEvaluationJob));
router.get('/', asyncHandler(EvaluationJobController.getUserEvaluationJobs));
router.get('/fine-tune/:fineTuneJobId', asyncHandler(EvaluationJobController.getEvaluationsByFineTuneJob));
router.get('/:jobId', asyncHandler(EvaluationJobController.getEvaluationJob));
router.delete('/:jobId', asyncHandler(EvaluationJobController.deleteEvaluationJob));

export default router;
