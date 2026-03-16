/**
 * MCP Server Service
 * Handles MCP protocol message routing and execution
 */

import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { BusinessEventLoggingService } from '../../../common/services/business-event-logging.service';
import {
  MCPMessage,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPCapabilities,
  MCPToolCallResponse,
  MCPAuthContext,
} from '../types/mcp.types';
import { McpAuthService } from './mcp-auth.service';
import { ToolRegistryService } from './tool-registry.service';
import { RateLimiterService } from './rate-limiter.service';
import { TokenManagerService } from './token-manager.service';
import { McpPermissionService } from './mcp-permission.service';
import { OAuthScopeMapperService } from './oauth-scope-mapper.service';
import {
  createSuccessResponse,
  createErrorResponse,
} from '../utils/standard-response';
import { createMCPError } from '../utils/error-mapper';
import { validateToolParameters } from '../utils/tool-validation';

@Injectable()
export class McpServerService {
  private initialized = false;

  constructor(
    private logger: LoggerService,
    private businessEventLogger: BusinessEventLoggingService,
    private authService: McpAuthService,
    private toolRegistry: ToolRegistryService,
    private rateLimiter: RateLimiterService,
    private tokenManager: TokenManagerService,
    private permissionService: McpPermissionService,
    private oauthScopeMapper: OAuthScopeMapperService,
  ) {}

  /**
   * Handle incoming MCP message
   */
  async handleMessage(
    message: MCPMessage,
    authContext: MCPAuthContext,
    connectionId?: string,
  ): Promise<MCPMessage> {
    this.logger.debug('MCP message received', {
      method: message.method,
      id: message.id,
    });

    try {
      let response: MCPMessage;

      switch (message.method) {
        case 'initialize':
          response = await this.handleInitialize(message);
          break;

        case 'tools/list':
          response = await this.handleToolsList(message, authContext);
          break;

        case 'tools/call':
          response = await this.handleToolsCall(
            message,
            authContext,
            connectionId,
          );
          break;

        case 'resources/list':
          response = await this.handleResourcesList(message);
          break;

        case 'ping':
          response = {
            jsonrpc: '2.0',
            id: message.id,
            result: { ok: true },
          };
          break;

        default:
          response = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: `Method not found: ${message.method}`,
            },
          };
      }

