import express from 'express';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';

const router = express.Router();

/**
 * Track email open via transparent pixel
 */
router.get('/track/open/:userId/:emailId', async (req, res) => {
    try {
        const { userId, emailId } = req.params;
        
        await User.findByIdAndUpdate(userId, {
            $inc: { 'preferences.emailEngagement.totalOpened': 1 },
            $set: { 
                'preferences.emailEngagement.lastOpened': new Date(),
                'preferences.emailEngagement.consecutiveIgnored': 0
            }
        });
        
        loggingService.info('Email opened', { userId, emailId });
        
        // Return 1x1 transparent pixel
        const pixel = Buffer.from(
            'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            'base64'
        );
        res.writeHead(200, {
            'Content-Type': 'image/gif',
            'Content-Length': pixel.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, private'
        });
        res.end(pixel);
    } catch (error) {
        loggingService.error('Error tracking email open:', { 
            error: error instanceof Error ? error.message : String(error)
        });
        res.status(200).end();
    }
});

/**
 * Track email link clicks and redirect
 */
router.get('/track/click/:userId/:emailId', async (req, res) => {
    try {
        const { userId, emailId } = req.params;
        const { url } = req.query;
        
        await User.findByIdAndUpdate(userId, {
            $inc: { 'preferences.emailEngagement.totalClicked': 1 },
            $set: { 
                'preferences.emailEngagement.lastOpened': new Date(),
                'preferences.emailEngagement.consecutiveIgnored': 0
            }
        });
        
        loggingService.info('Email link clicked', { userId, emailId, url });
        
        if (url && typeof url === 'string') {
            res.redirect(url);
        } else {
            res.redirect(process.env.FRONTEND_URL || 'https://costkatana.com');
        }
    } catch (error) {
        loggingService.error('Error tracking email click:', { 
            error: error instanceof Error ? error.message : String(error)
        });
        res.redirect(process.env.FRONTEND_URL || 'https://costkatana.com');
    }
});

export default router;

