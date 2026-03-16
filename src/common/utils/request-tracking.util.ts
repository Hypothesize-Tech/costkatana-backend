/**
 * Utility to build IRequestTracking from an Express request.
 * Used by optimization and other modules to capture network details for frontend requests.
 */

import { Request } from 'express';
import type {
  IRequestTracking,
  IClientInfo,
  IHeaders,
  INetworking,
  IPayload,
  IPerformance,
} from '@/schemas/core/optimization.schema';

const SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'cookie',
  'x-mfa-token',
  'proxy-authorization',
  'x-session-token',
];

function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (
      (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0])
    ).trim();
  }
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return (Array.isArray(realIP) ? realIP[0] : realIP).trim();
  }
  return req.ip || (req.connection?.remoteAddress as string) || 'unknown';
}

function extractForwardedIPs(req: Request): string[] {
  const forwarded = req.headers['x-forwarded-for'];
  if (!forwarded) return [];
  if (Array.isArray(forwarded)) {
    return forwarded.flatMap((f) => f.split(',').map((ip) => ip.trim()));
  }
  return forwarded.split(',').map((ip) => ip.trim());
}

function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    result[k] = SENSITIVE_HEADERS.includes(key)
      ? '[REDACTED]'
      : Array.isArray(v)
        ? v.join(', ')
        : String(v);
  }
  return result;
}

function estimatePayloadSize(body: unknown): number {
  if (!body) return 0;
  try {
    if (Buffer.isBuffer(body)) return body.length;
    if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return 0;
  }
}

/**
 * Build request tracking from Express request for saving with optimization/usage records.
 * Optionally merge with frontend-provided client-side data.
 */
export function buildRequestTrackingFromRequest(
  req: Request,
  options?: {
    serverProcessingTimeMs?: number;
    frontendData?: Partial<IRequestTracking>;
  },
): IRequestTracking {
  const clientIP = getClientIP(req);
  const forwardedIPs = extractForwardedIPs(req);
  const protocol = req.protocol || 'http';
  const secure = protocol === 'https' || req.secure === true;
  const host =
    req.headers.host || `${req.hostname || 'localhost'}:${req.socket?.localPort || 80}`;
  const serverIP = req.socket?.localAddress || '127.0.0.1';
  const serverPort = req.socket?.localPort || (secure ? 443 : 80);

  const clientInfo: IClientInfo = {
    ip: clientIP,
    port: req.socket?.remotePort,
    forwardedIPs,
    userAgent: (req.headers['user-agent'] as string) || 'Unknown',
    sdkVersion: req.headers['x-sdk-version'] as string,
    environment: (req.headers['x-environment'] as string) || 'production',
    ...(options?.frontendData?.clientInfo ?? {}),
  };

  const networking: INetworking = {
    serverEndpoint: req.path,
    serverFullUrl: `${protocol}://${host}${req.originalUrl}`,
    clientOrigin: (req.headers.origin || req.headers.referer) as string,
    serverIP,
    serverPort,
    routePattern: (req.route?.path as string) || req.path || 'unknown',
    protocol,
    secure,
  };

  const headers: IHeaders = {
    request: sanitizeHeaders(
      req.headers as Record<string, string | string[] | undefined>,
    ),
    response: {},
    ...(options?.frontendData?.headers ?? {}),
  };

  const requestSize = estimatePayloadSize(req.body);
  const payload: IPayload = {
    requestSize,
    responseSize: 0,
    contentType: (req.headers['content-type'] as string) || 'application/json',
    encoding: req.headers['content-encoding'] as string,
    ...(options?.frontendData?.payload ?? {}),
  };

  const processingTime = options?.serverProcessingTimeMs ?? 0;
  const performance: IPerformance = {
    networkTime: 0,
    serverProcessingTime: processingTime,
    totalRoundTripTime: processingTime,
    dataTransferEfficiency: 0,
    ...(options?.frontendData?.performance ?? {}),
  };

  const base: IRequestTracking = {
    clientInfo,
    headers,
    networking,
    payload,
    performance,
  };

  if (options?.frontendData) {
    return deepMergeTracking(base, options.frontendData);
  }
  return base;
}

function deepMergeTracking(
  base: IRequestTracking,
  overlay: Partial<IRequestTracking>,
): IRequestTracking {
  return {
    clientInfo: { ...base.clientInfo, ...overlay.clientInfo },
    headers: {
      request: { ...base.headers?.request, ...overlay.headers?.request },
      response: { ...base.headers?.response, ...overlay.headers?.response },
    },
    networking: { ...base.networking, ...overlay.networking },
    payload: { ...base.payload, ...overlay.payload },
    performance: { ...base.performance, ...overlay.performance },
  };
}
