import { PromptTemplate, IPromptTemplate } from '../models/PromptTemplate';
import { Project } from '../models/Project';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';
import { ActivityService } from './activity.service';
import { aiTemplateEngine } from './aiTemplateEngine.service';
import mongoose from 'mongoose';
import {
    CreateTemplateDto,
    UpdateTemplateDto,
    TemplateQueryParams,
    TemplateActivityType,
    ITemplateActivityMetadata,
    AITemplateGenerationRequest,
    AITemplateOptimizationRequest,
    OptimizationType
} from '../types/template.types';

// Helper function for tracking template activities
async function trackTemplateActivity(
    userId: string,
    activityType: TemplateActivityType,
    template: IPromptTemplate,
    additionalMetadata?: Partial<ITemplateActivityMetadata>
): Promise<void> {
    try {
        const baseMetadata: ITemplateActivityMetadata = {
            templateId: template._id,
            templateName: template.name,
            templateCategory: template.category,
            templateVersion: template.version,
            ...additionalMetadata
        };

        const activityTitles: Record<TemplateActivityType, string> = {
            'template_created': 'Template Created',
            'template_updated': 'Template Updated',
            'template_deleted': 'Template Deleted',
            'template_forked': 'Template Forked',
            'template_ai_generated': 'AI Template Generated',
            'template_optimized': 'Template Optimized',
            'template_used': 'Template Used',
            'template_shared': 'Template Shared',
            'template_feedback_added': 'Template Feedback Added',
            'template_variables_detected': 'Template Variables Detected',
            'template_effectiveness_predicted': 'Template Effectiveness Predicted'
        };

        const activityDescriptions: Record<TemplateActivityType, string> = {
            'template_created': `Created template "${template.name}" in ${template.category} category`,
            'template_updated': `Updated template "${template.name}" to version ${template.version}`,
            'template_deleted': `Deleted template "${template.name}"`,
            'template_forked': `Forked template "${template.name}"`,
            'template_ai_generated': `Generated template "${template.name}" using AI${additionalMetadata?.intent ? ` from intent: "${additionalMetadata.intent}"` : ''}`,
            'template_optimized': `Optimized template "${template.name}"${additionalMetadata?.optimizationType ? ` for ${additionalMetadata.optimizationType}` : ''}`,
            'template_used': `Used template "${template.name}"${additionalMetadata?.variablesUsed ? ` with ${Object.keys(additionalMetadata.variablesUsed).length} variables` : ''}`,
            'template_shared': `Shared template "${template.name}" with visibility: ${template.sharing.visibility}`,
            'template_feedback_added': `Added feedback to template "${template.name}"${additionalMetadata?.rating ? ` (Rating: ${additionalMetadata.rating}/5)` : ''}`,
            'template_variables_detected': `Detected ${additionalMetadata?.variablesCount || 0} variables in template "${template.name}"`,
            'template_effectiveness_predicted': `Predicted effectiveness for template "${template.name}"${additionalMetadata?.effectivenessScore ? ` (Score: ${additionalMetadata.effectivenessScore}%)` : ''}`
        };

        await ActivityService.trackActivity(userId, {
            type: activityType,
            title: activityTitles[activityType],
            description: activityDescriptions[activityType],
            metadata: baseMetadata
        });
    } catch (error) {
        loggingService.warn(`Failed to track template activity: ${activityType}`, error as Error);
    }
}

