import { ProjectService } from './project.service';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { ActivityService } from './activity.service';
import { RealtimeUpdateService } from './realtime-update.service';
import {
    AIProvider,
    OptimizationResult,
    TrackerConfig,
    ProviderConfig,
    OptimizationConfig,
    TrackingConfig
} from '../types/aiCostTracker.types';
import { calculateCost, estimateCost, getModelPricing } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';
import { generateOptimizationSuggestions, applyOptimizations } from '../utils/optimizationUtils';
import { loggingService } from './logging.service';

// Circuit breaker for resilience
class CircuitBreaker {
    private failures = 0;
    private lastFailureTime = 0;
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private readonly failureThreshold = 5;
    private readonly timeout = 60000; // 1 minute

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = 'HALF_OPEN';
            } else {
                throw new Error('Circuit breaker is OPEN');
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;
        this.state = 'CLOSED';
    }

    private onFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }
}

// Import BullMQ-based DeadLetterQueue
import { DeadLetterQueue } from '../queues/deadLetter.queue';

export class AICostTrackerService {
    private static config: TrackerConfig | null = null;
    private static initialized = false;
    private static configPromise: Promise<TrackerConfig> | null = null;
    private static circuitBreaker = new CircuitBreaker();
    private static deadLetterQueueInitialized = false;
    
    // Pre-computed provider mappings for performance
    private static readonly PROVIDER_MAP = new Map<string, AIProvider>([
        ['openai', AIProvider.OpenAI],
        ['aws-bedrock', AIProvider.AWSBedrock],
        ['bedrock', AIProvider.AWSBedrock],
        ['anthropic', AIProvider.Anthropic],
        ['google', AIProvider.Google],
        ['cohere', AIProvider.Cohere],
        ['gemini', AIProvider.Gemini],
        ['deepseek', AIProvider.DeepSeek],
        ['groq', AIProvider.Grok],
        ['huggingface', AIProvider.HuggingFace],
        ['ollama', AIProvider.Ollama],
        ['replicate', AIProvider.Replicate],
        ['azure', AIProvider.Azure]
    ]);
    
    // Performance metrics
    private static performanceMetrics = {
        totalRequests: 0,
        totalDuration: 0,
        slowRequests: 0,
        failedRequests: 0
    };

    /**
     * Initializes the internal cost tracker configuration
     */
    static async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const providers: ProviderConfig[] = [];

        if (process.env.OPENAI_API_KEY) {
            providers.push({
                provider: AIProvider.OpenAI,
                apiKey: process.env.OPENAI_API_KEY
            });
        }

        if (process.env.AWS_REGION) {
            providers.push({
                provider: AIProvider.AWSBedrock,
                region: process.env.AWS_REGION
            });
        }

        if (process.env.ANTHROPIC_API_KEY) {
            providers.push({
                provider: AIProvider.Anthropic,
                apiKey: process.env.ANTHROPIC_API_KEY
            });
        }

        if (process.env.GEMINI_API_KEY) {
            providers.push({
                provider: AIProvider.Google,
                apiKey: process.env.GEMINI_API_KEY
            });
        }

        if (process.env.COHERE_API_KEY) {
            providers.push({
                provider: AIProvider.Cohere,
                apiKey: process.env.COHERE_API_KEY
            });
        }

        if (providers.length === 0) {
            loggingService.warn('No AI provider API keys configured. Adding default OpenAI provider for tracking purposes only.');
            providers.push({
                provider: AIProvider.OpenAI,
                apiKey: 'dummy-key-for-tracking-only'
            });
        }

        const optimization: OptimizationConfig = {
            enablePromptOptimization: true,
            enableModelSuggestions: true,
            enableCachingSuggestions: true,
            enableCompression: true,
            enableContextTrimming: true,
            enableRequestFusion: true,
            bedrockConfig: {
                region: process.env.AWS_REGION || 'us-east-1',
                modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0'
            },
            compressionSettings: {
                minCompressionRatio: 0.7,
                jsonCompressionThreshold: 100
            },
            contextTrimmingSettings: {
                maxContextLength: 4000,
                preserveRecentMessages: 3,
                summarizationModel: 'global.anthropic.claude-haiku-4-5-20251001-v1:0'
            },
            requestFusionSettings: {
                maxFusionBatch: 5,
                fusionWaitTime: 5000
            },
            thresholds: {
                highCostPerRequest: 0.01,
                highTokenUsage: 10000,
                frequencyThreshold: 1000
            }
        };

