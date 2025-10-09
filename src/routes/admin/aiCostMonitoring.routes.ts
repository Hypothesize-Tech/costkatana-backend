import express from 'express';
import { AICostTrackingService } from '../../services/aiCostTracking.service';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = express.Router();

/**
 * Get monthly AI cost summary
 */
router.get('/summary/monthly', authenticate, authorize('admin'), async (req, res) => {
    try {
        const summary = AICostTrackingService.getMonthlySummary();
        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get summary'
        });
    }
});

/**
 * Get custom date range summary
 */
router.get('/summary/range', authenticate, authorize('admin'), async (req, res): Promise<void> => {
    try {
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) {
            res.status(400).json({
                success: false,
                error: 'startDate and endDate are required'
            });
            return;
        }
        
        const summary = AICostTrackingService.getSummary(
            new Date(startDate as string),
            new Date(endDate as string)
        );
        
        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get summary'
        });
    }
});

/**
 * Clear old records
 */
router.post('/cleanup', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { daysToKeep = 30 } = req.body;
        AICostTrackingService.clearOldRecords(daysToKeep);
        
        res.json({
            success: true,
            message: `Cleared records older than ${daysToKeep} days`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to cleanup records'
        });
    }
});

export default router;

