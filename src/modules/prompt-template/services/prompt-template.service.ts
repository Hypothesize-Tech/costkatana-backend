import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter } from 'events';
import {
  PromptTemplate,
  PromptTemplateDocument,
} from '../../../schemas/prompt/prompt-template.schema';
import { Project } from '../../../schemas/team-project/project.schema';
import { Usage } from '../../../schemas/analytics/usage.schema';
import { ActivityService } from '../../../modules/activity/activity.service';
import { AITemplateEngineService } from './ai-template-engine.service';
import { TemplateExecutionService } from './template-execution.service';
import { ModelRecommendationService } from './model-recommendation.service';
import { VisualComplianceOptimizedService } from '../../../modules/visual-compliance/services/visual-compliance-optimized.service';
import { ReferenceImageAnalysisService } from '../../../modules/reference-image/reference-image-analysis.service';
import { PermissionService } from '../../../modules/team/services/permission.service';
import { CacheService } from '../../../common/cache/cache.service';
import { S3Service } from '../../../modules/aws/services/s3.service';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '../../../schemas/integration/aws-connection.schema';
import { CreateTemplateDto } from '../dto/create-template.dto';
import { UpdateTemplateDto } from '../dto/update-template.dto';
import { DuplicateTemplateDto } from '../dto/duplicate-template.dto';
import { TemplateQueryDto } from '../dto/template-query.dto';
import { ExecuteTemplateDto } from '../dto/execute-template.dto';
import { CreateVisualComplianceDto } from '../dto/create-visual-compliance.dto';

interface TemplateActivityMetadata {
  templateId: string;
  templateName: string;
  templateCategory: string;
  templateVersion: number;
  intent?: string;
  optimizationType?: string;
  variablesUsed?: Record<string, any>;
  resolvedVariables?: Record<string, any>;
  rating?: number;
  variablesCount?: number;
  effectivenessScore?: number;
  complianceResult?: {
    score?: number;
    passFail?: boolean;
    cost?: number;
  };
}

type TemplateActivityType =
  | 'template_created'
  | 'template_updated'
  | 'template_deleted'
  | 'template_duplicated'
  | 'template_ai_generated'
  | 'template_optimized'
  | 'template_used'
  | 'template_used_with_context'
  | 'template_shared'
  | 'template_feedback_added'
  | 'template_variables_detected'
  | 'template_effectiveness_predicted';

@Injectable()
export class PromptTemplateService {
  private readonly logger = new Logger(PromptTemplateService.name);

  // Background processing queue
  private backgroundQueue: Array<() => Promise<void>> = [];
  private backgroundProcessor?: NodeJS.Timeout;
  private readonly eventEmitter = new EventEmitter();

  // Access control optimization
  private userProjectCache = new Map<
    string,
    { projects: string[]; timestamp: number }
  >();
  private readonly PROJECT_CACHE_TTL = 300000; // 5 minutes

  // Circuit breaker for AI services
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly MAX_FAILURES = 5;
  private readonly CIRCUIT_BREAKER_RESET_MS = 300000; // 5 minutes

  constructor(
    @InjectModel(PromptTemplate.name)
    private readonly promptTemplateModel: Model<PromptTemplateDocument>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<Project>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
    @InjectModel(AWSConnection.name)
    private readonly awsConnectionModel: Model<AWSConnectionDocument>,
    private readonly activityService: ActivityService,
    private readonly aiTemplateEngineService: AITemplateEngineService,
    @Inject(forwardRef(() => TemplateExecutionService))
    private readonly templateExecutionService: TemplateExecutionService,
    private readonly modelRecommendationService: ModelRecommendationService,
    private readonly visualComplianceService: VisualComplianceOptimizedService,
    private readonly referenceImageService: ReferenceImageAnalysisService,
    private readonly permissionService: PermissionService,
    private readonly cacheService: CacheService,
    private readonly s3Service: S3Service,
  ) {
    this.startBackgroundProcessor();
  }

