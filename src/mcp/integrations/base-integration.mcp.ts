/**
 * Base Integration MCP Server
 * Abstract base class for all integration MCP servers
 */

import { IntegrationType } from '../types/permission.types';
import { ToolSchema, ToolExecutionContext, ToolHandler } from '../types/tool-schema';
import { ToolRegistry } from '../registry/tool-registry';
import { PermissionValidator } from '../permissions/permission-validator';
import { createSuccessResponse, createErrorResponse } from '../types/standard-response';
import { createMCPError } from '../utils/error-mapper';
import { loggingService } from '../../services/logging.service';

export abstract class BaseIntegrationMCP {
  protected integration: IntegrationType;
  protected version: string;

  constructor(integration: IntegrationType, version: string = '1.0.0') {
    this.integration = integration;
    this.version = version;
  }

  /**
   * Initialize and register all tools
   */
  abstract registerTools(): void;

  /**
   * Helper to register a tool
   */
  protected registerTool(
    schema: ToolSchema,
    handler: (params: any, context: ToolExecutionContext) => Promise<any>
  ): void {
    const wrappedHandler: ToolHandler = async (params, context) => {
      const startTime = Date.now();

      try {
        // Use permission validator to check permissions and execute
        return await PermissionValidator.validateAndExecute(
          schema.name,
          schema.httpMethod,
          schema.integration,
          context,
          async (ctx) => {
            // Call the actual handler
            const result = await handler(params, ctx);

            // Wrap in standard response
            return createSuccessResponse(result, {
              integration: schema.integration,
              operation: schema.name,
              latency: Date.now() - startTime,
              httpMethod: schema.httpMethod,
              permissionChecked: true,
              dangerousOperation: schema.dangerous,
              userId: ctx.userId,
              connectionId: ctx.connectionId,
            });
          },
          params.resourceId
        );
      } catch (error) {
        loggingService.error('Tool handler error', {
          error: error instanceof Error ? error.message : String(error),
          toolName: schema.name,
          integration: schema.integration,
        });

        return createErrorResponse(
          createMCPError(error),
          {
            integration: schema.integration,
            operation: schema.name,
            latency: Date.now() - startTime,
            httpMethod: schema.httpMethod,
            permissionChecked: true,
            dangerousOperation: schema.dangerous,
          }
        );
      }
    };

    ToolRegistry.registerTool(schema, wrappedHandler, {
      enabled: true,
    });

    loggingService.debug('Tool registered', {
      name: schema.name,
      integration: schema.integration,
      httpMethod: schema.httpMethod,
    });
  }

