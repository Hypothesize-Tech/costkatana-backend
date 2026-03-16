import { AxiosResponse, AxiosRequestConfig } from 'axios';

/**
 * Gateway Context Interface - Extended Request Context for Gateway Operations
 * Contains all CostKatana headers and processing state for gateway requests
 */
export interface GatewayContext {
  // Core request tracking
  startTime: number;
  requestId?: string;

  // Routing configuration
  targetUrl?: string;
  projectId?: string;
  workspaceId?: string;
  authMethodOverride?: 'gateway' | 'standard' | 'agent';

  // Feature flags
  cacheEnabled?: boolean;
  retryEnabled?: boolean;
  securityEnabled?: boolean;
  omitRequest?: boolean;
  omitResponse?: boolean;

  // Rate limiting
  rateLimitPolicy?: string;

  // Firewall configuration
  firewallEnabled?: boolean;
  firewallAdvanced?: boolean;
  firewallPromptThreshold?: number;
  firewallLlamaThreshold?: number;

  // Tracing and logging
  traceId?: string;
  traceName?: string;
  traceStep?: string;
  traceSequence?: number;

  // User and authentication
  userId?: string;
  organizationId?: string;
  budgetId?: string;
  sessionId?: string;
  modelOverride?: string;

  // Custom properties (CostKatana-Property-* headers)
  properties?: Record<string, string>;

  // Caching configuration
  cacheUserScope?: string;
  cacheTTL?: number;
  cacheBucketMaxSize?: number;

  // Retry configuration
  retryCount?: number;
  retryFactor?: number;
  retryMinTimeout?: number;
  retryMaxTimeout?: number;

  // Proxy key configuration
  proxyKeyId?: string;
  providerKey?: string;
  provider?: string;

  // Failover configuration
  failoverEnabled?: boolean;
  failoverPolicy?: string;
  isFailoverRequest?: boolean;

  // Semantic caching
  semanticCacheEnabled?: boolean;
  deduplicationEnabled?: boolean;
  similarityThreshold?: number;

  // Usage tracking
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  estimatedCost?: number;
  simulationId?: string;

  // CORTEX PROCESSING PROPERTIES
  cortexEnabled?: boolean;
  cortexCoreModel?: string;
  cortexEncodingModel?: string;
  cortexDecodingModel?: string;
  cortexOperation?: 'optimize' | 'compress' | 'analyze' | 'transform' | 'sast';
  cortexOutputStyle?: 'formal' | 'casual' | 'technical' | 'conversational';
  cortexOutputFormat?: 'plain' | 'markdown' | 'structured';
  cortexPreserveSemantics?: boolean;
  cortexSemanticCache?: boolean;
  cortexPriority?: 'cost' | 'speed' | 'quality' | 'balanced';

  // Binary serialization
  cortexBinaryEnabled?: boolean;
  cortexBinaryCompression?: 'basic' | 'standard' | 'aggressive';

  // Schema validation
  cortexSchemaValidation?: boolean;
  cortexStrictValidation?: boolean;

  // Advanced Cortex features
  cortexControlFlowEnabled?: boolean;
  cortexHybridExecution?: boolean;
  cortexFragmentCache?: boolean;
  cortexMetadata?: any;

  // Budget management
  budgetReservationId?: string;

  // Agent configuration
  isAgentRequest?: boolean;
  agentId?: string;
  agentIdentityId?: string;
  agentToken?: string;
  agentType?: string;

  // Prompt caching metadata
  promptCaching?: {
    enabled: boolean;
    type: 'automatic' | 'explicit' | 'none';
    estimatedSavings: number;
    cacheHeaders: Record<string, string>;
  };
}

/**
 * Proxy Request Configuration - Axios-compatible request config
 */
export interface ProxyRequestConfig extends AxiosRequestConfig {
  timeout: number;
  httpsAgent: any;
  maxRedirects: number;
  decompress: boolean;
  validateStatus: () => boolean;
}

/**
 * Cache Entry Interface
 */
export interface CacheEntry {
  response: any;
  timestamp: number;
  headers: Record<string, string>;
  ttl?: number;
  userScope?: string;
}

/**
 * Moderation Result Interface
 */
export interface ModerationResult {
  response: any;
  moderationApplied: boolean;
  action: 'allow' | 'annotate' | 'redact' | 'block';
  violationCategories: string[];
  isBlocked: boolean;
  sanitizedContent?: string;
}

/**
 * Moderation Configuration Interface
 */
export interface ModerationConfig {
  enableOutputModeration: boolean;
  toxicityThreshold: number;
  enablePIIDetection: boolean;
  enableToxicityCheck: boolean;
  enableHateSpeechCheck: boolean;
  enableSexualContentCheck: boolean;
  enableViolenceCheck: boolean;
  enableSelfHarmCheck: boolean;
  action: 'allow' | 'annotate' | 'redact' | 'block';
}

/**
 * Priority Level Enum
 */
export enum PriorityLevel {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
  BULK = 4,
}

/**
 * Priority Request Interface
 */
export interface PriorityRequest {
  id: string;
  priority: PriorityLevel;
  userTier: string;
  createdAt: Date;
  estimatedProcessingTime?: number;
}

/**
 * Queue Statistics Interface
 */
export interface QueueStats {
  queueDepth: number;
  activeWorkers: number;
  maxWaitTime: number;
  averageProcessingTime: number;
  priorityDistribution: Record<string, number>;
}

