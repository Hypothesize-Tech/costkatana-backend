import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '../../../schemas/integration/aws-connection.schema';
import { randomUUID } from 'crypto';
import { Ec2Service } from '../../../modules/aws/services/ec2.service';
import { CostExplorerService } from '../../../modules/aws/services/cost-explorer.service';
import { S3Service } from '../../../modules/aws/services/s3.service';
import { RdsService } from '../../../modules/aws/services/rds.service';
import { LambdaService } from '../../../modules/aws/services/lambda.service';
import { ResourceCreationPlanGeneratorService } from '../../../modules/aws/services/resource-creation-plan-generator.service';
import { DynamoDbService } from '../../../modules/aws/services/dynamodb.service';
import { EcsService } from '../../../modules/aws/services/ecs.service';

export interface AWSChatRequest {
  userId: string;
  action: string;
  params: Record<string, unknown>;
  connectionId?: string;
  approvalToken?: string;
}

export interface AWSChatResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  requiresApproval?: boolean;
  approvalToken?: string;
}

/**
 * AWS Chat Agent Service
 *
 * Handles AWS-related queries from the chat interface, routing them to appropriate
 * AWS service providers and formatting responses for chat display.
 * Port from Express awsChatHandler.service.ts
 */
@Injectable()
export class AWSChatAgentService {
  private readonly logger = new Logger(AWSChatAgentService.name);

  // Approval tokens for resource creation (in-memory, with cleanup)
  private approvalTokens = new Map<
    string,
    { plan: any; userId: string; expiresAt: Date }
  >();

  constructor(
    @InjectModel(AWSConnection.name)
    private awsConnectionModel: Model<AWSConnectionDocument>,
    private readonly ec2Service: Ec2Service,
    private readonly costExplorerService: CostExplorerService,
    private readonly s3Service: S3Service,
    private readonly rdsService: RdsService,
    private readonly lambdaService: LambdaService,
    private readonly resourceCreationPlanGenerator: ResourceCreationPlanGeneratorService,
    private readonly dynamoDbService: DynamoDbService,
    private readonly ecsService: EcsService,
  ) {
    // Clean up expired tokens every 5 minutes
    setInterval(() => this.cleanupExpiredTokens(), 5 * 60 * 1000);
  }

