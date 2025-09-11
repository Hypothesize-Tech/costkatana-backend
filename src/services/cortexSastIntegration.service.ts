/**
 * Cortex SAST Integration Service
 * 
 * Integration layer that demonstrates the evolution from basic Cortex frames
 * to true Semantic Abstract Syntax Trees with semantic primitives. This service
 * provides comparison capabilities and shows the advancement in semantic representation.
 */

import { SemanticPrimitivesService } from './semanticPrimitives.service';
import { CortexSastEncoderService, SastEncodingResult } from './cortexSastEncoder.service';
import { CortexEncoderService } from './cortexEncoder.service';
import { 
    CortexFrame,
    CortexConfig,
    CortexError,
    CortexErrorCode,
    CortexProcessingRequest,
    CortexEncodingResult,
    DEFAULT_CORTEX_CONFIG,
    CortexEncodingRequest,
    CortexSastEncodingRequest
} from '../types/cortex.types';
import { SemanticCortexFrame } from '../types/semanticPrimitives.types';
import { BedrockService } from './bedrock.service';
import { loggingService } from './logging.service';

// ============================================================================
// COMPARISON TYPES
// ============================================================================

export interface CortexEvolutionComparison {
    inputText: string;
    language: string;
    
    // Traditional Cortex (v1)
    traditionalCortex: {
        result: CortexEncodingResult;
        tokenCount: number;
        ambiguityLevel: 'high' | 'medium' | 'low';
        semanticExplicitness: number; // 0-1 scale
    };
    
    // SAST Cortex (v2) 
    sastCortex: {
        result: SastEncodingResult;
        primitiveCount: number;
        ambiguitiesResolved: number;
        semanticExplicitness: number; // 0-1 scale
    };
    
    // Improvements
    improvements: {
        tokenReduction: number;
        ambiguityReduction: number;
        semanticClarityGain: number;
        crossLingualCompatibility: boolean;
        processingEfficiency: number;
    };
    
    metadata: {
        comparisonTime: number;
        complexityLevel: 'simple' | 'moderate' | 'complex';
        recommendedApproach: 'traditional' | 'sast' | 'hybrid';
    };
}

export interface UniversalSemanticTest {
    concept: string;
    languages: string[];
    translations: Record<string, string>;
    sastRepresentations: Record<string, SemanticCortexFrame>;
    isUniversal: boolean;
    unificationScore: number;
}

// ============================================================================
// CORTEX SAST INTEGRATION SERVICE
// ============================================================================

export class CortexSastIntegrationService {
    private static instance: CortexSastIntegrationService;
    
    private primitivesService: SemanticPrimitivesService;
    private sastEncoder: CortexSastEncoderService;
    private traditionalEncoder: CortexEncoderService;
    
    // Comparison statistics
    private comparisonStats = {
        totalComparisons: 0,
        sastWins: 0,
        traditionalWins: 0,
        averageImprovement: 0,
        ambiguityResolutionRate: 0
    };

    private constructor() {
        this.primitivesService = SemanticPrimitivesService.getInstance();
        this.sastEncoder = CortexSastEncoderService.getInstance();
        this.traditionalEncoder = CortexEncoderService.getInstance();
    }

    public static getInstance(): CortexSastIntegrationService {
        if (!this.instance) {
            this.instance = new CortexSastIntegrationService();
        }
        return this.instance;
    }

    // ========================================================================
    // EVOLUTION COMPARISON
    // ========================================================================

