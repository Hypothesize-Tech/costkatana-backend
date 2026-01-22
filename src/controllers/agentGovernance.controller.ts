import { Request, Response } from 'express';
import { agentIdentityService } from '../services/agentIdentity.service';
import { agentGovernanceService } from '../services/agentGovernance.service';
import { agentDecisionAuditService } from '../services/agentDecisionAudit.service';
import { agentRateLimitService } from '../services/agentRateLimit.service';
import { AgentIdentity } from '../models/AgentIdentity';
import { AgentDecisionAudit } from '../models/AgentDecisionAudit';
import { AgentExecution } from '../models/AgentExecution';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

/**
 * Agent Governance Controller
 * Management APIs for agent governance system
 */
export class AgentGovernanceController {
  /**
   * Create new agent identity
   */
  static async createAgentIdentity(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('createAgentIdentity', req);

    try {

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

      ControllerHelper.logRequestSuccess('createAgentIdentity', req, startTime, {
        agentId: identity.agentId
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
      ControllerHelper.handleError('createAgentIdentity', error, req, res, startTime);
    }
  }

  /**
   * List agent identities
   */
  static async listAgentIdentities(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('listAgentIdentities', req, { query: req.query });

    try {

      const { workspaceId, organizationId, status, agentType } = req.query;

      const agents = await agentIdentityService.listAgents({
        userId,
        workspaceId: workspaceId as string,
        organizationId: organizationId as string,
        status: status as string,
        agentType: agentType as string
      });

      ControllerHelper.logRequestSuccess('listAgentIdentities', req, startTime, {
        count: agents.length
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
      ControllerHelper.handleError('listAgentIdentities', error, req, res, startTime);
    }
  }

  /**
   * Get agent identity details
   */
  static async getAgentIdentity(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { agentId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getAgentIdentity', req, { agentId });

    try {

      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      ControllerHelper.logRequestSuccess('getAgentIdentity', req, startTime, { agentId });

      res.json({
        success: true,
        data: {
          identity: agent
        }
      });
    } catch (error) {
      ControllerHelper.handleError('getAgentIdentity', error, req, res, startTime, { agentId });
    }
  }

  /**
   * Update agent identity
   */
  static async updateAgentIdentity(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { agentId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('updateAgentIdentity', req, { agentId });

    try {
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

      ControllerHelper.logRequestSuccess('updateAgentIdentity', req, startTime, { agentId });

      res.json({
        success: true,
        data: {
          identity: agent
        }
      });
    } catch (error) {
      ControllerHelper.handleError('updateAgentIdentity', error, req, res, startTime, { agentId });
    }
  }

  /**
   * Revoke agent (kill-switch)
   */
  static async revokeAgent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { agentId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('revokeAgent', req, { agentId });

    try {
      const { reason } = req.body;

      // Verify ownership
      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Revoke agent
      await agentIdentityService.revokeAgent(agentId, reason || 'Revoked by user');

      ControllerHelper.logRequestSuccess('revokeAgent', req, startTime, { agentId });

      res.json({
        success: true,
        message: 'Agent revoked successfully'
      });
    } catch (error) {
      ControllerHelper.handleError('revokeAgent', error, req, res, startTime, { agentId });
    }
  }

  /**
   * Emergency kill-switch
   */
  static async emergencyKillSwitch(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { agentId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('emergencyKillSwitch', req, { agentId });

    try {
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

      ControllerHelper.logRequestSuccess('emergencyKillSwitch', req, startTime, { agentId });

      res.json({
        success: true,
        message: 'Emergency kill-switch activated - agent revoked and all executions terminated'
      });
    } catch (error) {
      ControllerHelper.handleError('emergencyKillSwitch', error, req, res, startTime, { agentId });
    }
  }

  /**
   * Get agent decision history
   */
  static async getAgentDecisions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { agentId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getAgentDecisions', req, { agentId, query: req.query });

    try {
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

      ControllerHelper.logRequestSuccess('getAgentDecisions', req, startTime, {
        agentId,
        count: decisions.length
      });

      res.json({
        success: true,
        data: {
          decisions,
          count: decisions.length
        }
      });
    } catch (error) {
      ControllerHelper.handleError('getAgentDecisions', error, req, res, startTime, { agentId });
    }
  }

  /**
   * Get agent execution history
   */
  static async getAgentExecutions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { agentId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getAgentExecutions', req, { agentId, query: req.query });

    try {
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

      ControllerHelper.logRequestSuccess('getAgentExecutions', req, startTime, {
        agentId,
        count: executions.length
      });

      res.json({
        success: true,
        data: {
          executions,
          count: executions.length
        }
      });
    } catch (error) {
      ControllerHelper.handleError('getAgentExecutions', error, req, res, startTime, { agentId });
    }
  }

  /**
   * Get agent rate limit status
   */
  static async getAgentRateLimitStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { agentId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getAgentRateLimitStatus', req, { agentId });

    try {

      // Verify ownership
      const agent = await AgentIdentity.findOne({ agentId, userId });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const status = await agentRateLimitService.getRateLimitStatus(agentId);

      ControllerHelper.logRequestSuccess('getAgentRateLimitStatus', req, startTime, { agentId });

      res.json({
        success: true,
        data: {
          agentId,
          rateLimits: status
        }
      });
    } catch (error) {
      ControllerHelper.handleError('getAgentRateLimitStatus', error, req, res, startTime, { agentId });
    }
  }

  /**
   * Get agent analytics
   */
  static async getAgentAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { agentId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getAgentAnalytics', req, { agentId });

    try {

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

      ControllerHelper.logRequestSuccess('getAgentAnalytics', req, startTime, { agentId });

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
      ControllerHelper.handleError('getAgentAnalytics', error, req, res, startTime, { agentId });
    }
  }

  /**
   * Get governance status
   */
  static async getGovernanceStatus(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();

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
      ControllerHelper.handleError('getGovernanceStatus', error, _req, res, startTime);
    }
  }
}

