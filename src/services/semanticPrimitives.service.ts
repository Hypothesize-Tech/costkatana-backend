/**
 * Semantic Primitives Service
 * 
 * Core service for managing semantic primitives and mappings in the Cortex SAST system.
 * This service replaces natural language tokens with unambiguous semantic primitives
 * like concept_1123=fox, action_54=jump, enabling true semantic abstraction.
 */

import {
    SemanticPrimitive,
    SemanticPrimitiveId,
    SemanticCategory,
    LanguageToPrimitiveMapping,
    SemanticPrimitiveMatch,
    AmbiguityResolution,
    SemanticInterpretation,
    SemanticVocabularyStats,
    SemanticSearchQuery,
    SemanticSearchResult,
    CrossLingualEquivalence,
    RelationType,
    SemanticRelationship
} from '../types/semanticPrimitives.types';
import { loggingService } from './logging.service';
import * as crypto from 'crypto';

// ============================================================================
// SEMANTIC PRIMITIVES SERVICE
// ============================================================================

export class SemanticPrimitivesService {
    private static instance: SemanticPrimitivesService;
    
    // Core vocabulary storage
    private primitives: Map<SemanticPrimitiveId, SemanticPrimitive> = new Map();
    private categoryIndex: Map<SemanticCategory, Set<SemanticPrimitiveId>> = new Map();
    private languageIndex: Map<string, Map<string, SemanticPrimitiveId[]>> = new Map();
    private frequencyIndex: SemanticPrimitiveId[] = []; // Sorted by frequency
    
    // Cross-lingual mappings
    private crossLingualMappings: Map<SemanticPrimitiveId, CrossLingualEquivalence> = new Map();
    
    // Primitive ID counters
    private idCounters: Map<SemanticCategory, number> = new Map();
    
    private constructor() {
        this.initializeVocabulary();
    }

    public static getInstance(): SemanticPrimitivesService {
        if (!this.instance) {
            this.instance = new SemanticPrimitivesService();
        }
        return this.instance;
    }

    // ========================================================================
    // INITIALIZATION & CORE VOCABULARY
    // ========================================================================

    private async initializeVocabulary(): Promise<void> {
        try {
            // Initialize category counters
            Object.values(SemanticCategory).forEach(category => {
                this.categoryIndex.set(category, new Set());
                this.idCounters.set(category, 1);
            });

            // Load base vocabulary with core primitives
            await this.loadBasePrimitives();
            
            loggingService.info('🧠 Semantic Primitives Service initialized', {
                totalPrimitives: this.primitives.size,
                categories: Object.keys(SemanticCategory).length
            });
        } catch (error) {
            loggingService.error('❌ Failed to initialize Semantic Primitives Service', { error });
            throw error;
        }
    }

