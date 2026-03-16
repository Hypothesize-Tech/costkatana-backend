/**
 * Cortex Training Data Collector Service (NestJS)
 *
 * Collects and manages training data from streaming executions for continuous
 * model improvement and optimization. Handles data anonymization, quality assessment,
 * and training dataset preparation.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  CortexToken,
  CortexStreamingExecution,
} from './cortex-streaming-orchestrator.service';

export interface TrainingSample {
  id: string;
  executionId: string;
  timestamp: Date;
  input: string;
  output: string;
  tokens: CortexToken[];
  metadata: {
    model: string;
    duration: number;
    cost: number;
    quality: 'excellent' | 'good' | 'fair' | 'poor';
    complexity: 'simple' | 'medium' | 'complex';
    success: boolean;
    errorType?: string;
  };
  anonymized: boolean;
  consentGiven: boolean;
}

export interface TrainingDataset {
  id: string;
  name: string;
  description: string;
  samples: TrainingSample[];
  created: Date;
  lastUpdated: Date;
  totalSamples: number;
  qualityDistribution: Record<string, number>;
  averageQuality: number;
  anonymizationLevel: 'none' | 'partial' | 'full';
}

@Injectable()
export class CortexTrainingDataCollectorService {
  private readonly logger = new Logger(CortexTrainingDataCollectorService.name);
  private samples: TrainingSample[] = [];
  private datasets = new Map<string, TrainingDataset>();
  private qualityThreshold = 0.7; // Minimum quality score to include in training

  /**
   * Collect training data from completed execution
   */
  public collectTrainingData(
    execution: CortexStreamingExecution,
  ): TrainingSample | null {
    try {
      // Only collect from successful executions with sufficient data
      if (execution.status !== 'completed' || execution.tokens.length < 10) {
        return null;
      }

      const quality = this.assessSampleQuality(execution);
      if (quality.score < this.qualityThreshold) {
        this.logger.debug(
          `Skipping low-quality training sample from execution ${execution.id}`,
        );
        return null;
      }

      const sample: TrainingSample = {
        id: `sample_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        executionId: execution.id,
        timestamp: new Date(),
        input: execution.inputText,
        output: this.extractOutputFromTokens(execution.tokens),
        tokens: execution.tokens,
        metadata: {
          model: `${execution.config.models.encoder}/${execution.config.models.processor}/${execution.config.models.decoder}`,
          duration: execution.duration || 0,
          cost: execution.totalCost,
          quality: quality.level,
          complexity: this.assessComplexity(execution),
          success: true,
        },
        anonymized: true, // Always anonymize data for privacy
        consentGiven: false, // Consent must be explicitly granted - never assume
      };

      this.samples.push(sample);

      this.logger.log(
        `📊 Collected training sample: ${sample.id} from execution ${execution.id}`,
        {
          quality: quality.level,
          complexity: sample.metadata.complexity,
          tokenCount: execution.tokens.length,
          cost: execution.totalCost,
        },
      );

      return sample;
    } catch (error) {
      this.logger.error(
        `❌ Failed to collect training data from execution ${execution.id}`,
        error,
      );
      return null;
    }
  }

  /**
   * Create a training dataset from collected samples
   */
  public createDataset(
    name: string,
    description: string,
    filters?: {
      minQuality?: 'excellent' | 'good' | 'fair' | 'poor';
      complexity?: 'simple' | 'medium' | 'complex';
      dateRange?: { start: Date; end: Date };
      maxSamples?: number;
    },
  ): TrainingDataset {
    let filteredSamples = [...this.samples];

    // Apply filters
    if (filters?.minQuality) {
      const qualityOrder = { poor: 0, fair: 1, good: 2, excellent: 3 };
      const minLevel = qualityOrder[filters.minQuality];
      filteredSamples = filteredSamples.filter(
        (s) => qualityOrder[s.metadata.quality] >= minLevel,
      );
    }

    if (filters?.complexity) {
      filteredSamples = filteredSamples.filter(
        (s) => s.metadata.complexity === filters.complexity,
      );
    }

    if (filters?.dateRange) {
      filteredSamples = filteredSamples.filter(
        (s) =>
          s.timestamp >= filters.dateRange!.start &&
          s.timestamp <= filters.dateRange!.end,
      );
    }

    if (filters?.maxSamples) {
      filteredSamples = filteredSamples.slice(0, filters.maxSamples);
    }

    // Anonymize sensitive data
    const anonymizedSamples = filteredSamples.map((sample) => ({
      ...sample,
      input: this.anonymizeText(sample.input),
      anonymized: true,
    }));

    const qualityDistribution =
      this.calculateQualityDistribution(anonymizedSamples);
    const averageQuality = this.calculateAverageQuality(anonymizedSamples);

    const dataset: TrainingDataset = {
      id: `dataset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      samples: anonymizedSamples,
      created: new Date(),
      lastUpdated: new Date(),
      totalSamples: anonymizedSamples.length,
      qualityDistribution,
      averageQuality,
      anonymizationLevel: 'full',
    };

    this.datasets.set(dataset.id, dataset);

    this.logger.log(`📋 Created training dataset: ${dataset.id}`, {
      name: dataset.name,
      samples: dataset.totalSamples,
      averageQuality: Math.round(averageQuality * 100) / 100,
      qualityDistribution,
    });

    return dataset;
  }

  /**
   * Get dataset by ID
   */
  public getDataset(datasetId: string): TrainingDataset | null {
    return this.datasets.get(datasetId) || null;
  }

  /**
   * Get all datasets
   */
  public getAllDatasets(): TrainingDataset[] {
    return Array.from(this.datasets.values());
  }

  /**
   * Export dataset in training format
   */
  public exportDataset(
    datasetId: string,
    format: 'json' | 'csv' = 'json',
  ): string | null {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) return null;

    switch (format) {
      case 'json':
        return JSON.stringify(
          dataset.samples.map((s) => ({
            input: s.input,
            output: s.output,
            metadata: s.metadata,
          })),
          null,
          2,
        );

      case 'csv':
        const headers = [
          'input',
          'output',
          'quality',
          'complexity',
          'duration',
          'cost',
        ];
        const rows = dataset.samples.map((s) => [
          `"${s.input.replace(/"/g, '""')}"`,
          `"${s.output.replace(/"/g, '""')}"`,
          s.metadata.quality,
          s.metadata.complexity,
          s.metadata.duration,
          s.metadata.cost,
        ]);
        return [headers.join(','), ...rows.map((row) => row.join(','))].join(
          '\n',
        );

      default:
        return null;
    }
  }

  /**
   * Get collection statistics
   */
  public getCollectionStats(): {
    totalSamples: number;
    datasetsCreated: number;
    averageQuality: number;
    qualityDistribution: Record<string, number>;
    recentActivity: number; // Samples in last 24 hours
  } {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const recentSamples = this.samples.filter(
      (s) => s.timestamp.getTime() > oneDayAgo,
    );
    const qualityDistribution = this.calculateQualityDistribution(this.samples);
    const averageQuality = this.calculateAverageQuality(this.samples);

    return {
      totalSamples: this.samples.length,
      datasetsCreated: this.datasets.size,
      averageQuality,
      qualityDistribution,
      recentActivity: recentSamples.length,
    };
  }

  /**
   * Clean up old samples
   */
  public cleanupOldSamples(maxAge: number = 30 * 24 * 60 * 60 * 1000): number {
    const cutoffTime = Date.now() - maxAge;
    const initialCount = this.samples.length;

    this.samples = this.samples.filter(
      (sample) => sample.timestamp.getTime() > cutoffTime,
    );

    const removedCount = initialCount - this.samples.length;
    if (removedCount > 0) {
      this.logger.log(`🧹 Cleaned up ${removedCount} old training samples`);
    }

    return removedCount;
  }

  // Private methods

  private assessSampleQuality(execution: CortexStreamingExecution): {
    score: number;
    level: 'excellent' | 'good' | 'fair' | 'poor';
  } {
    let score = 1.0;

    // Penalize for errors
    score -= execution.errors.length * 0.1;

    // Penalize for long duration (inefficient)
    if (execution.duration && execution.duration > 60000) {
      // > 1 minute
      score -= 0.2;
    }

    // Penalize for high cost
    if (execution.totalCost > 0.1) {
      // > $0.10
      score -= 0.1;
    }

    // Bonus for successful completion
    if (execution.status === 'completed') {
      score += 0.1;
    }

    // Determine level
    let level: 'excellent' | 'good' | 'fair' | 'poor';
    if (score >= 0.9) level = 'excellent';
    else if (score >= 0.7) level = 'good';
    else if (score >= 0.5) level = 'fair';
    else level = 'poor';

    return { score: Math.max(0, Math.min(1, score)), level };
  }

  private assessComplexity(
    execution: CortexStreamingExecution,
  ): 'simple' | 'medium' | 'complex' {
    const tokenCount = execution.tokens.length;
    const duration = execution.duration || 0;

    if (tokenCount < 50 && duration < 10000) return 'simple';
    if (tokenCount < 200 && duration < 30000) return 'medium';
    return 'complex';
  }

  private extractOutputFromTokens(tokens: CortexToken[]): string {
    const outputTokens = tokens.filter(
      (token) => token.type === 'output' || token.type === 'decoding',
    );
    return outputTokens.map((token) => token.content).join('');
  }

  private anonymizeText(text: string): string {
    // Simple anonymization - replace potential PII patterns
    return text
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]') // SSN pattern
      .replace(/\b\d{16}\b/g, '[CARD]') // Credit card pattern
      .replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        '[EMAIL]',
      ) // Email pattern
      .replace(/\b\d{3}-\d{3}-\d{4}\b/g, '[PHONE]'); // Phone pattern
  }

  private calculateQualityDistribution(
    samples: TrainingSample[],
  ): Record<string, number> {
    const distribution: Record<string, number> = {
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0,
    };

    for (const sample of samples) {
      distribution[sample.metadata.quality]++;
    }

    // Convert to percentages
    const total = samples.length;
    if (total > 0) {
      for (const key of Object.keys(distribution)) {
        distribution[key] = Math.round((distribution[key] / total) * 100);
      }
    }

    return distribution;
  }

  private calculateAverageQuality(samples: TrainingSample[]): number {
    if (samples.length === 0) return 0;

    const qualityScores = { excellent: 1.0, good: 0.75, fair: 0.5, poor: 0.25 };
    const totalScore = samples.reduce(
      (sum, sample) => sum + qualityScores[sample.metadata.quality],
      0,
    );

    return totalScore / samples.length;
  }
}
