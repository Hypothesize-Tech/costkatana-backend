/**
 * Comprehensive Tracking Middleware for Cost Katana Backend
 * 
 * Captures complete server-side request/response data, correlates with
 * client-side data, and provides comprehensive tracking for AI endpoints
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { performance } from 'perf_hooks';
import os from 'os';

export interface ComprehensiveServerRequestData {
  // Server Information
  serverInfo: {
    hostname: string;
    platform: string;
    nodeVersion: string;
    serverIP: string;
    serverPort: number;
    instanceId: string;
  };
  
  // Client Information (from request)
  clientInfo: {
    ip: string;
    port?: number;
    forwardedIPs: string[];
    userAgent: string;
    protocol: string;
    secure: boolean;
  };
  
  // Request Details
  request: {
    method: string;
    url: string;
    path: string;
    fullUrl?: string;
    clientOrigin?: string;
    query: Record<string, any>;
    headers: Record<string, string>;
    body: any;
    size: number;
    timestamp: Date;
    routePattern?: string;
  };
  
  // Response Details
  response?: {
    statusCode: number;
    headers: Record<string, string>;
    body: any;
    size: number;
    timestamp: Date;
  };
  
  // Performance Metrics
  performance: {
    serverProcessingTime: number;
    middlewareTime?: number;
    controllerTime?: number;
    databaseTime?: number;
    externalApiTime?: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage?: NodeJS.CpuUsage;
  };
  
  // Correlation with client-side data
  correlation: {
    sessionId: string;
    requestId: string;
    traceId?: string;
    clientRequestId?: string;
    userId?: string;
    projectId?: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      comprehensiveTracking?: {
        data: ComprehensiveServerRequestData;
        startTime: number;
        startCpuUsage?: NodeJS.CpuUsage;
      };
    }
  }
}

/**
 * Comprehensive tracking middleware
 */
export const comprehensiveTrackingMiddleware = (
  options: {
    enableBodyCapture?: boolean;
    maxBodySize?: number;
    sanitizeData?: boolean;
    skipHealthChecks?: boolean;
  } = {}
) => {
  const {
    enableBodyCapture = true,
    maxBodySize = 10 * 1024 * 1024, // 10MB
    sanitizeData = true,
    skipHealthChecks = true
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = performance.now();
    const startCpuUsage = process.cpuUsage();
    
    // Skip tracking for health checks and static assets if configured
    if (skipHealthChecks && isHealthCheckOrStatic(req.path)) {
      return next();
    }

    const requestId = uuidv4();
    const sessionId = extractSessionId(req) || uuidv4();
    const traceId = req.headers['x-trace-id'] as string;
    const clientRequestId = req.headers['x-costkatana-request-id'] as string;

    // Capture comprehensive server-side data
    const trackingData: ComprehensiveServerRequestData = {
      serverInfo: getServerInfo(req),
      clientInfo: getClientInfo(req),
      request: await captureRequestData(req, enableBodyCapture, maxBodySize, sanitizeData),
      performance: {
        serverProcessingTime: 0, // Will be updated on response
        memoryUsage: process.memoryUsage()
      },
      correlation: {
        sessionId,
        requestId,
        traceId,
        clientRequestId,
        userId: extractUserId(req),
        projectId: extractProjectId(req)
      }
    };

    // Store tracking data on request for response correlation
    req.comprehensiveTracking = {
      data: trackingData,
      startTime,
      startCpuUsage
    };

    // Intercept response to capture response data
    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;

    let responseBodyCaptured = false;

    // Override res.send
    res.send = function (data: any) {
      if (!responseBodyCaptured) {
        captureResponseData(req, res, data, sanitizeData, maxBodySize);
        responseBodyCaptured = true;
      }
      return originalSend.call(this, data);
    };

    // Override res.json
    res.json = function (data: any) {
      if (!responseBodyCaptured) {
        captureResponseData(req, res, data, sanitizeData, maxBodySize);
        responseBodyCaptured = true;
      }
      return originalJson.call(this, data);
    };

    // Override res.end with proper type signature
    res.end = function (this: any, chunkOrCallback?: any, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void): any {
      if (!responseBodyCaptured && chunkOrCallback && typeof chunkOrCallback !== 'function') {
        captureResponseData(req, res, chunkOrCallback, sanitizeData, maxBodySize);
        responseBodyCaptured = true;
      }
      
      // Finalize tracking data
      finalizeTrackingData(req);
      
      // Call original end with all arguments
      return (originalEnd as any).call(this, chunkOrCallback, encodingOrCallback, callback);
    };

    logger.debug('Comprehensive tracking initialized', {
      requestId,
      sessionId,
      method: req.method,
      path: req.path
    });

    next();
  };
};

