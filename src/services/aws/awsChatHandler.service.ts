/**
 * AWS Chat Handler Service
 * 
 * Handles AWS commands from the chat interface, routing them to appropriate
 * AWS service providers and formatting responses for chat display.
 */

import { loggingService } from '../logging.service';
import { AWSConnection, IAWSConnection } from '../../models/AWSConnection';
import { ec2ServiceProvider } from './providers/ec2.service';
import { costExplorerServiceProvider } from './providers/costExplorer.service';
import { s3ServiceProvider } from './providers/s3.service';
import { rdsServiceProvider } from './providers/rds.service';
import { lambdaServiceProvider } from './providers/lambda.service';
import { AWSAction } from '../../schemas/integrationTools.schema';

export interface AWSChatRequest {
  userId: string;
  action: AWSAction;
  params: Record<string, unknown>;
  connectionId?: string;
}

export interface AWSChatResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

class AWSChatHandlerService {
  private static instance: AWSChatHandlerService;

  private constructor() {}

  public static getInstance(): AWSChatHandlerService {
    if (!AWSChatHandlerService.instance) {
      AWSChatHandlerService.instance = new AWSChatHandlerService();
    }
    return AWSChatHandlerService.instance;
  }

  /**
   * Get active AWS connection for user
   */
  private async getConnection(userId: string, connectionId?: string): Promise<IAWSConnection | null> {
    if (connectionId) {
      return AWSConnection.findOne({
        _id: connectionId,
        userId,
        status: 'active',
      });
    }
    
    // Get first active connection
    return AWSConnection.findOne({
      userId,
      status: 'active',
    }).sort({ lastUsedAt: -1 });
  }

