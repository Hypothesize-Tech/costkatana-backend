import { LambdaClient, ListFunctionsCommand, GetFunctionCommand, UpdateFunctionConfigurationCommand, ListTagsCommand, CreateFunctionCommand } from '@aws-sdk/client-lambda';
import { IAMClient, GetRoleCommand, CreateRoleCommand, AttachRolePolicyCommand } from '@aws-sdk/client-iam';
import { loggingService } from '../../logging.service';
import { stsCredentialService } from '../stsCredential.service';
import { permissionBoundaryService } from '../permissionBoundary.service';
import { IAWSConnection } from '../../../models/AWSConnection';

/**
 * Lambda Service Provider - Lambda Operations
 * 
 * Allowed Operations:
 * - Read: ListFunctions, GetFunction, GetFunctionConfiguration
 * - Write: UpdateFunctionConfiguration (memory/timeout only)
 * - Blocked: DeleteFunction
 */

export interface LambdaFunction {
  functionName: string;
  functionArn: string;
  runtime: string;
  memorySize: number;
  timeout: number;
  codeSize: number;
  lastModified?: string;
  handler: string;
  description?: string;
  tags: Record<string, string>;
}

class LambdaServiceProvider {
  private static instance: LambdaServiceProvider;
  
  private constructor() {}
  
  public static getInstance(): LambdaServiceProvider {
    if (!LambdaServiceProvider.instance) {
      LambdaServiceProvider.instance = new LambdaServiceProvider();
    }
    return LambdaServiceProvider.instance;
  }
  
