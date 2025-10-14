import { BaseService, ServiceError } from '../shared/BaseService';
import { loggingService } from './logging.service';
import { BedrockService } from './bedrock.service';

export interface ModelComparisonResult {
    id: string;
    provider: string;
    model: string;
    response: string;
    metrics: {
        cost: number;
        latency: number;
        tokenCount: number;
        qualityScore: number;
        errorRate: number;
    };
    timestamp: Date;
}

export interface RealTimeComparisonResult {
    modelId: string;
    modelName: string;
    provider: string;
    response: string;
    cost: number;
    latency: number;
    tokens: {
        input: number;
        output: number;
        total: number;
    };
    qualityScore?: number;
    error?: string;
    timestamp: Date;
}

export interface ComparisonAnalysis {
    summary: string;
    recommendations: string[];
    costAnalysis: {
        cheapest: string;
        mostExpensive: string;
        averageCost: number;
        costRange: { min: number; max: number };
    };
    performanceAnalysis: {
        fastest: string;
        slowest: string;
        averageLatency: number;
        latencyRange: { min: number; max: number };
    };
    qualityAnalysis: {
        highest: string;
        lowest: string;
        averageQuality: number;
        qualityRange: { min: number; max: number };
    };
    tradeoffs: Array<{
        model: string;
        strengths: string[];
        weaknesses: string[];
    }>;
}

/**
 * ExperimentAnalytics handles metrics calculation and analysis
 * Responsible for evaluating experiment results and generating insights
 */
export class ExperimentAnalyticsService extends BaseService {
    private static instance: ExperimentAnalyticsService;
    private bedrockService: BedrockService;

    // Analysis configuration
    private readonly QUALITY_EVALUATION_TIMEOUT = 30000; // 30 seconds
    private readonly MAX_RETRY_ATTEMPTS = 3;

    private constructor() {
        super('ExperimentAnalytics', {
            max: 500, // Cache up to 500 analysis results
            ttl: 2 * 60 * 60 * 1000 // 2 hour TTL
        });

        this.bedrockService = new BedrockService();
    }

    public static getInstance(): ExperimentAnalyticsService {
        if (!ExperimentAnalyticsService.instance) {
            ExperimentAnalyticsService.instance = new ExperimentAnalyticsService();
        }
        return ExperimentAnalyticsService.instance;
    }

    /**
     * Perform AI-powered evaluation of model responses
     */
    public async performAIEvaluation(
        prompt: string,
        response: string,
        criteria: string[]
    ): Promise<number> {
        const cacheKey = `ai_eval_${this.generateHash(prompt + response + criteria.join(','))}`;
        
        return this.getCachedOrExecute(cacheKey, async () => {
            return this.executeWithTimeout(async () => {
                const evaluationPrompt = this.buildEvaluationPrompt(prompt, response, criteria);
                
                try {
                    const evaluation = await BedrockService.invokeModel(
                        evaluationPrompt,
                        'amazon.nova-micro-v1:0'
                    );

                    return this.parseEvaluationScore(evaluation);
                } catch (error) {
                    loggingService.warn('AI evaluation failed, using fallback scoring', {
                        component: 'ExperimentAnalytics',
                        operation: 'performAIEvaluation',
                        error: error instanceof Error ? error.message : String(error)
                    });

                    return this.calculateFallbackScore(response, criteria);
                }
            }, this.QUALITY_EVALUATION_TIMEOUT, 'performAIEvaluation');
        });
    }

    /**
     * Calculate comprehensive model metrics
     */
    public async calculateModelMetrics(
        prompt: string,
        response: string,
        modelName: string,
        latency: number,
        cost: number,
        tokenCount: number
    ): Promise<ModelComparisonResult['metrics']> {
        return this.executeWithCircuitBreaker(async () => {
            // Calculate quality score
            const qualityScore = await this.performAIEvaluation(
                prompt,
                response,
                ['accuracy', 'relevance', 'completeness', 'clarity']
            );

            // Calculate error rate (simple heuristic)
            const errorRate = this.calculateErrorRate(response);

            return {
                cost,
                latency,
                tokenCount,
                qualityScore,
                errorRate
            };
        }, 'calculateModelMetrics');
    }

