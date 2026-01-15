/**
 * True Cost Service
 * 
 * Calculates comprehensive cost beyond API pricing, including:
 * - API provider costs (OpenAI, Anthropic, etc.)
 * - Vector DB costs (embeddings, storage, queries)
 * - Storage costs (logs, cache, artifacts)
 * - Network egress costs
 * - Compute time costs
 * - Caching infrastructure costs
 * - Monitoring & observability costs
 */

import { loggingService } from './logging.service';
import { redisService } from './redis.service';

export interface TrueCostComponents {
  // Provider API costs
  apiCost: number;
  
  // Infrastructure costs
  vectorDBCost: number;
  storageCost: number;
  networkCost: number;
  computeCost: number;
  cachingCost: number;
  loggingCost: number;
  observabilityCost: number;
  
  // Total
  totalCost: number;
  
  // Breakdown metadata
  breakdown: {
    api: { cost: number; details: string };
    vectorDB: { cost: number; operations: number; storageGB: number };
    storage: { cost: number; logsBytes: number; cacheBytes: number; artifactsBytes: number };
    network: { cost: number; egressGB: number; ingressGB: number };
    compute: { cost: number; cpuMillis: number; memoryMBMillis: number };
    caching: { cost: number; redisOps: number; storageGB: number };
    logging: { cost: number; volumeGB: number; retentionDays: number };
    observability: { cost: number; metricsCount: number; tracesCount: number };
  };
}

export interface RequestMetrics {
  requestId: string;
  userId: string;
  timestamp: Date;
  
  // API metrics
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  
  // Timing
  latencyMs: number;
  
  // Infrastructure usage
  vectorDBQueries?: number;
  embeddingsGenerated?: number;
  cacheHits?: number;
  cacheMisses?: number;
  logVolumeBytes?: number;
  responseBytes?: number;
  
  // Context
  projectId?: string;
  workflowId?: string;
}

export class TrueCostService {
  // Cost constants (per unit, in USD)
  private static readonly PRICING = {
    // Vector DB costs (per operation and storage)
    VECTOR_DB_QUERY: 0.0001,          // $0.0001 per query
    VECTOR_DB_INSERT: 0.0002,         // $0.0002 per insert
    VECTOR_DB_STORAGE_GB_MONTH: 0.25, // $0.25 per GB/month
    EMBEDDING_GENERATION: 0.0001,     // $0.0001 per 1K tokens
    
    // Storage costs
    S3_STORAGE_GB_MONTH: 0.023,       // $0.023 per GB/month
    S3_REQUEST_PUT: 0.000005,         // $0.000005 per PUT
    S3_REQUEST_GET: 0.0000004,        // $0.0000004 per GET
    
    // Network costs
    NETWORK_EGRESS_GB: 0.09,          // $0.09 per GB egress
    NETWORK_INGRESS_GB: 0.0,          // Free ingress
    
    // Compute costs (AWS Lambda pricing as baseline)
    COMPUTE_GB_SECOND: 0.0000166667,  // $0.0000166667 per GB-second
    COMPUTE_REQUEST: 0.0000002,       // $0.0000002 per request
    
    // Redis/Caching costs
    REDIS_STORAGE_GB_MONTH: 0.125,    // $0.125 per GB/month
    REDIS_OPS_MILLION: 0.10,          // $0.10 per million operations
    
    // Logging costs (CloudWatch pricing)
    LOGGING_INGESTION_GB: 0.50,       // $0.50 per GB ingested
    LOGGING_STORAGE_GB_MONTH: 0.03,   // $0.03 per GB/month
    
    // Observability costs (metrics, traces)
    METRICS_PER_MILLION: 0.30,        // $0.30 per million metrics
    TRACES_PER_MILLION: 2.00,         // $2.00 per million traces
  };

