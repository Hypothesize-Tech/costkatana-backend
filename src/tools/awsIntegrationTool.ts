/**
 * AWS Integration Tool for Agent System
 * 
 * This tool allows the AI agent to execute AWS operations like creating S3 buckets,
 * EC2 instances, RDS databases, Lambda functions, DynamoDB tables, and ECS clusters.
 */

import { Tool } from '@langchain/core/tools';
import { loggingService } from '../services/logging.service';
import { awsChatHandlerService } from '../services/aws/awsChatHandler.service';
import { AWSAction } from '../schemas/integrationTools.schema';

export interface AWSIntegrationInput {
  action: string;
  bucketName?: string;
  instanceName?: string;
  dbInstanceIdentifier?: string;
  functionName?: string;
  tableName?: string;
  clusterName?: string;
  region?: string;
  [key: string]: any;
}

export class AWSIntegrationTool extends Tool {
  name = 'aws_integration';
  description = `Execute AWS operations directly. Use this tool when the user wants to:
  - Create an S3 bucket (action: "create_s3", bucketName: string, region?: string)
  - List S3 buckets (action: "list_s3")
  - Create EC2 instance (action: "create_ec2", instanceName: string, instanceType?: string, region?: string)
  - List EC2 instances (action: "list_ec2", region?: string, state?: "running"|"stopped"|"all")
  - Stop/Start EC2 instances (action: "stop_ec2"|"start_ec2", instanceIds: string[], region?: string)
  - Create RDS database (action: "create_rds", dbInstanceIdentifier: string, engine: "mysql"|"postgres"|"mariadb"|"oracle"|"sqlserver", region?: string)
  - List RDS databases (action: "list_rds", region?: string)
  - Create Lambda function (action: "create_lambda", functionName: string, runtime?: string, region?: string)
  - List Lambda functions (action: "list_lambda", region?: string)
  - Create DynamoDB table (action: "create_dynamodb", tableName: string, partitionKeyName: string, region?: string)
  - Create ECS cluster (action: "create_ecs", clusterName: string, region?: string)
  - Get AWS costs and cost forecasts
  - Optimize AWS infrastructure

Input should be a JSON string with action and required parameters.
Example: {"action": "create_s3", "bucketName": "my-test-bucket", "region": "us-east-1"}`;

  private userId: string = 'unknown';

  constructor(userId?: string) {
    super();
    if (userId) {
      this.userId = userId;
    }
  }

  /**
   * Set userId - called before invocation
   */
  public setUserId(userId: string): void {
    this.userId = userId;
  }

