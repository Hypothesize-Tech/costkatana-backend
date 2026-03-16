import {
  IsNotEmpty,
  IsString,
  IsObject,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';

/**
 * Proxy Request DTO - Data Transfer Object for Proxy Requests
 * Used for validating and transforming proxy request configurations
 */
export class ProxyRequestDto {
  @IsNotEmpty()
  @IsString()
  method: string;

  @IsNotEmpty()
  @IsString()
  url: string;

  @IsObject()
  headers: Record<string, any>;

  @IsObject()
  data: any;

  @IsNumber()
  @Min(1000)
  timeout: number;

  @IsBoolean()
  validateStatus: boolean;

  @IsNumber()
  @Min(0)
  maxRedirects: number;

  @IsBoolean()
  decompress: boolean;
}

/**
 * Health Check Response DTO
 */
export class HealthCheckResponseDto {
  @IsString()
  status: string;

  @IsString()
  service: string;

  @IsString()
  timestamp: string;

  @IsString()
  version: string;

  @IsString()
  cache: string;
}

/**
 * Gateway Statistics Response DTO
 */
export class GatewayStatsResponseDto {
  @IsObject()
  cache: Record<string, any>;

  @IsNumber()
  uptime: number;

  @IsObject()
  memoryUsage: Record<string, any>;

  @IsString()
  timestamp: string;
}

/**
 * Cache Stats Response DTO
 */
export class CacheStatsResponseDto {
  @IsObject()
  redis: Record<string, any>;

  @IsObject()
  config: {
    defaultTTL: number;
    defaultTTLHours: number;
  };
}

/**
 * Cache Clear Response DTO
 */
export class CacheClearResponseDto {
  @IsBoolean()
  success: boolean;

  @IsString()
  message: string;

  @IsNumber()
  clearedEntries: number;
}

/**
 * Failover Analytics Response DTO
 */
export class FailoverAnalyticsResponseDto {
  @IsBoolean()
  success: boolean;

  @IsObject()
  data: {
    metrics: any;
    healthStatus: any;
    timestamp: string;
  };
}

/**
 * Firewall Analytics Response DTO
 */
export class FirewallAnalyticsResponseDto {
  @IsBoolean()
  success: boolean;

  @IsObject()
  data: any;
}

/**
 * Queue Status Response DTO
 */
export class QueueStatusResponseDto {
  @IsBoolean()
  success: boolean;

  @IsObject()
  data: {
    queueDepth: number;
    activeWorkers: number;
    maxWaitTime: number;
    averageProcessingTime: number;
    priorityDistribution: Record<string, number>;
    isOverCapacity: boolean;
    wouldExceedMaxWait: boolean;
    timestamp: string;
  };
}

/**
 * Generic Success Response DTO
 */
export class SuccessResponseDto {
  @IsBoolean()
  success: boolean;

  @IsObject()
  data?: any;

  @IsString()
  message?: string;
}

/**
 * Generic Error Response DTO
 */
export class ErrorResponseDto {
  @IsString()
  error: string;

  @IsString()
  message: string;

  @IsObject()
  details?: any;

  @IsString()
  timestamp?: string;

  @IsNumber()
  retryAfter?: number;
}