  /**
   * Calculate comprehensive true cost for a request
   */
  static async calculateTrueCost(metrics: RequestMetrics): Promise<TrueCostComponents> {
    try {
      // 1. API Cost (from provider pricing)
      const apiCost = await this.calculateAPICost(metrics);
      
      // 2. Vector DB Cost
      const vectorDBCost = await this.calculateVectorDBCost(metrics);
      
      // 3. Storage Cost
      const storageCost = await this.calculateStorageCost(metrics);
      
      // 4. Network Cost
      const networkCost = await this.calculateNetworkCost(metrics);
      
      // 5. Compute Cost
      const computeCost = await this.calculateComputeCost(metrics);
      
      // 6. Caching Cost
      const cachingCost = await this.calculateCachingCost(metrics);
      
      // 7. Logging Cost
      const loggingCost = await this.calculateLoggingCost(metrics);
      
      // 8. Observability Cost
      const observabilityCost = await this.calculateObservabilityCost();
      
      // Total cost
      const totalCost = 
        apiCost.cost +
        vectorDBCost.cost +
        storageCost.cost +
        networkCost.cost +
        computeCost.cost +
        cachingCost.cost +
        loggingCost.cost +
        observabilityCost.cost;

      const trueCost: TrueCostComponents = {
        apiCost: apiCost.cost,
        vectorDBCost: vectorDBCost.cost,
        storageCost: storageCost.cost,
        networkCost: networkCost.cost,
        computeCost: computeCost.cost,
        cachingCost: cachingCost.cost,
        loggingCost: loggingCost.cost,
        observabilityCost: observabilityCost.cost,
        totalCost,
        breakdown: {
          api: apiCost,
          vectorDB: vectorDBCost,
          storage: storageCost,
          network: networkCost,
          compute: computeCost,
          caching: cachingCost,
          logging: loggingCost,
          observability: observabilityCost
        }
      };

      // Cache the calculation for analytics
      await this.cacheTrueCostCalculation(metrics.requestId, trueCost);

      loggingService.debug('True cost calculated', {
        requestId: metrics.requestId,
        apiCost: apiCost.cost,
        infraCost: totalCost - apiCost.cost,
        totalCost
      });

      return trueCost;
    } catch (error) {
      loggingService.error('Error calculating true cost', {
        error: error instanceof Error ? error.message : String(error),
        requestId: metrics.requestId
      });
      
      // Return fallback with API cost only
      return this.createFallbackTrueCost(metrics);
    }
  }

  /**
   * Calculate API provider cost
   */
  private static async calculateAPICost(metrics: RequestMetrics): Promise<{
    cost: number;
    details: string;
  }> {
    try {
      // Import pricing dynamically
      const { calculateCost } = await import('../utils/pricing');
      
      const cost = calculateCost(
        metrics.inputTokens,
        metrics.outputTokens,
        metrics.provider,
        metrics.model
      );

      return {
        cost: Math.max(0, cost),
        details: `${metrics.inputTokens} input + ${metrics.outputTokens} output tokens`
      };
    } catch (error) {
      loggingService.warn('Error calculating API cost', {
        error: error instanceof Error ? error.message : String(error),
        requestId: metrics.requestId
      });
      return { cost: 0, details: 'API cost calculation failed' };
    }
  }

  /**
   * Calculate vector DB costs (queries + storage + embeddings)
   */
  private static async calculateVectorDBCost(metrics: RequestMetrics): Promise<{
    cost: number;
    operations: number;
    storageGB: number;
  }> {
    const vectorDBQueries = metrics.vectorDBQueries || 0;
    const embeddingsGenerated = metrics.embeddingsGenerated || 0;
    
    // Query cost
    const queryCost = vectorDBQueries * this.PRICING.VECTOR_DB_QUERY;
    
    // Embedding generation cost (assume 1K tokens per embedding)
    const embeddingCost = (embeddingsGenerated / 1000) * this.PRICING.EMBEDDING_GENERATION;
    
    // Storage cost (estimate based on embeddings - average 1.5KB per embedding vector)
    const storageGB = (embeddingsGenerated * 1.5) / (1024 * 1024); // Convert to GB
    const storageCostPerMonth = storageGB * this.PRICING.VECTOR_DB_STORAGE_GB_MONTH;
    
    // Prorate to per-request cost (assume 30-day retention)
    const storageRequestCost = storageCostPerMonth / (30 * 24 * 60 * 60); // Per second
    
    const totalCost = queryCost + embeddingCost + storageRequestCost;

    return {
      cost: totalCost,
      operations: vectorDBQueries + embeddingsGenerated,
      storageGB
    };
  }

