/**
 * Comprehensive Tracking Service
 * 
 * Processes and stores comprehensive tracking data from client-side SDK and
 * server-side middleware, integrates with OpenTelemetry, and provides
 * analytics and optimization suggestions
 */

import { Usage, IUsage } from '../models/Usage';
import { Telemetry, ITelemetry } from '../models/Telemetry';
import mongoose from 'mongoose';
import { loggingService } from './logging.service';
import { TelemetryService } from './telemetry.service';
import { mixpanelService } from './mixpanel.service';
import { ComprehensiveServerRequestData } from '../middleware/comprehensive-tracking.middleware';
import geoip from 'geoip-lite';

export interface ClientSideTrackingData {
  clientEnvironment: {
    platform: string;
    userAgent?: string;
    sdkVersion: string;
    hostname?: string;
  };
  
  networking: {
    localIP?: string;
    remoteIP: string;
    port: number;
    protocol: 'http' | 'https';
    dnsResolutionTime?: number;
    connectionTime?: number;
    tlsHandshakeTime?: number;
  };
  
  request: {
    method: string;
    url: string;
    path: string;
    headers: Record<string, string>;
    body: any;
    size: number;
    timestamp: Date;
  };
  
  response?: {
    statusCode: number;
    headers: Record<string, string>;
    body: any;
    size: number;
    timestamp: Date;
  };
  
  performance: {
    totalTime: number;
    dnsTime?: number;
    connectTime?: number;
    uploadTime?: number;
    downloadTime?: number;
    redirectTime?: number;
  };
  
  context: {
    sessionId: string;
    requestId: string;
    projectId?: string;
    userId?: string;
    provider?: string;
    model?: string;
  };
}

export interface OptimizationSuggestion {
  type: 'cost' | 'performance' | 'data_efficiency';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  potentialSavings?: number;
  estimatedImpact: string;
  implementation: 'immediate' | 'short_term' | 'long_term';
  effort: 'low' | 'medium' | 'high';
  
  specifics?: {
    currentModel?: string;
    recommendedModel?: string;
    reasonCode?: string;
    confidence?: number;
  };
}

export class ComprehensiveTrackingService {
  private telemetryService: TelemetryService;
  
  constructor() {
    this.telemetryService = new TelemetryService();
  }
  
