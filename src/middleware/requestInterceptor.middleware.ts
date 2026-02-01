import { Request, Response, NextFunction } from 'express';
import { CortexModelRouterService } from '../services/cortexModelRouter.service';

/** Priority for request flow */
export type FlowPriority = 'critical' | 'high' | 'normal' | 'low';
import { GatewayCortexService } from '../services/gatewayCortex.service';
import { loggingService } from '../services/logging.service';
import { InterventionLog } from '../models/InterventionLog';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface RequestContext {
    userId: string;
    requestId: string;
    model: string;
    provider: string;
    prompt: string;
    promptLength: number;
    estimatedCost: number;
    userTier: string;
    priority: FlowPriority;
    budgetRemaining: number;
    projectId?: string;
}

export interface InterventionDecision {
    shouldIntervene: boolean;
    interventionType?: 'model_downgrade' | 'provider_switch' | 'prompt_compression' | 'budget_block' | 'rate_limit_switch';
    reason?: string;
    modifications?: {
        newModel?: string;
        newProvider?: string;
        newPrompt?: string;
        estimatedSavings?: number;
    };
}

// ============================================================================
// REQUEST INTERCEPTOR MIDDLEWARE
// ============================================================================

export class RequestInterceptor {
    private static instance: RequestInterceptor;
    private cortexModelRouter: CortexModelRouterService;
    
    // Feature flags
    private config = {
        enabled: process.env.ENABLE_REQUEST_INTERCEPTOR === 'true',
        shadowMode: process.env.INTERCEPTOR_SHADOW_MODE === 'true', // Log but don't modify
        interventionTypes: {
            modelDowngrade: process.env.INTERCEPTOR_MODEL_DOWNGRADE !== 'false',
            providerSwitch: process.env.INTERCEPTOR_PROVIDER_SWITCH !== 'false',
            promptCompression: process.env.INTERCEPTOR_PROMPT_COMPRESSION !== 'false',
            budgetBlock: process.env.INTERCEPTOR_BUDGET_BLOCK !== 'false'
        },
        thresholds: {
            budgetExhaustionPercent: 0.95, // Block if >95% budget used
            promptCompressionLength: 2000, // Compress if prompt > 2000 chars
            modelDowngradeThreshold: 0.8, // Downgrade if >80% budget used
            costSavingsMinimum: 0.10 // Only intervene if saves >$0.10
        }
    };

    private constructor() {
        this.cortexModelRouter = CortexModelRouterService.getInstance();
        
        loggingService.info('🛡️ Request Interceptor initialized', {
            component: 'RequestInterceptor',
            enabled: this.config.enabled,
            shadowMode: this.config.shadowMode
        });
    }

    public static getInstance(): RequestInterceptor {
        if (!RequestInterceptor.instance) {
            RequestInterceptor.instance = new RequestInterceptor();
        }
        return RequestInterceptor.instance;
    }

    /**
     * Main middleware handler
     */
    public handle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Skip if not enabled
        if (!this.config.enabled) {
            return next();
        }

        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string || uuidv4();

