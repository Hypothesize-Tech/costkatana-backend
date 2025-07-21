import { logger } from '../utils/logger';
import { Usage } from '../models/Usage';
import { Optimization } from '../models/Optimization';
import { MODEL_PRICING } from '../utils/pricing';
import mongoose from 'mongoose';
import { BedrockService } from './bedrock.service'; // Add Bedrock integration
import { EventEmitter } from 'events'; // For SSE support

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

            // Execute each model
            for (let i = 0; i < models.length; i++) {
                const model = models[i];
                const progressPercent = Math.round((i / totalModels) * 70); // 70% for execution
                
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
                    results.push(result);
                    completedModels++;

                    // Update progress after each model
                    const newProgress = Math.round((completedModels / totalModels) * 70);
                    this.emitProgress(sessionId, 'executing', newProgress, `Completed ${model.model}`);

                } catch (modelError: any) {
                    logger.error(`Error executing model ${model.model}:`, modelError);
                    
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
                }
            }

            // AI-based evaluation phase (optional - skip if throttled)
            this.emitProgress(sessionId, 'evaluating', 75, 'Running AI evaluation and scoring...');

            let evaluatedResults = results;
            try {
                evaluatedResults = await this.performAIEvaluation(
                    results, 
                    prompt, 
                    evaluationCriteria,
                    request.evaluationPrompt
                );
            } catch (evaluationError: any) {
                logger.warn('AI evaluation skipped due to error:', evaluationError.message);
                this.emitProgress(sessionId, 'evaluating', 85, '⚠️ AI evaluation skipped due to rate limiting - using basic scores');
                // Continue with basic scoring
                evaluatedResults = results.map(result => ({
                    ...result,
                    aiEvaluation: {
                        overallScore: 75,
                        criteriaScores: { accuracy: 75, relevance: 80, completeness: 70 },
                        reasoning: 'AI evaluation was throttled - basic scoring applied',
                        recommendation: 'Manual review recommended'
                    }
                }));
            }

            // Final analysis and recommendations (optional)
            this.emitProgress(sessionId, 'evaluating', 90, 'Generating intelligent recommendations...');

            try {
                await this.generateComparisonAnalysis(evaluatedResults, comparisonMode);
            } catch (analysisError: any) {
                logger.warn('Comparison analysis skipped due to error:', analysisError.message);
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
            logger.error('Error in real-time model comparison:', error);
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
                logger.info(`Mapped ${model.provider}:${model.model} -> ${bedrockModelId}`);
                
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
            logger.error(`Error executing model ${model.model}:`, error);
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
            // Import AWS SDK here to avoid circular dependencies
            const { BedrockClient, ListFoundationModelsCommand } = await import('@aws-sdk/client-bedrock');
            
            const client = new BedrockClient({ 
                region: process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                }
            });
            const command = new ListFoundationModelsCommand({});
            
            const response = await client.send(command);
            
            // Filter for text models that support on-demand inference, exclude embeddings and image models
            const accessibleModels = response.modelSummaries
                ?.filter(model => 
                    model.inferenceTypesSupported?.includes('ON_DEMAND') &&
                    model.outputModalities?.includes('TEXT') &&
                    !model.modelId?.includes('embedding') &&
                    !model.modelId?.includes('canvas') &&
                    !model.modelId?.includes('image') &&
                    model.inputModalities?.includes('TEXT')
                )
                .map(model => {
                    // Find matching pricing info
                    const pricingInfo = MODEL_PRICING.find(p => 
                        p.modelId === model.modelId || 
                        p.modelName.toLowerCase().includes(model.modelName?.toLowerCase() || '')
                    );

                    // Default pricing for common models if not found in MODEL_PRICING
                    let defaultPricing = { input: 0.001, output: 0.005, unit: 'Per 1M tokens' };
                    
                    if (model.modelId?.includes('nova-micro')) {
                        defaultPricing = { input: 0.035, output: 0.14, unit: 'Per 1M tokens' };
                    } else if (model.modelId?.includes('nova-lite')) {
                        defaultPricing = { input: 0.6, output: 2.4, unit: 'Per 1M tokens' };
                    } else if (model.modelId?.includes('nova-pro')) {
                        defaultPricing = { input: 0.8, output: 3.2, unit: 'Per 1M tokens' };
                    } else if (model.modelId?.includes('claude-3-haiku')) {
                        defaultPricing = { input: 0.25, output: 1.25, unit: 'Per 1M tokens' };
                    } else if (model.modelId?.includes('claude-3-5-sonnet')) {
                        defaultPricing = { input: 3, output: 15, unit: 'Per 1M tokens' };
                    } else if (model.modelId?.includes('titan-text-express')) {
                        defaultPricing = { input: 0.2, output: 0.6, unit: 'Per 1M tokens' };
                    }

                    return {
                        provider: model.providerName || 'Unknown',
                        model: model.modelId || '',
                        modelName: model.modelName || model.modelId || '',
                        pricing: pricingInfo ? {
                            input: pricingInfo.inputPrice,
                            output: pricingInfo.outputPrice,
                            unit: pricingInfo.unit || 'Per 1M tokens'
                        } : defaultPricing,
                        capabilities: pricingInfo?.capabilities || ['text'],
                        contextWindow: pricingInfo?.contextWindow || (
                            model.modelId?.includes('nova') ? 300000 : 
                            model.modelId?.includes('claude') ? 200000 : 
                            8192
                        ),
                        category: pricingInfo?.category || 'general',
                        isLatest: true,
                        notes: `Available in your AWS account`
                    };
                }) || [];

            logger.info(`Found ${accessibleModels.length} accessible Bedrock models`);
            return accessibleModels;

        } catch (error) {
            logger.error('Error fetching accessible Bedrock models:', error);
            throw error;
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
        logger.info('Model comparison progress:', progressData);
    }

    /**
     * Helper methods for Bedrock integration
     */
    private static mapToBedrockModelId(modelName: string, provider: string): string {
        // Map frontend model names to WORKING Bedrock model IDs (compatible with on-demand throughput)
        const modelMap: Record<string, string> = {
            // Claude models (use older stable versions that support on-demand)
            'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
            'claude-3-5-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
            'claude-3-opus': 'anthropic.claude-3-opus-20240229-v1:0',
            'claude-3-sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
            'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
            
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
        logger.warn(`Unknown model ${modelName} from ${provider}, falling back to Claude 3.5 Sonnet`);
        return 'anthropic.claude-3-5-sonnet-20240620-v1:0'; // Known working fallback
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
        try {
            // Create evaluation prompt for AI judge
            const evaluationPrompt = customEvaluationPrompt || this.createDefaultEvaluationPrompt(
                originalPrompt, 
                results.map(r => ({ model: r.model, response: r.response })),
                evaluationCriteria
            );

            // Add substantial delay to prevent throttling (AWS Bedrock has strict limits)
            await new Promise(resolve => setTimeout(resolve, 15000)); // Increased delay
            
            let evaluationResponse: string;
            
            // Try with Claude 3.5 Haiku first (lower rate limits) as per user memory
            try {
                logger.info('Attempting evaluation with Claude 3.5 Haiku...');
                evaluationResponse = await this.invokeWithExponentialBackoff(
                    evaluationPrompt,
                    'anthropic.claude-3-5-haiku-20241022-v1:0'
                );
            } catch (haikuError) {
                logger.warn('Claude 3.5 Haiku failed, trying Sonnet with longer delay...', haikuError);
                // Wait even longer before trying Sonnet
                await new Promise(resolve => setTimeout(resolve, 20000));
                evaluationResponse = await this.invokeWithExponentialBackoff(
                    evaluationPrompt,
                    'anthropic.claude-3-5-sonnet-20240620-v1:0'
                );
            }

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
            logger.error('Error performing AI evaluation:', error);
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
                    logger.info(`Retry attempt ${attempt + 1} after ${delay}ms delay...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                
                return await BedrockService.invokeModel(prompt, modelId);
                
            } catch (error: any) {
                lastError = error;
                
                if (error.name === 'ThrottlingException' && attempt < maxRetries - 1) {
                    logger.warn(`Throttling detected, retrying... (attempt ${attempt + 1}/${maxRetries})`);
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
                logger.info('Attempting analysis with Claude 3.5 Haiku...');
                analysisResponse = await this.invokeWithExponentialBackoff(
                    analysisPrompt,
                    'anthropic.claude-3-5-haiku-20241022-v1:0'
                );
            } catch (haikuError) {
                logger.warn('Claude 3.5 Haiku failed for analysis, trying Sonnet...', haikuError);
                // Wait even longer before trying Sonnet
                await new Promise(resolve => setTimeout(resolve, 30000));
                analysisResponse = await this.invokeWithExponentialBackoff(
                    analysisPrompt,
                    'anthropic.claude-3-5-sonnet-20240620-v1:0'
                );
            }

            return JSON.parse(BedrockService.extractJson(analysisResponse));
        } catch (error) {
            logger.error('Error generating comparison analysis:', error);
            
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
            logger.error('Error calculating actual cost:', error);
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
            logger.error('Error simulating model response:', error);
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
            logger.error('Error calculating model metrics:', error);
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
            logger.error('Error calculating cost breakdown:', error);
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
            const cleanedResponse = BedrockService.extractJson(response);
            return JSON.parse(cleanedResponse);
        } catch (error) {
            logger.error('Error parsing evaluation response:', error);
            return results.map(_r => ({
                overallScore: 50,
                criteriaScores: { accuracy: 50, relevance: 50, completeness: 50, coherence: 50 },
                reasoning: 'Evaluation parsing failed',
                recommendation: 'Manual review recommended'
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
            // Get actual optimization history which represents past experiments
            const query: any = {
                userId: new mongoose.Types.ObjectId(userId)
            };

            if (filters.startDate || filters.endDate) {
                query.createdAt = {};
                if (filters.startDate) query.createdAt.$gte = filters.startDate;
                if (filters.endDate) query.createdAt.$lte = filters.endDate;
            }

            const optimizations = await Optimization.find(query)
                .sort({ createdAt: -1 })
                .limit(filters.limit || 20)
                .lean();

            // Convert optimizations to experiment results
            const experiments: ExperimentResult[] = optimizations.map((opt) => {
                const experiment: ExperimentResult = {
                    id: `exp_${opt._id}`,
                    name: `Optimization: ${opt.category || 'Unknown'} - ${opt.model || 'Multiple Models'}`,
                    type: this.getExperimentType(opt.category),
                    status: opt.applied ? 'completed' : 'failed',
                    startTime: opt.createdAt.toISOString(),
                    endTime: opt.appliedAt?.toISOString() || new Date(opt.createdAt.getTime() + 60000).toISOString(),
                    results: {
                        tokensSaved: opt.tokensSaved || 0,
                        costSaved: opt.costSaved || 0,
                        improvementPercentage: opt.improvementPercentage || 0,
                        originalPrompt: opt.originalPrompt?.substring(0, 100) + '...',
                        optimizedPrompt: opt.optimizedPrompt?.substring(0, 100) + '...'
                    },
                    metadata: {
                        duration: opt.appliedAt ? 
                            Math.floor((opt.appliedAt.getTime() - opt.createdAt.getTime()) / 1000) : 60,
                        iterations: 1,
                        confidence: opt.improvementPercentage ? opt.improvementPercentage / 100 : 0.5
                    },
                    userId,
                    createdAt: opt.createdAt
                };

                return experiment;
            });

            // Apply type filter if specified
            if (filters.type) {
                return experiments.filter(exp => exp.type === filters.type);
            }

            return experiments;
        } catch (error) {
            logger.error('Error getting experiment history:', error);
            throw error;
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

            return experiment;
        } catch (error) {
            logger.error('Error running model comparison:', error);
            throw error;
        }
    }

    /**
     * Get experiment by ID
     */
    static async getExperimentById(experimentId: string, userId: string): Promise<ExperimentResult | null> {
        try {
            // Extract optimization ID from experiment ID
            const optimizationId = experimentId.replace('exp_', '');
            
            const optimization = await Optimization.findOne({
                _id: new mongoose.Types.ObjectId(optimizationId),
                userId: new mongoose.Types.ObjectId(userId)
            }).lean();

            if (!optimization) {
                return null;
            }

            return {
                id: experimentId,
                name: `Optimization: ${optimization.category || 'Unknown'} - ${optimization.model || 'Multiple Models'}`,
                type: this.getExperimentType(optimization.category),
                status: optimization.applied ? 'completed' : 'failed',
                startTime: optimization.createdAt.toISOString(),
                endTime: optimization.appliedAt?.toISOString() || new Date(optimization.createdAt.getTime() + 60000).toISOString(),
                results: {
                    tokensSaved: optimization.tokensSaved || 0,
                    costSaved: optimization.costSaved || 0,
                    improvementPercentage: optimization.improvementPercentage || 0,
                    originalPrompt: optimization.originalPrompt,
                    optimizedPrompt: optimization.optimizedPrompt,
                    feedback: optimization.feedback
                },
                metadata: {
                    duration: optimization.appliedAt ? 
                        Math.floor((optimization.appliedAt.getTime() - optimization.createdAt.getTime()) / 1000) : 60,
                    iterations: 1,
                    confidence: optimization.improvementPercentage ? optimization.improvementPercentage / 100 : 0.5
                },
                userId,
                createdAt: optimization.createdAt
            };
        } catch (error) {
            logger.error('Error getting experiment by ID:', error);
            throw error;
        }
    }

    /**
     * Delete experiment
     */
    static async deleteExperiment(experimentId: string, userId: string): Promise<void> {
        try {
            // Extract optimization ID and delete the actual optimization record
            const optimizationId = experimentId.replace('exp_', '');
            
            await Optimization.deleteOne({
                _id: new mongoose.Types.ObjectId(optimizationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            logger.info(`Deleted experiment ${experimentId} for user ${userId}`);
        } catch (error) {
            logger.error('Error deleting experiment:', error);
            throw error;
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
            logger.error('Error estimating experiment cost:', error);
            throw error;
        }
    }

    /**
     * Get experiment recommendations based on actual user data
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
            
            if (!usageAnalysis.hasData) {
                return []; // No usage data, no recommendations
            }

            // AI-driven recommendation generation based on usage patterns
            const modelRecommendations = await this.generateModelRecommendations(usageAnalysis);
            const optimizationRecommendations = await this.generateOptimizationRecommendations(usageAnalysis);
            const fineTuningRecommendations = await this.generateFineTuningRecommendations(usageAnalysis);

            recommendations.push(...modelRecommendations, ...optimizationRecommendations, ...fineTuningRecommendations);

            // Sort by potential savings (highest first)
            return recommendations.sort((a, b) => b.potentialSavings - a.potentialSavings);
        } catch (error) {
            logger.error('Error getting experiment recommendations:', error);
            throw error;
        }
    }

    /**
     * Private helper methods
     */
    private static getExperimentType(optimizationCategory?: string): 'model_comparison' | 'what_if' | 'fine_tuning' {
        if (optimizationCategory?.includes('model_selection')) return 'model_comparison';
        if (optimizationCategory?.includes('batch_processing')) return 'what_if';
        return 'model_comparison'; // default
    }

    private static async analyzeModelsFromUsageData(userId: string, request: ModelComparisonRequest) {
        try {
            const results = [];
            let totalConfidence = 0;

            for (const modelRequest of request.models) {
                // Get actual usage data for this model (exact match first, then fuzzy match)
                const modelUsage = await Usage.aggregate([
                    {
                        $match: {
                            userId: new mongoose.Types.ObjectId(userId),
                            $or: [
                                { model: modelRequest.model }, // Exact match first
                                { model: { $regex: modelRequest.model, $options: 'i' } } // Fallback to regex
                            ],
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
                    },
                    { $limit: 1 } // Take the first match (exact match will be prioritized)
                ]);

                const usage = modelUsage[0];
                const pricing = MODEL_PRICING.find(p => 
                    p.modelId === modelRequest.model || 
                    p.modelName.toLowerCase().includes(modelRequest.model.toLowerCase())
                );

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

            return {
                modelComparisons: results,
                confidence: totalConfidence / request.models.length,
                basedOnActualUsage: results.filter(r => !r.noUsageData).length,
                recommendation: overallRecommendation.recommendation,
                costComparison: overallRecommendation.costComparison,
                useCaseAnalysis: overallRecommendation.useCaseAnalysis
            };
        } catch (error) {
            logger.error('Error analyzing models from usage data:', error);
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
     * Get all what-if scenarios for a user
     */
    static async getWhatIfScenarios(userId: string): Promise<any[]> {
        try {
            // Get comprehensive usage analysis for intelligent scenario generation
            const usageAnalysis = await this.analyzeUserUsagePatterns(userId);
            
            if (!usageAnalysis.hasData) {
                return []; // No usage data, no scenarios
            }

            const scenarios: any[] = [];

            // Generate scenarios based on intelligent analysis
            const modelOptimizationScenario = await this.generateModelOptimizationScenario(usageAnalysis);
            if (modelOptimizationScenario) scenarios.push(modelOptimizationScenario);

            const volumeScenario = await this.generateVolumeScenario(usageAnalysis);
            if (volumeScenario) scenarios.push(volumeScenario);

            const cachingScenario = await this.generateCachingScenario(usageAnalysis);
            if (cachingScenario) scenarios.push(cachingScenario);

            const batchingScenario = await this.generateBatchingScenario(usageAnalysis);
            if (batchingScenario) scenarios.push(batchingScenario);

            return scenarios;

        } catch (error) {
            logger.error('Error getting what-if scenarios:', error);
            throw error;
        }
    }

    /**
     * Create new what-if scenario
     */
    static async createWhatIfScenario(userId: string, scenarioData: any): Promise<any> {
        try {
            // For now, return the created scenario with generated ID
            // In production, this would save to database
            const scenario = {
                id: `scenario_${Date.now()}`,
                ...scenarioData,
                userId,
                createdAt: new Date(),
                status: 'created'
            };

            logger.info(`Created what-if scenario: ${scenario.name} for user: ${userId}`);
            return scenario;

        } catch (error) {
            logger.error('Error creating what-if scenario:', error);
            throw error;
        }
    }

    /**
     * Run what-if analysis with intelligent projections
     */
    static async runWhatIfAnalysis(userId: string, scenarioName: string): Promise<any> {
        try {
            // Get user's comprehensive analysis for accurate projections
            const usageAnalysis = await this.analyzeUserUsagePatterns(userId);
            
            if (!usageAnalysis.hasData) {
                throw new Error('Insufficient usage data for analysis');
            }

            // Generate intelligent projections based on scenario and user patterns
            const projections = await this.calculateScenarioProjections(scenarioName, usageAnalysis);

            const costChange = projections.projectedCost - usageAnalysis.current.totalCost;
            const costChangePercentage = (costChange / usageAnalysis.current.totalCost) * 100;

            return {
                scenario: { name: scenarioName },
                projectedImpact: {
                    costChange: Math.round(costChange * 100) / 100,
                    costChangePercentage: Math.round(costChangePercentage * 100) / 100,
                    performanceChange: projections.performanceChange,
                    performanceChangePercentage: projections.performanceChange,
                    riskLevel: projections.riskLevel,
                    confidence: projections.confidence
                },
                breakdown: {
                    currentCosts: projections.currentBreakdown,
                    projectedCosts: projections.projectedBreakdown,
                    savingsOpportunities: projections.savingsOpportunities
                },
                recommendations: projections.recommendations,
                warnings: projections.warnings
            };

        } catch (error) {
            logger.error('Error running what-if analysis:', error);
            throw error;
        }
    }

    /**
     * Delete what-if scenario
     */
    static async deleteWhatIfScenario(userId: string, scenarioName: string): Promise<void> {
        try {
            // In production, this would delete from database
            logger.info(`Deleted what-if scenario: ${scenarioName} for user: ${userId}`);
        } catch (error) {
            logger.error('Error deleting what-if scenario:', error);
            throw error;
        }
    }

    // ============================================================================
    // FINE-TUNING PROJECTS METHODS - Real ROI Analysis Based on Usage Data
    // ============================================================================

    /**
     * Get fine-tuning projects with intelligent cost analysis
     */
    static async getFineTuningProjects(userId: string): Promise<any[]> {
        try {
            // Get comprehensive usage analysis for intelligent project generation
            const usageAnalysis = await this.analyzeUserUsagePatterns(userId);
            
            if (!usageAnalysis.hasData) {
                return []; // No usage data, no projects
            }

            const projects: any[] = [];

            // Generate projects based on intelligent analysis
            if (usageAnalysis.modelEfficiency) {
                for (const modelStats of usageAnalysis.modelEfficiency) {
                    const project = await this.generateFineTuningProject(modelStats, usageAnalysis);
                    if (project) projects.push(project);
                }
            }

            // If no viable projects from analysis, create one realistic example
            if (projects.length === 0 && usageAnalysis.current.totalCost > 50) {
                const exampleProject = await this.generateExampleFineTuningProject(usageAnalysis);
                projects.push(exampleProject);
            }

            return projects.sort((a, b) => b.roi.projectedSavings - a.roi.projectedSavings); // Sort by potential savings

        } catch (error) {
            logger.error('Error getting fine-tuning projects:', error);
            throw error;
        }
    }

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
            logger.error('Error getting fine-tuning analysis:', error);
            throw error;
        }
    }

    // ============================================================================
    // INTELLIGENT FINE-TUNING ANALYSIS METHODS
    // ============================================================================

    /**
     * Generate intelligent fine-tuning project based on model performance
     */
    private static async generateFineTuningProject(modelStats: any, usageAnalysis: any) {
        const fineTuningThreshold = this.calculateFineTuningThreshold(usageAnalysis);
        
        // Check if model qualifies for fine-tuning
        if (modelStats.totalCost < fineTuningThreshold.costThreshold || 
            modelStats.totalCalls < fineTuningThreshold.volumeThreshold) {
            return null;
        }

        // Calculate intelligent ROI
        const roiAnalysis = await this.calculateIntelligentFineTuningROI(modelStats, usageAnalysis);
        
        // Only suggest if ROI is favorable
        if (roiAnalysis.paybackPeriod > 8 || roiAnalysis.confidence < 0.6) {
            return null;
        }

        // Generate intelligent project details
        const trainingData = this.calculateTrainingDataRequirements(modelStats, usageAnalysis);
        const infrastructure = this.calculateInfrastructureRequirements(modelStats, usageAnalysis);
        const costs = this.calculateProjectCosts(roiAnalysis);
        const performance = this.projectPerformanceMetrics(modelStats, usageAnalysis);

        return {
            id: `ft_project_${Date.now()}_${modelStats.model.replace(/[^a-zA-Z0-9]/g, '_')}`,
            name: `${modelStats.model} Fine-Tuning Initiative`,
            baseModel: modelStats.model,
            status: 'planning',
            trainingData,
            infrastructure,
            costs,
            performance,
            roi: {
                paybackMonths: roiAnalysis.paybackPeriod,
                projectedSavings: roiAnalysis.expectedSavings,
                confidence: roiAnalysis.confidence > 0.8 ? 'high' : 'medium'
            },
            priority: this.calculateProjectPriority(roiAnalysis)
        };
    }

    /**
     * Generate example project when no models qualify but user has spending
     */
    private static async generateExampleFineTuningProject(usageAnalysis: any) {
        const primaryModel = usageAnalysis.costDistribution.topModel;
        const estimatedROI = await this.calculateIntelligentFineTuningROI(
            { model: primaryModel.model, totalCost: primaryModel.cost, totalCalls: usageAnalysis.current.totalCalls / 2 },
            usageAnalysis
        );

        return {
            id: `ft_project_${Date.now()}_example`,
            name: `${primaryModel.model} Custom Model (Future Opportunity)`,
            baseModel: primaryModel.model,
            status: 'concept',
            trainingData: {
                size: Math.min(usageAnalysis.current.totalCalls, 5000),
                quality: 'medium',
                preprocessingCost: estimatedROI.initialInvestment * 0.15
            },
            infrastructure: {
                computeType: usageAnalysis.usagePattern === 'complex_processing' ? 'gpu-premium' : 'gpu-standard',
                estimatedTrainingTime: Math.ceil(estimatedROI.initialInvestment / 100), // $100/hour estimate
                parallelization: usageAnalysis.current.totalCalls > 5000
            },
            costs: {
                training: Math.round(estimatedROI.initialInvestment * 0.7),
                hosting: Math.round(estimatedROI.initialInvestment * 0.15),
                inference: Math.round(primaryModel.cost * 0.6),
                storage: Math.round(estimatedROI.initialInvestment * 0.05),
                total: Math.round(estimatedROI.initialInvestment)
            },
            performance: {
                accuracy: 75 + (usageAnalysis.current.totalCalls / 1000) * 2, // More data = better accuracy
                f1Score: 0.7 + (usageAnalysis.current.totalCalls / 10000) * 0.1,
                latency: Math.max(100, 300 - (usageAnalysis.current.totalCalls / 100)),
                throughput: Math.round(usageAnalysis.current.totalCalls * 1.1)
            },
            roi: {
                paybackMonths: estimatedROI.paybackPeriod,
                projectedSavings: estimatedROI.expectedSavings,
                confidence: 'medium'
            },
            priority: 'medium',
            note: 'Conceptual project - requires higher volume for viability'
        };
    }

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
     * Calculate training data requirements based on usage patterns
     */
    private static calculateTrainingDataRequirements(modelStats: any, usageAnalysis: any) {
        // Base data size on call volume and complexity
        let dataSize = Math.min(modelStats.totalCalls * 2, 15000); // Cap at 15k samples
        
        // Adjust for usage pattern
        if (usageAnalysis.usagePattern === 'complex_processing') dataSize *= 1.5;
        if (usageAnalysis.usagePattern === 'simple_processing') dataSize *= 0.8;

        // Quality assessment
        let quality: 'low' | 'medium' | 'high' = 'medium';
        if (usageAnalysis.errorRate < 0.02 && modelStats.totalCalls > 2000) quality = 'high';
        else if (usageAnalysis.errorRate > 0.08 || modelStats.totalCalls < 500) quality = 'low';

        // Preprocessing cost
        const preprocessingCost = dataSize * (quality === 'high' ? 0.15 : quality === 'medium' ? 0.10 : 0.05);

        return {
            size: Math.round(dataSize),
            quality,
            preprocessingCost: Math.round(preprocessingCost),
            dataCollectionEffort: modelStats.totalCalls > 1000 ? 'low' : 'medium'
        };
    }

    /**
     * Calculate infrastructure requirements intelligently
     */
    private static calculateInfrastructureRequirements(modelStats: any, usageAnalysis: any) {
        // Determine compute type based on model complexity and volume
        let computeType = 'gpu-standard';
        if (usageAnalysis.usagePattern === 'complex_processing' || modelStats.totalCost > 500) {
            computeType = 'gpu-premium';
        } else if (usageAnalysis.usagePattern === 'simple_processing' && modelStats.totalCost < 100) {
            computeType = 'gpu-basic';
        }

        // Estimate training time based on data size and complexity
        const complexityFactor = usageAnalysis.usagePattern === 'complex_processing' ? 2 : 1;
        const trainingHours = Math.ceil((modelStats.totalCalls / 100) * complexityFactor);

        // Determine if parallelization is beneficial
        const parallelization = trainingHours > 20 || modelStats.totalCost > 300;

        return {
            computeType,
            estimatedTrainingTime: trainingHours,
            parallelization,
            resourceOptimization: this.calculateResourceOptimization(usageAnalysis)
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

    private static calculateProjectCosts(roiAnalysis: any) {
        const training = Math.round(roiAnalysis.initialInvestment * 0.65);
        const hosting = Math.round(roiAnalysis.initialInvestment * 0.15);
        const inference = Math.round(roiAnalysis.monthlySavings * 0.4); // Reduced inference costs
        const storage = Math.round(roiAnalysis.initialInvestment * 0.08);

        return {
            training,
            hosting,
            inference,
            storage,
            total: training + hosting + inference + storage
        };
    }

    private static projectPerformanceMetrics(modelStats: any, usageAnalysis: any) {
        // Project performance improvements based on data
        const baseAccuracy = 80;
        let accuracy = baseAccuracy + (modelStats.totalCalls / 1000) * 1.5; // More data = better accuracy
        accuracy = Math.min(95, Math.max(75, accuracy));

        const f1Score = (accuracy / 100) * 0.9; // F1 typically 90% of accuracy
        
        // Latency improvement through optimization
        const currentLatency = usageAnalysis.current.avgResponseTime || 2000;
        const latency = Math.round(currentLatency * 0.85); // 15% improvement

        // Throughput based on optimization
        const throughput = Math.round(modelStats.totalCalls * 1.25); // 25% improvement

        return {
            accuracy: Math.round(accuracy),
            f1Score: Math.round(f1Score * 100) / 100,
            latency,
            throughput
        };
    }

    private static calculateProjectPriority(roiAnalysis: any): 'low' | 'medium' | 'high' {
        if (roiAnalysis.paybackPeriod <= 3 && roiAnalysis.confidence > 0.8) return 'high';
        if (roiAnalysis.paybackPeriod <= 6 && roiAnalysis.confidence > 0.7) return 'medium';
        return 'low';
    }

    private static calculateResourceOptimization(usageAnalysis: any): string {
        if (usageAnalysis.usagePattern === 'high_volume_low_cost') return 'throughput_optimized';
        if (usageAnalysis.usagePattern === 'complex_processing') return 'quality_optimized';
        return 'balanced';
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

            logger.info(`Created fine-tuning project: ${project.name} for user: ${userId}`);
            return project;

        } catch (error) {
            logger.error('Error creating fine-tuning project:', error);
            throw error;
        }
    }

    /**
     * Delete fine-tuning project
     */
    static async deleteFineTuningProject(userId: string, projectId: string): Promise<void> {
        try {
            // In production, this would delete from database
            logger.info(`Deleted fine-tuning project: ${projectId} for user: ${userId}`);
        } catch (error) {
            logger.error('Error deleting fine-tuning project:', error);
            throw error;
        }
    }

    private static async analyzeUserUsagePatterns(userId: string) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

        // Current period analysis
        const currentUsage = await Usage.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
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
        ]);

        // Previous period for trend analysis
        const previousUsage = await Usage.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
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
        ]);

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
     * Generate AI-driven fine-tuning recommendations
     */
    private static async generateFineTuningRecommendations(analysis: any) {
        const recommendations = [];

        // Dynamic fine-tuning threshold based on usage pattern
        const fineTuningThreshold = this.calculateFineTuningThreshold(analysis);
        
        if (analysis.current.totalCost > fineTuningThreshold.costThreshold && 
            analysis.current.totalCalls > fineTuningThreshold.volumeThreshold) {
            
            const fineTuningROI = await this.calculateFineTuningROI(analysis);
            
            if (fineTuningROI.paybackMonths <= 6 && fineTuningROI.confidence > 0.7) {
                recommendations.push({
                    type: 'fine_tuning' as const,
                    title: `Fine-tune custom model for ${fineTuningROI.candidateModel}`,
                    description: `Usage pattern shows ${fineTuningROI.paybackMonths}-month payback with ${(fineTuningROI.confidence * 100).toFixed(0)}% confidence.`,
                    priority: fineTuningROI.paybackMonths <= 3 ? 'high' : 'medium' as 'low' | 'medium' | 'high',
                    potentialSavings: fineTuningROI.annualSavings,
                    effort: 'high' as const,
                    actions: [
                        'Prepare training dataset from usage logs',
                        'Calculate detailed training costs',
                        'Plan gradual model deployment'
                    ]
                });
            }
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
            p.modelName.toLowerCase().includes(modelStats.model.toLowerCase())
        );
        
        if (!currentPricing) return modelStats.totalCost * 0.15; // Conservative estimate
        
        const alternatives = MODEL_PRICING.filter(p => 
            p.category === currentPricing.category && 
            (p.inputPrice + p.outputPrice) < (currentPricing.inputPrice + currentPricing.outputPrice) &&
            p.isLatest
        );
        
        if (alternatives.length > 0) {
            const bestAlternative = alternatives.reduce((best, current) => 
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

    /**
     * Calculate dynamic fine-tuning threshold based on user patterns
     */
    private static calculateFineTuningThreshold(analysis: any) {
        // Base thresholds
        let costThreshold = 200; // Base $200/month
        let volumeThreshold = 2000; // Base 2000 calls/month
        
        // Adjust based on usage pattern
        switch (analysis.usagePattern) {
            case 'high_volume_high_cost':
                costThreshold = 100; // Lower threshold for expensive usage
                volumeThreshold = 1000;
                break;
            case 'complex_processing':
                costThreshold = 300; // Higher threshold for complex tasks
                volumeThreshold = 1500;
                break;
            case 'simple_processing':
                costThreshold = 150; // Moderate threshold for simple tasks
                volumeThreshold = 3000; // But need higher volume
                break;
        }
        
        return { costThreshold, volumeThreshold };
    }

    /**
     * Calculate fine-tuning ROI with intelligent analysis
     */
    private static async calculateFineTuningROI(analysis: any) {
        // Find the most expensive model as fine-tuning candidate
        const candidateModel = analysis.modelEfficiency[analysis.modelEfficiency.length - 1]; // Least efficient
        
        // Calculate training cost based on usage volume and complexity
        let trainingCost = Math.min(candidateModel.totalCost * 1.5, 2500); // Dynamic cap
        
        // Adjust for complexity
        if (analysis.usagePattern === 'complex_processing') trainingCost *= 1.3;
        if (analysis.usagePattern === 'simple_processing') trainingCost *= 0.8;
        
        // Calculate expected savings (varies by model type and usage)
        let savingsRate = 0.35; // Base 35%
        if (analysis.current.totalCalls > 10000) savingsRate = 0.45; // Higher savings for volume
        if (candidateModel.costPerToken > 0.00001) savingsRate = 0.50; // Higher savings for expensive models
        
        const annualSavings = candidateModel.totalCost * 12 * savingsRate;
        const paybackMonths = Math.ceil(trainingCost / (candidateModel.totalCost * savingsRate));
        
        // Calculate confidence based on data quality
        let confidence = 0.6; // Base confidence
        if (analysis.current.totalCalls > 5000) confidence += 0.1;
        if (analysis.current.totalCalls > 10000) confidence += 0.1;
        if (analysis.errorRate < 0.05) confidence += 0.1; // Low error rate
        if (analysis.usagePattern === 'simple_processing') confidence += 0.05; // Simpler = more predictable
        
        return {
            candidateModel: candidateModel.model,
            trainingCost,
            annualSavings,
            paybackMonths,
            confidence: Math.min(confidence, 0.95) // Cap at 95%
        };
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
} 