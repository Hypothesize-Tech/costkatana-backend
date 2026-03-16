import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

interface ClientInfo {
  ip: string;
  port?: number;
  forwardedIPs: string[];
  userAgent: string;
  geoLocation?: {
    country: string;
    region: string;
    city: string;
  };
  sdkVersion?: string;
  environment?: string;
}

interface Headers {
  request: Record<string, string>;
  response: Record<string, string>;
}

interface Networking {
  serverEndpoint: string;
  serverFullUrl?: string;
  clientOrigin?: string;
  serverIP: string;
  serverPort: number;
  routePattern: string;
  protocol: string;
  secure: boolean;
  dnsLookupTime?: number;
  tcpConnectTime?: number;
  tlsHandshakeTime?: number;
}

interface Payload {
  requestBody?: any;
  responseBody?: any;
  requestSize: number;
  responseSize: number;
  contentType: string;
  encoding?: string;
  compressionRatio?: number;
}

interface Performance {
  clientSideTime?: number;
  networkTime: number;
  serverProcessingTime: number;
  totalRoundTripTime: number;
  dataTransferEfficiency: number;
}

interface RequestTracking {
  clientInfo: ClientInfo;
  headers: Headers;
  networking: Networking;
  payload: Payload;
  performance: Performance;
}

@Injectable()
export class ComprehensiveTrackingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ComprehensiveTrackingMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req as any).requestId || uuidv4();

    // Skip health checks and static files
    if (this.shouldSkipTracking(req)) {
      return next();
    }

    // Skip SSE/streaming endpoints (incremental writes; response lifecycle differs)
    const url = req.originalUrl || req.url || req.path || '';
    if (
      url.includes('comparison-progress') ||
      url.includes('/stream/') ||
      url.includes('/messages/') ||
      url.includes('/upload-progress/')
    ) {
      return next();
    }

    try {
      this.logger.debug(
        `Starting comprehensive tracking for request ${requestId}`,
      );

      // Capture request start time
      (req as any).trackingStartTime = startTime;

      // Extract client information
      const clientInfo = this.extractClientInfo(req);

      // Extract networking information
      const networking = this.extractNetworkingInfo(req);

      // Extract request headers
      const headers: Headers = {
        request: this.sanitizeHeaders(req.headers as Record<string, string>),
        response: {}, // Will be filled on response
      };

      // Estimate request payload size
      const payload: Payload = {
        requestBody: this.shouldCaptureBody(req)
          ? this.sanitizeBody(req.body)
          : undefined,
        requestSize: this.estimatePayloadSize(req.body),
        responseSize: 0, // Will be updated on response
        contentType: req.headers['content-type'] || 'application/json',
        encoding: req.headers['content-encoding'],
        compressionRatio: undefined,
      };

      // Initialize performance tracking
      const performance: Performance = {
        networkTime: 0, // Will be calculated
        serverProcessingTime: 0, // Will be calculated
        totalRoundTripTime: 0, // Will be calculated
        dataTransferEfficiency: 0, // Will be calculated
      };

      // Create initial tracking object
      const requestTracking: RequestTracking = {
        clientInfo,
        headers,
        networking,
        payload,
        performance,
      };

      // Store tracking data on request
      (req as any).requestTracking = requestTracking;
      (req as any).correlationId = requestId;

      // Set correlation ID in response headers
      res.setHeader('x-correlation-id', requestId);

      // Hook into response to capture response data
      this.captureResponseData(req, res, requestTracking, startTime);

      this.logger.debug(
        `Comprehensive tracking initialized for request ${requestId}`,
      );
      next();
    } catch (error) {
      this.logger.error(
        `Failed to initialize comprehensive tracking for request ${requestId}`,
        error,
      );
      next();
    }
  }

  /**
   * Extract client information from request
   */
  private extractClientInfo(req: Request): ClientInfo {
    const clientIP = this.getClientIP(req);
    const forwardedIPs = this.extractForwardedIPs(req);

    return {
      ip: clientIP,
      port: req.socket?.remotePort,
      forwardedIPs,
      userAgent: req.headers['user-agent'] || 'Unknown',
      sdkVersion: req.headers['x-sdk-version'] as string,
      environment: (req.headers['x-environment'] as string) || 'production',
    };
  }

  /**
   * Extract networking information
   */
  private extractNetworkingInfo(req: Request): Networking {
    const protocol = req.protocol;
    const secure = protocol === 'https' || req.secure;
    const host =
      req.headers.host || `${req.hostname}:${req.socket?.localPort || 80}`;
    const serverIP = req.socket?.localAddress || '127.0.0.1';
    const serverPort = req.socket?.localPort || (secure ? 443 : 80);

    // Extract route pattern (simplified)
    const routePattern = req.route?.path || req.path || 'unknown';

    return {
      serverEndpoint: req.path,
      serverFullUrl: `${protocol}://${host}${req.originalUrl}`,
      clientOrigin: req.headers.origin || req.headers.referer,
      serverIP,
      serverPort,
      routePattern,
      protocol,
      secure,
    };
  }

  /**
   * Capture response data when response is finished
   */
  private captureResponseData(
    req: Request,
    res: Response,
    requestTracking: RequestTracking,
    startTime: number,
  ): void {
    const originalEnd = res.end;
    const originalWrite = res.write;
    const resRef = res; // Preserve response reference so originalEnd is called with correct 'this'
    const middlewareSelf = this;
    let responseSize = 0;

    // Capture response data
    const chunks: Buffer[] = [];

    // Override write method to capture response chunks
    res.write = function (chunk: any, ...args: any[]) {
      if (chunk) {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
          responseSize += chunk.length;
        } else if (typeof chunk === 'string') {
          const buffer = Buffer.from(chunk, args[0] || 'utf8');
          chunks.push(buffer);
          responseSize += buffer.length;
        }
      }
      return originalWrite.apply(this, [chunk, ...args]);
    };

    // Override end method to finalize tracking. Must call originalEnd with res as context,
    // not the middleware, or Node's ServerResponse will throw _implicitHeader is not a function.
    res.end = function (...args: any[]) {
      const endTime = Date.now();
      const processingTime = endTime - startTime;

      try {
        // Calculate performance metrics
        requestTracking.performance.serverProcessingTime = processingTime;
        requestTracking.performance.totalRoundTripTime = processingTime;

        // Estimate network time (rough approximation)
        requestTracking.performance.networkTime = Math.max(
          0,
          processingTime - 50,
        ); // Subtract estimated processing overhead

        // Calculate data transfer efficiency
        const totalDataTransferred =
          requestTracking.payload.requestSize + responseSize;
        requestTracking.performance.dataTransferEfficiency =
          totalDataTransferred > 0
            ? Math.min(100, (responseSize / totalDataTransferred) * 100)
            : 100;

        // Update payload information
        requestTracking.payload.responseSize = responseSize;
        requestTracking.payload.responseBody =
          middlewareSelf.shouldCaptureResponse(req, resRef)
            ? middlewareSelf.extractResponseBody(chunks)
            : undefined;

        // Update response headers
        requestTracking.headers.response = middlewareSelf.sanitizeHeaders(
          resRef.getHeaders() as Record<string, string>,
        );

        // Calculate compression ratio if applicable
        if (resRef.getHeader('content-encoding')) {
          requestTracking.payload.compressionRatio =
            middlewareSelf.calculateCompressionRatio(chunks);
        }

        // Store final tracking data
        (req as any).requestTracking = requestTracking;

        middlewareSelf.logger.debug(
          `Comprehensive tracking completed for request ${(req as any).correlationId}`,
          {
            processingTime,
            responseSize,
            statusCode: resRef.statusCode,
          },
        );
      } catch (error) {
        middlewareSelf.logger.error(
          `Failed to finalize comprehensive tracking for request ${(req as any).correlationId}`,
          error,
        );
      }

      // Call original end with the actual response object as context (required by Node's ServerResponse)
      return originalEnd.apply(resRef, args);
    };
  }

  /**
   * Get client IP address considering proxies
   */
  private getClientIP(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // Take the first IP if multiple are present
      return (
        Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]
      ).trim();
    }

    const realIP = req.headers['x-real-ip'];
    if (realIP) {
      return (Array.isArray(realIP) ? realIP[0] : realIP).trim();
    }

    return req.ip || req.connection?.remoteAddress || 'unknown';
  }

  /**
   * Extract forwarded IPs from headers
   */
  private extractForwardedIPs(req: Request): string[] {
    const forwarded = req.headers['x-forwarded-for'];
    if (!forwarded) return [];

    if (Array.isArray(forwarded)) {
      return forwarded.flatMap((f) => f.split(',').map((ip) => ip.trim()));
    }

    return forwarded.split(',').map((ip) => ip.trim());
  }

  /**
   * Sanitize headers for tracking (remove sensitive information)
   */
  private sanitizeHeaders(
    headers: Record<string, string>,
  ): Record<string, string> {
    const sanitized = { ...headers };

    // Remove sensitive headers
    const sensitiveHeaders = [
      'authorization',
      'x-api-key',
      'cookie',
      'x-mfa-token',
      'proxy-authorization',
      'x-session-token',
    ];

    sensitiveHeaders.forEach((header) => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Sanitize request/response body for tracking
   */
  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sanitized = { ...body };

    // Remove sensitive fields
    const sensitiveFields = [
      'password',
      'token',
      'apiKey',
      'secret',
      'creditCard',
      'cvv',
      'ssn',
    ];

    sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Estimate payload size
   */
  private estimatePayloadSize(body: any): number {
    if (!body) return 0;

    try {
      if (Buffer.isBuffer(body)) {
        return body.length;
      }
      if (typeof body === 'string') {
        return Buffer.byteLength(body, 'utf8');
      }
      return Buffer.byteLength(JSON.stringify(body), 'utf8');
    } catch {
      return 0;
    }
  }

  /**
   * Determine if request body should be captured
   */
  private shouldCaptureBody(req: Request): boolean {
    const contentType = req.headers['content-type'] || '';
    const method = req.method;

    // Only capture for relevant methods and content types
    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
      return false;
    }

    // Only capture JSON and form data
    if (
      !contentType.includes('application/json') &&
      !contentType.includes('application/x-www-form-urlencoded') &&
      !contentType.includes('multipart/form-data')
    ) {
      return false;
    }

    // Skip if body is too large (> 1MB)
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > 1024 * 1024) {
      return false;
    }

    return true;
  }

  /**
   * Determine if response body should be captured
   */
  private shouldCaptureResponse(req: Request, res: Response): boolean {
    const contentType = (res.getHeader('content-type') as string) || '';
    const statusCode = res.statusCode;

    // Only capture successful responses
    if (statusCode < 200 || statusCode >= 300) {
      return false;
    }

    // Only capture JSON responses
    if (!contentType.includes('application/json')) {
      return false;
    }

    // Skip if response is too large (> 1MB)
    const contentLength = parseInt(
      (res.getHeader('content-length') as string) || '0',
    );
    if (contentLength > 1024 * 1024) {
      return false;
    }

    return true;
  }

  /**
   * Extract response body from captured chunks
   */
  private extractResponseBody(chunks: Buffer[]): any {
    if (chunks.length === 0) return undefined;

    try {
      const fullBuffer = Buffer.concat(chunks);
      const bodyString = fullBuffer.toString('utf8');

      // Try to parse as JSON
      return JSON.parse(bodyString);
    } catch {
      // If not JSON or parsing fails, return undefined
      return undefined;
    }
  }

  /**
   * Calculate compression ratio
   */
  private calculateCompressionRatio(chunks: Buffer[]): number {
    if (chunks.length === 0) return 1;

    const compressedSize = chunks.reduce(
      (total, chunk) => total + chunk.length,
      0,
    );

    // Estimate uncompressed size (rough approximation)
    // This is a simplified calculation
    const estimatedUncompressedSize = compressedSize * 3; // Assume 3:1 compression ratio as baseline

    return compressedSize / estimatedUncompressedSize;
  }

  /**
   * Determine if request should be skipped for tracking
   */
  private shouldSkipTracking(req: Request): boolean {
    const path = req.path;
    const method = req.method;

    // Skip health checks
    if (path === '/health' || path === '/ping' || path === '/status') {
      return true;
    }

    // Skip static files
    if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
      return true;
    }

    // Skip OPTIONS requests
    if (method === 'OPTIONS') {
      return true;
    }

    // Skip favicon requests
    if (path === '/favicon.ico') {
      return true;
    }

    return false;
  }

  /**
   * Get comprehensive tracking data from request
   */
  static getComprehensiveTrackingData(
    req: Request,
  ): RequestTracking | undefined {
    return (req as any).requestTracking;
  }
}