/**
 * Get server information
 */
function getServerInfo(req: Request) {
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    nodeVersion: process.version,
    serverIP: getServerIP(req),
    serverPort: getServerPort(req),
    instanceId: process.env.INSTANCE_ID || 'unknown'
  };
}

/**
 * Get client information from request
 */
function getClientInfo(req: Request) {
  const forwardedFor = req.headers['x-forwarded-for'] as string;
  const realIP = req.headers['x-real-ip'] as string;
  
  let forwardedIPs: string[] = [];
  if (forwardedFor) {
    forwardedIPs = forwardedFor.split(',').map(ip => ip.trim());
  }

  return {
    ip: realIP || req.ip || req.connection.remoteAddress || 'unknown',
    port: req.connection.remotePort,
    forwardedIPs,
    userAgent: req.headers['user-agent'] || 'unknown',
    protocol: req.protocol,
    secure: req.secure
  };
}

/**
 * Capture comprehensive request data
 */
async function captureRequestData(
  req: Request,
  enableBodyCapture: boolean,
  maxBodySize: number,
  sanitizeData: boolean
) {
  const body = enableBodyCapture ? captureBody(req.body, maxBodySize, sanitizeData) : null;
  const size = body ? calculateBodySize(body) : 0;

  // Convert headers to proper Record<string, string> format
  const headers = sanitizeData 
    ? sanitizeHeaders(req.headers) 
    : sanitizeHeaders(req.headers); // Always sanitize to ensure proper typing

  // Support proxy: use X-Forwarded-* when present for full server URL
  const forwardedProto = req.headers['x-forwarded-proto'] as string | undefined;
  const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
  const host = forwardedHost || req.get('host') || 'localhost';
  const protocol = (forwardedProto?.split(',')[0]?.trim()) || req.protocol || 'http';
  const path = req.originalUrl || req.url || req.path;
  const fullUrl = `${protocol}://${host}${path}`;

  // Client origin: where the request came from (browser/app). Fallback for direct/script requests.
  const rawOrigin = (req.headers['origin'] || req.headers['referer']) as string | undefined;
  const clientOrigin = rawOrigin?.trim() || undefined;

  return {
    method: req.method,
    url: req.url,
    path: req.path,
    fullUrl,
    clientOrigin,
    query: req.query as Record<string, any>,
    headers,
    body,
    size,
    timestamp: new Date(),
    routePattern: extractRoutePattern(req)
  };
}

/**
 * Capture response data
 */
function captureResponseData(
  req: Request,
  res: Response,
  data: any,
  sanitizeData: boolean,
  maxBodySize: number
) {
  if (!req.comprehensiveTracking) return;

  const body = captureBody(data, maxBodySize, sanitizeData);
  const size = calculateBodySize(body);

  req.comprehensiveTracking.data.response = {
    statusCode: res.statusCode,
    headers: sanitizeHeaders(res.getHeaders()),
    body,
    size,
    timestamp: new Date()
  };
}

/**
 * Finalize tracking data with performance metrics
 */
function finalizeTrackingData(req: Request) {
  if (!req.comprehensiveTracking) return;

  const endTime = performance.now();
  const endCpuUsage = process.cpuUsage(req.comprehensiveTracking.startCpuUsage);
  
  req.comprehensiveTracking.data.performance = {
    ...req.comprehensiveTracking.data.performance,
    serverProcessingTime: endTime - req.comprehensiveTracking.startTime,
    cpuUsage: endCpuUsage,
    memoryUsage: process.memoryUsage()
  };

  // Log the comprehensive tracking data
  logger.debug('Comprehensive tracking completed', {
    requestId: req.comprehensiveTracking.data.correlation.requestId,
    processingTime: req.comprehensiveTracking.data.performance.serverProcessingTime,
    statusCode: req.comprehensiveTracking.data.response?.statusCode,
    memoryUsed: req.comprehensiveTracking.data.performance.memoryUsage.heapUsed
  });
}

/**
 * Utility functions
 */
