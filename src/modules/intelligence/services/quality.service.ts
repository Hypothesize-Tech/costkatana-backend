import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AIRouterService } from '../../cortex/services/ai-router.service';
import { ActivityService } from '../../activity/activity.service';
import { QualityScore } from '../../../schemas/analytics/quality-score.schema';
import { IntelligenceAiCostTrackingService } from './ai-cost-tracking.service';

export interface QualityAssessment {
  score: number;
  criteria: {
    accuracy: number;
    relevance: number;
    completeness: number;
    coherence: number;
    factuality: number;
  };
  confidence: number;
  explanation?: string;
}

export interface ComparisonResult {
  originalScore: number;
  optimizedScore: number;
  qualityRetention: number;
  recommendation: 'accept' | 'review' | 'reject';
  costSavings: { amount: number; percentage: number };
}

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);
  private readonly SCORING_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
  private readonly AI_SCORING_TIMEOUT_MS = 3000;

  constructor(
    @InjectModel(QualityScore.name)
    private qualityScoreModel: Model<QualityScore>,
    private readonly aiRouterService: AIRouterService,
    private readonly activityService: ActivityService,
    private readonly costTracking: IntelligenceAiCostTrackingService,
  ) {}

  async scoreResponse(
    prompt: string,
    response: string,
    expectedOutput?: string,
    method: 'ai_model' | 'automated' | 'hybrid' = 'automated',
  ): Promise<QualityAssessment> {
    try {
      let assessment: QualityAssessment;
      switch (method) {
        case 'ai_model':
          assessment = await Promise.race([
            this.aiModelScoring(prompt, response, expectedOutput),
            new Promise<QualityAssessment>((resolve) =>
              setTimeout(
                () => resolve(this.getDefaultScore()),
                this.AI_SCORING_TIMEOUT_MS,
              ),
            ),
          ]);
          break;
        case 'automated':
          assessment = this.automatedScoring(prompt, response);
          break;
        case 'hybrid':
        default:
          assessment = this.automatedScoring(prompt, response);
          break;
      }
      return assessment;
    } catch (error) {
      this.logger.error('Error scoring response', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getDefaultScore();
    }
  }

  private async aiModelScoring(
    prompt: string,
    response: string,
    expectedOutput?: string,
  ): Promise<QualityAssessment> {
    const startTime = Date.now();
    try {
      const scoringPrompt = this.buildScoringPrompt(
        prompt,
        response,
        expectedOutput,
      );
      const result = await this.aiRouterService.invokeModel({
        model: this.SCORING_MODEL,
        prompt: scoringPrompt,
      });

      const latency = Date.now() - startTime;
      this.costTracking.trackCall({
        service: 'quality_scoring',
        operation: 'ai_scoring',
        model: this.SCORING_MODEL,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCost: result.cost,
        latency,
        success: true,
        metadata: {
          promptLength: prompt.length,
          responseLength: response.length,
        },
      });

      return this.parseScoringResult(result.response);
    } catch (error) {
      this.costTracking.trackCall({
        service: 'quality_scoring',
        operation: 'ai_scoring',
        model: this.SCORING_MODEL,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        latency: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.error('AI model scoring failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getDefaultScore();
    }
  }

  private automatedScoring(
    prompt: string,
    response: string,
  ): QualityAssessment {
    const promptMetrics = this.getTextMetrics(prompt);
    const responseMetrics = this.getTextMetrics(response);

    const criteria = {
      accuracy: 75,
      relevance: 0,
      completeness: 0,
      coherence: 0,
      factuality: 75,
    };

    const lengthRatio =
      responseMetrics.wordCount / Math.max(promptMetrics.wordCount, 100);
    criteria.completeness = Math.min(100, lengthRatio * 50);
    criteria.coherence = this.calculateCoherenceScore(responseMetrics);
    criteria.relevance = this.calculateRelevanceScore(
      promptMetrics,
      responseMetrics,
    );

    const overallScore = Object.values(criteria).reduce((a, b) => a + b, 0) / 5;

    return {
      score: Math.round(overallScore),
      criteria,
      confidence: 0.6,
    };
  }

  private getTextMetrics(text: string): {
    wordCount: number;
    sentenceCount: number;
    paragraphCount: number;
    words: Set<string>;
    avgWordsPerSentence: number;
  } {
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const sentences = text.split(/[.!?]/).filter((s) => s.trim().length > 0);
    const paragraphs = text.split('\n\n').filter((p) => p.trim().length > 0);
    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,
      words: new Set(words.filter((w) => w.length > 3)),
      avgWordsPerSentence: words.length / Math.max(sentences.length, 1),
    };
  }

  private calculateCoherenceScore(metrics: {
    paragraphCount: number;
    sentenceCount: number;
    avgWordsPerSentence: number;
  }): number {
    const hasParagraphs = metrics.paragraphCount > 1;
    const hasSentences = metrics.sentenceCount > 2;
    const goodStructure =
      metrics.avgWordsPerSentence > 5 && metrics.avgWordsPerSentence < 30;
    return (
      (hasParagraphs ? 40 : 20) +
      (hasSentences ? 40 : 20) +
      (goodStructure ? 20 : 0)
    );
  }

  private calculateRelevanceScore(
    promptMetrics: { words: Set<string> },
    responseMetrics: { words: Set<string> },
  ): number {
    const intersection = new Set(
      [...promptMetrics.words].filter((w) => responseMetrics.words.has(w)),
    );
    return Math.min(
      100,
      (intersection.size / Math.max(promptMetrics.words.size, 1)) * 200,
    );
  }

  private buildScoringPrompt(
    prompt: string,
    response: string,
    expectedOutput?: string,
  ): string {
    let text = `Evaluate the quality of this AI response on a scale of 1-100 for each criterion.

User Prompt: ${prompt.substring(0, 500)}${prompt.length > 500 ? '...' : ''}

AI Response: ${response.substring(0, 1000)}${response.length > 1000 ? '...' : ''}

`;
    if (expectedOutput) {
      text += `Expected Output (reference): ${expectedOutput.substring(0, 500)}${expectedOutput.length > 500 ? '...' : ''}\n\n`;
    }
    text += `Rate the response on these criteria (1-100):
1. Accuracy: How factually correct is the response?
2. Relevance: How well does it address the prompt?
3. Completeness: Does it fully answer the question?
4. Coherence: Is it well-structured and clear?
5. Factuality: Are the claims verifiable?

Provide your response in JSON format:
{
    "accuracy": <score>,
    "relevance": <score>,
    "completeness": <score>,
    "coherence": <score>,
    "factuality": <score>,
    "overall": <average score>,
    "explanation": "<brief explanation>"
}`;
    return text;
  }

  private parseScoringResult(result: string): QualityAssessment {
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: parsed.overall ?? 75,
        criteria: {
          accuracy: parsed.accuracy ?? 75,
          relevance: parsed.relevance ?? 75,
          completeness: parsed.completeness ?? 75,
          coherence: parsed.coherence ?? 75,
          factuality: parsed.factuality ?? 75,
        },
        confidence: 0.8,
        explanation: parsed.explanation,
      };
    } catch (error) {
      this.logger.error('Error parsing scoring result', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getDefaultScore();
    }
  }

  private getDefaultScore(): QualityAssessment {
    return {
      score: 75,
      criteria: {
        accuracy: 75,
        relevance: 75,
        completeness: 75,
        coherence: 75,
        factuality: 75,
      },
      confidence: 0.5,
    };
  }

  async compareQuality(
    prompt: string,
    originalResponse: string,
    optimizedResponse: string,
    costSavings: { amount: number; percentage: number },
  ): Promise<ComparisonResult> {
    try {
      const [originalAssessment, optimizedAssessment] = await Promise.all([
        this.scoreResponse(prompt, originalResponse),
        this.scoreResponse(prompt, optimizedResponse),
      ]);

      const qualityRetention =
        (optimizedAssessment.score / originalAssessment.score) * 100;

      let recommendation: 'accept' | 'review' | 'reject';
      if (qualityRetention >= 95) recommendation = 'accept';
      else if (qualityRetention >= 85) recommendation = 'review';
      else recommendation = 'reject';

      return {
        originalScore: originalAssessment.score,
        optimizedScore: optimizedAssessment.score,
        qualityRetention,
        recommendation,
        costSavings,
      };
    } catch (error) {
      this.logger.error('Error comparing quality', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        originalScore: 75,
        optimizedScore: 75,
        qualityRetention: 100,
        recommendation: 'review',
        costSavings,
      };
    }
  }

  async saveQualityScore(scoreData: {
    userId: string;
    originalScore?: number;
    optimizedScore: number;
    scoringMethod: 'ai_model' | 'user_feedback' | 'automated' | 'hybrid';
    costSavings: { amount: number; percentage: number };
    optimizationType: string[];
  }): Promise<QualityScore> {
    const doc = await this.qualityScoreModel.create({
      userId: new Types.ObjectId(scoreData.userId),
      originalScore: scoreData.originalScore,
      optimizedScore: scoreData.optimizedScore,
      scoringMethod: scoreData.scoringMethod,
      costSavings: scoreData.costSavings,
      optimizationType: scoreData.optimizationType,
    });

    if (scoreData.userId) {
      await this.activityService.trackActivity(scoreData.userId, {
        type: 'quality_scored',
        title: 'Quality Score Generated',
        description: 'Quality score generated for optimization',
        metadata: {
          qualityScoreId: (doc as any)._id,
          optimizationType: scoreData.optimizationType[0],
        },
      });
    }

    return doc as QualityScore;
  }

  async getUserQualityStats(userId: string): Promise<{
    averageQualityRetention: number;
    totalCostSavings: number;
    acceptedOptimizations: number;
    rejectedOptimizations: number;
    optimizationTypes: Record<string, number>;
  }> {
    const stats = await this.qualityScoreModel.aggregate([
      { $match: { userId: new Types.ObjectId(userId) } },
      { $sort: { createdAt: -1 } },
      { $limit: 100 },
      {
        $facet: {
          basicStats: [
            {
              $group: {
                _id: null,
                totalScores: { $sum: 1 },
                avgQuality: { $avg: '$optimizedScore' },
                totalSavings: { $sum: '$costSavings.amount' },
                accepted: {
                  $sum: {
                    $cond: [
                      { $eq: ['$userFeedback.isAcceptable', true] },
                      1,
                      0,
                    ],
                  },
                },
                rejected: {
                  $sum: {
                    $cond: [
                      { $eq: ['$userFeedback.isAcceptable', false] },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          optimizationTypes: [
            { $unwind: '$optimizationType' },
            { $group: { _id: '$optimizationType', count: { $sum: 1 } } },
          ],
        },
      },
    ]);

    const result = stats[0];
    if (!result.basicStats[0]) {
      return {
        averageQualityRetention: 100,
        totalCostSavings: 0,
        acceptedOptimizations: 0,
        rejectedOptimizations: 0,
        optimizationTypes: {},
      };
    }

    const basic = result.basicStats[0];
    const optimizationTypes = (
      result.optimizationTypes as { _id: string; count: number }[]
    ).reduce(
      (acc, item) => {
        acc[item._id] = item.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      averageQualityRetention: basic.avgQuality ?? 100,
      totalCostSavings: basic.totalSavings ?? 0,
      acceptedOptimizations: basic.accepted ?? 0,
      rejectedOptimizations: basic.rejected ?? 0,
      optimizationTypes,
    };
  }

  async updateUserFeedback(
    scoreId: string,
    feedback: {
      rating?: 1 | 2 | 3 | 4 | 5;
      isAcceptable: boolean;
      comment?: string;
    },
  ): Promise<void> {
    await this.qualityScoreModel.findByIdAndUpdate(scoreId, {
      userFeedback: {
        ...feedback,
        timestamp: new Date(),
      },
    });
  }
}
