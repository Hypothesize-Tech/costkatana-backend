import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { logger } from '../utils/logger';

export const authenticate = async (
    req: any,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided',
            });
        }

        const token = authHeader.substring(7);

        try {
            const payload = AuthService.verifyAccessToken(token);
            req.user = {
                id: payload.id,
                email: payload.email,
                role: payload.role as 'user' | 'admin',
            };
            req.userId = payload.id;

            next();
        } catch (error) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token',
            });
        }
    } catch (error) {
        logger.error('Authentication error:', error);
        res.status(500).json({
            success: false,
            message: 'Authentication error',
        });
    }
    return;
};

export const authorize = (...roles: string[]) => {
    return (req: any, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated',
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions',
            });
        }

        next();
        return;
    };
};

export const optionalAuth = async (
    req: any,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.substring(7);

        try {
            const payload = AuthService.verifyAccessToken(token);
            req.user = {
                id: payload.id,
                email: payload.email,
                role: payload.role as 'user' | 'admin',
            };
            req.userId = payload.id;
        } catch (error) {
            // Invalid token, but continue without user
            logger.debug('Optional auth: Invalid token provided');
        }

        next();
    } catch (error) {
        logger.error('Optional authentication error:', error);
        next();
    }
};