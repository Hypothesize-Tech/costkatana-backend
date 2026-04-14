import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../../../schemas/core/activity.schema';
import { Usage } from '../../../schemas/core/usage.schema';
import {
  ProactiveSuggestion,
  ProactiveSuggestionDocument,
} from '../../../schemas/analytics/proactive-suggestion.schema';

const OBSERVATION_WINDOW_DAYS = 7;

/**
 * Proof Moments
 *
 * After a user applies a decision we capture the baseline cost at that moment.
 * This service runs daily and computes actualized savings by comparing the
 * N-day post-apply spend vs a same-length pre-apply baseline, then stamps
 * the suggestion record with the observed savings. The UI renders this as
 * "Applied Tue — saved $34 so far this week" on the DecisionCard.
 */
@Injectable()
export class ProofMomentsService {
  private readonly logger = new Logger(ProofMomentsService.name);

  constructor(
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
    @InjectModel(ProactiveSuggestion.name)
    private readonly suggestionModel: Model<ProactiveSuggestionDocument>,
  ) {}

  @Cron('0 5 * * *')
  async runDailyReconciliation(): Promise<void> {
    this.logger.log('Running proof-moments reconciliation');
    const windowStart = new Date(
      Date.now() - OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const appliedEvents = await this.activityModel
      .find({
        type: 'optimization_applied',
        createdAt: { $gte: windowStart },
      })
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean()
      .exec();

    let written = 0;
    for (const event of appliedEvents) {
      try {
        const suggestionId = (event.metadata as any)?.suggestionId as
          | string
          | undefined;
        if (!suggestionId) continue;

        const actual = await this.computeActualSavings(
          String(event.userId),
          new Date(event.createdAt),
        );
        if (actual === null) continue;

        await this.suggestionModel
          .updateOne(
            { id: suggestionId },
            {
              $set: {
                'feedback.resultMetrics.actualSavings': actual,
              },
            },
          )
          .exec();
        written += 1;
      } catch (error) {
        this.logger.warn('Proof reconciliation failed for event', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log(
      `Proof-moments reconciled ${written} suggestion(s) out of ${appliedEvents.length} apply event(s)`,
    );
  }

  private async computeActualSavings(
    userId: string,
    appliedAt: Date,
  ): Promise<number | null> {
    const windowMs = OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const now = new Date();
    const observedEnd = now < new Date(appliedAt.getTime() + windowMs)
      ? now
      : new Date(appliedAt.getTime() + windowMs);

    const observedDays = Math.max(
      0.5,
      (observedEnd.getTime() - appliedAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    const baselineStart = new Date(appliedAt.getTime() - windowMs);
    const baselineEnd = appliedAt;
    const baselineDays = OBSERVATION_WINDOW_DAYS;

    const uid = this.toObjectId(userId);
    if (!uid) return null;

    const [baselineAgg, observedAgg] = await Promise.all([
      this.usageModel
        .aggregate<{ _id: null; total: number }>([
          {
            $match: {
              userId: uid,
              createdAt: { $gte: baselineStart, $lt: baselineEnd },
            },
          },
          { $group: { _id: null, total: { $sum: '$cost' } } },
        ])
        .exec(),
      this.usageModel
        .aggregate<{ _id: null; total: number }>([
          {
            $match: {
              userId: uid,
              createdAt: { $gte: appliedAt, $lte: observedEnd },
            },
          },
          { $group: { _id: null, total: { $sum: '$cost' } } },
        ])
        .exec(),
    ]);

    const baseline = baselineAgg[0]?.total ?? 0;
    const observed = observedAgg[0]?.total ?? 0;
    if (baseline <= 0) return null;

    const normalizedBaseline = baseline * (observedDays / baselineDays);
    const savings = normalizedBaseline - observed;
    // Clamp negatives to zero — if spend went up, we don't claim savings,
    // but we also don't emit false proof.
    return Math.max(0, savings);
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
