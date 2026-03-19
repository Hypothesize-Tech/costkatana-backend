import {
  Injectable,
  Logger,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';
import { Alert, AlertDocument } from '@/schemas/core/alert.schema';
import {
  Project,
  ProjectDocument,
} from '@/schemas/team-project/project.schema';
import { User, UserDocument } from '@/schemas/user/user.schema';
import { Inject, forwardRef } from '@nestjs/common';
import type { RealtimeUpdateService } from './realtime-update.service';
import { SessionReplayService } from './session-replay.service';
import { CostOptimizationEngineService } from './cost-optimization-engine.service';
import { BedrockService } from '@/modules/bedrock/bedrock.service';
import { IntegrationService } from '../../integration/integration.service';
import { calculateCost } from '@/utils/pricing';
import { sanitizeModelName } from '@/utils/optimizationUtils';
import { extractErrorDetails } from '@/utils/helpers';

// Lazy-loaded imports for optional dependencies
let stripe: any = null;
let AWS: any = null;

interface UsageFilters {
  userId: string;
  projectId?: string;
  service?: string;
  model?: string;
  startDate?: Date;
  endDate?: Date;
  tags?: string[];
  minCost?: number;
  maxCost?: number;
  customProperties?: Record<string, string>;
  propertyExists?: string[];
}

interface PaginationOptions {
  page: number;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
}

interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  summary?: {
    totalCost: number;
    totalTokens: number;
    avgCost: number;
    avgTokens: number;
  };
}

interface UsageStats {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  avgCostPerRequest: number;
  avgTokensPerRequest: number;
  avgResponseTime: number;
  costByService: Record<string, number>;
  costByModel: Record<string, number>;
  costByProject: Record<string, number>;
  usageOverTime: Array<{
    date: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
}

interface AnomalyDetection {
  anomalies: Array<{
    usageId?: string;
    type:
      | 'cost_spike'
      | 'token_spike'
      | 'error_rate'
      | 'performance_degradation'
      | 'unusual_pattern';
    severity: 'low' | 'medium' | 'high';
    description: string;
    timestamp?: string;
    value?: number;
    threshold?: number;
    detectedAt?: Date;
    metrics?: Record<string, any>;
  }>;
  summary?: {
    totalAnomalies: number;
    highSeverityCount: number;
    mediumSeverityCount: number;
    lowSeverityCount: number;
  };
  recommendations?: string[];
}

@Injectable()
export class UsageService implements OnModuleDestroy {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @InjectModel(Alert.name) private alertModel: Model<AlertDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @Inject(
      forwardRef(
        () => require('./realtime-update.service').RealtimeUpdateService,
      ),
    )
    private realtimeUpdateService: RealtimeUpdateService,
    private sessionReplayService: SessionReplayService,
    private costOptimizationEngine: CostOptimizationEngineService,
    private bedrockService: BedrockService,
    private integrationService: IntegrationService,
  ) {}

  /**
   * Graceful shutdown: clear in-memory state and allow background work to drain.
   * RealtimeUpdateService cleans up its own intervals/Redis in its onModuleDestroy.
   */
  cleanup(): void {
    this.logger.log('UsageService cleanup called');
  }

  async onModuleDestroy(): Promise<void> {
    this.cleanup();
    await Promise.resolve();
  }