    private async loadBasePrimitives(): Promise<void> {
        // Load essential semantic primitives that form the foundation
        const basePrimitives = [
            // Core concepts
            { baseForm: 'person', category: SemanticCategory.CONCEPT, definition: 'Human being' },
            { baseForm: 'animal', category: SemanticCategory.CONCEPT, definition: 'Living creature' },
            { baseForm: 'object', category: SemanticCategory.CONCEPT, definition: 'Physical thing' },
            { baseForm: 'place', category: SemanticCategory.CONCEPT, definition: 'Location or area' },
            { baseForm: 'time', category: SemanticCategory.CONCEPT, definition: 'Temporal period' },
            { baseForm: 'document', category: SemanticCategory.CONCEPT, definition: 'Written or digital record' },
            
            // Core actions  
            { baseForm: 'be', category: SemanticCategory.ACTION, definition: 'State of existence' },
            { baseForm: 'have', category: SemanticCategory.ACTION, definition: 'Possession or relationship' },
            { baseForm: 'do', category: SemanticCategory.ACTION, definition: 'Perform action' },
            { baseForm: 'go', category: SemanticCategory.ACTION, definition: 'Move or travel' },
            { baseForm: 'see', category: SemanticCategory.ACTION, definition: 'Perceive visually' },
            { baseForm: 'know', category: SemanticCategory.ACTION, definition: 'Have knowledge' },
            { baseForm: 'think', category: SemanticCategory.ACTION, definition: 'Mental process' },
            { baseForm: 'say', category: SemanticCategory.ACTION, definition: 'Express verbally' },
            { baseForm: 'get', category: SemanticCategory.ACTION, definition: 'Obtain or receive' },
            { baseForm: 'make', category: SemanticCategory.ACTION, definition: 'Create or produce' },
            { baseForm: 'give', category: SemanticCategory.ACTION, definition: 'Transfer to another' },
            { baseForm: 'use', category: SemanticCategory.ACTION, definition: 'Employ for purpose' },
            { baseForm: 'find', category: SemanticCategory.ACTION, definition: 'Discover or locate' },
            { baseForm: 'analyze', category: SemanticCategory.ACTION, definition: 'Examine systematically' },
            { baseForm: 'create', category: SemanticCategory.ACTION, definition: 'Bring into existence' },
            { baseForm: 'process', category: SemanticCategory.ACTION, definition: 'Handle systematically' },
            
            // Core properties
            { baseForm: 'good', category: SemanticCategory.PROPERTY, definition: 'Positive quality' },
            { baseForm: 'bad', category: SemanticCategory.PROPERTY, definition: 'Negative quality' },
            { baseForm: 'big', category: SemanticCategory.PROPERTY, definition: 'Large size' },
            { baseForm: 'small', category: SemanticCategory.PROPERTY, definition: 'Limited size' },
            { baseForm: 'new', category: SemanticCategory.PROPERTY, definition: 'Recently created' },
            { baseForm: 'old', category: SemanticCategory.PROPERTY, definition: 'Existing for long time' },
            { baseForm: 'important', category: SemanticCategory.PROPERTY, definition: 'High significance' },
            { baseForm: 'quick', category: SemanticCategory.PROPERTY, definition: 'Fast speed' },
            { baseForm: 'slow', category: SemanticCategory.PROPERTY, definition: 'Low speed' },
            { baseForm: 'high', category: SemanticCategory.PROPERTY, definition: 'Great degree or level' },
            { baseForm: 'low', category: SemanticCategory.PROPERTY, definition: 'Small degree or level' },
            { baseForm: 'quality', category: SemanticCategory.PROPERTY, definition: 'Standard or grade' },
            
            // Core relations
            { baseForm: 'in', category: SemanticCategory.RELATION, definition: 'Inside or within' },
            { baseForm: 'on', category: SemanticCategory.RELATION, definition: 'Positioned above' },
            { baseForm: 'at', category: SemanticCategory.RELATION, definition: 'Located near' },
            { baseForm: 'with', category: SemanticCategory.RELATION, definition: 'Accompanied by' },
            { baseForm: 'for', category: SemanticCategory.RELATION, definition: 'Purpose or benefit' },
            { baseForm: 'of', category: SemanticCategory.RELATION, definition: 'Belonging or part of' },
            { baseForm: 'to', category: SemanticCategory.RELATION, definition: 'Direction or recipient' },
            { baseForm: 'from', category: SemanticCategory.RELATION, definition: 'Origin or source' },
            { baseForm: 'over', category: SemanticCategory.RELATION, definition: 'Above or across' },
            { baseForm: 'under', category: SemanticCategory.RELATION, definition: 'Below or beneath' },
            
            // Core logical operators
            { baseForm: 'and', category: SemanticCategory.LOGICAL, definition: 'Conjunction' },
            { baseForm: 'or', category: SemanticCategory.LOGICAL, definition: 'Disjunction' },
            { baseForm: 'not', category: SemanticCategory.LOGICAL, definition: 'Negation' },
            { baseForm: 'if', category: SemanticCategory.LOGICAL, definition: 'Conditional' },
            { baseForm: 'because', category: SemanticCategory.LOGICAL, definition: 'Causation' },
            { baseForm: 'but', category: SemanticCategory.LOGICAL, definition: 'Contrast' },
        ];

        for (const primitiveData of basePrimitives) {
            await this.createPrimitive(
                primitiveData.baseForm,
                primitiveData.category,
                primitiveData.definition,
                [primitiveData.baseForm], // synonyms
                { en: [primitiveData.baseForm] } // translations
            );
        }

        // Add some cross-lingual examples
        await this.addCrossLingualMappings();
    }

