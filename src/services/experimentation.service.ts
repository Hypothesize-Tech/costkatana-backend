import { loggingService } from './logging.service';
import { Usage } from '../models/Usage';
import { Experiment } from '../models/Experiment';
import { WhatIfScenario } from '../models/WhatIfScenario';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';
import { MODEL_PRICING } from '../utils/pricing';
import mongoose from 'mongoose';
import { BedrockService } from './bedrock.service'; 
import { EventEmitter } from 'events';
import { AICostTrackingService } from './aiCostTracking.service';

export interface ExperimentResult {
    id: string;
    name: string;
    type: 'model_comparison' | 'what_if' | 'fine_tuning';
    status: 'running' | 'completed' | 'failed';
    startTime: string;
    endTime?: string;
    results: any;
    metadata: {
        duration: number;
        iterations: number;
        confidence: number;
    };
    userId: string;
    createdAt: Date;
}

export interface ModelComparisonRequest {
    prompt: string;
    models: Array<{
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
    }>;
    evaluationCriteria: string[];
    iterations?: number;
}

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
    performance: {
        responseTime: number;
        throughput: number;
        reliability: number;
    };
    costBreakdown: {
        inputTokens: number;
        outputTokens: number;
        inputCost: number;
        outputCost: number;
        totalCost: number;
    };
    timestamp: string;
}

export interface RealTimeComparisonRequest extends ModelComparisonRequest {
    sessionId: string;
    executeOnBedrock: boolean;
    evaluationPrompt?: string;
    comparisonMode: 'quality' | 'cost' | 'speed' | 'comprehensive';
}

export interface RealTimeComparisonResult extends ModelComparisonResult {
    bedrockOutput?: string;
    aiEvaluation?: {
        overallScore: number;
        criteriaScores: Record<string, number>;
        reasoning: string;
        recommendation: string;
    };
    executionTime: number;
    actualCost: number;
}

export interface ComparisonProgress {
    sessionId: string;
    stage: 'starting' | 'executing' | 'evaluating' | 'completed' | 'failed';
    progress: number; // 0-100
    currentModel?: string;
    message: string;
            results?: any[];
    error?: string;
}

export class ExperimentationService {
    // Static event emitter for SSE progress updates
    private static progressEmitter = new EventEmitter();
    
    // Track active sessions for security validation
    private static activeSessions = new Map<string, { userId: string, createdAt: Date }>();

    // Circuit breaker for AI service reliability
    private static circuitBreaker = {
        failures: new Map<string, number>(),
        lastFailure: new Map<string, number>(),
        isOpen: (service: string) => {
            const failures = ExperimentationService.circuitBreaker.failures.get(service) || 0;
            const lastFailure = ExperimentationService.circuitBreaker.lastFailure.get(service) || 0;
            const now = Date.now();
            
            // Reset after 5 minutes
            if (now - lastFailure > 5 * 60 * 1000) {
                ExperimentationService.circuitBreaker.failures.set(service, 0);
                return false;
            }
            
            return failures >= 3; // Open circuit after 3 failures
        },
        recordFailure: (service: string) => {
            const current = ExperimentationService.circuitBreaker.failures.get(service) || 0;
            ExperimentationService.circuitBreaker.failures.set(service, current + 1);
            ExperimentationService.circuitBreaker.lastFailure.set(service, Date.now());
        }
    };



    // Pre-computed model pricing index for O(1) lookups
    private static modelPricingIndex = new Map<string, any>();
    private static pricingIndexInitialized = false;

    // ============================================================================
    // REAL-TIME BEDROCK MODEL COMPARISON
    // ============================================================================

