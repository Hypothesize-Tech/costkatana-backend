import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as Sentry from '@sentry/node';
import { metrics } from '@opentelemetry/api';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Usage } from '../../../schemas/core/usage.schema';
import { calculateCost, getModelPricing } from '../../../utils/pricing';
import { getHardcodedFallbackPricing } from '../../../config/pricing-fallback.config';

interface TrueCostComponents {
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
    storage: {
      cost: number;
      logsBytes: number;
      cacheBytes: number;
      artifactsBytes: number;
    };
    network: { cost: number; egressGB: number; ingressGB: number };
    compute: { cost: number; cpuMillis: number; memoryMBMillis: number };
    caching: { cost: number; redisOps: number; storageGB: number };
    logging: { cost: number; volumeGB: number; retentionDays: number };
    observability: { cost: number; metricsCount: number; tracesCount: number };
  };
}

interface RequestMetrics {
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

  // Additional metadata
  metadata?: {
    requestType?: string;
    [key: string]: any;
  };
  logVolumeBytes?: number;
  responseBytes?: number;

  // Context
  projectId?: string;
  traceId?: string;
}

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
@Injectable()
export class TrueCostService {
  private readonly logger = new Logger(TrueCostService.name);

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
    private readonly httpService: HttpService,
  ) {}

  // Cost constants (per unit, in USD)
  private static readonly PRICING = {
    // Vector DB costs (per operation and storage)
    VECTOR_DB_QUERY: 0.0001, // $0.0001 per query
    VECTOR_DB_INSERT: 0.0002, // $0.0002 per insert
    VECTOR_DB_STORAGE_GB_MONTH: 0.25, // $0.25 per GB/month
    EMBEDDING_GENERATION: 0.0001, // $0.0001 per 1K tokens

    // Storage costs
    S3_STORAGE_GB_MONTH: 0.023, // $0.023 per GB/month
    S3_REQUEST_PUT: 0.000005, // $0.000005 per PUT
    S3_REQUEST_GET: 0.0000004, // $0.0000004 per GET

    // Network costs
    NETWORK_EGRESS_GB: 0.09, // $0.09 per GB egress
    NETWORK_INGRESS_GB: 0.0, // Free ingress

    // Compute costs (AWS Lambda pricing as baseline)
    COMPUTE_GB_SECOND: 0.0000166667, // $0.0000166667 per GB-second
    COMPUTE_REQUEST: 0.0000002, // $0.0000002 per request

    // Redis/Caching costs
    REDIS_STORAGE_GB_MONTH: 0.125, // $0.125 per GB/month
    REDIS_OPS_MILLION: 0.1, // $0.10 per million operations

    // Logging costs (CloudWatch pricing)
    LOGGING_INGESTION_GB: 0.5, // $0.50 per GB ingested
    LOGGING_STORAGE_GB_MONTH: 0.03, // $0.03 per GB/month

    // Observability costs (metrics, traces)
    METRICS_PER_MILLION: 0.3, // $0.30 per million metrics
    TRACES_PER_MILLION: 2.0, // $2.00 per million traces
  };

  /**
   * Calculate comprehensive true cost for a request
   */
  async calculateTrueCost(
    metrics: RequestMetrics,
  ): Promise<TrueCostComponents> {
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
          observability: observabilityCost,
        },
      };

      this.logger.debug('Calculated true cost', {
        requestId: metrics.requestId,
        totalCost: totalCost.toFixed(8),
        apiCost: apiCost.cost.toFixed(8),
        infrastructureCost: (totalCost - apiCost.cost).toFixed(8),
      });

      return trueCost;
    } catch (error) {
      this.logger.error('Failed to calculate true cost', {
        requestId: metrics.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Calculate API cost with comprehensive pricing integration
   */
  private async calculateAPICost(
    metrics: RequestMetrics,
  ): Promise<{ cost: number; details: string }> {
    try {
      // Try to get pricing from external pricing service first
      const externalPricing = await this.getExternalPricing(metrics);
      if (externalPricing) {
        return externalPricing;
      }

      // Fall back to internal pricing calculation
      return await this.calculateInternalPricing(metrics);
    } catch (error) {
      this.logger.warn('Failed to calculate API cost, using fallback', error);
      return this.calculateFallbackPricing(metrics);
    }
  }

  /**
   * Get pricing from external pricing service
   */
  private async getExternalPricing(
    metrics: RequestMetrics,
  ): Promise<{ cost: number; details: string } | null> {
    try {
      if (!process.env.PRICING_SERVICE_URL) {
        return null;
      }

      const pricingRequest = {
        provider: metrics.provider,
        model: metrics.model,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        totalTokens: metrics.totalTokens,
        requestType: this.inferRequestType(metrics),
        region: process.env.AWS_REGION || 'us-east-1',
      };

      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.PRICING_SERVICE_URL}/calculate`,
          pricingRequest,
          {
            headers: {
              Authorization: `Bearer ${process.env.PRICING_SERVICE_API_KEY}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      if (response?.data?.cost !== undefined) {
        const data = response.data;
        return {
          cost: data.cost,
          details: data.details || `External pricing: $${data.cost.toFixed(6)}`,
        };
      }

      return null;
    } catch (error) {
      this.logger.debug('External pricing service not available', error);
      return null;
    }
  }

  /**
   * Calculate pricing using internal pricing data
   */
  private async calculateInternalPricing(
    metrics: RequestMetrics,
  ): Promise<{ cost: number; details: string }> {
    // Get pricing data from database or cache
    const pricingData = await this.getPricingData(
      metrics.provider,
      metrics.model,
    );

    if (pricingData) {
      return this.calculateCostFromPricingData(metrics, pricingData);
    }

    // Use dynamic pricing registry (utils/pricing) as fallback before hardcoded
    try {
      const modelPricing = getModelPricing(metrics.provider, metrics.model);
      if (modelPricing) {
        const totalCost = calculateCost(
          metrics.inputTokens,
          metrics.outputTokens,
          metrics.provider,
          metrics.model,
        );
        return {
          cost: totalCost,
          details:
            `${metrics.provider}/${metrics.model}: ` +
            `Input: ${(metrics.inputTokens / 1000).toFixed(2)}K, ` +
            `Output: ${(metrics.outputTokens / 1000).toFixed(2)}K, ` +
            `Total: $${totalCost.toFixed(6)} (from pricing registry)`,
        };
      }
    } catch (err) {
      this.logger.debug('Pricing registry lookup failed, using hardcoded', {
        provider: metrics.provider,
        model: metrics.model,
      });
    }

    return this.calculateHardcodedPricing(metrics);
  }

  /**
   * Get pricing data from database
   */
  private async getPricingData(provider: string, model: string): Promise<any> {
    try {
      // Query dynamic pricing collection when available.
      const pricingCollection = this.usageModel.db.collection('model_pricing');

      const pricingDoc = await pricingCollection.findOne({
        provider,
        model,
        isActive: true,
      });

      return pricingDoc;
    } catch (error) {
      this.logger.debug('Pricing data not available in database', error);
      return null;
    }
  }

  /**
   * Calculate cost from pricing data
   */
  private calculateCostFromPricingData(
    metrics: RequestMetrics,
    pricingData: any,
  ): { cost: number; details: string } {
    const inputCost =
      (metrics.inputTokens / 1000) * (pricingData.inputCostPer1K || 0);
    const outputCost =
      (metrics.outputTokens / 1000) * (pricingData.outputCostPer1K || 0);

    // Some providers charge per token regardless of input/output
    const totalCost = pricingData.chargePerToken
      ? (metrics.totalTokens / 1000) * pricingData.chargePerToken
      : inputCost + outputCost;

    // Apply any tiered pricing or volume discounts
    const finalCost = this.applyPricingAdjustments(
      totalCost,
      metrics,
      pricingData,
    );

    const details =
      `${metrics.provider}/${metrics.model}: ` +
      `Input: ${(metrics.inputTokens / 1000).toFixed(2)}K @ $${pricingData.inputCostPer1K?.toFixed(4)}/1K = $${inputCost.toFixed(6)}, ` +
      `Output: ${(metrics.outputTokens / 1000).toFixed(2)}K @ $${pricingData.outputCostPer1K?.toFixed(4)}/1K = $${outputCost.toFixed(6)}, ` +
      `Total: $${finalCost.toFixed(6)}`;

    return {
      cost: finalCost,
      details,
    };
  }

  /**
   * Calculate hardcoded pricing (last-resort fallback).
   * Uses config/pricing-fallback.config.ts. Emits metric for monitoring.
   */
  private calculateHardcodedPricing(metrics: RequestMetrics): {
    cost: number;
    details: string;
  } {
    this.logger.warn(
      `Using hardcoded pricing fallback for ${metrics.provider}/${metrics.model} - pricing registry/DB lookup unavailable. Consider syncing model_pricing collection.`,
      {
        provider: metrics.provider,
        model: metrics.model,
        metric: 'pricing.hardcoded_fallback',
      },
    );

    try {
      const meter = metrics.getMeter('costkatana-backend', '1.0.0');
      const fallbackCounter = meter.createCounter('pricing_fallback_used', {
        description: 'Count of times hardcoded pricing fallback was used',
      });
      fallbackCounter.add(1, {
        provider: metrics.provider,
        model: metrics.model,
      });
    } catch {
      // OTel may not be initialized
    }

    if (process.env.NODE_ENV === 'production') {
      Sentry.captureMessage(
        `Pricing fallback used for ${metrics.provider}/${metrics.model}`,
        {
          level: 'warning',
          tags: {
            component: 'true-cost',
            metric: 'pricing_fallback_used',
            provider: metrics.provider,
            model: metrics.model,
          },
        },
      );
    }

    const { inputCostPer1K, outputCostPer1K } = getHardcodedFallbackPricing(
      metrics.provider,
      metrics.model,
    );

    const inputCost = (metrics.inputTokens / 1000) * inputCostPer1K;
    const outputCost = (metrics.outputTokens / 1000) * outputCostPer1K;
    const totalCost = inputCost + outputCost;

    return {
      cost: totalCost,
      details:
        `${metrics.provider}/${metrics.model} (hardcoded fallback): ` +
        `Input: ${(metrics.inputTokens / 1000).toFixed(2)}K @ $${inputCostPer1K.toFixed(4)}/1K = $${inputCost.toFixed(6)}, ` +
        `Output: ${(metrics.outputTokens / 1000).toFixed(2)}K @ $${outputCostPer1K.toFixed(4)}/1K = $${outputCost.toFixed(6)}, ` +
        `Total: $${totalCost.toFixed(6)}`,
    };
  }

  /**
   * Calculate fallback pricing
   */
  private calculateFallbackPricing(metrics: RequestMetrics): {
    cost: number;
    details: string;
  } {
    const costPer1K = 0.002; // Conservative fallback
    const cost = (metrics.totalTokens / 1000) * costPer1K;

    return {
      cost,
      details: `${metrics.provider}/${metrics.model}: ${(metrics.totalTokens / 1000).toFixed(2)}K tokens at $${costPer1K.toFixed(4)}/1K (fallback pricing)`,
    };
  }

  /**
   * Apply pricing adjustments (tiered pricing, volume discounts, etc.)
   */
  private applyPricingAdjustments(
    baseCost: number,
    metrics: RequestMetrics,
    pricingData: any,
  ): number {
    let adjustedCost = baseCost;

    // Volume discounts for high usage
    if (metrics.totalTokens > 1000000) {
      // Over 1M tokens
      adjustedCost *= 0.9; // 10% discount
    } else if (metrics.totalTokens > 100000) {
      // Over 100K tokens
      adjustedCost *= 0.95; // 5% discount
    }

    // Provider-specific adjustments
    if (pricingData.tieredPricing) {
      adjustedCost = this.applyTieredPricing(
        adjustedCost,
        metrics,
        pricingData,
      );
    }

    return adjustedCost;
  }

  /**
   * Apply tiered pricing
   */
  private applyTieredPricing(
    baseCost: number,
    metrics: RequestMetrics,
    pricingData: any,
  ): number {
    const tiers = Array.isArray(pricingData?.tiers)
      ? [...pricingData.tiers]
      : [];
    if (tiers.length === 0) {
      return baseCost;
    }

    tiers.sort((a, b) => (a.minTokens || 0) - (b.minTokens || 0));
    const applicableTier = tiers
      .filter((tier) => metrics.totalTokens >= (tier.minTokens || 0))
      .pop();

    if (!applicableTier) {
      return baseCost;
    }

    if (typeof applicableTier.discountPercent === 'number') {
      const discount = Math.max(
        0,
        Math.min(100, applicableTier.discountPercent),
      );
      return baseCost * (1 - discount / 100);
    }

    if (typeof applicableTier.multiplier === 'number') {
      return baseCost * Math.max(0, applicableTier.multiplier);
    }

    return baseCost;
  }

  /**
   * Infer request type from metrics
   */
  private inferRequestType(metrics: RequestMetrics): string {
    if (metrics.metadata?.requestType) {
      return metrics.metadata.requestType;
    }

    // Infer from model and usage patterns
    if (metrics.model.includes('embedding')) {
      return 'embedding';
    } else if (
      metrics.model.includes('vision') ||
      metrics.model.includes('dall')
    ) {
      return 'image';
    } else if (
      metrics.model.includes('tts') ||
      metrics.model.includes('whisper')
    ) {
      return 'audio';
    } else {
      return 'text';
    }
  }

  /**
   * Calculate Vector DB cost
   */
  private async calculateVectorDBCost(metrics: RequestMetrics): Promise<{
    cost: number;
    operations: number;
    storageGB: number;
  }> {
    const queries = metrics.vectorDBQueries || 0;
    const embeddings = metrics.embeddingsGenerated || 0;

    const queryCost = queries * TrueCostService.PRICING.VECTOR_DB_QUERY;
    const embeddingCost =
      (embeddings / 1000) * TrueCostService.PRICING.EMBEDDING_GENERATION;
    const insertCost = embeddings * TrueCostService.PRICING.VECTOR_DB_INSERT;

    // Estimate storage (rough approximation)
    const storageGB = (embeddings * 0.004) / 1024 / 1024 / 1024; // 4KB per embedding on average
    const storageCost =
      (storageGB * TrueCostService.PRICING.VECTOR_DB_STORAGE_GB_MONTH) / 30; // Daily cost

    const totalCost = queryCost + embeddingCost + insertCost + storageCost;

    return {
      cost: totalCost,
      operations: queries + embeddings,
      storageGB,
    };
  }

  /**
   * Calculate storage cost
   */
  private async calculateStorageCost(metrics: RequestMetrics): Promise<{
    cost: number;
    logsBytes: number;
    cacheBytes: number;
    artifactsBytes: number;
  }> {
    const logsBytes = metrics.logVolumeBytes || 1024; // 1KB default
    const cacheBytes =
      ((metrics.cacheHits || 0) + (metrics.cacheMisses || 0)) * 1024; // 1KB per cache operation
    const artifactsBytes = metrics.responseBytes || 0;

    const totalBytes = logsBytes + cacheBytes + artifactsBytes;
    const totalGB = totalBytes / (1024 * 1024 * 1024);

    // S3 storage cost (monthly, converted to per-request estimate)
    const storageCost =
      (totalGB * TrueCostService.PRICING.S3_STORAGE_GB_MONTH) / 30;

    // S3 request costs (assume 2 requests per usage: PUT and GET)
    const requestCost =
      2 *
      (TrueCostService.PRICING.S3_REQUEST_PUT +
        TrueCostService.PRICING.S3_REQUEST_GET);

    return {
      cost: storageCost + requestCost,
      logsBytes,
      cacheBytes,
      artifactsBytes,
    };
  }

  /**
   * Calculate network cost
   */
  private async calculateNetworkCost(metrics: RequestMetrics): Promise<{
    cost: number;
    egressGB: number;
    ingressGB: number;
  }> {
    // Estimate based on response size and assume some overhead
    const responseBytes = metrics.responseBytes || 1024; // 1KB default
    const egressGB = responseBytes / (1024 * 1024 * 1024);
    const ingressGB = (responseBytes * 0.1) / (1024 * 1024 * 1024); // Assume 10% ingress for requests

    const egressCost = egressGB * TrueCostService.PRICING.NETWORK_EGRESS_GB;
    const ingressCost = ingressGB * TrueCostService.PRICING.NETWORK_INGRESS_GB;

    return {
      cost: egressCost + ingressCost,
      egressGB,
      ingressGB,
    };
  }

  /**
   * Calculate compute cost
   */
  private async calculateComputeCost(metrics: RequestMetrics): Promise<{
    cost: number;
    cpuMillis: number;
    memoryMBMillis: number;
  }> {
    // Estimate compute usage based on latency
    const latencyMs = metrics.latencyMs;
    const cpuMillis = latencyMs; // Assume 1 CPU core fully utilized
    const memoryMBMillis = latencyMs * 128; // Assume 128MB memory usage

    const computeCost =
      (cpuMillis / 1000) * TrueCostService.PRICING.COMPUTE_GB_SECOND * 0.001; // Convert to GB-seconds
    const requestCost = TrueCostService.PRICING.COMPUTE_REQUEST;

    return {
      cost: computeCost + requestCost,
      cpuMillis,
      memoryMBMillis,
    };
  }

  /**
   * Calculate caching cost
   */
  private async calculateCachingCost(metrics: RequestMetrics): Promise<{
    cost: number;
    redisOps: number;
    storageGB: number;
  }> {
    const redisOps = (metrics.cacheHits || 0) + (metrics.cacheMisses || 0);

    // Estimate Redis operations cost
    const opsCost =
      (redisOps / 1000000) * TrueCostService.PRICING.REDIS_OPS_MILLION;

    // Estimate storage (rough approximation)
    const storageGB = (redisOps * 0.001) / (1024 * 1024 * 1024); // 1KB per operation on average
    const storageCost =
      (storageGB * TrueCostService.PRICING.REDIS_STORAGE_GB_MONTH) / 30;

    return {
      cost: opsCost + storageCost,
      redisOps,
      storageGB,
    };
  }

  /**
   * Calculate logging cost
   */
  private async calculateLoggingCost(metrics: RequestMetrics): Promise<{
    cost: number;
    volumeGB: number;
    retentionDays: number;
  }> {
    const volumeBytes = metrics.logVolumeBytes || 2048; // 2KB default logs
    const volumeGB = volumeBytes / (1024 * 1024 * 1024);

    // Ingestion cost
    const ingestionCost =
      volumeGB * TrueCostService.PRICING.LOGGING_INGESTION_GB;

    // Storage cost (assume 30 days retention)
    const retentionDays = 30;
    const storageCost =
      volumeGB * TrueCostService.PRICING.LOGGING_STORAGE_GB_MONTH;

    return {
      cost: ingestionCost + storageCost,
      volumeGB,
      retentionDays,
    };
  }

  /**
   * Calculate observability cost
   */
  private async calculateObservabilityCost(): Promise<{
    cost: number;
    metricsCount: number;
    tracesCount: number;
  }> {
    // Estimate observability costs per request
    const metricsCount = 10; // Assume 10 metrics per request
    const tracesCount = 1; // Assume 1 trace per request

    const metricsCost =
      (metricsCount / 1000000) * TrueCostService.PRICING.METRICS_PER_MILLION;
    const tracesCost =
      (tracesCount / 1000000) * TrueCostService.PRICING.TRACES_PER_MILLION;

    return {
      cost: metricsCost + tracesCost,
      metricsCount,
      tracesCount,
    };
  }

  /**
   * Get cost breakdown summary
   */
  getCostBreakdown(trueCost: TrueCostComponents): {
    apiPercentage: number;
    infrastructurePercentage: number;
    topCostComponents: Array<{
      name: string;
      cost: number;
      percentage: number;
    }>;
  } {
    const apiPercentage = (trueCost.apiCost / trueCost.totalCost) * 100;
    const infrastructurePercentage = 100 - apiPercentage;

    const components = [
      { name: 'API Provider', cost: trueCost.apiCost },
      { name: 'Vector DB', cost: trueCost.vectorDBCost },
      { name: 'Storage', cost: trueCost.storageCost },
      { name: 'Network', cost: trueCost.networkCost },
      { name: 'Compute', cost: trueCost.computeCost },
      { name: 'Caching', cost: trueCost.cachingCost },
      { name: 'Logging', cost: trueCost.loggingCost },
      { name: 'Observability', cost: trueCost.observabilityCost },
    ];

    const topCostComponents = components
      .filter((c) => c.cost > 0)
      .map((c) => ({
        name: c.name,
        cost: c.cost,
        percentage: (c.cost / trueCost.totalCost) * 100,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    return {
      apiPercentage,
      infrastructurePercentage,
      topCostComponents,
    };
  }

  /**
   * Estimate monthly infrastructure cost for a project
   */
  async estimateMonthlyInfrastructureCost(projectId: string): Promise<{
    estimatedMonthlyCost: number;
    breakdown: Record<string, number>;
    assumptions: string[];
    confidence: number;
    lastUpdated: Date;
  }> {
    try {
      // Get actual usage data for the project (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Get actual usage data from database
      const usageData = await this.usageModel
        .find({
          projectId,
          timestamp: { $gte: thirtyDaysAgo },
        })
        .sort({ timestamp: -1 })
        .limit(1000) // Limit to prevent memory issues
        .exec();

      let breakdown;
      let dataSource: 'actual' | 'no_data' = 'actual';

      if (usageData.length === 0) {
        // No usage data found - return zero costs with clear indication
        this.logger.warn(
          `No usage data found for project ${projectId} - returning zero costs`,
        );
        dataSource = 'no_data';
        breakdown = {
          vectorDB: 0,
          storage: 0,
          network: 0,
          compute: 0,
          caching: 0,
          logging: 0,
          observability: 0,
        };
      } else {
        // Calculate costs based on actual usage patterns
        breakdown = await this.calculateMonthlyCostsFromUsageData(usageData);
      }

      const estimatedMonthlyCost = Object.values(breakdown).reduce(
        (sum, cost) => sum + cost,
        0,
      );

      // Calculate confidence based on data availability
      const confidence =
        dataSource === 'actual'
          ? Math.min(0.95, usageData.length / 100) // Higher confidence with more data points
          : 0.0; // Zero confidence when no data is available

      const assumptions =
        dataSource === 'actual'
          ? [
              'Based on last 30 days of usage data',
              'Excludes API provider costs',
              'Assumes AWS pricing in us-east-1',
              '30-day retention for logs and metrics',
            ]
          : [
              'No usage data available for this project',
              'All costs shown as $0.00',
              'Enable usage tracking to see real cost estimates',
              'Assumes AWS pricing in us-east-1 when data becomes available',
            ];

      return {
        estimatedMonthlyCost,
        breakdown,
        assumptions,
        confidence,
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.logger.error('Failed to estimate monthly infrastructure cost', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to basic estimates
      const breakdown = {
        vectorDB: 25.0,
        storage: 15.0,
        network: 10.0,
        compute: 50.0,
        caching: 8.0,
        logging: 12.0,
        observability: 30.0,
      };

      return {
        estimatedMonthlyCost: Object.values(breakdown).reduce(
          (sum, cost) => sum + cost,
          0,
        ),
        breakdown,
        assumptions: [
          'Fallback estimates due to data unavailability',
          'Based on average usage patterns',
          'Excludes API provider costs',
          'Assumes AWS pricing',
          '30-day retention for logs',
          'Standard caching patterns',
        ],
        confidence: 0.3,
        lastUpdated: new Date(),
      };
    }
  }

  /**
   * Get cost optimization recommendations
   */
  async getCostOptimizationRecommendations(projectId: string): Promise<{
    recommendations: Array<{
      type: string;
      description: string;
      potentialSavings: number;
      effort: 'low' | 'medium' | 'high';
      impact: 'low' | 'medium' | 'high';
      implementation: string[];
    }>;
    totalPotentialSavings: number;
  }> {
    try {
      const currentCosts =
        await this.estimateMonthlyInfrastructureCost(projectId);
      const recommendations: Array<{
        type: string;
        description: string;
        potentialSavings: number;
        effort: 'low' | 'medium' | 'high';
        impact: 'low' | 'medium' | 'high';
        implementation: string[];
      }> = [];

      // Vector DB optimization
      if (currentCosts.breakdown.vectorDB > 20) {
        recommendations.push({
          type: 'vector_db_optimization',
          description: 'Optimize vector database usage and storage',
          potentialSavings: currentCosts.breakdown.vectorDB * 0.3,
          effort: 'medium',
          impact: 'high',
          implementation: [
            'Implement vector compression',
            'Use approximate nearest neighbor search',
            'Clean up unused vector indexes',
            'Implement vector caching layer',
          ],
        });
      }

      // Storage optimization
      if (currentCosts.breakdown.storage > 10) {
        recommendations.push({
          type: 'storage_optimization',
          description: 'Implement intelligent data retention and compression',
          potentialSavings: currentCosts.breakdown.storage * 0.4,
          effort: 'low',
          impact: 'medium',
          implementation: [
            'Implement log rotation and compression',
            'Use tiered storage (hot/cold/warm)',
            'Clean up old telemetry data',
            'Implement data archiving policies',
          ],
        });
      }

      // Caching optimization
      if (currentCosts.breakdown.caching > 5) {
        recommendations.push({
          type: 'caching_optimization',
          description: 'Improve cache hit rates and efficiency',
          potentialSavings: currentCosts.breakdown.caching * 0.5,
          effort: 'medium',
          impact: 'high',
          implementation: [
            'Implement cache warming strategies',
            'Use Redis clustering for better performance',
            'Optimize cache key design',
            'Implement cache invalidation policies',
          ],
        });
      }

      // Compute optimization
      if (currentCosts.breakdown.compute > 30) {
        recommendations.push({
          type: 'compute_optimization',
          description: 'Optimize compute resource usage',
          potentialSavings: currentCosts.breakdown.compute * 0.25,
          effort: 'high',
          impact: 'medium',
          implementation: [
            'Use serverless compute where possible',
            'Implement request batching',
            'Optimize function cold starts',
            'Use spot instances for batch processing',
          ],
        });
      }

      // Network optimization
      if (currentCosts.breakdown.network > 15) {
        recommendations.push({
          type: 'network_optimization',
          description: 'Reduce data transfer and optimize CDN usage',
          potentialSavings: currentCosts.breakdown.network * 0.6,
          effort: 'low',
          impact: 'high',
          implementation: [
            'Implement response compression',
            'Use CDN for static assets',
            'Optimize API response sizes',
            'Implement request deduplication',
          ],
        });
      }

      const totalPotentialSavings = recommendations.reduce(
        (sum, rec) => sum + rec.potentialSavings,
        0,
      );

      return {
        recommendations: recommendations.sort(
          (a, b) => b.potentialSavings - a.potentialSavings,
        ),
        totalPotentialSavings,
      };
    } catch (error) {
      this.logger.error(
        'Failed to generate cost optimization recommendations',
        {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      return {
        recommendations: [],
        totalPotentialSavings: 0,
      };
    }
  }

  /**
   * Compare costs across different cloud providers
   */
  async compareCloudProviderCosts(metrics: RequestMetrics): Promise<{
    providers: Record<string, TrueCostComponents>;
    recommendation: string;
    savings: number;
  }> {
    const providers = ['aws', 'gcp', 'azure'];
    const results: Record<string, TrueCostComponents> = {};

    // Calculate costs for each provider
    for (const provider of providers) {
      const providerMetrics = { ...metrics, provider };
      results[provider] = await this.calculateTrueCost(providerMetrics);
    }

    // Find the cheapest provider
    const costs = Object.entries(results).map(([provider, cost]) => ({
      provider,
      totalCost: cost.totalCost,
    }));

    costs.sort((a, b) => a.totalCost - b.totalCost);
    const cheapest = costs[0];
    const mostExpensive = costs[costs.length - 1];

    const savings = mostExpensive.totalCost - cheapest.totalCost;

    return {
      providers: results,
      recommendation: `Switch to ${cheapest.provider.toUpperCase()} to save $${savings.toFixed(2)} per request`,
      savings,
    };
  }

  /**
   * Get cost trends over time
   */
  async getCostTrends(
    projectId: string,
    days: number = 30,
  ): Promise<{
    dailyCosts: Array<{
      date: string;
      totalCost: number;
      apiCost: number;
      infrastructureCost: number;
    }>;
    trends: {
      totalTrend: 'increasing' | 'decreasing' | 'stable';
      apiTrend: 'increasing' | 'decreasing' | 'stable';
      infrastructureTrend: 'increasing' | 'decreasing' | 'stable';
      projectedMonthlyCost: number;
    };
  }> {
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const dailyCosts: Array<{
        date: string;
        totalCost: number;
        apiCost: number;
        infrastructureCost: number;
      }> = [];

      // Try to get actual daily usage data
      const usageData = await this.usageModel
        .find({
          projectId,
          timestamp: { $gte: startDate },
        })
        .sort({ timestamp: 1 })
        .exec();

      if (usageData.length === 0) {
        // No usage data available
        this.logger.warn(
          `No usage data found for project ${projectId} - returning empty trends`,
        );
        return {
          dailyCosts: [],
          trends: {
            totalTrend: 'stable' as const,
            apiTrend: 'stable' as const,
            infrastructureTrend: 'stable' as const,
            projectedMonthlyCost: 0,
          },
        };
      } else {
        // Group usage data by date and calculate daily costs
        const dailyUsageMap = new Map<string, any[]>();

        usageData.forEach((usage) => {
          const dateKey = (usage.createdAt ?? new Date())
            .toISOString()
            .split('T')[0];
          if (!dailyUsageMap.has(dateKey)) {
            dailyUsageMap.set(dateKey, []);
          }
          dailyUsageMap.get(dateKey)!.push(usage);
        });

        // Calculate costs for each day
        for (const [dateKey, dayUsages] of dailyUsageMap.entries()) {
          try {
            const dailyMetrics =
              await this.calculateDailyMetricsFromUsageData(dayUsages);
            const cost = await this.calculateTrueCost(dailyMetrics);

            dailyCosts.push({
              date: dateKey,
              totalCost: cost.totalCost,
              apiCost: cost.apiCost,
              infrastructureCost: cost.totalCost - cost.apiCost,
            });
          } catch (dayError) {
            this.logger.warn(
              `Failed to calculate costs for date ${dateKey}`,
              dayError,
            );
          }
        }

        // Sort by date
        dailyCosts.sort((a, b) => a.date.localeCompare(b.date));
      }

      // Analyze trends
      const trends = this.analyzeCostTrends(dailyCosts);

      return {
        dailyCosts,
        trends,
      };
    } catch (error) {
      this.logger.error('Failed to get cost trends', {
        projectId,
        days,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        dailyCosts: [],
        trends: {
          totalTrend: 'stable',
          apiTrend: 'stable',
          infrastructureTrend: 'stable',
          projectedMonthlyCost: 0,
        },
      };
    }
  }

  /**
   * Calculate monthly costs from actual usage data
   */
  private async calculateMonthlyCostsFromUsageData(
    usageData: any[],
  ): Promise<Record<string, number>> {
    // Aggregate usage metrics across all records
    const aggregatedMetrics = usageData.reduce(
      (acc, usage) => {
        acc.totalRequests++;
        acc.totalTokens += usage.totalTokens || 0;
        acc.totalLatency += usage.latencyMs || 0;
        acc.totalVectorQueries += usage.metadata?.vectorDBQueries || 0;
        acc.totalEmbeddings += usage.metadata?.embeddingsGenerated || 0;
        acc.totalCacheHits += usage.metadata?.cacheHits || 0;
        acc.totalCacheMisses += usage.metadata?.cacheMisses || 0;
        acc.totalLogVolume += usage.metadata?.logVolumeBytes || 0;
        acc.totalResponseBytes += usage.metadata?.responseBytes || 0;
        return acc;
      },
      {
        totalRequests: 0,
        totalTokens: 0,
        totalLatency: 0,
        totalVectorQueries: 0,
        totalEmbeddings: 0,
        totalCacheHits: 0,
        totalCacheMisses: 0,
        totalLogVolume: 0,
        totalResponseBytes: 0,
      },
    );

    // Calculate average metrics per request
    const avgMetrics: RequestMetrics = {
      requestId: 'aggregated',
      userId: 'aggregated',
      timestamp: new Date(),
      model: 'mixed',
      provider: 'mixed',
      inputTokens: Math.floor(
        (aggregatedMetrics.totalTokens * 0.6) / aggregatedMetrics.totalRequests,
      ),
      outputTokens: Math.floor(
        (aggregatedMetrics.totalTokens * 0.4) / aggregatedMetrics.totalRequests,
      ),
      totalTokens: Math.floor(
        aggregatedMetrics.totalTokens / aggregatedMetrics.totalRequests,
      ),
      latencyMs:
        aggregatedMetrics.totalLatency / aggregatedMetrics.totalRequests,
      vectorDBQueries:
        aggregatedMetrics.totalVectorQueries / aggregatedMetrics.totalRequests,
      embeddingsGenerated:
        aggregatedMetrics.totalEmbeddings / aggregatedMetrics.totalRequests,
      cacheHits:
        aggregatedMetrics.totalCacheHits / aggregatedMetrics.totalRequests,
      cacheMisses:
        aggregatedMetrics.totalCacheMisses / aggregatedMetrics.totalRequests,
      logVolumeBytes:
        aggregatedMetrics.totalLogVolume / aggregatedMetrics.totalRequests,
      responseBytes:
        aggregatedMetrics.totalResponseBytes / aggregatedMetrics.totalRequests,
    };

    // Calculate monthly costs (scale up from sample data)
    const daysInSample =
      usageData.length > 0
        ? Math.max(
            1,
            (Date.now() - usageData[usageData.length - 1].timestamp.getTime()) /
              (24 * 60 * 60 * 1000),
          )
        : 30;

    const scalingFactor = 30 / daysInSample; // Scale to monthly

    return {
      vectorDB:
        (await this.calculateMonthlyVectorDBCost(avgMetrics)) * scalingFactor,
      storage:
        (await this.calculateMonthlyStorageCost(avgMetrics)) * scalingFactor,
      network:
        (await this.calculateMonthlyNetworkCost(avgMetrics)) * scalingFactor,
      compute:
        (await this.calculateMonthlyComputeCost(avgMetrics)) * scalingFactor,
      caching:
        (await this.calculateMonthlyCachingCost(avgMetrics)) * scalingFactor,
      logging:
        (await this.calculateMonthlyLoggingCost(avgMetrics)) * scalingFactor,
      observability:
        (await this.calculateMonthlyObservabilityCost(avgMetrics)) *
        scalingFactor,
    };
  }

  /**
   * Calculate daily metrics from usage data
   */
  private async calculateDailyMetricsFromUsageData(
    usageData: any[],
  ): Promise<RequestMetrics> {
    if (usageData.length === 0) {
      throw new Error('No usage data provided');
    }

    // Aggregate metrics for the day
    const aggregatedMetrics = usageData.reduce(
      (acc, usage) => {
        acc.totalRequests++;
        acc.totalTokens += usage.totalTokens || 0;
        acc.totalLatency += usage.latencyMs || 0;
        acc.totalVectorQueries += usage.metadata?.vectorDBQueries || 0;
        acc.totalEmbeddings += usage.metadata?.embeddingsGenerated || 0;
        acc.totalCacheHits += usage.metadata?.cacheHits || 0;
        acc.totalCacheMisses += usage.metadata?.cacheMisses || 0;
        acc.totalLogVolume += usage.metadata?.logVolumeBytes || 0;
        acc.totalResponseBytes += usage.metadata?.responseBytes || 0;
        return acc;
      },
      {
        totalRequests: 0,
        totalTokens: 0,
        totalLatency: 0,
        totalVectorQueries: 0,
        totalEmbeddings: 0,
        totalCacheHits: 0,
        totalCacheMisses: 0,
        totalLogVolume: 0,
        totalResponseBytes: 0,
      },
    );

    // Get most common model and provider
    const modelCounts = new Map<string, number>();
    const providerCounts = new Map<string, number>();

    usageData.forEach((usage) => {
      modelCounts.set(usage.model, (modelCounts.get(usage.model) || 0) + 1);
      providerCounts.set(
        usage.provider,
        (providerCounts.get(usage.provider) || 0) + 1,
      );
    });

    const mostCommonModel =
      Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      'mixed';

    const mostCommonProvider =
      Array.from(providerCounts.entries()).sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0] || 'mixed';

    // Calculate averages
    return {
      requestId: `daily-${usageData[0].timestamp.toISOString().split('T')[0]}`,
      userId: usageData[0].userId,
      timestamp: usageData[0].timestamp,
      model: mostCommonModel,
      provider: mostCommonProvider,
      inputTokens: Math.floor(
        (aggregatedMetrics.totalTokens * 0.6) / aggregatedMetrics.totalRequests,
      ),
      outputTokens: Math.floor(
        (aggregatedMetrics.totalTokens * 0.4) / aggregatedMetrics.totalRequests,
      ),
      totalTokens: Math.floor(
        aggregatedMetrics.totalTokens / aggregatedMetrics.totalRequests,
      ),
      latencyMs:
        aggregatedMetrics.totalLatency / aggregatedMetrics.totalRequests,
      vectorDBQueries:
        aggregatedMetrics.totalVectorQueries / aggregatedMetrics.totalRequests,
      embeddingsGenerated:
        aggregatedMetrics.totalEmbeddings / aggregatedMetrics.totalRequests,
      cacheHits:
        aggregatedMetrics.totalCacheHits / aggregatedMetrics.totalRequests,
      cacheMisses:
        aggregatedMetrics.totalCacheMisses / aggregatedMetrics.totalRequests,
      logVolumeBytes:
        aggregatedMetrics.totalLogVolume / aggregatedMetrics.totalRequests,
      responseBytes:
        aggregatedMetrics.totalResponseBytes / aggregatedMetrics.totalRequests,
    };
  }

  private async calculateMonthlyVectorDBCost(
    usage: RequestMetrics,
  ): Promise<number> {
    const monthlyQueries = usage.vectorDBQueries! * 30 * 24; // Estimate daily usage
    const monthlyEmbeddings = usage.embeddingsGenerated! * 30 * 24;
    const estimatedStorageGB = (monthlyEmbeddings * 0.004) / 1024 / 1024 / 1024;

    const queryCost =
      (monthlyQueries / 1000000) *
      TrueCostService.PRICING.VECTOR_DB_QUERY *
      1000000;
    const embeddingCost =
      (monthlyEmbeddings / 1000) * TrueCostService.PRICING.EMBEDDING_GENERATION;
    const storageCost =
      estimatedStorageGB * TrueCostService.PRICING.VECTOR_DB_STORAGE_GB_MONTH;

    return queryCost + embeddingCost + storageCost;
  }

  private async calculateMonthlyStorageCost(
    usage: RequestMetrics,
  ): Promise<number> {
    const monthlyLogsGB =
      (usage.logVolumeBytes! * 30 * 24) / (1024 * 1024 * 1024);
    const monthlyCacheGB =
      ((usage.cacheHits! + usage.cacheMisses!) * 1024 * 30 * 24) /
      (1024 * 1024 * 1024);
    const monthlyArtifactsGB =
      (usage.responseBytes! * 30 * 24) / (1024 * 1024 * 1024);

    const totalGB = monthlyLogsGB + monthlyCacheGB + monthlyArtifactsGB;
    return totalGB * TrueCostService.PRICING.S3_STORAGE_GB_MONTH;
  }

  private async calculateMonthlyNetworkCost(
    usage: RequestMetrics,
  ): Promise<number> {
    const monthlyEgressGB =
      (usage.responseBytes! * 30 * 24) / (1024 * 1024 * 1024);
    return monthlyEgressGB * TrueCostService.PRICING.NETWORK_EGRESS_GB;
  }

  private async calculateMonthlyComputeCost(
    usage: RequestMetrics,
  ): Promise<number> {
    const monthlyRequests = 30 * 24 * 10; // Estimate 10 requests per hour
    const monthlyComputeSeconds = (usage.latencyMs / 1000) * monthlyRequests;

    return monthlyComputeSeconds * TrueCostService.PRICING.COMPUTE_GB_SECOND;
  }

  private async calculateMonthlyCachingCost(
    usage: RequestMetrics,
  ): Promise<number> {
    const monthlyOps = (usage.cacheHits! + usage.cacheMisses!) * 30 * 24;
    const estimatedStorageGB = (monthlyOps * 0.001) / (1024 * 1024 * 1024);

    const opsCost =
      (monthlyOps / 1000000) * TrueCostService.PRICING.REDIS_OPS_MILLION;
    const storageCost =
      estimatedStorageGB * TrueCostService.PRICING.REDIS_STORAGE_GB_MONTH;

    return opsCost + storageCost;
  }

  private async calculateMonthlyLoggingCost(
    usage: RequestMetrics,
  ): Promise<number> {
    const monthlyVolumeGB =
      (usage.logVolumeBytes! * 30 * 24) / (1024 * 1024 * 1024);
    const ingestionCost =
      monthlyVolumeGB * TrueCostService.PRICING.LOGGING_INGESTION_GB;
    const storageCost =
      monthlyVolumeGB * TrueCostService.PRICING.LOGGING_STORAGE_GB_MONTH;

    return ingestionCost + storageCost;
  }

  private async calculateMonthlyObservabilityCost(
    usage: RequestMetrics,
  ): Promise<number> {
    const monthlyRequests = 30 * 24 * 10; // Estimate 10 requests per hour
    const metricsCost =
      (monthlyRequests / 1000000) * TrueCostService.PRICING.METRICS_PER_MILLION;
    const tracesCost =
      (monthlyRequests / 1000000) * TrueCostService.PRICING.TRACES_PER_MILLION;

    return metricsCost + tracesCost;
  }

  private calculateEstimationConfidence(usage: RequestMetrics): number {
    // Calculate confidence based on data completeness
    let confidence = 1.0;

    if (!usage.vectorDBQueries) confidence -= 0.1;
    if (!usage.cacheHits) confidence -= 0.1;
    if (!usage.logVolumeBytes) confidence -= 0.1;
    if (!usage.latencyMs) confidence -= 0.2;

    return Math.max(0.1, confidence);
  }

  private analyzeCostTrends(
    dailyCosts: Array<{
      date: string;
      totalCost: number;
      apiCost: number;
      infrastructureCost: number;
    }>,
  ): {
    totalTrend: 'increasing' | 'decreasing' | 'stable';
    apiTrend: 'increasing' | 'decreasing' | 'stable';
    infrastructureTrend: 'increasing' | 'decreasing' | 'stable';
    projectedMonthlyCost: number;
  } {
    if (dailyCosts.length < 7) {
      return {
        totalTrend: 'stable',
        apiTrend: 'stable',
        infrastructureTrend: 'stable',
        projectedMonthlyCost: 0,
      };
    }

    // Calculate trends using simple linear regression
    const totalTrend = this.calculateTrend(dailyCosts.map((d) => d.totalCost));
    const apiTrend = this.calculateTrend(dailyCosts.map((d) => d.apiCost));
    const infrastructureTrend = this.calculateTrend(
      dailyCosts.map((d) => d.infrastructureCost),
    );

    // Project monthly cost
    const avgDailyCost =
      dailyCosts.reduce((sum, d) => sum + d.totalCost, 0) / dailyCosts.length;
    const projectedMonthlyCost = avgDailyCost * 30;

    return {
      totalTrend,
      apiTrend,
      infrastructureTrend,
      projectedMonthlyCost,
    };
  }

  private calculateTrend(
    values: number[],
  ): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 2) return 'stable';

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg =
      firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;

    const change = (secondAvg - firstAvg) / firstAvg;

    if (change > 0.05) return 'increasing';
    if (change < -0.05) return 'decreasing';
    return 'stable';
  }

  private simpleHash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
