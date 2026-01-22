import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AWSConnection } from '../models/AWSConnection';
import { externalIdService } from '../services/aws/externalId.service';
import { tenantIsolationService } from '../services/aws/tenantIsolation.service';
import { killSwitchService } from '../services/aws/killSwitch.service';
import { stsCredentialService } from '../services/aws/stsCredential.service';
import { permissionBoundaryService } from '../services/aws/permissionBoundary.service';
import { permissionValidatorService } from '../services/aws/permissionValidator.service';
import { intentParserService } from '../services/aws/intentParser.service';
import { planGeneratorService } from '../services/aws/planGenerator.service';
import { executionEngineService } from '../services/aws/executionEngine.service';
import { simulationEngineService } from '../services/aws/simulationEngine.service';
import { costAnomalyGuardService } from '../services/aws/costAnomalyGuard.service';
import { auditLoggerService } from '../services/aws/auditLogger.service';
import { auditAnchorService } from '../services/aws/auditAnchor.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';
// AWS Service Providers
import { ec2ServiceProvider } from '../services/aws/providers/ec2.service';
import { s3ServiceProvider } from '../services/aws/providers/s3.service';
import { rdsServiceProvider } from '../services/aws/providers/rds.service';
import { lambdaServiceProvider } from '../services/aws/providers/lambda.service';
import { costExplorerServiceProvider } from '../services/aws/providers/costExplorer.service';

export class AWSController {
  // ============================================================================
  // Connection Management
  // ============================================================================

  static async createConnection(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('createConnection', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;
      const { 
        connectionName, 
        description, 
        environment, 
        roleArn, 
        permissionMode, 
        allowedRegions, 
        externalId: providedExternalId,
        selectedPermissions // New: granular permissions from frontend
      } = req.body;

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

      // Use provided external ID or generate a new one
      let externalIdResult;
      if (providedExternalId) {
        // User provided their own external ID (from CloudFormation template)
        externalIdResult = await externalIdService.encryptExternalId(providedExternalId, userId);
      } else {
        // Generate unique external ID
        externalIdResult = await externalIdService.generateUniqueExternalId(userId, environment || 'development');
      }

      // Extract AWS account ID from Role ARN
      // Format: arn:aws:iam::123456789012:role/RoleName
      const arnParts = roleArn.split(':');
      const awsAccountId = arnParts[4]; // Account ID is at index 4

      if (!awsAccountId || !/^\d{12}$/.test(awsAccountId)) {
        return res.status(400).json({ error: 'Invalid Role ARN format. Expected: arn:aws:iam::{ACCOUNT_ID}:role/{ROLE_NAME}' });
      }

      // Process granular permissions into allowedServices format
      const allowedServices: Array<{ service: string; actions: string[]; regions: string[] }> = [];
      
      if (selectedPermissions && typeof selectedPermissions === 'object') {
        // selectedPermissions format: { 'ec2': ['ec2:Describe*', 'ec2:StartInstances'], 's3': ['s3:List*'] }
        Object.entries(selectedPermissions).forEach(([serviceId, permissions]) => {
          if (Array.isArray(permissions) && permissions.length > 0) {
            allowedServices.push({
              service: serviceId,
              actions: permissions as string[],
              regions: allowedRegions || ['*'], // Use specified regions or all
            });
          }
        });

        loggingService.info('Processed granular permissions', {
          component: 'AWSController',
          operation: 'createConnection',
          userId,
          servicesCount: allowedServices.length,
          totalPermissions: allowedServices.reduce((sum, s) => sum + s.actions.length, 0),
        });
      }

      // Check if connection already exists for this AWS account and environment
      const existingConnection = await AWSConnection.findOne({
        awsAccountId,
        environment: environment || 'development',
        userId: new Types.ObjectId(userId),
      });

      let connection;
      let isUpdate = false;

      if (existingConnection) {
        // Update existing connection
        isUpdate = true;
        existingConnection.connectionName = connectionName;
        existingConnection.description = description;
        existingConnection.roleArn = roleArn;
        existingConnection.externalId = externalIdResult.externalIdEncrypted;
        existingConnection.externalIdHash = externalIdResult.externalIdHash;
        existingConnection.permissionMode = permissionMode || 'read-only';
        existingConnection.allowedRegions = allowedRegions || ['us-east-1'];
        existingConnection.allowedServices = allowedServices; // Update granular permissions
        existingConnection.lastModifiedBy = new Types.ObjectId(userId);
        existingConnection.status = 'pending_verification'; // Reset status for re-verification
        await existingConnection.save();
        connection = existingConnection;
      } else {
        // Create new connection
        connection = new AWSConnection({
          userId: new Types.ObjectId(userId),
          connectionName,
          description,
          environment: environment || 'development',
          roleArn,
          awsAccountId, // Extract from roleArn
          externalId: externalIdResult.externalIdEncrypted,
          externalIdHash: externalIdResult.externalIdHash,
          permissionMode: permissionMode || 'read-only',
          allowedRegions: allowedRegions || ['us-east-1'],
          allowedServices, // Store granular permissions
          createdBy: new Types.ObjectId(userId),
        });

        await connection.save();
      }

      // Auto-grant MCP permissions for new connection (not for updates)
      if (!isUpdate) {
        const { AutoGrantMCPPermissions } = await import('../mcp/permissions/auto-grant.service');
        await AutoGrantMCPPermissions.grantPermissionsForNewConnection(
          userId,
          'aws',
          connection._id.toString()
        );
      }

      // Log audit event with permission details
      await auditLoggerService.logSuccess(isUpdate ? 'connection_updated' : 'connection_created', {
        userId: new Types.ObjectId(userId),
        connectionId: connection._id,
      }, {
        service: 'aws',
        operation: isUpdate ? 'updateConnection' : 'createConnection',
      });

      return res.status(isUpdate ? 200 : 201).json({
        success: true,
        message: isUpdate ? 'Connection updated successfully' : 'Connection created successfully',
        connection: {
          id: connection._id,
          connectionName: connection.connectionName,
          environment: connection.environment,
          roleArn: connection.roleArn,
          externalId: externalIdResult.externalId, // Return plain for initial setup
          permissionMode: connection.permissionMode,
          allowedServices: connection.allowedServices, // Return granular permissions
          status: connection.status,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        },
      });
      
      ControllerHelper.logRequestSuccess('createConnection', req, startTime, {
        connectionId: connection._id.toString(),
        isUpdate
      });
      
      return res;
    } catch (error) {
      ControllerHelper.handleError('createConnection', error, req, res, startTime);
      return res;
    } finally {
      // Clear tenant context
      tenantIsolationService.clearTenantContext();
    }
  }