  private async getClient(connection: IAWSConnection, region?: string): Promise<LambdaClient> {
    const credentials = await stsCredentialService.assumeRole(connection);
    
    return new LambdaClient({
      region: region || connection.allowedRegions[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }
  
  /**
   * List Lambda functions
   */
  public async listFunctions(
    connection: IAWSConnection,
    region?: string
  ): Promise<LambdaFunction[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'ListFunctions', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const functions: LambdaFunction[] = [];
    let marker: string | undefined;
    
    do {
      const command = new ListFunctionsCommand({
        Marker: marker,
        MaxItems: 50,
      });
      
      const response = await client.send(command);
      
      for (const fn of response.Functions || []) {
        functions.push({
          functionName: fn.FunctionName || '',
          functionArn: fn.FunctionArn || '',
          runtime: fn.Runtime || '',
          memorySize: fn.MemorySize || 128,
          timeout: fn.Timeout || 3,
          codeSize: fn.CodeSize || 0,
          lastModified: fn.LastModified,
          handler: fn.Handler || '',
          description: fn.Description,
          tags: {},
        });
      }
      
      marker = response.NextMarker;
    } while (marker);
    
    loggingService.info('Lambda functions listed', {
      component: 'LambdaServiceProvider',
      operation: 'listFunctions',
      connectionId: connection._id.toString(),
      functionCount: functions.length,
      region,
    });
    
    return functions;
  }
  
  /**
   * Get function details
   */
  public async getFunction(
    connection: IAWSConnection,
    functionName: string,
    region?: string
  ): Promise<LambdaFunction | null> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'GetFunction', resources: [functionName], region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    try {
      const command = new GetFunctionCommand({
        FunctionName: functionName,
      });
      
      const response = await client.send(command);
      const config = response.Configuration;
      
      if (!config) {
        return null;
      }
      
      // Get tags
      let tags: Record<string, string> = {};
      try {
        const tagsCommand = new ListTagsCommand({
          Resource: config.FunctionArn,
        });
        const tagsResponse = await client.send(tagsCommand);
        tags = tagsResponse.Tags || {};
      } catch {
        // Tags might not be accessible
      }
      
      return {
        functionName: config.FunctionName || '',
        functionArn: config.FunctionArn || '',
        runtime: config.Runtime || '',
        memorySize: config.MemorySize || 128,
        timeout: config.Timeout || 3,
        codeSize: config.CodeSize || 0,
        lastModified: config.LastModified,
        handler: config.Handler || '',
        description: config.Description,
        tags,
      };
    } catch (error) {
      loggingService.error('Failed to get Lambda function', {
        component: 'LambdaServiceProvider',
        operation: 'getFunction',
        functionName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  
  /**
   * Update function memory
   */
  public async updateMemory(
    connection: IAWSConnection,
    functionName: string,
    memorySize: number,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'UpdateFunctionConfiguration', resources: [functionName], region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    // Validate memory size (must be between 128 and 10240, in 64MB increments)
    if (memorySize < 128 || memorySize > 10240 || memorySize % 64 !== 0) {
      return {
        success: false,
        error: 'Memory must be between 128 and 10240 MB in 64 MB increments',
      };
    }
    
    const client = await this.getClient(connection, region);
    
    try {
      const command = new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        MemorySize: memorySize,
      });
      
      await client.send(command);
      
      loggingService.info('Lambda function memory updated', {
        component: 'LambdaServiceProvider',
        operation: 'updateMemory',
        connectionId: connection._id.toString(),
        functionName,
        memorySize,
        region,
      });
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Update function timeout
   */
  public async updateTimeout(
    connection: IAWSConnection,
    functionName: string,
    timeout: number,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'UpdateFunctionConfiguration', resources: [functionName], region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    // Validate timeout (must be between 1 and 900 seconds)
    if (timeout < 1 || timeout > 900) {
      return {
        success: false,
        error: 'Timeout must be between 1 and 900 seconds',
      };
    }
    
    const client = await this.getClient(connection, region);
    
    try {
      const command = new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Timeout: timeout,
      });
      
      await client.send(command);
      
      loggingService.info('Lambda function timeout updated', {
        component: 'LambdaServiceProvider',
        operation: 'updateTimeout',
        connectionId: connection._id.toString(),
        functionName,
        timeout,
        region,
      });
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Find over-provisioned functions (memory too high for code size)
   */
  public async findOverProvisionedFunctions(
    connection: IAWSConnection,
    region?: string
  ): Promise<Array<LambdaFunction & { recommendation: string; potentialSavings: number }>> {
    const functions = await this.listFunctions(connection, region);
    
    const overProvisioned: Array<LambdaFunction & { recommendation: string; potentialSavings: number }> = [];
    
    for (const fn of functions) {
      // Simple heuristic: if memory > 1024 MB and code size < 10 MB, might be over-provisioned
      if (fn.memorySize > 1024 && fn.codeSize < 10 * 1024 * 1024) {
        const recommendedMemory = Math.max(256, Math.ceil(fn.codeSize / (1024 * 1024)) * 128);
        const potentialSavings = ((fn.memorySize - recommendedMemory) / fn.memorySize) * 100;
        
        overProvisioned.push({
          ...fn,
          recommendation: `Consider reducing memory from ${fn.memorySize}MB to ${recommendedMemory}MB`,
          potentialSavings,
        });
      }
    }
    
    return overProvisioned;
  }
  
  /**
   * Find functions with high timeout (potential optimization)
   */
  public async findHighTimeoutFunctions(
    connection: IAWSConnection,
    thresholdSeconds: number = 60,
    region?: string
  ): Promise<LambdaFunction[]> {
    const functions = await this.listFunctions(connection, region);
    return functions.filter(fn => fn.timeout > thresholdSeconds);
  }

  /**
   * Create Lambda function with IAM role and default code
   */
  public async createFunction(
    connection: IAWSConnection,
    config: {
      functionName: string;
      runtime?: string;
      handler?: string;
      memorySize?: number;
      timeout?: number;
      region?: string;
      tags?: Record<string, string>;
    }
  ): Promise<{ functionName: string; functionArn: string; handler: string; runtime: string }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'CreateFunction', region: config.region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const region = config.region ?? connection.allowedRegions[0] ?? 'us-east-1';
    const lambdaClient = await this.getClient(connection, region);
    const runtime = config.runtime ?? 'nodejs20.x';
    const handler = config.handler ?? 'index.handler';
    const memorySize = config.memorySize ?? 128;
    const timeout = config.timeout ?? 3;

    try {
      // Get or create Lambda execution role
      const roleArn = await this.getOrCreateLambdaExecutionRole(connection);

      // Create default "Hello World" code
      const code = this.createDefaultLambdaCode(runtime);

      // Create function
      const createCommand = new CreateFunctionCommand({
        FunctionName: config.functionName,
        Runtime: runtime as any,
        Role: roleArn,
        Handler: handler,
        Code: {
          ZipFile: code,
        },
        MemorySize: memorySize,
        Timeout: timeout,
        Architectures: ['arm64'],
        EphemeralStorage: { Size: 512 },
        TracingConfig: { Mode: 'PassThrough' },
        Tags: {
          'Name': config.functionName,
          'ManagedBy': 'CostKatana',
          'CreatedBy': connection.userId?.toString() ?? 'unknown',
          'CreatedAt': new Date().toISOString(),
          'ConnectionId': connection._id.toString(),
          ...config.tags,
        },
      });

      const response = await lambdaClient.send(createCommand);

      if (!response.FunctionArn) {
        throw new Error('Failed to create Lambda function');
      }

      loggingService.info('Lambda function created', {
        component: 'LambdaServiceProvider',
        operation: 'createFunction',
        functionName: config.functionName,
        runtime,
        memorySize,
        region,
        connectionId: connection._id.toString(),
      });

      return {
        functionName: config.functionName,
        functionArn: response.FunctionArn,
        handler,
        runtime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to create Lambda function', {
        component: 'LambdaServiceProvider',
        operation: 'createFunction',
        functionName: config.functionName,
        runtime,
        region,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get or create Lambda execution IAM role
   */
  private async getOrCreateLambdaExecutionRole(connection: IAWSConnection): Promise<string> {
    const credentials = await stsCredentialService.assumeRole(connection);
    const iamClient = new IAMClient({
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    const roleName = 'CostKatanaLambdaExecutionRole';

    try {
      // Check if role exists
      const getCommand = new GetRoleCommand({ RoleName: roleName });
      const getResponse = await iamClient.send(getCommand);
      if (getResponse.Role?.Arn) {
        return getResponse.Role.Arn;
      }
    } catch (error) {
      // Role doesn't exist, create it
    }

    try {
      // Create role
      const createCommand = new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
      });

      const createResponse = await iamClient.send(createCommand);

      if (!createResponse.Role?.Arn) {
        throw new Error('Failed to create Lambda execution role');
      }

      // Attach basic execution policy
      const attachCommand = new AttachRolePolicyCommand({
        RoleName: roleName,
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      });

      await iamClient.send(attachCommand);

      return createResponse.Role.Arn;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to get/create Lambda execution role', {
        component: 'LambdaServiceProvider',
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Create default Lambda code for different runtimes
   */
  private createDefaultLambdaCode(runtime: string): Buffer {
    let code = '';

    if (runtime.startsWith('nodejs')) {
      code = `
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from CostKatana Lambda!',
      timestamp: new Date().toISOString(),
    }),
  };
};
`;
    } else if (runtime.startsWith('python')) {
      code = `
import json
import logging
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    logger.info(f'Event: {json.dumps(event)}')
    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'Hello from CostKatana Lambda!',
            'timestamp': datetime.now().isoformat(),
        }),
    }
`;
    } else {
      code = '// Default handler for ' + runtime;
    }

    return Buffer.from(code);
  }
}

export const lambdaServiceProvider = LambdaServiceProvider.getInstance();