  /**
   * Calculate storage costs (logs, cache, artifacts)
   */
  private static async calculateStorageCost(metrics: RequestMetrics): Promise<{
    cost: number;
    logsBytes: number;
    cacheBytes: number;
    artifactsBytes: number;
  }> {
    // Estimate log storage (structured logs + request/response)
    const logsBytes = (metrics.logVolumeBytes || 0) + 
                      (metrics.inputTokens * 4) + 
                      (metrics.outputTokens * 4); // Rough estimate: 4 bytes per token
    
    // Cache storage (if cache miss, we store the response)
    const cacheBytes = (metrics.cacheMisses || 0) * (metrics.responseBytes || metrics.outputTokens * 4);
    
    // Artifacts (varies, estimate small per request)
    const artifactsBytes = 1024; // 1KB average artifacts per request
    
    const totalBytes = logsBytes + cacheBytes + artifactsBytes;
    const totalGB = totalBytes / (1024 * 1024 * 1024);
    
    // Storage cost (prorated for 30-day retention)
    const storageCostPerMonth = totalGB * this.PRICING.S3_STORAGE_GB_MONTH;
    const storageRequestCost = storageCostPerMonth / (30 * 24 * 60 * 60);
    
    // Request costs (PUT for storing)
    const putRequestCost = this.PRICING.S3_REQUEST_PUT;

    return {
      cost: storageRequestCost + putRequestCost,
      logsBytes,
      cacheBytes,
      artifactsBytes
    };
  }

  /**
   * Calculate network costs (egress/ingress)
   */
  private static async calculateNetworkCost(metrics: RequestMetrics): Promise<{
    cost: number;
    egressGB: number;
    ingressGB: number;
  }> {
    // Request size (ingress) - free
    const ingressBytes = metrics.inputTokens * 4; // Rough estimate
    const ingressGB = ingressBytes / (1024 * 1024 * 1024);
    
    // Response size (egress) - charged
    const egressBytes = (metrics.responseBytes || metrics.outputTokens * 4);
    const egressGB = egressBytes / (1024 * 1024 * 1024);
    
    const egressCost = egressGB * this.PRICING.NETWORK_EGRESS_GB;
    const ingressCost = ingressGB * this.PRICING.NETWORK_INGRESS_GB; // Free

    return {
      cost: egressCost + ingressCost,
      egressGB,
      ingressGB
    };
  }

  /**
   * Calculate compute costs (processing time, CPU, memory)
   */
  private static async calculateComputeCost(metrics: RequestMetrics): Promise<{
    cost: number;
    cpuMillis: number;
    memoryMBMillis: number;
  }> {
    // Use latency as proxy for compute time
    const computeSeconds = metrics.latencyMs / 1000;
    
    // Estimate memory usage (baseline 512MB, + tokens)
    const baseMemoryMB = 512;
    const tokenMemoryMB = (metrics.totalTokens / 1000) * 10; // 10MB per 1K tokens
    const totalMemoryMB = baseMemoryMB + tokenMemoryMB;
    
    // Convert to GB-seconds for pricing
    const gbSeconds = (totalMemoryMB / 1024) * computeSeconds;
    
    const computeCost = 
      gbSeconds * this.PRICING.COMPUTE_GB_SECOND +
      this.PRICING.COMPUTE_REQUEST;

    return {
      cost: computeCost,
      cpuMillis: metrics.latencyMs,
      memoryMBMillis: totalMemoryMB * metrics.latencyMs
    };
  }