  /**
   * Main entry point - process AWS chat command
   */
  public async processCommand(request: AWSChatRequest): Promise<AWSChatResponse> {
    const startTime = Date.now();

    try {
      loggingService.info('Processing AWS chat command', {
        component: 'AWSChatHandler',
        userId: request.userId,
        action: request.action,
        params: request.params,
      });

      // Get AWS connection
      const connection = await this.getConnection(request.userId, request.connectionId);
      
      if (!connection) {
        return {
          success: false,
          message: '❌ No active AWS connection found. Please connect your AWS account first from Settings → Integrations → AWS.',
          error: 'NO_CONNECTION',
        };
      }

      // Route to appropriate handler
      const result = await this.routeCommand(request.action, request.params, connection);

      loggingService.info('AWS chat command completed', {
        component: 'AWSChatHandler',
        action: request.action,
        success: result.success,
        executionTimeMs: Date.now() - startTime,
      });

      return result;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('AWS chat command failed', {
        component: 'AWSChatHandler',
        action: request.action,
        error: errorMessage,
      });

      return {
        success: false,
        message: `❌ AWS operation failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Route command to appropriate handler
   */
  private async routeCommand(
    action: AWSAction,
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    switch (action) {
      // Cost Explorer
      case 'costs':
        return this.handleCosts(params, connection);
      case 'cost_breakdown':
        return this.handleCostBreakdown(params, connection);
      case 'cost_forecast':
        return this.handleCostForecast(params, connection);
      case 'cost_anomalies':
        return this.handleCostAnomalies(params, connection);

      // EC2
      case 'list_ec2':
        return this.handleListEC2(params, connection);
      case 'stop_ec2':
        return this.handleStopEC2(params, connection);
      case 'start_ec2':
        return this.handleStartEC2(params, connection);
      case 'idle_instances':
        return this.handleIdleInstances(params, connection);

      // S3
      case 'list_s3':
        return this.handleListS3(connection);

      // RDS
      case 'list_rds':
        return this.handleListRDS(params, connection);

      // Lambda
      case 'list_lambda':
        return this.handleListLambda(params, connection);

      // General
      case 'optimize':
        return this.handleOptimize(params, connection);
      case 'status':
        return this.handleStatus(connection);

      default:
        return {
          success: false,
          message: `❌ Unknown AWS action: ${action}`,
          error: 'UNKNOWN_ACTION',
        };
    }
  }

  // ============================================================================
  // COST EXPLORER HANDLERS
  // ============================================================================

  private async handleCosts(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const endDate = (params.endDate as string) || new Date().toISOString().split('T')[0];
    const startDate = (params.startDate as string) || this.getDateDaysAgo(30);
    const granularity = (params.granularity as 'DAILY' | 'MONTHLY' | 'HOURLY') || 'DAILY';
    const groupBy = params.groupBy as string | undefined;

    const groupByConfig = groupBy ? [{ type: 'DIMENSION' as const, key: groupBy }] : undefined;

    const costData = await costExplorerServiceProvider.getCostAndUsage(
      connection,
      startDate,
      endDate,
      granularity,
      groupByConfig
    );

    // Calculate totals
    const totalCost = costData.reduce((sum, d) => sum + d.total, 0);
    const currency = costData[0]?.currency || 'USD';

    // Format response
    let message = `💰 **AWS Cost Report**\n\n`;
    message += `📅 Period: ${startDate} to ${endDate}\n`;
    message += `💵 **Total: $${totalCost.toFixed(2)} ${currency}**\n\n`;

    if (groupBy && costData.length > 0 && costData[0].groups) {
      message += `📊 **Breakdown by ${groupBy}:**\n`;
      const aggregatedGroups: Record<string, number> = {};
      
      for (const day of costData) {
        for (const group of day.groups || []) {
          const key = group.keys.join(', ') || 'Other';
          aggregatedGroups[key] = (aggregatedGroups[key] || 0) + group.amount;
        }
      }

      const sortedGroups = Object.entries(aggregatedGroups)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

      for (const [key, amount] of sortedGroups) {
        const percentage = ((amount / totalCost) * 100).toFixed(1);
        message += `  • ${key}: $${amount.toFixed(2)} (${percentage}%)\n`;
      }
    } else {
      message += `📈 **Daily Costs (last 7 days):**\n`;
      for (const day of costData.slice(-7)) {
        message += `  • ${day.timePeriod.start}: $${day.total.toFixed(2)}\n`;
      }
    }

    return {
      success: true,
      message,
      data: { costData, totalCost, currency },
    };
  }

  private async handleCostBreakdown(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const endDate = (params.endDate as string) || new Date().toISOString().split('T')[0];
    const startDate = (params.startDate as string) || this.getDateDaysAgo(30);

    const breakdown = await costExplorerServiceProvider.getCostBreakdownByService(
      connection,
      startDate,
      endDate
    );

    let message = `📊 **AWS Cost Breakdown by Service**\n\n`;
    message += `📅 Period: ${startDate} to ${endDate}\n\n`;

    const totalCost = breakdown.reduce((sum, b) => sum + b.amount, 0);
    message += `💵 **Total: $${totalCost.toFixed(2)}**\n\n`;

    for (const item of breakdown.slice(0, 15)) {
      const bar = this.createProgressBar(item.percentage);
      message += `${bar} **${item.service}**: $${item.amount.toFixed(2)} (${item.percentage.toFixed(1)}%)\n`;
    }

    if (breakdown.length > 15) {
      message += `\n_...and ${breakdown.length - 15} more services_`;
    }

    return {
      success: true,
      message,
      data: { breakdown, totalCost },
    };
  }

  private async handleCostForecast(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const days = (params.days as number) || 30;
    const granularity = (params.granularity as 'DAILY' | 'MONTHLY') || 'MONTHLY';

    const startDate = new Date().toISOString().split('T')[0];
    const endDate = this.getDateDaysFromNow(days);

    const forecast = await costExplorerServiceProvider.getCostForecast(
      connection,
      startDate,
      endDate,
      granularity
    );

    let message = `🔮 **AWS Cost Forecast**\n\n`;
    message += `📅 Forecast Period: ${startDate} to ${endDate}\n\n`;

    const totalForecast = forecast.reduce((sum, f) => sum + f.meanValue, 0);
    message += `💵 **Predicted Total: $${totalForecast.toFixed(2)}**\n\n`;

    if (forecast.length > 0) {
      const first = forecast[0];
      if (first.predictionIntervalLowerBound && first.predictionIntervalUpperBound) {
        message += `📊 **Confidence Range:**\n`;
        message += `  • Low: $${first.predictionIntervalLowerBound.toFixed(2)}\n`;
        message += `  • High: $${first.predictionIntervalUpperBound.toFixed(2)}\n\n`;
      }

      message += `📈 **Forecast Breakdown:**\n`;
      for (const item of forecast.slice(0, 5)) {
        message += `  • ${item.timePeriod.start}: $${item.meanValue.toFixed(2)}\n`;
      }
    }

    return {
      success: true,
      message,
      data: { forecast, totalForecast },
    };
  }

  private async handleCostAnomalies(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const days = (params.days as number) || 30;
    const startDate = this.getDateDaysAgo(days);
    const endDate = new Date().toISOString().split('T')[0];

    const anomalies = await costExplorerServiceProvider.getAnomalies(
      connection,
      startDate,
      endDate
    );

    if (anomalies.length === 0) {
      return {
        success: true,
        message: `✅ **No Cost Anomalies Detected**\n\nNo unusual spending patterns found in the last ${days} days. Your AWS costs appear to be within normal ranges.`,
        data: { anomalies: [] },
      };
    }

    let message = `⚠️ **AWS Cost Anomalies Detected**\n\n`;
    message += `Found **${anomalies.length}** anomalies in the last ${days} days:\n\n`;

    for (const anomaly of anomalies.slice(0, 10)) {
      message += `🔴 **Anomaly ${anomaly.anomalyId.substring(0, 8)}**\n`;
      message += `  • Period: ${anomaly.anomalyStartDate || 'N/A'} - ${anomaly.anomalyEndDate || 'Ongoing'}\n`;
      message += `  • Impact: $${anomaly.impact.totalImpact.toFixed(2)} (Max: $${anomaly.impact.maxImpact.toFixed(2)})\n`;
      
      if (anomaly.rootCauses && anomaly.rootCauses.length > 0) {
        const cause = anomaly.rootCauses[0];
        message += `  • Cause: ${cause.service || 'Unknown'} in ${cause.region || 'Unknown region'}\n`;
      }
      message += '\n';
    }

    return {
      success: true,
      message,
      data: { anomalies },
    };
  }

  // ============================================================================
  // EC2 HANDLERS
  // ============================================================================

  private async handleListEC2(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const region = params.region as string | undefined;
    const state = params.state as string | undefined;

    let filters: Array<{ Name: string; Values: string[] }> | undefined;
    if (state && state !== 'all') {
      filters = [{ Name: 'instance-state-name', Values: [state] }];
    }

    const instances = await ec2ServiceProvider.listInstances(connection, filters, region);
    const message = ec2ServiceProvider.formatInstancesForChat(instances);

    return {
      success: true,
      message,
      data: { instances },
    };
  }

  private async handleStopEC2(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const instanceIds = params.instanceIds as string[];
    const region = params.region as string | undefined;

    if (!instanceIds || instanceIds.length === 0) {
      return {
        success: false,
        message: '❌ Please specify at least one instance ID to stop.',
        error: 'MISSING_INSTANCE_IDS',
      };
    }

    const result = await ec2ServiceProvider.stopInstances(connection, instanceIds, region);

    let message = `🛑 **EC2 Stop Operation**\n\n`;
    
    if (result.stoppedInstances.length > 0) {
      message += `✅ **Successfully stopping:**\n`;
      for (const id of result.stoppedInstances) {
        message += `  • \`${id}\`\n`;
      }
    }

    if (result.errors.length > 0) {
      message += `\n❌ **Failed:**\n`;
      for (const err of result.errors) {
        message += `  • \`${err.instanceId}\`: ${err.error}\n`;
      }
    }

    return {
      success: result.errors.length === 0,
      message,
      data: result,
    };
  }

