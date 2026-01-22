import {  Response } from 'express';
import { OnboardingService } from '../services/onboarding.service';
import { ProjectService } from '../services/project.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';

export class OnboardingApiController {
    /**
     * Get onboarding status
     */
    static async getOnboardingStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('getOnboardingStatus', req);

        try {

            const status = await OnboardingService.getOnboardingStatus(userId);

            if (!status) {
                // Initialize onboarding if it doesn't exist
                const initStatus = await OnboardingService.initializeOnboarding(userId);
                ControllerHelper.logRequestSuccess('getOnboardingStatus', req, startTime, {
                    initialized: true
                });
                res.json({
                    success: true,
                    data: initStatus
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getOnboardingStatus', req, startTime, {
                currentStep: status.currentStep,
                completed: status.completed
            });

            res.json({
                success: true,
                data: status
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOnboardingStatus', error, req, res, startTime);
        }
    }

    /**
     * Initialize onboarding
     */
    static async initializeOnboarding(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('initializeOnboarding', req);

        try {

            const status = await OnboardingService.initializeOnboarding(userId);

            ControllerHelper.logRequestSuccess('initializeOnboarding', req, startTime, {
                currentStep: status.currentStep
            });

            res.json({
                success: true,
                data: status
            });
        } catch (error: any) {
            ControllerHelper.handleError('initializeOnboarding', error, req, res, startTime);
        }
    }

    /**
     * Complete onboarding step
     */
    static async completeStep(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { stepId, data } = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('completeStep', req, { stepId });

        try {

            if (!stepId) {
                res.status(400).json({
                    success: false,
                    error: 'Step ID is required'
                });
                return;
            }

            const status = await OnboardingService.completeStep(userId, stepId);

            ControllerHelper.logRequestSuccess('completeStep', req, startTime, {
                stepId,
                currentStep: status.currentStep,
                completed: status.completed
            });

            res.json({
                success: true,
                data: status
            });
        } catch (error: any) {
            ControllerHelper.handleError('completeStep', error, req, res, startTime, { stepId });
        }
    }

    /**
     * Create project during onboarding
     */
    static async createProject(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const projectData = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('createProject', req, {
            projectName: projectData?.name
        });

        try {

            if (!projectData?.name) {
                res.status(400).json({
                    success: false,
                    error: 'Project name is required'
                });
                return;
            }

            const project = await OnboardingService.createProject(userId, projectData);

            ControllerHelper.logRequestSuccess('createProject', req, startTime, {
                projectId: project._id,
                projectName: project.name
            });

            res.json({
                success: true,
                data: project,
                message: 'Project created successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('createProject', error, req, res, startTime);
        }
    }

    /**
     * Execute LLM query during onboarding
     */
    static async executeLlmQuery(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const queryData = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('executeLlmQuery', req, {
            model: queryData?.model
        });

        try {

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

            ControllerHelper.logRequestSuccess('executeLlmQuery', req, startTime, {
                model: queryData.model,
                tokens: response.tokens,
                cost: response.cost
            });

            res.json({
                success: true,
                data: response,
                message: 'LLM query executed successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('executeLlmQuery', error, req, res, startTime);
        }
    }

    /**
     * Complete onboarding
     */
    static async completeOnboarding(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('completeOnboarding', req);

        try {

            const status = await OnboardingService.completeOnboarding(userId);

            const duration = Date.now() - startTime;

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

            ControllerHelper.logRequestSuccess('completeOnboarding', req, startTime, {
                completedAt: status.completedAt
            });

            res.json({
                success: true,
                data: status,
                message: 'Onboarding completed successfully!'
            });
        } catch (error: any) {
            ControllerHelper.handleError('completeOnboarding', error, req, res, startTime);
        }
    }

    /**
     * Skip onboarding
     */
    static async skipOnboarding(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('skipOnboarding', req);

        try {

            const status = await OnboardingService.skipOnboarding(userId);

            const duration = Date.now() - startTime;

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

            ControllerHelper.logRequestSuccess('skipOnboarding', req, startTime, {
                skippedAt: status.skippedAt
            });

            res.json({
                success: true,
                data: status,
                message: 'Onboarding skipped successfully!'
            });
        } catch (error: any) {
            ControllerHelper.handleError('skipOnboarding', error, req, res, startTime);
        }
    }
}
