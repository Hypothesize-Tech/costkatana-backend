import { Response } from 'express';
import { ProjectService } from '../services/project.service';
import { ApprovalRequest } from '../models/ApprovalRequest';
import { loggingService } from '../services/logging.service';

export class ProjectController {
    /**
     * Create a new project
     */
    static async createProject(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Project creation initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectName: req.body?.name,
                hasProjectName: !!req.body?.name,
                projectDescription: req.body?.description,
                hasProjectDescription: !!req.body?.description,
                projectTags: req.body?.tags,
                hasProjectTags: !!req.body?.tags,
                budgetAmount: req.body?.budget?.amount,
                hasBudgetAmount: !!req.body?.budget?.amount,
                budgetPeriod: req.body?.budget?.period,
                hasBudgetPeriod: !!req.body?.budget?.period,
                alertsCount: req.body?.budget?.alerts?.length || 0,
                settingsKeys: Object.keys(req.body?.settings || {})
            });

            if (!userId) {
                loggingService.warn('Project creation failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const projectData = req.body;
            const project = await ProjectService.createProject(userId, projectData);
            const duration = Date.now() - startTime;

            loggingService.info('Project created successfully', {
                userId,
                duration,
                projectId: project._id,
                hasProjectId: !!project._id,
                projectName: project.name,
                hasProjectName: !!project.name,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_created',
                category: 'project',
                value: duration,
                metadata: {
                    userId,
                    projectId: project._id,
                    projectName: project.name,
                    budgetAmount: projectData.budget?.amount,
                    budgetPeriod: projectData.budget?.period
                }
            });

            res.status(201).json({
                success: true,
                data: project,
                message: 'Project created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project creation failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(400).json({
                success: false,
                error: error.message || 'Failed to create project'
            });
        }
    }

    /**
     * Get all projects for the authenticated user
     */
    static async getUserProjects(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('User projects retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId
            });

            if (!userId) {
                loggingService.warn('User projects retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const projects = await ProjectService.getUserProjects(userId);
            const duration = Date.now() - startTime;

            loggingService.info('User projects retrieved successfully', {
                userId,
                duration,
                projectsCount: projects.length,
                hasProjects: !!projects && projects.length > 0,
                requestId
            });

            res.json({
                success: true,
                data: projects
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User projects retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get projects'
            });
        }
    }

    /**
     * Get project analytics
     */
    static async getProjectAnalytics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { projectId } = req.params;
        const { period } = req.query;

        try {
            loggingService.info('Project analytics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                hasProjectId: !!projectId,
                period,
                hasPeriod: !!period
            });

            if (!userId) {
                loggingService.warn('Project analytics retrieval failed - user not authenticated', {
                    requestId,
                    projectId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const analytics = await ProjectService.getProjectAnalytics(
                projectId,
                period as string
            );
            const duration = Date.now() - startTime;

            loggingService.info('Project analytics retrieved successfully', {
                userId,
                duration,
                projectId,
                period,
                hasAnalytics: !!analytics,
                requestId
            });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project analytics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                period,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get analytics'
            });
        }
    }

    /**
     * Update project settings
     */
    static async updateProject(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { projectId } = req.params;
        const updates = req.body;

        try {
            loggingService.info('Project update initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                hasProjectId: !!projectId,
                updateKeys: Object.keys(updates || {}),
                hasUpdates: !!updates && Object.keys(updates).length > 0
            });

            if (!userId) {
                loggingService.warn('Project update failed - user not authenticated', {
                    requestId,
                    projectId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const project = await ProjectService.updateProject(
                projectId,
                updates,
                userId
            );
            const duration = Date.now() - startTime;

            loggingService.info('Project updated successfully', {
                userId,
                duration,
                projectId,
                updateKeys: Object.keys(updates || {}),
                hasProject: !!project,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_updated',
                category: 'project',
                value: duration,
                metadata: {
                    userId,
                    projectId,
                    updateKeys: Object.keys(updates || {})
                }
            });

            res.json({
                success: true,
                data: project,
                message: 'Project updated successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project update failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(400).json({
                success: false,
                error: error.message || 'Failed to update project'
            });
        }
    }

    /**
     * Get pending approval requests for a project
     */
    static async getApprovalRequests(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { projectId } = req.params;
        const { status } = req.query;

        try {
            loggingService.info('Approval requests retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                hasProjectId: !!projectId,
                status,
                hasStatus: !!status
            });

            if (!userId) {
                loggingService.warn('Approval requests retrieval failed - user not authenticated', {
                    requestId,
                    projectId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const filter: any = { projectId };
            if (status) {
                filter.status = status;
            }

            const requests = await ApprovalRequest.find(filter)
                .populate('requesterId', 'name email')
                .sort({ createdAt: -1 });
            const duration = Date.now() - startTime;

            loggingService.info('Approval requests retrieved successfully', {
                userId,
                duration,
                projectId,
                status,
                requestsCount: requests.length,
                hasRequests: !!requests && requests.length > 0,
                requestId
            });

            res.json({
                success: true,
                data: requests
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Approval requests retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                status,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get approval requests'
            });
        }
    }

    /**
     * Approve or reject an approval request
     */
    static async handleApprovalRequest(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { requestId: approvalRequestId } = req.params;
        const { action, comments, conditions } = req.body;

        try {
            loggingService.info('Approval request handling initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                approvalRequestId,
                hasApprovalRequestId: !!approvalRequestId,
                action,
                hasAction: !!action,
                hasComments: !!comments,
                hasConditions: !!conditions
            });

            if (!userId) {
                loggingService.warn('Approval request handling failed - user not authenticated', {
                    requestId,
                    approvalRequestId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const request = await ApprovalRequest.findById(approvalRequestId);
            if (!request) {
                loggingService.warn('Approval request handling failed - request not found', {
                    userId,
                    requestId,
                    approvalRequestId
                });
                res.status(404).json({
                    success: false,
                    error: 'Approval request not found'
                });
                return;
            }

            if (request.status !== 'pending') {
                loggingService.warn('Approval request handling failed - request already processed', {
                    userId,
                    requestId,
                    approvalRequestId,
                    currentStatus: request.status
                });
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
                loggingService.warn('Approval request handling failed - invalid action', {
                    userId,
                    requestId,
                    approvalRequestId,
                    action
                });
                res.status(400).json({
                    success: false,
                    error: 'Invalid action'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Approval request handled successfully', {
                userId,
                duration,
                approvalRequestId,
                action,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'approval_request_processed',
                category: 'project',
                value: duration,
                metadata: {
                    userId,
                    approvalRequestId,
                    action,
                    comments: !!comments,
                    conditions: !!conditions
                }
            });

            res.json({
                success: true,
                data: request,
                message: `Request ${action}d successfully`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Approval request handling failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                approvalRequestId,
                action,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to process approval'
            });
        }
    }

    /**
     * Get cost allocation breakdown
     */
    static async getCostAllocation(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { projectId } = req.params;
        const { groupBy, startDate, endDate } = req.query;

        try {
            loggingService.info('Cost allocation retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                hasProjectId: !!projectId,
                groupBy,
                hasGroupBy: !!groupBy,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            if (!userId) {
                loggingService.warn('Cost allocation retrieval failed - user not authenticated', {
                    requestId,
                    projectId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const allocation = await ProjectService.getCostAllocation(
                projectId,
                {
                    groupBy: groupBy as string,
                    startDate: startDate ? new Date(startDate as string) : undefined,
                    endDate: endDate ? new Date(endDate as string) : undefined
                }
            );
            const duration = Date.now() - startTime;

            loggingService.info('Cost allocation retrieved successfully', {
                userId,
                duration,
                projectId,
                groupBy,
                startDate,
                endDate,
                hasAllocation: !!allocation,
                requestId
            });

            res.json({
                success: true,
                data: allocation
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Cost allocation retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                groupBy,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get cost allocation'
            });
        }
    }

    /**
     * Get a specific project by ID
     */
    static async getProject(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { projectId } = req.params;

        try {
            loggingService.info('Project retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                hasProjectId: !!projectId
            });

            if (!userId) {
                loggingService.warn('Project retrieval failed - user not authenticated', {
                    requestId,
                    projectId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const project = await ProjectService.getProjectById(projectId, userId);
            const duration = Date.now() - startTime;

            loggingService.info('Project retrieved successfully', {
                userId,
                duration,
                projectId,
                hasProject: !!project,
                requestId
            });

            res.json({
                success: true,
                data: project
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            if (error.message === 'Project not found' || error.message === 'Access denied') {
                res.status(404).json({
                    success: false,
                    error: error.message
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to get project'
                });
            }
        }
    }

    /**
     * Delete a project
     */
    static async deleteProject(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { projectId } = req.params;

        try {
            loggingService.info('Project deletion initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                hasProjectId: !!projectId
            });

            if (!userId) {
                loggingService.warn('Project deletion failed - user not authenticated', {
                    requestId,
                    projectId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            await ProjectService.deleteProject(projectId, userId);
            const duration = Date.now() - startTime;

            loggingService.info('Project deleted successfully', {
                userId,
                duration,
                projectId,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_deleted',
                category: 'project',
                value: duration,
                metadata: {
                    userId,
                    projectId
                }
            });

            res.json({
                success: true,
                message: 'Project deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project deletion failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            if (error.message === 'Project not found' || error.message === 'Access denied') {
                res.status(404).json({
                    success: false,
                    error: error.message
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to delete project'
                });
            }
        }
    }

    /**
     * Recalculate all user project spending
     */
    static async recalculateUserProjectSpending(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('User project spending recalculation initiated', {
                userId,
                hasUserId: !!userId,
                requestId
            });

            if (!userId) {
                loggingService.warn('User project spending recalculation failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            // Recalculate spending for all user projects
            await ProjectService.recalculateUserProjectSpending(userId);
            const duration = Date.now() - startTime;

            loggingService.info('User project spending recalculated successfully', {
                userId,
                duration,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_project_spending_recalculated',
                category: 'project',
                value: duration,
                metadata: {
                    userId
                }
            });

            res.json({
                success: true,
                message: 'All project spending recalculated successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User project spending recalculation failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(400).json({
                success: false,
                error: error.message || 'Failed to recalculate project spending'
            });
        }
    }

    /**
     * Recalculate project spending from Usage data
     */
    static async recalculateProjectSpending(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { projectId } = req.params;

        try {
            loggingService.info('Project spending recalculation initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                hasProjectId: !!projectId
            });

            if (!userId) {
                loggingService.warn('Project spending recalculation failed - user not authenticated', {
                    requestId,
                    projectId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            // Recalculate spending
            await ProjectService.recalculateProjectSpending(projectId);
            const duration = Date.now() - startTime;

            loggingService.info('Project spending recalculated successfully', {
                userId,
                duration,
                projectId,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_spending_recalculated',
                category: 'project',
                value: duration,
                metadata: {
                    userId,
                    projectId
                }
            });

            res.json({
                success: true,
                message: 'Project spending recalculated successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project spending recalculation failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(400).json({
                success: false,
                error: error.message || 'Failed to recalculate project spending'
            });
        }
    }

    /**
     * Export project data
     */
    static async exportProjectData(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { projectId } = req.params;
        const { format, startDate, endDate } = req.query;

        try {
            loggingService.info('Project data export initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                hasProjectId: !!projectId,
                format,
                hasFormat: !!format,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            if (!userId) {
                loggingService.warn('Project data export failed - user not authenticated', {
                    requestId,
                    projectId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const data = await ProjectService.exportProjectData(
                projectId,
                {
                    format: format as 'csv' | 'json' | 'excel',
                    startDate: startDate ? new Date(startDate as string) : undefined,
                    endDate: endDate ? new Date(endDate as string) : undefined
                }
            );
            const duration = Date.now() - startTime;

            loggingService.info('Project data exported successfully', {
                userId,
                duration,
                projectId,
                format,
                startDate,
                endDate,
                hasData: !!data,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_data_exported',
                category: 'project',
                value: duration,
                metadata: {
                    userId,
                    projectId,
                    format,
                    startDate: !!startDate,
                    endDate: !!endDate
                }
            });

            if (format === 'csv') {
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="project-${projectId}-export.csv"`);
            } else if (format === 'excel') {
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="project-${projectId}-export.xlsx"`);
            }

            res.send(data);
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project data export failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                projectId,
                format,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to export data'
            });
        }
    }
} 