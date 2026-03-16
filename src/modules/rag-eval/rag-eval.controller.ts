import {
  Controller,
  Post,
  Body,
  ValidationPipe,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RAGEvalRequestDto, RAGEvalResponseDto } from './dto/rag-eval.dto';
import { modularRAGOrchestrator } from './rag/orchestrator/modular-rag.orchestrator';
import type { RAGContext } from './rag/types/rag.types';

@Controller('api/rag')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RagEvalController {
  private readonly logger = new Logger(RagEvalController.name);

  /**
   * POST /v1/rag/evaluate - Run batch RAG evaluation on a dataset
   */
  @Post('evaluate')
  @Roles('admin')
  async evaluateBatch(
    @Body(ValidationPipe) body: RAGEvalRequestDto,
    @CurrentUser() user: any,
  ): Promise<RAGEvalResponseDto> {
    const startTime = Date.now();

    this.logger.log('RAG batch evaluation started', {
      component: 'RagEvalController',
      userId: user?.userId,
      datasetSize: body.dataset.length,
      pattern: body.pattern,
    });

    const { dataset, pattern, config: customConfig } = body;

    // Build RAG context
    const context: RAGContext = {
      userId: user?.userId ?? 'rag-eval-user',
      conversationId: `rag-eval-${Date.now()}`,
    };

    // Ensure we do not run pipeline evaluation in batch (we run evaluator explicitly)
    const ragConfig = customConfig
      ? {
          ...customConfig,
          evaluation: { enabled: false },
        }
      : { evaluation: { enabled: false } };

    const results: any[] = [];
    const metricsCollected: any[] = [];
    let failedSamples = 0;

    for (let i = 0; i < dataset.length; i++) {
      const item = dataset[i];
      const question =
        typeof item?.question === 'string'
          ? item.question
          : String(item?.question ?? '');
      const groundTruth =
        typeof item?.groundTruth === 'string' ? item.groundTruth : undefined;

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

        // Get evaluation metrics if available from the result
        const evalMetrics = ragResult.metadata.evaluation || {
          contextRelevance: 0,
          answerFaithfulness: 0,
          answerRelevance: 0,
          retrievalPrecision: 0,
          retrievalRecall: 0,
          overall: 0,
        };

        metricsCollected.push(evalMetrics);
        results.push({
          question,
          answer: ragResult.answer,
          metrics: evalMetrics,
          success: true,
        });
      } catch (error) {
        this.logger.warn('RAG eval sample failed', {
          component: 'RagEvalController',
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

    // Calculate aggregate metrics
    const aggregate =
      metricsCollected.length > 0
        ? this.calculateAggregateStats(metricsCollected)
        : {
            mean: {
              contextRelevance: 0,
              answerFaithfulness: 0,
              answerRelevance: 0,
              retrievalPrecision: 0,
              retrievalRecall: 0,
              overall: 0,
            },
            std: {
              contextRelevance: 0,
              answerFaithfulness: 0,
              answerRelevance: 0,
              retrievalPrecision: 0,
              retrievalRecall: 0,
              overall: 0,
            },
            min: {
              contextRelevance: 0,
              answerFaithfulness: 0,
              answerRelevance: 0,
              retrievalPrecision: 0,
              retrievalRecall: 0,
              overall: 0,
            },
            max: {
              contextRelevance: 0,
              answerFaithfulness: 0,
              answerRelevance: 0,
              retrievalPrecision: 0,
              retrievalRecall: 0,
              overall: 0,
            },
          };

    const response: RAGEvalResponseDto = {
      results,
      aggregate,
      totalSamples: dataset.length,
      failedSamples,
    };

    this.logger.log('RAG batch evaluation completed', {
      component: 'RagEvalController',
      totalSamples: dataset.length,
      failedSamples,
      durationMs: Date.now() - startTime,
    });

    return response;
  }

  /**
   * Calculate aggregate statistics
   */
  private calculateAggregateStats(metrics: any[]): {
    mean: any;
    std: any;
    min: any;
    max: any;
  } {
    const keys = [
      'contextRelevance',
      'answerFaithfulness',
      'answerRelevance',
      'retrievalPrecision',
      'retrievalRecall',
      'overall',
    ];

    const mean: any = {};
    const std: any = {};
    const min: any = {};
    const max: any = {};

    keys.forEach((key) => {
      const values = metrics.map((m) => m[key]);
      mean[key] =
        values.reduce((a: number, b: number) => a + b, 0) / values.length;
      min[key] = Math.min(...values);
      max[key] = Math.max(...values);

      const variance =
        values.reduce(
          (sum: number, val: number) => sum + Math.pow(val - mean[key], 2),
          0,
        ) / values.length;
      std[key] = Math.sqrt(variance);
    });

    return {
      mean,
      std,
      min,
      max,
    };
  }
}
