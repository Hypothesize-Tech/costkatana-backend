import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { loggingService } from '../services/logging.service';
import { User } from '../models/User';
import { decrypt } from '../utils/helpers';

/**
 * Authentication middleware for automation webhooks
 * Supports both API Key (CostKatana-Auth header) and Bearer Token (Authorization header)
 */
export const authenticateAutomationWebhook = async (
    req: any,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const startTime = Date.now();

    try {
        let token: string | undefined;
        let apiKey: string | undefined;

        // Check for CostKatana-Auth header (API key formats: ck_user_{userId}_{keyId} or dak_{userId}_{keyId}_{secret})
        const costkatanaAuth = req.headers['costkatana-auth'] as string;
        if (costkatanaAuth) {
            // Check if it's a Bearer token format
            if (costkatanaAuth.startsWith('Bearer ')) {
                const bearerValue = costkatanaAuth.substring(7);
                // Check if Bearer value is an API key (dak_ or ck_user_)
                if (bearerValue.startsWith('dak_') || bearerValue.startsWith('ck_user_')) {
                    apiKey = bearerValue;
                    loggingService.info('API key found in CostKatana-Auth Bearer header', {
                        component: 'AutomationMiddleware',
                        operation: 'authenticateAutomationWebhook',
                        authMethod: 'costkatana_header',
                        authType: 'api_key'
                    });
                } else {
                    // Treat as JWT token
                    token = bearerValue;
                    loggingService.info('Bearer token found in CostKatana-Auth header', {
                        component: 'AutomationMiddleware',
                        operation: 'authenticateAutomationWebhook',
                        authMethod: 'costkatana_header',
                        authType: 'bearer_token'
                    });
                }
            } else if (costkatanaAuth.startsWith('ck_user_') || costkatanaAuth.startsWith('dak_')) {
                // Direct API key format
                apiKey = costkatanaAuth;
                loggingService.info('API key found in CostKatana-Auth header', {
                    component: 'AutomationMiddleware',
                    operation: 'authenticateAutomationWebhook',
                    authMethod: 'costkatana_header',
                    authType: 'api_key'
                });
            } else {
                // Try as direct API key
                apiKey = costkatanaAuth;
            }
        }

        // Check for standard Authorization header (Bearer token or API key)
        if (!token && !apiKey && req.headers.authorization) {
            if (req.headers.authorization.startsWith('Bearer ')) {
                const bearerValue = req.headers.authorization.substring(7);
                // Check if Bearer value is an API key (dak_ or ck_user_)
                if (bearerValue.startsWith('dak_') || bearerValue.startsWith('ck_user_')) {
                    apiKey = bearerValue;
                    loggingService.info('API key found in Authorization Bearer header', {
                        component: 'AutomationMiddleware',
                        operation: 'authenticateAutomationWebhook',
                        authMethod: 'authorization_header',
                        authType: 'api_key'
                    });
                } else {
                    // Treat as JWT token
                    token = bearerValue;
                    loggingService.info('Bearer token found in Authorization header', {
                        component: 'AutomationMiddleware',
                        operation: 'authenticateAutomationWebhook',
                        authMethod: 'authorization_header',
                        authType: 'bearer_token'
                    });
                }
            } else if (req.headers.authorization.startsWith('ck_user_') || req.headers.authorization.startsWith('dak_')) {
                apiKey = req.headers.authorization;
                loggingService.info('API key found in Authorization header', {
                    component: 'AutomationMiddleware',
                    operation: 'authenticateAutomationWebhook',
                    authMethod: 'authorization_header',
                    authType: 'api_key'
                });
            }
        }

        if (!token && !apiKey) {
            loggingService.warn('No authentication provided for automation webhook', {
                component: 'AutomationMiddleware',
                operation: 'authenticateAutomationWebhook',
                path: req.path,
                method: req.method
            });
            res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please provide either CostKatana-Auth header (API key) or Authorization: Bearer token'
            });
            return;
        }

        let user: any;
        let userId: string | undefined;

        if (apiKey) {
            // Parse API key (format: ck_user_{userId}_{keyId})
            const parsedKey = AuthService.parseApiKey(apiKey);
            if (!parsedKey) {
                loggingService.warn('Invalid API key format for automation webhook', {
                    component: 'AutomationMiddleware',
                    operation: 'authenticateAutomationWebhook',
                    error: 'invalid_format'
                });
                res.status(401).json({
                    success: false,
                    error: 'Invalid API key format',
                    message: 'API key must be in format: ck_user_{userId}_{keyId}'
                });
                return;
            }

            // Find user and validate API key
            user = await User.findById(parsedKey.userId);
            if (!user) {
                loggingService.warn('User not found for automation webhook API key', {
                    component: 'AutomationMiddleware',
                    operation: 'authenticateAutomationWebhook',
                    userId: parsedKey.userId
                });
                res.status(401).json({
                    success: false,
                    error: 'Invalid API key',
                    message: 'User not found for provided API key'
                });
                return;
            }

            // Find matching API key in user's dashboard keys
            const userApiKey = user.dashboardApiKeys?.find((key: any) => key.keyId === parsedKey.keyId);
            if (!userApiKey) {
                loggingService.warn('API key not found in user dashboard keys', {
                    component: 'AutomationMiddleware',
                    operation: 'authenticateAutomationWebhook',
                    userId: parsedKey.userId,
                    keyId: parsedKey.keyId
                });
                res.status(401).json({
                    success: false,
                    error: 'Invalid API key',
                    message: 'API key not found'
                });
                return;
            }

            // Check if API key is active (default to true if not set)
            if (userApiKey.isActive === false) {
                loggingService.warn('Inactive API key used for automation webhook', {
                    component: 'AutomationMiddleware',
                    operation: 'authenticateAutomationWebhook',
                    userId: parsedKey.userId,
                    keyId: parsedKey.keyId
                });
                res.status(401).json({
                    success: false,
                    error: 'Inactive API key',
                    message: 'This API key has been deactivated'
                });
                return;
            }

            // Validate the full API key by decrypting
            try {
                if (userApiKey.encryptedKey) {
                    const [iv, authTag, encrypted] = userApiKey.encryptedKey.split(':');
                    const decryptedKey = decrypt(encrypted, iv, authTag);

                    if (decryptedKey !== apiKey) {
                        loggingService.warn('API key validation failed for automation webhook', {
                            component: 'AutomationMiddleware',
                            operation: 'authenticateAutomationWebhook',
                            userId: parsedKey.userId,
                            keyId: parsedKey.keyId
                        });
                        res.status(401).json({
                            success: false,
                            error: 'Invalid API key',
                            message: 'API key validation failed'
                        });
                        return;
                    }
                }
            } catch (error) {
                loggingService.error('Error decrypting API key for automation webhook', {
                    component: 'AutomationMiddleware',
                    operation: 'authenticateAutomationWebhook',
                    error: error instanceof Error ? error.message : String(error)
                });
                res.status(401).json({
                    success: false,
                    error: 'Invalid API key',
                    message: 'Failed to validate API key'
                });
                return;
            }

            userId = parsedKey.userId;
        } else if (token) {
            // Validate JWT token
            try {
                const decoded = AuthService.verifyAccessToken(token);
                if (!decoded || !decoded.id) {
                    loggingService.warn('Invalid JWT token for automation webhook', {
                        component: 'AutomationMiddleware',
                        operation: 'authenticateAutomationWebhook',
                        error: 'invalid_token'
                    });
                    res.status(401).json({
                        success: false,
                        error: 'Invalid token',
                        message: 'Token validation failed'
                    });
                    return;
                }

                userId = decoded.id;
                user = await User.findById(userId);
                if (!user) {
                    loggingService.warn('User not found for automation webhook token', {
                        component: 'AutomationMiddleware',
                        operation: 'authenticateAutomationWebhook',
                        userId
                    });
                    res.status(401).json({
                        success: false,
                        error: 'Invalid token',
                        message: 'User not found'
                    });
                    return;
                }
            } catch (error) {
                loggingService.error('Error verifying token for automation webhook', {
                    component: 'AutomationMiddleware',
                    operation: 'authenticateAutomationWebhook',
                    error: error instanceof Error ? error.message : String(error)
                });
                res.status(401).json({
                    success: false,
                    error: 'Invalid token',
                    message: 'Token verification failed'
                });
                return;
            }
        }

        // Verify userId was set
        if (!userId || !user) {
            loggingService.warn('User or userId missing after authentication', {
                component: 'AutomationMiddleware',
                operation: 'authenticateAutomationWebhook'
            });
            res.status(401).json({
                success: false,
                error: 'Authentication failed',
                message: 'User information not available'
            });
            return;
        }

        // Attach user info to request
        req.userId = userId;
        req.user = user;

        const duration = Date.now() - startTime;
        loggingService.info('Automation webhook authenticated successfully', {
            component: 'AutomationMiddleware',
            operation: 'authenticateAutomationWebhook',
            userId,
            duration,
            authMethod: apiKey ? 'api_key' : 'bearer_token'
        });

        next();
    } catch (error) {
        loggingService.error('Error in automation webhook authentication', {
            component: 'AutomationMiddleware',
            operation: 'authenticateAutomationWebhook',
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        res.status(500).json({
            success: false,
            error: 'Authentication error',
            message: 'An error occurred during authentication'
        });
    }
};

