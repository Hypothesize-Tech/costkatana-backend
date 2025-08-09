import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { memoryService } from '../services/memory.service';
import { userPreferenceService } from '../services/userPreference.service';
import { vectorMemoryService } from '../services/vectorMemory.service';
import { UserMemory, ConversationMemory, UserPreference } from '../models/Memory';

export class MemoryController {
    /**
     * Get user memory insights
     */
    static async getMemoryInsights(req: Request, res: Response): Promise<Response> {
        try {
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const insights = await memoryService.getUserMemoryInsights(userId);
            
            return res.json({
                success: true,
                data: {
                    insights,
                    totalInsights: insights.length,
                    lastUpdated: new Date()
                }
            });
        } catch (error) {
            logger.error('❌ Failed to get memory insights:', error);
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
        try {
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const preferences = await userPreferenceService.getUserPreferences(userId);
            const preferenceSummary = await userPreferenceService.getPreferenceSummary(userId);
            
            return res.json({
                success: true,
                data: {
                    preferences: preferences || {},
                    summary: preferenceSummary,
                    hasPreferences: !!preferences
                }
            });
        } catch (error) {
            logger.error('❌ Failed to get user preferences:', error);
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
        try {
            const { userId } = req.params;
            const updates = req.body;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            await userPreferenceService.updatePreferences(userId, updates);
            const updatedPreferences = await userPreferenceService.getUserPreferences(userId);
            
            return res.json({
                success: true,
                message: 'Preferences updated successfully',
                data: updatedPreferences
            });
        } catch (error) {
            logger.error('❌ Failed to update user preferences:', error);
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
        try {
            const { userId } = req.params;
            const { limit = 20, page = 1, includeArchived = false } = req.query;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

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
        } catch (error) {
            logger.error('❌ Failed to get conversation history:', error);
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
        try {
            const { userId } = req.params;
            const { query, limit = 5 } = req.query;
            
            if (!userId || !query) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID and query are required'
                });
            }

            const similarConversations = await memoryService.getSimilarConversations(
                userId, 
                query as string, 
                Number(limit)
            );
            
            return res.json({
                success: true,
                data: {
                    similarConversations,
                    query: query as string,
                    totalFound: similarConversations.length
                }
            });
        } catch (error) {
            logger.error('❌ Failed to get similar conversations:', error);
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
        try {
            const { userId } = req.params;
            const { query } = req.query;
            
            if (!userId || !query) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID and query are required'
                });
            }

            const recommendations = await memoryService.getPersonalizedRecommendations(
                userId, 
                query as string
            );
            
            return res.json({
                success: true,
                data: {
                    recommendations,
                    query: query as string,
                    totalRecommendations: recommendations.length
                }
            });
        } catch (error) {
            logger.error('❌ Failed to get personalized recommendations:', error);
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
        try {
            const { conversationId } = req.params;
            const { userId } = req.body;
            
            if (!conversationId || !userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Conversation ID and User ID are required'
                });
            }

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
            
            return res.json({
                success: true,
                message: 'Conversation archived successfully',
                data: conversation
            });
        } catch (error) {
            logger.error('❌ Failed to archive conversation:', error);
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
        try {
            const { conversationId } = req.params;
            const { userId } = req.body;
            
            if (!conversationId || !userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Conversation ID and User ID are required'
                });
            }

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
            
            return res.json({
                success: true,
                message: 'Conversation deleted successfully'
            });
        } catch (error) {
            logger.error('❌ Failed to delete conversation:', error);
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
        try {
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            await userPreferenceService.resetPreferences(userId);
            
            return res.json({
                success: true,
                message: 'User preferences reset successfully'
            });
        } catch (error) {
            logger.error('❌ Failed to reset preferences:', error);
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
        try {
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            await memoryService.clearUserMemory(userId);
            
            return res.json({
                success: true,
                message: 'All user memory cleared successfully'
            });
        } catch (error) {
            logger.error('❌ Failed to clear user memory:', error);
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
        try {
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

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
            
            return res.json({
                success: true,
                data: exportData
            });
        } catch (error) {
            logger.error('❌ Failed to export user data:', error);
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
        try {
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const [conversationCount, memoryCount, preferenceExists] = await Promise.all([
                ConversationMemory.countDocuments({ userId }),
                UserMemory.countDocuments({ userId }),
                UserPreference.exists({ userId })
            ]);

            const vectorStats = vectorMemoryService.getStorageStats();
            
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
        } catch (error) {
            logger.error('❌ Failed to get storage stats:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve storage statistics'
            });
        }
    }
}