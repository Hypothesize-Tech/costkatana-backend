import { Response } from 'express';
import { GovernedAgentService, AgentMode } from '../services/governedAgent.service';
import { UniversalPlanGeneratorService } from '../services/universalPlanGenerator.service';
import { ApprovalManagerService } from '../services/approvalManager.service';
import { IntegrationOrchestratorService, IntegrationStep } from '../services/integrationOrchestrator.service';
import { UniversalVerificationService } from '../services/universalVerification.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class GovernedAgentController {
  /**
   * Initiate a new governed task
   * POST /api/governed-agent/initiate
   */
  static async initiateTask(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('initiateTask', req);

    try {
      const { userRequest } = req.body;

      if (!userRequest || typeof userRequest !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'userRequest is required'
        });
      }

      const task = await GovernedAgentService.initiateTask(userRequest, userId);

      ControllerHelper.logRequestSuccess('initiateTask', req, startTime, {
        taskId: task.id,
        mode: task.mode
      });

      return res.status(200).json({
        success: true,
        data: {
          taskId: task.id,
          mode: task.mode,
          classification: task.classification,
          status: task.status
        }
      });

    } catch (error) {
      ControllerHelper.handleError('initiateTask', error, req, res, startTime);
      return res;
    }
  }

  /**
   * Generate execution plan for a task
   * POST /api/governed-agent/:taskId/generate-plan
   */
  static async generatePlan(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { taskId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('generatePlan', req, { taskId });

    try {
      ServiceHelper.validateObjectId(taskId, 'taskId');
      
      const { clarifyingAnswers } = req.body; // Optional answers to clarifying questions

      const task = await GovernedAgentService.getTask(taskId, userId);
      if (!task) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }

      if (!task.classification) {
        return res.status(400).json({
          success: false,
          message: 'Task must be classified first'
        });
      }

      // Check scope analysis for ambiguities that need clarification
      if (!task.scopeAnalysis) {
        const scopeAnalysis = await GovernedAgentService.analyzeScope(taskId, userId);
        
        // If there are clarification questions and no answers provided yet, return questions
        if (scopeAnalysis.clarificationNeeded && scopeAnalysis.clarificationNeeded.length > 0 && !clarifyingAnswers) {
          return res.status(200).json({
            success: true,
            requiresClarification: true,
            data: {
              taskId,
              clarificationNeeded: scopeAnalysis.clarificationNeeded,
              ambiguities: scopeAnalysis.ambiguities,
              message: 'Please provide answers to clarifying questions before planning'
            }
          });
        }
      }

      // Generate plan (with clarifying answers if provided)
      const plan = await UniversalPlanGeneratorService.generatePlan(
        task, 
        task.classification,
        clarifyingAnswers
      );

      // Generate approval token if needed
      let approvalToken: string | undefined;
      if (plan.riskAssessment.requiresApproval) {
        approvalToken = await ApprovalManagerService.generateApprovalToken(plan, taskId, userId);
      }

      // Update task with plan
      await GovernedAgentService.updateTask(taskId, userId, {
        plan,
        approvalToken,
        mode: AgentMode.PLAN
      });

      return res.status(200).json({
        success: true,
        data: {
          taskId,
          plan,
          approvalToken,
          requiresApproval: plan.riskAssessment.requiresApproval
        }
      });

    } catch (error) {
      loggingService.error('Failed to generate plan', {
        component: 'GovernedAgentController',
        operation: 'generatePlan',
        error: error instanceof Error ? error.message : String(error)
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to generate plan',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get clarifying questions for a task
   * GET /api/governed-agent/:taskId/clarify
   */
  static async getClarifyingQuestions(req: any, res: Response): Promise<Response> {
    try {
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const { taskId } = req.params;

      const task = await GovernedAgentService.getTask(taskId, userId);
      if (!task) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }

      // Get or generate scope analysis
      let scopeAnalysis = task.scopeAnalysis;
      if (!scopeAnalysis) {
        scopeAnalysis = await GovernedAgentService.analyzeScope(taskId, userId);
      }

      return res.status(200).json({
        success: true,
        data: {
          taskId,
          clarificationNeeded: scopeAnalysis.clarificationNeeded || [],
          ambiguities: scopeAnalysis.ambiguities || [],
          hasClarifications: (scopeAnalysis.clarificationNeeded?.length || 0) > 0
        }
      });

    } catch (error) {
      loggingService.error('Failed to get clarifying questions', {
        component: 'GovernedAgentController',
        operation: 'getClarifyingQuestions',
        error: error instanceof Error ? error.message : String(error)
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to get clarifying questions',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Execute task with approval (SSE streaming)
   * POST /api/governed-agent/:taskId/execute
   */
  static async executeWithProgress(req: any, res: Response): Promise<void> {
    const userId = req.userId || req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { taskId } = req.params;
    const { approvalToken } = req.body;

    try {
      const task = await GovernedAgentService.getTask(taskId, userId);
      if (!task) {
        res.status(404).json({
          success: false,
          message: 'Task not found'
        });
        return;
      }

      // Validate approval if required
      if (task.plan?.riskAssessment.requiresApproval) {
        if (!approvalToken) {
          res.status(400).json({
            success: false,
            message: 'Approval token required'
          });
          return;
        }

        const validation = await ApprovalManagerService.validateApproval(approvalToken, userId);
        if (!validation.valid) {
          res.status(403).json({
            success: false,
            message: validation.reason || 'Invalid approval token'
          });
          return;
        }
      }

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Transition to BUILD mode
      await GovernedAgentService.transitionMode(taskId, userId, AgentMode.BUILD);

      // Send initial status
      res.write(`data: ${JSON.stringify({ status: 'started', timestamp: new Date() })}\n\n`);

      // Execute integration chain if plan exists
      if (task.plan) {
        const steps: IntegrationStep[] = task.plan.phases.flatMap(phase =>
          phase.steps.map(step => ({
            ...step,
            integration: step.tool.replace('_integration', '')
          }))
        );

        await IntegrationOrchestratorService.executeChain(
          steps,
          userId,
          (update) => {
            res.write(`data: ${JSON.stringify(update)}\n\n`);
          }
        );
      }

      // Transition to VERIFY mode
      await GovernedAgentService.transitionMode(taskId, userId, AgentMode.VERIFY);

      // Perform verification
      const verification = await UniversalVerificationService.verifyTask(task);
      
      // Update task with verification results
      await GovernedAgentService.updateTask(taskId, userId, {
        verification,
        status: verification.success ? 'completed' : 'failed',
        completedAt: new Date()
      });

      // Send verification results
      res.write(`data: ${JSON.stringify({ 
        status: 'verification', 
        verification,
        timestamp: new Date() 
      })}\n\n`);

      // Transition to DONE mode
      await GovernedAgentService.transitionMode(taskId, userId, AgentMode.DONE);

      // Send completion status
      res.write(`data: ${JSON.stringify({ 
        status: 'completed', 
        verification,
        timestamp: new Date() 
      })}\n\n`);
      res.end();

    } catch (error) {
      loggingService.error('Task execution failed', {
        component: 'GovernedAgentController',
        operation: 'executeWithProgress',
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });

      // Send error event
      res.write(`data: ${JSON.stringify({ 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      })}\n\n`);
      res.end();

      // Mark task as failed
      await GovernedAgentService.failTask(
        taskId,
        userId,
        error instanceof Error ? error : new Error('Unknown error')
      );
    }
  }

  /**
   * Get task status
   * GET /api/governed-agent/:taskId
   */
  static async getTaskStatus(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { taskId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getTaskStatus', req, { taskId });

    try {
      ServiceHelper.validateObjectId(taskId, 'taskId');

      const task = await GovernedAgentService.getTask(taskId, userId);
      if (!task) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }

      ControllerHelper.logRequestSuccess('getTaskStatus', req, startTime, { taskId });

      return res.status(200).json({
        success: true,
        data: task
      });

    } catch (error) {
      ControllerHelper.handleError('getTaskStatus', error, req, res, startTime, { taskId });
      return res;
    }
  }

  /**
   * Get user's recent tasks
   * GET /api/governed-agent/tasks
   */
  static async getUserTasks(req: any, res: Response): Promise<Response> {
    try {
      const userId = req.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const { limit, status } = req.query;

      const tasks = await GovernedAgentService.getUserTasks(
        userId,
        limit ? parseInt(limit as string) : 10,
        status as any
      );

      return res.status(200).json({
        success: true,
        data: tasks
      });

    } catch (error) {
      loggingService.error('Failed to get user tasks', {
        component: 'GovernedAgentController',
        operation: 'getUserTasks',
        error: error instanceof Error ? error.message : String(error)
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to get user tasks',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
