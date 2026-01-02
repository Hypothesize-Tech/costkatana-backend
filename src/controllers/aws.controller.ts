import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AWSConnection } from '../models/AWSConnection';
import { externalIdService } from '../services/aws/externalId.service';
import { tenantIsolationService } from '../services/aws/tenantIsolation.service';
import { killSwitchService } from '../services/aws/killSwitch.service';
import { stsCredentialService } from '../services/aws/stsCredential.service';
import { permissionBoundaryService } from '../services/aws/permissionBoundary.service';
import { intentParserService } from '../services/aws/intentParser.service';
import { planGeneratorService } from '../services/aws/planGenerator.service';
import { executionEngineService } from '../services/aws/executionEngine.service';
import { simulationEngineService } from '../services/aws/simulationEngine.service';
import { costAnomalyGuardService } from '../services/aws/costAnomalyGuard.service';
import { auditLoggerService } from '../services/aws/auditLogger.service';
import { auditAnchorService } from '../services/aws/auditAnchor.service';
import { loggingService } from '../services/logging.service';

export class AWSController {
  // ============================================================================
  // Connection Management
  // ============================================================================

  static async createConnection(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      const { connectionName, description, environment, roleArn, permissionMode, allowedRegions } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!connectionName || !roleArn) {
        return res.status(400).json({ error: 'connectionName and roleArn are required' });
      }

      // Create tenant context for isolation
      tenantContext = tenantIsolationService.createTenantContext(
        userId,
        workspaceId,
        undefined,
        undefined // AWS account ID will be extracted from roleArn
      );

      loggingService.info('Tenant context created for connection creation', {
        component: 'AWSController',
        operation: 'createConnection',
        tenantId: tenantContext.tenantId,
        sessionId: tenantContext.sessionId,
      });

      // Generate unique external ID
      const externalIdResult = await externalIdService.generateUniqueExternalId(userId, environment || 'development');

      // Create connection
      const connection = new AWSConnection({
        userId: new Types.ObjectId(userId),
        connectionName,
        description,
        environment: environment || 'development',
        roleArn,
        externalId: externalIdResult.externalIdEncrypted,
        externalIdHash: externalIdResult.externalIdHash,
        permissionMode: permissionMode || 'read-only',
        allowedRegions: allowedRegions || ['us-east-1'],
        createdBy: new Types.ObjectId(userId),
      });

      await connection.save();

      // Log audit event
      await auditLoggerService.logSuccess('connection_created', {
        userId: new Types.ObjectId(userId),
        connectionId: connection._id,
      }, {
        service: 'aws',
        operation: 'createConnection',
      });

