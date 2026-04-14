import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { CostAnomalyHistory } from '../../../schemas/cost/cost-anomaly-history.schema';
import {
  Activity,
  ActivityDocument,
} from '../../../schemas/core/activity.schema';
import { Usage } from '../../../schemas/core/usage.schema';
import {
  CostChangeExplanation,
  CostChangeExplanationDocument,
} from '../schemas/cost-change-explanation.schema';

const CORRELATION_WINDOW_HOURS = 48;

const ACTIVITY_WEIGHT: Record<string, number> = {
  team_member_added: 0.85,
  project_created: 0.75,
  subscription_changed: 0.7,
  template_used_with_context: 0.55,
  template_optimized: 0.45,
  optimization_applied: 0.4,
  settings_updated: 0.3,
  api_key_created: 0.3,
};

@Injectable()
export class CostChangeExplainerService {
  private readonly logger = new Logger(CostChangeExplainerService.name);

  constructor(
    @InjectModel(CostAnomalyHistory.name)
    private readonly anomalyModel: Model<CostAnomalyHistory>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
    @InjectModel(CostChangeExplanation.name)
    private readonly explanationModel: Model<CostChangeExplanationDocument>,
  ) {}

  @Cron('0 4 * * *')
  async runDailyCorrelation(): Promise<void> {
    this.logger.log('Running daily cost-change correlation job');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentAnomalies = await this.anomalyModel
      .find({ timestamp: { $gte: since } })
      .sort({ timestamp: -1 })
      .limit(500)
      .lean()
      .exec();

    let written = 0;
    for (const anomaly of recentAnomalies) {
      const explanation = await this.explainOne(anomaly);
      if (!explanation) continue;

      const userId = this.toObjectId(anomaly.userId);
      if (!userId) continue;

      await this.explanationModel
        .updateOne(
          { userId, anomalyTimestamp: explanation.anomalyTimestamp },
          {
            $set: {
              ...explanation,
              userId,
            },
          },
          { upsert: true },
        )
        .exec();
      written += 1;
    }

    this.logger.log(
      `Cost-change correlation wrote ${written} explanation(s) from ${recentAnomalies.length} anomaly events`,
    );
  }

  async getUnconsumedForUser(
    userId: string,
    limit = 10,
  ): Promise<CostChangeExplanationDocument[]> {
    const uid = this.toObjectId(userId);
    if (!uid) return [];
    return this.explanationModel
      .find({ userId: uid, consumed: false })
      .sort({ anomalyTimestamp: -1 })
      .limit(limit)
      .exec();
  }

  async markConsumed(explanationId: string): Promise<void> {
    const oid = this.toObjectId(explanationId);
    if (!oid) {
      this.logger.warn('markConsumed received non-ObjectId string', {
        explanationId,
      });
      return;
    }
    const result = await this.explanationModel
      .updateOne({ _id: oid }, { $set: { consumed: true } })
      .exec();
    if (result.matchedCount === 0) {
      this.logger.warn('markConsumed matched no explanation', { explanationId });
    }
  }

  private async explainOne(anomaly: {
    userId: string;
    amount: number;
    timestamp: Date;
    metadata?: Record<string, any>;
  }): Promise<Omit<CostChangeExplanation, 'userId'> | null> {
    if (!anomaly.amount || anomaly.amount <= 0) return null;

    const windowStart = new Date(
      anomaly.timestamp.getTime() - CORRELATION_WINDOW_HOURS * 60 * 60 * 1000,
    );

    const uid = this.toObjectId(anomaly.userId);
    if (!uid) return null;

    const activities = await this.activityModel
      .find({
        userId: uid,
        createdAt: { $gte: windowStart, $lte: anomaly.timestamp },
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();

    const scored = activities
      .map((a) => {
        const base = ACTIVITY_WEIGHT[a.type] ?? 0;
        if (base === 0) return null;
        const ageHours =
          (anomaly.timestamp.getTime() - new Date(a.createdAt).getTime()) /
          (60 * 60 * 1000);
        const recencyBoost = Math.max(0, 1 - ageHours / CORRELATION_WINDOW_HOURS);
        const confidence = base * (0.5 + 0.5 * recencyBoost);
        return { activity: a, confidence };
      })
      .filter((x): x is { activity: (typeof activities)[number]; confidence: number } => !!x)
      .sort((a, b) => b.confidence - a.confidence);

    const best = scored[0];

    const attribution = await this.buildAttribution(anomaly);

    const priorWindowStart = new Date(
      windowStart.getTime() - CORRELATION_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const baselineAgg = await this.usageModel
      .aggregate<{ _id: null; total: number }>([
        {
          $match: {
            userId: uid,
            createdAt: { $gte: priorWindowStart, $lt: windowStart },
          },
        },
        { $group: { _id: null, total: { $sum: '$cost' } } },
      ])
      .exec();
    const baseline = baselineAgg[0]?.total ?? 0;
    const pctChange = baseline > 0 ? (anomaly.amount / baseline) * 100 : 100;

    return {
      anomalyTimestamp: anomaly.timestamp,
      pctChange,
      absChangeUsd: anomaly.amount,
      correlatedActivityType: best?.activity.type,
      correlatedActivityId: best?.activity._id as Types.ObjectId | undefined,
      correlationConfidence: best?.confidence ?? 0,
      attribution,
      evidence: {
        anomalyAction: (anomaly.metadata as any)?.action,
        anomalyMeta: anomaly.metadata ?? {},
        topActivity: best?.activity.title,
        scoredActivityCount: scored.length,
      },
      consumed: false,
    };
  }

  private async buildAttribution(anomaly: {
    userId: string;
    timestamp: Date;
  }): Promise<CostChangeExplanation['attribution']> {
    const uid = this.toObjectId(anomaly.userId);
    if (!uid) return {};

    const windowStart = new Date(
      anomaly.timestamp.getTime() - CORRELATION_WINDOW_HOURS * 60 * 60 * 1000,
    );

    const topModelAgg = await this.usageModel
      .aggregate<{ _id: string; total: number }>([
        {
          $match: {
            userId: uid,
            createdAt: { $gte: windowStart, $lte: anomaly.timestamp },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$model', '$aiModel'] },
            total: { $sum: '$cost' },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 1 },
      ])
      .exec()
      .catch(() => [] as { _id: string; total: number }[]);

    return {
      model: topModelAgg[0]?._id,
    };
  }

  private toObjectId(id: unknown): Types.ObjectId | null {
    try {
      if (!id) return null;
      if (id instanceof Types.ObjectId) return id;
      return new Types.ObjectId(String(id));
    } catch {
      return null;
    }
  }
}