    /**
     * Run real-time model comparison with actual Bedrock execution
     * Uses SSE for progress updates and AI-driven evaluation
     */
    static async runRealTimeModelComparison(
        userId: string, 
        request: RealTimeComparisonRequest
    ): Promise<void> {
        const { sessionId, executeOnBedrock, prompt, models, evaluationCriteria, comparisonMode } = request;

        try {
            // Register session for security validation
            this.registerSession(sessionId, userId);
            
            // Initialize progress
            this.emitProgress(sessionId, 'starting', 0, 'Initializing model comparison...');

            const results: RealTimeComparisonResult[] = [];
            const totalModels = models.length;
            let completedModels = 0;

            // Execute models in parallel batches for optimal performance
            const BATCH_SIZE = 3; // Process 3 models concurrently to avoid rate limits
            const batches = this.chunkArray(models, BATCH_SIZE);
            
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                
                // Execute batch in parallel
                const batchPromises = batch.map(async (model, modelIndex) => {
                    const globalIndex = batchIndex * BATCH_SIZE + modelIndex;
                    const progressPercent = Math.round((globalIndex / totalModels) * 70);
                    
                    this.emitProgress(
                        sessionId, 
                        'executing', 
                        progressPercent, 
                        `Executing ${model.model} on ${executeOnBedrock ? 'Bedrock' : 'simulated environment'}...`,
                        model.model
                    );

                    try {
                        const result = await this.executeModelComparison(
                            userId, 
                            model, 
                            prompt, 
                            executeOnBedrock,
                            comparisonMode
                        );
                        
                        completedModels++;
                        const newProgress = Math.round((completedModels / totalModels) * 70);
                        this.emitProgress(sessionId, 'executing', newProgress, `Completed ${model.model}`);
                        
                        return result;
                    } catch (modelError: any) {
                        loggingService.error(`Error executing model ${model.model}:`, { error: modelError instanceof Error ? modelError.message : String(modelError) });
                        
                        // Handle specific error types
                        let errorMessage = modelError.message || 'Unknown error';
                        if (modelError.name === 'AccessDeniedException') {
                            errorMessage = `Model ${model.model} requires agreement in AWS console`;
                        } else if (modelError.name === 'ThrottlingException') {
                            errorMessage = `Rate limited - too many requests to ${model.model}`;
                        }
                        
                        // Continue with other models, but report the error
                        this.emitProgress(
                            sessionId, 
                            'executing', 
                            progressPercent, 
                            `⚠️ Skipped ${model.model}: ${errorMessage}`
                        );
                        
                        return null; // Return null for failed models
                    }
                });
                
                // Wait for batch to complete and add successful results
                const batchResults = await Promise.all(batchPromises);
                const successfulResults = batchResults.filter(result => result !== null);
                results.push(...successfulResults);
                
                // Small delay between batches to prevent overwhelming the service
                if (batchIndex < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            // AI-based evaluation phase with circuit breaker protection
            this.emitProgress(sessionId, 'evaluating', 75, 'Running AI evaluation and scoring...');

            const evaluatedResults = await this.executeWithCircuitBreaker(
                () => this.performAIEvaluation(results, prompt, evaluationCriteria, request.evaluationPrompt),
                'ai_evaluation',
                () => {
                    // Fallback: return results with basic scoring
                    this.emitProgress(sessionId, 'evaluating', 85, '⚠️ AI evaluation unavailable - using basic scores');
                    return results.map(result => ({
                    ...result,
                    aiEvaluation: {
                        overallScore: 75,
                        criteriaScores: { accuracy: 75, relevance: 80, completeness: 70 },
                        reasoning: 'AI evaluation was throttled - basic scoring applied',
                        recommendation: 'Manual review recommended'
                    }
                }));
                },
                15000 // 15 second timeout for AI evaluation
            );

            // Final analysis and recommendations (optional)
            this.emitProgress(sessionId, 'evaluating', 90, 'Generating intelligent recommendations...');

            try {
                await this.generateComparisonAnalysis(evaluatedResults, comparisonMode);
            } catch (analysisError: any) {
                loggingService.warn('Comparison analysis skipped due to error:', { error: analysisError instanceof Error ? analysisError.message : String(analysisError) });
                this.emitProgress(sessionId, 'evaluating', 95, '⚠️ Analysis generation skipped due to rate limiting');
            }

            // Map to frontend-compatible format
            const frontendResults = evaluatedResults.map(result => ({
                model: result.model,
                provider: result.provider,
                recommendation: result.aiEvaluation?.recommendation || 'Good performance with real execution',
                estimatedCostPer1K: result.actualCost * 1000, // Convert to per 1K cost
                pricing: {
                    inputCost: result.costBreakdown.inputCost,
                    outputCost: result.costBreakdown.outputCost,
                    contextWindow: result.model.includes('nova') ? 300000 : 
                                  result.model.includes('claude') ? 200000 : 8192
                },
                analysis: {
                    strengths: [
                        `Response time: ${result.executionTime}ms`,
                        `Quality score: ${result.aiEvaluation?.overallScore || result.metrics.qualityScore}/100`,
                        `Actual execution on AWS Bedrock`,
                        `Token efficiency: ${result.costBreakdown.inputTokens + result.costBreakdown.outputTokens} tokens`
                    ],
                    considerations: [
                        result.aiEvaluation?.reasoning || 'Based on real model execution',
                        `Cost: $${result.actualCost.toFixed(4)} for this request`,
                        `Throughput: ${result.performance.throughput.toFixed(0)} chars/sec`
                    ]
                },
                // Include full result data for debugging
                fullResult: result
            }));

            // Complete
            this.emitProgress(
                sessionId, 
                'completed', 
                100, 
                `Comparison completed! Analyzed ${evaluatedResults.length} models.`,
                undefined,
                frontendResults
            );

        } catch (error) {
            loggingService.error('Error in real-time model comparison:', { error: error instanceof Error ? error.message : String(error) });
            this.emitProgress(
                sessionId, 
                'failed', 
                0, 
                `Comparison failed: ${error}`,
                undefined,
                undefined,
(error as Error)?.message || 'Unknown error'
            );
        }
    }

    /**
     * Execute individual model comparison with Bedrock or simulation
     */
    private static async executeModelComparison(
        userId: string,
        model: ModelComparisonRequest['models'][0],
        prompt: string,
        executeOnBedrock: boolean,
        _comparisonMode: string
    ): Promise<RealTimeComparisonResult> {
        const startTime = Date.now();
        let modelResponse = '';
        let bedrockOutput = '';
        let actualCost = 0;

        try {
            if (executeOnBedrock) {
                // Get the appropriate Bedrock model ID
                const bedrockModelId = this.mapToBedrockModelId(model.model, model.provider);
                loggingService.info(`Mapped ${model.provider}:${model.model} -> ${bedrockModelId}`);
                
                // Execute on Bedrock
                bedrockOutput = await BedrockService.invokeModel(prompt, bedrockModelId);
                modelResponse = bedrockOutput;
                
                // Calculate actual cost based on tokens used
                actualCost = await this.calculateActualCost(prompt, bedrockOutput, model.model);
            } else {
                // Simulation mode - get response based on historical data
                modelResponse = await this.simulateModelResponse(userId, model, prompt);
                actualCost = await this.estimateSimulatedCost(prompt, modelResponse, model.model);
            }

            const executionTime = Date.now() - startTime;
            
            // Get model performance metrics
            const metrics = await this.calculateModelMetrics(
                userId, 
                model.model, 
                prompt, 
                modelResponse, 
                executionTime,
                actualCost
            );

            return {
                id: `result_${Date.now()}_${model.model}`,
                provider: model.provider,
                model: model.model,
                response: modelResponse,
                bedrockOutput: executeOnBedrock ? bedrockOutput : undefined,
                metrics,
                performance: {
                    responseTime: executionTime,
                    throughput: modelResponse.length / (executionTime / 1000), // chars per second
                    reliability: executeOnBedrock ? 100 : 95 // Assume bedrock is more reliable
                },
                costBreakdown: await this.calculateDetailedCostBreakdown(prompt, modelResponse, model.model),
                executionTime,
                actualCost,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            loggingService.error(`Error executing model ${model.model}:`, { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get progress emitter for SSE subscriptions
     */
    static getProgressEmitter(): EventEmitter {
        return this.progressEmitter;
    }

    /**
     * Register a session for security validation
     */
    private static registerSession(sessionId: string, userId: string): void {
        this.activeSessions.set(sessionId, {
            userId,
            createdAt: new Date()
        });

        // Clean up old sessions after 1 hour
        setTimeout(() => {
            this.activeSessions.delete(sessionId);
        }, 60 * 60 * 1000);
    }

    /**
     * Validate if a session is active and return the userId
     */
    static validateSession(sessionId: string): { isValid: boolean; userId?: string } {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return { isValid: false };
        }

        // Check if session is not older than 1 hour
        const sessionAge = Date.now() - session.createdAt.getTime();
        if (sessionAge > 60 * 60 * 1000) {
            this.activeSessions.delete(sessionId);
            return { isValid: false };
        }

        return { isValid: true, userId: session.userId };
    }

    /**
     * Get accessible Bedrock models from AWS API
     */
    static async getAccessibleBedrockModels(): Promise<any[]> {
        try {
            // Use AWS Bedrock pricing data directly from our pricing files
            const accessibleModels = AWS_BEDROCK_PRICING.map(pricing => ({
                provider: pricing.provider,
                model: pricing.modelId,
                modelName: pricing.modelName,
                pricing: {
                    input: pricing.inputPrice,
                    output: pricing.outputPrice,
                    unit: pricing.unit
                },
                capabilities: pricing.capabilities || ['text'],
                contextWindow: pricing.contextWindow || 8192,
                category: pricing.category || 'text',
                isLatest: pricing.isLatest || false,
                notes: pricing.notes || 'Available in AWS Bedrock'
            }));

            loggingService.info(`Found ${accessibleModels.length} AWS Bedrock models from pricing data`);
            return accessibleModels;

        } catch (error: any) {
            loggingService.error('Error getting AWS Bedrock models from pricing data:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error(`Failed to load AWS Bedrock models: ${error.message}`);
        }
    }

    /**
     * Emit progress updates for SSE
     */
    private static emitProgress(
        sessionId: string,
        stage: ComparisonProgress['stage'],
        progress: number,
        message: string,
        currentModel?: string,
        results?: any[],
        error?: string
    ): void {
        const progressData: ComparisonProgress = {
            sessionId,
            stage,
            progress,
            message,
            currentModel,
            results,
            error
        };

        this.progressEmitter.emit('progress', progressData);
        loggingService.info('Model comparison progress:', { value:  { value: progressData  } });
    }

    /**
     * Helper methods for Bedrock integration
     */
    private static mapToBedrockModelId(modelName: string, provider: string): string {
        // Map frontend model names to WORKING Bedrock model IDs (compatible with on-demand throughput)
        const modelMap: Record<string, string> = {
            // Claude models (use older stable versions that support on-demand)
            'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
            'claude-3-5-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0', // Upgraded to 3.5
            'claude-3-opus': 'anthropic.claude-3-5-sonnet-20240620-v1:0', // Upgraded to 3.5 Sonnet
            'claude-3-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0', // Upgraded to 3.5  
            'claude-3-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0', // Upgraded to 3.5
            'claude-4': 'anthropic.claude-opus-4-1-20250805-v1:0', // Claude 4 support
            
            // Amazon models (most reliable access)
            'amazon.nova-micro-v1': 'amazon.nova-micro-v1:0',
            'amazon.nova-lite-v1': 'amazon.nova-lite-v1:0', 
            'amazon.nova-pro-v1': 'amazon.nova-pro-v1:0',
            'nova-micro': 'amazon.nova-micro-v1:0',
            'nova-lite': 'amazon.nova-lite-v1:0',
            'nova-pro': 'amazon.nova-pro-v1:0',
            
            // Titan models (generally accessible)
            'titan-text': 'amazon.titan-text-express-v1',
            'amazon.titan-text-express-v1': 'amazon.titan-text-express-v1',
            'amazon.titan-text-lite-v1': 'amazon.titan-text-lite-v1',
            
            // Meta models (may require approval)
            'llama-3-70b': 'meta.llama3-70b-instruct-v1:0',
            'llama-3-8b': 'meta.llama3-8b-instruct-v1:0',
            
            // Skip AI21 models - they commonly require explicit agreement
            // 'ai21.jamba-1-5-large-v1:0': 'SKIP_NEEDS_AGREEMENT',
            // 'jamba': 'SKIP_NEEDS_AGREEMENT'
        };

        // Try different matching strategies
        const exactMatch = modelMap[modelName.toLowerCase()];
        if (exactMatch) return exactMatch;

        const providerMatch = modelMap[`${provider.toLowerCase()}-${modelName.toLowerCase()}`];
        if (providerMatch) return providerMatch;

        // Fallback to a known working model
        loggingService.warn(`Unknown model ${modelName} from ${provider}, falling back to Claude Sonnet 4`);
        return 'anthropic.claude-sonnet-4-20250514-v1:0'; // Known working fallback
    }

    /**
     * Perform AI-based evaluation of model outputs
     */
    private static async performAIEvaluation(
        results: RealTimeComparisonResult[],
        originalPrompt: string,
        evaluationCriteria: string[],
        customEvaluationPrompt?: string
    ): Promise<RealTimeComparisonResult[]> {
        const startTime = Date.now();
        let modelUsed = '';

        try {
            // Create evaluation prompt for AI judge
            const evaluationPrompt = customEvaluationPrompt || this.createDefaultEvaluationPrompt(
                originalPrompt, 
                results.map(r => ({ model: r.model, response: r.response })),
                evaluationCriteria
            );

            const estimatedInputTokens = Math.ceil(evaluationPrompt.length / 4);

            // Add substantial delay to prevent throttling (AWS Bedrock has strict limits)
            await new Promise(resolve => setTimeout(resolve, 15000)); // Increased delay
            
            let evaluationResponse: string;
            
            // Try with Claude 3.5 Haiku first (lower rate limits) as per user memory
            try {
                loggingService.info('Attempting evaluation with Claude 3.5 Haiku...');
                modelUsed = 'anthropic.claude-3-5-haiku-20241022-v1:0';
                evaluationResponse = await this.invokeWithExponentialBackoff(
                    evaluationPrompt,
                    modelUsed
                );
            } catch (haikuError) {
                loggingService.warn('Claude 3.5 Haiku failed, trying Sonnet with longer delay...', { error: haikuError instanceof Error ? haikuError.message : String(haikuError) });
                // Wait even longer before trying Sonnet
                await new Promise(resolve => setTimeout(resolve, 20000));
                modelUsed = 'anthropic.claude-sonnet-4-20250514-v1:0';
                evaluationResponse = await this.invokeWithExponentialBackoff(
                    evaluationPrompt,
                    modelUsed
                );
            }

            const estimatedOutputTokens = Math.ceil(evaluationResponse.length / 4);
            const latency = Date.now() - startTime;

            // Track AI cost for monitoring
            const estimatedCost = modelUsed.includes('haiku')
                ? (estimatedInputTokens * 0.0000008 + estimatedOutputTokens * 0.000004)
                : (estimatedInputTokens * 0.000003 + estimatedOutputTokens * 0.000015);

            AICostTrackingService.trackCall({
                service: 'experimentation',
                operation: 'ai_evaluation',
                model: modelUsed,
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
                estimatedCost,
                latency,
                success: true,
                metadata: {
                    modelsCompared: results.length,
                    promptLength: originalPrompt.length
                }
            });

            // Parse evaluation results
            const evaluationData = this.parseEvaluationResponse(evaluationResponse, results);

            // Apply evaluation scores to results
            return results.map((result, index) => ({
                ...result,
                aiEvaluation: evaluationData[index] || {
                    overallScore: 75, // Better fallback score
                    criteriaScores: { relevance: 75, accuracy: 75, completeness: 75 },
                    reasoning: 'Evaluation completed with fallback scoring',
                    recommendation: 'Good performance based on execution metrics'
                }
            }));

        } catch (error) {
            // Track failed AI call
            AICostTrackingService.trackCall({
                service: 'experimentation',
                operation: 'ai_evaluation',
                model: modelUsed || 'unknown',
                inputTokens: 0,
                outputTokens: 0,
                estimatedCost: 0,
                latency: Date.now() - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });

            loggingService.error('Error performing AI evaluation:', { error: error instanceof Error ? error.message : String(error) });
            // Return results with fallback AI evaluation based on execution metrics
            return results.map((result) => {
                const score = this.calculateFallbackScore(result);
                return {
                    ...result,
                    aiEvaluation: {
                        overallScore: score,
                        criteriaScores: { 
                            performance: Math.min(100, 5000 / (result.executionTime || 5000) * 100),
                            cost: Math.min(100, 0.1 / (result.actualCost || 0.1) * 100),
                            reliability: 85
                        },
                        reasoning: `Fallback evaluation based on execution metrics. Response time: ${result.executionTime}ms, Cost: $${result.actualCost}`,
                        recommendation: score > 70 ? 'Good performance with real execution' : 'Consider optimization'
                    }
                };
            });
        }
    }

    /**
     * Invoke model with exponential backoff for throttling resilience
     */
    private static async invokeWithExponentialBackoff(
        prompt: string, 
        modelId: string, 
        maxRetries: number = 4
    ): Promise<string> {
        let lastError: any;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    // Exponential backoff: 5s, 15s, 45s
                    const delay = Math.pow(3, attempt) * 5000;
                    loggingService.info(`Retry attempt ${attempt + 1} after ${delay}ms delay...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                
                return await BedrockService.invokeModel(prompt, modelId);
                
            } catch (error: any) {
                lastError = error;
                
                if (error.name === 'ThrottlingException' && attempt < maxRetries - 1) {
                    loggingService.warn(`Throttling detected, retrying... (attempt ${attempt + 1}/${maxRetries})`);
                    continue;
                }
                
                // If not throttling or max retries reached, throw error
                throw error;
            }
        }
        
        throw lastError;
    }

    /**
     * Calculate fallback score based on execution metrics
     */
    private static calculateFallbackScore(result: RealTimeComparisonResult): number {
        let score = 50; // Base score
        
        // Performance scoring (faster is better)
        if (result.executionTime && result.executionTime < 5000) score += 20;
        else if (result.executionTime && result.executionTime < 10000) score += 10;
        
        // Cost scoring (lower is better)
        if (result.actualCost && result.actualCost < 0.01) score += 15;
        else if (result.actualCost && result.actualCost < 0.05) score += 10;
        
        // Response quality (longer responses generally more detailed)
        if (result.response && result.response.length > 1000) score += 15;
        else if (result.response && result.response.length > 500) score += 10;
        
        return Math.min(100, Math.max(0, score));
    }

    /**
     * Generate comprehensive comparison analysis
     */
    private static async generateComparisonAnalysis(
        results: RealTimeComparisonResult[], 
        comparisonMode: string
    ): Promise<any> {
        const analysisPrompt = `
        Analyze these model comparison results and provide comprehensive insights:

        Comparison Results:
        ${JSON.stringify(results.map(r => ({
            model: r.model,
            provider: r.provider,
            overallScore: r.aiEvaluation?.overallScore,
            executionTime: r.executionTime,
            actualCost: r.actualCost,
            aiEvaluation: r.aiEvaluation
        })), null, 2)}

        Comparison Mode: ${comparisonMode}

        Please provide analysis as valid JSON:
        {
            "winner": { "model": "...", "reason": "..." },
            "costPerformanceAnalysis": "...",
            "useCaseRecommendations": ["..."]
        }
        `;

        try {
            // Add substantial delay to prevent throttling after evaluation
            await new Promise(resolve => setTimeout(resolve, 25000)); // Increased delay
            
            let analysisResponse: string;
            
            // Try with Claude 3.5 Haiku first for analysis
            try {
                loggingService.info('Attempting analysis with Claude 3.5 Haiku...');
                analysisResponse = await this.invokeWithExponentialBackoff(
                    analysisPrompt,
                    'anthropic.claude-3-5-haiku-20241022-v1:0'
                );
            } catch (haikuError) {
                loggingService.warn('Claude 3.5 Haiku failed for analysis, trying Sonnet...', { error: haikuError instanceof Error ? haikuError.message : String(haikuError) });
                // Wait even longer before trying Sonnet
                await new Promise(resolve => setTimeout(resolve, 30000));
                analysisResponse = await this.invokeWithExponentialBackoff(
                    analysisPrompt,
                    'anthropic.claude-sonnet-4-20250514-v1:0'
                );
            }

            const extractedJson = BedrockService.extractJson(analysisResponse);
            try {
                return JSON.parse(extractedJson);
            } catch (parseError) {
                loggingService.error('Failed to parse comparison analysis JSON:', { error: parseError instanceof Error ? parseError.message : String(parseError) });
                loggingService.error('Extracted JSON:', { json: extractedJson.substring(0, 500) + '...' });
                throw new Error('Failed to parse AI analysis response');
            }
        } catch (error) {
            loggingService.error('Error generating comparison analysis:', { error: error instanceof Error ? error.message : String(error) });
            
            // Generate fallback analysis based on available data
            const winner = results.reduce((best, current) => {
                const bestScore = best.aiEvaluation?.overallScore || 0;
                const currentScore = current.aiEvaluation?.overallScore || 0;
                return currentScore > bestScore ? current : best;
            });
            
            return {
                winner: { 
                    model: winner.model, 
                    reason: `Best overall score of ${winner.aiEvaluation?.overallScore || 'N/A'} with ${winner.executionTime}ms response time` 
                },
                costPerformanceAnalysis: `Analyzed ${results.length} models. Best performance: ${winner.model} with $${winner.actualCost} cost.`,
                useCaseRecommendations: [
                    `For cost optimization: ${results.sort((a, b) => (a.actualCost || 0) - (b.actualCost || 0))[0]?.model}`,
                    `For speed: ${results.sort((a, b) => (a.executionTime || 0) - (b.executionTime || 0))[0]?.model}`,
                    `For balanced performance: ${winner.model}`
                ]
            };
        }
    }

    /**
     * Calculate actual cost for Bedrock execution
     */
    private static async calculateActualCost(prompt: string, response: string, modelName: string): Promise<number> {
        try {
            const inputTokens = Math.ceil(prompt.length / 4); // Rough token estimate
            const outputTokens = Math.ceil(response.length / 4);
            
            // First try to find in AWS Bedrock pricing
            const bedrockPricing = AWS_BEDROCK_PRICING.find(p => 
                p.modelId === modelName || 
                p.modelName.toLowerCase().includes(modelName.toLowerCase())
            );

            if (bedrockPricing) {
                const inputCost = (inputTokens / 1000000) * bedrockPricing.inputPrice;
                const outputCost = (outputTokens / 1000000) * bedrockPricing.outputPrice;
                return inputCost + outputCost;
            }

            // Fallback to general MODEL_PRICING
            const pricing = MODEL_PRICING.find(p => 
                p.modelName.toLowerCase().includes(modelName.toLowerCase())
            );

            if (pricing) {
                const inputCost = (inputTokens / 1000000) * pricing.inputPrice;
                const outputCost = (outputTokens / 1000000) * pricing.outputPrice;
                return inputCost + outputCost;
            }

            return 0.01; // Fallback estimate
        } catch (error) {
            loggingService.error('Error calculating actual cost:', { error: error instanceof Error ? error.message : String(error) });
            return 0.01;
        }
    }

    /**
     * Simulate model response based on historical data
     */
    private static async simulateModelResponse(
        userId: string, 
        model: ModelComparisonRequest['models'][0], 
        prompt: string
    ): Promise<string> {
        try {
            // Get similar historical responses from usage data
            const similarUsage = await Usage.findOne({
                userId: new mongoose.Types.ObjectId(userId),
                model: { $regex: model.model, $options: 'i' }
            }).sort({ createdAt: -1 });

            if (similarUsage?.completion) {
                return `${similarUsage.completion}\n\n[Simulated response based on historical usage]`;
            }

            // Fallback to a generic response
            return `This is a simulated response from ${model.model} for the prompt: "${prompt.substring(0, 100)}..."`;
        } catch (error) {
            loggingService.error('Error simulating model response:', { error: error instanceof Error ? error.message : String(error) });
            return `Simulated response from ${model.model}`;
        }
    }

    /**
     * Estimate cost for simulated execution
     */
    private static async estimateSimulatedCost(prompt: string, response: string, modelName: string): Promise<number> {
        return await this.calculateActualCost(prompt, response, modelName);
    }

    /**
     * Calculate model performance metrics
     */
    private static async calculateModelMetrics(
        _userId: string,
        _modelName: string,
        prompt: string,
        response: string,
        executionTime: number,
        actualCost: number
    ): Promise<RealTimeComparisonResult['metrics']> {
        try {
            const inputTokens = Math.ceil(prompt.length / 4);
            const outputTokens = Math.ceil(response.length / 4);
            const totalTokens = inputTokens + outputTokens;

            return {
                cost: actualCost,
                latency: executionTime,
                tokenCount: totalTokens,
                qualityScore: 85, // Will be updated by AI evaluation
                errorRate: 0 // Assume no errors for successful execution
            };
        } catch (error) {
            loggingService.error('Error calculating model metrics:', { error: error instanceof Error ? error.message : String(error) });
            return {
                cost: actualCost,
                latency: executionTime,
                tokenCount: 0,
                qualityScore: 0,
                errorRate: 1
            };
        }
    }

    /**
     * Calculate detailed cost breakdown
     */
    private static async calculateDetailedCostBreakdown(
        prompt: string, 
        response: string, 
        modelName: string
    ): Promise<RealTimeComparisonResult['costBreakdown']> {
        try {
            const inputTokens = Math.ceil(prompt.length / 4);
            const outputTokens = Math.ceil(response.length / 4);
            
            // First try to find in AWS Bedrock pricing
            const bedrockPricing = AWS_BEDROCK_PRICING.find(p => 
                p.modelId === modelName || 
                p.modelName.toLowerCase().includes(modelName.toLowerCase())
            );

            if (bedrockPricing) {
                const inputCost = (inputTokens / 1000000) * bedrockPricing.inputPrice;
                const outputCost = (outputTokens / 1000000) * bedrockPricing.outputPrice;
                
                return {
                    inputTokens,
                    outputTokens,
                    inputCost,
                    outputCost,
                    totalCost: inputCost + outputCost
                };
            }

            // Fallback to general MODEL_PRICING
            const pricing = MODEL_PRICING.find(p => 
                p.modelName.toLowerCase().includes(modelName.toLowerCase())
            );

            if (pricing) {
                const inputCost = (inputTokens / 1000000) * pricing.inputPrice;
                const outputCost = (outputTokens / 1000000) * pricing.outputPrice;
                
                return {
                    inputTokens,
                    outputTokens,
                    inputCost,
                    outputCost,
                    totalCost: inputCost + outputCost
                };
            }

            return {
                inputTokens,
                outputTokens,
                inputCost: 0,
                outputCost: 0,
                totalCost: 0
            };
        } catch (error) {
            loggingService.error('Error calculating cost breakdown:', { error: error instanceof Error ? error.message : String(error) });
            return {
                inputTokens: 0,
                outputTokens: 0,
                inputCost: 0,
                outputCost: 0,
                totalCost: 0
            };
        }
    }

    private static createDefaultEvaluationPrompt(
        originalPrompt: string, 
        responses: Array<{model: string, response: string}>,
        criteria: string[]
    ): string {
        return `
        You are an expert AI evaluator. Please evaluate and score the following model responses.

        Original User Prompt: "${originalPrompt}"

        Model Responses:
        ${responses.map((r, i) => `
        ${i + 1}. Model: ${r.model}
        Response: ${r.response}
        `).join('\n')}

        Evaluation Criteria: ${criteria.join(', ')}

        Format your response as valid JSON:
        [
            {
                "model": "${responses[0]?.model}",
                "overallScore": 85,
                "criteriaScores": {
                    ${criteria.map(c => `"${c}": 85`).join(', ')}
                },
                "reasoning": "Detailed explanation...",
                "recommendation": "Specific recommendation..."
            }
        ]
        `;
    }

    private static parseEvaluationResponse(response: string, results: RealTimeComparisonResult[]): any[] {
        try {
            let cleanedResponse = BedrockService.extractJson(response);
            
            // Additional cleaning for control characters and invalid JSON
            cleanedResponse = cleanedResponse
                .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
                .replace(/\n/g, ' ') // Replace newlines with spaces
                .replace(/\r/g, '') // Remove carriage returns
                .replace(/\t/g, ' ') // Replace tabs with spaces
                .replace(/\\"/g, '"') // Fix escaped quotes
                .replace(/\\\\/g, '\\') // Fix double backslashes
                .trim();
            
            loggingService.info('Extracted JSON response:', { json: cleanedResponse.substring(0, 200) + '...' });
            
            const parsed = JSON.parse(cleanedResponse);
            
            // Validate that the parsed result is an array
            if (!Array.isArray(parsed)) {
                loggingService.warn('Parsed response is not an array, wrapping in array');
                return [parsed];
            }
            
            return parsed;
        } catch (error) {
            loggingService.error('Error parsing evaluation response:', { error: error instanceof Error ? error.message : String(error) });
            loggingService.error('Original response:', { response: response.substring(0, 500) + '...' });
            
            // Try alternative parsing approaches
            try {
                // Try to find JSON-like structures in the response
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const alternativeJson = jsonMatch[0]
                        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
                        .replace(/\n/g, ' ')
                        .replace(/\r/g, '')
                        .replace(/\t/g, ' ')
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, '\\');
                    
                    const parsed = JSON.parse(alternativeJson);
                    loggingService.info('Successfully parsed with alternative method');
                    return Array.isArray(parsed) ? parsed : [parsed];
                }
            } catch (altError) {
                loggingService.error('Alternative parsing also failed:', { error: altError instanceof Error ? altError.message : String(altError) });
            }
            
            // Return fallback evaluations for each result
            return results.map((result, index) => ({
                overallScore: 50,
                criteriaScores: { 
                    accuracy: 50, 
                    relevance: 50, 
                    completeness: 50, 
                    coherence: 50 
                },
                reasoning: `Evaluation parsing failed for ${result.model}. Using fallback scores.`,
                recommendation: 'Manual review recommended due to parsing error',
                modelIndex: index,
                modelName: result.model
            }));
        }
    }

    // ============================================================================
    // EXISTING METHODS
    // ============================================================================

    /**
     * Get experiment history for a user - based on actual optimization history
     */
    static async getExperimentHistory(
        userId: string,
        filters: {
            type?: string;
            status?: string;
            startDate?: Date;
            endDate?: Date;
            limit?: number;
        }
    ): Promise<ExperimentResult[]> {
        try {
            // Validate ObjectId format before creating
            if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
                loggingService.warn(`Invalid user ID format for experiment history: ${userId}`);
                return [];
            }

            // Build query for experiments
            const query: any = {
                userId: new mongoose.Types.ObjectId(userId)
            };

            if (filters.type) {
                query.type = filters.type;
            }

            if (filters.status) {
                query.status = filters.status;
            }

            if (filters.startDate || filters.endDate) {
                query.createdAt = {};
                if (filters.startDate) query.createdAt.$gte = filters.startDate;
                if (filters.endDate) query.createdAt.$lte = filters.endDate;
            }

            let experiments = await Experiment.find(query)
                .sort({ createdAt: -1 })
                .limit(filters.limit || 20)
                .lean();

            // Convert database experiments to ExperimentResult format
            const experimentResults: ExperimentResult[] = experiments.map((exp) => ({
                id: exp._id.toString(),
                name: exp.name,
                type: exp.type,
                status: exp.status,
                startTime: exp.startTime.toISOString(),
                endTime: exp.endTime?.toISOString(),
                results: exp.results,
                metadata: exp.metadata,
                userId,
                createdAt: exp.createdAt
            }));

            return experimentResults;
        } catch (error) {
            loggingService.error('Error getting experiment history:', { error: error instanceof Error ? error.message : String(error) });
            return []; // Return empty array instead of throwing to prevent 500 errors
        }
    }

    /**
     * Run model comparison experiment - based on actual usage data
     */
    static async runModelComparison(
        userId: string,
        request: ModelComparisonRequest
    ): Promise<ExperimentResult> {
        try {
            const experimentId = `exp_${Date.now()}`;
            
            // Get actual usage data for these models to base comparison on
            const results = await this.analyzeModelsFromUsageData(userId, request);

            const experiment: ExperimentResult = {
                id: experimentId,
                name: `Model Comparison: ${request.models.map(m => m.model).join(' vs ')}`,
                type: 'model_comparison',
                status: 'completed',
                startTime: new Date().toISOString(),
                endTime: new Date().toISOString(),
                results,
                metadata: {
                    duration: 5, // Quick analysis
                    iterations: request.iterations || 1,
                    confidence: results.confidence || 0.8
                },
                userId,
                createdAt: new Date()
            };

            // Save experiment to database
            const savedExperiment = new Experiment({
                userId: new mongoose.Types.ObjectId(userId),
                name: experiment.name,
                type: experiment.type,
                status: experiment.status,
                startTime: new Date(experiment.startTime),
                endTime: experiment.endTime ? new Date(experiment.endTime) : undefined,
                results: experiment.results,
                metadata: experiment.metadata,
                request: {
                    prompt: request.prompt,
                    models: request.models,
                    evaluationCriteria: request.evaluationCriteria,
                    iterations: request.iterations
                }
            });

            await savedExperiment.save();
            loggingService.info(`Saved experiment ${experimentId} to database for user ${userId}`);

            return experiment;
        } catch (error) {
            loggingService.error('Error running model comparison:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get experiment by ID
     */
    static async getExperimentById(experimentId: string, userId: string): Promise<ExperimentResult | null> {
        try {
            // Validate ObjectId format before creating
            if (!experimentId || !mongoose.Types.ObjectId.isValid(experimentId)) {
                loggingService.warn(`Invalid experiment ID format: ${experimentId}`);
                return null;
            }

            if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
                loggingService.warn(`Invalid user ID format: ${userId}`);
                return null;
            }

            const experiment = await Experiment.findOne({
                _id: new mongoose.Types.ObjectId(experimentId),
                userId: new mongoose.Types.ObjectId(userId)
            }).lean();

            if (!experiment) {
                return null;
            }

            return {
                id: experiment._id.toString(),
                name: experiment.name,
                type: experiment.type,
                status: experiment.status,
                startTime: experiment.startTime.toISOString(),
                endTime: experiment.endTime?.toISOString(),
                results: experiment.results,
                metadata: experiment.metadata,
                userId,
                createdAt: experiment.createdAt
            };
        } catch (error) {
            loggingService.error('Error getting experiment by ID:', { error: error instanceof Error ? error.message : String(error) });
            return null; // Return null instead of throwing to prevent 500 errors
        }
    }

    /**
     * Delete experiment
     */
    static async deleteExperiment(experimentId: string, userId: string): Promise<void> {
        try {
            // Validate ObjectId format before creating
            if (!experimentId || !mongoose.Types.ObjectId.isValid(experimentId)) {
                loggingService.warn(`Invalid experiment ID format for deletion: ${experimentId}`);
                return;
            }

            if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
                loggingService.warn(`Invalid user ID format for deletion: ${userId}`);
                return;
            }

            const result = await Experiment.deleteOne({
                _id: new mongoose.Types.ObjectId(experimentId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (result.deletedCount > 0) {
                loggingService.info(`Deleted experiment ${experimentId} for user ${userId}`);
            } else {
                loggingService.warn(`No experiment found to delete: ${experimentId} for user ${userId}`);
            }
        } catch (error) {
            loggingService.error('Error deleting experiment:', { error: error instanceof Error ? error.message : String(error) });
            // Don't throw error to prevent 500 responses
        }
    }

    /**
     * Estimate experiment cost - based on actual pricing and usage patterns
     */
    static async estimateExperimentCost(
        type: string,
        parameters: any
    ): Promise<{
        estimatedCost: number;
        breakdown: Record<string, number>;
        duration: number;
    }> {
        try {
            let estimatedCost = 0;
            const breakdown: Record<string, number> = {};
            let duration = 0;

            switch (type) {
                case 'model_comparison':
                    const models = parameters.models || [];
                    const iterations = parameters.iterations || 1;
                    const promptLength = parameters.prompt?.length || 0;
                    
                    // More accurate token estimation (4 chars ≈ 1 token)
                    const inputTokens = Math.ceil(promptLength / 4);
                    // Estimate output tokens based on typical completion ratio
                    const outputTokens = Math.ceil(inputTokens * 1.5);

                    for (const model of models) {
                        const pricing = MODEL_PRICING.find(p => p.modelId === model.model || p.modelName.toLowerCase().includes(model.model.toLowerCase()));
                        if (pricing) {
                            const modelCost = ((pricing.inputPrice * inputTokens) + (pricing.outputPrice * outputTokens)) / 1000000;
                            const totalCost = modelCost * iterations;
                            breakdown[model.model] = totalCost;
                            estimatedCost += totalCost;
                        }
                    }

                    // Realistic duration based on model count and iterations
                    duration = models.length * iterations * 2; // 2 seconds per model per iteration
                    break;

                case 'what_if':
                    // Analysis cost - free, just computational
                    estimatedCost = 0;
                    breakdown['analysis'] = 0;
                    duration = 1; // 1 second for analysis
                    break;

                case 'fine_tuning':
                    // Analysis cost - free, just computational
                    estimatedCost = 0;
                    breakdown['analysis'] = 0;
                    duration = 2; // 2 seconds for analysis
                    break;

                default:
                    estimatedCost = 0;
                    breakdown['unknown'] = 0;
                    duration = 1;
            }

            return {
                estimatedCost,
                breakdown,
                duration
            };
        } catch (error) {
            loggingService.error('Error estimating experiment cost:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get experiment recommendations
     */
    static async getExperimentRecommendations(userId: string): Promise<Array<{
        type: 'model_comparison' | 'what_if' | 'fine_tuning';
        title: string;
        description: string;
        priority: 'low' | 'medium' | 'high';
        potentialSavings: number;
        effort: 'low' | 'medium' | 'high';
        actions: string[];
    }>> {
        try {
            const recommendations = [];

            // Get comprehensive usage analysis
            const usageAnalysis = await this.analyzeUserUsagePatterns(userId);
            
            // Always provide recommendations, even if no usage data exists
            if (usageAnalysis.hasData) {
                // AI-driven recommendation generation based on usage patterns
                const modelRecommendations = await this.generateModelRecommendations(usageAnalysis);
                const optimizationRecommendations = await this.generateOptimizationRecommendations(usageAnalysis);

                recommendations.push(...modelRecommendations, ...optimizationRecommendations);
            } else {
                // Provide default recommendations for new users
                recommendations.push(
                    {
                        type: 'model_comparison' as const,
                        title: 'Start with Model Comparison',
                        description: 'Compare different AI models to find the most cost-effective solution for your use case',
                        priority: 'high' as const,
                        potentialSavings: 50.0,
                        effort: 'low' as const,
                        actions: [
                            'Select 2-3 models to compare',
                            'Define your evaluation criteria',
                            'Run a comparison experiment'
                        ]
                    },
                    {
                        type: 'what_if' as const,
                        title: 'Explore Cost Optimization Scenarios',
                        description: 'Analyze how different strategies could impact your AI costs and performance',
                        priority: 'medium' as const,
                        potentialSavings: 30.0,
                        effort: 'medium' as const,
                        actions: [
                            'Create a what-if scenario',
                            'Define your optimization goals',
                            'Run scenario analysis'
                        ]
                    },
                    {
                        type: 'model_comparison' as const,
                        title: 'Test Different Model Providers',
                        description: 'Compare models from different providers to find the best value for your needs',
                        priority: 'medium' as const,
                        potentialSavings: 25.0,
                        effort: 'low' as const,
                        actions: [
                            'Compare Amazon vs Anthropic models',
                            'Test different model sizes',
                            'Evaluate cost vs performance trade-offs'
                        ]
                    }
                );
            }

            // Sort by potential savings (highest first)
            return recommendations.sort((a, b) => b.potentialSavings - a.potentialSavings);
        } catch (error: any) {
            loggingService.error('Error getting experiment recommendations:', { error: error instanceof Error ? error.message : String(error) });
            
            throw new Error(`Failed to get experiment recommendations: ${error.message}`);
        }
    }

    /**
     * Private helper methods
     */
    private static async analyzeModelsFromUsageData(userId: string, request: ModelComparisonRequest) {
        try {
            const results = [];
            let totalConfidence = 0;

            // Unified database query to fetch all model usage data at once
            const modelNames = request.models.map(m => m.model);
            const allModelUsage = await Usage.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        $or: modelNames.flatMap(modelName => [
                            { model: modelName }, // Exact match
                            { model: { $regex: modelName, $options: 'i' } } // Fuzzy match
                        ]),
                        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                    }
                },
                {
                    $group: {
                        _id: "$model",
                        avgCost: { $avg: "$cost" },
                        avgTokens: { $avg: "$totalTokens" },
                        avgResponseTime: { $avg: "$responseTime" },
                        totalCalls: { $sum: 1 },
                        totalCost: { $sum: "$cost" },
                        errorCount: {
                            $sum: {
                                $cond: [{ $eq: ["$errorOccurred", true] }, 1, 0]
                            }
                        }
                    }
                }
            ]);

            // Create a map for quick lookup
            const usageMap = new Map();
            allModelUsage.forEach(usage => {
                // Find which requested model this usage data matches
                const matchingModel = modelNames.find(modelName => 
                    usage._id === modelName || 
                    usage._id.toLowerCase().includes(modelName.toLowerCase()) ||
                    modelName.toLowerCase().includes(usage._id.toLowerCase())
                );
                if (matchingModel && !usageMap.has(matchingModel)) {
                    usageMap.set(matchingModel, usage);
                }
            });

            for (const modelRequest of request.models) {
                const usage = usageMap.get(modelRequest.model);
                const pricing = this.getModelPricing(modelRequest.model);

                if (usage) {
                    // Real data from actual usage - but use requested model name for consistency
                    const errorRate = (usage.errorCount / usage.totalCalls) * 100;
                    const confidence = Math.min(usage.totalCalls / 100, 1); // Higher confidence with more data
                    totalConfidence += confidence;

                    results.push({
                        model: modelRequest.model, // Use requested model name, not database model name
                        provider: modelRequest.provider,
                        actualUsage: {
                            totalCalls: usage.totalCalls,
                            avgCost: usage.avgCost,
                            avgTokens: usage.avgTokens,
                            avgResponseTime: usage.avgResponseTime,
                            errorRate: errorRate,
                            totalCost: usage.totalCost
                        },
                        recommendation: this.generateModelRecommendation(usage, errorRate)
                    });
                } else {
                    // No usage data - provide meaningful comparison based on model specs and use case
                    const modelAnalysis = this.analyzeModelWithoutUsageData(modelRequest, pricing, request);
                    
                    results.push({
                        model: modelRequest.model, // Use requested model name
                        provider: modelRequest.provider,
                        noUsageData: true,
                        estimatedCostPer1K: pricing ? (pricing.inputPrice + pricing.outputPrice) / 1000 : 0,
                        recommendation: modelAnalysis.recommendation,
                        analysis: modelAnalysis,
                        pricing: pricing ? {
                            inputCost: pricing.inputPrice / 1000000, // per token
                            outputCost: pricing.outputPrice / 1000000, // per token
                            costPer1K: (pricing.inputPrice + pricing.outputPrice) / 1000,
                            contextWindow: pricing.contextWindow,
                            capabilities: pricing.capabilities
                        } : null
                    });
                }
            }

            // Enhanced overall recommendation considering all models
            const overallRecommendation = this.generateEnhancedOverallRecommendation(results, request);

            // Calculate potential cost savings
            let costSaved = 0;
            if (results.length > 1) {
                const costs = results.map(r => {
                    if (r.actualUsage) {
                        return r.actualUsage.avgCost;
                    } else if (r.estimatedCostPer1K) {
                        return r.estimatedCostPer1K;
                    }
                    return 0;
                }).filter(cost => cost > 0);
                
                if (costs.length > 1) {
                    const maxCost = Math.max(...costs);
                    const minCost = Math.min(...costs);
                    costSaved = maxCost - minCost;
                }
            }

            return {
                modelComparisons: results,
                confidence: totalConfidence / request.models.length,
                basedOnActualUsage: results.filter(r => !r.noUsageData).length,
                recommendation: overallRecommendation.recommendation,
                costComparison: overallRecommendation.costComparison,
                useCaseAnalysis: overallRecommendation.useCaseAnalysis,
                costSaved: costSaved
            };
        } catch (error) {
            loggingService.error('Error analyzing models from usage data:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    private static generateModelRecommendation(usage: any, errorRate: number): string {
        if (errorRate > 5) return "High error rate - consider alternative model";
        if (usage.avgCost > 0.01) return "High cost per request - test cheaper alternatives";
        if (usage.avgResponseTime > 5000) return "Slow response time - consider faster model";
        return "Performing well - good cost/performance balance";
    }

    private static analyzeModelWithoutUsageData(modelRequest: any, pricing: any, request: ModelComparisonRequest) {
        if (!pricing) {
            return {
                recommendation: "Model pricing information not available - unable to provide detailed analysis",
                strengths: [],
                considerations: [],
                useCaseMatch: "unknown"
            };
        }

        const prompt = request.prompt?.toLowerCase() || "";
        const strengths = [];
        const considerations = [];
        let useCaseMatch = "good";
        let recommendation = "";

        // Analyze model capabilities based on name and pricing
        const modelName = modelRequest.model.toLowerCase();
        
        // Size analysis
        if (modelName.includes('mini') || modelName.includes('small')) {
            strengths.push("Fast response times");
            strengths.push("Cost-effective for simple tasks");
            considerations.push("May have limited capabilities for complex tasks");
            
            if (prompt.includes('complex') || prompt.includes('detailed') || prompt.includes('advanced')) {
                useCaseMatch = "fair";
                considerations.push("Consider a larger model for complex tasks");
            }
        } else if (modelName.includes('large') || modelName.includes('pro')) {
            strengths.push("High capability for complex tasks");
            strengths.push("Better reasoning and analysis");
            considerations.push("Higher cost per request");
            
            if (prompt.includes('simple') || prompt.includes('basic')) {
                considerations.push("May be overkill for simple tasks");
            }
        }

        // Use case specific analysis
        if (prompt.includes('marketplace') || prompt.includes('business') || prompt.includes('commerce')) {
            strengths.push("Good for business and commercial use cases");
            if (modelName.includes('mini')) {
                recommendation = "Cost-effective choice for marketplace features like product descriptions and basic customer support";
            } else {
                recommendation = "Excellent for complex marketplace logic, detailed analysis, and advanced features";
            }
        } else if (prompt.includes('creative') || prompt.includes('writing') || prompt.includes('content')) {
            strengths.push("Suitable for creative content generation");
            recommendation = "Good choice for content creation and creative writing tasks";
        } else {
            recommendation = `Suitable for general-purpose tasks. ${modelName.includes('mini') ? 'Cost-effective option.' : 'High-capability option.'}`;
        }

        // Cost analysis
        const costPer1K = (pricing.inputPrice + pricing.outputPrice) / 1000;
        if (costPer1K > 5) {
            considerations.push("Higher cost - ensure the use case justifies the expense");
        } else if (costPer1K < 1) {
            strengths.push("Very cost-effective option");
        }

        return {
            recommendation,
            strengths,
            considerations,
            useCaseMatch,
            costPer1K,
            contextWindow: pricing.contextWindow
        };
    }

    private static generateEnhancedOverallRecommendation(results: any[], request: ModelComparisonRequest) {
        const modelsWithoutUsage = results.filter(r => r.noUsageData);
        
        if (modelsWithoutUsage.length === results.length) {
            // All models have no usage data - provide comparison based on specs
            const costs = modelsWithoutUsage.map(r => r.estimatedCostPer1K).filter(c => c > 0);
            const cheapest = modelsWithoutUsage.find(r => r.estimatedCostPer1K === Math.min(...costs));
            const mostExpensive = modelsWithoutUsage.find(r => r.estimatedCostPer1K === Math.max(...costs));

            let recommendation = "Based on model specifications and pricing: ";
            let costComparison = "";
            let useCaseAnalysis = "";

            if (costs.length > 1 && cheapest && mostExpensive && cheapest !== mostExpensive) {
                const costDiff = ((mostExpensive.estimatedCostPer1K - cheapest.estimatedCostPer1K) / cheapest.estimatedCostPer1K * 100).toFixed(0);
                costComparison = `${mostExpensive.model} costs ${costDiff}% more than ${cheapest.model} per 1K tokens`;
                
                recommendation += `${cheapest.model} is the most cost-effective option, while ${mostExpensive.model} likely offers higher capabilities. `;
            }

            // Use case analysis
            const prompt = request.prompt?.toLowerCase() || "";
            if (prompt.includes('marketplace') || prompt.includes('business')) {
                useCaseAnalysis = "For marketplace development: Start with the cost-effective option for basic features, then upgrade to higher-capability models for complex business logic.";
            } else if (prompt.includes('simple') || prompt.includes('basic')) {
                useCaseAnalysis = "For simple tasks: The cost-effective option should be sufficient.";
            } else {
                useCaseAnalysis = "Consider your complexity requirements vs. cost constraints when choosing.";
            }

            return {
                recommendation: recommendation + useCaseAnalysis,
                costComparison,
                useCaseAnalysis
            };
        }

        // Mixed case - some have usage data
        const withUsage = results.filter(r => !r.noUsageData);
        const bestPerforming = withUsage.reduce((best, current) => 
            current.actualUsage.avgCost < best.actualUsage.avgCost ? current : best
        );

        return {
            recommendation: `Based on actual usage data: ${bestPerforming.model} offers the best cost efficiency`,
            costComparison: "",
            useCaseAnalysis: ""
        };
    }



    // ============================================================================
    // WHAT-IF SCENARIOS METHODS - Real Dynamic Data Based on Usage Analysis
    // ============================================================================

    /**
     * Get what-if scenarios for user (both auto-generated and user-created)
     */
    static async getWhatIfScenarios(userId: string): Promise<any[]> {
        try {
            // Get user-created scenarios from database
            const userCreatedScenarios = await WhatIfScenario.find({
                userId: new mongoose.Types.ObjectId(userId),
                isUserCreated: true
            }).sort({ createdAt: -1 }).lean();

            // Convert database scenarios to expected format
            const scenarios = userCreatedScenarios.map(scenario => ({
                id: scenario._id.toString(),
                name: scenario.name,
                description: scenario.description,
                changes: scenario.changes,
                timeframe: scenario.timeframe,
                baselineData: scenario.baselineData,
                status: scenario.status,
                isUserCreated: scenario.isUserCreated,
                createdAt: scenario.createdAt,
                analysis: scenario.analysis
            }));

            // Then add auto-generated scenarios based on usage analysis
            try {
                const usageAnalysis = await this.analyzeUserUsagePatterns(userId);
                
                if (usageAnalysis.hasData) {
                    try {
                        const modelOptimizationScenario = await this.generateModelOptimizationScenario(usageAnalysis);
                        if (modelOptimizationScenario) {
                            scenarios.push({
                                id: `auto_${Date.now()}_1`,
                                name: modelOptimizationScenario.name,
                                description: modelOptimizationScenario.description,
                                changes: modelOptimizationScenario.changes as any,
                                timeframe: modelOptimizationScenario.timeframe as any,
                                baselineData: modelOptimizationScenario.baselineData,
                                status: 'created' as const,
                                isUserCreated: false,
                                createdAt: new Date(),
                                analysis: undefined
                            });
                        }
                    } catch (error) {
                        loggingService.warn('Failed to generate model optimization scenario:', { error: error instanceof Error ? error.message : String(error) });
                    }

                    try {
                        const volumeScenario = await this.generateVolumeScenario(usageAnalysis);
                        if (volumeScenario) {
                            scenarios.push({
                                id: `auto_${Date.now()}_2`,
                                name: volumeScenario.name,
                                description: volumeScenario.description,
                                changes: volumeScenario.changes as any,
                                timeframe: volumeScenario.timeframe as any,
                                baselineData: volumeScenario.baselineData,
                                status: 'created' as const,
                                isUserCreated: false,
                                createdAt: new Date(),
                                analysis: undefined
                            });
                        }
                    } catch (error) {
                        loggingService.warn('Failed to generate volume scenario:', { error: error instanceof Error ? error.message : String(error) });
                    }

                    try {
                        const cachingScenario = await this.generateCachingScenario(usageAnalysis);
                        if (cachingScenario) {
                            scenarios.push({
                                id: `auto_${Date.now()}_3`,
                                name: cachingScenario.name,
                                description: cachingScenario.description,
                                changes: cachingScenario.changes as any,
                                timeframe: cachingScenario.timeframe as any,
                                baselineData: cachingScenario.baselineData,
                                status: 'created' as const,
                                isUserCreated: false,
                                createdAt: new Date(),
                                analysis: undefined
                            });
                        }
                    } catch (error) {
                        loggingService.warn('Failed to generate caching scenario:', { error: error instanceof Error ? error.message : String(error) });
                    }

                    try {
                        const batchingScenario = await this.generateBatchingScenario(usageAnalysis);
                        if (batchingScenario) {
                            scenarios.push({
                                id: `auto_${Date.now()}_4`,
                                name: batchingScenario.name,
                                description: batchingScenario.description,
                                changes: batchingScenario.changes as any,
                                timeframe: batchingScenario.timeframe as any,
                                baselineData: batchingScenario.baselineData,
                                status: 'created' as const,
                                isUserCreated: false,
                                createdAt: new Date(),
                                analysis: undefined
                            });
                        }
                    } catch (error) {
                        loggingService.warn('Failed to generate batching scenario:', { error: error instanceof Error ? error.message : String(error) });
                    }
                }
            } catch (error) {
                loggingService.warn('Failed to analyze user usage patterns:', { error: error instanceof Error ? error.message : String(error) });
            }

            return scenarios;
        } catch (error) {
            loggingService.error('Error getting what-if scenarios:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Create new what-if scenario and store it
     */
    static async createWhatIfScenario(userId: string, scenarioData: any): Promise<any> {
        try {
            // Check if scenario with same name already exists for this user
            const existingScenario = await WhatIfScenario.findOne({
                userId: new mongoose.Types.ObjectId(userId),
                name: scenarioData.name
            });

            if (existingScenario) {
                // Generate a unique name by adding a timestamp
                const timestamp = Date.now();
                const uniqueName = `${scenarioData.name} (${timestamp})`;
                
                loggingService.info(`Scenario name "${scenarioData.name}" already exists. Using unique name: "${uniqueName}"`);
                scenarioData.name = uniqueName;
            }

            const scenario = {
                userId: new mongoose.Types.ObjectId(userId),
                name: scenarioData.name,
                description: scenarioData.description,
                changes: scenarioData.changes,
                timeframe: scenarioData.timeframe,
                baselineData: scenarioData.baselineData,
                status: 'created' as const,
                isUserCreated: true
            };

            // Save scenario to database
            const savedScenario = new WhatIfScenario(scenario);
            await savedScenario.save();

            loggingService.info(`Created and stored what-if scenario: ${scenarioData.name} for user: ${userId}`);
            
            return {
                id: (savedScenario._id as any).toString(),
                name: savedScenario.name,
                description: savedScenario.description,
                changes: savedScenario.changes,
                timeframe: savedScenario.timeframe,
                baselineData: savedScenario.baselineData,
                status: savedScenario.status,
                isUserCreated: savedScenario.isUserCreated,
                createdAt: savedScenario.createdAt,
                analysis: savedScenario.analysis
            };

        } catch (error: any) {
            // Handle duplicate key error specifically
            if (error.code === 11000 && error.keyPattern && error.keyPattern.name) {
                loggingService.warn(`Duplicate scenario name "${scenarioData.name}" detected. Generating unique name.`);
                
                // Generate a unique name with timestamp
                const timestamp = Date.now();
                const uniqueName = `${scenarioData.name} (${timestamp})`;
                
                // Retry with unique name
                try {
                    const scenarioWithUniqueName = {
                        userId: new mongoose.Types.ObjectId(userId),
                        name: uniqueName,
                        description: scenarioData.description,
                        changes: scenarioData.changes,
                        timeframe: scenarioData.timeframe,
                        baselineData: scenarioData.baselineData,
                        status: 'created' as const,
                        isUserCreated: true
                    };

                    const savedScenario = new WhatIfScenario(scenarioWithUniqueName);
                    await savedScenario.save();

                    loggingService.info(`Created scenario with unique name: ${uniqueName} for user: ${userId}`);
                    
                    return {
                        id: (savedScenario._id as any).toString(),
                        name: savedScenario.name,
                        description: savedScenario.description,
                        changes: savedScenario.changes,
                        timeframe: savedScenario.timeframe,
                        baselineData: savedScenario.baselineData,
                        status: savedScenario.status,
                        isUserCreated: savedScenario.isUserCreated,
                        createdAt: savedScenario.createdAt,
                        analysis: savedScenario.analysis
                    };
                } catch (retryError) {
                    loggingService.error('Error creating scenario with unique name:', { error: retryError instanceof Error ? retryError.message : String(retryError) });
                    throw retryError;
                }
            }
            
            loggingService.error('Error creating what-if scenario:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Real-time What-If Cost Simulator - Enhanced Analysis
     * Supports both strategic scenarios and prompt-level optimizations
     */
    static async runRealTimeWhatIfSimulation(
        simulationRequest: {
            prompt?: string;
            currentModel?: string;
            simulationType: 'prompt_optimization' | 'context_trimming' | 'model_comparison' | 'real_time_analysis';
            options?: {
                trimPercentage?: number;
                alternativeModels?: string[];
                optimizationGoals?: ('cost' | 'speed' | 'quality')[];
            };
        }
    ): Promise<{
        currentCost: any;
        optimizedOptions: any[];
        recommendations: any[];
        potentialSavings: number;
        confidence: number;
    }> {
        try {
            const { prompt, currentModel, simulationType, options = {} } = simulationRequest;
            
            // Initialize results structure
            const results = {
                currentCost: null as any,
                optimizedOptions: [] as any[],
                recommendations: [] as any[],
                potentialSavings: 0,
                confidence: 0
            };

            // For prompt-level optimizations
            if (prompt && currentModel) {
                // Calculate current cost using existing tools
                const currentAnalysis = await this.calculatePromptCost(prompt, currentModel);
                results.currentCost = currentAnalysis;

                // Run parallel optimization paths
                const optimizationPromises = [];

                // Path 1: Context trimming
                if (simulationType === 'context_trimming' || simulationType === 'real_time_analysis') {
                    optimizationPromises.push(this.simulateContextTrimming(prompt, currentModel, options.trimPercentage || 30));
                }

                // Path 2: Model alternatives
                if (simulationType === 'model_comparison' || simulationType === 'real_time_analysis') {
                    const alternativeModels = options.alternativeModels || await this.getAlternativeModels(currentModel);
                    optimizationPromises.push(this.simulateModelAlternatives(prompt, alternativeModels, currentModel));
                }

                // Path 3: Prompt optimization
                if (simulationType === 'prompt_optimization' || simulationType === 'real_time_analysis') {
                    optimizationPromises.push(this.simulatePromptOptimization(prompt, currentModel));
                }

                // Execute all paths in parallel
                const optimizationResults = await Promise.all(optimizationPromises);
                results.optimizedOptions = optimizationResults.flat();

                // Calculate savings and generate recommendations
                results.potentialSavings = this.calculateMaxSavings(results.currentCost, results.optimizedOptions);
                results.recommendations = this.generateRealTimeRecommendations(results.currentCost, results.optimizedOptions);
                results.confidence = this.calculateConfidenceScore(results.optimizedOptions);
            }

            return results;
        } catch (error) {
            loggingService.error('Error in real-time what-if simulation:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Calculate cost for a specific prompt and model
     */
    private static async calculatePromptCost(prompt: string, model: string): Promise<any> {
        // Use existing pricing utilities
        const { getModelPricing } = await import('../data/modelPricing');
        const modelPricing = getModelPricing(model);
        
        if (!modelPricing || modelPricing.length === 0) {
            throw new Error(`Pricing not found for model: ${model}`);
        }

        // Estimate tokens (simplified - could use tiktoken for accuracy)
        const estimatedTokens = Math.ceil(prompt.length / 4); // Rough estimation
        const estimatedCompletionTokens = Math.ceil(estimatedTokens * 0.3); // Assume 30% response
        
        const inputCost = (estimatedTokens / 1000000) * modelPricing[0].inputPrice;
        const outputCost = (estimatedCompletionTokens / 1000000) * modelPricing[0].outputPrice;
        const totalCost = inputCost + outputCost;

        return {
            model,
            inputTokens: estimatedTokens,
            outputTokens: estimatedCompletionTokens,
            totalTokens: estimatedTokens + estimatedCompletionTokens,
            inputCost,
            outputCost,
            totalCost,
            provider: modelPricing[0].provider
        };
    }

    /**
     * Simulate context trimming scenarios
     */
    private static async simulateContextTrimming(prompt: string, model: string, trimPercentage: number): Promise<any[]> {
        const results = [];
        
        // Calculate original cost once for comparison
        const originalCost = await this.calculatePromptCost(prompt, model);
        
        // Generate dynamic trim scenarios based on the provided percentage
        const trimScenarios = [
            Math.max(10, trimPercentage - 10), // Conservative trim
            trimPercentage,                    // Requested trim
            Math.min(70, trimPercentage + 20)  // Aggressive trim
        ].filter((val, index, arr) => arr.indexOf(val) === index); // Remove duplicates

        for (const trim of trimScenarios) {
            const trimmedLength = Math.ceil(prompt.length * (1 - trim / 100));
            const trimmedPrompt = prompt.substring(0, trimmedLength) + "...";
            
            const trimmedCost = await this.calculatePromptCost(trimmedPrompt, model);
            
            const savingsPercentage = ((1 - trimmedCost.totalCost / originalCost.totalCost) * 100);
            const risk = await this.assessOptimizationRisk(
                'context_trimming',
                model,
                undefined,
                trim,
                prompt.length,
                savingsPercentage
            );
            
            results.push({
                type: 'context_trimming',
                description: `Trim context by ${trim}%`,
                originalLength: prompt.length,
                trimmedLength: trimmedLength,
                savings: {
                    tokens: trimmedCost.totalTokens,
                    cost: trimmedCost.totalCost,
                    percentage: savingsPercentage
                },
                risk,
                implementation: 'easy'
            });
        }

        return results;
    }

    /**
     * Simulate alternative models
     */
    private static async simulateModelAlternatives(prompt: string, alternativeModels: string[], currentModel: string): Promise<any[]> {
        const results = [];
        
        // Calculate current model cost once for comparison
        let currentCost;
        try {
            currentCost = await this.calculatePromptCost(prompt, currentModel);
        } catch (error) {
            loggingService.error(`Could not calculate cost for current model ${currentModel}:`, { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
        
        for (const altModel of alternativeModels) {
            try {
                const altCost = await this.calculatePromptCost(prompt, altModel);
                
                const savingsPercentage = ((1 - altCost.totalCost / currentCost.totalCost) * 100);
                const risk = await this.assessOptimizationRisk(
                    'model_switch',
                    currentModel,
                    altModel,
                    undefined,
                    prompt.length,
                    savingsPercentage
                );
                
                results.push({
                    type: 'model_switch',
                    description: `Switch to ${altModel}`,
                    model: altModel,
                    savings: {
                        cost: altCost.totalCost,
                        percentage: savingsPercentage
                    },
                    qualityImpact: await this.estimateQualityImpact(altModel, currentModel),
                    risk,
                    implementation: 'moderate'
                });
            } catch (error) {
                loggingService.warn(`Could not simulate model ${altModel}:`, { error: error instanceof Error ? error.message : String(error) });
            }
        }

        return results.sort((a, b) => b.savings.percentage - a.savings.percentage);
    }

    /**
     * Simulate prompt optimization
     */
    private static async simulatePromptOptimization(prompt: string, model: string): Promise<any[]> {
        // This would integrate with your OptimizationManagerTool
        const optimizationSuggestions = [
            {
                type: 'prompt_optimization',
                description: 'Remove redundant instructions',
                estimatedReduction: 15,
                implementation: 'easy'
            },
            {
                type: 'prompt_optimization', 
                description: 'Use more concise language',
                estimatedReduction: 25,
                implementation: 'moderate'
            }
        ];

        const results = [];
        for (const suggestion of optimizationSuggestions) {
            const optimizedLength = Math.ceil(prompt.length * (1 - suggestion.estimatedReduction / 100));
            const optimizedCost = await this.calculatePromptCost(prompt.substring(0, optimizedLength), model);
            const originalCost = await this.calculatePromptCost(prompt, model);
            
            const savingsPercentage = ((1 - optimizedCost.totalCost / originalCost.totalCost) * 100);
            const risk = await this.assessOptimizationRisk(
                'prompt_optimization',
                model,
                undefined,
                undefined,
                prompt.length,
                savingsPercentage
            );
            
            results.push({
                ...suggestion,
                savings: {
                    cost: optimizedCost.totalCost,
                    percentage: savingsPercentage
                },
                risk
            });
        }

        return results;
    }

    /**
     * Get alternative models for comparison
     */
    private static async getAlternativeModels(currentModel: string): Promise<string[]> {
        const { findCheapestModel, getAvailableBedrickModels } = await import('../data/modelPricing');
        
        try {
            // Get all available Bedrock models
            const availableModels = getAvailableBedrickModels();
            
            // If current model is not in available models, just return some alternatives
            if (!availableModels.includes(currentModel)) {
                return availableModels.slice(0, 4);
            }
            
            // Find cheaper alternatives, excluding current model
            const alternatives = findCheapestModel({
                type: 'api-calls',
                volume: 'medium',
                complexity: 'moderate',
                priority: 'cost'
            });
            
            // Return top 4 alternatives that exist in our pricing data
            if (alternatives) {
                return [alternatives.model].filter((model: string) => availableModels.includes(model) && model !== currentModel);
            }
            return [];
        } catch (error: any) {
            loggingService.error('Error getting alternative models:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error(`Failed to get alternative models: ${error.message}`);
        }
    }

    /**
     * Calculate maximum potential savings (in actual cost, not percentage)
     */
    private static calculateMaxSavings(_currentCost: any, optimizedOptions: any[]): number {
        if (!optimizedOptions.length) return 0;
        
        // Filter out options with negative savings (increased costs)
        const savingsOptions = optimizedOptions.filter(option => (option.savings?.cost || 0) > 0);
        
        if (!savingsOptions.length) return 0;
        
        const bestOption = savingsOptions.reduce((best, option) => {
            const currentSavings = option.savings?.cost || 0;
            const bestSavings = best.savings?.cost || 0;
            return currentSavings > bestSavings ? option : best;
        });
        
        return bestOption.savings?.cost || 0;
    }

    /**
     * Generate real-time recommendations
     */
    private static generateRealTimeRecommendations(_currentCost: any, optimizedOptions: any[]): any[] {
        const recommendations = [];
        
        // Filter out options with negative savings (increased costs) and sort by actual cost savings
        const validOptions = optimizedOptions
            .filter(option => (option.savings?.cost || 0) > 0)
            .sort((a, b) => (b.savings?.cost || 0) - (a.savings?.cost || 0));
        
        // Top 3 recommendations
        for (let i = 0; i < Math.min(3, validOptions.length); i++) {
            const option = validOptions[i];
            recommendations.push({
                priority: i === 0 ? 'high' : i === 1 ? 'medium' : 'low',
                title: option.description,
                savings: option.savings,
                implementation: option.implementation,
                risk: option.risk || 'low',
                action: this.generateActionStep(option)
            });
        }
        
        return recommendations;
    }

    /**
     * Generate specific action steps
     */
    private static generateActionStep(option: any): string {
        switch (option.type) {
            case 'context_trimming':
                return `Reduce prompt length by ${option.description}`;
            case 'model_switch':
                return `Switch to ${option.model} model`;
            case 'prompt_optimization':
                return option.description;
            default:
                return 'Apply optimization';
        }
    }

    /**
     * Calculate confidence score
     */
    private static calculateConfidenceScore(optimizedOptions: any[]): number {
        if (!optimizedOptions.length) return 0;
        
        // Base confidence on number of options and their consistency
        const avgSavings = optimizedOptions.reduce((sum, opt) => sum + (opt.savings?.percentage || 0), 0) / optimizedOptions.length;
        const hasMultipleOptions = optimizedOptions.length > 2;
        const hasLowRiskOptions = optimizedOptions.some(opt => opt.risk === 'low');
        
        let confidence = 60; // Base confidence
        if (avgSavings > 30) confidence += 20;
        if (hasMultipleOptions) confidence += 10;
        if (hasLowRiskOptions) confidence += 10;
        
        return Math.min(100, confidence);
    }

    /**
     * Deterministic risk assessment for optimization strategies
     * Replaces AI-powered assessment to eliminate unnecessary LLM costs
     */
    private static assessOptimizationRisk(
        optimizationType: string,
        currentModel: string,
        newModel?: string,
        trimPercentage?: number,
        promptLength?: number,
        savingsPercentage?: number
    ): 'low' | 'medium' | 'high' {
        // Model switching risk based on capability gap
        if (optimizationType === 'model_switch') {
            const modelTiers: Record<string, number> = {
                'gpt-4': 4,
                'gpt-4-turbo': 4,
                'claude-3-opus': 4,
                'claude-3.5-sonnet': 4,
                'claude-3-sonnet': 3,
                'gpt-3.5-turbo': 3,
                'claude-3-haiku': 3,
                'amazon.nova-pro-v1': 3,
                'gpt-3.5': 2,
                'claude-instant': 2,
                'gpt-3.5-turbo-instruct': 2,
                'amazon.nova-lite-v1': 2,
                'amazon.nova-micro-v1': 1
            };
            
            const currentTier = modelTiers[currentModel] || 2;
            const newTier = newModel ? (modelTiers[newModel] || 2) : 2;
            const tierGap = currentTier - newTier;
            
            if (tierGap >= 2) return 'high';
            if (tierGap === 1) return 'medium';
            return 'low';
        }
        
        // Context trimming risk
        if (optimizationType === 'context_trimming') {
            if (trimPercentage && trimPercentage > 50) return 'high';
            if (trimPercentage && trimPercentage > 30) return 'medium';
            if (promptLength && promptLength > 1000 && trimPercentage && trimPercentage > 20) return 'medium';
            return 'low';
        }
        
        // Prompt optimization risk based on length
        if (optimizationType === 'prompt_optimization') {
            if (promptLength && promptLength > 3000) return 'medium';
            return 'low';
        }
        
        // Batch processing is generally low risk
        if (optimizationType === 'batch_processing') return 'low';
        
        // Default to medium for unknown types
        return 'medium';
    }

    /**
     * Estimate quality impact (simplified)
     */
    private static async estimateQualityImpact(newModel: string, currentModel: string): Promise<string> {
        // This could be enhanced with actual model performance data
        const qualityTiers = {
            'gpt-4': 5,
            'claude-3-opus': 5,
            'gpt-4-turbo': 4,
            'claude-3-sonnet': 4,
            'gpt-3.5-turbo': 3,
            'claude-3-haiku': 3
        };
        
        const currentTier = qualityTiers[currentModel as keyof typeof qualityTiers] || 3;
        const newTier = qualityTiers[newModel as keyof typeof qualityTiers] || 3;
        
        if (newTier >= currentTier) return 'minimal';
        if (newTier === currentTier - 1) return 'low';
        return 'medium';
    }

    /**
     * Run what-if analysis with intelligent projections (Enhanced Legacy Method)
     */
    static async runWhatIfAnalysis(userId: string, scenarioName: string): Promise<any> {
        try {
            // Get user's comprehensive analysis for accurate projections
            let usageAnalysis = await this.analyzeUserUsagePatterns(userId);
            
            // If no usage data available, create a realistic baseline using AI
            if (!usageAnalysis.hasData) {
                usageAnalysis = await this.generateAIBasedUsageAnalysis(scenarioName);
            }

            // Use AI to generate intelligent scenario projections
            const aiAnalysis = await this.generateAIScenarioAnalysis(scenarioName, usageAnalysis);
            
            // Combine AI analysis with mathematical projections for accuracy
            const mathematicalProjections = await this.calculateScenarioProjections(scenarioName, usageAnalysis);
            
            // Merge AI insights with mathematical calculations
            const mergedProjections = this.mergeAIAndMathematicalProjections(aiAnalysis, mathematicalProjections);

            const analysisResult = {
                scenario: { name: scenarioName },
                projectedImpact: {
                    costChange: Math.round(mergedProjections.costChange * 100) / 100,
                    costChangePercentage: Math.round(mergedProjections.costChangePercentage * 100) / 100,
                    performanceChange: mergedProjections.performanceChange,
                    performanceChangePercentage: mergedProjections.performanceChangePercentage,
                    riskLevel: mergedProjections.riskLevel,
                    confidence: mergedProjections.confidence
                },
                breakdown: {
                    currentCosts: mergedProjections.currentBreakdown,
                    projectedCosts: mergedProjections.projectedBreakdown,
                    savingsOpportunities: mergedProjections.savingsOpportunities
                },
                recommendations: mergedProjections.recommendations,
                warnings: mergedProjections.warnings,
                aiInsights: aiAnalysis.insights || []
            };

            // Update the scenario in database with analysis results
            await WhatIfScenario.findOneAndUpdate(
                {
                    userId: new mongoose.Types.ObjectId(userId),
                    name: scenarioName
                },
                {
                    $set: {
                        status: 'analyzed',
                        analysis: analysisResult
                    }
                }
            );

            return analysisResult;

        } catch (error) {
            loggingService.error('Error running what-if analysis:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Generate AI-based usage analysis when no real data is available
     */
    private static async generateAIBasedUsageAnalysis(scenarioName: string): Promise<any> {
        try {
            const prompt = `As an AI cost optimization expert, analyze the scenario "${scenarioName}" and generate realistic baseline usage data for a typical AI application. 

Consider the scenario type and provide realistic estimates for:
- Monthly API calls (based on scenario complexity)
- Average tokens per call
- Current monthly cost
- Error rates
- Response times
- Model distribution

Return a JSON object with this structure:
{
  "hasData": true,
  "current": {
    "totalCost": <realistic_monthly_cost>,
    "totalCalls": <monthly_api_calls>,
    "totalTokens": <total_tokens>,
    "avgResponseTime": <avg_response_time_ms>,
    "errorCount": <error_count>
  },
  "previous": {
    "totalCost": <previous_month_cost>,
    "totalCalls": <previous_month_calls>,
    "totalTokens": <previous_month_tokens>,
    "avgResponseTime": <previous_avg_response_time>,
    "errorCount": <previous_error_count>
  },
  "trends": { "cost": <cost_trend_percentage>, "volume": <volume_trend_percentage> },
  "usagePattern": "<pattern_type>",
  "modelEfficiency": [
    {
      "model": "<model_name>",
      "costPerToken": <cost_per_token>,
      "avgResponseTime": <response_time>,
      "efficiency_score": <efficiency_score>,
      "totalCost": <model_cost>,
      "totalCalls": <model_calls>,
      "share": <cost_share>
    }
  ],
  "costDistribution": {
    "totalCost": <total_cost>,
    "topModel": {
      "model": "<top_model>",
      "cost": <model_cost>,
      "percentage": <percentage>
    },
    "costShares": [
      {
        "model": "<model_name>",
        "cost": <cost>,
        "percentage": <percentage>
      }
    ],
    "isConcentrated": <boolean>,
    "diversityIndex": <diversity_score>
  },
  "avgCostPerCall": <avg_cost_per_call>,
  "avgTokensPerCall": <avg_tokens_per_call>,
  "errorRate": <error_rate>
}

Make the data realistic and consistent with the scenario type.`;

            const response = await this.invokeWithExponentialBackoff(prompt, 'anthropic.claude-3-5-sonnet-20240620-v1:0');
            const jsonResponse = BedrockService.extractJson(response);
            
            try {
                const analysis = JSON.parse(jsonResponse);
                loggingService.info('Generated AI-based usage analysis for scenario:', { value:  {  scenarioName  } });
                return analysis;
            } catch (parseError) {
                loggingService.warn('Failed to parse AI analysis, using fallback data');
                return this.getFallbackUsageAnalysis(scenarioName);
            }
        } catch (error) {
            loggingService.warn('AI analysis failed, using fallback data:', { error: error instanceof Error ? error.message : String(error) });
            return this.getFallbackUsageAnalysis(scenarioName);
        }
    }

    /**
     * Generate AI-powered scenario analysis
     */
    private static async generateAIScenarioAnalysis(scenarioName: string, usageAnalysis: any): Promise<any> {
        try {
            const prompt = `As an AI cost optimization expert, analyze the scenario "${scenarioName}" with the following current usage data:

Current Usage:
- Monthly Cost: $${usageAnalysis.current.totalCost}
- Monthly API Calls: ${usageAnalysis.current.totalCalls}
- Total Tokens: ${usageAnalysis.current.totalTokens}
- Average Response Time: ${usageAnalysis.current.avgResponseTime}ms
- Error Rate: ${(usageAnalysis.errorRate * 100).toFixed(2)}%
- Usage Pattern: ${usageAnalysis.usagePattern}
- Top Model: ${usageAnalysis.costDistribution.topModel.model}

Provide a comprehensive analysis including:
1. Projected cost changes and reasoning
2. Performance impact assessment
3. Risk level and confidence
4. Specific recommendations
5. Potential warnings
6. Implementation insights

Return a JSON object with this structure:
{
  "projectedCost": <projected_monthly_cost>,
  "costChange": <cost_change_amount>,
  "costChangePercentage": <cost_change_percentage>,
  "performanceChange": <performance_change_percentage>,
  "riskLevel": "<low|medium|high>",
  "confidence": <confidence_score_0_to_1>,
  "recommendations": ["<recommendation1>", "<recommendation2>", ...],
  "warnings": ["<warning1>", "<warning2>", ...],
  "insights": ["<insight1>", "<insight2>", ...],
  "implementationComplexity": "<low|medium|high>",
  "timeToImplement": "<estimated_time>",
  "roi": <return_on_investment_percentage>
}

Base your analysis on real-world AI cost optimization patterns and industry best practices.`;

            const response = await this.invokeWithExponentialBackoff(prompt, 'anthropic.claude-3-5-sonnet-20240620-v1:0');
            const jsonResponse = BedrockService.extractJson(response);
            
            try {
                const analysis = JSON.parse(jsonResponse);
                loggingService.info('Generated AI scenario analysis for:', { value:  {  scenarioName  } });
                return analysis;
            } catch (parseError) {
                loggingService.warn('Failed to parse AI scenario analysis, using mathematical projections');
                return null;
            }
        } catch (error) {
            loggingService.warn('AI scenario analysis failed:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    /**
     * Merge AI insights with mathematical projections
     */
    private static mergeAIAndMathematicalProjections(aiAnalysis: any, mathematicalProjections: any): any {
        if (!aiAnalysis) {
            return mathematicalProjections;
        }

        // Use AI analysis as primary, but validate with mathematical projections
        const merged = {
            projectedCost: aiAnalysis.projectedCost || mathematicalProjections.projectedCost,
            costChange: aiAnalysis.costChange || mathematicalProjections.projectedCost - mathematicalProjections.currentBreakdown.total,
            costChangePercentage: aiAnalysis.costChangePercentage || mathematicalProjections.performanceChange,
            performanceChange: aiAnalysis.performanceChange || mathematicalProjections.performanceChange,
            performanceChangePercentage: aiAnalysis.performanceChange || mathematicalProjections.performanceChange,
            riskLevel: aiAnalysis.riskLevel || mathematicalProjections.riskLevel,
            confidence: aiAnalysis.confidence || mathematicalProjections.confidence,
            recommendations: [...(aiAnalysis.recommendations || []), ...(mathematicalProjections.recommendations || [])],
            warnings: [...(aiAnalysis.warnings || []), ...(mathematicalProjections.warnings || [])],
            currentBreakdown: mathematicalProjections.currentBreakdown,
            projectedBreakdown: mathematicalProjections.projectedBreakdown,
            savingsOpportunities: mathematicalProjections.savingsOpportunities,
            insights: aiAnalysis.insights || []
        };

        // Remove duplicates from recommendations and warnings
        merged.recommendations = [...new Set(merged.recommendations)];
        merged.warnings = [...new Set(merged.warnings)];

        return merged;
    }

    /**
     * Fallback usage analysis when AI generation fails
     */
    private static getFallbackUsageAnalysis(scenarioName: string): any {
        // Generate realistic fallback data based on scenario type
        const isHighVolume = scenarioName.toLowerCase().includes('volume') || scenarioName.toLowerCase().includes('scale');
        const isOptimization = scenarioName.toLowerCase().includes('optimization') || scenarioName.toLowerCase().includes('caching');
        
        const baseCost = isHighVolume ? 2500 : (isOptimization ? 800 : 1200);
        const baseCalls = isHighVolume ? 25000 : (isOptimization ? 8000 : 15000);
        
        return {
            hasData: true,
            current: {
                totalCost: baseCost,
                totalCalls: baseCalls,
                totalTokens: baseCalls * 750,
                avgResponseTime: 1800,
                errorCount: Math.floor(baseCalls * 0.015)
            },
            previous: {
                totalCost: baseCost * 0.95,
                totalCalls: baseCalls * 0.95,
                totalTokens: baseCalls * 750 * 0.95,
                avgResponseTime: 1900,
                errorCount: Math.floor(baseCalls * 0.015 * 0.95)
            },
            trends: { cost: 5.26, volume: 5.26 },
            usagePattern: isHighVolume ? 'high_volume' : (isOptimization ? 'efficient' : 'general'),
            modelEfficiency: [
                {
                    model: 'gpt-4',
                    costPerToken: 0.0002,
                    avgResponseTime: 1800,
                    efficiency_score: 3.2,
                    totalCost: baseCost,
                    totalCalls: baseCalls,
                    share: baseCost
                }
            ],
            costDistribution: {
                totalCost: baseCost,
                topModel: {
                    model: 'gpt-4',
                    cost: baseCost,
                    percentage: 100
                },
                costShares: [
                    {
                        model: 'gpt-4',
                        cost: baseCost,
                        percentage: 100
                    }
                ],
                isConcentrated: true,
                diversityIndex: 1
            },
            avgCostPerCall: baseCost / baseCalls,
            avgTokensPerCall: 750,
            errorRate: 0.015
        };
    }

    /**
     * Delete what-if scenario
     */
    static async deleteWhatIfScenario(userId: string, scenarioName: string): Promise<void> {
        try {
            await WhatIfScenario.deleteOne({
                userId: new mongoose.Types.ObjectId(userId),
                name: scenarioName
            });

            loggingService.info(`Deleted what-if scenario: ${scenarioName} for user: ${userId}`);
        } catch (error) {
            loggingService.error('Error deleting what-if scenario:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    // Fine-tuning functionality removed - not core to business focus



    /**
     * Get fine-tuning analysis with intelligent ROI calculations
     */
    static async getFineTuningAnalysis(userId: string, projectId: string): Promise<any> {
        try {
            // Get comprehensive usage analysis for accurate ROI calculation
            const usageAnalysis = await this.analyzeUserUsagePatterns(userId);
            
            if (!usageAnalysis.hasData) {
                throw new Error('Insufficient usage data for fine-tuning analysis');
            }

            // Extract model from project ID
            const modelName = this.extractModelFromProjectId(projectId);
            const modelStats = usageAnalysis.modelEfficiency?.find((m: any) => m.model.includes(modelName));
            
            if (!modelStats) {
                throw new Error('Model not found in usage data');
            }

            // Calculate intelligent ROI based on actual patterns
            const roiAnalysis = await this.calculateIntelligentFineTuningROI(modelStats, usageAnalysis);
            const costBreakdown = await this.generateIntelligentCostBreakdown(roiAnalysis);
            const timeline = this.calculateRealisticTimeline(roiAnalysis, usageAnalysis);
            const riskFactors = this.assessIntelligentRiskFactors(usageAnalysis);

            return {
                projectId,
                roi: roiAnalysis,
                costBreakdown,
                timeline,
                riskFactors,
                recommendations: this.generateProjectRecommendations(roiAnalysis, usageAnalysis),
                dataRequirements: this.calculateDataRequirements(modelStats, usageAnalysis)
            };

        } catch (error) {
            loggingService.error('Error getting fine-tuning analysis:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    // ============================================================================
    // INTELLIGENT FINE-TUNING ANALYSIS METHODS
    // ============================================================================

    /**
     * Calculate intelligent fine-tuning ROI with advanced analysis
     */
    private static async calculateIntelligentFineTuningROI(modelStats: any, usageAnalysis: any) {
        // Calculate training investment based on complexity and volume
        let baseTrainingCost = modelStats.totalCost * 1.2; // Start with 1.2x monthly spend

        // Adjust for complexity
        const complexityMultiplier = this.calculateComplexityMultiplier(usageAnalysis);
        baseTrainingCost *= complexityMultiplier;

        // Adjust for data availability and quality
        const dataQualityMultiplier = this.calculateDataQualityMultiplier(usageAnalysis);
        baseTrainingCost *= dataQualityMultiplier;

        // Cap the investment based on business size
        const maxInvestment = this.calculateMaxInvestmentCap(usageAnalysis);
        const trainingCost = Math.min(baseTrainingCost, maxInvestment);

        // Calculate expected savings based on model type and usage pattern
        const savingsRate = this.calculateExpectedSavingsRate(modelStats, usageAnalysis);
        const monthlySavings = modelStats.totalCost * savingsRate;
        const annualSavings = monthlySavings * 12;

        // Calculate operational costs (hosting, monitoring, maintenance)
        const operationalRate = this.calculateOperationalCostRate(usageAnalysis);
        const annualOperationalCosts = annualSavings * operationalRate;

        // Calculate net present value over 2 years
        const netPresentValue = (annualSavings - annualOperationalCosts) * 2 - trainingCost;
        
        // Calculate payback period
        const paybackPeriod = Math.ceil(trainingCost / monthlySavings);

        // Calculate confidence based on data quality and volume
        const confidence = this.calculateROIConfidence(modelStats, usageAnalysis);

        // Calculate IRR (Internal Rate of Return)
        const irr = this.calculateIRR(trainingCost, monthlySavings - (annualOperationalCosts / 12));

        return {
            initialInvestment: Math.round(trainingCost),
            expectedSavings: Math.round(annualSavings),
            operationalCosts: Math.round(annualOperationalCosts),
            netPresentValue: Math.round(netPresentValue),
            paybackPeriod: Math.max(1, paybackPeriod),
            irr: Math.round(irr * 100) / 100,
            confidence: Math.min(0.95, confidence),
            monthlySavings: Math.round(monthlySavings)
        };
    }

    /**
     * Helper methods for intelligent calculations
     */
    private static calculateComplexityMultiplier(usageAnalysis: any): number {
        switch (usageAnalysis.usagePattern) {
            case 'complex_processing': return 1.4;
            case 'simple_processing': return 0.8;
            case 'high_volume_high_cost': return 1.2;
            default: return 1.0;
        }
    }

    private static calculateDataQualityMultiplier(usageAnalysis: any): number {
        if (usageAnalysis.errorRate < 0.02) return 0.9; // High quality data = lower prep costs
        if (usageAnalysis.errorRate > 0.08) return 1.3; // Poor quality = higher prep costs
        return 1.0;
    }

    private static calculateMaxInvestmentCap(usageAnalysis: any): number {
        // Cap investment at 6 months of current spending or $5000, whichever is lower
        return Math.min(usageAnalysis.current.totalCost * 6, 5000);
    }

    private static calculateExpectedSavingsRate(modelStats: any, usageAnalysis: any): number {
        let baseSavingsRate = 0.35; // Base 35%

        // Adjust for volume (higher volume = better savings)
        if (modelStats.totalCalls > 10000) baseSavingsRate += 0.10;
        else if (modelStats.totalCalls > 5000) baseSavingsRate += 0.05;

        // Adjust for cost efficiency (expensive models = better savings potential)
        if (modelStats.costPerToken > 0.00002) baseSavingsRate += 0.10;
        
        // Adjust for usage pattern
        if (usageAnalysis.usagePattern === 'simple_processing') baseSavingsRate += 0.05;
        if (usageAnalysis.usagePattern === 'complex_processing') baseSavingsRate -= 0.05;

        return Math.min(0.60, baseSavingsRate); // Cap at 60%
    }

    private static calculateOperationalCostRate(usageAnalysis: any): number {
        // Base operational cost is 15% of savings
        let operationalRate = 0.15;

        // Adjust for complexity
        if (usageAnalysis.usagePattern === 'complex_processing') operationalRate += 0.05;
        
        // Adjust for scale (larger scale = lower relative operational costs)
        if (usageAnalysis.current.totalCalls > 10000) operationalRate -= 0.03;

        return operationalRate;
    }

    private static calculateROIConfidence(modelStats: any, usageAnalysis: any): number {
        let confidence = 0.6; // Base confidence

        // Data volume confidence boost
        if (modelStats.totalCalls > 5000) confidence += 0.15;
        else if (modelStats.totalCalls > 2000) confidence += 0.10;
        else if (modelStats.totalCalls > 1000) confidence += 0.05;

        // Error rate confidence adjustment
        if (usageAnalysis.errorRate < 0.02) confidence += 0.10;
        else if (usageAnalysis.errorRate > 0.08) confidence -= 0.10;

        // Usage pattern confidence
        if (usageAnalysis.usagePattern === 'simple_processing') confidence += 0.05;
        if (usageAnalysis.usagePattern === 'complex_processing') confidence -= 0.05;

        // Trend stability
        if (Math.abs(usageAnalysis.trends.volume) < 0.2) confidence += 0.05; // Stable usage

        return confidence;
    }

    private static calculateIRR(investment: number, monthlyCashFlow: number): number {
        // Simplified IRR calculation for monthly cash flows over 24 months
        if (monthlyCashFlow <= 0) return -1;
        
        const months = 24;
        const totalCashFlow = monthlyCashFlow * months;
        
        // Approximate IRR using simple formula
        const irr = (Math.pow(totalCashFlow / investment, 1 / (months / 12)) - 1);
        
        return Math.max(-0.5, Math.min(2.0, irr)); // Cap between -50% and 200%
    }

    private static extractModelFromProjectId(projectId: string): string {
        // Extract model name from project ID
        const parts = projectId.split('_');
        return parts.length > 3 ? parts.slice(3).join(' ').replace(/_/g, '-') : 'unknown';
    }

    private static generateIntelligentCostBreakdown(roiAnalysis: any) {
        const categories = [
            {
                category: 'Training',
                subcategory: 'Compute Resources',
                cost: roiAnalysis.initialInvestment * 0.65,
                percentage: 65,
                description: 'GPU/TPU training infrastructure and compute time'
            },
            {
                category: 'Training',
                subcategory: 'Data Preparation',
                cost: roiAnalysis.initialInvestment * 0.20,
                percentage: 20,
                description: 'Dataset preparation, cleaning, and validation'
            },
            {
                category: 'Operations',
                subcategory: 'Model Hosting',
                cost: roiAnalysis.initialInvestment * 0.10,
                percentage: 10,
                description: 'Model deployment and hosting infrastructure'
            },
            {
                category: 'Operations',
                subcategory: 'Monitoring & Maintenance',
                cost: roiAnalysis.initialInvestment * 0.05,
                percentage: 5,
                description: 'Performance monitoring and model maintenance'
            }
        ];

        return categories;
    }

    private static calculateRealisticTimeline(roiAnalysis: any, usageAnalysis: any) {
        // Calculate timeline based on project complexity and data availability
        const baseWeeks = 4;
        
        let dataPrep = baseWeeks * 0.5;
        let training = baseWeeks * 0.75;
        let evaluation = baseWeeks * 0.25;
        let deployment = baseWeeks * 0.5;

        // Adjust based on complexity
        if (usageAnalysis.usagePattern === 'complex_processing') {
            dataPrep *= 1.5;
            training *= 1.3;
            evaluation *= 1.5;
        }

        // Adjust based on investment size
        if (roiAnalysis.initialInvestment > 2000) {
            training *= 1.2;
            evaluation *= 1.3;
        }

        return {
            dataPreparation: Math.ceil(dataPrep),
            training: Math.ceil(training),
            evaluation: Math.ceil(evaluation),
            deployment: Math.ceil(deployment),
            total: Math.ceil(dataPrep + training + evaluation + deployment)
        };
    }

    private static assessIntelligentRiskFactors(usageAnalysis: any) {
        const factors = [];

        // Data quality risk
        let dataRiskLevel = 'Low';
        if (usageAnalysis.errorRate > 0.05) dataRiskLevel = 'Medium';
        if (usageAnalysis.errorRate > 0.10) dataRiskLevel = 'High';

        factors.push({
            factor: 'Data Quality & Volume',
            level: dataRiskLevel,
            impact: 'High',
            mitigation: usageAnalysis.current.totalCalls > 2000 ? 
                'Sufficient data volume with quality validation processes' :
                'Implement data augmentation and quality improvement processes'
        });

        // Model performance risk
        let performanceRisk = 'Medium';
        if (usageAnalysis.usagePattern === 'simple_processing') performanceRisk = 'Low';
        if (usageAnalysis.usagePattern === 'complex_processing') performanceRisk = 'High';

        factors.push({
            factor: 'Model Performance',
            level: performanceRisk,
            impact: 'High',
            mitigation: 'Comprehensive A/B testing and gradual rollout strategy'
        });

        // Business continuity risk
        factors.push({
            factor: 'Business Continuity',
            level: usageAnalysis.costDistribution.isConcentrated ? 'Medium' : 'Low',
            impact: 'Medium',
            mitigation: 'Maintain fallback to original models during transition period'
        });

        return factors;
    }

    private static generateProjectRecommendations(roiAnalysis: any, usageAnalysis: any) {
        const recommendations = [];

        // Investment recommendations
        if (roiAnalysis.paybackPeriod <= 3) {
            recommendations.push('High-priority project: Excellent ROI with quick payback');
        } else if (roiAnalysis.paybackPeriod <= 6) {
            recommendations.push('Medium-priority: Good ROI but longer payback period');
        } else {
            recommendations.push('Consider delaying until usage volume increases');
        }

        // Technical recommendations
        if (usageAnalysis.usagePattern === 'simple_processing') {
            recommendations.push('Focus on efficiency optimization over capability enhancement');
        } else if (usageAnalysis.usagePattern === 'complex_processing') {
            recommendations.push('Prioritize quality and capability preservation during fine-tuning');
        }

        // Risk mitigation
        if (usageAnalysis.errorRate > 0.05) {
            recommendations.push('Address data quality issues before proceeding with fine-tuning');
        }

        // Scaling recommendations
        if (usageAnalysis.trends.volume > 0.3) {
            recommendations.push('Consider scaling plan as usage is growing rapidly');
        }

        return recommendations;
    }

    private static calculateDataRequirements(modelStats: any, usageAnalysis: any) {
        return {
            minimumSamples: Math.max(500, modelStats.totalCalls * 0.5),
            recommendedSamples: Math.min(10000, modelStats.totalCalls * 2),
            qualityThreshold: usageAnalysis.errorRate < 0.03 ? 95 : 85,
            diversityRequirement: usageAnalysis.usagePattern === 'complex_processing' ? 'high' : 'medium',
            collectionEffort: modelStats.totalCalls > 2000 ? 'low' : 'high'
        };
    }

    /**
     * Create fine-tuning project
     */
    static async createFineTuningProject(userId: string, projectData: any): Promise<any> {
        try {
            const project = {
                id: `ft_project_${Date.now()}`,
                ...projectData,
                userId,
                createdAt: new Date(),
                status: 'planning'
            };

            loggingService.info(`Created fine-tuning project: ${project.name} for user: ${userId}`);
            return project;

        } catch (error) {
            loggingService.error('Error creating fine-tuning project:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Delete fine-tuning project
     */
    static async deleteFineTuningProject(userId: string, projectId: string): Promise<void> {
        try {
            // In production, this would delete from database
            loggingService.info(`Deleted fine-tuning project: ${projectId} for user: ${userId}`);
        } catch (error) {
            loggingService.error('Error deleting fine-tuning project:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    private static async analyzeUserUsagePatterns(userId: string) {
        try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

        // Unified database query using $facet for both current and previous periods
        const [usageAnalysis] = await Usage.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    createdAt: { $gte: sixtyDaysAgo } // Get data for both periods
                }
            },
            {
                $facet: {
                    currentPeriod: [
                        {
                            $match: {
                                createdAt: { $gte: thirtyDaysAgo }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                totalCost: { $sum: "$cost" },
                                totalCalls: { $sum: 1 },
                                totalTokens: { $sum: "$totalTokens" },
                                avgResponseTime: { $avg: "$responseTime" },
                                models: { $addToSet: "$modelName" },
                                providers: { $addToSet: "$provider" },
                                modelUsage: {
                                    $push: {
                                        model: "$modelName",
                                        cost: "$cost",
                                        tokens: "$totalTokens",
                                        responseTime: "$responseTime"
                                    }
                                },
                                errorCount: {
                                    $sum: { $cond: [{ $eq: ["$errorOccurred", true] }, 1, 0] }
                                }
                            }
                        }
                    ],
                    previousPeriod: [
                        {
                            $match: {
                                createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                totalCost: { $sum: "$cost" },
                                totalCalls: { $sum: 1 }
                            }
                        }
                    ]
                }
            }
        ]);

        const currentUsage = usageAnalysis.currentPeriod;
        const previousUsage = usageAnalysis.previousPeriod;

        if (!currentUsage.length) {
            return { hasData: false };
        }

        const current = currentUsage[0];
        const previous = previousUsage[0] || { totalCost: 0, totalCalls: 0 };

        // Calculate trends and patterns
        const costTrend = previous.totalCost > 0 ? (current.totalCost - previous.totalCost) / previous.totalCost : 0;
        const volumeTrend = previous.totalCalls > 0 ? (current.totalCalls - previous.totalCalls) / previous.totalCalls : 0;
        
        // Model efficiency analysis
        const modelEfficiency = this.calculateModelEfficiency(current.modelUsage);
        const costDistribution = this.analyzeCostDistribution(current.modelUsage);
        
        // Usage pattern classification
        const usagePattern = this.classifyUsagePattern(current);
        
        return {
            hasData: true,
            current,
            previous,
            trends: { cost: costTrend, volume: volumeTrend },
            modelEfficiency,
            costDistribution,
            usagePattern,
            avgCostPerCall: current.totalCost / current.totalCalls,
            avgTokensPerCall: current.totalTokens / current.totalCalls,
            errorRate: current.errorCount / current.totalCalls
        };
        } catch (error: any) {
            // If database connection fails or no usage data, return default analysis
            loggingService.warn(`Database connection failed for user ${userId}, using default analysis:`, { error: error.message });
            return { hasData: false };
        }
    }

    /**
     * Calculate model efficiency based on cost per token and performance
     */
    private static calculateModelEfficiency(modelUsage: any[]) {
        const modelStats = new Map();
        
        modelUsage.forEach(usage => {
            if (!modelStats.has(usage.model)) {
                modelStats.set(usage.model, {
                    totalCost: 0,
                    totalTokens: 0,
                    totalCalls: 0,
                    totalResponseTime: 0
                });
            }
            
            const stats = modelStats.get(usage.model);
            stats.totalCost += usage.cost;
            stats.totalTokens += usage.tokens;
            stats.totalCalls += 1;
            stats.totalResponseTime += usage.responseTime || 0;
        });

        // Calculate efficiency metrics for each model
        const efficiency = [];
        for (const [model, stats] of modelStats.entries()) {
            const costPerToken = stats.totalCost / stats.totalTokens;
            const avgResponseTime = stats.totalResponseTime / stats.totalCalls;
            const efficiency_score = 1 / (costPerToken * (avgResponseTime || 1000)); // Higher is better
            
            efficiency.push({
                model,
                costPerToken,
                avgResponseTime,
                efficiency_score,
                totalCost: stats.totalCost,
                totalCalls: stats.totalCalls,
                share: stats.totalCost
            });
        }

        return efficiency.sort((a, b) => b.efficiency_score - a.efficiency_score);
    }

    /**
     * Analyze cost distribution to identify optimization opportunities
     */
    private static analyzeCostDistribution(modelUsage: any[]) {
        const totalCost = modelUsage.reduce((sum, usage) => sum + usage.cost, 0);
        const distribution = new Map();

        modelUsage.forEach(usage => {
            if (!distribution.has(usage.model)) {
                distribution.set(usage.model, 0);
            }
            distribution.set(usage.model, distribution.get(usage.model) + usage.cost);
        });

        const costShares = Array.from(distribution.entries())
            .map(([model, cost]) => ({ model, cost, percentage: (cost / totalCost) * 100 }))
            .sort((a, b) => b.cost - a.cost);

        return {
            totalCost,
            topModel: costShares[0],
            costShares,
            isConcentrated: costShares[0]?.percentage > 60, // 60%+ in single model
            diversityIndex: costShares.length
        };
    }

    /**
     * Classify usage pattern for targeted recommendations
     */
    private static classifyUsagePattern(usage: any) {
        const avgCostPerCall = usage.totalCost / usage.totalCalls;
        const avgTokensPerCall = usage.totalTokens / usage.totalCalls;
        
        // Pattern classification logic
        if (usage.totalCalls > 10000 && avgCostPerCall < 0.01) {
            return 'high_volume_low_cost';
        } else if (usage.totalCalls > 1000 && avgCostPerCall > 0.05) {
            return 'high_volume_high_cost';
        } else if (usage.totalCalls < 500 && avgCostPerCall > 0.10) {
            return 'low_volume_premium';
        } else if (avgTokensPerCall > 3000) {
            return 'complex_processing';
        } else if (avgTokensPerCall < 500) {
            return 'simple_processing';
        } else {
            return 'balanced_usage';
        }
    }

    /**
     * Generate AI-driven model recommendations
     */
    private static async generateModelRecommendations(analysis: any) {
        const recommendations = [];
        
        if (analysis.costDistribution.isConcentrated) {
            const topModel = analysis.costDistribution.topModel;
            const inefficientModel = analysis.modelEfficiency.find((m: any) => m.model === topModel.model);
            
            if (inefficientModel && inefficientModel.efficiency_score < 0.5) { // Below average efficiency
                const potentialSavings = this.calculateModelSwitchPotential(inefficientModel, analysis);
                
                recommendations.push({
                    type: 'model_comparison' as const,
                    title: `Optimize ${topModel.model} usage`,
                    description: `${topModel.model} represents ${topModel.percentage.toFixed(1)}% of costs with low efficiency. Compare with alternatives.`,
                    priority: potentialSavings > analysis.current.totalCost * 0.2 ? 'high' : 'medium' as 'low' | 'medium' | 'high',
                    potentialSavings,
                    effort: 'medium' as const,
                    actions: [
                        `Test alternatives to ${topModel.model}`,
                        'Run A/B tests with cheaper models',
                        'Analyze quality vs cost trade-offs'
                    ]
                });
            }
        }

        return recommendations;
    }

    /**
     * Generate AI-driven optimization recommendations
     */
    private static async generateOptimizationRecommendations(analysis: any) {
        const recommendations = [];

        // Dynamic threshold based on user's usage pattern
        const highVolumeThreshold = Math.max(1000, analysis.current.totalCalls * 0.5);
        
        if (analysis.current.totalCalls > highVolumeThreshold) {
            const cachingPotential = this.calculateCachingPotential(analysis);
            
            if (cachingPotential.savings > analysis.current.totalCost * 0.1) { // >10% potential savings
                recommendations.push({
                    type: 'what_if' as const,
                    title: 'Implement response caching',
                    description: `High call volume (${analysis.current.totalCalls}) with ${cachingPotential.redundancyRate.toFixed(1)}% potential cache hits detected.`,
                    priority: cachingPotential.savings > analysis.current.totalCost * 0.2 ? 'high' : 'medium' as 'low' | 'medium' | 'high',
                    potentialSavings: cachingPotential.savings,
                    effort: 'low' as const,
                    actions: [
                        'Implement response caching layer',
                        'Analyze request patterns for cache optimization',
                        'Monitor cache hit rates'
                    ]
                });
            }
        }

        // Batch processing recommendation
        if (analysis.usagePattern === 'high_volume_low_cost' || analysis.usagePattern === 'simple_processing') {
            const batchingPotential = this.calculateBatchingPotential(analysis);
            
            recommendations.push({
                type: 'what_if' as const,
                title: 'Implement request batching',
                description: `Usage pattern suggests ${batchingPotential.efficiency}% efficiency gain through batching.`,
                priority: 'medium' as const,
                potentialSavings: batchingPotential.savings,
                effort: 'medium' as const,
                actions: [
                    'Group similar requests for batch processing',
                    'Implement async request queuing',
                    'Optimize for throughput over latency'
                ]
            });
        }

        return recommendations;
    }

    /**
     * Calculate model switch potential based on actual market analysis
     */
    private static calculateModelSwitchPotential(modelStats: any, analysis: any) {
        // Find cheaper alternatives with similar capabilities
        const currentPricing = MODEL_PRICING.find(p => 
            p.modelId.includes(modelStats.model) || 
            (p.modelName && modelStats.model && p.modelName.toLowerCase().includes(modelStats.model.toLowerCase()))
        );
        
        if (!currentPricing) return modelStats.totalCost * 0.15; // Conservative estimate
        
        const alternatives = MODEL_PRICING.filter((p: any) => 
            p.category === currentPricing.category && 
            (p.inputPrice + p.outputPrice) < (currentPricing.inputPrice + currentPricing.outputPrice) &&
            p.isLatest
        );
        
        if (alternatives.length > 0) {
     const bestAlternative = alternatives.reduce((best: any, current: any) => 
                (current.inputPrice + current.outputPrice) < (best.inputPrice + best.outputPrice) ? current : best
            );
            
            const savingsRatio = ((currentPricing.inputPrice + currentPricing.outputPrice) - 
                                (bestAlternative.inputPrice + bestAlternative.outputPrice)) / 
                                (currentPricing.inputPrice + currentPricing.outputPrice);
            
            // Account for potential quality degradation
            const qualityRiskFactor = analysis.usagePattern === 'complex_processing' ? 0.7 : 0.9;
            
            return modelStats.totalCost * savingsRatio * qualityRiskFactor;
        }
        
        return modelStats.totalCost * 0.1; // Minimal savings if no clear alternative
    }

    /**
     * Calculate caching potential based on usage patterns
     */
    private static calculateCachingPotential(analysis: any) {
        // Estimate redundancy rate based on usage pattern
        let redundancyRate = 0.15; // Base 15%
        
        switch (analysis.usagePattern) {
            case 'simple_processing':
                redundancyRate = 0.35; // Higher redundancy for simple tasks
                break;
            case 'high_volume_low_cost':
                redundancyRate = 0.25; // Moderate redundancy
                break;
            case 'complex_processing':
                redundancyRate = 0.10; // Lower redundancy for complex tasks
                break;
        }
        
        // Adjust based on call volume (higher volume = better caching potential)
        if (analysis.current.totalCalls > 5000) redundancyRate += 0.05;
        if (analysis.current.totalCalls > 10000) redundancyRate += 0.05;
        
        const savings = analysis.current.totalCost * redundancyRate;
        
        return { redundancyRate, savings };
    }

    /**
     * Calculate batching potential
     */
    private static calculateBatchingPotential(analysis: any) {
        let efficiency = 15; // Base 15% efficiency gain
        
        if (analysis.avgTokensPerCall < 1000) efficiency = 25; // Better for small requests
        if (analysis.current.totalCalls > 5000) efficiency += 5; // Volume bonus
        
        const savings = analysis.current.totalCost * (efficiency / 100);
        
        return { efficiency, savings };
    }

    // ============================================================================
    // INTELLIGENT SCENARIO GENERATION METHODS
    // ============================================================================

    /**
     * Generate model optimization scenario based on usage analysis
     */
    private static async generateModelOptimizationScenario(analysis: any) {
        if (!analysis.costDistribution.isConcentrated) return null;

        const topModel = analysis.costDistribution.topModel;
        const savings = this.calculateModelSwitchPotential({ model: topModel.model, totalCost: topModel.cost }, analysis);
        
        if (savings < analysis.current.totalCost * 0.1) return null; // Less than 10% savings

        const projectedCost = analysis.current.totalCost - savings;
        
        return {
            name: "Model Optimization Switch",
            description: `Switch from ${topModel.model} to cost-effective alternatives. Analysis shows ${savings.toFixed(2)} potential monthly savings.`,
            timeframe: "monthly",
            changes: [
                {
                    type: "model_switch",
                    currentValue: { cost: analysis.current.totalCost, model: topModel.model },
                    proposedValue: { cost: projectedCost, model: "optimized_alternative" },
                    affectedMetrics: ["cost", "performance"],
                    description: `Replace ${topModel.model} with cheaper alternative based on usage pattern analysis`
                }
            ],
            baselineData: {
                cost: analysis.current.totalCost,
                volume: analysis.current.totalCalls,
                performance: this.calculateCurrentPerformanceScore(analysis)
            }
        };
    }

    /**
     * Generate volume scenario based on growth trends
     */
    private static async generateVolumeScenario(analysis: any) {
        // Calculate growth multiplier based on trends
        let growthMultiplier = 2; // Base 2x
        
        if (analysis.trends.volume > 0.5) growthMultiplier = 3; // High growth trend = 3x
        else if (analysis.trends.volume > 0.2) growthMultiplier = 2.5; // Moderate growth = 2.5x
        else if (analysis.trends.volume < -0.1) growthMultiplier = 1.5; // Declining trend = 1.5x

        // Calculate volume pricing efficiency (larger volumes = better rates)
        const volumeDiscountRate = this.calculateVolumeDiscountRate(analysis.current.totalCalls, growthMultiplier);
        const projectedCost = analysis.current.totalCost * growthMultiplier * (1 - volumeDiscountRate);

        return {
            name: `Volume Scale Analysis (${growthMultiplier}x growth)`,
            description: `Analyze cost impact of ${growthMultiplier}x growth from current ${analysis.current.totalCalls} calls. Includes volume discount modeling.`,
            timeframe: "monthly",
            changes: [
                {
                    type: "volume_change",
                    currentValue: { calls: analysis.current.totalCalls, cost: analysis.current.totalCost },
                    proposedValue: { calls: Math.round(analysis.current.totalCalls * growthMultiplier), cost: projectedCost },
                    affectedMetrics: ["cost", "infrastructure", "performance"],
                    description: `Scale to ${Math.round(analysis.current.totalCalls * growthMultiplier)} calls with ${(volumeDiscountRate * 100).toFixed(1)}% volume discount`
                }
            ],
            baselineData: {
                cost: analysis.current.totalCost,
                volume: analysis.current.totalCalls,
                performance: this.calculateCurrentPerformanceScore(analysis)
            }
        };
    }

    /**
     * Generate caching scenario if applicable
     */
    private static async generateCachingScenario(analysis: any) {
        const cachingPotential = this.calculateCachingPotential(analysis);
        
        if (cachingPotential.savings < analysis.current.totalCost * 0.05) return null; // Less than 5% savings
        
        const projectedCost = analysis.current.totalCost - cachingPotential.savings;
        
        return {
            name: "Response Caching Implementation",
            description: `Implement smart caching for ${analysis.current.totalCalls} monthly calls. Estimated ${(cachingPotential.redundancyRate * 100).toFixed(1)}% cache hit rate.`,
            timeframe: "monthly",
            changes: [
                {
                    type: "optimization_applied",
                    currentValue: { cacheHitRate: 0, cost: analysis.current.totalCost },
                    proposedValue: { cacheHitRate: cachingPotential.redundancyRate, cost: projectedCost },
                    affectedMetrics: ["cost", "latency"],
                    description: `${(cachingPotential.redundancyRate * 100).toFixed(1)}% cache hit rate reduces API calls and improves response time`
                }
            ],
            baselineData: {
                cost: analysis.current.totalCost,
                volume: analysis.current.totalCalls,
                performance: this.calculateCurrentPerformanceScore(analysis)
            }
        };
    }

    /**
     * Generate batching scenario if applicable
     */
    private static async generateBatchingScenario(analysis: any) {
        if (analysis.usagePattern !== 'high_volume_low_cost' && analysis.usagePattern !== 'simple_processing') {
            return null; // Not suitable for batching
        }

        const batchingPotential = this.calculateBatchingPotential(analysis);
        const projectedCost = analysis.current.totalCost - batchingPotential.savings;
        
        return {
            name: "Request Batching Optimization",
            description: `Implement request batching for ${analysis.usagePattern} pattern. Estimated ${batchingPotential.efficiency}% efficiency improvement.`,
            timeframe: "monthly",
            changes: [
                {
                    type: "optimization_applied",
                    currentValue: { batchSize: 1, cost: analysis.current.totalCost },
                    proposedValue: { batchSize: this.calculateOptimalBatchSize(analysis), cost: projectedCost },
                    affectedMetrics: ["cost", "throughput"],
                    description: `Batch processing reduces API overhead and improves cost efficiency`
                }
            ],
            baselineData: {
                cost: analysis.current.totalCost,
                volume: analysis.current.totalCalls,
                performance: this.calculateCurrentPerformanceScore(analysis)
            }
        };
    }

    /**
     * Calculate intelligent scenario projections
     */
    private static async calculateScenarioProjections(scenarioName: string, analysis: any) {
        // Base projections on scenario type and user's specific patterns
        let projectedCost = analysis.current.totalCost;
        let performanceChange = 0;
        let riskLevel = 'medium';
        let confidence = 0.7;
        const recommendations = [];
        const warnings = [];

        if (scenarioName.includes('Model Optimization')) {
            const savings = this.calculateModelSwitchPotential(analysis.costDistribution.topModel, analysis);
            projectedCost = analysis.current.totalCost - savings;
            performanceChange = analysis.usagePattern === 'complex_processing' ? -5 : 2; // Complex tasks might lose quality
            riskLevel = analysis.usagePattern === 'complex_processing' ? 'medium' : 'low';
            confidence = analysis.modelEfficiency.length > 1 ? 0.85 : 0.65;
            
            recommendations.push(
                'Start with A/B testing on 10% of traffic',
                'Monitor quality metrics during transition',
                'Prepare rollback plan for critical applications'
            );
            
            if (performanceChange < 0) warnings.push('Quality degradation possible for complex tasks');

        } else if (scenarioName.includes('Volume Scale')) {
            const multiplier = parseFloat(scenarioName.match(/(\d+\.?\d*)x/)?.[1] || '2');
            const volumeDiscountRate = this.calculateVolumeDiscountRate(analysis.current.totalCalls, multiplier);
            projectedCost = analysis.current.totalCost * multiplier * (1 - volumeDiscountRate);
            performanceChange = multiplier > 3 ? -10 : -5; // Higher volume = more latency
            riskLevel = multiplier > 3 ? 'high' : 'medium';
            confidence = 0.8;
            
            recommendations.push(
                'Plan infrastructure scaling in advance',
                'Implement auto-scaling policies',
                'Monitor rate limits and quotas'
            );
            
            warnings.push('Infrastructure scaling required');
            if (multiplier > 3) warnings.push('Significant infrastructure investment needed');

        } else if (scenarioName.includes('Caching')) {
            const cachingPotential = this.calculateCachingPotential(analysis);
            projectedCost = analysis.current.totalCost - cachingPotential.savings;
            performanceChange = 15; // Caching improves performance
            riskLevel = 'low';
            confidence = 0.85;
            
            recommendations.push(
                'Implement cache invalidation strategy',
                'Monitor cache hit rates and adjust TTL',
                'Consider distributed caching for scale'
            );

        } else if (scenarioName.includes('Batching')) {
            const batchingPotential = this.calculateBatchingPotential(analysis);
            projectedCost = analysis.current.totalCost - batchingPotential.savings;
            performanceChange = 10; // Batching improves throughput
            riskLevel = 'low';
            confidence = 0.8;
            
            recommendations.push(
                'Implement async request processing',
                'Optimize batch sizes for your workload',
                'Add proper error handling for batch failures'
            );
        }

        // Generate intelligent cost breakdown
        const currentBreakdown = this.generateCostBreakdown(analysis, false);
        const projectedBreakdown = this.generateCostBreakdown(analysis, true, projectedCost);

        // Generate savings opportunities based on analysis
        const savingsOpportunities = this.generateSavingsOpportunities(analysis, projectedCost);

        return {
            projectedCost,
            performanceChange,
            riskLevel,
            confidence,
            recommendations,
            warnings,
            currentBreakdown,
            projectedBreakdown,
            savingsOpportunities
        };
    }

    /**
     * Calculate volume discount rate based on usage patterns
     */
    private static calculateVolumeDiscountRate(currentVolume: number, multiplier: number): number {
        const projectedVolume = currentVolume * multiplier;
        
        // Volume discount tiers (based on typical API pricing)
        if (projectedVolume > 100000) return 0.15; // 15% discount for enterprise volume
        if (projectedVolume > 50000) return 0.10;  // 10% discount for high volume
        if (projectedVolume > 10000) return 0.05;  // 5% discount for medium volume
        return 0; // No discount for low volume
    }

    /**
     * Calculate current performance score
     */
    private static calculateCurrentPerformanceScore(analysis: any): number {
        let score = 80; // Base score
        
        if (analysis.errorRate < 0.01) score += 10; // Low error rate bonus
        if (analysis.errorRate > 0.05) score -= 15; // High error rate penalty
        
        const avgResponseTime = analysis.current.avgResponseTime || 2000;
        if (avgResponseTime < 1000) score += 5; // Fast response bonus
        if (avgResponseTime > 5000) score -= 10; // Slow response penalty
        
        if (analysis.modelEfficiency.length > 1) {
            const topEfficiency = analysis.modelEfficiency[0].efficiency_score;
            const avgEfficiency = analysis.modelEfficiency.reduce((sum: number, model: any) => sum + model.efficiency_score, 0) / analysis.modelEfficiency.length;
            if (topEfficiency > avgEfficiency * 1.5) score += 5; // Efficiency bonus
        }
        
        return Math.max(60, Math.min(95, score)); // Cap between 60-95
    }

    /**
     * Calculate optimal batch size based on usage patterns
     */
    private static calculateOptimalBatchSize(analysis: any): number {
        const avgTokensPerCall = analysis.avgTokensPerCall || 1000;
        
        if (avgTokensPerCall < 500) return 10; // Small requests = larger batches
        if (avgTokensPerCall < 1500) return 5; // Medium requests = medium batches
        return 3; // Large requests = small batches
    }

    /**
     * Generate intelligent cost breakdown
     */
    private static generateCostBreakdown(analysis: any, isProjected: boolean, projectedCost?: number) {
        const baseCost = isProjected ? (projectedCost || analysis.current.totalCost) : analysis.current.totalCost;
        
        return {
            "API Calls": baseCost * 0.85,
            "Infrastructure": baseCost * 0.10,
            "Monitoring & Analytics": baseCost * 0.03,
            "Other": baseCost * 0.02
        };
    }

    /**
     * Generate savings opportunities based on analysis
     */
    private static generateSavingsOpportunities(analysis: any, projectedCost: number) {
        const totalSavings = analysis.current.totalCost - projectedCost;
        
        return [
            {
                category: "Primary Optimization",
                savings: totalSavings * 0.7,
                effort: 'medium'
            },
            {
                category: "Secondary Improvements",
                savings: totalSavings * 0.2,
                effort: 'low'
            },
            {
                category: "Advanced Optimizations",
                savings: totalSavings * 0.1,
                effort: 'high'
            }
        ];
    }

    /**
     * Utility method to chunk array into smaller batches
     */
    private static chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Execute operation with circuit breaker and timeout
     */
    private static async executeWithCircuitBreaker<T>(
        operation: () => Promise<T>,
        serviceName: string,
        fallback: () => T,
        timeout: number = 10000
    ): Promise<T> {
        if (this.circuitBreaker.isOpen(serviceName)) {
            loggingService.warn(`Circuit breaker open for ${serviceName}, using fallback`);
            return fallback();
        }

        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Operation timeout after ${timeout}ms`)), timeout);
            });

            const result = await Promise.race([operation(), timeoutPromise]);
            return result;
        } catch (error) {
            this.circuitBreaker.recordFailure(serviceName);
            loggingService.error(`Operation failed for ${serviceName}:`, { error: error instanceof Error ? error.message : String(error) });
            return fallback();
        }
    }


    /**
     * Initialize model pricing index for fast O(1) lookups
     */
    private static initializeModelPricingIndex(): void {
        if (this.pricingIndexInitialized) return;

        // Build index from MODEL_PRICING array
        MODEL_PRICING.forEach(pricing => {
            // Add exact model ID
            this.modelPricingIndex.set(pricing.modelId.toLowerCase(), pricing);
            
            // Add model name variations
            if (pricing.modelName) {
                this.modelPricingIndex.set(pricing.modelName.toLowerCase(), pricing);
                // Add without special characters
                const cleanName = pricing.modelName.toLowerCase().replace(/[-_\s]/g, '');
                this.modelPricingIndex.set(cleanName, pricing);
            }
            
            // Add provider-specific variations
            if (pricing.provider) {
                const providerKey = `${pricing.provider.toLowerCase()}-${pricing.modelId.toLowerCase()}`;
                this.modelPricingIndex.set(providerKey, pricing);
            }
        });

        // Add AWS Bedrock pricing
        Object.entries(AWS_BEDROCK_PRICING).forEach(([modelId, pricing]) => {
            const key = modelId.toLowerCase();
            this.modelPricingIndex.set(key, {
                ...pricing,
                modelId,
                modelName: modelId,
                provider: 'aws-bedrock'
            });
        });

        this.pricingIndexInitialized = true;
        loggingService.info(`Initialized model pricing index with ${this.modelPricingIndex.size} entries`);
    }

    /**
     * Fast O(1) model pricing lookup
     */
    private static getModelPricing(modelId: string): any {
        this.initializeModelPricingIndex();
        
        const key = modelId.toLowerCase();
        
        // Try exact match first
        let pricing = this.modelPricingIndex.get(key);
        if (pricing) return pricing;
        
        // Try without special characters
        const cleanKey = key.replace(/[-_\s]/g, '');
        pricing = this.modelPricingIndex.get(cleanKey);
        if (pricing) return pricing;
        
        // Try partial matches
        for (const [indexKey, indexPricing] of Array.from(this.modelPricingIndex.entries())) {
            if (indexKey.includes(cleanKey) || cleanKey.includes(indexKey)) {
                return indexPricing;
            }
        }
        
        return null;
    }


} 