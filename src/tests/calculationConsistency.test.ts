import { calculateUnifiedSavings, convertToCortexMetrics } from '../utils/calculationUtils';
import { AIProvider } from '../types/aiCostTracker.types';

describe('Calculation Consistency Tests', () => {
    describe('Unified Calculation Function', () => {
        it('should calculate consistent token and cost savings', () => {
            const originalPrompt = 'This is a very long prompt with lots of unnecessary words that could be optimized to save tokens and reduce costs significantly';
            const optimizedResponse = 'Optimized prompt with fewer tokens';
            const provider = AIProvider.OpenAI;
            const model = 'gpt-4';
            
            const result = calculateUnifiedSavings(
                originalPrompt,
                optimizedResponse,
                provider,
                model,
                150
            );
            
            // Check that all values are calculated
            expect(result.originalTokens).toBeGreaterThan(0);
            expect(result.optimizedTokens).toBeGreaterThan(0);
            expect(result.originalCost).toBeGreaterThan(0);
            expect(result.optimizedCost).toBeGreaterThan(0);
            
            // Check that savings are calculated correctly
            expect(result.tokensSaved).toBe(result.originalTokens - result.optimizedTokens);
            expect(result.costSaved).toBeCloseTo(result.originalCost - result.optimizedCost, 6);
            
            // Check percentage calculations
            const expectedTokenPercentage = (result.tokensSaved / result.originalTokens) * 100;
            expect(result.tokensSavedPercentage).toBeCloseTo(expectedTokenPercentage, 2);
            
            const expectedCostPercentage = (result.costSaved / result.originalCost) * 100;
            expect(result.costSavedPercentage).toBeCloseTo(expectedCostPercentage, 2);
            
            // Check display values are absolute
            expect(result.displayTokensSaved).toBe(Math.abs(result.tokensSaved));
            expect(result.displayCostSaved).toBe(Math.abs(result.costSaved));
            expect(result.displayPercentage).toBe(Math.abs(result.tokensSavedPercentage));
        });
        
        it('should handle cases where optimized response is longer than prompt but still saves overall', () => {
            const originalPrompt = 'Short query';
            const optimizedResponse = 'This is a much longer response that provides a comprehensive answer with detailed information and context';
            const provider = AIProvider.OpenAI;
            const model = 'gpt-4';
            
            const result = calculateUnifiedSavings(
                originalPrompt,
                optimizedResponse,
                provider,
                model,
                150
            );
            
            // Even though response is longer than prompt, we save overall because
            // we eliminate the need for the completion tokens
            // Original: prompt (3 tokens) + completion (150 tokens) = 153 tokens
            // Optimized: just the response (26 tokens) = 26 tokens
            // Savings: 153 - 26 = 127 tokens (positive savings)
            expect(result.tokensSaved).toBeGreaterThan(0);
            expect(result.costSaved).toBeGreaterThan(0);
            expect(result.tokensSavedPercentage).toBeGreaterThan(0);
            expect(result.costSavedPercentage).toBeGreaterThan(0);
            
            // Display values should be positive
            expect(result.displayTokensSaved).toBeGreaterThan(0);
            expect(result.displayCostSaved).toBeGreaterThan(0);
            expect(result.displayPercentage).toBeGreaterThan(0);
            
            // isIncrease flag should be false since we're saving
            expect(result.isIncrease).toBe(false);
        });
        
        it('should handle cases where optimized response truly increases tokens', () => {
            const originalPrompt = 'Tell me about JavaScript';
            // A response that's longer than prompt + expected completion
            const veryLongResponse = 'JavaScript '.repeat(200); // ~400 tokens
            const provider = AIProvider.OpenAI;
            const model = 'gpt-4';
            
            const result = calculateUnifiedSavings(
                originalPrompt,
                veryLongResponse,
                provider,
                model,
                150 // Expected completion
            );
            
            // When optimized response is longer than original + completion, it's an increase
            // Original: prompt (~6 tokens) + completion (150 tokens) = 156 tokens
            // Optimized: response (~400 tokens) = 400 tokens
            // Difference: 156 - 400 = -244 tokens (negative = increase)
            expect(result.tokensSaved).toBeLessThan(0);
            expect(result.costSaved).toBeLessThan(0);
            expect(result.tokensSavedPercentage).toBeLessThan(0);
            expect(result.costSavedPercentage).toBeLessThan(0);
            
            // Display values should be positive (absolute values)
            expect(result.displayTokensSaved).toBeGreaterThan(0);
            expect(result.displayCostSaved).toBeGreaterThan(0);
            expect(result.displayPercentage).toBeGreaterThan(0);
            
            // isIncrease flag should be true
            expect(result.isIncrease).toBe(true);
        });
        
        it('should handle different providers correctly', () => {
            const prompt = 'Test prompt for different providers';
            const response = 'Optimized response';
            
            const providers = [
                AIProvider.OpenAI,
                AIProvider.Anthropic,
                AIProvider.Google,
                AIProvider.AWSBedrock
            ];
            
            const results = providers.map(provider => 
                calculateUnifiedSavings(prompt, response, provider, 'test-model', 150)
            );
            
            // All providers should produce valid results
            results.forEach(result => {
                expect(result.originalTokens).toBeGreaterThan(0);
                expect(result.optimizedTokens).toBeGreaterThan(0);
                expect(result.originalCost).toBeGreaterThan(0);
                expect(result.optimizedCost).toBeGreaterThan(0);
            });
        });
    });
    
    describe('Cortex Metrics Conversion', () => {
        it('should convert unified results to cortex metrics format correctly', () => {
            const unifiedResult = calculateUnifiedSavings(
                'Original prompt text',
                'Optimized text',
                AIProvider.OpenAI,
                'gpt-4',
                150
            );
            
            const cortexMetrics = convertToCortexMetrics(unifiedResult);
            
            // Check token reduction matches
            expect(cortexMetrics.tokenReduction.withoutCortex).toBe(unifiedResult.originalTokens);
            expect(cortexMetrics.tokenReduction.withCortex).toBe(unifiedResult.optimizedTokens);
            expect(cortexMetrics.tokenReduction.absoluteSavings).toBe(unifiedResult.tokensSaved);
            expect(cortexMetrics.tokenReduction.percentageSavings).toBe(unifiedResult.tokensSavedPercentage);
            
            // Check cost impact matches
            expect(cortexMetrics.costImpact.estimatedCostWithoutCortex).toBe(unifiedResult.originalCost);
            expect(cortexMetrics.costImpact.actualCostWithCortex).toBe(unifiedResult.optimizedCost);
            expect(cortexMetrics.costImpact.costSavings).toBe(unifiedResult.costSaved);
            expect(cortexMetrics.costImpact.savingsPercentage).toBe(unifiedResult.costSavedPercentage);
            
            // Check that quality metrics are present
            expect(cortexMetrics.qualityMetrics).toBeDefined();
            expect(cortexMetrics.qualityMetrics.clarityScore).toBeGreaterThanOrEqual(0);
            expect(cortexMetrics.qualityMetrics.clarityScore).toBeLessThanOrEqual(100);
            
            // Check performance metrics
            expect(cortexMetrics.performanceMetrics).toBeDefined();
            expect(cortexMetrics.performanceMetrics.processingTime).toBeGreaterThan(0);
            
            // Check justification
            expect(cortexMetrics.justification).toBeDefined();
            expect(cortexMetrics.justification.optimizationTechniques).toBeInstanceOf(Array);
            expect(cortexMetrics.justification.optimizationTechniques.length).toBeGreaterThan(0);
        });
        
        it('should preserve custom quality metrics when provided', () => {
            const unifiedResult = calculateUnifiedSavings(
                'Original prompt',
                'Optimized',
                AIProvider.OpenAI,
                'gpt-4',
                150
            );
            
            const customQualityMetrics = {
                clarityScore: 95,
                completenessScore: 88,
                relevanceScore: 92
            };
            
            const cortexMetrics = convertToCortexMetrics(
                unifiedResult,
                customQualityMetrics
            );
            
            expect(cortexMetrics.qualityMetrics.clarityScore).toBe(95);
            expect(cortexMetrics.qualityMetrics.completenessScore).toBe(88);
            expect(cortexMetrics.qualityMetrics.relevanceScore).toBe(92);
        });
    });
    
    describe('Token to Dollar Calculation Consistency', () => {
        it('should maintain bidirectional consistency between tokens and cost', () => {
            const originalPrompt = 'Test prompt for bidirectional consistency';
            const optimizedResponse = 'Optimized';
            
            const result = calculateUnifiedSavings(
                originalPrompt,
                optimizedResponse,
                AIProvider.OpenAI,
                'gpt-4',
                150
            );
            
            // Calculate cost per token
            const originalCostPerToken = result.originalCost / result.originalTokens;
            const optimizedCostPerToken = result.optimizedCost / result.optimizedTokens;
            
            // Verify that cost savings match token savings when using the same rate
            // Note: This might not be exact due to different input/output pricing
            // but the relationship should be consistent
            if (result.tokensSaved > 0) {
                expect(result.costSaved).toBeGreaterThan(0);
            } else if (result.tokensSaved < 0) {
                expect(result.costSaved).toBeLessThan(0);
            }
            
            // Verify percentage consistency
            if (result.tokensSavedPercentage !== 0) {
                // The percentages might differ slightly due to different input/output pricing
                // but they should have the same sign
                expect(Math.sign(result.tokensSavedPercentage)).toBe(Math.sign(result.costSavedPercentage));
            }
        });
    });
    
    describe('Edge Cases', () => {
        it('should handle empty prompts', () => {
            const result = calculateUnifiedSavings(
                '',
                '',
                AIProvider.OpenAI,
                'gpt-4',
                150
            );
            
            expect(result.originalTokens).toBe(150); // Just completion tokens
            expect(result.optimizedTokens).toBe(0);
            expect(result.tokensSaved).toBe(150);
        });
        
        it('should handle very long prompts', () => {
            const longPrompt = 'word '.repeat(10000);
            const result = calculateUnifiedSavings(
                longPrompt,
                'Short response',
                AIProvider.OpenAI,
                'gpt-4',
                150
            );
            
            expect(result.originalTokens).toBeGreaterThan(10000);
            expect(result.tokensSaved).toBeGreaterThan(10000);
            expect(result.costSaved).toBeGreaterThan(0);
        });
        
        it('should handle unknown models with fallback pricing', () => {
            const result = calculateUnifiedSavings(
                'Test prompt',
                'Response',
                'CustomProvider',
                'unknown-model',
                150
            );
            
            // Should still calculate with fallback pricing
            expect(result.originalCost).toBeGreaterThan(0);
            expect(result.optimizedCost).toBeGreaterThan(0);
        });
    });
});

// Helper function to run specific test
export function verifyCalculationConsistency(
    optimization: any,
    cortexMetrics: any
): boolean {
    // Check that main optimization values match cortex metrics
    const tokenMatch = optimization.tokensSaved === cortexMetrics.tokenReduction.absoluteSavings;
    const costMatch = Math.abs(optimization.costSaved - cortexMetrics.costImpact.costSavings) < 0.0001;
    const percentageMatch = Math.abs(optimization.improvementPercentage - cortexMetrics.tokenReduction.percentageSavings) < 0.1;
    
    if (!tokenMatch || !costMatch || !percentageMatch) {
        console.error('Calculation inconsistency detected:', {
            tokenMatch,
            costMatch,
            percentageMatch,
            optimization: {
                tokensSaved: optimization.tokensSaved,
                costSaved: optimization.costSaved,
                improvementPercentage: optimization.improvementPercentage
            },
            cortexMetrics: {
                tokensSaved: cortexMetrics.tokenReduction.absoluteSavings,
                costSaved: cortexMetrics.costImpact.costSavings,
                percentageSavings: cortexMetrics.tokenReduction.percentageSavings
            }
        });
        return false;
    }
    
    return true;
}
