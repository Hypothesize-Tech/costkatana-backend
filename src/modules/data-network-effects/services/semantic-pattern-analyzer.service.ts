import {
  SemanticCluster,
  SemanticClusterDocument,
  IClusterCostAnalysis,
  IClusterPerformanceAnalysis,
  IClusterUsagePattern,
  IOptimizationRecommendation,
} from '../../../schemas/misc/semantic-cluster.schema';
import { Telemetry } from '../../../schemas/core/telemetry.schema';
import { Usage } from '../../../schemas/core/usage.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { Model, Types } from 'mongoose';

/**
 * Data point for clustering
 */
interface DataPoint {
  id: string;
  embedding: number[];
  content: string;
  cost: number;
  latency: number;
  timestamp: Date;
  userId: string;
  model: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  source: 'telemetry' | 'usage';
}

/**
 * Semantic Pattern Analyzer Service
 * Uses existing embeddings to cluster similar requests and discover patterns
 */
@Injectable()
export class SemanticPatternAnalyzerService {
  private readonly logger = new Logger(SemanticPatternAnalyzerService.name);
  private static readonly DEFAULT_NUM_CLUSTERS = 20;
  private static readonly MIN_CLUSTER_SIZE = 10;
  private static readonly MAX_EXAMPLES_PER_CLUSTER = 10;

  constructor(
    @InjectModel(SemanticCluster.name)
    private semanticClusterModel: Model<SemanticClusterDocument>,
    @InjectModel(Telemetry.name)
    private telemetryModel: Model<any>,
    @InjectModel(Usage.name)
    private usageModel: Model<any>,
  ) {}

