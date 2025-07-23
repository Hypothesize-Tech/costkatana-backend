import { Response } from 'express';
import { User } from '../models/User';
import { logger } from '../utils/logger';
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
        try {
            const userId = req.user!.id;
            const { name } = req.body;

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

            logger.info(`API key generated for user ${userId}`, {
                userId,
                keyName: name,
                keyId: newApiKey.id
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
            logger.error('Generate API key error:', error);
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
        try {
            const userId = req.user!.id;
            
            const user = await User.findById(userId).select('apiKeys');
            if (!user || !user.apiKeys) {
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

            res.json({
                success: true,
                data: apiKeysList,
                total: apiKeysList.length,
                active: apiKeysList.filter(k => k.is_active).length
            });
        } catch (error: any) {
            logger.error('List API keys error:', error);
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
        try {
            const userId = req.user!.id;
            const { keyId } = req.params;

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

            user.apiKeys[apiKeyIndex].isActive = false;
            await user.save();

            logger.info(`API key deactivated for user ${userId}`, {
                userId,
                keyId,
                keyName: user.apiKeys[apiKeyIndex].name
            });

            res.json({
                success: true,
                message: 'API key deactivated successfully',
                data: {
                    id: keyId,
                    name: user.apiKeys[apiKeyIndex].name,
                    status: 'Inactive'
                }
            });
        } catch (error: any) {
            logger.error('Deactivate API key error:', error);
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
        try {
            // Extract userId from API key format: ck_user_{userId}_{random}
            const userIdMatch = apiKey.match(/ck_user_([a-f0-9]{24})/);
            if (!userIdMatch) {
                return null;
            }

            const userId = userIdMatch[1];
            const user = await User.findById(userId);
            
            if (!user || !user.apiKeys) {
                return null;
            }

            // Find the matching API key
            const matchingKey = user.apiKeys.find((key: any) => 
                key.key === apiKey && key.isActive
            );

            if (!matchingKey) {
                return null;
            }

            // Update last used timestamp
            matchingKey.lastUsed = new Date();
            await user.save();

            return { userId, user };
        } catch (error) {
            logger.error('API key validation error:', error);
            return null;
        }
    }

    /**
     * Regenerate an API key
     */
    static async regenerateApiKey(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { keyId } = req.params;

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

            // Generate new key
            const randomSuffix = crypto.randomBytes(16).toString('hex');
            const newApiKey = `ck_user_${userId}_${randomSuffix}`;

            // Update existing key
            user.apiKeys[apiKeyIndex].key = newApiKey;
            user.apiKeys[apiKeyIndex].created = new Date();
            user.apiKeys[apiKeyIndex].lastUsed = undefined;
            user.apiKeys[apiKeyIndex].isActive = true;

            await user.save();

            logger.info(`API key regenerated for user ${userId}`, {
                userId,
                keyId,
                keyName: oldKeyName
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
            logger.error('Regenerate API key error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to regenerate API key',
                message: error.message
            });
        }
    }
} 