import { loggingService } from './logging.service';
import { UserPreference } from '../models/Memory';

export interface UserPreferenceData {
    preferredModel?: string;
    preferredChatMode?: 'fastest' | 'cheapest' | 'balanced';
    preferredStyle?: string;
    commonTopics?: string[];
    costPreference?: 'cheap' | 'balanced' | 'premium';
    responseLength?: 'concise' | 'detailed' | 'comprehensive';
    technicalLevel?: 'beginner' | 'intermediate' | 'expert';
    notificationPreferences?: {
        email: boolean;
        push: boolean;
        sms: boolean;
    };
    privacySettings?: {
        shareData: boolean;
        trackUsage: boolean;
        personalizedRecommendations: boolean;
    };
}

export class UserPreferenceService {
    // In-memory cache for frequently accessed preferences
    private preferenceCache = new Map<string, { data: any; timestamp: number }>();
    private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes

    constructor() {
        // Clean up cache periodically
        setInterval(() => this.cleanupCache(), 10 * 60 * 1000); // Every 10 minutes
    }

    /**
     * Get user preferences with caching
     */
    async getUserPreferences(userId: string): Promise<UserPreferenceData | null> {
        try {
            // Check cache first
            const cached = this.preferenceCache.get(userId);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                return cached.data;
            }

            // Fetch from database
            const userPreference = await UserPreference.findOne({ userId });
            const preferences = userPreference ? userPreference.toObject() : null;

            // Cache the result
            if (preferences) {
                this.preferenceCache.set(userId, {
                    data: preferences,
                    timestamp: Date.now()
                });
            }

            return preferences;
        } catch (error) {
            loggingService.error('❌ Failed to get user preferences:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    /**
     * Update user preferences
     */
    async updatePreferences(userId: string, updates: Partial<UserPreferenceData>): Promise<void> {
        try {
            loggingService.info(`🔧 Updating preferences for user: ${userId}`);

            // Get existing preferences
            let userPreference = await UserPreference.findOne({ userId });

            if (userPreference) {
                // Update existing preferences
                Object.assign(userPreference, updates);
                
                // Handle array fields specially (merge instead of replace)
                if (updates.commonTopics) {
                    const existingTopics = userPreference.commonTopics || [];
                    const newTopics = updates.commonTopics;
                    
                    // Merge and deduplicate topics
                    const mergedTopics = [...new Set([...existingTopics, ...newTopics])];
                    userPreference.commonTopics = mergedTopics.slice(0, 20); // Limit to 20 topics
                }

                userPreference.updatedAt = new Date();
                await userPreference.save();
            } else {
                // Create new preferences
                userPreference = new UserPreference({
                    userId,
                    ...updates,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                await userPreference.save();
            }

            // Update cache
            this.preferenceCache.set(userId, {
                data: userPreference.toObject(),
                timestamp: Date.now()
            });

            loggingService.info(`✅ Updated preferences for user: ${userId}`);
        } catch (error) {
            loggingService.error('❌ Failed to update user preferences:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get personalized model recommendation
     */
    async getRecommendedModel(userId: string, context?: string): Promise<string> {
        try {
            const preferences = await this.getUserPreferences(userId);
            
            if (preferences?.preferredModel) {
                return preferences.preferredModel;
            }

            // Default recommendations based on context
            if (context) {
                const contextLower = context.toLowerCase();
                
                if (contextLower.includes('code') || contextLower.includes('programming')) {
                    return 'amazon.nova-pro-v1:0'; // Good for coding
                }
                
                if (contextLower.includes('creative') || contextLower.includes('writing')) {
                    return 'anthropic.claude-3-5-sonnet-20241022-v2:0'; // Good for creative tasks
                }
                
                if (contextLower.includes('analysis') || contextLower.includes('data')) {
                    return 'amazon.nova-pro-v1:0'; // Good for analysis
                }
            }

            // Default model
            return 'amazon.nova-pro-v1:0';
        } catch (error) {
            loggingService.error('❌ Failed to get recommended model:', { error: error instanceof Error ? error.message : String(error) });
            return 'amazon.nova-pro-v1:0';
        }
    }

    /**
     * Get personalized chat mode
     */
    async getRecommendedChatMode(userId: string): Promise<'fastest' | 'cheapest' | 'balanced'> {
        try {
            const preferences = await this.getUserPreferences(userId);
            
            if (preferences?.preferredChatMode) {
                return preferences.preferredChatMode;
            }

            // Analyze cost preference
            if (preferences?.costPreference === 'cheap') {
                return 'cheapest';
            } else if (preferences?.costPreference === 'premium') {
                return 'fastest';
            }

            return 'balanced'; // Default
        } catch (error) {
            loggingService.error('❌ Failed to get recommended chat mode:', { error: error instanceof Error ? error.message : String(error) });
            return 'balanced';
        }
    }

    /**
     * Learn from user interaction
     */
    async learnFromInteraction(userId: string, interaction: {
        query: string;
        modelUsed?: string;
        chatMode?: string;
        userSatisfaction?: number; // 1-5 rating
        responseTime?: number;
        cost?: number;
    }): Promise<void> {
        try {
            const preferences = await this.getUserPreferences(userId) || {};

            // Extract topics from query
            const topics = this.extractTopicsFromQuery(interaction.query);
            if (topics.length > 0) {
                const existingTopics = preferences.commonTopics || [];
                const updatedTopics = [...new Set([...existingTopics, ...topics])];
                
                await this.updatePreferences(userId, {
                    commonTopics: updatedTopics.slice(0, 20)
                });
            }

            // Learn model preference from satisfaction
            if (interaction.modelUsed && interaction.userSatisfaction && interaction.userSatisfaction >= 4) {
                await this.updatePreferences(userId, {
                    preferredModel: interaction.modelUsed
                });
            }

            // Learn chat mode preference
            if (interaction.chatMode && interaction.userSatisfaction && interaction.userSatisfaction >= 4) {
                await this.updatePreferences(userId, {
                    preferredChatMode: interaction.chatMode as any
                });
            }

            loggingService.info(`📚 Learned from interaction for user: ${userId}`);
        } catch (error) {
            loggingService.error('❌ Failed to learn from interaction:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Extract topics from query using simple keyword analysis
     */
    private extractTopicsFromQuery(query: string): string[] {
        const topics: string[] = [];
        const queryLower = query.toLowerCase();

        // AI/ML topics
        const aiTopics = ['ai', 'machine learning', 'deep learning', 'neural network', 'llm', 'gpt', 'claude', 'gemini'];
        const techTopics = ['programming', 'code', 'javascript', 'python', 'react', 'node', 'api', 'database'];
        const businessTopics = ['pricing', 'cost', 'budget', 'analytics', 'optimization', 'performance'];
        const cloudTopics = ['aws', 'azure', 'gcp', 'cloud', 'serverless', 'docker', 'kubernetes'];

        const allTopics = [...aiTopics, ...techTopics, ...businessTopics, ...cloudTopics];

        for (const topic of allTopics) {
            if (queryLower.includes(topic)) {
                topics.push(topic);
            }
        }

        return topics;
    }

    /**
     * Get user preference summary
     */
    async getPreferenceSummary(userId: string): Promise<string> {
        try {
            const preferences = await this.getUserPreferences(userId);
            
            if (!preferences) {
                return "No preferences set yet. I'll learn from your interactions!";
            }

            const summary: string[] = [];

            if (preferences.preferredModel) {
                summary.push(`Prefers ${preferences.preferredModel} model`);
            }

            if (preferences.preferredChatMode) {
                summary.push(`Likes ${preferences.preferredChatMode} mode`);
            }

            if (preferences.costPreference) {
                summary.push(`Budget preference: ${preferences.costPreference}`);
            }

            if (preferences.commonTopics && preferences.commonTopics.length > 0) {
                const topTopics = preferences.commonTopics.slice(0, 3);
                summary.push(`Often asks about: ${topTopics.join(', ')}`);
            }

            if (preferences.responseLength) {
                summary.push(`Prefers ${preferences.responseLength} responses`);
            }

            if (preferences.technicalLevel) {
                summary.push(`Technical level: ${preferences.technicalLevel}`);
            }

            return summary.length > 0 
                ? summary.join(' • ')
                : "Learning your preferences from interactions...";
        } catch (error) {
            loggingService.error('❌ Failed to get preference summary:', { error: error instanceof Error ? error.message : String(error) });
            return "Unable to load preferences";
        }
    }

    /**
     * Reset user preferences
     */
    async resetPreferences(userId: string): Promise<void> {
        try {
            loggingService.info(`🔄 Resetting preferences for user: ${userId}`);

            await UserPreference.deleteOne({ userId });
            this.preferenceCache.delete(userId);

            loggingService.info(`✅ Reset preferences for user: ${userId}`);
        } catch (error) {
            loggingService.error('❌ Failed to reset user preferences:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, value] of this.preferenceCache.entries()) {
            if (now - value.timestamp > this.CACHE_TTL) {
                this.preferenceCache.delete(key);
            }
        }
    }

    /**
     * Export user preferences (GDPR compliance)
     */
    async exportPreferences(userId: string): Promise<any> {
        try {
            const preferences = await this.getUserPreferences(userId);
            return preferences || {};
        } catch (error) {
            loggingService.error('❌ Failed to export preferences:', { error: error instanceof Error ? error.message : String(error) });
            return {};
        }
    }
}

export const userPreferenceService = new UserPreferenceService();