  private async handleStartEC2(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const instanceIds = params.instanceIds as string[];
    const region = params.region as string | undefined;

    if (!instanceIds || instanceIds.length === 0) {
      return {
        success: false,
        message: '❌ Please specify at least one instance ID to start.',
        error: 'MISSING_INSTANCE_IDS',
      };
    }

    const result = await ec2ServiceProvider.startInstances(connection, instanceIds, region);

    let message = `🚀 **EC2 Start Operation**\n\n`;
    
    if (result.startedInstances.length > 0) {
      message += `✅ **Successfully starting:**\n`;
      for (const id of result.startedInstances) {
        message += `  • \`${id}\`\n`;
      }
    }

    if (result.errors.length > 0) {
      message += `\n❌ **Failed:**\n`;
      for (const err of result.errors) {
        message += `  • \`${err.instanceId}\`: ${err.error}\n`;
      }
    }

    return {
      success: result.errors.length === 0,
      message,
      data: result,
    };
  }

  private async handleIdleInstances(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const cpuThreshold = (params.cpuThreshold as number) || 5;
    const days = (params.days as number) || 7;
    const region = params.region as string | undefined;

    const recommendations = await ec2ServiceProvider.findIdleInstances(connection, {
      cpuThreshold,
      periodDays: days,
      region,
    });

    const message = ec2ServiceProvider.formatIdleRecommendationsForChat(recommendations);

    return {
      success: true,
      message,
      data: { recommendations },
    };
  }

