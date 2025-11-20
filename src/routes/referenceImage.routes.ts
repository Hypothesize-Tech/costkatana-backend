import express from 'express';
import multer from 'multer';
import { ReferenceImageController } from '../controllers/referenceImage.controller';
import { authenticate } from '../middleware/auth.middleware';
import { body } from 'express-validator';
import { validateRequest } from '../middleware/validation.middleware';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
        // Accept images only
        if (!file.mimetype.startsWith('image/')) {
            cb(new Error('Only image files are allowed'));
            return;
        }
        cb(null, true);
    }
});

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/reference-image/presigned-url
 * Get presigned URL for viewing reference image
 */
router.get(
    '/presigned-url',
    ReferenceImageController.getPresignedUrl
);

/**
 * POST /api/reference-image/pre-upload
 * Pre-upload reference image before template creation
 */
router.post(
    '/pre-upload',
    upload.single('image'),
    ReferenceImageController.preUploadReferenceImage
);

/**
 * POST /api/templates/:templateId/reference-image/upload
 * Upload reference image for a template
 */
router.post(
    '/:templateId/reference-image/upload',
    upload.single('image'),
    ReferenceImageController.uploadReferenceImage
);

/**
 * POST /api/templates/:templateId/reference-image/extract
 * Manually trigger feature extraction
 */
router.post(
    '/:templateId/reference-image/extract',
    [
        body('forceRefresh').optional().isBoolean().withMessage('forceRefresh must be a boolean')
    ],
    validateRequest,
    ReferenceImageController.triggerExtraction
);

/**
 * GET /api/templates/:templateId/reference-image/status
 * Get extraction status
 */
router.get(
    '/:templateId/reference-image/status',
    ReferenceImageController.getExtractionStatus
);

/**
 * GET /api/templates/:templateId/reference-image/features
 * Get extracted features
 */
router.get(
    '/:templateId/reference-image/features',
    ReferenceImageController.getExtractedFeatures
);

/**
 * DELETE /api/templates/:templateId/reference-image
 * Delete reference image
 */
router.delete(
    '/:templateId/reference-image',
    ReferenceImageController.deleteReferenceImage
);

/**
 * GET /api/templates/:templateId/reference-image/cost-savings
 * Get cost savings statistics
 */
router.get(
    '/:templateId/reference-image/cost-savings',
    ReferenceImageController.getCostSavings
);

export default router;

