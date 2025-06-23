import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { logger } from '../utils/logger';

export const validate = (schema: ZodSchema) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await schema.parseAsync(req.body);
            next();
            return;
        } catch (error: any) {
            logger.debug('Validation error:', error);

            if (error.errors) {
                const errors = error.errors.map((err: any) => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors,
                });
            }

            res.status(400).json({
                success: false,
                message: 'Invalid request data',
            });
            return;
        }
    };
};

export const validateQuery = (schema: ZodSchema) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await schema.parseAsync(req.query);
            next();
            return;
        } catch (error: any) {
            logger.debug('Query validation error:', error);

            if (error.errors) {
                const errors = error.errors.map((err: any) => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                return res.status(400).json({
                    success: false,
                    message: 'Invalid query parameters',
                    errors,
                });
            }

            res.status(400).json({
                success: false,
                message: 'Invalid query parameters',
            });
            return;
        }
    };
};

export const validateParams = (schema: ZodSchema) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await schema.parseAsync(req.params);
            next();
            return;
        } catch (error: any) {
            logger.debug('Params validation error:', error);

            if (error.errors) {
                const errors = error.errors.map((err: any) => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                return res.status(400).json({
                    success: false,
                    message: 'Invalid URL parameters',
                    errors,
                });
            }

            res.status(400).json({
                success: false,
                message: 'Invalid URL parameters',
            });
            return;
        }
    };
};

// Sanitize input to prevent XSS
export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
    const sanitize = (obj: any): any => {
        if (typeof obj === 'string') {
            return obj
                .replace(/[<>]/g, '')
                .replace(/javascript:/gi, '')
                .replace(/on\w+=/gi, '');
        }

        if (Array.isArray(obj)) {
            return obj.map(sanitize);
        }

        if (obj && typeof obj === 'object') {
            const sanitized: any = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    sanitized[key] = sanitize(obj[key]);
                }
            }
            return sanitized;
        }

        return obj;
    };

    req.body = sanitize(req.body);
    req.query = sanitize(req.query);
    req.params = sanitize(req.params);

    next();
    return;
};