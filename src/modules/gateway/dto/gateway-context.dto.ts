import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsEnum,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Gateway Context DTO - Data Transfer Object for Gateway Context
 * Used for validating and transforming gateway context data
 */
export class GatewayContextDto {
  // Core request tracking
  @IsOptional()
  @IsString()
  requestId?: string;

  // Routing configuration
  @IsOptional()
  @IsString()
  targetUrl?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsEnum(['gateway', 'standard', 'agent'])
  authMethodOverride?: 'gateway' | 'standard' | 'agent';

  // Feature flags
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  cacheEnabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  retryEnabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  securityEnabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  omitRequest?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  omitResponse?: boolean;

  // Rate limiting
  @IsOptional()
  @IsString()
  rateLimitPolicy?: string;

  // Firewall configuration
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  firewallEnabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  firewallAdvanced?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  @Max(1)
  firewallPromptThreshold?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  @Max(1)
  firewallLlamaThreshold?: number;

  // Tracing and logging
  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  traceName?: string;

  @IsOptional()
  @IsString()
  traceStep?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  traceSequence?: number;

  // User and authentication
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  budgetId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  modelOverride?: string;

  // Custom properties
  @IsOptional()
  @IsObject()
  properties?: Record<string, string>;

  // Caching configuration
  @IsOptional()
  @IsString()
  cacheUserScope?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(0)
  cacheTTL?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(10)
  cacheBucketMaxSize?: number;

  // Retry configuration
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(0)
  @Max(10)
  retryCount?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(1)
  @Max(5)
  retryFactor?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(100)
  @Max(60000)
  retryMinTimeout?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1000)
  @Max(300000)
  retryMaxTimeout?: number;

  // Proxy key configuration
  @IsOptional()
  @IsString()
  proxyKeyId?: string;

  @IsOptional()
  @IsString()
  providerKey?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  // Failover configuration
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  failoverEnabled?: boolean;

  @IsOptional()
  @IsString()
  failoverPolicy?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isFailoverRequest?: boolean;

  // Semantic caching
  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  semanticCacheEnabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  deduplicationEnabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityThreshold?: number;

  // Usage tracking
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(0)
  inputTokens?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(0)
  outputTokens?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  cost?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  estimatedCost?: number;

  @IsOptional()
  @IsString()
  simulationId?: string;

  // CORTEX PROCESSING PROPERTIES
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  cortexEnabled?: boolean;

  @IsOptional()
  @IsString()
  cortexCoreModel?: string;

  @IsOptional()
  @IsString()
  cortexEncodingModel?: string;

  @IsOptional()
  @IsString()
  cortexDecodingModel?: string;

  @IsOptional()
  @IsEnum(['optimize', 'compress', 'analyze', 'transform', 'sast'])
  cortexOperation?: 'optimize' | 'compress' | 'analyze' | 'transform' | 'sast';

  @IsOptional()
  @IsEnum(['formal', 'casual', 'technical', 'conversational'])
  cortexOutputStyle?: 'formal' | 'casual' | 'technical' | 'conversational';

  @IsOptional()
  @IsEnum(['plain', 'markdown', 'structured'])
  cortexOutputFormat?: 'plain' | 'markdown' | 'structured';

  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  cortexPreserveSemantics?: boolean;

  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  cortexSemanticCache?: boolean;

  @IsOptional()
  @IsEnum(['cost', 'speed', 'quality', 'balanced'])
  cortexPriority?: 'cost' | 'speed' | 'quality' | 'balanced';

  // Binary serialization
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  cortexBinaryEnabled?: boolean;

  @IsOptional()
  @IsEnum(['basic', 'standard', 'aggressive'])
  cortexBinaryCompression?: 'basic' | 'standard' | 'aggressive';

  // Schema validation
  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  cortexSchemaValidation?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  cortexStrictValidation?: boolean;

  // Advanced Cortex features
  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  cortexControlFlowEnabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  cortexHybridExecution?: boolean;

  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  cortexFragmentCache?: boolean;

  @IsOptional()
  cortexMetadata?: any;

  // Budget management
  @IsOptional()
  @IsString()
  budgetReservationId?: string;

  // Agent configuration
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isAgentRequest?: boolean;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  agentIdentityId?: string;

  @IsOptional()
  @IsString()
  agentToken?: string;

  @IsOptional()
  @IsString()
  agentType?: string;
}
