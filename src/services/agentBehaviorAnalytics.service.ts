import { 
  AgentDecisionLog, 
  IAgentDecisionLog,
  AgentAction,
  AgentAnomaly,
  AgentCostBreakdown,
  AgentPerformance
} from '../models/AgentDecisionLog';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';

/**
 * Agent pattern detection result
 */
export interface DetectedPattern {
  patternType: 'loop' | 'excessive_retries' | 'redundant_calls' | 'inefficient_tool_usage' | 'model_over_usage' | 'cost_spike';
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedSessions: string[];
  frequency: number;
  avgCostImpact: number;
  recommendation: string;
}

/**
 * Agent efficiency metrics
 */
export interface AgentEfficiencyMetrics {
  agentId: string;
  agentType: string;
  
  // Performance
  avgDurationMs: number;
  avgActionsPerSession: number;
  avgSuccessRate: number;
  
  // Cost
  avgCostPerSession: number;
  totalCost: number;
  costTrend: 'increasing' | 'stable' | 'decreasing';
  
  // Quality
  avgGoalAchievement: number;
  avgUserSatisfaction: number;
  
  // Efficiency scores
  efficiencyScore: number;
  costEfficiencyScore: number;
  qualityScore: number;
  reliabilityScore: number;
  
  // Improvement potential
  estimatedSavings: number;
  improvementAreas: string[];
  
  sampleSize: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Agent Behavior Analytics Service
 * Monitors agent decisions, detects patterns, and identifies optimization opportunities
 */
export class AgentBehaviorAnalyticsService {
  private static readonly ANOMALY_THRESHOLDS = {
    highCost: 0.10, // $0.10 per session
    longDuration: 60000, // 60 seconds
    lowSuccessRate: 0.5, // 50%
    excessiveRetries: 3,
    redundantActions: 0.3 // 30% of actions are redundant
  };

