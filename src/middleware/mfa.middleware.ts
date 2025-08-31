import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { loggingService } from '../services/logging.service';
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
    const startTime = Date.now();
    
    loggingService.info('=== MFA AUTHENTICATION MIDDLEWARE STARTED ===', {
        component: 'MFAMiddleware',
        operation: 'authenticateMFA',
        type: 'mfa_authentication',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Analyzing request context', {
        component: 'MFAMiddleware',
        operation: 'authenticateMFA',
        type: 'mfa_authentication',
        step: 'analyze_context'
    });

    try {
        loggingService.info('Request details extracted', {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'request_details',
            path: req.path,
            method: req.method,
            hasAuthHeader: !!req.headers.authorization
        });

        loggingService.info('Step 2: Extracting authentication header', {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'extract_header'
        });

        // Extract token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            loggingService.warn('No Authorization header or invalid format', {
                component: 'MFAMiddleware',
                operation: 'authenticateMFA',
                type: 'mfa_authentication',
                step: 'header_validation_failed',
                hasHeader: !!authHeader,
                headerFormat: authHeader ? authHeader.substring(0, 20) + '...' : 'none'
            });
            res.status(401).json({
                success: false,
                message: 'No authentication provided',
            });
            return;
        }

        const token = authHeader.substring(7);
        loggingService.info('Token extracted from header successfully', {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'token_extracted',
            tokenLength: token.length,
            tokenPrefix: token.substring(0, 10) + '...'
        });

        loggingService.info('Step 3: Attempting MFA token verification', {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'try_mfa_token'
        });

        let user: any = null;

        // Try MFA token first (for login flow)
        try {
            const payload = AuthService.verifyMFAToken(token);
            loggingService.info('MFA token verified successfully', {
                component: 'MFAMiddleware',
                operation: 'authenticateMFA',
                type: 'mfa_authentication',
                step: 'mfa_token_verified',
                userId: payload.userId,
                tokenType: 'mfa_token'
            });

            loggingService.info('Step 3a: Finding user for MFA token', {
                component: 'MFAMiddleware',
                operation: 'authenticateMFA',
                type: 'mfa_authentication',
                step: 'find_user_mfa'
            });

            user = await User.findById(payload.userId);
            if (user) {
                loggingService.info('User found via MFA token', {
                    component: 'MFAMiddleware',
                    operation: 'authenticateMFA',
                    type: 'mfa_authentication',
                    step: 'user_found_mfa',
                    userId: user._id,
                    email: user.email,
                    name: user.name,
                    role: user.role
                });
            } else {
                loggingService.warn('User not found for MFA token', {
                    component: 'MFAMiddleware',
                    operation: 'authenticateMFA',
                    type: 'mfa_authentication',
                    step: 'user_not_found_mfa',
                    userId: payload.userId
                });
            }
        } catch (mfaError) {
            loggingService.info('MFA token verification failed, trying regular access token', {
                component: 'MFAMiddleware',
                operation: 'authenticateMFA',
                type: 'mfa_authentication',
                step: 'mfa_failed_try_access',
                mfaError: mfaError instanceof Error ? mfaError.message : 'Unknown error'
            });
            
            loggingService.info('Step 3b: Attempting access token verification', {
                component: 'MFAMiddleware',
                operation: 'authenticateMFA',
                type: 'mfa_authentication',
                step: 'try_access_token'
            });
            
            // Try regular access token (for setup flow)
            try {
                const payload = AuthService.verifyAccessToken(token);
                loggingService.info('Access token verified successfully', {
                    component: 'MFAMiddleware',
                    operation: 'authenticateMFA',
                    type: 'mfa_authentication',
                    step: 'access_token_verified',
                    userId: payload.id,
                    tokenType: 'access_token'
                });

                loggingService.info('Step 3c: Finding user for access token', {
                    component: 'MFAMiddleware',
                    operation: 'authenticateMFA',
                    type: 'mfa_authentication',
                    step: 'find_user_access'
                });

                user = await User.findById(payload.id);
                if (user) {
                    loggingService.info('User found via access token', {
                        component: 'MFAMiddleware',
                        operation: 'authenticateMFA',
                        type: 'mfa_authentication',
                        step: 'user_found_access',
                        userId: user._id,
                        email: user.email,
                        name: user.name,
                        role: user.role
                    });
                } else {
                    loggingService.warn('User not found for access token', {
                        component: 'MFAMiddleware',
                        operation: 'authenticateMFA',
                        type: 'mfa_authentication',
                        step: 'user_not_found_access',
                        userId: payload.id
                    });
                }
            } catch (accessError) {
                loggingService.warn('Both MFA and access token verification failed', {
                    component: 'MFAMiddleware',
                    operation: 'authenticateMFA',
                    type: 'mfa_authentication',
                    step: 'both_tokens_failed',
                    mfaError: mfaError instanceof Error ? mfaError.message : 'Unknown error',
                    accessError: accessError instanceof Error ? accessError.message : 'Unknown error'
                });
                res.status(401).json({
                    success: false,
                    message: 'Invalid or expired token',
                });
                return;
            }
        }

        if (!user) {
            loggingService.warn('User not found for any token type', {
                component: 'MFAMiddleware',
                operation: 'authenticateMFA',
                type: 'mfa_authentication',
                step: 'no_user_found',
                tokenLength: token.length,
                tokenPrefix: token.substring(0, 10) + '...'
            });
            res.status(401).json({
                success: false,
                message: 'Invalid token: User not found',
            });
            return;
        }

        loggingService.info('Step 4: Setting up user context', {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'setup_user_context'
        });

        // Set user context for the request
        req.user = {
            id: user._id.toString(),
            _id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
        };
        req.userId = user._id.toString();

        loggingService.info('User context set successfully', {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'user_context_set',
            userId: user._id.toString(),
            email: user.email,
            name: user.name,
            role: user.role
        });

        loggingService.info('MFA authentication completed successfully', {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'authentication_success',
            userId: user._id.toString(),
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== MFA AUTHENTICATION MIDDLEWARE COMPLETED ===', {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'completed',
            userId: user._id.toString(),
            totalTime: `${Date.now() - startTime}ms`
        });

        next();

    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'MFAMiddleware',
            operation: 'authenticateMFA',
            type: 'mfa_authentication',
            step: 'error',
            totalTime: `${Date.now() - startTime}ms`
        });
        res.status(500).json({
            success: false,
            message: 'Authentication error',
        });
        return;
    }
};
