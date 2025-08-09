import { Response } from 'express';
import { PromptTemplateService } from '../services/promptTemplate.service';
import { logger } from '../utils/logger';

export class PromptTemplateController {
    /**
     * Create a new prompt template
     */
    static async createTemplate(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const templateData = req.body;

            const template = await PromptTemplateService.createTemplate(userId, templateData);

            res.status(201).json({
                success: true,
                data: template,
                message: 'Prompt template created successfully'
            });
        } catch (error: any) {
            logger.error('Error creating prompt template:', error);
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
            logger.info('=== GET PROMPT TEMPLATES START ===');
            logger.info('Request headers:', req.headers);
            logger.info('Request query:', req.query);
            logger.info('User from auth middleware:', req.user);

            const userId = req.user!.id;
            logger.info('Extracted userId:', userId);

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

            logger.info('Filters prepared:', filters);
            logger.info('Calling PromptTemplateService.getTemplates...');

            const result = await PromptTemplateService.getTemplates(filters);

            logger.info('Service call completed successfully');
            logger.info('Result:', {
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

            logger.info('Sending response...');
            res.json(response);
            logger.info('=== GET PROMPT TEMPLATES END ===');
        } catch (error: any) {
            logger.error('=== GET PROMPT TEMPLATES ERROR ===');
            logger.error('Error getting prompt templates:', error);
            logger.error('Error stack:', error.stack);
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
            logger.error('Error getting prompt template:', error);
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
            logger.error('Error using prompt template:', error);
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
            logger.error('Error updating prompt template:', error);
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
            logger.error('Error deleting prompt template:', error);
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
            logger.error('Error forking prompt template:', error);
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
            logger.error('Error adding template feedback:', error);
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
            logger.error('Error getting template analytics:', error);
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
            logger.error('Error getting popular templates:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get popular templates'
            });
        }
    }
} 