        const tracking: TrackingConfig = {
            enableSessionReplay: process.env.ENABLE_SESSION_REPLAY === 'true',
            retentionDays: 90,
            sessionReplayTimeout: parseInt(process.env.SESSION_REPLAY_TIMEOUT || '30')
        };

        this.config = {
            providers,
            optimization,
            tracking
        };

        this.initialized = true;

        loggingService.info('Internal AI Cost Tracker initialized successfully', {
            providersConfigured: providers.length,
            providers: providers.map(p => p.provider)
        });
    }

    /**
     * Returns the tracker configuration with caching
     */
    static async getConfig(): Promise<TrackerConfig> {
        if (!this.configPromise) {
            this.configPromise = this.initializeConfig();
        }
        return this.configPromise;
    }
    
    /**
     * Internal configuration initialization
     */
    private static async initializeConfig(): Promise<TrackerConfig> {
        if (this.config && this.initialized) {
            return this.config;
        }
        
        // Initialize config if not already initialized
        await this.initialize();
        return this.config!;
    }

    /**
     * Track a request and response with enhanced error handling and performance monitoring
     */
    static async trackRequest(
        request: any,
        response: any,
        userId: string,
        metadata?: {
            service?: string;
            endpoint?: string;
            historicalSync?: boolean;
            originalCreatedAt?: Date;
            projectId?: string;
            tags?: string[];
            costAllocation?: Record<string, any>;
            promptTemplateId?: string;
            // Workflow tracking fields
            workflowId?: string;
            workflowName?: string;
            workflowStep?: string;
            metadata?: {
                workspace?: any;
                codeContext?: any;
                requestType?: string;
                executionTime?: number;
                contextFiles?: string[];
                generatedFiles?: string[];
            };
        }
    ): Promise<void> {
        const startTime = process.hrtime.bigint();
        this.performanceMetrics.totalRequests++;
        
        try {
            // Use circuit breaker pattern for resilience
            await this.circuitBreaker.execute(() => 
                this.trackRequestInternal(request, response, userId, metadata)
            );
        } catch (error) {
            this.performanceMetrics.failedRequests++;
            
            // Async error logging and dead letter queue
            setImmediate(async () => {
                loggingService.error('Usage tracking failed', {
                    error: error instanceof Error ? error.message : String(error),
                    userId,
                    model: request?.model,
                    metadata
                });
                
                // Ensure dead letter queue is initialized
                if (!this.deadLetterQueueInitialized) {
                    await DeadLetterQueue.initialize();
                    // Register handler for cost tracking retries
                    DeadLetterQueue.registerHandler('track-cost', async (data) => {
                        await AICostTrackerService.trackRequestInternal(
                            data.request,
                            data.response,
                            data.userId,
                            data.metadata
                        );
                    });
                    this.deadLetterQueueInitialized = true;
                }
                
                // Add to dead letter queue for retry
                await DeadLetterQueue.add({
                    operation: 'track-cost',
                    request,
                    response,
                    userId,
                    metadata,
                    originalError: error instanceof Error ? error.message : String(error),
                    timestamp: Date.now()
                }).catch(err => {
                    loggingService.error('Failed to add to dead letter queue', {
                        error: err instanceof Error ? err.message : String(err)
                    });
                });
            });
            
            // Don't throw - allow request to continue
            return;
        } finally {
            // Performance monitoring
            const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to ms
            this.performanceMetrics.totalDuration += duration;
            
            if (duration > 100) { // Log slow operations
                this.performanceMetrics.slowRequests++;
                loggingService.warn('Slow usage tracking detected', {
                    duration: `${duration.toFixed(2)}ms`,
                    userId,
                    model: request?.model,
                    service: metadata?.service
                });
            }
        }
    }
    
    /**
     * Internal tracking implementation with optimized async operations
     */
    static async trackRequestInternal(
        request: any,
        response: any,
        userId: string,
        metadata?: {
            service?: string;
            endpoint?: string;
            historicalSync?: boolean;
            originalCreatedAt?: Date;
            projectId?: string;
            tags?: string[];
            costAllocation?: Record<string, any>;
            promptTemplateId?: string;
            workflowId?: string;
            workflowName?: string;
            workflowStep?: string;
            metadata?: {
                workspace?: any;
                codeContext?: any;
                requestType?: string;
                executionTime?: number;
                contextFiles?: string[];
                generatedFiles?: string[];
            };
        }
    ): Promise<void> {
        try {
            await this.getConfig(); // Use cached config

            // Extract usage data
            const promptTokens = response.usage?.promptTokens || request.promptTokens || 0;
            const completionTokens = response.usage?.completionTokens || request.completionTokens || 0;
            // Always use totalTokens if available, otherwise sum prompt+completion
            const totalTokens = response.usage?.totalTokens !== undefined
                ? response.usage.totalTokens
                : (promptTokens + completionTokens);

            // Parallel token estimation if needed
            const provider = this.mapServiceToProvider(metadata?.service || 'openai');
            const providerString = this.providerEnumToString(provider);

            // If totalTokens is provided, use it directly; otherwise, estimate as before
            let finalPromptTokens = promptTokens;
            let finalCompletionTokens = completionTokens;
            let finalTotalTokens = totalTokens;

            if (response.usage?.totalTokens === undefined) {
                // Estimate prompt and completion tokens if needed
                [finalPromptTokens, finalCompletionTokens] = await Promise.all([
                    promptTokens === 0 && request.prompt
                        ? Promise.resolve(estimateTokens(request.prompt, provider))
                        : Promise.resolve(promptTokens),
                    completionTokens === 0 && (response.content || response.choices?.[0]?.message?.content)
                        ? Promise.resolve(estimateTokens(response.content || response.choices?.[0]?.message?.content || '', provider))
                        : Promise.resolve(completionTokens)
                ]);
                finalTotalTokens = finalPromptTokens + finalCompletionTokens;
            }

            const estimatedCost = calculateCost(
                finalPromptTokens,
                finalCompletionTokens,
                providerString,
                request.model
            );

            // Parallel operations for approval check and workflow sequence
            const [approvalResult, workflowSequence] = await Promise.all([
                this.checkProjectApproval(metadata, estimatedCost, finalTotalTokens, userId, request),
                this.getWorkflowSequence(metadata?.workflowId)
            ]);

            if (approvalResult?.requiresApproval) {
                throw new Error(`Approval required. Request ID: ${approvalResult.requestId}`);
            }

            // Prepare usage record
            const usageRecord = {
                userId,
                projectId: metadata?.projectId,
                service: metadata?.service || 'openai',
                model: request.model,
                prompt: request.prompt || '',
                completion: response.content || response.choices?.[0]?.message?.content || '',
                promptTokens: finalPromptTokens,
                completionTokens: finalCompletionTokens,
                totalTokens: finalTotalTokens,
                cost: estimatedCost,
                responseTime: metadata?.endpoint ? 100 : 0,
                metadata: {
                    ...metadata,
                    promptTemplateId: metadata?.promptTemplateId
                },
                tags: metadata?.tags || [],
                costAllocation: metadata?.costAllocation,
                workflowId: metadata?.workflowId,
                workflowName: metadata?.workflowName,
                workflowStep: metadata?.workflowStep,
                workflowSequence: workflowSequence,
                optimizationApplied: false,
                errorOccurred: false,
                createdAt: metadata?.originalCreatedAt || new Date()
            };

            // Parallel database operations
            await Promise.all([
                Usage.create(usageRecord),
                this.updateUserUsage(userId, estimatedCost, finalTotalTokens)
            ]);

            // 🌊 Real-time cost streaming to dashboard (non-blocking, P0 feature)
            setImmediate(async () => {
                try {
                    const { costStreamingService } = await import('./costStreaming.service');
                    const { UnexplainedCostService } = await import('./unexplainedCost.service');
                    const { TrueCostService } = await import('./trueCost.service');

                    // 🎯 P0: Calculate true cost (API + infrastructure)
                    // Extract requestId from metadata (could be in metadata.requestId or metadata.metadata.requestId)
                    const requestId = (metadata as any)?.requestId || 
                                    (metadata as any)?.metadata?.requestId || 
                                    `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const trueCost = await TrueCostService.calculateTrueCost({
                        requestId,
                        userId,
                        timestamp: new Date(),
                        model: request.model,
                        provider: providerString,
                        inputTokens: finalPromptTokens,
                        outputTokens: finalCompletionTokens,
                        totalTokens: finalTotalTokens,
                        latencyMs: metadata?.metadata?.executionTime || 1000,
                        vectorDBQueries: 0, // Would be tracked separately
                        embeddingsGenerated: 0,
                        cacheHits: 0, // Would come from cache service
                        cacheMisses: 0,
                        logVolumeBytes: JSON.stringify(request).length + JSON.stringify(response).length,
                        responseBytes: JSON.stringify(response).length,
                        projectId: metadata?.projectId,
                        workflowId: metadata?.workflowId
                    });

                    // 🎯 P1: AI-powered automatic feature attribution
                    const featureAttribution = await UnexplainedCostService.detectAndAttributeFeature(
                        userId,
                        {
                            operation: metadata?.workflowName || metadata?.endpoint || 'ai.request',
                            model: request.model,
                            cost: estimatedCost,
                            tokens: finalTotalTokens,
                            metadata: {
                                service: metadata?.service,
                                workflowId: metadata?.workflowId,
                                workflowName: metadata?.workflowName,
                                promptTemplateId: metadata?.promptTemplateId,
                                projectId: metadata?.projectId,
                                agentId: (metadata?.metadata as any)?.agentId,
                                agentName: (metadata?.metadata as any)?.agentName
                            }
                        }
                    );

                    costStreamingService.emitCostEvent({
                        eventType: 'cost_tracked',
                        timestamp: new Date(),
                        userId,
                        workspaceId: metadata?.metadata?.workspace?.id,
                        data: {
                            model: request.model,
                            vendor: providerString,
                            cost: estimatedCost,
                            tokens: finalTotalTokens,
                            operation: featureAttribution.feature,
                            template: metadata?.promptTemplateId,
                            metadata: {
                                trueCost: trueCost.totalCost, // 🎯 P0: Include true cost in metadata
                                promptTokens: finalPromptTokens,
                                completionTokens: finalCompletionTokens,
                                service: metadata?.service,
                                workflowId: metadata?.workflowId,
                                projectId: metadata?.projectId,
                                // 🎯 P0: True cost breakdown
                                trueCostBreakdown: {
                                    apiCost: trueCost.apiCost,
                                    infrastructureCost: trueCost.totalCost - trueCost.apiCost,
                                    vectorDBCost: trueCost.vectorDBCost,
                                    storageCost: trueCost.storageCost,
                                    networkCost: trueCost.networkCost,
                                    computeCost: trueCost.computeCost,
                                    cachingCost: trueCost.cachingCost,
                                    loggingCost: trueCost.loggingCost,
                                    observabilityCost: trueCost.observabilityCost
                                },
                                // 🎯 P1: Feature attribution metadata
                                featureCategory: featureAttribution.category,
                                featureConfidence: featureAttribution.confidence,
                                featureAttribution: featureAttribution.metadata
                            }
                        }
                    });
                } catch (streamError) {
                    // Fail silently - cost streaming is non-critical
                    loggingService.debug('Cost streaming failed (non-critical)', {
                        error: streamError instanceof Error ? streamError.message : String(streamError)
                    });
                }
            });

            // Handle session replay if enabled (non-blocking)
            if (this.config?.tracking?.enableSessionReplay) {
                setImmediate(async () => {
                    try {
                        const { sessionReplayService } = await import('./sessionReplay.service');
                        
                        // Get or create active session
                        const sessionId = await sessionReplayService.getOrCreateActiveSession(userId, {
                            workspaceId: metadata?.metadata?.workspace?.id,
                            metadata: metadata?.metadata?.workspace
                        });

                        // Record tracking state (tracking is always on; no option to disable)
                        const trackingState = {
                            enabled: true,
                            sessionReplayEnabled: this.config?.tracking?.enableSessionReplay ?? false,
                            timestamp: new Date(),
                            request: { 
                                model: request.model, 
                                tokens: finalTotalTokens, 
                                cost: estimatedCost 
                            },
                            context: {
                                files: metadata?.metadata?.contextFiles,
                                workspace: metadata?.metadata?.workspace
                            }
                        };

                        // Add replay data with full AI interaction
                        await sessionReplayService.addReplayData({
                            sessionId,
                            aiInteraction: {
                                model: request.model,
                                prompt: request.prompt || '',
                                response: response.content || response.choices?.[0]?.message?.content || '',
                                parameters: {
                                    temperature: request.temperature,
                                    maxTokens: request.maxTokens || request.max_tokens,
                                    topP: request.topP || request.top_p,
                                    ...request
                                },
                                tokens: {
                                    input: finalPromptTokens,
                                    output: finalCompletionTokens
                                },
                                cost: estimatedCost
                            },
                            captureSystemMetrics: true
                        });

                        // Update tracking history
                        const { Session } = await import('../models/Session');
                        await Session.updateOne(
                            { sessionId },
                            {
                                $push: { trackingHistory: trackingState },
                                $set: { 
                                    trackingEnabled: trackingState.enabled,
                                    sessionReplayEnabled: trackingState.sessionReplayEnabled,
                                    trackingEnabledAt: new Date()
                                }
                            }
                        );

                        loggingService.debug('Recorded session replay data', {
                            component: 'AICostTrackerService',
                            sessionId,
                            userId,
                            model: request.model
                        });
                    } catch (replayError) {
                        loggingService.warn('Failed to record session replay data', {
                            error: replayError instanceof Error ? replayError.message : String(replayError),
                            userId
                        });
                    }
                });
            }

            // Non-blocking activity tracking and real-time updates
            if (!metadata?.historicalSync) {
                setImmediate(async () => {
                    try {
                        await Promise.all([
                            ActivityService.trackActivity(userId, {
                    type: 'api_call',
                    title: `Made AI request using ${request.model}`,
                    description: `AI request with ${finalTotalTokens} tokens and cost $${estimatedCost.toFixed(6)}`,
                    metadata: {
                        model: request.model,
                        tokens: finalTotalTokens,
                        cost: estimatedCost,
                        projectId: metadata?.projectId
                    }
                            }),
                            Promise.resolve(RealtimeUpdateService.emitUsageUpdate(userId, {
                                type: 'usage_tracked',
                                data: {
                                    model: request.model,
                                    cost: estimatedCost,
                                    tokens: finalTotalTokens,
                                    service: metadata?.service || 'openai',
                                    timestamp: new Date().toISOString()
                                }
                            }))
                        ]);
                    } catch (error) {
                        loggingService.warn('Non-critical post-tracking operations failed', {
                            error: error instanceof Error ? error.message : String(error),
                            userId
                        });
                    }
                });
            }

            loggingService.debug('Usage tracked successfully', {
                userId,
                model: request.model,
                tokens: finalTotalTokens,
                cost: estimatedCost,
                projectId: metadata?.projectId
            });

        } catch (error) {
            loggingService.error('Error tracking usage:', { 
                error: error instanceof Error ? error.message : String(error),
                userId,
                model: request?.model
            });
            throw error;
        }
    }

    /**
     * Generate optimization suggestions for a prompt
     */
    static async generateOptimizations(
        prompt: string,
        provider: AIProvider,
        model: string,
        conversationHistory?: any[]
    ): Promise<OptimizationResult> {
        await this.getConfig();

        return generateOptimizationSuggestions(
            prompt,
            provider,
            model,
            conversationHistory
        );
    }

    /**
     * Apply optimizations to a prompt
     */
    static async applyOptimizations(
        prompt: string,
        optimizations: any[],
        conversationHistory?: any[]
    ): Promise<{
        optimizedPrompt: string;
        optimizedHistory?: any[];
        appliedOptimizations: string[];
    }> {
        await this.getConfig();

        return applyOptimizations(prompt, optimizations, conversationHistory);
    }

    /**
     * Estimate cost for a request before making it
     */
    static async estimateRequestCost(
        prompt: string,
        model: string,
        provider: AIProvider,
        expectedCompletionTokens: number = 150
    ): Promise<{
        promptCost: number;
        completionCost: number;
        totalCost: number;
        currency: string;
        breakdown: {
            promptTokens: number;
            completionTokens: number;
            pricePerPromptToken: number;
            pricePerCompletionToken: number;
        };
    }> {
        await this.getConfig();

        const promptTokens = estimateTokens(prompt, provider);
        const providerString = this.providerEnumToString(provider);
        const costEstimate = estimateCost(promptTokens, expectedCompletionTokens, providerString, model);

        // Convert to the expected format
        const modelPricing = getModelPricing(providerString, model);
        const inputPricePerToken = modelPricing ? modelPricing.inputPrice / 1000000 : 0;
        const outputPricePerToken = modelPricing ? modelPricing.outputPrice / 1000000 : 0;

        return {
            promptCost: costEstimate.inputCost,
            completionCost: costEstimate.outputCost,
            totalCost: costEstimate.totalCost,
            currency: 'USD',
            breakdown: {
                promptTokens,
                completionTokens: expectedCompletionTokens,
                pricePerPromptToken: inputPricePerToken,
                pricePerCompletionToken: outputPricePerToken
            }
        };
    }

    /**
     * Map service string to AIProvider enum using pre-computed Map
     */
    private static mapServiceToProvider(service: string): AIProvider {
        return this.PROVIDER_MAP.get(service.toLowerCase()) || AIProvider.OpenAI;
    }
    
    /**
     * Optimized project approval check
     */
    private static async checkProjectApproval(
        metadata: any,
        estimatedCost: number,
        finalTotalTokens: number,
        userId: string,
        request: any
    ): Promise<{ requiresApproval: boolean; requestId?: string } | null> {
        if (!metadata?.projectId || metadata?.historicalSync) {
            return null;
        }
        
        try {
            const requiresApproval = await ProjectService.checkApprovalRequired(
                metadata.projectId,
                estimatedCost
            );

            if (requiresApproval) {
                const approvalRequest = await ProjectService.createApprovalRequest(
                    userId,
                    metadata.projectId,
                    {
                        operation: 'API Call',
                        estimatedCost: estimatedCost,
                        estimatedTokens: finalTotalTokens,
                        model: request.model,
                        prompt: request.prompt,
                        reason: 'Exceeds project approval threshold'
                    }
                );
                
                return { requiresApproval: true, requestId: approvalRequest._id };
            }
            
            return { requiresApproval: false };
        } catch (error) {
            loggingService.warn('Project approval check failed', {
                error: error instanceof Error ? error.message : String(error),
                projectId: metadata.projectId
            });
            return null;
        }
    }
    
    /**
     * Optimized workflow sequence calculation
     */
    private static async getWorkflowSequence(workflowId?: string): Promise<number | undefined> {
        if (!workflowId) {
            return undefined;
        }
        
        try {
            const existingCount = await Usage.countDocuments({ workflowId });
            return existingCount + 1;
        } catch (error) {
            loggingService.warn('Could not calculate workflow sequence', {
                error: error instanceof Error ? error.message : String(error),
                workflowId
            });
            return 1; // Default to 1 if count fails
        }
    }
    
    /**
     * Optimized user usage update
     */
    private static async updateUserUsage(
        userId: string,
        estimatedCost: number,
        finalTotalTokens: number
    ): Promise<void> {
        try {
            await User.findByIdAndUpdate(userId, {
                $inc: {
                    'monthlyUsage.totalCost': estimatedCost,
                    'monthlyUsage.totalTokens': finalTotalTokens,
                    'monthlyUsage.requestCount': 1
                }
            });
        } catch (error) {
            loggingService.error('Failed to update user usage', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }
    
    /**
     * Get performance metrics
     */
    static getPerformanceMetrics(): {
        totalRequests: number;
        averageDuration: number;
        slowRequestPercentage: number;
        failureRate: number;
        circuitBreakerState: string;
    } {
        const avgDuration = this.performanceMetrics.totalRequests > 0 
            ? this.performanceMetrics.totalDuration / this.performanceMetrics.totalRequests 
            : 0;
            
        const slowRequestPercentage = this.performanceMetrics.totalRequests > 0
            ? (this.performanceMetrics.slowRequests / this.performanceMetrics.totalRequests) * 100
            : 0;
            
        const failureRate = this.performanceMetrics.totalRequests > 0
            ? (this.performanceMetrics.failedRequests / this.performanceMetrics.totalRequests) * 100
            : 0;
        
        return {
            totalRequests: this.performanceMetrics.totalRequests,
            averageDuration: Number(avgDuration.toFixed(2)),
            slowRequestPercentage: Number(slowRequestPercentage.toFixed(2)),
            failureRate: Number(failureRate.toFixed(2)),
            circuitBreakerState: this.circuitBreaker['state']
        };
    }
    
    /**
     * Reset performance metrics (useful for testing)
     */
    static resetPerformanceMetrics(): void {
        this.performanceMetrics = {
            totalRequests: 0,
            totalDuration: 0,
            slowRequests: 0,
            failedRequests: 0
        };
    }

    /**
     * Map AIProvider enum to string for pricing functions
     */
    private static providerEnumToString(provider: AIProvider): string {
        const providerMap: Record<AIProvider, string> = {
            [AIProvider.OpenAI]: 'OpenAI',
            [AIProvider.Anthropic]: 'Anthropic',
            [AIProvider.Google]: 'Google AI',
            [AIProvider.Gemini]: 'Google AI',
            [AIProvider.AWSBedrock]: 'AWS Bedrock',
            [AIProvider.Cohere]: 'Cohere',
            [AIProvider.DeepSeek]: 'DeepSeek',
            [AIProvider.Grok]: 'Grok',
            [AIProvider.HuggingFace]: 'Hugging Face',
            [AIProvider.Ollama]: 'Ollama',
            [AIProvider.Replicate]: 'Replicate',
            [AIProvider.Azure]: 'Azure OpenAI'
        };

        return providerMap[provider] || 'OpenAI';
    }

    /**
     * Make a tracked request (placeholder for future implementation)
     */
    static async makeTrackedRequest(
        request: any,
        userId: string,
        metadata?: any
    ): Promise<any> {
        // This would be implemented to make actual API calls to providers
        // For now, we'll just track the usage and return a mock response

        const mockResponse = {
            content: 'Mock response for tracking purposes',
            usage: {
                promptTokens: estimateTokens(request.prompt || '', AIProvider.OpenAI),
                completionTokens: 50,
                totalTokens: 0
            }
        };

        mockResponse.usage.totalTokens = mockResponse.usage.promptTokens + mockResponse.usage.completionTokens;

        await this.trackRequest(request, mockResponse, userId, metadata);

        return mockResponse;
    }

    /**
     * Get usage analytics
     */
    static async getUsageAnalytics(
        userId: string,
        projectId?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<any> {
        await this.getConfig();

        const query: any = { userId };

        if (projectId) {
            query.projectId = projectId;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = startDate;
            if (endDate) query.createdAt.$lte = endDate;
        }

        const usage = await Usage.find(query);

        const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);
        const totalTokens = usage.reduce((sum, u) => sum + u.totalTokens, 0);
        const averageTokensPerRequest = usage.length > 0 ? totalTokens / usage.length : 0;

        // Group by model
        const modelUsage = usage.reduce((acc, u) => {
            const key = `${u.service}-${u.model}`;
            if (!acc[key]) {
                acc[key] = {
                    model: u.model,
                    provider: this.mapServiceToProvider(u.service),
                    requestCount: 0,
                    totalTokens: 0,
                    totalCost: 0,
                    averageCostPerRequest: 0
                };
            }
            acc[key].requestCount++;
            acc[key].totalTokens += u.totalTokens;
            acc[key].totalCost += u.cost;
            acc[key].averageCostPerRequest = acc[key].totalCost / acc[key].requestCount;
            return acc;
        }, {} as any);

        return {
            totalCost,
            totalTokens,
            averageTokensPerRequest,
            mostUsedModels: Object.values(modelUsage),
            requestCount: usage.length,
            dateRange: {
                start: startDate,
                end: endDate
            }
        };
    }
} 