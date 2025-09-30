import {  Response } from 'express';
import { OnboardingService } from '../services/onboarding.service';
import { ProjectService } from '../services/project.service';
import { loggingService } from '../services/logging.service';

export class OnboardingApiController {
    /**
     * Get onboarding status
     */
    static async getOnboardingStatus(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Getting onboarding status', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const status = await OnboardingService.getOnboardingStatus(userId);

            if (!status) {
                // Initialize onboarding if it doesn't exist
                const initStatus = await OnboardingService.initializeOnboarding(userId);
                res.json({
                    success: true,
                    data: initStatus
                });
                return;
            }

            const duration = Date.now() - startTime;
            loggingService.info('Onboarding status retrieved successfully', {
                userId,
                currentStep: status.currentStep,
                completed: status.completed,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.json({
                success: true,
                data: status
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Error getting onboarding status', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to get onboarding status',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Initialize onboarding
     */
    static async initializeOnboarding(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Initializing onboarding', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const status = await OnboardingService.initializeOnboarding(userId);

            const duration = Date.now() - startTime;
            loggingService.info('Onboarding initialized successfully', {
                userId,
                currentStep: status.currentStep,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.json({
                success: true,
                data: status
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Error initializing onboarding', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to initialize onboarding',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Complete onboarding step
     */
    static async completeStep(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const { stepId, data } = req.body;

        try {
            loggingService.info('Completing onboarding step', {
                userId,
                stepId,
                hasData: !!data,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            if (!stepId) {
                res.status(400).json({
                    success: false,
                    error: 'Step ID is required'
                });
                return;
            }

            const status = await OnboardingService.completeStep(userId, stepId, data);

            const duration = Date.now() - startTime;
            loggingService.info('Onboarding step completed successfully', {
                userId,
                stepId,
                currentStep: status.currentStep,
                completed: status.completed,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.json({
                success: true,
                data: status
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Error completing onboarding step', {
                userId,
                stepId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to complete onboarding step',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Create project during onboarding
     */
    static async createProject(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const projectData = req.body;

        try {
            loggingService.info('Creating project during onboarding', {
                userId,
                projectName: projectData?.name,
                budgetAmount: projectData?.budget?.amount,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            if (!projectData?.name) {
                res.status(400).json({
                    success: false,
                    error: 'Project name is required'
                });
                return;
            }

            const project = await OnboardingService.createProject(userId, projectData);

            const duration = Date.now() - startTime;
            loggingService.info('Project created during onboarding successfully', {
                userId,
                projectId: project._id,
                projectName: project.name,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.json({
                success: true,
                data: project,
                message: 'Project created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Error creating project during onboarding', {
                userId,
                projectData,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to create project',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Execute LLM query during onboarding
     */
    static async executeLlmQuery(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const queryData = req.body;

        try {
            loggingService.info('Executing LLM query during onboarding', {
                userId,
                model: queryData?.model,
                queryLength: queryData?.query?.length,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            if (!queryData?.query || !queryData?.model) {
                res.status(400).json({
                    success: false,
                    error: 'Query and model are required'
                });
                return;
            }

            // Get user's projects to find the most recent one for the query
            const projects = await ProjectService.getUserProjects(userId);
            const projectId = projects[0]?._id?.toString();

            if (!projectId) {
                res.status(400).json({
                    success: false,
                    error: 'No project found. Please create a project first.'
                });
                return;
            }

            const response = await OnboardingService.executeLlmQuery(userId, {
                ...queryData,
                projectId,
                userId
            });

            const duration = Date.now() - startTime;
            loggingService.info('LLM query executed during onboarding successfully', {
                userId,
                model: queryData.model,
                tokens: response.tokens,
                cost: response.cost,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.json({
                success: true,
                data: response,
                message: 'LLM query executed successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Error executing LLM query during onboarding', {
                userId,
                queryData,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to execute LLM query',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Complete onboarding
     */
    static async completeOnboarding(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Completing onboarding', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const status = await OnboardingService.completeOnboarding(userId);

            const duration = Date.now() - startTime;
            loggingService.info('Onboarding completed successfully', {
                userId,
                completedAt: status.completedAt,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'onboarding_completed',
                category: 'onboarding_operations',
                value: duration,
                metadata: {
                    userId,
                    completedAt: status.completedAt
                }
            });

            res.json({
                success: true,
                data: status,
                message: 'Onboarding completed successfully!'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Error completing onboarding', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to complete onboarding',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Skip onboarding
     */
    static async skipOnboarding(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Skipping onboarding', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const status = await OnboardingService.skipOnboarding(userId);

            const duration = Date.now() - startTime;
            loggingService.info('Onboarding skipped successfully', {
                userId,
                skippedAt: status.skippedAt,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'onboarding_skipped',
                category: 'onboarding_operations',
                value: duration,
                metadata: {
                    userId,
                    skippedAt: status.skippedAt
                }
            });

            res.json({
                success: true,
                data: status,
                message: 'Onboarding skipped successfully!'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Error skipping onboarding', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to skip onboarding',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