function isHealthCheckOrStatic(path: string): boolean {
  const patterns = [
    '/health',
    '/status',
    '/ping',
    '/favicon.ico',
    '/robots.txt',
    '/.well-known'
  ];
  
  return patterns.some(pattern => path.startsWith(pattern));
}

function extractSessionId(req: Request): string | undefined {
  return req.headers['x-session-id'] as string || 
         req.headers['x-costkatana-session-id'] as string;
}

function extractUserId(req: Request): string | undefined {
  return (req as any).user?.userId || 
         (req as any).user?._id?.toString() ||
         req.headers['x-user-id'] as string;
}

function extractProjectId(req: Request): string | undefined {
  return req.headers['x-project-id'] as string ||
         req.headers['x-costkatana-project-id'] as string ||
         process.env.PROJECT_ID;
}

function extractRoutePattern(req: Request): string | undefined {
  return (req as any).route?.path;
}

function getServerIP(req: Request): string {
  // Try to get server IP from various sources
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (iface) {
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
  }
  return req.socket.localAddress || 'unknown';
}

function getServerPort(req: Request): number {
  return req.socket.localPort || parseInt(process.env.PORT || '3000');
}

function captureBody(body: any, maxSize: number, sanitize: boolean): any {
  if (!body) return null;

  try {
    let processedBody = body;
    
    if (sanitize) {
      processedBody = sanitizeBody(body);
    }
    
    // Truncate if too large
    const bodyString = JSON.stringify(processedBody);
    if (bodyString.length > maxSize) {
      return {
        _truncated: true,
        _originalSize: bodyString.length,
        _data: bodyString.substring(0, maxSize) + '...[TRUNCATED]'
      };
    }
    
    return processedBody;
  } catch (error) {
    return { _error: 'Failed to process body', _originalType: typeof body };
  }
}

function sanitizeHeaders(headers: any): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'x-api-key',
    'x-auth-token',
    'authentication',
    'proxy-authorization',
    'x-access-token'
  ];
  
  for (const [key, value] of Object.entries(headers)) {
    const keyLower = key.toLowerCase();
    let stringValue: string;
    
    if (Array.isArray(value)) {
      stringValue = value.join(', ');
    } else if (typeof value === 'string') {
      stringValue = value;
    } else if (typeof value === 'number') {
      stringValue = value.toString();
    } else if (value !== undefined && value !== null) {
      stringValue = String(value);
    } else {
      continue; // Skip undefined/null values
    }

    if (sensitiveHeaders.includes(keyLower)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = stringValue;
    }
  }
  
  return sanitized;
}

function sanitizeBody(body: any): any {
  if (!body) return body;
  
  if (typeof body === 'string') {
    return body.length > 1000 ? body.substring(0, 1000) + '...[TRUNCATED]' : body;
  }
  
  if (typeof body === 'object') {
    const sanitized = JSON.parse(JSON.stringify(body));
    sanitizeObjectRecursive(sanitized);
    return sanitized;
  }
  
  return body;
}

function sanitizeObjectRecursive(obj: any): void {
  if (!obj || typeof obj !== 'object') return;
  
  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'apikey', 'api_key',
    'auth', 'authorization', 'credential', 'private', 'session'
  ];
  
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      obj[key] = '[REDACTED]';
    } else if (typeof obj[key] === 'object') {
      sanitizeObjectRecursive(obj[key]);
    } else if (typeof obj[key] === 'string' && obj[key].length > 1000) {
      obj[key] = obj[key].substring(0, 1000) + '...[TRUNCATED]';
    }
  }
}

function calculateBodySize(body: any): number {
  if (!body) return 0;
  
  try {
    if (typeof body === 'string') {
      return Buffer.byteLength(body, 'utf8');
    } else if (typeof body === 'object') {
      return Buffer.byteLength(JSON.stringify(body), 'utf8');
    }
  } catch {
    return 0;
  }
  
  return 0;
}

/**
 * Middleware to extract and store comprehensive tracking data
 */
export const extractComprehensiveTrackingData = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    // This middleware should be placed after comprehensiveTrackingMiddleware
    // and before route handlers that need access to tracking data
    
    if (req.comprehensiveTracking) {
      // Store tracking data in a way that can be accessed by controllers
      (req as any).trackingData = req.comprehensiveTracking.data;
    }
    
    next();
  };
};

/**
 * Get comprehensive tracking data from request
 */
export function getComprehensiveTrackingData(req: Request): ComprehensiveServerRequestData | null {
  return req.comprehensiveTracking?.data || null;
}