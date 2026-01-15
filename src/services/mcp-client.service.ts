/**
 * MCP Client Service
 * Provides a clean interface for ChatService to interact with MCP
 */

import { loggingService } from './logging.service';
import { MCPServer } from '../mcp/server';
import { MCPToolDefinition } from '../mcp/types/mcp.types';
import { MCPToolResponse, createSuccessResponse, createErrorResponse } from '../mcp/types/standard-response';
import { ToolRegistry } from '../mcp/registry/tool-registry';
import { MCPAuthService, MCPAuthContext } from '../mcp/auth/mcp-auth';
import { PermissionManager } from '../mcp/permissions/permission-manager';
import { IntegrationType } from '../mcp/types/permission.types';
import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export class MCPClientService {
  private static mcpServers = new Map<string, MCPServer>();
  private static authContexts = new Map<string, MCPAuthContext>();

  /**
   * Initialize MCP for a user
   * @param userId - User ID from JWT token authentication
   */
  static async initialize(userId: string): Promise<boolean> {
    try {
      loggingService.info('Initializing MCP for user', { userId });

      if (!userId || userId === 'undefined' || userId === 'null') {
        loggingService.error('Invalid userId provided to MCP initialize', { userId });
        return false;
      }

      // Authenticate user with userId
      const authContext = await MCPAuthService.authenticate(userId);
      if (!authContext) {
        loggingService.error('MCP authentication failed - no auth context returned', { userId });
        return false;
      }

      // Store auth context
      this.authContexts.set(userId, authContext);

      // Create MCP server instance for this user if not exists
      // For API usage, we use stdio transport (programmatic, not web SSE)
      if (!this.mcpServers.has(userId)) {
        const server = new MCPServer({
          name: 'cost-katana-mcp',
          version: '1.0.0',
          transport: 'stdio', // Use stdio for programmatic API calls
        });

        this.mcpServers.set(userId, server);
        
        loggingService.debug('Created new MCP server instance', { userId });
      }

      loggingService.info('MCP initialized successfully', {
        userId,
        integrations: authContext.integrations,
        integrationCount: authContext.integrations.length,
      });

      return true;
    } catch (error) {
      loggingService.error('Failed to initialize MCP - exception thrown', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  /**
   * Discover available tools for user's connected integrations
   */
  static async discoverTools(userId: string): Promise<MCPToolDefinition[]> {
    try {
      const authContext = this.authContexts.get(userId);
      if (!authContext) {
        throw new Error('User not authenticated with MCP');
      }

      // Get tools filtered by user's connected integrations
      const tools = ToolRegistry.toMCPDefinitions(authContext.integrations);

      loggingService.info('Discovered MCP tools', {
        userId,
        toolCount: tools.length,
        integrations: authContext.integrations,
      });

      return tools;
    } catch (error) {
      loggingService.error('Failed to discover MCP tools', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get the actual connection ID for a specific integration
   */
  private static async getConnectionId(
    userId: string,
    integration: IntegrationType
  ): Promise<string | null> {
    try {
      loggingService.info('🔍 Getting connection ID', {
        userId,
        integration,
        component: 'MCPClientService',
      });

      switch (integration) {
        case 'vercel': {
          const { VercelConnection } = await import('../models/VercelConnection');
          const conn = await VercelConnection.findOne({ userId, isActive: true }).select('_id').lean();
          loggingService.info('Vercel connection lookup', { found: !!conn, connId: conn?._id });
          return conn?._id?.toString() || null;
        }
        case 'github': {
          const { GitHubConnection } = await import('../models/GitHubConnection');
          const conn = await GitHubConnection.findOne({ userId, isActive: true }).select('_id').lean();
          loggingService.info('GitHub connection lookup', { found: !!conn, connId: conn?._id });
          return conn?._id?.toString() || null;
        }
        case 'google': {
          const { GoogleConnection } = await import('../models/GoogleConnection');
          const conn = await GoogleConnection.findOne({ userId, isActive: true }).select('_id').lean();
          loggingService.info('Google connection lookup', { found: !!conn, connId: conn?._id });
          return conn?._id?.toString() || null;
        }
        case 'mongodb': {
          const { MongoDBConnection } = await import('../models/MongoDBConnection');
          const conn = await MongoDBConnection.findOne({ userId, isActive: true }).select('_id').lean();
          loggingService.info('MongoDB connection lookup', { found: !!conn, connId: conn?._id });
          return conn?._id?.toString() || null;
        }
        case 'aws': {
          const { AWSConnection } = await import('../models/AWSConnection');
          const conn = await AWSConnection.findOne({ userId, status: 'active' }).select('_id').lean();
          loggingService.info('AWS connection lookup', { found: !!conn, connId: conn?._id });
          return conn?._id?.toString() || null;
        }
        case 'slack':
        case 'discord':
        case 'jira':
        case 'linear': {
          // For these integrations, use standard Integration model with status field
          // Map integration names to their OAuth type values
          const typeMap: Record<string, string> = {
            'slack': 'slack_oauth',
            'discord': 'discord_oauth',
            'jira': 'jira_oauth',
            'linear': 'linear_oauth'
          };
          
          const { Integration } = await import('../models/Integration');
          const conn = await Integration.findOne({
            userId,
            type: typeMap[integration],
            status: 'active',
          }).select('_id').lean();
          loggingService.info(`${integration} connection lookup`, { found: !!conn, connId: conn?._id, type: typeMap[integration] });
          return conn?._id?.toString() || null;
        }
        default: {
          loggingService.warn('Unknown integration type', { integration });
          return null;
        }
      }
    } catch (error) {
      loggingService.error('Failed to get connection ID', {
        userId,
        integration,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Execute a tool by name
   */
  static async executeTool(
    userId: string,
    toolName: string,
    params: any
  ): Promise<MCPToolResponse> {
    try {
      const authContext = this.authContexts.get(userId);
      if (!authContext) {
        return createErrorResponse(
          {
            code: 'AUTH_FAILED',
            message: 'User not authenticated with MCP',
            recoverable: false,
          },
          { operation: 'executeTool' }
        );
      }

      // Get tool from registry
      const tool = ToolRegistry.getTool(toolName);
      if (!tool) {
        return createErrorResponse(
          {
            code: 'NOT_FOUND',
            message: `Tool '${toolName}' not found`,
            recoverable: false,
          },
          { operation: 'executeTool' }
        );
      }

      // Get the actual connection ID for this integration
      const connectionId = await this.getConnectionId(authContext.userId, tool.schema.integration);
      if (!connectionId) {
        return createErrorResponse(
          {
            code: 'NOT_FOUND',
            message: `No active connection found for ${tool.schema.integration}`,
            recoverable: false,
          },
          { operation: 'executeTool' }
        );
      }

      // Check permissions
      const permissionCheck = await PermissionManager.checkPermission({
        userId: authContext.userId,
        integration: tool.schema.integration,
        connectionId,
        toolName: toolName,
        httpMethod: tool.schema.httpMethod,
        resourceId: params.resourceId,
      });

      if (!permissionCheck.allowed) {
        return createErrorResponse(
          {
            code: 'PERMISSION_DENIED',
            message: permissionCheck.reason || 'Permission denied',
            recoverable: false,
            missingPermission: permissionCheck.missingPermission,
          },
          {
            operation: 'executeTool',
            integration: tool.schema.integration,
          }
        );
      }

      // Execute tool
      const startTime = Date.now();
      const result = await ToolRegistry.executeTool(toolName, params, {
        userId: authContext.userId,
        connectionId,
        integration: tool.schema.integration,
        permissions: [], // Empty for now, can be populated from auth context
        scopes: [], // Empty for now, can be populated from auth context
        isAdmin: authContext.isAdmin,
      });

      const latency = Date.now() - startTime;

      // Format as MCPToolResponse
      return createSuccessResponse(result, {
        integration: tool.schema.integration,
        operation: tool.schema.name,
        latency,
        httpMethod: tool.schema.httpMethod,
        permissionChecked: true,
        dangerousOperation: (tool.schema as any).dangerousOperation || false,
        userId: authContext.userId,
      });
    } catch (error) {
      loggingService.error('Failed to execute MCP tool', {
        userId,
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });

      return createErrorResponse(
        {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Tool execution failed',
          recoverable: true,
        },
        { operation: 'executeTool' }
      );
    }
  }

  /**
   * Find tools that match a user's intent
   */
  static async findToolsForIntent(
    userId: string,
    userMessage: string,
    integrations?: string[]
  ): Promise<MCPToolDefinition[]> {
    try {
      const authContext = this.authContexts.get(userId);
      if (!authContext) {
        return [];
      }

      // Filter integrations to only those the user has connected
      const availableIntegrations = integrations
        ? integrations.filter(i => authContext.integrations.includes(i as IntegrationType))
        : authContext.integrations;

      // Get all tools for these integrations
      const allTools = ToolRegistry.toMCPDefinitions(availableIntegrations as any);

      // Check for explicit tool mentions like @aws:list-s3 or @github:list-repos
      const explicitToolMatch = userMessage.match(/@(\w+):([a-z-_]+)/i);
      if (explicitToolMatch) {
        const [, integration, action] = explicitToolMatch;
        const toolName = `${integration.toLowerCase()}_${action.replace(/-/g, '_')}`;
        
        // Look for exact match first
        const exactMatch = allTools.find(t => t.name === toolName);
        if (exactMatch) {
          loggingService.info('Found exact tool match for explicit mention', {
            userId,
            userMessage: userMessage.substring(0, 100),
            toolName,
          });
          return [exactMatch];
        }

        // Look for partial match (e.g., aws_list_s3 when user says @aws:list-s3)
        const partialMatch = allTools.find(t => 
          t.name.startsWith(`${integration.toLowerCase()}_`) &&
          (t.name.includes(action.replace(/-/g, '_')) || action.replace(/-/g, '_').includes(t.name.split('_').slice(1).join('_')))
        );
        if (partialMatch) {
          loggingService.info('Found partial tool match for explicit mention', {
            userId,
            userMessage: userMessage.substring(0, 100),
            toolName: partialMatch.name,
          });
          return [partialMatch];
        }
      }

      // Use AI to find relevant tools
      const model = new ChatBedrockConverse({
        model: 'anthropic.claude-3-haiku-20240307-v1:0',
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      const systemPrompt = `You are an MCP tool selector. Given a user's message and a list of available tools, identify which tools would be most relevant to fulfill the user's request.

Available tools:
${allTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Return a JSON array of tool names that match the user's intent, sorted by relevance (most relevant first). Return empty array if no tools match.
Example: ["github_create_issue", "github_create_pr"]`;

      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
      ]);

      let selectedToolNames: string[] = [];
      try {
        const content = response.content.toString();
        selectedToolNames = JSON.parse(content);
      } catch {
        // Fallback: keyword matching prioritizing integration-specific tools
        const lowerMessage = userMessage.toLowerCase();
        selectedToolNames = allTools
          .filter(tool => {
            const lowerName = tool.name.toLowerCase();
            const lowerDesc = tool.description.toLowerCase();
            
            // Check if message contains tool name parts
            const toolParts = lowerName.split('_');
            const matchScore = toolParts.filter(part => lowerMessage.includes(part)).length;
            
            // Also check description
            const descWords = lowerDesc.split(' ');
            const descMatchScore = descWords.filter(word => word.length > 3 && lowerMessage.includes(word)).length;
            
            return matchScore > 0 || descMatchScore > 0;
          })
          .sort((a, b) => {
            // Sort by relevance: prioritize tools whose names match better
            const aScore = a.name.split('_').filter(part => lowerMessage.includes(part)).length;
            const bScore = b.name.split('_').filter(part => lowerMessage.includes(part)).length;
            return bScore - aScore;
          })
          .map(t => t.name);
      }

      // Return full tool definitions for selected tools
      const selectedTools = allTools.filter(t => selectedToolNames.includes(t.name));

      loggingService.info('Found tools for intent', {
        userId,
        messagePreview: userMessage.substring(0, 100),
        toolCount: selectedTools.length,
        tools: selectedTools.map(t => t.name),
      });

      return selectedTools;
    } catch (error) {
      loggingService.error('Failed to find tools for intent', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Execute tool with automatic parameter extraction
   */
  static async executeWithAI(
    userId: string,
    toolName: string,
    userMessage: string,
    context?: any
  ): Promise<MCPToolResponse> {
    try {
      const authContext = this.authContexts.get(userId);
      if (!authContext) {
        return createErrorResponse(
          {
            code: 'AUTH_FAILED',
            message: 'User not authenticated with MCP',
            recoverable: false,
          },
          { operation: 'executeWithAI' }
        );
      }

      // Get tool schema
      const tool = ToolRegistry.getTool(toolName);
      if (!tool) {
        return createErrorResponse(
          {
            code: 'NOT_FOUND',
            message: `Tool '${toolName}' not found`,
            recoverable: false,
          },
          { operation: 'executeWithAI' }
        );
      }

      // Use AI to extract parameters
      const model = new ChatBedrockConverse({
        model: 'anthropic.claude-3-sonnet-20240229-v1:0',
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      const parameterSchema = tool.schema.parameters
        .map(p => {
          let description = `- ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`;
          if (p.default !== undefined) {
            description += ` (default: ${JSON.stringify(p.default)})`;
          }
          return description;
        })
        .join('\n');

      const systemPrompt = `Extract parameters for the MCP tool "${toolName}" from the user's message.

Tool: ${tool.schema.name}
Description: ${tool.schema.description}

Parameters needed:
${parameterSchema}

Context provided:
${JSON.stringify(context || {}, null, 2)}

IMPORTANT: 
1. If a parameter is optional and not mentioned in the message, you can omit it (the system will use its default value).
2. If a required parameter cannot be extracted, return {"error": "explanation"}.
3. For JIRA list operations, if no specific filter is mentioned, omit the 'jql' parameter to use the default query.

Return ONLY a valid JSON object with the extracted parameters.`;

      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
      ]);

      let extractedParams: any;
      try {
        extractedParams = JSON.parse(response.content.toString());
      } catch (error) {
        return createErrorResponse(
          {
            code: 'INVALID_PARAMS',
            message: 'Failed to extract parameters from message',
            recoverable: true,
          },
          {
            operation: 'executeWithAI',
            integration: tool.schema.integration,
          }
        );
      }

      // Check if AI returned an error
      if (extractedParams.error) {
        return createErrorResponse(
          {
            code: 'INVALID_PARAMS',
            message: extractedParams.error,
            recoverable: true,
          },
          {
            operation: 'executeWithAI',
            integration: tool.schema.integration,
          }
        );
      }

      // If extractedParams is empty or only has optional params, fill in defaults
      if (!extractedParams || Object.keys(extractedParams).length === 0) {
        extractedParams = {};
      }

      // Apply default values for optional parameters that weren't extracted
      tool.schema.parameters.forEach(param => {
        if (!param.required && param.default !== undefined && extractedParams[param.name] === undefined) {
          extractedParams[param.name] = param.default;
        }
      });

      // Execute the tool with extracted parameters
      const result = await this.executeTool(userId, toolName, extractedParams);

      // Add AI-generated response message if successful
      if (result.success && result.data) {
        const responsePrompt = `Generate a natural language response for the successful execution of "${toolName}".
Result data: ${JSON.stringify(result.data, null, 2)}
Keep it concise and friendly.`;

        const aiResponse = await model.invoke([
          new SystemMessage(responsePrompt),
          new HumanMessage('Generate response'),
        ]);

        result.data.message = aiResponse.content.toString();
      }

      return result;
    } catch (error) {
      loggingService.error('Failed to execute tool with AI', {
        userId,
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });

      return createErrorResponse(
        {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'AI tool execution failed',
          recoverable: true,
        },
        { operation: 'executeWithAI' }
      );
    }
  }

  /**
   * Clear user's MCP session
   */
  static clearUserSession(userId: string): void {
    this.authContexts.delete(userId);
    this.mcpServers.delete(userId);
  }
}