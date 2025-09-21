import { Response } from 'express';
import { PromptTemplateService } from '../services/promptTemplate.service';
import { loggingService } from '../services/logging.service';

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
    private static readonly PROJECT_CACHE_TTL = 300000; // 5 minutes
    
    /**
     * Initialize background processor
     */
    static {
        PromptTemplateController.startBackgroundProcessor();
    }
    /**
     * Create a new prompt template
     */
    static async createTemplate(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            PromptTemplateController.conditionalLog('info', 'Prompt template creation initiated', {
                userId,
                requestId,
                templateName: req.body?.name,
                templateCategory: req.body?.category
            });

            if (!userId) {
                PromptTemplateController.conditionalLog('warn', 'Prompt template creation failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
                return;
            }

            const templateData = req.body;
            const template = await PromptTemplateService.createTemplate(userId, templateData);
            const duration = Date.now() - startTime;

            PromptTemplateController.conditionalLog('info', 'Prompt template created successfully', {
                userId,
                duration,
                templateId: template._id,
                templateName: template.name,
                requestId
            });

            // Queue background business event logging
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
            const duration = Date.now() - startTime;
            
            PromptTemplateController.conditionalLog('error', 'Prompt template creation failed', {
                userId,
                requestId,
                error: error.message || 'Unknown error',
                duration
            });

            res.status(400).json({
                success: false,
                error: error.message || 'Failed to create template'
            });
        }
    }

    /**
     * Get accessible prompt templates
     */
    static async getTemplates(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
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

            PromptTemplateController.conditionalLog('info', 'Templates retrieved successfully', {
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
            PromptTemplateController.conditionalLog('error', 'Error getting prompt templates', {
                error: error.message || 'Unknown error'
            });
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get templates'
            });
        }
    }

    /**
     * Get a specific prompt template
     */
    static async getTemplate(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;
            const userId = req.user!.id;

            const template = await PromptTemplateService.getTemplateById(templateId, userId);

            res.json({
                success: true,
                data: template
            });
        } catch (error: any) {
            loggingService.error('Error getting prompt template:', error);
            res.status(404).json({
                success: false,
                error: error.message || 'Template not found'
            });
        }
    }

    /**
     * Use a prompt template
     */
    static async useTemplate(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;
            const userId = req.user!.id;
            const { variables } = req.body;

            const result = await PromptTemplateService.useTemplate(
                templateId,
                userId,
                variables
            );

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Error using prompt template:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to use template'
            });
        }
    }

    /**
     * Update a prompt template
     */
    static async updateTemplate(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;
            const userId = req.user!.id;
            const updates = req.body;

            const template = await PromptTemplateService.updateTemplate(
                templateId,
                userId,
                updates
            );

            res.json({
                success: true,
                data: template,
                message: 'Template updated successfully'
            });
        } catch (error: any) {
            loggingService.error('Error updating prompt template:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to update template'
            });
        }
    }

    /**
     * Delete a prompt template
     */
    static async deleteTemplate(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;
            const userId = req.user!.id;

            await PromptTemplateService.deleteTemplate(templateId, userId);

            res.json({
                success: true,
                message: 'Template deleted successfully'
            });
        } catch (error: any) {
            loggingService.error('Error deleting prompt template:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to delete template'
            });
        }
    }

    /**
     * Fork a prompt template
     */
    static async forkTemplate(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;
            const userId = req.user!.id;
            const { projectId } = req.body;

            const forkedTemplate = await PromptTemplateService.forkTemplate(
                templateId,
                userId,
                projectId
            );

            res.status(201).json({
                success: true,
                data: forkedTemplate,
                message: 'Template forked successfully'
            });
        } catch (error: any) {
            loggingService.error('Error forking prompt template:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to fork template'
            });
        }
    }

    /**
     * Add feedback to a prompt template
     */
    static async addFeedback(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;
            const userId = req.user!.id;
            const { rating, comment } = req.body;

            await PromptTemplateService.addTemplateFeedback(
                templateId,
                userId,
                rating,
                comment
            );

            res.json({
                success: true,
                message: 'Feedback added successfully'
            });
        } catch (error: any) {
            loggingService.error('Error adding template feedback:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to add feedback'
            });
        }
    }

    /**
     * Get template analytics
     */
    static async getTemplateAnalytics(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;

            const analytics = await PromptTemplateService.getTemplateAnalytics(templateId);

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            loggingService.error('Error getting template analytics:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get analytics'
            });
        }
    }

    /**
     * Get popular templates
     */
    static async getPopularTemplates(req: any, res: Response): Promise<void> {
        try {
            const { category, limit } = req.query;

            const templates = await PromptTemplateService.getPopularTemplates(
                category as string,
                limit ? parseInt(limit as string) : 10
            );

            res.json({
                success: true,
                data: templates
            });
        } catch (error: any) {
            loggingService.error('Error getting popular templates:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get popular templates'
            });
        }
    }

    /**
     * AI: Generate template from intent
     */
    static async generateFromIntent(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { intent, category, context, constraints } = req.body;

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
                intent,
                {
                    category,
                    details: context,
                    constraints
                }
            );

            const result = await Promise.race([generationPromise, timeoutPromise]);

            // Reset failure count on success
            this.aiFailureCount = 0;

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            PromptTemplateController.recordAiFailure(); 
            PromptTemplateController.conditionalLog('error', 'Error generating template from intent', {
                error: error.message || 'Unknown error'
            });
            
            if (error.message === 'AI generation timeout') {
                res.status(408).json({
                    success: false,
                    message: 'AI generation took too long. Please try again with a simpler request.'
                });
                return;
            }
            
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to generate template'
            });
        }
    }

    /**
     * AI: Detect variables in content
     */
    static async detectVariables(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { content, autoFillDefaults, validateTypes } = req.body;

            const result = await PromptTemplateService.detectVariables(
                content,
                userId,
                {
                    autoFillDefaults,
                    validateTypes
                }
            );

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Error detecting variables:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to detect variables'
            });
        }
    }

    /**
     * AI: Optimize template
     */
    static async optimizeTemplate(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { templateId } = req.params;
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

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Error optimizing template:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to optimize template'
            });
        }
    }

    /**
     * AI: Get template recommendations
     */
    static async getRecommendations(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { currentProject, taskType } = req.query;

            const recommendations = await PromptTemplateService.getRecommendations(
                userId,
                {
                    currentProject,
                    taskType
                }
            );

            res.json({
                success: true,
                data: recommendations
            });
        } catch (error: any) {
            loggingService.error('Error getting recommendations:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to get recommendations'
            });
        }
    }

    /**
     * AI: Predict template effectiveness
     */
    static async predictEffectiveness(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;
            const { variables } = req.body;
            const userId = req.user!.id;

            const effectiveness = await PromptTemplateService.predictEffectiveness(
                templateId,
                userId,
                variables
            );

            res.json({
                success: true,
                data: effectiveness
            });
        } catch (error: any) {
            loggingService.error('Error predicting effectiveness:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to predict effectiveness'
            });
        }
    }

    /**
     * AI: Get template insights
     */
    static async getInsights(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;

            const insights = await PromptTemplateService.getInsights(templateId);

            res.json({
                success: true,
                data: insights
            });
        } catch (error: any) {
            loggingService.error('Error getting insights:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to get insights'
            });
        }
    }

    /**
     * AI: Semantic search templates
     */
    static async searchSemantic(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { query, limit = 10 } = req.query;

            const results = await PromptTemplateService.searchSemantic(
                query,
                userId,
                parseInt(limit)
            );

            res.json({
                success: true,
                data: results
            });
        } catch (error: any) {
            loggingService.error('Error in semantic search:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to search templates'
            });
        }
    }

    /**
     * AI: Personalize template
     */
    static async personalizeTemplate(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { templateId } = req.params;

            const personalized = await PromptTemplateService.personalizeTemplate(
                templateId,
                userId
            );

            res.json({
                success: true,
                data: personalized
            });
        } catch (error: any) {
            loggingService.error('Error personalizing template:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to personalize template'
            });
        }
    }

    /**
     * AI: Apply optimization to template
     */
    static async applyOptimization(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { templateId } = req.params;
            const { optimizedContent, metadata } = req.body;

            const updated = await PromptTemplateService.applyOptimization(
                templateId,
                optimizedContent,
                userId,
                metadata
            );

            res.json({
                success: true,
                data: updated
            });
        } catch (error: any) {
            PromptTemplateController.recordAiFailure();
            PromptTemplateController.conditionalLog('error', 'Error applying optimization', {
                error: error.message || 'Unknown error'
            });
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to apply optimization'
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
        this.lastAiFailureTime = Date.now();
    }

    /**
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        PromptTemplateController.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        PromptTemplateController.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
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
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
        
        // Clear caches
        this.userProjectCache.clear();
    }
} 