import { Response } from 'express';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';
import crypto from 'crypto';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

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
    static async generateApiKey(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { name } = req.body;

        ControllerHelper.logRequestStart('generateApiKey', req, { keyName: name });

        try {

            if (!name || name.trim() === '') {
                res.status(400).json({
                    success: false,
                    error: 'API key name is required'
                });
                return;
            }

            // Generate API key in format: ck_user_{userId}_{random}
            const randomSuffix = crypto.randomBytes(16).toString('hex');
            const apiKey = `ck_user_${userId}_${randomSuffix}`;

            ServiceHelper.validateObjectId(userId, 'userId');

            // Get user and add API key
            const user = await User.findById(userId);
            if (!user) {
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

            ControllerHelper.logRequestSuccess('generateApiKey', req, startTime, {
                keyName: name,
                keyId: newApiKey.id,
                totalActiveKeys: activeKeys.length + 1
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'api_key_generated',
                'api_management',
                userId,
                Date.now() - startTime,
                { keyName: name, keyId: newApiKey.id, totalActiveKeys: activeKeys.length + 1 }
            );



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
            ControllerHelper.handleError('generateApiKey', error, req, res, startTime, { keyName: name });
        }
    }

    /**
     * List user's API keys (without exposing actual keys)
     */
    static async listApiKeys(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('listApiKeys', req);

        try {
            ServiceHelper.validateObjectId(userId, 'userId');
            
            const user = await User.findById(userId).select('apiKeys');
            if (!user || !user.apiKeys) {
                ControllerHelper.logRequestSuccess('listApiKeys', req, startTime, {
                    totalKeys: 0,
                    activeKeys: 0
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

            const activeKeys = apiKeysList.filter(k => k.is_active).length;

            ControllerHelper.logRequestSuccess('listApiKeys', req, startTime, {
                totalKeys: apiKeysList.length,
                activeKeys,
                inactiveKeys: apiKeysList.length - activeKeys
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'api_keys_listed',
                'api_management',
                userId,
                Date.now() - startTime,
                { totalKeys: apiKeysList.length, activeKeys, inactiveKeys: apiKeysList.length - activeKeys }
            );

            res.json({
                success: true,
                data: apiKeysList,
                total: apiKeysList.length,
                active: activeKeys
            });
        } catch (error: any) {
            ControllerHelper.handleError('listApiKeys', error, req, res, startTime);
        }
    }

    /**
     * Deactivate an API key
     */
    static async deactivateApiKey(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { keyId } = req.params;

        ControllerHelper.logRequestStart('deactivateApiKey', req, { keyId });

        try {

            ServiceHelper.validateObjectId(userId, 'userId');

            const user = await User.findById(userId);
            if (!user || !user.apiKeys) {
                res.status(404).json({
                    success: false,
                    error: 'API key not found'
                });
                return;
            }

            const apiKeyIndex = user.apiKeys.findIndex((key: any) => key.id === keyId);
            if (apiKeyIndex === -1) {
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

            ControllerHelper.logRequestSuccess('deactivateApiKey', req, startTime, {
                keyId,
                keyName,
                wasActive
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'api_key_deactivated',
                'api_management',
                userId,
                Date.now() - startTime,
                { keyId, keyName, wasActive }
            );



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
            ControllerHelper.handleError('deactivateApiKey', error, req, res, startTime, { keyId });
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
    static async regenerateApiKey(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { keyId } = req.params;

        ControllerHelper.logRequestStart('regenerateApiKey', req, { keyId });

        try {

            ServiceHelper.validateObjectId(userId, 'userId');

            const user = await User.findById(userId);
            if (!user || !user.apiKeys) {
                res.status(404).json({
                    success: false,
                    error: 'API key not found'
                });
                return;
            }

            const apiKeyIndex = user.apiKeys.findIndex((key: any) => key.id === keyId);
            if (apiKeyIndex === -1) {
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

            ControllerHelper.logRequestSuccess('regenerateApiKey', req, startTime, {
                keyId,
                keyName: oldKeyName,
                oldKeyPreview
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'api_key_regenerated',
                'api_management',
                userId,
                Date.now() - startTime,
                { keyId, keyName: oldKeyName, oldKeyPreview }
            );



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
            ControllerHelper.handleError('regenerateApiKey', error, req, res, startTime, { keyId });
        }
    }
} 