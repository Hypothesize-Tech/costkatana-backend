import { Response } from 'express';
import { WorkflowService } from '../services/workflow.service';
import { logger } from '../utils/logger';

export class WorkflowController {
    /**
     * Get workflow details by ID
     */
    static async getWorkflowDetails(req: any, res: Response): Promise<void> {
        try {
            const { workflowId } = req.params;
            const userId = req.user?.id || req.userId;

            if (!workflowId) {
                res.status(400).json({
                    success: false,
                    message: 'Workflow ID is required'
                });
                return;
            }

            const workflow = await WorkflowService.getWorkflowDetails(workflowId, userId);

            if (!workflow) {
                res.status(404).json({
                    success: false,
                    message: 'Workflow not found'
                });
                return;
            }

            res.json({
                success: true,
                data: workflow
            });

        } catch (error) {
            logger.error('Error getting workflow details:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get workflow details',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get user workflows with pagination
     */
    static async getUserWorkflows(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            const {
                page = 1,
                limit = 20,
                workflowName,
                startDate,
                endDate
            } = req.query;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const options = {
                page: parseInt(page as string),
                limit: parseInt(limit as string),
                workflowName: workflowName as string,
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined
            };

            const result = await WorkflowService.getUserWorkflows(userId, options);

            res.json({
                success: true,
                data: result.workflows,
                pagination: result.pagination
            });

        } catch (error) {
            logger.error('Error getting user workflows:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get workflows',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get workflow analytics
     */
    static async getWorkflowAnalytics(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            const { startDate, endDate } = req.query;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined
            };

            const analytics = await WorkflowService.getWorkflowAnalytics(userId, options);

            res.json({
                success: true,
                data: analytics
            });

        } catch (error) {
            logger.error('Error getting workflow analytics:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get workflow analytics',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Compare multiple workflows
     */
    static async compareWorkflows(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            const { workflowIds } = req.body;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            if (!workflowIds || !Array.isArray(workflowIds) || workflowIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Workflow IDs array is required'
                });
                return;
            }

            if (workflowIds.length > 10) {
                res.status(400).json({
                    success: false,
                    message: 'Maximum 10 workflows can be compared at once'
                });
                return;
            }

            const workflows = await WorkflowService.compareWorkflows(workflowIds, userId);

            res.json({
                success: true,
                data: workflows
            });

        } catch (error) {
            logger.error('Error comparing workflows:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to compare workflows',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get workflow steps for a specific workflow
     */
    static async getWorkflowSteps(req: any, res: Response): Promise<void> {
        try {
            const { workflowId } = req.params;
            const userId = req.user?.id || req.userId;

            if (!workflowId) {
                res.status(400).json({
                    success: false,
                    message: 'Workflow ID is required'
                });
                return;
            }

            const workflow = await WorkflowService.getWorkflowDetails(workflowId, userId);

            if (!workflow) {
                res.status(404).json({
                    success: false,
                    message: 'Workflow not found'
                });
                return;
            }

            res.json({
                success: true,
                data: {
                    workflowId: workflow.workflowId,
                    workflowName: workflow.workflowName,
                    steps: workflow.steps,
                    totalCost: workflow.totalCost,
                    duration: workflow.duration
                }
            });

        } catch (error) {
            logger.error('Error getting workflow steps:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get workflow steps',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}