    /**
     * Generate comprehensive comparison analysis
     */
    public async generateComparisonAnalysis(
        results: RealTimeComparisonResult[]
    ): Promise<ComparisonAnalysis> {
        const cacheKey = `analysis_${this.generateHash(JSON.stringify(results.map(r => r.modelId + r.cost + r.latency)))}`;
        
        return this.getCachedOrExecute(cacheKey, async () => {
            if (results.length === 0) {
                throw new ServiceError(
                    'No results provided for analysis',
                    'INVALID_INPUT',
                    400
                );
            }

            // Filter out failed results
            const successfulResults = results.filter(r => !r.error);
            
            if (successfulResults.length === 0) {
                throw new ServiceError(
                    'No successful results to analyze',
                    'NO_SUCCESSFUL_RESULTS',
                    400
                );
            }

            // Cost analysis
            const costs = successfulResults.map(r => r.cost);
            const costAnalysis = {
                cheapest: successfulResults.find(r => r.cost === Math.min(...costs))?.modelName || '',
                mostExpensive: successfulResults.find(r => r.cost === Math.max(...costs))?.modelName || '',
                averageCost: costs.reduce((a, b) => a + b, 0) / costs.length,
                costRange: { min: Math.min(...costs), max: Math.max(...costs) }
            };

            // Performance analysis
            const latencies = successfulResults.map(r => r.latency);
            const performanceAnalysis = {
                fastest: successfulResults.find(r => r.latency === Math.min(...latencies))?.modelName || '',
                slowest: successfulResults.find(r => r.latency === Math.max(...latencies))?.modelName || '',
                averageLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
                latencyRange: { min: Math.min(...latencies), max: Math.max(...latencies) }
            };

            // Quality analysis
            const qualityScores = successfulResults
                .map(r => r.qualityScore || 0)
                .filter(score => score > 0);
            
            const qualityAnalysis = {
                highest: successfulResults.find(r => r.qualityScore === Math.max(...qualityScores))?.modelName || '',
                lowest: successfulResults.find(r => r.qualityScore === Math.min(...qualityScores))?.modelName || '',
                averageQuality: qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : 0,
                qualityRange: qualityScores.length > 0 ? { min: Math.min(...qualityScores), max: Math.max(...qualityScores) } : { min: 0, max: 0 }
            };

            // Generate AI-powered summary and recommendations
            const { summary, recommendations, tradeoffs } = await this.generateAISummary(successfulResults);

            return {
                summary,
                recommendations,
                costAnalysis,
                performanceAnalysis,
                qualityAnalysis,
                tradeoffs
            };
        });
    }

    /**
     * Calculate fallback quality score when AI evaluation fails
     */
    private calculateFallbackScore(response: string, criteria: string[]): number {
        let score = 50; // Base score

        // Length-based scoring
        const responseLength = response.length;
        if (responseLength > 100) score += 10;
        if (responseLength > 500) score += 10;
        if (responseLength > 1000) score -= 5; // Penalty for being too verbose

        // Structure-based scoring
        const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length >= 2) score += 10;
        if (sentences.length >= 5) score += 5;

        // Content quality heuristics
        const hasNumbers = /\d+/.test(response);
        const hasExamples = /for example|such as|like|including/i.test(response);
        const hasStructure = /first|second|third|finally|conclusion/i.test(response);

        if (hasNumbers) score += 5;
        if (hasExamples) score += 5;
        if (hasStructure) score += 5;

        // Error indicators
        const hasErrors = /error|failed|unable|cannot|sorry/i.test(response);
        if (hasErrors) score -= 15;

