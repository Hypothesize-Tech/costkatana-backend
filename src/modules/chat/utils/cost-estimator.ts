import { Injectable } from '@nestjs/common';
import { AWS_BEDROCK_PRICING } from '../../../utils/pricing/aws-bedrock';

@Injectable()
export class CostEstimator {
  private static readonly pricingCache: Map<
    string,
    { input: number; output: number }
  > = new Map();

  static estimateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const modelPricing = this.getModelPricing(modelId);
    if (!modelPricing) {
      return 0.001; // Default fallback
    }

    return (
      (inputTokens / 1_000_000) * modelPricing.input +
      (outputTokens / 1_000_000) * modelPricing.output
    );
  }

  private static getModelPricing(
    modelId: string,
  ): { input: number; output: number } | null {
    // Check cache first
    if (this.pricingCache.has(modelId)) {
      return this.pricingCache.get(modelId)!;
    }

    // Find model in AWS_BEDROCK_PRICING
    const modelData = AWS_BEDROCK_PRICING.find(
      (model) => model.modelId === modelId,
    );
    if (!modelData) {
      return null;
    }

    // Convert from dollars per 1M tokens to dollars per token
    const pricing = {
      input: modelData.inputPrice,
      output: modelData.outputPrice,
    };

    // Cache the result
    this.pricingCache.set(modelId, pricing);
    return pricing;
  }
}
