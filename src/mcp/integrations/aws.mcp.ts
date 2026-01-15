/**
 * AWS MCP Server
 * Full operations for AWS cost management and resource management
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter } from '../registry/tool-metadata';
import { awsChatHandlerService } from '../../services/aws/awsChatHandler.service';

export class AWSMCP extends BaseIntegrationMCP {
  constructor() {
    super('aws', '1.0.0');
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
          createParameter('timeframe', 'string', 'Time period (today, week, month, year, custom)', { default: 'month' }),
          createParameter('startDate', 'string', 'Start date for custom timeframe (YYYY-MM-DD)', { required: false }),
          createParameter('endDate', 'string', 'End date for custom timeframe (YYYY-MM-DD)', { required: false }),
          createParameter('granularity', 'string', 'Data granularity (DAILY, MONTHLY)', { default: 'MONTHLY', required: false }),
        ],
        { requiredScopes: ['costs:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'costs',
          params: {
            timeframe: params.timeframe,
            startDate: params.startDate,
            endDate: params.endDate,
            granularity: params.granularity,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
    );

    // Cost breakdown
    this.registerTool(
      createToolSchema(
        'aws_cost_breakdown',
        'aws',
        'Get AWS cost breakdown by service',
        'GET',
        [
          createParameter('timeframe', 'string', 'Time period (today, week, month, year, custom)', { default: 'month' }),
          createParameter('startDate', 'string', 'Start date for custom timeframe (YYYY-MM-DD)', { required: false }),
          createParameter('endDate', 'string', 'End date for custom timeframe (YYYY-MM-DD)', { required: false }),
          createParameter('groupBy', 'string', 'Group by SERVICE or REGION', { default: 'SERVICE', required: false }),
        ],
        { requiredScopes: ['costs:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'cost_breakdown',
          params: {
            timeframe: params.timeframe,
            startDate: params.startDate,
            endDate: params.endDate,
            groupBy: params.groupBy,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
    );

    // Cost forecast
    this.registerTool(
      createToolSchema(
        'aws_cost_forecast',
        'aws',
        'Get AWS cost forecast',
        'GET',
        [
          createParameter('months', 'number', 'Number of months to forecast', { default: 3 }),
        ],
        { requiredScopes: ['costs:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'cost_forecast',
          params: {
            months: params.months,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
    );

    // Cost anomalies
    this.registerTool(
      createToolSchema(
        'aws_cost_anomalies',
        'aws',
        'Detect AWS cost anomalies',
        'GET',
        [
          createParameter('days', 'number', 'Number of days to analyze', { default: 30 }),
        ],
        { requiredScopes: ['costs:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'cost_anomalies',
          params: {
            days: params.days,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
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
          createParameter('region', 'string', 'AWS region', { required: false }),
          createParameter('status', 'string', 'Instance status filter (running, stopped, etc)', { required: false }),
        ],
        { requiredScopes: ['ec2:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'list_ec2',
          params: {
            region: params.region,
            status: params.status,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
    );

    // Stop EC2 instance
    this.registerTool(
      createToolSchema(
        'aws_stop_ec2',
        'aws',
        'Stop EC2 instances',
        'POST',
        [
          createParameter('instanceIds', 'array', 'EC2 instance IDs to stop', { required: true }),
          createParameter('region', 'string', 'AWS region', { required: false }),
        ],
        { requiredScopes: ['ec2:write'], dangerous: true }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'stop_ec2',
          params: {
            instanceIds: params.instanceIds,
            region: params.region,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
    );

    // Start EC2 instance
    this.registerTool(
      createToolSchema(
        'aws_start_ec2',
        'aws',
        'Start EC2 instances',
        'POST',
        [
          createParameter('instanceIds', 'array', 'EC2 instance IDs to start', { required: true }),
          createParameter('region', 'string', 'AWS region', { required: false }),
        ],
        { requiredScopes: ['ec2:write'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'start_ec2',
          params: {
            instanceIds: params.instanceIds,
            region: params.region,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
    );

    // Find idle instances
    this.registerTool(
      createToolSchema(
        'aws_idle_instances',
        'aws',
        'Find idle or underutilized EC2 instances',
        'GET',
        [
          createParameter('region', 'string', 'AWS region', { required: false }),
          createParameter('threshold', 'number', 'CPU utilization threshold percentage', { default: 5, required: false }),
        ],
        { requiredScopes: ['ec2:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'idle_instances',
          params: {
            region: params.region,
            threshold: params.threshold,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
    );

    // ===== S3 OPERATIONS =====
    
    // List S3 buckets
    this.registerTool(
      createToolSchema(
        'aws_list_s3',
        'aws',
        'List S3 buckets',
        'GET',
        [],
        { requiredScopes: ['s3:read'] }
      ),
      async (_params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'list_s3',
          params: {},
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
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
          createParameter('region', 'string', 'AWS region', { required: false }),
        ],
        { requiredScopes: ['rds:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'list_rds',
          params: {
            region: params.region,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
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
          createParameter('region', 'string', 'AWS region', { required: false }),
        ],
        { requiredScopes: ['lambda:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'list_lambda',
          params: {
            region: params.region,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
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
          createParameter('category', 'string', 'Optimization category (cost, performance, security, all)', { default: 'all', required: false }),
        ],
        { requiredScopes: ['trustedadvisor:read'] }
      ),
      async (params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'optimize',
          params: {
            category: params.category,
          },
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
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
        { requiredScopes: [] }
      ),
      async (_params, context) => {
        const result = await awsChatHandlerService.processCommand({
          userId: context.userId,
          action: 'status',
          params: {},
        });

        if (!result.success) {
          throw new Error(result.error || result.message);
        }

        return result.data;
      }
    );
  }
}

/**
 * Initialize AWS MCP
 */
export function initializeAWSMCP(): void {
  const awsMCP = new AWSMCP();
  awsMCP.registerTools();
}