        return Math.min(Math.max(score, 0), 100);
    }

    /**
     * Calculate error rate based on response content
     */
    private calculateErrorRate(response: string): number {
        const errorIndicators = [
            'error', 'failed', 'unable', 'cannot', 'sorry',
            'not available', 'not found', 'invalid', 'incorrect'
        ];

        const errorCount = errorIndicators.reduce((count, indicator) => {
            return count + (response.toLowerCase().includes(indicator) ? 1 : 0);
        }, 0);

        return Math.min(errorCount * 0.2, 1.0); // Max 100% error rate
    }

    /**
     * Build evaluation prompt for AI scoring
     */
    private buildEvaluationPrompt(prompt: string, response: string, criteria: string[]): string {
        return `
Please evaluate the following AI response based on the specified criteria. Provide a score from 0-100.

Original Prompt: "${prompt}"

AI Response: "${response}"

Evaluation Criteria: ${criteria.join(', ')}

Please analyze the response and provide only a numerical score (0-100) based on how well it meets the criteria. Consider:
- Accuracy and correctness
- Relevance to the prompt
- Completeness of the answer
- Clarity and coherence
- Overall helpfulness

Score (0-100):`;
    }

    /**
     * Parse evaluation score from AI response
     */
    private parseEvaluationScore(evaluationResponse: string): number {
        // Extract numerical score from response
        const scoreMatch = evaluationResponse.match(/(\d+)/);
        if (scoreMatch) {
            const score = parseInt(scoreMatch[1], 10);
            return Math.min(Math.max(score, 0), 100);
        }

        // Fallback: look for percentage
        const percentMatch = evaluationResponse.match(/(\d+)%/);
        if (percentMatch) {
            const score = parseInt(percentMatch[1], 10);
            return Math.min(Math.max(score, 0), 100);
        }

        // Default fallback score
        loggingService.warn('Could not parse evaluation score, using fallback', {
            component: 'ExperimentAnalytics',
            operation: 'parseEvaluationScore',
            response: evaluationResponse
        });

        return 50;
    }

    /**
     * Generate AI-powered summary and recommendations
     */
    private async generateAISummary(results: RealTimeComparisonResult[]): Promise<{
        summary: string;
        recommendations: string[];
        tradeoffs: Array<{ model: string; strengths: string[]; weaknesses: string[] }>;
    }> {
        try {
            const analysisPrompt = this.buildAnalysisPrompt(results);
            
            const analysis = await BedrockService.invokeModel(
                analysisPrompt,
                'amazon.nova-micro-v1:0'
            );

            return this.parseAnalysisResponse(analysis);
        } catch (error) {
            loggingService.warn('AI analysis failed, using fallback analysis', {
                component: 'ExperimentAnalytics',
                operation: 'generateAISummary',
                error: error instanceof Error ? error.message : String(error)
            });

            return this.generateFallbackAnalysis(results);
        }
    }

    /**
     * Build analysis prompt for AI summary generation
     */
    private buildAnalysisPrompt(results: RealTimeComparisonResult[]): string {
        const resultsSummary = results.map(r => 
            `${r.modelName}: Cost: $${r.cost.toFixed(4)}, Latency: ${r.latency}ms, Quality: ${r.qualityScore || 'N/A'}`
        ).join('\n');

        return `
Analyze the following model comparison results and provide insights:

${resultsSummary}

Please provide:
1. A brief summary of the overall comparison
2. Top 3 recommendations for model selection
3. Key tradeoffs for each model

Format your response as JSON with keys: summary, recommendations (array), tradeoffs (array of objects with model, strengths, weaknesses)`;
    }

    /**
     * Parse AI analysis response
     */
    private parseAnalysisResponse(response: string): {
        summary: string;
        recommendations: string[];
        tradeoffs: Array<{ model: string; strengths: string[]; weaknesses: string[] }>;
    } {
        try {
            const parsed = JSON.parse(response);
            return {
                summary: parsed.summary || 'Analysis completed successfully',
                recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
                tradeoffs: Array.isArray(parsed.tradeoffs) ? parsed.tradeoffs : []
            };
        } catch {
            return this.generateFallbackAnalysis([]);
        }
    }

    /**
     * Generate fallback analysis when AI fails
     */
    private generateFallbackAnalysis(results: RealTimeComparisonResult[]): {
        summary: string;
        recommendations: string[];
        tradeoffs: Array<{ model: string; strengths: string[]; weaknesses: string[] }>;
    } {
        return {
            summary: `Compared ${results.length} models with varying performance characteristics.`,
            recommendations: [
                'Consider cost vs quality tradeoffs based on your use case',
                'Test models with your specific prompts for best results',
                'Monitor performance over time for consistency'
            ],
            tradeoffs: results.map(r => ({
                model: r.modelName,
                strengths: ['Available for testing'],
                weaknesses: ['Requires further evaluation']
            }))
        };
    }

    /**
     * Generate hash for caching
     */
    private generateHash(input: string): string {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
    }
}
