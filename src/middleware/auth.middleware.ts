import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { loggingService } from '../services/logging.service';
import { User } from '../models/User';
import { decrypt } from '../utils/helpers';

export const authenticate = async (
    req: any,
    res: Response,
    next: NextFunction
) => {
    const startTime = Date.now();
    loggingService.info('=== AUTHENTICATION MIDDLEWARE STARTED ===', {
        component: 'AuthMiddleware',
        operation: 'authenticate',
        type: 'authentication',
        path: req.path,
        method: req.method
    });

    try {
        let token: string | undefined;
        let apiKey: string | undefined;

        loggingService.info('Step 1: Extracting authentication from request', {
            component: 'AuthMiddleware',
            operation: 'authenticate',
            type: 'authentication',
            step: 'extract_auth'
        });

        // Check for CostKatana-Auth header first (gateway requests)
        const costkatanaAuth = req.headers['costkatana-auth'] as string;
        if (costkatanaAuth && costkatanaAuth.startsWith('Bearer ')) {
            const authValue = costkatanaAuth.substring(7);

            // Check if it's an API key (starts with 'dak_') or JWT token
            if (authValue.startsWith('dak_')) {
                apiKey = authValue;
                loggingService.info('Dashboard API key found in CostKatana-Auth header', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    authMethod: 'costkatana_header',
                    authType: 'api_key'
                });
            } else {
                token = authValue;
                loggingService.info('JWT token found in CostKatana-Auth header', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    authMethod: 'costkatana_header',
                    authType: 'jwt_token'
                });
            }
        }
        // Check for standard Authorization header
        else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            const authValue = req.headers.authorization.substring(7);

            // Check if it's an API key (starts with 'dak_') or JWT token
            if (authValue.startsWith('dak_')) {
                apiKey = authValue;
                loggingService.info('Dashboard API key found in Authorization header', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    authMethod: 'authorization_header',
                    authType: 'api_key'
                });
            } else {
                token = authValue;
                loggingService.info('JWT token found in Authorization header', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    authMethod: 'authorization_header',
                    authType: 'jwt_token'
                });
            }
        } else if (req.query.token) {
            token = req.query.token as string;
            loggingService.info('Token found in query parameters', {
                component: 'AuthMiddleware',
                operation: 'authenticate',
                type: 'authentication',
                authMethod: 'query_param',
                authType: 'jwt_token'
            });
        } else if (req.query.apiKey) {
            apiKey = req.query.apiKey as string;
            loggingService.info('API key found in query parameters', {
                component: 'AuthMiddleware',
                operation: 'authenticate',
                type: 'authentication',
                authMethod: 'query_param',
                authType: 'api_key'
            });
        }

        if (!token && !apiKey) {
            loggingService.warn('No authentication provided in request', {
                component: 'AuthMiddleware',
                operation: 'authenticate',
                type: 'authentication',
                step: 'no_auth_provided',
                path: req.path,
                method: req.method
            });
            return res.status(401).json({
                success: false,
                message: 'No authentication provided',
            });
        }

        let user: any;
        let userId: string;

        if (apiKey) {
            loggingService.info('Step 2: Processing API key authentication', {
                component: 'AuthMiddleware',
                operation: 'authenticate',
                type: 'authentication',
                step: 'process_api_key'
            });

            // Parse API key
            const parsedKey = AuthService.parseApiKey(apiKey);
            if (!parsedKey) {
                loggingService.warn('Invalid API key format', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'parse_api_key',
                    error: 'invalid_format'
                });
                return res.status(401).json({
                    success: false,
                    message: 'Invalid API key format',
                });
            }

            // Find user and validate API key
            user = await User.findById(parsedKey.userId);
            if (!user) {
                loggingService.warn('User not found for API key', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'find_user',
                    userId: parsedKey.userId,
                    error: 'user_not_found'
                });
                return res.status(401).json({
                    success: false,
                    message: 'Invalid API key: User not found',
                });
            }

            // Find matching API key in user's dashboard keys
            const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === parsedKey.keyId);
            if (!userApiKey) {
                loggingService.warn('API key not found in user account', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'validate_api_key',
                    userId: parsedKey.userId,
                    keyId: parsedKey.keyId,
                    error: 'key_not_found'
                });
                return res.status(401).json({
                    success: false,
                    message: 'Invalid API key',
                });
            }

            // Decrypt and validate the full API key
            try {
                const [iv, authTag, encrypted] = userApiKey.encryptedKey.split(':');
                const decryptedKey = decrypt(encrypted, iv, authTag);

                if (decryptedKey !== apiKey) {
                    loggingService.warn('API key validation failed', {
                        component: 'AuthMiddleware',
                        operation: 'authenticate',
                        type: 'authentication',
                        step: 'validate_api_key',
                        userId: parsedKey.userId,
                        keyId: parsedKey.keyId,
                        error: 'validation_failed'
                    });
                    return res.status(401).json({
                        success: false,
                        message: 'Invalid API key',
                    });
                }
            } catch (error) {
                loggingService.logError(error as Error, {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'decrypt_api_key',
                    userId: parsedKey.userId,
                    keyId: parsedKey.keyId
                });
                return res.status(401).json({
                    success: false,
                    message: 'Invalid API key',
                });
            }

            // Check if API key is expired
            if (userApiKey.expiresAt && new Date() > userApiKey.expiresAt) {
                loggingService.warn('API key has expired', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'check_expiry',
                    userId: parsedKey.userId,
                    keyId: parsedKey.keyId,
                    expiresAt: userApiKey.expiresAt
                });
                return res.status(401).json({
                    success: false,
                    message: 'API key has expired',
                });
            }

            // Update last used timestamp
            userApiKey.lastUsed = new Date();
            await user.save();

            userId = user._id.toString();
            loggingService.info('API key validated successfully', {
                component: 'AuthMiddleware',
                operation: 'authenticate',
                type: 'authentication',
                step: 'api_key_validated',
                userId: parsedKey.userId,
                keyId: parsedKey.keyId,
                permissions: userApiKey.permissions
            });

            req.user = {
                id: userId,
                email: user.email,
                role: user.role as 'user' | 'admin',
                apiKeyAuth: true,
                permissions: userApiKey.permissions,
            };
            req.userId = userId;

        } else if (token) {
            loggingService.info('Step 2: Processing JWT token authentication', {
                component: 'AuthMiddleware',
                operation: 'authenticate',
                type: 'authentication',
                step: 'process_jwt'
            });

            try {
                const payload = AuthService.verifyAccessToken(token);
                loggingService.info('Token verified successfully', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'verify_jwt',
                    userId: payload.id,
                    email: payload.email,
                    hasJti: !!payload.jti
                });

                loggingService.info('Step 3: Finding user in database', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'find_user'
                });
                user = await User.findById(payload.id);

                if (!user) {
                    loggingService.warn('User not found for token payload', {
                        component: 'AuthMiddleware',
                        operation: 'authenticate',
                        type: 'authentication',
                        step: 'find_user',
                        userId: payload.id,
                        error: 'user_not_found'
                    });
                    return res.status(401).json({
                        success: false,
                        message: 'Invalid token: User not found',
                    });
                }

                loggingService.info('User found', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'user_found',
                    userId: user._id,
                    email: user.email,
                    role: user.role
                });

                // If jti claim exists, it's an API key auth via JWT, validate it
                if (payload.jti) {
                    loggingService.info('Step 4: Validating API key via JWT', {
                        component: 'AuthMiddleware',
                        operation: 'authenticate',
                        type: 'authentication',
                        step: 'validate_api_key_jwt'
                    });
                    const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === payload.jti);

                    if (!userApiKey) {
                        loggingService.warn('Invalid API key ID in JWT', {
                            component: 'AuthMiddleware',
                            operation: 'authenticate',
                            type: 'authentication',
                            step: 'validate_api_key_jwt',
                            userId: payload.id,
                            error: 'invalid_api_key_id'
                        });
                        return res.status(401).json({
                            success: false,
                            message: 'Invalid API Key',
                        });
                    }

                    // Check expiration
                    if (userApiKey.expiresAt && new Date() > userApiKey.expiresAt) {
                        loggingService.warn('API key has expired', {
                            component: 'AuthMiddleware',
                            operation: 'authenticate',
                            type: 'authentication',
                            step: 'check_expiry',
                            userId: payload.id,
                            apiKeyId: payload.jti,
                            expiresAt: userApiKey.expiresAt
                        });
                        return res.status(401).json({
                            success: false,
                            message: 'API key has expired',
                        });
                    }

                    // Update last used
                    userApiKey.lastUsed = new Date();
                    await user.save();

                    loggingService.info('API key validated successfully via JWT', {
                        component: 'AuthMiddleware',
                        operation: 'authenticate',
                        type: 'authentication',
                        step: 'api_key_validated_jwt',
                        userId: payload.id,
                        apiKeyId: payload.jti
                    });
                }

                loggingService.info('Step 5: Setting user context', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'set_user_context'
                });
                req.user = {
                    id: payload.id,
                    email: payload.email,
                    role: user.role as 'user' | 'admin',
                    apiKeyAuth: !!payload.jti,
                    permissions: payload.jti ? user.dashboardApiKeys.find((key: any) => key.keyId === payload.jti)?.permissions || ['read'] : ['read', 'write', 'admin'],
                };
                req.userId = payload.id;

            } catch (error: any) {
                loggingService.warn('Token verification failed', {
                    component: 'AuthMiddleware',
                    operation: 'authenticate',
                    type: 'authentication',
                    step: 'verify_jwt',
                    error: error.message,
                    timeTaken: Date.now() - startTime + 'ms'
                });
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired token',
                });
            }
        }

        loggingService.info('Authentication successful', {
            component: 'AuthMiddleware',
            operation: 'authenticate',
            type: 'authentication',
            step: 'success',
            userId: req.user.id,
            authMethod: req.user.apiKeyAuth ? 'API Key' : 'JWT',
            permissions: req.user.permissions,
            timeTaken: Date.now() - startTime + 'ms'
        });
        loggingService.info('=== AUTHENTICATION MIDDLEWARE COMPLETED ===', {
            component: 'AuthMiddleware',
            operation: 'authenticate',
            type: 'authentication',
            step: 'completed'
        });
        next();

    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'AuthMiddleware',
            operation: 'authenticate',
            type: 'authentication',
            step: 'error',
            timeTaken: Date.now() - startTime + 'ms'
        });
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

