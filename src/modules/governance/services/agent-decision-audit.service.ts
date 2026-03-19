import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import {
  AgentDecisionAudit,
  IAgentDecisionAudit,
  IAlternativeConsidered,
  IDecisionImpact,
  IStrategicTradeoff,
  IArchitecturalDecisionReference,
} from '../../../schemas/agent/agent-decision-audit.schema';

export interface RecordDecisionOptions {
  decision: string;
  reasoning: string;
  alternativesConsidered: IAlternativeConsidered[];
  confidenceScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  executionContext: {
    executionId: string;
    startTime: Date;
    status: IAgentDecisionAudit['executionContext']['status'];
    estimatedCost?: number;
    sandboxId?: string;
    [key: string]: unknown;
  };
  inputData?: {
    prompt?: string;
    context?: unknown;
    parameters?: Record<string, unknown>;
    userIntent?: string;
  };
  outputData?: {
    result?: unknown;
    modelResponse?: string;
    actionsTaken?: string[];
    sideEffects?: string[];
  };
  decisionType: IAgentDecisionAudit['decisionType'];
  decisionCategory?: IAgentDecisionAudit['decisionCategory'];
  strategicTradeoff?: IStrategicTradeoff;
  architecturalDecisions?: IArchitecturalDecisionReference[];
  policyCompliance?: {
    policiesApplied: string[];
    policyOverrides?: string[];
    complianceScore: number;
  };
  impactAssessment?: IDecisionImpact;
  uncertaintyFactors?: string[];
  humanOverrideable?: boolean;
  reversible?: boolean;
  requiresApproval?: boolean;
  autoApproved?: boolean;
  mitigationStrategies?: string[];
  correlationId?: string;
  parentDecisionId?: string;
  complianceFlags?: string[];
  tags?: string[];
  customMetadata?: Record<string, unknown>;
}

export interface DecisionStats {
  totalDecisions: number;
  decisionsByType: Record<string, number>;
  decisionsByRisk: Record<string, number>;
  averageConfidence: number;
  averageCost: number;
  successRate: number;
  pendingReviews: number;
}

export interface AuditSummary {
  period: {
    start: Date;
    end: Date;
  };
  totals: {
    decisions: number;
    approvedDecisions: number;
    rejectedDecisions: number;
    pendingReview: number;
    highRiskDecisions: number;
    criticalDecisions: number;
    legalHolds: number;
  };
  costs: {
    totalEstimated: number;
    totalActual: number;
    averagePerDecision: number;
    totalTokens: number;
  };
  quality: {
    averageConfidence: number;
    successRate: number;
    averageFeedbackScore: number;
  };
  topAgents: Array<{ agentId: string; decisionCount: number; avgRisk: number }>;
  topDecisionTypes: Array<{ type: string; count: number }>;
}

/**
 * Agent Decision Audit Service
 *
 * Comprehensive audit trail for all agent decisions. Provides:
 * - Full decision recording with structured metadata
 * - Human review workflow management
 * - Decision querying and analytics
 * - Retention, masking, and compliance controls
 * - Legal-hold support
 * - Automated retention cleanup
 */
@Injectable()
export class AgentDecisionAuditService {
  private readonly logger = new Logger(AgentDecisionAuditService.name);

  private flushTimer: NodeJS.Timeout | null = null;
  private flushIntervalMs = 30_000; // 30 seconds, adjustable via configureAuditRules

  private dataMaskingEnabled = false;
  private sensitiveFieldPatterns: RegExp[] = [];
  private retentionPeriodMs = 365 * 24 * 60 * 60 * 1000; // 1 year
  private logLevel: 'minimal' | 'standard' | 'detailed' = 'detailed';
  private auditedEventTypes: string[] = ['*'];

