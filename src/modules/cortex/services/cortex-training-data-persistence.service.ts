/**
 * Cortex Training Data Persistence Service (NestJS)
 *
 * Production parity with Express CortexTrainingDataCollectorService: in-memory
 * collection queue, batch insert to MongoDB, startSession/collect/finalizeSession,
 * getStats, exportTrainingData (delegate to store), addUserFeedback (delegate to store).
 * Used by optimization/Cortex flow to persist training data and by the API for stats/export/feedback.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CortexTrainingData,
  CortexTrainingDataDocument,
} from '../../../schemas/core/cortex-training-data.schema';
import { CortexTrainingDataStoreService } from './cortex-training-data-store.service';
import type { CortexFrame } from '../types/cortex.types';

/** Entry built in memory before batch insert (matches Express CortexTrainingDataEntry). */
export interface CortexTrainingDataEntry {
  sessionId: string;
  userId: string;
  timestamp: Date;
  originalPrompt: string;
  originalTokenCount: number;
  lispInstructions?: {
    encoderPrompt: string;
    coreProcessorPrompt: string;
    decoderPrompt: string;
    generatedAt: Date;
    model: string;
  };
  encoderStage?: {
    inputText: string;
    outputLisp: CortexFrame;
    confidence: number;
    processingTime: number;
    model: string;
    tokenCounts: { input: number; output: number };
  };
  coreProcessorStage?: {
    inputLisp: CortexFrame;
    outputLisp: CortexFrame;
    answerType: string;
    processingTime: number;
    model: string;
    tokenCounts: { input: number; output: number };
  };
  decoderStage?: {
    inputLisp: CortexFrame;
    outputText: string;
    style: string;
    processingTime: number;
    model: string;
    tokenCounts: { input: number; output: number };
  };
  performance?: {
    totalProcessingTime: number;
    totalTokenReduction: number;
    tokenReductionPercentage: number;
    costSavings: number;
    qualityScore?: number;
  };
  context?: {
    service: string;
    category: string;
    complexity: 'simple' | 'medium' | 'complex';
    language: string;
    userAgent?: string;
    requestId?: string;
  };
  trainingLabels?: {
    isSuccessful: boolean;
    userFeedback?: number;
    errorType?: string;
    improvementSuggestions?: string[];
  };
}

export interface ExportFilters {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  complexity?: 'simple' | 'medium' | 'complex';
  minTokenReduction?: number;
  limit?: number;
}

export interface UserFeedbackData {
  rating?: number;
  isSuccessful?: boolean;
  improvementSuggestions?: string[];
}

@Injectable()
export class CortexTrainingDataPersistenceService implements OnModuleDestroy {
  private readonly logger = new Logger(
    CortexTrainingDataPersistenceService.name,
  );
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_INTERVAL_MS = 30000;
  private readonly STALE_THRESHOLD_MS = 30 * 60 * 1000;

  private collectionQueue = new Map<string, Partial<CortexTrainingDataEntry>>();
  private batchQueue: CortexTrainingDataEntry[] = [];
  private batchIntervalId?: NodeJS.Timeout;
  private cleanupIntervalId?: NodeJS.Timeout;

  private stats = {
    totalCollected: 0,
    successfulSaves: 0,
    failedSaves: 0,
    totalProcessingTime: 0,
    batchesProcessed: 0,
  };

  constructor(
    @InjectModel(CortexTrainingData.name)
    private readonly cortexTrainingDataModel: Model<CortexTrainingDataDocument>,
    private readonly store: CortexTrainingDataStoreService,
  ) {
    this.batchIntervalId = setInterval(() => {
      void this.processBatch();
    }, this.BATCH_INTERVAL_MS);
    this.cleanupIntervalId = setInterval(
      () => this.cleanupStaleEntries(),
      60000,
    );
    this.logger.log('Cortex training data persistence service started');
  }

  onModuleDestroy(): void {
    if (this.batchIntervalId) clearInterval(this.batchIntervalId);
    if (this.cleanupIntervalId) clearInterval(this.cleanupIntervalId);
    this.logger.log('Cortex training data persistence service stopped');
  }

