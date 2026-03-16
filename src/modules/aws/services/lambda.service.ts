import { Injectable } from '@nestjs/common';
import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  CreateFunctionCommand,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import {
  IAMClient,
  GetRoleCommand,
  CreateRoleCommand,
  AttachRolePolicyCommand,
} from '@aws-sdk/client-iam';
import { LoggerService } from '../../../common/logger/logger.service';
import { StsCredentialService } from './sts-credential.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import { AwsPricingService } from './aws-pricing.service';
import { AWSConnectionDocument } from '@/schemas/integration/aws-connection.schema';

export interface LambdaFunction {
  functionName: string;
  functionArn: string;
  runtime: string;
  handler: string;
  memorySize: number;
  timeout: number;
  lastModified: string;
  version: string;
  environment?: Record<string, string>;
  vpcConfig?: {
    vpcId: string;
    subnetIds: string[];
    securityGroupIds: string[];
  };
}

@Injectable()
export class LambdaService {
  constructor(
    private readonly stsCredentialService: StsCredentialService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
    private readonly logger: LoggerService,
    private readonly awsPricingService: AwsPricingService,
  ) {}

  /**
   * Get Lambda client for a connection
   */
  private async getClient(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<LambdaClient> {
    const credentials = await this.stsCredentialService.assumeRole(connection);

    return new LambdaClient({
      region: region || connection.allowedRegions?.[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * Get IAM client for a connection
   */
  private async getIamClient(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<IAMClient> {
    const credentials = await this.stsCredentialService.assumeRole(connection);

    return new IAMClient({
      region: region || connection.allowedRegions?.[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * Get or create Lambda execution role
   */
  private async getExecutionRoleArn(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<string> {
    const iamClient = await this.getIamClient(connection, region);
    const roleName = `cost-katana-lambda-execution-${connection.userId.toString().slice(-8)}`;

    try {
      // Try to get existing role
      const getRoleCommand = new GetRoleCommand({
        RoleName: roleName,
      });
      const existingRole = await iamClient.send(getRoleCommand);
      if (!existingRole.Role?.Arn) {
        throw new Error('Failed to get role ARN');
      }
      return existingRole.Role.Arn;
    } catch (error: any) {
      // Role doesn't exist, create it
      if (error.name === 'NoSuchEntity') {
        try {
          const assumeRolePolicyDocument = {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: {
                  Service: 'lambda.amazonaws.com',
                },
                Action: 'sts:AssumeRole',
              },
            ],
          };

          const createRoleCommand = new CreateRoleCommand({
            RoleName: roleName,
            AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicyDocument),
            Description: 'Execution role for Cost Katana Lambda functions',
          });

          const newRole = await iamClient.send(createRoleCommand);

          // Attach basic execution policy
          const attachPolicyCommand = new AttachRolePolicyCommand({
            RoleName: roleName,
            PolicyArn:
              'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          });

          await iamClient.send(attachPolicyCommand);

          this.logger.log('Created Lambda execution role', {
            connectionId: connection._id.toString(),
            roleName,
            roleArn: newRole.Role?.Arn,
          });

          return newRole.Role!.Arn!;
        } catch (createError) {
          this.logger.error('Failed to create Lambda execution role', {
            connectionId: connection._id.toString(),
            roleName,
            error:
              createError instanceof Error
                ? createError.message
                : String(createError),
          });
          throw new Error(
            `Failed to create Lambda execution role: ${createError instanceof Error ? createError.message : String(createError)}`,
          );
        }
      } else {
        this.logger.error('Failed to get Lambda execution role', {
          connectionId: connection._id.toString(),
          roleName,
          error: error.message,
        });
        throw error;
      }
    }
  }

  /**
   * List Lambda functions
   */
  async listFunctions(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<LambdaFunction[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'ListFunctions', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new ListFunctionsCommand({
      MaxItems: 50,
    });

    const response = await client.send(command);

    const functions: LambdaFunction[] = (response.Functions || []).map(
      (func) => ({
        functionName: func.FunctionName || '',
        functionArn: func.FunctionArn || '',
        runtime: func.Runtime || '',
        handler: func.Handler || '',
        memorySize: func.MemorySize || 128,
        timeout: func.Timeout || 3,
        lastModified: func.LastModified || '',
        version: func.Version || '$LATEST',
        environment: func.Environment?.Variables,
        vpcConfig: func.VpcConfig
          ? {
              vpcId: func.VpcConfig.VpcId || '',
              subnetIds: func.VpcConfig.SubnetIds || [],
              securityGroupIds: func.VpcConfig.SecurityGroupIds || [],
            }
          : undefined,
      }),
    );

    this.logger.log('Lambda functions listed', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      functionCount: functions.length,
    });

    return functions;
  }

  /**
   * Get Lambda function details
   */
  async getFunction(
    connection: AWSConnectionDocument,
    functionName: string,
    region?: string,
  ): Promise<LambdaFunction | null> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'GetFunction', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new GetFunctionCommand({
      FunctionName: functionName,
    });

    const response = await client.send(command);

    if (!response.Configuration) {
      return null;
    }

    const config = response.Configuration;

    return {
      functionName: config.FunctionName || '',
      functionArn: config.FunctionArn || '',
      runtime: config.Runtime || '',
      handler: config.Handler || '',
      memorySize: config.MemorySize || 128,
      timeout: config.Timeout || 3,
      lastModified: config.LastModified || '',
      version: config.Version || '$LATEST',
      environment: config.Environment?.Variables,
      vpcConfig: config.VpcConfig
        ? {
            vpcId: config.VpcConfig.VpcId || '',
            subnetIds: config.VpcConfig.SubnetIds || [],
            securityGroupIds: config.VpcConfig.SecurityGroupIds || [],
          }
        : undefined,
    };
  }

  /**
   * Create Lambda function
   */
  async createFunction(
    connection: AWSConnectionDocument,
    params: {
      functionName: string;
      runtime: string;
      handler: string;
      code: string; // Base64 encoded ZIP
      memorySize?: number;
      timeout?: number;
      environment?: Record<string, string>;
      region?: string;
    },
  ): Promise<{ functionName: string; functionArn: string; version: string }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'CreateFunction', region: params.region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, params.region);
    const executionRoleArn = await this.getExecutionRoleArn(
      connection,
      params.region,
    );

    const command = new CreateFunctionCommand({
      FunctionName: params.functionName,
      Runtime: params.runtime as any,
      Handler: params.handler,
      Code: {
        ZipFile: Buffer.from(params.code, 'base64'),
      },
      Role: executionRoleArn,
      MemorySize: params.memorySize || 128,
      Timeout: params.timeout || 30,
      Environment: params.environment
        ? {
            Variables: params.environment,
          }
        : undefined,
      // Security defaults
      Publish: false, // Don't publish version
    });

    const response = await client.send(command);

    const result = {
      functionName: response.FunctionName || params.functionName,
      functionArn: response.FunctionArn || '',
      version: response.Version || '$LATEST',
    };

    this.logger.log('Lambda function created', {
      connectionId: connection._id.toString(),
      region: params.region || 'default',
      functionName: params.functionName,
      runtime: params.runtime,
      memorySize: params.memorySize || 128,
    });

    return result;
  }

  /**
   * Update Lambda function configuration
   */
  async updateFunctionConfiguration(
    connection: AWSConnectionDocument,
    functionName: string,
    updates: {
      memorySize?: number;
      timeout?: number;
      environment?: Record<string, string>;
    },
    region?: string,
  ): Promise<{ functionName: string; lastModified: string }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'UpdateFunctionConfiguration', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      MemorySize: updates.memorySize,
      Timeout: updates.timeout,
      Environment: updates.environment
        ? {
            Variables: updates.environment,
          }
        : undefined,
    });

    const response = await client.send(command);

    const result = {
      functionName: response.FunctionName || functionName,
      lastModified: response.LastModified || '',
    };

    this.logger.log('Lambda function configuration updated', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      functionName,
      updates,
    });

    return result;
  }

  /**
   * Format functions for chat response
   */
  formatFunctionsForChat(functions: LambdaFunction[]): string {
    if (functions.length === 0) {
      return 'No Lambda functions found.';
    }

    let message = `⚡ **Lambda Functions (${functions.length})**\n\n`;

    for (const func of functions.slice(0, 10)) {
      // Limit to first 10
      message += `🔧 **${func.functionName}**\n`;
      message += `   Runtime: ${func.runtime}\n`;
      message += `   Memory: ${func.memorySize} MB\n`;
      message += `   Timeout: ${func.timeout}s\n`;

      if (func.lastModified) {
        const modifiedDate = new Date(func.lastModified);
        message += `   Modified: ${modifiedDate.toLocaleDateString()}\n`;
      }

      if (func.vpcConfig) {
        message += `   VPC: Configured\n`;
      }

      message += '\n';
    }

    if (functions.length > 10) {
      message += `*... and ${functions.length - 10} more functions*`;
    }

    return message;
  }

  /**
   * Get Lambda runtime options
   */
  getSupportedRuntimes(): Array<{ runtime: string; description: string }> {
    return [
      { runtime: 'nodejs20.x', description: 'Node.js 20' },
      { runtime: 'nodejs18.x', description: 'Node.js 18' },
      { runtime: 'python3.12', description: 'Python 3.12' },
      { runtime: 'python3.11', description: 'Python 3.11' },
      { runtime: 'python3.10', description: 'Python 3.10' },
      { runtime: 'java21', description: 'Java 21' },
      { runtime: 'java17', description: 'Java 17' },
      { runtime: 'java11', description: 'Java 11' },
      { runtime: 'dotnet8', description: '.NET 8' },
      { runtime: 'dotnet6', description: '.NET 6' },
      { runtime: 'go1.x', description: 'Go 1.x' },
      { runtime: 'ruby3.3', description: 'Ruby 3.3' },
      { runtime: 'ruby3.2', description: 'Ruby 3.2' },
    ];
  }

  /**
   * Analyze Lambda functions for optimization opportunities
   */
  analyzeOptimizationOpportunities(functions: LambdaFunction[]): Array<{
    functionName: string;
    issue: string;
    recommendation: string;
    severity: 'low' | 'medium' | 'high';
  }> {
    const opportunities: Array<{
      functionName: string;
      issue: string;
      recommendation: string;
      severity: 'low' | 'medium' | 'high';
    }> = [];

    for (const func of functions) {
      // Memory size checks
      if (func.memorySize < 128) {
        opportunities.push({
          functionName: func.functionName,
          issue: `Low memory allocation (${func.memorySize} MB)`,
          recommendation:
            'Consider increasing memory to at least 128 MB for better performance',
          severity: 'low',
        });
      }

      if (func.memorySize > 3008) {
        opportunities.push({
          functionName: func.functionName,
          issue: `High memory allocation (${func.memorySize} MB)`,
          recommendation: 'Review if this much memory is necessary',
          severity: 'medium',
        });
      }

      // Timeout checks
      if (func.timeout > 900) {
        opportunities.push({
          functionName: func.functionName,
          issue: `Long timeout (${func.timeout}s)`,
          recommendation:
            'Consider optimizing code or breaking into smaller functions',
          severity: 'medium',
        });
      }

      // Runtime checks
      if (
        ['nodejs14.x', 'nodejs16.x', 'python3.8', 'python3.9'].includes(
          func.runtime,
        )
      ) {
        opportunities.push({
          functionName: func.functionName,
          issue: `Outdated runtime: ${func.runtime}`,
          recommendation: 'Upgrade to a newer supported runtime',
          severity: 'high',
        });
      }
    }

    return opportunities;
  }

  /**
   * Update Lambda function memory size
   */
  async updateMemory(
    connection: AWSConnectionDocument,
    functionName: string,
    memorySize: number,
    region?: string,
  ): Promise<LambdaFunction> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'UpdateFunctionConfiguration', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      MemorySize: memorySize,
    });

    const response = await client.send(command);

    const updatedFunction: LambdaFunction = {
      functionName: response.FunctionName || functionName,
      functionArn: response.FunctionArn || '',
      runtime: response.Runtime || '',
      handler: response.Handler || '',
      memorySize: response.MemorySize || memorySize,
      timeout: response.Timeout || 3,
      lastModified: response.LastModified || '',
      version: response.Version || '',
      environment: response.Environment?.Variables,
      vpcConfig: response.VpcConfig
        ? {
            vpcId: response.VpcConfig.VpcId || '',
            subnetIds: response.VpcConfig.SubnetIds || [],
            securityGroupIds: response.VpcConfig.SecurityGroupIds || [],
          }
        : undefined,
    };

    this.logger.log('Lambda function memory updated', {
      connectionId: connection._id.toString(),
      functionName,
      memorySize,
      region,
    });

    return updatedFunction;
  }

