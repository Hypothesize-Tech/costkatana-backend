/**
 * Request Interceptor Middleware (NestJS injectable)
 *
 * Analyzes incoming AI requests and applies cost optimization interventions
 * (model downgrade, provider switch, prompt compression, budget block) using
 * real CortexModelRouterService and PricingRegistryService.
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import {
  CortexModelRouterService,
  type PromptComplexityAnalysis,
  type RoutingDecision,
  type RoutingPreferences,
} from '../../modules/cortex/services/cortex-model-router.service';
import {
  PricingRegistryService,
  type CostCalculationRequest,
} from '../../modules/pricing/services/pricing-registry.service';
import { GatewayCortexService } from '../../modules/gateway/services/gateway-cortex.service';
import { InterventionLog } from '../../schemas/misc/intervention-log.schema';
import { loggingService } from '../services/logging.service';
import type { Model } from 'mongoose';

/** Priority for request flow */
export type FlowPriority = 'critical' | 'high' | 'normal' | 'low';

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
  req?: Request;
}

export interface InterventionDecision {
  shouldIntervene: boolean;
  interventionType?:
    | 'model_downgrade'
    | 'provider_switch'
    | 'prompt_compression'
    | 'budget_block'
    | 'rate_limit_switch';
  reason?: string;
  modifications?: {
    newModel?: string;
    newProvider?: string;
    newPrompt?: string;
    estimatedSavings?: number;
  };
}

export class RequestInterceptorMiddleware {
  private readonly config = {
    enabled: process.env.ENABLE_REQUEST_INTERCEPTOR === 'true',
    shadowMode: process.env.INTERCEPTOR_SHADOW_MODE === 'true',
    interventionTypes: {
      modelDowngrade: process.env.INTERCEPTOR_MODEL_DOWNGRADE !== 'false',
      providerSwitch: process.env.INTERCEPTOR_PROVIDER_SWITCH !== 'false',
      promptCompression: process.env.INTERCEPTOR_PROMPT_COMPRESSION !== 'false',
      budgetBlock: process.env.INTERCEPTOR_BUDGET_BLOCK !== 'false',
    },
    thresholds: {
      budgetExhaustionPercent: 0.95,
      promptCompressionLength: 2000,
      modelDowngradeThreshold: 0.8,
      costSavingsMinimum: 0.1,
    },
  };

  constructor(
    private readonly cortexModelRouter: CortexModelRouterService,
    private readonly pricingRegistry: PricingRegistryService,
    private readonly gatewayCortex: GatewayCortexService,
    private readonly interventionLogModel: Model<InterventionLog>,
  ) {
    loggingService.info('🛡️ Request Interceptor initialized', {
      component: 'RequestInterceptor',
      enabled: this.config.enabled,
      shadowMode: this.config.shadowMode,
    });
  }

