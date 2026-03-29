/**
 * Decides whether multi-stage Cortex processing is likely to save cost vs a single LLM call.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PricingService } from '../../utils/services/pricing.service';
import { TokenCounterService } from '../../utils/services/token-counter.service';
import { DEFAULT_CORTEX_BREAKEVEN_POLICY } from '../../../config/strategicPolicies.config';

export interface CortexDecisionResult {
  useCortex: boolean;
  reason: string;
  promptTokens?: number;
  estimatedBaselineCost?: number;
  estimatedCortexCost?: number;
}

@Injectable()
export class CortexDecisionService {
  private readonly logger = new Logger(CortexDecisionService.name);

  constructor(
    private readonly pricingService: PricingService,
    private readonly tokenCounterService: TokenCounterService,
  ) {}

  /**
   * Heuristic cost comparison: 3-stage Cortex vs one direct completion on baselineModel.
   */
  shouldUseCortex(params: {
    prompt: string;
    baselineModel?: string;
    encoderModel?: string;
    coreModel?: string;
    decoderModel?: string;
    estimatedOutputTokens?: number;
    forceCortex?: boolean;
  }): CortexDecisionResult {
    const policy = DEFAULT_CORTEX_BREAKEVEN_POLICY;

    if (params.forceCortex === true) {
      return { useCortex: true, reason: 'forced' };
    }

    const baselineModel = params.baselineModel || 'amazon.nova-pro-v1:0';
    const encoderModel =
      params.encoderModel ||
      'global.anthropic.claude-haiku-4-5-20251001-v1:0';
    const coreModel =
      params.coreModel || 'anthropic.claude-3-5-haiku-20241022-v1:0';
    const decoderModel = params.decoderModel || 'amazon.nova-pro-v1:0';

    const promptTokens = this.tokenCounterService.countTokens(params.prompt, {
      model: baselineModel,
    }).tokens;

    if (promptTokens < policy.minPromptTokens) {
      return {
        useCortex: false,
        reason: `prompt_below_min_tokens_${policy.minPromptTokens}`,
        promptTokens,
      };
    }

    const outTok =
      params.estimatedOutputTokens ??
      policy.estimatedCompletionTokensDefault;

    const baseline = this.pricingService.estimateCost(
      baselineModel,
      promptTokens,
      outTok,
    );
    const baselineCost = baseline?.totalCost ?? 0;

    const encOut = Math.max(16, Math.ceil(promptTokens * 0.35));
    const coreOut = Math.max(16, Math.ceil(promptTokens * 0.35));

    const encCost = this.pricingService.estimateCost(
      encoderModel,
      promptTokens,
      encOut,
    );
    const coreCost = this.pricingService.estimateCost(
      coreModel,
      encOut,
      coreOut,
    );
    const decCost = this.pricingService.estimateCost(
      decoderModel,
      coreOut,
      outTok,
    );

    const cortexTotal =
      (encCost?.totalCost ?? 0) +
      (coreCost?.totalCost ?? 0) +
      (decCost?.totalCost ?? 0);

    if (baselineCost <= 0 || cortexTotal <= 0) {
      this.logger.debug('Cortex breakeven: incomplete pricing, allowing Cortex', {
        baselineCost,
        cortexTotal,
      });
      return {
        useCortex: true,
        reason: 'pricing_incomplete_default_allow_cortex',
        promptTokens,
        estimatedBaselineCost: baselineCost,
        estimatedCortexCost: cortexTotal,
      };
    }

    const ratio = cortexTotal / baselineCost;
    if (ratio > policy.maxCostRatioVsBaseline) {
      this.logger.debug('Cortex breakeven: skip multi-stage', {
        baselineCost,
        cortexTotal,
        ratio,
        maxRatio: policy.maxCostRatioVsBaseline,
      });
      return {
        useCortex: false,
        reason: 'multi_stage_cost_exceeds_baseline',
        promptTokens,
        estimatedBaselineCost: baselineCost,
        estimatedCortexCost: cortexTotal,
      };
    }

    return {
      useCortex: true,
      reason: 'breakeven_ok',
      promptTokens,
      estimatedBaselineCost: baselineCost,
      estimatedCortexCost: cortexTotal,
    };
  }
}
