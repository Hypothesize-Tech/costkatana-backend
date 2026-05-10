import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EvaluationResult,
  EvaluationResultDocument,
} from '../../../schemas/analytics/evaluation-result.schema';
import {
  RequestFeedback,
  RequestFeedbackDocument,
} from '../../../schemas/analytics/request-feedback.schema';

export interface DashboardFilters {
  userId: string;
  from?: Date;
  to?: Date;
  modelName?: string;
  promptVersionId?: string;
}

export interface MetricBucket {
  date: Date;
  count: number;
  overall: number;
  contextRelevance: number;
  answerFaithfulness: number;
  answerRelevance: number;
  retrievalPrecision: number;
}

export interface DashboardSummary {
  totalEvaluated: number;
  averageOverall: number;
  positiveRatio: number;
  negativeCount: number;
  positiveCount: number;
  weakestMetric: keyof Omit<MetricBucket, 'date' | 'count'> | null;
}

export interface ByModelRow {
  modelName: string;
  count: number;
  averageOverall: number;
  positiveRatio: number;
}

export interface ByPromptVersionRow {
  promptTemplateId?: string;
  promptVersionId?: string;
  count: number;
  averageOverall: number;
  positiveRatio: number;
}

export interface DashboardPayload {
  summary: DashboardSummary;
  timeline: MetricBucket[];
  byModel: ByModelRow[];
  byPromptVersion: ByPromptVersionRow[];
}

@Injectable()
export class EvalsDashboardService {
  private readonly logger = new Logger(EvalsDashboardService.name);

  constructor(
    @InjectModel(EvaluationResult.name)
    private readonly evalModel: Model<EvaluationResultDocument>,
    @InjectModel(RequestFeedback.name)
    private readonly feedbackModel: Model<RequestFeedbackDocument>,
  ) {}

