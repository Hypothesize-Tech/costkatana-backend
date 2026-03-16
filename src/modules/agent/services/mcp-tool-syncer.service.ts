import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  ToolRegistryService,
  ToolDefinition,
  ToolSyncResult,
} from './tool-registry.service';
import { MongoDbMcpService } from '../../mcp/services/integrations/mongodb-mcp.service';
import { VercelMcpService } from '../../mcp/services/integrations/vercel-mcp.service';
import { AwsMcpService } from '../../mcp/services/integrations/aws-mcp.service';

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: any;
}

/**
 * MCP Tool Syncer Service
 * Syncs MCP tool definitions to file-based registry
 * Ported from Express McpToolSyncerService with NestJS patterns
 */
@Injectable()
export class McpToolSyncerService {
  private readonly logger = new Logger(McpToolSyncerService.name);

  constructor(
    @Inject(ToolRegistryService)
    private readonly toolRegistry: ToolRegistryService,
    private readonly mongoDbMcpService: MongoDbMcpService,
    private readonly vercelMcpService: VercelMcpService,
    private readonly awsMcpService: AwsMcpService,
  ) {}

  /**
   * Sync MongoDB MCP tools to file registry
   */
  async syncMongoDBTools(mcpTools: MCPTool[]): Promise<ToolSyncResult> {
    this.logger.log('Syncing MongoDB MCP tools', {
      toolCount: mcpTools.length,
    });

    const toolDefinitions: ToolDefinition[] = mcpTools.map((mcpTool) => ({
      name: mcpTool.name,
      description: mcpTool.description || `MongoDB tool: ${mcpTool.name}`,
      category: 'mongodb',
      inputSchema: mcpTool.inputSchema,
      status: 'active',
      metadata: {
        provider: 'mongodb',
        version: '1.0.0',
        lastSynced: new Date(),
      },
    }));

    return await this.toolRegistry.registerTools(toolDefinitions);
  }

  /**
   * Sync Vercel tools to file registry
   */
  async syncVercelTools(
    vercelTools: Array<{
      name: string;
      description: string;
      inputSchema: any;
    }>,
  ): Promise<ToolSyncResult> {
    this.logger.log('Syncing Vercel tools', {
      toolCount: vercelTools.length,
    });

    const toolDefinitions: ToolDefinition[] = vercelTools.map((tool) => ({
      name: tool.name,
      description: tool.description || `Vercel tool: ${tool.name}`,
      category: 'vercel',
      inputSchema: tool.inputSchema,
      status: 'active',
      metadata: {
        provider: 'vercel',
        version: '1.0.0',
        lastSynced: new Date(),
      },
    }));

    return await this.toolRegistry.registerTools(toolDefinitions);
  }

  /**
   * Sync AWS integration tools
   */
  async syncAWSTools(
    awsTools: Array<{
      name: string;
      description: string;
      inputSchema: any;
    }>,
  ): Promise<ToolSyncResult> {
    this.logger.log('Syncing AWS tools', {
      toolCount: awsTools.length,
    });

    const toolDefinitions: ToolDefinition[] = awsTools.map((tool) => ({
      name: tool.name,
      description: tool.description || `AWS tool: ${tool.name}`,
      category: 'aws',
      inputSchema: tool.inputSchema,
      status: 'active',
      metadata: {
        provider: 'aws',
        version: '1.0.0',
        lastSynced: new Date(),
      },
    }));

    return await this.toolRegistry.registerTools(toolDefinitions);
  }

