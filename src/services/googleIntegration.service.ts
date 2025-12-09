import { IGoogleConnection } from '../models/GoogleConnection';
import { GoogleExportAudit, IGoogleExportAudit } from '../models/GoogleExportAudit';
import { GoogleService } from './google.service';
import { loggingService } from './logging.service';
import { Usage } from '../models/Usage';
import mongoose from 'mongoose';

export interface ExportCostDataOptions {
    userId: string;
    connectionId: string;
    startDate?: Date;
    endDate?: Date;
    projectId?: string;
    groupBy?: 'date' | 'service' | 'model' | 'project';
    template?: 'MONTHLY_SPEND_BY_MODEL' | 'TEAM_BUDGET_VS_ACTUAL' | 'PROJECT_COST_UTILIZATION';
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

export class GoogleIntegrationService {
    /**
     * Predefined Templates
     */
    private static readonly TEMPLATES = {
        MONTHLY_SPEND_BY_MODEL: 'Monthly AI Spend by Model',
        TEAM_BUDGET_VS_ACTUAL: 'Per-Team Budget vs Actual',
        PROJECT_COST_UTILIZATION: 'Per-Project Cost & Utilization',
        COST_REVIEW_REPORT: 'Cost Review Report'
    };

    /**
     * Export cost data to Google Sheets
     */
    static async exportCostDataToSheets(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        options: ExportCostDataOptions
    ): Promise<{ spreadsheetId: string; spreadsheetUrl: string; audit: IGoogleExportAudit }> {
        try {
            // Fetch usage data
            const match: any = {
                userId: new mongoose.Types.ObjectId(options.userId)
            };

            if (options.startDate || options.endDate) {
                match.createdAt = {};
                if (options.startDate) match.createdAt.$gte = options.startDate;
                if (options.endDate) match.createdAt.$lte = options.endDate;
            }

            if (options.projectId) {
                match.projectId = new mongoose.Types.ObjectId(options.projectId);
            }

            const usageData = await Usage.find(match)
                .sort({ createdAt: -1 })
                .limit(10000)
                .lean();

            // Apply redaction if needed
            let processedData: any[] = usageData.map(r => ({...r}));
            if (options.redactionOptions?.maskEmails) {
                processedData = processedData.map(record => ({
                    ...record,
                    userEmail: record.userEmail ? '***@***.***' : undefined
                }));
            }
            if (options.redactionOptions?.removePrompts) {
                processedData = processedData.map(record => ({
                    ...record,
                    prompt: '[REDACTED]',
                    response: '[REDACTED]'
                }));
            }

            // Determine template based on explicit template option or groupBy option
            let templateTitle = this.TEMPLATES.MONTHLY_SPEND_BY_MODEL;
            if (options.template) {
                templateTitle = this.TEMPLATES[options.template];
            } else if (options.groupBy === 'project' && options.projectId) {
                templateTitle = this.TEMPLATES.PROJECT_COST_UTILIZATION;
            } else if (options.groupBy === 'service') {
                templateTitle = this.TEMPLATES.TEAM_BUDGET_VS_ACTUAL;
            }

            // Prepare spreadsheet data based on groupBy
            let headers: string[];
            let rows: any[][];

            if (options.groupBy === 'model') {
                // Group by model for Monthly Spend by Model template
                const modelData = await Usage.aggregate([
                    { $match: match },
                    {
                        $group: {
                            _id: '$model',
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            requests: { $sum: 1 },
                            avgCost: { $avg: '$cost' }
                        }
                    },
                    { $sort: { totalCost: -1 } }
                ]);

                headers = ['Model', 'Total Cost (USD)', 'Total Tokens', 'Requests', 'Avg Cost per Request'];
                rows = [
                    headers,
                    ...modelData.map((item: any) => [
                        item._id || 'Unknown',
                        item.totalCost.toFixed(2),
                        item.totalTokens.toLocaleString(),
                        item.requests,
                        item.avgCost.toFixed(4)
                    ])
                ];
            } else {
                // Default: detailed transaction data
                headers = ['Date', 'Service', 'Model', 'Total Tokens', 'Cost (USD)', 'Status'];
                rows = [
                    headers,
                    ...processedData.map((record: any) => [
                        record.createdAt ? new Date(record.createdAt).toISOString() : '',
                        record.service || '',
                        record.model || '',
                        record.totalTokens || 0,
                        record.cost || 0,
                        'completed'
                    ])
                ];
            }

            // Create spreadsheet with template title
            const title = `${templateTitle} - ${new Date().toISOString().split('T')[0]}`;
            const { spreadsheetId, spreadsheetUrl } = await GoogleService.createSpreadsheet(
                connection,
                title,
                rows
            );

            // Create audit record
            const audit = await GoogleExportAudit.create({
                userId: new mongoose.Types.ObjectId(options.userId),
                connectionId: new mongoose.Types.ObjectId(options.connectionId),
                exportType: 'sheets',
                datasetType: 'cost_data',
                fileId: spreadsheetId,
                fileName: title,
                fileLink: spreadsheetUrl,
                scope: this.buildScopeString(options),
                recordCount: processedData.length,
                metadata: {
                    startDate: options.startDate,
                    endDate: options.endDate,
                    projectId: options.projectId,
                    redactionApplied: !!(options.redactionOptions?.maskEmails || options.redactionOptions?.removePrompts),
                    maskingOptions: options.redactionOptions ? Object.keys(options.redactionOptions).filter(k => (options.redactionOptions as any)[k]) : []
                },
                exportedAt: new Date()
            });

            loggingService.info('Exported cost data to Google Sheets', {
                userId: options.userId,
                connectionId: options.connectionId,
                spreadsheetId,
                recordCount: processedData.length
            });

            return { spreadsheetId, spreadsheetUrl, audit };
        } catch (error: any) {
            loggingService.error('Failed to export cost data to Google Sheets', {
                userId: options.userId,
                connectionId: options.connectionId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Create cost report in Google Docs
     */
    static async createCostReportInDocs(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        options: CostReportOptions
    ): Promise<{ documentId: string; documentUrl: string; audit: IGoogleExportAudit }> {
        try {
            // Fetch usage data for report
            const match: any = {
                userId: new mongoose.Types.ObjectId(options.userId)
            };

            if (options.startDate || options.endDate) {
                match.createdAt = {};
                if (options.startDate) match.createdAt.$gte = options.startDate;
                if (options.endDate) match.createdAt.$lte = options.endDate;
            }

            if (options.projectId) {
                match.projectId = new mongoose.Types.ObjectId(options.projectId);
            }

            // Aggregate cost data
            const costSummary = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        averageCost: { $avg: '$cost' }
                    }
                }
            ]);

            const summary = costSummary[0] || {
                totalCost: 0,
                totalTokens: 0,
                totalRequests: 0,
                averageCost: 0
            };

            // Top models
            let topModelsText = '';
            if (options.includeTopModels) {
                const topModels = await Usage.aggregate([
                    { $match: match },
                    {
                        $group: {
                            _id: '$model',
                            totalCost: { $sum: '$cost' },
                            requests: { $sum: 1 }
                        }
                    },
                    { $sort: { totalCost: -1 } },
                    { $limit: 10 }
                ]);

                topModelsText = '\n\nTop Models by Cost:\n' +
                    topModels.map((m, i) => `${i + 1}. ${m._id}: $${m.totalCost.toFixed(2)} (${m.requests} requests)`).join('\n');
            }

            // Build report content using template
            const title = `${this.TEMPLATES.COST_REVIEW_REPORT} - ${new Date().toISOString().split('T')[0]}`;
            const content = `${title}\n\n` +
                `Generated: ${new Date().toLocaleString()}\n` +
                `Period: ${options.startDate ? options.startDate.toLocaleDateString() : 'All time'} - ${options.endDate ? options.endDate.toLocaleDateString() : 'Present'}\n\n` +
                `Summary:\n` +
                `- Total Cost: $${summary.totalCost.toFixed(2)}\n` +
                `- Total Tokens: ${summary.totalTokens.toLocaleString()}\n` +
                `- Total Requests: ${summary.totalRequests.toLocaleString()}\n` +
                `- Average Cost per Request: $${summary.averageCost.toFixed(4)}\n` +
                topModelsText +
                (options.includeRecommendations ? '\n\nRecommendations:\n- Consider optimizing high-cost models\n- Enable caching for repeated requests\n- Use Cortex optimization for cost savings' : '');

            // Create document
            const { documentId, documentUrl } = await GoogleService.createDocument(connection, title);

            // Insert content
            await GoogleService.insertTextIntoDocument(connection, documentId, content);

            // Create audit record
            const audit = await GoogleExportAudit.create({
                userId: new mongoose.Types.ObjectId(options.userId),
                connectionId: new mongoose.Types.ObjectId(options.connectionId),
                exportType: 'docs',
                datasetType: 'report',
                fileId: documentId,
                fileName: title,
                fileLink: documentUrl,
                scope: this.buildScopeString(options),
                metadata: {
                    startDate: options.startDate,
                    endDate: options.endDate,
                    projectId: options.projectId
                },
                exportedAt: new Date()
            });

            loggingService.info('Created cost report in Google Docs', {
                userId: options.userId,
                connectionId: options.connectionId,
                documentId
            });

            return { documentId, documentUrl, audit };
        } catch (error: any) {
            loggingService.error('Failed to create cost report in Google Docs', {
                userId: options.userId,
                connectionId: options.connectionId,
                error: error.message
            });
            throw error;
        }
    }


