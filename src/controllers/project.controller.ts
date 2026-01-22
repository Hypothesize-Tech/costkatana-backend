import { Response } from 'express';
import { ProjectService } from '../services/project.service';
import { ApprovalRequest } from '../models/ApprovalRequest';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class ProjectController {
    /**
     * Create a new project
     */
    static async createProject(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        ControllerHelper.logRequestStart('createProject', req);

        try {
            const projectData = req.body;
            const project = await ProjectService.createProject(userId, projectData);

            ControllerHelper.logRequestSuccess('createProject', req, startTime, {
                projectId: project._id,
                projectName: project.name,
                budgetAmount: projectData.budget?.amount
            });

            ControllerHelper.logBusinessEvent(
                'project_created',
                'project',
                userId,
                undefined,
                {
                    projectId: project._id,
                    projectName: project.name,
                    budgetAmount: projectData.budget?.amount,
                    budgetPeriod: projectData.budget?.period
                }
            );

            // Keep existing response format (backward compatibility)
            res.status(201).json({
                success: true,
                data: project,
                message: 'Project created successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('createProject', error, req, res, startTime);
        }
    }

    /**
     * Get all projects for the authenticated user
     */
    static async getUserProjects(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getUserProjects', req);

        try {
            const projects = await ProjectService.getUserProjects(userId);

            ControllerHelper.logRequestSuccess('getUserProjects', req, startTime, {
                projectsCount: projects.length
            });

            // Keep existing response format (backward compatibility)
            res.json({
                success: true,
                data: projects
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserProjects', error, req, res, startTime);
        }
    }

    /**
     * Get project analytics
     */
    static async getProjectAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { projectId } = req.params;
        const { period } = req.query;
        ControllerHelper.logRequestStart('getProjectAnalytics', req);

        try {
            ServiceHelper.validateObjectId(projectId, 'Project ID');

            const analytics = await ProjectService.getProjectAnalytics(
                projectId,
                period as string
            );

            ControllerHelper.logRequestSuccess('getProjectAnalytics', req, startTime, {
                projectId,
                period
            });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            ControllerHelper.handleError('getProjectAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Update project settings
     */
    static async updateProject(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { projectId } = req.params;
        const updates = req.body;
        ControllerHelper.logRequestStart('updateProject', req);

        try {
            ServiceHelper.validateObjectId(projectId, 'Project ID');

            const project = await ProjectService.updateProject(
                projectId,
                updates,
                userId
            );

            ControllerHelper.logRequestSuccess('updateProject', req, startTime, {
                projectId,
                updateKeys: Object.keys(updates || {})
            });

            ControllerHelper.logBusinessEvent(
                'project_updated',
                'project',
                userId,
                Date.now() - startTime,
                {
                    projectId,
                    updateKeys: Object.keys(updates || {})
                }
            );

            res.json({
                success: true,
                data: project,
                message: 'Project updated successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateProject', error, req, res, startTime);
        }
    }

    /**
     * Get pending approval requests for a project
     */
    static async getApprovalRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { projectId } = req.params;
        const { status } = req.query;
        ControllerHelper.logRequestStart('getApprovalRequests', req);

        try {
            ServiceHelper.validateObjectId(projectId, 'Project ID');

            const filter: any = { projectId };
            if (status) {
                filter.status = status;
            }

            const requests = await ApprovalRequest.find(filter)
                .populate('requesterId', 'name email')
                .sort({ createdAt: -1 });

            ControllerHelper.logRequestSuccess('getApprovalRequests', req, startTime, {
                projectId,
                status,
                requestsCount: requests.length
            });

            res.json({
                success: true,
                data: requests
            });
        } catch (error: any) {
            ControllerHelper.handleError('getApprovalRequests', error, req, res, startTime);
        }
    }

    /**
     * Approve or reject an approval request
     */
    static async handleApprovalRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { requestId: approvalRequestId } = req.params;
        const { action, comments, conditions } = req.body;
        ControllerHelper.logRequestStart('handleApprovalRequest', req);

        try {
            ServiceHelper.validateObjectId(approvalRequestId, 'Approval Request ID');

            const request = await ApprovalRequest.findById(approvalRequestId);
            if (!request) {
                res.status(404).json({
                    success: false,
                    error: 'Approval request not found'
                });
                return;
            }

            if (request.status !== 'pending') {
                res.status(400).json({
                    success: false,
                    error: 'Request has already been processed'
                });
                return;
            }

            if (action === 'approve') {
                await (request as any).approve(userId, comments, conditions);
            } else if (action === 'reject') {
                await (request as any).reject(userId, comments);
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Invalid action'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('handleApprovalRequest', req, startTime, {
                approvalRequestId,
                action
            });

            ControllerHelper.logBusinessEvent(
                'approval_request_processed',
                'project',
                userId,
                Date.now() - startTime,
                {
                    approvalRequestId,
                    action,
                    comments: !!comments,
                    conditions: !!conditions
                }
            );

            res.json({
                success: true,
                data: request,
                message: `Request ${action}d successfully`
            });
        } catch (error: any) {
            ControllerHelper.handleError('handleApprovalRequest', error, req, res, startTime);
        }
    }

    /**
     * Get cost allocation breakdown
     */
    static async getCostAllocation(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { projectId } = req.params;
        const { groupBy, startDate, endDate } = req.query;
        ControllerHelper.logRequestStart('getCostAllocation', req);

        try {
            ServiceHelper.validateObjectId(projectId, 'Project ID');

            const allocation = await ProjectService.getCostAllocation(
                projectId,
                {
                    groupBy: groupBy as string,
                    startDate: startDate ? new Date(startDate as string) : undefined,
                    endDate: endDate ? new Date(endDate as string) : undefined
                }
            );

            ControllerHelper.logRequestSuccess('getCostAllocation', req, startTime, {
                projectId,
                groupBy
            });

            res.json({
                success: true,
                data: allocation
            });
        } catch (error: any) {
            ControllerHelper.handleError('getCostAllocation', error, req, res, startTime);
        }
    }

    /**
     * Get a specific project by ID
     */
    static async getProject(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        const { projectId } = req.params;
        ControllerHelper.logRequestStart('getProject', req);

        try {
            // Validate MongoDB ObjectId
            ServiceHelper.validateObjectId(projectId, 'Project ID');

            const project = await ProjectService.getProjectById(projectId, userId);

            ControllerHelper.logRequestSuccess('getProject', req, startTime, {
                projectId
            });

            // Keep existing response format (backward compatibility)
            res.json({
                success: true,
                data: project
            });
        } catch (error: any) {
            ControllerHelper.handleError('getProject', error, req, res, startTime);
        }
    }

    /**
     * Delete a project
     */
    static async deleteProject(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        const { projectId } = req.params;
        ControllerHelper.logRequestStart('deleteProject', req);

        try {
            // Validate MongoDB ObjectId
            ServiceHelper.validateObjectId(projectId, 'Project ID');

            await ProjectService.deleteProject(projectId, userId);

            ControllerHelper.logRequestSuccess('deleteProject', req, startTime, {
                projectId
            });

            ControllerHelper.logBusinessEvent(
                'project_deleted',
                'project',
                userId,
                undefined,
                { projectId }
            );

            // Keep existing response format (backward compatibility)
            res.json({
                success: true,
                message: 'Project deleted successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('deleteProject', error, req, res, startTime);
        }
    }

    /**
     * Recalculate all user project spending
     */
    static async recalculateUserProjectSpending(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('recalculateUserProjectSpending', req);

        try {
            // Recalculate spending for all user projects
            await ProjectService.recalculateUserProjectSpending(userId);

            ControllerHelper.logRequestSuccess('recalculateUserProjectSpending', req, startTime);

            ControllerHelper.logBusinessEvent(
                'user_project_spending_recalculated',
                'project',
                userId,
                Date.now() - startTime,
                {}
            );

            res.json({
                success: true,
                message: 'All project spending recalculated successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('recalculateUserProjectSpending', error, req, res, startTime);
        }
    }

    /**
     * Recalculate project spending from Usage data
     */
    static async recalculateProjectSpending(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { projectId } = req.params;
        ControllerHelper.logRequestStart('recalculateProjectSpending', req);

        try {
            ServiceHelper.validateObjectId(projectId, 'Project ID');

            // Recalculate spending
            await ProjectService.recalculateProjectSpending(projectId);

            ControllerHelper.logRequestSuccess('recalculateProjectSpending', req, startTime, {
                projectId
            });

            ControllerHelper.logBusinessEvent(
                'project_spending_recalculated',
                'project',
                userId,
                Date.now() - startTime,
                { projectId }
            );

            res.json({
                success: true,
                message: 'Project spending recalculated successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('recalculateProjectSpending', error, req, res, startTime);
        }
    }

    /**
     * Export project data
     */
    static async exportProjectData(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { projectId } = req.params;
        const { format, startDate, endDate } = req.query;
        ControllerHelper.logRequestStart('exportProjectData', req);

        try {
            ServiceHelper.validateObjectId(projectId, 'Project ID');

            const data = await ProjectService.exportProjectData(
                projectId,
                {
                    format: format as 'csv' | 'json' | 'excel',
                    startDate: startDate ? new Date(startDate as string) : undefined,
                    endDate: endDate ? new Date(endDate as string) : undefined
                }
            );

            ControllerHelper.logRequestSuccess('exportProjectData', req, startTime, {
                projectId,
                format
            });

            ControllerHelper.logBusinessEvent(
                'project_data_exported',
                'project',
                userId,
                Date.now() - startTime,
                {
                    projectId,
                    format,
                    startDate: !!startDate,
                    endDate: !!endDate
                }
            );

            if (format === 'csv') {
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="project-${projectId}-export.csv"`);
            } else if (format === 'excel') {
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="project-${projectId}-export.xlsx"`);
            }

            res.send(data);
        } catch (error: any) {
            ControllerHelper.handleError('exportProjectData', error, req, res, startTime);
        }
    }
} 