  /**
   * Log an agent decision session
   */
  static async logAgentSession(params: {
    agentId: string;
    agentSessionId: string;
    userId: mongoose.Types.ObjectId;
    tenantId?: string;
    workspaceId?: string;
    requestId: string;
    conversationId?: string;
    configuration: any;
    userGoal: string;
    actions: AgentAction[];
    startedAt: Date;
    completedAt: Date;
    outcome: any;
    environment?: string;
  }): Promise<IAgentDecisionLog> {
    try {
      // Calculate performance metrics
      const performance = this.calculatePerformance(
        params.actions,
        params.startedAt,
        params.completedAt,
        params.outcome
      );

      // Calculate cost breakdown
      const costBreakdown = this.calculateCostBreakdown(params.actions);

      // Detect anomalies
      const anomalies = this.detectAnomalies(params.actions, performance, costBreakdown);

      // Calculate learning signals
      const learningSignals = this.calculateLearningSignals(
        performance,
        costBreakdown,
        anomalies,
        params.outcome
      );

      const log = new AgentDecisionLog({
        agentId: params.agentId,
        agentSessionId: params.agentSessionId,
        userId: params.userId,
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        requestId: params.requestId,
        conversationId: params.conversationId,
        configuration: params.configuration,
        userGoal: params.userGoal,
        userInputSummary: params.userGoal.substring(0, 2000),
        actions: params.actions,
        performance,
        costBreakdown,
        anomalies,
        outcome: params.outcome,
        learningSignals,
        startedAt: params.startedAt,
        completedAt: params.completedAt,
        environment: (params.environment as any) || 'production'
      });

      await log.save();

      // Log any critical anomalies
      const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
      if (criticalAnomalies.length > 0) {
        loggingService.warn('🚨 Critical agent anomalies detected', {
          agentSessionId: params.agentSessionId,
          anomalies: criticalAnomalies.map(a => a.anomalyType)
        });
      }

      loggingService.info('✅ Logged agent session', {
        agentSessionId: params.agentSessionId,
        actions: params.actions.length,
        cost: costBreakdown.totalCost.toFixed(4),
        anomalies: anomalies.length
      });

      return log;
    } catch (error) {
      loggingService.error('❌ Failed to log agent session', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Calculate performance metrics from actions
   */
  private static calculatePerformance(
    actions: AgentAction[],
    startedAt: Date,
    completedAt: Date,
    outcome: any
  ): AgentPerformance {
    const totalDurationMs = completedAt.getTime() - startedAt.getTime();
    
    const actionsSuccessful = actions.filter(a => a.success).length;
    const actionsFailed = actions.filter(a => !a.success).length;
    
    // Estimate retries (actions with same actionName within short time)
    let actionsRetried = 0;
    for (let i = 1; i < actions.length; i++) {
      if (actions[i].actionName === actions[i-1].actionName &&
          !actions[i-1].success &&
          actions[i].timestamp.getTime() - actions[i-1].timestamp.getTime() < 5000) {
        actionsRetried++;
      }
    }

    const totalTokens = actions.reduce((sum, a) => sum + (a.inputTokens || 0) + (a.outputTokens || 0), 0);
    const avgTokensPerAction = actions.length > 0 ? totalTokens / actions.length : 0;

    // Estimate time breakdown (simplified)
    const planningTimeMs = Math.min(totalDurationMs * 0.1, 5000);
    const validationTimeMs = Math.min(totalDurationMs * 0.05, 2000);
    const executionTimeMs = totalDurationMs - planningTimeMs - validationTimeMs;

    return {
      totalDurationMs,
      planningTimeMs,
      executionTimeMs,
      validationTimeMs,
      actionsAttempted: actions.length,
      actionsSuccessful,
      actionsRetried,
      actionsFailed,
      goalAchieved: outcome.status === 'success',
      goalAchievementScore: outcome.completeness || 0,
      totalTokens,
      avgTokensPerAction
    };
  }

  /**
   * Calculate cost breakdown from actions
   */
  private static calculateCostBreakdown(actions: AgentAction[]): AgentCostBreakdown {
    let modelCosts = 0;
    let toolCosts = 0;
    let apiCosts = 0;
    let dataRetrievalCosts = 0;

    let planningCost = 0;
    let executionCost = 0;
    let validationCost = 0;

    let retriedActionsCost = 0;
    let redundantCallsCost = 0;

    const actionCosts = new Map<string, number>();

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const cost = action.cost || 0;

      // Categorize by action type
      if (action.actionType === 'model_invocation') {
        modelCosts += cost;
      } else if (action.actionType === 'tool_call') {
        toolCosts += cost;
      } else if (action.actionType === 'external_api') {
        apiCosts += cost;
      } else if (action.actionType === 'data_retrieval') {
        dataRetrievalCosts += cost;
      }

      // Estimate phase costs (simplified)
      if (i < actions.length * 0.1) {
        planningCost += cost;
      } else if (i < actions.length * 0.95) {
        executionCost += cost;
      } else {
        validationCost += cost;
      }

      // Detect retries
      if (i > 0 && action.actionName === actions[i-1].actionName && !actions[i-1].success) {
        retriedActionsCost += cost;
      }

      // Detect redundant calls (same action within short time)
      const key = `${action.actionType}:${action.actionName}`;
      if (actionCosts.has(key)) {
        redundantCallsCost += cost * 0.5; // Estimate 50% of redundant call cost as waste
      }
      actionCosts.set(key, (actionCosts.get(key) || 0) + cost);
    }

    const totalCost = modelCosts + toolCosts + apiCosts + dataRetrievalCosts;
    const abandonedPathsCost = actions.filter(a => !a.success).reduce((sum, a) => sum + (a.cost || 0), 0);

    return {
      totalCost,
      modelCosts,
      toolCosts,
      apiCosts,
      dataRetrievalCosts,
      planningCost,
      executionCost,
      validationCost,
      retriedActionsCost,
      abandonedPathsCost,
      redundantCallsCost
    };
  }

  /**
   * Detect anomalies in agent behavior
   */
  private static detectAnomalies(
    actions: AgentAction[],
    performance: AgentPerformance,
    costBreakdown: AgentCostBreakdown
  ): AgentAnomaly[] {
    const anomalies: AgentAnomaly[] = [];
    const now = new Date();

    // 1. Detect infinite loops or repeated patterns
    const loopDetection = this.detectLoops(actions);
    if (loopDetection) {
      anomalies.push({
        anomalyType: 'infinite_loop',
        severity: 'critical',
        description: `Detected potential infinite loop: ${loopDetection.description}`,
        detectedAt: now,
        affectedActions: loopDetection.indices,
        costImpact: loopDetection.costImpact,
        timeImpact: loopDetection.timeImpact,
        suggestedFix: 'Review agent logic and add loop detection/breaking mechanisms',
        autoFixable: false
      });
    }

    // 2. Detect excessive retries
    if (performance.actionsRetried > this.ANOMALY_THRESHOLDS.excessiveRetries) {
      anomalies.push({
        anomalyType: 'excessive_retries',
        severity: performance.actionsRetried > 10 ? 'high' : 'medium',
        description: `Agent retried actions ${performance.actionsRetried} times`,
        detectedAt: now,
        affectedActions: [],
        costImpact: costBreakdown.retriedActionsCost,
        suggestedFix: 'Improve error handling and add exponential backoff',
        autoFixable: false
      });
    }

    // 3. Detect high cost
    if (costBreakdown.totalCost > this.ANOMALY_THRESHOLDS.highCost) {
      anomalies.push({
        anomalyType: 'high_cost',
        severity: costBreakdown.totalCost > 0.5 ? 'critical' : 'high',
        description: `Session cost ($${costBreakdown.totalCost.toFixed(4)}) exceeds threshold`,
        detectedAt: now,
        affectedActions: [],
        costImpact: costBreakdown.totalCost,
        suggestedFix: 'Review model choices and consider cheaper alternatives',
        autoFixable: false
      });
    }

    // 4. Detect low success rate
    const successRate = performance.actionsAttempted > 0
      ? performance.actionsSuccessful / performance.actionsAttempted
      : 0;
    
    if (successRate < this.ANOMALY_THRESHOLDS.lowSuccessRate && performance.actionsAttempted > 5) {
      anomalies.push({
        anomalyType: 'low_success_rate',
        severity: successRate < 0.3 ? 'high' : 'medium',
        description: `Low action success rate: ${(successRate * 100).toFixed(1)}%`,
        detectedAt: now,
        affectedActions: [],
        suggestedFix: 'Improve action validation and error recovery',
        autoFixable: false
      });
    }

    // 5. Detect redundant actions
    const redundantRatio = costBreakdown.redundantCallsCost / Math.max(0.001, costBreakdown.totalCost);
    if (redundantRatio > this.ANOMALY_THRESHOLDS.redundantActions) {
      anomalies.push({
        anomalyType: 'redundant_actions',
        severity: redundantRatio > 0.5 ? 'high' : 'medium',
        description: `${(redundantRatio * 100).toFixed(1)}% of actions appear redundant`,
        detectedAt: now,
        affectedActions: [],
        costImpact: costBreakdown.redundantCallsCost,
        suggestedFix: 'Implement result caching and deduplication',
        autoFixable: true
      });
    }

    // 6. Detect timeout
    if (performance.totalDurationMs > this.ANOMALY_THRESHOLDS.longDuration) {
      anomalies.push({
        anomalyType: 'timeout',
        severity: performance.totalDurationMs > 120000 ? 'high' : 'medium',
        description: `Session duration (${(performance.totalDurationMs / 1000).toFixed(1)}s) exceeds threshold`,
        detectedAt: now,
        affectedActions: [],
        timeImpact: performance.totalDurationMs,
        suggestedFix: 'Optimize action sequence and parallelize when possible',
        autoFixable: false
      });
    }

    return anomalies;
  }

  /**
   * Detect loop patterns in actions
   */
  private static detectLoops(actions: AgentAction[]): {
    description: string;
    indices: number[];
    costImpact: number;
    timeImpact: number;
  } | null {
    if (actions.length < 10) return null;

    // Look for repeated sequences
    for (let patternLen = 3; patternLen <= 5; patternLen++) {
      for (let i = 0; i <= actions.length - patternLen * 3; i++) {
        const pattern = actions.slice(i, i + patternLen).map(a => a.actionName).join('|');
        
        let repeatCount = 0;
        let j = i + patternLen;
        const indices = Array.from({ length: patternLen }, (_, k) => i + k);
        
        while (j <= actions.length - patternLen) {
          const nextPattern = actions.slice(j, j + patternLen).map(a => a.actionName).join('|');
          if (nextPattern === pattern) {
            repeatCount++;
            indices.push(...Array.from({ length: patternLen }, (_, k) => j + k));
            j += patternLen;
          } else {
            break;
          }
        }

        if (repeatCount >= 2) {
          const loopActions = actions.filter((_, idx) => indices.includes(idx));
          const costImpact = loopActions.reduce((sum, a) => sum + (a.cost || 0), 0);
          const timeImpact = loopActions.reduce((sum, a) => sum + a.latencyMs, 0);

          return {
            description: `Pattern "${pattern}" repeated ${repeatCount + 1} times`,
            indices,
            costImpact,
            timeImpact
          };
        }
      }
    }

    return null;
  }

  /**
   * Calculate learning signals from session data
   */
  private static calculateLearningSignals(
    performance: AgentPerformance,
    costBreakdown: AgentCostBreakdown,
    anomalies: AgentAnomaly[],
    outcome: any
  ): {
    efficiencyScore: number;
    costEfficiencyScore: number;
    qualityScore: number;
    reliabilityScore: number;
    improvementAreas: string[];
    estimatedSavingsPotential?: number;
  } {
    // Efficiency: fewer actions with higher success rate is better
    const successRate = performance.actionsAttempted > 0
      ? performance.actionsSuccessful / performance.actionsAttempted
      : 0;
    const retryPenalty = Math.max(0, 1 - (performance.actionsRetried / performance.actionsAttempted));
    const efficiencyScore = successRate * retryPenalty;

    // Cost efficiency: low cost relative to value delivered
    const valueDelivered = performance.goalAchieved ? 1.0 : (outcome.completeness || 0);
    const costEfficiencyScore = Math.max(0, Math.min(1, valueDelivered / Math.max(0.001, costBreakdown.totalCost * 10)));

    // Quality: goal achievement, completeness, accuracy
    const qualityScore = (
      (performance.goalAchieved ? 1 : 0) * 0.5 +
      (outcome.completeness || 0) * 0.3 +
      (outcome.accuracy || 0) * 0.2
    );

    // Reliability: consistent success without errors
    const reliabilityScore = successRate * (anomalies.length === 0 ? 1 : 0.7);

    // Identify improvement areas
    const improvementAreas: string[] = [];
    if (efficiencyScore < 0.7) improvementAreas.push('action_efficiency');
    if (costEfficiencyScore < 0.7) improvementAreas.push('cost_optimization');
    if (qualityScore < 0.7) improvementAreas.push('output_quality');
    if (reliabilityScore < 0.7) improvementAreas.push('error_handling');
    if (performance.actionsRetried > 3) improvementAreas.push('retry_logic');
    if (costBreakdown.redundantCallsCost > 0.01) improvementAreas.push('deduplication');

    // Estimate savings potential
    const estimatedSavingsPotential = 
      costBreakdown.retriedActionsCost +
      costBreakdown.abandonedPathsCost * 0.5 +
      costBreakdown.redundantCallsCost;

    return {
      efficiencyScore,
      costEfficiencyScore,
      qualityScore,
      reliabilityScore,
      improvementAreas,
      estimatedSavingsPotential
    };
  }

  /**
   * Get agent efficiency metrics over a period
   */
  static async getAgentEfficiencyMetrics(params: {
    agentId?: string;
    agentType?: string;
    userId?: string;
    startDate: Date;
    endDate: Date;
  }): Promise<AgentEfficiencyMetrics[]> {
    try {
      const query: any = {
        startedAt: { $gte: params.startDate, $lte: params.endDate }
      };

      if (params.agentId) query.agentId = params.agentId;
      if (params.agentType) query['configuration.agentType'] = params.agentType;
      if (params.userId) query.userId = new mongoose.Types.ObjectId(params.userId);

      const logs = await AgentDecisionLog.find(query).lean();

      // Group by agent
      const agentGroups = new Map<string, IAgentDecisionLog[]>();
      for (const log of logs) {
        const key = `${log.agentId}:${log.configuration.agentType}`;
        if (!agentGroups.has(key)) {
          agentGroups.set(key, []);
        }
        agentGroups.get(key)!.push(log as unknown as IAgentDecisionLog);
      }

      // Calculate metrics for each agent
      const metrics: AgentEfficiencyMetrics[] = [];
      for (const [key, agentLogs] of agentGroups) {
        const [agentId, agentType] = key.split(':');
        
        const totalDuration = agentLogs.reduce((sum, l) => sum + l.performance.totalDurationMs, 0);
        const totalActions = agentLogs.reduce((sum, l) => sum + l.performance.actionsAttempted, 0);
        const successfulActions = agentLogs.reduce((sum, l) => sum + l.performance.actionsSuccessful, 0);
        const totalCost = agentLogs.reduce((sum, l) => sum + l.costBreakdown.totalCost, 0);
        const goalsAchieved = agentLogs.filter(l => l.performance.goalAchieved).length;
        
        const sessionsWithFeedback = agentLogs.filter(l => l.userFeedback?.rating);
        const avgUserSatisfaction = sessionsWithFeedback.length > 0
          ? sessionsWithFeedback.reduce((sum, l) => sum + (l.userFeedback!.rating!), 0) / sessionsWithFeedback.length
          : 0;

        const avgEfficiency = agentLogs.reduce((sum, l) => sum + l.learningSignals.efficiencyScore, 0) / agentLogs.length;
        const avgCostEfficiency = agentLogs.reduce((sum, l) => sum + l.learningSignals.costEfficiencyScore, 0) / agentLogs.length;
        const avgQuality = agentLogs.reduce((sum, l) => sum + l.learningSignals.qualityScore, 0) / agentLogs.length;
        const avgReliability = agentLogs.reduce((sum, l) => sum + l.learningSignals.reliabilityScore, 0) / agentLogs.length;

        const estimatedSavings = agentLogs.reduce((sum, l) => 
          sum + (l.learningSignals.estimatedSavingsPotential || 0), 0
        );

        // Determine cost trend
        const recentLogs = agentLogs.slice(-Math.min(10, agentLogs.length));
        const olderLogs = agentLogs.slice(0, Math.min(10, agentLogs.length));
        const recentAvgCost = recentLogs.reduce((sum, l) => sum + l.costBreakdown.totalCost, 0) / recentLogs.length;
        const olderAvgCost = olderLogs.reduce((sum, l) => sum + l.costBreakdown.totalCost, 0) / olderLogs.length;
        
        let costTrend: 'increasing' | 'stable' | 'decreasing' = 'stable';
        if (Math.abs(recentAvgCost - olderAvgCost) > olderAvgCost * 0.1) {
          costTrend = recentAvgCost > olderAvgCost ? 'increasing' : 'decreasing';
        }

        // Collect improvement areas
        const improvementAreasMap = new Map<string, number>();
        for (const log of agentLogs) {
          for (const area of log.learningSignals.improvementAreas) {
            improvementAreasMap.set(area, (improvementAreasMap.get(area) || 0) + 1);
          }
        }
        const improvementAreas = Array.from(improvementAreasMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([area]) => area);

        metrics.push({
          agentId,
          agentType,
          avgDurationMs: totalDuration / agentLogs.length,
          avgActionsPerSession: totalActions / agentLogs.length,
          avgSuccessRate: totalActions > 0 ? successfulActions / totalActions : 0,
          avgCostPerSession: totalCost / agentLogs.length,
          totalCost,
          costTrend,
          avgGoalAchievement: goalsAchieved / agentLogs.length,
          avgUserSatisfaction,
          efficiencyScore: avgEfficiency,
          costEfficiencyScore: avgCostEfficiency,
          qualityScore: avgQuality,
          reliabilityScore: avgReliability,
          estimatedSavings,
          improvementAreas,
          sampleSize: agentLogs.length,
          periodStart: params.startDate,
          periodEnd: params.endDate
        });
      }

      return metrics.sort((a, b) => b.totalCost - a.totalCost);
    } catch (error) {
      loggingService.error('Failed to get agent efficiency metrics', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Detect patterns across multiple agent sessions
   */
  static async detectPatterns(params: {
    agentId?: string;
    userId?: string;
    startDate: Date;
    endDate: Date;
    minOccurrences?: number;
  }): Promise<DetectedPattern[]> {
    try {
      const query: any = {
        startedAt: { $gte: params.startDate, $lte: params.endDate },
        'anomalies.0': { $exists: true } // Only sessions with anomalies
      };

      if (params.agentId) query.agentId = params.agentId;
      if (params.userId) query.userId = new mongoose.Types.ObjectId(params.userId);

      const logs = await AgentDecisionLog.find(query).lean();
      const minOccurrences = params.minOccurrences || 3;

      // Group anomalies by type
      const anomalyGroups = new Map<string, {
        sessions: string[];
        totalCost: number;
        avgCost: number;
        severity: 'low' | 'medium' | 'high';
      }>();

      for (const log of logs) {
        for (const anomaly of log.anomalies) {
          const key = anomaly.anomalyType;
          if (!anomalyGroups.has(key)) {
            anomalyGroups.set(key, {
              sessions: [],
              totalCost: 0,
              avgCost: 0,
              severity: 'low'
            });
          }

          const group = anomalyGroups.get(key)!;
          group.sessions.push(log.agentSessionId);
          group.totalCost += anomaly.costImpact || 0;
          
          // Upgrade severity if needed
          if (anomaly.severity === 'high' && group.severity !== 'high') {
            group.severity = 'high';
          } else if (anomaly.severity === 'medium' && group.severity === 'low') {
            group.severity = 'medium';
          }
        }
      }

      // Convert to detected patterns
      const patterns: DetectedPattern[] = [];
      for (const [patternType, group] of anomalyGroups) {
        if (group.sessions.length < minOccurrences) continue;

        const avgCostImpact = group.totalCost / group.sessions.length;

        patterns.push({
          patternType: patternType as any,
          severity: group.severity,
          description: this.getPatternDescription(patternType, group.sessions.length),
          affectedSessions: group.sessions.slice(0, 10), // Limit to 10 examples
          frequency: group.sessions.length,
          avgCostImpact,
          recommendation: this.getPatternRecommendation(patternType, avgCostImpact)
        });
      }

      return patterns.sort((a, b) => b.avgCostImpact - a.avgCostImpact);
    } catch (error) {
      loggingService.error('Failed to detect patterns', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Get human-readable pattern description
   */
  private static getPatternDescription(patternType: string, frequency: number): string {
    const descriptions: Record<string, string> = {
      'infinite_loop': `Agent entered infinite loops in ${frequency} sessions`,
      'excessive_retries': `Agent retried actions excessively in ${frequency} sessions`,
      'high_cost': `Agent incurred high costs in ${frequency} sessions`,
      'low_success_rate': `Agent had low action success rates in ${frequency} sessions`,
      'redundant_actions': `Agent performed redundant actions in ${frequency} sessions`,
      'timeout': `Agent sessions timed out ${frequency} times`,
      'resource_waste': `Agent wasted resources in ${frequency} sessions`
    };

    return descriptions[patternType] || `Pattern "${patternType}" occurred ${frequency} times`;
  }

  /**
   * Get pattern-specific recommendation
   */
  private static getPatternRecommendation(patternType: string, avgCost: number): string {
    const recommendations: Record<string, string> = {
      'infinite_loop': 'Implement loop detection and max iteration limits',
      'excessive_retries': 'Add exponential backoff and improve error handling',
      'high_cost': `Review model selection (avg $${avgCost.toFixed(4)}/session) and consider cheaper alternatives`,
      'low_success_rate': 'Improve action validation and add better error recovery',
      'redundant_actions': 'Implement result caching and deduplication logic',
      'timeout': 'Optimize action sequences and add parallelization',
      'resource_waste': 'Review agent configuration and reduce unnecessary operations'
    };

    return recommendations[patternType] || 'Review agent behavior and optimize';
  }

  /**
   * Get top inefficient agents
   */
  static async getTopInefficientAgents(limit: number = 10): Promise<AgentEfficiencyMetrics[]> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const now = new Date();

      const metrics = await this.getAgentEfficiencyMetrics({
        startDate: thirtyDaysAgo,
        endDate: now
      });

      // Sort by combination of low efficiency and high cost
      return metrics
        .filter(m => m.sampleSize >= 5) // At least 5 sessions
        .sort((a, b) => {
          const aScore = a.efficiencyScore * 0.4 + a.costEfficiencyScore * 0.6;
          const bScore = b.efficiencyScore * 0.4 + b.costEfficiencyScore * 0.6;
          return aScore - bScore; // Lower score = more inefficient
        })
        .slice(0, limit);
    } catch (error) {
      loggingService.error('Failed to get top inefficient agents', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
}

