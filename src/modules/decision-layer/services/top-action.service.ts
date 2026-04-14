import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ProactiveSuggestion as ProactiveSuggestionSchema,
  ProactiveSuggestionDocument,
} from '../../../schemas/analytics/proactive-suggestion.schema';
import {
  Activity,
  ActivityDocument,
} from '../../../schemas/core/activity.schema';
import { Usage } from '../../../schemas/core/usage.schema';
import { BudgetService } from '../../budget/budget.service';
import { EmbeddingsService } from '../../notebook/services/embeddings.service';
import { OptimizationFeedbackLoopService } from '../../proactive-suggestions/services/optimization-feedback-loop.service';
import {
  DecisionContext,
  DecisionListFilters,
  DecisionState,
  SavingsSummary,
  TriggerReason,
  UrgencyLevel,
} from '../types/decision-context';
import { CostChangeExplainerService } from './cost-change-explainer.service';
import { applyAcceptanceMultiplier, computeDecisionScore } from './scoring';

const TYPE_TO_REASON: Record<string, TriggerReason> = {
  model_downgrade: 'model_overspend',
  semantic_cache: 'caching_opportunity',
  context_compression: 'compression_opportunity',
  lazy_summarization: 'summarization_opportunity',
  batch_requests: 'batch_opportunity',
  cheaper_provider: 'model_overspend',
};

@Injectable()
export class TopActionService {
  private readonly logger = new Logger(TopActionService.name);

  constructor(
    @InjectModel(ProactiveSuggestionSchema.name)
    private readonly suggestionModel: Model<ProactiveSuggestionDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
    private readonly budgetService: BudgetService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly costChangeExplainer: CostChangeExplainerService,
    private readonly feedbackLoop: OptimizationFeedbackLoopService,
  ) {}

  /**
   * Pull recent high-signal usage records for a user, optionally filtered by
   * model or high-cost records. These get handed to the LLM as evidence so
   * it produces grounded, specific recommendations instead of templates.
   */
  private async fetchUsageSamples(
    userId: string,
    opts: { model?: string; limit?: number; minCost?: number } = {},
  ): Promise<
    Array<{
      prompt?: string;
      completion?: string;
      model?: string;
      service?: string;
      costUsd?: number;
      promptTokens?: number;
      completionTokens?: number;
      responseTimeMs?: number;
      tags?: string[];
    }>
  > {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const match: Record<string, unknown> = {
      userId: this.oid(userId),
      createdAt: { $gte: sevenDaysAgo },
    };
    if (opts.model) match.model = opts.model;
    if (opts.minCost) match.cost = { $gte: opts.minCost };

    const docs = await this.usageModel
      .find(match)
      .sort({ cost: -1, createdAt: -1 })
      .limit(opts.limit ?? 5)
      .lean()
      .exec();

    return docs.map((d: any) => ({
      prompt: d.prompt,
      completion: d.completion,
      model: d.model,
      service: d.service,
      costUsd: d.cost,
      promptTokens: d.promptTokens,
      completionTokens: d.completionTokens,
      responseTimeMs: d.responseTime,
      tags: d.tags,
    }));
  }

  /**
   * Aggregate signal the LLM uses alongside samples: what's the dominant
   * model, what's total spend in the window, how many requests?
   */
  private async fetchUsageAggregate(
    userId: string,
  ): Promise<{
    totalCostUsd?: number;
    totalRequests?: number;
    windowDays?: number;
    topModel?: string;
  }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const agg = await this.usageModel
      .aggregate<{
        _id: string;
        totalCost: number;
        totalRequests: number;
      }>([
        {
          $match: {
            userId: this.oid(userId),
            createdAt: { $gte: sevenDaysAgo },
          },
        },
        {
          $group: {
            _id: '$model',
            totalCost: { $sum: '$cost' },
            totalRequests: { $sum: 1 },
          },
        },
        { $sort: { totalCost: -1 } },
        { $limit: 5 },
      ])
      .exec()
      .catch(() => [] as { _id: string; totalCost: number; totalRequests: number }[]);

