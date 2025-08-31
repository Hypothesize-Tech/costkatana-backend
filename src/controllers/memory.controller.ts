import { Request, Response } from 'express';
import { loggingService } from '../services/logging.service';
import { memoryService } from '../services/memory.service';
import { userPreferenceService } from '../services/userPreference.service';
import { vectorMemoryService } from '../services/vectorMemory.service';
import { UserMemory, ConversationMemory, UserPreference } from '../models/Memory';

export class MemoryController {
    /**
     * Get user memory insights
     */
    static async getMemoryInsights(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;

        try {
            loggingService.info('Memory insights retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Memory insights retrieval failed - missing user ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            loggingService.info('Memory insights retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const insights = await memoryService.getUserMemoryInsights(userId);

            const duration = Date.now() - startTime;

            loggingService.info('Memory insights retrieved successfully', {
                userId,
                duration,
                insightsCount: insights.length,
                hasInsights: !!insights && insights.length > 0,
                requestId: req.headers['x-request-id'] as string
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Memory insights retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve memory insights'
            });
        }
    }

    /**
     * Get user preferences
     */
    static async getUserPreferences(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
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

            const preferences = await userPreferenceService.getUserPreferences(userId);
            const preferenceSummary = await userPreferenceService.getPreferenceSummary(userId);

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
    static async updateUserPreferences(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;
        const updates = req.body;

        try {
            loggingService.info('User preferences update initiated', {
                userId,
                hasUserId: !!userId,
                hasUpdates: !!updates,
                updateKeys: updates ? Object.keys(updates) : [],
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('User preferences update failed - missing user ID', {
                    hasUpdates: !!updates,
                    updateKeys: updates ? Object.keys(updates) : [],
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            loggingService.info('User preferences update processing started', {
                userId,
                hasUpdates: !!updates,
                updateKeys: updates ? Object.keys(updates) : [],
                requestId: req.headers['x-request-id'] as string
            });

            await userPreferenceService.updatePreferences(userId, updates);
            const updatedPreferences = await userPreferenceService.getUserPreferences(userId);

            const duration = Date.now() - startTime;

            loggingService.info('User preferences updated successfully', {
                userId,
                hasUpdates: !!updates,
                updateKeys: updates ? Object.keys(updates) : [],
                duration,
                hasUpdatedPreferences: !!updatedPreferences,
                requestId: req.headers['x-request-id'] as string
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
            const duration = Date.now() - startTime;
            
            loggingService.error('User preferences update failed', {
                userId,
                hasUpdates: !!updates,
                updateKeys: updates ? Object.keys(updates) : [],
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to update user preferences'
            });
        }
    }

    /**
     * Get conversation history with memory context
     */
    static async getConversationHistory(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;
        const { limit = 20, page = 1, includeArchived = false } = req.query;

        try {
            loggingService.info('Conversation history retrieval initiated', {
                userId,
                hasUserId: !!userId,
                limit: Number(limit),
                page: Number(page),
                includeArchived: Boolean(includeArchived),
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Conversation history retrieval failed - missing user ID', {
                    limit: Number(limit),
                    page: Number(page),
                    includeArchived: Boolean(includeArchived),
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            loggingService.info('Conversation history retrieval processing started', {
                userId,
                limit: Number(limit),
                page: Number(page),
                includeArchived: Boolean(includeArchived),
                requestId: req.headers['x-request-id'] as string
            });

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

            loggingService.info('Conversation history retrieved successfully', {
                userId,
                limit: Number(limit),
                page: Number(page),
                includeArchived: Boolean(includeArchived),
                duration,
                conversationsCount: conversations.length,
                totalCount,
                hasConversations: !!conversations && conversations.length > 0,
                requestId: req.headers['x-request-id'] as string
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Conversation history retrieval failed', {
                userId,
                limit: Number(limit),
                page: Number(page),
                includeArchived: Boolean(includeArchived),
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve conversation history'
            });
        }
    }

    /**
     * Get similar conversations
     */
    static async getSimilarConversations(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;
        const { query, limit = 5 } = req.query;

        try {
            loggingService.info('Similar conversations retrieval initiated', {
                userId,
                hasUserId: !!userId,
                query: query as string,
                hasQuery: !!query,
                limit: Number(limit),
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId || !query) {
                loggingService.warn('Similar conversations retrieval failed - missing required fields', {
                    userId,
                    hasUserId: !!userId,
                    query: query as string,
                    hasQuery: !!query,
                    limit: Number(limit),
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID and query are required'
                });
            }

            loggingService.info('Similar conversations retrieval processing started', {
                userId,
                query: query as string,
                limit: Number(limit),
                requestId: req.headers['x-request-id'] as string
            });

            const similarConversations = await memoryService.getSimilarConversations(
                userId, 
                query as string, 
                Number(limit)
            );

            const duration = Date.now() - startTime;

            loggingService.info('Similar conversations retrieved successfully', {
                userId,
                query: query as string,
                limit: Number(limit),
                duration,
                similarConversationsCount: similarConversations.length,
                hasSimilarConversations: !!similarConversations && similarConversations.length > 0,
                requestId: req.headers['x-request-id'] as string
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Similar conversations retrieval failed', {
                userId,
                query: query as string,
                hasQuery: !!query,
                limit: Number(limit),
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve similar conversations'
            });
        }
    }

    /**
     * Get personalized recommendations
     */
    static async getPersonalizedRecommendations(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;
        const { query } = req.query;

        try {
            loggingService.info('Personalized recommendations retrieval initiated', {
                userId,
                hasUserId: !!userId,
                query: query as string,
                hasQuery: !!query,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId || !query) {
                loggingService.warn('Personalized recommendations retrieval failed - missing required fields', {
                    userId,
                    hasUserId: !!userId,
                    query: query as string,
                    hasQuery: !!query,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID and query are required'
                });
            }

            loggingService.info('Personalized recommendations retrieval processing started', {
                userId,
                query: query as string,
                requestId: req.headers['x-request-id'] as string
            });

            const recommendations = await memoryService.getPersonalizedRecommendations(
                userId, 
                query as string
            );

            const duration = Date.now() - startTime;

            loggingService.info('Personalized recommendations retrieved successfully', {
                userId,
                query: query as string,
                duration,
                recommendationsCount: recommendations.length,
                hasRecommendations: !!recommendations && recommendations.length > 0,
                requestId: req.headers['x-request-id'] as string
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Personalized recommendations retrieval failed', {
                userId,
                query: query as string,
                hasQuery: !!query,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve personalized recommendations'
            });
        }
    }

    /**
     * Archive conversation
     */
    static async archiveConversation(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { conversationId } = req.params;
        const { userId } = req.body;

        try {
            loggingService.info('Conversation archiving initiated', {
                userId,
                hasUserId: !!userId,
                conversationId,
                hasConversationId: !!conversationId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!conversationId || !userId) {
                loggingService.warn('Conversation archiving failed - missing required fields', {
                    userId,
                    hasUserId: !!userId,
                    conversationId,
                    hasConversationId: !!conversationId,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'Conversation ID and User ID are required'
                });
            }

            loggingService.info('Conversation archiving processing started', {
                userId,
                conversationId,
                requestId: req.headers['x-request-id'] as string
            });

            const conversation = await ConversationMemory.findOneAndUpdate(
                { _id: conversationId, userId },
                { isArchived: true, updatedAt: new Date() },
                { new: true }
            );

            if (!conversation) {
                loggingService.warn('Conversation archiving failed - conversation not found', {
                    userId,
                    conversationId,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(404).json({
                    success: false,
                    message: 'Conversation not found'
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('Conversation archived successfully', {
                userId,
                conversationId,
                duration,
                hasConversation: !!conversation,
                isArchived: conversation.isArchived,
                requestId: req.headers['x-request-id'] as string
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Conversation archiving failed', {
                userId,
                conversationId,
                hasConversationId: !!conversationId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to archive conversation'
            });
        }
    }

    /**
     * Delete conversation
     */
    static async deleteConversation(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { conversationId } = req.params;
        const { userId } = req.body;

        try {
            loggingService.info('Conversation deletion initiated', {
                userId,
                hasUserId: !!userId,
                conversationId,
                hasConversationId: !!conversationId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!conversationId || !userId) {
                loggingService.warn('Conversation deletion failed - missing required fields', {
                    userId,
                    hasUserId: !!userId,
                    conversationId,
                    hasConversationId: !!conversationId,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'Conversation ID and User ID are required'
                });
            }

            loggingService.info('Conversation deletion processing started', {
                userId,
                conversationId,
                requestId: req.headers['x-request-id'] as string
            });

            const conversation = await ConversationMemory.findOneAndDelete({
                _id: conversationId,
                userId
            });

            if (!conversation) {
                loggingService.warn('Conversation deletion failed - conversation not found', {
                    userId,
                    conversationId,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(404).json({
                    success: false,
                    message: 'Conversation not found'
                });
            }

            // Also remove from vector storage
            await vectorMemoryService.clearUserVectors(userId);

            const duration = Date.now() - startTime;

            loggingService.info('Conversation deleted successfully', {
                userId,
                conversationId,
                duration,
                hasConversation: !!conversation,
                vectorStorageCleared: true,
                requestId: req.headers['x-request-id'] as string
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Conversation deletion failed', {
                userId,
                conversationId,
                hasConversationId: !!conversationId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to delete conversation'
            });
        }
    }

    /**
     * Reset user preferences
     */
    static async resetPreferences(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;

        try {
            loggingService.info('User preferences reset initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('User preferences reset failed - missing user ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            loggingService.info('User preferences reset processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            await userPreferenceService.resetPreferences(userId);

            const duration = Date.now() - startTime;

            loggingService.info('User preferences reset successfully', {
                userId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
            const duration = Date.now() - startTime;
            
            loggingService.error('User preferences reset failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to reset user preferences'
            });
        }
    }

    /**
     * Clear all user memory (GDPR compliance)
     */
    static async clearUserMemory(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;

        try {
            loggingService.info('User memory clearing initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('User memory clearing failed - missing user ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            loggingService.info('User memory clearing processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            await memoryService.clearUserMemory(userId);

            const duration = Date.now() - startTime;

            loggingService.info('User memory cleared successfully', {
                userId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
            const duration = Date.now() - startTime;
            
            loggingService.error('User memory clearing failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to clear user memory'
            });
        }
    }

    /**
     * Export user memory data (GDPR compliance)
     */
    static async exportUserData(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;

        try {
            loggingService.info('User data export initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('User data export failed - missing user ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            loggingService.info('User data export processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const [preferences, conversations, memories, insights] = await Promise.all([
                userPreferenceService.exportPreferences(userId),
                ConversationMemory.find({ userId }).lean(),
                UserMemory.find({ userId }).lean(),
                memoryService.getUserMemoryInsights(userId)
            ]);

            const exportData = {
                userId,
                exportDate: new Date(),
                preferences,
                conversations: conversations.map(conv => ({
                    ...conv,
                    queryEmbedding: undefined // Remove embeddings for privacy
                })),
                memories,
                insights,
                vectorStorageStats: vectorMemoryService.getStorageStats()
            };

            const duration = Date.now() - startTime;

            loggingService.info('User data exported successfully', {
                userId,
                duration,
                hasPreferences: !!preferences,
                conversationsCount: conversations.length,
                memoriesCount: memories.length,
                insightsCount: insights.length,
                hasVectorStorageStats: !!vectorMemoryService.getStorageStats(),
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
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
            const duration = Date.now() - startTime;
            
            loggingService.error('User data export failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to export user data'
            });
        }
    }

    /**
     * Get memory storage statistics
     */
    static async getStorageStats(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { userId } = req.params;

        try {
            loggingService.info('Memory storage statistics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Memory storage statistics retrieval failed - missing user ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            loggingService.info('Memory storage statistics retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const [conversationCount, memoryCount, preferenceExists] = await Promise.all([
                ConversationMemory.countDocuments({ userId }),
                UserMemory.countDocuments({ userId }),
                UserPreference.exists({ userId })
            ]);

            const vectorStats = vectorMemoryService.getStorageStats();

            const duration = Date.now() - startTime;

            loggingService.info('Memory storage statistics retrieved successfully', {
                userId,
                duration,
                conversationCount,
                memoryCount,
                hasPreferences: !!preferenceExists,
                hasVectorStats: !!vectorStats,
                requestId: req.headers['x-request-id'] as string
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
                    vectorStorage: vectorStats,
                    lastUpdated: new Date()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Memory storage statistics retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve storage statistics'
            });
        }
    }
}