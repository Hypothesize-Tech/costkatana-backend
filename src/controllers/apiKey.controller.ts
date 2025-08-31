import { Response } from 'express';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';
import crypto from 'crypto';

export interface IApiKey {
    id: string;
    name: string;
    key: string;
    created: Date;
    lastUsed?: Date;
    isActive: boolean;
}

export class ApiKeyController {
    /**
     * Generate a new API key for ChatGPT integration
     */
    static async generateApiKey(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { name } = req.body;

        try {
            loggingService.info('API key generation request initiated', {
                userId,
                keyName: name,
                requestId: req.headers['x-request-id'] as string
            });

            if (!name || name.trim() === '') {
                loggingService.warn('API key generation failed - missing name', {
                    userId,
                    keyName: name,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'API key name is required'
                });
                return;
            }

            // Generate API key in format: ck_user_{userId}_{random}
            const randomSuffix = crypto.randomBytes(16).toString('hex');
            const apiKey = `ck_user_${userId}_${randomSuffix}`;

            // Get user and add API key
            const user = await User.findById(userId);
            if (!user) {
                loggingService.warn('API key generation failed - user not found', {
                    userId,
                    keyName: name,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
                return;
            }

            // Initialize apiKeys array if it doesn't exist
            if (!user.apiKeys) {
                user.apiKeys = [];
            }

            // Check if user already has too many API keys (limit 5)
            const activeKeys = user.apiKeys.filter((key: any) => key.isActive);
            if (activeKeys.length >= 5) {
                loggingService.warn('API key generation failed - maximum keys limit reached', {
                    userId,
                    keyName: name,
                    currentActiveKeys: activeKeys.length,
                    maxAllowed: 5,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Maximum of 5 active API keys allowed. Please deactivate an existing key first.'
                });
                return;
            }

            const newApiKey: IApiKey = {
                id: crypto.randomBytes(8).toString('hex'),
                name: name.trim(),
                key: apiKey,
                created: new Date(),
                isActive: true
            };

            user.apiKeys.push(newApiKey);
            await user.save();

            const duration = Date.now() - startTime;

            loggingService.info('API key generated successfully', {
                userId,
                keyName: name,
                keyId: newApiKey.id,
                duration,
                totalActiveKeys: activeKeys.length + 1,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'api_key_generated',
                category: 'api_management',
                value: duration,
                metadata: {
                    userId,
                    keyName: name,
                    keyId: newApiKey.id,
                    totalActiveKeys: activeKeys.length + 1
                }
            });



            res.status(201).json({
                success: true,
                message: 'API key generated successfully',
                data: {
                    id: newApiKey.id,
                    name: newApiKey.name,
                    key: apiKey, // Only return the key on creation
                    created: newApiKey.created,
                    usage_instructions: {
                        chatgpt_integration: 'Use this key in your Custom GPT Actions authentication',
                        header_format: 'X-API-Key: ' + apiKey,
                        example_usage: 'Perfect for ChatGPT Custom GPT integration with Cost Katana'
                    }
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('API key generation failed', {
                userId,
                keyName: name,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to generate API key',
                message: error.message
            });
        }
    }

    /**
     * List user's API keys (without exposing actual keys)
     */
    static async listApiKeys(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;

        try {
            loggingService.info('API keys list request initiated', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });
            
            const user = await User.findById(userId).select('apiKeys');
            if (!user || !user.apiKeys) {
                const duration = Date.now() - startTime;

                loggingService.info('API keys list retrieved - no keys found', {
                    userId,
                    duration,
                    totalKeys: 0,
                    activeKeys: 0,
                    requestId: req.headers['x-request-id'] as string
                });

                res.json({
                    success: true,
                    data: [],
                    message: 'No API keys found'
                });
                return;
            }

            const apiKeysList = user.apiKeys.map((key: any) => ({
                id: key.id,
                name: key.name,
                key_preview: `${key.key.substring(0, 20)}...${key.key.slice(-4)}`,
                created: key.created,
                last_used: key.lastUsed || null,
                is_active: key.isActive,
                status: key.isActive ? 'Active' : 'Inactive'
            }));

            const duration = Date.now() - startTime;
            const activeKeys = apiKeysList.filter(k => k.is_active).length;

            loggingService.info('API keys list retrieved successfully', {
                userId,
                duration,
                totalKeys: apiKeysList.length,
                activeKeys,
                inactiveKeys: apiKeysList.length - activeKeys,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'api_keys_listed',
                category: 'api_management',
                value: duration,
                metadata: {
                    userId,
                    totalKeys: apiKeysList.length,
                    activeKeys,
                    inactiveKeys: apiKeysList.length - activeKeys
                }
            });

            res.json({
                success: true,
                data: apiKeysList,
                total: apiKeysList.length,
                active: activeKeys
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('API keys list retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to list API keys',
                message: error.message
            });
        }
    }

    /**
     * Deactivate an API key
     */
    static async deactivateApiKey(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { keyId } = req.params;

        try {
            loggingService.info('API key deactivation request initiated', {
                userId,
                keyId,
                requestId: req.headers['x-request-id'] as string
            });

            const user = await User.findById(userId);
            if (!user || !user.apiKeys) {
                loggingService.warn('API key deactivation failed - user or API keys not found', {
                    userId,
                    keyId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    error: 'API key not found'
                });
                return;
            }

            const apiKeyIndex = user.apiKeys.findIndex((key: any) => key.id === keyId);
            if (apiKeyIndex === -1) {
                loggingService.warn('API key deactivation failed - key not found', {
                    userId,
                    keyId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    error: 'API key not found'
                });
                return;
            }

            const keyName = user.apiKeys[apiKeyIndex].name;
            const wasActive = user.apiKeys[apiKeyIndex].isActive;

            user.apiKeys[apiKeyIndex].isActive = false;
            await user.save();

            const duration = Date.now() - startTime;

            loggingService.info('API key deactivated successfully', {
                userId,
                keyId,
                keyName,
                wasActive,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'api_key_deactivated',
                category: 'api_management',
                value: duration,
                metadata: {
                    userId,
                    keyId,
                    keyName,
                    wasActive
                }
            });



            res.json({
                success: true,
                message: 'API key deactivated successfully',
                data: {
                    id: keyId,
                    name: keyName,
                    status: 'Inactive'
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('API key deactivation failed', {
                userId,
                keyId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to deactivate API key',
                message: error.message
            });
        }
    }

    /**
     * Validate an API key and return user info (for internal use by ChatGPT controller)
     */
    static async validateApiKey(apiKey: string): Promise<{ userId: string; user: any } | null> {
        const startTime = Date.now();

        try {
            loggingService.info('API key validation initiated', {
                apiKeyPreview: `${apiKey.substring(0, 20)}...${apiKey.slice(-4)}`,
                requestId: 'internal'
            });

            // Extract userId from API key format: ck_user_{userId}_{random}
            const userIdMatch = apiKey.match(/ck_user_([a-f0-9]{24})/);
            if (!userIdMatch) {
                const duration = Date.now() - startTime;

                loggingService.warn('API key validation failed - invalid format', {
                    apiKeyPreview: `${apiKey.substring(0, 20)}...${apiKey.slice(-4)}`,
                    duration,
                    requestId: 'internal'
                });

                return null;
            }

            const userId = userIdMatch[1];
            const user = await User.findById(userId);
            
            if (!user || !user.apiKeys) {
                const duration = Date.now() - startTime;

                loggingService.warn('API key validation failed - user not found', {
                    userId,
                    apiKeyPreview: `${apiKey.substring(0, 20)}...${apiKey.slice(-4)}`,
                    duration,
                    requestId: 'internal'
                });

                return null;
            }

            // Find the matching API key
            const matchingKey = user.apiKeys.find((key: any) => 
                key.key === apiKey && key.isActive
            );

            if (!matchingKey) {
                const duration = Date.now() - startTime;

                loggingService.warn('API key validation failed - key not found or inactive', {
                    userId,
                    apiKeyPreview: `${apiKey.substring(0, 20)}...${apiKey.slice(-4)}`,
                    duration,
                    requestId: 'internal'
                });

                return null;
            }

            // Update last used timestamp
            matchingKey.lastUsed = new Date();
            await user.save();

            const duration = Date.now() - startTime;

            loggingService.info('API key validation successful', {
                userId,
                keyId: matchingKey.id,
                keyName: matchingKey.name,
                duration,
                requestId: 'internal'
            });

            // Log business event
            loggingService.logBusiness({
                event: 'api_key_validated',
                category: 'api_management',
                value: duration,
                metadata: {
                    userId,
                    keyId: matchingKey.id,
                    keyName: matchingKey.name
                }
            });

            return { userId, user };
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('API key validation failed', {
                apiKeyPreview: `${apiKey.substring(0, 20)}...${apiKey.slice(-4)}`,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: 'internal'
            });


            return null;
        }
    }

    /**
     * Regenerate an API key
     */
    static async regenerateApiKey(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { keyId } = req.params;

        try {
            loggingService.info('API key regeneration request initiated', {
                userId,
                keyId,
                requestId: req.headers['x-request-id'] as string
            });

            const user = await User.findById(userId);
            if (!user || !user.apiKeys) {
                loggingService.warn('API key regeneration failed - user or API keys not found', {
                    userId,
                    keyId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    error: 'API key not found'
                });
                return;
            }

            const apiKeyIndex = user.apiKeys.findIndex((key: any) => key.id === keyId);
            if (apiKeyIndex === -1) {
                loggingService.warn('API key regeneration failed - key not found', {
                    userId,
                    keyId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    error: 'API key not found'
                });
                return;
            }

            const oldKeyName = user.apiKeys[apiKeyIndex].name;
            const oldKeyPreview = `${user.apiKeys[apiKeyIndex].key.substring(0, 20)}...${user.apiKeys[apiKeyIndex].key.slice(-4)}`;

            // Generate new key
            const randomSuffix = crypto.randomBytes(16).toString('hex');
            const newApiKey = `ck_user_${userId}_${randomSuffix}`;

            // Update existing key
            user.apiKeys[apiKeyIndex].key = newApiKey;
            user.apiKeys[apiKeyIndex].created = new Date();
            user.apiKeys[apiKeyIndex].lastUsed = undefined;
            user.apiKeys[apiKeyIndex].isActive = true;

            await user.save();

            const duration = Date.now() - startTime;

            loggingService.info('API key regenerated successfully', {
                userId,
                keyId,
                keyName: oldKeyName,
                oldKeyPreview,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'api_key_regenerated',
                category: 'api_management',
                value: duration,
                metadata: {
                    userId,
                    keyId,
                    keyName: oldKeyName,
                    oldKeyPreview
                }
            });



            res.json({
                success: true,
                message: 'API key regenerated successfully',
                data: {
                    id: keyId,
                    name: oldKeyName,
                    key: newApiKey, // Return new key
                    created: user.apiKeys[apiKeyIndex].created,
                    warning: 'Please update this key in your ChatGPT Custom GPT Actions immediately. The old key is now invalid.'
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('API key regeneration failed', {
                userId,
                keyId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to regenerate API key',
                message: error.message
            });
        }
    }
} 