  /**
   * Create a new prompt template
   */
  async createTemplate(
    userId: string,
    data: CreateTemplateDto,
  ): Promise<PromptTemplateDocument> {
    try {
      // Verify project access if projectId is provided
      if (data.projectId) {
        const project = await this.projectModel.findById(data.projectId);
        if (!project) {
          throw new Error('Project not found');
        }

        // Check if user has access to the project
        if (!this.canAccessProject(userId, project)) {
          throw new Error('Unauthorized: Cannot access this project');
        }
      }

      // Create template
      const template = new this.promptTemplateModel({
        ...data,
        createdBy: userId,
        version: 1,
        usage: {
          count: 0,
          lastUsed: null,
          totalTokensSaved: 0,
          totalCostSaved: 0,
          averageRating: 0,
          feedback: [],
        },
        executionStats: {
          totalExecutions: 0,
          totalCostSavings: 0,
          averageCost: 0,
          mostUsedModel: '',
          lastExecutedAt: null,
        },
      });

      const savedTemplate = await template.save();

      // Queue background business event logging
      this.queueBackgroundTask(async () => {
        await this.trackTemplateActivity(
          userId,
          'template_created',
          savedTemplate,
        );
      });

      this.logger.log('Template created', {
        templateId: savedTemplate._id,
        userId,
        name: savedTemplate.name,
      });

      return savedTemplate;
    } catch (error) {
      this.logger.error('Error creating template', {
        userId,
        data,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get templates with filtering
   */
  async getTemplates(
    filters: TemplateQueryDto,
    userId?: string,
  ): Promise<{
    templates: PromptTemplateDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const query: any = {};

      // Build query based on filters
      if (filters.projectId) {
        query.projectId = filters.projectId;
      }

      if (filters.category) {
        query.category = filters.category;
      }

      if (filters.tags && filters.tags.length > 0) {
        query.tags = { $in: filters.tags };
      }

      if (filters.search) {
        query.$or = [
          { name: { $regex: filters.search, $options: 'i' } },
          { description: { $regex: filters.search, $options: 'i' } },
          { content: { $regex: filters.search, $options: 'i' } },
          { tags: { $in: [new RegExp(filters.search, 'i')] } },
        ];
      }

      // Visibility filter
      if (userId) {
        query.$or = [
          { createdBy: userId },
          { 'sharing.visibility': 'public' },
          { 'sharing.visibility': 'organization' },
          { 'sharing.sharedWith': userId },
        ];
      } else {
        query['sharing.visibility'] = 'public';
      }

      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const skip = (page - 1) * limit;

      let sort: any = { createdAt: -1 };
      if (filters.sortBy) {
        sort = { [filters.sortBy]: filters.sortOrder === 'asc' ? 1 : -1 };
      }

      const [templates, total] = await Promise.all([
        this.promptTemplateModel
          .find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .populate('createdBy', 'name email')
          .populate('projectId', 'name')
          .lean(),
        this.promptTemplateModel.countDocuments(query),
      ]);

      return {
        templates: templates as PromptTemplateDocument[],
        total,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error('Error getting templates', {
        filters,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get a specific template by ID
   */
  async getTemplateById(
    templateId: string,
    userId?: string,
  ): Promise<PromptTemplateDocument> {
    try {
      const template = await this.promptTemplateModel
        .findById(templateId)
        .populate('createdBy', 'name email')
        .populate('projectId', 'name');

      if (!template) {
        throw new Error('Template not found');
      }

      // Check access
      if (userId && !(await this.canAccessTemplate(userId, template))) {
        throw new Error('Unauthorized: Cannot access this template');
      }

      return template;
    } catch (error) {
      this.logger.error('Error getting template by ID', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update a template
   */
  async updateTemplate(
    templateId: string,
    userId: string,
    updates: UpdateTemplateDto,
  ): Promise<PromptTemplateDocument> {
    try {
      const template = await this.promptTemplateModel.findById(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Check ownership
      if (template.createdBy.toString() !== userId) {
        throw new Error('Unauthorized: Only template owner can update');
      }

      // Verify project access if projectId is being changed
      if (
        updates.projectId &&
        updates.projectId !== template.projectId?.toString()
      ) {
        const project = await this.projectModel.findById(updates.projectId);
        if (!project) {
          throw new Error('Project not found');
        }

        if (!this.canAccessProject(userId, project)) {
          throw new Error('Unauthorized: Cannot access target project');
        }
      }

      const updatedTemplate = await this.promptTemplateModel.findByIdAndUpdate(
        templateId,
        {
          ...updates,
          version: template.version + 1,
          updatedAt: new Date(),
        },
        { new: true },
      );

      if (!updatedTemplate) {
        throw new Error('Failed to update template');
      }

      // Queue background activity tracking
      this.queueBackgroundTask(async () => {
        await this.trackTemplateActivity(
          userId,
          'template_updated',
          updatedTemplate,
        );
      });

      this.logger.log('Template updated', {
        templateId,
        userId,
        version: updatedTemplate.version,
      });

      return updatedTemplate;
    } catch (error) {
      this.logger.error('Error updating template', {
        templateId,
        userId,
        updates,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: string, userId: string): Promise<void> {
    try {
      const template = await this.promptTemplateModel.findById(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Check ownership
      if (template.createdBy.toString() !== userId) {
        throw new Error('Unauthorized: Only template owner can delete');
      }

      await this.promptTemplateModel.findByIdAndDelete(templateId);

      // Queue background activity tracking
      this.queueBackgroundTask(async () => {
        await this.trackTemplateActivity(userId, 'template_deleted', template);
      });

      this.logger.log('Template deleted', {
        templateId,
        userId,
        templateName: template.name,
      });
    } catch (error) {
      this.logger.error('Error deleting template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Duplicate a template
   */
  async duplicateTemplate(
    templateId: string,
    userId: string,
    customizations?: DuplicateTemplateDto,
  ): Promise<PromptTemplateDocument> {
    try {
      const originalTemplate =
        await this.promptTemplateModel.findById(templateId);
      if (!originalTemplate) {
        throw new Error('Template not found');
      }

      // Check access to original template
      if (!(await this.canAccessTemplate(userId, originalTemplate))) {
        throw new Error('Unauthorized: Cannot access this template');
      }

      // Create duplicate
      const duplicateData = {
        name: customizations?.name || `${originalTemplate.name} (Copy)`,
        description:
          customizations?.description || originalTemplate.description,
        content: originalTemplate.content,
        category: originalTemplate.category,
        projectId: customizations?.projectId || originalTemplate.projectId,
        variables:
          customizations?.keepVariables !== false
            ? originalTemplate.variables
            : [],
        sharing:
          customizations?.keepSharing !== false
            ? originalTemplate.sharing
            : {
                visibility: 'private',
                sharedWith: [],
                allowFork: true,
              },
        tags: originalTemplate.metadata?.tags || [],
        language: originalTemplate.metadata?.language,
        createdBy: userId,
        version: 1,
        usage: {
          count: 0,
          lastUsed: null,
          totalTokensSaved: 0,
          totalCostSaved: 0,
          averageRating: 0,
          feedback: [],
        },
        executionStats: {
          totalExecutions: 0,
          totalCostSavings: 0,
          averageCost: 0,
          mostUsedModel: '',
          lastExecutedAt: null,
        },
      };

      const duplicate = new this.promptTemplateModel(duplicateData);
      const savedDuplicate = await duplicate.save();

      // Queue background activity tracking
      this.queueBackgroundTask(async () => {
        await this.trackTemplateActivity(
          userId,
          'template_duplicated',
          savedDuplicate,
          {
            templateId: originalTemplate._id.toString(),
            templateName: originalTemplate.name,
          },
        );
      });

      this.logger.log('Template duplicated', {
        originalTemplateId: templateId,
        duplicateTemplateId: savedDuplicate._id,
        userId,
      });

      return savedDuplicate;
    } catch (error) {
      this.logger.error('Error duplicating template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Add feedback to a template
   */
  async addTemplateFeedback(
    templateId: string,
    userId: string,
    rating: number,
    comment?: string,
  ): Promise<void> {
    try {
      const template = await this.promptTemplateModel.findById(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Check access
      if (!(await this.canAccessTemplate(userId, template))) {
        throw new Error('Unauthorized: Cannot access this template');
      }

      const feedback = {
        userId,
        rating,
        comment,
        createdAt: new Date(),
      };

      await this.promptTemplateModel.updateOne(
        { _id: templateId },
        {
          $push: { 'usage.feedback': feedback },
          $set: { updatedAt: new Date() },
        },
      );

      // Update average rating
      const updatedTemplate =
        await this.promptTemplateModel.findById(templateId);
      if (updatedTemplate?.usage?.feedback) {
        const totalRating = updatedTemplate.usage.feedback.reduce(
          (sum, f) => sum + f.rating,
          0,
        );
        const averageRating =
          totalRating / updatedTemplate.usage.feedback.length;

        await this.promptTemplateModel.updateOne(
          { _id: templateId },
          { $set: { 'usage.averageRating': averageRating } },
        );
      }

      // Queue background activity tracking
      this.queueBackgroundTask(async () => {
        await this.trackTemplateActivity(
          userId,
          'template_feedback_added',
          template,
          {
            rating,
          },
        );
      });

      this.logger.log('Feedback added to template', {
        templateId,
        userId,
        rating,
      });
    } catch (error) {
      this.logger.error('Error adding template feedback', {
        templateId,
        userId,
        rating,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get template analytics
   */
  async getTemplateAnalytics(templateId: string): Promise<any> {
    try {
      const template = await this.promptTemplateModel.findById(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Get usage data from executions
      const executionStats =
        await this.templateExecutionService.getExecutionStats(templateId);

      return {
        template: {
          id: template._id,
          name: template.name,
          category: template.category,
          createdAt: template.createdAt,
          usage: template.usage,
        },
        executionStats,
        feedback: template.usage?.feedback || [],
      };
    } catch (error) {
      this.logger.error('Error getting template analytics', {
        templateId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get popular templates
   */
  async getPopularTemplates(
    category?: string,
    limit: number = 10,
  ): Promise<PromptTemplateDocument[]> {
    try {
      const query: any = {
        'sharing.visibility': 'public',
      };

      if (category) {
        query.category = category;
      }

      const templates = await this.promptTemplateModel
        .find(query)
        .sort({ 'usage.count': -1, 'usage.averageRating': -1 })
        .limit(limit)
        .populate('createdBy', 'name')
        .lean();

      return templates as PromptTemplateDocument[];
    } catch (error) {
      this.logger.error('Error getting popular templates', {
        category,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get trending templates
   */
  async getTrendingTemplates(
    period: 'week' | 'month' | 'all' = 'week',
    category?: string,
    limit: number = 10,
  ): Promise<PromptTemplateDocument[]> {
    try {
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(0); // All time
      }

      const matchQuery: any = {
        'sharing.visibility': 'public',
        'usage.lastUsed': { $gte: startDate },
      };

      if (category) {
        matchQuery.category = category;
      }

      const templates = await this.promptTemplateModel
        .find(matchQuery)
        .sort({ 'usage.count': -1 })
        .limit(limit)
        .populate('createdBy', 'name')
        .lean();

      return templates as PromptTemplateDocument[];
    } catch (error) {
      this.logger.error('Error getting trending templates', {
        period,
        category,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // AI-Powered Methods

  /**
   * Generate template from intent
   */
  async generateTemplateFromIntent(
    userId: string,
    intent: string,
    options?: {
      category?: string;
      context?: any;
      constraints?: any;
    },
  ): Promise<any> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('AI service temporarily unavailable');
    }

    try {
      const result =
        await this.aiTemplateEngineService.generateTemplateFromIntent({
          userId,
          intent,
          category: options?.category,
          context: options?.context,
          constraints: options?.constraints,
        });

      // Create the template
      const templateData: CreateTemplateDto = {
        name: result.template.name,
        content: result.template.content,
        description: result.template.description,
        category: result.template.category,
        variables: result.template.variables,
        tags: result.template.tags,
      };

      const template = await this.createTemplate(userId, templateData);

      // Track AI generation activity
      await this.trackTemplateActivity(
        userId,
        'template_ai_generated',
        template,
        {
          intent,
        },
      );

      return {
        template,
        metadata: result.metadata,
      };
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Detect variables in content
   */
  async detectVariables(
    content: string,
    userId: string,
    options?: {
      autoFillDefaults?: boolean;
      validateTypes?: boolean;
    },
  ): Promise<any> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('AI service temporarily unavailable');
    }

    try {
      const result = await this.aiTemplateEngineService.detectVariables({
        content,
        userId,
        autoFillDefaults: options?.autoFillDefaults,
        validateTypes: options?.validateTypes,
      });

      // Track utility activity (non-template operation)
      await this.trackUtilityActivity(
        userId,
        'template_variables_detected',
        'Variable Detection',
        'analysis',
        {
          variablesCount: result.variables?.length || 0,
        },
      );

      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Optimize template
   */
  async optimizeTemplate(
    templateId: string,
    userId: string,
    optimizationType: 'token' | 'cost' | 'quality' | 'model-specific',
    options?: {
      targetModel?: string;
      preserveIntent?: boolean;
    },
  ): Promise<any> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('AI service temporarily unavailable');
    }

    try {
      const template = await this.getTemplateById(templateId, userId);

      const result = await this.aiTemplateEngineService.optimizeTemplate({
        templateId,
        userId,
        optimizationType,
        targetModel: options?.targetModel,
        preserveIntent: options?.preserveIntent,
      });

      // Apply optimization if successful
      if (result.optimizedContent) {
        await this.updateTemplate(templateId, userId, {
          content: result.optimizedContent,
        });

        // Track optimization activity
        await this.trackTemplateActivity(
          userId,
          'template_optimized',
          template,
          {
            optimizationType,
          },
        );
      }

      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Get template recommendations
   */
  async getRecommendations(
    userId: string,
    options?: {
      currentProject?: string;
      taskType?: string;
      limit?: number;
    },
  ): Promise<any[]> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('AI service temporarily unavailable');
    }

    try {
      return await this.aiTemplateEngineService.getTemplateRecommendations(
        userId,
        options,
      );
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Predict template effectiveness
   */
  async predictEffectiveness(
    templateId: string,
    userId: string,
    variables?: Record<string, any>,
  ): Promise<any> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('AI service temporarily unavailable');
    }

    try {
      const template = await this.getTemplateById(templateId, userId);

      const result = await this.aiTemplateEngineService.predictEffectiveness(
        templateId,
        variables,
      );

      // Track activity
      await this.trackTemplateActivity(
        userId,
        'template_effectiveness_predicted',
        template,
        {
          effectivenessScore: result.overall,
        },
      );

      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Get template insights
   */
  async getInsights(templateId: string): Promise<any> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('AI service temporarily unavailable');
    }

    try {
      return await this.aiTemplateEngineService.getTemplateInsights(templateId);
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Semantic search for templates
   */
  async searchSemantic(
    query: string,
    userId: string,
    limit: number = 10,
  ): Promise<any[]> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('AI service temporarily unavailable');
    }

    try {
      return await this.aiTemplateEngineService.searchTemplatesSemantic(
        query,
        userId,
        limit,
      );
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Personalize template for user
   */
  async personalizeTemplate(templateId: string, userId: string): Promise<any> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('AI service temporarily unavailable');
    }

    try {
      return await this.aiTemplateEngineService.personalizeTemplate(
        templateId,
        userId,
      );
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Apply optimization to template
   */
  async applyOptimization(
    templateId: string,
    optimizedContent: string,
    userId: string,
    metadata?: any,
  ): Promise<PromptTemplateDocument> {
    try {
      return await this.updateTemplate(templateId, userId, {
        content: optimizedContent,
      });
    } catch (error) {
      this.logger.error('Error applying optimization', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Visual Compliance Methods

  /**
   * Create visual compliance template
   */
  async createVisualComplianceTemplate(
    userId: string,
    data: CreateVisualComplianceDto,
  ): Promise<PromptTemplateDocument> {
    try {
      // Create base template
      const templateData: CreateTemplateDto = {
        name: data.name,
        content: '', // Will be set later based on visual compliance logic
        description: data.description,
        category: 'visual-compliance',
        projectId: data.projectId,
        variables: data.imageVariables,
        tags: ['visual-compliance', data.industry],
      };

      const template = await this.createTemplate(userId, templateData);

      // Add visual compliance specific data
      await this.promptTemplateModel.updateOne(
        { _id: template._id },
        {
          $set: {
            visualCompliance: {
              industry: data.industry,
              mode: data.mode,
              metaPromptPresetId: data.metaPromptPresetId,
              complianceCriteria: data.complianceCriteria,
              structuredData: data.structuredData,
              referenceImage: data.referenceImageUrl
                ? {
                    url: data.referenceImageUrl,
                    uploadedBy: userId,
                    uploadedAt: new Date(),
                  }
                : undefined,
            },
          },
        },
      );

      // Trigger feature extraction if reference image provided
      if (data.referenceImageUrl) {
        const criteria = (data.complianceCriteria || []).map(
          (criterion, index) => ({
            name: criterion.name || `criterion_${index + 1}`,
            text:
              criterion.whatToCheck ||
              criterion.description ||
              criterion.passCriteria ||
              criterion.name ||
              `Criterion ${index + 1}`,
          }),
        );

        this.queueBackgroundTask(async () => {
          try {
            await this.referenceImageService.extractReferenceFeatures(
              data.referenceImageUrl!,
              criteria,
              data.industry,
              String(template._id),
              userId,
            );
            this.logger.log('Reference image features extracted', {
              templateId: template._id,
              criteriaCount: criteria.length,
            });
          } catch (error) {
            this.logger.warn(
              'Failed to extract reference image features after template creation',
              {
                templateId: template._id,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        });
      }

      return template;
    } catch (error) {
      this.logger.error('Error creating visual compliance template', {
        userId,
        data,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Execute visual compliance template
   */
  async executeVisualComplianceTemplate(
    templateId: string,
    userId: string,
    variables: Record<string, any>,
    projectId?: string,
  ): Promise<any> {
    try {
      const template = await this.getTemplateById(templateId, userId);

      // Construct visual compliance request from template variables
      const complianceRequest = {
        referenceImage: variables.referenceImage,
        evidenceImage: variables.evidenceImage,
        complianceCriteria: variables.complianceCriteria || [],
        industry:
          variables.industry ||
          (template as { industry?: string }).industry ||
          'retail',
        useUltraCompression: variables.useUltraCompression !== false,
        mode: variables.mode || 'optimized',
        metaPrompt: variables.metaPrompt,
        metaPromptPresetId: variables.metaPromptPresetId,
        templateId,
        projectId,
        userId,
      };

      // Execute using actual visual compliance service
      const complianceResult =
        await this.visualComplianceService.processComplianceCheckOptimized(
          complianceRequest,
        );

      // Transform result to match expected format
      const result = {
        compliant: complianceResult.pass_fail,
        score: complianceResult.compliance_score,
        message: complianceResult.feedback_message,
        templateId,
        userId,
        items: complianceResult.items,
        metadata: complianceResult.metadata,
      };

      // Track usage
      await this.trackTemplateActivity(userId, 'template_used', template, {
        variablesUsed: variables,
        complianceResult: {
          score: complianceResult.compliance_score,
          passFail: complianceResult.pass_fail,
          cost: complianceResult.metadata?.cost,
        },
      });

      return result;
    } catch (error) {
      this.logger.error('Error executing visual compliance template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Upload image for template variable
   */
  async uploadTemplateImage(
    templateId: string,
    userId: string,
    variableName: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<any> {
    try {
      const template = await this.getTemplateById(templateId, userId);

      // Check if variable exists and is an image type
      const variable = template.variables?.find((v) => v.name === variableName);
      if (!variable || variable.type !== 'image') {
        throw new Error('Invalid variable: must be an image type');
      }

      this.logger.log('Template image upload requested', {
        templateId,
        userId,
        variableName,
        mimeType,
        size: imageBuffer.length,
      });

      // Get user's AWS connection (assume they have one configured)
      const awsConnection = await this.awsConnectionModel.findOne({ userId });
      if (!awsConnection) {
        throw new Error('AWS connection not configured for this user');
      }

      // Upload to S3
      const fileName = `template-${templateId}-${variableName}-${Date.now()}.${mimeType.split('/')[1]}`;
      const uploadResult = await this.s3Service.uploadDocument(
        awsConnection,
        userId,
        fileName,
        imageBuffer,
        mimeType,
        {
          type: 'template-image',
          templateId: templateId,
          variableName: variableName,
          imageRole: variable.imageRole || 'evidence',
        },
      );

      // Update variable with S3 URL
      variable.s3Url = uploadResult.s3Url;
      variable.metadata = {
        format: mimeType,
        uploadedAt: new Date(),
        ...(variable.metadata || {}),
        s3Key: uploadResult.s3Key,
        fileSize: imageBuffer.length,
      } as typeof variable.metadata;

      await template.save();

      this.logger.log('Template image uploaded successfully', {
        templateId,
        userId,
        variableName,
        s3Url: uploadResult.s3Url,
      });

      return {
        success: true,
        variableName,
        s3Url: uploadResult.s3Url,
        message: 'Image uploaded successfully',
      };
    } catch (error) {
      this.logger.error('Error uploading template image', {
        templateId,
        userId,
        variableName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Legacy method for backward compatibility
  async useTemplate(
    templateId: string,
    userId: string,
    variables: Record<string, any>,
  ): Promise<string> {
    try {
      const template = await this.getTemplateById(templateId, userId);

      // Fill variables in template content
      let content = template.content;
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        content = content.replace(regex, String(value));
      }

      // Track usage
      await this.trackTemplateActivity(userId, 'template_used', template, {
        variablesUsed: variables,
      });

      return content;
    } catch (error) {
      this.logger.error('Error using template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Execute template with AI
  async executeTemplate(
    request: ExecuteTemplateDto & { templateId: string; userId: string },
  ): Promise<any> {
    return await this.templateExecutionService.executeTemplate({
      templateId: request.templateId,
      userId: request.userId,
      variables: request.variables || {},
      executionMode: request.mode || 'single',
      modelId: request.modelId,
    });
  }

  // Private helper methods

  private startBackgroundProcessor(): void {
    if (this.backgroundProcessor) {
      clearInterval(this.backgroundProcessor);
    }

    this.backgroundProcessor = setInterval(async () => {
      if (this.backgroundQueue.length > 0) {
        const task = this.backgroundQueue.shift();
        if (task) {
          try {
            await task();
          } catch (error) {
            this.logger.error('Background task failed', {
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }
    }, 5000); // Process every 5 seconds

    // Cleanup on module destroy
    this.eventEmitter.on('destroy', () => {
      if (this.backgroundProcessor) {
        clearInterval(this.backgroundProcessor);
      }
    });
  }

  private queueBackgroundTask(task: () => Promise<void>): void {
    this.backgroundQueue.push(task);
  }

  private canAccessProject(userId: string, project: any): boolean {
    // Check if user is owner or member of the project
    return (
      project.createdBy.toString() === userId ||
      project.members?.some(
        (member: any) => member.userId.toString() === userId,
      )
    );
  }

  private async canAccessTemplate(
    userId: string,
    template: PromptTemplateDocument,
  ): Promise<boolean> {
    // Check ownership
    if (template.createdBy.toString() === userId) {
      return Promise.resolve(true);
    }

    // Check sharing permissions
    if (template.sharing?.visibility === 'public') {
      return Promise.resolve(true);
    }

    if (template.sharing?.sharedWith?.some((id) => id.toString() === userId)) {
      return Promise.resolve(true);
    }

    if (template.sharing?.visibility === 'project') {
      if (!template.projectId) {
        return Promise.resolve(false);
      }
      return this.permissionService.canAccessProject(
        userId,
        template.projectId.toString(),
      );
    }

    if (template.sharing?.visibility === 'organization') {
      // Organization-scoped templates must still resolve to a project that the user
      // can access, or be explicitly shared. This avoids permissive bypasses.
      if (!template.projectId) {
        return Promise.resolve(false);
      }
      return this.permissionService.canAccessProject(
        userId,
        template.projectId.toString(),
      );
    }

    return Promise.resolve(false);
  }

  private async trackTemplateActivity(
    userId: string,
    activityType: TemplateActivityType,
    template: PromptTemplateDocument,
    additionalMetadata?: Partial<TemplateActivityMetadata>,
  ): Promise<void> {
    try {
      const baseMetadata: TemplateActivityMetadata = {
        templateId: template._id.toString(),
        templateName: template.name,
        templateCategory: template.category || '',
        templateVersion: template.version || 1,
        ...additionalMetadata,
      };

      const activityTitles: Record<TemplateActivityType, string> = {
        template_created: 'Template Created',
        template_updated: 'Template Updated',
        template_deleted: 'Template Deleted',
        template_duplicated: 'Template Duplicated',
        template_ai_generated: 'AI Template Generated',
        template_optimized: 'Template Optimized',
        template_used: 'Template Used',
        template_used_with_context: 'Template Used with Context',
        template_shared: 'Template Shared',
        template_feedback_added: 'Template Feedback Added',
        template_variables_detected: 'Template Variables Detected',
        template_effectiveness_predicted: 'Template Effectiveness Predicted',
      };

      const activityDescriptions: Record<TemplateActivityType, string> = {
        template_created: `Created template "${template.name}" in ${template.category} category`,
        template_updated: `Updated template "${template.name}" to version ${template.version}`,
        template_deleted: `Deleted template "${template.name}"`,
        template_duplicated: `Duplicated template "${template.name}"`,
        template_ai_generated: `Generated template "${template.name}" using AI${additionalMetadata?.intent ? ` from intent: "${additionalMetadata.intent}"` : ''}`,
        template_optimized: `Optimized template "${template.name}"${additionalMetadata?.optimizationType ? ` for ${additionalMetadata.optimizationType}` : ''}`,
        template_used: `Used template "${template.name}"${additionalMetadata?.variablesUsed ? ` with ${Object.keys(additionalMetadata.variablesUsed).length} variables` : ''}`,
        template_used_with_context: `Used template "${template.name}" with context-aware resolution${additionalMetadata?.resolvedVariables ? ` (${Object.keys(additionalMetadata.resolvedVariables).length} variables resolved)` : ''}`,
        template_shared: `Shared template "${template.name}" with visibility: ${template.sharing?.visibility}`,
        template_feedback_added: `Added feedback to template "${template.name}"${additionalMetadata?.rating ? ` (Rating: ${additionalMetadata.rating}/5)` : ''}`,
        template_variables_detected: `Detected ${additionalMetadata?.variablesCount || 0} variables in template "${template.name}"`,
        template_effectiveness_predicted: `Predicted effectiveness for template "${template.name}"${additionalMetadata?.effectivenessScore ? ` (Score: ${additionalMetadata.effectivenessScore}%)` : ''}`,
      };

      await this.activityService.trackActivity(userId, {
        type: activityType,
        title: activityTitles[activityType],
        description: activityDescriptions[activityType],
        metadata: baseMetadata,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to track template activity: ${activityType}`,
        error as Error,
      );
    }
  }

  /**
   * Track utility activities (non-template operations)
   */
  private async trackUtilityActivity(
    userId: string,
    activityType: string,
    activityName: string,
    category: string,
    additionalMetadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const metadata = {
        operationName: activityName,
        category,
        ...additionalMetadata,
      };

      const activityTitles: Record<string, string> = {
        template_variables_detected: 'Variables Detected',
        template_optimization_suggested: 'Optimization Suggested',
        template_analysis_completed: 'Template Analysis Completed',
      };

      const activityDescriptions: Record<string, string> = {
        template_variables_detected: `${additionalMetadata?.variablesCount || 0} variables detected in content`,
        template_optimization_suggested: `Optimization suggestions generated for ${category}`,
        template_analysis_completed: `Analysis completed for ${activityName}`,
      };

      await this.activityService.trackActivity(userId, {
        type: activityType,
        title: activityTitles[activityType] || activityName,
        description:
          activityDescriptions[activityType] || `Completed ${activityName}`,
        metadata,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to track utility activity: ${activityType}`,
        error as Error,
      );
    }
  }

  private isCircuitBreakerOpen(): boolean {
    if (this.failureCount >= this.MAX_FAILURES) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_MS) {
        return true;
      } else {
        // Reset circuit breaker
        this.failureCount = 0;
        this.lastFailureTime = 0;
      }
    }
    return false;
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
  }

  onModuleDestroy(): void {
    this.eventEmitter.emit('destroy');
  }
}
