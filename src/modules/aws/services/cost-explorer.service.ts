import { Injectable } from '@nestjs/common';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
  GetAnomaliesCommand,
  GetDimensionValuesCommand,
  Granularity,
  Metric,
  GroupDefinition,
} from '@aws-sdk/client-cost-explorer';
import { LoggerService } from '../../../common/logger/logger.service';
import { StsCredentialService } from './sts-credential.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '@/schemas/integration/aws-connection.schema';

export interface CostData {
  timePeriod: { start: string; end: string };
  total: number;
  currency: string;
  groups?: Array<{
    keys: string[];
    amount: number;
  }>;
}

export interface CostBreakdown {
  service: string;
  amount: number;
  percentage: number;
  currency: string;
}

export interface CostForecast {
  timePeriod: { start: string; end: string };
  meanValue: number;
  predictionIntervalLowerBound?: number;
  predictionIntervalUpperBound?: number;
  currency: string;
}

export interface CostAnomaly {
  anomalyId: string;
  anomalyStartDate?: string;
  anomalyEndDate?: string;
  dimensionValue?: string;
  rootCauses?: Array<{
    service?: string;
    region?: string;
    linkedAccount?: string;
    usageType?: string;
  }>;
  impact: {
    maxImpact: number;
    totalImpact: number;
  };
  feedback?: string;
}

