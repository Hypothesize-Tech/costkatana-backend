import { Response } from 'express';
import { ProjectService } from '../services/project.service';
import { ApprovalRequest } from '../models/ApprovalRequest';
import { logger } from '../utils/logger';

export class ProjectController {
    /**
     * Create a new project
     */
    static async createProject(req: any, res: Response) {
        const startTime = Date.now();
        logger.info('=== PROJECT CREATION REQUEST STARTED ===');
        logger.info('Request headers:', {
            'content-type': req.headers['content-type'],
            'authorization': req.headers['authorization'] ? 'Bearer [REDACTED]' : 'No auth header',
            'user-agent': req.headers['user-agent']
        });

        try {
            logger.info('Step 1: Extracting user ID from request');
            const userId = req.user!.id;
            logger.info('User ID extracted:', userId);

            logger.info('Step 2: Extracting project data from request body');
            const projectData = req.body;
            logger.info('Project data received:', {
                name: projectData.name,
                description: projectData.description,
                tags: projectData.tags,
                budgetAmount: projectData.budget?.amount,
                budgetPeriod: projectData.budget?.period,
                alertsCount: projectData.budget?.alerts?.length,
                settingsKeys: Object.keys(projectData.settings || {})
            });

            logger.info('Step 3: Calling ProjectService.createProject');
            const project = await ProjectService.createProject(userId, projectData);
            logger.info('Step 4: Project created successfully:', {
                projectId: project._id,
                projectName: project.name,
                timeTaken: Date.now() - startTime + 'ms'
            });

            logger.info('Step 5: Sending success response');
            res.status(201).json({
                success: true,
                data: project,
                message: 'Project created successfully'
            });
            logger.info('=== PROJECT CREATION REQUEST COMPLETED ===');
        } catch (error: any) {
            const timeTaken = Date.now() - startTime;
            logger.error('=== PROJECT CREATION REQUEST FAILED ===');
            logger.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name,
                timeTaken: timeTaken + 'ms'
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
    static async getUserProjects(req: any, res: Response) {
        try {
            const userId = req.user!.id;

            const projects = await ProjectService.getUserProjects(userId);

            res.json({
                success: true,
                data: projects
            });
        } catch (error: any) {
            logger.error('Error getting user projects:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get projects'
            });
        }
    }

    /**
     * Get project analytics
     */
    static async getProjectAnalytics(req: any, res: Response) {
        try {
            const { projectId } = req.params;
            const { period } = req.query;

            const analytics = await ProjectService.getProjectAnalytics(
                projectId,
                period as string
            );

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            logger.error('Error getting project analytics:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get analytics'
            });
        }
    }