  /**
   * Run clustering analysis on telemetry/usage data
   */
  async runClusteringAnalysis(params: {
    startDate: Date;
    endDate: Date;
    userId?: string;
    tenantId?: string;
    numClusters?: number;
  }): Promise<SemanticClusterDocument[]> {
    try {
      this.logger.log('🔍 Starting semantic clustering analysis...', {
        startDate: params.startDate.toISOString(),
        endDate: params.endDate.toISOString(),
      });

      // 1. Collect data points with embeddings
      const dataPoints = await this.collectDataPoints(params);

      if (dataPoints.length < SemanticPatternAnalyzerService.MIN_CLUSTER_SIZE) {
        this.logger.warn('Insufficient data for clustering', {
          dataPoints: dataPoints.length,
          minRequired: SemanticPatternAnalyzerService.MIN_CLUSTER_SIZE,
        });
        return [];
      }

      this.logger.log(
        `Collected ${dataPoints.length} data points for clustering`,
      );

      // 2. Perform K-means clustering
      const numClusters = Math.min(
        params.numClusters ??
          SemanticPatternAnalyzerService.DEFAULT_NUM_CLUSTERS,
        Math.floor(
          dataPoints.length / SemanticPatternAnalyzerService.MIN_CLUSTER_SIZE,
        ),
      );

      const clusters = this.performKMeansClustering(dataPoints, numClusters);

      this.logger.log(`Created ${clusters.length} clusters`);

      // 3. Analyze each cluster and save
      const savedClusters: SemanticClusterDocument[] = [];

      for (let i = 0; i < clusters.length; i++) {
        if (
          clusters[i].length < SemanticPatternAnalyzerService.MIN_CLUSTER_SIZE
        )
          continue;

        try {
          const cluster = await this.analyzeAndSaveCluster(
            clusters[i],
            i,
            params.startDate,
            params.endDate,
          );
          savedClusters.push(cluster);
        } catch (error) {
          this.logger.warn(`Failed to analyze cluster ${i}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.logger.log('✅ Completed semantic clustering analysis', {
        clustersCreated: savedClusters.length,
        totalDataPoints: dataPoints.length,
      });

      return savedClusters;
    } catch (error) {
      this.logger.error('❌ Clustering analysis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Collect data points with embeddings
   */
  private async collectDataPoints(params: {
    startDate: Date;
    endDate: Date;
    userId?: string;
    tenantId?: string;
  }): Promise<DataPoint[]> {
    const dataPoints: DataPoint[] = [];

    // Query telemetry data with embeddings
    const telemetryQuery: Record<string, unknown> = {
      timestamp: { $gte: params.startDate, $lte: params.endDate },
      semantic_embedding: { $exists: true, $ne: null, $not: { $size: 0 } },
    };

    if (params.tenantId) telemetryQuery.tenant_id = params.tenantId;
    if (params.userId) telemetryQuery.user_id = params.userId;

    const telemetryData = await this.telemetryModel
      .find(telemetryQuery)
      .select(
        'semantic_embedding semantic_content cost_usd duration_ms timestamp user_id gen_ai_model prompt_tokens completion_tokens total_tokens status',
      )
      .limit(5000) // Limit for performance
      .lean();

    for (const t of telemetryData) {
      if (!t.semantic_embedding || t.semantic_embedding.length === 0) continue;

      dataPoints.push({
        id: String(t._id),
        embedding: t.semantic_embedding,
        content: String(t.semantic_content ?? ''),
        cost: Number(t.cost_usd ?? 0),
        latency: Number(t.duration_ms ?? 0),
        timestamp: t.timestamp,
        userId: String(t.user_id ?? ''),
        model: (t.gen_ai_model as string) ?? 'unknown',
        tokens: (t.total_tokens as number) ?? 0,
        inputTokens: (t.prompt_tokens as number) ?? 0,
        outputTokens: (t.completion_tokens as number) ?? 0,
        success: t.status === 'success',
        source: 'telemetry',
      });
    }

    this.logger.log(
      `Collected ${dataPoints.length} data points from telemetry`,
    );

    return dataPoints;
  }

  /**
   * Perform K-means clustering on embeddings
   */
  private performKMeansClustering(
    dataPoints: DataPoint[],
    numClusters: number,
  ): DataPoint[][] {
    if (dataPoints.length === 0) return [];

    const embeddingDim = dataPoints[0].embedding.length;
    const maxIterations = 50;
    const convergenceThreshold = 0.001;

    // Initialize centroids using k-means++
    let centroids: number[][] = this.initializeCentroidsKMeansPlusPlus(
      dataPoints,
      numClusters,
    );

    // Ensure all initial centroids are the correct dimension
    centroids = centroids.map((centroid): number[] => {
      return centroid.length === embeddingDim
        ? centroid
        : [
            ...centroid,
            ...(Array(embeddingDim - centroid.length).fill(0) as number[]),
          ];
    });

    // K-means iterations
    let prevCentroids: number[][] = [];
    let iteration = 0;

    while (iteration < maxIterations) {
      // Assign points to nearest centroid
      const clusters: DataPoint[][] = Array.from(
        { length: numClusters },
        () => [],
      );

      for (const point of dataPoints) {
        const embedding: number[] =
          point.embedding.length === embeddingDim
            ? point.embedding
            : [
                ...point.embedding,
                ...(Array(embeddingDim - point.embedding.length).fill(
                  0,
                ) as number[]),
              ];
        const nearestCentroidIdx = this.findNearestCentroid(
          embedding,
          centroids,
        );
        clusters[nearestCentroidIdx].push(point);
      }

      // Update centroids
      prevCentroids = centroids;
      centroids = clusters.map((cluster): number[] => {
        if (cluster.length === 0) {
          // If cluster is empty, reinitialize with random point and pad if necessary
          const rand =
            dataPoints[Math.floor(Math.random() * dataPoints.length)].embedding;
          return rand.length === embeddingDim
            ? rand
            : [
                ...rand,
                ...(Array(embeddingDim - rand.length).fill(0) as number[]),
              ];
        }
        // Calculate cluster centroid and ensure correct dimension
        const centroid = this.calculateCentroid(
          cluster.map((p): number[] => {
            return p.embedding.length === embeddingDim
              ? p.embedding
              : [
                  ...p.embedding,
                  ...(Array(embeddingDim - p.embedding.length).fill(
                    0,
                  ) as number[]),
                ];
          }),
        );
        return centroid.length === embeddingDim
          ? centroid
          : [
              ...centroid,
              ...(Array(embeddingDim - centroid.length).fill(0) as number[]),
            ];
      });

      // Check convergence
      const maxChange = this.maxCentroidChange(prevCentroids, centroids);
      if (maxChange < convergenceThreshold) {
        this.logger.log(`K-means converged after ${iteration + 1} iterations`);
        break;
      }

      iteration++;
    }

    // Final assignment
    const finalClusters: DataPoint[][] = Array.from(
      { length: numClusters },
      () => [],
    );
    for (const point of dataPoints) {
      const embedding: number[] =
        point.embedding.length === embeddingDim
          ? point.embedding
          : [
              ...point.embedding,
              ...(Array(embeddingDim - point.embedding.length).fill(
                0,
              ) as number[]),
            ];
      const nearestCentroidIdx = this.findNearestCentroid(embedding, centroids);
      finalClusters[nearestCentroidIdx].push(point);
    }

    // Filter out empty or small clusters
    return finalClusters.filter(
      (cluster) =>
        cluster.length >= SemanticPatternAnalyzerService.MIN_CLUSTER_SIZE,
    );
  }

  /**
   * Initialize centroids using k-means++ algorithm
   */
  private initializeCentroidsKMeansPlusPlus(
    dataPoints: DataPoint[],
    numClusters: number,
  ): number[][] {
    const centroids: number[][] = [];

    // First centroid: random point
    const firstIdx = Math.floor(Math.random() * dataPoints.length);
    centroids.push([...dataPoints[firstIdx].embedding]);

    // Subsequent centroids: weighted by distance to nearest existing centroid
    for (let i = 1; i < numClusters; i++) {
      const distances = dataPoints.map((point) => {
        const nearestCentroidIdx = this.findNearestCentroid(
          point.embedding,
          centroids,
        );
        return this.cosineSimilarity(
          point.embedding,
          centroids[nearestCentroidIdx],
        );
      });

      // Convert similarity to distance (1 - similarity)
      const distancesFromNearest = distances.map((d) => 1 - d);
      const totalDistance = distancesFromNearest.reduce((sum, d) => sum + d, 0);

      // Weighted random selection
      let rand = Math.random() * totalDistance;
      let selectedIdx = 0;

      for (let j = 0; j < distancesFromNearest.length; j++) {
        rand -= distancesFromNearest[j];
        if (rand <= 0) {
          selectedIdx = j;
          break;
        }
      }

      centroids.push([...dataPoints[selectedIdx].embedding]);
    }

    return centroids;
  }

  /**
   * Find nearest centroid to a point
   */
  private findNearestCentroid(
    embedding: number[],
    centroids: number[][],
  ): number {
    let maxSimilarity = -1;
    let nearestIdx = 0;

    for (let i = 0; i < centroids.length; i++) {
      const similarity = this.cosineSimilarity(embedding, centroids[i]);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        nearestIdx = i;
      }
    }

    return nearestIdx;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    return normA && normB ? dotProduct / (normA * normB) : 0;
  }

  /**
   * Calculate centroid of a cluster
   */
  private calculateCentroid(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];

    const dim = embeddings[0].length;
    const centroid = new Array(dim).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += embedding[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }

  /**
   * Calculate maximum change between centroid sets
   */
  private maxCentroidChange(
    oldCentroids: number[][],
    newCentroids: number[][],
  ): number {
    let maxChange = 0;

    for (let i = 0; i < oldCentroids.length; i++) {
      const change = this.cosineSimilarity(oldCentroids[i], newCentroids[i]);
      maxChange = Math.max(maxChange, 1 - change); // Convert similarity to distance
    }

    return maxChange;
  }

  /**
   * Analyze and save a cluster
   */
  private async analyzeAndSaveCluster(
    dataPoints: DataPoint[],
    clusterIndex: number,
    startDate: Date,
    endDate: Date,
  ): Promise<SemanticClusterDocument> {
    const clusterId = `cluster_${Date.now()}_${clusterIndex}`;
    const centroid = this.calculateCentroid(dataPoints.map((p) => p.embedding));
    const centroidDimensions = centroid.length;

    // Generate semantic description
    const semanticDescription =
      await this.generateClusterDescription(dataPoints);

    // Extract keywords
    const keywords = this.extractKeywords(dataPoints);

    // Determine category
    const category = this.determineCategory(keywords);

    // Cost analysis with real cache stats from Usage
    const cacheStats = await this.getCacheStatsForWindow(startDate, endDate, [
      ...new Set(dataPoints.map((p) => p.userId).filter(Boolean)),
    ]);
    const costAnalysis = this.calculateCostAnalysis(dataPoints, cacheStats);

    // Performance analysis
    const performanceAnalysis = this.calculatePerformanceAnalysis(dataPoints);

    // Usage pattern
    const usagePattern = this.calculateUsagePattern(dataPoints);

    // Optimization recommendations
    const optimization = this.generateOptimizationRecommendations(
      costAnalysis,
      performanceAnalysis,
      usagePattern,
    );

    // Create examples
    const examples = dataPoints
      .slice(0, SemanticPatternAnalyzerService.MAX_EXAMPLES_PER_CLUSTER)
      .map((point) => ({
        telemetryId: point.source === 'telemetry' ? point.id : undefined,
        usageId: point.source === 'usage' ? point.id : undefined,
        content: point.content.substring(0, 1000),
        embedding: point.embedding,
        similarity: this.cosineSimilarity(point.embedding, centroid),
        cost: point.cost,
        latency: point.latency,
        timestamp: point.timestamp,
      }));

    const cluster = new this.semanticClusterModel({
      clusterId,
      clusterName: `Cluster ${clusterIndex + 1}`,
      centroid,
      centroidDimensions,
      size: dataPoints.length,
      density: this.calculateDensity(dataPoints, centroid),
      examples,
      semanticDescription,
      keywords,
      category,
      costAnalysis,
      performanceAnalysis,
      usagePattern,
      optimization,
      dataStartDate: startDate,
      dataEndDate: endDate,
      clusteringAlgorithm: 'k-means',
      clusteringConfidence: 0.8,
      lastAnalyzedAt: new Date(),
      nextScheduledAnalysis: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
    });

    await cluster.save();

    this.logger.log(`✅ Saved cluster ${clusterId}`, {
      size: dataPoints.length,
      category,
      costSavings: optimization.totalEstimatedSavings,
    });

    return cluster;
  }

  /**
   * Generate semantic description for cluster
   */
  private async generateClusterDescription(
    dataPoints: DataPoint[],
  ): Promise<string> {
    // Simple keyword-based description generation
    const keywords = this.extractKeywords(dataPoints);
    const topKeywords = keywords.slice(0, 5);

    if (topKeywords.length === 0) {
      return 'Mixed usage patterns with similar semantic characteristics';
    }

    return `Requests involving ${topKeywords.join(', ')} with similar semantic patterns`;
  }

  /**
   * Extract keywords from data points
   */
  private extractKeywords(dataPoints: DataPoint[]): string[] {
    const keywordMap = new Map<string, number>();

    for (const point of dataPoints) {
      const words = point.content
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .slice(0, 10); // Limit words per request

      for (const word of words) {
        keywordMap.set(word, (keywordMap.get(word) || 0) + 1);
      }
    }

    // Return top keywords by frequency
    return Array.from(keywordMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword]) => keyword);
  }

  /**
   * Determine category from keywords
   */
  private determineCategory(keywords: string[]): string {
    const categories: Record<string, string[]> = {
      code: [
        'code',
        'programming',
        'function',
        'script',
        'api',
        'database',
        'query',
      ],
      chat: ['conversation', 'talk', 'discuss', 'question', 'answer', 'help'],
      analysis: [
        'analyze',
        'review',
        'evaluate',
        'assess',
        'study',
        'research',
      ],
      writing: ['write', 'create', 'generate', 'compose', 'draft', 'article'],
      translation: ['translate', 'language', 'convert', 'interpret'],
      summarization: [
        'summarize',
        'summary',
        'overview',
        'condense',
        'abstract',
      ],
    };

    for (const [category, categoryKeywords] of Object.entries(categories)) {
      const matches = keywords.filter((k) =>
        categoryKeywords.some((ck) => k.includes(ck)),
      ).length;

      if (matches >= 2) {
        return category;
      }
    }

    return 'general';
  }

  /**
   * Aggregate cache hit/miss and savings from Usage for a time window.
   */
  private async getCacheStatsForWindow(
    startDate: Date,
    endDate: Date,
    userIds: string[],
  ): Promise<{ cacheHitRate: number; cacheCosts: number }> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (userIds.length > 0) {
      match.userId = {
        $in: userIds
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      };
    }

    const result = await this.usageModel
      .aggregate<{
        totalHits: number;
        totalMisses: number;
        totalSavings: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: null,
            totalHits: {
              $sum: {
                $add: [
                  { $ifNull: ['$promptCaching.cacheHits', 0] },
                  { $ifNull: ['$metadata.cacheHits', 0] },
                ],
              },
            },
            totalMisses: {
              $sum: {
                $add: [
                  { $ifNull: ['$promptCaching.cacheMisses', 0] },
                  { $ifNull: ['$metadata.cacheMisses', 0] },
                ],
              },
            },
            totalSavings: {
              $sum: { $ifNull: ['$promptCaching.savingsFromCaching', 0] },
            },
          },
        },
      ])
      .exec();

    if (!result.length) {
      return { cacheHitRate: 0, cacheCosts: 0 };
    }

    const r = result[0];
    const total = r.totalHits + r.totalMisses;
    const cacheHitRate = total > 0 ? r.totalHits / total : 0;
    const cacheCosts = r.totalSavings > 0 ? r.totalSavings : 0;

    return { cacheHitRate, cacheCosts };
  }

  /**
   * Calculate cost analysis
   */
  private calculateCostAnalysis(
    dataPoints: DataPoint[],
    cacheStats?: { cacheHitRate: number; cacheCosts: number },
  ): IClusterCostAnalysis {
    const costs = dataPoints.map((p) => p.cost);
    const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
    const avgCostPerRequest = totalCost / dataPoints.length;

    const sortedCosts = [...costs].sort((a, b) => a - b);
    const medianCost = sortedCosts[Math.floor(sortedCosts.length / 2)];
    const p90Cost = sortedCosts[Math.floor(sortedCosts.length * 0.9)];

    // Group by model for model costs
    const modelCostMap = new Map<string, number>();
    for (const point of dataPoints) {
      modelCostMap.set(
        point.model,
        (modelCostMap.get(point.model) || 0) + point.cost,
      );
    }

    const modelCosts = Array.from(modelCostMap.values()).reduce(
      (sum, cost) => sum + cost,
      0,
    );

    const cacheHitRate = cacheStats?.cacheHitRate ?? 0;
    const cacheCosts = cacheStats?.cacheCosts ?? 0;

    const potentialSavingsWithCache =
      cacheCosts > 0 ? cacheCosts : totalCost * (1 - cacheHitRate) * 0.1; // 10% savings with better caching when no cache data
    const potentialSavingsWithCheaperModel = Math.max(
      0,
      totalCost - totalCost * 0.7,
    ); // Assume 30% savings possible

    // Compare to global average (simplified)
    const costVsGlobalAvg = avgCostPerRequest - 0.01; // Assume global avg is $0.01
    const isHighCost = costVsGlobalAvg > 0;

    return {
      totalCost,
      avgCostPerRequest,
      medianCost,
      p90Cost,
      modelCosts,
      cacheCosts,
      cacheHitRate,
      potentialSavingsWithCache,
      potentialSavingsWithCheaperModel,
      costVsGlobalAvg,
      isHighCost,
    };
  }

  /**
   * Calculate performance analysis
   */
  private calculatePerformanceAnalysis(
    dataPoints: DataPoint[],
  ): IClusterPerformanceAnalysis {
    const latencies = dataPoints.map((p) => p.latency).filter((l) => l > 0);
    const avgLatency =
      latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const p50Latency =
      sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
    const p90Latency =
      sortedLatencies[Math.floor(sortedLatencies.length * 0.9)];
    const p95Latency =
      sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];

    const tokens = dataPoints.map((p) => p.tokens);
    const avgTokens = tokens.reduce((sum, t) => sum + t, 0) / tokens.length;
    const avgInputTokens =
      dataPoints.reduce((sum, p) => sum + p.inputTokens, 0) / dataPoints.length;
    const avgOutputTokens =
      dataPoints.reduce((sum, p) => sum + p.outputTokens, 0) /
      dataPoints.length;

    const successRate =
      dataPoints.filter((p) => p.success).length / dataPoints.length;
    const errorRate = 1 - successRate;

    // Group by model for top models
    const modelMap = new Map<
      string,
      { frequency: number; totalCost: number; totalLatency: number }
    >();
    for (const point of dataPoints) {
      const existing = modelMap.get(point.model) || {
        frequency: 0,
        totalCost: 0,
        totalLatency: 0,
      };
      existing.frequency++;
      existing.totalCost += point.cost;
      existing.totalLatency += point.latency;
      modelMap.set(point.model, existing);
    }

    const topModels = Array.from(modelMap.entries())
      .sort((a, b) => b[1].frequency - a[1].frequency)
      .slice(0, 5)
      .map(([modelId, data]) => ({
        modelId,
        frequency: data.frequency,
        avgCost: data.totalCost / data.frequency,
        avgLatency: data.totalLatency / data.frequency,
      }));

    return {
      avgLatency: avgLatency || 0,
      p50Latency: p50Latency || 0,
      p90Latency: p90Latency || 0,
      p95Latency: p95Latency || 0,
      avgTokens: avgTokens || 0,
      avgInputTokens,
      avgOutputTokens,
      successRate,
      errorRate,
      topModels,
    };
  }

  /**
   * Calculate usage pattern
   */
  private calculateUsagePattern(dataPoints: DataPoint[]): IClusterUsagePattern {
    const timestamps = dataPoints.map((p) => p.timestamp);
    const hours = timestamps.map((t) => t.getHours());
    const days = timestamps.map((t) => t.getDay());

    // Calculate peak hours (simplified)
    const hourCounts = new Array(24).fill(0);
    for (const hour of hours) {
      hourCounts[hour]++;
    }
    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((h) => h.hour);

    // Calculate peak days
    const dayCounts = new Array(7).fill(0);
    for (const day of days) {
      dayCounts[day]++;
    }
    const peakDays = dayCounts
      .map((count, day) => ({ day, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((d) => d.day);

    const requestsPerDay =
      dataPoints.length / Math.max(1, this.daysBetween(dataPoints));
    const uniqueUsers = new Set(dataPoints.map((p) => p.userId)).size;
    const requestsPerUser = dataPoints.length / uniqueUsers;

    // Top users
    const userMap = new Map<string, { count: number; totalCost: number }>();
    for (const point of dataPoints) {
      const existing = userMap.get(point.userId) || { count: 0, totalCost: 0 };
      existing.count++;
      existing.totalCost += point.cost;
      userMap.set(point.userId, existing);
    }

    const topUsers = Array.from(userMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([userId, data]) => ({
        userId,
        requestCount: data.count,
        totalCost: data.totalCost,
      }));

    // Calculate growth rate (simplified)
    const sortedPoints = dataPoints.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    const firstHalf = sortedPoints.slice(
      0,
      Math.floor(sortedPoints.length / 2),
    );
    const secondHalf = sortedPoints.slice(Math.floor(sortedPoints.length / 2));

    const firstHalfRequests = firstHalf.length;
    const secondHalfRequests = secondHalf.length;
    const growthRate =
      firstHalfRequests > 0
        ? (secondHalfRequests - firstHalfRequests) / firstHalfRequests
        : 0;
    const isGrowing = growthRate > 0.1; // 10% growth

    return {
      peakHours,
      peakDays,
      requestsPerDay,
      requestsPerUser,
      uniqueUsers,
      topUsers,
      growthRate,
      isGrowing,
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateOptimizationRecommendations(
    costAnalysis: IClusterCostAnalysis,
    performanceAnalysis: IClusterPerformanceAnalysis,
    usagePattern: IClusterUsagePattern,
  ): any {
    const recommendations: IOptimizationRecommendation[] = [];
    let totalEstimatedSavings = 0;

    // Model switch recommendation
    if (
      costAnalysis.isHighCost &&
      costAnalysis.potentialSavingsWithCheaperModel > 0.01
    ) {
      recommendations.push({
        type: 'model_switch',
        description: `Switch to more cost-effective models to save $${costAnalysis.potentialSavingsWithCheaperModel.toFixed(2)} per month`,
        estimatedSavings: costAnalysis.potentialSavingsWithCheaperModel,
        estimatedSavingsPercentage:
          (costAnalysis.potentialSavingsWithCheaperModel /
            costAnalysis.totalCost) *
          100,
        implementationEffort: 'medium',
        confidence: 0.8,
      });
      totalEstimatedSavings += costAnalysis.potentialSavingsWithCheaperModel;
    }

    // Caching recommendation
    if (costAnalysis.potentialSavingsWithCache > 0.01) {
      recommendations.push({
        type: 'enable_cache',
        description: `Implement intelligent caching to reduce redundant requests and save $${costAnalysis.potentialSavingsWithCache.toFixed(2)}`,
        estimatedSavings: costAnalysis.potentialSavingsWithCache,
        estimatedSavingsPercentage:
          (costAnalysis.potentialSavingsWithCache / costAnalysis.totalCost) *
          100,
        implementationEffort: 'low',
        confidence: 0.7,
      });
      totalEstimatedSavings += costAnalysis.potentialSavingsWithCache;
    }

    // Rate limiting recommendation
    if (usagePattern.requestsPerUser > 100) {
      const potentialSavings = costAnalysis.totalCost * 0.05; // Assume 5% savings
      recommendations.push({
        type: 'rate_limiting',
        description:
          'Implement user-level rate limiting to prevent excessive usage',
        estimatedSavings: potentialSavings,
        estimatedSavingsPercentage: 5,
        implementationEffort: 'low',
        confidence: 0.6,
      });
      totalEstimatedSavings += potentialSavings;
    }

    // Performance recommendation: suggest batching or parallelization if average latency is high
    if (
      performanceAnalysis.avgLatency &&
      performanceAnalysis.avgLatency > 1500
    ) {
      const potentialSavings = costAnalysis.totalCost * 0.03; // Assume 3% savings for better batching/optimization
      recommendations.push({
        type: 'model_switch',
        description: `High average latency (${performanceAnalysis.avgLatency}ms) detected. Recommend batching requests or further optimizing infrastructure.`,
        estimatedSavings: potentialSavings,
        estimatedSavingsPercentage: 3,
        implementationEffort: 'medium',
        confidence: 0.6,
      });
      totalEstimatedSavings += potentialSavings;
    }

    // Performance recommendation: if p95 latency is high, suggest deeper infra review
    if (
      performanceAnalysis.p95Latency &&
      performanceAnalysis.p95Latency > 2500
    ) {
      recommendations.push({
        type: 'model_switch',
        description: `p95 latency (${performanceAnalysis.p95Latency}ms) is high. Investigate outliers, slow dependencies, or network issues.`,
        estimatedSavings: 0, // Investigation, no direct savings
        estimatedSavingsPercentage: 0,
        implementationEffort: 'medium',
        confidence: 0.5,
      });
    }

    // Determine priority
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (totalEstimatedSavings > 10) priority = 'high';
    if (totalEstimatedSavings > 50) priority = 'critical';

    return {
      priority,
      recommendations,
      totalEstimatedSavings,
      totalEstimatedSavingsPercentage:
        costAnalysis.totalCost > 0
          ? (totalEstimatedSavings / costAnalysis.totalCost) * 100
          : 0,
    };
  }

  /**
   * Calculate cluster density
   */
  private calculateDensity(
    dataPoints: DataPoint[],
    centroid: number[],
  ): number {
    if (dataPoints.length === 0) return 0;

    const similarities = dataPoints.map((point) =>
      this.cosineSimilarity(point.embedding, centroid),
    );

    const avgSimilarity =
      similarities.reduce((sum, s) => sum + s, 0) / similarities.length;
    return avgSimilarity;
  }

  /**
   * Calculate days between first and last data point
   */
  private daysBetween(dataPoints: DataPoint[]): number {
    if (dataPoints.length === 0) return 0;

    const timestamps = dataPoints
      .map((p) => p.timestamp.getTime())
      .sort((a, b) => a - b);
    const earliest = timestamps[0];
    const latest = timestamps[timestamps.length - 1];

    return (latest - earliest) / (1000 * 60 * 60 * 24);
  }

  /**
   * Get high-cost clusters
   */
  async getHighCostClusters(
    limit: number = 10,
  ): Promise<SemanticClusterDocument[]> {
    try {
      const clusters = await this.semanticClusterModel
        .find({
          'costAnalysis.isHighCost': true,
          isActive: true,
        })
        .sort({ 'costAnalysis.totalCost': -1 })
        .limit(limit)
        .lean();

      return clusters as unknown as SemanticClusterDocument[];
    } catch (error) {
      this.logger.error('Failed to get high-cost clusters', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get clusters with high optimization potential
   */
  async getClustersWithHighOptimizationPotential(
    limit: number = 10,
  ): Promise<SemanticClusterDocument[]> {
    try {
      const clusters = await this.semanticClusterModel
        .find({
          'optimization.totalEstimatedSavings': { $gt: 5 }, // At least $5 savings
          isActive: true,
        })
        .sort({ 'optimization.totalEstimatedSavings': -1 })
        .limit(limit)
        .lean();

      return clusters as unknown as SemanticClusterDocument[];
    } catch (error) {
      this.logger.error('Failed to get clusters with optimization potential', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get all semantic clusters
   */
  async getAllClusters(): Promise<SemanticClusterDocument[]> {
    try {
      const clusters = await this.semanticClusterModel
        .find({ isActive: true })
        .sort({ 'costAnalysis.totalCost': -1 })
        .limit(50)
        .lean();

      return clusters as unknown as SemanticClusterDocument[];
    } catch (error) {
      this.logger.error('Failed to get semantic clusters', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