@Injectable()
export class CostExplorerService {
  constructor(
    private readonly stsCredentialService: StsCredentialService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get cost and usage data
   */
  async getCostAndUsage(
    connection: AWSConnectionDocument,
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY' | 'HOURLY' = 'DAILY',
    groupBy?: Array<{ type: 'DIMENSION' | 'TAG'; key: string }>,
  ): Promise<CostData[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ce', action: 'GetCostAndUsage' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const credentials = await this.stsCredentialService.assumeRole(connection);

    const client = new CostExplorerClient({
      region: 'us-east-1', // Cost Explorer is global
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    const groupDefinitions: GroupDefinition[] =
      groupBy?.map((g) => ({
        Type: g.type,
        Key: g.key,
      })) || [];

    const command = new GetCostAndUsageCommand({
      TimePeriod: {
        Start: startDate,
        End: endDate,
      },
      Granularity: granularity as Granularity,
      Metrics: ['UnblendedCost', 'UsageQuantity'],
      GroupBy: groupDefinitions,
    });

    const response = await client.send(command);

    const costData: CostData[] = [];

    for (const result of response.ResultsByTime || []) {
      const total = parseFloat(result.Total?.UnblendedCost?.Amount || '0');
      const currency = result.Total?.UnblendedCost?.Unit || 'USD';

      const groups = result.Groups?.map((g) => ({
        keys: g.Keys || [],
        amount: parseFloat(g.Metrics?.UnblendedCost?.Amount || '0'),
      }));

      costData.push({
        timePeriod: {
          start: result.TimePeriod?.Start || startDate,
          end: result.TimePeriod?.End || endDate,
        },
        total,
        currency,
        groups,
      });
    }

    this.logger.log('Cost and usage data retrieved', {
      connectionId: connection._id.toString(),
      resultCount: costData.length,
    });

    return costData;
  }

  /**
   * Get cost breakdown by service
   */
  async getCostBreakdownByService(
    connection: AWSConnectionDocument,
    startDate: string,
    endDate: string,
  ): Promise<CostBreakdown[]> {
    const costData = await this.getCostAndUsage(
      connection,
      startDate,
      endDate,
      'MONTHLY',
      [{ type: 'DIMENSION', key: 'SERVICE' }],
    );

    // Aggregate all groups across time periods
    const serviceMap = new Map<string, number>();
    let totalCost = 0;
    let currency = 'USD';

    for (const data of costData) {
      currency = data.currency;
      for (const group of data.groups || []) {
        const service = group.keys[0] || 'Unknown';
        const current = serviceMap.get(service) || 0;
        serviceMap.set(service, current + group.amount);
        totalCost += group.amount;
      }
    }

    // Convert to breakdown array
    const breakdown: CostBreakdown[] = [];
    for (const [service, amount] of serviceMap) {
      breakdown.push({
        service,
        amount,
        percentage: totalCost > 0 ? (amount / totalCost) * 100 : 0,
        currency,
      });
    }

    // Sort by amount descending
    breakdown.sort((a, b) => b.amount - a.amount);

    return breakdown;
  }

  /**
   * Get cost forecast
   */
  async getCostForecast(
    connection: AWSConnectionDocument,
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY' = 'MONTHLY',
  ): Promise<CostForecast[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ce', action: 'GetCostForecast' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const credentials = await this.stsCredentialService.assumeRole(connection);

    const client = new CostExplorerClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    const command = new GetCostForecastCommand({
      TimePeriod: {
        Start: startDate,
        End: endDate,
      },
      Granularity: granularity as Granularity,
      Metric: 'UNBLENDED_COST' as Metric,
    });

    const response = await client.send(command);

    const forecasts: CostForecast[] = [];

    for (const result of response.ForecastResultsByTime || []) {
      forecasts.push({
        timePeriod: {
          start: result.TimePeriod?.Start || startDate,
          end: result.TimePeriod?.End || endDate,
        },
        meanValue: parseFloat(result.MeanValue || '0'),
        predictionIntervalLowerBound: result.PredictionIntervalLowerBound
          ? parseFloat(result.PredictionIntervalLowerBound)
          : undefined,
        predictionIntervalUpperBound: result.PredictionIntervalUpperBound
          ? parseFloat(result.PredictionIntervalUpperBound)
          : undefined,
        currency: 'USD',
      });
    }

    // Add total forecast
    if (response.Total) {
      forecasts.unshift({
        timePeriod: { start: startDate, end: endDate },
        meanValue: parseFloat(response.Total.Amount || '0'),
        currency: response.Total.Unit || 'USD',
      });
    }

    this.logger.log('Cost forecast retrieved', {
      connectionId: connection._id.toString(),
      forecastCount: forecasts.length,
    });

    return forecasts;
  }

  /**
   * Get cost anomalies
   */
  async getAnomalies(
    connection: AWSConnectionDocument,
    startDate?: string,
    endDate?: string,
  ): Promise<CostAnomaly[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ce', action: 'GetAnomalies' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const credentials = await this.stsCredentialService.assumeRole(connection);

    const client = new CostExplorerClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    // Default to last 90 days if no dates provided
    const end = endDate || new Date().toISOString().split('T')[0];
    const start =
      startDate ||
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

    const command = new GetAnomaliesCommand({
      DateInterval: {
        StartDate: start,
        EndDate: end,
      },
      MaxResults: 100,
    });

    const response = await client.send(command);

    const anomalies: CostAnomaly[] = (response.Anomalies || []).map((a) => ({
      anomalyId: a.AnomalyId || '',
      anomalyStartDate: a.AnomalyStartDate,
      anomalyEndDate: a.AnomalyEndDate,
      dimensionValue: a.DimensionValue,
      rootCauses: a.RootCauses?.map((rc) => ({
        service: rc.Service,
        region: rc.Region,
        linkedAccount: rc.LinkedAccount,
        usageType: rc.UsageType,
      })),
      impact: {
        maxImpact: a.Impact?.MaxImpact || 0,
        totalImpact: a.Impact?.TotalImpact || 0,
      },
      feedback: a.Feedback,
    }));

    this.logger.log('Cost anomalies retrieved', {
      connectionId: connection._id.toString(),
      anomalyCount: anomalies.length,
    });

    return anomalies;
  }

  /**
   * Get available dimension values (services, regions, etc.)
   */
  async getDimensionValues(
    connection: AWSConnectionDocument,
    dimension: 'SERVICE' | 'REGION' | 'LINKED_ACCOUNT' | 'USAGE_TYPE',
    startDate: string,
    endDate: string,
  ): Promise<string[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ce', action: 'GetDimensionValues' },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const credentials = await this.stsCredentialService.assumeRole(connection);

    const client = new CostExplorerClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    const command = new GetDimensionValuesCommand({
      TimePeriod: {
        Start: startDate,
        End: endDate,
      },
      Dimension: dimension,
    });

    const response = await client.send(command);

    return (response.DimensionValues || [])
      .map((dv) => dv.Value || '')
      .filter((v) => v.length > 0);
  }

  /**
   * Get current month costs summary
   */
  async getCurrentMonthCosts(connection: AWSConnectionDocument): Promise<{
    total: number;
    currency: string;
    topServices: CostBreakdown[];
    dailyAverage: number;
    projectedMonthEnd: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const today = now.toISOString().split('T')[0];

    // Get cost breakdown by service
    const breakdown = await this.getCostBreakdownByService(
      connection,
      startOfMonth,
      today,
    );

    const total = breakdown.reduce((sum, b) => sum + b.amount, 0);
    const currency = breakdown[0]?.currency || 'USD';

    // Calculate daily average
    const daysElapsed = Math.max(
      1,
      Math.ceil(
        (now.getTime() - new Date(startOfMonth).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );
    const dailyAverage = total / daysElapsed;

    // Project to month end
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const projectedMonthEnd = dailyAverage * daysInMonth;

    return {
      total,
      currency,
      topServices: breakdown.slice(0, 10),
      dailyAverage,
      projectedMonthEnd,
    };
  }

  /**
   * Get cost optimization recommendations based on usage patterns
   */
  async getOptimizationInsights(connection: AWSConnectionDocument): Promise<
    Array<{
      service: string;
      insight: string;
      potentialSavings?: number;
      priority: 'high' | 'medium' | 'low';
    }>
  > {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      .toISOString()
      .split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    const breakdown = await this.getCostBreakdownByService(
      connection,
      startDate,
      endDate,
    );

    const insights: Array<{
      service: string;
      insight: string;
      potentialSavings?: number;
      priority: 'high' | 'medium' | 'low';
    }> = [];

    // Analyze top services for optimization opportunities
    for (const service of breakdown.slice(0, 5)) {
      if (service.service.includes('EC2')) {
        insights.push({
          service: service.service,
          insight:
            'Consider using Reserved Instances or Savings Plans for predictable EC2 workloads',
          potentialSavings: service.amount * 0.3, // Estimate 30% savings
          priority: service.percentage > 20 ? 'high' : 'medium',
        });
      }

      if (service.service.includes('S3')) {
        insights.push({
          service: service.service,
          insight:
            'Enable S3 Intelligent-Tiering for automatic cost optimization',
          potentialSavings: service.amount * 0.2,
          priority: 'medium',
        });
      }

      if (service.service.includes('RDS')) {
        insights.push({
          service: service.service,
          insight:
            'Consider stopping non-production RDS instances during off-hours',
          potentialSavings: service.amount * 0.4,
          priority: service.percentage > 15 ? 'high' : 'medium',
        });
      }

      if (service.service.includes('Lambda')) {
        insights.push({
          service: service.service,
          insight: 'Review Lambda memory allocation and timeout settings',
          potentialSavings: service.amount * 0.15,
          priority: 'low',
        });
      }
    }

    return insights;
  }
}
