/**
 * Cost Estimator
 * Estimate costs for AI model usage
 */

export class CostEstimator {
    private static readonly PRICING_MAP: Record<string, { input: number; output: number }> = {
        'amazon.nova-micro-v1:0': { input: 0.035, output: 0.14 },
        'amazon.nova-lite-v1:0': { input: 0.06, output: 0.24 },
        'amazon.nova-pro-v1:0': { input: 0.80, output: 3.20 },
        'global.anthropic.claude-haiku-4-5-20251001-v1:0': { input: 1.0, output: 5.0 },
        'anthropic.claude-sonnet-4-20250514-v1:0': { input: 3.0, output: 15.0 },
    };

    /**
     * Estimate cost for model usage
     */
    static estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
        const pricing = this.PRICING_MAP[modelId] || { input: 1.0, output: 5.0 }; // Default pricing
        
        const inputCost = (inputTokens / 1000000) * pricing.input;
        const outputCost = (outputTokens / 1000000) * pricing.output;
        
        return inputCost + outputCost;
    }
}
