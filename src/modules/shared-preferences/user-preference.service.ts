import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UserPreference,
  UserPreferenceDocument,
} from '../../schemas/agent/memory.schema';

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
  updatedAt?: Date;
}

@Injectable()
export class UserPreferenceService {
  private readonly logger = new Logger(UserPreferenceService.name);

  // In-memory cache for frequently accessed preferences
  private preferenceCache = new Map<
    string,
    { data: UserPreferenceData; timestamp: number }
  >();
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  constructor(
    @InjectModel(UserPreference.name)
    private readonly userPreferenceModel: Model<UserPreferenceDocument>,
  ) {
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
      const userPreference = await this.userPreferenceModel.findOne({ userId });
      const preferences = userPreference ? userPreference.toObject() : null;

      // Cache the result
      if (preferences) {
        this.preferenceCache.set(userId, {
          data: preferences,
          timestamp: Date.now(),
        });
      }

      return preferences;
    } catch (error) {
      this.logger.error('Failed to get user preferences', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return null;
    }
  }

  /**
   * Update user preferences
   */
  async updatePreferences(
    userId: string,
    updates: Partial<UserPreferenceData>,
  ): Promise<void> {
    try {
      this.logger.log(`Updating preferences for user: ${userId}`, { updates });

      // Get existing preferences
      let userPreference = await this.userPreferenceModel.findOne({ userId });

      if (userPreference) {
        // Update existing preferences
        Object.assign(userPreference, updates);

        // Handle array fields specially (merge instead of replace)
        if (updates.commonTopics) {
          const existingTopics = userPreference.commonTopics || [];
          const newTopics = updates.commonTopics;

          // Merge and deduplicate topics
          const mergedTopics = Array.from(
            new Set([...existingTopics, ...newTopics]),
          );
          userPreference.commonTopics = mergedTopics.slice(0, 20);
        }

        userPreference.updatedAt = new Date();
        await userPreference.save();
      } else {
        // Create new preferences
        userPreference = new this.userPreferenceModel({
          userId,
          ...updates,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await userPreference.save();
      }

      // Invalidate cache
      this.preferenceCache.delete(userId);

      this.logger.log(`Successfully updated preferences for user: ${userId}`);
    } catch (error) {
      this.logger.error('Failed to update user preferences', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  /**
   * Delete user preferences
   */
  async deletePreferences(userId: string): Promise<void> {
    try {
      await this.userPreferenceModel.deleteOne({ userId });
      this.preferenceCache.delete(userId);
      this.logger.log(`Deleted preferences for user: ${userId}`);
    } catch (error) {
      this.logger.error('Failed to delete user preferences', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  /**
   * Learn from user interaction
   */
  async learnFromInteraction(
    userId: string,
    interaction: {
      modelUsed?: string;
      topic?: string;
      responseLength?: 'concise' | 'detailed' | 'comprehensive';
      rating?: number;
      feedback?: string;
    },
  ): Promise<void> {
    try {
      const preferences = (await this.getUserPreferences(userId)) || {};
      const updates: Partial<UserPreferenceData> = {};

      // Learn preferred model
      if (
        interaction.modelUsed &&
        interaction.rating &&
        interaction.rating >= 4
      ) {
        updates.preferredModel = interaction.modelUsed;
      }

      // Learn common topics
      if (interaction.topic) {
        const currentTopics = preferences.commonTopics || [];
        if (!currentTopics.includes(interaction.topic)) {
          updates.commonTopics = [...currentTopics, interaction.topic].slice(
            0,
            20,
          );
        }
      }

      // Learn preferred response length
      if (
        interaction.responseLength &&
        interaction.rating &&
        interaction.rating >= 4
      ) {
        updates.responseLength = interaction.responseLength;
      }

      if (Object.keys(updates).length > 0) {
        await this.updatePreferences(userId, updates);
        this.logger.log('Learned from user interaction', { userId, updates });
      }
    } catch (error) {
      this.logger.error('Failed to learn from interaction', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Get user analytics for preferences
   */
  async getAnalytics(userId: string): Promise<any> {
    try {
      const preferences = await this.getUserPreferences(userId);
      if (!preferences) return null;

      return {
        preferredModel: preferences.preferredModel,
        chatMode: preferences.preferredChatMode,
        costPreference: preferences.costPreference,
        technicalLevel: preferences.technicalLevel,
        responseLength: preferences.responseLength,
        topicCount: preferences.commonTopics?.length || 0,
        notificationSettings: preferences.notificationPreferences,
        lastUpdated: preferences.updatedAt,
      };
    } catch (error) {
      this.logger.error('Failed to get user analytics', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return null;
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [userId, entry] of this.preferenceCache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.preferenceCache.delete(userId);
      }
    }
  }
}
