/**
 * RAG Evaluation Controller
 * Handles batch evaluation of RAG pipeline (RAGAS-aligned metrics)
 */

import { Response } from 'express';
import { modularRAGOrchestrator } from '../rag';
import { ragEvaluator } from '../rag/evaluation';
import type { EvaluationMetrics } from '../rag/evaluation';
import type { RAGPatternType, RAGConfig, RAGContext } from '../rag/types/rag.types';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';

const MAX_DATASET_SIZE = 50;

export interface RAGEvalDatasetItem {
  question: string;
  groundTruth?: string;
}

export interface RAGEvalRequest {
  dataset: RAGEvalDatasetItem[];
  pattern?: RAGPatternType;
  config?: Partial<RAGConfig>;
}

export interface RAGEvalResultItem {
  question: string;
  answer: string;
  metrics: EvaluationMetrics;
  success: boolean;
}

export interface RAGEvalAggregate {
  mean: EvaluationMetrics;
  std: EvaluationMetrics;
  min: EvaluationMetrics;
  max: EvaluationMetrics;
}

export interface RAGEvalResponse {
  results: RAGEvalResultItem[];
  aggregate: RAGEvalAggregate;
  totalSamples: number;
  failedSamples: number;
}

/**
 * POST /evaluate - Run batch RAG evaluation on a dataset
 */
export async function evaluateBatch(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const startTime = Date.now();

  if (!ControllerHelper.requireAuth(req, res)) {
    return;
  }

  const body = req.body as RAGEvalRequest;
  const { dataset, pattern, config: customConfig } = body;

  if (!Array.isArray(dataset) || dataset.length === 0) {
    res.status(400).json({
      error: 'dataset is required and must be a non-empty array',
    });
    return;
  }

  if (dataset.length > MAX_DATASET_SIZE) {
    res.status(400).json({
      error: `dataset size must not exceed ${MAX_DATASET_SIZE}`,
    });
    return;
  }

  const context: RAGContext = {
    userId: req.userId ?? 'rag-eval-user',
    conversationId: `rag-eval-${Date.now()}`,
  };

  // Ensure we do not run pipeline evaluation in batch (we run evaluator explicitly)
  const ragConfig: Partial<RAGConfig> = {
    ...customConfig,
    evaluation: { enabled: false },
  };

  const results: RAGEvalResultItem[] = [];
  const metricsCollected: EvaluationMetrics[] = [];
  let failedSamples = 0;

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    const question = typeof item?.question === 'string' ? item.question : String(item?.question ?? '');
    const groundTruth = typeof item?.groundTruth === 'string' ? item.groundTruth : undefined;

    try {
      const ragResult = await modularRAGOrchestrator.execute({
        query: question,
        context,
        preferredPattern: pattern,
        config: ragConfig,
      });

      if (!ragResult.success || !ragResult.answer) {
        results.push({
          question,
          answer: ragResult.answer ?? '',
          metrics: {
            contextRelevance: 0,
            answerFaithfulness: 0,
            answerRelevance: 0,
            retrievalPrecision: 0,
            retrievalRecall: 0,
            overall: 0,
          },
          success: false,
        });
        failedSamples++;
        continue;
      }

      const evalMetrics = await ragEvaluator.evaluate({
        query: question,
        answer: ragResult.answer,
        documents: ragResult.documents,
        groundTruth,
      });

      metricsCollected.push(evalMetrics);
      results.push({
        question,
        answer: ragResult.answer,
        metrics: evalMetrics,
        success: true,
      });
    } catch (error) {
      loggingService.warn('RAG eval sample failed', {
        component: 'RAGEvalController',
        question: question.substring(0, 80),
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({
        question,
        answer: '',
        metrics: {
          contextRelevance: 0,
          answerFaithfulness: 0,
          answerRelevance: 0,
          retrievalPrecision: 0,
          retrievalRecall: 0,
          overall: 0,
        },
        success: false,
      });
      failedSamples++;
    }
  }

  const aggregate = metricsCollected.length > 0
    ? ragEvaluator.calculateAggregateStats(metricsCollected)
    : {
        mean: { contextRelevance: 0, answerFaithfulness: 0, answerRelevance: 0, retrievalPrecision: 0, retrievalRecall: 0, overall: 0 },
        std: { contextRelevance: 0, answerFaithfulness: 0, answerRelevance: 0, retrievalPrecision: 0, retrievalRecall: 0, overall: 0 },
        min: { contextRelevance: 0, answerFaithfulness: 0, answerRelevance: 0, retrievalPrecision: 0, retrievalRecall: 0, overall: 0 },
        max: { contextRelevance: 0, answerFaithfulness: 0, answerRelevance: 0, retrievalPrecision: 0, retrievalRecall: 0, overall: 0 },
      };

  const response: RAGEvalResponse = {
    results,
    aggregate,
    totalSamples: dataset.length,
    failedSamples,
  };

  loggingService.info('RAG batch evaluation completed', {
    component: 'RAGEvalController',
    totalSamples: dataset.length,
    failedSamples,
    durationMs: Date.now() - startTime,
  });

  res.status(200).json(response);
}