  // ============================================================================
  // S3 HANDLERS
  // ============================================================================

  private async handleListS3(connection: IAWSConnection): Promise<AWSChatResponse> {
    const buckets = await s3ServiceProvider.listBuckets(connection);

    if (buckets.length === 0) {
      return {
        success: true,
        message: '📦 **S3 Buckets**\n\nNo S3 buckets found in your account.',
        data: { buckets: [] },
      };
    }

    let message = `📦 **S3 Buckets** (${buckets.length} total)\n\n`;
    
    for (const bucket of buckets.slice(0, 20)) {
      message += `  • **${bucket.name}**`;
      if (bucket.region) message += ` (${bucket.region})`;
      if (bucket.creationDate) {
        message += ` - Created: ${new Date(bucket.creationDate).toLocaleDateString()}`;
      }
      message += '\n';
    }

    if (buckets.length > 20) {
      message += `\n_...and ${buckets.length - 20} more buckets_`;
    }

    return {
      success: true,
      message,
      data: { buckets },
    };
  }

  // ============================================================================
  // RDS HANDLERS
  // ============================================================================

  private async handleListRDS(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const region = params.region as string | undefined;
    const instances = await rdsServiceProvider.listInstances(connection, region);

    if (instances.length === 0) {
      return {
        success: true,
        message: '🗄️ **RDS Instances**\n\nNo RDS database instances found.',
        data: { instances: [] },
      };
    }

    let message = `🗄️ **RDS Instances** (${instances.length} total)\n\n`;
    
    const running = instances.filter(i => i.status === 'available');
    const stopped = instances.filter(i => i.status === 'stopped');

    message += `  • 🟢 Available: ${running.length}\n`;
    message += `  • 🔴 Stopped: ${stopped.length}\n\n`;

    for (const instance of instances.slice(0, 10)) {
      const statusIcon = instance.status === 'available' ? '🟢' : '🔴';
      message += `${statusIcon} **${instance.dbInstanceId}**\n`;
      message += `   ${instance.engine} ${instance.engineVersion} | ${instance.dbInstanceClass}\n`;
      if (instance.allocatedStorage) {
        message += `   Storage: ${instance.allocatedStorage} GB\n`;
      }
      message += '\n';
    }

    if (instances.length > 10) {
      message += `_...and ${instances.length - 10} more instances_`;
    }

    return {
      success: true,
      message,
      data: { instances },
    };
  }

  // ============================================================================
  // LAMBDA HANDLERS
  // ============================================================================

  private async handleListLambda(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const region = params.region as string | undefined;
    const functions = await lambdaServiceProvider.listFunctions(connection, region);

    if (functions.length === 0) {
      return {
        success: true,
        message: 'λ **Lambda Functions**\n\nNo Lambda functions found.',
        data: { functions: [] },
      };
    }

    let message = `λ **Lambda Functions** (${functions.length} total)\n\n`;
    
    for (const fn of functions.slice(0, 15)) {
      message += `• **${fn.functionName}**\n`;
      message += `   Runtime: ${fn.runtime} | Memory: ${fn.memorySize}MB | Timeout: ${fn.timeout}s\n`;
      if (fn.lastModified) {
        message += `   Last Modified: ${new Date(fn.lastModified).toLocaleDateString()}\n`;
      }
      message += '\n';
    }

    if (functions.length > 15) {
      message += `_...and ${functions.length - 15} more functions_`;
    }

    return {
      success: true,
      message,
      data: { functions },
    };
  }

  // ============================================================================
  // GENERAL HANDLERS
  // ============================================================================

