import { QualityScore, IQualityScore } from '../models/QualityScore';
import { BedrockService } from './bedrock.service';
import { logger } from '../utils/logger';
import { ActivityService } from './activity.service';

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
    constructor() { }

    /**
     * Score the quality of an AI response
     */
    async scoreResponse(
        prompt: string,
        response: string,
        expectedOutput?: string,
        method: 'ai_model' | 'automated' | 'hybrid' = 'hybrid'
    ): Promise<QualityAssessment> {
        try {
            let assessment: QualityAssessment;

            switch (method) {
                case 'ai_model':
                    assessment = await this.aiModelScoring(prompt, response, expectedOutput);
                    break;
                case 'automated':
                    assessment = this.automatedScoring(prompt, response);
                    break;
                case 'hybrid':
                default:
                    const aiScore = await this.aiModelScoring(prompt, response, expectedOutput);
                    const autoScore = this.automatedScoring(prompt, response);
                    assessment = this.combineScores(aiScore, autoScore);
                    break;
            }

            return assessment;
        } catch (error) {
            logger.error('Error scoring response:', error);
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
        try {
            const scoringPrompt = this.buildScoringPrompt(prompt, response, expectedOutput);

            // Use a cheap model for scoring
            const result = await BedrockService['invokeModel'](
                scoringPrompt,
                'anthropic.claude-instant-v1'
            );

            return this.parseScoringResult(result);
        } catch (error) {
            logger.error('Error in AI model scoring:', error);
            return this.getDefaultScore();
        }
    }

    /**
     * Automated scoring based on heuristics
     */
    private automatedScoring(prompt: string, response: string): QualityAssessment {
        const criteria = {
            accuracy: 0,
            relevance: 0,
            completeness: 0,
            coherence: 0,
            factuality: 0
        };

        // Length-based scoring
        const responseLength = response.length;
        const promptLength = prompt.length;
        const lengthRatio = responseLength / Math.max(promptLength, 100);

        // Completeness: Response should be proportional to prompt complexity
        criteria.completeness = Math.min(100, lengthRatio * 50);

        // Coherence: Check for structured response
        const hasParagraphs = response.split('\n\n').length > 1;
        const hasSentences = response.split(/[.!?]/).length > 2;
        criteria.coherence = (hasParagraphs ? 40 : 20) + (hasSentences ? 40 : 20) + 20;

        // Relevance: Basic keyword matching
        const promptWords = prompt.toLowerCase().split(/\s+/);
        const responseWords = response.toLowerCase().split(/\s+/);
        const matchingWords = promptWords.filter(word =>
            word.length > 3 && responseWords.includes(word)
        ).length;
        criteria.relevance = Math.min(100, (matchingWords / promptWords.length) * 200);

        // Default scores for accuracy and factuality (require AI or external validation)
        criteria.accuracy = 75;
        criteria.factuality = 75;

        const overallScore = Object.values(criteria).reduce((a, b) => a + b, 0) / 5;

        return {
            score: Math.round(overallScore),
            criteria,
            confidence: 0.6 // Lower confidence for automated scoring
        };
    }

    /**
     * Combine AI and automated scores
     */
    private combineScores(aiScore: QualityAssessment, autoScore: QualityAssessment): QualityAssessment {
        const aiWeight = 0.7;
        const autoWeight = 0.3;

        const combinedCriteria: any = {};
        for (const key in aiScore.criteria) {
            combinedCriteria[key] = Math.round(
                aiScore.criteria[key as keyof typeof aiScore.criteria] * aiWeight +
                autoScore.criteria[key as keyof typeof autoScore.criteria] * autoWeight
            );
        }

        return {
            score: Math.round(aiScore.score * aiWeight + autoScore.score * autoWeight),
            criteria: combinedCriteria,
            confidence: aiScore.confidence * aiWeight + autoScore.confidence * autoWeight,
            explanation: aiScore.explanation
        };
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
            logger.error('Error parsing scoring result:', error);
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
            logger.error('Error comparing quality:', error);
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
                        optimizationType: scoreData.optimizationType
                    }
                });
            }

            return qualityScore;
        } catch (error) {
            logger.error('Error saving quality score:', error);
            throw error;
        }
    }

    /**
     * Get quality statistics for a user
     */
    async getUserQualityStats(userId: string): Promise<any> {
        try {
            const scores = await QualityScore.find({ userId })
                .sort({ createdAt: -1 })
                .limit(100);

            if (scores.length === 0) {
                return {
                    averageQualityRetention: 100,
                    totalCostSavings: 0,
                    acceptedOptimizations: 0,
                    rejectedOptimizations: 0,
                    optimizationTypes: {}
                };
            }

            const stats = scores.reduce((acc, score) => {
                acc.totalScores += 1;
                acc.totalQuality += score.optimizedScore;
                acc.totalSavings += score.costSavings.amount;

                if (score.userFeedback?.isAcceptable) {
                    acc.accepted += 1;
                } else if (score.userFeedback?.isAcceptable === false) {
                    acc.rejected += 1;
                }

                score.optimizationType.forEach(type => {
                    acc.types[type] = (acc.types[type] || 0) + 1;
                });

                return acc;
            }, {
                totalScores: 0,
                totalQuality: 0,
                totalSavings: 0,
                accepted: 0,
                rejected: 0,
                types: {} as Record<string, number>
            });

            return {
                averageQualityRetention: stats.totalQuality / stats.totalScores,
                totalCostSavings: stats.totalSavings,
                acceptedOptimizations: stats.accepted,
                rejectedOptimizations: stats.rejected,
                optimizationTypes: stats.types
            };
        } catch (error) {
            logger.error('Error getting quality stats:', error);
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
            logger.error('Error updating user feedback:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const qualityService = new QualityService(); 