  /**
   * Calculate caching infrastructure costs
   */
  private static async calculateCachingCost(metrics: RequestMetrics): Promise<{
    cost: number;
    redisOps: number;
    storageGB: number;
  }> {
    const cacheHits = metrics.cacheHits || 0;
    const cacheMisses = metrics.cacheMisses || 0;
    const totalOps = cacheHits + cacheMisses;
    
    // Redis operations cost
    const opsCost = (totalOps / 1_000_000) * this.PRICING.REDIS_OPS_MILLION;
    
    // Storage cost (if cache miss, we write)
    const cacheEntryBytes = cacheMisses * (metrics.responseBytes || metrics.outputTokens * 4);
    const storageGB = cacheEntryBytes / (1024 * 1024 * 1024);
    const storageCostPerMonth = storageGB * this.PRICING.REDIS_STORAGE_GB_MONTH;
    const storageRequestCost = storageCostPerMonth / (30 * 24 * 60 * 60); // Prorated

    return {
      cost: opsCost + storageRequestCost,
      redisOps: totalOps,
      storageGB
    };
  }

  /**
   * Calculate logging costs
   */
  private static async calculateLoggingCost(metrics: RequestMetrics): Promise<{
    cost: number;
    volumeGB: number;
    retentionDays: number;
  }> {
    // Estimate log volume
    const baseLogBytes = 2048; // 2KB baseline per request
    const contextLogBytes = (metrics.inputTokens + metrics.outputTokens) * 0.5; // Partial context logging
    const totalLogBytes = baseLogBytes + contextLogBytes + (metrics.logVolumeBytes || 0);
    const volumeGB = totalLogBytes / (1024 * 1024 * 1024);
    
    // Ingestion cost
    const ingestionCost = volumeGB * this.PRICING.LOGGING_INGESTION_GB;
    
    // Storage cost (30-day retention)
    const retentionDays = 30;
    const storageCostPerMonth = volumeGB * this.PRICING.LOGGING_STORAGE_GB_MONTH;
    const storageRequestCost = storageCostPerMonth / (30 * 24 * 60 * 60);

    return {
      cost: ingestionCost + storageRequestCost,
      volumeGB,
      retentionDays
    };
  }

  /**
   * Calculate observability costs (metrics, traces)
   */
  private static async calculateObservabilityCost(): Promise<{
    cost: number;
    metricsCount: number;
    tracesCount: number;
  }> {
    // Estimate metrics emitted per request (latency, cost, tokens, etc.)
    const metricsCount = 10; // ~10 metrics per request
    
    // Trace (1 per request if tracing enabled)
    const tracesCount = 1;
    
    const metricsCost = (metricsCount / 1_000_000) * this.PRICING.METRICS_PER_MILLION;
    const tracesCost = (tracesCount / 1_000_000) * this.PRICING.TRACES_PER_MILLION;

    return {
      cost: metricsCost + tracesCost,
      metricsCount,
      tracesCount
    };
  }

  /**
   * Cache true cost calculation for analytics
   */
  private static async cacheTrueCostCalculation(
    requestId: string,
    trueCost: TrueCostComponents
  ): Promise<void> {
    try {
      const key = `truecost:${requestId}`;
      await redisService.set(key, trueCost, 86400); // 24-hour TTL
    } catch (error) {
      loggingService.warn('Error caching true cost', {
        error: error instanceof Error ? error.message : String(error),
        requestId
      });
    }
  }