      return res.status(201).json({
        success: true,
        connection: {
          id: connection._id,
          connectionName: connection.connectionName,
          environment: connection.environment,
          roleArn: connection.roleArn,
          externalId: externalIdResult.externalId, // Return plain for initial setup
          permissionMode: connection.permissionMode,
          status: connection.status,
          createdAt: connection.createdAt,
        },
      });
    } catch (error) {
      loggingService.error('Failed to create AWS connection', {
        component: 'AWSController',
        operation: 'createConnection',
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: 'Failed to create connection' });
    } finally {
      // Clear tenant context
      tenantIsolationService.clearTenantContext();
    }
  }

  static async listConnections(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Create tenant context for isolation
      tenantContext = tenantIsolationService.createTenantContext(userId, workspaceId);

      loggingService.info('Tenant context created for listing connections', {
        component: 'AWSController',
        operation: 'listConnections',
        tenantId: tenantContext.tenantId,
      });

      const connections = await AWSConnection.find({ userId: new Types.ObjectId(userId) })
        .select('-externalId')
        .sort({ createdAt: -1 });

      return res.json({
        success: true,
        connections: connections.map(c => ({
          id: c._id,
          connectionName: c.connectionName,
          description: c.description,
          environment: c.environment,
          roleArn: c.roleArn,
          permissionMode: c.permissionMode,
          executionMode: c.executionMode,
          status: c.status,
          health: c.health,
          lastUsed: c.lastUsed,
          totalExecutions: c.totalExecutions,
          createdAt: c.createdAt,
        })),
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to list connections' });
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  static async deleteConnection(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Create tenant context
      tenantContext = tenantIsolationService.createTenantContext(userId, workspaceId);

      loggingService.info('Tenant context created for connection deletion', {
        component: 'AWSController',
        operation: 'deleteConnection',
        tenantId: tenantContext.tenantId,
      });

      // Find connection first to validate tenant scope
      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      // Validate tenant scope
      const isAuthorized = await tenantIsolationService.validateTenantScope(
        new Types.ObjectId(userId),
        connection.userId
      );

      if (!isAuthorized) {
        await auditLoggerService.logBlocked('connection_deleted', {
          userId: new Types.ObjectId(userId),
          connectionId: connection._id,
        }, 'Tenant scope validation failed');
        return res.status(403).json({ error: 'Unauthorized access to connection' });
      }

      // Delete connection
      await AWSConnection.findByIdAndDelete(connection._id);

      await auditLoggerService.logSuccess('connection_deleted', {
        userId: new Types.ObjectId(userId),
        connectionId: connection._id,
      });

      return res.json({ success: true, message: 'Connection deleted' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete connection' });
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  static async testConnection(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Create tenant context
      tenantContext = tenantIsolationService.createTenantContext(userId, workspaceId);

      loggingService.info('Tenant context created for plan generation', {
        component: 'AWSController',
        operation: 'generatePlan',
        tenantId: tenantContext.tenantId,
      });

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      // Validate tenant scope
      const isAuthorized = await tenantIsolationService.validateTenantScope(
        new Types.ObjectId(userId),
        connection.userId
      );

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Unauthorized access to connection' });
      }

      const startTime = Date.now();
      try {
        await stsCredentialService.assumeRole(connection);
        const latency = Date.now() - startTime;
        
        return res.json({
          success: true,
          status: 'healthy',
          latencyMs: latency,
        });
      } catch (error) {
        return res.json({
          success: false,
          status: 'error',
          error: error instanceof Error ? error.message : 'Connection test failed',
        });
      }
    } catch (error) {
      return res.status(500).json({ error: 'Failed to test connection' });
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  // ============================================================================
  // Intent & Plan
  // ============================================================================

  static async parseIntent(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      const { request, connectionId } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!request) {
        return res.status(400).json({ error: 'request is required' });
      }

      // Create tenant context for isolation
      tenantContext = tenantIsolationService.createTenantContext(userId, workspaceId);

      // Generate isolated prompt with tenant validation
      const isolatedPrompt = await tenantIsolationService.generateIsolatedPrompt(
        tenantContext.tenantId,
        request
      );

      // Validate isolation before processing
      const isolationValidation = tenantIsolationService.validateIsolation(isolatedPrompt);
      if (!isolationValidation.valid) {
        await auditLoggerService.logBlocked('intent_parsed', {
          userId: new Types.ObjectId(userId),
          connectionId: connectionId ? new Types.ObjectId(connectionId) : undefined,
        }, `Isolation validation failed: ${isolationValidation.violations.join(', ')}`, undefined, {
          intent: request,
          blockedReason: `Isolation validation failed: ${isolationValidation.violations.join(', ')}`,
        });

        return res.status(403).json({
          error: 'Intent contains potential cross-tenant data',
          violations: isolationValidation.violations,
          riskLevel: isolationValidation.riskLevel,
        });
      }

      // Parse intent using isolated prompt
      const intent = await intentParserService.parseIntent(isolatedPrompt.prompt);

      await auditLoggerService.log({
        eventType: 'intent_parsed',
        context: { userId: new Types.ObjectId(userId), connectionId: connectionId ? new Types.ObjectId(connectionId) : undefined },
        action: { operation: 'parseIntent' },
        result: intent.blocked ? 'blocked' : 'success',
        decisionTrace: {
          intent: request,
          interpretation: intent.interpretedAction,
          blockedReason: intent.blockReason,
        },
      });

      return res.json({ success: true, intent });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to parse intent' });
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  static async generatePlan(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      const { intent, connectionId, resources } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!intent || !connectionId) {
        return res.status(400).json({ error: 'intent and connectionId are required' });
      }

      // Create tenant context
      tenantContext = tenantIsolationService.createTenantContext(userId, workspaceId);

      loggingService.info('Tenant context created for plan generation', {
        component: 'AWSController',
        operation: 'generatePlan',
        tenantId: tenantContext.tenantId,
      });

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      // Validate tenant scope
      const isAuthorized = await tenantIsolationService.validateTenantScope(
        new Types.ObjectId(userId),
        connection.userId
      );

      if (!isAuthorized) {
        await auditLoggerService.logBlocked('plan_generated', {
          userId: new Types.ObjectId(userId),
          connectionId: connection._id,
        }, 'Tenant scope validation failed');
        return res.status(403).json({ error: 'Unauthorized access to connection' });
      }

      const plan = await planGeneratorService.generatePlan(intent, connection, resources);

      await auditLoggerService.logSuccess('plan_generated', {
        userId: new Types.ObjectId(userId),
        connectionId: connection._id,
      }, {
        planId: plan.planId,
        dslHash: plan.dslHash,
      });

      return res.json({ success: true, plan });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate plan' });
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  // ============================================================================
  // Execution
  // ============================================================================

  static async approvePlan(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user?.id;
      const { planId, connectionId } = req.body;

      if (!planId || !connectionId) {
        return res.status(400).json({ error: 'planId and connectionId are required' });
      }

      const { token, expiresAt } = executionEngineService.generateApprovalToken(
        planId,
        userId,
        connectionId
      );

      await auditLoggerService.logSuccess('plan_approved', {
        userId: new Types.ObjectId(userId),
        connectionId: new Types.ObjectId(connectionId),
      }, { planId });

      return res.json({
        success: true,
        approvalToken: token,
        expiresAt,
        message: 'Plan approved. Use the approval token to execute within 15 minutes.',
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to approve plan' });
    }
  }

  static async executePlan(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      const { plan, connectionId, approvalToken } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!plan || !connectionId || !approvalToken) {
        return res.status(400).json({ error: 'plan, connectionId, and approvalToken are required' });
      }

      // Create tenant context
      tenantContext = tenantIsolationService.createTenantContext(userId, workspaceId);

      loggingService.info('Tenant context created for plan generation', {
        component: 'AWSController',
        operation: 'generatePlan',
        tenantId: tenantContext.tenantId,
      });

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      // Validate tenant scope
      const isAuthorized = await tenantIsolationService.validateTenantScope(
        new Types.ObjectId(userId),
        connection.userId
      );

      if (!isAuthorized) {
        await auditLoggerService.logBlocked('execution_started', {
          userId: new Types.ObjectId(userId),
          connectionId: connection._id,
        }, 'Tenant scope validation failed', { planId: plan.planId });
        return res.status(403).json({ error: 'Unauthorized access to connection' });
      }

      // Validate cost impact
      const costValidation = await costAnomalyGuardService.validateCostImpact(
        {
          planId: plan.planId,
          estimatedCostImpact: plan.summary?.estimatedCostImpact || 0,
          resourceCount: plan.summary?.resourcesAffected || 0,
          service: plan.steps?.[0]?.service || 'unknown',
          action: plan.steps?.[0]?.action || 'unknown',
          regions: connection.allowedRegions,
        },
        userId
      );

      if (!costValidation.allowed) {
        await auditLoggerService.logBlocked('execution_started', {
          userId: new Types.ObjectId(userId),
          connectionId: connection._id,
        }, costValidation.reason || 'Cost validation failed', { planId: plan.planId });

        return res.status(403).json({ error: costValidation.reason, recommendation: costValidation.recommendation });
      }

      const result = await executionEngineService.execute(plan, {
        userId: new Types.ObjectId(userId),
        connectionId: connection._id,
        planId: plan.planId,
        approvalToken,
        approvedAt: new Date(),
      });

      const eventType = result.status === 'completed' ? 'execution_completed' : 
                       result.status === 'rolled_back' ? 'rollback_executed' : 'execution_failed';

      await auditLoggerService.log({
        eventType,
        context: { userId: new Types.ObjectId(userId), connectionId: connection._id },
        action: { planId: plan.planId },
        result: result.status === 'completed' ? 'success' : 'failure',
        error: result.error,
        impact: { resourceCount: plan.summary?.resourcesAffected, costChange: plan.summary?.estimatedCostImpact },
      });

      return res.json({ success: true, result });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Execution failed' });
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  static async simulatePlan(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      const { plan, connectionId } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Create tenant context
      tenantContext = tenantIsolationService.createTenantContext(userId, workspaceId);

      loggingService.info('Tenant context created for plan generation', {
        component: 'AWSController',
        operation: 'generatePlan',
        tenantId: tenantContext.tenantId,
      });

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      // Validate tenant scope
      const isAuthorized = await tenantIsolationService.validateTenantScope(
        new Types.ObjectId(userId),
        connection.userId
      );

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Unauthorized access to connection' });
      }

      const result = await simulationEngineService.simulate(plan, connection);

      await auditLoggerService.logSuccess('simulation_executed', {
        userId: new Types.ObjectId(userId),
        connectionId: connection._id,
      }, { planId: plan.planId });

      return res.json({ success: true, simulation: result });
    } catch (error) {
      return res.status(500).json({ error: 'Simulation failed' });
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  // ============================================================================
  // Kill Switch (Admin Only)
  // ============================================================================

  static async activateKillSwitch(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const { scope, id, reason } = req.body;

      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      await killSwitchService.activateKillSwitch({
        scope,
        id,
        reason: reason || 'manual_activation',
        activatedBy: userId,
      });

      await auditLoggerService.logSuccess('kill_switch_activated', {
        userId: new Types.ObjectId(userId),
      }, { operation: 'activateKillSwitch' }, undefined, { scope, id, reason });

      return res.json({ success: true, message: 'Kill switch activated' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to activate kill switch' });
    }
  }

  static getKillSwitchState(req: Request, res: Response): Response {
    try {
      const state = killSwitchService.getState();
      return res.json({ success: true, state });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to get kill switch state' });
    }
  }

  // ============================================================================
  // Audit
  // ============================================================================

  static async getAuditLogs(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user?.id;
      const { connectionId, eventType, startDate, endDate, limit, offset } = req.query;

      const result = await auditLoggerService.query({
        userId: new Types.ObjectId(userId),
        connectionId: connectionId ? new Types.ObjectId(connectionId as string) : undefined,
        eventType: eventType as any,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: limit ? parseInt(limit as string) : 100,
        offset: offset ? parseInt(offset as string) : 0,
      });

      return res.json({ success: true, ...result });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to get audit logs' });
    }
  }

  static getAuditAnchor(req: Request, res: Response): Response {
    try {
      const anchorData = auditAnchorService.getPublicAnchorData();
      return res.json({ success: true, ...anchorData });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to get audit anchor' });
    }
  }

  static async verifyAuditChain(req: Request, res: Response): Promise<Response> {
    try {
      const { startPosition, endPosition } = req.query;
      
      const result = await auditLoggerService.verifyChain(
        startPosition ? parseInt(startPosition as string) : undefined,
        endPosition ? parseInt(endPosition as string) : undefined
      );

      return res.json({ success: true, verification: result });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to verify audit chain' });
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  static getAllowedActions(req: Request, res: Response): Response {
    try {
      const actions = intentParserService.getAvailableActions();
      return res.json({ success: true, actions });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to get allowed actions' });
    }
  }

  static getPermissionBoundaries(req: Request, res: Response): Response {
    try {
      return res.json({
        success: true,
        hardLimits: permissionBoundaryService.getHardLimits(),
        bannedActions: permissionBoundaryService.getBannedActions(),
        allowedServices: permissionBoundaryService.getAllowedServices(),
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to get permission boundaries' });
    }
  }

  static async getEmergencyStopInstructions(req: Request, res: Response): Promise<Response> {
    let tenantContext;
    try {
      const userId = (req as any).user?.id;
      const workspaceId = (req as any).user?.workspaceId || (req as any).workspaceId;
      const { connectionId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Create tenant context
      tenantContext = tenantIsolationService.createTenantContext(userId, workspaceId);

      loggingService.info('Tenant context created for plan generation', {
        component: 'AWSController',
        operation: 'generatePlan',
        tenantId: tenantContext.tenantId,
      });

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      // Validate tenant scope
      const isAuthorized = await tenantIsolationService.validateTenantScope(
        new Types.ObjectId(userId),
        connection.userId
      );

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Unauthorized access to connection' });
      }

      // Verify external ID encryption is valid (defense in depth)
      // Test decryption to ensure encryption format is valid
      try {
        connection.getDecryptedExternalId();
        // If decryption succeeds, encryption is valid
        loggingService.info('External ID encryption verified', {
          component: 'AWSController',
          operation: 'getEmergencyStopInstructions',
          connectionId: connection._id.toString(),
        });
      } catch (error) {
        loggingService.warn('External ID decryption failed - encryption may be invalid', {
          component: 'AWSController',
          operation: 'getEmergencyStopInstructions',
          connectionId: connection._id.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const instructions = stsCredentialService.getEmergencyStopInstructions(connection.roleArn);
      return res.json({ success: true, instructions });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to get emergency stop instructions' });
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }
}