  /**
   * Update Lambda function timeout
   */
  async updateTimeout(
    connection: AWSConnectionDocument,
    functionName: string,
    timeout: number,
    region?: string,
  ): Promise<LambdaFunction> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'UpdateFunctionConfiguration', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Timeout: timeout,
    });

    const response = await client.send(command);

    const updatedFunction: LambdaFunction = {
      functionName: response.FunctionName || functionName,
      functionArn: response.FunctionArn || '',
      runtime: response.Runtime || '',
      handler: response.Handler || '',
      memorySize: response.MemorySize || 128,
      timeout: response.Timeout || timeout,
      lastModified: response.LastModified || '',
      version: response.Version || '',
      environment: response.Environment?.Variables,
      vpcConfig: response.VpcConfig
        ? {
            vpcId: response.VpcConfig.VpcId || '',
            subnetIds: response.VpcConfig.SubnetIds || [],
            securityGroupIds: response.VpcConfig.SecurityGroupIds || [],
          }
        : undefined,
    };

    this.logger.log('Lambda function timeout updated', {
      connectionId: connection._id.toString(),
      functionName,
      timeout,
      region,
    });

    return updatedFunction;
  }

  /**
   * Find over-provisioned Lambda functions
   */
  async findOverProvisionedFunctions(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<
    Array<{
      functionName: string;
      memorySize: number;
      averageUtilization?: number;
      recommendedMemory: number;
      estimatedMonthlySavings: number;
      reason: string;
    }>
  > {
    const functions = await this.listFunctions(connection, region);

    // In production, this would analyze CloudWatch metrics for memory utilization
    // For now, we'll use a simplified approach
    const overProvisioned: Array<{
      functionName: string;
      memorySize: number;
      averageUtilization?: number;
      recommendedMemory: number;
      estimatedMonthlySavings: number;
      reason: string;
    }> = [];

    for (const func of functions) {
      // Simple heuristic: functions with high memory but potentially low utilization
      if (func.memorySize >= 1024) {
        // Assume these might be over-provisioned
        const recommendedMemory = Math.max(128, func.memorySize / 2);
        const savings = await this.calculateMemorySavings(
          func.memorySize,
          recommendedMemory,
          region,
        );

        overProvisioned.push({
          functionName: func.functionName,
          memorySize: func.memorySize,
          recommendedMemory,
          estimatedMonthlySavings: savings,
          reason: 'High memory allocation - consider right-sizing',
        });
      }
    }

    this.logger.log('Over-provisioned Lambda functions identified', {
      connectionId: connection._id.toString(),
      totalFunctions: functions.length,
      overProvisionedCount: overProvisioned.length,
      region,
    });

    return overProvisioned;
  }

  /**
   * Find Lambda functions with high timeout settings
   */
  async findHighTimeoutFunctions(
    connection: AWSConnectionDocument,
    thresholdSeconds: number = 300, // 5 minutes
    region?: string,
  ): Promise<
    Array<{
      functionName: string;
      timeout: number;
      recommendedTimeout: number;
      reason: string;
      potentialIssues: string[];
    }>
  > {
    const functions = await this.listFunctions(connection, region);

    const highTimeoutFunctions: Array<{
      functionName: string;
      timeout: number;
      recommendedTimeout: number;
      reason: string;
      potentialIssues: string[];
    }> = [];

    for (const func of functions) {
      if (func.timeout >= thresholdSeconds) {
        const issues: string[] = [];

        if (func.timeout >= 900) {
          // 15 minutes
          issues.push('Maximum Lambda timeout reached');
        }

        if (func.runtime.startsWith('nodejs') && func.timeout > 300) {
          issues.push('Node.js functions rarely need timeouts over 5 minutes');
        }

        highTimeoutFunctions.push({
          functionName: func.functionName,
          timeout: func.timeout,
          recommendedTimeout: Math.min(300, func.timeout / 2), // Suggest halving
          reason: `Timeout of ${func.timeout}s is very high`,
          potentialIssues: issues,
        });
      }
    }

    this.logger.log('High timeout Lambda functions identified', {
      connectionId: connection._id.toString(),
      totalFunctions: functions.length,
      highTimeoutCount: highTimeoutFunctions.length,
      thresholdSeconds,
      region,
    });

    return highTimeoutFunctions;
  }

  /**
   * Calculate potential savings from memory optimization
   */
  private async calculateMemorySavings(
    currentMemory: number,
    recommendedMemory: number,
    region: string = 'us-east-1',
  ): Promise<number> {
    try {
      // Get pricing from AWS Pricing API
      const pricing = await this.awsPricingService.getLambdaPricing(region);

      if (pricing && pricing.pricePerGBSecond) {
        const costPerGBSecond = pricing.pricePerGBSecond;
        const averageDuration = 1000; // ms
        const dailyInvocations = 1000;

        const currentCost =
          (currentMemory / 1024) *
          (averageDuration / 1000) *
          costPerGBSecond *
          dailyInvocations;
        const recommendedCost =
          (recommendedMemory / 1024) *
          (averageDuration / 1000) *
          costPerGBSecond *
          dailyInvocations;

        return Math.round((currentCost - recommendedCost) * 30); // Monthly savings
      }
    } catch (error) {
      this.logger.warn(
        'Failed to get Lambda pricing for memory savings calculation',
        { error },
      );
    }

    // Fallback to hardcoded pricing
    const fallbackPricing =
      this.awsPricingService.getFallbackPricing('AWSLambda');
    const costPerGBSecond = fallbackPricing.pricePerGBSecond || 0.0000166667;
    const averageDuration = 1000; // ms
    const dailyInvocations = 1000;

    const currentCost =
      (currentMemory / 1024) *
      (averageDuration / 1000) *
      costPerGBSecond *
      dailyInvocations;
    const recommendedCost =
      (recommendedMemory / 1024) *
      (averageDuration / 1000) *
      costPerGBSecond *
      dailyInvocations;

    return Math.round((currentCost - recommendedCost) * 30); // Monthly savings
  }
}
