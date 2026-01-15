/**
 * Universal MCP Server
 * Main server that handles MCP protocol and routes to integration servers
 */

import {
  MCPMessage,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPCapabilities,
  MCPToolCallResponse,
} from './types/mcp.types';
import { BaseTransport } from './transports/base.transport';
import { StdioTransport } from './transports/stdio.transport';
import { SSETransport } from './transports/sse.transport';
import { MCPAuthService, MCPAuthContext } from './auth/mcp-auth';
import { TokenManager } from './auth/token-manager';
import { ToolRegistry } from './registry/tool-registry';
import { validateToolParameters } from './types/tool-schema';
import { createSuccessResponse, createErrorResponse } from './types/standard-response';
import { AuditLogger } from './utils/audit-logger';
import { RateLimiter } from './utils/rate-limiter';
import { createMCPError } from './utils/error-mapper';
import { loggingService } from '../services/logging.service';

export interface MCPServerConfig {
  name: string;
  version: string;
  transport: 'stdio' | 'sse';
  sseTransport?: SSETransport; // Provided if using SSE
}

export class MCPServer {
  private transport: BaseTransport | SSETransport;
  private authContext?: MCPAuthContext;
  private initialized = false;
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;

    // Create transport
    if (config.transport === 'stdio') {
      this.transport = new StdioTransport();
    } else if (config.transport === 'sse' && config.sseTransport) {
      this.transport = config.sseTransport;
    } else {
      throw new Error('Invalid transport configuration');
    }

