import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { Ec2Service } from './ec2.service';
import { CostExplorerService } from './cost-explorer.service';
import { S3Service } from './s3.service';
import { RdsService } from './rds.service';
import { LambdaService } from './lambda.service';
import { DynamoDbService } from './dynamodb.service';
import { EcsService } from './ecs.service';
import { CloudWatchService } from './cloudwatch.service';
import { ResourceCreationPlanGeneratorService } from './resource-creation-plan-generator.service';
import { ExecutionEngineService } from './execution-engine.service';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '../../../schemas/integration/aws-connection.schema';
import type { DynamoDBCreationConfig } from '../types/aws-resource-creation.types';

/**
 * AWS Chat Handler Service
 *
 * Handles AWS commands from the chat interface, routing them to appropriate
 * AWS service providers and formatting responses for chat display.
 */

export interface AWSChatRequest {
  userId: string;
  action: string;
  params: Record<string, unknown>;
  connectionId?: string;
  approvalToken?: string; // For executing approved plans
}

export interface AWSChatResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  requiresApproval?: boolean; // Indicates user needs to approve
  approvalToken?: string; // Token for approval
}

let awsChatHandlerServiceInstance: AwsChatHandlerService | null = null;

/** Get the singleton instance (set when Nest bootstraps). Use for tools/MCP outside DI. */
export function getAwsChatHandlerService(): AwsChatHandlerService {
  if (!awsChatHandlerServiceInstance) {
    throw new Error(
      'AwsChatHandlerService not initialized. Ensure AwsModule is imported.',
    );
  }
  return awsChatHandlerServiceInstance;
}

