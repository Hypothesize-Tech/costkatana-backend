import { Router } from 'express';
import { AWSController } from '../controllers/aws.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================================================
// Connection Management
// ============================================================================

/**
 * @route POST /aws/connections
 * @desc Create a new AWS connection
 * @access Private
 */
router.post('/connections', AWSController.createConnection);

/**
 * @route GET /aws/connections
 * @desc List all AWS connections for the user
 * @access Private
 */
router.get('/connections', AWSController.listConnections);

/**
 * @route DELETE /aws/connections/:id
 * @desc Delete an AWS connection
 * @access Private
 */
router.delete('/connections/:id', AWSController.deleteConnection);

/**
 * @route POST /aws/connections/:id/test
 * @desc Test an AWS connection
 * @access Private
 */
router.post('/connections/:id/test', AWSController.testConnection);

/**
 * @route GET /aws/connections/:id/permissions
 * @desc Get permission summary for a connection
 * @access Private
 */
router.get('/connections/:id/permissions', AWSController.getConnectionPermissions);

/**
 * @route POST /aws/connections/:id/validate-action
 * @desc Validate if an action is allowed
 * @access Private
 */
router.post('/connections/:id/validate-action', AWSController.validateAction);

// ============================================================================
// EC2 Resources
// ============================================================================

/**
 * @route GET /aws/connections/:id/ec2/instances
 * @desc List EC2 instances
 * @access Private
 */
router.get('/connections/:id/ec2/instances', AWSController.listEC2Instances);

/**
 * @route POST /aws/connections/:id/ec2/stop
 * @desc Stop EC2 instances
 * @access Private
 */
router.post('/connections/:id/ec2/stop', AWSController.stopEC2Instances);

/**
 * @route POST /aws/connections/:id/ec2/start
 * @desc Start EC2 instances
 * @access Private
 */
router.post('/connections/:id/ec2/start', AWSController.startEC2Instances);

// ============================================================================
// S3 Resources
// ============================================================================

/**
 * @route GET /aws/connections/:id/s3/buckets
 * @desc List S3 buckets
 * @access Private
 */
router.get('/connections/:id/s3/buckets', AWSController.listS3Buckets);

// ============================================================================
// RDS Resources
// ============================================================================

/**
 * @route GET /aws/connections/:id/rds/instances
 * @desc List RDS instances
 * @access Private
 */
router.get('/connections/:id/rds/instances', AWSController.listRDSInstances);

// ============================================================================
// Lambda Resources
// ============================================================================

/**
 * @route GET /aws/connections/:id/lambda/functions
 * @desc List Lambda functions
 * @access Private
 */
router.get('/connections/:id/lambda/functions', AWSController.listLambdaFunctions);

// ============================================================================
// Cost Explorer
// ============================================================================

/**
 * @route GET /aws/connections/:id/costs
 * @desc Get current month costs summary
 * @access Private
 */
router.get('/connections/:id/costs', AWSController.getCosts);

/**
 * @route GET /aws/connections/:id/costs/breakdown
 * @desc Get cost breakdown by service
 * @access Private
 */
router.get('/connections/:id/costs/breakdown', AWSController.getCostBreakdown);

/**
 * @route GET /aws/connections/:id/costs/forecast
 * @desc Get cost forecast
 * @access Private
 */
router.get('/connections/:id/costs/forecast', AWSController.getCostForecast);

/**
 * @route GET /aws/connections/:id/costs/anomalies
 * @desc Get cost anomalies
 * @access Private
 */
router.get('/connections/:id/costs/anomalies', AWSController.getCostAnomalies);

/**
 * @route GET /aws/connections/:id/costs/optimize
 * @desc Get cost optimization recommendations
 * @access Private
 */
router.get('/connections/:id/costs/optimize', AWSController.getOptimizationRecommendations);

// ============================================================================
// Intent & Plan
// ============================================================================

/**
 * @route POST /aws/intent
 * @desc Parse natural language request into structured intent
 * @access Private
 */
router.post('/intent', AWSController.parseIntent);

/**
 * @route POST /aws/plan
 * @desc Generate execution plan from intent
 * @access Private
 */
router.post('/plan', AWSController.generatePlan);

// ============================================================================
// Execution
// ============================================================================

/**
 * @route POST /aws/approve
 * @desc Approve a plan for execution (generates approval token)
 * @access Private
 */
router.post('/approve', AWSController.approvePlan);

/**
 * @route POST /aws/execute
 * @desc Execute an approved plan
 * @access Private
 */
router.post('/execute', AWSController.executePlan);

/**
 * @route POST /aws/simulate
 * @desc Simulate plan execution (dry-run)
 * @access Private
 */
router.post('/simulate', AWSController.simulatePlan);

// ============================================================================
// Kill Switch (Admin Only)
// ============================================================================

/**
 * @route POST /aws/kill-switch
 * @desc Activate kill switch (admin only)
 * @access Admin
 */
router.post('/kill-switch', AWSController.activateKillSwitch);

/**
 * @route GET /aws/kill-switch
 * @desc Get kill switch state
 * @access Private
 */
router.get('/kill-switch', AWSController.getKillSwitchState);

// ============================================================================
// Audit
// ============================================================================

/**
 * @route GET /aws/audit
 * @desc Get audit logs for the user
 * @access Private
 */
router.get('/audit', AWSController.getAuditLogs);

/**
 * @route GET /aws/audit/anchor
 * @desc Get public audit anchor data
 * @access Public (no auth required for transparency)
 */
router.get('/audit/anchor', AWSController.getAuditAnchor);

/**
 * @route GET /aws/audit/verify
 * @desc Verify audit chain integrity
 * @access Private
 */
router.get('/audit/verify', AWSController.verifyAuditChain);

// ============================================================================
// Utilities
// ============================================================================

/**
 * @route GET /aws/actions
 * @desc Get list of allowed AWS actions
 * @access Private
 */
router.get('/actions', AWSController.getAllowedActions);

/**
 * @route GET /aws/boundaries
 * @desc Get permission boundaries and hard limits
 * @access Private
 */
router.get('/boundaries', AWSController.getPermissionBoundaries);

/**
 * @route GET /aws/emergency-stop/:connectionId
 * @desc Get emergency stop instructions for a connection
 * @access Private
 */
router.get('/emergency-stop/:connectionId', AWSController.getEmergencyStopInstructions);

export default router;