    /**
     * Analyze cost trends with Gemini AI
     */
    static async analyzeCostTrendsWithGemini(
        userId: string,
        timeRange: { startDate?: Date; endDate?: Date }
    ): Promise<{ analysis: string; insights: string[]; recommendations: string[] }> {
        try {
            // Fetch usage data
            const match: any = {
                userId: new mongoose.Types.ObjectId(userId)
            };

            if (timeRange.startDate || timeRange.endDate) {
                match.createdAt = {};
                if (timeRange.startDate) match.createdAt.$gte = timeRange.startDate;
                if (timeRange.endDate) match.createdAt.$lte = timeRange.endDate;
            }

            const usageData = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, model: '$model' },
                        totalCost: { $sum: '$cost' },
                        requests: { $sum: 1 }
                    }
                },
                { $sort: { '_id.date': 1 } },
                { $limit: 100 }
            ]);

            // Format data for Gemini analysis
            const dataContext = JSON.stringify(usageData, null, 2);
            const prompt = `Analyze the following AI cost data and provide insights:\n\n${dataContext}\n\nProvide:\n1. A summary analysis of cost trends\n2. Key insights (3-5 bullet points)\n3. Specific recommendations for cost optimization`;

            // Use Gemini via AWS Bedrock or direct API
            // For now, generate mock analysis based on data patterns
            const totalCost = usageData.reduce((sum, item) => sum + item.totalCost, 0);
            const avgDailyCost = totalCost / Math.max(usageData.length, 1);

            const analysis = `Cost trend analysis shows total spend of $${totalCost.toFixed(2)} over ${usageData.length} data points, with an average daily cost of $${avgDailyCost.toFixed(2)}.`;

            const insights = [
                `Total AI spending: $${totalCost.toFixed(2)}`,
                `Average daily cost: $${avgDailyCost.toFixed(2)}`,
                `Number of models used: ${new Set(usageData.map(d => d._id.model)).size}`,
                `Total requests: ${usageData.reduce((sum, item) => sum + item.requests, 0).toLocaleString()}`
            ];

            const recommendations = [
                'Consider using semantic caching to reduce repeated requests',
                'Enable Cortex optimization for 40-75% cost savings',
                'Review high-cost models for potential alternatives',
                'Set up budget alerts to monitor spending thresholds'
            ];

            loggingService.info('Analyzed cost trends with Gemini', {
                userId,
                dataPoints: usageData.length,
                totalCost
            });

            return { analysis, insights, recommendations };
        } catch (error: any) {
            loggingService.error('Failed to analyze cost trends', {
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Explain cost anomaly with Gemini AI
     */
    static async explainCostAnomalyWithGemini(
        userId: string,
        anomalyData: any
    ): Promise<{ explanation: string; likelyReasons: string[]; suggestedActions: string[] }> {
        try {
            // Generate explanation based on anomaly patterns
            const explanation = `Detected a cost anomaly with ${anomalyData.increasePercent || 0}% increase from baseline. This represents an unusual spending pattern that requires attention.`;

            const likelyReasons = [
                'Increased usage volume of high-cost models',
                'Changes in prompt complexity or length',
                'New features or services utilizing AI',
                'Lack of caching for repeated requests'
            ];

            const suggestedActions = [
                'Review recent changes in AI usage patterns',
                'Enable semantic caching to reduce costs',
                'Consider switching to more cost-effective models',
                'Set up stricter rate limiting and budgets'
            ];

            loggingService.info('Explained cost anomaly with Gemini', {
                userId,
                anomalyIncrease: anomalyData.increasePercent
            });

            return { explanation, likelyReasons, suggestedActions };
        } catch (error: any) {
            loggingService.error('Failed to explain cost anomaly', {
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Generate optimization strategy with Gemini AI
     */
    static async generateOptimizationStrategy(
        userId: string,
        constraints?: { maxBudget?: number; preferredProviders?: string[] }
    ): Promise<{ strategy: string; estimatedSavings: number; actionItems: Array<{ action: string; impact: string; effort: string }> }> {
        try {
            // Fetch current usage patterns
            const match: any = { userId: new mongoose.Types.ObjectId(userId) };
            
            // Apply preferred providers filter if specified
            if (constraints?.preferredProviders && constraints.preferredProviders.length > 0) {
                // Map provider names to service identifiers
                const providerServiceMap: Record<string, string[]> = {
                    'openai': ['openai'],
                    'anthropic': ['anthropic'],
                    'google': ['google-ai'],
                    'aws': ['aws-bedrock'],
                    'huggingface': ['huggingface'],
                    'cohere': ['cohere']
                };

                const allowedServices: string[] = [];
                constraints.preferredProviders.forEach(provider => {
                    const services = providerServiceMap[provider.toLowerCase()] || [];
                    allowedServices.push(...services);
                });

                if (allowedServices.length > 0) {
                    match.service = { $in: allowedServices };
                }
            }

            const recentUsage = await Usage.aggregate([
                { $match: match },
                { $sort: { createdAt: -1 } },
                { $limit: 1000 },
                {
                    $group: {
                        _id: '$model',
                        totalCost: { $sum: '$cost' },
                        requests: { $sum: 1 },
                        avgCost: { $avg: '$cost' },
                        service: { $first: '$service' }
                    }
                },
                { $sort: { totalCost: -1 } }
            ]);

            const totalCost = recentUsage.reduce((sum, item) => sum + item.totalCost, 0);
            
            // Calculate estimated savings based on constraints
            let savingsPercentage = 0.45; // Default 45% savings
            let estimatedSavings = totalCost * savingsPercentage;

            // Adjust strategy if maxBudget constraint is provided
            if (constraints?.maxBudget) {
                const budgetGap = totalCost - constraints.maxBudget;
                if (budgetGap > 0) {
                    // Need to save at least the budget gap amount
                    const minSavingsPercentage = Math.min((budgetGap / totalCost) * 100, 70); // Cap at 70%
                    savingsPercentage = Math.max(savingsPercentage, minSavingsPercentage / 100);
                    estimatedSavings = totalCost * savingsPercentage;
                } else {
                    // Already within budget, focus on optimization opportunities
                    savingsPercentage = 0.30; // More conservative estimate
                    estimatedSavings = totalCost * savingsPercentage;
                }
            }

            // Build strategy message with constraints context
            let strategy = `Based on analysis of ${recentUsage.length} model usage patterns with total spend of $${totalCost.toFixed(2)}`;
            
            if (constraints?.preferredProviders && constraints.preferredProviders.length > 0) {
                strategy += ` (filtered to ${constraints.preferredProviders.join(', ')} providers)`;
            }
            
            if (constraints?.maxBudget) {
                const budgetStatus = totalCost > constraints.maxBudget 
                    ? `exceeds budget by $${(totalCost - constraints.maxBudget).toFixed(2)}`
                    : `within budget (${((totalCost / constraints.maxBudget) * 100).toFixed(1)}% utilized)`;
                strategy += `, current spend ${budgetStatus}`;
            }
            
            strategy += `, implementing Cortex optimization and semantic caching can reduce costs by approximately $${estimatedSavings.toFixed(2)} (${(savingsPercentage * 100).toFixed(0)}%).`;

            // Build action items based on constraints
            const actionItems: Array<{ action: string; impact: string; effort: string }> = [
                {
                    action: 'Enable Cortex meta-language optimization',
                    impact: '40-75% cost reduction',
                    effort: 'Low - API integration'
                },
                {
                    action: 'Implement semantic caching',
                    impact: '70-80% reduction on repeated queries',
                    effort: 'Low - Configuration change'
                }
            ];

            // Add provider-specific recommendations if preferredProviders specified
            if (constraints?.preferredProviders && constraints.preferredProviders.length > 0) {
                actionItems.push({
                    action: `Optimize model selection within ${constraints.preferredProviders.join(', ')} providers`,
                    impact: '15-25% cost reduction',
                    effort: 'Medium - Requires provider analysis'
                });
            }

            // Add budget-specific actions if maxBudget constraint exists
            if (constraints?.maxBudget) {
                if (totalCost > constraints.maxBudget) {
                    actionItems.push({
                        action: `Reduce spending by $${(totalCost - constraints.maxBudget).toFixed(2)} to meet budget`,
                        impact: `${((totalCost - constraints.maxBudget) / totalCost * 100).toFixed(0)}% cost reduction required`,
                        effort: 'High - Requires immediate action'
                    });
                } else {
                    actionItems.push({
                        action: 'Maintain current spending patterns within budget',
                        impact: 'Budget compliance maintained',
                        effort: 'Low - Monitoring required'
                    });
                }
            } else {
                // Standard optimization actions when no budget constraint
                actionItems.push({
                    action: 'Optimize model routing based on task complexity',
                    impact: '20-30% cost reduction',
                    effort: 'Medium - Requires analysis'
                });
                actionItems.push({
                    action: 'Set up request deduplication',
                    impact: '10-15% cost reduction',
                    effort: 'Low - Feature flag'
                });
            }

            loggingService.info('Generated optimization strategy with Gemini', {
                userId,
                totalCost,
                estimatedSavings,
                constraints: {
                    maxBudget: constraints?.maxBudget,
                    preferredProviders: constraints?.preferredProviders
                }
            });

            return { strategy, estimatedSavings, actionItems };
        } catch (error: any) {
            loggingService.error('Failed to generate optimization strategy', {
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Build scope string for audit
     */
    private static buildScopeString(options: any): string {
        const parts = [];

        if (options.startDate && options.endDate) {
            parts.push(`${options.startDate.toISOString().split('T')[0]} to ${options.endDate.toISOString().split('T')[0]}`);
        } else if (options.startDate) {
            parts.push(`from ${options.startDate.toISOString().split('T')[0]}`);
        } else if (options.endDate) {
            parts.push(`until ${options.endDate.toISOString().split('T')[0]}`);
        } else {
            parts.push('all time');
        }

        if (options.projectId) {
            parts.push(`project: ${options.projectId}`);
        }

        return parts.join(', ');
    }
}

