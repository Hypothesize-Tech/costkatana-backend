import { Router, Request, Response } from 'express';
import { backupScheduler } from '../services/backupScheduler';
import { loggingService } from '../services/logging.service';

const router = Router();

/**
 * GET /api/backup/status
 * Get backup scheduler status and statistics
 */
router.get('/status', (_req: Request, res: Response): void => {
  void (async () => {
    try {
      const status = backupScheduler.getStatus();
      const stats = await backupScheduler.getBackupStats();
      
      res.json({
        success: true,
        data: {
          scheduler: status,
          statistics: stats
        }
      });
    } catch (error) {
      loggingService.error('Failed to get backup status', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get backup status'
      });
    }
  })();
});

/**
 * POST /api/backup/start
 * Start the backup scheduler
 */
router.post('/start', (req: Request, res: Response): void => {
  try {
    backupScheduler.start();
    
    res.json({
      success: true,
      message: 'Backup scheduler started'
    });
  } catch (error) {
    loggingService.error('Failed to start backup scheduler', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to start backup scheduler'
    });
  }
});

/**
 * POST /api/backup/stop
 * Stop the backup scheduler
 */
router.post('/stop', (req: Request, res: Response): void => {
  try {
    backupScheduler.stop();
    
    res.json({
      success: true,
      message: 'Backup scheduler stopped'
    });
  } catch (error) {
    loggingService.error('Failed to stop backup scheduler', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to stop backup scheduler'
    });
  }
});

/**
 * POST /api/backup/trigger
 * Trigger an immediate backup
 */
router.post('/trigger', (req: Request, res: Response): void => {
  void (async () => {
    try {
      const result = await backupScheduler.performImmediateBackup();
      
      res.json({
        success: true,
        message: 'Immediate backup completed',
        data: result
      });
    } catch (error) {
      loggingService.error('Failed to trigger immediate backup', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger backup'
      });
    }
  })();
});

/**
 * GET /api/backup/stats
 * Get backup statistics
 */
router.get('/stats', (req: Request, res: Response): void => {
  void (async () => {
    try {
      const stats = await backupScheduler.getBackupStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      loggingService.error('Failed to get backup statistics', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get backup statistics'
      });
    }
  })();
});

export default router;
