/**
 * Capability Router Service
 * 
 * Provider-agnostic intelligent routing using ModelCapabilityRegistry.
 * Replaces hardcoded provider switching with capability-based selection.
 * 
 * Key Improvements over IntelligentRouter:
 * - Zero hardcoded provider strings
 * - Capability-first selection
 * - Unified provider adapters
 * - Strategic tradeoff tracking
 */

import { ModelCapabilityRegistry } from './modelCapabilityRegistry.service';
import { PricingRegistryService } from './pricingRegistry.service';
import {
    ModelSelectionRequest,
    ModelSelectionResult,
    ModelSelectionStrategy,
    ModelCapability,
    UnifiedAIRequest,
    UnifiedAIResponse,
    IProviderAdapter
} from '../types/modelCapability.types';
import { loggingService } from './logging.service';
import { AgentDecisionAuditService } from './agentDecisionAudit.service';
import mongoose from 'mongoose';

/**
 * Capability-based routing request
 */
export interface CapabilityRoutingRequest {
    // Required capabilities (e.g., ['vision', 'streaming'])
    requiredCapabilities: ModelCapability[];
    
    // Optional capabilities (nice to have)
    optionalCapabilities?: ModelCapability[];
    
    // Strategic preferences
    strategy: ModelSelectionStrategy;
    
    // Constraints
    maxCostPerRequest?: number;
    maxLatencyMs?: number;
    minReliability?: number;
    excludeProviders?: string[];
    preferredProviders?: string[];
    
    // Token estimates for cost calculation
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
    
    // Context for decision audit
    userId?: mongoose.Types.ObjectId;
    agentId?: string;
    decisionContext?: string;
}

/**
 * Capability routing result
 */
export interface CapabilityRoutingResult extends ModelSelectionResult {
    // Provider adapter for execution
    providerAdapter: IProviderAdapter;
    
    // Decision audit ID (if auditing enabled)
    decisionAuditId?: string;
}

export class CapabilityRouterService {
    private static instance: CapabilityRouterService;
    private registry: ModelCapabilityRegistry;
    private pricingRegistry: PricingRegistryService;
    private decisionAudit: AgentDecisionAuditService;
    
    // Performance tracking for adaptive routing
    private performanceHistory = new Map<string, {
        latencies: number[];
        costs: number[];
        successCount: number;
        failureCount: number;
        lastUpdated: Date;
    }>();
    
    private constructor() {
        this.registry = ModelCapabilityRegistry.getInstance();
        this.pricingRegistry = PricingRegistryService.getInstance();
        this.decisionAudit = AgentDecisionAuditService.getInstance();
    }
    
    static getInstance(): CapabilityRouterService {
        if (!CapabilityRouterService.instance) {
            CapabilityRouterService.instance = new CapabilityRouterService();
        }
        return CapabilityRouterService.instance;
    }
    
    /**
     * Route request to optimal model based on capabilities
     */
    async routeRequest(request: CapabilityRoutingRequest): Promise<CapabilityRoutingResult> {
        const startTime = Date.now();
        
        try {
            // Build model selection request
            const selectionRequest: ModelSelectionRequest = {
                requiredCapabilities: request.requiredCapabilities,
                optionalCapabilities: request.optionalCapabilities,
                strategy: request.strategy,
                constraints: {
                    maxCostPerRequest: request.maxCostPerRequest,
                    maxLatencyMs: request.maxLatencyMs,
                    minReliability: request.minReliability,
                    excludeProviders: request.excludeProviders,
                    preferredProviders: request.preferredProviders,
                    excludeExperimental: true // Default to stable models
                },
                contextHints: {
                    estimatedInputTokens: request.estimatedInputTokens,
                    estimatedOutputTokens: request.estimatedOutputTokens
                }
            };
            
            // Select optimal model
            const selectionResult = this.registry.selectOptimalModel(selectionRequest);
            
            // Get provider adapter
            const providerAdapter = this.registry.getProviderForModel(selectionResult.selectedModel.modelId);
            
            if (!providerAdapter) {
                throw new Error(`No provider adapter found for model: ${selectionResult.selectedModel.modelId}`);
            }
            
            // Build capability routing result
            const routingResult: CapabilityRoutingResult = {
                ...selectionResult,
                providerAdapter
            };
            
            // Audit decision if context provided
            if (request.userId && request.agentId) {
                const decisionAuditId = await this.auditRoutingDecision(
                    request,
                    routingResult,
                    Date.now() - startTime
                );
                routingResult.decisionAuditId = decisionAuditId;
            }
            
            loggingService.info('Capability routing completed', {
                selectedModel: selectionResult.selectedModel.modelId,
                provider: selectionResult.selectedModel.provider,
                strategy: request.strategy,
                score: selectionResult.selectionReasoning.score,
                latencyMs: Date.now() - startTime
            });
            
            return routingResult;
            
        } catch (error) {
            loggingService.error('Capability routing failed', {
                error: error instanceof Error ? error.message : String(error),
                request: {
                    requiredCapabilities: request.requiredCapabilities,
                    strategy: request.strategy
                }
            });
            throw error;
        }
    }
    
