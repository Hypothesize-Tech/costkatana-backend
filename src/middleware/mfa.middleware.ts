import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { logger } from '../utils/logger';
import { User } from '../models/User';

/**
 * Middleware to authenticate both MFA tokens and regular access tokens
 * This handles both login flow (MFA tokens) and setup flow (access tokens)
 */
export const authenticateMFA = async (
    req: any,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        logger.info('=== MFA AUTHENTICATION MIDDLEWARE STARTED ===');
        logger.info('Request path:', req.path);
        logger.info('Request method:', req.method);

        // Extract token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logger.warn('No Authorization header or invalid format');
            res.status(401).json({
                success: false,
                message: 'No authentication provided',
            });
            return;
        }

        const token = authHeader.substring(7);
        logger.info('Token extracted from header');

        let user: any = null;

        // Try MFA token first (for login flow)
        try {
            const payload = AuthService.verifyMFAToken(token);
            logger.info('MFA token verified successfully:', {
                userId: payload.userId
            });

            user = await User.findById(payload.userId);
            if (user) {
                logger.info('User found via MFA token:', {
                    userId: user._id,
                    email: user.email
                });
            }
        } catch (mfaError) {
            logger.info('Not an MFA token, trying regular access token');
            
            // Try regular access token (for setup flow)
            try {
                const payload = AuthService.verifyAccessToken(token);
                logger.info('Access token verified successfully:', {
                    userId: payload.id
                });

                user = await User.findById(payload.id);
                if (user) {
                    logger.info('User found via access token:', {
                        userId: user._id,
                        email: user.email
                    });
                }
            } catch (accessError) {
                logger.warn('Both MFA and access token verification failed');
                res.status(401).json({
                    success: false,
                    message: 'Invalid or expired token',
                });
                return;
            }
        }

        if (!user) {
            logger.warn('User not found for token');
            res.status(401).json({
                success: false,
                message: 'Invalid token: User not found',
            });
            return;
        }

        // Set user context for the request
        req.user = {
            id: user._id.toString(),
            _id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
        };
        req.userId = user._id.toString();

        logger.info('Authentication successful');
        logger.info('=== MFA AUTHENTICATION MIDDLEWARE COMPLETED ===');
        next();

    } catch (error) {
        logger.error('MFA authentication middleware error:', error);
        res.status(500).json({
            success: false,
            message: 'Authentication error',
        });
        return;
    }
};
