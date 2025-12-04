import { Request, Response, NextFunction } from 'express';
import { UserSessionService } from '../services/userSession.service';
import { loggingService } from '../services/logging.service';

/**
 * Middleware to update user session activity on authenticated requests
 */
export const trackUserSessionActivity = (req: Request, _res: Response, next: NextFunction): void => {
    try {
        // Skip for certain routes
        const skipRoutes = [
            '/health',
            '/metrics',
            '/favicon.ico',
            '/static',
            '/assets',
            '/auth/refresh', // Skip refresh endpoint to avoid loops
            '/auth/login', // Skip login endpoint
            '/auth/logout' // Skip logout endpoint
        ];
        
        const shouldSkip = skipRoutes.some(route => req.path.startsWith(route));
        if (shouldSkip) {
            next();
            return;
        }

        // Only track if user is authenticated
        const user = (req as { user?: { jti?: string } }).user;
        if (!user) {
            next();
            return;
        }

        // Get userSessionId from JWT token (jti field)
        const userSessionId = UserSessionService.getCurrentUserSessionId(req);
        
        if (userSessionId) {
            // Update session activity asynchronously (don't block request)
            UserSessionService.updateUserSessionActivity(userSessionId).catch(error => {
                // Fail silently - activity updates shouldn't break requests
                loggingService.debug('Error updating user session activity', {
                    component: 'UserSessionMiddleware',
                    operation: 'trackUserSessionActivity',
                    userSessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        }

        next();
    } catch (error) {
        // Don't block request if middleware fails
        loggingService.debug('Error in user session tracking middleware', {
            component: 'UserSessionMiddleware',
            operation: 'trackUserSessionActivity',
            error: error instanceof Error ? error.message : String(error)
        });
        next();
    }
};