  /**
   * Generate approval token for a plan
   */
  private generateApprovalToken(plan: any, userId: string): string {
    const token = `approval-${Date.now()}-${randomUUID()}`;
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
      this.logger.log(
        `Processing AWS chat command for user ${request.userId}`,
        {
          action: request.action,
          params: request.params,
        },
      );

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

      this.logger.log(`AWS chat command completed for user ${request.userId}`, {
        action: request.action,
        success: result.success,
        executionTimeMs: Date.now() - startTime,
      });

      return result;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`AWS chat command failed for user ${request.userId}`, {
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

  private formatInstancesForChat(instances: any[]): string {
    if (instances.length === 0) {
      return '🖥️ **EC2 Instances**\n\nNo EC2 instances found in your account.';
    }

    let message = `🖥️ **EC2 Instances** (${instances.length} total)\n\n`;

    const running = instances.filter((i) => i.state === 'running');
    const stopped = instances.filter((i) => i.state === 'stopped');

    message += `  • 🟢 Running: ${running.length}\n`;
    message += `  • 🔴 Stopped: ${stopped.length}\n\n`;

    for (const instance of instances.slice(0, 10)) {
      const statusIcon = instance.state === 'running' ? '🟢' : '🔴';
      message += `${statusIcon} **${instance.instanceId}**\n`;
      message += `   ${instance.instanceType} | ${instance.availabilityZone}\n`;
      if (instance.publicIpAddress) {
        message += `   Public IP: ${instance.publicIpAddress}\n`;
      }
      if (instance.privateIpAddress) {
        message += `   Private IP: ${instance.privateIpAddress}\n`;
      }
      if (instance.tags?.length > 0) {
        const nameTag = instance.tags.find((t: any) => t.key === 'Name');
        if (nameTag) {
          message += `   Name: ${nameTag.value}\n`;
        }
      }
      message += '\n';
    }

    if (instances.length > 10) {
      message += `_...and ${instances.length - 10} more instances_`;
    }

    return message;
  }

  private formatIdleRecommendationsForChat(
    recommendations: Array<{
      instanceId: string;
      instanceType: string;
      averageCpuUtilization: number;
      isIdle: boolean;
    }>,
  ): string {
    if (recommendations.length === 0) {
      return '✅ **EC2 Idle Instance Analysis**\n\nNo idle instances found. All your EC2 instances appear to be well-utilized.';
    }

    const idleOnly = recommendations.filter((r) => r.isIdle);
    let message = `⚠️ **EC2 Idle Instances Found**\n\n`;
    message += `Found **${idleOnly.length}** potentially idle instances:\n\n`;

    for (const rec of idleOnly.slice(0, 10)) {
      message += `🖥️ **${rec.instanceId}**\n`;
      message += `  • Type: ${rec.instanceType}\n`;
      message += `  • Avg CPU: ${rec.averageCpuUtilization.toFixed(1)}%\n`;
      message += `  • Recommendation: Stop or downsize if not needed\n\n`;
    }

    if (idleOnly.length > 10) {
      message += `_...and ${idleOnly.length - 10} more recommendations_`;
    }

    return message;
  }

  // ============================================================================
  // COST EXPLORER HANDLERS
  // ============================================================================

  private async handleCosts(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    try {
      const endDate =
        (params.endDate as string) || new Date().toISOString().split('T')[0];
      const startDate = (params.startDate as string) || this.getDateDaysAgo(30);
      const granularity =
        (params.granularity as 'DAILY' | 'MONTHLY' | 'HOURLY') || 'DAILY';
      const groupBy = params.groupBy as string | undefined;

      const costData = await this.costExplorerService.getCostAndUsage(
        connection,
        startDate,
        endDate,
        granularity,
        groupBy ? [{ type: 'DIMENSION', key: groupBy }] : undefined,
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
      this.logger.error('Error getting AWS costs', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to retrieve AWS cost data. Please check your connection and permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleCostBreakdown(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    try {
      const endDate =
        (params.endDate as string) || new Date().toISOString().split('T')[0];
      const startDate = (params.startDate as string) || this.getDateDaysAgo(30);

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
      this.logger.error('Error getting AWS cost breakdown', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to retrieve AWS cost breakdown. Please check your connection and permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleCostForecast(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    try {
      const days = (params.days as number) || 30;
      const granularity =
        (params.granularity as 'DAILY' | 'MONTHLY') || 'MONTHLY';

      const startDate = new Date().toISOString().split('T')[0];
      const endDate = this.getDateDaysFromNow(days);

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
      this.logger.error('Error getting AWS cost forecast', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to retrieve AWS cost forecast. Please check your connection and permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleCostAnomalies(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    try {
      const days = (params.days as number) || 30;
      const startDate = this.getDateDaysAgo(days);
      const endDate = new Date().toISOString().split('T')[0];

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
      this.logger.error('Error getting AWS cost anomalies', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to retrieve AWS cost anomalies. Please check your connection and permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
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
    try {
      const region = params.region as string | undefined;
      const state = params.state as string | undefined;

      let filters: Array<{ Name: string; Values: string[] }> | undefined;
      if (state && state !== 'all') {
        filters = [{ Name: 'instance-state-name', Values: [state] }];
      }

      const instances = await this.ec2Service.listInstances(
        connection,
        filters,
        region,
      );
      const message = this.formatInstancesForChat(instances);

      return {
        success: true,
        message,
        data: { instances },
      };
    } catch (error) {
      this.logger.error('Error listing EC2 instances', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to list EC2 instances. Please check your connection and permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleStopEC2(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    try {
      const instanceIds = params.instanceIds as string[];
      const region = params.region as string | undefined;

      if (!instanceIds || instanceIds.length === 0) {
        return {
          success: false,
          message: '❌ Please specify at least one instance ID to stop.',
          error: 'MISSING_INSTANCE_IDS',
        };
      }

      const result = await this.ec2Service.stopInstances(
        connection,
        instanceIds,
        region,
      );

      const stoppedIds = result.map((r) => r.instanceId);
      const errors: Array<{ instanceId: string; error: string }> = [];

      let message = `🛑 **EC2 Stop Operation**\n\n`;

      if (stoppedIds.length > 0) {
        message += `✅ **Successfully stopping:**\n`;
        for (const id of stoppedIds) {
          message += `  • \`${id}\`\n`;
        }
      }

      if (errors.length > 0) {
        message += `\n❌ **Failed:**\n`;
        for (const err of errors) {
          message += `  • \`${err.instanceId}\`: ${err.error}\n`;
        }
      }

      return {
        success: errors.length === 0,
        message,
        data: { stoppedInstances: stoppedIds, errors },
      };
    } catch (error) {
      this.logger.error('Error stopping EC2 instances', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to stop EC2 instances. Please check your permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleStartEC2(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    try {
      const instanceIds = params.instanceIds as string[];
      const region = params.region as string | undefined;

      if (!instanceIds || instanceIds.length === 0) {
        return {
          success: false,
          message: '❌ Please specify at least one instance ID to start.',
          error: 'MISSING_INSTANCE_IDS',
        };
      }

      const result = await this.ec2Service.startInstances(
        connection,
        instanceIds,
        region,
      );

      const startedIds = result.map((r) => r.instanceId);
      const errors: Array<{ instanceId: string; error: string }> = [];

      let message = `🚀 **EC2 Start Operation**\n\n`;

      if (startedIds.length > 0) {
        message += `✅ **Successfully starting:**\n`;
        for (const id of startedIds) {
          message += `  • \`${id}\`\n`;
        }
      }

      if (errors.length > 0) {
        message += `\n❌ **Failed:**\n`;
        for (const err of errors) {
          message += `  • \`${err.instanceId}\`: ${err.error}\n`;
        }
      }

      return {
        success: errors.length === 0,
        message,
        data: { startedInstances: startedIds, errors },
      };
    } catch (error) {
      this.logger.error('Error starting EC2 instances', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to start EC2 instances. Please check your permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleIdleInstances(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    try {
      const cpuThreshold = (params.cpuThreshold as number) || 5;
      const days = (params.days as number) || 7;
      const region = params.region as string | undefined;

      const recommendations = await this.ec2Service.findIdleInstances(
        connection,
        cpuThreshold,
        region,
      );

      const message = this.formatIdleRecommendationsForChat(recommendations);

      return {
        success: true,
        message,
        data: { recommendations },
      };
    } catch (error) {
      this.logger.error('Error finding idle EC2 instances', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message: '❌ Failed to analyze EC2 instances for idle resources.',
        error: error instanceof Error ? error.message : 'Unknown error',
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
      this.logger.error('Error listing S3 buckets', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to list S3 buckets. Please check your connection and permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
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
    try {
      const region = params.region as string | undefined;
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
      this.logger.error('Error listing RDS instances', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to list RDS instances. Please check your connection and permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
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
    try {
      const region = params.region as string | undefined;
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
      this.logger.error('Error listing Lambda functions', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to list Lambda functions. Please check your connection and permissions.',
        error: error instanceof Error ? error.message : 'Unknown error',
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
    try {
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
          const idleInstances = await this.ec2Service.findIdleInstances(
            connection,
            5,
          );

          if (idleInstances.length > 0) {
            message += `🖥️ **EC2 Instances**\n`;
            message += `  • Found **${idleInstances.length}** idle or low-utilization instances\n\n`;

            for (const rec of idleInstances.slice(0, 3)) {
              recommendations.push({
                service: 'EC2',
                recommendation: `Stop or downsize ${rec.instanceId} (avg CPU: ${rec.averageCpuUtilization.toFixed(1)}%)`,
                savings: undefined,
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
        const anomalies = await this.costExplorerService.getAnomalies(
          connection,
          this.getDateDaysAgo(30),
          new Date().toISOString().split('T')[0],
        );

        if (anomalies.length > 0) {
          const totalImpact = anomalies.reduce(
            (sum: number, a: any) => sum + a.impact.totalImpact,
            0,
          );
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
    } catch (error) {
      this.logger.error('Error getting AWS optimization recommendations', {
        error,
        connectionId: connection._id,
      });
      return {
        success: false,
        message:
          '❌ Failed to analyze AWS resources for optimization opportunities.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleStatus(
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    let message = `☁️ **AWS Connection Status**\n\n`;

    message += `🔗 **Connection:** ${connection.name}\n`;
    message += `📊 **Status:** ${connection.status === 'active' ? '✅ Active' : '❌ Inactive'}\n`;
    message += `🌍 **Account ID:** ${connection.awsAccountId}\n`;
    message += `🏷️ **Environment:** ${connection.environment}\n`;
    message += `🔐 **Permission Mode:** ${connection.permissionMode}\n\n`;

    message += `📋 **Enabled Services:**\n`;
    for (const service of connection.allowedServices) {
      message += `  • ${service.service.toUpperCase()} (${service.actions.length} permissions)\n`;
    }

    message += `\n🌎 **Allowed Regions:** ${connection.allowedRegions?.join(', ') ?? 'all'}\n`;

    if (connection.lastUsedAt) {
      message += `\n⏰ **Last Used:** ${new Date(connection.lastUsedAt).toLocaleString()}`;
    }

    return {
      success: true,
      message,
      data: {
        connectionName: connection.name,
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
  // CREATE HANDLERS (Require Approval)
  // ============================================================================

  private async handleCreateEC2(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const instanceName = params.instanceName as string;

    // Validate required parameters
    if (!instanceName) {
      return {
        success: false,
        message:
          '❌ Instance name is required. Please provide an instance name (e.g., "my-web-server").',
        error: 'MISSING_INSTANCE_NAME',
      };
    }

    try {
      // Build configuration with defaults
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

      // Generate creation plan using resource creation plan generator
      const userId = connection.userId?.toString() ?? '';
      const connectionId = connection._id?.toString() ?? '';
      const plan = await this.resourceCreationPlanGenerator.generateEC2Plan(
        userId,
        connectionId,
        config as any,
      );

      // Generate approval token
      const approvalToken = this.generateApprovalToken(
        plan,
        connection.userId?.toString() ?? '',
      );

      // Format plan for user approval
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

      // Generate creation plan using resource creation plan generator
      const userId = connection.userId?.toString() ?? '';
      const connectionId = connection._id?.toString() ?? '';
      const plan = await this.resourceCreationPlanGenerator.generateRDSPlan(
        userId,
        connectionId,
        config,
      );

      const approvalToken = this.generateApprovalToken(
        plan,
        connection.userId?.toString() ?? '',
      );

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
      message += `⏱️ **Estimated Duration:** ${Math.ceil(plan.estimatedDuration / 60)} minutes\n\n`;
      message += `⚠️ **Warnings:**\n`;
      for (const warning of plan.warnings) {
        message += `  • ${warning}\n`;
      }
      message += `\n✅ **Ready to create?** Reply with "approve" to proceed or "cancel" to abort.`;

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

      // Generate creation plan using resource creation plan generator
      const userId = connection.userId?.toString() ?? '';
      const connectionId = connection._id?.toString() ?? '';
      const plan = await this.resourceCreationPlanGenerator.generateLambdaPlan(
        userId,
        connectionId,
        config as any,
      );

      const approvalToken = this.generateApprovalToken(
        plan,
        connection.userId?.toString() ?? '',
      );

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
        message: `❌ Failed to generate Lambda creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

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
      const config = {
        tableName,
        partitionKeyName,
        partitionKeyType: (params.partitionKeyType as 'S' | 'N' | 'B') ?? 'S',
        sortKeyName: params.sortKeyName as string | undefined,
        sortKeyType: (params.sortKeyType as 'S' | 'N' | 'B') ?? 'S',
        billingMode:
          (params.billingMode as 'PAY_PER_REQUEST' | 'PROVISIONED') ??
          'PAY_PER_REQUEST',
        region:
          (params.region as string) ??
          connection.allowedRegions?.[0] ??
          'us-east-1',
        tags: params.tags as Record<string, string> | undefined,
        attributeDefinitions: [
          {
            attributeName: partitionKeyName,
            attributeType: (params.partitionKeyType as 'S' | 'N' | 'B') ?? 'S',
          },
          ...(params.sortKeyName
            ? [
                {
                  attributeName: params.sortKeyName as string,
                  attributeType: (params.sortKeyType as 'S' | 'N' | 'B') ?? 'S',
                },
              ]
            : []),
        ],
        keySchema: [
          { attributeName: partitionKeyName, keyType: 'HASH' as const },
          ...(params.sortKeyName
            ? [
                {
                  attributeName: params.sortKeyName as string,
                  keyType: 'RANGE' as const,
                },
              ]
            : []),
        ],
      };

      // Generate creation plan using resource creation plan generator
      const userId = connection.userId?.toString() ?? '';
      const connectionId = connection._id?.toString() ?? '';
      const plan =
        await this.resourceCreationPlanGenerator.generateDynamoDBPlan(
          userId,
          connectionId,
          config as any,
        );

      const approvalToken = this.generateApprovalToken(
        plan,
        connection.userId?.toString() ?? '',
      );

      let message = `📋 **DynamoDB Table Creation Plan**\n\n`;
      message += `📊 **Table Details:**\n`;
      message += `  • Name: ${config.tableName}\n`;
      message += `  • Partition Key: ${config.partitionKeyName} (${config.partitionKeyType})\n`;
      if (config.sortKeyName) {
        message += `  • Sort Key: ${config.sortKeyName} (${config.sortKeyType})\n`;
      }
      message += `  • Billing Mode: ${config.billingMode}\n`;
      message += `  • Region: ${config.region}\n\n`;
      message += `💰 **Cost Estimate:**\n`;
      message += `  • Monthly: $${plan.costEstimate.monthly.toFixed(2)}\n`;
      message += `  • Free Tier Eligible: ✅ Yes (25GB storage free)\n\n`;
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
        message: `❌ Failed to generate DynamoDB creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

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

      // Generate creation plan using resource creation plan generator
      const userId = connection.userId?.toString() ?? '';
      const connectionId = connection._id?.toString() ?? '';
      const plan = await this.resourceCreationPlanGenerator.generateECSPlan(
        userId,
        connectionId,
        config as any,
      );

      const approvalToken = this.generateApprovalToken(
        plan,
        connection.userId?.toString() ?? '',
      );

      let message = `📋 **ECS Cluster Creation Plan**\n\n`;
      message += `🐳 **Cluster Details:**\n`;
      message += `  • Name: ${config.clusterName}\n`;
      message += `  • Region: ${config.region}\n`;
      message += `  • Container Insights: ${config.enableContainerInsights ? '✅ Enabled' : '❌ Disabled'}\n`;
      message += `  • Capacity Providers: Fargate, Fargate Spot\n\n`;
      message += `💰 **Cost Estimate:**\n`;
      message += `  • Cluster: Free (pay only for running tasks)\n`;
      message += `  • Free Tier Eligible: ✅ Yes\n\n`;
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
        message: `❌ Failed to generate ECS creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private async handleCreateS3(
    params: Record<string, unknown>,
    connection: AWSConnectionDocument,
  ): Promise<AWSChatResponse> {
    const bucketName = params.bucketName as string;

    if (!bucketName) {
      return {
        success: false,
        message: '❌ Bucket name is required to create an S3 bucket.',
        error: 'MISSING_BUCKET_NAME',
      };
    }

    try {
      const region = (params.region as string) || undefined;
      // Create S3 bucket using S3 service
      const bucket = await this.s3Service.createBucket(
        connection,
        bucketName,
        region,
      );

      return {
        success: true,
        message: `✅ **S3 Bucket Created Successfully**\n\n📦 **${bucket.name}**\n📍 Region: ${bucket.region || 'us-east-1'}\n🕐 Created: ${new Date().toLocaleString()}`,
        data: { bucket },
      };
    } catch (error) {
      this.logger.error('Error creating S3 bucket', {
        error,
        connectionId: connection._id,
      });
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to create S3 bucket: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute an approved resource creation
   */
  private async executeApprovedCreation(
    approvalToken: string,
    connection: AWSConnectionDocument,
    plan: any,
  ): Promise<AWSChatResponse> {
    try {
      let result: any;
      let message = '';

      switch (plan.resourceType) {
        case 'ec2': {
          const ec2Results = await this.ec2Service.createInstance(connection, {
            imageId:
              plan.steps[plan.steps.length - 1].parameters.imageId ||
              'ami-0c55b159cbfafe1f0',
            instanceType:
              plan.steps[plan.steps.length - 1].parameters.instanceType ||
              't3.micro',
            region: plan.steps[plan.steps.length - 1].parameters.region,
            tags: [
              {
                key: 'Name',
                value: plan.resourceName,
              },
            ],
          });
          result = ec2Results[0];
          message = `✅ **EC2 Instance Created Successfully**\n\n🖥️ **${result?.instanceId}**\nState: ${result?.state}\n\n⏱️ Instance is starting up. It may take a few moments to be fully ready.`;
          break;
        }

        case 'rds':
          result = await this.rdsService.createInstance(connection, {
            dbInstanceIdentifier: plan.resourceName,
            engine: plan.steps[plan.steps.length - 1].parameters.engine,
            dbInstanceClass:
              plan.steps[plan.steps.length - 1].parameters.dbInstanceClass,
            masterUsername:
              plan.steps[plan.steps.length - 1].parameters.masterUsername ||
              'admin',
            masterUserPassword:
              plan.steps[plan.steps.length - 1].parameters.masterUserPassword ||
              randomUUID().replace(/-/g, '').slice(0, 20),
            allocatedStorage:
              plan.steps[plan.steps.length - 1].parameters.allocatedStorage,
            region: plan.steps[plan.steps.length - 1].parameters.region,
          });
          message = `✅ **RDS Database Created Successfully**\n\n🗄️ **${result.dbInstanceIdentifier}**\nStatus: ${result.status}\n\n⚠️ **Save your master password securely** — it was set during creation and cannot be retrieved later.\n\n⏱️ Database is initializing. This typically takes 5-10 minutes.`;
          break;

        case 'lambda':
          // Minimal valid ZIP (empty index.js) for Lambda placeholder
          const minimalZipBase64 =
            'UEsDBBQACAAIAAAAIQAAAAAAAAAAAAAAAAAKABwAaW5kZXguanNVVAkAA0xYbFzMWGxcdXgLAAEE6AMAAAToAwAAUEsBAh4AFAAAAAgAAAAhAAAAAAAAAAAAAAAAAAoAGAAAAAAAAAAAAAAAdAAAAABpbmRleC5qc1VUBQADTFhsXHV4CwABBOgDAAAE6AMAAA==';
          result = await this.lambdaService.createFunction(connection, {
            functionName: plan.resourceName,
            runtime: plan.steps[plan.steps.length - 1].parameters.runtime,
            handler: plan.steps[plan.steps.length - 1].parameters.handler,
            code: minimalZipBase64,
            memorySize: plan.steps[plan.steps.length - 1].parameters.memorySize,
            timeout: plan.steps[plan.steps.length - 1].parameters.timeout,
            region: plan.steps[plan.steps.length - 1].parameters.region,
          });
          message = `✅ **Lambda Function Created Successfully**\n\n⚡ **${result.functionName}**\nARN: ${result.functionArn}\n\n🚀 Function is ready to use!`;
          break;

        case 'dynamodb':
          result = await this.dynamoDbService.createTable(connection, {
            tableName: plan.resourceName,
            partitionKeyName:
              plan.steps[plan.steps.length - 1].parameters.keySchema[0]
                .attributeName,
            region: plan.steps[plan.steps.length - 1].parameters.region,
          });
          message = `✅ **DynamoDB Table Created Successfully**\n\n📊 **${result.tableName}**\nARN: ${result.tableArn}\nStatus: ${result.status}\n\n🚀 Table is ready to use!`;
          break;

        case 'ecs':
          result = await this.ecsService.createCluster(connection, {
            clusterName: plan.resourceName,
            region: plan.steps[plan.steps.length - 1].parameters.region,
          });
          message = `✅ **ECS Cluster Created Successfully**\n\n🐳 **${result.clusterName}**\nARN: ${result.clusterArn}\nStatus: ${result.status}\n\n🚀 Cluster is ready! You can now add services and tasks.`;
          break;

        case 's3':
          result = await this.s3Service.createBucket(
            connection,
            plan.resourceName,
            plan.steps[plan.steps.length - 1].parameters.region,
          );
          message = `✅ **S3 Bucket Created Successfully**\n\n📦 **${result.name}**\nRegion: ${result.region}\nEncryption: AES256\nVersioning: Enabled\nPublic Access: Blocked\n\n🚀 Bucket is ready to use!`;
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
}
