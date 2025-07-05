import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { logger } from '../utils/logger';
import { User } from '../models/User';
import { decrypt } from '../utils/helpers';

export const authenticate = async (
    req: any,
    res: Response,
    next: NextFunction
) => {
    const startTime = Date.now();
    logger.info('=== AUTHENTICATION MIDDLEWARE STARTED ===');
    logger.info('Request path:', req.path);
    logger.info('Request method:', req.method);

    try {
        let token: string | undefined;
        let apiKey: string | undefined;

        logger.info('Step 1: Extracting authentication from request');

        // Check for Bearer token
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            const authValue = req.headers.authorization.substring(7);

            // Check if it's an API key (starts with 'dak_') or JWT token
            if (authValue.startsWith('dak_')) {
                apiKey = authValue;
                logger.info('Dashboard API key found in Authorization header');
            } else {
                token = authValue;
                logger.info('JWT token found in Authorization header');
            }
        } else if (req.query.token) {
            token = req.query.token as string;
            logger.info('Token found in query parameters');
        } else if (req.query.apiKey) {
            apiKey = req.query.apiKey as string;
            logger.info('API key found in query parameters');
        }

        if (!token && !apiKey) {
            logger.warn('No authentication provided in request');
            return res.status(401).json({
                success: false,
                message: 'No authentication provided',
            });
        }

        let user: any;
        let userId: string;

        if (apiKey) {
            logger.info('Step 2: Processing API key authentication');

            // Parse API key
            const parsedKey = AuthService.parseApiKey(apiKey);
            if (!parsedKey) {
                logger.warn('Invalid API key format');
                return res.status(401).json({
                    success: false,
                    message: 'Invalid API key format',
                });
            }

            // Find user and validate API key
            user = await User.findById(parsedKey.userId);
            if (!user) {
                logger.warn('User not found for API key:', parsedKey.userId);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid API key: User not found',
                });
            }

            // Find matching API key in user's dashboard keys
            const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === parsedKey.keyId);
            if (!userApiKey) {
                logger.warn('API key not found in user account');
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
                    logger.warn('API key validation failed');
                    return res.status(401).json({
                        success: false,
                        message: 'Invalid API key',
                    });
                }
            } catch (error) {
                logger.error('Error decrypting API key:', error);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid API key',
                });
            }

            // Check if API key is expired
            if (userApiKey.expiresAt && new Date() > userApiKey.expiresAt) {
                logger.warn('API key has expired');
                return res.status(401).json({
                    success: false,
                    message: 'API key has expired',
                });
            }

            // Update last used timestamp
            userApiKey.lastUsed = new Date();
            await user.save();

            userId = user._id.toString();
            logger.info('API key validated successfully:', {
                userId: userId,
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
            logger.info('Step 2: Processing JWT token authentication');

            try {
                const payload = AuthService.verifyAccessToken(token);
                logger.info('Token verified successfully:', {
                    userId: payload.id,
                    email: payload.email,
                    hasJti: !!payload.jti
                });

                logger.info('Step 3: Finding user in database');
                user = await User.findById(payload.id);

                if (!user) {
                    logger.warn('User not found for token payload:', payload.id);
                    return res.status(401).json({
                        success: false,
                        message: 'Invalid token: User not found',
                    });
                }

                logger.info('User found:', {
                    userId: user._id,
                    email: user.email,
                    role: user.role
                });

                // If jti claim exists, it's an API key auth via JWT, validate it
                if (payload.jti) {
                    logger.info('Step 4: Validating API key via JWT');
                    const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === payload.jti);

                    if (!userApiKey) {
                        logger.warn('Invalid API key ID in JWT');
                        return res.status(401).json({
                            success: false,
                            message: 'Invalid API Key',
                        });
                    }

                    // Check expiration
                    if (userApiKey.expiresAt && new Date() > userApiKey.expiresAt) {
                        logger.warn('API key has expired');
                        return res.status(401).json({
                            success: false,
                            message: 'API key has expired',
                        });
                    }

                    // Update last used
                    userApiKey.lastUsed = new Date();
                    await user.save();

                    logger.info('API key validated successfully via JWT');
                }

                logger.info('Step 5: Setting user context');
                req.user = {
                    id: payload.id,
                    email: payload.email,
                    role: user.role as 'user' | 'admin',
                    apiKeyAuth: !!payload.jti,
                    permissions: payload.jti ? user.dashboardApiKeys.find((key: any) => key.keyId === payload.jti)?.permissions || ['read'] : ['read', 'write', 'admin'],
                };
                req.userId = payload.id;

            } catch (error: any) {
                logger.warn('Token verification failed:', {
                    error: error.message,
                    timeTaken: Date.now() - startTime + 'ms'
                });
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired token',
                });
            }
        }

        logger.info('Authentication successful:', {
            userId: req.user.id,
            authMethod: req.user.apiKeyAuth ? 'API Key' : 'JWT',
            permissions: req.user.permissions,
            timeTaken: Date.now() - startTime + 'ms'
        });
        logger.info('=== AUTHENTICATION MIDDLEWARE COMPLETED ===');
        next();

    } catch (error) {
        logger.error('Authentication middleware error:', {
            error,
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

        // Check for authorization header
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
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
                                logger.debug('Optional auth: Invalid API key provided');
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
            logger.debug('Optional auth: Invalid authentication provided');
        }

        next();
    } catch (error) {
        logger.error('Optional authentication error:', error);
        next();
    }
};