      return response;
    } catch (error) {
      this.logger.error('Failed to handle MCP message', {
        error: error instanceof Error ? error.message : String(error),
        method: message.method,
        id: message.id,
      });

      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      };
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(message: MCPMessage): Promise<MCPMessage> {
    const params = message.params as MCPInitializeParams;

    this.logger.log('MCP initialize', {
      clientName: params.clientInfo.name,
      clientVersion: params.clientInfo.version,
      protocolVersion: params.protocolVersion,
    });

    const capabilities: MCPCapabilities = {
      tools: {
        listChanged: false,
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
    };

    const result: MCPInitializeResult = {
      protocolVersion: '2024-11-05',
      capabilities,
      serverInfo: {
        name: 'Cost Katana MCP Server',
        version: '1.0.0',
      },
    };

    this.initialized = true;

    return {
      jsonrpc: '2.0',
      id: message.id,
      result,
    };
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(
    message: MCPMessage,
    authContext: MCPAuthContext,
  ): Promise<MCPMessage> {
    if (!this.ensureInitialized()) {
      return this.createError(message.id, -32002, 'Server not initialized');
    }

    // Get tools filtered by user's integrations
    const tools = this.toolRegistry.toMCPDefinitions(authContext.integrations);

    this.logger.log('Tools list requested', {
      userId: authContext.userId,
      toolCount: tools.length,
    });

    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools,
      },
    };
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(
    message: MCPMessage,
    authContext: MCPAuthContext,
    connectionId?: string,
  ): Promise<MCPMessage> {
    if (!this.ensureInitialized()) {
      return this.createError(message.id, -32002, 'Server not initialized');
    }

    const startTime = Date.now();
    const params = message.params as {
      name: string;
      arguments: Record<string, any>;
    };
    const { name: toolName, arguments: toolArgs } = params;

    try {
      // Get tool
      const tool = this.toolRegistry.getTool(toolName);
      if (!tool) {
        return this.createError(
          message.id,
          -32602,
          `Tool not found: ${toolName}`,
        );
      }

      const schema = tool.schema;

      // Validate parameters
      const validation = validateToolParameters(toolArgs, schema);
      if (!validation.valid) {
        const errors = validation
          .errors!.map((e) => `${e.parameter}: ${e.message}`)
          .join('; ');
        return this.createError(
          message.id,
          -32602,
          `Invalid parameters: ${errors}`,
        );
      }

      // Check integration access
      const hasAccess = await this.authService.validateIntegrationAccess(
        authContext.userId,
        schema.integration,
      );

      if (!hasAccess) {
        return this.createError(
          message.id,
          -32001,
          `No active ${schema.integration} connection`,
        );
      }

      // Get connection ID
      const connId = await this.authService.getConnectionId(
        authContext.userId,
        schema.integration,
      );

      if (!connId) {
        return this.createError(
          message.id,
          -32001,
          `Could not find ${schema.integration} connection`,
        );
      }

      // Check rate limit
      const rateLimit = await this.rateLimiter.checkRateLimit(
        authContext.userId,
        schema.integration,
        schema.httpMethod,
        toolName,
      );

      if (!rateLimit.allowed) {
        return this.createError(
          message.id,
          429,
          `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        );
      }

      // Refresh token if needed
      await this.tokenManager.refreshIfNeeded(connId, schema.integration);

      // Get user permissions and OAuth scopes for the integration
      const userPermissions = await this.permissionService.getUserPermissions(
        authContext.userId,
      );
      const integrationPermissions = userPermissions.filter(
        (p) => p.integration === schema.integration,
      );
      const oauthScopes = await this.oauthScopeMapper.getScopesForIntegration(
        schema.integration,
        authContext.userId,
      );

      // Extract tool names from permissions for context
      const permissionTools = integrationPermissions.flatMap(
        (p) => p.permissions?.tools || [],
      );

      // Create tool execution context
      const context = {
        userId: authContext.userId,
        connectionId: connId,
        integration: schema.integration,
        permissions: permissionTools,
        scopes: oauthScopes,
        isAdmin: authContext.isAdmin,
      };

      // Execute tool
      const result = await this.toolRegistry.executeTool(
        toolName,
        toolArgs,
        context,
      );

      const latency = Date.now() - startTime;

      // Create MCP response format
      const mcpResponse: MCPToolCallResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        isError: false,
      };

      // Log successful execution
      await this.businessEventLogger.logBusiness({
        event: 'mcp_tool_execution',
        category: 'tool_execution',
        metadata: {
          toolName,
          integration: schema.integration,
          userId: authContext.userId,
          connectionId: connId,
          latency,
          success: true,
        },
      });

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: mcpResponse,
      };
    } catch (error) {
      const latency = Date.now() - startTime;

      this.logger.error('Tool execution error', {
        error: error instanceof Error ? error.message : String(error),
        toolName,
        userId: authContext.userId,
      });

      const toolError = createMCPError(error);
      const errorResponse = createErrorResponse(toolError, {
        integration: 'unknown',
        operation: toolName,
        latency,
        httpMethod: 'GET',
        permissionChecked: true,
      });

      const mcpResponse: MCPToolCallResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(errorResponse),
          },
        ],
        isError: true,
      };

      // Log failed execution
      await this.businessEventLogger.logBusiness({
        event: 'mcp_tool_execution',
        category: 'tool_execution',
        metadata: {
          toolName,
          userId: authContext.userId,
          latency,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: mcpResponse,
      };
    }
  }

  /**
   * Handle resources/list request
   */
  private async handleResourcesList(message: MCPMessage): Promise<MCPMessage> {
    if (!this.ensureInitialized()) {
      return this.createError(message.id, -32002, 'Server not initialized');
    }

    // No resources exposed yet
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        resources: [],
      },
    };
  }

  /**
   * Ensure server is initialized
   */
  private ensureInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Create error response
   */
  private createError(id: any, code: number, message: string): MCPMessage {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    };
  }

  /**
   * Get server capabilities
   */
  getCapabilities(): MCPCapabilities {
    return {
      tools: {
        listChanged: false,
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
    };
  }

  /**
   * Check if server is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset server state (for testing)
   */
  reset(): void {
    this.initialized = false;
    this.logger.log('MCP Server reset');
  }
}
