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
import { dynamodbServiceProvider } from './providers/dynamodb.service';
import { ecsServiceProvider } from './providers/ecs.service';
import { resourceCreationPlanGeneratorService } from './resourceCreationPlanGenerator.service';
import { AWSAction } from '../../schemas/integrationTools.schema';

export interface AWSChatRequest {
  userId: string;
  action: AWSAction;
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

class AWSChatHandlerService {
  private static instance: AWSChatHandlerService;
  private approvalTokens = new Map<string, { plan: any; userId: string; expiresAt: Date }>();

  private constructor() {
    // Clean up expired tokens every 5 minutes
    setInterval(() => this.cleanupExpiredTokens(), 5 * 60 * 1000);
  }

  public static getInstance(): AWSChatHandlerService {
    if (!AWSChatHandlerService.instance) {
      AWSChatHandlerService.instance = new AWSChatHandlerService();
    }
    return AWSChatHandlerService.instance;
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

      // Handle approval execution
      if (request.approvalToken && (request.action as string === 'approve' || request.action as string === 'execute')) {
        const plan = this.validateApprovalToken(request.approvalToken, request.userId);
        if (!plan) {
          return {
            success: false,
            message: '❌ Approval token is invalid or expired. Please generate a new creation plan.',
            error: 'INVALID_APPROVAL_TOKEN',
          };
        }
        return this.executeApprovedCreation(request.approvalToken, connection, plan);
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

  private async handleCreateS3(
    params: Record<string, unknown>,
    connection: IAWSConnection
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
      const bucket = await s3ServiceProvider.createBucket(connection, bucketName, region);

      return {
        success: true,
        message: `✅ **S3 Bucket Created Successfully**\n\n📦 **${bucket.name}**\n📍 Region: ${bucket.region || 'us-east-1'}\n🕐 Created: ${new Date().toLocaleString()}`,
        data: { bucket },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to create S3 bucket: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // EC2 CREATE HANDLER
  // ============================================================================

  private async handleCreateEC2(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const instanceName = params.instanceName as string;

    // Validate required parameters
    if (!instanceName) {
      return {
        success: false,
        message: '❌ Instance name is required. Please provide an instance name (e.g., "my-web-server").',
        error: 'MISSING_INSTANCE_NAME',
      };
    }

    try {
      // Build configuration with defaults
      const config = {
        instanceName,
        instanceType: (params.instanceType as string) ?? 't3.micro',
        region: (params.region as string) ?? connection.allowedRegions[0] ?? 'us-east-1',
        vpcId: params.vpcId as string | undefined,
        subnetId: params.subnetId as string | undefined,
        securityGroupId: params.securityGroupId as string | undefined,
        keyPairName: params.keyPairName as string | undefined,
        tags: params.tags as Record<string, string> | undefined,
      };

      // Generate creation plan
      const plan = await resourceCreationPlanGeneratorService.generateEC2Plan(connection, config);

      // Generate approval token
      const approvalToken = this.generateApprovalToken(plan, connection.userId?.toString() ?? '');

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate EC2 creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // RDS CREATE HANDLER
  // ============================================================================

  private async handleCreateRDS(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const dbInstanceIdentifier = params.dbInstanceIdentifier as string;

    if (!dbInstanceIdentifier) {
      return {
        success: false,
        message: '❌ Database instance identifier is required. Please provide a name (e.g., "my-database").',
        error: 'MISSING_DB_IDENTIFIER',
      };
    }

    try {
      const config = {
        dbInstanceIdentifier,
        engine: (params.engine as 'mysql' | 'postgres' | 'mariadb' | 'oracle' | 'sqlserver') ?? 'postgres',
        dbInstanceClass: (params.dbInstanceClass as string) ?? 'db.t3.micro',
        allocatedStorage: (params.allocatedStorage as number) ?? 20,
        region: (params.region as string) ?? connection.allowedRegions[0] ?? 'us-east-1',
        tags: params.tags as Record<string, string> | undefined,
      };

      const plan = await resourceCreationPlanGeneratorService.generateRDSPlan(connection, config);
      const approvalToken = this.generateApprovalToken(plan, connection.userId?.toString() ?? '');

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate RDS creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // LAMBDA CREATE HANDLER
  // ============================================================================

  private async handleCreateLambda(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const functionName = params.functionName as string;

    if (!functionName) {
      return {
        success: false,
        message: '❌ Function name is required. Please provide a name (e.g., "my-function").',
        error: 'MISSING_FUNCTION_NAME',
      };
    }

    try {
      const config = {
        functionName,
        runtime: (params.runtime as 'nodejs18.x' | 'nodejs20.x' | 'python3.11' | 'python3.12' | 'java17' | 'go1.x') ?? 'nodejs20.x',
        handler: (params.handler as string) ?? 'index.handler',
        memorySize: (params.memorySize as number) ?? 128,
        timeout: (params.timeout as number) ?? 3,
        region: (params.region as string) ?? connection.allowedRegions[0] ?? 'us-east-1',
        tags: params.tags as Record<string, string> | undefined,
      };

      const plan = await resourceCreationPlanGeneratorService.generateLambdaPlan(connection, config);
      const approvalToken = this.generateApprovalToken(plan, connection.userId?.toString() ?? '');

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate Lambda creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // DYNAMODB CREATE HANDLER
  // ============================================================================

  private async handleCreateDynamoDB(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const tableName = params.tableName as string;
    const partitionKeyName = params.partitionKeyName as string;

    if (!tableName || !partitionKeyName) {
      return {
        success: false,
        message: '❌ Table name and partition key name are required. Example: tableName="users", partitionKeyName="userId".',
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
        billingMode: (params.billingMode as 'PAY_PER_REQUEST' | 'PROVISIONED') ?? 'PAY_PER_REQUEST',
        region: (params.region as string) ?? connection.allowedRegions[0] ?? 'us-east-1',
        tags: params.tags as Record<string, string> | undefined,
        attributeDefinitions: [
          { attributeName: partitionKeyName, attributeType: (params.partitionKeyType as 'S' | 'N' | 'B') ?? 'S' },
          ...(params.sortKeyName ? [{ attributeName: params.sortKeyName as string, attributeType: (params.sortKeyType as 'S' | 'N' | 'B') ?? 'S' }] : []),
        ],
        keySchema: [
          { attributeName: partitionKeyName, keyType: 'HASH' as const },
          ...(params.sortKeyName ? [{ attributeName: params.sortKeyName as string, keyType: 'RANGE' as const }] : []),
        ],
      };

      const plan = await resourceCreationPlanGeneratorService.generateDynamoDBPlan(connection, config);
      const approvalToken = this.generateApprovalToken(plan, connection.userId?.toString() ?? '');

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate DynamoDB creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // ECS CREATE HANDLER
  // ============================================================================

  private async handleCreateECS(
    params: Record<string, unknown>,
    connection: IAWSConnection
  ): Promise<AWSChatResponse> {
    const clusterName = params.clusterName as string;

    if (!clusterName) {
      return {
        success: false,
        message: '❌ Cluster name is required. Please provide a name (e.g., "my-cluster").',
        error: 'MISSING_CLUSTER_NAME',
      };
    }

    try {
      const config = {
        clusterName,
        region: (params.region as string) ?? connection.allowedRegions[0] ?? 'us-east-1',
        enableContainerInsights: (params.enableContainerInsights as boolean) ?? true,
        tags: params.tags as Record<string, string> | undefined,
      };

      const plan = await resourceCreationPlanGeneratorService.generateECSPlan(connection, config);
      const approvalToken = this.generateApprovalToken(plan, connection.userId?.toString() ?? '');

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to generate ECS creation plan: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute an approved resource creation
   */
  private async executeApprovedCreation(
    approvalToken: string,
    connection: IAWSConnection,
    plan: any
  ): Promise<AWSChatResponse> {
    try {
      let result: any;
      let message = '';

      switch (plan.resourceType) {
        case 'ec2':
          result = await ec2ServiceProvider.createInstance(connection, {
            instanceName: plan.resourceName,
            instanceType: plan.steps[plan.steps.length - 1].parameters.instanceType,
            region: plan.steps[plan.steps.length - 1].parameters.region,
            vpcId: plan.steps[plan.steps.length - 1].parameters.vpcId,
            subnetId: plan.steps[plan.steps.length - 1].parameters.subnetId,
            securityGroupId: plan.steps[plan.steps.length - 1].parameters.securityGroupId,
            keyPairName: plan.steps[plan.steps.length - 1].parameters.keyPairName,
          });
          message = `✅ **EC2 Instance Created Successfully**\n\n🖥️ **${result.instanceId}**\nState: ${result.state}\nPrivate IP: ${result.privateIpAddress}\nPublic IP: ${result.publicIpAddress ?? 'Pending'}\n\n💾 **Key Pair:** ${result.keyPairName}\n\n⏱️ Instance is starting up. It may take a few moments to be fully ready.`;
          break;

        case 'rds':
          result = await rdsServiceProvider.createDBInstance(connection, {
            dbInstanceIdentifier: plan.resourceName,
            engine: plan.steps[plan.steps.length - 1].parameters.engine,
            dbInstanceClass: plan.steps[plan.steps.length - 1].parameters.dbInstanceClass,
            allocatedStorage: plan.steps[plan.steps.length - 1].parameters.allocatedStorage,
            region: plan.steps[plan.steps.length - 1].parameters.region,
          });
          message = `✅ **RDS Database Created Successfully**\n\n🗄️ **${result.dbInstanceIdentifier}**\nEndpoint: ${result.endpoint}\nPort: ${result.port}\nMaster User: ${result.masterUsername}\n\n🔐 **Password:** ${result.masterUserPassword}\n\n⚠️ **Save this password securely!** You won't be able to retrieve it later.\n\n⏱️ Database is initializing. This typically takes 5-10 minutes.`;
          break;

        case 'lambda':
          result = await lambdaServiceProvider.createFunction(connection, {
            functionName: plan.resourceName,
            runtime: plan.steps[plan.steps.length - 1].parameters.runtime,
            handler: plan.steps[plan.steps.length - 1].parameters.handler,
            memorySize: plan.steps[plan.steps.length - 1].parameters.memorySize,
            timeout: plan.steps[plan.steps.length - 1].parameters.timeout,
            region: plan.steps[plan.steps.length - 1].parameters.region,
          });
          message = `✅ **Lambda Function Created Successfully**\n\n⚡ **${result.functionName}**\nARN: ${result.functionArn}\nRuntime: ${result.runtime}\nHandler: ${result.handler}\n\n🚀 Function is ready to use!`;
          break;

        case 'dynamodb':
          result = await dynamodbServiceProvider.createTable(connection, {
            tableName: plan.resourceName,
            partitionKeyName: plan.steps[plan.steps.length - 1].parameters.keySchema[0].attributeName,
            region: plan.steps[plan.steps.length - 1].parameters.region,
          });
          message = `✅ **DynamoDB Table Created Successfully**\n\n📊 **${result.tableName}**\nARN: ${result.tableArn}\nStatus: ${result.status}\n\n🚀 Table is ready to use!`;
          break;

        case 'ecs':
          result = await ecsServiceProvider.createCluster(connection, {
            clusterName: plan.resourceName,
            region: plan.steps[plan.steps.length - 1].parameters.region,
          });
          message = `✅ **ECS Cluster Created Successfully**\n\n🐳 **${result.clusterName}**\nARN: ${result.clusterArn}\nStatus: ${result.status}\n\n🚀 Cluster is ready! You can now add services and tasks.`;
          break;

        case 's3':
          result = await s3ServiceProvider.createBucket(connection, plan.resourceName, plan.steps[plan.steps.length - 1].parameters.region);
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to execute approved creation', {
        component: 'AWSChatHandler',
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