    const totalCostUsd = agg.reduce((s, r) => s + r.totalCost, 0);
    const totalRequests = agg.reduce((s, r) => s + r.totalRequests, 0);
    return {
      totalCostUsd,
      totalRequests,
      windowDays: 7,
      topModel: agg[0]?._id,
    };
  }

  async getTop(userId: string): Promise<DecisionContext | null> {
    const decisions = await this.buildAllDecisions(userId);
    if (decisions.length === 0) return null;
    return decisions[0];
  }

  async list(
    userId: string,
    filters: DecisionListFilters = {},
  ): Promise<DecisionContext[]> {
    let decisions = await this.buildAllDecisions(userId);

    if (filters.urgency) {
      decisions = decisions.filter((d) => d.urgency === filters.urgency);
    }
    if (filters.state) {
      decisions = decisions.filter((d) => d.state === filters.state);
    }
    if (filters.team) {
      decisions = decisions.filter(
        (d) => d.attribution?.team === filters.team,
      );
    }
    if (typeof filters.limit === 'number' && filters.limit > 0) {
      decisions = decisions.slice(0, filters.limit);
    }
    return decisions;
  }

  async apply(
    userId: string,
    decisionId: string,
  ): Promise<{ success: boolean; appliedAt: Date }> {
    const appliedAt = new Date();

    // Cost-change-explainer items: mark the explanation consumed so it
    // stops surfacing, and log the acknowledgement activity.
    if (decisionId.startsWith('cost-change:')) {
      const explanationId = decisionId.slice('cost-change:'.length);
      await this.costChangeExplainer
        .markConsumed(explanationId)
        .catch(() => undefined);
      await this.logActivity(userId, 'optimization_applied', {
        decisionId,
        source: 'cost_change_explainer',
      });
      return { success: true, appliedAt };
    }

    // Budget-pacing items: no persistent row; just record the activity.
    // The decision regenerates daily from live pacing data anyway.
    if (decisionId.startsWith('budget-pacing:')) {
      await this.logActivity(userId, 'optimization_applied', {
        decisionId,
        source: 'budget',
      });
      return { success: true, appliedAt };
    }

    // Proactive suggestion — the common case.
    const doc = await this.suggestionModel
      .findOne({ id: decisionId, userId: this.oid(userId) })
      .exec();
    if (!doc) {
      throw new NotFoundException('Decision not found or not yours');
    }
    doc.status = 'accepted';
    doc.feedback = {
      action: 'accepted',
      appliedAt,
    };
    await doc.save();
    await this.logActivity(userId, 'optimization_applied', {
      suggestionId: decisionId,
      saved: doc.estimatedSavings,
    });
    return { success: true, appliedAt };
  }

  async dismiss(
    userId: string,
    decisionId: string,
    reason?: string,
  ): Promise<{ success: boolean }> {
    if (decisionId.startsWith('cost-change:')) {
      const explanationId = decisionId.slice('cost-change:'.length);
      await this.costChangeExplainer
        .markConsumed(explanationId)
        .catch(() => undefined);
      return { success: true };
    }
    if (decisionId.startsWith('budget-pacing:')) {
      // Budget pacing regenerates daily; dismissal is just a UX hint,
      // persisted as an activity so it influences the feedback loop.
      await this.logActivity(userId, 'alert_settings_updated', {
        decisionId,
        source: 'budget',
        action: 'dismissed',
        reason,
      });
      return { success: true };
    }

    const doc = await this.suggestionModel
      .findOne({ id: decisionId, userId: this.oid(userId) })
      .exec();
    if (!doc) {
      throw new NotFoundException('Decision not found or not yours');
    }
    doc.status = 'rejected';
    doc.feedback = {
      action: 'dismissed',
      reason,
    };
    await doc.save();
    return { success: true };
  }

  async snooze(
    userId: string,
    decisionId: string,
    durationMs: number,
  ): Promise<{ success: boolean; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + durationMs);

    // Non-suggestion sources: we don't have a row to write expiresAt onto,
    // so fall back to consuming / acknowledging so the item drops off.
    if (
      decisionId.startsWith('cost-change:') ||
      decisionId.startsWith('budget-pacing:')
    ) {
      return this.dismiss(userId, decisionId, 'snoozed').then(() => ({
        success: true,
        expiresAt,
      }));
    }

    const doc = await this.suggestionModel
      .findOne({ id: decisionId, userId: this.oid(userId) })
      .exec();
    if (!doc) {
      throw new NotFoundException('Decision not found or not yours');
    }
    doc.expiresAt = expiresAt;
    await doc.save();
    return { success: true, expiresAt };
  }

  async savingsSummary(
    userId: string,
    sinceDays = 30,
  ): Promise<SavingsSummary> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const uid = this.oid(userId);
    const applied = await this.activityModel
      .find({
        userId: uid,
        type: 'optimization_applied',
        createdAt: { $gte: since },
      })
      .lean()
      .exec();
    const totalSavingsUsd = applied.reduce(
      (sum, a) => sum + Number((a.metadata as any)?.saved ?? 0),
      0,
    );
    return {
      sinceDate: since,
      totalSavingsUsd,
      decisionsApplied: applied.length,
    };
  }

  // --- build / normalize ---

  private async buildAllDecisions(
    userId: string,
  ): Promise<DecisionContext[]> {
    const [suggestionDecisions, budgetDecision, changeDecisions, acceptanceRate] =
      await Promise.all([
        this.buildSuggestionDecisions(userId),
        this.buildBudgetPacingDecision(userId),
        this.buildChangeExplainerDecisions(userId),
        this.feedbackLoop
          .getUserAcceptanceRate(userId)
          .catch(() => 0.5),
      ]);

    const all = [
      ...suggestionDecisions,
      ...(budgetDecision ? [budgetDecision] : []),
      ...changeDecisions,
    ].map((d) => ({
      ...d,
      score: applyAcceptanceMultiplier(d.score ?? 0, acceptanceRate),
    }));

    return all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  private async buildSuggestionDecisions(
    userId: string,
  ): Promise<DecisionContext[]> {
    const now = new Date();
    const monitoringSince = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    );
    const docs = await this.suggestionModel
      .find({
        userId: this.oid(userId),
        $or: [
          {
            status: 'pending',
            $or: [
              { expiresAt: { $gt: now } },
              { expiresAt: { $exists: false } },
            ],
          },
          {
            status: 'accepted',
            'feedback.appliedAt': { $gte: monitoringSince },
          },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(40)
      .lean()
      .exec();

    const results: DecisionContext[] = [];
    const aggregate = await this.fetchUsageAggregate(userId);
    for (const s of docs) {
      const reason: TriggerReason =
        TYPE_TO_REASON[s.type] ?? 'periodic_review';
      const impactUsd = s.estimatedSavings || 0;
      const samples = await this.fetchUsageSamples(userId, {
        model: s.context?.currentModel,
        limit: 5,
      });
      const grounded = await this.embeddingsService.generateGroundedDecision({
        userId,
        reason,
        impactUsd,
        timeframe: 'per_month',
        samples,
        aggregate: {
          ...aggregate,
          suggestedModel: s.context?.suggestedModel,
        },
        attribution: { model: s.context?.currentModel },
      });
      const { headline, narrative } = grounded;

      const urgency = this.urgencyFor(s.priority as any, s.createdAt);
      const score = computeDecisionScore({
        priority: s.priority as any,
        impactUsd,
        createdAt: s.createdAt,
        confidence: s.confidence,
        reason,
      });

      const proofState =
        s.status === 'accepted' || (s.feedback as any)?.appliedAt
          ? 'monitoring'
          : 'action_required';
      const actualSavings = (s.feedback as any)?.resultMetrics?.actualSavings;

      results.push({
        id: s.id,
        userId,
        urgency,
        state: proofState,
        trigger: {
          reason,
          detectedAt: new Date(s.createdAt),
          evidence: {
            pattern: s.context?.pattern,
            requests: s.context?.requests,
          },
        },
        headline,
        narrative,
        impact: {
          amountUsd: impactUsd,
          timeframe: 'per_month',
          confidence: s.confidence,
        },
        suggestedAction: {
          label: grounded.action.label,
          kind: grounded.action.kind,
          endpoint: `/api/decisions/${s.id}/apply`,
          payload: grounded.action.payload,
        },
        dismissible: true,
        source: { kind: 'proactive_suggestion', refId: s.id },
        createdAt: new Date(s.createdAt),
        expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined,
        attribution: { model: s.context?.currentModel },
        proof:
          proofState === 'monitoring'
            ? {
                appliedAt: (s.feedback as any)?.appliedAt,
                actualSavingsUsd: typeof actualSavings === 'number'
                  ? actualSavings
                  : undefined,
                observationWindowDays: 7,
              }
            : undefined,
        reasoning: grounded.reasoning,
        score,
      });
    }
    return results;
  }

  private async buildBudgetPacingDecision(
    userId: string,
  ): Promise<DecisionContext | null> {
    try {
      const pacing = await this.budgetService.getBudgetPacing(userId);
      if (!pacing.isOverPacing) return null;
      const samples = await this.fetchUsageSamples(userId, {
        model: pacing.topOffenderModel,
        limit: 5,
      });
      const aggregate = await this.fetchUsageAggregate(userId);
      const grounded = await this.embeddingsService.generateGroundedDecision({
        userId,
        reason: 'budget_pacing',
        impactUsd: pacing.topOffenderCostUsd ?? 1,
        timeframe: 'per_month',
        samples,
        aggregate: {
          ...aggregate,
          currentSettings: {
            projectedHitDate: pacing.projectedHitDate,
            dailyBurnUsd: pacing.dailyBurnUsd,
            daysUntilHit: pacing.daysUntilHit,
          },
        },
        attribution: { model: pacing.topOffenderModel },
      });

      return {
        id: `budget-pacing:${new Date().toISOString().slice(0, 10)}`,
        userId,
        urgency: 'now',
        state: 'action_required',
        trigger: {
          reason: 'budget_pacing',
          detectedAt: new Date(),
          evidence: { ...pacing },
        },
        headline: grounded.headline,
        narrative: grounded.narrative,
        impact: {
          amountUsd: pacing.topOffenderCostUsd ?? 0,
          timeframe: 'per_month',
          confidence: grounded.confidence,
        },
        suggestedAction: {
          label: grounded.action.label,
          kind: grounded.action.kind,
          endpoint: grounded.action.kind === 'review' ? '/budget' : undefined,
          payload: grounded.action.payload,
        },
        dismissible: false,
        source: { kind: 'budget', refId: 'budget-pacing' },
        createdAt: new Date(),
        attribution: { model: pacing.topOffenderModel },
        reasoning: grounded.reasoning,
        score: 10_000 + (pacing.daysUntilHit ? 100 - pacing.daysUntilHit : 50),
      };
    } catch (error) {
      this.logger.warn('Budget pacing decision build failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async buildChangeExplainerDecisions(
    userId: string,
  ): Promise<DecisionContext[]> {
    const docs = await this.costChangeExplainer.getUnconsumedForUser(userId, 5);
    const results: DecisionContext[] = [];
    const aggregate = await this.fetchUsageAggregate(userId);
    for (const doc of docs) {
      const samples = await this.fetchUsageSamples(userId, {
        model: doc.attribution?.model,
        limit: 5,
      });
      const grounded = await this.embeddingsService.generateGroundedDecision({
        userId,
        reason: 'cost_spike',
        impactUsd: doc.absChangeUsd,
        timeframe: 'per_week',
        samples,
        aggregate: {
          ...aggregate,
          currentSettings: {
            pctChange: doc.pctChange,
            correlatedActivity: doc.correlatedActivityType,
            ...doc.evidence,
          },
        },
        attribution: doc.attribution,
      });
      const { headline, narrative } = grounded;

      const urgency: UrgencyLevel =
        doc.anomalyTimestamp.getTime() > Date.now() - 24 * 60 * 60 * 1000
          ? 'now'
          : 'this_week';

      results.push({
        id: `cost-change:${doc._id}`,
        userId,
        urgency,
        state: 'action_required',
        trigger: {
          reason: doc.correlatedActivityType
            ? 'new_team_activity'
            : 'cost_spike',
          detectedAt: doc.anomalyTimestamp,
          evidence: {
            pctChange: doc.pctChange,
            correlationConfidence: doc.correlationConfidence,
            ...doc.evidence,
          },
        },
        headline,
        narrative,
        impact: {
          amountUsd: doc.absChangeUsd,
          timeframe: 'per_week',
          confidence: Math.max(
            grounded.confidence,
            doc.correlationConfidence || 0.4,
          ),
        },
        suggestedAction: {
          label: grounded.action.label,
          kind: grounded.action.kind,
          endpoint:
            grounded.action.kind === 'review' ? '/analytics' : undefined,
          payload: grounded.action.payload,
        },
        dismissible: true,
        source: { kind: 'cost_change_explainer', refId: String(doc._id) },
        createdAt: new Date(doc.anomalyTimestamp),
        attribution: doc.attribution,
        reasoning: grounded.reasoning,
        score: 5000 + Math.min(5000, doc.absChangeUsd * 10),
      });
    }
    return results;
  }

  private urgencyFor(
    priority: 'low' | 'medium' | 'high' | 'critical',
    createdAt: Date,
  ): UrgencyLevel {
    if (priority === 'critical') return 'now';
    const ageHours =
      (Date.now() - new Date(createdAt).getTime()) / (60 * 60 * 1000);
    if (priority === 'high' && ageHours < 24 * 7) return 'this_week';
    if (priority === 'medium') return 'this_month';
    return 'informational';
  }

  private async logActivity(
    userId: string,
    type: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.activityModel.create({
        userId: this.oid(userId),
        type,
        title: 'Decision applied',
        metadata,
      });
    } catch (error) {
      this.logger.warn('Failed to log decision activity', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private oid(id: string): Types.ObjectId {
    return new Types.ObjectId(id);
  }

  // Internal helper to satisfy unused-var warning on DecisionState import
  private _internalStates: DecisionState[] = [
    'action_required',
    'monitoring',
    'already_optimized',
  ];
}