  async _call(input: string, runManager?: any): Promise<string> {
    try {
      // Try to extract userId from run manager or context
      const contextUserId = runManager?.metadata?.userId || runManager?.tags?.includes('user:') 
        ? runManager.tags.find((t: string) => t.startsWith('user:'))?.split(':')[1]
        : this.userId;

      loggingService.info('🔧 AWS Integration Tool called', {
        component: 'AWSIntegrationTool',
        userId: contextUserId,
        input: input.substring(0, 200),
      });

      // Parse input
      let params: AWSIntegrationInput;
      try {
        params = JSON.parse(input);
      } catch (error) {
        // If input is not JSON, try to extract action and parameters from natural language
        params = this.parseNaturalLanguage(input);
      }

      if (!params.action) {
        return JSON.stringify({
          success: false,
          error: 'Missing required parameter: action',
          hint: 'Please specify an action like create_s3, list_ec2, etc.',
        });
      }

      // Validate action
      const validActions = [
        'create_s3', 'list_s3',
        'create_ec2', 'list_ec2', 'stop_ec2', 'start_ec2', 'idle_instances',
        'create_rds', 'list_rds',
        'create_lambda', 'list_lambda',
        'create_dynamodb',
        'create_ecs',
        'costs', 'cost_breakdown', 'cost_forecast', 'cost_anomalies',
        'optimize', 'status'
      ];

      if (!validActions.includes(params.action)) {
        return JSON.stringify({
          success: false,
          error: `Invalid action: ${params.action}`,
          validActions,
        });
      }

      // Execute AWS command
      const result = await awsChatHandlerService.processCommand({
        userId: contextUserId,
        action: params.action as AWSAction,
        params,
      });

      loggingService.info('✅ AWS Integration Tool completed', {
        component: 'AWSIntegrationTool',
        action: params.action,
        success: result.success,
      });

      return JSON.stringify({
        success: result.success,
        message: result.message,
        data: result.data,
        requiresApproval: result.requiresApproval,
        approvalToken: result.approvalToken,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('❌ AWS Integration Tool failed', {
        component: 'AWSIntegrationTool',
        error: errorMessage,
      });

      return JSON.stringify({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Parse natural language input to extract action and parameters
   */
  private parseNaturalLanguage(input: string): AWSIntegrationInput {
    const lowerInput = input.toLowerCase();
    const params: AWSIntegrationInput = { action: '' };

    // S3 Bucket creation
    if (lowerInput.includes('create') && (lowerInput.includes('bucket') || lowerInput.includes('s3'))) {
      params.action = 'create_s3';
      
      // Extract bucket name - look for patterns like "called X", "named X", "bucket X"
      const bucketNameMatch = input.match(/(?:bucket\s+called|called|named)\s+["']([^"']+)["']|(?:bucket\s+)["']?([a-zA-Z0-9\-]+)["']?(?:\s|$)/i);
      if (bucketNameMatch) {
        params.bucketName = bucketNameMatch[1] || bucketNameMatch[2];
      }
    }
    // List S3 buckets
    else if ((lowerInput.includes('list') || lowerInput.includes('show')) && (lowerInput.includes('bucket') || lowerInput.includes('s3'))) {
      params.action = 'list_s3';
    }
    // EC2 instance creation
    else if (lowerInput.includes('create') && (lowerInput.includes('instance') || lowerInput.includes('ec2') || lowerInput.includes('server'))) {
      params.action = 'create_ec2';
      
      const instanceNameMatch = input.match(/(?:instance|server|called|named)\s+["']?(\S+)["']?/i);
      if (instanceNameMatch) {
        params.instanceName = instanceNameMatch[1].replace(/['"]/g, '');
      }
    }
    // RDS database creation
    else if (lowerInput.includes('create') && (lowerInput.includes('database') || lowerInput.includes('rds') || lowerInput.includes('db'))) {
      params.action = 'create_rds';
      
      const dbNameMatch = input.match(/(?:database|db|called|named)\s+["']?(\S+)["']?/i);
      if (dbNameMatch) {
        params.dbInstanceIdentifier = dbNameMatch[1].replace(/['"]/g, '');
      }
      
      // Detect engine
      if (lowerInput.includes('postgres')) params.engine = 'postgres';
      else if (lowerInput.includes('mysql')) params.engine = 'mysql';
      else if (lowerInput.includes('mariadb')) params.engine = 'mariadb';
    }
    // Lambda function creation
    else if (lowerInput.includes('create') && (lowerInput.includes('lambda') || lowerInput.includes('function'))) {
      params.action = 'create_lambda';
      
      const functionNameMatch = input.match(/(?:function|lambda|called|named)\s+["']?(\S+)["']?/i);
      if (functionNameMatch) {
        params.functionName = functionNameMatch[1].replace(/['"]/g, '');
      }
    }
    // DynamoDB table creation
    else if (lowerInput.includes('create') && (lowerInput.includes('dynamodb') || lowerInput.includes('table'))) {
      params.action = 'create_dynamodb';
      
      const tableNameMatch = input.match(/(?:table|called|named)\s+["']?(\S+)["']?/i);
      if (tableNameMatch) {
        params.tableName = tableNameMatch[1].replace(/['"]/g, '');
      }
    }
    // ECS cluster creation
    else if (lowerInput.includes('create') && (lowerInput.includes('ecs') || lowerInput.includes('cluster'))) {
      params.action = 'create_ecs';
      
      const clusterNameMatch = input.match(/(?:cluster|called|named)\s+["']?(\S+)["']?/i);
      if (clusterNameMatch) {
        params.clusterName = clusterNameMatch[1].replace(/['"]/g, '');
      }
    }
    // Cost queries
    else if (lowerInput.includes('cost') || lowerInput.includes('spending') || lowerInput.includes('bill')) {
      if (lowerInput.includes('forecast') || lowerInput.includes('predict')) {
        params.action = 'cost_forecast';
      } else if (lowerInput.includes('breakdown') || lowerInput.includes('detail')) {
        params.action = 'cost_breakdown';
      } else if (lowerInput.includes('anomal')) {
        params.action = 'cost_anomalies';
      } else {
        params.action = 'costs';
      }
    }
    // List operations
    else if (lowerInput.includes('list') || lowerInput.includes('show')) {
      if (lowerInput.includes('ec2') || lowerInput.includes('instance')) {
        params.action = 'list_ec2';
      } else if (lowerInput.includes('lambda') || lowerInput.includes('function')) {
        params.action = 'list_lambda';
      } else if (lowerInput.includes('rds') || lowerInput.includes('database')) {
        params.action = 'list_rds';
      }
    }

    return params;
  }
}
