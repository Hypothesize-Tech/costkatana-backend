/**
 * AWS MCP Service
 * Full operations for AWS cost management and resource management
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseIntegrationService } from './base-integration.service';
import { ToolRegistryService } from '../tool-registry.service';
import { TokenManagerService } from '../token-manager.service';
import { LoggerService } from '../../../../common/logger/logger.service';
import { createToolSchema, createParameter } from '../../utils/tool-validation';
import { VercelConnection } from '@/schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '@/schemas/integration/github-connection.schema';
import { GoogleConnection } from '@/schemas/integration/google-connection.schema';
import { MongoDBConnection } from '@/schemas/integration/mongodb-connection.schema';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '@/schemas/integration/aws-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';
import { CostExplorerService } from '../../../aws/services/cost-explorer.service';
import { Ec2Service } from '../../../aws/services/ec2.service';
import { S3Service } from '../../../aws/services/s3.service';
import { RdsService } from '../../../aws/services/rds.service';
import { LambdaService } from '../../../aws/services/lambda.service';
import { StsCredentialService } from '../../../aws/services/sts-credential.service';

@Injectable()
export class AwsMcpService
  extends BaseIntegrationService
  implements OnModuleInit
{
  protected integration: 'aws' = 'aws';
  protected version = '1.0.0';

  constructor(
    logger: LoggerService,
    toolRegistry: ToolRegistryService,
    tokenManager: TokenManagerService,
    @InjectModel(VercelConnection.name)
    vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(GitHubConnection.name)
    githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(GoogleConnection.name)
    googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(MongoDBConnection.name)
    mongodbConnectionModel: Model<MongoDBConnection>,
    @InjectModel(AWSConnection.name) awsConnectionModel: Model<AWSConnection>,
    @InjectModel(Integration.name) integrationModel: Model<Integration>,
    private readonly costExplorerService: CostExplorerService,
    private readonly ec2Service: Ec2Service,
    private readonly s3Service: S3Service,
    private readonly rdsService: RdsService,
    private readonly lambdaService: LambdaService,
    private readonly stsCredentialService: StsCredentialService,
  ) {
    super(
      logger,
      toolRegistry,
      tokenManager,
      vercelConnectionModel,
      githubConnectionModel,
      googleConnectionModel,
      mongodbConnectionModel,
      awsConnectionModel,
      integrationModel,
    );
  }

  onModuleInit() {
    this.registerTools();
  }

  registerTools(): void {
    // ===== COST OPERATIONS =====

    // Get costs
    this.registerTool(
      createToolSchema(
        'aws_get_costs',
        'aws',
        'Get AWS cost and usage data',
        'GET',
        [
          createParameter(
            'timeframe',
            'string',
            'Time period (today, week, month, year, custom)',
            { default: 'month' },
          ),
          createParameter(
            'startDate',
            'string',
            'Start date for custom timeframe (YYYY-MM-DD)',
            { required: false },
          ),
          createParameter(
            'endDate',
            'string',
            'End date for custom timeframe (YYYY-MM-DD)',
            { required: false },
          ),
          createParameter(
            'granularity',
            'string',
            'Data granularity (DAILY, MONTHLY)',
            { default: 'MONTHLY', required: false },
          ),
        ],
        { requiredScopes: ['costs:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const endDate =
            params.endDate || new Date().toISOString().split('T')[0];
          const startDate =
            params.startDate ||
            this.getDateDaysAgo(
              params.timeframe === 'today'
                ? 1
                : params.timeframe === 'week'
                  ? 7
                  : params.timeframe === 'month'
                    ? 30
                    : 90,
            );

          const costData = await this.costExplorerService.getCostAndUsage(
            connection,
            startDate,
            endDate,
            params.granularity || 'DAILY',
          );

          const totalCost = costData.reduce((sum, data) => sum + data.total, 0);
          const currency = costData[0]?.currency || 'USD';

          let message = `💰 **AWS Cost Report**\n\n`;
          message += `📊 **Timeframe:** ${startDate} to ${endDate}\n`;
          message += `💵 **Total Cost:** $${totalCost.toFixed(2)} ${currency}\n\n`;

          // Show daily breakdown for recent periods
          if (params.granularity === 'DAILY' && costData.length <= 10) {
            message += `📈 **Daily Breakdown:**\n`;
            for (const data of costData.slice(-7)) {
              message += `  ${data.timePeriod.start}: $${data.total.toFixed(2)}\n`;
            }
          }

          return {
            message,
            timeframe: params.timeframe,
            totalCost,
            currency,
            dataPoints: costData.length,
          };
        } catch (error) {
          this.logger.error('Failed to get AWS costs', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to retrieve AWS costs: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // Cost breakdown
    this.registerTool(
      createToolSchema(
        'aws_cost_breakdown',
        'aws',
        'Get AWS cost breakdown by service',
        'GET',
        [
          createParameter(
            'timeframe',
            'string',
            'Time period (today, week, month, year, custom)',
            { default: 'month' },
          ),
          createParameter(
            'startDate',
            'string',
            'Start date for custom timeframe (YYYY-MM-DD)',
            { required: false },
          ),
          createParameter(
            'endDate',
            'string',
            'End date for custom timeframe (YYYY-MM-DD)',
            { required: false },
          ),
          createParameter('groupBy', 'string', 'Group by SERVICE or REGION', {
            default: 'SERVICE',
            required: false,
          }),
        ],
        { requiredScopes: ['costs:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const endDate =
            params.endDate || new Date().toISOString().split('T')[0];
          const startDate =
            params.startDate ||
            this.getDateDaysAgo(
              params.timeframe === 'today'
                ? 1
                : params.timeframe === 'week'
                  ? 7
                  : params.timeframe === 'month'
                    ? 30
                    : 90,
            );

          const breakdown =
            await this.costExplorerService.getCostBreakdownByService(
              connection,
              startDate,
              endDate,
            );

          const totalCost = breakdown.reduce((sum, b) => sum + b.amount, 0);
          const currency = breakdown[0]?.currency || 'USD';

          let message = `📊 **AWS Cost Breakdown by Service**\n\n`;
          message += `📅 **Timeframe:** ${startDate} to ${endDate}\n`;
          message += `💵 **Total Cost:** $${totalCost.toFixed(2)} ${currency}\n\n`;

          message += `🏆 **Top Services:**\n`;
          for (const service of breakdown.slice(0, 10)) {
            const percentage =
              totalCost > 0 ? (service.amount / totalCost) * 100 : 0;
            message += `  ${service.service}: $${service.amount.toFixed(2)} (${percentage.toFixed(1)}%)\n`;
          }

          return {
            message,
            timeframe: params.timeframe,
            totalCost,
            currency,
            topServices: breakdown.slice(0, 5),
          };
        } catch (error) {
          this.logger.error('Failed to get AWS cost breakdown', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to retrieve AWS cost breakdown: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // Cost forecast
    this.registerTool(
      createToolSchema(
        'aws_cost_forecast',
        'aws',
        'Get AWS cost forecast',
        'GET',
        [
          createParameter('months', 'number', 'Number of months to forecast', {
            default: 3,
          }),
        ],
        { requiredScopes: ['costs:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const endDate = new Date();
          endDate.setMonth(endDate.getMonth() + (params.months || 3));

          const startDate = new Date().toISOString().split('T')[0];
          const forecastEndDate = endDate.toISOString().split('T')[0];

          const forecasts = await this.costExplorerService.getCostForecast(
            connection,
            startDate,
            forecastEndDate,
            'MONTHLY',
          );

          let message = `🔮 **AWS Cost Forecast**\n\n`;
          message += `📅 **Forecast Period:** Next ${params.months || 3} months\n\n`;

          if (forecasts.length > 0) {
            message += `💰 **Projected Costs:**\n`;
            for (const forecast of forecasts.slice(0, 3)) {
              message += `  ${forecast.timePeriod.start} - ${forecast.timePeriod.end}: $${forecast.meanValue.toFixed(2)} ${forecast.currency}\n`;
            }
          }

          return {
            message,
            months: params.months,
            forecastData: forecasts,
          };
        } catch (error) {
          this.logger.error('Failed to get AWS cost forecast', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to get cost forecast: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // Cost anomalies
    this.registerTool(
      createToolSchema(
        'aws_cost_anomalies',
        'aws',
        'Detect AWS cost anomalies',
        'GET',
        [
          createParameter('days', 'number', 'Number of days to analyze', {
            default: 30,
          }),
        ],
        { requiredScopes: ['costs:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const endDate = new Date().toISOString().split('T')[0];
          const startDate = this.getDateDaysAgo(params.days || 30);

          const anomalies = await this.costExplorerService.getAnomalies(
            connection,
            startDate,
            endDate,
          );

          let message = `🚨 **AWS Cost Anomalies**\n\n`;
          message += `📅 **Analysis Period:** Last ${params.days || 30} days\n\n`;

          if (anomalies.length === 0) {
            message += `✅ No cost anomalies detected!\n`;
          } else {
            message += `⚠️ **Found ${anomalies.length} anomalies:**\n\n`;
            for (const anomaly of anomalies.slice(0, 5)) {
              message += `💸 **$${anomaly.impact.totalImpact.toFixed(2)}** impact\n`;
              if (anomaly.rootCauses?.[0]?.service) {
                message += `   Service: ${anomaly.rootCauses[0].service}\n`;
              }
              message += '\n';
            }
          }

          return {
            message,
            days: params.days,
            anomalyCount: anomalies.length,
            totalImpact: anomalies.reduce(
              (sum, a) => sum + a.impact.totalImpact,
              0,
            ),
          };
        } catch (error) {
          this.logger.error('Failed to detect AWS cost anomalies', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to detect cost anomalies: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // ===== EC2 OPERATIONS =====

    // List EC2 instances
    this.registerTool(
      createToolSchema(
        'aws_list_ec2',
        'aws',
        'List EC2 instances',
        'GET',
        [
          createParameter('region', 'string', 'AWS region', {
            required: false,
          }),
          createParameter(
            'status',
            'string',
            'Instance status filter (running, stopped, etc)',
            { required: false },
          ),
        ],
        { requiredScopes: ['ec2:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const filters =
            params.status && params.status !== 'all'
              ? [{ Name: 'instance-state-name', Values: [params.status] }]
              : undefined;

          const instances = await this.ec2Service.listInstances(
            connection,
            filters,
            params.region,
          );

          const message = this.ec2Service.formatInstancesForChat(instances);

          return {
            message,
            region: params.region || 'default',
            instanceCount: instances.length,
            statusFilter: params.status,
          };
        } catch (error) {
          this.logger.error('Failed to list EC2 instances', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to list EC2 instances: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // Stop EC2 instance
    this.registerTool(
      createToolSchema(
        'aws_stop_ec2',
        'aws',
        'Stop EC2 instances',
        'POST',
        [
          createParameter('instanceIds', 'array', 'EC2 instance IDs to stop', {
            required: true,
          }),
          createParameter('region', 'string', 'AWS region', {
            required: false,
          }),
        ],
        { requiredScopes: ['ec2:write'], dangerous: true },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const results = await this.ec2Service.stopInstances(
            connection,
            params.instanceIds,
            params.region,
          );

          const message = `⏹️ **EC2 Instances Stopped**\n\n✅ Successfully stopped ${results.length} instance(s)`;

          return {
            message,
            instanceIds: params.instanceIds,
            region: params.region,
            results,
          };
        } catch (error) {
          this.logger.error('Failed to stop EC2 instances', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to stop EC2 instances: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // Start EC2 instance
    this.registerTool(
      createToolSchema(
        'aws_start_ec2',
        'aws',
        'Start EC2 instances',
        'POST',
        [
          createParameter('instanceIds', 'array', 'EC2 instance IDs to start', {
            required: true,
          }),
          createParameter('region', 'string', 'AWS region', {
            required: false,
          }),
        ],
        { requiredScopes: ['ec2:write'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const results = await this.ec2Service.startInstances(
            connection,
            params.instanceIds,
            params.region,
          );

          const message = `▶️ **EC2 Instances Started**\n\n✅ Successfully started ${results.length} instance(s)`;

          return {
            message,
            instanceIds: params.instanceIds,
            region: params.region,
            results,
          };
        } catch (error) {
          this.logger.error('Failed to start EC2 instances', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to start EC2 instances: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // Find idle instances
    this.registerTool(
      createToolSchema(
        'aws_idle_instances',
        'aws',
        'Find idle or underutilized EC2 instances',
        'GET',
        [
          createParameter('region', 'string', 'AWS region', {
            required: false,
          }),
          createParameter(
            'threshold',
            'number',
            'CPU utilization threshold percentage',
            { default: 5, required: false },
          ),
        ],
        { requiredScopes: ['ec2:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const idleInstances = await this.ec2Service.findIdleInstances(
            connection,
            params.threshold || 5,
            params.region,
          );

          const idleCount = idleInstances.filter((i) => i.isIdle).length;

          let message = `🔍 **EC2 Idle Instance Analysis**\n\n`;
          message += `📊 **CPU Threshold:** < ${params.threshold || 5}%\n`;
          message += `⚠️ **Idle Instances:** ${idleCount} of ${idleInstances.length}\n\n`;

          if (idleCount > 0) {
            message += `💡 **Recommendations:**\n`;
            message += `   Consider stopping idle instances to reduce costs\n`;
          }

          return {
            message,
            region: params.region || 'default',
            threshold: params.threshold || 5,
            idleCount,
            totalInstances: idleInstances.length,
          };
        } catch (error) {
          this.logger.error('Failed to analyze idle EC2 instances', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to analyze idle instances: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // ===== S3 OPERATIONS =====

    // List S3 buckets
    this.registerTool(
      createToolSchema('aws_list_s3', 'aws', 'List S3 buckets', 'GET', [], {
        requiredScopes: ['s3:read'],
      }),
      async (_params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const buckets = await this.s3Service.listBuckets(connection);

          const message = this.s3Service.formatBucketsForChat(buckets);

          return {
            message,
            bucketCount: buckets.length,
          };
        } catch (error) {
          this.logger.error('Failed to list S3 buckets', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to list S3 buckets: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // ===== RDS OPERATIONS =====

    // List RDS instances
    this.registerTool(
      createToolSchema(
        'aws_list_rds',
        'aws',
        'List RDS database instances',
        'GET',
        [
          createParameter('region', 'string', 'AWS region', {
            required: false,
          }),
        ],
        { requiredScopes: ['rds:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const databases = await this.rdsService.listInstances(
            connection,
            params.region,
          );

          const message = this.rdsService.formatDatabasesForChat(databases);

          return {
            message,
            region: params.region || 'default',
            databaseCount: databases.length,
          };
        } catch (error) {
          this.logger.error('Failed to list RDS instances', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to list RDS instances: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // ===== LAMBDA OPERATIONS =====

    // List Lambda functions
    this.registerTool(
      createToolSchema(
        'aws_list_lambda',
        'aws',
        'List Lambda functions',
        'GET',
        [
          createParameter('region', 'string', 'AWS region', {
            required: false,
          }),
        ],
        { requiredScopes: ['lambda:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const functions = await this.lambdaService.listFunctions(
            connection,
            params.region,
          );

          const message = this.lambdaService.formatFunctionsForChat(functions);

          return {
            message,
            region: params.region || 'default',
            functionCount: functions.length,
          };
        } catch (error) {
          this.logger.error('Failed to list Lambda functions', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to list Lambda functions: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // ===== OPTIMIZATION OPERATIONS =====

    // Get optimization recommendations
    this.registerTool(
      createToolSchema(
        'aws_optimize',
        'aws',
        'Get AWS optimization recommendations',
        'GET',
        [
          createParameter(
            'category',
            'string',
            'Optimization category (cost, performance, security, all)',
            { default: 'all', required: false },
          ),
        ],
        { requiredScopes: ['trustedadvisor:read'] },
      ),
      async (params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const insights =
            await this.costExplorerService.getOptimizationInsights(connection);

          // Filter by category if specified
          const filteredInsights =
            params.category && params.category !== 'all'
              ? insights.filter(
                  (i) =>
                    i.priority === params.category ||
                    params.category === 'cost',
                )
              : insights;

          let message = `🎯 **AWS Optimization Recommendations**\n\n`;
          message += `📊 **Category:** ${params.category || 'all'}\n\n`;

          if (filteredInsights.length === 0) {
            message += `✅ No optimization opportunities found!\n`;
          } else {
            for (const insight of filteredInsights.slice(0, 5)) {
              const emoji =
                insight.priority === 'high'
                  ? '🔴'
                  : insight.priority === 'medium'
                    ? '🟡'
                    : '🟢';
              message += `${emoji} **${insight.service}**\n`;
              message += `   ${insight.insight}\n`;
              if (insight.potentialSavings) {
                message += `   💰 Potential savings: $${insight.potentialSavings.toFixed(0)}\n`;
              }
              message += '\n';
            }
          }

          return {
            message,
            category: params.category,
            recommendationCount: filteredInsights.length,
            totalPotentialSavings: filteredInsights.reduce(
              (sum, i) => sum + (i.potentialSavings || 0),
              0,
            ),
          };
        } catch (error) {
          this.logger.error('Failed to get AWS optimization insights', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to get optimization recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );

    // ===== CONNECTION STATUS =====

    // Get connection status
    this.registerTool(
      createToolSchema(
        'aws_status',
        'aws',
        'Get AWS connection status and account info',
        'GET',
        [],
        { requiredScopes: [] },
      ),
      async (_params, context) => {
        try {
          const connection = await this.getConnection(context.userId);

          const isConnected =
            await this.stsCredentialService.verifyConnection(connection);

          let message = `🔗 **AWS Connection Status**\n\n`;

          if (isConnected) {
            message += `✅ **Status:** Connected\n`;
            message += `🏢 **Account ID:** ${connection.awsAccountId || 'Unknown'}\n`;
            message += `🌍 **Region:** ${connection.allowedRegions?.[0] || 'Not specified'}\n`;
            message += `🔐 **Permission Mode:** ${connection.permissionMode}\n`;

            if (connection.lastUsedAt) {
              message += `🕒 **Last Used:** ${connection.lastUsedAt.toLocaleString()}\n`;
            }
          } else {
            message += `❌ **Status:** Disconnected\n`;
            if (connection.health?.lastError) {
              message += `⚠️ **Last Error:** ${connection.health.lastError}\n`;
            }
          }

          return {
            message,
            connected: isConnected,
            accountId: connection.awsAccountId,
            region: connection.allowedRegions?.[0],
            permissionMode: connection.permissionMode,
          };
        } catch (error) {
          this.logger.error('Failed to check AWS connection status', {
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            message: `❌ Failed to check connection status: ${error instanceof Error ? error.message : 'Unknown error'}`,
            status: 'error',
          };
        }
      },
    );
  }

  /**
   * Get AWS connection for user
   */
  private async getConnection(userId: string): Promise<AWSConnectionDocument> {
    const connection = await this.awsConnectionModel
      .findOne({
        userId,
        status: 'active',
      })
      .exec();

    if (!connection) {
      throw new Error('No active AWS connection found for user');
    }

    return connection;
  }

  /**
   * Get date string for days ago
   */
  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }
}