export class PromptTemplateService {
    /**
     * Create a new prompt template
     */
    static async createTemplate(
        userId: string,
        data: CreateTemplateDto
    ): Promise<IPromptTemplate> {
        try {
            // Verify project access if projectId is provided
            if (data.projectId) {
                const project = await Project.findById(data.projectId);
                if (!project) {
                    throw new Error('Project not found');
                }

                // Check if user is member
                const ownerIdString = typeof project.ownerId === 'object' && project.ownerId._id 
                    ? project.ownerId._id.toString() 
                    : project.ownerId.toString();
                const isMember = ownerIdString === userId ||
                    project.members.some(m => {
                        const memberIdString = typeof m.userId === 'object' && m.userId._id 
                            ? m.userId._id.toString() 
                            : m.userId.toString();
                        return memberIdString === userId;
                    });

                if (!isMember) {
                    throw new Error('Unauthorized: Not a member of the project');
                }
            }

            // Estimate tokens if not provided
            const estimatedTokens = data.metadata?.estimatedTokens ||
                this.estimateTokenCount(data.content);

            const template = await PromptTemplate.create({
                ...data,
                createdBy: userId,
                metadata: {
                    ...data.metadata,
                    estimatedTokens,
                    tags: data.metadata?.tags || []
                },
                sharing: {
                    visibility: data.sharing?.visibility || 'private',
                    sharedWith: data.sharing?.sharedWith?.map(id =>
                        new mongoose.Types.ObjectId(id)
                    ) || [],
                    allowFork: data.sharing?.allowFork !== false
                }
            });

            // Track template creation activity
            await trackTemplateActivity(userId, 'template_created', template);

            loggingService.info(`Prompt template created: ${template.name} by user ${userId}`);
            return template;
        } catch (error) {
            loggingService.error('Error creating prompt template:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get accessible prompt templates for a user
     */
    static async getTemplates(query: TemplateQueryParams): Promise<{
        templates: IPromptTemplate[];
        total: number;
        page: number;
        pages: number;
    }> {
        try {
            loggingService.info('=== PROMPT TEMPLATE SERVICE: getTemplates START ===');
            loggingService.info('Query received:', { value:  { value: query  } });

            const {
                userId,
                projectId,
                category,
                tags,
                visibility,
                search,
                page = 1,
                limit = 20
            } = query;

            loggingService.info('Destructured query params:', { value:  { 
                userId,
                projectId,
                category,
                tags,
                visibility,
                search,
                page,
                limit
             } });

            // Get user's projects for access control
            loggingService.info('Getting user projects for access control...');
            const userProjects = await Project.find({
                $or: [
                    { ownerId: userId },
                    { 'members.userId': userId }
                ],
                isActive: true
            }).select('_id');

            loggingService.info('User projects found:', { value:  { value: userProjects.length  } });
            const userProjectIds = userProjects.map(p => p._id.toString());
            loggingService.info('User project IDs:', { value:  { value: userProjectIds  } });

            // Build query
            loggingService.info('Building filter query...');
            const filter: any = {
                isActive: true,
                isDeleted: false,
                $or: [
                    { createdBy: userId }, // Own templates
                    { 'sharing.visibility': 'public' }, // Public templates
                    {
                        'sharing.visibility': 'project',
                        projectId: { $in: userProjectIds }
                    }, // Project templates
                    { 'sharing.sharedWith': userId } // Explicitly shared
                ]
            };

            if (projectId) {
                filter.projectId = projectId;
                loggingService.info('Added projectId filter:', { value:  { value: projectId  } });
            }

            if (category) {
                filter.category = category;
                loggingService.info('Added category filter:', { value:  { value: category  } });
            }

            if (tags && tags.length > 0) {
                filter['metadata.tags'] = { $in: tags };
                loggingService.info('Added tags filter:', { value:  { value: tags  } });
            }

            if (visibility) {
                filter['sharing.visibility'] = visibility;
                loggingService.info('Added visibility filter:', { value:  { value: visibility  } });
            }

            if (search) {
                filter.$text = { $search: search };
                loggingService.info('Added search filter:', { value:  { value: search  } });
            }

            loggingService.info('Final filter:', { value: JSON.stringify(filter, null, 2) });

            const skip = (page - 1) * limit;
            loggingService.info('Pagination:', { value:  {  skip, limit, page  } });

            loggingService.info('Executing MongoDB queries...');
            const [templates, total] = await Promise.all([
                PromptTemplate.find(filter)
                    .populate('createdBy', 'name email')
                    .sort({ 'usage.count': -1, createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
                PromptTemplate.countDocuments(filter)
            ]);

            loggingService.info('MongoDB queries completed');
            loggingService.info('Results:', {
                templatesFound: templates.length,
                totalCount: total,
                page,
                pages: Math.ceil(total / limit)
            });

            const result = {
                templates,
                total,
                page,
                pages: Math.ceil(total / limit)
            };

            loggingService.info('=== PROMPT TEMPLATE SERVICE: getTemplates END ===');
            return result;
        } catch (error: any) {
            loggingService.error('=== PROMPT TEMPLATE SERVICE: getTemplates ERROR ===');
            loggingService.error('Error getting prompt templates:', { error: error instanceof Error ? error.message : String(error) });
            loggingService.error('Error stack:', error.stack);
            throw error;
        }
    }

    /**
     * Use a prompt template
     */
    static async useTemplate(
        templateId: string,
        userId: string,
        variables?: Record<string, any>
    ): Promise<{
        prompt: string;
        estimatedTokens: number;
        estimatedCost?: number;
    }> {
        try {
            const template = await PromptTemplate.findById(templateId);
            if (!template || !template.isActive) {
                throw new Error('Template not found');
            }

            // Check access
            const userProjects = await Project.find({
                $or: [
                    { ownerId: userId },
                    { 'members.userId': userId }
                ]
            }).select('_id');

            const userProjectIds = userProjects.map(p => p._id.toString());

            // Check access manually
            const canAccess =
                template.createdBy.toString() === userId ||
                template.sharing.visibility === 'public' ||
                (template.sharing.visibility === 'project' &&
                    template.projectId && userProjectIds.includes(template.projectId.toString())) ||
                template.sharing.sharedWith.some(id => id.toString() === userId);

            if (!canAccess) {
                throw new Error('Unauthorized: Cannot access this template');
            }

            // Process variables
            let prompt = template.content;
            if (template.variables && template.variables.length > 0) {
                for (const variable of template.variables) {
                    const value = variables?.[variable.name] || variable.defaultValue || '';
                    if (variable.required && !value) {
                        throw new Error(`Required variable missing: ${variable.name}`);
                    }
                    const regex = new RegExp(`{{${variable.name}}}`, 'g');
                    prompt = prompt.replace(regex, value);
                }
            }

            // Update usage statistics
            template.usage.count += 1;
            template.usage.lastUsed = new Date();
            await template.save();

            // Track template usage activity
            await trackTemplateActivity(userId, 'template_used', template, {
                variablesUsed: variables || {}
            });

            return {
                prompt,
                estimatedTokens: template.metadata.estimatedTokens || this.estimateTokenCount(prompt),
                estimatedCost: template.metadata.estimatedCost
            };
        } catch (error) {
            loggingService.error('Error using prompt template:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Fork a prompt template
     */
    static async forkTemplate(
        templateId: string,
        userId: string,
        projectId?: string
    ): Promise<IPromptTemplate> {
        try {
            const originalTemplate = await PromptTemplate.findById(templateId);
            if (!originalTemplate || !originalTemplate.isActive) {
                throw new Error('Template not found');
            }

            if (!originalTemplate.sharing.allowFork) {
                throw new Error('This template cannot be forked');
            }

            // Create forked template manually
            const forkedTemplate = new PromptTemplate({
                ...originalTemplate.toObject(),
                _id: undefined,
                createdBy: userId,
                projectId: projectId || originalTemplate.projectId,
                parentId: originalTemplate._id,
                version: 1,
                usage: {
                    count: 0,
                    totalTokensSaved: 0,
                    totalCostSaved: 0,
                    feedback: []
                },
                createdAt: undefined,
                updatedAt: undefined
            });

            await forkedTemplate.save();

            // Track template fork activity
            await trackTemplateActivity(userId, 'template_forked', forkedTemplate, {
                originalTemplateId: originalTemplate._id,
                forkedTemplateId: forkedTemplate._id
            });

            return forkedTemplate;
        } catch (error) {
            loggingService.error('Error forking prompt template:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Update template usage after API call
     */
    static async updateTemplateUsage(
        templateId: string,
        usage: {
            tokensSaved?: number;
            costSaved?: number;
        }
    ): Promise<void> {
        try {
            await PromptTemplate.findByIdAndUpdate(templateId, {
                $inc: {
                    'usage.totalTokensSaved': usage.tokensSaved || 0,
                    'usage.totalCostSaved': usage.costSaved || 0
                }
            });
        } catch (error) {
            loggingService.error('Error updating template usage:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Add feedback to template
     */
    static async addTemplateFeedback(
        templateId: string,
        userId: string,
        rating: number,
        comment?: string
    ): Promise<void> {
        try {
            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            // Remove existing feedback from user
            template.usage.feedback = template.usage.feedback.filter(
                f => f.userId.toString() !== userId
            );

            // Add new feedback
            template.usage.feedback.push({
                userId: new mongoose.Types.ObjectId(userId),
                rating,
                comment,
                createdAt: new Date()
            });

            // Recalculate average rating
            const totalRating = template.usage.feedback.reduce(
                (sum, f) => sum + f.rating, 0
            );
            template.usage.averageRating = totalRating / template.usage.feedback.length;

            await template.save();
        } catch (error) {
            loggingService.error('Error adding template feedback:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get template analytics
     */
    static async getTemplateAnalytics(templateId: string): Promise<any> {
        try {
            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            // Get usage by model
            const usageByModel = await Usage.aggregate([
                {
                    $match: {
                        'metadata.promptTemplateId': new mongoose.Types.ObjectId(templateId)
                    }
                },
                {
                    $group: {
                        _id: '$model',
                        count: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        avgTokens: { $avg: '$totalTokens' }
                    }
                }
            ]);

            // Get usage over time
            const usageOverTime = await Usage.aggregate([
                {
                    $match: {
                        'metadata.promptTemplateId': new mongoose.Types.ObjectId(templateId)
                    }
                },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        count: { $sum: 1 },
                        totalCost: { $sum: '$cost' }
                    }
                },
                { $sort: { _id: 1 } }
            ]);

            return {
                template: {
                    id: template._id,
                    name: template.name,
                    category: template.category,
                    usage: template.usage
                },
                analytics: {
                    byModel: usageByModel,
                    overTime: usageOverTime,
                    totalUses: template.usage.count,
                    averageRating: template.usage.averageRating,
                    totalSaved: template.usage.totalCostSaved
                }
            };
        } catch (error) {
            loggingService.error('Error getting template analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get popular templates
     */
    static async getPopularTemplates(
        category?: string,
        limit: number = 10
    ): Promise<IPromptTemplate[]> {
        const filter: any = {
            isActive: true,
            isDeleted: false,
            'sharing.visibility': 'public',
            'usage.count': { $gt: 0 }
        };

        if (category) {
            filter.category = category;
        }

        return PromptTemplate.find(filter)
            .sort({ 'usage.count': -1, 'usage.averageRating': -1 })
            .limit(limit)
            .populate('createdBy', 'name');
    }

    /**
     * Helper to estimate token count
     */
    private static estimateTokenCount(text: string): number {
        // Rough estimation: 1 token ≈ 4 characters
        return Math.ceil(text.length / 4);
    }

    /**
     * Get template by ID
     */
    static async getTemplateById(templateId: string, userId: string): Promise<IPromptTemplate> {
        const template = await PromptTemplate.findById(templateId)
            .populate('createdBy', 'name email');

        if (!template || !template.isActive || template.isDeleted) {
            throw new Error('Template not found');
        }

        // Check access
        const userProjects = await Project.find({
            $or: [
                { ownerId: userId },
                { 'members.userId': userId }
            ]
        }).select('_id');

        const userProjectIds = userProjects.map(p => p._id.toString());

        // Check access manually
        const canAccess =
            template.createdBy.toString() === userId ||
            template.sharing.visibility === 'public' ||
            (template.sharing.visibility === 'project' &&
                template.projectId && userProjectIds.includes(template.projectId.toString())) ||
            template.sharing.sharedWith.some(id => id.toString() === userId);

        if (!canAccess) {
            throw new Error('Unauthorized: Cannot access this template');
        }

        return template;
    }

    /**
     * Update template
     */
    static async updateTemplate(
        templateId: string,
        userId: string,
        updates: Partial<IPromptTemplate>
    ): Promise<IPromptTemplate> {
        const template = await PromptTemplate.findById(templateId);

        if (!template || !template.isActive || template.isDeleted) {
            throw new Error('Template not found');
        }

        // Only creator can update
        if (template.createdBy.toString() !== userId) {
            throw new Error('Unauthorized: Only the creator can update this template');
        }

        // Update allowed fields
        const allowedUpdates = [
            'name', 'description', 'content', 'category',
            'variables', 'metadata', 'sharing'
        ];

        allowedUpdates.forEach(field => {
            if (updates[field as keyof IPromptTemplate] !== undefined) {
                (template as any)[field] = updates[field as keyof IPromptTemplate];
            }
        });

        // Increment version if content changed
        if (updates.content && updates.content !== template.content) {
            template.version += 1;
        }

        await template.save();

        // Track template update activity
        await trackTemplateActivity(userId, 'template_updated', template);

        return template;
    }

    /**
     * Delete template (soft delete)
     */
    static async deleteTemplate(templateId: string, userId: string): Promise<void> {
        const template = await PromptTemplate.findById(templateId);

        if (!template || !template.isActive || template.isDeleted) {
            throw new Error('Template not found');
        }

        // Only creator can delete
        if (template.createdBy.toString() !== userId) {
            throw new Error('Unauthorized: Only the creator can delete this template');
        }

        template.isDeleted = true;
        template.isActive = false;
        await template.save();

        // Track template deletion activity
        await trackTemplateActivity(userId, 'template_deleted', template);
    }

    /**
     * Generate template from AI intent
     */
    static async generateTemplateFromIntent(
        userId: string,
        intent: string,
        context?: any
    ): Promise<any> {
        try {
            loggingService.info('🤖 Generating template from intent', {
                userId,
                intent,
                context
            });

            const result = await aiTemplateEngine.generateTemplateFromIntent({
                userId,
                intent,
                category: context?.category,
                context: context?.details,
                constraints: context?.constraints
            });

            // Save the generated template
            const template = await this.createTemplate(userId, {
                ...result.template,
                metadata: {
                    ...result.template.metadata,
                    aiGenerated: true,
                    generationConfidence: result.metadata.confidence
                }
            });

            // Track AI template generation activity
            await trackTemplateActivity(userId, 'template_ai_generated', template, {
                intent,
                confidence: result.metadata.confidence,
                alternatives: result.metadata.alternativeVersions?.length || 0
            });

            return {
                template,
                metadata: result.metadata,
                alternatives: result.metadata.alternativeVersions
            };
        } catch (error: any) {
            loggingService.error('Failed to generate template from intent', error);
            throw error;
        }
    }

    /**
     * Detect variables in template content
     */
    static async detectVariables(
        content: string,
        userId: string,
        options?: {
            autoFillDefaults?: boolean;
            validateTypes?: boolean;
        }
    ): Promise<any> {
        try {
            const result = await aiTemplateEngine.detectVariables({
                content,
                userId,
                autoFillDefaults: options?.autoFillDefaults,
                validateTypes: options?.validateTypes
            });

            // Track variables detection activity (using general activity tracking since we don't have a specific template)
            await ActivityService.trackActivity(userId, {
                type: 'settings_updated',
                title: 'Template Variables Detected',
                description: `Detected ${result.variables?.length || 0} variables using AI`,
                metadata: {
                    variablesCount: result.variables?.length || 0,
                    detectedVariables: result.variables?.map(v => v.name) || []
                }
            });

            return result;
        } catch (error: any) {
            loggingService.error('Failed to detect variables', error);
            throw error;
        }
    }

    /**
     * Optimize an existing template
     */
    static async optimizeTemplate(
        templateId: string,
        userId: string,
        optimizationType: 'token' | 'cost' | 'quality' | 'model-specific',
        options?: {
            targetModel?: string;
            preserveIntent?: boolean;
        }
    ): Promise<any> {
        try {
            // Check access
            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            const canEdit = await this.canEditTemplate(templateId, userId);
            if (!canEdit) {
                throw new Error('Unauthorized: Cannot optimize this template');
            }

            const result = await aiTemplateEngine.optimizeTemplate({
                templateId,
                userId,
                optimizationType,
                targetModel: options?.targetModel,
                preserveIntent: options?.preserveIntent
            });

            // Track template optimization activity
            if (template) {
                await trackTemplateActivity(userId, 'template_optimized', template, {
                    optimizationType,
                    tokenReduction: result.metrics.tokenReduction,
                    costSaving: result.metrics.costSaving
                });
            }

            return result;
        } catch (error: any) {
            loggingService.error('Failed to optimize template', error);
            throw error;
        }
    }

    /**
     * Get AI-powered template recommendations
     */
    static async getRecommendations(
        userId: string,
        context?: {
            currentProject?: string;
            recentActivity?: string[];
            taskType?: string;
        }
    ): Promise<any[]> {
        try {
            const recommendations = await aiTemplateEngine.getTemplateRecommendations(
                userId,
                context || {}
            );

            // Track template recommendations viewed (using general activity tracking)
            await ActivityService.trackActivity(userId, {
                type: 'settings_updated',
                title: 'Template Recommendations Viewed',
                description: `Viewed ${recommendations.length} template recommendations`,
                metadata: {
                    count: recommendations.length,
                    context
                }
            });

            return recommendations;
        } catch (error: any) {
            loggingService.error('Failed to get recommendations', error);
            throw error;
        }
    }

    /**
     * Predict template effectiveness
     */
    static async predictEffectiveness(
        templateId: string,
        userId: string,
        variables?: Record<string, any>
    ): Promise<any> {
        try {
            const effectiveness = await aiTemplateEngine.predictEffectiveness(
                templateId,
                variables
            );

            // Track effectiveness prediction activity
            const template = await PromptTemplate.findById(templateId);
            if (template) {
                await trackTemplateActivity(userId, 'template_effectiveness_predicted', template, {
                    effectivenessScore: effectiveness.overall,
                    clarity: effectiveness.clarity,
                    specificity: effectiveness.specificity,
                    tokenEfficiency: effectiveness.tokenEfficiency,
                    expectedOutputQuality: effectiveness.expectedOutputQuality
                });
            }

            return effectiveness;
        } catch (error: any) {
            loggingService.error('Failed to predict effectiveness', error);
            throw error;
        }
    }

    /**
     * Get AI insights for a template
     */
    static async getInsights(templateId: string): Promise<any> {
        try {
            const insights = await aiTemplateEngine.getTemplateInsights(templateId);
            return insights;
        } catch (error: any) {
            loggingService.error('Failed to get insights', error);
            throw error;
        }
    }

    /**
     * Semantic search for templates
     */
    static async searchSemantic(
        query: string,
        userId: string,
        limit: number = 10
    ): Promise<any[]> {
        try {
            const results = await aiTemplateEngine.searchTemplatesSemantic(
                query,
                userId,
                limit
            );

            return results;
        } catch (error: any) {
            loggingService.error('Failed semantic search', error);
            throw error;
        }
    }

    /**
     * Personalize template for user
     */
    static async personalizeTemplate(
        templateId: string,
        userId: string
    ): Promise<any> {
        try {
            const personalized = await aiTemplateEngine.personalizeTemplate(
                templateId,
                userId
            );

            return personalized;
        } catch (error: any) {
            loggingService.error('Failed to personalize template', error);
            throw error;
        }
    }

    /**
     * Apply optimized version to template
     */
    static async applyOptimization(
        templateId: string,
        optimizedContent: string,
        userId: string,
        metadata?: any
    ): Promise<IPromptTemplate> {
        try {
            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            // Check permissions
            const canEdit = await this.canEditTemplate(templateId, userId);
            if (!canEdit) {
                throw new Error('Unauthorized: Cannot edit this template');
            }

            // Store original version history
            const originalVersion = {
                content: template.content,
                metadata: template.metadata,
                version: template.version,
                updatedAt: template.updatedAt
            };

            // Update with optimized content
            template.content = optimizedContent;
            template.version = template.version + 1;
            template.metadata = {
                ...template.metadata,
                ...metadata,
                lastOptimized: new Date()
                // Note: previousVersions would need to be added to the schema
                // previousVersions: [
                //     ...(template.metadata.previousVersions || []),
                //     originalVersion
                // ]
            };

            await template.save();

            // Track optimization application activity
            await trackTemplateActivity(userId, 'template_optimized', template, {
                optimizationType: metadata?.optimizationType,
                tokenReduction: metadata?.tokenReduction,
                costSaving: metadata?.costSaving
            });

            return template;
        } catch (error: any) {
            loggingService.error('Failed to apply optimization', error);
            throw error;
        }
    }

    /**
     * Check if user can edit template
     */
    private static async canEditTemplate(templateId: string, userId: string): Promise<boolean> {
        const template = await PromptTemplate.findById(templateId);
        if (!template) return false;

        // Owner can always edit
        if (template.createdBy.toString() === userId) return true;

        // Check project membership if template is project-based
        if (template.projectId) {
            const project = await Project.findOne({
                _id: template.projectId,
                $or: [
                    { ownerId: userId },
                    { 'members.userId': userId, 'members.role': { $in: ['admin', 'editor'] } }
                ]
            });
            return !!project;
        }

        return false;
    }
} 