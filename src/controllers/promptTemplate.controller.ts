import { Response } from 'express';
import { PromptTemplateService } from '../services/promptTemplate.service';
import { TemplateExecutionService } from '../services/templateExecution.service';
import { ModelRecommendationService } from '../services/modelRecommendation.service';
import { loggingService } from '../services/logging.service';
import { ReferenceImageAnalysisService } from '../services/referenceImageAnalysis.service';
import { PromptTemplate } from '../models/PromptTemplate';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class PromptTemplateController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for AI services
    private static aiFailureCount: number = 0;
    private static readonly MAX_AI_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastAiFailureTime: number = 0;
    
    // Access control optimization
    private static userProjectCache = new Map<string, { projects: string[]; timestamp: number }>();
    
    /**
     * Initialize background processor
     */
    static {
        PromptTemplateController.startBackgroundProcessor();
    }
    /**
     * Create a new prompt template
     */
    static async createTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('createTemplate', req);

        try {

            const templateData = req.body;
            const template = await PromptTemplateService.createTemplate(userId, templateData);
            ControllerHelper.logRequestSuccess('createTemplate', req, startTime, {
                templateId: template._id,
                templateName: template.name
            });

            // Queue background business event logging
            const duration = Date.now() - startTime;
            PromptTemplateController.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'prompt_template_created',
                    category: 'prompt_template',
                    value: duration,
                    metadata: {
                        userId,
                        templateId: template._id,
                        templateName: template.name,
                        templateCategory: template.category
                    }
                });
            });

            res.status(201).json({
                success: true,
                data: template,
                message: 'Prompt template created successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('createTemplate', error, req, res, startTime);
        }
    }

    /**
     * Get accessible prompt templates
     */
    static async getTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getTemplates', req);

        try {
            PromptTemplateController.conditionalLog('info', 'GET prompt templates request', { userId });

            const {
                projectId,
                category,
                tags,
                visibility,
                search,
                page,
                limit
            } = req.query;

            const filters = {
                userId,
                projectId: projectId as string,
                category: category as any,
                tags: tags ? (tags as string).split(',') : undefined,
                visibility: visibility as any,
                search: search as string,
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 20
            };

            const result = await PromptTemplateService.getTemplates(filters);

            ControllerHelper.logRequestSuccess('getTemplates', req, startTime, {
                templatesCount: result.templates?.length || 0,
                total: result.total,
                page: result.page
            });

            const response = {
                success: true,
                data: result.templates,
                pagination: {
                    total: result.total,
                    page: result.page,
                    pages: result.pages
                }
            };

            res.json(response);
        } catch (error: any) {
            ControllerHelper.handleError('getTemplates', error, req, res, startTime);
        }
    }

    /**
     * Get a specific prompt template
     */
    static async getTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getTemplate', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;

            const template = await PromptTemplateService.getTemplateById(templateId, userId);

            ControllerHelper.logRequestSuccess('getTemplate', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: template
            });
        } catch (error: any) {
            ControllerHelper.handleError('getTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Use a prompt template (legacy - just fills variables)
     */
    static async useTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('useTemplate', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            const { variables } = req.body;

            const result = await PromptTemplateService.useTemplate(
                templateId,
                userId,
                variables
            );

            ControllerHelper.logRequestSuccess('useTemplate', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            ControllerHelper.handleError('useTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Update a prompt template
     */
    static async updateTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('updateTemplate', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            const updates = req.body;

            const template = await PromptTemplateService.updateTemplate(
                templateId,
                userId,
                updates
            );

            ControllerHelper.logRequestSuccess('updateTemplate', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: template,
                message: 'Template updated successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Delete a prompt template
     */
    static async deleteTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('deleteTemplate', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;

            await PromptTemplateService.deleteTemplate(templateId, userId);

            ControllerHelper.logRequestSuccess('deleteTemplate', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                message: 'Template deleted successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('deleteTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Duplicate a prompt template
     */
    static async duplicateTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('duplicateTemplate', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const customizations = req.body;

            const duplicatedTemplate = await PromptTemplateService.duplicateTemplate(
                templateId,
                userId,
                customizations
            );

            ControllerHelper.logRequestSuccess('duplicateTemplate', req, startTime, {
                templateId,
                duplicatedTemplateId: duplicatedTemplate._id,
                duplicatedTemplateName: duplicatedTemplate.name
            });

            res.status(201).json({
                success: true,
                data: duplicatedTemplate,
                message: 'Template duplicated successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('duplicateTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Add feedback to a prompt template
     */
    static async addFeedback(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('addFeedback', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            const { rating, comment } = req.body;

            await PromptTemplateService.addTemplateFeedback(
                templateId,
                userId,
                rating,
                comment
            );

            ControllerHelper.logRequestSuccess('addFeedback', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                message: 'Feedback added successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('addFeedback', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Get template analytics
     */
    static async getTemplateAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getTemplateAnalytics', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const analytics = await PromptTemplateService.getTemplateAnalytics(templateId);

            ControllerHelper.logRequestSuccess('getTemplateAnalytics', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            ControllerHelper.handleError('getTemplateAnalytics', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Get popular templates
     */
    static async getPopularTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getPopularTemplates', req);

        try {
            const { category, limit } = req.query;

            const templates = await PromptTemplateService.getPopularTemplates(
                category as string,
                limit ? parseInt(limit as string) : 10
            );

            ControllerHelper.logRequestSuccess('getPopularTemplates', req, startTime, {
                templatesCount: templates.length,
                category
            });

            res.json({
                success: true,
                data: templates
            });
        } catch (error: any) {
            ControllerHelper.handleError('getPopularTemplates', error, req, res, startTime);
        }
    }

    /**
     * Get trending templates
     */
    static async getTrendingTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getTrendingTemplates', req);

        try {
            const { period, category, limit } = req.query;

            const templates = await PromptTemplateService.getTrendingTemplates(
                period as 'day' | 'week' | 'month' || 'week',
                category as string,
                limit ? parseInt(limit as string) : 10
            );

            ControllerHelper.logRequestSuccess('getTrendingTemplates', req, startTime, {
                templatesCount: templates.length,
                period,
                category
            });

            res.json({
                success: true,
                data: templates
            });
        } catch (error: any) {
            ControllerHelper.handleError('getTrendingTemplates', error, req, res, startTime);
        }
    }

    /**
     * AI: Generate template from intent
     */
    static async generateFromIntent(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        let intent: string | undefined;
        let category: string | undefined;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('generateFromIntent', req);

        try {
            intent = req.body.intent;
            category = req.body.category;
            const { context, constraints } = req.body;

            // Check AI circuit breaker
            if (PromptTemplateController.isAiCircuitBreakerOpen()) {
                res.status(503).json({
                    success: false,
                    message: 'AI service temporarily unavailable. Please try again later.'
                });
                return;
            }

            PromptTemplateController.conditionalLog('info', 'AI template generation requested', {
                userId,
                intent,
                category
            });

            // Add timeout handling (30 seconds)
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('AI generation timeout')), 30000);
            });

            const generationPromise = PromptTemplateService.generateTemplateFromIntent(
                userId,
                intent as string,
                {
                    category,
                    details: context,
                    constraints
                }
            );

            const result = await Promise.race([generationPromise, timeoutPromise]);

            // Reset failure count on success
            PromptTemplateController.aiFailureCount = 0;

            ControllerHelper.logRequestSuccess('generateFromIntent', req, startTime, {
                intent,
                category
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            PromptTemplateController.recordAiFailure();
            
            if (error.message === 'AI generation timeout') {
                const duration = Date.now() - startTime;
                loggingService.error('AI generation timeout', {
                    userId,
                    intent,
                    category,
                    duration,
                    requestId: req.headers['x-request-id'] as string
                });
                res.status(408).json({
                    success: false,
                    message: 'AI generation took too long. Please try again with a simpler request.'
                });
                return;
            }
            
            ControllerHelper.handleError('generateFromIntent', error, req, res, startTime, {
                intent,
                category
            });
        }
    }

    /**
     * AI: Detect variables in content
     */
    static async detectVariables(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('detectVariables', req);

        try {
            const { content, autoFillDefaults, validateTypes } = req.body;

            const result = await PromptTemplateService.detectVariables(
                content,
                userId,
                {
                    autoFillDefaults,
                    validateTypes
                }
            );

            ControllerHelper.logRequestSuccess('detectVariables', req, startTime);

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            ControllerHelper.handleError('detectVariables', error, req, res, startTime);
        }
    }

    /**
     * AI: Optimize template
     */
    static async optimizeTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('optimizeTemplate', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            const { optimizationType, targetModel, preserveIntent } = req.body;

            const result = await PromptTemplateService.optimizeTemplate(
                templateId,
                userId,
                optimizationType || 'token',
                {
                    targetModel,
                    preserveIntent
                }
            );

            ControllerHelper.logRequestSuccess('optimizeTemplate', req, startTime, {
                templateId,
                optimizationType
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            ControllerHelper.handleError('optimizeTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * AI: Get template recommendations
     */
    static async getRecommendations(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getRecommendations', req);

        try {
            const { currentProject, taskType } = req.query;

            const recommendations = await PromptTemplateService.getRecommendations(
                userId,
                {
                    currentProject: currentProject as string | undefined,
                    taskType: taskType as string | undefined
                }
            );

            ControllerHelper.logRequestSuccess('getRecommendations', req, startTime, {
                recommendationsCount: recommendations.length
            });

            res.json({
                success: true,
                data: recommendations
            });
        } catch (error: any) {
            ControllerHelper.handleError('getRecommendations', error, req, res, startTime);
        }
    }

    /**
     * AI: Predict template effectiveness
     */
    static async predictEffectiveness(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('predictEffectiveness', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            const { variables } = req.body;

            const effectiveness = await PromptTemplateService.predictEffectiveness(
                templateId,
                userId,
                variables
            );

            ControllerHelper.logRequestSuccess('predictEffectiveness', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: effectiveness
            });
        } catch (error: any) {
            ControllerHelper.handleError('predictEffectiveness', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * AI: Get template insights
     */
    static async getInsights(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getInsights', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const insights = await PromptTemplateService.getInsights(templateId);

            ControllerHelper.logRequestSuccess('getInsights', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: insights
            });
        } catch (error: any) {
            ControllerHelper.handleError('getInsights', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * AI: Semantic search templates
     */
    static async searchSemantic(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('searchSemantic', req);

        try {
            const { query, limit = 10 } = req.query;

            const results = await PromptTemplateService.searchSemantic(
                query as string,
                userId,
                parseInt(limit as string)
            );

            ControllerHelper.logRequestSuccess('searchSemantic', req, startTime, {
                query,
                resultsCount: results.length
            });

            res.json({
                success: true,
                data: results
            });
        } catch (error: any) {
            ControllerHelper.handleError('searchSemantic', error, req, res, startTime);
        }
    }

    /**
     * AI: Personalize template
     */
    static async personalizeTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('personalizeTemplate', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;

            const personalized = await PromptTemplateService.personalizeTemplate(
                templateId,
                userId
            );

            ControllerHelper.logRequestSuccess('personalizeTemplate', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: personalized
            });
        } catch (error: any) {
            ControllerHelper.handleError('personalizeTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * AI: Apply optimization to template
     */
    static async applyOptimization(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('applyOptimization', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            const { optimizedContent, metadata } = req.body;

            const updated = await PromptTemplateService.applyOptimization(
                templateId,
                optimizedContent,
                userId,
                metadata
            );

            ControllerHelper.logRequestSuccess('applyOptimization', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: updated
            });
        } catch (error: any) {
            PromptTemplateController.recordAiFailure();
            ControllerHelper.handleError('applyOptimization', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Circuit breaker utilities for AI services
     */
    private static isAiCircuitBreakerOpen(): boolean {
        if (PromptTemplateController.aiFailureCount >= PromptTemplateController.MAX_AI_FAILURES) {
            const timeSinceLastFailure = Date.now() - PromptTemplateController.lastAiFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                PromptTemplateController.aiFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordAiFailure(): void {
        PromptTemplateController.aiFailureCount++;
        PromptTemplateController.lastAiFailureTime = Date.now();
    }

    /**
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        PromptTemplateController.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        PromptTemplateController.backgroundProcessor = setInterval(async () => {
            if (PromptTemplateController.backgroundQueue.length > 0) {
                const operation = PromptTemplateController.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * Conditional logging utility
     */
    private static conditionalLog(level: 'info' | 'warn' | 'error', message: string, metadata?: any): void {
        // Only log if it's an error or if we're in development mode
        if (level === 'error') {
            loggingService[level](message, metadata);
        }
    }

    /**
     * POST /api/prompt-templates/visual-compliance
     * Create a visual compliance template
     */
    static async createVisualComplianceTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('createVisualComplianceTemplate', req);

        try {

            const { name, description, content, complianceCriteria, imageVariables, industry, mode, metaPromptPresetId, projectId, referenceImage } = req.body;

            // Validation
            if (!name || !complianceCriteria || !imageVariables || !industry) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required fields: name, complianceCriteria, imageVariables, industry'
                });
                return;
            }

            if (!Array.isArray(complianceCriteria) || complianceCriteria.length === 0) {
                res.status(400).json({
                    success: false,
                    error: 'complianceCriteria must be a non-empty array'
                });
                return;
            }

            if (!Array.isArray(imageVariables) || imageVariables.length === 0) {
                res.status(400).json({
                    success: false,
                    error: 'imageVariables must be a non-empty array'
                });
                return;
            }

            // Log reference image data for debugging
            loggingService.info('Creating visual compliance template with reference image', {
                component: 'PromptTemplateController',
                hasReferenceImage: !!referenceImage,
                referenceImageKeys: referenceImage ? Object.keys(referenceImage) : []
            });

            const template = await PromptTemplateService.createVisualComplianceTemplate(userId, {
                name,
                description,
                content: content || `Visual compliance check for ${industry}`,
                complianceCriteria,
                imageVariables,
                industry,
                mode,
                metaPromptPresetId,
                projectId,
                referenceImage
            });

            ControllerHelper.logRequestSuccess('createVisualComplianceTemplate', req, startTime, {
                templateId: template._id,
                templateName: template.name,
                industry
            });

            // Trigger automatic feature extraction if reference image exists
            if (template.referenceImage?.s3Url) {
                loggingService.info('Starting automatic feature extraction for template', {
                    templateId: template._id,
                    userId
                });

                // Extract criteria from template variables
                const criteria = template.variables
                    .filter((v: any) => v.name.startsWith('criterion_'))
                    .map((v: any) => ({
                        name: v.name,
                        text: v.defaultValue || v.description || ''
                    }));

                // Start feature extraction in background
                ReferenceImageAnalysisService.extractReferenceFeatures(
                    template.referenceImage.s3Url,
                    criteria,
                    template.visualComplianceConfig?.industry || 'retail',
                    template._id.toString(),
                    userId
                ).catch(error => {
                    loggingService.error('Background feature extraction failed during template creation', {
                        component: 'PromptTemplateController',
                        templateId: template._id,
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }

            res.status(201).json({
                success: true,
                data: template,
                message: 'Visual compliance template created successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('createVisualComplianceTemplate', error, req, res, startTime, {
                templateName: req.body?.name,
                industry: req.body?.industry
            });
        }
    }

    /**
     * POST /api/prompt-templates/:id/use-visual
     * Use visual compliance template with images
     */
    static async useVisualTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('useVisualTemplate', req);

        try {
            const templateId = req.params.templateId;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const { textVariables, imageVariables, projectId } = req.body;

            // Execute visual compliance check with template
            const result = await PromptTemplateService.executeVisualComplianceTemplate(
                templateId,
                userId,
                {
                    text: textVariables,
                    images: imageVariables
                },
                projectId
            );

            ControllerHelper.logRequestSuccess('useVisualTemplate', req, startTime, {
                templateId,
                complianceScore: result.compliance_score,
                passFail: result.pass_fail
            });

            res.status(200).json({
                success: true,
                data: result,
                message: 'Visual compliance check completed successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('useVisualTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * POST /api/prompt-templates/:id/upload-image
     * Upload image for template variable
     */
    static async uploadTemplateImage(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('uploadTemplateImage', req);

        try {
            const templateId = req.params.id;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const { variableName, imageData, mimeType } = req.body;

            if (!variableName || !imageData || !mimeType) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required fields: variableName, imageData, mimeType'
                });
                return;
            }

            // Convert base64 to buffer
            const imageBuffer = Buffer.from(
                imageData.includes('base64,') ? imageData.split('base64,')[1] : imageData,
                'base64'
            );

            const result = await PromptTemplateService.uploadTemplateImage(
                templateId,
                userId,
                variableName,
                imageBuffer,
                mimeType
            );

            ControllerHelper.logRequestSuccess('uploadTemplateImage', req, startTime, {
                templateId,
                variableName,
                s3Url: result.s3Url
            });

            res.status(200).json({
                success: true,
                data: result,
                message: 'Image uploaded successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('uploadTemplateImage', error, req, res, startTime, {
                templateId: req.params.id
            });
        }
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (PromptTemplateController.backgroundProcessor) {
            clearInterval(PromptTemplateController.backgroundProcessor);
            PromptTemplateController.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (PromptTemplateController.backgroundQueue.length > 0) {
            const operation = PromptTemplateController.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
        
        // Clear caches
        PromptTemplateController.userProjectCache.clear();
    }

    /**
     * Execute a prompt template with AI
     */
    static async executeTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('executeTemplate', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            const {
                variables = {},
                executionMode = 'recommended',
                modelId,
                compareWith,
                enableOptimization = false
            } = req.body;


            const result = await TemplateExecutionService.executeTemplate({
                templateId,
                userId,
                variables,
                executionMode,
                modelId,
                compareWith,
                enableOptimization
            });

            ControllerHelper.logRequestSuccess('executeTemplate', req, startTime, {
                templateId,
                executionMode,
                modelId
            });

            res.json({
                success: true,
                data: result,
                message: 'Template executed successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('executeTemplate', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Get model recommendation for a template
     */
    static async getModelRecommendation(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getModelRecommendation', req);

        try {
            const templateId = req.params.templateId as string;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            // Find template without strict authorization check for recommendations
            const template = await PromptTemplate.findById(templateId);
            if (!template || !template.isActive || template.isDeleted) {
                res.status(404).json({
                    success: false,
                    error: 'Template not found'
                });
                return;
            }

            // Get recommendations
            const recommendations = await ModelRecommendationService.recommendModel(template);

            ControllerHelper.logRequestSuccess('getModelRecommendation', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: recommendations
            });
        } catch (error: any) {
            ControllerHelper.handleError('getModelRecommendation', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Get execution history for a template
     */
    static async getExecutionHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getExecutionHistory', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            const limit = parseInt(req.query.limit as string) || 10;

            const history = await TemplateExecutionService.getExecutionHistory(
                templateId,
                userId,
                limit
            );

            ControllerHelper.logRequestSuccess('getExecutionHistory', req, startTime, {
                templateId,
                historyCount: history.length
            });

            res.json({
                success: true,
                data: history
            });
        } catch (error: any) {
            ControllerHelper.handleError('getExecutionHistory', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }

    /**
     * Get execution statistics for a template
     */
    static async getExecutionStats(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getExecutionStats', req);

        try {
            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const stats = await TemplateExecutionService.getExecutionStats(templateId);

            ControllerHelper.logRequestSuccess('getExecutionStats', req, startTime, {
                templateId
            });

            res.json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getExecutionStats', error, req, res, startTime, {
                templateId: req.params.templateId
            });
        }
    }
} 