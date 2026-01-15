import { Request, Response } from 'express';
import { agentIdentityService } from '../services/agentIdentity.service';
import { agentGovernanceService } from '../services/agentGovernance.service';
import { agentDecisionAuditService } from '../services/agentDecisionAudit.service';
import { agentRateLimitService } from '../services/agentRateLimit.service';
import { AgentIdentity } from '../models/AgentIdentity';
import { AgentDecisionAudit } from '../models/AgentDecisionAudit';
import { AgentExecution } from '../models/AgentExecution';
import { loggingService } from '../services/logging.service';

/**
 * Agent Governance Controller
 * Management APIs for agent governance system
 */
export class AgentGovernanceController {
  /**
   * Create new agent identity
   */
  static async createAgentIdentity(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const {
        agentName,
        agentType,
        workspaceId,
        organizationId,
        allowedModels,
        allowedProviders,
        allowedActions,
        capabilities,
        budgetCapPerRequest,
        budgetCapPerDay,
        budgetCapPerMonth,
        sandboxRequired,
        sandboxConfig,
        description
      } = req.body;

      // Validation
      if (!agentName || !agentType) {
        res.status(400).json({ error: 'Agent name and type are required' });
        return;
      }

      const { identity, token } = await agentIdentityService.createAgentIdentity({
        agentName,
        agentType,
        userId,
        workspaceId,
        organizationId,
        allowedModels,
        allowedProviders,
        allowedActions,
        capabilities,
        budgetCapPerRequest,
        budgetCapPerDay,
        budgetCapPerMonth,
        sandboxRequired,
        sandboxConfig,
        description
      });

      loggingService.info('Agent identity created via API', {
        component: 'AgentGovernanceController',
        operation: 'createAgentIdentity',
        agentId: identity.agentId,
        userId
      });

      res.status(201).json({
        success: true,
        data: {
          identity: {
            id: identity._id,
            agentId: identity.agentId,
            agentName: identity.agentName,
            agentType: identity.agentType,
            tokenPrefix: identity.tokenPrefix,
            status: identity.status,
            sandboxRequired: identity.sandboxRequired,
            createdAt: identity.createdAt
          },
          token: token, // Only returned once at creation
          message: 'Store this token securely - it cannot be retrieved again'
        }
      });
    } catch (error) {
      loggingService.error('Failed to create agent identity', {
        component: 'AgentGovernanceController',
        operation: 'createAgentIdentity',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to create agent identity' });
    }
  }

  /**
   * List agent identities
   */
  static async listAgentIdentities(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { workspaceId, organizationId, status, agentType } = req.query;

      const agents = await agentIdentityService.listAgents({
        userId,
        workspaceId: workspaceId as string,
        organizationId: organizationId as string,
        status: status as string,
        agentType: agentType as string
      });

      res.json({
        success: true,
        data: {
          agents: agents.map(agent => ({
            id: agent._id,
            agentId: agent.agentId,
            agentName: agent.agentName,
            agentType: agent.agentType,
            tokenPrefix: agent.tokenPrefix,
            status: agent.status,
            sandboxRequired: agent.sandboxRequired,
            totalRequests: agent.totalRequests,
            totalCost: agent.totalCost,
            lastUsedAt: agent.lastUsedAt,
            createdAt: agent.createdAt
          })),
          count: agents.length
        }
      });
    } catch (error) {
      loggingService.error('Failed to list agent identities', {
        component: 'AgentGovernanceController',
        operation: 'listAgentIdentities',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to list agent identities' });
    }
  }

  /**
   * Get agent identity details
   */
  static async getAgentIdentity(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { agentId } = req.params;

      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      res.json({
        success: true,
        data: {
          identity: agent
        }
      });
    } catch (error) {
      loggingService.error('Failed to get agent identity', {
        component: 'AgentGovernanceController',
        operation: 'getAgentIdentity',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to get agent identity' });
    }
  }

  /**
   * Update agent identity
   */
  static async updateAgentIdentity(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { agentId } = req.params;
      const updates = req.body;

      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Update allowed fields
      const allowedFields = [
        'agentName',
        'allowedModels',
        'allowedProviders',
        'allowedActions',
        'capabilities',
        'budgetCapPerRequest',
        'budgetCapPerDay',
        'budgetCapPerMonth',
        'maxRequestsPerMinute',
        'maxRequestsPerHour',
        'maxConcurrentExecutions',
        'sandboxRequired',
        'sandboxConfig',
        'description',
        'tags'
      ];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          (agent as any)[field] = updates[field];
        }
      }

      await agent.save();

      loggingService.info('Agent identity updated', {
        component: 'AgentGovernanceController',
        operation: 'updateAgentIdentity',
        agentId,
        userId
      });

      res.json({
        success: true,
        data: {
          identity: agent
        }
      });
    } catch (error) {
      loggingService.error('Failed to update agent identity', {
        component: 'AgentGovernanceController',
        operation: 'updateAgentIdentity',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to update agent identity' });
    }
  }

  /**
   * Revoke agent (kill-switch)
   */
  static async revokeAgent(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { agentId } = req.params;
      const { reason } = req.body;

      // Verify ownership
      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Revoke agent
      await agentIdentityService.revokeAgent(agentId, reason || 'Revoked by user');

      loggingService.warn('Agent revoked via API', {
        component: 'AgentGovernanceController',
        operation: 'revokeAgent',
        agentId,
        userId,
        reason
      });

      res.json({
        success: true,
        message: 'Agent revoked successfully'
      });
    } catch (error) {
      loggingService.error('Failed to revoke agent', {
        component: 'AgentGovernanceController',
        operation: 'revokeAgent',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to revoke agent' });
    }
  }

  /**
   * Emergency kill-switch
   */
  static async emergencyKillSwitch(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { agentId } = req.params;
      const { reason } = req.body;

      // Verify ownership
      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Emergency kill-switch
      await agentGovernanceService.emergencyKillSwitch(
        agentId,
        reason || 'Emergency kill-switch activated',
        userId
      );

      loggingService.warn('Emergency kill-switch activated via API', {
        component: 'AgentGovernanceController',
        operation: 'emergencyKillSwitch',
        agentId,
        userId,
        reason
      });

      res.json({
        success: true,
        message: 'Emergency kill-switch activated - agent revoked and all executions terminated'
      });
    } catch (error) {
      loggingService.error('Failed to activate emergency kill-switch', {
        component: 'AgentGovernanceController',
        operation: 'emergencyKillSwitch',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to activate emergency kill-switch' });
    }
  }

  /**
   * Get agent decision history
   */
  static async getAgentDecisions(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { agentId } = req.params;
      const { limit, startDate, endDate, decisionType, riskLevel } = req.query;

      // Verify ownership
      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Use AgentDecisionAudit model directly for advanced queries
      const query: any = {
        agentId,
        agentIdentityId: agent._id
      };

      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate as string);
        if (endDate) query.timestamp.$lte = new Date(endDate as string);
      }

      if (decisionType) {
        query.decisionType = decisionType;
      }

      if (riskLevel) {
        query.riskLevel = riskLevel;
      }

      const decisions = await AgentDecisionAudit.find(query)
        .sort({ timestamp: -1 })
        .limit(limit ? parseInt(limit as string) : 100)
        .populate('agentIdentityId', 'agentId agentName agentType')
        .populate('userId', 'name email')
        .lean();

      res.json({
        success: true,
        data: {
          decisions,
          count: decisions.length
        }
      });
    } catch (error) {
      loggingService.error('Failed to get agent decisions', {
        component: 'AgentGovernanceController',
        operation: 'getAgentDecisions',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to get agent decisions' });
    }
  }

  /**
   * Get agent execution history
   */
  static async getAgentExecutions(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { agentId } = req.params;
      const { limit, status } = req.query;

      // Verify ownership
      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const query: any = { agentId };
      if (status) {
        query.status = status;
      }

      const executions = await AgentExecution.find(query)
        .sort({ queuedAt: -1 })
        .limit(limit ? parseInt(limit as string) : 50);

      res.json({
        success: true,
        data: {
          executions,
          count: executions.length
        }
      });
    } catch (error) {
      loggingService.error('Failed to get agent executions', {
        component: 'AgentGovernanceController',
        operation: 'getAgentExecutions',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to get agent executions' });
    }
  }

  /**
   * Get agent rate limit status
   */
  static async getAgentRateLimitStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { agentId } = req.params;

      // Verify ownership
      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const status = await agentRateLimitService.getRateLimitStatus(agentId);

      res.json({
        success: true,
        data: {
          agentId,
          rateLimits: status
        }
      });
    } catch (error) {
      loggingService.error('Failed to get agent rate limit status', {
        component: 'AgentGovernanceController',
        operation: 'getAgentRateLimitStatus',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to get agent rate limit status' });
    }
  }

  /**
   * Get agent analytics
   */
  static async getAgentAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { agentId } = req.params;

      // Verify ownership
      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Get decision patterns using service
      const decisionPatterns = await agentDecisionAuditService.analyzeDecisionPatterns(agentId);

      // Get detailed decision statistics using AgentDecisionAudit model
      const decisionStats = await AgentDecisionAudit.aggregate([
        { $match: { agentId, agentIdentityId: agent._id } },
        {
          $group: {
            _id: '$decisionType',
            count: { $sum: 1 },
            avgConfidence: { $avg: '$confidenceScore' },
            highRiskCount: {
              $sum: { $cond: [{ $in: ['$riskLevel', ['high', 'critical']] }, 1, 0] }
            }
          }
        }
      ]);

      const riskLevelStats = await AgentDecisionAudit.aggregate([
        { $match: { agentId, agentIdentityId: agent._id } },
        {
          $group: {
            _id: '$riskLevel',
            count: { $sum: 1 }
          }
        }
      ]);

      // Get execution stats
      const executions = await AgentExecution.find({ agentId });
      const executionStats = {
        total: executions.length,
        completed: executions.filter(e => e.status === 'completed').length,
        failed: executions.filter(e => e.status === 'failed').length,
        killed: executions.filter(e => e.status === 'killed').length,
        timeout: executions.filter(e => e.status === 'timeout').length,
        averageExecutionTime: executions.reduce((sum, e) => sum + (e.executionTimeMs || 0), 0) / executions.length || 0,
        totalCost: executions.reduce((sum, e) => sum + (e.actualCost || 0), 0)
      };

      // Get recent high-risk decisions
      const recentHighRiskDecisions = await AgentDecisionAudit.find({
        agentId,
        agentIdentityId: agent._id,
        riskLevel: { $in: ['high', 'critical'] }
      })
        .sort({ timestamp: -1 })
        .limit(5)
        .select('decisionId decisionType decision reasoning riskLevel timestamp')
        .lean();

      res.json({
        success: true,
        data: {
          agent: {
            id: agent._id,
            agentId: agent.agentId,
            agentName: agent.agentName,
            status: agent.status,
            totalRequests: agent.totalRequests,
            totalCost: agent.totalCost,
            totalTokens: agent.totalTokens,
            failureCount: agent.failureCount,
            lastUsedAt: agent.lastUsedAt
          },
          decisionPatterns,
          decisionStats,
          riskLevelStats,
          executionStats,
          recentHighRiskDecisions
        }
      });
    } catch (error) {
      loggingService.error('Failed to get agent analytics', {
        component: 'AgentGovernanceController',
        operation: 'getAgentAnalytics',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to get agent analytics' });
    }
  }

  /**
   * Get governance status
   */
  static async getGovernanceStatus(_req: Request, res: Response): Promise<void> {
    try {

      // Get basic governance status
      const status = agentGovernanceService.getGovernanceStatus();

      // Get aggregate statistics using AgentDecisionAudit
      const totalDecisions = await AgentDecisionAudit.countDocuments();
      const highRiskDecisions = await AgentDecisionAudit.countDocuments({
        riskLevel: { $in: ['high', 'critical'] }
      });
      const pendingReviews = await AgentDecisionAudit.countDocuments({
        requiresApproval: true,
        'humanReview.reviewStatus': 'pending'
      });

      // Get active agents count
      const activeAgents = await AgentIdentity.countDocuments({ status: 'active' });
      const totalAgents = await AgentIdentity.countDocuments();

      // Get recent decision activity
      const recentDecisions = await AgentDecisionAudit.find()
        .sort({ timestamp: -1 })
        .limit(10)
        .select('decisionId agentId decisionType riskLevel timestamp')
        .lean();

      res.json({
        success: true,
        data: {
          ...status,
          statistics: {
            totalAgents,
            activeAgents,
            totalDecisions,
            highRiskDecisions,
            pendingReviews
          },
          recentActivity: recentDecisions
        }
      });
    } catch (error) {
      loggingService.error('Failed to get governance status', {
        component: 'AgentGovernanceController',
        operation: 'getGovernanceStatus',
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ error: 'Failed to get governance status' });
    }
  }
}

