import { Router } from 'express';
import { fileUploadController, uploadMiddleware } from '../controllers/fileUpload.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/files/upload
 * @desc    Upload a file
 * @access  Private
 */
router.post('/upload', uploadMiddleware, (req, res) => 
    fileUploadController.uploadFile(req, res)
);

/**
 * @route   DELETE /api/files/:fileId
 * @desc    Delete a file
 * @access  Private
 */
router.delete('/:fileId', (req, res) => 
    fileUploadController.deleteFile(req, res)
);

/**
 * @route   GET /api/files
 * @desc    Get user's uploaded files
 * @access  Private
 */
router.get('/', (req, res) => 
    fileUploadController.getUserFiles(req, res)
);

export default router;

