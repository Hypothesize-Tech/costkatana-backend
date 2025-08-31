import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { validationResult } from 'express-validator';
import { loggingService } from '../services/logging.service';

export const validate = (schema: ZodSchema) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const startTime = Date.now();
        
        loggingService.info('=== ZOD VALIDATION MIDDLEWARE STARTED ===', {
            component: 'ValidationMiddleware',
            operation: 'validate',
            type: 'zod_validation',
            path: req.path,
            method: req.method,
            schemaType: 'body'
        });

        loggingService.info('Step 1: Starting body validation with Zod schema', {
            component: 'ValidationMiddleware',
            operation: 'validate',
            type: 'zod_validation',
            step: 'start_validation',
            hasBody: !!req.body,
            bodySize: req.body ? JSON.stringify(req.body).length : 0
        });

        try {
            await schema.parseAsync(req.body);
            
            loggingService.info('Body validation completed successfully', {
                component: 'ValidationMiddleware',
                operation: 'validate',
                type: 'zod_validation',
                step: 'validation_success',
                validationTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== ZOD VALIDATION MIDDLEWARE COMPLETED ===', {
                component: 'ValidationMiddleware',
                operation: 'validate',
                type: 'zod_validation',
                step: 'completed',
                validationTime: `${Date.now() - startTime}ms`
            });

            next();
            return;
        } catch (error: any) {
            loggingService.debug('Validation error occurred', {
                component: 'ValidationMiddleware',
                operation: 'validate',
                type: 'zod_validation',
                step: 'validation_error',
                error: error instanceof Error ? error.message : 'Unknown error',
                validationTime: `${Date.now() - startTime}ms`
            });

            if (error.errors) {
                const errors = error.errors.map((err: any) => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                loggingService.info('Validation errors formatted and sent to client', {
                    component: 'ValidationMiddleware',
                    operation: 'validate',
                    type: 'zod_validation',
                    step: 'send_validation_errors',
                    errorCount: errors.length,
                    errors: errors.map((e: any) => ({ field: e.field, message: e.message })),
                    totalTime: `${Date.now() - startTime}ms`
                });

                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors,
                });
            }

            loggingService.info('Generic validation error sent to client', {
                component: 'ValidationMiddleware',
                operation: 'validate',
                type: 'zod_validation',
                step: 'send_generic_error',
                error: 'Invalid request data',
                totalTime: `${Date.now() - startTime}ms`
            });

            res.status(400).json({
                success: false,
                message: 'Invalid request data',
            });
            return;
        }
    };
};

// Express-validator middleware
export const validateRequest = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    loggingService.info('=== EXPRESS-VALIDATOR MIDDLEWARE STARTED ===', {
        component: 'ValidationMiddleware',
        operation: 'validateRequest',
        type: 'express_validator',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Running express-validator validation', {
        component: 'ValidationMiddleware',
        operation: 'validateRequest',
        type: 'express_validator',
        step: 'run_validation'
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        loggingService.debug('Express-validator validation errors found', {
            component: 'ValidationMiddleware',
            operation: 'validateRequest',
            type: 'express_validator',
            step: 'validation_errors_found',
            errorCount: errors.array().length,
            errors: errors.array().map((e: any) => ({ field: e.path, message: e.msg, value: e.value }))
        });

        loggingService.info('Validation errors sent to client', {
            component: 'ValidationMiddleware',
            operation: 'validateRequest',
            type: 'express_validator',
            step: 'send_validation_errors',
            errorCount: errors.array().length,
            totalTime: `${Date.now() - startTime}ms`
        });

        res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
        return;
    }

    loggingService.info('Express-validator validation passed successfully', {
        component: 'ValidationMiddleware',
        operation: 'validateRequest',
        type: 'express_validator',
        step: 'validation_passed',
        validationTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== EXPRESS-VALIDATOR MIDDLEWARE COMPLETED ===', {
        component: 'ValidationMiddleware',
        operation: 'validateRequest',
        type: 'express_validator',
        step: 'completed',
        validationTime: `${Date.now() - startTime}ms`
    });

    next();
};