  startSession(
    sessionId: string,
    userId: string,
    originalPrompt: string,
    context: Partial<CortexTrainingDataEntry['context']>,
  ): void {
    setImmediate(() => {
      try {
        const entry: Partial<CortexTrainingDataEntry> = {
          sessionId,
          userId,
          timestamp: new Date(),
          originalPrompt,
          originalTokenCount: this.estimateTokenCount(originalPrompt),
          context: {
            service: 'optimization',
            category: 'unknown',
            complexity: this.analyzeComplexity(originalPrompt),
            language: 'en',
            ...context,
          },
        };
        this.collectionQueue.set(sessionId, entry);
        this.logger.debug('Started Cortex training data collection', {
          sessionId,
          userId,
          promptLength: originalPrompt.length,
        });
      } catch (error) {
        this.logger.debug('Training data collection start failed (silent)', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  collectLispInstructions(
    sessionId: string,
    instructions: {
      encoderPrompt: string;
      coreProcessorPrompt: string;
      decoderPrompt: string;
      model: string;
    },
  ): void {
    setImmediate(() => {
      try {
        const entry = this.collectionQueue.get(sessionId);
        if (entry) {
          entry.lispInstructions = {
            ...instructions,
            generatedAt: new Date(),
          };
          this.collectionQueue.set(sessionId, entry);
        }
      } catch (error) {
        this.logger.debug('Failed to collect LISP instructions (silent)', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  collectEncoderData(
    sessionId: string,
    data: {
      inputText: string;
      outputLisp: CortexFrame;
      confidence: number;
      processingTime: number;
      model: string;
    },
  ): void {
    setImmediate(() => {
      try {
        const entry = this.collectionQueue.get(sessionId);
        if (entry) {
          entry.encoderStage = {
            ...data,
            tokenCounts: {
              input: this.estimateTokenCount(data.inputText),
              output: this.estimateTokenCount(JSON.stringify(data.outputLisp)),
            },
          };
          this.collectionQueue.set(sessionId, entry);
        }
      } catch (error) {
        this.logger.debug('Failed to collect encoder data (silent)', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  collectCoreProcessorData(
    sessionId: string,
    data: {
      inputLisp: CortexFrame;
      outputLisp: CortexFrame;
      answerType: string;
      processingTime: number;
      model: string;
    },
  ): void {
    setImmediate(() => {
      try {
        const entry = this.collectionQueue.get(sessionId);
        if (entry) {
          entry.coreProcessorStage = {
            ...data,
            tokenCounts: {
              input: this.estimateTokenCount(JSON.stringify(data.inputLisp)),
              output: this.estimateTokenCount(JSON.stringify(data.outputLisp)),
            },
          };
          this.collectionQueue.set(sessionId, entry);
        }
      } catch (error) {
        this.logger.debug('Failed to collect core processor data (silent)', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  collectDecoderData(
    sessionId: string,
    data: {
      inputLisp: CortexFrame;
      outputText: string;
      style: string;
      processingTime: number;
      model: string;
    },
  ): void {
    setImmediate(() => {
      try {
        const entry = this.collectionQueue.get(sessionId);
        if (entry) {
          entry.decoderStage = {
            ...data,
            tokenCounts: {
              input: this.estimateTokenCount(JSON.stringify(data.inputLisp)),
              output: this.estimateTokenCount(data.outputText),
            },
          };
          this.collectionQueue.set(sessionId, entry);
        }
      } catch (error) {
        this.logger.debug('Failed to collect decoder data (silent)', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  finalizeSession(
    sessionId: string,
    performance: {
      totalProcessingTime: number;
      totalTokenReduction: number;
      tokenReductionPercentage: number;
      costSavings: number;
      qualityScore?: number;
    },
  ): void {
    setImmediate(() => {
      try {
        const entry = this.collectionQueue.get(sessionId);
        if (!entry) return;

        if (this.batchQueue.length >= this.MAX_QUEUE_SIZE) {
          this.logger.debug('Batch queue full, dropping oldest entries', {
            queueSize: this.batchQueue.length,
            maxSize: this.MAX_QUEUE_SIZE,
          });
          this.batchQueue.splice(0, this.BATCH_SIZE);
        }

        const fullEntry: CortexTrainingDataEntry = {
          ...entry,
          sessionId: entry.sessionId!,
          userId: entry.userId!,
          timestamp: entry.timestamp ?? new Date(),
          originalPrompt: entry.originalPrompt!,
          originalTokenCount: entry.originalTokenCount ?? 0,
          performance,
          trainingLabels: { isSuccessful: true },
        } as CortexTrainingDataEntry;

        this.batchQueue.push(fullEntry);
        this.collectionQueue.delete(sessionId);
        this.stats.totalCollected++;

        this.logger.debug('Cortex training data queued for batch processing', {
          sessionId,
          batchQueueSize: this.batchQueue.length,
          totalTokenReduction: performance.totalTokenReduction,
          reductionPercentage: performance.tokenReductionPercentage,
        });
      } catch (error) {
        this.logger.debug('Cortex training data finalization failed (silent)', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.collectionQueue.delete(sessionId);
      }
    });
  }

  private async processBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const batch = this.batchQueue.splice(0, this.BATCH_SIZE);

    try {
      const docs = batch.map((e) => ({
        sessionId: e.sessionId,
        userId: e.userId,
        timestamp: e.timestamp,
        originalPrompt: e.originalPrompt,
        originalTokenCount: e.originalTokenCount,
        lispInstructions: e.lispInstructions,
        encoderStage: e.encoderStage,
        coreProcessorStage: e.coreProcessorStage,
        decoderStage: e.decoderStage,
        performance: e.performance,
        context: e.context,
        trainingLabels: e.trainingLabels,
      }));

      await this.cortexTrainingDataModel.insertMany(docs, { ordered: false });
      this.stats.successfulSaves += batch.length;
      this.stats.batchesProcessed++;
      this.stats.totalProcessingTime += batch.reduce(
        (sum, d) => sum + (d.performance?.totalProcessingTime ?? 0),
        0,
      );

      this.logger.debug('Batch training data saved', {
        batchSize: batch.length,
        totalBatches: this.stats.batchesProcessed,
      });
    } catch (error) {
      this.stats.failedSaves += batch.length;
      this.logger.debug('Batch save failed', {
        batchSize: batch.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getStats(): {
    totalCollected: number;
    successfulSaves: number;
    failedSaves: number;
    averageProcessingTime: number;
    batchesProcessed: number;
    queueSize: number;
    batchQueueSize: number;
  } {
    const avgTime =
      this.stats.successfulSaves > 0
        ? this.stats.totalProcessingTime / this.stats.successfulSaves
        : 0;
    return {
      ...this.stats,
      averageProcessingTime: Math.round(avgTime * 100) / 100,
      queueSize: this.collectionQueue.size,
      batchQueueSize: this.batchQueue.length,
    };
  }

  async exportTrainingData(
    filters: ExportFilters = {},
  ): Promise<Record<string, unknown>[]> {
    return this.store.exportTrainingData(filters);
  }

  async addUserFeedback(
    sessionId: string,
    feedback: UserFeedbackData,
  ): Promise<void> {
    await this.store.addUserFeedback(sessionId, feedback);
  }

  async getBasicInsights(
    filters: ExportFilters,
    userId: string,
    isAdmin: boolean,
  ): Promise<
    Awaited<ReturnType<CortexTrainingDataStoreService['getBasicInsights']>>
  > {
    return this.store.getBasicInsights(filters, userId, isAdmin);
  }

  triggerDetailedInsightsAsync(
    filters: ExportFilters,
    userId: string,
    isAdmin: boolean,
  ): void {
    setImmediate(() => {
      this.runDetailedInsightsAsync(filters, userId, isAdmin).catch((err) => {
        this.logger.error('Background insights generation failed', {
          error: err instanceof Error ? err.message : String(err),
          userId,
        });
      });
    });
  }

  private async runDetailedInsightsAsync(
    filters: ExportFilters,
    userId: string,
    isAdmin: boolean,
  ): Promise<void> {
    const query: Record<string, unknown> = {};
    if (filters.startDate || filters.endDate) {
      query.timestamp = {};
      if (filters.startDate)
        (query.timestamp as Record<string, Date>).$gte = filters.startDate;
      if (filters.endDate)
        (query.timestamp as Record<string, Date>).$lte = filters.endDate;
    }
    if (!isAdmin && userId) query.userId = userId;

    const trainingData = await this.cortexTrainingDataModel
      .find(query)
      .sort({ timestamp: -1 })
      .limit(10000)
      .lean()
      .exec();

    const totalSessions = trainingData.length;
    const insights = {
      totalSessions,
      averageTokenReduction:
        totalSessions > 0
          ? trainingData.reduce(
              (sum, d) =>
                sum +
                ((d.performance as { tokenReductionPercentage?: number })
                  ?.tokenReductionPercentage ?? 0),
              0,
            ) / totalSessions
          : 0,
      averageProcessingTime:
        totalSessions > 0
          ? trainingData.reduce(
              (sum, d) =>
                sum +
                ((d.performance as { totalProcessingTime?: number })
                  ?.totalProcessingTime ?? 0),
              0,
            ) / totalSessions
          : 0,
      averageCostSavings:
        totalSessions > 0
          ? trainingData.reduce(
              (sum, d) =>
                sum +
                ((d.performance as { costSavings?: number })?.costSavings ?? 0),
              0,
            ) / totalSessions
          : 0,
      complexityBreakdown: {
        simple: trainingData.filter(
          (d) =>
            (d.context as { complexity?: string })?.complexity === 'simple',
        ).length,
        medium: trainingData.filter(
          (d) =>
            (d.context as { complexity?: string })?.complexity === 'medium',
        ).length,
        complex: trainingData.filter(
          (d) =>
            (d.context as { complexity?: string })?.complexity === 'complex',
        ).length,
      },
      successRate:
        totalSessions > 0
          ? trainingData.filter(
              (d) =>
                (d.trainingLabels as { isSuccessful?: boolean })
                  ?.isSuccessful !== false,
            ).length / totalSessions
          : 0,
      averageUserRating: (() => {
        const rated = trainingData.filter(
          (d) =>
            (d.trainingLabels as { userFeedback?: number })?.userFeedback !=
            null,
        );
        return rated.length > 0
          ? rated.reduce(
              (sum, d) =>
                sum +
                ((d.trainingLabels as { userFeedback?: number })
                  ?.userFeedback ?? 0),
              0,
            ) / rated.length
          : 0;
      })(),
      modelUsage: {
        encoder: this.getModelUsageStats(
          trainingData as Record<string, unknown>[],
          'encoderStage',
        ),
        coreProcessor: this.getModelUsageStats(
          trainingData as Record<string, unknown>[],
          'coreProcessorStage',
        ),
        decoder: this.getModelUsageStats(
          trainingData as Record<string, unknown>[],
          'decoderStage',
        ),
      },
      isBasicStats: false,
    };

    this.logger.log('Detailed training insights generated in background', {
      userId,
      totalSessions: insights.totalSessions,
    });
  }

  private getModelUsageStats(
    trainingData: Record<string, unknown>[],
    stage: string,
  ): {
    usage: Record<string, number>;
    averageProcessingTime: Record<string, number>;
  } {
    const modelCounts: Record<string, number> = {};
    const modelPerformance: Record<
      string,
      { totalTime: number; count: number }
    > = {};

    for (const item of trainingData) {
      const stageData = item[stage] as
        | { model?: string; processingTime?: number }
        | undefined;
      if (stageData?.model) {
        const model = stageData.model;
        modelCounts[model] = (modelCounts[model] ?? 0) + 1;
        if (!modelPerformance[model]) {
          modelPerformance[model] = { totalTime: 0, count: 0 };
        }
        modelPerformance[model].totalTime += stageData.processingTime ?? 0;
        modelPerformance[model].count += 1;
      }
    }

    const averageProcessingTime: Record<string, number> = {};
    for (const model of Object.keys(modelPerformance)) {
      const p = modelPerformance[model];
      averageProcessingTime[model] =
        p.count > 0 ? Math.round((p.totalTime / p.count) * 100) / 100 : 0;
    }

    return { usage: modelCounts, averageProcessingTime };
  }

  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private analyzeComplexity(prompt: string): 'simple' | 'medium' | 'complex' {
    const length = prompt.length;
    const words = prompt.split(/\s+/).length;
    if (length < 100 && words < 20) return 'simple';
    if (length < 500 && words < 100) return 'medium';
    return 'complex';
  }

  private cleanupStaleEntries(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    this.collectionQueue.forEach((entry, sessionId) => {
      if (
        entry.timestamp &&
        now - entry.timestamp.getTime() > this.STALE_THRESHOLD_MS
      ) {
        toDelete.push(sessionId);
      }
    });
    toDelete.forEach((id) => {
      this.collectionQueue.delete(id);
      this.logger.debug('Cleaned up stale training data entry', {
        sessionId: id,
      });
    });
  }
}