        try {
            // Extract request context
            const context = await this.analyzeRequestContext(req);
            
            if (!context) {
                // Unable to analyze - skip intervention
                return next();
            }

            // Make intervention decision
            const decision = await this.shouldIntervene(context);

            if (decision.shouldIntervene) {
                loggingService.info('🎯 Intervention recommended', {
                    component: 'RequestInterceptor',
                    requestId,
                    interventionType: decision.interventionType,
                    reason: decision.reason
                });

                // Apply intervention (or log if shadow mode)
                if (this.config.shadowMode) {
                    // Shadow mode: log but don't modify
                    await this.logIntervention(context, decision, false);
                    loggingService.info('🕶️ Shadow mode: intervention logged but not applied', {
                        component: 'RequestInterceptor',
                        requestId,
                        interventionType: decision.interventionType
                    });
                } else {
                    // Apply the intervention
                    await this.applyIntervention(req, context, decision);
                    await this.logIntervention(context, decision, true);
                    
                    loggingService.info('✅ Intervention applied', {
                        component: 'RequestInterceptor',
                        requestId,
                        interventionType: decision.interventionType,
                        estimatedSavings: decision.modifications?.estimatedSavings
                    });
                }
            }

            // Continue to next middleware
            next();

        } catch (error) {
            loggingService.error('❌ Request interceptor error', {
                component: 'RequestInterceptor',
                requestId,
                error: error instanceof Error ? error.message : String(error),
                duration: Date.now() - startTime
            });
            
            // Fail open - don't block request on error
            next();
        }
    };

    /**
     * Analyze request context to extract key information
     */
    private async analyzeRequestContext(req: Request): Promise<RequestContext | null> {
        try {
            const body = req.body || {};
            const userId = (req as any).userId || (req as any).user?.id;
            
            if (!userId) {
                return null; // Can't analyze without user context
            }

            // Extract model and prompt from request body
            const model = body.model || 'gpt-3.5-turbo';
            const prompt = this.extractPrompt(body);
            
            if (!prompt) {
                return null; // Can't analyze without prompt
            }

            // Estimate cost
            const estimatedCost = await this.estimateCost(model, prompt);

            const budgetCheck = { allowed: true, currentUtilization: 0 };

            // Determine priority (could be from request or default)
            const priority: FlowPriority = (req.headers['x-priority'] as FlowPriority) || 'normal';

            // Determine provider from model or request
            const provider = this.getProviderFromModel(model);

            return {
                userId,
                requestId: req.headers['x-request-id'] as string || uuidv4(),
                model,
                provider,
                prompt,
                promptLength: prompt.length,
                estimatedCost,
                userTier: (req as any).user?.tier || 'free',
                priority,
                budgetRemaining: budgetCheck.allowed ? budgetCheck.currentUtilization : 0,
                projectId: body.projectId
            };

        } catch (error) {
            loggingService.error('Failed to analyze request context', {
                component: 'RequestInterceptor',
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Decide whether to intervene and what type of intervention
     */
    private async shouldIntervene(context: RequestContext): Promise<InterventionDecision> {
        // Priority 1: Budget exhaustion check
        if (this.config.interventionTypes.budgetBlock) {
            if (context.budgetRemaining >= this.config.thresholds.budgetExhaustionPercent) {
                // Budget critical - block low priority requests
                if (context.priority === 'low' || context.priority === 'normal') {
                    return {
                        shouldIntervene: true,
                        interventionType: 'budget_block',
                        reason: `Budget utilization at ${(context.budgetRemaining * 100).toFixed(1)}%, blocking low-priority request`
                    };
                }
            }
        }

        // Priority 2: Model downgrade if approaching budget limit
        if (this.config.interventionTypes.modelDowngrade) {
            if (context.budgetRemaining >= this.config.thresholds.modelDowngradeThreshold) {
                const cheaperModel = await this.findCheaperModel(context.model, context.prompt);
                
                if (cheaperModel) {
                    const estimatedSavings = context.estimatedCost - cheaperModel.cost;
                    
                    if (estimatedSavings > this.config.thresholds.costSavingsMinimum) {
                        return {
                            shouldIntervene: true,
                            interventionType: 'model_downgrade',
                            reason: `Budget at ${(context.budgetRemaining * 100).toFixed(1)}%, downgrading to cheaper model`,
                            modifications: {
                                newModel: cheaperModel.model,
                                newProvider: cheaperModel.provider,
                                estimatedSavings
                            }
                        };
                    }
                }
            }
        }

        // Priority 3: Prompt compression for long prompts with low budget
        if (this.config.interventionTypes.promptCompression) {
            if (
                context.promptLength > this.config.thresholds.promptCompressionLength &&
                context.budgetRemaining > 0.5 &&
                context.userTier !== 'enterprise'
            ) {
                const compressionEstimate = await this.estimateCompressionSavings(context.prompt);
                
                if (compressionEstimate.savings > this.config.thresholds.costSavingsMinimum) {
                    return {
                        shouldIntervene: true,
                        interventionType: 'prompt_compression',
                        reason: `Prompt length ${context.promptLength} chars, applying Cortex compression`,
                        modifications: {
                            newPrompt: compressionEstimate.compressedPrompt,
                            estimatedSavings: compressionEstimate.savings
                        }
                    };
                }
            }
        }

        // Priority 4: Provider switch for rate limits
        if (this.config.interventionTypes.providerSwitch) {
            try {
                // Check if current provider is experiencing issues via circuit breaker
                const circuitBreakerState = this.cortexModelRouter.getCircuitBreakerState(context.provider, context.model);
                
                if (circuitBreakerState === 'open' || circuitBreakerState === 'half-open') {
                    // Find alternative provider for the same model or equivalent
                    const alternativeProvider = await this.findAlternativeProvider(context.model, context.provider);
                    
                    if (alternativeProvider) {
                        return {
                            shouldIntervene: true,
                            interventionType: 'provider_switch',
                            reason: `Provider ${context.provider} circuit breaker ${circuitBreakerState}, switching to ${alternativeProvider.provider}`,
                            modifications: {
                                newProvider: alternativeProvider.provider,
                                newModel: alternativeProvider.model,
                                estimatedSavings: 0 // No cost savings, just availability
                            }
                        };
                    }
                }
            } catch (error) {
                loggingService.error('Failed to check circuit breaker state', {
                    component: 'RequestInterceptor',
                    provider: context.provider,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        // No intervention needed
        return {
            shouldIntervene: false
        };
    }

    /**
     * Apply the intervention to the request
     */
    private async applyIntervention(
        req: Request,
        context: RequestContext,
        decision: InterventionDecision
    ): Promise<void> {
        if (!decision.shouldIntervene || !decision.modifications) {
            return;
        }

        switch (decision.interventionType) {
            case 'budget_block':
                // Set a flag that gateway will check
                (req as any).interceptorBlocked = true;
                (req as any).interceptorReason = decision.reason;
                break;

            case 'model_downgrade':
                if (decision.modifications.newModel) {
                    req.body.model = decision.modifications.newModel;
                    (req as any).interceptorModified = true;
                    (req as any).interceptorOriginalModel = context.model;
                }
                break;

            case 'prompt_compression':
                if (decision.modifications.newPrompt) {
                    // Update prompt in body (structure varies by provider)
                    this.updatePromptInBody(req.body, decision.modifications.newPrompt);
                    (req as any).interceptorModified = true;
                    (req as any).interceptorOriginalPromptLength = context.promptLength;
                }
                break;

            case 'provider_switch':
                if (decision.modifications.newProvider) {
                    (req as any).interceptorSwitchProvider = decision.modifications.newProvider;
                    (req as any).interceptorModified = true;
                }
                break;
        }
    }

    /**
     * Log intervention to database
     */
    private async logIntervention(
        context: RequestContext,
        decision: InterventionDecision,
        applied: boolean
    ): Promise<void> {
        try {
            const interventionLog = {
                timestamp: new Date(),
                userId: new mongoose.Types.ObjectId(context.userId),
                flowId: context.requestId,
                interventionType: decision.interventionType!,
                originalRequest: {
                    model: context.model,
                    provider: context.provider,
                    estimatedCost: context.estimatedCost,
                    promptLength: context.promptLength
                },
                modifiedRequest: {
                    model: decision.modifications?.newModel || context.model,
                    provider: decision.modifications?.newProvider || context.provider,
                    actualCost: context.estimatedCost - (decision.modifications?.estimatedSavings || 0),
                    promptLength: decision.modifications?.newPrompt?.length || context.promptLength
                },
                reason: decision.reason || 'Unknown',
                costSaved: decision.modifications?.estimatedSavings || 0,
                metadata: {
                    applied,
                    userTier: context.userTier,
                    priority: context.priority,
                    budgetRemaining: context.budgetRemaining,
                    shadowMode: this.config.shadowMode
                }
            };

            await InterventionLog.create(interventionLog);

        } catch (error) {
            loggingService.error('Failed to log intervention', {
                component: 'RequestInterceptor',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Extract prompt from various request body structures
     */
    private extractPrompt(body: any): string | null {
        // OpenAI-style
        if (body.messages && Array.isArray(body.messages)) {
            return body.messages.map((m: any) => m.content).join('\n');
        }
        
        // Direct prompt
        if (body.prompt) {
            return body.prompt;
        }
        
        // Completion-style
        if (body.input) {
            return body.input;
        }

        return null;
    }

    /**
     * Update prompt in request body (handles different structures)
     */
    private updatePromptInBody(body: any, newPrompt: string): void {
        if (body.messages && Array.isArray(body.messages)) {
            // OpenAI-style: update last user message
            const lastUserMsg = body.messages.filter((m: any) => m.role === 'user').pop();
            if (lastUserMsg) {
                lastUserMsg.content = newPrompt;
            }
        } else if (body.prompt) {
            body.prompt = newPrompt;
        } else if (body.input) {
            body.input = newPrompt;
        }
    }

    /**
     * Estimate cost for a model and prompt
     */
    private async estimateCost(model: string, prompt: string): Promise<number> {
        // Simplified estimation - in production, use actual pricing service
        const tokenEstimate = Math.ceil(prompt.length / 4);
        const costPerToken = this.getCostPerToken(model);
        return (tokenEstimate * costPerToken);
    }

    /**
     * Get cost per token for a model
     */
    private getCostPerToken(model: string): number {
        // Simplified pricing - should use actual pricing service
        const pricing: Record<string, number> = {
            'gpt-4': 0.00003,
            'gpt-4-turbo': 0.00001,
            'gpt-3.5-turbo': 0.0000015,
            'claude-3-opus': 0.000015,
            'claude-3-sonnet': 0.000003,
            'claude-3-haiku': 0.00000025,
            'gemini-pro': 0.000001
        };
        
        return pricing[model] || 0.000001;
    }

    /**
     * Get provider from model name
     */
    private getProviderFromModel(model: string): string {
        if (model.startsWith('gpt-')) return 'openai';
        if (model.startsWith('claude-')) return 'anthropic';
        if (model.startsWith('gemini-')) return 'google';
        if (model.includes('bedrock')) return 'aws-bedrock';
        return 'unknown';
    }

    /**
     * Find an alternative provider for the same or equivalent model
     */
    private async findAlternativeProvider(
        model: string,
        currentProvider: string
    ): Promise<{ provider: string; model: string } | null> {
        try {
            // Define provider alternatives and model mappings
            const providerAlternatives: Record<string, string[]> = {
                'openai': ['anthropic', 'google', 'aws-bedrock'],
                'anthropic': ['openai', 'google', 'aws-bedrock'],
                'google': ['openai', 'anthropic', 'aws-bedrock'],
                'aws-bedrock': ['openai', 'anthropic', 'google']
            };

            // Model equivalence mapping (similar capability models)
            const modelEquivalents: Record<string, Record<string, string>> = {
                'gpt-4': {
                    'anthropic': 'claude-3-opus',
                    'google': 'gemini-pro',
                    'aws-bedrock': 'anthropic.claude-3-opus-20240229-v1:0'
                },
                'gpt-4-turbo': {
                    'anthropic': 'claude-3-sonnet',
                    'google': 'gemini-pro',
                    'aws-bedrock': 'anthropic.claude-3-sonnet-20240229-v1:0'
                },
                'gpt-3.5-turbo': {
                    'anthropic': 'claude-3-haiku',
                    'google': 'gemini-pro',
                    'aws-bedrock': 'anthropic.claude-3-haiku-20240307-v1:0'
                },
                'claude-3-opus': {
                    'openai': 'gpt-4',
                    'google': 'gemini-pro',
                    'aws-bedrock': 'anthropic.claude-3-opus-20240229-v1:0'
                },
                'claude-3-sonnet': {
                    'openai': 'gpt-4-turbo',
                    'google': 'gemini-pro',
                    'aws-bedrock': 'anthropic.claude-3-sonnet-20240229-v1:0'
                },
                'claude-3-haiku': {
                    'openai': 'gpt-3.5-turbo',
                    'google': 'gemini-pro',
                    'aws-bedrock': 'anthropic.claude-3-haiku-20240307-v1:0'
                },
                'gemini-pro': {
                    'openai': 'gpt-3.5-turbo',
                    'anthropic': 'claude-3-haiku',
                    'aws-bedrock': 'anthropic.claude-3-haiku-20240307-v1:0'
                }
            };

            const alternatives = providerAlternatives[currentProvider] || [];
            
            // Try to find an alternative provider with available circuit breaker
            for (const altProvider of alternatives) {
                // Get equivalent model for this provider
                let altModel = model;
                
                // Check if we have a model mapping
                const baseModel = model.split(':')[0]; // Remove version suffix if present
                if (modelEquivalents[baseModel] && modelEquivalents[baseModel][altProvider]) {
                    altModel = modelEquivalents[baseModel][altProvider];
                } else if (altProvider === 'aws-bedrock' && model.includes('claude')) {
                    // Convert Anthropic model to Bedrock format
                    altModel = `anthropic.${baseModel}-20240229-v1:0`;
                }

                // Check if this provider's circuit breaker is closed (available)
                const circuitState = this.cortexModelRouter.getCircuitBreakerState(altProvider, altModel);
                
                if (circuitState === 'closed') {
                    return {
                        provider: altProvider,
                        model: altModel
                    };
                }
            }

            // No available alternative found
            return null;

        } catch (error) {
            loggingService.error('Failed to find alternative provider', {
                component: 'RequestInterceptor',
                model,
                currentProvider,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Find a cheaper alternative model
     */
    private async findCheaperModel(
        currentModel: string,
        prompt: string
    ): Promise<{ model: string; provider: string; cost: number } | null> {
        try {
            // Use Cortex Model Router to find optimal model
            const complexity = this.cortexModelRouter.analyzePromptComplexity(prompt);
            const routingDecision = this.cortexModelRouter.makeRoutingDecision(complexity, {
                priority: 'cost',
                maxCostPerRequest: this.getCostPerToken(currentModel) * 0.7 * Math.ceil(prompt.length / 4) // 30% cheaper
            });

            if (routingDecision.selectedTier) {
                const config = this.cortexModelRouter.getModelConfiguration(routingDecision);
                return {
                    model: config.cortexCoreModel,
                    provider: this.getProviderFromModel(config.cortexCoreModel),
                    cost: this.getCostPerToken(config.cortexCoreModel) * Math.ceil(prompt.length / 4)
                };
            }

            return null;

        } catch (error) {
            loggingService.error('Failed to find cheaper model', {
                component: 'RequestInterceptor',
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Estimate compression savings using Cortex
     */
    private async estimateCompressionSavings(prompt: string): Promise<{
        compressedPrompt: string;
        savings: number;
    }> {
        try {
            // Use GatewayCortex to compress prompt
            const compressed = await GatewayCortexService.processGatewayRequest(
                {} as any, // Mock request
                { prompt }
            );

            if (compressed.shouldBypass) {
                return { compressedPrompt: prompt, savings: 0 };
            }

            const originalTokens = Math.ceil(prompt.length / 4);
            const compressedTokens = Math.ceil((compressed.processedBody.prompt?.length || prompt.length) / 4);
            const tokensSaved = originalTokens - compressedTokens;
            const costPerToken = 0.000001; // Average
            
            return {
                compressedPrompt: compressed.processedBody.prompt || prompt,
                savings: tokensSaved * costPerToken
            };

        } catch (error) {
            loggingService.error('Failed to estimate compression savings', {
                component: 'RequestInterceptor',
                error: error instanceof Error ? error.message : String(error)
            });
            return { compressedPrompt: prompt, savings: 0 };
        }
    }
}

// Export singleton instance
export const requestInterceptor = RequestInterceptor.getInstance();