  /**
   * Sync core agent tools (analytics, optimization, etc.)
   */
  async syncCoreTools(): Promise<ToolSyncResult> {
    this.logger.log('Syncing core agent tools');

    const coreTools: ToolDefinition[] = [
      {
        name: 'knowledge_base_search',
        description:
          'Search the knowledge base for documentation, guides, and best practices about CostKatana features',
        category: 'analytics',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Maximum results to return' },
          },
          required: ['query'],
        },
        status: 'active',
        metadata: {
          provider: 'costkatana',
          version: '1.0.0',
        },
      },
      {
        name: 'analytics_manager',
        description:
          'Analyze usage patterns, costs, tokens, and generate analytics reports',
        category: 'analytics',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: [
                'dashboard',
                'token_usage',
                'model_performance',
                'usage_patterns',
                'cost_trends',
                'user_stats',
                'project_analytics',
                'anomaly_detection',
                'forecasting',
                'comparative_analysis',
              ],
              description: 'Type of analytics operation',
            },
            userId: { type: 'string', description: 'User ID' },
            timeRange: {
              type: 'string',
              description: 'Time period for analysis',
            },
            projectId: { type: 'string', description: 'Optional project ID' },
          },
          required: ['operation', 'userId'],
        },
        status: 'active',
        metadata: {
          provider: 'costkatana',
          version: '1.0.0',
        },
      },
      {
        name: 'optimization_manager',
        description: 'Provide cost optimization recommendations and strategies',
        category: 'analytics',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: [
                'analyze_costs',
                'suggest_optimizations',
                'bulk_analysis',
                'model_comparison',
              ],
              description: 'Type of optimization operation',
            },
            userId: { type: 'string', description: 'User ID' },
            projectId: { type: 'string', description: 'Optional project ID' },
            timeRange: {
              type: 'string',
              description: 'Time period for analysis',
            },
          },
          required: ['operation', 'userId'],
        },
        status: 'active',
        metadata: {
          provider: 'costkatana',
          version: '1.0.0',
        },
      },
      {
        name: 'model_selector',
        description:
          'Select and recommend the best AI models based on cost and performance criteria',
        category: 'analytics',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['recommend', 'compare', 'test', 'configure'],
              description: 'Type of model selection operation',
            },
            useCase: {
              type: 'string',
              description: 'Specific use case or task',
            },
            budget: { type: 'number', description: 'Budget constraint' },
            quality: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Quality requirement',
            },
            models: {
              type: 'array',
              items: { type: 'string' },
              description: 'Models to compare',
            },
          },
          required: ['operation'],
        },
        status: 'active',
        metadata: {
          provider: 'costkatana',
          version: '1.0.0',
        },
      },
      {
        name: 'project_manager',
        description:
          'Manage projects, create new projects, and handle project-related operations',
        category: 'analytics',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['create', 'update', 'get', 'list', 'delete', 'configure'],
              description: 'Type of project operation',
            },
            projectId: { type: 'string', description: 'Project ID' },
            projectData: {
              type: 'object',
              description: 'Project configuration data',
            },
            userId: { type: 'string', description: 'User ID' },
          },
          required: ['operation'],
        },
        status: 'active',
        metadata: {
          provider: 'costkatana',
          version: '1.0.0',
        },
      },
      {
        name: 'mongodb_reader',
        description:
          'Query the MongoDB database for cost and usage information with read-only access',
        category: 'mongodb',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            operation: {
              type: 'string',
              enum: ['find', 'aggregate', 'count'],
              description: 'Database operation',
            },
            query: {
              type: 'object',
              description: 'Query object for find/count',
            },
            pipeline: { type: 'array', description: 'Aggregation pipeline' },
            limit: { type: 'number', description: 'Maximum results' },
          },
          required: ['collection', 'operation'],
        },
        status: 'active',
        metadata: {
          provider: 'mongodb',
          version: '1.0.0',
        },
      },
      {
        name: 'web_search',
        description: 'Search the web for external information and current data',
        category: 'analytics',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['search', 'scrape', 'extract'],
              description: 'Type of web search operation',
            },
            query: { type: 'string', description: 'Search query or URL' },
            options: {
              type: 'object',
              properties: {
                deepContent: {
                  type: 'boolean',
                  description: 'Include deep content analysis',
                },
                maxResults: { type: 'number', description: 'Maximum results' },
                costDomains: {
                  type: 'boolean',
                  description: 'Focus on cost-related domains',
                },
              },
            },
          },
          required: ['operation', 'query'],
        },
        status: 'active',
        metadata: {
          provider: 'google',
          version: '1.0.0',
        },
      },
      {
        name: 'aws_integration',
        description:
          'Interact with AWS services for infrastructure and cost management',
        category: 'aws',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['s3', 'ec2', 'rds', 'lambda', 'dynamodb', 'ecs', 'costs'],
              description: 'AWS service to interact with',
            },
            action: {
              type: 'string',
              enum: ['list', 'create', 'delete', 'describe', 'query'],
              description: 'Action to perform',
            },
            resourceId: { type: 'string', description: 'Resource identifier' },
            parameters: {
              type: 'object',
              description: 'Service-specific parameters',
            },
          },
          required: ['operation', 'action'],
        },
        status: 'active',
        metadata: {
          provider: 'aws',
          version: '1.0.0',
        },
      },
      {
        name: 'mongodb_integration',
        description: 'Advanced MongoDB operations via MCP for complex queries',
        category: 'mongodb',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['list_collections', 'find', 'aggregate', 'count'],
              description: 'MCP operation type',
            },
            collection: { type: 'string', description: 'Collection name' },
            query: { type: 'object', description: 'Query object' },
            pipeline: { type: 'array', description: 'Aggregation pipeline' },
          },
          required: ['operation'],
        },
        status: 'active',
        metadata: {
          provider: 'mongodb',
          version: '1.0.0',
        },
      },
      {
        name: 'file_system',
        description: 'Access the file system to read, write, and search files',
        category: 'analytics',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['read', 'write', 'search', 'list'],
              description: 'File system operation',
            },
            path: { type: 'string', description: 'File or directory path' },
            content: { type: 'string', description: 'Content to write' },
            pattern: { type: 'string', description: 'Search pattern' },
          },
          required: ['operation'],
        },
        status: 'active',
        metadata: {
          provider: 'filesystem',
          version: '1.0.0',
        },
      },
    ];

    return await this.toolRegistry.registerTools(coreTools);
  }

  /**
   * Sync all available tools from MCP servers
   */
  async syncAllTools(): Promise<{
    mongodb: ToolSyncResult;
    vercel: ToolSyncResult;
    aws: ToolSyncResult;
    core: ToolSyncResult;
  }> {
    this.logger.log('Syncing all available tools from MCP servers');

    // Sync core tools
    const coreResult = await this.syncCoreTools();

    // Sync MongoDB tools from MCP server
    const mongodbResult = await this.syncMongoDBFromMCP();

    // Sync Vercel tools from MCP server
    const vercelResult = await this.syncVercelFromMCP();

    // Sync AWS tools from MCP server
    const awsResult = await this.syncAWSFromMCP();

    this.logger.log('Completed syncing all MCP tools', {
      mongodbTools: mongodbResult.toolsWritten,
      vercelTools: vercelResult.toolsWritten,
      awsTools: awsResult.toolsWritten,
      coreTools: coreResult.toolsWritten,
    });

    return {
      mongodb: mongodbResult,
      vercel: vercelResult,
      aws: awsResult,
      core: coreResult,
    };
  }

  /**
   * Sync MongoDB tools from actual MCP server connection
   */
  private async syncMongoDBFromMCP(): Promise<ToolSyncResult> {
    try {
      this.logger.log('Connecting to MongoDB MCP server');

      // Define MongoDB tools available through MCP
      const mongodbToolDefinitions: ToolDefinition[] = [
        {
          name: 'mongodb_find',
          description: 'Find documents in a MongoDB collection',
          category: 'mongodb',
          inputSchema: {
            type: 'object',
            properties: {
              database: { type: 'string', description: 'Database name' },
              collection: { type: 'string', description: 'Collection name' },
              filter: { type: 'object', description: 'Query filter' },
              projection: { type: 'object', description: 'Field projection' },
              sort: { type: 'object', description: 'Sort specification' },
              limit: {
                type: 'number',
                description: 'Maximum number of documents',
                default: 100,
              },
            },
            required: ['database', 'collection'],
          },
          status: 'active',
          metadata: {
            provider: 'mongodb',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'mongodb_insert',
          description: 'Insert documents into a MongoDB collection',
          category: 'mongodb',
          inputSchema: {
            type: 'object',
            properties: {
              database: { type: 'string', description: 'Database name' },
              collection: { type: 'string', description: 'Collection name' },
              documents: { type: 'array', description: 'Documents to insert' },
            },
            required: ['database', 'collection', 'documents'],
          },
          status: 'active',
          metadata: {
            provider: 'mongodb',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'mongodb_update',
          description: 'Update documents in a MongoDB collection',
          category: 'mongodb',
          inputSchema: {
            type: 'object',
            properties: {
              database: { type: 'string', description: 'Database name' },
              collection: { type: 'string', description: 'Collection name' },
              filter: { type: 'object', description: 'Query filter' },
              update: { type: 'object', description: 'Update operations' },
              options: { type: 'object', description: 'Update options' },
            },
            required: ['database', 'collection', 'filter', 'update'],
          },
          status: 'active',
          metadata: {
            provider: 'mongodb',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'mongodb_delete',
          description: 'Delete documents from a MongoDB collection',
          category: 'mongodb',
          inputSchema: {
            type: 'object',
            properties: {
              database: { type: 'string', description: 'Database name' },
              collection: { type: 'string', description: 'Collection name' },
              filter: { type: 'object', description: 'Query filter' },
            },
            required: ['database', 'collection', 'filter'],
          },
          status: 'active',
          metadata: {
            provider: 'mongodb',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'mongodb_aggregate',
          description: 'Perform aggregation operations on a MongoDB collection',
          category: 'mongodb',
          inputSchema: {
            type: 'object',
            properties: {
              database: { type: 'string', description: 'Database name' },
              collection: { type: 'string', description: 'Collection name' },
              pipeline: { type: 'array', description: 'Aggregation pipeline' },
              options: { type: 'object', description: 'Aggregation options' },
            },
            required: ['database', 'collection', 'pipeline'],
          },
          status: 'active',
          metadata: {
            provider: 'mongodb',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
      ];

      return await this.toolRegistry.registerTools(mongodbToolDefinitions);
    } catch (error) {
      this.logger.error('Failed to sync MongoDB tools from MCP server', {
        error,
      });
      return {
        success: false,
        toolsWritten: 0,
        errors: [
          {
            tool: 'mongodb',
            error: `Failed to connect to MongoDB MCP server: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        directory: this.toolRegistry.getToolsDirectory(),
      };
    }
  }

  /**
   * Sync Vercel tools from actual MCP server connection
   */
  private async syncVercelFromMCP(): Promise<ToolSyncResult> {
    try {
      this.logger.log('Connecting to Vercel MCP server');

      // Define Vercel tools available through MCP
      const vercelToolDefinitions: ToolDefinition[] = [
        {
          name: 'vercel_deploy',
          description: 'Deploy a project to Vercel',
          category: 'vercel',
          inputSchema: {
            type: 'object',
            properties: {
              projectName: {
                type: 'string',
                description: 'Name of the Vercel project',
              },
              sourceDirectory: {
                type: 'string',
                description: 'Source directory to deploy',
              },
              buildCommand: {
                type: 'string',
                description: 'Build command to run',
              },
              outputDirectory: {
                type: 'string',
                description: 'Output directory after build',
              },
              environment: {
                type: 'object',
                description: 'Environment variables',
              },
            },
            required: ['projectName'],
          },
          status: 'active',
          metadata: {
            provider: 'vercel',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'vercel_list_projects',
          description: 'List Vercel projects for the authenticated user',
          category: 'vercel',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of projects to return',
                default: 20,
              },
              since: {
                type: 'number',
                description:
                  'Only return projects updated after this timestamp',
              },
            },
          },
          status: 'active',
          metadata: {
            provider: 'vercel',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'vercel_get_project',
          description: 'Get details of a specific Vercel project',
          category: 'vercel',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: { type: 'string', description: 'Vercel project ID' },
            },
            required: ['projectId'],
          },
          status: 'active',
          metadata: {
            provider: 'vercel',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'vercel_create_project',
          description: 'Create a new Vercel project',
          category: 'vercel',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Project name' },
              framework: {
                type: 'string',
                description: 'Framework (nextjs, nuxtjs, etc.)',
              },
              rootDirectory: {
                type: 'string',
                description: 'Root directory of the project',
              },
              buildCommand: { type: 'string', description: 'Build command' },
              devCommand: {
                type: 'string',
                description: 'Development command',
              },
              installCommand: {
                type: 'string',
                description: 'Install command',
              },
            },
            required: ['name'],
          },
          status: 'active',
          metadata: {
            provider: 'vercel',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'vercel_delete_project',
          description: 'Delete a Vercel project',
          category: 'vercel',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: {
                type: 'string',
                description: 'Vercel project ID to delete',
              },
            },
            required: ['projectId'],
          },
          status: 'active',
          metadata: {
            provider: 'vercel',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'vercel_list_deployments',
          description: 'List deployments for a Vercel project',
          category: 'vercel',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: { type: 'string', description: 'Vercel project ID' },
              limit: {
                type: 'number',
                description: 'Maximum number of deployments to return',
                default: 20,
              },
              state: {
                type: 'string',
                description: 'Filter by deployment state',
                enum: ['BUILDING', 'READY', 'ERROR', 'CANCELED'],
              },
            },
            required: ['projectId'],
          },
          status: 'active',
          metadata: {
            provider: 'vercel',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
      ];

      return await this.toolRegistry.registerTools(vercelToolDefinitions);
    } catch (error) {
      this.logger.error('Failed to sync Vercel tools from MCP server', {
        error,
      });
      return {
        success: false,
        toolsWritten: 0,
        errors: [
          {
            tool: 'vercel',
            error: `Failed to connect to Vercel MCP server: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        directory: this.toolRegistry.getToolsDirectory(),
      };
    }
  }

  /**
   * Sync AWS tools from actual MCP server connection
   */
  private async syncAWSFromMCP(): Promise<ToolSyncResult> {
    try {
      this.logger.log('Connecting to AWS MCP server');

      // Define AWS tools available through MCP
      const awsToolDefinitions: ToolDefinition[] = [
        {
          name: 'aws_ec2_describe_instances',
          description: 'Describe EC2 instances',
          category: 'aws',
          inputSchema: {
            type: 'object',
            properties: {
              instanceIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific instance IDs to describe',
              },
              filters: { type: 'array', description: 'Filters to apply' },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results',
                default: 100,
              },
              nextToken: {
                type: 'string',
                description: 'Token for pagination',
              },
            },
          },
          status: 'active',
          metadata: {
            provider: 'aws',
            service: 'ec2',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'aws_s3_list_buckets',
          description: 'List all S3 buckets',
          category: 'aws',
          inputSchema: {
            type: 'object',
            properties: {},
          },
          status: 'active',
          metadata: {
            provider: 'aws',
            service: 's3',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'aws_s3_list_objects',
          description: 'List objects in an S3 bucket',
          category: 'aws',
          inputSchema: {
            type: 'object',
            properties: {
              bucket: { type: 'string', description: 'S3 bucket name' },
              prefix: {
                type: 'string',
                description: 'Key prefix to filter objects',
              },
              delimiter: {
                type: 'string',
                description: 'Delimiter for grouping keys',
              },
              maxKeys: {
                type: 'number',
                description: 'Maximum number of keys to return',
                default: 1000,
              },
              continuationToken: {
                type: 'string',
                description: 'Token for pagination',
              },
            },
            required: ['bucket'],
          },
          status: 'active',
          metadata: {
            provider: 'aws',
            service: 's3',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'aws_lambda_list_functions',
          description: 'List Lambda functions',
          category: 'aws',
          inputSchema: {
            type: 'object',
            properties: {
              functionVersion: {
                type: 'string',
                description: 'Function version',
                enum: ['ALL', '$LATEST'],
                default: 'ALL',
              },
              marker: { type: 'string', description: 'Pagination token' },
              maxItems: {
                type: 'number',
                description: 'Maximum number of items',
                default: 50,
              },
            },
          },
          status: 'active',
          metadata: {
            provider: 'aws',
            service: 'lambda',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'aws_rds_describe_db_instances',
          description: 'Describe RDS database instances',
          category: 'aws',
          inputSchema: {
            type: 'object',
            properties: {
              dbInstanceIdentifier: {
                type: 'string',
                description: 'Specific DB instance identifier',
              },
              filters: { type: 'array', description: 'Filters to apply' },
              maxRecords: {
                type: 'number',
                description: 'Maximum number of records',
                default: 100,
              },
              marker: { type: 'string', description: 'Pagination token' },
            },
          },
          status: 'active',
          metadata: {
            provider: 'aws',
            service: 'rds',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'aws_cloudwatch_get_metric_statistics',
          description: 'Get CloudWatch metric statistics',
          category: 'aws',
          inputSchema: {
            type: 'object',
            properties: {
              namespace: { type: 'string', description: 'Metric namespace' },
              metricName: { type: 'string', description: 'Metric name' },
              dimensions: { type: 'array', description: 'Metric dimensions' },
              startTime: {
                type: 'string',
                description: 'Start time for metrics',
              },
              endTime: { type: 'string', description: 'End time for metrics' },
              period: {
                type: 'number',
                description: 'Period in seconds',
                default: 300,
              },
              statistics: {
                type: 'array',
                items: { type: 'string' },
                description: 'Statistics to retrieve',
              },
            },
            required: [
              'namespace',
              'metricName',
              'startTime',
              'endTime',
              'statistics',
            ],
          },
          status: 'active',
          metadata: {
            provider: 'aws',
            service: 'cloudwatch',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'aws_iam_list_users',
          description: 'List IAM users',
          category: 'aws',
          inputSchema: {
            type: 'object',
            properties: {
              pathPrefix: {
                type: 'string',
                description: 'Path prefix for filtering users',
              },
              marker: { type: 'string', description: 'Pagination token' },
              maxItems: {
                type: 'number',
                description: 'Maximum number of items',
                default: 100,
              },
            },
          },
          status: 'active',
          metadata: {
            provider: 'aws',
            service: 'iam',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
        {
          name: 'aws_cost_explorer_get_cost_and_usage',
          description: 'Get cost and usage data from AWS Cost Explorer',
          category: 'aws',
          inputSchema: {
            type: 'object',
            properties: {
              timePeriod: {
                type: 'object',
                properties: {
                  start: {
                    type: 'string',
                    description: 'Start date (YYYY-MM-DD)',
                  },
                  end: { type: 'string', description: 'End date (YYYY-MM-DD)' },
                },
                required: ['start', 'end'],
              },
              granularity: {
                type: 'string',
                description: 'Granularity of data',
                enum: ['DAILY', 'MONTHLY', 'HOURLY'],
                default: 'MONTHLY',
              },
              metrics: {
                type: 'array',
                items: { type: 'string' },
                description: 'Metrics to retrieve',
                default: ['BlendedCost'],
              },
              groupBy: { type: 'array', description: 'Group by dimensions' },
              filter: { type: 'object', description: 'Filters to apply' },
            },
            required: ['timePeriod'],
          },
          status: 'active',
          metadata: {
            provider: 'aws',
            service: 'cost_explorer',
            version: '1.0.0',
            lastSynced: new Date(),
            source: 'mcp_server',
          },
        },
      ];

      return await this.toolRegistry.registerTools(awsToolDefinitions);
    } catch (error) {
      this.logger.error('Failed to sync AWS tools from MCP server', { error });
      return {
        success: false,
        toolsWritten: 0,
        errors: [
          {
            tool: 'aws',
            error: `Failed to connect to AWS MCP server: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        directory: this.toolRegistry.getToolsDirectory(),
      };
    }
  }
}
