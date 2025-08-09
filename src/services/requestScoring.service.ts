import { RequestScore, IRequestScore } from '../models/RequestScore';
import { Usage } from '../models/Usage';
import { logger } from '../utils/logger';
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

            logger.info(`Request scored: ${scoreData.requestId} - Score: ${scoreData.score}`);
            return requestScore;

        } catch (error) {
            logger.error('Error scoring request:', error);
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
            logger.error('Error getting request score:', error);
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
            logger.error('Error getting user scores:', error);
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
            logger.error('Error getting training candidates:', error);
            throw error;
        }
    }

    /**
     * Get scoring analytics for a user
     */
    static async getScoringAnalytics(userId: string): Promise<ScoringAnalytics> {
        try {
            const scores = await RequestScore.find({
                userId: new mongoose.Types.ObjectId(userId)
            });

            const totalScored = scores.length;
            const averageScore = totalScored > 0 
                ? scores.reduce((sum, score) => sum + score.score, 0) / totalScored 
                : 0;

            // Score distribution
            const scoreDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            scores.forEach(score => {
                scoreDistribution[score.score] = (scoreDistribution[score.score] || 0) + 1;
            });

            const trainingCandidates = scores.filter(score => score.isTrainingCandidate).length;

            // Top scored requests with meaningful information
            const topScored = scores
                .filter(score => score.tokenEfficiency && score.costEfficiency)
                .sort((a, b) => {
                    // Sort by score first, then by efficiency
                    if (a.score !== b.score) return b.score - a.score;
                    return (b.tokenEfficiency! + b.costEfficiency!) - (a.tokenEfficiency! + a.costEfficiency!);
                })
                .slice(0, 10);

            // Enrich with usage data to get meaningful titles/descriptions
            const topScoredRequests = [];
            for (const score of topScored) {
                try {
                    // Try to find usage record by metadata.requestId first, then by _id
                    let usageRecord = await Usage.findOne({ 
                        'metadata.requestId': score.requestId,
                        userId: new mongoose.Types.ObjectId(userId)
                    });

                    if (!usageRecord && mongoose.Types.ObjectId.isValid(score.requestId)) {
                        usageRecord = await Usage.findOne({
                            _id: new mongoose.Types.ObjectId(score.requestId),
                            userId: new mongoose.Types.ObjectId(userId)
                        });
                    }

                    if (usageRecord) {
                        // Create a meaningful title from the prompt
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
                } catch (error) {
                    logger.error(`Error enriching request ${score.requestId}:`, error);
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

            return {
                totalScored,
                averageScore,
                scoreDistribution,
                trainingCandidates,
                topScoredRequests
            };
        } catch (error) {
            logger.error('Error getting scoring analytics:', error);
            throw error;
        }
    }

    /**
     * Bulk score requests
     */
    static async bulkScoreRequests(
        userId: string,
        scores: ScoreRequestData[]
    ): Promise<IRequestScore[]> {
        try {
            const results: IRequestScore[] = [];

            for (const scoreData of scores) {
                const result = await this.scoreRequest(userId, scoreData);
                results.push(result);
            }

            logger.info(`Bulk scored ${scores.length} requests for user ${userId}`);
            return results;
        } catch (error) {
            logger.error('Error bulk scoring requests:', error);
            throw error;
        }
    }

    /**
     * Delete a request score
     */
    static async deleteScore(userId: string, requestId: string): Promise<boolean> {
        try {
            const result = await RequestScore.deleteOne({
                requestId,
                userId: new mongoose.Types.ObjectId(userId)
            });

            return result.deletedCount > 0;
        } catch (error) {
            logger.error('Error deleting request score:', error);
            throw error;
        }
    }
}