    private async addCrossLingualMappings(): Promise<void> {
        // Example: "fox" concept across languages
        const foxId = await this.createPrimitive(
            'fox',
            SemanticCategory.CONCEPT,
            'Small carnivorous mammal',
            ['fox', 'vixen'],
            {
                en: ['fox', 'vixen'],
                es: ['zorro', 'zorra'],
                fr: ['renard'],
                de: ['Fuchs'],
                ja: ['狐', 'きつね'],
                zh: ['狐狸']
            }
        );

        // Example: "jump" action across languages  
        const jumpId = await this.createPrimitive(
            'jump',
            SemanticCategory.ACTION,
            'Move quickly upward or forward by pushing off',
            ['jump', 'leap', 'bound', 'hop'],
            {
                en: ['jump', 'leap', 'bound', 'hop'],
                es: ['saltar', 'brincar'],
                fr: ['sauter', 'bondir'],
                de: ['springen', 'hüpfen'],
                ja: ['跳ぶ', 'ジャンプする'],
                zh: ['跳', '跳跃']
            }
        );

        loggingService.info('✅ Cross-lingual mappings loaded', {
            examples: { fox: foxId, jump: jumpId }
        });
    }

    // ========================================================================
    // PRIMITIVE CREATION & MANAGEMENT
    // ========================================================================

    public async createPrimitive(
        baseForm: string,
        category: SemanticCategory,
        definition: string,
        synonyms: string[] = [],
        translations: Record<string, string[]> = {},
        relationships: SemanticRelationship[] = []
    ): Promise<SemanticPrimitiveId> {
        
        // Generate unique ID
        const counter = this.idCounters.get(category) || 1;
        const primitiveId: SemanticPrimitiveId = `${category}_${counter}`;
        this.idCounters.set(category, counter + 1);

        const primitive: SemanticPrimitive = {
            id: primitiveId,
            category,
            baseForm,
            definition,
            synonyms,
            translations,
            frequency: 0,
            abstractness: this.calculateAbstractness(baseForm, category),
            relationships,
            created: new Date(),
            lastUpdated: new Date()
        };

        // Store primitive
        this.primitives.set(primitiveId, primitive);
        
        // Update indices
        this.categoryIndex.get(category)?.add(primitiveId);
        this.updateLanguageIndices(primitive);
        
        loggingService.debug('🆕 Created semantic primitive', {
            id: primitiveId,
            baseForm,
            category,
            translations: Object.keys(translations).length
        });

        return primitiveId;
    }

    private calculateAbstractness(baseForm: string, category: SemanticCategory): number {
        // Simple heuristic for abstractness (0 = concrete, 1 = abstract)
        const concreteWords = ['fox', 'dog', 'tree', 'car', 'house', 'book'];
        const abstractWords = ['love', 'justice', 'freedom', 'thought', 'quality'];
        
        if (concreteWords.includes(baseForm.toLowerCase())) return 0.1;
        if (abstractWords.includes(baseForm.toLowerCase())) return 0.9;
        
        // Category-based defaults
        switch (category) {
            case SemanticCategory.CONCEPT: return 0.3;
            case SemanticCategory.ACTION: return 0.4;
            case SemanticCategory.PROPERTY: return 0.6;
            case SemanticCategory.RELATION: return 0.7;
            default: return 0.5;
        }
    }

    private updateLanguageIndices(primitive: SemanticPrimitive): void {
        // Index all synonyms and translations
        const allTerms = new Set([primitive.baseForm, ...primitive.synonyms]);
        
        Object.entries(primitive.translations).forEach(([lang, terms]) => {
            terms.forEach(term => allTerms.add(term));
            
            if (!this.languageIndex.has(lang)) {
                this.languageIndex.set(lang, new Map());
            }
            const langIndex = this.languageIndex.get(lang)!;
            
            terms.forEach(term => {
                const normalizedTerm = term.toLowerCase();
                if (!langIndex.has(normalizedTerm)) {
                    langIndex.set(normalizedTerm, []);
                }
                langIndex.get(normalizedTerm)!.push(primitive.id);
            });
        });
    }

    // ========================================================================
    // NATURAL LANGUAGE TO PRIMITIVES MAPPING
    // ========================================================================