    /**
     * Execute request using capability-based routing
     */
    async execute(
        prompt: string,
        routingRequest: CapabilityRoutingRequest,
        additionalOptions?: {
            systemMessage?: string;
            conversationHistory?: Array<{ role: string; content: string }>;
            temperature?: number;
            maxTokens?: number;
        }
    ): Promise<UnifiedAIResponse> {
        const startTime = Date.now();
        
        try {
            // Route request to optimal model
            const routing = await this.routeRequest(routingRequest);
            
            // Build unified AI request
            const aiRequest: UnifiedAIRequest = {
                prompt,
                modelId: routing.selectedModel.modelId,
                systemMessage: additionalOptions?.systemMessage,
                conversationHistory: additionalOptions?.conversationHistory,
                temperature: additionalOptions?.temperature,
                maxTokens: additionalOptions?.maxTokens,
                metadata: {
                    routingStrategy: routingRequest.strategy,
                    selectionScore: routing.selectionReasoning.score
                }
            };
            
            // Execute using provider adapter
            const response = await routing.providerAdapter.invoke(aiRequest);
            
            // Add latency
            response.latencyMs = Date.now() - startTime;
            
            // Record performance for adaptive routing
            this.recordPerformance(
                routing.selectedModel.modelId,
                response.latencyMs,
                this.calculateCost(response),
                true
            );
            
            loggingService.info('Capability-based execution completed', {
                modelId: routing.selectedModel.modelId,
                provider: routing.selectedModel.provider,
                inputTokens: response.usage.inputTokens,
                outputTokens: response.usage.outputTokens,
                latencyMs: response.latencyMs
            });
            
            return response;
            
        } catch (error) {
            loggingService.error('Capability-based execution failed', {
                error: error instanceof Error ? error.message : String(error),
                prompt: prompt.substring(0, 100)
            });
            throw error;
        }
    }
    
    /**
     * Audit routing decision for compliance and analysis
     */
    private async auditRoutingDecision(
        request: CapabilityRoutingRequest,
        result: CapabilityRoutingResult,
        _: number
    ): Promise<string> {
        try {
            const alternativesConsidered = result.alternativeModels.map(alt => ({
                option: `${alt.displayName} (${alt.modelId})`,
                reasoning: `Provider: ${alt.provider}, Cost: $${this.estimateModelCost(alt)}/req`,
                estimatedCost: this.estimateModelCost(alt),
                estimatedLatency: alt.performance.avgLatencyMs,
                estimatedQuality: this.estimateModelQuality(alt),
                rejectionReason: `Selected ${result.selectedModel.displayName} with higher score`,
                tradeoffAnalysis: this.explainTradeoff(result.selectedModel, alt, request.strategy)
            }));
            
            const decisionId = await this.decisionAudit.recordDecision({
                agentId: request.agentId || 'capability-router',
                agentIdentityId: new mongoose.Types.ObjectId(), // Placeholder
                userId: request.userId!,
                
                decisionType: 'model_selection',
                decision: `Selected ${result.selectedModel.displayName} (${result.selectedModel.modelId})`,
                reasoning: result.selectionReasoning.tradeoffs || 'Optimal model for requirements',
                alternativesConsidered,
                
                confidenceScore: result.selectionReasoning.score,
                riskLevel: this.assessRiskLevel(result),
                
                executionContext: {
                    executionId: `route-${Date.now()}`,
                    startTime: new Date(),
                    status: 'completed',
                    estimatedCost: result.estimatedCost
                },
                
                inputData: {
                    prompt: request.decisionContext || 'Routing request',
                    context: {
                        requiredCapabilities: request.requiredCapabilities,
                        strategy: request.strategy
                    }
                },
                
                outputData: {
                    result: result.selectedModel.modelId,
                    actionsTaken: ['model_selection', 'provider_resolution']
                }
            });
            
            return decisionId;
            
        } catch (error) {
            loggingService.error('Failed to audit routing decision', {
                error: error instanceof Error ? error.message : String(error)
            });
            return '';
        }
    }
    