export const validateQuery = (schema: ZodSchema) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const startTime = Date.now();
        
        loggingService.info('=== ZOD QUERY VALIDATION MIDDLEWARE STARTED ===', {
            component: 'ValidationMiddleware',
            operation: 'validateQuery',
            type: 'zod_query_validation',
            path: req.path,
            method: req.method,
            schemaType: 'query'
        });

        loggingService.info('Step 1: Starting query parameters validation with Zod schema', {
            component: 'ValidationMiddleware',
            operation: 'validateQuery',
            type: 'zod_query_validation',
            step: 'start_validation',
            hasQuery: !!req.query,
            queryParams: Object.keys(req.query),
            queryCount: Object.keys(req.query).length
        });

        try {
            await schema.parseAsync(req.query);
            
            loggingService.info('Query validation completed successfully', {
                component: 'ValidationMiddleware',
                operation: 'validateQuery',
                type: 'zod_query_validation',
                step: 'validation_success',
                validationTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== ZOD QUERY VALIDATION MIDDLEWARE COMPLETED ===', {
                component: 'ValidationMiddleware',
                operation: 'validateQuery',
                type: 'zod_query_validation',
                step: 'completed',
                validationTime: `${Date.now() - startTime}ms`
            });

            next();
            return;
        } catch (error: any) {
            loggingService.debug('Query validation error occurred', {
                component: 'ValidationMiddleware',
                operation: 'validateQuery',
                type: 'zod_query_validation',
                step: 'validation_error',
                error: error instanceof Error ? error.message : 'Unknown error',
                validationTime: `${Date.now() - startTime}ms`
            });

            if (error.errors) {
                const errors = error.errors.map((err: any) => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                loggingService.info('Query validation errors formatted and sent to client', {
                    component: 'ValidationMiddleware',
                    operation: 'validateQuery',
                    type: 'zod_query_validation',
                    step: 'send_validation_errors',
                    errorCount: errors.length,
                    errors: errors.map((e: any) => ({ field: e.field, message: e.message })),
                    totalTime: `${Date.now() - startTime}ms`
                });

                return res.status(400).json({
                    success: false,
                    message: 'Invalid query parameters',
                    errors,
                });
            }

            loggingService.info('Generic query validation error sent to client', {
                component: 'ValidationMiddleware',
                operation: 'validateQuery',
                type: 'zod_query_validation',
                step: 'send_generic_error',
                error: 'Invalid query parameters',
                totalTime: `${Date.now() - startTime}ms`
            });

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
        const startTime = Date.now();
        
        loggingService.info('=== ZOD PARAMS VALIDATION MIDDLEWARE STARTED ===', {
            component: 'ValidationMiddleware',
            operation: 'validateParams',
            type: 'zod_params_validation',
            path: req.path,
            method: req.method,
            schemaType: 'params'
        });

        loggingService.info('Step 1: Starting URL parameters validation with Zod schema', {
            component: 'ValidationMiddleware',
            operation: 'validateParams',
            type: 'zod_params_validation',
            step: 'start_validation',
            hasParams: !!req.params,
            params: Object.keys(req.params),
            paramCount: Object.keys(req.params).length
        });

        try {
            await schema.parseAsync(req.params);
            
            loggingService.info('URL parameters validation completed successfully', {
                component: 'ValidationMiddleware',
                operation: 'validateParams',
                type: 'zod_params_validation',
                step: 'validation_success',
                validationTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== ZOD PARAMS VALIDATION MIDDLEWARE COMPLETED ===', {
                component: 'ValidationMiddleware',
                operation: 'validateParams',
                type: 'zod_params_validation',
                step: 'completed',
                validationTime: `${Date.now() - startTime}ms`
            });

            next();
            return;
        } catch (error: any) {
            loggingService.debug('URL parameters validation error occurred', {
                component: 'ValidationMiddleware',
                operation: 'validateParams',
                type: 'zod_params_validation',
                step: 'validation_error',
                error: error instanceof Error ? error.message : 'Unknown error',
                validationTime: `${Date.now() - startTime}ms`
            });

            if (error.errors) {
                const errors = error.errors.map((err: any) => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                loggingService.info('URL parameters validation errors formatted and sent to client', {
                    component: 'ValidationMiddleware',
                    operation: 'validateParams',
                    type: 'zod_params_validation',
                    step: 'send_validation_errors',
                    errorCount: errors.length,
                    errors: errors.map((e: any) => ({ field: e.field, message: e.message })),
                    totalTime: `${Date.now() - startTime}ms`
                });

                return res.status(400).json({
                    success: false,
                    message: 'Invalid URL parameters',
                    errors,
                });
            }

            loggingService.info('Generic URL parameters validation error sent to client', {
                component: 'ValidationMiddleware',
                operation: 'validateParams',
                type: 'zod_params_validation',
                step: 'send_generic_error',
                error: 'Invalid URL parameters',
                totalTime: `${Date.now() - startTime}ms`
            });

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
    const startTime = Date.now();
    
    loggingService.info('=== INPUT SANITIZATION MIDDLEWARE STARTED ===', {
        component: 'ValidationMiddleware',
        operation: 'sanitizeInput',
        type: 'input_sanitization',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Starting input sanitization for XSS prevention', {
        component: 'ValidationMiddleware',
        operation: 'sanitizeInput',
        type: 'input_sanitization',
        step: 'start_sanitization',
        hasBody: !!req.body,
        hasQuery: !!req.query,
        hasParams: !!req.params
    });

    const sanitize = (obj: any): any => {
        if (typeof obj === 'string') {
            const originalLength = obj.length;
            const sanitized = obj
                .replace(/[<>]/g, '')
                .replace(/javascript:/gi, '')
                .replace(/on\w+=/gi, '');
            
            if (originalLength !== sanitized.length) {
                loggingService.debug('String sanitized for XSS prevention', {
                    component: 'ValidationMiddleware',
                    operation: 'sanitizeInput',
                    type: 'input_sanitization',
                    step: 'string_sanitized',
                    originalLength,
                    sanitizedLength: sanitized.length,
                    changes: originalLength - sanitized.length
                });
            }
            
            return sanitized;
        }

        if (Array.isArray(obj)) {
            loggingService.debug('Array sanitization started', {
                component: 'ValidationMiddleware',
                operation: 'sanitizeInput',
                type: 'input_sanitization',
                step: 'array_sanitization',
                arrayLength: obj.length
            });
            return obj.map(sanitize);
        }

        if (obj && typeof obj === 'object') {
            const sanitized: any = {};
            const keys = Object.keys(obj);
            
            loggingService.debug('Object sanitization started', {
                component: 'ValidationMiddleware',
                operation: 'sanitizeInput',
                type: 'input_sanitization',
                step: 'object_sanitization',
                objectKeys: keys,
                keyCount: keys.length
            });
            
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    sanitized[key] = sanitize(obj[key]);
                }
            }
            return sanitized;
        }

        return obj;
    };

    loggingService.info('Step 2: Applying sanitization to request data', {
        component: 'ValidationMiddleware',
        operation: 'sanitizeInput',
        type: 'input_sanitization',
        step: 'apply_sanitization'
    });

    req.body = sanitize(req.body);
    req.query = sanitize(req.query);
    req.params = sanitize(req.params);

    loggingService.info('Input sanitization completed successfully', {
        component: 'ValidationMiddleware',
        operation: 'sanitizeInput',
        type: 'input_sanitization',
        step: 'sanitization_complete',
        bodySanitized: !!req.body,
        querySanitized: !!req.query,
        paramsSanitized: !!req.params,
        totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== INPUT SANITIZATION MIDDLEWARE COMPLETED ===', {
        component: 'ValidationMiddleware',
        operation: 'sanitizeInput',
        type: 'input_sanitization',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });

    next();
    return;
};