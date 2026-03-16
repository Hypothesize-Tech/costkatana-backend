import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../cache/cache.service';
import { LoggingService } from '../services/logging.service';

declare global {
  namespace Express {
    interface Request {
      mcpContext?: {
        startTime: number;
        protocol?: string;
        clientInfo?: any;
      };
    }
  }
}

/**
 * MCP Middleware
 * Handles MCP (Model Context Protocol) request validation, connection monitoring,
 * and response timing for NestJS backend
 */
@Injectable()
export class MCPMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MCPMiddleware.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    this.logger.debug('MCP middleware activated', {
      path: req.path,
      method: req.method,
      hasBody: req.body && Object.keys(req.body).length > 0,
    });

    try {
      // Initialize MCP context
      req.mcpContext = {
        startTime,
        protocol: '2.0',
      };

      // Validate MCP request for POST requests
      if (req.method === 'POST') {
        const validationResult = await this.validateMCPRequest(req);
        if (!validationResult.valid) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: validationResult.error,
          });
          return;
        }
      }

      // Track MCP client connection
      await this.trackMCPConnection(req);

      // Set up response timing
      this.setupResponseTiming(req, res, startTime);

      next();
    } catch (error) {
      this.logger.error('MCP middleware error', {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
        method: req.method,
      });

      // Continue without MCP processing on error
      req.mcpContext = { startTime };
      next();
    }
  }

  /**
   * Validate MCP request structure
   */
  private async validateMCPRequest(req: Request): Promise<{
    valid: boolean;
    error?: { code: number; message: string };
  }> {
    const { jsonrpc, method } = req.body;

    // Validate JSON-RPC version
    if (jsonrpc !== '2.0') {
      this.logger.warn('Invalid JSON-RPC version', {
        received: jsonrpc,
        expected: '2.0',
        path: req.path,
      });

      await this.recordMCPError(req, 'invalid_jsonrpc_version');
      return {
        valid: false,
        error: {
          code: -32600,
          message: 'Invalid Request - JSON-RPC version must be 2.0',
        },
      };
    }

    // Validate method presence
    if (!method || typeof method !== 'string') {
      this.logger.warn('Missing or invalid method', {
        method,
        type: typeof method,
        path: req.path,
      });

      await this.recordMCPError(req, 'missing_method');
      return {
        valid: false,
        error: {
          code: -32600,
          message: 'Invalid Request - method is required',
        },
      };
    }

    // Fast path for high-frequency requests
    if (['tools/list', 'resources/list', 'prompts/list'].includes(method)) {
      this.logger.debug('High-frequency MCP request', {
        method,
        path: req.path,
      });
      return { valid: true };
    }

    this.logger.debug('MCP request validation successful', {
      method,
      jsonrpc,
      path: req.path,
    });

    return { valid: true };
  }

  /**
   * Track MCP client connection
   */
  private async trackMCPConnection(req: Request): Promise<void> {
    const clientId =
      (req.headers['x-mcp-client-id'] as string) || req.ip || 'unknown';

    try {
      const connectionKey = `mcp_connection:${clientId}`;
      const existingConnection = await this.cacheService.get(connectionKey);

      if (!existingConnection) {
        // Track new connection
        await this.cacheService.set(
          connectionKey,
          {
            lastActivity: Date.now(),
            errorCount: 0,
            requestCount: 0,
            connectedAt: Date.now(),
          },
          3600,
        ); // 1 hour TTL

        this.logger.debug('New MCP client connection tracked', { clientId });
      } else {
        // Update activity
        const connectionData = existingConnection as any;
        connectionData.lastActivity = Date.now();
        connectionData.requestCount = (connectionData.requestCount || 0) + 1;

        await this.cacheService.set(connectionKey, connectionData, 3600);

        this.logger.debug('MCP client activity updated', {
          clientId,
          requestCount: connectionData.requestCount,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to track MCP client connection', {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Set up response timing monitoring
   */
  private setupResponseTiming(
    req: Request,
    res: Response,
    startTime: number,
  ): void {
    const originalSend = res.send.bind(res);

    res.send = (data: any) => {
      if (req.mcpContext) {
        const duration = Date.now() - startTime;
        const method = req.body?.method || 'unknown';

        // Only log timing for non-high-frequency requests or slow requests
        if (
          !['tools/list', 'resources/list', 'prompts/list'].includes(method) ||
          duration > 1000
        ) {
          this.logger.debug('MCP response timing', {
            method,
            duration,
            path: req.path,
            statusCode: res.statusCode,
            isSlowRequest: duration > 1000,
          });
        }
      }

      return originalSend(data);
    };
  }

  /**
   * Record MCP validation error
   */
  private async recordMCPError(req: Request, errorType: string): Promise<void> {
    const clientId =
      (req.headers['x-mcp-client-id'] as string) || req.ip || 'unknown';

    try {
      const connectionKey = `mcp_connection:${clientId}`;
      const connectionData = (await this.cacheService.get(
        connectionKey,
      )) as any;

      if (connectionData) {
        connectionData.errorCount = (connectionData.errorCount || 0) + 1;
        await this.cacheService.set(connectionKey, connectionData, 3600);

        this.logger.debug('MCP error recorded', {
          clientId,
          errorType,
          errorCount: connectionData.errorCount,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to record MCP error', {
        clientId,
        errorType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * MCP Rate Limiting Middleware
 */
@Injectable()
export class MCPRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MCPRateLimitMiddleware.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const maxRequests = 100; // Configurable
    const windowMs = 60000; // 1 minute

    const clientId =
      (req.headers['x-mcp-client-id'] as string) || req.ip || 'unknown';
    const now = Date.now();
    const cacheKey = `mcp_rate_limit:${clientId}`;

    try {
      // Track connection
      await this.trackMCPConnection(req);

      // Get current rate limit record
      const record = await this.cacheService.get(cacheKey) as
        | { count: number; resetTime: number }
        | undefined
        | null;

      let currentRecord: { count: number; resetTime: number };

      if (!record || record.resetTime < now) {
        // Create new record
        currentRecord = {
          count: 1,
          resetTime: now + windowMs,
        };
      } else {
        // Increment existing record
        currentRecord = {
          count: record.count + 1,
          resetTime: record.resetTime,
        };
      }

      // Check if limit exceeded
      if (currentRecord.count > maxRequests) {
        const retryAfter = Math.ceil((currentRecord.resetTime - now) / 1000);

        this.logger.warn('MCP rate limit exceeded', {
          clientId,
          count: currentRecord.count,
          maxRequests,
          retryAfter,
        });

        // Record error
        await this.recordMCPError(req);

        res.status(429).json({
          error: 'MCP rate limit exceeded',
          message: 'Too many MCP requests, please try again later.',
          retryAfter,
        });
        return;
      }

      // Store updated record
      const ttl = Math.ceil((currentRecord.resetTime - now) / 1000);
      await this.cacheService.set(cacheKey, currentRecord, ttl);

      this.logger.debug('MCP rate limit check passed', {
        clientId,
        count: currentRecord.count,
        remaining: maxRequests - currentRecord.count,
      });

      next();
    } catch (error) {
      this.logger.error('MCP rate limit middleware error', {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fail open
      next();
    }
  }

  /**
   * Track MCP client connection (duplicate from main middleware, but needed for rate limiting)
   */
  private async trackMCPConnection(req: Request): Promise<void> {
    const clientId =
      (req.headers['x-mcp-client-id'] as string) || req.ip || 'unknown';

    try {
      const connectionKey = `mcp_connection:${clientId}`;
      const existingConnection = await this.cacheService.get(connectionKey);

      if (!existingConnection) {
        await this.cacheService.set(
          connectionKey,
          {
            lastActivity: Date.now(),
            errorCount: 0,
            requestCount: 0,
            connectedAt: Date.now(),
          },
          3600,
        );
      } else {
        const connectionData = existingConnection as any;
        connectionData.lastActivity = Date.now();
        connectionData.requestCount = (connectionData.requestCount || 0) + 1;
        await this.cacheService.set(connectionKey, connectionData, 3600);
      }
    } catch (error) {
      this.logger.warn('Failed to track MCP connection in rate limiter', {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record MCP error for rate limiting
   */
  private async recordMCPError(req: Request): Promise<void> {
    const clientId =
      (req.headers['x-mcp-client-id'] as string) || req.ip || 'unknown';

    try {
      const connectionKey = `mcp_connection:${clientId}`;
      const connectionData = (await this.cacheService.get(
        connectionKey,
      )) as any;

      if (connectionData) {
        connectionData.errorCount = (connectionData.errorCount || 0) + 1;
        await this.cacheService.set(connectionKey, connectionData, 3600);
      }
    } catch (error) {
      this.logger.warn('Failed to record MCP error in rate limiter', {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