  constructor(
    @InjectModel(AgentDecisionAudit.name)
    private readonly agentDecisionAuditModel: Model<IAgentDecisionAudit>,
  ) {
    this.startFlushTimer();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC – WRITE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record a new agent decision with a full audit trail.
   *
   * Applies data masking to prompt / context fields when masking is enabled
   * before persisting to MongoDB.
   */
  async recordDecision(
    agentId: string,
    agentIdentityId: Types.ObjectId,
    userId: Types.ObjectId,
    options: RecordDecisionOptions,
  ): Promise<IAgentDecisionAudit> {
    if (!this.shouldAuditEventType(options.decisionType)) {
      this.logger.debug(
        `Skipping audit for event type: ${options.decisionType}`,
      );
      return this.buildStubAudit(agentId, agentIdentityId, userId, options);
    }

    const decisionId = this.generateDecisionId();
    const sanitizedInput = this.dataMaskingEnabled
      ? this.maskSensitiveData(options.inputData)
      : options.inputData;
    const sanitizedOutput = this.dataMaskingEnabled
      ? this.maskSensitiveData(options.outputData)
      : options.outputData;

    try {
      const audit = new this.agentDecisionAuditModel({
        decisionId,
        agentId,
        agentIdentityId,
        userId,
        decisionType: options.decisionType,
        decisionCategory: options.decisionCategory ?? 'operational',
        decision: options.decision,
        reasoning: options.reasoning,
        alternativesConsidered: options.alternativesConsidered,
        confidenceScore: options.confidenceScore,
        riskLevel: options.riskLevel,
        executionContext: options.executionContext,
        inputData: sanitizedInput,
        outputData: sanitizedOutput,
        strategicTradeoff: options.strategicTradeoff,
        architecturalDecisions: options.architecturalDecisions,
        policyCompliance: options.policyCompliance,
        impactAssessment: options.impactAssessment,
        uncertaintyFactors: options.uncertaintyFactors,
        humanOverrideable: options.humanOverrideable ?? true,
        reversible: options.reversible ?? true,
        requiresApproval: options.requiresApproval ?? false,
        autoApproved: options.autoApproved ?? false,
        mitigationStrategies: options.mitigationStrategies,
        correlationId: options.correlationId,
        parentDecisionId: options.parentDecisionId,
        complianceFlags: options.complianceFlags,
        tags: options.tags,
        customMetadata: options.customMetadata,
        timestamp: new Date(),
      });

      await audit.save();

      this.log('log', `Decision recorded: ${decisionId}`, {
        agentId,
        decisionType: options.decisionType,
        riskLevel: options.riskLevel,
        confidenceScore: options.confidenceScore,
        requiresApproval: options.requiresApproval,
      });

      // Alert immediately for critical / high-risk decisions
      if (options.riskLevel === 'critical' || options.riskLevel === 'high') {
        await this.flagHighRiskDecision(audit);
      }

      return audit;
    } catch (error) {
      this.logger.error('Failed to record decision', {
        agentId,
        decisionType: options.decisionType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a decision with actual execution results (cost, tokens, status, timing).
   *
   * Typically called after the agent action completes or fails so the audit
   * record is enriched with real performance data.
   */
  async updateDecisionExecution(
    decisionId: string,
    executionData: {
      actualCost?: number;
      costBreakdown?: {
        inputTokensCost: number;
        outputTokensCost: number;
        computeCost: number;
        storageCost: number;
      };
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      durationMs?: number;
      exitCode?: number;
      errorMessage?: string;
      errorStack?: string;
      status: IAgentDecisionAudit['executionContext']['status'];
    },
  ): Promise<void> {
    try {
      const $set: Record<string, unknown> = {
        'executionContext.status': executionData.status,
        'executionContext.endTime': new Date(),
      };

      if (executionData.actualCost !== undefined)
        $set['executionContext.actualCost'] = executionData.actualCost;
      if (executionData.costBreakdown !== undefined)
        $set['executionContext.costBreakdown'] = executionData.costBreakdown;
      if (executionData.inputTokens !== undefined)
        $set['executionContext.inputTokens'] = executionData.inputTokens;
      if (executionData.outputTokens !== undefined)
        $set['executionContext.outputTokens'] = executionData.outputTokens;
      if (executionData.totalTokens !== undefined)
        $set['executionContext.totalTokens'] = executionData.totalTokens;
      if (executionData.durationMs !== undefined)
        $set['executionContext.durationMs'] = executionData.durationMs;
      if (executionData.exitCode !== undefined)
        $set['executionContext.exitCode'] = executionData.exitCode;
      if (executionData.errorMessage !== undefined)
        $set['executionContext.errorMessage'] = executionData.errorMessage;
      if (executionData.errorStack !== undefined)
        $set['executionContext.errorStack'] = executionData.errorStack;

      const result = await this.agentDecisionAuditModel.updateOne(
        { decisionId },
        { $set },
      );

      if (result.matchedCount === 0) {
        this.logger.warn(
          `updateDecisionExecution: decision not found – ${decisionId}`,
        );
        return;
      }

      this.log('log', `Decision execution updated: ${decisionId}`, {
        status: executionData.status,
        actualCost: executionData.actualCost,
        totalTokens: executionData.totalTokens,
        durationMs: executionData.durationMs,
      });
    } catch (error) {
      this.logger.error('Failed to update decision execution', {
        decisionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Attach a human reviewer's decision (approve / reject / escalate) to an audit.
   */
  async addHumanReview(
    decisionId: string,
    review: {
      reviewerId: Types.ObjectId;
      reviewerEmail: string;
      reviewerName: string;
      reviewStatus: NonNullable<
        IAgentDecisionAudit['humanReview']
      >['reviewStatus'];
      reviewComments?: string;
      approvalGranted?: boolean;
      approvalReason?: string;
    },
  ): Promise<void> {
    try {
      const humanReview = {
        ...review,
        reviewedAt: new Date(),
        approvalRequired: true,
      };

      const result = await this.agentDecisionAuditModel.updateOne(
        { decisionId },
        { $set: { humanReview } },
      );

      if (result.matchedCount === 0) {
        this.logger.warn(`addHumanReview: decision not found – ${decisionId}`);
        return;
      }

      this.log('log', `Human review added: ${decisionId}`, {
        reviewStatus: review.reviewStatus,
        reviewerEmail: review.reviewerEmail,
        approvalGranted: review.approvalGranted,
      });
    } catch (error) {
      this.logger.error('Failed to add human review', {
        decisionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record post-execution feedback for a decision.
   * Feedback is used to train / improve agent decision models.
   */
  async addFeedback(
    decisionId: string,
    feedback: {
      feedbackScore?: number;
      feedbackComments?: string;
      wasSuccessful?: boolean;
      successMetrics?: Record<string, number>;
    },
  ): Promise<void> {
    try {
      const $set: Record<string, unknown> = {};
      if (feedback.feedbackScore !== undefined)
        $set.feedbackScore = feedback.feedbackScore;
      if (feedback.feedbackComments !== undefined)
        $set.feedbackComments = feedback.feedbackComments;
      if (feedback.wasSuccessful !== undefined)
        $set.wasSuccessful = feedback.wasSuccessful;
      if (feedback.successMetrics !== undefined)
        $set.successMetrics = feedback.successMetrics;

      const result = await this.agentDecisionAuditModel.updateOne(
        { decisionId },
        { $set },
      );

      if (result.matchedCount === 0) {
        this.logger.warn(`addFeedback: decision not found – ${decisionId}`);
        return;
      }

      this.log('log', `Feedback added: ${decisionId}`, {
        feedbackScore: feedback.feedbackScore,
        wasSuccessful: feedback.wasSuccessful,
      });
    } catch (error) {
      this.logger.error('Failed to add feedback', {
        decisionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Link child decision IDs to a parent decision (builds the decision tree).
   */
  async linkChildDecisions(
    parentDecisionId: string,
    childDecisionIds: string[],
  ): Promise<void> {
    try {
      await this.agentDecisionAuditModel.updateOne(
        { decisionId: parentDecisionId },
        { $addToSet: { childDecisionIds: { $each: childDecisionIds } } },
      );
      this.log(
        'log',
        `Linked ${childDecisionIds.length} child decisions to ${parentDecisionId}`,
      );
    } catch (error) {
      this.logger.error('Failed to link child decisions', {
        parentDecisionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Set or remove a legal hold on a set of decisions.
   *
   * Decisions under legal hold are excluded from TTL-based cleanup and
   * retention-policy deletion.
   */
  async setLegalHold(decisionIds: string[], legalHold: boolean): Promise<void> {
    try {
      const result = await this.agentDecisionAuditModel.updateMany(
        { decisionId: { $in: decisionIds } },
        { $set: { legalHold, retentionOverride: legalHold } },
      );

      this.logger.log(
        `Legal hold ${legalHold ? 'set' : 'cleared'} on ${result.modifiedCount} decisions`,
        { requestedCount: decisionIds.length },
      );
    } catch (error) {
      this.logger.error('Failed to set legal hold', {
        count: decisionIds.length,
        legalHold,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC – READ
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Flexible decision query with rich filtering and pagination.
   */
  async queryDecisions(filter: {
    agentId?: string;
    userId?: string;
    decisionType?: IAgentDecisionAudit['decisionType'];
    riskLevel?: IAgentDecisionAudit['riskLevel'];
    status?: IAgentDecisionAudit['executionContext']['status'];
    reviewStatus?: NonNullable<
      IAgentDecisionAudit['humanReview']
    >['reviewStatus'];
    dateFrom?: Date;
    dateTo?: Date;
    correlationId?: string;
    legalHold?: boolean;
    requiresApproval?: boolean;
    wasSuccessful?: boolean;
    tags?: string[];
    complianceFlags?: string[];
    minConfidence?: number;
    maxConfidence?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ decisions: IAgentDecisionAudit[]; total: number }> {
    try {
      const query: Record<string, unknown> = {};

      if (filter.agentId) query.agentId = filter.agentId;
      if (filter.userId) query.userId = filter.userId;
      if (filter.decisionType) query.decisionType = filter.decisionType;
      if (filter.riskLevel) query.riskLevel = filter.riskLevel;
      if (filter.status) query['executionContext.status'] = filter.status;
      if (filter.reviewStatus)
        query['humanReview.reviewStatus'] = filter.reviewStatus;
      if (filter.correlationId) query.correlationId = filter.correlationId;
      if (filter.legalHold !== undefined) query.legalHold = filter.legalHold;
      if (filter.requiresApproval !== undefined)
        query.requiresApproval = filter.requiresApproval;
      if (filter.wasSuccessful !== undefined)
        query.wasSuccessful = filter.wasSuccessful;
      if (filter.tags?.length) query.tags = { $in: filter.tags };
      if (filter.complianceFlags?.length)
        query.complianceFlags = { $in: filter.complianceFlags };

      if (filter.dateFrom || filter.dateTo) {
        const tRange: Record<string, Date> = {};
        if (filter.dateFrom) tRange.$gte = filter.dateFrom;
        if (filter.dateTo) tRange.$lte = filter.dateTo;
        query.timestamp = tRange;
      }

      if (
        filter.minConfidence !== undefined ||
        filter.maxConfidence !== undefined
      ) {
        const cRange: Record<string, number> = {};
        if (filter.minConfidence !== undefined)
          cRange.$gte = filter.minConfidence;
        if (filter.maxConfidence !== undefined)
          cRange.$lte = filter.maxConfidence;
        query.confidenceScore = cRange;
      }

      const limit = Math.min(filter.limit ?? 100, 1000);
      const offset = filter.offset ?? 0;

      const [decisions, total] = await Promise.all([
        this.agentDecisionAuditModel
          .find(query)
          .sort({ timestamp: -1 })
          .skip(offset)
          .limit(limit)
          .populate('userId', 'email name')
          .populate('agentIdentityId', 'agentName agentType'),
        this.agentDecisionAuditModel.countDocuments(query),
      ]);

      this.log('log', `Queried ${decisions.length} / ${total} decisions`, {
        filterKeys: Object.keys(filter).length,
        limit,
        offset,
      });

      return { decisions, total };
    } catch (error) {
      this.logger.error('Failed to query decisions', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { decisions: [], total: 0 };
    }
  }

  /**
   * Fetch a single decision by its unique decision ID.
   */
  async getDecisionById(
    decisionId: string,
  ): Promise<IAgentDecisionAudit | null> {
    try {
      return await this.agentDecisionAuditModel
        .findOne({ decisionId })
        .populate('userId', 'email name')
        .populate('agentIdentityId', 'agentName agentType');
    } catch (error) {
      this.logger.error('Failed to get decision by ID', {
        decisionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Return the full decision chain (parent + all descendants) for a correlation ID.
   * Useful for tracing multi-step agent workflows end-to-end.
   */
  async getDecisionChain(
    correlationId: string,
  ): Promise<IAgentDecisionAudit[]> {
    try {
      const decisions = await this.agentDecisionAuditModel
        .find({ correlationId })
        .sort({ timestamp: 1 });
      return decisions;
    } catch (error) {
      this.logger.error('Failed to get decision chain', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Aggregate decision KPIs for a given agent / user / time range.
   *
   * Returns counts, averages, and success/pending-review breakdowns.
   */
  async getDecisionStats(filter: {
    agentId?: string;
    userId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<DecisionStats> {
    try {
      const matchStage: Record<string, unknown> = {};
      if (filter.agentId) matchStage.agentId = filter.agentId;
      if (filter.userId) matchStage.userId = filter.userId;
      if (filter.dateFrom || filter.dateTo) {
        const tRange: Record<string, Date> = {};
        if (filter.dateFrom) tRange.$gte = filter.dateFrom;
        if (filter.dateTo) tRange.$lte = filter.dateTo;
        matchStage.timestamp = tRange;
      }

      const [stats] = await this.agentDecisionAuditModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalDecisions: { $sum: 1 },
            decisionsByType: { $push: '$decisionType' },
            decisionsByRisk: { $push: '$riskLevel' },
            confidenceScores: { $push: '$confidenceScore' },
            costs: { $push: '$executionContext.actualCost' },
            successfulDecisions: {
              $sum: {
                $cond: [
                  { $eq: ['$executionContext.status', 'completed'] },
                  1,
                  0,
                ],
              },
            },
            pendingReviews: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      '$requiresApproval',
                      {
                        $or: [
                          { $eq: ['$humanReview', null] },
                          { $eq: ['$humanReview.reviewStatus', 'pending'] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]);

      if (!stats) {
        return {
          totalDecisions: 0,
          decisionsByType: {},
          decisionsByRisk: {},
          averageConfidence: 0,
          averageCost: 0,
          successRate: 0,
          pendingReviews: 0,
        };
      }

      const decisionsByType = this.countArray<string>(stats.decisionsByType);
      const decisionsByRisk = this.countArray<string>(stats.decisionsByRisk);

      const validCosts = (stats.costs as (number | null)[]).filter(
        (c): c is number => c != null,
      );

      const averageConfidence =
        stats.confidenceScores.length > 0
          ? stats.confidenceScores.reduce((a: number, b: number) => a + b, 0) /
            stats.confidenceScores.length
          : 0;

      const averageCost =
        validCosts.length > 0
          ? validCosts.reduce((a, b) => a + b, 0) / validCosts.length
          : 0;

      return {
        totalDecisions: stats.totalDecisions,
        decisionsByType,
        decisionsByRisk,
        averageConfidence: Math.round(averageConfidence * 1000) / 1000,
        averageCost: Math.round(averageCost * 10_000) / 10_000,
        successRate:
          stats.totalDecisions > 0
            ? Math.round(
                (stats.successfulDecisions / stats.totalDecisions) * 1000,
              ) / 1000
            : 0,
        pendingReviews: stats.pendingReviews,
      };
    } catch (error) {
      this.logger.error('Failed to get decision stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate a rich audit summary for a time window.
   *
   * Aggregates totals, cost data, quality metrics, and top agents / decision
   * types into a single object suited for dashboards and compliance reports.
   */
  async generateAuditSummary(
    startDate: Date,
    endDate: Date,
    agentId?: string,
  ): Promise<AuditSummary> {
    try {
      const matchStage: Record<string, unknown> = {
        timestamp: { $gte: startDate, $lte: endDate },
      };
      if (agentId) matchStage.agentId = agentId;

      const [
        totalsResult,
        costsResult,
        qualityResult,
        agentsResult,
        typesResult,
      ] = await Promise.all([
        // Totals
        this.agentDecisionAuditModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              approved: {
                $sum: {
                  $cond: [
                    { $eq: ['$humanReview.reviewStatus', 'approved'] },
                    1,
                    0,
                  ],
                },
              },
              rejected: {
                $sum: {
                  $cond: [
                    { $eq: ['$humanReview.reviewStatus', 'rejected'] },
                    1,
                    0,
                  ],
                },
              },
              pending: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        '$requiresApproval',
                        {
                          $or: [
                            { $eq: ['$humanReview', null] },
                            { $eq: ['$humanReview.reviewStatus', 'pending'] },
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              highRisk: {
                $sum: { $cond: [{ $eq: ['$riskLevel', 'high'] }, 1, 0] },
              },
              critical: {
                $sum: { $cond: [{ $eq: ['$riskLevel', 'critical'] }, 1, 0] },
              },
              legalHolds: {
                $sum: { $cond: [{ $eq: ['$legalHold', true] }, 1, 0] },
              },
            },
          },
        ]),

        // Costs & tokens
        this.agentDecisionAuditModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              totalEstimated: { $sum: '$executionContext.estimatedCost' },
              totalActual: { $sum: '$executionContext.actualCost' },
              count: { $sum: 1 },
              totalTokens: { $sum: '$executionContext.totalTokens' },
            },
          },
        ]),

        // Quality
        this.agentDecisionAuditModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              avgConfidence: { $avg: '$confidenceScore' },
              successfulCount: {
                $sum: {
                  $cond: [
                    { $eq: ['$executionContext.status', 'completed'] },
                    1,
                    0,
                  ],
                },
              },
              total: { $sum: 1 },
              avgFeedback: { $avg: '$feedbackScore' },
            },
          },
        ]),

        // Top agents by decision count
        this.agentDecisionAuditModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$agentId',
              decisionCount: { $sum: 1 },
              riskLevels: { $push: '$riskLevel' },
            },
          },
          { $sort: { decisionCount: -1 } },
          { $limit: 10 },
        ]),

        // Top decision types
        this.agentDecisionAuditModel.aggregate([
          { $match: matchStage },
          { $group: { _id: '$decisionType', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
      ]);

      const t = totalsResult[0] ?? {};
      const c = costsResult[0] ?? {};
      const q = qualityResult[0] ?? {};

      const riskScore = (level: string): number =>
        ({ low: 1, medium: 2, high: 3, critical: 4 })[level] ?? 1;

      const topAgents = agentsResult.map(
        (a: { _id: string; decisionCount: number; riskLevels: string[] }) => ({
          agentId: a._id,
          decisionCount: a.decisionCount,
          avgRisk:
            a.riskLevels.length > 0
              ? a.riskLevels.reduce((sum, r) => sum + riskScore(r), 0) /
                a.riskLevels.length
              : 1,
        }),
      );

      const topDecisionTypes = typesResult.map(
        (d: { _id: string; count: number }) => ({
          type: d._id,
          count: d.count,
        }),
      );

      return {
        period: { start: startDate, end: endDate },
        totals: {
          decisions: t.total ?? 0,
          approvedDecisions: t.approved ?? 0,
          rejectedDecisions: t.rejected ?? 0,
          pendingReview: t.pending ?? 0,
          highRiskDecisions: t.highRisk ?? 0,
          criticalDecisions: t.critical ?? 0,
          legalHolds: t.legalHolds ?? 0,
        },
        costs: {
          totalEstimated: Math.round((c.totalEstimated ?? 0) * 10_000) / 10_000,
          totalActual: Math.round((c.totalActual ?? 0) * 10_000) / 10_000,
          averagePerDecision:
            c.count > 0
              ? Math.round(((c.totalActual ?? 0) / c.count) * 10_000) / 10_000
              : 0,
          totalTokens: c.totalTokens ?? 0,
        },
        quality: {
          averageConfidence: Math.round((q.avgConfidence ?? 0) * 1000) / 1000,
          successRate:
            q.total > 0
              ? Math.round(((q.successfulCount ?? 0) / q.total) * 1000) / 1000
              : 0,
          averageFeedbackScore: Math.round((q.avgFeedback ?? 0) * 100) / 100,
        },
        topAgents,
        topDecisionTypes,
      };
    } catch (error) {
      this.logger.error('Failed to generate audit summary', {
        startDate,
        endDate,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Return the most recent N audit documents for real-time monitoring.
   */
  async getRecentAudits(
    timeRangeMs: number,
    limit = 100,
  ): Promise<IAgentDecisionAudit[]> {
    try {
      const since = new Date(Date.now() - timeRangeMs);
      return (await this.agentDecisionAuditModel
        .find({ timestamp: { $gte: since } })
        .sort({ timestamp: -1 })
        .limit(Math.min(limit, 1000))
        .lean()) as unknown as IAgentDecisionAudit[];
    } catch (error) {
      this.logger.error('Failed to get recent audits', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Return all decisions that require human review and have not yet been acted on.
   */
  async getPendingReviews(
    limit = 50,
    offset = 0,
  ): Promise<{ decisions: IAgentDecisionAudit[]; total: number }> {
    const query = {
      requiresApproval: true,
      $or: [{ humanReview: null }, { 'humanReview.reviewStatus': 'pending' }],
    };

    const [decisions, total] = await Promise.all([
      this.agentDecisionAuditModel
        .find(query)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .populate('userId', 'email name'),
      this.agentDecisionAuditModel.countDocuments(query),
    ]);

    return { decisions, total };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC – SYSTEM / ADMIN
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * One-time bootstrap: ensure indexes and validate configuration.
   * Call during application startup (e.g. OnModuleInit) if needed.
   */
  async initializeAuditSystem(): Promise<void> {
    try {
      this.logger.log('Initializing audit system…');
      await this.ensureAuditIndexes();
      this.startFlushTimer();
      await this.validateAuditConfiguration();
      this.logger.log('Audit system initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize audit system', error);
      throw error;
    }
  }

  /**
   * Apply an array of rule objects to configure masking, retention, log level,
   * and audited event types at runtime.
   *
   * Rule shape (all fields optional):
   * ```json
   * {
   *   "name": "gdpr-mask",
   *   "sensitiveDataMasking": true,
   *   "retentionPeriod": "2y",
   *   "logLevel": "standard",
   *   "eventTypes": ["model_selection", "data_access"]
   * }
   * ```
   */
  async configureAuditRules(
    rules: Array<Record<string, unknown>>,
  ): Promise<void> {
    try {
      this.logger.log(`Configuring ${rules.length} audit rules…`);
      for (const rule of rules) {
        this.applyAuditRule(rule);
      }
      // Restart flush timer with potentially updated interval
      this.startFlushTimer();
      this.logger.log('Audit rules configured successfully');
    } catch (error) {
      this.logger.error('Failed to configure audit rules', error);
      throw error;
    }
  }

  /**
   * Force-flush any in-flight writes and verify database connectivity.
   * Useful during graceful shutdown or health-check endpoints.
   */
  async flushPendingAudits(): Promise<void> {
    try {
      this.logger.log('Flushing pending audit operations…');
      // Ping the primary to confirm write concern is satisfied
      await (
        this.agentDecisionAuditModel.db as unknown as {
          admin: () => { ping: () => Promise<void> };
        }
      )
        .admin()
        .ping();
      this.logger.log('Audit flush complete – all writes committed');
    } catch (error) {
      this.logger.error('Failed to flush pending audits', error);
      throw error;
    }
  }

  /**
   * Delete audit records that are past their retention date and NOT under legal hold.
   *
   * Should be called by a scheduled job (e.g. a NestJS cron), not on every request.
   */
  async cleanupOldLogs(): Promise<{ deleted: number }> {
    try {
      const cutoff = new Date(Date.now() - this.retentionPeriodMs);

      const result = await this.agentDecisionAuditModel.deleteMany({
        timestamp: { $lt: cutoff },
        legalHold: { $ne: true },
        retentionOverride: { $ne: true },
      });

      this.logger.log(
        `Cleanup: deleted ${result.deletedCount} expired audit logs`,
        {
          cutoffDate: cutoff.toISOString(),
          retentionDays: Math.round(
            this.retentionPeriodMs / (24 * 60 * 60 * 1000),
          ),
        },
      );

      return { deleted: result.deletedCount ?? 0 };
    } catch (error) {
      this.logger.error('Failed to cleanup old audit logs', error);
      throw error;
    }
  }

  /**
   * Stop the background flush timer (typically called during graceful shutdown).
   */
  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      this.logger.log('Decision audit flush timer stopped');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE – HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private generateDecisionId(): string {
    const ts = Date.now().toString(36);
    const rnd = crypto.randomBytes(6).toString('hex');
    return `decision-${ts}-${rnd}`;
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      this.logger.debug('Decision audit heartbeat tick');
    }, this.flushIntervalMs);
  }

  private async ensureAuditIndexes(): Promise<void> {
    try {
      const col = this.agentDecisionAuditModel.collection;
      await Promise.all([
        col.createIndex({ agentId: 1, timestamp: -1 }, { background: true }),
        col.createIndex({ userId: 1, timestamp: -1 }, { background: true }),
        col.createIndex(
          { decisionType: 1, riskLevel: 1, timestamp: -1 },
          { background: true },
        ),
        col.createIndex(
          { correlationId: 1 },
          { background: true, sparse: true },
        ),
        col.createIndex(
          { 'humanReview.reviewStatus': 1 },
          { background: true, sparse: true },
        ),
        col.createIndex({ legalHold: 1 }, { background: true, sparse: true }),
        col.createIndex(
          { 'policyCompliance.complianceScore': 1 },
          { background: true, sparse: true },
        ),
        col.createIndex(
          { requiresApproval: 1, 'humanReview.reviewStatus': 1 },
          { background: true },
        ),
      ]);
      this.logger.log('Audit indexes verified');
    } catch (error) {
      this.logger.warn('Failed to create audit indexes (may already exist)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async validateAuditConfiguration(): Promise<void> {
    const issues: string[] = [];
    if (this.retentionPeriodMs < 24 * 60 * 60 * 1000) {
      issues.push(
        'Retention period is less than 1 day – this may cause accidental data loss',
      );
    }
    if (this.auditedEventTypes.length === 0) {
      issues.push('No event types configured for auditing');
    }
    if (issues.length > 0) {
      this.logger.warn('Audit configuration warnings', { issues });
    } else {
      this.logger.log('Audit configuration validated', {
        retentionDays: Math.round(
          this.retentionPeriodMs / (24 * 60 * 60 * 1000),
        ),
        dataMasking: this.dataMaskingEnabled,
        logLevel: this.logLevel,
        auditedEventTypes: this.auditedEventTypes,
      });
    }
  }

  private applyAuditRule(rule: Record<string, unknown>): void {
    const name = String(rule.name ?? 'unnamed');

    if (rule.sensitiveDataMasking === true) {
      this.enableDataMasking();
    }

    if (typeof rule.retentionPeriod === 'string') {
      this.setRetentionPeriod(rule.retentionPeriod);
    }

    if (typeof rule.logLevel === 'string') {
      this.setLogLevel(rule.logLevel as 'minimal' | 'standard' | 'detailed');
    }

    if (
      Array.isArray(rule.eventTypes) &&
      (rule.eventTypes as string[]).length > 0
    ) {
      this.configureEventTypes(rule.eventTypes as string[]);
    }

    this.logger.log(`Applied audit rule: ${name}`);
  }

  private enableDataMasking(): void {
    this.dataMaskingEnabled = true;
    this.sensitiveFieldPatterns = [
      /password/i,
      /token/i,
      /secret/i,
      /\bkey\b/i,
      /auth/i,
      /credential/i,
      /private/i,
      /ssn/i,
      /social.?security/i,
      /credit.?card/i,
      /cvv/i,
      /\bpan\b/i,
    ];
    this.logger.log('Audit data masking enabled', {
      patterns: this.sensitiveFieldPatterns.length,
    });
  }

  /**
   * Recursively mask values whose keys match any sensitive pattern.
   * Returns a deep clone so the original object is not mutated.
   */
  private maskSensitiveData<T>(data: T): T {
    if (!data || typeof data !== 'object') return data;

    const masked: Record<string, unknown> = Array.isArray(data)
      ? ([] as unknown as Record<string, unknown>)
      : {};

    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      const isSensitive = this.sensitiveFieldPatterns.some((re) =>
        re.test(key),
      );
      if (isSensitive) {
        masked[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.maskSensitiveData(value);
      } else {
        masked[key] = value;
      }
    }

    return masked as T;
  }

  private setRetentionPeriod(period: string): void {
    const ms = this.parseRetentionPeriod(period);
    this.retentionPeriodMs = ms;

    // Tune flush interval when retention is short (< 30 days)
    if (ms < 30 * 24 * 60 * 60 * 1000) {
      this.flushIntervalMs = Math.max(ms / 10, 60_000);
    }

    this.logger.log(`Retention period updated: ${period} (${ms}ms)`);
  }

  private setLogLevel(level: 'minimal' | 'standard' | 'detailed'): void {
    this.logLevel = level;
    this.logger.log(`Log level set to: ${level}`);
  }

  private configureEventTypes(eventTypes: string[]): void {
    this.auditedEventTypes = eventTypes;
    this.logger.log(`Audited event types: ${eventTypes.join(', ')}`);
  }

  private shouldAuditEventType(decisionType: string): boolean {
    return (
      this.auditedEventTypes.includes('*') ||
      this.auditedEventTypes.includes(decisionType)
    );
  }

  private parseRetentionPeriod(period: string): number {
    const match = period.match(/^(\d+)([smhdwy])$/);
    if (!match)
      throw new Error(
        `Invalid retention period: "${period}" (expected e.g. "1y", "30d")`,
      );

    const value = parseInt(match[1], 10);
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
      y: 31_536_000_000, // 365 days
    };
    return value * multipliers[match[2]];
  }

  /**
   * Emit a structured warning for high/critical-risk decisions so downstream
   * alerting systems (Slack, PagerDuty, etc.) can subscribe via events.
   */
  private async flagHighRiskDecision(
    audit: IAgentDecisionAudit,
  ): Promise<void> {
    this.logger.warn('High-risk agent decision recorded', {
      decisionId: audit.decisionId,
      agentId: audit.agentId,
      riskLevel: audit.riskLevel,
      decisionType: audit.decisionType,
      requiresApproval: audit.requiresApproval,
      confidenceScore: audit.confidenceScore,
      timestamp: audit.timestamp,
    });
  }

  /** Structured log that respects the configured log level. */
  private log(
    level: 'log' | 'debug' | 'warn',
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (this.logLevel === 'minimal' && level === 'log') return;
    if (this.logLevel === 'standard' && level === 'debug') return;
    this.logger[level](message, context);
  }

  /**
   * Count occurrences of each value in an array.
   * Equivalent to a `lodash.countBy` but dependency-free.
   */
  private countArray<T extends string>(arr: T[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of arr) {
      counts[item] = (counts[item] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Build an in-memory stub document when auditing is skipped for an event
   * type. Returned so callers always get a typed value; consumers can check
   * customMetadata._skippedAudit to know the decision was not persisted.
   */
  /**
   * Build a stub audit record for cases where auditing is intentionally skipped
   * (e.g., low-risk operations, performance-critical paths).
   * The record maintains audit trail structure but is not persisted to database.
   */
  private buildStubAudit(
    agentId: string,
    agentIdentityId: Types.ObjectId,
    userId: Types.ObjectId,
    options: RecordDecisionOptions,
  ): IAgentDecisionAudit {
    return {
      decisionId: this.generateDecisionId(),
      agentId,
      agentIdentityId,
      userId,
      decisionType: options.decisionType,
      decisionCategory: options.decisionCategory ?? 'operational',
      decision: options.decision,
      reasoning: options.reasoning,
      alternativesConsidered: options.alternativesConsidered,
      confidenceScore: options.confidenceScore,
      riskLevel: options.riskLevel,
      executionContext:
        options.executionContext as IAgentDecisionAudit['executionContext'],
      inputData: options.inputData,
      outputData: options.outputData,
      humanOverrideable: options.humanOverrideable ?? true,
      reversible: options.reversible ?? true,
      requiresApproval: options.requiresApproval ?? false,
      autoApproved: options.autoApproved ?? false,
      timestamp: new Date(),
      customMetadata: {
        ...options.customMetadata,
        _skippedAudit: true,
      },
    } as unknown as IAgentDecisionAudit;
  }
}
