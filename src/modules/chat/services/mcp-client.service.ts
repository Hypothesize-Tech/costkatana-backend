import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { McpAuthService } from '../../mcp/services/mcp-auth.service';
import { ToolRegistryService } from '../../mcp/services/tool-registry.service';
import { McpPermissionService } from '../../mcp/services/mcp-permission.service';
import type {
  MCPAuthContext,
  MCPToolDefinition,
  IntegrationType,
  ToolSchema,
} from '../../mcp/types/mcp.types';
import { BedrockService } from '../../bedrock/bedrock.service';

export interface MCPIntegrationRequest {
  userId: string;
  command: any;
  context?: any;
}

export interface MCPExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  metadata?: any;
}

@Injectable()
export class MCPClientService {
  private authContexts = new Map<string, MCPAuthContext>();
  private readonly logger = new Logger(MCPClientService.name);

  constructor(
    private readonly mcpAuthService: McpAuthService,
    private readonly toolRegistryService: ToolRegistryService,
    private readonly mcpPermissionService: McpPermissionService,
  ) {}

  /**
   * Initialize MCP for a user
   * @param userId - User ID from JWT token authentication
   */
  async initialize(userId: string): Promise<boolean> {
    try {
      this.logger.log('Initializing MCP for user', { userId });

      if (!userId || userId === 'undefined' || userId === 'null') {
        this.logger.error('Invalid userId provided to MCP initialize', {
          userId,
        });
        return false;
      }

      const authContext = await this.mcpAuthService.authenticate(userId);
      if (!authContext) {
        this.logger.error(
          'MCP authentication failed - no auth context returned',
          {
            userId,
          },
        );
        return false;
      }

      this.authContexts.set(userId, authContext);

      this.logger.log('MCP initialized successfully', {
        userId,
        integrations: authContext.integrations,
        integrationCount: authContext.integrations.length,
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to initialize MCP - exception thrown', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  async discoverTools(userId: string): Promise<MCPToolDefinition[]> {
    try {
      const authContext = this.authContexts.get(userId);
      if (!authContext) {
        throw new Error('User not authenticated with MCP');
      }

      const tools = this.toolRegistryService.toMCPDefinitions(
        authContext.integrations,
      );

      this.logger.log('Discovered MCP tools', {
        userId,
        toolCount: tools.length,
        integrations: authContext.integrations,
      });

      return tools;
    } catch (error) {
      this.logger.error('Failed to discover MCP tools', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async findToolsForIntent(
    userId: string,
    message: string,
    _integrations: string[],
  ): Promise<MCPToolDefinition[]> {
    try {
      const authContext = this.authContexts.get(userId);
      if (!authContext) {
        throw new Error('User not authenticated with MCP');
      }

      const allTools = this.toolRegistryService.toMCPDefinitions(
        authContext.integrations,
      );

      const relevantTools = allTools.filter((tool: MCPToolDefinition) => {
        const toolName = tool.name.toLowerCase();
        const lowerMessage = message.toLowerCase();

        if (toolName.includes('github') && lowerMessage.includes('repo'))
          return true;
        if (toolName.includes('github') && lowerMessage.includes('issue'))
          return true;
        if (toolName.includes('mongodb') && lowerMessage.includes('query'))
          return true;
        if (toolName.includes('mongodb') && lowerMessage.includes('find'))
          return true;
        if (toolName.includes('mongodb') && lowerMessage.includes('insert'))
          return true;
        if (toolName.includes('vercel') && lowerMessage.includes('deploy'))
          return true;
        if (toolName.includes('vercel') && lowerMessage.includes('build'))
          return true;
        if (toolName.includes('linear') && lowerMessage.includes('issue'))
          return true;
        if (toolName.includes('jira') && lowerMessage.includes('ticket'))
          return true;
        if (toolName.includes('slack') && lowerMessage.includes('message'))
          return true;
        if (toolName.includes('discord') && lowerMessage.includes('message'))
          return true;
        if (toolName.includes('google') && lowerMessage.includes('file'))
          return true;
        if (toolName.includes('aws') && lowerMessage.includes('instance'))
          return true;

        return false;
      });

      this.logger.log('Found tools for intent', {
        userId,
        message: message.substring(0, 100),
        totalTools: allTools.length,
        relevantTools: relevantTools.length,
        toolNames: relevantTools.map((t: MCPToolDefinition) => t.name),
      });

      return relevantTools;
    } catch (error) {
      this.logger.error('Failed to find tools for intent', {
        userId,
        message: message.substring(0, 100),
        integrations: _integrations,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async executeWithAI(
    userId: string,
    toolName: string,
    message: string,
    context?: Record<string, unknown>,
    selectedModel?: string,
  ): Promise<MCPExecutionResult> {
    try {
      const authContext = this.authContexts.get(userId);
      if (!authContext) {
        return {
          success: false,
          error: 'User not authenticated with MCP',
          metadata: { toolName, userId },
        };
      }

      const tool = this.toolRegistryService.getTool(toolName);
      if (!tool) {
        return {
          success: false,
          error: `Tool '${toolName}' not found`,
          metadata: { toolName, userId },
        };
      }

      const connectionId = await this.mcpAuthService.getConnectionId(
        userId,
        tool.schema.integration,
      );
      if (!connectionId) {
        return {
          success: false,
          error: `No active connection found for ${tool.schema.integration}`,
          metadata: {
            toolName,
            userId,
            integration: tool.schema.integration,
          },
        };
      }

      const resourceId =
        context && typeof context === 'object' && 'resourceId' in context
          ? (context as { resourceId?: string }).resourceId
          : undefined;

      const permissionCheck = await this.mcpPermissionService.checkPermission({
        userId: authContext.userId,
        integration: tool.schema.integration,
        connectionId,
        toolName,
        httpMethod: tool.schema.httpMethod,
        resourceId,
      });

      if (!permissionCheck.allowed) {
        return {
          success: false,
          error: permissionCheck.reason || 'Permission denied',
          metadata: {
            toolName,
            userId,
            integration: tool.schema.integration,
            permissionDenied: true,
            missingPermission: permissionCheck.missingPermission,
          },
        };
      }

      const params = await this.extractParametersFromMessage(
        message,
        tool.schema,
        context,
        selectedModel,
      );

      const startTime = Date.now();
      const result = await this.toolRegistryService.executeTool(
        toolName,
        params,
        {
          userId: authContext.userId,
          connectionId,
          integration: tool.schema.integration,
          permissions: [],
          scopes: [],
          isAdmin: authContext.isAdmin,
        },
      );

      const latency = Date.now() - startTime;

      this.logger.log('MCP tool executed successfully', {
        userId,
        toolName,
        integration: tool.schema.integration,
        latency,
        success: true,
      });

      return {
        success: true,
        result,
        metadata: {
          toolName,
          integration: tool.schema.integration,
          executionTime: latency,
          cached: false,
          permissionChecked: true,
          dangerousOperation: tool.schema.dangerous ?? false,
          userId: authContext.userId,
        },
      };
    } catch (error) {
      this.logger.error('Failed to execute MCP tool', {
        userId,
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'MCP execution failed',
        metadata: {
          toolName,
          userId,
          error: true,
          executionTime: 0,
        },
      };
    }
  }

  /**
   * Get the actual connection ID for a specific integration.
   * Delegates to McpAuthService, which holds all integration-specific logic
   * (vercel, github, google, mongodb, aws, slack, discord, jira, linear) using
   * the properly injected Mongoose models. Do not duplicate the switch here.
   */
  async getConnectionId(
    userId: string,
    integration: string,
  ): Promise<string | null> {
    try {
      this.logger.log('Getting connection ID', { userId, integration });
      return this.mcpAuthService.getConnectionId(
        userId,
        integration as IntegrationType,
      );
    } catch (error) {
      this.logger.error('Failed to get connection ID', {
        userId,
        integration,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Extract parameters from natural language message using AI
   */
  private async extractParametersFromMessage(
    message: string,
    toolSchema: ToolSchema,
    context?: Record<string, unknown>,
    selectedModel?: string,
  ): Promise<Record<string, unknown>> {
    try {
      const prompt = `Extract parameters from this user message for the tool "${toolSchema.name}":

User Message: "${message}"

Tool Schema: ${JSON.stringify(toolSchema.parameters ?? {}, null, 2)}

Context: ${JSON.stringify(context ?? {}, null, 2)}

Return ONLY a JSON object with the extracted parameters. If a parameter cannot be determined, omit it or use null.`;

      const result = await BedrockService.invokeModel(
        prompt,
        selectedModel || 'anthropic.claude-sonnet-4-5-20250929-v1:0', // Default to a stable model
      );

      const responseStr =
        typeof result === 'string' ? result : JSON.stringify(result);

      try {
        const extractedParams = JSON.parse(responseStr) as Record<
          string,
          unknown
        >;
        return extractedParams;
      } catch {
        return {};
      }
    } catch (error) {
      this.logger.warn(
        'Failed to extract parameters from message, using defaults',
        {
          message: message.substring(0, 100),
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return {};
    }
  }
}
