import { QualityScore, IQualityScore } from '../models/QualityScore';
import { AIRouterService } from './aiRouter.service';
import { loggingService } from './logging.service';
import { ActivityService } from './activity.service';
import { AICostTrackingService } from './aiCostTracking.service';

export interface QualityAssessment {
    score: number;
    criteria: {
        accuracy: number;
        relevance: number;
        completeness: number;
        coherence: number;
        factuality: number;
    };
    confidence: number;
    explanation?: string;
}

export interface ComparisonResult {
    originalScore: number;
    optimizedScore: number;
    qualityRetention: number;
    recommendation: 'accept' | 'review' | 'reject';
    costSavings: {
        amount: number;
        percentage: number;
    };
}

export class QualityService {
    // Optimization: Background processing queue for AI operations
    private aiScoringQueue: Array<() => Promise<void>> = [];
    private aiProcessor?: NodeJS.Timeout;

    constructor() { }

    /**
     * Score the quality of an AI response (optimized - default to automated)
     */
    async scoreResponse(
        prompt: string,
        response: string,
        expectedOutput?: string,
        method: 'ai_model' | 'automated' | 'hybrid' = 'automated' // Changed default to automated
    ): Promise<QualityAssessment> {
        try {
            let assessment: QualityAssessment;

            switch (method) {
                case 'ai_model':
                    // Only use AI when explicitly requested
                    assessment = await Promise.race([
                        this.aiModelScoring(prompt, response, expectedOutput),
                        new Promise<QualityAssessment>(resolve => 
                            setTimeout(() => resolve(this.getDefaultScore()), 3000)
                        )
                    ]);
                    break;
                case 'automated':
                    assessment = this.automatedScoring(prompt, response);
                    break;
                case 'hybrid':
                    // For hybrid, use automated as base (no background AI queue to eliminate costs)
                    assessment = this.automatedScoring(prompt, response);
                    break;
                default:
                    assessment = this.automatedScoring(prompt, response);
                    break;
            }

            return assessment;
        } catch (error) {
            loggingService.error('Error scoring response:', { error: error instanceof Error ? error.message : String(error) });
            return this.getDefaultScore();
        }
    }

    /**
     * AI-powered quality scoring using a cheap model
     */
    private async aiModelScoring(
        prompt: string,
        response: string,
        expectedOutput?: string
    ): Promise<QualityAssessment> {
        const startTime = Date.now();
        const modelId = 'anthropic.claude-instant-v1';
        
        try {
            const scoringPrompt = this.buildScoringPrompt(prompt, response, expectedOutput);
            const estimatedInputTokens = Math.ceil(scoringPrompt.length / 4);

            // Use AIRouterService for scoring
            const result = await AIRouterService.invokeModel(
                scoringPrompt,
                modelId
            );

            const estimatedOutputTokens = Math.ceil(result.length / 4);
            const latency = Date.now() - startTime;

            // Track AI cost for monitoring
            AICostTrackingService.trackCall({
                service: 'quality_scoring',
                operation: 'ai_scoring',
                model: modelId,
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
                estimatedCost: (estimatedInputTokens * 0.0000008 + estimatedOutputTokens * 0.0000024), // Claude Instant pricing
                latency,
                success: true,
                metadata: {
                    promptLength: prompt.length,
                    responseLength: response.length
                }
            });

            return this.parseScoringResult(result);
        } catch (error) {
            // Track failed AI call
            AICostTrackingService.trackCall({
                service: 'quality_scoring',
                operation: 'ai_scoring',
                model: modelId,
                inputTokens: 0,
                outputTokens: 0,
                estimatedCost: 0,
                latency: Date.now() - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });

            loggingService.error('Error in AI model scoring:', { error: error instanceof Error ? error.message : String(error) });
            return this.getDefaultScore();
        }
    }

    /**
     * Automated scoring based on heuristics with optimized text processing
     */
    private automatedScoring(prompt: string, response: string): QualityAssessment {
        // Pre-compute text metrics for efficiency
        const promptMetrics = this.getTextMetrics(prompt);
        const responseMetrics = this.getTextMetrics(response);
        
        const criteria = {
            accuracy: 75, // Default score (requires AI validation)
            relevance: 0,
            completeness: 0,
            coherence: 0,
            factuality: 75 // Default score (requires AI validation)
        };

        // Optimized completeness calculation
        const lengthRatio = responseMetrics.wordCount / Math.max(promptMetrics.wordCount, 100);
        criteria.completeness = Math.min(100, lengthRatio * 50);

        // Optimized coherence calculation
        criteria.coherence = this.calculateCoherenceScore(responseMetrics);

        // Optimized relevance calculation using pre-computed word sets
        criteria.relevance = this.calculateRelevanceScore(promptMetrics, responseMetrics);

        const overallScore = Object.values(criteria).reduce((a, b) => a + b, 0) / 5;

        return {
            score: Math.round(overallScore),
            criteria,
            confidence: 0.6 // Lower confidence for automated scoring
        };
    }

