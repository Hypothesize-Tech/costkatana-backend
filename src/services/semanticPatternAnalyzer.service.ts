import {
  SemanticCluster,
  ISemanticCluster,
  ClusterExample,
  ClusterCostAnalysis,
  ClusterPerformanceAnalysis,
  ClusterUsagePattern,
  ClusterOptimization
} from '../models/SemanticCluster';
import { Telemetry } from '../models/Telemetry';
import { loggingService } from './logging.service';

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
export class SemanticPatternAnalyzerService {
  private static readonly DEFAULT_NUM_CLUSTERS = 20;
  private static readonly MIN_CLUSTER_SIZE = 10;
  private static readonly SIMILARITY_THRESHOLD = 0.75;
  private static readonly MAX_EXAMPLES_PER_CLUSTER = 10;

  /**
   * Run clustering analysis on telemetry/usage data
   */
  static async runClusteringAnalysis(params: {
    startDate: Date;
    endDate: Date;
    userId?: string;
    tenantId?: string;
    numClusters?: number;
  }): Promise<ISemanticCluster[]> {
    try {
      loggingService.info('🔍 Starting semantic clustering analysis...', {
        startDate: params.startDate.toISOString(),
        endDate: params.endDate.toISOString()
      });

      // 1. Collect data points with embeddings
      const dataPoints = await this.collectDataPoints(params);

      if (dataPoints.length < this.MIN_CLUSTER_SIZE) {
        loggingService.warn('Insufficient data for clustering', {
          dataPoints: dataPoints.length,
          minRequired: this.MIN_CLUSTER_SIZE
        });
        return [];
      }

      loggingService.info(`Collected ${dataPoints.length} data points for clustering`);

      // 2. Perform K-means clustering
      const numClusters = Math.min(
        params.numClusters ?? this.DEFAULT_NUM_CLUSTERS,
        Math.floor(dataPoints.length / this.MIN_CLUSTER_SIZE)
      );

      const clusters = this.performKMeansClustering(dataPoints, numClusters);

      loggingService.info(`Created ${clusters.length} clusters`);

      // 3. Analyze each cluster and save
      const savedClusters: ISemanticCluster[] = [];

      for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].length < this.MIN_CLUSTER_SIZE) continue;

        try {
          const cluster = await this.analyzeAndSaveCluster(
            clusters[i],
            i,
            params.startDate,
            params.endDate
          );
          savedClusters.push(cluster);
        } catch (error) {
          loggingService.warn(`Failed to analyze cluster ${i}`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      loggingService.info('✅ Completed semantic clustering analysis', {
        clustersCreated: savedClusters.length,
        totalDataPoints: dataPoints.length
      });

      return savedClusters;
    } catch (error) {
      loggingService.error('❌ Clustering analysis failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Collect data points with embeddings
   */
  private static async collectDataPoints(params: {
    startDate: Date;
    endDate: Date;
    userId?: string;
    tenantId?: string;
  }): Promise<DataPoint[]> {
    const dataPoints: DataPoint[] = [];

    // Query telemetry data with embeddings
    const telemetryQuery: Record<string, unknown> = {
      timestamp: { $gte: params.startDate, $lte: params.endDate },
      semantic_embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
    };

    if (params.tenantId) telemetryQuery.tenant_id = params.tenantId;
    if (params.userId) telemetryQuery.user_id = params.userId;

    const telemetryData = await Telemetry.find(telemetryQuery)
      .select('semantic_embedding semantic_content cost_usd duration_ms timestamp user_id gen_ai_model prompt_tokens completion_tokens total_tokens status')
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
        source: 'telemetry'
      });
    }

    loggingService.info(`Collected ${dataPoints.length} data points from telemetry`);

    return dataPoints;
  }