  static async listConnections(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('listConnections', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;

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
          allowedServices: c.allowedServices, // Include granular permissions
          allowedRegions: c.allowedRegions,
          executionMode: c.executionMode,
          status: c.status,
          health: c.health,
          lastUsed: c.lastUsed,
          totalExecutions: c.totalExecutions,
          createdAt: c.createdAt,
        })),
      });
      
      ControllerHelper.logRequestSuccess('listConnections', req, startTime, {
        connectionCount: connections.length
      });
      
      return res;
    } catch (error) {
      ControllerHelper.handleError('listConnections', error, req, res, startTime);
      return res;
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  static async deleteConnection(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('deleteConnection', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');

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

      ControllerHelper.logRequestSuccess('deleteConnection', req, startTime, {
        connectionId: id
      });
      
      return res.json({ success: true, message: 'Connection deleted' });
    } catch (error) {
      ControllerHelper.handleError('deleteConnection', error, req, res, startTime, {
        connectionId: req.params.id
      });
      return res;
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  static async testConnection(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('testConnection', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');

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
      
      ControllerHelper.logRequestSuccess('testConnection', req, startTime, {
        connectionId: id,
        status: 'healthy'
      });
      
      return res;
    } catch (error) {
      ControllerHelper.handleError('testConnection', error, req, res, startTime, {
        connectionId: req.params.id
      });
      return res;
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  // ============================================================================
  // Intent & Plan
  // ============================================================================

  static async parseIntent(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('parseIntent', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;
      const { request, connectionId } = req.body;

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

      ControllerHelper.logRequestSuccess('parseIntent', req, startTime, {
        connectionId,
        blocked: intent.blocked
      });
      
      return res.json({ success: true, intent });
    } catch (error) {
      ControllerHelper.handleError('parseIntent', error, req, res, startTime, {
        connectionId: req.body.connectionId
      });
      return res;
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  static async generatePlan(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('generatePlan', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;
      const { intent, connectionId, resources } = req.body;
      ServiceHelper.validateObjectId(connectionId, 'connectionId');

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

      ControllerHelper.logRequestSuccess('generatePlan', req, startTime, {
        connectionId,
        planId: plan.planId
      });
      
      return res.json({ success: true, plan });
    } catch (error) {
      ControllerHelper.handleError('generatePlan', error, req, res, startTime, {
        connectionId: req.body.connectionId
      });
      return res;
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  // ============================================================================
  // Execution
  // ============================================================================

  static async approvePlan(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('approvePlan', req);
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
      
      ControllerHelper.logRequestSuccess('approvePlan', req, startTime, {
        planId,
        connectionId
      });
      
      return res;
    } catch (error) {
      ControllerHelper.handleError('approvePlan', error, req, res, startTime, {
        planId: req.body.planId,
        connectionId: req.body.connectionId
      });
      return res;
    }
  }

  static async executePlan(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('executePlan', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;
      const { plan, connectionId, approvalToken } = req.body;
      ServiceHelper.validateObjectId(connectionId, 'connectionId');

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

      ControllerHelper.logRequestSuccess('executePlan', req, startTime, {
        connectionId,
        planId: plan.planId,
        status: result.status
      });
      
      return res.json({ success: true, result });
    } catch (error) {
      ControllerHelper.handleError('executePlan', error, req, res, startTime, {
        connectionId: req.body.connectionId,
        planId: req.body.plan?.planId
      });
      return res;
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  static async simulatePlan(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('simulatePlan', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;
      const { plan, connectionId } = req.body;
      ServiceHelper.validateObjectId(connectionId, 'connectionId');

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

      ControllerHelper.logRequestSuccess('simulatePlan', req, startTime, {
        connectionId,
        planId: plan.planId
      });
      
      return res.json({ success: true, simulation: result });
    } catch (error) {
      ControllerHelper.handleError('simulatePlan', error, req, res, startTime, {
        connectionId: req.body.connectionId,
        planId: req.body.plan?.planId
      });
      return res;
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  // ============================================================================
  // Kill Switch (Admin Only)
  // ============================================================================

  static async activateKillSwitch(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('activateKillSwitch', req);
      const userRole = req.user?.role;
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

      ControllerHelper.logRequestSuccess('activateKillSwitch', req, startTime, {
        scope: req.body.scope,
        id: req.body.id
      });
      
      return res.json({ success: true, message: 'Kill switch activated' });
    } catch (error) {
      ControllerHelper.handleError('activateKillSwitch', error, req, res, startTime);
      return res;
    }
  }

  static getKillSwitchState(req: AuthenticatedRequest, res: Response): Response {
    const startTime = Date.now();
    try {
      ControllerHelper.logRequestStart('getKillSwitchState', req);
      const state = killSwitchService.getState();
      
      ControllerHelper.logRequestSuccess('getKillSwitchState', req, startTime);
      
      return res.json({ success: true, state });
    } catch (error) {
      ControllerHelper.handleError('getKillSwitchState', error, req, res, startTime);
      return res;
    }
  }

  // ============================================================================
  // Audit
  // ============================================================================

  static async getAuditLogs(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getAuditLogs', req);
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

      ControllerHelper.logRequestSuccess('getAuditLogs', req, startTime, {
        connectionId: req.query.connectionId,
        eventType: req.query.eventType
      });
      
      return res.json({ success: true, ...result });
    } catch (error) {
      ControllerHelper.handleError('getAuditLogs', error, req, res, startTime);
      return res;
    }
  }

  static getAuditAnchor(req: AuthenticatedRequest, res: Response): Response {
    const startTime = Date.now();
    try {
      ControllerHelper.logRequestStart('getAuditAnchor', req);
      const anchorData = auditAnchorService.getPublicAnchorData();
      
      ControllerHelper.logRequestSuccess('getAuditAnchor', req, startTime);
      
      return res.json({ success: true, ...anchorData });
    } catch (error) {
      ControllerHelper.handleError('getAuditAnchor', error, req, res, startTime);
      return res;
    }
  }

  static async verifyAuditChain(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      ControllerHelper.logRequestStart('verifyAuditChain', req);
      const { startPosition, endPosition } = req.query;
      
      const result = await auditLoggerService.verifyChain(
        startPosition ? parseInt(startPosition as string) : undefined,
        endPosition ? parseInt(endPosition as string) : undefined
      );

      ControllerHelper.logRequestSuccess('verifyAuditChain', req, startTime, {
        startPosition: req.query.startPosition,
        endPosition: req.query.endPosition
      });
      
      return res.json({ success: true, verification: result });
    } catch (error) {
      ControllerHelper.handleError('verifyAuditChain', error, req, res, startTime);
      return res;
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  static getAllowedActions(req: AuthenticatedRequest, res: Response): Response {
    const startTime = Date.now();
    try {
      ControllerHelper.logRequestStart('getAllowedActions', req);
      const actions = intentParserService.getAvailableActions();
      
      ControllerHelper.logRequestSuccess('getAllowedActions', req, startTime, {
        actionCount: actions.length
      });
      
      return res.json({ success: true, actions });
    } catch (error) {
      ControllerHelper.handleError('getAllowedActions', error, req, res, startTime);
      return res;
    }
  }

  static getPermissionBoundaries(req: AuthenticatedRequest, res: Response): Response {
    const startTime = Date.now();
    try {
      ControllerHelper.logRequestStart('getPermissionBoundaries', req);
      
      const result = {
        success: true,
        hardLimits: permissionBoundaryService.getHardLimits(),
        bannedActions: permissionBoundaryService.getBannedActions(),
        allowedServices: permissionBoundaryService.getAllowedServices(),
      };
      
      ControllerHelper.logRequestSuccess('getPermissionBoundaries', req, startTime);
      
      return res.json(result);
    } catch (error) {
      ControllerHelper.handleError('getPermissionBoundaries', error, req, res, startTime);
      return res;
    }
  }

  static async getEmergencyStopInstructions(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    let tenantContext;
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getEmergencyStopInstructions', req);
      const workspaceId = req.user?.workspaceId || (req as any).workspaceId;
      const { connectionId } = req.params;
      ServiceHelper.validateObjectId(connectionId, 'connectionId');

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
      
      ControllerHelper.logRequestSuccess('getEmergencyStopInstructions', req, startTime, {
        connectionId
      });
      
      return res.json({ success: true, instructions });
    } catch (error) {
      ControllerHelper.handleError('getEmergencyStopInstructions', error, req, res, startTime, {
        connectionId: req.params.connectionId
      });
      return res;
    } finally {
      tenantIsolationService.clearTenantContext();
    }
  }

  /**
   * @route GET /aws/connections/:id/permissions
   * @desc Get permission summary for a connection
   * @access Private
   */
  static async getConnectionPermissions(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getConnectionPermissions', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const summary = await permissionValidatorService.getPermissionSummary(new Types.ObjectId(id));
      const hasWrite = await permissionValidatorService.hasWritePermissions(new Types.ObjectId(id));

      return res.json({
        success: true,
        permissions: {
          ...summary,
          hasWritePermissions: hasWrite,
          permissionMode: connection.permissionMode,
          allowedServices: connection.allowedServices,
        },
      });
      
      ControllerHelper.logRequestSuccess('getConnectionPermissions', req, startTime, {
        connectionId: id,
        hasWrite
      });
      
      return res;
    } catch (error) {
      ControllerHelper.handleError('getConnectionPermissions', error, req, res, startTime, {
        connectionId: req.params.id
      });
      return res;
    }
  }

  /**
   * @route POST /aws/connections/:id/validate-action
   * @desc Validate if an action is allowed for a connection
   * @access Private
   */
  static async validateAction(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('validateAction', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { action, region } = req.body;

      if (!action) {
        return res.status(400).json({ error: 'action is required' });
      }

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const validation = await permissionValidatorService.validateAction(
        new Types.ObjectId(id),
        action,
        region
      );

      ControllerHelper.logRequestSuccess('validateAction', req, startTime, {
        connectionId: id,
        action: req.body.action,
        allowed: validation.allowed
      });
      
      return res.json({
        success: true,
        validation,
      });
    } catch (error) {
      ControllerHelper.handleError('validateAction', error, req, res, startTime, {
        connectionId: req.params.id,
        action: req.body.action
      });
      return res;
    }
  }

  // ============================================================================
  // Resource Listing - EC2
  // ============================================================================

  /**
   * @route GET /aws/connections/:id/ec2/instances
   * @desc List EC2 instances
   * @access Private
   */
  static async listEC2Instances(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('listEC2Instances', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { region } = req.query;

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const instances = await ec2ServiceProvider.listInstances(
        connection,
        undefined,
        region as string | undefined
      );

      ControllerHelper.logRequestSuccess('listEC2Instances', req, startTime, {
        connectionId: id,
        instanceCount: instances.length,
        region: req.query.region
      });
      
      return res.json({
        success: true,
        instances,
        count: instances.length,
      });
    } catch (error) {
      ControllerHelper.handleError('listEC2Instances', error, req, res, startTime, {
        connectionId: req.params.id,
        region: req.query.region
      });
      return res;
    }
  }

  /**
   * @route POST /aws/connections/:id/ec2/stop
   * @desc Stop EC2 instances
   * @access Private
   */
  static async stopEC2Instances(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('stopEC2Instances', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { instanceIds, region } = req.body;

      if (!instanceIds || !Array.isArray(instanceIds) || instanceIds.length === 0) {
        return res.status(400).json({ error: 'instanceIds array is required' });
      }

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const result = await ec2ServiceProvider.stopInstances(connection, instanceIds, region);

      await auditLoggerService.logSuccess('ec2_instances_stopped', {
        userId: new Types.ObjectId(userId),
        connectionId: connection._id,
      }, { service: 'ec2', operation: 'StopInstances', resources: instanceIds });

      ControllerHelper.logRequestSuccess('stopEC2Instances', req, startTime, {
        connectionId: id,
        instanceCount: instanceIds.length,
        region: req.body.region
      });
      
      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      ControllerHelper.handleError('stopEC2Instances', error, req, res, startTime, {
        connectionId: req.params.id,
        instanceIds: req.body.instanceIds,
        region: req.body.region
      });
      return res;
    }
  }

  /**
   * @route POST /aws/connections/:id/ec2/start
   * @desc Start EC2 instances
   * @access Private
   */
  static async startEC2Instances(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('startEC2Instances', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { instanceIds, region } = req.body;

      if (!instanceIds || !Array.isArray(instanceIds) || instanceIds.length === 0) {
        return res.status(400).json({ error: 'instanceIds array is required' });
      }

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const result = await ec2ServiceProvider.startInstances(connection, instanceIds, region);

      await auditLoggerService.logSuccess('ec2_instances_started', {
        userId: new Types.ObjectId(userId),
        connectionId: connection._id,
      }, { service: 'ec2', operation: 'StartInstances', resources: instanceIds });

      ControllerHelper.logRequestSuccess('startEC2Instances', req, startTime, {
        connectionId: id,
        instanceCount: instanceIds.length,
        region: req.body.region
      });
      
      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      ControllerHelper.handleError('startEC2Instances', error, req, res, startTime, {
        connectionId: req.params.id,
        instanceIds: req.body.instanceIds,
        region: req.body.region
      });
      return res;
    }
  }

  // ============================================================================
  // Resource Listing - S3
  // ============================================================================

  /**
   * @route GET /aws/connections/:id/s3/buckets
   * @desc List S3 buckets
   * @access Private
   */
  static async listS3Buckets(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('listS3Buckets', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const buckets = await s3ServiceProvider.listBuckets(connection);

      ControllerHelper.logRequestSuccess('listS3Buckets', req, startTime, {
        connectionId: id,
        bucketCount: buckets.length
      });
      
      return res.json({
        success: true,
        buckets,
        count: buckets.length,
      });
    } catch (error) {
      ControllerHelper.handleError('listS3Buckets', error, req, res, startTime, {
        connectionId: req.params.id
      });
      return res;
    }
  }

  // ============================================================================
  // Resource Listing - RDS
  // ============================================================================

  /**
   * @route GET /aws/connections/:id/rds/instances
   * @desc List RDS instances
   * @access Private
   */
  static async listRDSInstances(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('listRDSInstances', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { region } = req.query;

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const instances = await rdsServiceProvider.listInstances(connection, region as string | undefined);

      ControllerHelper.logRequestSuccess('listRDSInstances', req, startTime, {
        connectionId: id,
        instanceCount: instances.length,
        region: req.query.region
      });
      
      return res.json({
        success: true,
        instances,
        count: instances.length,
      });
    } catch (error) {
      ControllerHelper.handleError('listRDSInstances', error, req, res, startTime, {
        connectionId: req.params.id,
        region: req.query.region
      });
      return res;
    }
  }

  // ============================================================================
  // Resource Listing - Lambda
  // ============================================================================

  /**
   * @route GET /aws/connections/:id/lambda/functions
   * @desc List Lambda functions
   * @access Private
   */
  static async listLambdaFunctions(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('listLambdaFunctions', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { region } = req.query;

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const functions = await lambdaServiceProvider.listFunctions(connection, region as string | undefined);

      ControllerHelper.logRequestSuccess('listLambdaFunctions', req, startTime, {
        connectionId: id,
        functionCount: functions.length,
        region: req.query.region
      });
      
      return res.json({
        success: true,
        functions,
        count: functions.length,
      });
    } catch (error) {
      ControllerHelper.handleError('listLambdaFunctions', error, req, res, startTime, {
        connectionId: req.params.id,
        region: req.query.region
      });
      return res;
    }
  }

  // ============================================================================
  // Cost Explorer
  // ============================================================================

  /**
   * @route GET /aws/connections/:id/costs
   * @desc Get current month costs summary
   * @access Private
   */
  static async getCosts(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getCosts', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const costs = await costExplorerServiceProvider.getCurrentMonthCosts(connection);

      ControllerHelper.logRequestSuccess('getCosts', req, startTime, {
        connectionId: id
      });
      
      return res.json({
        success: true,
        ...costs,
      });
    } catch (error) {
      ControllerHelper.handleError('getCosts', error, req, res, startTime, {
        connectionId: req.params.id
      });
      return res;
    }
  }

  /**
   * @route GET /aws/connections/:id/costs/breakdown
   * @desc Get cost breakdown by service
   * @access Private
   */
  static async getCostBreakdown(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getCostBreakdown', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { startDate, endDate } = req.query;

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      // Default to last 30 days
      const end = (endDate as string) || new Date().toISOString().split('T')[0];
      const start = (startDate as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const breakdown = await costExplorerServiceProvider.getCostBreakdownByService(connection, start, end);

      ControllerHelper.logRequestSuccess('getCostBreakdown', req, startTime, {
        connectionId: id,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      
      return res.json({
        success: true,
        breakdown,
        period: { start, end },
      });
    } catch (error) {
      ControllerHelper.handleError('getCostBreakdown', error, req, res, startTime, {
        connectionId: req.params.id,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      return res;
    }
  }

  /**
   * @route GET /aws/connections/:id/costs/forecast
   * @desc Get cost forecast
   * @access Private
   */
  static async getCostForecast(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getCostForecast', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { granularity } = req.query;

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      // Forecast for next 30 days
      const start = new Date().toISOString().split('T')[0];
      const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const forecast = await costExplorerServiceProvider.getCostForecast(
        connection,
        start,
        end,
        (granularity as 'DAILY' | 'MONTHLY') || 'DAILY'
      );

      ControllerHelper.logRequestSuccess('getCostForecast', req, startTime, {
        connectionId: id,
        granularity: req.query.granularity
      });
      
      return res.json({
        success: true,
        forecast,
        period: { start, end },
      });
    } catch (error) {
      ControllerHelper.handleError('getCostForecast', error, req, res, startTime, {
        connectionId: req.params.id,
        granularity: req.query.granularity
      });
      return res;
    }
  }

  /**
   * @route GET /aws/connections/:id/costs/anomalies
   * @desc Get cost anomalies
   * @access Private
   */
  static async getCostAnomalies(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getCostAnomalies', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');
      const { startDate, endDate } = req.query;

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const anomalies = await costExplorerServiceProvider.getAnomalies(
        connection,
        startDate as string | undefined,
        endDate as string | undefined
      );

      ControllerHelper.logRequestSuccess('getCostAnomalies', req, startTime, {
        connectionId: id,
        anomalyCount: anomalies.length,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      
      return res.json({
        success: true,
        anomalies,
        count: anomalies.length,
      });
    } catch (error) {
      ControllerHelper.handleError('getCostAnomalies', error, req, res, startTime, {
        connectionId: req.params.id,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      return res;
    }
  }

  /**
   * @route GET /aws/connections/:id/costs/optimize
   * @desc Get cost optimization recommendations
   * @access Private
   */
  static async getOptimizationRecommendations(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) {
        return res;
      }
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getOptimizationRecommendations', req);
      const { id } = req.params;
      ServiceHelper.validateObjectId(id, 'connectionId');

      const connection = await AWSConnection.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const insights = await costExplorerServiceProvider.getOptimizationInsights(connection);

      ControllerHelper.logRequestSuccess('getOptimizationRecommendations', req, startTime, {
        connectionId: id,
        recommendationCount: insights.length
      });
      
      return res.json({
        success: true,
        recommendations: insights,
        count: insights.length,
      });
    } catch (error) {
      ControllerHelper.handleError('getOptimizationRecommendations', error, req, res, startTime, {
        connectionId: req.params.id
      });
      return res;
    }
  }
}