    public async mapLanguageToPrimitives(
        text: string,
        language: string = 'en'
    ): Promise<LanguageToPrimitiveMapping> {
        const startTime = Date.now();
        
        try {
            // Tokenize and normalize text
            const tokens = this.tokenizeText(text);
            const matches: SemanticPrimitiveMatch[] = [];
            const ambiguities: AmbiguityResolution[] = [];
            
            // Process each token for primitive matching
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const primitiveMatches = await this.findPrimitivesForToken(token, language);
                
                if (primitiveMatches.length > 0) {
                    // Handle ambiguity if multiple matches
                    if (primitiveMatches.length > 1) {
                        const resolution = await this.resolveAmbiguity(
                            token,
                            primitiveMatches,
                            tokens,
                            i
                        );
                        ambiguities.push(resolution);
                        
                        matches.push({
                            primitiveId: resolution.chosenInterpretation.primitives[0],
                            sourceSpan: [token.start, token.end],
                            confidence: resolution.confidence,
                            alternatives: primitiveMatches.slice(1).map(match => ({
                                primitiveId: match.primitiveId,
                                confidence: match.confidence,
                                reason: 'Alternative interpretation'
                            }))
                        });
                    } else {
                        matches.push({
                            primitiveId: primitiveMatches[0].primitiveId,
                            sourceSpan: [token.start, token.end],
                            confidence: primitiveMatches[0].confidence,
                            alternatives: []
                        });
                    }
                }
            }
            
            // Calculate overall confidence
            const overallConfidence = matches.length > 0 
                ? matches.reduce((sum, match) => sum + match.confidence, 0) / matches.length
                : 0;
            
            const mapping: LanguageToPrimitiveMapping = {
                language,
                sourceText: text,
                primitives: matches,
                confidence: overallConfidence,
                ambiguity: ambiguities
            };
            
            loggingService.info('🔄 Natural language mapped to primitives', {
                sourceLength: text.length,
                primitiveCount: matches.length,
                confidence: overallConfidence,
                ambiguities: ambiguities.length,
                processingTime: Date.now() - startTime
            });
            
            return mapping;
            
        } catch (error) {
            loggingService.error('❌ Failed to map language to primitives', {
                text: text.substring(0, 100),
                language,
                error
            });
            throw error;
        }
    }

    private tokenizeText(text: string): Array<{word: string, start: number, end: number}> {
        // Simple tokenization - in production, use proper NLP tokenizer
        const tokens: Array<{word: string, start: number, end: number}> = [];
        const words = text.match(/\b\w+\b/g) || [];
        
        let position = 0;
        for (const word of words) {
            const start = text.indexOf(word, position);
            const end = start + word.length;
            tokens.push({ word: word.toLowerCase(), start, end });
            position = end;
        }
        
        return tokens;
    }

    private async findPrimitivesForToken(
        token: {word: string, start: number, end: number},
        language: string
    ): Promise<Array<{primitiveId: SemanticPrimitiveId, confidence: number}>> {
        const matches: Array<{primitiveId: SemanticPrimitiveId, confidence: number}> = [];
        
        // Check language index for exact matches
        const langIndex = this.languageIndex.get(language);
        if (langIndex && langIndex.has(token.word)) {
            const primitiveIds = langIndex.get(token.word)!;
            primitiveIds.forEach(id => {
                matches.push({ primitiveId: id, confidence: 0.9 });
            });
        }
        
        // Check synonyms and fuzzy matches
        for (const [id, primitive] of this.primitives) {
            const synonymMatch = primitive.synonyms.find(syn => 
                syn.toLowerCase() === token.word
            );
            if (synonymMatch) {
                matches.push({ primitiveId: id, confidence: 0.8 });
                continue;
            }
            
            // Fuzzy matching for partial matches
            if (primitive.baseForm.toLowerCase().includes(token.word) || 
                token.word.includes(primitive.baseForm.toLowerCase())) {
                matches.push({ primitiveId: id, confidence: 0.6 });
            }
        }
        
        return matches.sort((a, b) => b.confidence - a.confidence);
    }

    private async resolveAmbiguity(
        token: {word: string, start: number, end: number},
        matches: Array<{primitiveId: SemanticPrimitiveId, confidence: number}>,
        allTokens: Array<{word: string, start: number, end: number}>,
        tokenIndex: number
    ): Promise<AmbiguityResolution> {
        
        // Simple disambiguation based on context and frequency
        // In production, this would use sophisticated NLP models
        
        const interpretations: SemanticInterpretation[] = matches.map((match, index) => {
            const primitive = this.primitives.get(match.primitiveId)!;
            
            return {
                interpretation: `${token.word} as ${primitive.baseForm} (${primitive.category})`,
                primitives: [match.primitiveId],
                syntacticStructure: {
                    type: primitive.category,
                    span: [token.start, token.end],
                    children: [],
                    primitive: match.primitiveId
                },
                likelihood: match.confidence
            };
        });
        
        // Choose interpretation with highest confidence
        const chosen = interpretations[0];
        
        return {
            ambiguousSpan: [token.start, token.end],
            possibleInterpretations: interpretations,
            chosenInterpretation: chosen,
            resolutionStrategy: 'confidence_based',
            confidence: chosen.likelihood
        };
    }

    // ========================================================================
    // VOCABULARY SEARCH & RETRIEVAL
    // ========================================================================

    public async searchPrimitives(query: SemanticSearchQuery): Promise<SemanticSearchResult[]> {
        const results: SemanticSearchResult[] = [];
        
        for (const [id, primitive] of this.primitives) {
            let score = 0;
            let matchType: 'exact' | 'synonym' | 'translation' | 'relationship' = 'exact';
            
            // Category filter
            if (query.category && primitive.category !== query.category) {
                continue;
            }
            
            // Frequency filter
            if (query.minFrequency && primitive.frequency < query.minFrequency) {
                continue;
            }
            
            // Abstractness filter
            if (query.maxAbstractness && primitive.abstractness > query.maxAbstractness) {
                continue;
            }
            
            // Term matching
            if (query.term) {
                const term = query.term.toLowerCase();
                
                if (primitive.baseForm.toLowerCase() === term) {
                    score = 1.0;
                } else if (primitive.synonyms.some(syn => syn.toLowerCase() === term)) {
                    score = 0.9;
                    matchType = 'synonym';
                } else if (this.hasTranslation(primitive, term, query.language)) {
                    score = 0.8;
                    matchType = 'translation';
                } else if (primitive.baseForm.toLowerCase().includes(term)) {
                    score = 0.6;
                } else {
                    continue; // No match
                }
            } else {
                score = 0.5; // Base score for category-only matches
            }
            
            results.push({
                primitive,
                relevanceScore: score,
                matchType
            });
        }
        
        // Sort by relevance and apply limit
        results.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        if (query.limit) {
            return results.slice(0, query.limit);
        }
        
        return results;
    }

    private hasTranslation(primitive: SemanticPrimitive, term: string, language?: string): boolean {
        if (!language) return false;
        
        const translations = primitive.translations[language];
        return translations ? translations.some(t => t.toLowerCase() === term) : false;
    }

    public getPrimitive(id: SemanticPrimitiveId): SemanticPrimitive | undefined {
        return this.primitives.get(id);
    }

    public getVocabularyStats(): SemanticVocabularyStats {
        const primitivesByCategory: Record<SemanticCategory, number> = {} as any;
        
        Object.values(SemanticCategory).forEach(category => {
            primitivesByCategory[category] = this.categoryIndex.get(category)?.size || 0;
        });
        
        const translationCounts = Array.from(this.primitives.values())
            .map(p => Object.keys(p.translations).length);
        const averageTranslations = translationCounts.length > 0 
            ? translationCounts.reduce((sum, count) => sum + count, 0) / translationCounts.length
            : 0;
        
        const coverageByLanguage: Record<string, number> = {};
        for (const [lang, index] of this.languageIndex) {
            coverageByLanguage[lang] = index.size;
        }
        
        return {
            totalPrimitives: this.primitives.size,
            primitivesByCategory,
            averageTranslations,
            coverageByLanguage,
            lastUpdated: new Date()
        };
    }

    // ========================================================================
    // EXAMPLE USAGE METHODS
    // ========================================================================

    /**
     * Demo method showing the classic ambiguous telescope example
     */
    public async demonstrateTelescopeAmbiguity(): Promise<{
        sentence: string,
        interpretation1: LanguageToPrimitiveMapping,
        interpretation2: LanguageToPrimitiveMapping
    }> {
        const sentence = "I saw a man on the hill with a telescope";
        
        // This would normally require sophisticated syntactic parsing
        // For now, we'll show how the system would handle it conceptually
        
        const mapping1 = await this.mapLanguageToPrimitives(sentence, 'en');
        const mapping2 = await this.mapLanguageToPrimitives(sentence, 'en');
        
        loggingService.info('🔭 Telescope ambiguity demonstration', {
            sentence,
            mapping1Confidence: mapping1.confidence,
            mapping2Confidence: mapping2.confidence
        });
        
        return {
            sentence,
            interpretation1: mapping1,
            interpretation2: mapping2
        };
    }
}