    loggingService.info('MCP Server created', {
      name: config.name,
      version: config.version,
      transport: config.transport,
    });
  }

  /**
   * Start the server
   * @param userId - User ID from JWT token authentication (optional for initialization)
   */
  async start(userId?: string): Promise<void> {
    if (userId) {
      // Authenticate on startup with userId
      const auth = await MCPAuthService.authenticate(userId);
      if (!auth) {
        throw new Error('Authentication failed');
      }
      this.authContext = auth;
    }

    // Setup message handler
    this.transport.on('message', this.handleMessage.bind(this));
    this.transport.on('error', this.handleError.bind(this));
    this.transport.on('close', this.handleClose.bind(this));

    loggingService.info('MCP Server started', {
      authenticated: !!this.authContext,
      userId: this.authContext?.userId,
    });

    // Start message loop (for stdio)
    if (this.config.transport === 'stdio') {
      this.startMessageLoop();
    }
  }

  /**
   * Message loop for stdio transport
   */
  private async startMessageLoop(): Promise<void> {
    while (!this.transport.isClosed()) {
      try {
        const message = await this.transport.receive();
        await this.handleMessage(message);
      } catch (error) {
        if (!this.transport.isClosed()) {
          loggingService.error('Message loop error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
    }
  }

  /**
   * Handle incoming MCP message
   */
  private async handleMessage(message: MCPMessage): Promise<void> {
    loggingService.debug('MCP message received', {
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
          response = await this.handleToolsList(message);
          break;

        case 'tools/call':
          response = await this.handleToolsCall(message);
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

      await this.transport.send(response);
    } catch (error) {
      loggingService.error('Failed to handle message', {
        error: error instanceof Error ? error.message : String(error),
        method: message.method,
      });

      await this.transport.send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      });
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(message: MCPMessage): Promise<MCPMessage> {
    const params = message.params as MCPInitializeParams;

    loggingService.info('MCP initialize', {
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
        name: this.config.name,
        version: this.config.version,
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
  private async handleToolsList(message: MCPMessage): Promise<MCPMessage> {
    if (!this.ensureInitialized()) {
      return this.createError(message.id, -32002, 'Server not initialized');
    }

    if (!this.authContext) {
      return this.createError(message.id, -32001, 'Not authenticated');
    }

    // Get tools filtered by user's integrations
    const tools = ToolRegistry.toMCPDefinitions(this.authContext.integrations);

    loggingService.info('Tools list requested', {
      userId: this.authContext.userId,
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
  private async handleToolsCall(message: MCPMessage): Promise<MCPMessage> {
    if (!this.ensureInitialized()) {
      return this.createError(message.id, -32002, 'Server not initialized');
    }

    if (!this.authContext) {
      return this.createError(message.id, -32001, 'Not authenticated');
    }

    const startTime = Date.now();
    const params = message.params as { name: string; arguments: Record<string, any> };
    const { name: toolName, arguments: toolArgs } = params;
    let schema: any = null;

    try {
      // Get tool
      const tool = ToolRegistry.getTool(toolName);
      if (!tool) {
        return this.createError(message.id, -32602, `Tool not found: ${toolName}`);
      }

      schema = tool.schema;
      const { handler } = tool;

      // Validate parameters
      const validation = validateToolParameters(toolArgs, schema);
      if (!validation.valid) {
        const errors = validation.errors!.map(e => `${e.parameter}: ${e.message}`).join('; ');
        return this.createError(message.id, -32602, `Invalid parameters: ${errors}`);
      }

      // Check integration access
      const hasAccess = await MCPAuthService.validateIntegrationAccess(
        this.authContext.userId,
        schema.integration
      );

      if (!hasAccess) {
        return this.createError(
          message.id,
          -32001,
          `No active ${schema.integration} connection`
        );
      }

      // Get connection ID
      const connectionId = await MCPAuthService.getConnectionId(
        this.authContext.userId,
        schema.integration
      );

      if (!connectionId) {
        return this.createError(
          message.id,
          -32001,
          `Could not find ${schema.integration} connection`
        );
      }

      // Check rate limit
      const rateLimit = await RateLimiter.checkRateLimit(
        this.authContext.userId,
        schema.integration,
        schema.httpMethod,
        toolName
      );

      if (!rateLimit.allowed) {
        return this.createError(
          message.id,
          429,
          `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`
        );
      }

      // Refresh token if needed
      await TokenManager.refreshIfNeeded(connectionId, schema.integration);

      // Execute tool
      const result = await handler(toolArgs, {
        userId: this.authContext.userId,
        connectionId,
        integration: schema.integration,
        permissions: [], // Will be filled by permission system
        scopes: [], // Will be filled by permission system
        isAdmin: this.authContext.isAdmin,
      });

      const latency = Date.now() - startTime;

      // Create success response
      const toolResponse = createSuccessResponse(result, {
        integration: schema.integration,
        operation: toolName,
        latency,
        httpMethod: schema.httpMethod,
        permissionChecked: true,
        dangerousOperation: schema.dangerous,
        userId: this.authContext.userId,
        connectionId,
      });

      // Audit log
      await AuditLogger.logExecution(
        this.authContext.userId,
        schema.integration,
        toolName,
        schema.httpMethod,
        toolArgs,
        toolResponse,
        { connectionId }
      );

      // Convert to MCP response format
      const mcpResponse: MCPToolCallResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(toolResponse),
          },
        ],
        isError: false,
      };

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: mcpResponse,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      loggingService.error('Tool execution error', {
        error: error instanceof Error ? error.message : String(error),
        toolName,
        userId: this.authContext.userId,
      });

      const toolResponse = createErrorResponse(
        createMCPError(error),
        {
          integration: schema?.integration || 'unknown',
          operation: toolName,
          latency,
          httpMethod: schema?.httpMethod || 'GET',
          permissionChecked: true,
        }
      );

      const mcpResponse: MCPToolCallResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(toolResponse),
          },
        ],
        isError: true,
      };

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
   * Handle error
   */
  private handleError(error: Error): void {
    loggingService.error('MCP transport error', {
      error: error.message,
    });
  }

  /**
   * Handle close
   */
  private handleClose(): void {
    loggingService.info('MCP Server closed');
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
   * Stop the server
   */
  async stop(): Promise<void> {
    await this.transport.close();
    loggingService.info('MCP Server stopped');
  }
}