  /**
   * Create fallback true cost with API cost only
   */
  private static createFallbackTrueCost(metrics: RequestMetrics): TrueCostComponents {
    // Try to give a more meaningful breakdown even if we can't fully price
    return {
      apiCost: 0,
      vectorDBCost: 0,
      storageCost: 0,
      networkCost: 0,
      computeCost: 0,
      cachingCost: 0,
      loggingCost: 0,
      observabilityCost: 0,
      totalCost: 0,
      breakdown: {
        api: { 
          cost: 0, 
          details: `Calculation failed for model=${metrics.model || 'unknown'}, provider=${metrics.provider || 'unknown'}, tokens=${metrics.totalTokens ?? (metrics.inputTokens ?? 0) + (metrics.outputTokens ?? 0)}` 
        },
        vectorDB: { 
          cost: 0, 
          operations: metrics.vectorDBQueries ?? 0, 
          storageGB: 0 
        },
        storage: { 
          cost: 0, 
          logsBytes: metrics.logVolumeBytes ?? 0, 
          cacheBytes: metrics.cacheHits !== undefined || metrics.cacheMisses !== undefined 
            ? ((metrics.cacheHits ?? 0) + (metrics.cacheMisses ?? 0)) * 1024 // guess 1KB/req
            : 0, 
          artifactsBytes: 0 
        },
        network: { 
          cost: 0, 
          egressGB: metrics.responseBytes !== undefined ? metrics.responseBytes / 1_000_000_000 : 0, 
          ingressGB: 0 
        },
        compute: { 
          cost: 0, 
          cpuMillis: typeof metrics.latencyMs === "number" ? metrics.latencyMs : 0, 
          memoryMBMillis: 0 
        },
        caching: { 
          cost: 0, 
          redisOps: (metrics.cacheHits ?? 0) + (metrics.cacheMisses ?? 0), 
          storageGB: 0 
        },
        logging: { 
          cost: 0, 
          volumeGB: metrics.logVolumeBytes !== undefined ? metrics.logVolumeBytes / 1_000_000_000 : 0, 
          retentionDays: 0 
        },
        observability: { 
          cost: 0, 
          metricsCount: 10, // fallback default
          tracesCount: 1    // fallback default
        }
      }
    };
  }

