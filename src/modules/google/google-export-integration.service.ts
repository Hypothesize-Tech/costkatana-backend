import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { GoogleConnection } from '../../schemas/integration/google-connection.schema';
import { GoogleExportAudit } from '../../schemas/integration/google-export-audit.schema';
import { Usage } from '../../schemas/core/usage.schema';
import { GoogleService } from './google.service';
import type { GoogleConnectionWithTokens } from './utils/google-connection-tokens';

export interface ExportCostDataOptions {
  userId: string;
  connectionId: string;
  startDate?: Date;
  endDate?: Date;
  projectId?: string;
  groupBy?: 'date' | 'service' | 'model' | 'project';
  template?:
    | 'MONTHLY_SPEND_BY_MODEL'
    | 'TEAM_BUDGET_VS_ACTUAL'
    | 'PROJECT_COST_UTILIZATION';
  redactionOptions?: {
    maskEmails?: boolean;
    removePrompts?: boolean;
    aggregateByTeam?: boolean;
  };
}

export interface CostReportOptions {
  userId: string;
  connectionId: string;
  startDate?: Date;
  endDate?: Date;
  projectId?: string;
  includeTopModels?: boolean;
  includeAnomalies?: boolean;
  includeRecommendations?: boolean;
}

const TEMPLATES = {
  MONTHLY_SPEND_BY_MODEL: 'Monthly AI Spend by Model',
  TEAM_BUDGET_VS_ACTUAL: 'Per-Team Budget vs Actual',
  PROJECT_COST_UTILIZATION: 'Per-Project Cost & Utilization',
  COST_REVIEW_REPORT: 'Cost Review Report',
};

@Injectable()
export class GoogleExportIntegrationService {
  private readonly logger = new Logger(GoogleExportIntegrationService.name);

  constructor(
    private readonly googleService: GoogleService,
    @InjectModel(GoogleConnection.name)
    private readonly googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(GoogleExportAudit.name)
    private readonly googleExportAuditModel: Model<GoogleExportAudit>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
  ) {}

