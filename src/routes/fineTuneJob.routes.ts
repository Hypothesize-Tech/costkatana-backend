import { Router } from 'express';
import { FineTuneJobController } from '../controllers/fineTuneJob.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { body, param } from 'express-validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Fine-tune job routes
router.post('/jobs', 
    [
        body('name').isString().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
        body('datasetId').isMongoId().withMessage('Valid dataset ID is required'),
        body('baseModel').isString().isLength({ min: 1 }).withMessage('Base model is required'),
        body('provider').isIn(['openai', 'anthropic', 'aws-bedrock', 'azure', 'cohere', 'huggingface']).withMessage('Invalid provider'),
        body('description').optional().isString().isLength({ max: 500 }).withMessage('Description must be max 500 characters'),
        body('hyperparameters').optional().isObject().withMessage('Hyperparameters must be an object'),
        body('providerConfig').optional().isObject().withMessage('Provider config must be an object')
    ],
    validateRequest,
    FineTuneJobController.createFineTuneJob
);

router.get('/jobs', FineTuneJobController.getUserFineTuneJobs);

router.get('/jobs/:jobId', 
    [param('jobId').isMongoId().withMessage('Valid job ID is required')],
    validateRequest,
    FineTuneJobController.getFineTuneJob
);

router.post('/jobs/:jobId/cancel',
    [param('jobId').isMongoId().withMessage('Valid job ID is required')],
    validateRequest,
    FineTuneJobController.cancelFineTuneJob
);

router.get('/jobs/:jobId/status',
    [param('jobId').isMongoId().withMessage('Valid job ID is required')],
    validateRequest,
    FineTuneJobController.getJobStatus
);

router.get('/jobs/:jobId/metrics',
    [param('jobId').isMongoId().withMessage('Valid job ID is required')],
    validateRequest,
    FineTuneJobController.getJobMetrics
);

router.delete('/jobs/:jobId',
    [param('jobId').isMongoId().withMessage('Valid job ID is required')],
    validateRequest,
    FineTuneJobController.deleteFineTuneJob
);

// Provider and utility routes
router.get('/providers', FineTuneJobController.getSupportedProviders);

router.post('/estimate-cost',
    [
        body('provider').isIn(['openai', 'anthropic', 'aws-bedrock', 'azure', 'cohere', 'huggingface']).withMessage('Invalid provider'),
        body('baseModel').isString().isLength({ min: 1 }).withMessage('Base model is required'),
        body('datasetId').isMongoId().withMessage('Valid dataset ID is required')
    ],
    validateRequest,
    FineTuneJobController.estimateCost
);

export default router;
