import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';
import { RealtimeUpdateService } from './realtime-update.service';
import { calculateCost } from '@/utils/pricing';
import { extractErrorDetails } from '@/utils/helpers';

interface ClientSideData {
  performance: {
    clientSideTime?: number;
    networkTime: number;
    dataTransferEfficiency: number;
  };
  network: {
    dnsLookupTime?: number;
    tcpConnectTime?: number;
    tlsHandshakeTime?: number;
  };
  payload: {
    requestSize: number;
    responseSize: number;
    compressionRatio?: number;
  };
  geoLocation?: {
    country: string;
    region: string;
    city: string;
  };
  sdkVersion?: string;
  environment?: string;
}

interface ServerSideData {
  clientInfo: {
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
  };
  headers: {
    request: Record<string, string>;
    response: Record<string, string>;
  };
  networking: {
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
  };
  payload: {
    requestSize: number;
    responseSize: number;
    contentType: string;
    encoding?: string;
    compressionRatio?: number;
  };
  performance: {
    clientSideTime?: number;
    networkTime: number;
    serverProcessingTime: number;
    totalRoundTripTime: number;
    dataTransferEfficiency: number;
  };
  traceId?: string;
  correlationId?: string;
}

interface UsageMetadata {
  userId: string;
  service?: string;
  model?: string;
  prompt?: string;
  completion?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  responseTime?: number;
  metadata?: Record<string, any>;
  tags?: string[];
  projectId?: string;
  workflowId?: string;
  workflowName?: string;
  workflowStep?: string;
  workflowSequence?: number;
  userEmail?: string;
  customerEmail?: string;
  errorOccurred?: boolean;
  errorMessage?: string;
  httpStatusCode?: number;
  errorType?: string;
  optimizationApplied?: boolean;
}

@Injectable()
export class ComprehensiveTrackingService {
  private readonly logger = new Logger(ComprehensiveTrackingService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    private realtimeUpdateService: RealtimeUpdateService,
  ) {}