  async exportCostDataToSheets(
    connection: GoogleConnectionWithTokens,
    options: ExportCostDataOptions,
  ): Promise<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    audit: GoogleExportAudit;
  }> {
    const match: Record<string, unknown> = {
      userId: new Types.ObjectId(options.userId),
    };
    if (options.startDate || options.endDate) {
      (match as any).createdAt = {};
      if (options.startDate) (match as any).createdAt.$gte = options.startDate;
      if (options.endDate) (match as any).createdAt.$lte = options.endDate;
    }
    if (options.projectId) {
      (match as any).projectId = new Types.ObjectId(options.projectId);
    }

    const usageData = await this.usageModel
      .find(match)
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean()
      .exec();

    let processedData = usageData.map((r: any) => ({ ...r }));
    if (options.redactionOptions?.maskEmails) {
      processedData = processedData.map((record: any) => ({
        ...record,
        userEmail: record.userEmail ? '***@***.***' : undefined,
      }));
    }
    if (options.redactionOptions?.removePrompts) {
      processedData = processedData.map((record: any) => ({
        ...record,
        prompt: '[REDACTED]',
        response: '[REDACTED]',
      }));
    }

    let templateTitle = TEMPLATES.MONTHLY_SPEND_BY_MODEL;
    if (options.template) templateTitle = TEMPLATES[options.template];
    else if (options.groupBy === 'project' && options.projectId)
      templateTitle = TEMPLATES.PROJECT_COST_UTILIZATION;
    else if (options.groupBy === 'service')
      templateTitle = TEMPLATES.TEAM_BUDGET_VS_ACTUAL;

    let headers: string[];
    let rows: string[][];

    if (options.groupBy === 'model') {
      const modelData = await this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$model',
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            requests: { $sum: 1 },
            avgCost: { $avg: '$cost' },
          },
        },
        { $sort: { totalCost: -1 } },
      ]);
      headers = [
        'Model',
        'Total Cost (USD)',
        'Total Tokens',
        'Requests',
        'Avg Cost per Request',
      ];
      rows = [
        headers,
        ...modelData.map((item: any) => [
          item._id ?? 'Unknown',
          item.totalCost.toFixed(2),
          String(item.totalTokens ?? 0),
          String(item.requests ?? 0),
          (item.avgCost ?? 0).toFixed(4),
        ]),
      ];
    } else {
      headers = [
        'Date',
        'Service',
        'Model',
        'Total Tokens',
        'Cost (USD)',
        'Status',
      ];
      rows = [
        headers,
        ...processedData.map((record: any) => [
          record.createdAt ? new Date(record.createdAt).toISOString() : '',
          record.service ?? '',
          record.model ?? '',
          String(record.totalTokens ?? 0),
          String(record.cost ?? 0),
          'completed',
        ]),
      ];
    }

    const title = `${templateTitle} - ${new Date().toISOString().split('T')[0]}`;
    const { spreadsheetId, spreadsheetUrl } =
      await this.googleService.createSpreadsheet(connection, title, rows);

    const auditDoc = await this.googleExportAuditModel.create({
      userId: new Types.ObjectId(options.userId),
      connectionId: new Types.ObjectId(options.connectionId),
      googleConnectionId: new Types.ObjectId(options.connectionId),
      requestorId: options.userId,
      exportId: spreadsheetId,
      exportType: 'sheets',
      datasetType: 'cost_data',
      fileId: spreadsheetId,
      fileName: title,
      fileLink: spreadsheetUrl,
      googleDriveFileId: spreadsheetId,
      downloadUrl: spreadsheetUrl,
      scope: this.buildScopeString(options),
      recordCount: processedData.length,
      status: 'completed',
      exportedAt: new Date(),
      completedAt: new Date(),
      metadata: {
        recordCount: processedData.length,
        format: 'xlsx',
        startDate: options.startDate,
        endDate: options.endDate,
        projectId: options.projectId,
        redactionApplied: !!(
          options.redactionOptions?.maskEmails ||
          options.redactionOptions?.removePrompts
        ),
        maskingOptions: options.redactionOptions
          ? Object.keys(options.redactionOptions).filter(
              (k) => (options.redactionOptions as any)[k],
            )
          : [],
      },
    });

    return { spreadsheetId, spreadsheetUrl, audit: auditDoc };
  }

  async createCostReportInDocs(
    connection: GoogleConnectionWithTokens,
    options: CostReportOptions,
  ): Promise<{
    documentId: string;
    documentUrl: string;
    audit: GoogleExportAudit;
  }> {
    const match: Record<string, unknown> = {
      userId: new Types.ObjectId(options.userId),
    };
    if (options.startDate || options.endDate) {
      (match as any).createdAt = {};
      if (options.startDate) (match as any).createdAt.$gte = options.startDate;
      if (options.endDate) (match as any).createdAt.$lte = options.endDate;
    }
    if (options.projectId) {
      (match as any).projectId = new Types.ObjectId(options.projectId);
    }

    const costSummary = await this.usageModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalCost: { $sum: '$cost' },
          totalTokens: { $sum: '$totalTokens' },
          totalRequests: { $sum: 1 },
          averageCost: { $avg: '$cost' },
        },
      },
    ]);

    const summary = costSummary[0] ?? {
      totalCost: 0,
      totalTokens: 0,
      totalRequests: 0,
      averageCost: 0,
    };

    const topModels = options.includeTopModels
      ? await this.usageModel.aggregate([
          { $match: match },
          {
            $group: {
              _id: '$model',
              totalCost: { $sum: '$cost' },
              totalTokens: { $sum: '$totalTokens' },
              requests: { $sum: 1 },
              avgCost: { $avg: '$cost' },
            },
          },
          { $sort: { totalCost: -1 } },
          { $limit: 10 },
        ])
      : [];

    const costByDate = await this.usageModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          dailyCost: { $sum: '$cost' },
          dailyRequests: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 30 },
    ]);

    const title = `${TEMPLATES.COST_REVIEW_REPORT} - ${new Date().toISOString().split('T')[0]}`;
    const { documentId, documentUrl } = await this.googleService.createDocument(
      connection,
      title,
    );

    await this.googleService.formatCostReportDocument(connection, documentId, {
      title,
      generatedDate: new Date(),
      startDate: options.startDate,
      endDate: options.endDate,
      summary: {
        totalCost: summary.totalCost,
        totalTokens: summary.totalTokens,
        totalRequests: summary.totalRequests,
        averageCost: summary.averageCost,
      },
      topModels,
      costByDate: costByDate.map((d: any) => ({
        _id: d._id,
        dailyCost: d.dailyCost,
        dailyRequests: d.dailyRequests,
      })),
      includeRecommendations: options.includeRecommendations ?? false,
    });

    const auditDoc = await this.googleExportAuditModel.create({
      userId: new Types.ObjectId(options.userId),
      connectionId: new Types.ObjectId(options.connectionId),
      googleConnectionId: new Types.ObjectId(options.connectionId),
      requestorId: options.userId,
      exportId: documentId,
      exportType: 'docs',
      datasetType: 'report',
      fileId: documentId,
      fileName: title,
      fileLink: documentUrl,
      googleDriveFileId: documentId,
      downloadUrl: documentUrl,
      scope: this.buildScopeString(options),
      status: 'completed',
      exportedAt: new Date(),
      completedAt: new Date(),
      metadata: {
        recordCount: 0,
        format: 'pdf',
        startDate: options.startDate,
        endDate: options.endDate,
        projectId: options.projectId,
      },
    });

    return { documentId, documentUrl, audit: auditDoc };
  }

  async analyzeCostTrendsWithGemini(
    userId: string,
    timeRange: { startDate?: Date; endDate?: Date },
  ): Promise<{
    analysis: string;
    insights: string[];
    recommendations: string[];
  }> {
    const match: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (timeRange.startDate || timeRange.endDate) {
      (match as any).createdAt = {};
      if (timeRange.startDate)
        (match as any).createdAt.$gte = timeRange.startDate;
      if (timeRange.endDate) (match as any).createdAt.$lte = timeRange.endDate;
    }

    const usageData = await this.usageModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            model: '$model',
          },
          totalCost: { $sum: '$cost' },
          requests: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1 } },
      { $limit: 100 },
    ]);

    const totalCost = usageData.reduce(
      (sum: number, item: any) => sum + item.totalCost,
      0,
    );
    const avgDailyCost = totalCost / Math.max(usageData.length, 1);

    const analysis = `Cost trend analysis shows total spend of $${totalCost.toFixed(2)} over ${usageData.length} data points, with an average daily cost of $${avgDailyCost.toFixed(2)}.`;
    const insights = [
      `Total AI spending: $${totalCost.toFixed(2)}`,
      `Average daily cost: $${avgDailyCost.toFixed(2)}`,
      `Number of models used: ${new Set(usageData.map((d: any) => d._id.model)).size}`,
      `Total requests: ${usageData.reduce((sum: number, item: any) => sum + item.requests, 0).toLocaleString()}`,
    ];
    const recommendations = [
      'Consider using semantic caching to reduce repeated requests',
      'Enable Cortex optimization for 40-75% cost savings',
      'Review high-cost models for potential alternatives',
      'Set up budget alerts to monitor spending thresholds',
    ];

    return { analysis, insights, recommendations };
  }

  async explainCostAnomalyWithGemini(
    userId: string,
    anomalyData: { increasePercent?: number; [key: string]: unknown },
  ): Promise<{
    explanation: string;
    likelyReasons: string[];
    suggestedActions: string[];
  }> {
    const explanation = `Detected a cost anomaly with ${anomalyData.increasePercent ?? 0}% increase from baseline. This represents an unusual spending pattern that requires attention.`;
    const likelyReasons = [
      'Increased usage volume of high-cost models',
      'Changes in prompt complexity or length',
      'New features or services utilizing AI',
      'Lack of caching for repeated requests',
    ];
    const suggestedActions = [
      'Review recent changes in AI usage patterns',
      'Enable semantic caching to reduce costs',
      'Consider switching to more cost-effective models',
      'Set up stricter rate limiting and budgets',
    ];
    return { explanation, likelyReasons, suggestedActions };
  }

  async generateOptimizationStrategy(
    userId: string,
    constraints?: { maxBudget?: number; preferredProviders?: string[] },
  ): Promise<{
    strategy: string;
    estimatedSavings: number;
    actionItems: Array<{ action: string; impact: string; effort: string }>;
  }> {
    const match: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (
      constraints?.preferredProviders &&
      constraints.preferredProviders.length > 0
    ) {
      const providerServiceMap: Record<string, string[]> = {
        openai: ['openai'],
        anthropic: ['anthropic'],
        google: ['google-ai'],
        aws: ['aws-bedrock'],
        huggingface: ['huggingface'],
        cohere: ['cohere'],
      };
      const allowedServices: string[] = [];
      constraints.preferredProviders.forEach((provider) => {
        const services = providerServiceMap[provider.toLowerCase()] ?? [];
        allowedServices.push(...services);
      });
      if (allowedServices.length > 0)
        (match as any).service = { $in: allowedServices };
    }

    const recentUsage = await this.usageModel.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $limit: 1000 },
      {
        $group: {
          _id: '$model',
          totalCost: { $sum: '$cost' },
          requests: { $sum: 1 },
          avgCost: { $avg: '$cost' },
          service: { $first: '$service' },
        },
      },
      { $sort: { totalCost: -1 } },
    ]);

    const totalCost = recentUsage.reduce(
      (sum: number, item: any) => sum + item.totalCost,
      0,
    );
    let savingsPercentage = 0.45;
    let estimatedSavings = totalCost * savingsPercentage;

    if (constraints?.maxBudget) {
      const budgetGap = totalCost - constraints.maxBudget;
      if (budgetGap > 0) {
        const minSavingsPct = Math.min((budgetGap / totalCost) * 100, 70) / 100;
        savingsPercentage = Math.max(savingsPercentage, minSavingsPct);
        estimatedSavings = totalCost * savingsPercentage;
      } else {
        savingsPercentage = 0.3;
        estimatedSavings = totalCost * savingsPercentage;
      }
    }

    let strategy = `Based on analysis of ${recentUsage.length} model usage patterns with total spend of $${totalCost.toFixed(2)}`;
    if (constraints?.preferredProviders?.length) {
      strategy += ` (filtered to ${constraints.preferredProviders.join(', ')} providers)`;
    }
    if (constraints?.maxBudget) {
      const status =
        totalCost > constraints.maxBudget
          ? `exceeds budget by $${(totalCost - constraints.maxBudget).toFixed(2)}`
          : `within budget (${((totalCost / constraints.maxBudget) * 100).toFixed(1)}% utilized)`;
      strategy += `, current spend ${status}`;
    }
    strategy += `, implementing Cortex optimization and semantic caching can reduce costs by approximately $${estimatedSavings.toFixed(2)} (${(savingsPercentage * 100).toFixed(0)}%).`;

    const actionItems: Array<{
      action: string;
      impact: string;
      effort: string;
    }> = [
      {
        action: 'Enable Cortex meta-language optimization',
        impact: '40-75% cost reduction',
        effort: 'Low - API integration',
      },
      {
        action: 'Implement semantic caching',
        impact: '70-80% reduction on repeated queries',
        effort: 'Low - Configuration change',
      },
    ];

    if (constraints?.preferredProviders?.length) {
      actionItems.push({
        action: `Optimize model selection within ${constraints.preferredProviders.join(', ')} providers`,
        impact: '15-25% cost reduction',
        effort: 'Medium - Requires provider analysis',
      });
    }
    if (constraints?.maxBudget) {
      if (totalCost > constraints.maxBudget) {
        actionItems.push({
          action: `Reduce spending by $${(totalCost - constraints.maxBudget).toFixed(2)} to meet budget`,
          impact: `${(((totalCost - constraints.maxBudget) / totalCost) * 100).toFixed(0)}% cost reduction required`,
          effort: 'High - Requires immediate action',
        });
      } else {
        actionItems.push({
          action: 'Maintain current spending patterns within budget',
          impact: 'Budget compliance maintained',
          effort: 'Low - Monitoring required',
        });
      }
    } else {
      actionItems.push({
        action: 'Optimize model routing based on task complexity',
        impact: '20-30% cost reduction',
        effort: 'Medium - Requires analysis',
      });
      actionItems.push({
        action: 'Set up request deduplication',
        impact: '10-15% cost reduction',
        effort: 'Low - Feature flag',
      });
    }

    return { strategy, estimatedSavings, actionItems };
  }

  private buildScopeString(
    options: ExportCostDataOptions | CostReportOptions,
  ): string {
    const parts: string[] = [];
    if (options.startDate && options.endDate) {
      parts.push(
        `${options.startDate.toISOString().split('T')[0]} to ${options.endDate.toISOString().split('T')[0]}`,
      );
    } else if (options.startDate) {
      parts.push(`from ${options.startDate.toISOString().split('T')[0]}`);
    } else if (options.endDate) {
      parts.push(`until ${options.endDate.toISOString().split('T')[0]}`);
    } else {
      parts.push('all time');
    }
    if (options.projectId) parts.push(`project: ${options.projectId}`);
    return parts.join(', ');
  }
}