  use = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!this.config.enabled) {
      return next();
    }

    const startTime = Date.now();
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();

    try {
      const context = await this.analyzeRequestContext(req);

      if (!context) {
        return next();
      }

      const decision = await this.shouldIntervene(context);

      if (decision.shouldIntervene) {
        loggingService.info('🎯 Intervention recommended', {
          component: 'RequestInterceptor',
          requestId,
          interventionType: decision.interventionType,
          reason: decision.reason,
        });

        if (this.config.shadowMode) {
          await this.logIntervention(context, decision, false);
          loggingService.info(
            '🕶️ Shadow mode: intervention logged but not applied',
            {
              component: 'RequestInterceptor',
              requestId,
              interventionType: decision.interventionType,
            },
          );
        } else {
          await this.applyIntervention(req, context, decision);
          await this.logIntervention(context, decision, true);

          loggingService.info('✅ Intervention applied', {
            component: 'RequestInterceptor',
            requestId,
            interventionType: decision.interventionType,
            estimatedSavings: decision.modifications?.estimatedSavings,
          });
        }
      }

      next();
    } catch (error) {
      loggingService.error('❌ Request interceptor error', {
        component: 'RequestInterceptor',
        requestId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      next();
    }
  };

  private async analyzeRequestContext(
    req: Request,
  ): Promise<RequestContext | null> {
    try {
      const body = req.body || {};
      const userId = (req as any).userId || (req as any).user?.id;

      if (!userId) {
        return null;
      }

      const model = body.model || 'gpt-3.5-turbo';
      const prompt = this.extractPrompt(body);

      if (!prompt) {
        return null;
      }

      const estimatedCost = await this.estimateCost(model, prompt);
      const budgetCheck = { allowed: true, currentUtilization: 0 };
      const priority: FlowPriority =
        (req.headers['x-priority'] as FlowPriority) || 'normal';
      const provider = this.getProviderFromModel(model);

      return {
        userId,
        requestId: (req.headers['x-request-id'] as string) || uuidv4(),
        model,
        provider,
        prompt,
        promptLength: prompt.length,
        estimatedCost,
        userTier: (req as any).user?.tier || 'free',
        priority,
        budgetRemaining: budgetCheck.allowed
          ? budgetCheck.currentUtilization
          : 0,
        projectId: body.projectId,
        req,
      };
    } catch (error) {
      loggingService.error('Failed to analyze request context', {
        component: 'RequestInterceptor',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async shouldIntervene(
    context: RequestContext,
  ): Promise<InterventionDecision> {
    if (this.config.interventionTypes.budgetBlock) {
      if (
        context.budgetRemaining >=
        this.config.thresholds.budgetExhaustionPercent
      ) {
        if (context.priority === 'low' || context.priority === 'normal') {
          return {
            shouldIntervene: true,
            interventionType: 'budget_block',
            reason: `Budget utilization at ${(context.budgetRemaining * 100).toFixed(1)}%, blocking low-priority request`,
          };
        }
      }
    }

    if (this.config.interventionTypes.modelDowngrade) {
      if (
        context.budgetRemaining >=
        this.config.thresholds.modelDowngradeThreshold
      ) {
        const cheaperModel = await this.findCheaperModel(
          context.model,
          context.prompt,
        );

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
                estimatedSavings,
              },
            };
          }
        }
      }
    }

    if (this.config.interventionTypes.promptCompression) {
      if (
        context.promptLength > this.config.thresholds.promptCompressionLength &&
        context.budgetRemaining > 0.5 &&
        context.userTier !== 'enterprise'
      ) {
        const compressionEstimate = await this.estimateCompressionSavings(
          context.prompt,
          context.req,
        );

        if (
          compressionEstimate.savings >
          this.config.thresholds.costSavingsMinimum
        ) {
          return {
            shouldIntervene: true,
            interventionType: 'prompt_compression',
            reason: `Prompt length ${context.promptLength} chars, applying Cortex compression`,
            modifications: {
              newPrompt: compressionEstimate.compressedPrompt,
              estimatedSavings: compressionEstimate.savings,
            },
          };
        }
      }
    }

    if (this.config.interventionTypes.providerSwitch) {
      try {
        const circuitBreakerState =
          this.cortexModelRouter.getCircuitBreakerState(
            context.provider,
            context.model,
          );

        if (
          circuitBreakerState === 'open' ||
          circuitBreakerState === 'half-open'
        ) {
          const alternativeProvider = await this.findAlternativeProvider(
            context.model,
            context.provider,
          );

          if (alternativeProvider) {
            return {
              shouldIntervene: true,
              interventionType: 'provider_switch',
              reason: `Provider ${context.provider} circuit breaker ${circuitBreakerState}, switching to ${alternativeProvider.provider}`,
              modifications: {
                newProvider: alternativeProvider.provider,
                newModel: alternativeProvider.model,
                estimatedSavings: 0,
              },
            };
          }
        }
      } catch (error) {
        loggingService.error('Failed to check circuit breaker state', {
          component: 'RequestInterceptor',
          provider: context.provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { shouldIntervene: false };
  }

  private async applyIntervention(
    req: Request,
    context: RequestContext,
    decision: InterventionDecision,
  ): Promise<void> {
    if (!decision.shouldIntervene || !decision.modifications) {
      return;
    }

    switch (decision.interventionType) {
      case 'budget_block':
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
          this.updatePromptInBody(req.body, decision.modifications.newPrompt);
          (req as any).interceptorModified = true;
          (req as any).interceptorOriginalPromptLength = context.promptLength;
        }
        break;

      case 'provider_switch':
        if (decision.modifications.newProvider) {
          (req as any).interceptorSwitchProvider =
            decision.modifications.newProvider;
          (req as any).interceptorModified = true;
        }
        break;
    }
  }

  private async logIntervention(
    context: RequestContext,
    decision: InterventionDecision,
    applied: boolean,
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
          promptLength: context.promptLength,
        },
        modifiedRequest: {
          model: decision.modifications?.newModel || context.model,
          provider: decision.modifications?.newProvider || context.provider,
          actualCost:
            context.estimatedCost -
            (decision.modifications?.estimatedSavings || 0),
          promptLength:
            decision.modifications?.newPrompt?.length || context.promptLength,
        },
        reason: decision.reason || 'Unknown',
        costSaved: decision.modifications?.estimatedSavings || 0,
        metadata: {
          applied,
          userTier: context.userTier,
          priority: context.priority,
          budgetRemaining: context.budgetRemaining,
          shadowMode: this.config.shadowMode,
        },
      };

      await this.interventionLogModel.create(interventionLog);
    } catch (error) {
      loggingService.error('Failed to log intervention', {
        component: 'RequestInterceptor',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private extractPrompt(body: any): string | null {
    if (body.messages && Array.isArray(body.messages)) {
      return body.messages.map((m: any) => m.content).join('\n');
    }
    if (body.prompt) return body.prompt;
    if (body.input) return body.input;
    return null;
  }

  private updatePromptInBody(body: any, newPrompt: string): void {
    if (body.messages && Array.isArray(body.messages)) {
      const lastUserMsg = body.messages
        .filter((m: any) => m.role === 'user')
        .pop();
      if (lastUserMsg) lastUserMsg.content = newPrompt;
    } else if (body.prompt) {
      body.prompt = newPrompt;
    } else if (body.input) {
      body.input = newPrompt;
    }
  }

  private getCostPerToken(model: string): number {
    try {
      const costResult = this.pricingRegistry.calculateCost({
        modelId: model,
        inputTokens: 1,
        outputTokens: 0,
      } as CostCalculationRequest);
      return costResult?.totalCost ?? 0.000001;
    } catch {
      return 0.000001;
    }
  }

  private async estimateCost(model: string, prompt: string): Promise<number> {
    try {
      const tokenEstimate = Math.ceil(prompt.length / 4);
      const costResult = this.pricingRegistry.calculateCost({
        modelId: model,
        inputTokens: tokenEstimate,
        outputTokens: 0,
      } as CostCalculationRequest);

      return costResult ? costResult.totalCost : tokenEstimate * 0.000001;
    } catch (error) {
      loggingService.warn(
        `Failed to calculate cost for model ${model} in request interceptor`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      const tokenEstimate = Math.ceil(prompt.length / 4);
      return tokenEstimate * 0.000001;
    }
  }

  private getProviderFromModel(model: string): string {
    if (model.startsWith('gpt-')) return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('gemini-')) return 'google';
    if (model.includes('bedrock')) return 'aws-bedrock';
    return 'unknown';
  }

  private async findAlternativeProvider(
    model: string,
    currentProvider: string,
  ): Promise<{ provider: string; model: string } | null> {
    try {
      const providerAlternatives: Record<string, string[]> = {
        openai: ['anthropic', 'google', 'aws-bedrock'],
        anthropic: ['openai', 'google', 'aws-bedrock'],
        google: ['openai', 'anthropic', 'aws-bedrock'],
        'aws-bedrock': ['openai', 'anthropic', 'google'],
      };

      const modelEquivalents: Record<string, Record<string, string>> = {
        'gpt-4': {
          anthropic: 'claude-3-opus',
          google: 'gemini-pro',
          'aws-bedrock': 'anthropic.claude-3-opus-20240229-v1:0',
        },
        'gpt-4-turbo': {
          anthropic: 'claude-3-sonnet',
          google: 'gemini-pro',
          'aws-bedrock': 'anthropic.claude-3-sonnet-20240229-v1:0',
        },
        'gpt-3.5-turbo': {
          anthropic: 'claude-3-haiku',
          google: 'gemini-pro',
          'aws-bedrock': 'anthropic.claude-3-haiku-20240307-v1:0',
        },
        'claude-3-opus': {
          openai: 'gpt-4',
          google: 'gemini-pro',
          'aws-bedrock': 'anthropic.claude-3-opus-20240229-v1:0',
        },
        'claude-3-sonnet': {
          openai: 'gpt-4-turbo',
          google: 'gemini-pro',
          'aws-bedrock': 'anthropic.claude-3-sonnet-20240229-v1:0',
        },
        'claude-3-haiku': {
          openai: 'gpt-3.5-turbo',
          google: 'gemini-pro',
          'aws-bedrock': 'anthropic.claude-3-haiku-20240307-v1:0',
        },
        'gemini-pro': {
          openai: 'gpt-3.5-turbo',
          anthropic: 'claude-3-haiku',
          'aws-bedrock': 'anthropic.claude-3-haiku-20240307-v1:0',
        },
      };

      const alternatives = providerAlternatives[currentProvider] || [];

      for (const altProvider of alternatives) {
        let altModel = model;
        const baseModel = model.split(':')[0];

        if (
          modelEquivalents[baseModel] &&
          modelEquivalents[baseModel][altProvider]
        ) {
          altModel = modelEquivalents[baseModel][altProvider];
        } else if (altProvider === 'aws-bedrock' && model.includes('claude')) {
          altModel = `anthropic.${baseModel}-20240229-v1:0`;
        }

        const circuitState = this.cortexModelRouter.getCircuitBreakerState(
          altProvider,
          altModel,
        );

        if (circuitState === 'closed') {
          return { provider: altProvider, model: altModel };
        }
      }

      return null;
    } catch (error) {
      loggingService.error('Failed to find alternative provider', {
        component: 'RequestInterceptor',
        model,
        currentProvider,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async findCheaperModel(
    currentModel: string,
    prompt: string,
  ): Promise<{ model: string; provider: string; cost: number } | null> {
    try {
      const complexity =
        this.cortexModelRouter.analyzePromptComplexity(prompt);
      const routingDecision =
        this.cortexModelRouter.makeRoutingDecision(
          complexity,
          {
            priority: 'cost',
            maxCostPerRequest:
              this.getCostPerToken(currentModel) *
              0.7 *
              Math.ceil(prompt.length / 4),
          } as RoutingPreferences,
        );

      if (routingDecision?.selectedTier) {
        const config =
          this.cortexModelRouter.getModelConfiguration(routingDecision);
        return {
          model: config.cortexCoreModel,
          provider: this.getProviderFromModel(config.cortexCoreModel),
          cost:
            this.getCostPerToken(config.cortexCoreModel) *
            Math.ceil(prompt.length / 4),
        };
      }

      return null;
    } catch (error) {
      loggingService.error('Failed to find cheaper model', {
        component: 'RequestInterceptor',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async estimateCompressionSavings(
    prompt: string,
    req?: Request,
  ): Promise<{ compressedPrompt: string; savings: number }> {
    try {
      if (!req) {
        return { compressedPrompt: prompt, savings: 0 };
      }

      const originalBody = { messages: [{ role: 'user', content: prompt }] };
      const compressed = await this.gatewayCortex.processGatewayRequest(
        req,
        originalBody,
      );

      if (!compressed.processedBody) {
        return { compressedPrompt: prompt, savings: 0 };
      }

      const extractedPrompt =
        (compressed.processedBody as any).prompt ||
        (compressed.processedBody as any).messages?.[0]?.content ||
        prompt;

      const originalTokens = Math.ceil(prompt.length / 4);
      const compressedTokens = Math.ceil(extractedPrompt.length / 4);
      const tokensSaved = originalTokens - compressedTokens;
      const costPerToken = 0.000001;

      return {
        compressedPrompt: extractedPrompt,
        savings: Math.max(0, tokensSaved * costPerToken),
      };
    } catch (error) {
      loggingService.error('Failed to estimate compression savings', {
        component: 'RequestInterceptor',
        error: error instanceof Error ? error.message : String(error),
      });
      return { compressedPrompt: prompt, savings: 0 };
    }
  }
}
