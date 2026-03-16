/**
 * High-Availability Gateway & Failover Types
 */

export interface FailoverTarget {
  'target-url': string;
  headers: Record<string, string>;
  onCodes: (number | { from: number; to: number })[];
  bodyKeyOverride?: Record<string, string>;
  timeout?: number;
  retryConfig?: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
  };
}

export interface FailoverPolicy {
  targets: FailoverTarget[];
  globalTimeout?: number;
  continueOnSuccess?: boolean;
}

export interface FailoverContext {
  policy: FailoverPolicy;
  currentAttemptIndex: number;
  startTime: number;
  previousErrors: Array<{
    targetIndex: number;
    error: unknown;
    statusCode?: number;
    timestamp: number;
  }>;
  originalRequestBody: unknown;
}

export interface FailoverResult {
  success: boolean;
  successfulProviderIndex: number;
  response?: unknown;
  responseHeaders?: Record<string, string>;
  statusCode?: number;
  totalDuration: number;
  providersAttempted: number;
  attemptDetails: Array<{
    targetIndex: number;
    targetUrl: string;
    success: boolean;
    statusCode?: number;
    error?: string;
    duration: number;
    timestamp: number;
  }>;
  finalError?: unknown;
}

export interface FailoverMetrics {
  totalRequests: number;
  firstProviderSuccess: number;
  failoverTriggered: number;
  totalFailures: number;
  averageProvidersAttempted: number;
  providerStats: Record<
    string,
    {
      attempts: number;
      successes: number;
      failures: number;
      averageResponseTime: number;
    }
  >;
  failureReasons: Record<string, number>;
}

export interface FailoverGatewayContext {
  targetUrl?: string;
  userId?: string;
  requestId?: string;
  cacheEnabled?: boolean;
  retryEnabled?: boolean;
  failoverEnabled: boolean;
  failoverContext?: FailoverContext;
  isFailoverRequest: boolean;
}

export class FailoverError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly providerIndex: number,
    public readonly providerUrl: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'FailoverError';
  }
}

export interface FailoverValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