  /**
   * Perform K-means clustering on embeddings
   */
  private static performKMeansClustering(
    dataPoints: DataPoint[],
    numClusters: number
  ): DataPoint[][] {
    if (dataPoints.length === 0) return [];

    const embeddingDim = dataPoints[0].embedding.length; // Now used for centroid padding
    const maxIterations = 50;
    const convergenceThreshold = 0.001;

    // Initialize centroids using k-means++
    let centroids: number[][] = this.initializeCentroidsKMeansPlusPlus(dataPoints, numClusters);

    // Ensure all initial centroids are the correct dimension
    centroids = centroids.map((centroid): number[] => {
      return centroid.length === embeddingDim
        ? centroid
        : [...centroid, ...Array(embeddingDim - centroid.length).fill(0) as number[]];
    });

    // K-means iterations
    let prevCentroids: number[][] = [];
    let iteration = 0;

    while (iteration < maxIterations) {
      // Assign points to nearest centroid
      const clusters: DataPoint[][] = Array.from({ length: numClusters }, () => []);

      for (const point of dataPoints) {
        const embedding: number[] =
          point.embedding.length === embeddingDim
            ? point.embedding
            : [...point.embedding, ...Array(embeddingDim - point.embedding.length).fill(0) as number[]];
        const nearestCentroidIdx = this.findNearestCentroid(embedding, centroids);
        clusters[nearestCentroidIdx].push(point);
      }

      // Update centroids
      prevCentroids = centroids;
      centroids = clusters.map((cluster): number[] => {
        if (cluster.length === 0) {
          // If cluster is empty, reinitialize with random point and pad if necessary
          const rand = dataPoints[Math.floor(Math.random() * dataPoints.length)].embedding;
          return rand.length === embeddingDim
            ? rand
            : [...rand, ...Array(embeddingDim - rand.length).fill(0) as number[]];
        }
        // Calculate cluster centroid and ensure correct dimension
        const centroid = this.calculateCentroid(cluster.map((p): number[] => {
          return p.embedding.length === embeddingDim
            ? p.embedding
            : [...p.embedding, ...Array(embeddingDim - p.embedding.length).fill(0) as number[]];
        }));
        return centroid.length === embeddingDim
          ? centroid
          : [...centroid, ...Array(embeddingDim - centroid.length).fill(0) as number[]];
      });

      // Check convergence
      const maxChange = this.maxCentroidChange(prevCentroids, centroids);
      if (maxChange < convergenceThreshold) {
        loggingService.info(`K-means converged after ${iteration + 1} iterations`);
        break;
      }

      iteration++;
    }

    // Final assignment
    const finalClusters: DataPoint[][] = Array.from({ length: numClusters }, () => []);
    for (const point of dataPoints) {
      const embedding: number[] =
        point.embedding.length === embeddingDim
          ? point.embedding
          : [...point.embedding, ...Array(embeddingDim - point.embedding.length).fill(0) as number[]];
      const nearestCentroidIdx = this.findNearestCentroid(embedding, centroids);
      finalClusters[nearestCentroidIdx].push(point);
    }

    // Filter out empty or small clusters
    return finalClusters.filter(cluster => cluster.length >= this.MIN_CLUSTER_SIZE);
  }

