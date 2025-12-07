import crypto from 'crypto';
import { AgentDecisionAudit, IAgentDecisionAudit, IAlternativeConsidered } from '../models/AgentDecisionAudit';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';
import { EventEmitter } from 'events';

/**
 * Decision Recording Options
 */
export interface RecordDecisionOptions {
  agentId: string;
  agentIdentityId: string | mongoose.Types.ObjectId;
  userId: string | mongoose.Types.ObjectId;
  workspaceId?: string | mongoose.Types.ObjectId;
  organizationId?: string | mongoose.Types.ObjectId;
  projectId?: string | mongoose.Types.ObjectId;
  
  decisionType: IAgentDecisionAudit['decisionType'];
  decision: string;
  reasoning: string;
  alternativesConsidered: IAlternativeConsidered[];
  
  confidenceScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  executionContext: any;
  
  inputData?: any;
  outputData?: any;
  
  humanOverrideable?: boolean;
  reversible?: boolean;
  requiresApproval?: boolean;
  
  correlationId?: string;
  parentDecisionId?: string;
}

/**
 * Agent Decision Audit Service
 * Comprehensive audit trail for all agent decisions with reasoning capture
 * Enables post-mortem analysis, debugging, and compliance
 */
export class AgentDecisionAuditService extends EventEmitter {
  private static instance: AgentDecisionAuditService;
  
  // Buffer for batch writes
  private decisionBuffer: IAgentDecisionAudit[] = [];
  private readonly BUFFER_SIZE = 50;
  private readonly BUFFER_FLUSH_INTERVAL = 10000; // 10 seconds
  private flushTimer?: NodeJS.Timeout;

  private constructor() {
    super();
    this.startFlushTimer();
  }

  public static getInstance(): AgentDecisionAuditService {
    if (!AgentDecisionAuditService.instance) {
      AgentDecisionAuditService.instance = new AgentDecisionAuditService();
    }
    return AgentDecisionAuditService.instance;
  }