    /**
     * Update project settings
     */
    static async updateProject(req: any, res: Response) {
        try {
            const { projectId } = req.params;
            const userId = req.user!.id;
            const updates = req.body;

            const project = await ProjectService.updateProject(
                projectId,
                updates,
                userId
            );

            res.json({
                success: true,
                data: project,
                message: 'Project updated successfully'
            });
        } catch (error: any) {
            logger.error('Error updating project:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to update project'
            });
        }
    }

    /**
     * Add member to project
     */
    static async addMember(req: any, res: Response) {
        try {
            const { projectId } = req.params;
            const { memberId, email, role } = req.body;
            const addedBy = req.user!.id;

            // Require either email or memberId
            if (!email && !memberId) {
                res.status(400).json({
                    success: false,
                    error: 'Either email or memberId is required'
                });
                return;
            }

            await ProjectService.addMember(projectId, memberId || email, role, addedBy);

            res.json({
                success: true,
                message: 'Member added successfully'
            });
        } catch (error: any) {
            logger.error('Error adding member:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to add member'
            });
        }
    }

    /**
     * Remove member from project
     */
    static async removeMember(req: any, res: Response) {
        try {
            const { projectId, memberId } = req.params;
            const removedBy = req.user!.id;

            await ProjectService.removeMember(projectId, memberId, removedBy);

            res.json({
                success: true,
                message: 'Member removed successfully'
            });
        } catch (error: any) {
            logger.error('Error removing member:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to remove member'
            });
        }
    }

    /**
     * Get pending approval requests for a project
     */
    static async getApprovalRequests(req: any, res: Response) {
        try {
            const { projectId } = req.params;
            const { status } = req.query;

            const filter: any = { projectId };
            if (status) {
                filter.status = status;
            }

            const requests = await ApprovalRequest.find(filter)
                .populate('requesterId', 'name email')
                .sort({ createdAt: -1 });

            res.json({
                success: true,
                data: requests
            });
        } catch (error: any) {
            logger.error('Error getting approval requests:', error);
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
        try {
            const { requestId } = req.params;
            const { action, comments, conditions } = req.body;
            const approverId = req.user!.id;

            const request = await ApprovalRequest.findById(requestId);
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
                    error: 'any has already been processed'
                });
                return;
            }

            if (action === 'approve') {
                await (request as any).approve(approverId, comments, conditions);
            } else if (action === 'reject') {
                await (request as any).reject(approverId, comments);
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Invalid action'
                });
                return;
            }

            res.json({
                success: true,
                data: request,
                message: `any ${action}d successfully`
            });
            return;
        } catch (error: any) {
            logger.error('Error handling approval request:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to process approval'
            });
            return;
        }
    }

    /**
     * Get cost allocation breakdown
     */
    static async getCostAllocation(req: any, res: Response) {
        try {
            const { projectId } = req.params;
            const { groupBy, startDate, endDate } = req.query;

            const allocation = await ProjectService.getCostAllocation(
                projectId,
                {
                    groupBy: groupBy as string,
                    startDate: startDate ? new Date(startDate as string) : undefined,
                    endDate: endDate ? new Date(endDate as string) : undefined
                }
            );

            res.json({
                success: true,
                data: allocation
            });
        } catch (error: any) {
            logger.error('Error getting cost allocation:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get cost allocation'
            });
        }
    }

    /**
     * Get a specific project by ID
     */
    static async getProject(req: any, res: Response) {
        try {
            const { projectId } = req.params;
            const userId = req.user!.id;

            const project = await ProjectService.getProjectById(projectId, userId);

            res.json({
                success: true,
                data: project
            });
        } catch (error: any) {
            logger.error('Error getting project:', error);

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
    static async deleteProject(req: any, res: Response) {
        try {
            const { projectId } = req.params;
            const userId = req.user!.id;

            await ProjectService.deleteProject(projectId, userId);

            res.json({
                success: true,
                message: 'Project deleted successfully'
            });
        } catch (error: any) {
            logger.error('Error deleting project:', error);

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
     * Update project members in bulk
     */
    static async updateProjectMembers(req: any, res: Response): Promise<void> {
        try {
            const { projectId } = req.params;
            const { members } = req.body;
            const userId = req.user!.id;

            if (!Array.isArray(members)) {
                res.status(400).json({
                    success: false,
                    error: 'Members must be an array'
                });
                return;
            }

            const updatedProject = await ProjectService.updateProjectMembers(projectId, members, userId);

            res.json({
                success: true,
                data: updatedProject,
                message: 'Project members updated successfully'
            });
        } catch (error: any) {
            logger.error('Error updating project members:', error);

            if (error.message === 'Project not found' || error.message === 'Access denied') {
                res.status(404).json({
                    success: false,
                    error: error.message
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: error.message || 'Failed to update project members'
                });
            }
        }
    }

    /**
     * Export project data
     */
    static async exportProjectData(req: any, res: Response) {
        try {
            const { projectId } = req.params;
            const { format, startDate, endDate } = req.query;

            const data = await ProjectService.exportProjectData(
                projectId,
                {
                    format: format as 'csv' | 'json' | 'excel',
                    startDate: startDate ? new Date(startDate as string) : undefined,
                    endDate: endDate ? new Date(endDate as string) : undefined
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
            logger.error('Error exporting project data:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to export data'
            });
        }
    }
} 