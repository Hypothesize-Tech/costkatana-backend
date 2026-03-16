/**
 * Auto-Simulation Service
 *
 * Handles all auto-simulation business logic including triggering simulations,
 * processing queues, managing settings, and auto-optimization.
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import {
  AutoSimulationSettings,
  AutoSimulationSettingsDocument,
} from '../../schemas/analytics/auto-simulation-settings.schema';
import {
  AutoSimulationQueue,
  AutoSimulationQueueDocument,
} from '../../schemas/analytics/auto-simulation-queue.schema';
import { Usage } from '../../schemas/core/usage.schema';
import { ExperimentationService } from '../experimentation/services/experimentation.service';
import { SimulationTrackingService } from '../simulation-tracking/simulation-tracking.service';
import {
  AutoSimulationSettingsData,
  AutoSimulationQueueItemData,
  AutoSimulationSettingsUpdate,
} from './interfaces/auto-simulation.interfaces';

@Injectable()
export class AutoSimulationService {
  private readonly logger = new Logger(AutoSimulationService.name);

  constructor(
    @InjectModel(AutoSimulationSettings.name)
    private autoSimulationSettingsModel: Model<AutoSimulationSettingsDocument>,
    @InjectModel(AutoSimulationQueue.name)
    private autoSimulationQueueModel: Model<AutoSimulationQueueDocument>,
    @InjectModel(Usage.name)
    private usageModel: Model<any>,
    @Inject(forwardRef(() => ExperimentationService))
    private experimentationService: ExperimentationService,
    private simulationTrackingService: SimulationTrackingService,
  ) {}

  /**
   * Check if usage should trigger auto-simulation
   */
  async shouldTriggerSimulation(usageId: string): Promise<boolean> {
    try {
      // Single aggregation pipeline to get all needed data
      const [result] = await this.usageModel.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(usageId) } },
        {
          $lookup: {
            from: 'auto_simulation_settings',
            localField: 'userId',
            foreignField: 'userId',
            as: 'settings',
            pipeline: [
              { $project: { enabled: 1, triggers: 1 } }, // Only select needed fields
            ],
          },
        },
        {
          $lookup: {
            from: 'auto_simulation_queue',
            let: { userId: '$userId', usageId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$userId', '$$userId'] },
                      { $eq: ['$usageId', '$$usageId'] },
                      { $in: ['$status', ['pending', 'processing']] },
                    ],
                  },
                },
              },
              { $project: { _id: 1 } }, // Only need to know if exists
            ],
            as: 'existing',
          },
        },
        {
          $project: {
            cost: 1,
            totalTokens: 1,
            model: 1,
            settings: { $arrayElemAt: ['$settings', 0] },
            hasExisting: { $gt: [{ $size: '$existing' }, 0] },
          },
        },
      ]);

      if (!result) return false;

      const { settings, hasExisting, cost, totalTokens, model } = result;

      // Check if settings exist and enabled
      if (!settings || !settings.enabled) return false;

      // Check if already queued
      if (hasExisting) return false;

      const triggers = settings.triggers;
      if (!triggers) return false;

      // Check trigger conditions
      if (triggers.allCalls) return true;
      if (cost > triggers.costThreshold) return true;
      if (totalTokens > triggers.tokenThreshold) return true;
      if (triggers.expensiveModels && triggers.expensiveModels.includes(model))
        return true;

      return false;
    } catch (error) {
      this.logger.error(
        `Error checking auto-simulation trigger for usage ${usageId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Queue usage for auto-simulation
   */
  async queueForSimulation(usageId: string): Promise<string | null> {
    try {
      const usage = await this.usageModel.findById(usageId).lean();
      if (!usage) return null;

      const usageDoc = usage as { _id: unknown; userId?: string };
      const queueItem = new this.autoSimulationQueueModel({
        userId: usageDoc.userId,
        usageId: new mongoose.Types.ObjectId(usageId),
        status: 'pending',
      });

      const saved = await queueItem.save();
      this.logger.log(
        `Queued usage ${usageId} for auto-simulation: ${saved._id}`,
      );

      // Process immediately if not too busy
      setImmediate(() => this.processQueue());

      return saved._id.toString();
    } catch (error) {
      this.logger.error(
        `Error queuing for auto-simulation for usage ${usageId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Process auto-simulation queue
   */
  async processQueue(): Promise<void> {
    try {
      const pendingItems = await this.autoSimulationQueueModel
        .find({
          status: 'pending',
        })
        .sort({ createdAt: 1 })
        .limit(5) // Process 5 at a time
        .populate('usageId')
        .lean();

      if (pendingItems.length === 0) return;

      // Mark all items as processing in bulk operation
      const bulkOps = pendingItems.map((item) => ({
        updateOne: {
          filter: { _id: item._id },
          update: {
            status: 'processing',
            processedAt: new Date(),
          },
        },
      }));

      await this.autoSimulationQueueModel.bulkWrite(bulkOps);

      // Process items in parallel using Promise.all
      const results = await Promise.allSettled(
        pendingItems.map((item) => this.processQueueItem(item)),
      );

      // Log any failed processing
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.logger.error(
            `Failed to process queue item ${pendingItems[index]._id}:`,
            result.reason,
          );
        }
      });
    } catch (error) {
      this.logger.error('Error processing auto-simulation queue:', error);
    }
  }

  /**
   * Process individual queue item
   */
  private async processQueueItem(queueItem: any): Promise<void> {
    try {
      const usage = queueItem.usageId;
      if (!usage) {
        throw new Error('Usage not found');
      }

      // Run simulation and get settings in parallel
      const simulationRequest = {
        prompt: usage.prompt,
        currentModel: usage.model,
        simulationType: 'real_time_analysis' as const,
        options: {
          optimizationGoals: ['cost', 'quality'] as ('cost' | 'quality')[],
        },
      };

      const [result, settings] = await Promise.all([
        this.experimentationService.runRealTimeWhatIfSimulation(
          simulationRequest,
        ),
        this.autoSimulationSettingsModel
          .findOne({
            userId: queueItem.userId,
          })
          .select('autoOptimize')
          .lean(),
      ]);

      // Track simulation first
      const trackingId = await this.simulationTrackingService.trackSimulation({
        userId: queueItem.userId.toString(),
        sessionId: `auto-${queueItem._id}`,
        originalUsageId: usage._id.toString(),
        simulationType: 'real_time_analysis',
        originalModel: usage.model,
        originalPrompt: usage.prompt,
        originalCost: usage.cost,
        originalTokens: usage.totalTokens,
        optimizationOptions: result.optimizedOptions || [],
        recommendations: result.recommendations || [],
        potentialSavings: result.potentialSavings || 0,
        confidence: result.confidence || 0,
      });

      // Update queue item with tracking ID
      await this.autoSimulationQueueModel.findByIdAndUpdate(queueItem._id, {
        status: 'completed',
        simulationId: trackingId,
        optimizationOptions: result.optimizedOptions,
        recommendations: result.recommendations,
        potentialSavings: result.potentialSavings,
        confidence: result.confidence,
        updatedAt: new Date(),
      });

      // Check if auto-optimization should be applied
      if (settings?.autoOptimize?.enabled) {
        // Run auto-optimization in parallel with logging
        await Promise.all([
          this.considerAutoOptimization(
            queueItem._id.toString(),
            result,
            settings,
          ),
          Promise.resolve(
            this.logger.log(
              `Completed auto-simulation for queue item: ${queueItem._id}`,
              {
                trackingId,
                potentialSavings: result.potentialSavings,
                confidence: result.confidence,
              },
            ),
          ),
        ]);
      } else {
        this.logger.log(
          `Completed auto-simulation for queue item: ${queueItem._id}`,
          {
            trackingId,
            potentialSavings: result.potentialSavings,
            confidence: result.confidence,
          },
        );
      }
    } catch (error) {
      this.logger.error(`Error processing queue item ${queueItem._id}:`, error);

      // Update with error and retry logic
      await this.autoSimulationQueueModel.findByIdAndUpdate(queueItem._id, {
        status:
          queueItem.retryCount >= queueItem.maxRetries ? 'failed' : 'pending',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        retryCount: queueItem.retryCount + 1,
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Consider auto-optimization based on settings
   */
  private async considerAutoOptimization(
    queueItemId: string,
    simulationResult: any,
    settings: any,
  ): Promise<void> {
    try {
      if (
        !simulationResult.optimizedOptions ||
        simulationResult.optimizedOptions.length === 0
      ) {
        return;
      }

      const autoOptimizeSettings = settings.autoOptimize;
      const appliedOptimizations = [];

      for (const option of simulationResult.optimizedOptions) {
        const shouldAutoApply = this.shouldAutoApplyOptimization(
          option,
          autoOptimizeSettings,
        );

        if (shouldAutoApply) {
          appliedOptimizations.push({
            ...option,
            autoApplied: true,
            appliedAt: new Date(),
          });
        }
      }

      if (appliedOptimizations.length > 0) {
        await this.autoSimulationQueueModel.findByIdAndUpdate(queueItemId, {
          autoApplied: true,
          appliedOptimizations,
          updatedAt: new Date(),
        });

        this.logger.log(
          `Auto-applied ${appliedOptimizations.length} optimizations for queue item: ${queueItemId}`,
        );
      }
    } catch (error) {
      this.logger.error('Error considering auto-optimization:', error);
    }
  }

  /**
   * Determine if optimization should be auto-applied
   */
  private shouldAutoApplyOptimization(option: any, settings: any): boolean {
    // Check savings threshold
    if (option.savingsPercentage < settings.maxSavingsThreshold * 100) {
      return false;
    }

    // Check risk tolerance
    const riskLevels = { low: 1, medium: 2, high: 3 };
    const optionRisk = riskLevels[option.risk as keyof typeof riskLevels] || 2;
    const toleranceRisk =
      riskLevels[settings.riskTolerance as keyof typeof riskLevels] || 2;

    if (optionRisk > toleranceRisk) {
      return false;
    }

    // Check if approval is required
    if (settings.approvalRequired) {
      return false; // Queue for approval instead
    }

    return true;
  }

  /**
   * Get user's auto-simulation settings
   */
  async getUserSettings(
    userId: string,
  ): Promise<AutoSimulationSettingsData | null> {
    try {
      const settings = await this.autoSimulationSettingsModel
        .findOne({
          userId: new mongoose.Types.ObjectId(userId),
        })
        .lean();

      if (!settings) return null;

      return {
        userId: settings.userId.toString(),
        enabled: settings.enabled,
        triggers: settings.triggers || {
          costThreshold: 0.01,
          tokenThreshold: 1000,
          expensiveModels: [],
          allCalls: false,
        },
        autoOptimize: settings.autoOptimize || {
          enabled: false,
          approvalRequired: true,
          maxSavingsThreshold: 0.5,
          riskTolerance: 'medium',
        },
        notifications: settings.notifications
          ? {
              email: settings.notifications.email,
              dashboard: settings.notifications.dashboard,
              slack: settings.notifications.slack,
              slackWebhook: settings.notifications.slackWebhook || undefined,
            }
          : {
              email: true,
              dashboard: true,
              slack: false,
            },
      };
    } catch (error) {
      this.logger.error(
        `Error getting user settings for user ${userId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Update user's auto-simulation settings
   */
  async updateUserSettings(
    userId: string,
    settings: AutoSimulationSettingsUpdate,
  ): Promise<void> {
    try {
      await this.autoSimulationSettingsModel.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId) },
        {
          ...settings,
          userId: new mongoose.Types.ObjectId(userId),
          updatedAt: new Date(),
        },
        { upsert: true, new: true },
      );

      this.logger.log(`Updated auto-simulation settings for user: ${userId}`);
    } catch (error) {
      this.logger.error(
        `Error updating user settings for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get user's simulation queue
   */
  async getUserQueue(
    userId: string,
    status?: string,
    limit: number = 20,
  ): Promise<AutoSimulationQueueItemData[]> {
    try {
      // Use aggregation pipeline for better performance
      const pipeline: any[] = [
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      ];

      if (status) {
        pipeline[0].$match.status = status;
      }

      pipeline.push(
        { $sort: { createdAt: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'usages',
            localField: 'usageId',
            foreignField: '_id',
            as: 'usage',
            pipeline: [
              { $project: { prompt: 1, model: 1, cost: 1, totalTokens: 1 } }, // Only needed fields
            ],
          },
        },
        {
          $project: {
            _id: 1,
            userId: 1,
            status: 1,
            simulationId: 1,
            optimizationOptions: 1,
            recommendations: 1,
            potentialSavings: 1,
            confidence: 1,
            autoApplied: 1,
            appliedOptimizations: 1,
            errorMessage: 1,
            createdAt: 1,
            updatedAt: 1,
            usage: { $arrayElemAt: ['$usage', 0] },
          },
        },
      );

      const items = await this.autoSimulationQueueModel.aggregate(pipeline);

      return items.map((item) => ({
        id: item._id.toString(),
        userId: item.userId.toString(),
        usageId: item.usage?._id.toString() || '',
        status: item.status,
        simulationId: item.simulationId || undefined,
        optimizationOptions: item.optimizationOptions,
        recommendations: item.recommendations,
        potentialSavings: item.potentialSavings || undefined,
        confidence: item.confidence || undefined,
        autoApplied: item.autoApplied,
        appliedOptimizations: item.appliedOptimizations,
        errorMessage: item.errorMessage || undefined,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
    } catch (error) {
      this.logger.error(`Error getting user queue for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Approve or reject pending optimization
   */
  async handleOptimizationApproval(
    queueItemId: string,
    approved: boolean,
    selectedOptimizations?: number[],
  ): Promise<void> {
    try {
      const updateData: any = {
        status: approved ? 'approved' : 'rejected',
        updatedAt: new Date(),
      };

      if (
        approved &&
        selectedOptimizations &&
        selectedOptimizations.length > 0
      ) {
        const queueItem =
          await this.autoSimulationQueueModel.findById(queueItemId);
        if (queueItem && queueItem.optimizationOptions) {
          const appliedOptimizations = selectedOptimizations.map((index) => ({
            ...queueItem.optimizationOptions[index],
            approved: true,
            appliedAt: new Date(),
          }));

          updateData.autoApplied = true;
          updateData.appliedOptimizations = appliedOptimizations;
        }
      }

      await this.autoSimulationQueueModel.findByIdAndUpdate(
        queueItemId,
        updateData,
      );

      this.logger.log(
        `${approved ? 'Approved' : 'Rejected'} optimization for queue item: ${queueItemId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error handling optimization approval for queue item ${queueItemId}:`,
        error,
      );
      throw error;
    }
  }
}