    public async compareEvolution(
        text: string,
        language: string = 'en'
    ): Promise<CortexEvolutionComparison> {
        const startTime = Date.now();
        
        loggingService.info('⚖️ Starting Cortex evolution comparison', {
            text: text.substring(0, 50),
            language
        });

        try {
            // Process with traditional Cortex encoder
            const traditionalRequest: CortexEncodingRequest = {
                text: text,
                language: language
            };
            const traditionalResult = await this.traditionalEncoder.encode(traditionalRequest);

            // Process with SAST encoder
            const sastResult = await this.sastEncoder.encodeSast({
                text,
                language,
                disambiguationStrategy: 'hybrid'
            });

            // Calculate metrics
            const traditionalMetrics = this.analyzeTraditionalResult(traditionalResult as any, text);
            const sastMetrics = this.analyzeSastResult(sastResult, text);
            
            // Calculate improvements
            const improvements = {
                tokenReduction: this.calculateTokenReduction(traditionalMetrics.tokenCount, sastMetrics.primitiveCount),
                ambiguityReduction: this.calculateAmbiguityReduction(traditionalMetrics.ambiguityLevel, sastMetrics.ambiguitiesResolved),
                semanticClarityGain: sastMetrics.semanticExplicitness - traditionalMetrics.semanticExplicitness,
                crossLingualCompatibility: sastResult.metadata.crossLingualEquivalent,
                processingEfficiency: this.calculateProcessingEfficiency(
                    traditionalResult.processingTime,
                    sastResult.metadata.processingTime
                )
            };

            const comparison: CortexEvolutionComparison = {
                inputText: text,
                language,
                traditionalCortex: traditionalMetrics,
                sastCortex: sastMetrics,
                improvements,
                metadata: {
                    comparisonTime: Date.now() - startTime,
                    complexityLevel: this.assessComplexity(text),
                    recommendedApproach: this.recommendApproach(improvements)
                }
            };

            this.updateComparisonStats(comparison);

            loggingService.info('✅ Cortex evolution comparison completed', {
                tokenReduction: `${improvements.tokenReduction.toFixed(1)}%`,
                ambiguityReduction: improvements.ambiguityReduction,
                semanticGain: `${(improvements.semanticClarityGain * 100).toFixed(1)}%`,
                recommended: comparison.metadata.recommendedApproach
            });

            return comparison;

        } catch (error) {
            loggingService.error('❌ Evolution comparison failed', { text, error });
            throw error;
        }
    }

    private analyzeTraditionalResult(result: CortexEncodingResult, text: string) {
        return {
            result,
            tokenCount: this.estimateTokenCount(text),
            ambiguityLevel: this.assessAmbiguityLevel(text) as 'high' | 'medium' | 'low',
            semanticExplicitness: this.calculateSemanticExplicitness((result as any).cortexFrame || result)
        };
    }

    private analyzeSastResult(result: SastEncodingResult, text: string) {
        return {
            result,
            primitiveCount: result.sourceMapping.primitives.length,
            ambiguitiesResolved: result.ambiguitiesResolved.length,
            semanticExplicitness: this.calculateSastSemanticExplicitness(result.semanticFrame)
        };
    }

    private estimateTokenCount(text: string): number {
        // Simple tokenization estimate
        return text.split(/\s+/).length + text.split(/[^\w\s]/).length - 1;
    }

    private assessAmbiguityLevel(text: string): 'high' | 'medium' | 'low' {
        // Heuristic for ambiguity assessment
        const ambiguityMarkers = [
            'with', 'on', 'in', 'by', 'of',  // PP attachment ambiguity
            'that', 'which', 'who',          // Relative clause ambiguity
            'and', 'or',                     // Coordination ambiguity
            'not', 'no',                     // Scope ambiguity
            'every', 'all', 'some'           // Quantifier scope
        ];

        const markerCount = ambiguityMarkers.filter(marker => text.toLowerCase().includes(marker)).length;
        
        if (markerCount >= 3) return 'high';
        if (markerCount >= 1) return 'medium';
        return 'low';
    }

    private calculateSemanticExplicitness(frame: any): number {
        // Measure how explicitly semantic the traditional frame is
        const hasSemanticRoles = ['agent', 'action', 'object', 'instrument'].some(role => 
            role in frame
        );
        
        const structureComplexity = Object.keys(frame).length / 10; // Normalized
        const explicitness = hasSemanticRoles ? 0.6 : 0.3;
        
        return Math.min(explicitness + structureComplexity, 1.0);
    }