  /**
   * Track usage - creates a new usage record
   */
  async trackUsage(usageData: {
    userId: string;
    service?: string;
    model: string;
    prompt?: string;
    completion?: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
    cost?: number;
    responseTime: number;
    metadata?: Record<string, any>;
    tags?: string[];
    projectId?: string;
    workflowId?: string;
    workflowName?: string;
    workflowStep?: string;
    workflowSequence?: number;
    userEmail?: string;
    customerEmail?: string;
    errorOccurred?: boolean;
    errorMessage?: string;
    httpStatusCode?: number;
    errorType?: string;
    optimizationApplied?: boolean;
  }): Promise<UsageDocument> {
    try {
      const {
        userId,
        service = 'openai',
        model,
        prompt = '',
        completion = '',
        promptTokens,
        completionTokens,
        totalTokens,
        cost,
        responseTime,
        metadata = {},
        tags = [],
        projectId,
        workflowId,
        workflowName,
        workflowStep,
        workflowSequence,
        userEmail,
        customerEmail,
        errorOccurred = false,
        errorMessage,
        httpStatusCode,
        errorType,
        optimizationApplied = false,
      } = usageData;

      // Sanitize model name
      const sanitizedModel = sanitizeModelName(model);

      // Calculate total tokens if not provided
      const calculatedTotalTokens =
        totalTokens || promptTokens + completionTokens;

      // Calculate cost if not provided
      let calculatedCost = cost;
      if (!calculatedCost) {
        try {
          calculatedCost = calculateCost(
            promptTokens,
            completionTokens,
            service,
            sanitizedModel,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to calculate cost for ${service}/${sanitizedModel}`,
            error,
          );
          calculatedCost = 0;
        }
      }

      // Extract error details if error occurred
      let errorDetails = {};
      if (errorOccurred || errorMessage || httpStatusCode) {
        errorDetails = extractErrorDetails(
          {
            errorMessage,
            httpStatusCode,
            errorType,
          },
          { originalUrl: '/api/usage/track' },
        );
      }

      const usageRecord = new this.usageModel({
        userId,
        projectId,
        service,
        model: sanitizedModel,
        prompt,
        completion,
        promptTokens,
        completionTokens,
        totalTokens: calculatedTotalTokens,
        cost: calculatedCost,
        responseTime,
        metadata,
        tags,
        optimizationApplied,
        errorOccurred,
        errorMessage,
        httpStatusCode,
        errorType,
        errorDetails,
        userEmail,
        customerEmail,
        workflowId,
        workflowName,
        workflowStep,
        workflowSequence,
        createdAt: new Date(),
      });

      const savedUsage = await usageRecord.save();

      // Emit real-time update
      await this.realtimeUpdateService.emitUsageUpdate(userId, savedUsage);

      this.logger.log(`Usage tracked for user ${userId}: ${savedUsage._id}`);
      return savedUsage;
    } catch (error) {
      this.logger.error(
        `Failed to track usage for user ${usageData.userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get usage records with pagination and filtering
   */
  async getUsage(
    filters: UsageFilters,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<UsageDocument>> {
    try {
      const {
        userId,
        projectId,
        service,
        model,
        startDate,
        endDate,
        tags,
        minCost,
        maxCost,
        customProperties,
        propertyExists,
      } = filters;

      // Require userId for usage queries - throw when unauthenticated
      if (!userId) {
        throw new UnauthorizedException(
          'Authentication required to fetch usage data',
        );
      }

      const page = Math.max(1, parseInt(String(pagination.page), 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(pagination.limit), 10) || 20),
      );
      const sort = pagination.sort || 'createdAt';
      const order = pagination.order || 'desc';

      // Build match query - explicitly convert userId to ObjectId for reliable MongoDB matching
      const matchQuery: any = {
        userId:
          typeof userId === 'string' && userId
            ? new Types.ObjectId(userId)
            : userId,
      };

      if (projectId) matchQuery.projectId = projectId;
      if (service) matchQuery.service = service;
      if (model) matchQuery.model = model;

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      if (tags && tags.length > 0) {
        matchQuery.tags = { $in: tags };
      }

      if (minCost !== undefined || maxCost !== undefined) {
        matchQuery.cost = {};
        if (minCost !== undefined) matchQuery.cost.$gte = minCost;
        if (maxCost !== undefined) matchQuery.cost.$lte = maxCost;
      }

      // Custom properties filter
      if (customProperties) {
        Object.entries(customProperties).forEach(([key, value]) => {
          matchQuery[`metadata.${key}`] = value;
        });
      }

      // Property exists filter
      if (propertyExists && propertyExists.length > 0) {
        propertyExists.forEach((prop) => {
          matchQuery[`metadata.${prop}`] = { $exists: true, $ne: null };
        });
      }

      // Get total count and execute find via native collection for reliable matching
      // (Mongoose find/countDocuments can diverge from aggregate with same query in some setups)
      const total = await this.usageModel.collection.countDocuments(matchQuery);

      const sortDir = order === 'desc' ? -1 : 1;
      const data = await this.usageModel.collection
        .find(matchQuery)
        .sort({ [sort]: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();

      // Calculate summary
      const summary = await this.calculateUsageSummary(matchQuery);

      const result: PaginatedResult<UsageDocument> = {
        data: data as any,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
        summary,
      };

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get usage for user ${filters.userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(
    userId: string,
    period: 'daily' | 'weekly' | 'monthly' = 'monthly',
    projectId?: string,
  ): Promise<UsageStats> {
    try {
      // Build date range
      const { start, end } = this.getDateRange(period);

      const matchQuery: any = {
        userId,
        createdAt: { $gte: start, $lte: end },
      };

      if (projectId) {
        matchQuery.projectId = projectId;
      }

      // Aggregate statistics
      const stats = await this.usageModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
            avgCostPerRequest: { $avg: '$cost' },
            avgTokensPerRequest: { $avg: '$totalTokens' },
            avgResponseTime: { $avg: '$responseTime' },
            costByService: {
              $push: { service: '$service', cost: '$cost' },
            },
            costByModel: {
              $push: { model: '$model', cost: '$cost' },
            },
            costByProject: {
              $push: { projectId: '$projectId', cost: '$cost' },
            },
          },
        },
      ]);

      const baseStats = stats[0] || {
        totalCost: 0,
        totalTokens: 0,
        totalRequests: 0,
        avgCostPerRequest: 0,
        avgTokensPerRequest: 0,
        avgResponseTime: 0,
        costByService: [],
        costByModel: [],
        costByProject: [],
      };

      // Process grouped data
      const costByService = this.groupCosts(baseStats.costByService, 'service');
      const costByModel = this.groupCosts(baseStats.costByModel, 'model');
      const costByProject = this.groupCosts(
        baseStats.costByProject,
        'projectId',
      );

      // Get usage over time
      const usageOverTime = await this.getUsageOverTime(matchQuery, period);

      return {
        totalCost: baseStats.totalCost,
        totalTokens: baseStats.totalTokens,
        totalRequests: baseStats.totalRequests,
        avgCostPerRequest: baseStats.avgCostPerRequest,
        avgTokensPerRequest: baseStats.avgTokensPerRequest,
        avgResponseTime: baseStats.avgResponseTime,
        costByService,
        costByModel,
        costByProject,
        usageOverTime,
      };
    } catch (error) {
      this.logger.error(`Failed to get usage stats for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Get usage analytics for dashboards - filtered records with aggregated stats
   */
  async getUsageAnalytics(
    userId: string,
    params: {
      timeRange?: '1h' | '24h' | '7d' | '30d';
      status?: 'all' | 'success' | 'error';
      model?: string;
      service?: string;
      projectId?: string;
      limit?: number;
    },
  ): Promise<{
    requests: Array<{
      id: string;
      timestamp: Date;
      model: string;
      service: string;
      status: 'success' | 'error';
      statusCode: number;
      latency: number;
      totalTokens: number;
      cost: number;
      user: string;
    }>;
    stats: {
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
      avgResponseTime: number;
      errorCount: number;
      successCount: number;
      successRate: string;
    };
  }> {
    if (!userId) {
      throw new UnauthorizedException(
        'Authentication required to fetch usage analytics',
      );
    }

    const { start, end } = this.parseTimeRange(params.timeRange || '7d');

    const matchQuery: any = {
      userId: new Types.ObjectId(userId),
      createdAt: { $gte: start, $lte: end },
    };

    if (params.projectId && params.projectId !== 'all') {
      matchQuery.projectId = new Types.ObjectId(params.projectId);
    }
    if (params.service) matchQuery.service = params.service;
    if (params.model) matchQuery.model = params.model;

    if (params.status === 'success') {
      matchQuery.errorOccurred = false;
    } else if (params.status === 'error') {
      matchQuery.errorOccurred = true;
    }

    const limit = Math.min(500, params.limit || 100);

    const [records, statsResult] = await Promise.all([
      this.usageModel.collection
        .find(matchQuery)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
      this.usageModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
            successCount: { $sum: { $cond: ['$errorOccurred', 0, 1] } },
          },
        },
      ]),
    ]);

    const statsData = statsResult[0] || {
      totalCost: 0,
      totalTokens: 0,
      totalRequests: 0,
      avgResponseTime: 0,
      errorCount: 0,
      successCount: 0,
    };

    const totalRequests = statsData.totalRequests || 0;
    const successRate =
      totalRequests > 0
        ? (((statsData.successCount || 0) / totalRequests) * 100).toFixed(1) +
          '%'
        : '0%';

    const requests = (records as any[]).map((r) => ({
      id: r._id?.toString() ?? '',
      timestamp: r.createdAt,
      model: r.model ?? '',
      service: r.service ?? '',
      status: (r.errorOccurred ? 'error' : 'success') as 'success' | 'error',
      statusCode: r.httpStatusCode ?? (r.errorOccurred ? 500 : 200),
      latency: r.responseTime ?? 0,
      totalTokens: r.totalTokens ?? 0,
      cost: r.cost ?? 0,
      user: r.userId?.toString() ?? '',
    }));

    return {
      requests,
      stats: {
        totalCost: statsData.totalCost ?? 0,
        totalTokens: statsData.totalTokens ?? 0,
        totalRequests,
        avgResponseTime: statsData.avgResponseTime ?? 0,
        errorCount: statsData.errorCount ?? 0,
        successCount: statsData.successCount ?? 0,
        successRate,
      },
    };
  }

  /**
   * Parse timeRange string (1h, 24h, 7d, 30d) to start/end dates
   */
  private parseTimeRange(timeRange: '1h' | '24h' | '7d' | '30d'): {
    start: Date;
    end: Date;
  } {
    const end = new Date();
    const start = new Date(end);

    switch (timeRange) {
      case '1h':
        start.setHours(start.getHours() - 1);
        break;
      case '24h':
        start.setDate(start.getDate() - 1);
        break;
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
      default:
        start.setDate(start.getDate() - 7);
    }

    return { start, end };
  }

  /**
   * Get contextual data for usage filtering
   */
  async getContextualData(
    userId: string,
    projectId?: string,
    timeRange?: { start: Date; end: Date },
  ): Promise<{
    templates: Array<{
      id: string;
      name: string;
      category: string;
      usage: number;
    }>;
    workflows: Array<{ id: string; name: string; usage: number }>;
    projects: Array<{ id: string; name: string; usage: number }>;
    services: Array<{ name: string; usage: number; cost: number }>;
  }> {
    try {
      const matchQuery: any = { userId };
      if (projectId) matchQuery.projectId = projectId;
      if (timeRange) {
        matchQuery.createdAt = {
          $gte: timeRange.start,
          $lte: timeRange.end,
        };
      }

      // Get template usage
      const templateStats = await this.usageModel.aggregate([
        {
          $match: {
            ...matchQuery,
            'templateUsage.templateId': { $exists: true },
          },
        },
        {
          $group: {
            _id: {
              id: '$templateUsage.templateId',
              name: '$templateUsage.templateName',
              category: '$templateUsage.templateCategory',
            },
            usage: { $sum: 1 },
            cost: { $sum: '$cost' },
          },
        },
        { $sort: { usage: -1 } },
        { $limit: 10 },
      ]);

      // Get workflow usage
      const workflowStats = await this.usageModel.aggregate([
        { $match: { ...matchQuery, workflowId: { $exists: true } } },
        {
          $group: {
            _id: {
              id: '$workflowId',
              name: '$workflowName',
            },
            usage: { $sum: 1 },
          },
        },
        { $sort: { usage: -1 } },
        { $limit: 10 },
      ]);

      // Get project usage
      const projectStats = await this.usageModel.aggregate([
        { $match: { ...matchQuery, projectId: { $exists: true } } },
        {
          $group: {
            _id: '$projectId',
            usage: { $sum: 1 },
          },
        },
        { $sort: { usage: -1 } },
        { $limit: 10 },
      ]);

      // Get service usage
      const serviceStats = await this.usageModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$service',
            usage: { $sum: 1 },
            cost: { $sum: '$cost' },
          },
        },
        { $sort: { cost: -1 } },
        { $limit: 10 },
      ]);

      return {
        templates: templateStats.map((t) => ({
          id: t._id.id,
          name: t._id.name,
          category: t._id.category,
          usage: t.usage,
        })),
        workflows: workflowStats.map((w) => ({
          id: w._id.id,
          name: w._id.name,
          usage: w.usage,
        })),
        projects: projectStats.map((p) => ({
          id: p._id,
          name: p._id, // Would need to join with project collection for name
          usage: p.usage,
        })),
        services: serviceStats.map((s) => ({
          name: s._id,
          usage: s.usage,
          cost: s.cost,
        })),
      };
    } catch (error) {
      this.logger.error(
        `Failed to get contextual data for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Detect anomalies in usage patterns
   */
  async detectAnomalies(
    userId: string,
    projectId?: string,
  ): Promise<AnomalyDetection> {
    try {
      // Get recent usage data (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const matchQuery: any = {
        userId,
        createdAt: { $gte: thirtyDaysAgo },
      };

      if (projectId) {
        matchQuery.projectId = projectId;
      }

      const recentUsage = await this.usageModel
        .find(matchQuery)
        .sort({ createdAt: -1 })
        .limit(100)
        .select('createdAt cost totalTokens')
        .lean();

      // Get historical averages (last 30 days)
      const historicalStats = await this.usageModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            avgCost: { $avg: '$cost' },
            avgTokens: { $avg: '$totalTokens' },
          },
        },
      ]);

      if (recentUsage.length === 0 || !historicalStats[0]) {
        return {
          anomalies: [],
          recommendations: [],
        };
      }

      // Use LLM for intelligent anomaly detection
      const analysisPrompt = `Analyze the following usage data for anomalies:

Recent Usage Data:
${JSON.stringify(
  recentUsage.map((u) => ({
    timestamp: u.createdAt,
    cost: u.cost,
    tokens: u.totalTokens,
  })),
  null,
  2,
)}

Historical Averages:
- Average Cost: ${historicalStats[0].avgCost}
- Average Tokens: ${historicalStats[0].avgTokens}

Identify any anomalies in cost or token usage patterns. Return a JSON object with:
{
  "anomalies": [
    {
      "type": "cost_spike" | "token_spike" | "unusual_pattern",
      "severity": "low" | "medium" | "high",
      "description": "string",
      "timestamp": "ISO date",
      "value": number,
      "threshold": number
    }
  ],
  "recommendations": ["string array of recommendations"]
}`;

      const responseResult = await BedrockService.invokeModel(
        analysisPrompt,
        'amazon.nova-lite-v1:0',
        { useSystemPrompt: false },
      );

      // Parse the response - invokeModel returns string
      let anomalyResult;
      try {
        const responseText =
          typeof responseResult === 'string'
            ? responseResult
            : String((responseResult as { response?: string })?.response ?? '');
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          anomalyResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch (parseError) {
        this.logger.warn(
          'Failed to parse anomaly detection response, using defaults',
          { parseError },
        );
        anomalyResult = { anomalies: [], recommendations: [] };
      }

      // Create alerts for high severity anomalies
      for (const anomaly of anomalyResult.anomalies || []) {
        if (anomaly.severity === 'high') {
          try {
            await this.alertModel.create({
              userId,
              type: 'usage_spike',
              title: 'Unusual Usage Pattern Detected',
              message: anomaly.description,
              severity: anomaly.severity,
              data: { anomaly, projectId },
            });
            this.logger.log('Created alert for high-severity anomaly', {
              userId,
              anomalyType: anomaly.type,
            });
          } catch (alertError) {
            this.logger.error('Failed to create anomaly alert', {
              alertError,
              userId,
              anomaly,
            });
          }
        }
      }

      return anomalyResult;
    } catch (error) {
      this.logger.error('Error detecting anomalies', { error });
      return { anomalies: [], recommendations: [] };
    }
  }

  /**
   * Search usage records
   */
  async searchUsage(
    userId: string,
    query: string,
    pagination: PaginationOptions,
    projectId?: string,
    filters?: Partial<UsageFilters>,
  ): Promise<PaginatedResult<UsageDocument>> {
    try {
      if (!userId) {
        throw new UnauthorizedException(
          'Authentication required to search usage data',
        );
      }

      const { page, limit, sort, order } = pagination;

      // Build search query
      const searchQuery: any = {
        userId:
          typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
        $or: [
          { prompt: { $regex: query, $options: 'i' } },
          { completion: { $regex: query, $options: 'i' } },
          { model: { $regex: query, $options: 'i' } },
          { service: { $regex: query, $options: 'i' } },
          { tags: { $in: [new RegExp(query, 'i')] } },
          { 'metadata.prompt': { $regex: query, $options: 'i' } },
          { errorMessage: { $regex: query, $options: 'i' } },
        ],
      };

      if (projectId) {
        searchQuery.projectId = projectId;
      }

      // Apply additional filters
      if (filters) {
        if (filters.service) searchQuery.service = filters.service;
        if (filters.model) searchQuery.model = filters.model;
        if (filters.startDate || filters.endDate) {
          searchQuery.createdAt = {};
          if (filters.startDate) searchQuery.createdAt.$gte = filters.startDate;
          if (filters.endDate) searchQuery.createdAt.$lte = filters.endDate;
        }
        if (filters.tags && filters.tags.length > 0) {
          searchQuery.tags = { $in: filters.tags };
        }
      }

      // Get total count
      const total = await this.usageModel.countDocuments(searchQuery);

      // Build sort query
      const sortQuery: any = {};
      sortQuery[sort] = order === 'desc' ? -1 : 1;
      sortQuery.score = { $meta: 'textScore' }; // For text search relevance

      // Execute search
      const data = await this.usageModel
        .find(searchQuery, { score: { $meta: 'textScore' } })
        .sort(sortQuery)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const result: PaginatedResult<UsageDocument> = {
        data: data as any,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      };

      return result;
    } catch (error) {
      this.logger.error(`Failed to search usage for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Bulk track usage records
   */
  async bulkTrackUsage(
    usageRecords: Array<{
      userId: string;
      [key: string]: any;
    }>,
  ): Promise<UsageDocument[]> {
    try {
      const savedRecords: UsageDocument[] = [];

      // Process in batches to avoid overwhelming the database
      const batchSize = 10;
      for (let i = 0; i < usageRecords.length; i += batchSize) {
        const batch = usageRecords.slice(
          i,
          Math.min(i + batchSize, usageRecords.length),
        );

        const bulkOps = batch.map((record) => ({
          insertOne: {
            document: {
              ...record,
              model: sanitizeModelName(record.model),
              createdAt: new Date(),
            },
          },
        }));

        const result = await this.usageModel.bulkWrite(bulkOps, {
          ordered: false,
        });
        this.logger.log(
          `Bulk insert batch ${Math.floor(i / batchSize) + 1}: ${result.insertedCount} records`,
        );
      }

      // Retrieve the saved records
      const userIds = [...new Set(usageRecords.map((r) => r.userId))];
      const recentRecords = await this.usageModel
        .find({ userId: { $in: userIds } })
        .sort({ createdAt: -1 })
        .limit(usageRecords.length)
        .exec();

      // Emit real-time updates for each user
      const userUpdates = new Map<string, UsageDocument[]>();
      recentRecords.forEach((record) => {
        if (!userUpdates.has(record.userId.toString())) {
          userUpdates.set(record.userId.toString(), []);
        }
        userUpdates.get(record.userId.toString())!.push(record);
      });

      for (const [userId, records] of userUpdates) {
        for (const record of records) {
          await this.realtimeUpdateService.emitUsageUpdate(userId, record);
        }
      }

      this.logger.log(`Bulk tracked ${usageRecords.length} usage records`);
      return recentRecords;
    } catch (error) {
      this.logger.error('Failed to bulk track usage', error);
      throw error;
    }
  }

  /**
   * Get CLI analytics with team usage, budget comparisons, and AI insights
   */
  async getCLIAnalytics(
    userId: string,
    options: {
      days?: number;
      project?: string;
      user?: string;
    } = {},
  ): Promise<{
    totalCost: {
      currentPeriod: number;
      previousPeriod: number;
      change: number;
      changePercent: number;
      budget: number;
      budgetRemaining: number;
      budgetUsedPercent: number;
    };
    tokenUsage: {
      total: number;
      input: number;
      output: number;
      inputPercentage: number;
      outputPercentage: number;
      efficiency: number;
    };
    summary: {
      totalRequests: number;
      totalCost: number;
      totalTokens: number;
      avgResponseTime: number;
      avgCostPerRequest: number;
      avgTokensPerRequest: number;
    };
    topModelsBySpend: Array<{
      model: string;
      cost: number;
      percentage: number;
      requests: number;
    }>;
    teamUsage: Array<{
      userId: string;
      userName?: string;
      cost: number;
      requests: number;
      percentage: number;
    }>;
    insights: Array<{
      type: 'warning' | 'info' | 'success' | 'error';
      message: string;
      priority: 'low' | 'medium' | 'high';
      data?: any;
    }>;
    trends: Array<{
      date: string;
      requests: number;
      cost: number;
      tokens: number;
    }>;
  }> {
    const { days = 30, project: projectFilter, user: userFilter } = options;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const previousStartDate = new Date(
      startDate.getTime() - days * 24 * 60 * 60 * 1000,
    );

    // Build match criteria
    const match: any = {
      userId: userFilter || userId,
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (projectFilter) {
      // Check if project is a valid ObjectId, otherwise treat as project name
      if (this.isValidObjectId(projectFilter)) {
        match.projectId = projectFilter;
      } else {
        // Treat as project name and look up the project ID
        const projectDoc = await this.projectModel.findOne({
          name: projectFilter,
          $or: [{ ownerId: userId }, { 'members.userId': userId }],
        });
        if (projectDoc) {
          match.projectId = projectDoc._id;
        } else {
          return {
            totalCost: {
              currentPeriod: 0,
              previousPeriod: 0,
              change: 0,
              changePercent: 0,
              budget: 0,
              budgetRemaining: 0,
              budgetUsedPercent: 0,
            },
            tokenUsage: {
              total: 0,
              input: 0,
              output: 0,
              inputPercentage: 0,
              outputPercentage: 0,
              efficiency: 0,
            },
            summary: {
              totalRequests: 0,
              totalCost: 0,
              totalTokens: 0,
              avgResponseTime: 0,
              avgCostPerRequest: 0,
              avgTokensPerRequest: 0,
            },
            topModelsBySpend: [],
            teamUsage: [],
            insights: [
              {
                type: 'warning' as const,
                message: `Project "${projectFilter}" not found`,
                priority: 'medium' as const,
              },
            ],
            trends: [],
          };
        }
      }
    }

    // Get project budget if applicable
    let projectBudget = 0;
    if (match.projectId) {
      const project = await this.projectModel.findById(match.projectId);
      projectBudget = project?.budget?.amount || 0;
    }

    // Parallel data fetching
    const [
      currentPeriodData,
      previousPeriodData,
      modelBreakdown,
      teamBreakdown,
      trendsData,
    ] = await Promise.all([
      // Current period summary
      this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalPromptTokens: { $sum: '$promptTokens' },
            totalCompletionTokens: { $sum: '$completionTokens' },
            avgResponseTime: { $avg: '$responseTime' },
          },
        },
      ]),

      // Previous period for comparison
      this.usageModel.aggregate([
        {
          $match: {
            ...match,
            createdAt: { $gte: previousStartDate, $lt: startDate },
          },
        },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
          },
        },
      ]),

      // Model breakdown
      this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$model',
            cost: { $sum: '$cost' },
            requests: { $sum: 1 },
          },
        },
        { $sort: { cost: -1 } },
        { $limit: 10 },
      ]),

      // Team usage breakdown
      this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$userId',
            cost: { $sum: '$cost' },
            requests: { $sum: 1 },
          },
        },
        { $sort: { cost: -1 } },
      ]),

      // Trends data (daily)
      this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            requests: { $sum: 1 },
            cost: { $sum: '$cost' },
            tokens: { $sum: '$totalTokens' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Extract data
    const currentData = currentPeriodData[0] || {
      totalRequests: 0,
      totalCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      avgResponseTime: 0,
    };
    const previousData = previousPeriodData[0] || { totalCost: 0 };

    // Calculate cost comparisons
    const currentPeriodCost = currentData.totalCost || 0;
    const previousPeriodCost = previousData.totalCost || 0;
    const costChange = currentPeriodCost - previousPeriodCost;
    const costChangePercent =
      previousPeriodCost > 0 ? (costChange / previousPeriodCost) * 100 : 0;

    // Calculate budget metrics
    const budgetRemaining = projectBudget - currentPeriodCost;
    const budgetUsedPercent =
      projectBudget > 0 ? (currentPeriodCost / projectBudget) * 100 : 0;

    // Calculate token usage breakdown
    const totalTokens = currentData.totalTokens || 0;
    const inputTokens = currentData.totalPromptTokens || 0;
    const outputTokens = currentData.totalCompletionTokens || 0;
    const inputPercentage =
      totalTokens > 0 ? (inputTokens / totalTokens) * 100 : 0;
    const outputPercentage =
      totalTokens > 0 ? (outputTokens / totalTokens) * 100 : 0;
    const efficiency = outputTokens > 0 ? inputTokens / outputTokens : 0;

    // Calculate summary metrics
    const totalRequests = currentData.totalRequests || 0;
    const avgCostPerRequest =
      totalRequests > 0 ? currentPeriodCost / totalRequests : 0;
    const avgTokensPerRequest =
      totalRequests > 0 ? totalTokens / totalRequests : 0;

    // Process model breakdown with percentages
    const totalModelCost = modelBreakdown.reduce(
      (sum, model) => sum + model.cost,
      0,
    );
    const topModelsBySpend = modelBreakdown.map((model) => ({
      model: model._id,
      cost: model.cost,
      percentage: totalModelCost > 0 ? (model.cost / totalModelCost) * 100 : 0,
      requests: model.requests,
    }));

    // Process team usage with user names and percentages
    const teamUsage = await Promise.all(
      teamBreakdown.map(async (user) => {
        // Try to get user name from user model
        let userName: string | undefined;
        try {
          const userDoc = await this.getUserById(user._id);
          userName = userDoc?.name || userDoc?.email?.split('@')[0];
        } catch (error) {
          // Ignore errors, just leave userName undefined
        }

        return {
          userId: user._id,
          userName,
          cost: user.cost,
          requests: user.requests,
          percentage:
            currentPeriodCost > 0 ? (user.cost / currentPeriodCost) * 100 : 0,
        };
      }),
    );

    // Generate AI insights
    const insights = await this.generateCostInsights(
      currentPeriodCost,
      previousPeriodCost,
      topModelsBySpend,
      teamUsage,
      budgetUsedPercent,
      projectBudget,
    );

    // Format trends data
    const trends = trendsData.map((trend) => ({
      date: trend._id,
      requests: trend.requests,
      cost: trend.cost,
      tokens: trend.tokens,
    }));

    return {
      totalCost: {
        currentPeriod: currentPeriodCost,
        previousPeriod: previousPeriodCost,
        change: costChange,
        changePercent: costChangePercent,
        budget: projectBudget,
        budgetRemaining,
        budgetUsedPercent,
      },
      tokenUsage: {
        total: totalTokens,
        input: inputTokens,
        output: outputTokens,
        inputPercentage,
        outputPercentage,
        efficiency,
      },
      summary: {
        totalRequests,
        totalCost: currentPeriodCost,
        totalTokens,
        avgResponseTime: currentData.avgResponseTime || 0,
        avgCostPerRequest,
        avgTokensPerRequest,
      },
      topModelsBySpend,
      teamUsage,
      insights,
      trends,
    };
  }

  /**
   * Get property analytics
   */
  async getPropertyAnalytics(
    userId: string,
    options: {
      groupBy: string;
      startDate?: Date;
      endDate?: Date;
      projectId?: string;
    },
  ): Promise<
    Array<{
      property: string;
      value: string;
      count: number;
      totalCost: number;
      avgCost: number;
    }>
  > {
    try {
      const { groupBy, startDate, endDate, projectId } = options;

      const matchQuery: any = { userId };
      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }
      if (projectId) matchQuery.projectId = projectId;

      const analytics = await this.usageModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: `$metadata.${groupBy}`,
            count: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            avgCost: { $avg: '$cost' },
          },
        },
        {
          $project: {
            _id: 0,
            property: { $literal: groupBy },
            value: '$_id',
            count: 1,
            totalCost: 1,
            avgCost: 1,
          },
        },
        { $sort: { totalCost: -1 } },
        { $limit: 50 },
      ]);

      return analytics.filter(
        (item) => item.value !== null && item.value !== undefined,
      );
    } catch (error) {
      this.logger.error(
        `Failed to get property analytics for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get available properties for analytics
   */
  async getAvailableProperties(
    userId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      projectId?: string;
    } = {},
  ): Promise<
    Array<{
      property: string;
      values: string[];
      count: number;
    }>
  > {
    try {
      const { startDate, endDate, projectId } = options;

      const matchQuery: any = { userId };
      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }
      if (projectId) matchQuery.projectId = projectId;

      // Sample recent records to discover properties
      const sampleRecords = await this.usageModel
        .find(matchQuery)
        .sort({ createdAt: -1 })
        .limit(100)
        .select('metadata')
        .lean();

      const propertyMap = new Map<string, Set<string>>();

      // Extract all metadata keys and their values
      sampleRecords.forEach((record) => {
        if (record.metadata) {
          this.extractMetadataProperties(record.metadata, '', propertyMap);
        }
      });

      const availableProperties: Array<{
        property: string;
        values: string[];
        count: number;
      }> = [];

      for (const [property, values] of propertyMap) {
        if (values.size > 0) {
          availableProperties.push({
            property,
            values: Array.from(values).slice(0, 10), // Limit to 10 example values
            count: values.size,
          });
        }
      }

      return availableProperties.sort((a, b) => b.count - a.count);
    } catch (error) {
      this.logger.error(
        `Failed to get available properties for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update usage properties
   */
  async updateUsageProperties(
    usageId: string,
    userId: string,
    properties: Record<string, any>,
  ): Promise<UsageDocument | null> {
    try {
      const updatedUsage = await this.usageModel.findOneAndUpdate(
        { _id: usageId, userId },
        {
          $set: {
            metadata: {
              ...((await this.usageModel.findById(usageId).select('metadata'))
                ?.metadata || {}),
              ...properties,
            },
            updatedAt: new Date(),
          },
        },
        { new: true },
      );

      if (updatedUsage) {
        this.logger.log(`Updated properties for usage ${usageId}`);
      }

      return updatedUsage;
    } catch (error) {
      this.logger.error(
        `Failed to update usage properties for ${usageId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get usage by ID
   */
  async getUsageById(
    usageId: string,
    userId: string,
  ): Promise<UsageDocument | null> {
    try {
      const query: any = {
        _id: new Types.ObjectId(usageId),
        userId:
          typeof userId === 'string' && userId
            ? new Types.ObjectId(userId)
            : userId,
      };
      const doc = await this.usageModel.collection.findOne(query);
      return doc as UsageDocument | null;
    } catch (error) {
      this.logger.error(`Failed to get usage by ID ${usageId}`, error);
      throw error;
    }
  }

  /**
   * Update usage record
   */
  async updateUsage(
    usageId: string,
    updateData: Partial<UsageDocument>,
  ): Promise<UsageDocument | null> {
    try {
      const updatedUsage = await this.usageModel.findByIdAndUpdate(
        usageId,
        { ...updateData, updatedAt: new Date() },
        { new: true },
      );

      if (updatedUsage) {
        this.logger.log(`Updated usage ${usageId}`);
      }

      return updatedUsage;
    } catch (error) {
      this.logger.error(`Failed to update usage ${usageId}`, error);
      throw error;
    }
  }

  /**
   * Delete usage record
   */
  async deleteUsage(usageId: string): Promise<boolean> {
    try {
      const result = await this.usageModel.findByIdAndDelete(usageId);
      const deleted = !!result;

      if (deleted) {
        this.logger.log(`Deleted usage ${usageId}`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete usage ${usageId}`, error);
      throw error;
    }
  }

  /**
   * Get recent usage for user (for real-time updates)
   */
  async getRecentUsageForUser(
    userId: string,
    limit: number = 10,
  ): Promise<UsageDocument[]> {
    try {
      return (await this.usageModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()) as any;
    } catch (error) {
      this.logger.error(`Failed to get recent usage for user ${userId}`, error);
      return [];
    }
  }

  /**
   * Sync historical data from external sources
   */
  async syncHistoricalData(
    userId: string,
    source: 'stripe' | 'aws' | 'openai' | 'anthropic' | 'google',
    options: {
      startDate?: Date;
      endDate?: Date;
      projectId?: string;
    } = {},
  ): Promise<{
    syncedRecords: number;
    skippedRecords: number;
    errors: string[];
  }> {
    const startDate =
      options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const endDate = options.endDate || new Date();

    this.logger.log(`Starting historical data sync for ${source}`, {
      userId,
      startDate,
      endDate,
      projectId: options.projectId,
    });

    try {
      switch (source) {
        case 'stripe':
          return await this.syncStripeHistoricalData(
            userId,
            startDate,
            endDate,
            options.projectId,
          );
        case 'aws':
          return await this.syncAWSHistoricalData(
            userId,
            startDate,
            endDate,
            options.projectId,
          );
        case 'openai':
          return await this.syncOpenAIHistoricalData(
            userId,
            startDate,
            endDate,
            options.projectId,
          );
        case 'anthropic':
          return await this.syncAnthropicHistoricalData(
            userId,
            startDate,
            endDate,
            options.projectId,
          );
        case 'google':
          return await this.syncGoogleHistoricalData(
            userId,
            startDate,
            endDate,
            options.projectId,
          );
        default:
          throw new Error(`Unsupported data source: ${source}`);
      }
    } catch (error) {
      this.logger.error(`Failed to sync historical data from ${source}`, {
        error,
        userId,
      });
      return {
        syncedRecords: 0,
        skippedRecords: 0,
        errors: [
          `Failed to sync data from ${source}: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }

  private async syncStripeHistoricalData(
    userId: string,
    startDate: Date,
    endDate: Date,
    projectId?: string,
  ): Promise<{
    syncedRecords: number;
    skippedRecords: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let syncedRecords = 0;
    let skippedRecords = 0;

    try {
      // Get user's Stripe integration
      const integration = await this.getUserIntegration(userId, 'stripe_oauth');
      if (!integration) {
        return {
          syncedRecords: 0,
          skippedRecords: 0,
          errors: ['No Stripe integration found for user'],
        };
      }

      const credentials = integration.getCredentials();
      if (!stripe) {
        try {
          stripe = require('stripe')(credentials.apiKey);
        } catch (error) {
          return {
            syncedRecords: 0,
            skippedRecords: 0,
            errors: [
              'Stripe SDK not available. Install with: npm install stripe',
            ],
          };
        }
      }

      // Get charges (payments) within date range
      const charges = await stripe.charges.list({
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
          lte: Math.floor(endDate.getTime() / 1000),
        },
        limit: 100,
      });

      for (const charge of charges.data) {
        try {
          // Convert Stripe charge to usage record
          const usageData = {
            userId,
            projectId: projectId || charge.metadata?.projectId,
            service: 'stripe',
            model: 'payment',
            cost: charge.amount / 100, // Convert cents to dollars
            metadata: {
              stripeChargeId: charge.id,
              paymentMethod: charge.payment_method_details?.type,
              currency: charge.currency,
              description: charge.description,
              receiptUrl: charge.receipt_url,
            },
            createdAt: new Date(charge.created * 1000),
          };

          await this.usageModel.create(usageData);
          syncedRecords++;
        } catch (error) {
          this.logger.warn('Failed to sync Stripe charge', {
            chargeId: charge.id,
            error,
          });
          errors.push(`Failed to sync charge ${charge.id}`);
          skippedRecords++;
        }
      }
    } catch (error) {
      errors.push(
        `Stripe API error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { syncedRecords, skippedRecords, errors };
  }

  private async syncAWSHistoricalData(
    userId: string,
    startDate: Date,
    endDate: Date,
    projectId?: string,
  ): Promise<{
    syncedRecords: number;
    skippedRecords: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let syncedRecords = 0;
    let skippedRecords = 0;

    try {
      // Get user's AWS integration
      const integration = await this.getUserIntegration(userId, 'aws');
      if (!integration) {
        return {
          syncedRecords: 0,
          skippedRecords: 0,
          errors: ['No AWS integration found for user'],
        };
      }

      const credentials = integration.getCredentials();

      // Use AWS Cost Explorer API
      if (!AWS) {
        try {
          AWS = require('@aws-sdk/client-cost-explorer');
        } catch (error) {
          return {
            syncedRecords: 0,
            skippedRecords: 0,
            errors: [
              'AWS SDK not available. Install with: npm install @aws-sdk/client-cost-explorer',
            ],
          };
        }
      }
      const { CostExplorerClient, GetCostAndUsageCommand } = AWS;
      const costExplorer = new CostExplorerClient({
        region: credentials.region || 'us-east-1',
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
        },
      });

      const command = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: startDate.toISOString().split('T')[0],
          End: endDate.toISOString().split('T')[0],
        },
        Granularity: 'DAILY',
        Metrics: ['BlendedCost', 'UsageQuantity'],
        GroupBy: [
          { Type: 'DIMENSION', Key: 'SERVICE' },
          { Type: 'DIMENSION', Key: 'AZ' },
        ],
      });

      const response = await costExplorer.send(command);

      for (const group of response.Groups || []) {
        try {
          const service = group.Keys?.[0] || 'unknown';
          const region = group.Keys?.[1] || 'unknown';

          for (const metric of group.Metrics || []) {
            const date = metric.Groups?.[0]?.Keys?.[0];
            const cost = parseFloat(metric.Amount || '0');

            if (cost > 0) {
              const usageData = {
                userId,
                projectId,
                service: 'aws',
                model: service,
                cost,
                metadata: {
                  awsRegion: region,
                  awsService: service,
                  date,
                  currency: metric.Unit || 'USD',
                },
                createdAt: date ? new Date(date) : new Date(),
              };

              await this.usageModel.create(usageData);
              syncedRecords++;
            }
          }
        } catch (error) {
          this.logger.warn('Failed to sync AWS cost data', { error });
          errors.push(
            `Failed to sync AWS cost data: ${error instanceof Error ? error.message : String(error)}`,
          );
          skippedRecords++;
        }
      }
    } catch (error) {
      errors.push(
        `AWS API error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { syncedRecords, skippedRecords, errors };
  }

  private async syncOpenAIHistoricalData(
    userId: string,
    startDate: Date,
    endDate: Date,
    projectId?: string,
  ): Promise<{
    syncedRecords: number;
    skippedRecords: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let syncedRecords = 0;
    let skippedRecords = 0;

    try {
      // Get user's OpenAI integration (if any)
      const integration = await this.getUserIntegration(userId, 'openai');
      const apiKey =
        integration?.getCredentials()?.apiKey || process.env.OPENAI_API_KEY;

      if (!apiKey) {
        return {
          syncedRecords: 0,
          skippedRecords: 0,
          errors: ['No OpenAI API key found'],
        };
      }

      // OpenAI Usage API requires premium tier access
      // For users with premium access, we can fetch usage data
      try {
        const usage = await this.fetchOpenAIUsage(apiKey, startDate, endDate);

        for (const usageItem of usage) {
          try {
            // Convert OpenAI usage to internal format
            const usageData = {
              userId,
              projectId,
              service: 'openai',
              model: usageItem.model || 'unknown',
              promptTokens: usageItem.prompt_tokens || 0,
              completionTokens: usageItem.completion_tokens || 0,
              totalTokens: usageItem.total_tokens || 0,
              cost: this.calculateOpenAICost(usageItem),
              metadata: {
                openaiRequestId: usageItem.request_id,
                organizationId: usageItem.organization_id,
                apiVersion: usageItem.api_version,
              },
              createdAt: new Date(usageItem.timestamp * 1000),
            };

            await this.usageModel.create(usageData);
            syncedRecords++;
          } catch (error) {
            this.logger.warn('Failed to sync OpenAI usage item', {
              error,
              usageItem,
            });
            errors.push(`Failed to sync usage item: ${usageItem.request_id}`);
            skippedRecords++;
          }
        }
      } catch (apiError) {
        if (apiError instanceof Error && apiError.message.includes('403')) {
          errors.push('OpenAI Usage API requires premium tier access');
        } else {
          errors.push(
            `OpenAI API error: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
          );
        }
      }
    } catch (error) {
      errors.push(
        `OpenAI sync error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { syncedRecords, skippedRecords, errors };
  }

  private async fetchOpenAIUsage(
    apiKey: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any[]> {
    // OpenAI Usage API endpoint (requires premium tier)
    const url = 'https://api.openai.com/v1/usage';

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date_start: startDate.toISOString().split('T')[0],
        date_end: endDate.toISOString().split('T')[0],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API returned ${response.status}: ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.data || [];
  }

  private calculateOpenAICost(usageItem: any): number {
    // OpenAI pricing (approximate, should be updated with current rates)
    const modelPricing: Record<string, { prompt: number; completion: number }> =
      {
        'gpt-4': { prompt: 0.03, completion: 0.06 }, // per 1K tokens
        'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
        'gpt-3.5-turbo': { prompt: 0.0015, completion: 0.002 },
        'gpt-3.5-turbo-16k': { prompt: 0.003, completion: 0.004 },
        'davinci-002': { prompt: 0.002, completion: 0.002 },
        'babbage-002': { prompt: 0.0004, completion: 0.0004 },
      };

    const pricing = modelPricing[usageItem.model] || {
      prompt: 0.002,
      completion: 0.002,
    };
    const promptCost = ((usageItem.prompt_tokens || 0) * pricing.prompt) / 1000;
    const completionCost =
      ((usageItem.completion_tokens || 0) * pricing.completion) / 1000;

    return promptCost + completionCost;
  }

  private async syncAnthropicHistoricalData(
    userId: string,
    startDate: Date,
    endDate: Date,
    projectId?: string,
  ): Promise<{
    syncedRecords: number;
    skippedRecords: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let syncedRecords = 0;
    let skippedRecords = 0;

    try {
      // Get user's Anthropic integration
      const integration = await this.getUserIntegration(userId, 'anthropic');
      const apiKey =
        integration?.getCredentials()?.apiKey || process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        return {
          syncedRecords: 0,
          skippedRecords: 0,
          errors: ['No Anthropic API key found'],
        };
      }

      // Anthropic doesn't provide a historical usage API
      // Usage data is typically received via webhooks and stored locally
      // For historical sync, we check if there's a local usage log or webhook data

      try {
        // Check for stored Anthropic usage data (from webhooks)
        const storedUsage = await this.usageModel.find({
          userId,
          service: 'anthropic',
          createdAt: {
            $gte: startDate,
            $lte: endDate,
          },
          ...(projectId && { projectId }),
        });

        // If we have stored data, count it as already synced
        if (storedUsage.length > 0) {
          syncedRecords = storedUsage.length;
          this.logger.log(
            `Found ${storedUsage.length} stored Anthropic usage records in date range`,
          );
        } else {
          // No stored data found - suggest webhook setup
          errors.push(
            'No stored Anthropic usage data found. Set up Anthropic webhooks for automatic usage tracking.',
          );
        }

        // Optionally attempt to fetch from Anthropic's beta usage endpoint if available
        try {
          const apiUsage = await this.fetchAnthropicUsage(
            apiKey,
            startDate,
            endDate,
          );

          for (const usageItem of apiUsage) {
            try {
              // Check if we already have this usage record
              const existing = await this.usageModel.findOne({
                userId,
                'metadata.anthropicRequestId': usageItem.request_id,
              });

              if (existing) {
                skippedRecords++;
                continue;
              }

              // Convert Anthropic usage to internal format
              const usageData = {
                userId,
                projectId,
                service: 'anthropic',
                model: usageItem.model || 'unknown',
                promptTokens: usageItem.input_tokens || 0,
                completionTokens: usageItem.output_tokens || 0,
                totalTokens:
                  (usageItem.input_tokens || 0) +
                  (usageItem.output_tokens || 0),
                cost: this.calculateAnthropicCost(usageItem),
                metadata: {
                  anthropicRequestId: usageItem.request_id,
                  anthropicOrganizationId: usageItem.organization_id,
                  apiVersion: usageItem.api_version,
                },
                createdAt: new Date(usageItem.created_at),
              };

              await this.usageModel.create(usageData);
              syncedRecords++;
            } catch (error) {
              this.logger.warn('Failed to sync Anthropic usage item', {
                error,
                usageItem,
              });
              errors.push(`Failed to sync usage item: ${usageItem.request_id}`);
              skippedRecords++;
            }
          }
        } catch (apiError) {
          // API might not be available, that's OK
          this.logger.log(
            'Anthropic API usage endpoint not available or accessible',
          );
        }
      } catch (dbError) {
        errors.push(
          `Database error checking stored usage: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
        );
      }
    } catch (error) {
      errors.push(
        `Anthropic sync error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { syncedRecords, skippedRecords, errors };
  }

  private async fetchAnthropicUsage(
    apiKey: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any[]> {
    // Anthropic has a beta usage API endpoint (may not be publicly available)
    const url = 'https://api.anthropic.com/v1/usage';

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Anthropic API returned ${response.status}: ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.usage || [];
  }

  private calculateAnthropicCost(usageItem: any): number {
    // Anthropic pricing (approximate, should be updated with current rates)
    const modelPricing: Record<string, { input: number; output: number }> = {
      'claude-3-opus': { input: 0.015, output: 0.075 }, // per 1K tokens
      'claude-3-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-haiku': { input: 0.00025, output: 0.00125 },
      'claude-2': { input: 0.008, output: 0.024 },
      'claude-instant-1': { input: 0.0008, output: 0.0024 },
    };

    const pricing = modelPricing[usageItem.model] || {
      input: 0.008,
      output: 0.024,
    };
    const inputCost = ((usageItem.input_tokens || 0) * pricing.input) / 1000;
    const outputCost = ((usageItem.output_tokens || 0) * pricing.output) / 1000;

    return inputCost + outputCost;
  }

  private async syncGoogleHistoricalData(
    userId: string,
    startDate: Date,
    endDate: Date,
    projectId?: string,
  ): Promise<{
    syncedRecords: number;
    skippedRecords: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let syncedRecords = 0;
    let skippedRecords = 0;

    try {
      // Get user's Google integration
      const integration = await this.getUserIntegration(userId, 'google');
      if (!integration) {
        return {
          syncedRecords: 0,
          skippedRecords: 0,
          errors: ['No Google integration found for user'],
        };
      }

      const credentials = integration.getCredentials();

      // Google Cloud Billing API implementation
      if (!credentials.serviceAccountKey || !credentials.projectId) {
        return {
          syncedRecords: 0,
          skippedRecords: 0,
          errors: ['Google Cloud service account key and project ID required'],
        };
      }

      try {
        const billingData = await this.fetchGoogleBillingData(
          credentials.serviceAccountKey,
          credentials.projectId,
          startDate,
          endDate,
        );

        for (const billingItem of billingData) {
          try {
            // Convert Google Cloud billing to internal usage format
            const usageData = {
              userId,
              projectId,
              service: 'google_cloud',
              model: billingItem.service || 'unknown',
              cost: parseFloat(billingItem.cost) || 0,
              metadata: {
                googleBillingAccountId: billingItem.billing_account_id,
                googleProjectId: billingItem.project_id,
                googleService: billingItem.service,
                googleSku: billingItem.sku,
                googleRegion: billingItem.region,
                currency: billingItem.currency || 'USD',
                usageAmount: billingItem.usage_amount,
                usageUnit: billingItem.usage_unit,
              },
              createdAt: new Date(
                billingItem.usage_start_time || billingItem.timestamp,
              ),
            };

            await this.usageModel.create(usageData);
            syncedRecords++;
          } catch (error) {
            this.logger.warn('Failed to sync Google billing item', {
              error,
              billingItem,
            });
            errors.push(
              `Failed to sync billing item: ${billingItem.sku || 'unknown'}`,
            );
            skippedRecords++;
          }
        }
      } catch (apiError) {
        errors.push(
          `Google Cloud Billing API error: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
        );
      }
    } catch (error) {
      errors.push(
        `Google sync error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { syncedRecords, skippedRecords, errors };
  }

  private async fetchGoogleBillingData(
    serviceAccountKey: any,
    projectId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any[]> {
    // Google Cloud Billing API implementation using googleapis
    try {
      // Check if googleapis package is available
      const { google } = require('googleapis');

      const auth = new google.auth.GoogleAuth({
        credentials: serviceAccountKey,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });

      const billing = google.cloudbilling('v1');
      const authClient = await auth.getClient();

      // Get billing accounts first
      const billingAccounts = await billing.billingAccounts.list({
        auth: authClient,
      });

      if (
        !billingAccounts.data.accounts ||
        billingAccounts.data.accounts.length === 0
      ) {
        throw new Error('No billing accounts found');
      }

      // Cloud Billing API v1 does not provide usage/cost data. Cost data requires
      // BigQuery billing export: https://cloud.google.com/billing/docs/how-to/export-data-bigquery
      this.logger.debug(
        'GCP billing accounts listed; cost sync requires BigQuery export',
        { accountCount: billingAccounts.data.accounts?.length ?? 0 },
      );
      return [];
    } catch (error) {
      // Fallback or error handling
      if (
        error instanceof Error &&
        error.message.includes('Cannot find module')
      ) {
        throw new Error(
          'Google APIs package not installed. Run: npm install googleapis',
        );
      }
      throw error;
    }
  }

  private async getUserIntegration(userId: string, type: string): Promise<any> {
    try {
      const integrations = await this.integrationService.getUserIntegrations(
        userId,
        {
          status: 'active',
        },
      );

      // Map external service names to integration types
      const typeMapping: Record<string, string[]> = {
        stripe: ['stripe_oauth'],
        aws: ['aws'],
        openai: ['openai'],
        anthropic: ['anthropic'],
        google: ['google_oauth', 'google'],
      };

      const possibleTypes = typeMapping[type] || [type];
      return integrations.find((integration: { type: string }) =>
        possibleTypes.some((t) => integration.type.includes(t)),
      );
    } catch (error) {
      this.logger.error('Failed to get user integration', {
        userId,
        type,
        error,
      });
      return null;
    }
  }

  private isValidObjectId(id: string): boolean {
    return /^[0-9a-fA-F]{24}$/.test(id);
  }

  private async getUserById(userId: string): Promise<{
    _id: string;
    name: string;
    email: string;
    avatar?: string;
  } | null> {
    try {
      const user = await this.userModel
        .findById(userId)
        .select('_id name email avatar')
        .lean();

      if (!user) {
        return null;
      }

      return {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      };
    } catch (error) {
      this.logger.error(`Failed to get user by ID ${userId}`, { error });
      return null;
    }
  }

  private async generateCostInsights(
    currentCost: number,
    previousCost: number,
    topModels: any[],
    teamUsage: any[],
    budgetUsedPercent: number,
    budget: number,
  ): Promise<
    Array<{
      type: 'warning' | 'info' | 'success' | 'error';
      message: string;
      priority: 'low' | 'medium' | 'high';
      data?: any;
    }>
  > {
    const insights: Array<{
      type: 'warning' | 'info' | 'success' | 'error';
      message: string;
      priority: 'low' | 'medium' | 'high';
      data?: any;
    }> = [];

    // Budget alerts
    if (budget > 0) {
      if (budgetUsedPercent > 90) {
        insights.push({
          type: 'warning',
          message: `Budget usage is at ${budgetUsedPercent.toFixed(1)}% - consider cost optimization`,
          priority: 'high',
        });
      } else if (budgetUsedPercent > 75) {
        insights.push({
          type: 'info',
          message: `Budget usage is at ${budgetUsedPercent.toFixed(1)}%`,
          priority: 'medium',
        });
      }
    }

    // Cost change insights
    const costChangePercent =
      previousCost > 0
        ? ((currentCost - previousCost) / previousCost) * 100
        : 0;
    if (Math.abs(costChangePercent) > 20) {
      const direction = costChangePercent > 0 ? 'increased' : 'decreased';
      const insightType: 'warning' | 'success' =
        costChangePercent > 0 ? 'warning' : 'success';
      const priority: 'high' | 'medium' =
        costChangePercent > 50 ? 'high' : 'medium';
      insights.push({
        type: insightType,
        message: `Costs ${direction} by ${Math.abs(costChangePercent).toFixed(1)}% compared to previous period`,
        priority,
      });
    }

    // Model concentration insights
    if (topModels.length > 0 && topModels[0].percentage > 70) {
      insights.push({
        type: 'info',
        message: `${topModels[0].model} accounts for ${topModels[0].percentage.toFixed(1)}% of costs - consider diversifying models`,
        priority: 'medium',
      });
    }

    // Team insights
    if (teamUsage.length > 3) {
      const topUser = teamUsage[0];
      if (topUser.percentage > 50) {
        insights.push({
          type: 'info',
          message: `${topUser.userName || 'One user'} accounts for ${topUser.percentage.toFixed(1)}% of team costs`,
          priority: 'low',
        });
      }
    }

    // Cost efficiency insights
    if (currentCost > 10 && currentCost / (topModels.length || 1) > 5) {
      insights.push({
        type: 'info',
        message: 'Consider using fewer, more cost-effective models',
        priority: 'low',
      });
    }

    return insights;
  }

  /**
   * Create usage record from request context
   */
  async createUsage(
    usageData: {
      userId: string;
      projectId?: string;
      service: string;
      model: string;
      prompt?: string;
      completion?: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cost: number;
      responseTime: number;
      metadata?: Record<string, any>;
      tags?: string[];
    },
    requestContext?: {
      ipAddress?: string;
      userAgent?: string;
      requestId?: string;
    },
  ): Promise<UsageDocument> {
    const usage = new this.usageModel({
      ...usageData,
      responseTime: usageData.responseTime,
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
      requestId: requestContext?.requestId || crypto.randomUUID(),
      createdAt: new Date(),
    });

    const savedUsage = await usage.save();

    // Trigger real-time updates
    const userId =
      savedUsage.userId instanceof Types.ObjectId
        ? savedUsage.userId.toString()
        : String(
            savedUsage.userId ?? (savedUsage as { user?: string }).user ?? '',
          );
    await this.realtimeUpdateService.emitUsageUpdate(userId, savedUsage);

    // Check for anomalies
    try {
      const anomalies = await this.detectAnomalies(
        usageData.userId,
        usageData.projectId,
      );
      if (anomalies.anomalies.length > 0) {
        this.logger.warn('Anomalies detected in usage', {
          userId: usageData.userId,
          anomalyCount: anomalies.anomalies.length,
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for anomalies', { error });
    }

    return savedUsage;
  }

  // Private helper methods

  private getDateRange(period: 'daily' | 'weekly' | 'monthly') {
    const now = new Date();
    const start = new Date(now);

    switch (period) {
      case 'daily':
        start.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        const dayOfWeek = start.getDay();
        start.setDate(start.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
    }

    return { start, end: now };
  }

  private calculateUsageSummary(matchQuery: any) {
    return this.usageModel
      .aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            avgCost: { $avg: '$cost' },
            avgTokens: { $avg: '$totalTokens' },
          },
        },
      ])
      .then(
        (results) =>
          results[0] || {
            totalCost: 0,
            totalTokens: 0,
            avgCost: 0,
            avgTokens: 0,
          },
      );
  }

  private groupCosts(items: any[], key: string): Record<string, number> {
    return items.reduce((acc: Record<string, number>, item) => {
      const groupKey = item[key] || 'unknown';
      acc[groupKey] = (acc[groupKey] || 0) + item.cost;
      return acc;
    }, {});
  }

  private getUsageOverTime(matchQuery: any, period: string) {
    const dateFormat = period === 'daily' ? '%Y-%m-%d' : '%Y-%m-%d';

    return this.usageModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            $dateToString: { format: dateFormat, date: '$createdAt' },
          },
          cost: { $sum: '$cost' },
          tokens: { $sum: '$totalTokens' },
          requests: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          date: '$_id',
          cost: 1,
          tokens: 1,
          requests: 1,
          _id: 0,
        },
      },
    ]);
  }

  private extractMetadataProperties(
    obj: any,
    prefix: string,
    propertyMap: Map<string, Set<string>>,
  ): void {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string' && value.length > 0 && value.length < 100) {
        if (!propertyMap.has(fullKey)) {
          propertyMap.set(fullKey, new Set());
        }
        propertyMap.get(fullKey)!.add(value);
      } else if (typeof value === 'object' && value !== null) {
        this.extractMetadataProperties(value, fullKey, propertyMap);
      }
    }
  }
}