  private async handleOptimize(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const service = (params.service as string) || 'all';
    
    let message = `💡 **AWS Cost Optimization Recommendations**\n\n`;
    const recommendations: Array<{ service: string; recommendation: string; savings?: number }> = [];

    // EC2 Idle Instances
    if (service === 'all' || service === 'ec2') {
      try {
        const idleInstances = await ec2ServiceProvider.findIdleInstances(connection, {
          cpuThreshold: 5,
          periodDays: 7,
        });

        if (idleInstances.length > 0) {
          const totalSavings = idleInstances.reduce((sum, r) => sum + (r.estimatedMonthlySavings || 0), 0);
          message += `🖥️ **EC2 Instances**\n`;
          message += `  • Found **${idleInstances.length}** idle instances\n`;
          message += `  • Potential savings: **$${totalSavings.toFixed(2)}/month**\n\n`;
          
          for (const rec of idleInstances.slice(0, 3)) {
            recommendations.push({
              service: 'EC2',
              recommendation: `Stop or downsize ${rec.instance.instanceId} (${rec.instance.name || 'unnamed'})`,
              savings: rec.estimatedMonthlySavings,
            });
          }
        } else {
          message += `🖥️ **EC2 Instances**\n  ✅ All instances appear to be well-utilized\n\n`;
        }
      } catch (error) {
        message += `🖥️ **EC2 Instances**\n  ⚠️ Unable to analyze EC2 instances\n\n`;
      }
    }

    // Cost Anomalies
    try {
      const anomalies = await costExplorerServiceProvider.getAnomalies(
        connection,
        this.getDateDaysAgo(30),
        new Date().toISOString().split('T')[0]
      );

      if (anomalies.length > 0) {
        const totalImpact = anomalies.reduce((sum: number, a: { impact: { totalImpact: number } }) => sum + a.impact.totalImpact, 0);
        message += `⚠️ **Cost Anomalies**\n`;
        message += `  • Found **${anomalies.length}** anomalies\n`;
        message += `  • Total impact: **$${totalImpact.toFixed(2)}**\n\n`;
      } else {
        message += `⚠️ **Cost Anomalies**\n  ✅ No unusual spending detected\n\n`;
      }
    } catch (error) {
      // Skip if cost explorer not available
    }

    if (recommendations.length === 0) {
      message += `\n✅ **Summary:** Your AWS resources appear to be well-optimized!`;
    } else {
      message += `\n📋 **Top Recommendations:**\n`;
      for (const rec of recommendations.slice(0, 5)) {
        message += `  • [${rec.service}] ${rec.recommendation}`;
        if (rec.savings) message += ` (saves ~$${rec.savings.toFixed(2)}/mo)`;
        message += '\n';
      }
    }

    return {
      success: true,
      message,
      data: { recommendations },
    };
  }

  private async handleStatus(connection: IAWSConnection): Promise<AWSChatResponse> {
    let message = `☁️ **AWS Connection Status**\n\n`;
    
    message += `🔗 **Connection:** ${connection.connectionName}\n`;
    message += `📊 **Status:** ${connection.status === 'active' ? '✅ Active' : '❌ Inactive'}\n`;
    message += `🌍 **Account ID:** ${connection.awsAccountId}\n`;
    message += `🏷️ **Environment:** ${connection.environment}\n`;
    message += `🔐 **Permission Mode:** ${connection.permissionMode}\n\n`;

    message += `📋 **Enabled Services:**\n`;
    for (const service of connection.allowedServices) {
      message += `  • ${service.service.toUpperCase()} (${service.actions.length} permissions)\n`;
    }

    message += `\n🌎 **Allowed Regions:** ${connection.allowedRegions.join(', ')}\n`;

    if (connection.lastUsed) {
      message += `\n⏰ **Last Used:** ${new Date(connection.lastUsed).toLocaleString()}`;
    }

    return {
      success: true,
      message,
      data: {
        connectionName: connection.connectionName,
        status: connection.status,
        awsAccountId: connection.awsAccountId,
        environment: connection.environment,
        permissionMode: connection.permissionMode,
        allowedServices: connection.allowedServices,
        allowedRegions: connection.allowedRegions,
      },
    };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  private getDateDaysFromNow(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  private createProgressBar(percentage: number, length: number = 10): string {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}

export const awsChatHandlerService = AWSChatHandlerService.getInstance();