  /**
   * Record agent decision with full context and reasoning
   */
  public async recordDecision(options: RecordDecisionOptions): Promise<string> {
    try {
      const decisionId = this.generateDecisionId();

      const decision = new AgentDecisionAudit({
        decisionId,
        agentId: options.agentId,
        agentIdentityId: options.agentIdentityId,
        userId: options.userId,
        workspaceId: options.workspaceId,
        organizationId: options.organizationId,
        projectId: options.projectId,
        
        decisionType: options.decisionType,
        decisionCategory: this.categorizeDecision(options.decisionType, options.riskLevel),
        
        decision: options.decision,
        reasoning: options.reasoning,
        alternativesConsidered: options.alternativesConsidered,
        
        confidenceScore: options.confidenceScore,
        riskLevel: options.riskLevel,
        impactAssessment: await this.assessImpact(options),
        
        humanOverrideable: options.humanOverrideable !== false,
        reversible: options.reversible !== false,
        requiresApproval: options.requiresApproval || false,
        autoApproved: !options.requiresApproval,
        
        executionContext: options.executionContext,
        
        inputData: options.inputData,
        outputData: options.outputData,
        
        timestamp: new Date(),
        correlationId: options.correlationId,
        parentDecisionId: options.parentDecisionId
      });

      // Add to buffer for batch processing
      this.decisionBuffer.push(decision);

      // Flush if buffer is full
      if (this.decisionBuffer.length >= this.BUFFER_SIZE) {
        await this.flush();
      }

      // Emit event for real-time processing
      this.emit('decision_recorded', {
        decisionId,
        agentId: options.agentId,
        decisionType: options.decisionType,
        riskLevel: options.riskLevel
      });

      // High-risk decisions are written immediately
      if (options.riskLevel === 'high' || options.riskLevel === 'critical') {
        await decision.save();
        loggingService.warn('High-risk agent decision recorded', {
          component: 'AgentDecisionAuditService',
          operation: 'recordDecision',
          decisionId,
          agentId: options.agentId,
          riskLevel: options.riskLevel,
          decisionType: options.decisionType
        });
      }

      return decisionId;
    } catch (error) {
      loggingService.error('Failed to record agent decision', {
        component: 'AgentDecisionAuditService',
        operation: 'recordDecision',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update decision with execution results
   */
  public async updateDecisionResult(
    decisionId: string,
    update: {
      executionContext?: Partial<IAgentDecisionAudit['executionContext']>;
      outputData?: any;
      wasSuccessful?: boolean;
      successMetrics?: Record<string, number>;
    }
  ): Promise<void> {
    try {
      const updateQuery: any = {};

      if (update.executionContext) {
        for (const [key, value] of Object.entries(update.executionContext)) {
          updateQuery[`executionContext.${key}`] = value;
        }
      }

      if (update.outputData) {
        updateQuery.outputData = update.outputData;
      }

      if (update.wasSuccessful !== undefined) {
        updateQuery.wasSuccessful = update.wasSuccessful;
      }

      if (update.successMetrics) {
        updateQuery.successMetrics = update.successMetrics;
      }

      await AgentDecisionAudit.updateOne({ decisionId }, { $set: updateQuery });
    } catch (error) {
      loggingService.error('Failed to update decision result', {
        component: 'AgentDecisionAuditService',
        operation: 'updateDecisionResult',
        decisionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Record human review for decision
   */
  public async recordHumanReview(
    decisionId: string,
    review: {
      reviewerId: string | mongoose.Types.ObjectId;
      reviewerEmail: string;
      reviewerName: string;
      reviewStatus: 'approved' | 'rejected' | 'escalated';
      reviewComments?: string;
      approvalGranted?: boolean;
      approvalReason?: string;
    }
  ): Promise<void> {
    try {
      await AgentDecisionAudit.updateOne(
        { decisionId },
        {
          $set: {
            humanReview: {
              reviewerId: review.reviewerId,
              reviewerEmail: review.reviewerEmail,
              reviewerName: review.reviewerName,
              reviewStatus: review.reviewStatus,
              reviewedAt: new Date(),
              reviewComments: review.reviewComments,
              approvalRequired: true,
              approvalGranted: review.approvalGranted,
              approvalReason: review.approvalReason
            }
          }
        }
      );

      loggingService.info('Human review recorded for decision', {
        component: 'AgentDecisionAuditService',
        operation: 'recordHumanReview',
        decisionId,
        reviewStatus: review.reviewStatus,
        reviewerId: review.reviewerId.toString()
      });

      this.emit('human_review_recorded', {
        decisionId,
        reviewStatus: review.reviewStatus,
        reviewerId: review.reviewerId
      });
    } catch (error) {
      loggingService.error('Failed to record human review', {
        component: 'AgentDecisionAuditService',
        operation: 'recordHumanReview',
        decisionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get decision audit trail for agent
   */
  public async getDecisionHistory(
    agentId: string,
    options?: {
      limit?: number;
      startDate?: Date;
      endDate?: Date;
      decisionType?: string;
      riskLevel?: string;
    }
  ): Promise<IAgentDecisionAudit[]> {
    try {
      const query: any = { agentId };

      if (options?.startDate || options?.endDate) {
        query.timestamp = {};
        if (options.startDate) query.timestamp.$gte = options.startDate;
        if (options.endDate) query.timestamp.$lte = options.endDate;
      }

      if (options?.decisionType) {
        query.decisionType = options.decisionType;
      }

      if (options?.riskLevel) {
        query.riskLevel = options.riskLevel;
      }

      const decisions = await AgentDecisionAudit.find(query)
        .sort({ timestamp: -1 })
        .limit(options?.limit || 100);

      return decisions;
    } catch (error) {
      loggingService.error('Failed to get decision history', {
        component: 'AgentDecisionAuditService',
        operation: 'getDecisionHistory',
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Analyze decision patterns for agent
   */
  public async analyzeDecisionPatterns(agentId: string): Promise<{
    totalDecisions: number;
    decisionsByType: Record<string, number>;
    decisionsByRisk: Record<string, number>;
    averageConfidence: number;
    successRate: number;
    commonReasons: string[];
  }> {
    try {
      const decisions = await AgentDecisionAudit.find({ agentId });

      const patterns = {
        totalDecisions: decisions.length,
        decisionsByType: {} as Record<string, number>,
        decisionsByRisk: {} as Record<string, number>,
        averageConfidence: 0,
        successRate: 0,
        commonReasons: [] as string[]
      };

      if (decisions.length === 0) {
        return patterns;
      }

      let totalConfidence = 0;
      let successCount = 0;
      const reasonMap = new Map<string, number>();

      for (const decision of decisions) {
        // Count by type
        patterns.decisionsByType[decision.decisionType] = 
          (patterns.decisionsByType[decision.decisionType] || 0) + 1;

        // Count by risk
        patterns.decisionsByRisk[decision.riskLevel] = 
          (patterns.decisionsByRisk[decision.riskLevel] || 0) + 1;

        // Sum confidence
        totalConfidence += decision.confidenceScore;

        // Count successes
        if (decision.wasSuccessful) {
          successCount++;
        }

        // Track reasoning patterns
        const reasoning = decision.reasoning.substring(0, 100);
        reasonMap.set(reasoning, (reasonMap.get(reasoning) || 0) + 1);
      }

      patterns.averageConfidence = totalConfidence / decisions.length;
      patterns.successRate = successCount / decisions.length;

      // Get top 5 common reasons
      patterns.commonReasons = Array.from(reasonMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason]) => reason);

      return patterns;
    } catch (error) {
      loggingService.error('Failed to analyze decision patterns', {
        component: 'AgentDecisionAuditService',
        operation: 'analyzeDecisionPatterns',
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Find decisions pending human review
   */
  public async getPendingReviews(userId?: string): Promise<IAgentDecisionAudit[]> {
    try {
      const query: any = {
        requiresApproval: true,
        'humanReview.reviewStatus': 'pending'
      };

      if (userId) {
        query.userId = userId;
      }

      const pending = await AgentDecisionAudit.find(query)
        .sort({ timestamp: -1 })
        .limit(50);

      return pending;
    } catch (error) {
      loggingService.error('Failed to get pending reviews', {
        component: 'AgentDecisionAuditService',
        operation: 'getPendingReviews',
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Categorize decision based on type and risk
   */
  private categorizeDecision(
    decisionType: string,
    riskLevel: string
  ): 'operational' | 'strategic' | 'tactical' | 'emergency' {
    if (riskLevel === 'critical') {
      return 'emergency';
    }

    if (decisionType === 'resource_allocation' || decisionType === 'optimization') {
      return 'strategic';
    }

    if (decisionType === 'model_selection' || decisionType === 'action_execution') {
      return 'tactical';
    }

    return 'operational';
  }

  /**
   * Assess impact of decision
   */
  private async assessImpact(options: RecordDecisionOptions): Promise<any> {
    // Simplified impact assessment
    // In production, this would be more sophisticated
    const impact = {
      costImpact: 'low',
      performanceImpact: 'low',
      securityImpact: 'low',
      userExperienceImpact: 'low',
      overallRiskLevel: options.riskLevel
    };

    // Adjust based on decision type
    if (options.decisionType === 'resource_allocation') {
      impact.costImpact = options.riskLevel === 'critical' ? 'critical' : 'medium';
    }

    if (options.decisionType === 'model_selection') {
      impact.performanceImpact = 'medium';
    }

    if (options.decisionType === 'data_access' || options.decisionType === 'capability_invocation') {
      impact.securityImpact = options.riskLevel;
    }

    return impact;
  }

  /**
   * Generate unique decision ID
   */
  private generateDecisionId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `dec-${timestamp}-${random}`;
  }

  /**
   * Flush decision buffer to database
   */
  private async flush(): Promise<void> {
    if (this.decisionBuffer.length === 0) return;

    try {
      const toFlush = [...this.decisionBuffer];
      this.decisionBuffer = [];

      await AgentDecisionAudit.insertMany(toFlush, { ordered: false });

      loggingService.info('Flushed decision audit buffer', {
        component: 'AgentDecisionAuditService',
        operation: 'flush',
        count: toFlush.length
      });
    } catch (error) {
      loggingService.error('Failed to flush decision buffer', {
        component: 'AgentDecisionAuditService',
        operation: 'flush',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Start flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.BUFFER_FLUSH_INTERVAL);
  }

  /**
   * Stop flush timer
   */
  public stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }
}

// Export singleton instance
export const agentDecisionAuditService = AgentDecisionAuditService.getInstance();