    private calculateSastSemanticExplicitness(frame: SemanticCortexFrame): number {
        // SAST frames are inherently more semantically explicit
        const primitiveExplicitness = frame.metadata.primitiveCount / 20; // Normalized
        const ambiguityBonus = frame.metadata.ambiguityResolved ? 0.2 : 0;
        const crossLingualBonus = frame.metadata.crossLingualEquivalent ? 0.2 : 0;
        
        return Math.min(0.7 + primitiveExplicitness + ambiguityBonus + crossLingualBonus, 1.0);
    }

    private calculateTokenReduction(traditionalTokens: number, primitiveCount: number): number {
        return ((traditionalTokens - primitiveCount) / traditionalTokens) * 100;
    }

    private calculateAmbiguityReduction(ambiguityLevel: string, resolvedCount: number): number {
        const baseAmbiguity = { low: 1, medium: 3, high: 5 }[ambiguityLevel] || 3;
        return Math.min(resolvedCount / baseAmbiguity, 1.0) * 100;
    }

    private calculateProcessingEfficiency(traditionalTime: number, sastTime: number): number {
        // Positive means SAST is more efficient
        return ((traditionalTime - sastTime) / traditionalTime) * 100;
    }

    private assessComplexity(text: string): 'simple' | 'moderate' | 'complex' {
        const sentences = text.split(/[.!?]+/).length;
        const avgWordsPerSentence = text.split(/\s+/).length / sentences;
        
        if (avgWordsPerSentence > 20) return 'complex';
        if (avgWordsPerSentence > 10) return 'moderate';
        return 'simple';
    }

    private recommendApproach(improvements: CortexEvolutionComparison['improvements']): 'traditional' | 'sast' | 'hybrid' {
        let sastScore = 0;
        
        if (improvements.tokenReduction > 10) sastScore += 2;
        if (improvements.ambiguityReduction > 50) sastScore += 2;
        if (improvements.semanticClarityGain > 0.2) sastScore += 2;
        if (improvements.crossLingualCompatibility) sastScore += 1;
        
        if (sastScore >= 5) return 'sast';
        if (sastScore >= 2) return 'hybrid';
        return 'traditional';
    }

    // ========================================================================
    // UNIVERSAL SEMANTIC TESTING
    // ========================================================================

    public async testUniversalSemantics(
        concept: string,
        languages: string[] = ['en', 'es', 'fr', 'de', 'ja', 'zh']
    ): Promise<UniversalSemanticTest> {
        
        loggingService.info('🌐 Testing universal semantic representation', {
            concept,
            languages: languages.length
        });

        const translations: Record<string, string> = {};
        const sastRepresentations: Record<string, SemanticCortexFrame> = {};

        // Mock translations (in production, use translation service)
        const mockTranslations = {
            'the sky is blue': {
                en: 'the sky is blue',
                es: 'el cielo es azul',
                fr: 'le ciel est bleu',
                de: 'der himmel ist blau',
                ja: '空は青いです',
                zh: '天空是蓝色的'
            }
        };

        const conceptTranslations = (mockTranslations as any)[concept] || { en: concept };

        // Process each language
        for (const lang of languages) {
            const text = conceptTranslations[lang] || conceptTranslations['en'];
            translations[lang] = text;

            try {
                const result = await this.sastEncoder.encodeSast({
                    text,
                    language: lang,
                    disambiguationStrategy: 'hybrid'
                });

                sastRepresentations[lang] = result.semanticFrame;
            } catch (error) {
                loggingService.warn(`Failed to process ${lang}`, { error });
            }
        }

        // Calculate universality
        const unificationScore = this.calculateUnificationScore(sastRepresentations);
        const isUniversal = unificationScore > 0.8;

        return {
            concept,
            languages,
            translations,
            sastRepresentations,
            isUniversal,
            unificationScore
        };
    }

