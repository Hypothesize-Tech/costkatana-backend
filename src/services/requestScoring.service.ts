import { RequestScore, IRequestScore } from '../models/RequestScore';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';

export interface ScoreRequestData {
    requestId: string;
    score: number;
    notes?: string;
    trainingTags?: string[];
}

export interface ScoringAnalytics {
    totalScored: number;
    averageScore: number;
    scoreDistribution: Record<number, number>;
    trainingCandidates: number;
    topScoredRequests: Array<{
        requestId: string;
        score: number;
        tokenEfficiency: number;
        costEfficiency: number;
    }>;
}

export class RequestScoringService {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }
    /**
     * Score a request for training quality
     */
    static async scoreRequest(userId: string, scoreData: ScoreRequestData): Promise<IRequestScore> {
        try {
            // Get usage data to calculate efficiency metrics
            // Try to find by metadata.requestId first, then by _id as fallback
            let usageRecord = await Usage.findOne({ 
                'metadata.requestId': scoreData.requestId,
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!usageRecord) {
                // Fallback: try to find by _id if requestId looks like a MongoDB ObjectId
                if (mongoose.Types.ObjectId.isValid(scoreData.requestId)) {
                    usageRecord = await Usage.findOne({
                        _id: new mongoose.Types.ObjectId(scoreData.requestId),
                        userId: new mongoose.Types.ObjectId(userId)
                    });
                }
            }

            if (!usageRecord) {
                throw new Error('Usage record not found for this request');
            }

            // Calculate efficiency metrics
            const tokenEfficiency = usageRecord.totalTokens > 0 ? scoreData.score / usageRecord.totalTokens : 0;
            const costEfficiency = usageRecord.cost > 0 ? scoreData.score / usageRecord.cost : 0;

            // Create or update score
            const existingScore = await RequestScore.findOne({
                requestId: scoreData.requestId,
                userId: new mongoose.Types.ObjectId(userId)
            });

            let requestScore: IRequestScore;

            if (existingScore) {
                // Update existing score
                existingScore.score = scoreData.score;
                existingScore.notes = scoreData.notes;
                existingScore.trainingTags = scoreData.trainingTags || [];
                existingScore.tokenEfficiency = tokenEfficiency;
                existingScore.costEfficiency = costEfficiency;
                existingScore.isTrainingCandidate = scoreData.score >= 4;
                existingScore.scoredAt = new Date();
                
                requestScore = await existingScore.save();
            } else {
                // Create new score
                requestScore = new RequestScore({
                    requestId: scoreData.requestId,
                    userId: new mongoose.Types.ObjectId(userId),
                    score: scoreData.score,
                    notes: scoreData.notes,
                    trainingTags: scoreData.trainingTags || [],
                    tokenEfficiency,
                    costEfficiency,
                    isTrainingCandidate: scoreData.score >= 4,
                    scoredAt: new Date()
                });

                requestScore = await requestScore.save();
            }

            loggingService.info(`Request scored: ${scoreData.requestId} - Score: ${scoreData.score}`);
            return requestScore;

        } catch (error) {
            loggingService.error('Error scoring request:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get score for a specific request
     */
    static async getRequestScore(userId: string, requestId: string): Promise<IRequestScore | null> {
        try {
            return await RequestScore.findOne({
                requestId,
                userId: new mongoose.Types.ObjectId(userId)
            });
        } catch (error) {
            loggingService.error('Error getting request score:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get all scores for a user with filtering
     */
    static async getUserScores(
        userId: string,
        filters: {
            minScore?: number;
            maxScore?: number;
            isTrainingCandidate?: boolean;
            trainingTags?: string[];
            limit?: number;
            offset?: number;
        } = {}
    ): Promise<IRequestScore[]> {
        try {
            const query: any = {
                userId: new mongoose.Types.ObjectId(userId)
            };

            if (filters.minScore !== undefined) {
                query.score = { ...query.score, $gte: filters.minScore };
            }
            if (filters.maxScore !== undefined) {
                query.score = { ...query.score, $lte: filters.maxScore };
            }
            if (filters.isTrainingCandidate !== undefined) {
                query.isTrainingCandidate = filters.isTrainingCandidate;
            }
            if (filters.trainingTags && filters.trainingTags.length > 0) {
                query.trainingTags = { $in: filters.trainingTags };
            }

            let queryBuilder = RequestScore.find(query)
                .sort({ scoredAt: -1 });

            if (filters.limit) {
                queryBuilder = queryBuilder.limit(filters.limit);
            }
            if (filters.offset) {
                queryBuilder = queryBuilder.skip(filters.offset);
            }

            return await queryBuilder.exec();
        } catch (error) {
            loggingService.error('Error getting user scores:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get training candidates (high-scoring requests)
     */
    static async getTrainingCandidates(
        userId: string,
        filters: {
            minScore?: number;
            maxTokens?: number;
            maxCost?: number;
            providers?: string[];
            models?: string[];
            features?: string[];
            limit?: number;
        } = {}
    ): Promise<Array<{
        requestScore: IRequestScore;
        usageData: any;
    }>> {
        try {
            const minScore = filters.minScore || 4;
            
            // Get high-scoring requests
            const scores = await RequestScore.find({
                userId: new mongoose.Types.ObjectId(userId),
                score: { $gte: minScore },
                isTrainingCandidate: true
            }).sort({ score: -1, tokenEfficiency: -1 });

            // Get corresponding usage data
            const requestIds = scores.map(score => score.requestId);
            
            const usageQuery: any = {
                'metadata.requestId': { $in: requestIds },
                userId: new mongoose.Types.ObjectId(userId)
            };

            // Apply filters
            if (filters.maxTokens) {
                usageQuery.totalTokens = { $lte: filters.maxTokens };
            }
            if (filters.maxCost) {
                usageQuery.cost = { $lte: filters.maxCost };
            }
            if (filters.providers && filters.providers.length > 0) {
                usageQuery.service = { $in: filters.providers };
            }
            if (filters.models && filters.models.length > 0) {
                usageQuery.model = { $in: filters.models };
            }
            if (filters.features && filters.features.length > 0) {
                // Check custom properties
                const featureQueries = filters.features.map(feature => ({
                    [`metadata.CostKatana-Property-Feature`]: feature
                }));
                usageQuery.$or = featureQueries;
            }

            const usageRecords = await Usage.find(usageQuery).limit(filters.limit || 100);

            // Combine scores with usage data
            const candidates = usageRecords.map(usage => {
                const requestScore = scores.find(score => score.requestId === usage.metadata?.requestId);
                return {
                    requestScore: requestScore!,
                    usageData: usage
                };
            }).filter(candidate => candidate.requestScore);

            return candidates;
        } catch (error) {
            loggingService.error('Error getting training candidates:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get scoring analytics for a user (optimized with aggregation pipeline)
     */
    static async getScoringAnalytics(userId: string): Promise<ScoringAnalytics> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Use MongoDB aggregation pipeline for efficient analytics calculation
            const analyticsResults = await RequestScore.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $facet: {
                        // Basic statistics
                        basicStats: [
                            {
                                $group: {
                                    _id: null,
                                    totalScored: { $sum: 1 },
                                    averageScore: { $avg: '$score' },
                                    trainingCandidates: { $sum: { $cond: ['$isTrainingCandidate', 1, 0] } }
                                }
                            }
                        ],
                        // Score distribution
                        scoreDistribution: [
                            {
                                $group: {
                                    _id: '$score',
                                    count: { $sum: 1 }
                                }
                            }
                        ],
                        // Top scored requests
                        topScored: [
                            {
                                $match: {
                                    tokenEfficiency: { $exists: true, $ne: null },
                                    costEfficiency: { $exists: true, $ne: null }
                                }
                            },
                            {
                                $addFields: {
                                    combinedEfficiency: { $add: ['$tokenEfficiency', '$costEfficiency'] }
                                }
                            },
                            { $sort: { score: -1, combinedEfficiency: -1 } },
                            { $limit: 10 },
                            {
                                $project: {
                                    requestId: 1,
                                    score: 1,
                                    tokenEfficiency: 1,
                                    costEfficiency: 1,
                                    trainingTags: 1,
                                    notes: 1
                                }
                            }
                        ]
                    }
                }
            ]);

            const result = analyticsResults[0];
            const basicStats = result.basicStats[0] || { totalScored: 0, averageScore: 0, trainingCandidates: 0 };
            
            // Transform score distribution
            const scoreDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            result.scoreDistribution.forEach((item: any) => {
                scoreDistribution[item._id] = item.count;
            });

            // Get top scored requests with usage data enrichment (parallel processing)
            const topScoredRequests = [];
            if (result.topScored && result.topScored.length > 0) {
                const requestIds = result.topScored.map((score: any) => score.requestId);
                
                // Parallel query for usage data
                const [usageByRequestId, usageByObjectId] = await Promise.all([
                    Usage.find({
                        'metadata.requestId': { $in: requestIds },
                        userId: new mongoose.Types.ObjectId(userId)
                    }).lean(),
                    Usage.find({
                        _id: { $in: requestIds.filter((id: string) => mongoose.Types.ObjectId.isValid(id)).map((id: string) => new mongoose.Types.ObjectId(id)) },
                        userId: new mongoose.Types.ObjectId(userId)
                    }).lean()
                ]);

                // Create usage lookup map
                const usageLookup = new Map();
                usageByRequestId.forEach(usage => {
                    if (usage.metadata?.requestId) {
                        usageLookup.set(usage.metadata.requestId, usage);
                    }
                });
                usageByObjectId.forEach(usage => {
                    usageLookup.set(usage._id.toString(), usage);
                });

                // Enrich top scored requests
                for (const score of result.topScored) {
                    const usageRecord = usageLookup.get(score.requestId);
                    
                    if (usageRecord) {
                        const promptPreview = usageRecord.prompt?.length > 60 
                            ? usageRecord.prompt.substring(0, 60) + '...'
                            : usageRecord.prompt || 'Untitled Request';

                        topScoredRequests.push({
                            requestId: score.requestId,
                            title: promptPreview,
                            model: usageRecord.model,
                            provider: usageRecord.service,
                            score: score.score,
                            tokenEfficiency: score.tokenEfficiency || 0,
                            costEfficiency: score.costEfficiency || 0,
                            totalTokens: usageRecord.totalTokens,
                            cost: usageRecord.cost,
                            createdAt: usageRecord.createdAt,
                            trainingTags: score.trainingTags,
                            notes: score.notes
                        });
                    } else {
                        // Fallback with minimal info
                        topScoredRequests.push({
                            requestId: score.requestId,
                            title: `Request ${score.requestId.substring(0, 8)}...`,
                            model: 'Unknown',
                            provider: 'Unknown',
                            score: score.score,
                            tokenEfficiency: score.tokenEfficiency || 0,
                            costEfficiency: score.costEfficiency || 0,
                            trainingTags: score.trainingTags,
                            notes: score.notes
                        });
                    }
                }
            }

            // Reset failure count on success
            this.dbFailureCount = 0;

            return {
                totalScored: basicStats.totalScored,
                averageScore: basicStats.averageScore,
                scoreDistribution,
                trainingCandidates: basicStats.trainingCandidates,
                topScoredRequests
            };
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error getting scoring analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Bulk score requests (optimized with parallel processing)
     */
    static async bulkScoreRequests(
        userId: string,
        scores: ScoreRequestData[]
    ): Promise<IRequestScore[]> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Process in batches to avoid overwhelming the database
            const BATCH_SIZE = 10;
            const results: IRequestScore[] = [];

            for (let i = 0; i < scores.length; i += BATCH_SIZE) {
                const batch = scores.slice(i, i + BATCH_SIZE);
                
                // Process batch in parallel
                const batchPromises = batch.map(scoreData => this.scoreRequest(userId, scoreData));
                const batchResults = await Promise.all(batchPromises);
                
                results.push(...batchResults);
            }

            // Reset failure count on success
            this.dbFailureCount = 0;

            loggingService.info(`Bulk scored ${scores.length} requests for user ${userId}`);
            return results;
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error bulk scoring requests:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Delete a request score
     */
    static async deleteScore(userId: string, requestId: string): Promise<boolean> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const result = await RequestScore.deleteOne({
                requestId,
                userId: new mongoose.Types.ObjectId(userId)
            });

            // Reset failure count on success
            this.dbFailureCount = 0;

            return result.deletedCount > 0;
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error deleting request score:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
    }
}