    /**
     * Record model performance for adaptive routing
     */
    private recordPerformance(
        modelId: string,
        latencyMs: number,
        cost: number,
        success: boolean
    ): void {
        if (!this.performanceHistory.has(modelId)) {
            this.performanceHistory.set(modelId, {
                latencies: [],
                costs: [],
                successCount: 0,
                failureCount: 0,
                lastUpdated: new Date()
            });
        }
        
        const history = this.performanceHistory.get(modelId)!;
        
        history.latencies.push(latencyMs);
        history.costs.push(cost);
        if (success) {
            history.successCount++;
        } else {
            history.failureCount++;
        }
        history.lastUpdated = new Date();
        
        // Keep last 100 samples
        if (history.latencies.length > 100) {
            history.latencies.shift();
            history.costs.shift();
        }
    }
    
    /**
     * Calculate cost from response
     */
    private calculateCost(response: UnifiedAIResponse): number {
        const pricing = this.registry.getModel(response.modelId)?.pricing;
        if (!pricing) return 0;
        
        const inputCost = (response.usage.inputTokens / 1_000_000) * pricing.inputPricePerMillion;
        const outputCost = (response.usage.outputTokens / 1_000_000) * pricing.outputPricePerMillion;
        
        return inputCost + outputCost;
    }
    
    /**
     * Estimate cost for a model
     */
    private estimateModelCost(model: any): number {
        const inputCost = (1000 / 1_000_000) * model.pricing.inputPricePerMillion;
        const outputCost = (500 / 1_000_000) * model.pricing.outputPricePerMillion;
        return inputCost + outputCost;
    }
    
    /**
     * Estimate model quality (heuristic)
     */
    private estimateModelQuality(model: any): number {
        if (model.modelId.includes('opus') || model.modelId.includes('gpt-4o')) return 0.9;
        if (model.modelId.includes('sonnet') || model.modelId.includes('pro')) return 0.8;
        if (model.modelId.includes('haiku') || model.modelId.includes('mini')) return 0.7;
        return 0.6;
    }
    
    /**
     * Explain tradeoff between models
     */
    private explainTradeoff(selected: any, alternative: any, strategy: ModelSelectionStrategy): string {
        const costDiff = this.estimateModelCost(selected) - this.estimateModelCost(alternative);
        const latencyDiff = selected.performance.avgLatencyMs - alternative.performance.avgLatencyMs;
        
        if (strategy === ModelSelectionStrategy.COST_OPTIMIZED) {
            return costDiff < 0 ? `${Math.abs(costDiff * 100).toFixed(1)}% cheaper` : `${Math.abs(costDiff * 100).toFixed(1)}% more expensive`;
        } else if (strategy === ModelSelectionStrategy.SPEED_OPTIMIZED) {
            return latencyDiff < 0 ? `${Math.abs(latencyDiff).toFixed(0)}ms faster` : `${Math.abs(latencyDiff).toFixed(0)}ms slower`;
        }
        return 'Balanced tradeoff';
    }
    
    /**
     * Assess risk level of routing decision
     */
    private assessRiskLevel(result: CapabilityRoutingResult): 'low' | 'medium' | 'high' | 'critical' {
        if (result.selectedModel.isExperimental) return 'medium';
        if (result.selectedModel.performance.reliabilityScore < 0.9) return 'medium';
        return 'low';
    }

    
    /**
     * Get performance statistics for a model
     */
    getModelPerformance(modelId: string): {
        avgLatency: number;
        avgCost: number;
        successRate: number;
        sampleSize: number;
    } | null {
        const history = this.performanceHistory.get(modelId);
        if (!history || history.latencies.length === 0) return null;
        
        const avgLatency = history.latencies.reduce((a, b) => a + b, 0) / history.latencies.length;
        const avgCost = history.costs.reduce((a, b) => a + b, 0) / history.costs.length;
        const totalRequests = history.successCount + history.failureCount;
        const successRate = totalRequests > 0 ? history.successCount / totalRequests : 0;
        
        return {
            avgLatency,
            avgCost,
            successRate,
            sampleSize: history.latencies.length
        };
    }
}