    /**
     * Pre-compute text metrics for efficient processing
     */
    private getTextMetrics(text: string) {
        const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 0);
        const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
        
        return {
            wordCount: words.length,
            sentenceCount: sentences.length,
            paragraphCount: paragraphs.length,
            words: new Set(words.filter(w => w.length > 3)), // Filter meaningful words
            avgWordsPerSentence: words.length / Math.max(sentences.length, 1)
        };
    }

    /**
     * Calculate coherence score from text metrics
     */
    private calculateCoherenceScore(metrics: { paragraphCount: number; sentenceCount: number; avgWordsPerSentence: number }): number {
        const hasParagraphs = metrics.paragraphCount > 1;
        const hasSentences = metrics.sentenceCount > 2;
        const goodStructure = metrics.avgWordsPerSentence > 5 && metrics.avgWordsPerSentence < 30;
        
        return (hasParagraphs ? 40 : 20) + (hasSentences ? 40 : 20) + (goodStructure ? 20 : 0);
    }

    /**
     * Calculate relevance score using word set intersection
     */
    private calculateRelevanceScore(promptMetrics: any, responseMetrics: any): number {
        // Use Set intersection for O(n) complexity instead of nested loops
        const intersection = new Set([...promptMetrics.words].filter(word => responseMetrics.words.has(word)));
        const matchingWords = intersection.size;
        
        return Math.min(100, (matchingWords / Math.max(promptMetrics.words.size, 1)) * 200);
    }

    /**
     * Build prompt for AI scoring
     */
    private buildScoringPrompt(prompt: string, response: string, expectedOutput?: string): string {
        let scoringPrompt = `Evaluate the quality of this AI response on a scale of 1-100 for each criterion.

User Prompt: ${prompt.substring(0, 500)}...

AI Response: ${response.substring(0, 1000)}...

`;

        if (expectedOutput) {
            scoringPrompt += `Expected Output (reference): ${expectedOutput.substring(0, 500)}...\n\n`;
        }

        scoringPrompt += `Rate the response on these criteria (1-100):
1. Accuracy: How factually correct is the response?
2. Relevance: How well does it address the prompt?
3. Completeness: Does it fully answer the question?
4. Coherence: Is it well-structured and clear?
5. Factuality: Are the claims verifiable?

Provide your response in JSON format:
{
    "accuracy": <score>,
    "relevance": <score>,
    "completeness": <score>,
    "coherence": <score>,
    "factuality": <score>,
    "overall": <average score>,
    "explanation": "<brief explanation>"
}`;

        return scoringPrompt;
    }

    /**
     * Parse AI scoring result
     */
    private parseScoringResult(result: string): QualityAssessment {
        try {
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found');

            const parsed = JSON.parse(jsonMatch[0]);

            return {
                score: parsed.overall || 75,
                criteria: {
                    accuracy: parsed.accuracy || 75,
                    relevance: parsed.relevance || 75,
                    completeness: parsed.completeness || 75,
                    coherence: parsed.coherence || 75,
                    factuality: parsed.factuality || 75
                },
                confidence: 0.8,
                explanation: parsed.explanation
            };
        } catch (error) {
            loggingService.error('Error parsing scoring result:', { error: error instanceof Error ? error.message : String(error) });
            return this.getDefaultScore();
        }
    }

    /**
     * Get default score when scoring fails
     */
    private getDefaultScore(): QualityAssessment {
        return {
            score: 75,
            criteria: {
                accuracy: 75,
                relevance: 75,
                completeness: 75,
                coherence: 75,
                factuality: 75
            },
            confidence: 0.5
        };
    }

    /**
     * Compare original and optimized responses
     */
    async compareQuality(
        prompt: string,
        originalResponse: string,
        optimizedResponse: string,
        costSavings: { amount: number; percentage: number }
    ): Promise<ComparisonResult> {
        try {
            const [originalAssessment, optimizedAssessment] = await Promise.all([
                this.scoreResponse(prompt, originalResponse),
                this.scoreResponse(prompt, optimizedResponse)
            ]);

            const qualityRetention = (optimizedAssessment.score / originalAssessment.score) * 100;

            let recommendation: 'accept' | 'review' | 'reject';
            if (qualityRetention >= 95) {
                recommendation = 'accept';
            } else if (qualityRetention >= 85) {
                recommendation = 'review';
            } else {
                recommendation = 'reject';
            }

            return {
                originalScore: originalAssessment.score,
                optimizedScore: optimizedAssessment.score,
                qualityRetention,
                recommendation,
                costSavings
            };
        } catch (error) {
            loggingService.error('Error comparing quality:', { error: error instanceof Error ? error.message : String(error) });
            return {
                originalScore: 75,
                optimizedScore: 75,
                qualityRetention: 100,
                recommendation: 'review',
                costSavings
            };
        }
    }

    /**
     * Save quality score to database
     */
    async saveQualityScore(scoreData: Partial<IQualityScore>): Promise<IQualityScore> {
        try {
            const qualityScore = new QualityScore(scoreData);
            await qualityScore.save();

            // Track activity (only if we have the required fields)
            if (scoreData.userId) {
                await ActivityService.trackActivity(scoreData.userId, {
                    type: 'quality_scored',
                    title: 'Quality Score Generated',
                    description: 'Quality score generated for optimization',
                    metadata: {
                        qualityScoreId: qualityScore._id,
                        optimizationType: Array.isArray(scoreData.optimizationType) ? 
                            (scoreData.optimizationType[0] as unknown as 'token' | 'cost' | 'quality' | 'model-specific') : 
                            (scoreData.optimizationType as unknown as 'token' | 'cost' | 'quality' | 'model-specific')
                    }
                });
            }
            

            return qualityScore;
        } catch (error) {
            loggingService.error('Error saving quality score:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get quality statistics for a user with aggregation-based processing
     */
    async getUserQualityStats(userId: string): Promise<any> {
        try {
            // Use MongoDB aggregation for efficient processing
            const stats = await QualityScore.aggregate([
                {
                    $match: { 
                        userId: userId
                    }
                },
                {
                    $sort: { createdAt: -1 }
                },
                {
                    $limit: 100
                },
                {
                    $facet: {
                        // Basic statistics
                        basicStats: [
                            {
                                $group: {
                                    _id: null,
                                    totalScores: { $sum: 1 },
                                    avgQuality: { $avg: '$optimizedScore' },
                                    totalSavings: { $sum: '$costSavings.amount' },
                                    accepted: { 
                                        $sum: { 
                                            $cond: [{ $eq: ['$userFeedback.isAcceptable', true] }, 1, 0] 
                                        }
                                    },
                                    rejected: { 
                                        $sum: { 
                                            $cond: [{ $eq: ['$userFeedback.isAcceptable', false] }, 1, 0] 
                                        }
                                    }
                                }
                            }
                        ],
                        // Optimization types breakdown
                        optimizationTypes: [
                            {
                                $unwind: '$optimizationType'
                            },
                            {
                                $group: {
                                    _id: '$optimizationType',
                                    count: { $sum: 1 }
                                }
                            }
                        ]
                    }
                }
            ]);

            const result = stats[0];
            
            // Handle empty results
            if (!result.basicStats[0]) {
                return {
                    averageQualityRetention: 100,
                    totalCostSavings: 0,
                    acceptedOptimizations: 0,
                    rejectedOptimizations: 0,
                    optimizationTypes: {}
                };
            }

            const basicStats = result.basicStats[0];
            const optimizationTypes = result.optimizationTypes.reduce((acc: Record<string, number>, item: any) => {
                acc[item._id] = item.count;
                return acc;
            }, {});

            return {
                averageQualityRetention: basicStats.avgQuality || 100,
                totalCostSavings: basicStats.totalSavings || 0,
                acceptedOptimizations: basicStats.accepted || 0,
                rejectedOptimizations: basicStats.rejected || 0,
                optimizationTypes
            };
        } catch (error) {
            loggingService.error('Error getting quality stats:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Update user feedback for a quality score
     */
    async updateUserFeedback(
        scoreId: string,
        feedback: {
            rating?: 1 | 2 | 3 | 4 | 5;
            isAcceptable: boolean;
            comment?: string;
        }
    ): Promise<void> {
        try {
            await QualityScore.findByIdAndUpdate(scoreId, {
                userFeedback: {
                    ...feedback,
                    timestamp: new Date()
                }
            });
        } catch (error) {
            loggingService.error('Error updating user feedback:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Process background AI scoring queue
     */
    private async processAIScoringQueue(): Promise<void> {
        if (this.aiScoringQueue.length === 0) {
            this.aiProcessor = undefined;
            return;
        }

        const operations = this.aiScoringQueue.splice(0, 5); // Process 5 operations at a time
        
        try {
            await Promise.allSettled(operations.map(op => op()));
        } catch (error) {
            loggingService.warn('Background AI scoring batch failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Continue processing if more operations are queued
        if (this.aiScoringQueue.length > 0) {
            this.aiProcessor = setTimeout(() => {
                this.processAIScoringQueue();
            }, 500);
        } else {
            this.aiProcessor = undefined;
        }
    }
}

// Export singleton instance
export const qualityService = new QualityService(); 