@Injectable()
export class AwsChatHandlerService implements OnModuleInit, OnModuleDestroy {
  private approvalTokens = new Map<
    string,
    { plan: any; userId: string; expiresAt: Date }
  >();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    @InjectModel(AWSConnection.name)
    private awsConnectionModel: Model<AWSConnectionDocument>,
    private readonly logger: LoggerService,
    private readonly ec2Service: Ec2Service,
    private readonly costExplorerService: CostExplorerService,
    private readonly s3Service: S3Service,
    private readonly rdsService: RdsService,
    private readonly lambdaService: LambdaService,
    private readonly dynamoDbService: DynamoDbService,
    private readonly ecsService: EcsService,
    private readonly cloudWatchService: CloudWatchService,
    private readonly resourceCreationService: ResourceCreationPlanGeneratorService,
    private readonly executionEngineService: ExecutionEngineService,
  ) {}

  onModuleInit() {
    awsChatHandlerServiceInstance = this;
    // Clean up expired tokens every 5 minutes
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredTokens(),
      5 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    awsChatHandlerServiceInstance = null;
    // Clean up the interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Generate approval token for a plan
   */
  private generateApprovalToken(plan: any, userId: string): string {
    const token = `approval-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.approvalTokens.set(token, {
      plan,
      userId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    });
    return token;
  }

  /**
   * Validate and retrieve approval token
   */
  private validateApprovalToken(token: string, userId: string): any | null {
    const tokenData = this.approvalTokens.get(token);
    if (!tokenData) {
      return null;
    }
    if (tokenData.userId !== userId) {
      return null;
    }
    if (tokenData.expiresAt < new Date()) {
      this.approvalTokens.delete(token);
      return null;
    }
    return tokenData.plan;
  }

  /**
   * Clean up expired tokens
   */
  private cleanupExpiredTokens(): void {
    const now = new Date();
    for (const [token, data] of this.approvalTokens.entries()) {
      if (data.expiresAt < now) {
        this.approvalTokens.delete(token);
      }
    }
  }

  /**
   * Get active AWS connection for user
   */
  private async getConnection(
    userId: string,
    connectionId?: string,
  ): Promise<AWSConnectionDocument | null> {
    if (connectionId) {
      return this.awsConnectionModel.findOne({
        _id: connectionId,
        userId,
        status: 'active',
      });
    }

    // Get first active connection
    return this.awsConnectionModel
      .findOne({
        userId,
        status: 'active',
      })
      .sort({ lastUsedAt: -1 });
  }

  /**
   * Main entry point - process AWS chat command
   */
  async processCommand(request: AWSChatRequest): Promise<AWSChatResponse> {
    const startTime = Date.now();

    try {
      this.logger.log('Processing AWS chat command', {
        component: 'AwsChatHandlerService',
        userId: request.userId,
        action: request.action,
        params: request.params,
      });

      // Get AWS connection
      const connection = await this.getConnection(
        request.userId,
        request.connectionId,
      );

      if (!connection) {
        return {
          success: false,
          message:
            '❌ No active AWS connection found. Please connect your AWS account first from Settings → Integrations → AWS.',
          error: 'NO_CONNECTION',
        };
      }

      // Handle approval execution
      if (
        request.approvalToken &&
        (request.action === 'approve' || request.action === 'execute')
      ) {
        const plan = this.validateApprovalToken(
          request.approvalToken,
          request.userId,
        );
        if (!plan) {
          return {
            success: false,
            message:
              '❌ Approval token is invalid or expired. Please generate a new creation plan.',
            error: 'INVALID_APPROVAL_TOKEN',
          };
        }
        return this.executeApprovedCreation(
          request.approvalToken,
          connection,
          plan,
        );
      }

      // Route to appropriate handler
      const result = await this.routeCommand(
        request.action,
        request.params,
        connection,
      );

      this.logger.log('AWS chat command completed', {
        component: 'AwsChatHandlerService',
        action: request.action,
        success: result.success,
        executionTimeMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('AWS chat command failed', {
        component: 'AwsChatHandlerService',
        userId: request.userId,
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
    action: string,
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
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
      case 'create_ec2':
        return this.handleCreateEC2(params, connection);

      // S3
      case 'list_s3':
        return this.handleListS3(connection);
      case 'create_s3':
        return this.handleCreateS3(params, connection);

      // RDS
      case 'list_rds':
        return this.handleListRDS(params, connection);
      case 'create_rds':
        return this.handleCreateRDS(params, connection);

      // Lambda
      case 'list_lambda':
        return this.handleListLambda(params, connection);
      case 'create_lambda':
        return this.handleCreateLambda(params, connection);

      // DynamoDB
      case 'create_dynamodb':
        return this.handleCreateDynamoDB(params, connection);

      // ECS
      case 'create_ecs':
        return this.handleCreateECS(params, connection);

      // CloudWatch
      case 'metrics':
        return this.handleMetrics(params, connection);

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
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const endDate =
      (params.endDate as string) || new Date().toISOString().split('T')[0];
    const startDate = (params.startDate as string) || this.getDateDaysAgo(30);
    const granularity =
      (params.granularity as 'DAILY' | 'MONTHLY' | 'HOURLY') || 'DAILY';
    const groupBy = params.groupBy as string | undefined;

    try {
      const costData = await this.costExplorerService.getCostAndUsage(
        connection,
        startDate,
        endDate,
        granularity,
        groupBy ? [{ type: 'DIMENSION' as const, key: groupBy }] : undefined,
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to get costs: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleCostBreakdown(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const endDate =
      (params.endDate as string) || new Date().toISOString().split('T')[0];
    const startDate = (params.startDate as string) || this.getDateDaysAgo(30);

    try {
      const breakdown =
        await this.costExplorerService.getCostBreakdownByService(
          connection,
          startDate,
          endDate,
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to get cost breakdown: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleCostForecast(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const days = (params.days as number) || 30;
    const granularity =
      (params.granularity as 'DAILY' | 'MONTHLY') || 'MONTHLY';

    const startDate = new Date().toISOString().split('T')[0];
    const endDate = this.getDateDaysFromNow(days);

    try {
      const forecast = await this.costExplorerService.getCostForecast(
        connection,
        startDate,
        endDate,
        granularity,
      );

      let message = `🔮 **AWS Cost Forecast**\n\n`;
      message += `📅 Forecast Period: ${startDate} to ${endDate}\n\n`;

      const totalForecast = forecast.reduce((sum, f) => sum + f.meanValue, 0);
      message += `💵 **Predicted Total: $${totalForecast.toFixed(2)}**\n\n`;

      if (forecast.length > 0) {
        const first = forecast[0];
        if (
          first.predictionIntervalLowerBound &&
          first.predictionIntervalUpperBound
        ) {
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to get cost forecast: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleCostAnomalies(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const days = (params.days as number) || 30;
    const startDate = this.getDateDaysAgo(days);
    const endDate = new Date().toISOString().split('T')[0];

    try {
      const anomalies = await this.costExplorerService.getAnomalies(
        connection,
        startDate,
        endDate,
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to get cost anomalies: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // EC2 HANDLERS
  // ============================================================================

  private async handleListEC2(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const region = params.region as string | undefined;
    const state = params.state as string | undefined;

    let filters: Array<{ Name: string; Values: string[] }> | undefined;
    if (state && state !== 'all') {
      filters = [{ Name: 'instance-state-name', Values: [state] }];
    }

    try {
      const instances = await this.ec2Service.listInstances(
        connection,
        filters,
        region,
      );
      const message = this.ec2Service.formatInstancesForChat(instances);

      return {
        success: true,
        message,
        data: { instances },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to list EC2 instances: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleStopEC2(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
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

    try {
      const results = await this.ec2Service.stopInstances(
        connection,
        instanceIds,
        region,
      );

      let message = `🛑 **EC2 Stop Operation**\n\n`;

      // Count successful stops
      const stoppedCount = results.filter(
        (r) => r.currentState === 'stopped' || r.currentState === 'stopping',
      ).length;

      if (stoppedCount > 0) {
        message += `✅ **Successfully stopping:**\n`;
        for (const result of results) {
          message += `  • \`${result.instanceId}\`: ${result.currentState}\n`;
        }
      }

      return {
        success: stoppedCount > 0,
        message,
        data: results,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to stop EC2 instances: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleStartEC2(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
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

    try {
      const results = await this.ec2Service.startInstances(
        connection,
        instanceIds,
        region,
      );

      let message = `🚀 **EC2 Start Operation**\n\n`;

      // Count successful starts
      const startedCount = results.filter(
        (r) => r.currentState === 'running' || r.currentState === 'pending',
      ).length;

      if (startedCount > 0) {
        message += `✅ **Successfully starting:**\n`;
        for (const result of results) {
          message += `  • \`${result.instanceId}\`: ${result.currentState}\n`;
        }
      }

      return {
        success: startedCount > 0,
        message,
        data: results,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to start EC2 instances: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleIdleInstances(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const cpuThreshold = (params.cpuThreshold as number) || 5;

    try {
      const recommendations = await this.ec2Service.findIdleInstancesDetailed(
        connection,
        cpuThreshold,
      );

      let message = `💤 **Idle EC2 Instance Analysis**\n\n`;

      if (recommendations.length === 0) {
        message += `✅ **Good news!** No idle instances found with CPU usage below ${cpuThreshold}%.`;
      } else {
        const totalSavings = recommendations.reduce(
          (sum, r) => sum + r.estimatedMonthlySavings,
          0,
        );
        message += `Found **${recommendations.length}** potentially idle instances:\n\n`;
        message += `💰 **Potential monthly savings: $${totalSavings.toFixed(2)}**\n\n`;

        for (const rec of recommendations.slice(0, 5)) {
          message += `• **${rec.instanceId}** (${rec.instanceType})\n`;
          message += `  CPU: ${rec.averageCpuUtilization.toFixed(1)}% | Network In: ${(rec.averageNetworkIn / 1024 / 1024).toFixed(2)}MB\n`;
          message += `  💵 Save ~$${rec.estimatedMonthlySavings.toFixed(2)}/month\n`;
          message += `  📋 ${rec.recommendation}\n\n`;
        }

        if (recommendations.length > 5) {
          message += `_...and ${recommendations.length - 5} more instances_`;
        }
      }

      return {
        success: true,
        message,
        data: { recommendations },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to analyze idle instances: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleCreateEC2(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const instanceName = params.instanceName as string;

    if (!instanceName) {
      return {
        success: false,
        message:
          '❌ Instance name is required. Please provide an instance name (e.g., "my-web-server").',
        error: 'MISSING_INSTANCE_NAME',
      };
    }

    try {
      const config = {
        instanceName,
        instanceType: (params.instanceType as string) ?? 't3.micro',
        region:
          (params.region as string) ??
          connection.allowedRegions?.[0] ??
          'us-east-1',
        vpcId: params.vpcId as string | undefined,
        subnetId: params.subnetId as string | undefined,
        securityGroupId: params.securityGroupId as string | undefined,
        keyPairName: params.keyPairName as string | undefined,
        tags: params.tags as Record<string, string> | undefined,
      };

      const plan = await this.resourceCreationService.generateEC2Plan(
        connection.userId,
        connection._id.toString(),
        config,
      );
      const approvalToken = this.generateApprovalToken(plan, connection.userId);

      let message = `📋 **EC2 Instance Creation Plan**\n\n`;
      message += `🖥️ **Instance Details:**\n`;
      message += `  • Name: ${config.instanceName}\n`;
      message += `  • Type: ${config.instanceType}\n`;
      message += `  • Region: ${config.region}\n\n`;
      message += `💰 **Cost Estimate:**\n`;
      message += `  • Hourly: $${plan.costEstimate.hourly.toFixed(4)}\n`;
      message += `  • Monthly: $${plan.costEstimate.monthly.toFixed(2)}\n`;
      message += `  • Free Tier Eligible: ${plan.costEstimate.freeEligible ? '✅ Yes' : '❌ No'}\n\n`;
      message += `⏱️ **Estimated Duration:** ${Math.ceil(plan.estimatedDuration / 60)} minutes\n\n`;
      message += `⚠️ **Risk Level:** ${plan.riskLevel.toUpperCase()}\n\n`;
      message += `✅ **Ready to create?** Reply with "approve" to proceed or "cancel" to abort.`;

      return {
        success: true,
        message,
        data: { plan },
        requiresApproval: true,
        approvalToken,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate EC2 creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // S3 HANDLERS
  // ============================================================================

  private async handleListS3(
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    try {
      const buckets = await this.s3Service.listBuckets(connection);

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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to list S3 buckets: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleCreateS3(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const bucketName = params.bucketName as string;
    const region = params.region as string | undefined;

    if (!bucketName) {
      return {
        success: false,
        message: '❌ Bucket name is required to create an S3 bucket.',
        error: 'MISSING_BUCKET_NAME',
      };
    }

    try {
      const plan = await this.resourceCreationService.generateS3Plan(
        connection.userId,
        connection._id.toString(),
        { bucketName, region },
      );
      const approvalToken = this.generateApprovalToken(plan, connection.userId);

      let message = `📋 **S3 Bucket Creation Plan**\n\n`;
      message += `📦 **Bucket Details:**\n`;
      message += `  • Name: ${bucketName}\n`;
      message += `  • Region: ${region || 'us-east-1'}\n\n`;
      message += `🔒 **Security:**\n`;
      message += `  • Public Access: Blocked\n`;
      message += `  • Encryption: Enabled\n`;
      message += `  • Versioning: Enabled\n\n`;
      message += `💰 **Cost:** Pay only for storage and requests used\n\n`;
      message += `✅ **Ready to create?** Reply with "approve" to proceed.`;

      return {
        success: true,
        message,
        data: { plan },
        requiresApproval: true,
        approvalToken,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate S3 creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // RDS HANDLERS
  // ============================================================================

  private async handleListRDS(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const region = params.region as string | undefined;

    try {
      const instances = await this.rdsService.listInstances(connection, region);

      if (instances.length === 0) {
        return {
          success: true,
          message: '🗄️ **RDS Instances**\n\nNo RDS database instances found.',
          data: { instances: [] },
        };
      }

      let message = `🗄️ **RDS Instances** (${instances.length} total)\n\n`;

      const running = instances.filter(
        (i) => i.dbInstanceStatus === 'available',
      );
      const stopped = instances.filter((i) => i.dbInstanceStatus === 'stopped');

      message += `  • 🟢 Available: ${running.length}\n`;
      message += `  • 🔴 Stopped: ${stopped.length}\n\n`;

      for (const instance of instances.slice(0, 10)) {
        const statusIcon =
          instance.dbInstanceStatus === 'available' ? '🟢' : '🔴';
        message += `${statusIcon} **${instance.dbInstanceIdentifier}**\n`;
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to list RDS instances: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleCreateRDS(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const dbInstanceIdentifier = params.dbInstanceIdentifier as string;

    if (!dbInstanceIdentifier) {
      return {
        success: false,
        message:
          '❌ Database instance identifier is required. Please provide a name (e.g., "my-database").',
        error: 'MISSING_DB_IDENTIFIER',
      };
    }

    try {
      const config = {
        dbInstanceIdentifier,
        engine:
          (params.engine as
            | 'mysql'
            | 'postgres'
            | 'mariadb'
            | 'oracle'
            | 'sqlserver') ?? 'postgres',
        dbInstanceClass: (params.dbInstanceClass as string) ?? 'db.t3.micro',
        allocatedStorage: (params.allocatedStorage as number) ?? 20,
        region:
          (params.region as string) ??
          connection.allowedRegions?.[0] ??
          'us-east-1',
        tags: params.tags as Record<string, string> | undefined,
      };

      const plan = await this.resourceCreationService.generateRDSPlan(
        connection.userId,
        connection._id.toString(),
        config,
      );
      const approvalToken = this.generateApprovalToken(plan, connection.userId);

      let message = `📋 **RDS Database Creation Plan**\n\n`;
      message += `🗄️ **Database Details:**\n`;
      message += `  • Identifier: ${config.dbInstanceIdentifier}\n`;
      message += `  • Engine: ${config.engine}\n`;
      message += `  • Instance Class: ${config.dbInstanceClass}\n`;
      message += `  • Storage: ${config.allocatedStorage}GB\n`;
      message += `  • Region: ${config.region}\n\n`;
      message += `💰 **Cost Estimate:**\n`;
      message += `  • Hourly: $${plan.costEstimate.hourly.toFixed(4)}\n`;
      message += `  • Monthly: $${plan.costEstimate.monthly.toFixed(2)}\n`;
      message += `  • Free Tier Eligible: ${plan.costEstimate.freeEligible ? '✅ Yes' : '❌ No'}\n\n`;
      message += `⚠️ **Warnings:**\n`;
      for (const warning of plan.warnings) {
        message += `  • ${warning}\n`;
      }
      message += `\n✅ **Ready to create?** Reply with "approve" to proceed.`;

      return {
        success: true,
        message,
        data: { plan },
        requiresApproval: true,
        approvalToken,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate RDS creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // LAMBDA HANDLERS
  // ============================================================================

  private async handleListLambda(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const region = params.region as string | undefined;

    try {
      const functions = await this.lambdaService.listFunctions(
        connection,
        region,
      );

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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to list Lambda functions: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleCreateLambda(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const functionName = params.functionName as string;

    if (!functionName) {
      return {
        success: false,
        message:
          '❌ Function name is required. Please provide a name (e.g., "my-function").',
        error: 'MISSING_FUNCTION_NAME',
      };
    }

    try {
      const config = {
        functionName,
        runtime:
          (params.runtime as
            | 'nodejs18.x'
            | 'nodejs20.x'
            | 'python3.11'
            | 'python3.12'
            | 'java17'
            | 'go1.x') ?? 'nodejs20.x',
        handler: (params.handler as string) ?? 'index.handler',
        memorySize: (params.memorySize as number) ?? 128,
        timeout: (params.timeout as number) ?? 3,
        region:
          (params.region as string) ??
          connection.allowedRegions?.[0] ??
          'us-east-1',
        tags: params.tags as Record<string, string> | undefined,
      };

      const plan = await this.resourceCreationService.generateLambdaPlan(
        connection.userId,
        connection._id.toString(),
        config,
      );
      const approvalToken = this.generateApprovalToken(plan, connection.userId);

      let message = `📋 **Lambda Function Creation Plan**\n\n`;
      message += `⚡ **Function Details:**\n`;
      message += `  • Name: ${config.functionName}\n`;
      message += `  • Runtime: ${config.runtime}\n`;
      message += `  • Memory: ${config.memorySize}MB\n`;
      message += `  • Timeout: ${config.timeout}s\n`;
      message += `  • Region: ${config.region}\n\n`;
      message += `💰 **Cost Estimate:**\n`;
      message += `  • Monthly: $${plan.costEstimate.monthly.toFixed(2)}\n`;
      message += `  • Free Tier Eligible: ✅ Yes (1M requests/month free)\n\n`;
      message += `✅ **Ready to create?** Reply with "approve" to proceed.`;

      return {
        success: true,
        message,
        data: { plan },
        requiresApproval: true,
        approvalToken,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate Lambda creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // DYNAMODB HANDLER
  // ============================================================================

  private async handleCreateDynamoDB(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const tableName = params.tableName as string;
    const partitionKeyName = params.partitionKeyName as string;

    if (!tableName || !partitionKeyName) {
      return {
        success: false,
        message:
          '❌ Table name and partition key name are required. Example: tableName="users", partitionKeyName="userId".',
        error: 'MISSING_TABLE_CONFIG',
      };
    }

    try {
      const partitionKeyType =
        (params.partitionKeyType as 'S' | 'N' | 'B') ?? 'S';
      const sortKeyName = params.sortKeyName as string | undefined;
      const sortKeyType = (params.sortKeyType as 'S' | 'N' | 'B') ?? 'S';

      // Build attributeDefinitions and keySchema required by DynamoDBCreationConfig
      const attributeDefinitions: Array<{
        attributeName: string;
        attributeType: 'S' | 'N' | 'B';
      }> = [
        { attributeName: partitionKeyName, attributeType: partitionKeyType },
      ];
      const keySchema: Array<{
        attributeName: string;
        keyType: 'HASH' | 'RANGE';
      }> = [{ attributeName: partitionKeyName, keyType: 'HASH' }];
      if (sortKeyName) {
        attributeDefinitions.push({
          attributeName: sortKeyName,
          attributeType: sortKeyType,
        });
        keySchema.push({ attributeName: sortKeyName, keyType: 'RANGE' });
      }

      const billingMode =
        (params.billingMode as 'PAY_PER_REQUEST' | 'PROVISIONED') ??
        'PAY_PER_REQUEST';
      const region =
        (params.region as string) ??
        connection.allowedRegions?.[0] ??
        'us-east-1';

      const config: DynamoDBCreationConfig = {
        tableName,
        attributeDefinitions,
        keySchema,
        billingMode,
        tags: params.tags as Record<string, string> | undefined,
      };

      const plan = await this.resourceCreationService.generateDynamoDBPlan(
        connection.userId,
        connection._id.toString(),
        config,
      );
      const approvalToken = this.generateApprovalToken(plan, connection.userId);

      let message = `📋 **DynamoDB Table Creation Plan**\n\n`;
      message += `📊 **Table Details:**\n`;
      message += `  • Name: ${config.tableName}\n`;
      message += `  • Partition Key: ${partitionKeyName} (${partitionKeyType})\n`;
      if (sortKeyName) {
        message += `  • Sort Key: ${sortKeyName} (${sortKeyType})\n`;
      }
      message += `  • Billing Mode: ${billingMode}\n`;
      message += `  • Region: ${region}\n\n`;
      message += `💰 **Cost Estimate:**\n`;
      message += `  • Monthly: $${plan.costEstimate.monthly.toFixed(2)}\n`;
      message += `  • Free Tier Eligible: ✅ Yes (25GB storage free)\n\n`;
      message += `✅ **Ready to create?** Reply with "approve" to proceed.`;

      return {
        success: true,
        message,
        data: { plan },
        requiresApproval: true,
        approvalToken,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate DynamoDB creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // ECS HANDLER
  // ============================================================================

  private async handleCreateECS(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const clusterName = params.clusterName as string;

    if (!clusterName) {
      return {
        success: false,
        message:
          '❌ Cluster name is required. Please provide a name (e.g., "my-cluster").',
        error: 'MISSING_CLUSTER_NAME',
      };
    }

    try {
      const config = {
        clusterName,
        region:
          (params.region as string) ??
          connection.allowedRegions?.[0] ??
          'us-east-1',
        enableContainerInsights:
          (params.enableContainerInsights as boolean) ?? true,
        tags: params.tags as Record<string, string> | undefined,
      };

      const plan = await this.resourceCreationService.generateECSPlan(
        connection.userId,
        connection._id.toString(),
        config,
      );
      const approvalToken = this.generateApprovalToken(plan, connection.userId);

      let message = `📋 **ECS Cluster Creation Plan**\n\n`;
      message += `🐳 **Cluster Details:**\n`;
      message += `  • Name: ${config.clusterName}\n`;
      message += `  • Region: ${config.region}\n`;
      message += `  • Container Insights: ${config.enableContainerInsights ? '✅ Enabled' : '❌ Disabled'}\n`;
      message += `  • Capacity Providers: Fargate, Fargate Spot\n\n`;
      message += `💰 **Cost Estimate:**\n`;
      message += `  • Cluster: Free (pay only for running tasks)\n`;
      message += `  • Free Tier Eligible: ✅ Yes\n\n`;
      message += `✅ **Ready to create?** Reply with "approve" to proceed.`;

      return {
        success: true,
        message,
        data: { plan },
        requiresApproval: true,
        approvalToken,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate ECS creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // CLOUDWATCH HANDLER
  // ============================================================================

  private async handleMetrics(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const namespace = (params.namespace as string) ?? 'AWS/EC2';
    const metricName = (params.metricName as string) ?? 'CPUUtilization';
    const startTime =
      (params.startTime as string) ??
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endTime = (params.endTime as string) ?? new Date().toISOString();
    const period = (params.period as number) ?? 3600; // 1 hour default

    try {
      // Build metric query
      const queries = [
        {
          id: 'm1',
          namespace,
          metricName,
          stat: 'Average',
          period,
        },
      ];

      const metrics = await this.cloudWatchService.getMetricData(
        connection,
        queries,
        new Date(startTime),
        new Date(endTime),
      );

      let message = `📊 **CloudWatch Metrics**\n\n`;
      message += `📈 **${metricName}** (${namespace})\n\n`;

      if (metrics.length > 0 && metrics[0].dataPoints.length > 0) {
        const dataPoints = metrics[0].dataPoints;
        const values = dataPoints.map((dp) => dp.value);
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
        const max = Math.max(...values);
        const min = Math.min(...values);

        message += `📊 **Statistics:**\n`;
        message += `  • Average: ${avg.toFixed(2)}\n`;
        message += `  • Maximum: ${max.toFixed(2)}\n`;
        message += `  • Minimum: ${min.toFixed(2)}\n\n`;

        message += `📈 **Recent Data Points:**\n`;
        for (
          let i = Math.max(0, dataPoints.length - 5);
          i < dataPoints.length;
          i++
        ) {
          message += `  • ${new Date(dataPoints[i].timestamp).toLocaleTimeString()}: ${dataPoints[i].value.toFixed(2)}\n`;
        }
      } else {
        message += `⚠️ No metrics data available for the specified time range.`;
      }

      return {
        success: true,
        message,
        data: { metrics },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to get metrics: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // GENERAL HANDLERS
  // ============================================================================

  private async handleOptimize(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const service = (params.service as string) || 'all';

    let message = `💡 **AWS Cost Optimization Recommendations**\n\n`;
    const recommendations: Array<{
      service: string;
      recommendation: string;
      savings?: number;
    }> = [];

    // EC2 Idle Instances
    if (service === 'all' || service === 'ec2') {
      try {
        const idleInstances = await this.ec2Service.findIdleInstancesDetailed(
          connection,
          5,
        );

        if (idleInstances.length > 0) {
          const totalSavings = idleInstances.reduce(
            (sum, r) => sum + r.estimatedMonthlySavings,
            0,
          );
          message += `🖥️ **EC2 Instances**\n`;
          message += `  • Found **${idleInstances.length}** idle instances\n`;
          message += `  • Potential savings: **$${totalSavings.toFixed(2)}/month**\n\n`;

          for (const rec of idleInstances.slice(0, 3)) {
            recommendations.push({
              service: 'EC2',
              recommendation: `Stop or downsize ${rec.instanceId} (${rec.instanceType})`,
              savings: rec.estimatedMonthlySavings,
            });
          }
        } else {
          message += `🖥️ **EC2 Instances**\n  ✅ All instances appear to be well-utilized\n\n`;
        }
      } catch {
        message += `🖥️ **EC2 Instances**\n  ⚠️ Unable to analyze EC2 instances\n\n`;
      }
    }

    // RDS Non-Production
    if (service === 'all' || service === 'rds') {
      try {
        const nonProdInstances =
          await this.rdsService.findNonProductionInstances(connection);

        if (nonProdInstances.length > 0) {
          const totalSavings = nonProdInstances.reduce(
            (sum, i) => sum + i.estimatedMonthlySavings,
            0,
          );
          message += `🗄️ **RDS Non-Production**\n`;
          message += `  • Found **${nonProdInstances.length}** non-production instances\n`;
          message += `  • Potential savings: **$${totalSavings.toFixed(2)}/month**\n\n`;
        }
      } catch {
        // Skip RDS analysis errors
      }
    }

    // Lambda Over-Provisioned
    if (service === 'all' || service === 'lambda') {
      try {
        const overProvisioned =
          await this.lambdaService.findOverProvisionedFunctions(connection);

        if (overProvisioned.length > 0) {
          const totalSavings = overProvisioned.reduce(
            (sum, f) => sum + f.estimatedMonthlySavings,
            0,
          );
          message += `λ **Lambda Over-Provisioned**\n`;
          message += `  • Found **${overProvisioned.length}** over-provisioned functions\n`;
          message += `  • Potential savings: **$${totalSavings.toFixed(2)}/month**\n\n`;
        }
      } catch {
        // Skip Lambda analysis errors
      }
    }

    // Cost Anomalies
    try {
      const anomalies = await this.costExplorerService.getAnomalies(
        connection,
        this.getDateDaysAgo(30),
        new Date().toISOString().split('T')[0],
      );

      if (anomalies.length > 0) {
        const totalImpact = anomalies.reduce(
          (sum, a) => sum + a.impact.totalImpact,
          0,
        );
        message += `⚠️ **Cost Anomalies**\n`;
        message += `  • Found **${anomalies.length}** anomalies\n`;
        message += `  • Total impact: **$${totalImpact.toFixed(2)}**\n\n`;
      } else {
        message += `⚠️ **Cost Anomalies**\n  ✅ No unusual spending detected\n\n`;
      }
    } catch {
      // Skip cost anomalies errors
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

  private async handleStatus(
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    let message = `☁️ **AWS Connection Status**\n\n`;

    message += `🔗 **Connection:** ${connection.name}\n`;
    message += `📊 **Status:** ${connection.status === 'active' ? '✅ Active' : '❌ Inactive'}\n`;
    message += `🌍 **Environment:** ${connection.environment}\n`;
    message += `🔐 **Permission Mode:** ${connection.permissionMode}\n`;
    message += `🚀 **Execution Mode:** ${connection.executionMode}\n\n`;

    message += `📋 **Enabled Services:**\n`;
    for (const service of connection.allowedServices || []) {
      message += `  • ${service.service.toUpperCase()} (${service.actions?.length || 0} actions)\n`;
    }

    message += `\n🌎 **Allowed Regions:** ${connection.allowedRegions?.join(', ') || 'Not configured'}\n`;

    if (connection.lastUsedAt) {
      message += `\n⏰ **Last Used:** ${new Date(connection.lastUsedAt).toLocaleString()}`;
    }

    return {
      success: true,
      message,
      data: {
        connectionName: connection.name,
        status: connection.status,
        environment: connection.environment,
        permissionMode: connection.permissionMode,
        executionMode: connection.executionMode,
        allowedServices: connection.allowedServices,
        allowedRegions: connection.allowedRegions,
      },
    };
  }

  // ============================================================================
  // APPROVED CREATION EXECUTION
  // ============================================================================

  private async executeApprovedCreation(
    approvalToken: string,
    connection: AWSConnectionDocument,
    plan: any,
  ): Promise<AWSChatResponse> {
    try {
      let result: any;
      let message = '';

      switch (plan.resourceType) {
        case 'ec2':
          result = await this.ec2Service.createInstance(connection, {
            imageId: plan.parameters.imageId,
            instanceType: plan.parameters.instanceType,
            region: plan.parameters.region,
            minCount: 1,
            maxCount: 1,
          });
          message = `✅ **EC2 Instance Created Successfully**\n\n🖥️ **${result.instanceId}**\nState: ${result.state}\nPrivate IP: ${result.privateIpAddress}\nPublic IP: ${result.publicIpAddress ?? 'Pending'}\n\n⏱️ Instance is starting up. It may take a few moments to be fully ready.`;
          break;

        case 'rds':
          result = await this.rdsService.createInstance(connection, {
            dbInstanceIdentifier: plan.parameters.dbInstanceIdentifier,
            engine: plan.parameters.engine,
            dbInstanceClass: plan.parameters.dbInstanceClass,
            allocatedStorage: plan.parameters.allocatedStorage,
            region: plan.parameters.region,
            masterUsername: plan.parameters.masterUsername ?? 'admin',
            masterUserPassword:
              plan.parameters.masterUserPassword ??
              crypto
                .randomBytes(16)
                .toString('base64')
                .replace(/[+/=]/g, (c) =>
                  c === '+' ? '-' : c === '/' ? '_' : '',
                ),
          });
          message = `✅ **RDS Database Created Successfully**\n\n🗄️ **${result.dbInstanceIdentifier}**\nEndpoint: ${result.endpoint}\nPort: ${result.port}\n\n⏱️ Database is initializing. This typically takes 5-10 minutes.`;
          break;

        case 'lambda': {
          const AdmZip = require('adm-zip');
          const emptyZip = new AdmZip();
          const defaultCode =
            plan.parameters.code ?? emptyZip.toBuffer().toString('base64');
          result = await this.lambdaService.createFunction(connection, {
            functionName: plan.parameters.functionName,
            runtime: plan.parameters.runtime,
            handler: plan.parameters.handler,
            code: defaultCode,
            memorySize: plan.parameters.memorySize,
            timeout: plan.parameters.timeout,
            region: plan.parameters.region,
          });
          message = `✅ **Lambda Function Created Successfully**\n\nλ **${result.functionName}**\nARN: ${result.functionArn}\nRuntime: ${result.runtime}\n\n🚀 Function is ready to use!`;
          break;
        }

        case 'dynamodb':
          result = await this.dynamoDbService.createTable(connection, {
            tableName: plan.parameters.tableName,
            partitionKeyName: plan.parameters.partitionKeyName,
            partitionKeyType: plan.parameters.partitionKeyType,
            sortKeyName: plan.parameters.sortKeyName,
            sortKeyType: plan.parameters.sortKeyType,
            region: plan.parameters.region,
          });
          message = `✅ **DynamoDB Table Created Successfully**\n\n📊 **${result.tableName}**\nARN: ${result.tableArn}\nStatus: ${result.status}\n\n🚀 Table is ready to use!`;
          break;

        case 'ecs':
          result = await this.ecsService.createCluster(connection, {
            clusterName: plan.parameters.clusterName,
            region: plan.parameters.region,
          });
          message = `✅ **ECS Cluster Created Successfully**\n\n🐳 **${result.clusterName}**\nARN: ${result.clusterArn}\nStatus: ${result.status}\n\n🚀 Cluster is ready! You can now add services and tasks.`;
          break;

        case 's3':
          result = await this.s3Service.createBucket(
            connection,
            plan.parameters.bucketName,
            plan.parameters.region,
          );
          message = `✅ **S3 Bucket Created Successfully**\n\n📦 **${result.name}**\nRegion: ${result.region}\n\n🚀 Bucket is ready to use!`;
          break;

        default:
          throw new Error(`Unknown resource type: ${plan.resourceType}`);
      }

      // Remove used token
      this.approvalTokens.delete(approvalToken);

      return {
        success: true,
        message,
        data: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to execute approved creation', {
        component: 'AwsChatHandlerService',
        resourceType: plan.resourceType,
        error: errorMessage,
      });
      return {
        success: false,
        message: `❌ Failed to create resource: ${errorMessage}`,
        error: errorMessage,
      };
    }
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