  /**
   * Process comprehensive tracking with both client and server data
   */
  async processComprehensiveTracking(
    clientData: ClientSideData,
    serverData: ServerSideData,
    usageMetadata: UsageMetadata,
  ): Promise<UsageDocument> {
    try {
      this.logger.log(
        `Processing comprehensive tracking for user ${usageMetadata.userId}`,
      );

      // Merge client and server data
      const mergedData = this.mergeClientServerData(clientData, serverData);

      // Enhance with geo-location if not provided
      const enhancedData = await this.enhanceWithGeoLocation(mergedData);

      // Generate optimization suggestions
      const optimizationSuggestions =
        await this.generateOptimizationSuggestions(enhancedData);

      // Create comprehensive usage record
      const usageData = {
        ...usageMetadata,
        requestTracking: enhancedData,
        optimizationOpportunities:
          optimizationSuggestions.optimizationOpportunities,
        promptCaching: optimizationSuggestions.promptCaching,
        createdAt: new Date(),
      };

      // Calculate cost if not provided
      if (
        !usageData.cost &&
        usageData.service &&
        usageData.model &&
        usageData.promptTokens &&
        usageData.completionTokens
      ) {
        try {
          usageData.cost = calculateCost(
            usageData.promptTokens,
            usageData.completionTokens,
            usageData.service,
            usageData.model,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to calculate cost for ${usageData.service}/${usageData.model}`,
            error,
          );
          usageData.cost = 0;
        }
      }

      // Extract error details if present
      if (usageMetadata.errorMessage || usageMetadata.httpStatusCode) {
        const errorDetails = extractErrorDetails(usageMetadata, {
          originalUrl: serverData.networking.serverEndpoint,
        });
        (usageData as any).errorOccurred = errorDetails.errorType !== undefined;
        (usageData as any).errorType = errorDetails.errorType;
        (usageData as any).errorDetails = errorDetails.errorDetails;
        (usageData as any).isClientError = errorDetails.isClientError;
        (usageData as any).isServerError = errorDetails.isServerError;
        (usageData as any).httpStatusCode = errorDetails.httpStatusCode;
      }

      const usage = new this.usageModel(usageData);
      const savedUsage = await usage.save();

      // Emit real-time update
      await this.realtimeUpdateService.emitUsageUpdate(
        usageMetadata.userId,
        savedUsage,
      );

      this.logger.log(
        `Comprehensive tracking completed for usage ${savedUsage._id}`,
      );
      return savedUsage;
    } catch (error) {
      this.logger.error(
        `Failed to process comprehensive tracking for user ${usageMetadata.userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Process server-side only tracking
   */
  async processServerSideTracking(
    serverData: ServerSideData,
    usageMetadata: UsageMetadata,
  ): Promise<UsageDocument> {
    try {
      this.logger.log(
        `Processing server-side tracking for user ${usageMetadata.userId}`,
      );

      // Enhance with geo-location
      const enhancedData = await this.enhanceWithGeoLocation(serverData);

      // Generate basic optimization suggestions
      const optimizationSuggestions =
        await this.generateOptimizationSuggestions(enhancedData);

      const usageData = {
        ...usageMetadata,
        requestTracking: enhancedData,
        optimizationOpportunities:
          optimizationSuggestions.optimizationOpportunities,
        promptCaching: optimizationSuggestions.promptCaching,
        createdAt: new Date(),
      };

      // Calculate cost if not provided
      if (
        !usageData.cost &&
        usageData.service &&
        usageData.model &&
        usageData.promptTokens &&
        usageData.completionTokens
      ) {
        try {
          usageData.cost = calculateCost(
            usageData.promptTokens,
            usageData.completionTokens,
            usageData.service,
            usageData.model,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to calculate cost for ${usageData.service}/${usageData.model}`,
            error,
          );
          usageData.cost = 0;
        }
      }

      const usage = new this.usageModel(usageData);
      const savedUsage = await usage.save();

      // Emit real-time update
      await this.realtimeUpdateService.emitUsageUpdate(
        usageMetadata.userId,
        savedUsage,
      );

      this.logger.log(
        `Server-side tracking completed for usage ${savedUsage._id}`,
      );
      return savedUsage;
    } catch (error) {
      this.logger.error(
        `Failed to process server-side tracking for user ${usageMetadata.userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Merge client-side and server-side tracking data
   */
  private mergeClientServerData(
    clientData: ClientSideData,
    serverData: ServerSideData,
  ): ServerSideData {
    return {
      ...serverData,
      performance: {
        ...serverData.performance,
        clientSideTime: clientData.performance.clientSideTime,
        networkTime: clientData.performance.networkTime,
        dataTransferEfficiency: clientData.performance.dataTransferEfficiency,
      },
      payload: {
        ...serverData.payload,
        requestSize: Math.max(
          serverData.payload.requestSize,
          clientData.payload.requestSize,
        ),
        responseSize: Math.max(
          serverData.payload.responseSize,
          clientData.payload.responseSize,
        ),
        compressionRatio:
          clientData.payload.compressionRatio ||
          serverData.payload.compressionRatio,
      },
      networking: {
        ...serverData.networking,
        dnsLookupTime:
          clientData.network.dnsLookupTime ||
          serverData.networking.dnsLookupTime,
        tcpConnectTime:
          clientData.network.tcpConnectTime ||
          serverData.networking.tcpConnectTime,
        tlsHandshakeTime:
          clientData.network.tlsHandshakeTime ||
          serverData.networking.tlsHandshakeTime,
      },
      clientInfo: {
        ...serverData.clientInfo,
        geoLocation:
          clientData.geoLocation || serverData.clientInfo.geoLocation,
        sdkVersion: clientData.sdkVersion || serverData.clientInfo.sdkVersion,
        environment:
          clientData.environment || serverData.clientInfo.environment,
      },
    };
  }

  /**
   * Enhance tracking data with geo-location information
   */
  private async enhanceWithGeoLocation(
    data: ServerSideData,
  ): Promise<ServerSideData> {
    try {
      // If geo-location is already provided, use it
      if (data.clientInfo.geoLocation) {
        return data;
      }

      // Try to get geo-location from IP
      const geoLocation = await this.lookupGeoLocation(data.clientInfo.ip);

      if (geoLocation) {
        return {
          ...data,
          clientInfo: {
            ...data.clientInfo,
            geoLocation,
          },
        };
      }

      return data;
    } catch (error) {
      this.logger.warn('Failed to enhance with geo-location', error);
      return data;
    }
  }

  /**
   * Lookup geo-location from IP address
   */
  private async lookupGeoLocation(
    ip: string,
  ): Promise<{ country: string; region: string; city: string } | null> {
    try {
      // Use geoip-lite for IP geolocation
      const geoip = await import('geoip-lite');
      const geo = geoip.lookup(ip);

      if (geo) {
        return {
          country: geo.country,
          region: geo.region,
          city: geo.city,
        };
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to lookup geo-location for IP ${ip}`, error);
      return null;
    }
  }

  /**
   * Generate optimization suggestions based on tracking data
   */
  private async generateOptimizationSuggestions(data: ServerSideData): Promise<{
    optimizationOpportunities: any;
    promptCaching?: any;
  }> {
    const suggestions = {
      costOptimization: {
        potentialSavings: 0,
        recommendedModel: undefined,
        reasonCode: 'model_downgrade' as const,
        confidence: 0,
        estimatedImpact: '',
      },
      performanceOptimization: {
        currentPerformanceScore: this.calculatePerformanceScore(data),
        bottleneckIdentified: this.identifyBottleneck(data),
        recommendation: '',
        estimatedImprovement: '',
      },
      dataEfficiency: {
        compressionRecommendation: undefined,
        payloadOptimization: undefined,
        headerOptimization: undefined,
      },
    };

    // Analyze performance bottlenecks
    const bottleneck = this.identifyBottleneck(data);
    suggestions.performanceOptimization.bottleneckIdentified = bottleneck;

    switch (bottleneck) {
      case 'network':
        suggestions.performanceOptimization.recommendation =
          'Consider using a geographically closer AI provider';
        suggestions.performanceOptimization.estimatedImprovement =
          '20-40% reduction in network latency';
        break;
      case 'processing':
        suggestions.performanceOptimization.recommendation =
          'Consider using a faster model or optimizing prompts';
        suggestions.performanceOptimization.estimatedImprovement =
          '30-50% reduction in response time';
        break;
      case 'payload_size':
        (suggestions.dataEfficiency as any).compressionRecommendation = true;
        (suggestions.dataEfficiency as any).payloadOptimization =
          'Implement response compression';
        (suggestions.performanceOptimization as any).estimatedImprovement =
          '15-25% reduction in transfer time';
        break;
      default:
        suggestions.performanceOptimization.recommendation =
          'Performance is within acceptable range';
    }

    // Check for compression opportunities
    if (data.payload.responseSize > 1024 * 1024) {
      // > 1MB
      (suggestions.dataEfficiency as any).compressionRecommendation = true;
      (suggestions.dataEfficiency as any).payloadOptimization =
        'Large response detected - consider compression or pagination';
    }

    return {
      optimizationOpportunities: suggestions,
    };
  }

  /**
   * Calculate performance score (0-100)
   */
  private calculatePerformanceScore(data: ServerSideData): number {
    let score = 100;

    // Network time penalty
    if (data.performance.networkTime > 1000) score -= 20;
    else if (data.performance.networkTime > 500) score -= 10;

    // Server processing time penalty
    if (data.performance.serverProcessingTime > 2000) score -= 25;
    else if (data.performance.serverProcessingTime > 1000) score -= 15;

    // Payload size penalty
    if (data.payload.responseSize > 1024 * 1024) score -= 15;
    else if (data.payload.responseSize > 512 * 1024) score -= 8;

    // Data transfer efficiency penalty
    if (data.performance.dataTransferEfficiency < 0.5) score -= 20;
    else if (data.performance.dataTransferEfficiency < 0.8) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Identify performance bottleneck
   */
  private identifyBottleneck(
    data: ServerSideData,
  ): 'network' | 'processing' | 'payload_size' | 'model_complexity' {
    const networkTime = data.performance.networkTime;
    const processingTime = data.performance.serverProcessingTime;
    const payloadSize = data.payload.responseSize;

    // Network bottleneck
    if (networkTime > processingTime * 1.5) {
      return 'network';
    }

    // Payload size bottleneck
    if (payloadSize > 1024 * 1024 && networkTime > 500) {
      return 'payload_size';
    }

    // Processing bottleneck
    if (processingTime > 2000) {
      return 'processing';
    }

    return 'model_complexity';
  }

  /**
   * Analyze network performance patterns
   */
  async analyzeNetworkPerformance(
    userId: string,
    timeRange: { start: Date; end: Date },
  ): Promise<{
    averageNetworkTime: number;
    averageServerProcessingTime: number;
    averageDataTransferEfficiency: number;
    geoDistribution: Record<string, number>;
    performanceTrends: Array<{
      date: string;
      avgNetworkTime: number;
      avgProcessingTime: number;
    }>;
  }> {
    try {
      const networkStats = await this.usageModel.aggregate([
        {
          $match: {
            userId,
            createdAt: { $gte: timeRange.start, $lte: timeRange.end },
            'requestTracking.performance.networkTime': { $exists: true },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            avgNetworkTime: {
              $avg: '$requestTracking.performance.networkTime',
            },
            avgProcessingTime: {
              $avg: '$requestTracking.performance.serverProcessingTime',
            },
            avgDataTransferEfficiency: {
              $avg: '$requestTracking.performance.dataTransferEfficiency',
            },
            count: { $sum: 1 },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      const geoStats = await this.usageModel.aggregate([
        {
          $match: {
            userId,
            createdAt: { $gte: timeRange.start, $lte: timeRange.end },
            'requestTracking.clientInfo.geoLocation.country': { $exists: true },
          },
        },
        {
          $group: {
            _id: '$requestTracking.clientInfo.geoLocation.country',
            count: { $sum: 1 },
          },
        },
      ]);

      const geoDistribution = geoStats.reduce(
        (acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        },
        {} as Record<string, number>,
      );

      const overallStats = await this.usageModel.aggregate([
        {
          $match: {
            userId,
            createdAt: { $gte: timeRange.start, $lte: timeRange.end },
            'requestTracking.performance': { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            avgNetworkTime: {
              $avg: '$requestTracking.performance.networkTime',
            },
            avgServerProcessingTime: {
              $avg: '$requestTracking.performance.serverProcessingTime',
            },
            avgDataTransferEfficiency: {
              $avg: '$requestTracking.performance.dataTransferEfficiency',
            },
          },
        },
      ]);

      const overall = overallStats[0] || {
        avgNetworkTime: 0,
        avgServerProcessingTime: 0,
        avgDataTransferEfficiency: 0,
      };

      return {
        averageNetworkTime: overall.avgNetworkTime || 0,
        averageServerProcessingTime: overall.avgServerProcessingTime || 0,
        averageDataTransferEfficiency: overall.avgDataTransferEfficiency || 0,
        geoDistribution,
        performanceTrends: networkStats.map((stat) => ({
          date: stat._id,
          avgNetworkTime: stat.avgNetworkTime,
          avgProcessingTime: stat.avgProcessingTime,
        })),
      };
    } catch (error) {
      this.logger.error(
        `Failed to analyze network performance for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get comprehensive tracking summary for user
   */
  async getComprehensiveTrackingSummary(
    userId: string,
    timeRange: { start: Date; end: Date },
  ): Promise<{
    totalRequests: number;
    averageResponseTime: number;
    averageNetworkTime: number;
    averageServerProcessingTime: number;
    geoDistribution: Record<string, number>;
    performanceScore: number;
    optimizationOpportunities: number;
    errorRate: number;
  }> {
    try {
      const summary = await this.usageModel.aggregate([
        {
          $match: {
            userId,
            createdAt: { $gte: timeRange.start, $lte: timeRange.end },
          },
        },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            avgNetworkTime: {
              $avg: '$requestTracking.performance.networkTime',
            },
            avgServerProcessingTime: {
              $avg: '$requestTracking.performance.serverProcessingTime',
            },
            totalErrors: {
              $sum: { $cond: [{ $eq: ['$errorOccurred', true] }, 1, 0] },
            },
            totalOptimizationOpportunities: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      '$optimizationOpportunities.costOptimization.potentialSavings',
                      0,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            avgPerformanceScore: {
              $avg: '$optimizationOpportunities.performanceOptimization.currentPerformanceScore',
            },
            geoData: { $push: '$requestTracking.clientInfo.geoLocation' },
          },
        },
      ]);

      if (summary.length === 0) {
        return {
          totalRequests: 0,
          averageResponseTime: 0,
          averageNetworkTime: 0,
          averageServerProcessingTime: 0,
          geoDistribution: {},
          performanceScore: 0,
          optimizationOpportunities: 0,
          errorRate: 0,
        };
      }

      const result = summary[0];

      // Process geo distribution
      const geoDistribution: Record<string, number> = {};
      result.geoData.forEach((geo: any) => {
        if (geo?.country) {
          geoDistribution[geo.country] =
            (geoDistribution[geo.country] || 0) + 1;
        }
      });

      return {
        totalRequests: result.totalRequests,
        averageResponseTime: result.avgResponseTime || 0,
        averageNetworkTime: result.avgNetworkTime || 0,
        averageServerProcessingTime: result.avgServerProcessingTime || 0,
        geoDistribution,
        performanceScore: result.avgPerformanceScore || 0,
        optimizationOpportunities: result.totalOptimizationOpportunities,
        errorRate:
          result.totalRequests > 0
            ? (result.totalErrors / result.totalRequests) * 100
            : 0,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get comprehensive tracking summary for user ${userId}`,
        error,
      );
      throw error;
    }
  }
}
