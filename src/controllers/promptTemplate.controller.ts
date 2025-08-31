import { Response } from 'express';
import { PromptTemplateService } from '../services/promptTemplate.service';
import { loggingService } from '../services/logging.service';

export class PromptTemplateController {
    /**
     * Create a new prompt template
     */
    static async createTemplate(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Prompt template creation initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                templateName: req.body?.name,
                hasTemplateName: !!req.body?.name,
                templateCategory: req.body?.category,
                hasTemplateCategory: !!req.body?.category,
                templateTags: req.body?.tags,
                hasTemplateTags: !!req.body?.tags,
                templateVisibility: req.body?.visibility,
                hasTemplateVisibility: !!req.body?.visibility
            });

            if (!userId) {
                loggingService.warn('Prompt template creation failed - user not authenticated', {
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

            loggingService.info('Prompt template created successfully', {
                userId,
                duration,
                templateId: template._id,
                hasTemplateId: !!template._id,
                templateName: template.name,
                hasTemplateName: !!template.name,
                requestId
            });

            // Log business event
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

            res.status(201).json({
                success: true,
                data: template,
                message: 'Prompt template created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Prompt template creation failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
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
            loggingService.info('=== GET PROMPT TEMPLATES START ===');
            loggingService.info('Request headers:', req.headers);
            loggingService.info('Request query:', req.query);
            loggingService.info('User from auth middleware:', req.user);

            const userId = req.user!.id;
            loggingService.info('Extracted userId:', userId);

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
                category: category as string,
                tags: tags ? (tags as string).split(',') : undefined,
                visibility: visibility as string,
                search: search as string,
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 20
            };

            loggingService.info('Filters prepared:', filters);
            loggingService.info('Calling PromptTemplateService.getTemplates...');

            const result = await PromptTemplateService.getTemplates(filters);

            loggingService.info('Service call completed successfully');
            loggingService.info('Result:', {
                templatesCount: result.templates?.length || 0,
                total: result.total,
                page: result.page,
                pages: result.pages
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

            loggingService.info('Sending response...');
            res.json(response);
            loggingService.info('=== GET PROMPT TEMPLATES END ===');
        } catch (error: any) {
            loggingService.error('=== GET PROMPT TEMPLATES ERROR ===');
            loggingService.error('Error getting prompt templates:', error);
            loggingService.error('Error stack:', error.stack);
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
} 