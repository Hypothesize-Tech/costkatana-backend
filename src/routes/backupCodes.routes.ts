import { Router } from 'express';
import { BackupCodesController } from '../controllers/backupCodes.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

/**
 * Backup Codes Routes
 * All routes require authentication
 */

// Generate new backup codes (requires password verification)
router.post('/generate', authenticate, BackupCodesController.generateBackupCodes);

// Verify user password
router.post('/verify-password', authenticate, BackupCodesController.verifyPassword);

// Get backup codes metadata (count, last generated date)
router.get('/metadata', authenticate, BackupCodesController.getBackupCodesMetadata);

export default router;