  /**
   * Get connection access token by calling the model's decryptToken method
   */
  protected async getAccessToken(connectionId: string): Promise<string> {
    const mongoose = await import('mongoose');
    const Types = mongoose.Types;
    
    try {
      switch (this.integration) {
        case 'vercel': {
          const { VercelConnection } = await import('../../models/VercelConnection');
          const connection = await VercelConnection.findById(new Types.ObjectId(connectionId)).select('+accessToken');
          if (!connection) {
            throw new Error(`Vercel connection not found for ID: ${connectionId}`);
          }
          if (!connection.isActive) {
            throw new Error(`Vercel connection is not active`);
          }
          return connection.decryptToken();
        }
        
        case 'github': {
          const { GitHubConnection } = await import('../../models/GitHubConnection');
          const connection = await GitHubConnection.findById(new Types.ObjectId(connectionId)).select('+accessToken');
          if (!connection) {
            throw new Error(`GitHub connection not found for ID: ${connectionId}`);
          }
          if (!connection.isActive) {
            throw new Error(`GitHub connection is not active`);
          }
          return connection.decryptToken();
        }
        
        case 'google': {
          const { GoogleConnection } = await import('../../models/GoogleConnection');
          const connection = await GoogleConnection.findById(new Types.ObjectId(connectionId)).select('+accessToken');
          if (!connection) {
            throw new Error(`Google connection not found for ID: ${connectionId}`);
          }
          if (!connection.isActive) {
            throw new Error(`Google connection is not active`);
          }
          return connection.decryptToken();
        }
        
        case 'mongodb': {
          const { MongoDBConnection } = await import('../../models/MongoDBConnection');
          const connection = await MongoDBConnection.findById(new Types.ObjectId(connectionId));
          if (!connection) {
            throw new Error(`MongoDB connection not found for ID: ${connectionId}`);
          }
          if (!connection.isActive) {
            throw new Error(`MongoDB connection is not active`);
          }
          // MongoDB stores connection string, not access token
          return connection.connectionString || '';
        }
        
        case 'aws': {
          const { AWSConnection } = await import('../../models/AWSConnection');
          const connection = await AWSConnection.findById(new Types.ObjectId(connectionId));
          if (!connection) {
            throw new Error(`AWS connection not found for ID: ${connectionId}`);
          }
          if (connection.status !== 'active') {
            throw new Error(`AWS connection is not active`);
          }
          // AWS connections don't have encrypted access tokens in the same way
          // Return empty string or implement AWS credential retrieval if needed
          return '';
        }
        
        default: {
          // For generic integrations (Slack, Discord, Jira, Linear)
          const { Integration } = await import('../../models/Integration');
          const connection = await Integration.findById(new Types.ObjectId(connectionId));
          if (!connection) {
            throw new Error(`${this.integration} connection not found for ID: ${connectionId}`);
          }
          if (connection.status !== 'active') {
            throw new Error(`${this.integration} connection is not active`);
          }
          // Generic integrations use getCredentials() method
          const credentials = connection.getCredentials();
          return credentials?.accessToken || '';
        }
      }
    } catch (error) {
      loggingService.error('Failed to get access token', {
        integration: this.integration,
        connectionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Make authenticated HTTP request with automatic token refresh
   */
  protected async makeRequest(
    connectionId: string,
    method: string,
    url: string,
    options: {
      body?: any;
      headers?: Record<string, string>;
      params?: Record<string, any>;
      timeout?: number;
      maxRetries?: number;
    } = {}
  ): Promise<any> {
    const axios = (await import('axios')).default;
    
    // Check and refresh token if needed (before first request)
    if (this.integration === 'google' || this.integration === 'github' || this.integration === 'jira' || this.integration === 'linear' || this.integration === 'slack' || this.integration === 'discord') {
      try {
        const { TokenManager } = await import('../auth/token-manager');
        await TokenManager.refreshIfNeeded(connectionId, this.integration);
      } catch (refreshError) {
        loggingService.warn('Token refresh check failed, proceeding with existing token', {
          integration: this.integration,
          connectionId,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
      }
    }

    const accessToken = await this.getAccessToken(connectionId);

    const config: any = {
      method,
      url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
      timeout: options.timeout || 300000, // 5 minute timeout by default
      validateStatus: (status: number) => status >= 200 && status < 300, // Only accept 2xx
    };

    if (options.body) {
      config.data = options.body;
    }

    if (options.params) {
      config.params = options.params;
    }

    // Retry logic
    const maxRetries = options.maxRetries || 2;
    let lastError: any;
    let tokenRefreshed = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        loggingService.info(`MCP HTTP request attempt ${attempt + 1}/${maxRetries + 1}`, {
          integration: this.integration,
          method,
          url: url.replace(/\?.*/,''), // Remove query params from log
        });

        const response = await axios(config);
        
        loggingService.info('MCP HTTP request successful', {
          integration: this.integration,
          method,
          url: url.replace(/\?.*/,''),
          status: response.status,
          attempt: attempt + 1,
        });

        return response.data;
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a 401 Unauthorized error - attempt token refresh once
        const is401 = error.response?.status === 401;
        const isRetryable = 
          error.code === 'ECONNABORTED' || // Timeout
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNRESET' ||
          (error.response?.status >= 500 && error.response?.status < 600); // Server errors

        loggingService.error(`MCP HTTP request failed (attempt ${attempt + 1}/${maxRetries + 1})`, {
          error: error.message,
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          integration: this.integration,
          method,
          url: url.replace(/\?.*/,''),
          isRetryable,
          is401,
          tokenRefreshed,
        });

        // If 401 and we haven't tried refreshing token yet, attempt to refresh
        if (is401 && !tokenRefreshed && (this.integration === 'google' || this.integration === 'github' || this.integration === 'jira' || this.integration === 'linear' || this.integration === 'slack' || this.integration === 'discord')) {
          try {
            loggingService.info('Attempting to refresh token due to 401 error', {
              integration: this.integration,
              connectionId,
            });
            
            const { TokenManager } = await import('../auth/token-manager');
            const refreshed = await TokenManager.refreshIfNeeded(connectionId, this.integration);
            
            if (refreshed) {
              // Get the new access token
              const newAccessToken = await this.getAccessToken(connectionId);
              config.headers.Authorization = `Bearer ${newAccessToken}`;
              tokenRefreshed = true;
              
              loggingService.info('Token refreshed successfully, retrying request', {
                integration: this.integration,
              });
              
              // Retry immediately with new token (don't count against retry limit)
              continue;
            } else {
              loggingService.warn('Token refresh returned false, connection may need manual re-authorization', {
                integration: this.integration,
                connectionId,
              });
            }
          } catch (refreshError) {
            loggingService.error('Token refresh failed', {
              integration: this.integration,
              connectionId,
              error: refreshError instanceof Error ? refreshError.message : String(refreshError),
            });
          }
        }

        // Handle 410 Gone - resource no longer exists (e.g., JIRA workspace deleted)
        if (error.response?.status === 410) {
          loggingService.error(`${this.integration} resource no longer exists (410 Gone)`, {
            integration: this.integration,
            connectionId,
            url: url.replace(/\?.*/,''),
          });
          throw new Error(`${this.integration.toUpperCase()} workspace or resource no longer exists. Please reconnect your ${this.integration.toUpperCase()} account from the integrations page.`);
        }

        // Don't retry on last attempt or non-retryable errors (unless it's a 401 we just refreshed)
        if (attempt === maxRetries || (!isRetryable && !is401)) {
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt) * 1000;
        loggingService.info(`Retrying after ${backoffMs}ms...`, {
          integration: this.integration,
          attempt: attempt + 1,
        });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    // All retries failed, throw the last error
    throw new Error(
      `${this.integration} API request failed: ${lastError.message} (status: ${lastError.response?.status || 'none'})`
    );
  }
}
