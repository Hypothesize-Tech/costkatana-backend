import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage } from '../../../schemas/core/usage.schema';

/**
 * Traffic Management Service
 *
 * Manages API traffic patterns, implements rate limiting strategies,
 * and provides intelligent traffic routing based on load and performance.
 */
@Injectable()
export class TrafficManagementService {
  private readonly logger = new Logger(TrafficManagementService.name);

  // Traffic metrics tracking
  private trafficMetrics = new Map<
    string,
    {
      requestsPerMinute: number;
      averageResponseTime: number;
      errorRate: number;
      lastUpdated: Date;
      loadFactor: number;
      requestCount?: number;
      userAgent?: string;
      clientIp?: string;
      method?: string;
      statusCode?: number;
    }
  >();

  // Rate limiting state
  private rateLimiters = new Map<
    string,
    {
      tokens: number;
      lastRefill: Date;
      maxTokens: number;
      refillRate: number; // tokens per second
    }
  >();

  constructor(@InjectModel(Usage.name) private usageModel: Model<any>) {
    // Start background traffic monitoring
    this.startTrafficMonitoring();
  }

  /**
   * Check if request should be allowed based on traffic management rules
   */
  async shouldAllowRequest(
    endpoint: string,
    userId: string,
    clientIp: string,
    requestData?: {
      userAgent?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: any;
    },
  ): Promise<{ allowed: boolean; reason?: string; retryAfter?: number }> {
    try {
      // Check rate limits
      const rateLimitResult = await this.checkRateLimit(userId, endpoint);
      if (!rateLimitResult.allowed) {
        return {
          allowed: false,
          reason: 'Rate limit exceeded',
          retryAfter: rateLimitResult.retryAfter,
        };
      }

      // Check traffic load
      const loadResult = await this.checkTrafficLoad(endpoint);
      if (!loadResult.allowed) {
        return {
          allowed: false,
          reason: 'High traffic load',
          retryAfter: loadResult.retryAfter,
        };
      }

      // Check for traffic patterns that might indicate abuse
      const patternResult = await this.checkTrafficPatterns(
        clientIp,
        userId,
        requestData,
      );
      if (!patternResult.allowed) {
        return {
          allowed: false,
          reason: 'Suspicious traffic pattern detected',
        };
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error('Error in traffic management check', {
        endpoint,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Allow request on error to avoid blocking legitimate traffic
      return { allowed: true };
    }
  }

  /**
   * Record traffic metrics for an endpoint
   */
  async recordTrafficMetrics(
    endpoint: string,
    responseTime: number,
    success: boolean,
    userId: string,
    additionalData?: {
      userAgent?: string;
      clientIp?: string;
      method?: string;
      statusCode?: number;
    },
  ): Promise<void> {
    try {
      const key = `${endpoint}:${userId}`;
      const existing = this.trafficMetrics.get(key) || {
        requestsPerMinute: 0,
        averageResponseTime: 0,
        errorRate: 0,
        lastUpdated: new Date(),
        loadFactor: 1,
        userAgent: additionalData?.userAgent,
        clientIp: additionalData?.clientIp,
        method: additionalData?.method,
        statusCode: additionalData?.statusCode,
        requestCount: 0,
      };

      // Update request count for rate calculation
      existing.requestCount = (existing.requestCount || 0) + 1;

      // Calculate requests per minute based on time window
      const timeSinceLastUpdate = Date.now() - existing.lastUpdated.getTime();
      if (timeSinceLastUpdate > 0) {
        const minutesElapsed = timeSinceLastUpdate / (1000 * 60);
        existing.requestsPerMinute =
          existing.requestCount / Math.max(minutesElapsed, 0.0167); // Min 1 second
      }

      // Update metrics using exponential moving average
      const alpha = 0.1; // Smoothing factor
      existing.averageResponseTime =
        existing.averageResponseTime * (1 - alpha) + responseTime * alpha;
      existing.errorRate =
        existing.errorRate * (1 - alpha) + (success ? 0 : 1) * alpha;
      existing.loadFactor = this.calculateLoadFactor(existing);

      // Update metadata
      if (additionalData?.userAgent) {
        existing.userAgent = additionalData.userAgent;
      }
      if (additionalData?.clientIp) {
        existing.clientIp = additionalData.clientIp;
      }
      if (additionalData?.method) {
        existing.method = additionalData.method;
      }
      if (additionalData?.statusCode) {
        existing.statusCode = additionalData.statusCode;
      }

      existing.lastUpdated = new Date();

      this.trafficMetrics.set(key, existing);

      // Also persist to database for long-term analytics
      await this.persistTrafficMetrics(key, existing);
    } catch (error) {
      this.logger.warn('Failed to record traffic metrics', {
        endpoint,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Persist traffic metrics to database for analytics
   */
  private async persistTrafficMetrics(
    key: string,
    metrics: any,
  ): Promise<void> {
    try {
      // Create usage record for traffic analytics
      const [endpoint, userId] = key.split(':');

      await this.usageModel.create({
        userId,
        endpoint,
        clientIp: metrics.clientIp,
        userAgent: metrics.userAgent,
        method: metrics.method,
        statusCode: metrics.statusCode,
        responseTime: metrics.averageResponseTime,
        cost: 0, // Traffic monitoring doesn't incur cost
        tokensUsed: 0,
        model: 'traffic-monitor',
        createdAt: new Date(),
      });
    } catch (error) {
      // Don't throw error for metrics persistence failure
      this.logger.debug('Failed to persist traffic metrics', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get traffic analytics for monitoring
   */
  async getTrafficAnalytics(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalRequests: number;
    peakLoadTimes: Date[];
    highTrafficEndpoints: string[];
    averageResponseTime: number;
    errorRate: number;
  }> {
    try {
      const usageStats = await this.usageModel.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: {
              endpoint: '$endpoint',
              date: {
                $dateToString: {
                  format: '%Y-%m-%d-%H',
                  date: '$createdAt',
                },
              },
            },
            requestCount: { $sum: 1 },
            averageResponseTime: { $avg: '$responseTime' },
            errorCount: {
              $sum: { $cond: [{ $eq: ['$errorOccurred', true] }, 1, 0] },
            },
          },
        },
        {
          $group: {
            _id: '$_id.date',
            endpoints: {
              $push: {
                endpoint: '$_id.endpoint',
                requests: '$requestCount',
                avgResponseTime: '$averageResponseTime',
                errors: '$errorCount',
              },
            },
            totalRequests: { $sum: '$requestCount' },
            totalErrors: { $sum: '$errorCount' },
          },
        },
        {
          $sort: { totalRequests: -1 },
        },
        {
          $limit: 10,
        },
      ]);

      const totalRequests = usageStats.reduce(
        (sum, stat) => sum + stat.totalRequests,
        0,
      );
      const totalErrors = usageStats.reduce(
        (sum, stat) => sum + stat.totalErrors,
        0,
      );
      const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

      const averageResponseTime =
        usageStats.length > 0
          ? usageStats.reduce(
              (sum, stat) =>
                sum +
                stat.endpoints.reduce(
                  (
                    endpointSum: number,
                    endpoint: { avgResponseTime?: number },
                  ) => endpointSum + (endpoint.avgResponseTime || 0),
                  0,
                ) /
                  stat.endpoints.length,
              0,
            ) / usageStats.length
          : 0;

      const highTrafficEndpoints = usageStats
        .flatMap((stat) => stat.endpoints)
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 5)
        .map((endpoint) => endpoint.endpoint);

      // Find peak load times (simplified - would need more complex analysis)
      const peakLoadTimes = usageStats
        .filter(
          (stat) =>
            stat.totalRequests > (totalRequests / usageStats.length) * 1.5,
        )
        .map((stat) => new Date(stat._id));

      return {
        totalRequests,
        peakLoadTimes,
        highTrafficEndpoints,
        averageResponseTime,
        errorRate,
      };
    } catch (error) {
      this.logger.error('Failed to get traffic analytics', {
        startDate,
        endDate,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        totalRequests: 0,
        peakLoadTimes: [],
        highTrafficEndpoints: [],
        averageResponseTime: 0,
        errorRate: 0,
      };
    }
  }

  /**
   * Check rate limit for a user/endpoint combination
   */
  private async checkRateLimit(
    userId: string,
    endpoint: string,
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    const key = `${userId}:${endpoint}`;
    const now = new Date();

    let limiter = this.rateLimiters.get(key);
    if (!limiter) {
      // Initialize rate limiter with default settings
      limiter = {
        tokens: 100, // Max 100 requests per minute
        lastRefill: now,
        maxTokens: 100,
        refillRate: 100 / 60, // 100 tokens per minute = ~1.67 tokens per second
      };
      this.rateLimiters.set(key, limiter);
    }

    // Refill tokens based on time passed
    const timePassed = (now.getTime() - limiter.lastRefill.getTime()) / 1000; // seconds
    const tokensToAdd = timePassed * limiter.refillRate;
    limiter.tokens = Math.min(limiter.maxTokens, limiter.tokens + tokensToAdd);
    limiter.lastRefill = now;

    if (limiter.tokens >= 1) {
      limiter.tokens -= 1;
      return { allowed: true };
    }

    // Calculate retry after time
    const retryAfter = Math.ceil((1 - limiter.tokens) / limiter.refillRate);
    return { allowed: false, retryAfter };
  }

  /**
   * Check current traffic load for an endpoint using adaptive thresholds
   */
  private async checkTrafficLoad(
    endpoint: string,
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    try {
      // Get current load metrics for this endpoint
      const endpointMetrics = this.getEndpointLoadMetrics(endpoint);

      if (!endpointMetrics) {
        // No metrics available, allow request
        return { allowed: true };
      }

      // Calculate adaptive thresholds based on historical data
      const thresholds = await this.calculateAdaptiveThresholds(endpoint);

      // Check various load indicators
      const loadChecks = {
        responseTime:
          endpointMetrics.averageResponseTime > thresholds.maxResponseTime,
        errorRate: endpointMetrics.errorRate > thresholds.maxErrorRate,
        requestRate: endpointMetrics.requestsPerMinute > thresholds.maxRPM,
        overallLoad: endpointMetrics.loadFactor > thresholds.maxLoadFactor,
      };

      const failedChecks = Object.entries(loadChecks).filter(
        ([, failed]) => failed,
      );

      if (failedChecks.length > 0) {
        // Calculate retry time based on load severity
        const retryAfter = this.calculateRetryTime(endpointMetrics, thresholds);

        this.logger.warn('High traffic load detected', {
          endpoint,
          failedChecks: failedChecks.map(([check]) => check),
          currentMetrics: endpointMetrics,
          thresholds,
          retryAfter,
        });

        return {
          allowed: false,
          retryAfter,
        };
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error('Error checking traffic load', {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      });
      // Allow request on error
      return { allowed: true };
    }
  }

  /**
   * Get current load metrics for a specific endpoint
   */
  private getEndpointLoadMetrics(endpoint: string): any | null {
    // Find metrics that match this endpoint
    for (const [key, metrics] of this.trafficMetrics.entries()) {
      if (key.includes(endpoint) || endpoint.includes(key.split(':')[0])) {
        return metrics;
      }
    }

    // Check for similar endpoints (partial matches)
    const similarMetrics = Array.from(this.trafficMetrics.entries())
      .filter(([key]) => key.includes(endpoint.split('/')[1] || endpoint))
      .map(([, metrics]) => metrics);

    if (similarMetrics.length > 0) {
      // Return average of similar metrics
      return {
        requestsPerMinute:
          similarMetrics.reduce((sum, m) => sum + m.requestsPerMinute, 0) /
          similarMetrics.length,
        averageResponseTime:
          similarMetrics.reduce((sum, m) => sum + m.averageResponseTime, 0) /
          similarMetrics.length,
        errorRate:
          similarMetrics.reduce((sum, m) => sum + m.errorRate, 0) /
          similarMetrics.length,
        loadFactor:
          similarMetrics.reduce((sum, m) => sum + m.loadFactor, 0) /
          similarMetrics.length,
      };
    }

    return null;
  }

  /**
   * Calculate adaptive thresholds based on historical performance
   */
  private async calculateAdaptiveThresholds(endpoint: string): Promise<{
    maxResponseTime: number;
    maxErrorRate: number;
    maxRPM: number;
    maxLoadFactor: number;
  }> {
    // Base thresholds
    const baseThresholds = {
      maxResponseTime: 5000, // 5 seconds
      maxErrorRate: 0.1, // 10% error rate
      maxRPM: 100, // 100 requests per minute
      maxLoadFactor: 2.0, // 2x normal load
    };

    // In a real implementation, these would be calculated from historical data
    // For now, use configurable values with environment variable overrides

    return {
      maxResponseTime: parseInt(
        process.env.MAX_RESPONSE_TIME_MS ||
          String(baseThresholds.maxResponseTime),
        10,
      ),
      maxErrorRate: parseFloat(
        process.env.MAX_ERROR_RATE || String(baseThresholds.maxErrorRate),
      ),
      maxRPM: parseInt(
        process.env.MAX_REQUESTS_PER_MINUTE || String(baseThresholds.maxRPM),
        10,
      ),
      maxLoadFactor: parseFloat(
        process.env.MAX_LOAD_FACTOR || String(baseThresholds.maxLoadFactor),
      ),
    };
  }

  /**
   * Calculate appropriate retry time based on current load
   */
  private calculateRetryTime(metrics: any, thresholds: any): number {
    // Calculate retry time based on how far over thresholds we are
    const responseTimeRatio =
      metrics.averageResponseTime / thresholds.maxResponseTime;
    const errorRateRatio = metrics.errorRate / thresholds.maxErrorRate;
    const rpmRatio = metrics.requestsPerMinute / thresholds.maxRPM;
    const loadRatio = metrics.loadFactor / thresholds.maxLoadFactor;

    // Use the highest ratio to determine severity
    const maxRatio = Math.max(
      responseTimeRatio,
      errorRateRatio,
      rpmRatio,
      loadRatio,
    );

    if (maxRatio < 1.2) {
      return 10; // 10 seconds for mild overload
    } else if (maxRatio < 1.5) {
      return 30; // 30 seconds for moderate overload
    } else if (maxRatio < 2.0) {
      return 60; // 1 minute for high overload
    } else {
      return 300; // 5 minutes for extreme overload
    }
  }

  /**
   * Check for suspicious traffic patterns using advanced heuristics
   */
  private async checkTrafficPatterns(
    clientIp: string,
    userId: string,
    requestData?: {
      userAgent?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: any;
    },
  ): Promise<{ allowed: boolean }> {
    try {
      // Get recent traffic data for this IP and user
      const recentTraffic = await this.getRecentTrafficData(clientIp, userId);

      // Check for various suspicious patterns
      const patterns = {
        rapidRequests: this.detectRapidRequests(recentTraffic),
        unusualUserAgent: this.detectUnusualUserAgent(
          recentTraffic,
          requestData?.userAgent,
        ),
        ipRotation: this.detectIPRotation(recentTraffic),
        burstTraffic: this.detectBurstTraffic(recentTraffic),
        suspiciousTiming: this.detectSuspiciousTiming(recentTraffic),
        suspiciousHeaders: this.detectSuspiciousHeaders(requestData?.headers),
        suspiciousBody: this.detectSuspiciousBody(requestData?.body),
      };

      // Calculate suspicion score
      let suspicionScore = 0;
      if (patterns.rapidRequests) suspicionScore += 0.3;
      if (patterns.unusualUserAgent) suspicionScore += 0.2;
      if (patterns.ipRotation) suspicionScore += 0.4;
      if (patterns.burstTraffic) suspicionScore += 0.2;
      if (patterns.suspiciousTiming) suspicionScore += 0.1;
      if (patterns.suspiciousHeaders) suspicionScore += 0.3;
      if (patterns.suspiciousBody) suspicionScore += 0.4;

      // Log suspicious activity
      if (suspicionScore > 0.5) {
        this.logger.warn('Suspicious traffic pattern detected', {
          clientIp,
          userId,
          suspicionScore,
          patterns: Object.entries(patterns).filter(([, detected]) => detected),
        });
      }

      // Allow requests with low suspicion scores, block high scores
      return { allowed: suspicionScore < 0.7 };
    } catch (error) {
      this.logger.error('Error checking traffic patterns', {
        clientIp,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Allow request on error to avoid blocking legitimate traffic
      return { allowed: true };
    }
  }

  /**
   * Get recent traffic data for analysis from database
   */
  private async getRecentTrafficData(
    clientIp: string,
    userId: string,
  ): Promise<any[]> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      // Query actual usage data from database
      const recentUsage = await this.usageModel
        .find({
          $or: [{ userId }, { clientIp }],
          createdAt: { $gte: fiveMinutesAgo },
        })
        .sort({ createdAt: -1 })
        .limit(100) // Limit to prevent excessive memory usage
        .lean();

      // Transform to analysis format
      return recentUsage.map((usage) => ({
        timestamp: new Date(usage.createdAt),
        requestsPerMinute: 1, // Each document represents one request
        errorRate: usage.errorOccurred ? 1 : 0,
        clientIp: usage.clientIp || clientIp,
        userId: usage.userId,
        userAgent: (usage as any).userAgent,
        endpoint: usage.endpoint,
        responseTime: usage.responseTime || 0,
        cost: usage.cost || 0,
      }));
    } catch (error) {
      this.logger.error('Failed to get recent traffic data from database', {
        clientIp,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to in-memory metrics if database query fails
      return this.getFallbackTrafficData(clientIp, userId);
    }
  }

  /**
   * Fallback method using in-memory metrics when database is unavailable
   */
  private getFallbackTrafficData(clientIp: string, userId: string): any[] {
    const recentData: any[] = [];
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    for (const [key, metrics] of this.trafficMetrics.entries()) {
      if (
        key.includes(userId) &&
        metrics.lastUpdated.getTime() > fiveMinutesAgo
      ) {
        recentData.push({
          timestamp: metrics.lastUpdated,
          requestsPerMinute: metrics.requestsPerMinute,
          errorRate: metrics.errorRate,
          clientIp,
          userId,
        });
      }
    }

    return recentData;
  }

  /**
   * Detect rapid consecutive requests
   */
  private detectRapidRequests(trafficData: any[]): boolean {
    if (trafficData.length < 5) return false;

    // Check if requests are coming too frequently
    const recentRequests = trafficData.slice(-5);
    const avgRPM =
      recentRequests.reduce((sum, data) => sum + data.requestsPerMinute, 0) /
      recentRequests.length;

    // Flag if average RPM exceeds threshold
    return avgRPM > 120; // More than 2 requests per second on average
  }

  /**
   * Detect unusual user agent patterns
   */
  private detectUnusualUserAgent(
    trafficData: any[],
    currentUserAgent?: string,
  ): boolean {
    // Check current request's user agent first
    if (currentUserAgent) {
      const currentSuspicious = this.isUserAgentSuspicious(currentUserAgent);
      if (currentSuspicious) {
        return true;
      }
    }

    if (trafficData.length === 0) return false;

    // Known bot user agent patterns
    const botPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
      /headless/i,
      /selenium/i,
      /puppeteer/i,
      /chrome.*headless/i,
      /phantomjs/i,
      /nightmarejs/i,
      /electron/i,
      /python-requests/i,
      /java\//i,
      /go-http-client/i,
      /curl/i,
      /wget/i,
    ];

    // Suspicious patterns
    const suspiciousPatterns = [
      /^["']?["']?$/, // Empty or just quotes
      /^[a-zA-Z]{1,10}$/, // Very short user agents
      /mozilla\/4\.0/i, // Very old browsers
      /compatible;/i, // IE compatibility mode
    ];

    let suspiciousCount = 0;
    let totalWithUserAgent = 0;

    for (const data of trafficData) {
      const userAgent = data.userAgent;
      if (!userAgent) {
        suspiciousCount++; // Missing user agent is suspicious
        continue;
      }

      totalWithUserAgent++;

      // Check for bot patterns
      const isBot = botPatterns.some((pattern) => pattern.test(userAgent));
      if (isBot) {
        suspiciousCount++;
        continue;
      }

      // Check for suspicious patterns
      const isSuspicious = suspiciousPatterns.some((pattern) =>
        pattern.test(userAgent),
      );
      if (isSuspicious) {
        suspiciousCount++;
        continue;
      }

      // Check user agent length (too short or too long)
      if (userAgent.length < 10 || userAgent.length > 500) {
        suspiciousCount++;
        continue;
      }

      // Check for repetitive characters (potential obfuscation)
      const repetitiveChars = /(.)\1{10,}/.test(userAgent);
      if (repetitiveChars) {
        suspiciousCount++;
        continue;
      }
    }

    // Calculate suspicion ratio
    const totalRequests = trafficData.length;
    const suspicionRatio = suspiciousCount / totalRequests;

    // Flag as suspicious if more than 30% of requests have suspicious user agents
    // or if all requests are missing user agents
    return (
      suspicionRatio > 0.3 || (totalWithUserAgent === 0 && totalRequests > 2)
    );
  }

  /**
   * Check if a single user agent string is suspicious
   */
  private isUserAgentSuspicious(userAgent: string): boolean {
    if (!userAgent || userAgent.trim().length === 0) {
      return true; // Missing or empty user agent
    }

    const ua = userAgent.trim();

    // Check length
    if (ua.length < 10 || ua.length > 500) {
      return true;
    }

    // Check for known bot patterns
    const botPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
      /headless/i,
      /selenium/i,
      /puppeteer/i,
      /phantomjs/i,
      /electron/i,
    ];

    if (botPatterns.some((pattern) => pattern.test(ua))) {
      return true;
    }

    // Check for suspicious patterns
    const suspiciousPatterns = [
      /^["']?["']?$/, // Just quotes
      /^[a-zA-Z]{1,10}$/, // Very short
      /(.)\1{10,}/, // Repetitive characters
    ];

    if (suspiciousPatterns.some((pattern) => pattern.test(ua))) {
      return true;
    }

    return false;
  }

  /**
   * Detect suspicious headers
   */
  private detectSuspiciousHeaders(headers?: Record<string, string>): boolean {
    if (!headers) return false;

    // Check for suspicious header patterns
    const suspiciousHeaders = [
      'x-forwarded-for', // Multiple values or suspicious IPs
      'referer', // Unusual referer patterns
    ];

    for (const headerName of suspiciousHeaders) {
      const headerValue = headers[headerName];
      if (headerValue) {
        // Check for multiple IPs in X-Forwarded-For
        if (headerName === 'x-forwarded-for') {
          const ips = headerValue.split(',').map((ip) => ip.trim());
          if (ips.length > 3) {
            // Too many forwarded IPs
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Detect suspicious request body patterns using comprehensive WAF-style rules
   */
  private detectSuspiciousBody(body?: any): boolean {
    if (!body) return false;

    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    const normalized = bodyString.toLowerCase();

    const suspiciousPatterns = [
      // SQL injection
      /\b(UNION|SELECT|DROP|INSERT|UPDATE|DELETE|EXEC|EXECUTE|TRUNCATE)\b/i,
      /;\s*--|\/\*|\*\/|' OR '1'='1|" OR "1"="1|1=1|OR 1=1/i,
      /\b(SLEEP|BENCHMARK|WAITFOR)\s*\(/i,
      /INTO\s+(OUTFILE|DUMPFILE)/i,
      // XSS
      /<script[^>]*>[\s\S]*?<\/script>/i,
      /javascript:/i,
      /vbscript:/i,
      /data:\s*text\/html/i,
      /on\w+\s*=\s*["']?[^"'\s>]*/i, // onerror=, onload=, onclick=, etc.
      /<img[^>]+onerror/i,
      /<iframe[^>]*>/i,
      /expression\s*\(/i, // CSS expression
      // NoSQL injection
      /\$\s*(gt|gte|lt|lte|ne|in|exists|regex)\s*:/i,
      /\{\s*"\$[a-z]+"\s*:/i,
      // Command injection
      /[;&|`]\s*(curl|wget|nc|bash|sh|cmd|powershell)/i,
      /\$\([^)]*\)|`[^`]*`/, // Command substitution
      // Path traversal
      /\.\.\/(\.\.\/)+/,
      /%2e%2e%2f|%2e%2e\//i,
      // LDAP injection (filter injection)
      /\*\)\s*\(|\)\s*\(\s*\*/i,
      // XML/XXE
      /<!ENTITY|<!DOCTYPE\s+[^\s[]+\[/i,
      /SYSTEM\s+["'](?:file|expect|php):/i,
    ];

    const highEntropySuspicious =
      /(eval\s*\(|Function\s*\(|setTimeout\s*\([^,]*\)|setInterval\s*\([^,]*\))/i;
    if (highEntropySuspicious.test(bodyString)) return true;

    return suspiciousPatterns.some((pattern) => pattern.test(bodyString));
  }

  /**
   * Detect IP rotation (rapid changes in IP for same user)
   */
  private detectIPRotation(trafficData: any[]): boolean {
    if (trafficData.length < 3) return false;

    // Check for multiple different IPs used by same user recently
    const uniqueIPs = new Set(trafficData.map((data) => data.clientIp));

    // Flag if user has used more than 2 different IPs in recent traffic
    return uniqueIPs.size > 2;
  }

  /**
   * Detect burst traffic patterns
   */
  private detectBurstTraffic(trafficData: any[]): boolean {
    if (trafficData.length < 10) return false;

    // Look for sudden spikes in traffic
    const recentData = trafficData.slice(-10);
    const avgRPM =
      recentData.reduce((sum, data) => sum + data.requestsPerMinute, 0) /
      recentData.length;

    // Check last 2 data points for burst
    const lastTwo = recentData.slice(-2);
    const recentAvg =
      lastTwo.reduce((sum, data) => sum + data.requestsPerMinute, 0) /
      lastTwo.length;

    // Flag if recent traffic is 3x the overall average
    return recentAvg > avgRPM * 3;
  }

  /**
   * Detect suspicious timing patterns
   */
  private detectSuspiciousTiming(trafficData: any[]): boolean {
    if (trafficData.length < 5) return false;

    // Check for perfectly regular timing (bots often have exact intervals)
    const timestamps = trafficData
      .map((data) => data.timestamp)
      .sort((a, b) => a - b);

    if (timestamps.length < 3) return false;

    // Calculate intervals between requests
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    // Check if intervals are too regular (within 100ms of each other)
    const avgInterval =
      intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const regularityScore =
      intervals.reduce(
        (sum, interval) => sum + Math.abs(interval - avgInterval),
        0,
      ) / intervals.length;

    // Flag if intervals are very regular (low variance)
    return regularityScore < 2000; // Less than 2 second average variance
  }

  /**
   * Calculate load factor based on traffic metrics
   */
  private calculateLoadFactor(metrics: any): number {
    const responseTimeFactor = metrics.averageResponseTime / 1000; // Normalize to seconds
    const errorFactor = metrics.errorRate * 2; // Weight errors more heavily
    const requestFactor = Math.min(metrics.requestsPerMinute / 100, 2); // Cap at 2x normal load

    return Math.max(1, responseTimeFactor + errorFactor + requestFactor);
  }

  /**
   * Start background traffic monitoring
   */
  private startTrafficMonitoring(): void {
    setInterval(
      () => {
        this.cleanupOldMetrics();
      },
      5 * 60 * 1000,
    ); // Clean up every 5 minutes
  }

  /**
   * Clean up old traffic metrics to prevent memory leaks
   */
  private cleanupOldMetrics(): void {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

    for (const [key, metrics] of this.trafficMetrics.entries()) {
      if (metrics.lastUpdated < cutoff) {
        this.trafficMetrics.delete(key);
      }
    }

    // Also cleanup rate limiters
    for (const [key, limiter] of this.rateLimiters.entries()) {
      if (limiter.lastRefill < cutoff) {
        this.rateLimiters.delete(key);
      }
    }
  }
}
