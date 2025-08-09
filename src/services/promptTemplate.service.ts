import { PromptTemplate, IPromptTemplate } from '../models/PromptTemplate';
import { Project } from '../models/Project';
import { Usage } from '../models/Usage';
import { logger } from '../utils/logger';
import { ActivityService } from './activity.service';
import mongoose from 'mongoose';

interface CreatePromptTemplateDto {
    name: string;
    description?: string;
    content: string;
    category?: string;
    projectId?: string;
    variables?: Array<{
        name: string;
        description?: string;
        defaultValue?: string;
        required?: boolean;
    }>;
    metadata?: {
        estimatedTokens?: number;
        recommendedModel?: string;
        tags?: string[];
        language?: string;
    };
    sharing?: {
        visibility?: 'private' | 'project' | 'organization' | 'public';
        sharedWith?: string[];
        allowFork?: boolean;
    };
}

interface PromptTemplateQuery {
    userId: string;
    projectId?: string;
    category?: string;
    tags?: string[];
    visibility?: string;
    search?: string;
    page?: number;
    limit?: number;
}

export class PromptTemplateService {
    /**
     * Create a new prompt template
     */
    static async createTemplate(
        userId: string,
        data: CreatePromptTemplateDto
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

            // Track activity
            await ActivityService.trackActivity(userId, {
                type: 'settings_updated',
                title: 'Created Prompt Template',
                description: `Created template "${template.name}" in ${template.category} category`,
                metadata: {
                    templateId: template._id,
                    category: template.category,
                    visibility: template.sharing.visibility
                }
            });

            logger.info(`Prompt template created: ${template.name} by user ${userId}`);
            return template;
        } catch (error) {
            logger.error('Error creating prompt template:', error);
            throw error;
        }
    }

    /**
     * Get accessible prompt templates for a user
     */
    static async getTemplates(query: PromptTemplateQuery): Promise<{
        templates: IPromptTemplate[];
        total: number;
        page: number;
        pages: number;
    }> {
        try {
            logger.info('=== PROMPT TEMPLATE SERVICE: getTemplates START ===');
            logger.info('Query received:', query);

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

            logger.info('Destructured query params:', {
                userId,
                projectId,
                category,
                tags,
                visibility,
                search,
                page,
                limit
            });

            // Get user's projects for access control
            logger.info('Getting user projects for access control...');
            const userProjects = await Project.find({
                $or: [
                    { ownerId: userId },
                    { 'members.userId': userId }
                ],
                isActive: true
            }).select('_id');

            logger.info('User projects found:', userProjects.length);
            const userProjectIds = userProjects.map(p => p._id.toString());
            logger.info('User project IDs:', userProjectIds);

            // Build query
            logger.info('Building filter query...');
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
                logger.info('Added projectId filter:', projectId);
            }

            if (category) {
                filter.category = category;
                logger.info('Added category filter:', category);
            }

            if (tags && tags.length > 0) {
                filter['metadata.tags'] = { $in: tags };
                logger.info('Added tags filter:', tags);
            }

            if (visibility) {
                filter['sharing.visibility'] = visibility;
                logger.info('Added visibility filter:', visibility);
            }

            if (search) {
                filter.$text = { $search: search };
                logger.info('Added search filter:', search);
            }

            logger.info('Final filter:', JSON.stringify(filter, null, 2));

            const skip = (page - 1) * limit;
            logger.info('Pagination:', { skip, limit, page });

            logger.info('Executing MongoDB queries...');
            const [templates, total] = await Promise.all([
                PromptTemplate.find(filter)
                    .populate('createdBy', 'name email')
                    .sort({ 'usage.count': -1, createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
                PromptTemplate.countDocuments(filter)
            ]);

            logger.info('MongoDB queries completed');
            logger.info('Results:', {
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

            logger.info('=== PROMPT TEMPLATE SERVICE: getTemplates END ===');
            return result;
        } catch (error: any) {
            logger.error('=== PROMPT TEMPLATE SERVICE: getTemplates ERROR ===');
            logger.error('Error getting prompt templates:', error);
            logger.error('Error stack:', error.stack);
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

            return {
                prompt,
                estimatedTokens: template.metadata.estimatedTokens || this.estimateTokenCount(prompt),
                estimatedCost: template.metadata.estimatedCost
            };
        } catch (error) {
            logger.error('Error using prompt template:', error);
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

            // Track activity
            await ActivityService.trackActivity(userId, {
                type: 'settings_updated',
                title: 'Forked Prompt Template',
                description: `Forked template "${originalTemplate.name}"`,
                metadata: {
                    originalTemplateId: originalTemplate._id,
                    forkedTemplateId: forkedTemplate._id
                }
            });

            return forkedTemplate;
        } catch (error) {
            logger.error('Error forking prompt template:', error);
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
            logger.error('Error updating template usage:', error);
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
            logger.error('Error adding template feedback:', error);
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
            logger.error('Error getting template analytics:', error);
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

        // Track activity
        await ActivityService.trackActivity(userId, {
            type: 'settings_updated',
            title: 'Updated Prompt Template',
            description: `Updated template "${template.name}"`,
            metadata: {
                templateId: template._id,
                version: template.version
            }
        });

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

        // Track activity
        await ActivityService.trackActivity(userId, {
            type: 'settings_updated',
            title: 'Deleted Prompt Template',
            description: `Deleted template "${template.name}"`,
            metadata: {
                templateId: template._id
            }
        });
    }
} 