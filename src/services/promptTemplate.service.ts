import { PromptTemplate, IPromptTemplate } from '../models/PromptTemplate';
import { Project } from '../models/Project';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';
import { ActivityService } from './activity.service';
import { aiTemplateEngine } from './aiTemplateEngine.service';
import mongoose from 'mongoose';
import {
    CreateTemplateDto,
    DuplicateTemplateDto,
    TemplateQueryParams,
    TemplateActivityType,
    ITemplateActivityMetadata,
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
            'template_duplicated': 'Template Duplicated',
            'template_ai_generated': 'AI Template Generated',
            'template_optimized': 'Template Optimized',
            'template_used': 'Template Used',
            'template_used_with_context': 'Template Used with Context',
            'template_shared': 'Template Shared',
            'template_feedback_added': 'Template Feedback Added',
            'template_variables_detected': 'Template Variables Detected',
            'template_effectiveness_predicted': 'Template Effectiveness Predicted'
        };

        const activityDescriptions: Record<TemplateActivityType, string> = {
            'template_created': `Created template "${template.name}" in ${template.category} category`,
            'template_updated': `Updated template "${template.name}" to version ${template.version}`,
            'template_deleted': `Deleted template "${template.name}"`,
            'template_duplicated': `Duplicated template "${template.name}"`,
            'template_ai_generated': `Generated template "${template.name}" using AI${additionalMetadata?.intent ? ` from intent: "${additionalMetadata.intent}"` : ''}`,
            'template_optimized': `Optimized template "${template.name}"${additionalMetadata?.optimizationType ? ` for ${additionalMetadata.optimizationType}` : ''}`,
            'template_used': `Used template "${template.name}"${additionalMetadata?.variablesUsed ? ` with ${Object.keys(additionalMetadata.variablesUsed).length} variables` : ''}`,
            'template_used_with_context': `Used template "${template.name}" with context-aware resolution${additionalMetadata?.resolvedVariables ? ` (${Object.keys(additionalMetadata.resolvedVariables).length} variables resolved)` : ''}`,
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
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Access control optimization
    private static userProjectCache = new Map<string, { projects: string[]; timestamp: number }>();
    private static readonly PROJECT_CACHE_TTL = 300000; // 5 minutes
    
    // Circuit breaker for AI services
    private static aiFailureCount: number = 0;
    private static readonly MAX_AI_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastAiFailureTime: number = 0;
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }
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

                // Check if user has access via workspace or is owner
                const { PermissionService } = await import('./permission.service');
                const canAccess = await PermissionService.canAccessProject(userId, data.projectId);

                if (!canAccess) {
                    throw new Error('Unauthorized: Cannot access this project');
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

            // Queue background activity tracking
            this.queueBackgroundOperation(async () => {
                await trackTemplateActivity(userId, 'template_created', template);
            });

            this.conditionalLog('info', `Prompt template created: ${template.name} by user ${userId}`);
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

            // Get user's projects for access control (with optimization)
            const userProjectIds = await this.getUserProjectIds(userId);

            // Build query
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
            }

            if (category) {
                filter.category = category;
            }

            if (tags && tags.length > 0) {
                filter['metadata.tags'] = { $in: tags };
            }

            if (visibility) {
                filter['sharing.visibility'] = visibility;
            }

            if (search) {
                filter.$text = { $search: search };
            }

            const skip = (page - 1) * limit;

            // Parallel database operations
            const [templates, total] = await Promise.all([
                PromptTemplate.find(filter)
                    .populate('createdBy', 'name email')
                    .sort({ 'usage.count': -1, createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(), // Use lean for better performance
                PromptTemplate.countDocuments(filter)
            ]);

            this.conditionalLog('info', 'Templates query completed', {
                templatesFound: templates.length,
                totalCount: total,
                page
            });

            const result = {
                templates,
                total,
                page,
                pages: Math.ceil(total / limit)
            };

            return result;
        } catch (error: any) {
            loggingService.error('Error getting prompt templates:', { error: error instanceof Error ? error.message : String(error) });
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

            // Check access (optimized)
            const userProjectIds = await this.getUserProjectIds(userId);

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

            // Update usage statistics (background)
            this.queueBackgroundOperation(async () => {
                await PromptTemplate.findByIdAndUpdate(templateId, {
                    $inc: { 'usage.count': 1 },
                    $set: { 'usage.lastUsed': new Date() }
                });
                
                await trackTemplateActivity(userId, 'template_used', template, {
                    variablesUsed: variables || {}
                });
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
     * Use a prompt template with intelligent context-aware variable resolution
     * This method integrates with conversation history to auto-fill variables
     */
    static async useTemplateWithContext(
        templateId: string,
        userId: string,
        options: {
            userProvidedVariables?: Record<string, any>;
            conversationHistory?: Array<{
                role: 'user' | 'assistant';
                content: string;
            }>;
        }
    ): Promise<{
        prompt: string;
        estimatedTokens: number;
        estimatedCost?: number;
        resolutionDetails: Array<{
            variableName: string;
            value: string;
            confidence: number;
            source: 'user_provided' | 'context_inferred' | 'default' | 'missing';
            reasoning?: string;
        }>;
        template: {
            id: string;
            name: string;
            category: string;
        };
    }> {
        try {
            const { TemplateContextResolverService } = await import('./templateContextResolver.service');

            loggingService.info('Using template with context resolution', {
                templateId,
                userId,
                hasHistory: !!options.conversationHistory?.length,
                providedVariables: Object.keys(options.userProvidedVariables || {})
            });

            // Fetch template
            const template = await PromptTemplate.findById(templateId);
            if (!template || !template.isActive) {
                throw new Error('Template not found or inactive');
            }

            // Check access (optimized)
            const userProjectIds = await this.getUserProjectIds(userId);

            const canAccess =
                template.createdBy.toString() === userId ||
                template.sharing.visibility === 'public' ||
                (template.sharing.visibility === 'project' &&
                    template.projectId && userProjectIds.includes(template.projectId.toString())) ||
                template.sharing.sharedWith.some(id => id.toString() === userId);

            if (!canAccess) {
                throw new Error('Unauthorized: Cannot access this template');
            }

            // Resolve variables using context
            const { resolvedVariables, resolutionDetails, allRequiredProvided } = 
                await TemplateContextResolverService.resolveVariables({
                    conversationHistory: options.conversationHistory || [],
                    userProvidedVariables: options.userProvidedVariables,
                    templateVariables: template.variables || []
                });

            // Check if all required variables are provided
            if (!allRequiredProvided) {
                const missingRequired = resolutionDetails
                    .filter(r => r.source === 'missing' && 
                        template.variables?.find(v => v.name === r.variableName)?.required)
                    .map(r => r.variableName);

                throw new Error(
                    `Required variables missing: ${missingRequired.join(', ')}. ` +
                    `Please provide these variables or ensure they are mentioned in the conversation.`
                );
            }

            // Process template with resolved variables
            let prompt = template.content;
            if (template.variables && template.variables.length > 0) {
                for (const variable of template.variables) {
                    const value = resolvedVariables[variable.name] || '';
                    const regex = new RegExp(`{{${variable.name}}}`, 'g');
                    prompt = prompt.replace(regex, value);
                }
            }

            // Update usage statistics (background)
            this.queueBackgroundOperation(async () => {
                await PromptTemplate.findByIdAndUpdate(templateId, {
                    $inc: { 'usage.count': 1 },
                    $set: { 'usage.lastUsed': new Date() }
                });
                
                await trackTemplateActivity(userId, 'template_used_with_context', template, {
                    resolvedVariables,
                    resolutionDetails,
                    contextUsed: !!options.conversationHistory?.length
                });
            });

            const estimatedTokens = template.metadata.estimatedTokens || this.estimateTokenCount(prompt);

            loggingService.info('Template resolved successfully with context', {
                templateId,
                variablesResolved: resolutionDetails.length,
                contextInferred: resolutionDetails.filter(r => r.source === 'context_inferred').length,
                estimatedTokens
            });

            return {
                prompt,
                estimatedTokens,
                estimatedCost: template.metadata.estimatedCost,
                resolutionDetails,
                template: {
                    id: template._id.toString(),
                    name: template.name,
                    category: template.category
                }
            };
        } catch (error) {
            loggingService.error('Error using template with context:', { 
                error: error instanceof Error ? error.message : String(error),
                templateId,
                userId
            });
            throw error;
        }
    }

    /**
     * Duplicate a template (create an independent copy)
     */
    static async duplicateTemplate(
        templateId: string,
        userId: string,
        customizations?: DuplicateTemplateDto
    ): Promise<IPromptTemplate> {
        try {
            const originalTemplate = await PromptTemplate.findById(templateId);
            if (!originalTemplate || !originalTemplate.isActive) {
                throw new Error('Template not found');
            }

            // Generate default name if not provided
            const duplicateName = customizations?.name || `Copy of ${originalTemplate.name}`;

            // Create duplicated template as an independent copy (no parentId)
            const duplicatedTemplate = new PromptTemplate({
                ...originalTemplate.toObject(),
                _id: undefined,
                name: duplicateName,
                description: customizations?.description !== undefined ? customizations.description : originalTemplate.description,
                category: customizations?.category || originalTemplate.category,
                createdBy: userId,
                projectId: customizations?.projectId || originalTemplate.projectId,
                parentId: undefined, // Independent copy
                version: 1,
                usage: {
                    count: 0,
                    totalTokensSaved: 0,
                    totalCostSaved: 0,
                    feedback: []
                },
                metadata: {
                    ...originalTemplate.metadata,
                    ...customizations?.metadata,
                    tags: customizations?.metadata?.tags || originalTemplate.metadata?.tags || []
                },
                sharing: {
                    visibility: customizations?.sharing?.visibility || 'private',
                    sharedWith: customizations?.sharing?.sharedWith || [],
                    allowFork: customizations?.sharing?.allowFork !== undefined ? customizations.sharing.allowFork : true
                },
                createdAt: undefined,
                updatedAt: undefined
            });

            await duplicatedTemplate.save();

            // Track template duplicate activity
            await trackTemplateActivity(userId, 'template_duplicated', duplicatedTemplate, {
                originalTemplateId: originalTemplate._id,
                duplicatedTemplateId: duplicatedTemplate._id
            });

            return duplicatedTemplate;
        } catch (error) {
            loggingService.error('Error duplicating prompt template:', { error: error instanceof Error ? error.message : String(error) });
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

            // Unified analytics query using $facet for better performance
            const analyticsResults = await Usage.aggregate([
                {
                    $match: {
                        'metadata.promptTemplateId': new mongoose.Types.ObjectId(templateId)
                    }
                },
                {
                    $facet: {
                        byModel: [
                            {
                                $group: {
                                    _id: '$model',
                                    count: { $sum: 1 },
                                    totalCost: { $sum: '$cost' },
                                    avgTokens: { $avg: '$totalTokens' }
                                }
                            }
                        ],
                        overTime: [
                            {
                                $group: {
                                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                                    count: { $sum: 1 },
                                    totalCost: { $sum: '$cost' }
                                }
                            },
                            { $sort: { _id: 1 } }
                        ]
                    }
                }
            ]);

            const usageByModel = analyticsResults[0]?.byModel || [];
            const usageOverTime = analyticsResults[0]?.overTime || [];

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
     * Get trending templates based on recent usage growth
     */
    static async getTrendingTemplates(
        period: 'day' | 'week' | 'month' = 'week',
        category?: string,
        limit: number = 10
    ): Promise<IPromptTemplate[]> {
        // Calculate the date threshold based on period
        const now = new Date();
        const periodMap = {
            day: 1,
            week: 7,
            month: 30
        };
        const daysAgo = periodMap[period];
        const dateThreshold = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));

        const filter: any = {
            isActive: true,
            isDeleted: false,
            'sharing.visibility': 'public',
            'usage.lastUsedAt': { $gte: dateThreshold }
        };

        if (category) {
            filter.category = category;
        }

        // Sort by recent usage and rating
        return PromptTemplate.find(filter)
            .sort({ 
                'usage.lastUsedAt': -1, 
                'usage.count': -1, 
                'usage.averageRating': -1 
            })
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

            // Check access (optimized)
            const userProjectIds = await this.getUserProjectIds(userId);

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

    /**
     * Optimized user project access control
     */
    private static async getUserProjectIds(userId: string): Promise<string[]> {
        const cacheKey = userId;
        const cached = this.userProjectCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.PROJECT_CACHE_TTL) {
            return cached.projects;
        }

        const userProjects = await Project.find({
            $or: [
                { ownerId: userId },
                { 'members.userId': userId }
            ],
            isActive: true
        }).select('_id').lean();

        const projectIds = userProjects.map(p => p._id.toString());
        
        // Cache the result
        this.userProjectCache.set(cacheKey, {
            projects: projectIds,
            timestamp: Date.now()
        });

        return projectIds;
    }

    /**
     * Circuit breaker utilities for AI services
     */
    private static isAiCircuitBreakerOpen(): boolean {
        if (this.aiFailureCount >= this.MAX_AI_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastAiFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.aiFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordAiFailure(): void {
        this.aiFailureCount++;
        this.lastAiFailureTime = Date.now();
    }

    /**
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
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
     * Create a visual compliance template
     */
    static async createVisualComplianceTemplate(
        userId: string,
        data: {
            name: string;
            description?: string;
            content: string;
            complianceCriteria: string[];
            imageVariables: Array<{
                name: string;
                imageRole: 'reference' | 'evidence';
                description?: string;
                required: boolean;
            }>;
            industry: 'jewelry' | 'grooming' | 'retail' | 'fmcg' | 'documents';
            mode?: 'optimized' | 'standard';
            metaPromptPresetId?: string;
            projectId?: string;
        }
    ): Promise<IPromptTemplate> {
        try {
            // Create variables array combining criteria (text) and images
            const variables: Array<any> = [
                // Add compliance criteria as text variables
                ...data.complianceCriteria.map((criterion, index) => ({
                    name: `criterion_${index + 1}`,
                    description: criterion,
                    defaultValue: criterion,
                    required: true,
                    type: 'text'
                })),
                // Add image variables
                ...data.imageVariables.map(imgVar => ({
                    name: imgVar.name,
                    description: imgVar.description || `${imgVar.imageRole} image`,
                    required: imgVar.required,
                    type: 'image',
                    imageRole: imgVar.imageRole,
                    accept: 'image/*'
                }))
            ];

            const template = await PromptTemplate.create({
                name: data.name,
                description: data.description,
                content: data.content,
                category: 'visual-compliance',
                createdBy: new mongoose.Types.ObjectId(userId),
                projectId: data.projectId ? new mongoose.Types.ObjectId(data.projectId) : undefined,
                variables,
                metadata: {
                    tags: ['visual-compliance', data.industry],
                    recommendedModel: data.mode === 'standard' ? 'anthropic.claude-3-5-sonnet' : 'amazon.nova-pro-v1:0'
                },
                usage: {
                    count: 0,
                    totalTokensSaved: 0,
                    totalCostSaved: 0,
                    feedback: []
                },
                sharing: {
                    visibility: 'private',
                    sharedWith: [],
                    allowFork: true
                },
                isVisualCompliance: true,
                visualComplianceConfig: {
                    industry: data.industry,
                    mode: data.mode || 'optimized',
                    metaPromptPresetId: data.metaPromptPresetId
                },
                version: 1,
                isActive: true,
                isDeleted: false
            });

            // Track activity
            await trackTemplateActivity(userId, 'template_created', template, {
                category: 'visual-compliance',
                isVisualCompliance: true
            });

            loggingService.info('Visual compliance template created', {
                templateId: template._id,
                userId,
                industry: data.industry,
                criteriaCount: data.complianceCriteria.length,
                imageVariableCount: data.imageVariables.length
            });

            return template;
        } catch (error) {
            loggingService.error('Failed to create visual compliance template', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Resolve visual template with text and image variables
     */
    static async resolveVisualTemplate(
        templateId: string,
        userId: string,
        variables: {
            text?: Record<string, string>;
            images?: Record<string, string>; // name -> S3 URL or base64
        }
    ): Promise<{
        template: IPromptTemplate;
        resolvedCriteria: string[];
        resolvedImages: {
            reference?: string;
            evidence?: string;
        };
        allVariablesProvided: boolean;
    }> {
        try {
            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            if (!template.isVisualCompliance) {
                throw new Error('Template is not a visual compliance template');
            }

            // Separate text and image variables
            const textVariables = template.variables.filter(v => v.type !== 'image');
            const imageVariables = template.variables.filter(v => v.type === 'image');

            // Resolve text variables (compliance criteria)
            const resolvedCriteria: string[] = [];
            for (const textVar of textVariables) {
                const value = variables.text?.[textVar.name] || textVar.defaultValue || '';
                resolvedCriteria.push(value);
            }

            // Resolve image variables
            const resolvedImages: { reference?: string; evidence?: string } = {};
            for (const imageVar of imageVariables) {
                const value = variables.images?.[imageVar.name] || imageVar.s3Url || imageVar.defaultValue;
                if (value) {
                    if (imageVar.imageRole === 'reference') {
                        resolvedImages.reference = value;
                    } else if (imageVar.imageRole === 'evidence') {
                        resolvedImages.evidence = value;
                    }
                }
            }

            // Check if all required variables are provided
            const allRequiredTextProvided = textVariables
                .filter(v => v.required)
                .every(v => variables.text?.[v.name] || v.defaultValue);
            
            const allRequiredImagesProvided = imageVariables
                .filter(v => v.required)
                .every(v => variables.images?.[v.name] || v.s3Url || v.defaultValue);

            const allVariablesProvided = allRequiredTextProvided && allRequiredImagesProvided;

            loggingService.info('Visual template resolved', {
                templateId,
                userId,
                criteriaCount: resolvedCriteria.length,
                hasReference: !!resolvedImages.reference,
                hasEvidence: !!resolvedImages.evidence,
                allVariablesProvided
            });

            return {
                template,
                resolvedCriteria,
                resolvedImages,
                allVariablesProvided
            };
        } catch (error) {
            loggingService.error('Failed to resolve visual template', {
                error: error instanceof Error ? error.message : String(error),
                templateId,
                userId
            });
            throw error;
        }
    }

    /**
     * Execute visual compliance check using template
     */
    static async executeVisualComplianceTemplate(
        templateId: string,
        userId: string,
        variables: {
            text?: Record<string, string>;
            images?: Record<string, string>;
        },
        projectId?: string
    ): Promise<any> {
        try {
            // Resolve template variables
            const resolution = await this.resolveVisualTemplate(templateId, userId, variables);

            if (!resolution.allVariablesProvided) {
                throw new Error('Not all required variables are provided');
            }

            const { template, resolvedCriteria, resolvedImages } = resolution;

            if (!resolvedImages.reference || !resolvedImages.evidence) {
                throw new Error('Both reference and evidence images are required');
            }

            // Import visual compliance service
            const { VisualComplianceOptimizedService } = await import('./visualComplianceOptimized.service');

            // Execute visual compliance check
            const result = await VisualComplianceOptimizedService.processComplianceCheckOptimized({
                referenceImage: resolvedImages.reference,
                evidenceImage: resolvedImages.evidence,
                complianceCriteria: resolvedCriteria,
                industry: template.visualComplianceConfig!.industry,
                userId,
                projectId,
                useUltraCompression: true,
                mode: template.visualComplianceConfig!.mode || 'optimized',
                metaPromptPresetId: template.visualComplianceConfig!.metaPromptPresetId
            });

            // Update template usage statistics
            const templateDoc = await PromptTemplate.findById(templateId);
            if (templateDoc) {
                templateDoc.usage.count += 1;
                templateDoc.usage.lastUsed = new Date();
                
                // Track cost savings if available
                if (result.metadata.costBreakdown) {
                    const savings = result.metadata.costBreakdown.savings.amount;
                    templateDoc.usage.totalCostSaved = (templateDoc.usage.totalCostSaved || 0) + savings;
                }
                
                await templateDoc.save();
            }

            // Track activity
            await trackTemplateActivity(userId, 'template_used', template, {
                variablesUsed: { ...variables.text, ...variables.images },
                complianceScore: result.compliance_score,
                passFail: result.pass_fail
            });

            loggingService.info('Visual compliance template executed', {
                templateId,
                userId,
                complianceScore: result.compliance_score,
                passFail: result.pass_fail,
                costSavings: result.metadata.costBreakdown?.savings.percentage
            });

            return {
                ...result,
                templateInfo: {
                    id: template._id,
                    name: template.name,
                    category: template.category
                }
            };
        } catch (error) {
            loggingService.error('Failed to execute visual compliance template', {
                error: error instanceof Error ? error.message : String(error),
                templateId,
                userId
            });
            throw error;
        }
    }

    /**
     * Upload image for template variable
     */
    static async uploadTemplateImage(
        templateId: string,
        userId: string,
        variableName: string,
        imageFile: Buffer,
        mimeType: string
    ): Promise<{ s3Url: string; variable: any }> {
        try {
            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            // Check if variable exists and is an image variable
            const variable = template.variables.find(v => v.name === variableName && v.type === 'image');
            if (!variable) {
                throw new Error('Image variable not found in template');
            }

            // Import S3 service
            const { S3Service } = await import('./s3.service');

            // Upload to S3
            const fileName = `template-${templateId}-${variableName}-${Date.now()}.${mimeType.split('/')[1]}`;
            const uploadResult = await S3Service.uploadDocument(
                userId,
                fileName,
                imageFile,
                mimeType,
                {
                    type: 'template-image',
                    templateId: templateId,
                    variableName: variableName,
                    imageRole: variable.imageRole || 'evidence'
                }
            );

            // Update variable with S3 URL
            variable.s3Url = uploadResult.s3Url;
            variable.metadata = {
                format: mimeType,
                uploadedAt: new Date()
            };

            await template.save();

            loggingService.info('Template image uploaded', {
                templateId,
                userId,
                variableName,
                s3Url: uploadResult.s3Url
            });

            return {
                s3Url: uploadResult.s3Url,
                variable
            };
        } catch (error) {
            loggingService.error('Failed to upload template image', {
                error: error instanceof Error ? error.message : String(error),
                templateId,
                userId,
                variableName
            });
            throw error;
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