  async getDashboard(filters: DashboardFilters): Promise<DashboardPayload> {
    const match: Record<string, unknown> = { userId: filters.userId };
    if (filters.from || filters.to) {
      const dateRange: Record<string, Date> = {};
      if (filters.from) dateRange.$gte = filters.from;
      if (filters.to) dateRange.$lte = filters.to;
      match.createdAt = dateRange;
    }
    if (filters.modelName) match.modelName = filters.modelName;
    if (filters.promptVersionId) match.promptVersionId = filters.promptVersionId;

    const [aggResult] = await this.evalModel.aggregate([
      { $match: match },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalEvaluated: { $sum: 1 },
                averageOverall: { $avg: '$metrics.overall' },
                averageContextRelevance: { $avg: '$metrics.contextRelevance' },
                averageAnswerFaithfulness: {
                  $avg: '$metrics.answerFaithfulness',
                },
                averageAnswerRelevance: { $avg: '$metrics.answerRelevance' },
                averageRetrievalPrecision: {
                  $avg: '$metrics.retrievalPrecision',
                },
              },
            },
          ],
          timeline: [
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' },
                  day: { $dayOfMonth: '$createdAt' },
                },
                count: { $sum: 1 },
                overall: { $avg: '$metrics.overall' },
                contextRelevance: { $avg: '$metrics.contextRelevance' },
                answerFaithfulness: { $avg: '$metrics.answerFaithfulness' },
                answerRelevance: { $avg: '$metrics.answerRelevance' },
                retrievalPrecision: { $avg: '$metrics.retrievalPrecision' },
              },
            },
            {
              $project: {
                date: {
                  $dateFromParts: {
                    year: '$_id.year',
                    month: '$_id.month',
                    day: '$_id.day',
                  },
                },
                count: 1,
                overall: { $round: ['$overall', 4] },
                contextRelevance: { $round: ['$contextRelevance', 4] },
                answerFaithfulness: { $round: ['$answerFaithfulness', 4] },
                answerRelevance: { $round: ['$answerRelevance', 4] },
                retrievalPrecision: { $round: ['$retrievalPrecision', 4] },
                _id: 0,
              },
            },
            { $sort: { date: 1 } },
          ],
          byModel: [
            {
              $group: {
                _id: '$modelName',
                count: { $sum: 1 },
                averageOverall: { $avg: '$metrics.overall' },
              },
            },
            {
              $project: {
                _id: 0,
                modelName: { $ifNull: ['$_id', 'unknown'] },
                count: 1,
                averageOverall: { $round: ['$averageOverall', 4] },
              },
            },
            { $sort: { count: -1 } },
          ],
          byPromptVersion: [
            {
              $group: {
                _id: {
                  promptTemplateId: '$promptTemplateId',
                  promptVersionId: '$promptVersionId',
                },
                count: { $sum: 1 },
                averageOverall: { $avg: '$metrics.overall' },
              },
            },
            {
              $project: {
                _id: 0,
                promptTemplateId: '$_id.promptTemplateId',
                promptVersionId: '$_id.promptVersionId',
                count: 1,
                averageOverall: { $round: ['$averageOverall', 4] },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 50 },
          ],
        },
      },
    ]);

    const feedbackMatch: Record<string, unknown> = { userId: filters.userId };
    if (filters.from || filters.to) {
      const dateRange: Record<string, Date> = {};
      if (filters.from) dateRange.$gte = filters.from;
      if (filters.to) dateRange.$lte = filters.to;
      feedbackMatch.createdAt = dateRange;
    }
    if (filters.modelName) feedbackMatch.modelName = filters.modelName;

    const feedbackAgg = await this.feedbackModel.aggregate([
      { $match: feedbackMatch },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 },
        },
      },
    ]);
    const positiveCount =
      feedbackAgg.find((row: { _id: boolean }) => row._id === true)?.count ?? 0;
    const negativeCount =
      feedbackAgg.find((row: { _id: boolean }) => row._id === false)?.count ?? 0;
    const totalFeedback = positiveCount + negativeCount;
    const positiveRatio = totalFeedback === 0 ? 0 : positiveCount / totalFeedback;

    const summaryRaw = aggResult?.summary?.[0];
    const summary: DashboardSummary = summaryRaw
      ? {
          totalEvaluated: summaryRaw.totalEvaluated ?? 0,
          averageOverall: round(summaryRaw.averageOverall),
          positiveRatio: round(positiveRatio),
          negativeCount,
          positiveCount,
          weakestMetric: pickWeakestMetric(summaryRaw),
        }
      : {
          totalEvaluated: 0,
          averageOverall: 0,
          positiveRatio: round(positiveRatio),
          negativeCount,
          positiveCount,
          weakestMetric: null,
        };

    const byModelRaw: ByModelRow[] = (aggResult?.byModel ?? []).map(
      (row: ByModelRow) => ({ ...row, positiveRatio: 0 }),
    );

    return {
      summary,
      timeline: aggResult?.timeline ?? [],
      byModel: byModelRaw,
      byPromptVersion: aggResult?.byPromptVersion ?? [],
    };
  }
}

function round(value: number | undefined | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function pickWeakestMetric(
  summary: Record<string, number>,
): DashboardSummary['weakestMetric'] {
  const candidates: Array<{
    key: NonNullable<DashboardSummary['weakestMetric']>;
    value: number;
  }> = [
    {
      key: 'contextRelevance',
      value: summary.averageContextRelevance ?? 1,
    },
    {
      key: 'answerFaithfulness',
      value: summary.averageAnswerFaithfulness ?? 1,
    },
    {
      key: 'answerRelevance',
      value: summary.averageAnswerRelevance ?? 1,
    },
    {
      key: 'retrievalPrecision',
      value: summary.averageRetrievalPrecision ?? 1,
    },
  ];
  candidates.sort((a, b) => a.value - b.value);
  return candidates[0]?.key ?? null;
}