  /**
   * Process and store comprehensive tracking data from both client and server
   */
  async processComprehensiveTracking(
    clientData: ClientSideTrackingData,
    serverData: ComprehensiveServerRequestData,
    usageMetadata?: Partial<IUsage>
  ): Promise<IUsage> {
    try {
      // Correlate client and server data
      const correlatedData = this.correlateClientServerData(clientData, serverData);
      
      // Generate optimization opportunities
      const optimizationOpportunities = await this.generateOptimizationOpportunities(
        clientData, 
        serverData, 
        usageMetadata
      );
      
      // Ensure required token fields from metadata (dynamic payload support)
      const promptTokens = usageMetadata?.promptTokens ?? 0;
      const completionTokens = usageMetadata?.completionTokens ?? 0;
      const totalTokens = usageMetadata?.totalTokens ?? ((promptTokens + completionTokens) || 0);

      // Create enhanced usage record
      const usageData: Partial<IUsage> = {
        ...usageMetadata,
        promptTokens,
        completionTokens,
        totalTokens,

        // Basic usage fields
        userId: serverData.correlation.userId ? 
          new mongoose.Types.ObjectId(serverData.correlation.userId) : 
          (usageMetadata?.userId ? new mongoose.Types.ObjectId(usageMetadata.userId) : undefined),
        projectId: serverData.correlation.projectId ? 
          new mongoose.Types.ObjectId(serverData.correlation.projectId) : 
          (usageMetadata?.projectId ? 
            (typeof usageMetadata.projectId === 'string' ? 
              new mongoose.Types.ObjectId(usageMetadata.projectId) : 
              usageMetadata.projectId
            ) : undefined),
        
        service: usageMetadata?.service || this.inferServiceFromProvider(clientData.context.provider),
        model: clientData.context.model || usageMetadata?.model || 'unknown',
        
        // Enhanced fields from existing usage metadata
        ipAddress: serverData.clientInfo.ip,
        userAgent: serverData.clientInfo.userAgent,
        responseTime: correlatedData.performance.totalRoundTripTime,
        
        // Comprehensive request tracking
        requestTracking: {
          clientInfo: {
            ip: serverData.clientInfo.ip,
            port: serverData.clientInfo.port,
            forwardedIPs: serverData.clientInfo.forwardedIPs,
            userAgent: serverData.clientInfo.userAgent,
            geoLocation: this.getGeoLocation(serverData.clientInfo.ip),
            sdkVersion: clientData.clientEnvironment.sdkVersion,
            environment: clientData.clientEnvironment.platform
          },
          
          headers: {
            request: { ...clientData.request.headers, ...serverData.request.headers },
            response: clientData.response ? 
              { ...clientData.response.headers, ...serverData.response?.headers } : 
              { ...serverData.response?.headers }
          },
          
          networking: {
            serverEndpoint: serverData.request.url,
            serverFullUrl: serverData.request.fullUrl,
            clientOrigin: serverData.request.clientOrigin ?? 'Direct request (no Origin/Referer)',
            serverIP: serverData.serverInfo.serverIP,
            serverPort: serverData.serverInfo.serverPort,
            routePattern: serverData.request.routePattern || 'unknown',
            protocol: clientData.networking.protocol,
            secure: serverData.clientInfo.secure,
            dnsLookupTime: clientData.performance.dnsTime,
            tcpConnectTime: clientData.performance.connectTime,
            tlsHandshakeTime: clientData.performance.uploadTime || 0 // Use uploadTime as approximation for TLS time
          },
          
          payload: {
            requestBody: this.sanitizeBody(clientData.request.body),
            responseBody: this.sanitizeBody(clientData.response?.body || serverData.response?.body),
            requestSize: clientData.request.size || serverData.request.size,
            responseSize: clientData.response?.size || serverData.response?.size || 0,
            contentType: serverData.response?.headers['content-type'] || 'application/json',
            encoding: serverData.response?.headers['content-encoding'],
            compressionRatio: this.calculateCompressionRatio(
              clientData.response?.headers || serverData.response?.headers
            )
          },
          
          performance: correlatedData.performance
        },
        
        // Optimization opportunities
        optimizationOpportunities
      };
      
      // Save to Usage collection
      const usage = new Usage(usageData);
      await usage.save();
      
      // Create telemetry span for comprehensive tracking
      await this.createTelemetrySpan(usage, clientData, serverData);
      
      // Track analytics
      await this.trackComprehensiveAnalytics(usage, clientData, serverData);
      
      loggingService.info('Comprehensive tracking data processed successfully', {
        component: 'ComprehensiveTrackingService',
        operation: 'processComprehensiveTracking',
        usageId: usage._id,
        sessionId: correlatedData.correlation.sessionId,
        totalTime: correlatedData.performance.totalRoundTripTime
      });
      
      return usage;
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'ComprehensiveTrackingService',
        operation: 'processComprehensiveTracking',
        sessionId: clientData.context.sessionId,
        requestId: clientData.context.requestId
      });
      throw error;
    }
  }
  
  /**
   * Process server-side only tracking (for requests without SDK)
   */
  async processServerSideTracking(
    serverData: ComprehensiveServerRequestData,
    usageMetadata?: Partial<IUsage>
  ): Promise<IUsage> {
    try {
      // Ensure required token fields from metadata (dynamic payload support)
      const promptTokens = usageMetadata?.promptTokens ?? 0;
      const completionTokens = usageMetadata?.completionTokens ?? 0;
      const totalTokens = usageMetadata?.totalTokens ?? ((promptTokens + completionTokens) || 0);

      const usageData: Partial<IUsage> = {
        ...usageMetadata,
        promptTokens,
        completionTokens,
        totalTokens,

        userId: new mongoose.Types.ObjectId(serverData.correlation.userId || usageMetadata?.userId),
        projectId: serverData.correlation.projectId ? 
          new mongoose.Types.ObjectId(serverData.correlation.projectId) : undefined,
        
        service: usageMetadata?.service || 'dashboard-analytics',
        model: usageMetadata?.model || 'server-side',
        
        ipAddress: serverData.clientInfo.ip,
        userAgent: serverData.clientInfo.userAgent,
        responseTime: serverData.performance.serverProcessingTime,
        
        // Server-side only request tracking
        requestTracking: {
          clientInfo: {
            ip: serverData.clientInfo.ip,
            port: serverData.clientInfo.port,
            forwardedIPs: serverData.clientInfo.forwardedIPs,
            userAgent: serverData.clientInfo.userAgent,
            geoLocation: this.getGeoLocation(serverData.clientInfo.ip)
          },
          
          headers: {
            request: serverData.request.headers,
            response: serverData.response?.headers || {}
          },
          
          networking: {
            serverEndpoint: serverData.request.url,
            serverFullUrl: serverData.request.fullUrl,
            clientOrigin: serverData.request.clientOrigin ?? 'Direct request (no Origin/Referer)',
            serverIP: serverData.serverInfo.serverIP,
            serverPort: serverData.serverInfo.serverPort,
            routePattern: serverData.request.routePattern || 'unknown',
            protocol: serverData.clientInfo.protocol,
            secure: serverData.clientInfo.secure
          },
          
          payload: {
            requestBody: this.sanitizeBody(serverData.request.body),
            responseBody: this.sanitizeBody(serverData.response?.body),
            requestSize: serverData.request.size,
            responseSize: serverData.response?.size || 0,
            contentType: serverData.response?.headers['content-type'] || 'application/json'
          },
          
          performance: {
            networkTime: 0, // Unknown for server-side only
            serverProcessingTime: serverData.performance.serverProcessingTime,
            totalRoundTripTime: serverData.performance.serverProcessingTime,
            dataTransferEfficiency: this.calculateDataTransferEfficiency(
              serverData.request.size,
              serverData.response?.size || 0,
              serverData.performance.serverProcessingTime
            )
          }
        }
      };
      
      const usage = new Usage(usageData);
      await usage.save();
      
      loggingService.info('Server-side tracking data processed successfully', {
        component: 'ComprehensiveTrackingService',
        operation: 'processServerSideTracking',
        usageId: usage._id,
        requestId: serverData.correlation.requestId
      });
      
      return usage;
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'ComprehensiveTrackingService',
        operation: 'processServerSideTracking',
        requestId: serverData.correlation.requestId
      });
      throw error;
    }
  }
  
  /**
   * Generate optimization opportunities based on tracking data
   */
  private async generateOptimizationOpportunities(
    clientData: ClientSideTrackingData,
    serverData: ComprehensiveServerRequestData,
    usageMetadata?: Partial<IUsage>
  ): Promise<any> {
    const suggestions = await this.generateOptimizationSuggestions(
      clientData,
      serverData,
      usageMetadata
    );
    
    const costSuggestion = suggestions.find(s => s.type === 'cost');
    const performanceSuggestion = suggestions.find(s => s.type === 'performance');
    const efficiencySuggestion = suggestions.find(s => s.type === 'data_efficiency');
    
    return {
      costOptimization: costSuggestion ? {
        potentialSavings: costSuggestion.potentialSavings || 0,
        recommendedModel: costSuggestion.specifics?.recommendedModel,
        reasonCode: costSuggestion.specifics?.reasonCode as any || 'prompt_optimization',
        confidence: costSuggestion.specifics?.confidence || 0.5,
        estimatedImpact: costSuggestion.estimatedImpact
      } : undefined,
      
      performanceOptimization: performanceSuggestion ? {
        currentPerformanceScore: this.calculatePerformanceScore(clientData, serverData),
        bottleneckIdentified: this.identifyBottleneck(clientData, serverData) as any,
        recommendation: performanceSuggestion.description,
        estimatedImprovement: performanceSuggestion.estimatedImpact
      } : undefined,
      
      dataEfficiency: efficiencySuggestion ? {
        compressionRecommendation: efficiencySuggestion.description.includes('compression'),
        payloadOptimization: efficiencySuggestion.description,
        headerOptimization: efficiencySuggestion.estimatedImpact
      } : undefined
    };
  }
  
  /**
   * Generate optimization suggestions
   */
  async generateOptimizationSuggestions(
    clientData: ClientSideTrackingData,
    serverData: ComprehensiveServerRequestData,
    usageMetadata?: Partial<IUsage>
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    
    // Cost optimization suggestions
    if (usageMetadata?.cost && usageMetadata.cost > 0.01) {
      suggestions.push({
        type: 'cost',
        priority: 'high',
        title: 'Consider Model Downgrade',
        description: 'Current request may be using an overpowered model for the task complexity',
        potentialSavings: usageMetadata.cost * 0.3,
        estimatedImpact: '30% cost reduction',
        implementation: 'immediate',
        effort: 'low',
        specifics: {
          currentModel: usageMetadata.model,
          reasonCode: 'model_downgrade',
          confidence: 0.7
        }
      });
    }
    
    // Performance optimization suggestions
    const totalTime = clientData.performance.totalTime + serverData.performance.serverProcessingTime;
    if (totalTime > 5000) { // More than 5 seconds
      const bottleneck = this.identifyBottleneck(clientData, serverData);
      
      suggestions.push({
        type: 'performance',
        priority: bottleneck === 'network' ? 'high' : 'medium',
        title: `Optimize ${bottleneck} Performance`,
        description: `${bottleneck} is the primary bottleneck affecting response time`,
        estimatedImpact: `${Math.round((totalTime - 3000) / totalTime * 100)}% time reduction`,
        implementation: bottleneck === 'network' ? 'short_term' : 'immediate',
        effort: 'medium'
      });
    }
    
    // Data efficiency suggestions
    const totalPayloadSize = (clientData.request.size || 0) + (clientData.response?.size || 0);
    if (totalPayloadSize > 1024 * 1024) { // More than 1MB
      suggestions.push({
        type: 'data_efficiency',
        priority: 'medium',
        title: 'Enable Compression',
        description: 'Large payload detected - enable gzip compression to reduce transfer time',
        estimatedImpact: '60-80% size reduction',
        implementation: 'immediate',
        effort: 'low'
      });
    }
    
    return suggestions;
  }
  
  /**
   * Correlate client and server data
   */
  private correlateClientServerData(
    clientData: ClientSideTrackingData,
    serverData: ComprehensiveServerRequestData
  ) {
    return {
      correlation: {
        sessionId: clientData.context.sessionId || serverData.correlation.sessionId,
        requestId: clientData.context.requestId || serverData.correlation.requestId,
        traceId: serverData.correlation.traceId,
        userId: clientData.context.userId || serverData.correlation.userId,
        projectId: clientData.context.projectId || serverData.correlation.projectId
      },
      
      performance: {
        clientSideTime: clientData.performance.totalTime,
        networkTime: clientData.performance.totalTime - serverData.performance.serverProcessingTime,
        serverProcessingTime: serverData.performance.serverProcessingTime,
        totalRoundTripTime: clientData.performance.totalTime + serverData.performance.serverProcessingTime,
        dataTransferEfficiency: this.calculateDataTransferEfficiency(
          clientData.request.size,
          clientData.response?.size || serverData.response?.size || 0,
          clientData.performance.totalTime
        )
      }
    };
  }
  
  /**
   * Create telemetry span with comprehensive networking metadata
   */
  private async createTelemetrySpan(
    usage: IUsage,
    clientData: ClientSideTrackingData,
    serverData: ComprehensiveServerRequestData
  ): Promise<void> {
    try {
      const telemetryData: Partial<ITelemetry> = {
        trace_id: serverData.correlation.traceId || clientData.context.requestId,
        span_id: clientData.context.requestId,
        tenant_id: serverData.correlation.projectId || 'unknown',
        workspace_id: serverData.correlation.projectId || 'unknown',
        user_id: serverData.correlation.userId || 'unknown',
        request_id: clientData.context.requestId,
        
        timestamp: new Date(),
        start_time: clientData.request.timestamp,
        end_time: clientData.response?.timestamp || serverData.response?.timestamp || new Date(),
        duration_ms: clientData.performance.totalTime + serverData.performance.serverProcessingTime,
        
        service_name: 'cost-katana-comprehensive-tracking',
        operation_name: `${clientData.request.method} ${clientData.request.path}`,
        span_kind: 'server',
        
        status: (clientData.response?.statusCode || serverData.response?.statusCode || 0) < 400 ? 'success' : 'error',
        
        // HTTP details
        http_method: clientData.request.method,
        http_status_code: clientData.response?.statusCode || serverData.response?.statusCode,
        http_url: clientData.request.url,
        http_user_agent: serverData.clientInfo.userAgent,
        
        // GenAI fields if available
        gen_ai_system: clientData.context.provider,
        gen_ai_model: clientData.context.model,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        cost_usd: usage.cost,
        
        // Network details
        net_peer_ip: serverData.clientInfo.ip,
        net_peer_port: serverData.clientInfo.port,
        net_host_ip: serverData.serverInfo.serverIP,
        net_host_port: serverData.serverInfo.serverPort,
        
        // NEW: Comprehensive networking metadata
        networkingMetadata: {
          clientEndpoint: `${clientData.networking.remoteIP}:${clientData.networking.port}`,
          serverEndpoint: `${serverData.serverInfo.serverIP}:${serverData.serverInfo.serverPort}`,
          dataTransferred: {
            requestBytes: clientData.request.size,
            responseBytes: clientData.response?.size || serverData.response?.size || 0,
            compressionRatio: this.calculateCompressionRatio(
              clientData.response?.headers || serverData.response?.headers
            )
          },
          connectionDetails: {
            protocol: clientData.networking.protocol,
            keepAlive: clientData.request.headers['connection']?.includes('keep-alive') || false,
            connectionReused: false // Would need to track this
          },
          performanceBreakdown: {
            dnsLookupTime: clientData.performance.dnsTime,
            tcpConnectTime: clientData.performance.connectTime,
            tlsHandshakeTime: clientData.performance.uploadTime || 0, // Use uploadTime as approximation for TLS time
            requestUploadTime: clientData.performance.uploadTime,
            responseDownloadTime: clientData.performance.downloadTime
          }
        }
      };
      
      const telemetry = new Telemetry(telemetryData);
      await telemetry.save();
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'ComprehensiveTrackingService',
        operation: 'createTelemetrySpan',
        usageId: usage._id
      });
    }
  }
  
  /**
   * Track comprehensive analytics with Mixpanel
   */
  private async trackComprehensiveAnalytics(
    usage: IUsage,
    clientData: ClientSideTrackingData,
    serverData: ComprehensiveServerRequestData
  ): Promise<void> {
    try {
      await mixpanelService.trackComprehensiveUsage(
        serverData.correlation.userId || 'anonymous',
        {
          service: usage.service,
          model: usage.model,
          cost: usage.cost,
          tokens: usage.totalTokens,
          responseTime: usage.responseTime,
          
          // Network performance metrics
          networkTime: usage.requestTracking?.performance.networkTime || 0,
          serverProcessingTime: usage.requestTracking?.performance.serverProcessingTime || 0,
          dataTransferEfficiency: usage.requestTracking?.performance.dataTransferEfficiency || 0,
          
          // Optimization opportunities
          potentialSavings: usage.optimizationOpportunities?.costOptimization?.potentialSavings || 0,
          performanceScore: usage.optimizationOpportunities?.performanceOptimization?.currentPerformanceScore || 0,
          
          // Client environment
          clientPlatform: clientData.clientEnvironment.platform,
          sdkVersion: clientData.clientEnvironment.sdkVersion,
          
          // Geographic data
          country: usage.requestTracking?.clientInfo.geoLocation?.country,
          region: usage.requestTracking?.clientInfo.geoLocation?.region
        }
      );
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'ComprehensiveTrackingService',
        operation: 'trackComprehensiveAnalytics',
        usageId: usage._id
      });
    }
  }
  
  /**
   * Utility methods
   */
  private getGeoLocation(ip: string) {
    try {
      const geo = geoip.lookup(ip);
      return geo ? {
        country: geo.country,
        region: geo.region,
        city: geo.city
      } : undefined;
    } catch {
      return undefined;
    }
  }
  
  private sanitizeBody(body: any): any {
    if (!body) return null;
    
    if (typeof body === 'string' && body.length > 10000) {
      return body.substring(0, 10000) + '...[TRUNCATED]';
    }
    
    if (typeof body === 'object') {
      try {
        const bodyString = JSON.stringify(body);
        if (bodyString.length > 10000) {
          return { _truncated: true, _data: bodyString.substring(0, 10000) + '...[TRUNCATED]' };
        }
      } catch {
        return { _error: 'Could not serialize body' };
      }
    }
    
    return body;
  }
  
  private calculateCompressionRatio(headers?: Record<string, string>): number | undefined {
    const encoding = headers?.['content-encoding'];
    if (encoding && encoding.includes('gzip')) {
      return 0.3; // Rough estimate for gzip compression
    }
    return undefined;
  }
  
  private calculateDataTransferEfficiency(
    requestSize: number,
    responseSize: number,
    totalTime: number
  ): number {
    const totalBytes = requestSize + responseSize;
    const totalTimeSeconds = totalTime / 1000;
    return totalTimeSeconds > 0 ? totalBytes / totalTimeSeconds : 0;
  }
  
  private calculatePerformanceScore(
    clientData: ClientSideTrackingData,
    serverData: ComprehensiveServerRequestData
  ): number {
    const totalTime = clientData.performance.totalTime + serverData.performance.serverProcessingTime;
    
    // Score based on total response time (lower is better)
    if (totalTime < 1000) return 100; // Excellent
    if (totalTime < 3000) return 80;  // Good
    if (totalTime < 5000) return 60;  // Fair
    if (totalTime < 10000) return 40; // Poor
    return 20; // Very poor
  }
  
  private identifyBottleneck(
    clientData: ClientSideTrackingData,
    serverData: ComprehensiveServerRequestData
  ): string {
    const networkTime = clientData.performance.totalTime - serverData.performance.serverProcessingTime;
    const serverTime = serverData.performance.serverProcessingTime;
    const payloadSize = clientData.request.size + (clientData.response?.size || 0);
    
    if (networkTime > serverTime * 2) return 'network';
    if (serverTime > 3000) return 'processing';
    if (payloadSize > 5 * 1024 * 1024) return 'payload_size'; // 5MB
    return 'model_complexity';
  }
  
  private inferServiceFromProvider(provider?: string): string {
    if (!provider) return 'dashboard-analytics';
    
    const mapping: Record<string, string> = {
      'openai': 'openai',
      'anthropic': 'anthropic',
      'google': 'google-ai',
      'cohere': 'cohere',
      'aws-bedrock': 'aws-bedrock'
    };
    
    return mapping[provider] || 'dashboard-analytics';
  }
}

// Export singleton instance
export const comprehensiveTrackingService = new ComprehensiveTrackingService();