export const requirePermission = (...permissions: string[]) => {
    return (req: any, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated',
            });
        }

        const userPermissions = req.user.permissions || [];
        const hasPermission = permissions.some(permission =>
            userPermissions.includes(permission) || userPermissions.includes('admin')
        );

        if (!hasPermission) {
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
    _res: Response,
    next: NextFunction
) => {
    try {
        let authValue: string | undefined;

        // Check for CostKatana-Auth header first (gateway requests)
        const costkatanaAuth = req.headers['costkatana-auth'] as string;
        if (costkatanaAuth && costkatanaAuth.startsWith('Bearer ')) {
            authValue = costkatanaAuth.substring(7);
        }
        // Check for standard authorization header
        else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            authValue = req.headers.authorization.substring(7);
        } else if (req.query.token) {
            authValue = req.query.token as string;
        } else if (req.query.apiKey) {
            authValue = req.query.apiKey as string;
        }

        if (!authValue) {
            return next();
        }

        try {
            // Try API key first
            if (authValue.startsWith('dak_')) {
                const parsedKey = AuthService.parseApiKey(authValue);
                if (parsedKey) {
                    const user = await User.findById(parsedKey.userId);
                    if (user) {
                        const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === parsedKey.keyId);
                        if (userApiKey && (!userApiKey.expiresAt || new Date() <= userApiKey.expiresAt)) {
                            // Validate key
                            try {
                                const [iv, authTag, encrypted] = userApiKey.encryptedKey.split(':');
                                const decryptedKey = decrypt(encrypted, iv, authTag);

                                if (decryptedKey === authValue) {
                                    userApiKey.lastUsed = new Date();
                                    await user.save();

                                    req.user = {
                                        id: user._id.toString(),
                                        email: user.email,
                                        role: user.role as 'user' | 'admin',
                                        apiKeyAuth: true,
                                        permissions: userApiKey.permissions,
                                    };
                                    req.userId = user._id.toString();
                                }
                            } catch (error) {
                                // Invalid key, continue without user
                                loggingService.debug('Optional auth: Invalid API key provided', {
                                    component: 'AuthMiddleware',
                                    operation: 'optionalAuth',
                                    type: 'authentication',
                                    step: 'invalid_api_key'
                                });
                            }
                        }
                    }
                }
            } else {
                // Try JWT token
                const payload = AuthService.verifyAccessToken(authValue);
                const user = await User.findById(payload.id);
                if (user) {
                    req.user = {
                        id: payload.id,
                        email: payload.email,
                        role: user.role as 'user' | 'admin',
                        apiKeyAuth: false,
                        permissions: ['read', 'write', 'admin'],
                    };
                    req.userId = payload.id;
                }
            }
        } catch (error) {
            // Invalid token/key, but continue without user
            loggingService.debug('Optional auth: Invalid authentication provided', {
                component: 'AuthMiddleware',
                operation: 'optionalAuth',
                type: 'authentication',
                step: 'invalid_auth'
            });
        }

        next();
    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'AuthMiddleware',
            operation: 'optionalAuth',
            type: 'authentication',
            step: 'error'
        });
        next();
    }
};