  /**
   * Get aggregated true cost for a user over a time period
   */
  static async getUserTrueCost(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalTrueCost: number;
    apiCost: number;
    infrastructureCost: number;
    costBreakdown: Partial<TrueCostComponents>;
    requestCount: number;
  }> {
    try {
      loggingService.info('Aggregating true cost for user', {
        userId,
        startDate,
        endDate
      });

      // Assume Usage model holds request-level logs with all required metrics per request
      const usageDocs = await require('../models').Usage.find({
        userId: userId,
        timestamp: { $gte: startDate, $lte: endDate }
      }).lean();

      if (!usageDocs || usageDocs.length === 0) {
        return {
          totalTrueCost: 0,
          apiCost: 0,
          infrastructureCost: 0,
          costBreakdown: {},
          requestCount: 0
        };
      }

      let totalTrueCost = 0;
      let apiCost = 0;
      let infrastructureCost = 0;

      let breakdownSum: Partial<TrueCostComponents> = {
        apiCost: 0,
        vectorDBCost: 0,
        storageCost: 0,
        networkCost: 0,
        computeCost: 0,
        cachingCost: 0,
        loggingCost: 0,
        observabilityCost: 0,
        totalCost: 0,
        breakdown: undefined // we'll set this at the end if needed
      };

      let breakdowns: TrueCostComponents['breakdown'][] = [];

      for (const doc of usageDocs) {
        // We'll try to mimic RequestMetrics from usage doc - if incomplete, fallback
        const metrics: RequestMetrics = {
          requestId: doc.requestId || doc._id?.toString() || "",
          userId: doc.userId,
          timestamp: doc.timestamp,
          model: doc.model || 'unknown',
          provider: doc.provider || 'unknown',
          inputTokens: doc.inputTokens || 0,
          outputTokens: doc.outputTokens || 0,
          totalTokens: typeof doc.totalTokens === 'number'
            ? doc.totalTokens
            : ((doc.inputTokens || 0) + (doc.outputTokens || 0)),
          latencyMs: doc.latencyMs || 0,
          vectorDBQueries: doc.vectorDBQueries,
          embeddingsGenerated: doc.embeddingsGenerated,
          cacheHits: doc.cacheHits,
          cacheMisses: doc.cacheMisses,
          logVolumeBytes: doc.logVolumeBytes,
          responseBytes: doc.responseBytes,
          projectId: doc.projectId,
          workflowId: doc.workflowId
        };

        const tcc = await this.calculateTrueCost(metrics);
        totalTrueCost += tcc.totalCost;
        apiCost += tcc.apiCost;
        // infra cost = total - api
        infrastructureCost += (tcc.totalCost - tcc.apiCost);

        // sum up components
        breakdownSum.apiCost! += tcc.apiCost;
        breakdownSum.vectorDBCost! += tcc.vectorDBCost;
        breakdownSum.storageCost! += tcc.storageCost;
        breakdownSum.networkCost! += tcc.networkCost;
        breakdownSum.computeCost! += tcc.computeCost;
        breakdownSum.cachingCost! += tcc.cachingCost;
        breakdownSum.loggingCost! += tcc.loggingCost;
        breakdownSum.observabilityCost! += tcc.observabilityCost;
        breakdownSum.totalCost! += tcc.totalCost;
        breakdowns.push(tcc.breakdown);
      }

      // Optionally, aggregate breakdown (e.g., sum of values, or just return count)
      // For this, we can provide totals for each breakdown component, other details can be left out or summarized
      const mergedBreakdown = {
        api: {
          cost: breakdowns.reduce((sum, b) => sum + (b?.api.cost || 0), 0),
          details: "see per-request for details"
        },
        vectorDB: {
          cost: breakdowns.reduce((sum, b) => sum + (b?.vectorDB.cost || 0), 0),
          operations: breakdowns.reduce((sum, b) => sum + (b?.vectorDB.operations || 0), 0),
          storageGB: breakdowns.reduce((sum, b) => sum + (b?.vectorDB.storageGB || 0), 0)
        },
        storage: {
          cost: breakdowns.reduce((sum, b) => sum + (b?.storage.cost || 0), 0),
          logsBytes: breakdowns.reduce((sum, b) => sum + (b?.storage.logsBytes || 0), 0),
          cacheBytes: breakdowns.reduce((sum, b) => sum + (b?.storage.cacheBytes || 0), 0),
          artifactsBytes: breakdowns.reduce((sum, b) => sum + (b?.storage.artifactsBytes || 0), 0)
        },
        network: {
          cost: breakdowns.reduce((sum, b) => sum + (b?.network.cost || 0), 0),
          egressGB: breakdowns.reduce((sum, b) => sum + (b?.network.egressGB || 0), 0),
          ingressGB: breakdowns.reduce((sum, b) => sum + (b?.network.ingressGB || 0), 0)
        },
        compute: {
          cost: breakdowns.reduce((sum, b) => sum + (b?.compute.cost || 0), 0),
          cpuMillis: breakdowns.reduce((sum, b) => sum + (b?.compute.cpuMillis || 0), 0),
          memoryMBMillis: breakdowns.reduce((sum, b) => sum + (b?.compute.memoryMBMillis || 0), 0)
        },
        caching: {
          cost: breakdowns.reduce((sum, b) => sum + (b?.caching.cost || 0), 0),
          redisOps: breakdowns.reduce((sum, b) => sum + (b?.caching.redisOps || 0), 0),
          storageGB: breakdowns.reduce((sum, b) => sum + (b?.caching.storageGB || 0), 0)
        },
        logging: {
          cost: breakdowns.reduce((sum, b) => sum + (b?.logging.cost || 0), 0),
          volumeGB: breakdowns.reduce((sum, b) => sum + (b?.logging.volumeGB || 0), 0),
          retentionDays: breakdowns.reduce((sum, b) => sum + (b?.logging.retentionDays || 0), 0)
        },
        observability: {
          cost: breakdowns.reduce((sum, b) => sum + (b?.observability.cost || 0), 0),
          metricsCount: breakdowns.reduce((sum, b) => sum + (b?.observability.metricsCount || 0), 0),
          tracesCount: breakdowns.reduce((sum, b) => sum + (b?.observability.tracesCount || 0), 0)
        }
      };

      breakdownSum.breakdown = mergedBreakdown;

      return {
        totalTrueCost,
        apiCost,
        infrastructureCost,
        costBreakdown: breakdownSum,
        requestCount: usageDocs.length
      };

    } catch (error) {
      loggingService.error('Error getting user true cost', {
        error: error instanceof Error ? error.message : String(error),
        userId
      });
      throw error;
    }
  }
}