/**
 * Circuit Breaker State
 */
export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

/**
 * Retry Configuration Interface
 */
export interface RetryConfig {
  retryCount?: number;
  retryFactor?: number;
  retryMinTimeout?: number;
  retryMaxTimeout?: number;
}

/**
 * Budget Check Result Interface
 */
export interface BudgetCheckResult {
  allowed: boolean;
  message?: string;
  reservationId?: string;
  simulation?: any;
  cheaperAlternatives?: any[];
}

/**
 * Firewall Check Result Interface
 */
export interface FirewallCheckResult {
  isBlocked: boolean;
  threatCategory?: string;
  confidence?: number;
  riskScore?: number;
  stage?: string;
  containmentAction?: string;
  matchedPatterns?: string[];
  humanReviewId?: string;
  reason?: string;
}

/**
 * Failover Policy Interface
 */
export interface FailoverPolicy {
  providers: Array<{
    url: string;
    priority: number;
    weight: number;
    timeout: number;
    retries: number;
  }>;
  strategy: 'priority' | 'weighted' | 'round-robin';
  maxRetries: number;
  timeoutMs: number;
}

/**
 * Failover Result Interface
 */
export interface FailoverResult {
  success: boolean;
  response?: any;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  successfulProviderIndex?: number;
  providersAttempted: number;
  totalLatency: number;
  finalError?: Error;
}

/**
 * Failover Metrics Interface
 */
export interface FailoverMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  providerHealth: Record<
    string,
    {
      successRate: number;
      averageLatency: number;
      lastFailure?: Date;
    }
  >;
}

/**
 * Cortex Processing Result Interface
 */
export interface CortexProcessingResult {
  processedBody: any;
  cortexMetadata: {
    processingTime: number;
    gateway: boolean;
    /** Present when processing failed */
    error?: string;
    operation?: string;
    encodingConfidence?: number;
    optimizationsApplied?: number;
    decodingConfidence?: number;
    semanticIntegrity?: number;
    tokensSaved?: number;
    reductionPercentage?: number;
    complexity?: {
      level: string;
      score: number;
      factors: string[];
      confidence: number;
    };
    routing?: {
      selectedTier: string;
      reasoning: string;
      confidence: number;
      costEstimate: any;
    };
    cortexModel?: {
      encoder: string;
      core: string;
      decoder: string;
    };
    bypassedLLM?: boolean;
    cacheHit?: boolean;
    originalCacheTime?: number;
    binarySerialization?: {
      enabled: boolean;
      originalSize: number;
      compressedSize: number;
      compressionRatio: number;
      compressionLevel: string;
      error?: string;
    };
    schemaValidation?: {
      enabled: boolean;
      valid?: boolean;
      score?: number;
      errorCount?: number;
      warningCount?: number;
      strictMode?: boolean;
      errors?: any[];
      warnings?: any[];
    };
    controlFlow?: {
      enabled: boolean;
      success: boolean;
      executedSteps: number;
      executionTime: number;
      variablesCreated: number;
      errors: number;
      warnings: number;
      bypassedLLM?: boolean;
    };
    hybridExecution?: {
      enabled: boolean;
      deterministic: boolean;
      executedTools: string[];
      apiCalls: number;
      costSaved: number;
      executionTime: number;
      toolsUsed: number;
      executionType: string;
      bypassedLLM?: boolean;
    };
    contextManagement?: {
      enabled: boolean;
      sessionId: string;
      entitiesCount: number;
      preferencesCount: number;
      contextTokensSaved: number;
      contextCompressionRatio: number;
      intentionsExtracted: number;
      preferencesExtracted: number;
      compressionApplied?: boolean;
      reason?: string;
    };
    fragmentCache?: {
      enabled: boolean;
      hit: boolean;
      hitRate: number;
      fragmentsFound: number;
      totalFragments: number;
      compressionSavings: number;
      cacheTime: number;
      fragmentId?: string;
      category?: string;
      composition?: {
        enabled: boolean;
        coverageRatio: number;
        fragmentCount: number;
        strategy: string;
        missingParts: number;
      };
      bypassedLLM?: boolean;
    };
  };
  shouldBypass: boolean;
}

/**
 * Prompt Extraction Result Interface
 */
export interface PromptExtractionResult {
  prompt: string | null;
  format: 'openai' | 'anthropic' | 'google' | 'cohere' | 'generic' | 'unknown';
}

/**
 * Tool Call Extraction Result Interface
 */
export interface ToolCallExtractionResult {
  toolCalls: any[] | undefined;
  format: 'openai' | 'anthropic' | 'google' | 'unknown';
}

/**
 * Conversation Message Interface
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

/**
 * Rate Limit Check Result Interface
 */
export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfter?: number;
}

/**
 * Proxy Key Authentication Result Interface
 */
export interface ProxyKeyAuthResult {
  proxyKeyId: string;
  provider: string;
  userId: string;
  user: any;
  decryptedApiKey: string;
}

/**
 * Request Processing Result Interface
 */
export interface RequestProcessingResult {
  proxyRequest: ProxyRequestConfig;
  modified: boolean;
  optimizations: string[];
}

/**
 * Response Processing Result Interface
 */
export interface ResponseProcessingResult {
  processedResponse: AxiosResponse;
  moderated: boolean;
  cached: boolean;
  headersAdded: boolean;
}