  /**
   * Initialize centroids using k-means++ algorithm
   */
  private static initializeCentroidsKMeansPlusPlus(
    dataPoints: DataPoint[],
    numClusters: number
  ): number[][] {
    const centroids: number[][] = [];

    // First centroid: random point
    const firstIdx = Math.floor(Math.random() * dataPoints.length);
    centroids.push([...dataPoints[firstIdx].embedding]);

    // Subsequent centroids: weighted by distance to nearest existing centroid
    for (let i = 1; i < numClusters; i++) {
      const distances = dataPoints.map(point => {
        const nearestCentroidIdx = this.findNearestCentroid(point.embedding, centroids);
        return this.cosineSimilarity(point.embedding, centroids[nearestCentroidIdx]);
      });

      // Convert similarity to distance (1 - similarity)
      const distancesFromNearest = distances.map(d => 1 - d);
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
  private static findNearestCentroid(embedding: number[], centroids: number[][]): number {
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
   * Calculate centroid of a set of embeddings
   */
  private static calculateCentroid(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];

    const firstEmbedding = embeddings[0];
    if (!firstEmbedding) return [];
    const dim = firstEmbedding.length;
    const centroid: number[] = new Array(dim).fill(0) as number[];

    for (const embedding of embeddings) {
      for (let i = 0; i < dim; i++) {
        const val = embedding[i];
        if (val !== undefined) {
          centroid[i] = (centroid[i] ?? 0) + val;
        }
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] = (centroid[i] ?? 0) / embeddings.length;
    }
    
    // Normalize
    const magnitude = Math.sqrt(centroid.reduce((sum: number, val: number) => {
      return sum + val * val;
    }, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dim; i++) {
        centroid[i] = (centroid[i] ?? 0) / magnitude;
      }
    }

    return centroid;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Calculate maximum change in centroids
   */
  private static maxCentroidChange(prev: number[][], curr: number[][]): number {
    let maxChange = 0;

    for (let i = 0; i < prev.length; i++) {
      let sumSquaredDiff = 0;
      for (let j = 0; j < prev[i].length; j++) {
        const diff = prev[i][j] - curr[i][j];
        sumSquaredDiff += diff * diff;
      }
      const change = Math.sqrt(sumSquaredDiff);
      maxChange = Math.max(maxChange, change);
    }

    return maxChange;
  }

  /**
   * Analyze and save a cluster
   */
  private static async analyzeAndSaveCluster(
    clusterData: DataPoint[],
    clusterIndex: number,
    startDate: Date,
    endDate: Date
  ): Promise<ISemanticCluster> {
    // Calculate centroid
    const centroid = this.calculateCentroid(clusterData.map(p => p.embedding));

    // Select representative examples
    const examples = this.selectRepresentativeExamples(clusterData, centroid);

    // Analyze cost
    const costAnalysis = this.analyzeCost(clusterData);

    // Analyze performance
    const performanceAnalysis = this.analyzePerformance(clusterData);

    // Analyze usage patterns
    const usagePattern = this.analyzeUsagePattern(clusterData, startDate, endDate);

    // Generate optimization recommendations
    const optimization = this.generateOptimizationRecommendations(
      clusterData,
      costAnalysis,
      performanceAnalysis
    );

    // Generate semantic description (simplified - in production use AI)
    const semanticDescription = this.generateSemanticDescription(examples);

    // Extract keywords
    const keywords = this.extractKeywords(examples);

    // Categorize
    const category = this.categorizeCluster(keywords, semanticDescription);

    // Calculate density
    const density = this.calculateClusterDensity(clusterData, centroid);

    const clusterId = `cluster_${Date.now()}_${clusterIndex}`;
    const clusterName = `Cluster ${clusterIndex + 1}: ${category}`;

    const cluster = new SemanticCluster({
      clusterId,
      clusterName,
      centroid,
      centroidDimensions: centroid.length,
      size: clusterData.length,
      density,
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
      clusteringAlgorithm: 'kmeans',
      clusteringConfidence: Math.min(1, density * 0.8 + (clusterData.length / 100) * 0.2),
      lastAnalyzedAt: new Date(),
      nextScheduledAnalysis: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      isActive: true
    });

    await cluster.save();

    loggingService.info(`✅ Created cluster: ${clusterName}`, {
      size: clusterData.length,
      totalCost: costAnalysis.totalCost.toFixed(4),
      potentialSavings: optimization.totalEstimatedSavings.toFixed(4)
    });

    return cluster;
  }

  /**
   * Select representative examples from cluster
   */
  private static selectRepresentativeExamples(
    clusterData: DataPoint[],
    centroid: number[]
  ): ClusterExample[] {
    // Sort by similarity to centroid
    const sorted = clusterData
      .map(point => ({
        point,
        similarity: this.cosineSimilarity(point.embedding, centroid)
      }))
      .sort((a, b) => b.similarity - a.similarity);

    // Take top N most representative examples
    return sorted
      .slice(0, this.MAX_EXAMPLES_PER_CLUSTER)
      .map(({ point, similarity }) => ({
        telemetryId: point.source === 'telemetry' ? point.id : undefined,
        usageId: point.source === 'usage' ? point.id : undefined,
        content: point.content.substring(0, 1000),
        embedding: point.embedding,
        similarity,
        cost: point.cost,
        latency: point.latency,
        timestamp: point.timestamp
      }));
  }

  /**
   * Analyze cost for cluster
   */
  private static analyzeCost(clusterData: DataPoint[]): ClusterCostAnalysis {
    const costs = clusterData.map(p => p.cost).sort((a, b) => a - b);
    const totalCost = costs.reduce((sum, c) => sum + c, 0);
    const avgCostPerRequest = totalCost / clusterData.length;
    const medianCost = costs[Math.floor(costs.length / 2)];
    const p90Cost = costs[Math.floor(costs.length * 0.9)];

    // Estimate model vs cache costs (simplified)
    const modelCosts = totalCost * 0.95;
    const cacheCosts = totalCost * 0.05;

    // Estimate cache hit rate (simplified - would need actual cache data)
    const cacheHitRate = 0.1;

    // Potential savings
    const potentialSavingsWithCache = totalCost * (1 - cacheHitRate) * 0.8;
    const potentialSavingsWithCheaperModel = totalCost * 0.3; // Assume 30% savings

    // Compare to global average (simplified)
    const globalAvg = 0.002; // $0.002 per request
    const costVsGlobalAvg = ((avgCostPerRequest - globalAvg) / globalAvg) * 100;

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
      isHighCost: avgCostPerRequest > globalAvg * 2
    };
  }

  /**
   * Analyze performance for cluster
   */
  private static analyzePerformance(clusterData: DataPoint[]): ClusterPerformanceAnalysis {
    const latencies = clusterData.map(p => p.latency).sort((a, b) => a - b);
    const avgLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
    const p50Latency = latencies[Math.floor(latencies.length * 0.5)];
    const p90Latency = latencies[Math.floor(latencies.length * 0.9)];
    const p95Latency = latencies[Math.floor(latencies.length * 0.95)];

    const avgTokens = clusterData.reduce((sum, p) => sum + p.tokens, 0) / clusterData.length;
    const avgInputTokens = clusterData.reduce((sum, p) => sum + p.inputTokens, 0) / clusterData.length;
    const avgOutputTokens = clusterData.reduce((sum, p) => sum + p.outputTokens, 0) / clusterData.length;

    const successful = clusterData.filter(p => p.success).length;
    const successRate = successful / clusterData.length;
    const errorRate = 1 - successRate;

    // Top models
    const modelStats = new Map<string, { count: number; totalCost: number; totalLatency: number }>();
    for (const point of clusterData) {
      if (!modelStats.has(point.model)) {
        modelStats.set(point.model, { count: 0, totalCost: 0, totalLatency: 0 });
      }
      const stats = modelStats.get(point.model);
      if (stats) {
        stats.count++;
        stats.totalCost += point.cost;
        stats.totalLatency += point.latency;
      }
    }

    const topModels = Array.from(modelStats.entries())
      .map(([modelId, stats]) => ({
        modelId,
        frequency: stats.count,
        avgCost: stats.totalCost / stats.count,
        avgLatency: stats.totalLatency / stats.count
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    return {
      avgLatency,
      p50Latency,
      p90Latency,
      p95Latency,
      avgTokens,
      avgInputTokens,
      avgOutputTokens,
      successRate,
      errorRate,
      topModels
    };
  }

  /**
   * Analyze usage patterns for cluster
   */
  private static analyzeUsagePattern(
    clusterData: DataPoint[],
    startDate: Date,
    endDate: Date
  ): ClusterUsagePattern {
    // Temporal patterns
    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0);

    for (const point of clusterData) {
      const hour = point.timestamp.getHours();
      const day = point.timestamp.getDay();
      hourCounts[hour]++;
      dayCounts[day]++;
    }

    const peakHours = hourCounts
      .map((count: number, hour: number) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((h: { hour: number; count: number }) => h.hour);

    const peakDays = dayCounts
      .map((count: number, day: number) => ({ day, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map((d: { day: number; count: number }) => d.day);

    // User distribution
    const userStats = new Map<string, { requestCount: number; totalCost: number }>();
    for (const point of clusterData) {
      if (!userStats.has(point.userId)) {
        userStats.set(point.userId, { requestCount: 0, totalCost: 0 });
      }
      const stats = userStats.get(point.userId);
      if (stats) {
        stats.requestCount++;
        stats.totalCost += point.cost;
      }
    }

    const topUsers = Array.from(userStats.entries())
      .map(([userId, stats]) => ({
        userId,
        requestCount: stats.requestCount,
        totalCost: stats.totalCost
      }))
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 10);

    const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const requestsPerDay = clusterData.length / Math.max(1, daysDiff);
    const requestsPerUser = clusterData.length / userStats.size;

    // Growth rate (simplified - would need historical data)
    const growthRate = 0; // Placeholder
    const isGrowing = growthRate > 5;

    return {
      peakHours,
      peakDays,
      requestsPerDay,
      requestsPerUser,
      uniqueUsers: userStats.size,
      topUsers,
      growthRate,
      isGrowing
    };
  }

  /**
   * Generate optimization recommendations for cluster
   */
  private static generateOptimizationRecommendations(
    clusterData: DataPoint[],
    costAnalysis: ClusterCostAnalysis,
    performanceAnalysis: ClusterPerformanceAnalysis
  ): ClusterOptimization {
    const recommendations: Array<{
      type: 'model_switch' | 'enable_cache' | 'prompt_optimization' | 'batch_processing' | 'rate_limiting';
      description: string;
      estimatedSavings: number;
      estimatedSavingsPercentage: number;
      implementationEffort: 'low' | 'medium' | 'high';
      confidence: number;
    }> = [];

    // Recommend caching if potential savings exist
    if (costAnalysis.potentialSavingsWithCache > 1.0) {
      recommendations.push({
        type: 'enable_cache',
        description: 'Enable semantic caching for this pattern to reduce redundant requests',
        estimatedSavings: costAnalysis.potentialSavingsWithCache,
        estimatedSavingsPercentage: (costAnalysis.potentialSavingsWithCache / costAnalysis.totalCost) * 100,
        implementationEffort: 'low',
        confidence: 0.8
      });
    }

    // Recommend cheaper model if cost is high
    if (costAnalysis.isHighCost && costAnalysis.potentialSavingsWithCheaperModel > 0.5) {
      recommendations.push({
        type: 'model_switch',
        description: `Switch to cheaper model for this use case (avg cost $${costAnalysis.avgCostPerRequest.toFixed(4)} per request)`,
        estimatedSavings: costAnalysis.potentialSavingsWithCheaperModel,
        estimatedSavingsPercentage: 30,
        implementationEffort: 'medium',
        confidence: 0.7
      });
    }

    // Recommend prompt optimization if tokens are high
    if (performanceAnalysis.avgInputTokens > 1000) {
      recommendations.push({
        type: 'prompt_optimization',
        description: 'Optimize prompts to reduce token usage (avg input: ${performanceAnalysis.avgInputTokens.toFixed(0)} tokens)',
        estimatedSavings: costAnalysis.totalCost * 0.2,
        estimatedSavingsPercentage: 20,
        implementationEffort: 'medium',
        confidence: 0.6
      });
    }

    // Recommend batch processing if requests are frequent
    if (clusterData.length > 100) {
      recommendations.push({
        type: 'batch_processing',
        description: 'Consider batch processing for this high-volume pattern',
        estimatedSavings: costAnalysis.totalCost * 0.15,
        estimatedSavingsPercentage: 15,
        implementationEffort: 'high',
        confidence: 0.5
      });
    }

    const totalEstimatedSavings = recommendations.reduce((sum: number, r) => sum + r.estimatedSavings, 0);
    const totalEstimatedSavingsPercentage = (totalEstimatedSavings / costAnalysis.totalCost) * 100;

    // Determine priority
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (totalEstimatedSavings > 10) priority = 'critical';
    else if (totalEstimatedSavings > 5) priority = 'high';
    else if (totalEstimatedSavings > 1) priority = 'medium';

    return {
      priority,
      recommendations,
      totalEstimatedSavings,
      totalEstimatedSavingsPercentage
    };
  }

  /**
   * Generate semantic description (simplified)
   */
  private static generateSemanticDescription(examples: ClusterExample[]): string {
    // In production, this would use AI to generate a description
    // For now, return a simple description
    const avgCost = examples.reduce((sum, e) => sum + e.cost, 0) / examples.length;
    const avgLatency = examples.reduce((sum, e) => sum + e.latency, 0) / examples.length;

    return `Cluster of ${examples.length}+ similar requests with avg cost $${avgCost.toFixed(4)} and avg latency ${avgLatency.toFixed(0)}ms`;
  }

  /**
   * Extract keywords from examples
   */
  private static extractKeywords(examples: ClusterExample[]): string[] {
    // Simple keyword extraction (in production use NLP)
    const words = new Map<string, number>();

    for (const example of examples) {
      const tokens = example.content.toLowerCase().split(/\W+/);
      for (const token of tokens) {
        if (token.length > 3) {
          words.set(token, (words.get(token) ?? 0) + 1);
        }
      }
    }

    return Array.from(words.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Categorize cluster based on keywords and description
   */
  private static categorizeCluster(keywords: string[], description: string): string {
    const text = (keywords.join(' ') + ' ' + description).toLowerCase();

    if (text.includes('code') || text.includes('function') || text.includes('script')) return 'code_generation';
    if (text.includes('summar') || text.includes('brief')) return 'summarization';
    if (text.includes('translate') || text.includes('language')) return 'translation';
    if (text.includes('analyze') || text.includes('analysis')) return 'analysis';
    if (text.includes('chat') || text.includes('conversation')) return 'chat';
    if (text.includes('create') || text.includes('generate') || text.includes('write')) return 'creative';

    return 'general';
  }

  /**
   * Calculate cluster density (how tightly grouped points are)
   */
  private static calculateClusterDensity(clusterData: DataPoint[], centroid: number[]): number {
    const similarities = clusterData.map(point => 
      this.cosineSimilarity(point.embedding, centroid)
    );

    const avgSimilarity = similarities.reduce((sum, s) => sum + s, 0) / similarities.length;
    return avgSimilarity;
  }

  /**
   * Get high-cost clusters
   */
  static async getHighCostClusters(limit: number = 10): Promise<ISemanticCluster[]> {
    try {
      const clusters = await SemanticCluster.find({
        isActive: true,
        'costAnalysis.isHighCost': true
      })
        .sort({ 'costAnalysis.totalCost': -1 })
        .limit(limit)
        .lean();
      return clusters as unknown as ISemanticCluster[];
    } catch (error) {
      loggingService.error('Failed to get high-cost clusters', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Get clusters with high optimization potential
   */
  static async getClustersWithHighOptimizationPotential(limit: number = 10): Promise<ISemanticCluster[]> {
    try {
      const clusters = await SemanticCluster.find({
        isActive: true
      })
        .sort({ 'optimization.totalEstimatedSavings': -1 })
        .limit(limit)
        .lean();
      return clusters as unknown as ISemanticCluster[];
    } catch (error) {
      loggingService.error('Failed to get clusters with high optimization potential', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find similar clusters to a given embedding
   */
  static async findSimilarClusters(
    embedding: number[],
    limit: number = 5
  ): Promise<Array<ISemanticCluster & { similarity: number }>> {
    try {
      const clusters = await SemanticCluster.find({ isActive: true }).lean();

      const withSimilarity = clusters.map((cluster) => {
        const clusterData = cluster as unknown as ISemanticCluster;
        return {
          ...clusterData,
          similarity: this.cosineSimilarity(embedding, clusterData.centroid)
        } as ISemanticCluster & { similarity: number };
      });

      return withSimilarity
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (error) {
      loggingService.error('Failed to find similar clusters', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
}