    private calculateUnificationScore(representations: Record<string, SemanticCortexFrame>): number {
        // Simplified unification scoring
        const languages = Object.keys(representations);
        if (languages.length < 2) return 0;

        const baselineFrame = representations[languages[0]];
        let totalSimilarity = 0;

        for (let i = 1; i < languages.length; i++) {
            const compareFrame = representations[languages[i]];
            const similarity = this.calculateFrameSimilarity(baselineFrame, compareFrame);
            totalSimilarity += similarity;
        }

        return totalSimilarity / (languages.length - 1);
    }

    private calculateFrameSimilarity(frame1: SemanticCortexFrame, frame2: SemanticCortexFrame): number {
        // Simple similarity metric based on shared primitive patterns
        const primitives1 = Object.values(frame1.primitives);
        const primitives2 = Object.values(frame2.primitives);
        
        let matches = 0;
        for (const p1 of primitives1) {
            if (primitives2.includes(p1)) {
                matches++;
            }
        }

        const total = Math.max(primitives1.length, primitives2.length);
        return total > 0 ? matches / total : 0;
    }

    // ========================================================================
    // DEMONSTRATION METHODS
    // ========================================================================

    public async demonstrateEvolutionShowcase(): Promise<{
        examples: CortexEvolutionComparison[];
        summary: {
            avgTokenReduction: number;
            avgAmbiguityReduction: number;
            avgSemanticGain: number;
            universalCompatibility: number;
        };
    }> {
        const testSentences = [
            "I saw a man on the hill with a telescope",
            "The report that the committee submitted was rejected",
            "Flying planes can be dangerous", 
            "The chicken is ready to eat",
            "Time flies like an arrow"
        ];

        const examples: CortexEvolutionComparison[] = [];
        
        for (const sentence of testSentences) {
            const comparison = await this.compareEvolution(sentence, 'en');
            examples.push(comparison);
        }

        // Calculate summary statistics
        const avgTokenReduction = examples.reduce((sum, ex) => sum + ex.improvements.tokenReduction, 0) / examples.length;
        const avgAmbiguityReduction = examples.reduce((sum, ex) => sum + ex.improvements.ambiguityReduction, 0) / examples.length;
        const avgSemanticGain = examples.reduce((sum, ex) => sum + ex.improvements.semanticClarityGain, 0) / examples.length;
        const universalCompatibility = examples.filter(ex => ex.improvements.crossLingualCompatibility).length / examples.length;

        loggingService.info('🎯 Evolution showcase completed', {
            examples: examples.length,
            avgTokenReduction: `${avgTokenReduction.toFixed(1)}%`,
            avgAmbiguityReduction: `${avgAmbiguityReduction.toFixed(1)}%`,
            avgSemanticGain: `${(avgSemanticGain * 100).toFixed(1)}%`,
            universalCompatibility: `${(universalCompatibility * 100).toFixed(1)}%`
        });

        return {
            examples,
            summary: {
                avgTokenReduction,
                avgAmbiguityReduction,
                avgSemanticGain,
                universalCompatibility
            }
        };
    }

    private updateComparisonStats(comparison: CortexEvolutionComparison): void {
        this.comparisonStats.totalComparisons++;
        
        if (comparison.metadata.recommendedApproach === 'sast') {
            this.comparisonStats.sastWins++;
        } else if (comparison.metadata.recommendedApproach === 'traditional') {
            this.comparisonStats.traditionalWins++;
        }

        const improvement = comparison.improvements.semanticClarityGain;
        this.comparisonStats.averageImprovement = 
            (this.comparisonStats.averageImprovement * (this.comparisonStats.totalComparisons - 1) + improvement) 
            / this.comparisonStats.totalComparisons;

        if (comparison.sastCortex.ambiguitiesResolved > 0) {
            this.comparisonStats.ambiguityResolutionRate++;
        }
    }

    public getComparisonStats() {
        return {
            ...this.comparisonStats,
            sastWinRate: this.comparisonStats.sastWins / this.comparisonStats.totalComparisons * 100,
            ambiguityResolutionRate: this.comparisonStats.ambiguityResolutionRate / this.comparisonStats.totalComparisons * 100
        };
    }
}
