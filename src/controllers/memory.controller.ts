import { Request, Response } from 'express';
import { loggingService } from '../services/logging.service';
import { memoryService } from '../services/memory.service';
import { userPreferenceService } from '../services/userPreference.service';
import { vectorMemoryService } from '../services/vectorMemory.service';
import { UserMemory, ConversationMemory, UserPreference } from '../models/Memory';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class MemoryController {
    /**
     * Get user memory insights
     */
    static async getMemoryInsights(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('getMemoryInsights', req);
        const { userId } = req.params;

        try {
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');
            const insights = await memoryService.getUserMemoryInsights(userId);
            const duration = Date.now() - startTime;

            ControllerHelper.logRequestSuccess('getMemoryInsights', req, startTime, {
                insightsCount: insights.length,
                hasInsights: !!insights && insights.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'memory_insights_retrieved',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    insightsCount: insights.length,
                    hasInsights: !!insights && insights.length > 0
                }
            });

            return res.json({
                success: true,
                data: {
                    insights,
                    totalInsights: insights.length,
                    lastUpdated: new Date()
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getMemoryInsights', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get user preferences with parallel data fetching
     */
    static async getUserPreferences(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('getUserPreferences', req);
        const { userId } = req.params;

        try {
            loggingService.info('User preferences retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('User preferences retrieval failed - missing user ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            loggingService.info('User preferences retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            // Parallel data fetching for better performance
            const [preferences, preferenceSummary] = await Promise.all([
                userPreferenceService.getUserPreferences(userId),
                userPreferenceService.getPreferenceSummary(userId)
            ]);

            const duration = Date.now() - startTime;

            loggingService.info('User preferences retrieved successfully', {
                userId,
                duration,
                hasPreferences: !!preferences,
                hasPreferenceSummary: !!preferenceSummary,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_preferences_retrieved',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    hasPreferences: !!preferences,
                    hasPreferenceSummary: !!preferenceSummary
                }
            });

            return res.json({
                success: true,
                data: {
                    preferences: preferences || {},
                    summary: preferenceSummary,
                    hasPreferences: !!preferences
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User preferences retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve user preferences'
            });
        }
    }

    /**
     * Update user preferences
     */
    static async updateUserPreferences(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('updateUserPreferences', req);
        const { userId } = req.params;
        const updates = req.body;

        try {
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            await userPreferenceService.updatePreferences(userId, updates);
            const updatedPreferences = await userPreferenceService.getUserPreferences(userId);

            const duration = Date.now() - startTime;

            ControllerHelper.logRequestSuccess('updateUserPreferences', req, startTime, {
                hasUpdates: !!updates,
                updateKeys: updates ? Object.keys(updates) : [],
                hasUpdatedPreferences: !!updatedPreferences
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_preferences_updated',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    hasUpdates: !!updates,
                    updateKeys: updates ? Object.keys(updates) : [],
                    hasUpdatedPreferences: !!updatedPreferences
                }
            });

            return res.json({
                success: true,
                message: 'Preferences updated successfully',
                data: updatedPreferences
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateUserPreferences', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get conversation history with memory context
     */
    static async getConversationHistory(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('getConversationHistory', req);
        const { userId } = req.params;
        const { limit = 20, page = 1, includeArchived = false } = req.query;

        try {
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            const skip = (Number(page) - 1) * Number(limit);
            const query: any = { userId };
            
            if (!includeArchived) {
                query.isArchived = false;
            }

            const conversations = await ConversationMemory
                .find(query)
                .sort({ createdAt: -1 })
                .limit(Number(limit))
                .skip(skip)
                .lean();

            const totalCount = await ConversationMemory.countDocuments(query);

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('getConversationHistory', req, startTime, {
                limit: Number(limit),
                page: Number(page),
                includeArchived: Boolean(includeArchived),
                conversationsCount: conversations.length,
                totalCount,
                hasConversations: !!conversations && conversations.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'conversation_history_retrieved',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    limit: Number(limit),
                    page: Number(page),
                    includeArchived: Boolean(includeArchived),
                    conversationsCount: conversations.length,
                    totalCount,
                    hasConversations: !!conversations && conversations.length > 0
                }
            });

            return res.json({
                success: true,
                data: {
                    conversations,
                    pagination: {
                        page: Number(page),
                        limit: Number(limit),
                        total: totalCount,
                        totalPages: Math.ceil(totalCount / Number(limit))
                    }
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getConversationHistory', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get similar conversations
     */
    static async getSimilarConversations(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('getSimilarConversations', req);
        const { userId } = req.params;
        const { query, limit = 5 } = req.query;

        try {
            if (!userId || !query) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID and query are required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            const similarConversations = await memoryService.getSimilarConversations(
                userId, 
                query as string, 
                Number(limit)
            );

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('getSimilarConversations', req, startTime, {
                query: query as string,
                limit: Number(limit),
                similarConversationsCount: similarConversations.length,
                hasSimilarConversations: !!similarConversations && similarConversations.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'similar_conversations_retrieved',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    query: query as string,
                    limit: Number(limit),
                    similarConversationsCount: similarConversations.length,
                    hasSimilarConversations: !!similarConversations && similarConversations.length > 0
                }
            });

            return res.json({
                success: true,
                data: {
                    similarConversations,
                    query: query as string,
                    totalFound: similarConversations.length
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getSimilarConversations', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get personalized recommendations
     */
    static async getPersonalizedRecommendations(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('getPersonalizedRecommendations', req);
        const { userId } = req.params;
        const { query } = req.query;

        try {
            if (!userId || !query) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID and query are required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            const recommendations = await memoryService.getPersonalizedRecommendations(
                userId, 
                query as string
            );

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('getPersonalizedRecommendations', req, startTime, {
                query: query as string,
                recommendationsCount: recommendations.length,
                hasRecommendations: !!recommendations && recommendations.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'personalized_recommendations_retrieved',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    query: query as string,
                    recommendationsCount: recommendations.length,
                    hasRecommendations: !!recommendations && recommendations.length > 0
                }
            });

            return res.json({
                success: true,
                data: {
                    recommendations,
                    query: query as string,
                    totalRecommendations: recommendations.length
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getPersonalizedRecommendations', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Archive conversation
     */
    static async archiveConversation(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('archiveConversation', req);
        const { conversationId } = req.params;
        const { userId } = req.body;

        try {
            if (!conversationId || !userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Conversation ID and User ID are required'
                });
            }

            ServiceHelper.validateObjectId(conversationId, 'conversationId');
            ServiceHelper.validateObjectId(userId, 'userId');

            const conversation = await ConversationMemory.findOneAndUpdate(
                { _id: conversationId, userId },
                { isArchived: true, updatedAt: new Date() },
                { new: true }
            );

            if (!conversation) {
                return res.status(404).json({
                    success: false,
                    message: 'Conversation not found'
                });
            }

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('archiveConversation', req, startTime, {
                conversationId,
                hasConversation: !!conversation,
                isArchived: conversation.isArchived
            });

            // Log business event
            loggingService.logBusiness({
                event: 'conversation_archived',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    conversationId,
                    hasConversation: !!conversation,
                    isArchived: conversation.isArchived
                }
            });

            return res.json({
                success: true,
                message: 'Conversation archived successfully',
                data: conversation
            });
        } catch (error: any) {
            ControllerHelper.handleError('archiveConversation', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Delete conversation
     */
    static async deleteConversation(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('deleteConversation', req);
        const { conversationId } = req.params;
        const { userId } = req.body;

        try {
            if (!conversationId || !userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Conversation ID and User ID are required'
                });
            }

            ServiceHelper.validateObjectId(conversationId, 'conversationId');
            ServiceHelper.validateObjectId(userId, 'userId');

            const conversation = await ConversationMemory.findOneAndDelete({
                _id: conversationId,
                userId
            });

            if (!conversation) {
                return res.status(404).json({
                    success: false,
                    message: 'Conversation not found'
                });
            }

            // Also remove from vector storage
            await vectorMemoryService.clearUserVectors(userId);

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('deleteConversation', req, startTime, {
                conversationId,
                hasConversation: !!conversation,
                vectorStorageCleared: true
            });

            // Log business event
            loggingService.logBusiness({
                event: 'conversation_deleted',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    conversationId,
                    hasConversation: !!conversation,
                    vectorStorageCleared: true
                }
            });

            return res.json({
                success: true,
                message: 'Conversation deleted successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('deleteConversation', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Reset user preferences
     */
    static async resetPreferences(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('resetPreferences', req);
        const { userId } = req.params;

        try {
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            await userPreferenceService.resetPreferences(userId);

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('resetPreferences', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'user_preferences_reset',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId
                }
            });

            return res.json({
                success: true,
                message: 'User preferences reset successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('resetPreferences', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Clear all user memory (GDPR compliance)
     */
    static async clearUserMemory(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('clearUserMemory', req);
        const { userId } = req.params;

        try {
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            await memoryService.clearUserMemory(userId);

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('clearUserMemory', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'user_memory_cleared',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId
                }
            });

            return res.json({
                success: true,
                message: 'All user memory cleared successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('clearUserMemory', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Export user memory data (GDPR compliance)
     */
    static async exportUserData(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('exportUserData', req);
        const { userId } = req.params;

        try {
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            // Use streaming approach for large datasets and parallel fetching
            const [preferences, insights, vectorStorageStats] = await Promise.all([
                userPreferenceService.exportPreferences(userId),
                memoryService.getUserMemoryInsights(userId),
                Promise.resolve(vectorMemoryService.getStorageStats())
            ]);

            // Stream conversations and memories to avoid memory issues
            const [conversations, memories] = await Promise.all([
                ConversationMemory.find({ userId })
                    .select('-queryEmbedding -__v') // Exclude embeddings and version
                    .lean()
                    .limit(1000), // Limit for performance
                UserMemory.find({ userId })
                    .select('-__v')
                    .lean()
                    .limit(1000) // Limit for performance
            ]);

            const exportData = {
                userId,
                exportDate: new Date(),
                preferences,
                conversations,
                memories,
                insights,
                vectorStorageStats,
                dataLimits: {
                    conversationsIncluded: Math.min(conversations.length, 1000),
                    memoriesIncluded: Math.min(memories.length, 1000),
                    note: conversations.length >= 1000 || memories.length >= 1000 
                        ? 'Large datasets limited for performance. Contact support for full export.' 
                        : 'Complete dataset included'
                }
            };

            ControllerHelper.logRequestSuccess('exportUserData', req, startTime, {
                hasPreferences: !!preferences,
                conversationsCount: conversations.length,
                memoriesCount: memories.length,
                insightsCount: insights.length,
                hasVectorStorageStats: !!vectorMemoryService.getStorageStats()
            });

            // Log business event
            const duration = Date.now() - startTime;
            loggingService.logBusiness({
                event: 'user_data_exported',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    hasPreferences: !!preferences,
                    conversationsCount: conversations.length,
                    memoriesCount: memories.length,
                    insightsCount: insights.length,
                    hasVectorStorageStats: !!vectorMemoryService.getStorageStats()
                }
            });

            return res.json({
                success: true,
                data: exportData
            });
        } catch (error: any) {
            ControllerHelper.handleError('exportUserData', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get memory storage statistics
     */
    static async getStorageStats(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return res;
        ControllerHelper.logRequestStart('getStorageStats', req);
        const { userId } = req.params;

        try {
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            // Use aggregation for better performance and parallel execution
            const [storageStats, vectorStats] = await Promise.all([
                // Single aggregation query to get all counts
                Promise.all([
                    ConversationMemory.aggregate([
                        { $match: { userId } },
                        { $group: { _id: null, count: { $sum: 1 }, totalSize: { $sum: { $strLenCP: '$query' } } } }
                    ]),
                    UserMemory.aggregate([
                        { $match: { userId } },
                        { $group: { _id: null, count: { $sum: 1 }, totalSize: { $sum: { $strLenCP: '$content' } } } }
                    ]),
                    UserPreference.exists({ userId })
                ]),
                Promise.resolve(vectorMemoryService.getStorageStats())
            ]);

            const [conversationStats, memoryStats, preferenceExists] = storageStats;
            const conversationCount = conversationStats[0]?.count || 0;
            const memoryCount = memoryStats[0]?.count || 0;
            const conversationSize = conversationStats[0]?.totalSize || 0;
            const memorySize = memoryStats[0]?.totalSize || 0;

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('getStorageStats', req, startTime, {
                conversationCount,
                memoryCount,
                hasPreferences: !!preferenceExists,
                hasVectorStats: !!vectorStats
            });

            // Log business event
            loggingService.logBusiness({
                event: 'memory_storage_statistics_retrieved',
                category: 'memory_operations',
                value: duration,
                metadata: {
                    userId,
                    conversationCount,
                    memoryCount,
                    hasPreferences: !!preferenceExists,
                    hasVectorStats: !!vectorStats
                }
            });

            return res.json({
                success: true,
                data: {
                    userId,
                    conversationCount,
                    memoryCount,
                    hasPreferences: !!preferenceExists,
                    storageSize: {
                        conversations: `${(conversationSize / 1024).toFixed(2)} KB`,
                        memories: `${(memorySize / 1024).toFixed(2)} KB`,
                        total: `${((conversationSize + memorySize) / 1024).toFixed(2)} KB`
                    },
                    vectorStorage: vectorStats,
                    lastUpdated: new Date()
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getStorageStats', error, req, res, startTime);
            return res;
        }
    }
}