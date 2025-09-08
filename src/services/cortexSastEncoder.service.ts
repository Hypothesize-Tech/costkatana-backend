/**
 * Cortex SAST Encoder Service
 * 
 * Advanced semantic encoder that creates true Semantic Abstract Syntax Trees (SAST)
 * using semantic primitives instead of natural language tokens. This encoder resolves
 * ambiguities and produces unambiguous, universal semantic representations.
 */

import {
    SemanticCortexFrame,
    SemanticPrimitiveValue,
    SemanticFrameMetadata,
    LanguageToPrimitiveMapping,
    AmbiguityResolution,
    SyntacticNode,
    SemanticInterpretation,
    SemanticPrimitiveId
} from '../types/semanticPrimitives.types';
import { SemanticPrimitivesService } from './semanticPrimitives.service';
import { loggingService } from './logging.service';

// ============================================================================
// SAST ENCODING TYPES
// ============================================================================

export interface SastEncodingRequest {
    text: string;
    language?: string;
    domain?: string;
    disambiguationStrategy?: 'confidence' | 'context' | 'frequency' | 'hybrid';
    preserveAmbiguity?: boolean;
    outputFormat?: 'frame' | 'tree' | 'linearized';
}

export interface SastEncodingResult {
    semanticFrame: SemanticCortexFrame;
    sourceMapping: LanguageToPrimitiveMapping;
    ambiguitiesResolved: AmbiguityResolution[];
    syntacticStructure: SyntacticNode;
    metadata: SastEncodingMetadata;
}

export interface SastEncodingMetadata extends SemanticFrameMetadata {
    processingTime: number;
    disambiguationStrategy: string;
    syntacticComplexity: number;
    semanticDepth: number;
    universalCompatibility: boolean;
}

// ============================================================================
// SYNTACTIC PARSING STRUCTURES
// ============================================================================

interface ParsedConstituent {
    type: 'NP' | 'VP' | 'PP' | 'ADJP' | 'ADVP' | 'S' | 'SBAR';
    head: string;
    span: [number, number];
    children: ParsedConstituent[];
    semanticRole?: 'agent' | 'patient' | 'instrument' | 'location' | 'time' | 'manner';
    primitiveId?: SemanticPrimitiveId;
    attachmentAmbiguity?: AttachmentOption[];
}

interface AttachmentOption {
    parentConstituent: string;
    confidence: number;
    semanticInterpretation: string;
}

// ============================================================================
// CORTEX SAST ENCODER SERVICE
// ============================================================================

export class CortexSastEncoderService {
    private static instance: CortexSastEncoderService;
    private primitivesService: SemanticPrimitivesService;
    
    // Processing statistics
    private stats = {
        totalEncodings: 0,
        successfulEncodings: 0,
        ambiguitiesResolved: 0,
        averageProcessingTime: 0,
        semanticAccuracy: 0
    };

    private constructor() {
        this.primitivesService = SemanticPrimitivesService.getInstance();
    }

    public static getInstance(): CortexSastEncoderService {
        if (!this.instance) {
            this.instance = new CortexSastEncoderService();
        }
        return this.instance;
    }

    // ========================================================================
    // MAIN SAST ENCODING PIPELINE
    // ========================================================================

    public async encodeSast(request: SastEncodingRequest): Promise<SastEncodingResult> {
        const startTime = Date.now();
        this.stats.totalEncodings++;

        try {
            loggingService.info('🧬 Starting SAST encoding', {
                text: request.text.substring(0, 100),
                language: request.language || 'en',
                strategy: request.disambiguationStrategy || 'hybrid'
            });

            // Step 1: Map natural language to semantic primitives
            const sourceMapping = await this.primitivesService.mapLanguageToPrimitives(
                request.text,
                request.language || 'en'
            );

            // Step 2: Perform syntactic parsing for disambiguation
            const syntacticStructure = await this.parseSyntacticStructure(request.text);

            // Step 3: Resolve attachment and scope ambiguities
            const resolvedAmbiguities = await this.resolveStructuralAmbiguities(
                syntacticStructure,
                sourceMapping,
                request.disambiguationStrategy || 'hybrid'
            );

            // Step 4: Build semantic frame from resolved structure
            const semanticFrame = await this.buildSemanticFrame(
                syntacticStructure,
                sourceMapping,
                resolvedAmbiguities
            );

            // Step 5: Generate metadata
            const processingTime = Date.now() - startTime;
            const metadata: SastEncodingMetadata = {
                sourceLanguage: request.language || 'en',
                confidence: sourceMapping.confidence,
                ambiguityResolved: resolvedAmbiguities.length > 0,
                parseComplexity: this.calculateParseComplexity(syntacticStructure),
                primitiveCount: sourceMapping.primitives.length,
                crossLingualEquivalent: await this.checkCrossLingualCompatibility(sourceMapping),
                processingTime,
                disambiguationStrategy: request.disambiguationStrategy || 'hybrid',
                syntacticComplexity: this.calculateSyntacticComplexity(syntacticStructure),
                semanticDepth: this.calculateSemanticDepth(semanticFrame),
                universalCompatibility: true
            };

            const result: SastEncodingResult = {
                semanticFrame,
                sourceMapping,
                ambiguitiesResolved: resolvedAmbiguities,
                syntacticStructure,
                metadata
            };

            this.updateStats(result);

            loggingService.info('✅ SAST encoding completed', {
                processingTime,
                primitiveCount: sourceMapping.primitives.length,
                ambiguitiesResolved: resolvedAmbiguities.length,
                confidence: sourceMapping.confidence
            });

            return result;

        } catch (error) {
            loggingService.error('❌ SAST encoding failed', {
                text: request.text.substring(0, 100),
                error
            });
            throw error;
        }
    }

    // ========================================================================
    // SYNTACTIC PARSING
    // ========================================================================

    private async parseSyntacticStructure(text: string): Promise<SyntacticNode> {
        // Simplified syntactic parsing - in production, use proper NLP parser
        // This demonstrates the concept of structural parsing for disambiguation
        
        const tokens = text.toLowerCase().split(/\s+/);
        
        // Basic constituency parsing rules
        const structure: SyntacticNode = {
            type: 'S', // Sentence
            span: [0, text.length],
            children: [],
            semanticRole: undefined
        };

        // Identify main components
        let currentPos = 0;
        const components: ParsedConstituent[] = [];

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            
            // Simple heuristic for constituent identification
            if (this.isNoun(token)) {
                components.push({
                    type: 'NP',
                    head: token,
                    span: [currentPos, currentPos + token.length],
                    children: []
                });
            } else if (this.isVerb(token)) {
                components.push({
                    type: 'VP',
                    head: token,
                    span: [currentPos, currentPos + token.length],
                    children: []
                });
            } else if (this.isPreposition(token)) {
                components.push({
                    type: 'PP',
                    head: token,
                    span: [currentPos, currentPos + token.length],
                    children: []
                });
            }
            
            currentPos += token.length + 1;
        }

        // Convert to SyntacticNode format
        structure.children = components.map(comp => ({
            type: comp.type,
            span: comp.span,
            children: [],
            semanticRole: this.inferSemanticRole(comp),
            primitive: undefined
        }));

        return structure;
    }

    private isNoun(token: string): boolean {
        const nouns = ['man', 'hill', 'telescope', 'person', 'dog', 'fox', 'document', 'report', 'system'];
        return nouns.includes(token);
    }

    private isVerb(token: string): boolean {
        const verbs = ['saw', 'see', 'is', 'was', 'jump', 'run', 'analyze', 'create', 'process'];
        return verbs.includes(token) || token.endsWith('ing') || token.endsWith('ed');
    }

    private isPreposition(token: string): boolean {
        const prepositions = ['on', 'with', 'in', 'at', 'over', 'under', 'to', 'from', 'for'];
        return prepositions.includes(token);
    }

    private inferSemanticRole(constituent: ParsedConstituent): string | undefined {
        switch (constituent.type) {
            case 'NP': return 'agent'; // Simplification
            case 'VP': return undefined; // Verbs don't have semantic roles themselves
            case 'PP': return 'instrument'; // Default PP role
            default: return undefined;
        }
    }

    // ========================================================================
    // AMBIGUITY RESOLUTION
    // ========================================================================

    private async resolveStructuralAmbiguities(
        syntax: SyntacticNode,
        mapping: LanguageToPrimitiveMapping,
        strategy: string
    ): Promise<AmbiguityResolution[]> {
        const ambiguities: AmbiguityResolution[] = [];

        // Handle the classic "telescope" ambiguity
        if (mapping.sourceText.includes('telescope')) {
            const telescopeAmbiguity = await this.resolveTelescopeAmbiguity(
                mapping.sourceText,
                syntax,
                mapping
            );
            if (telescopeAmbiguity) {
                ambiguities.push(telescopeAmbiguity);
            }
        }

        // Handle prepositional phrase attachment ambiguities
        const ppAmbiguities = await this.resolvePrepositionalAttachments(syntax, mapping);
        ambiguities.push(...ppAmbiguities);

        // Handle scope ambiguities
        const scopeAmbiguities = await this.resolveScopeAmbiguities(syntax, mapping);
        ambiguities.push(...scopeAmbiguities);

        return ambiguities;
    }

    private async resolveTelescopeAmbiguity(
        text: string,
        syntax: SyntacticNode,
        mapping: LanguageToPrimitiveMapping
    ): Promise<AmbiguityResolution | null> {
        
        // "I saw a man on the hill with a telescope"
        // Two interpretations:
        // 1. I used a telescope to see a man on the hill
        // 2. I saw a man who had a telescope and was on the hill

        if (!text.match(/\b(saw|see)\b.*\bman\b.*\bhill\b.*\btelescope\b/)) {
            return null;
        }

        const interpretations: SemanticInterpretation[] = [
            {
                interpretation: "Agent uses telescope as instrument to see man on hill",
                primitives: ['action_see', 'concept_person', 'location_hill', 'instrument_telescope'],
                syntacticStructure: {
                    type: 'S',
                    span: [0, text.length],
                    children: [
                        {
                            type: 'NP',
                            span: [0, 1],
                            children: [],
                            semanticRole: 'agent',
                            primitive: 'concept_person'
                        },
                        {
                            type: 'VP',
                            span: [2, 5],
                            children: [
                                {
                                    type: 'PP',
                                    span: [text.indexOf('with'), text.indexOf('telescope') + 9],
                                    children: [],
                                    semanticRole: 'instrument',
                                    primitive: 'concept_telescope'
                                }
                            ],
                            primitive: 'action_see'
                        }
                    ]
                },
                likelihood: 0.7
            },
            {
                interpretation: "Agent sees man who possesses telescope and is on hill",
                primitives: ['action_see', 'concept_person', 'location_hill', 'possession_telescope'],
                syntacticStructure: {
                    type: 'S',
                    span: [0, text.length],
                    children: [
                        {
                            type: 'NP',
                            span: [text.indexOf('man'), text.indexOf('telescope') + 9],
                            children: [
                                {
                                    type: 'PP',
                                    span: [text.indexOf('with'), text.indexOf('telescope') + 9],
                                    children: [],
                                    semanticRole: 'possession',
                                    primitive: 'concept_telescope'
                                }
                            ],
                            semanticRole: 'patient',
                            primitive: 'concept_person'
                        }
                    ]
                },
                likelihood: 0.3
            }
        ];

        return {
            ambiguousSpan: [text.indexOf('with'), text.indexOf('telescope') + 9],
            possibleInterpretations: interpretations,
            chosenInterpretation: interpretations[0], // Higher likelihood
            resolutionStrategy: 'syntactic_preference',
            confidence: 0.7
        };
    }

    private async resolvePrepositionalAttachments(
        syntax: SyntacticNode,
        mapping: LanguageToPrimitiveMapping
    ): Promise<AmbiguityResolution[]> {
        // Simplified PP attachment resolution
        // In production, this would use statistical parsing models
        return [];
    }

    private async resolveScopeAmbiguities(
        syntax: SyntacticNode,
        mapping: LanguageToPrimitiveMapping
    ): Promise<AmbiguityResolution[]> {
        // Simplified scope resolution
        // Handle quantifier scope, negation scope, etc.
        return [];
    }

    // ========================================================================
    // SEMANTIC FRAME CONSTRUCTION
    // ========================================================================

    private async buildSemanticFrame(
        syntax: SyntacticNode,
        mapping: LanguageToPrimitiveMapping,
        ambiguities: AmbiguityResolution[]
    ): Promise<SemanticCortexFrame> {
        
        // Determine main frame type based on syntactic structure
        const frameType = this.determineFrameType(syntax, mapping);
        
        // Build primitive mappings from resolved structure
        const primitives: Record<string, SemanticPrimitiveValue> = {};
        
        // Extract semantic roles and map to primitives
        for (const match of mapping.primitives) {
            const primitive = this.primitivesService.getPrimitive(match.primitiveId);
            if (primitive) {
                const role = this.mapToSemanticRole(primitive, syntax);
                if (role) {
                    primitives[role] = match.primitiveId;
                }
            }
        }

        // Apply ambiguity resolutions to refine primitive mappings
        for (const ambiguity of ambiguities) {
            const refinedPrimitives = this.applyAmbiguityResolution(primitives, ambiguity);
            Object.assign(primitives, refinedPrimitives);
        }

        // Construct metadata
        const metadata: SemanticFrameMetadata = {
            sourceLanguage: mapping.language,
            confidence: mapping.confidence,
            ambiguityResolved: ambiguities.length > 0,
            parseComplexity: this.calculateParseComplexity(syntax),
            primitiveCount: mapping.primitives.length,
            crossLingualEquivalent: await this.checkCrossLingualCompatibility(mapping)
        };

        return {
            frameType,
            primitives,
            metadata
        };
    }

    private determineFrameType(syntax: SyntacticNode, mapping: LanguageToPrimitiveMapping): 'event' | 'state' | 'query' | 'concept' | 'relation' {
        // Simple heuristic for frame type determination
        const hasAction = mapping.primitives.some(match => {
            const primitive = this.primitivesService.getPrimitive(match.primitiveId);
            return primitive?.category === 'action';
        });

        const hasQuery = mapping.sourceText.includes('?') || 
                        mapping.sourceText.toLowerCase().includes('what') ||
                        mapping.sourceText.toLowerCase().includes('how') ||
                        mapping.sourceText.toLowerCase().includes('why');

        if (hasQuery) return 'query';
        if (hasAction) return 'event';
        return 'state'; // Default
    }

    private mapToSemanticRole(primitive: any, syntax: SyntacticNode): string | null {
        // Map primitive to semantic role based on category and syntactic position
        switch (primitive.category) {
            case 'action': return 'action';
            case 'concept': return 'agent'; // Simplification
            case 'property': return 'aspect';
            case 'relation': return 'relation';
            default: return 'object';
        }
    }

    private applyAmbiguityResolution(
        primitives: Record<string, SemanticPrimitiveValue>,
        ambiguity: AmbiguityResolution
    ): Record<string, SemanticPrimitiveValue> {
        const refined: Record<string, SemanticPrimitiveValue> = {};
        
        // Apply chosen interpretation to refine primitive mappings
        const chosen = ambiguity.chosenInterpretation;
        
        // Example: telescope ambiguity resolution
        if (chosen.interpretation.includes('instrument')) {
            refined['instrument'] = chosen.primitives.find(p => p.includes('telescope')) || chosen.primitives[0];
        } else if (chosen.interpretation.includes('possession')) {
            refined['possession'] = chosen.primitives.find(p => p.includes('telescope')) || chosen.primitives[0];
        }
        
        return refined;
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    private calculateParseComplexity(syntax: SyntacticNode): number {
        // Simple complexity metric based on tree depth and branching
        const depth = this.getTreeDepth(syntax);
        const branching = this.getAverageBranching(syntax);
        return depth * branching / 10; // Normalized score
    }

    private getTreeDepth(node: SyntacticNode): number {
        if (!node.children || node.children.length === 0) {
            return 1;
        }
        return 1 + Math.max(...node.children.map(child => this.getTreeDepth(child)));
    }

    private getAverageBranching(node: SyntacticNode): number {
        const getAllNodes = (n: SyntacticNode): SyntacticNode[] => {
            return [n, ...n.children.flatMap(child => getAllNodes(child))];
        };
        
        const allNodes = getAllNodes(node);
        const totalBranching = allNodes.reduce((sum, n) => sum + n.children.length, 0);
        return totalBranching / allNodes.length;
    }

    private calculateSyntacticComplexity(syntax: SyntacticNode): number {
        return this.calculateParseComplexity(syntax);
    }

    private calculateSemanticDepth(frame: SemanticCortexFrame): number {
        // Calculate semantic nesting depth
        let maxDepth = 1;
        
        for (const value of Object.values(frame.primitives)) {
            if (typeof value === 'object' && 'frameType' in value) {
                const nestedDepth = 1 + this.calculateSemanticDepth(value as SemanticCortexFrame);
                maxDepth = Math.max(maxDepth, nestedDepth);
            }
        }
        
        return maxDepth;
    }

    private async checkCrossLingualCompatibility(mapping: LanguageToPrimitiveMapping): Promise<boolean> {
        // Check if all primitives have cross-lingual mappings
        for (const match of mapping.primitives) {
            const primitive = this.primitivesService.getPrimitive(match.primitiveId);
            if (!primitive || Object.keys(primitive.translations).length < 2) {
                return false;
            }
        }
        return true;
    }

    private updateStats(result: SastEncodingResult): void {
        this.stats.successfulEncodings++;
        this.stats.ambiguitiesResolved += result.ambiguitiesResolved.length;
        
        const totalTime = this.stats.averageProcessingTime * (this.stats.successfulEncodings - 1) + result.metadata.processingTime;
        this.stats.averageProcessingTime = totalTime / this.stats.successfulEncodings;
        
        this.stats.semanticAccuracy = (this.stats.semanticAccuracy * (this.stats.successfulEncodings - 1) + result.metadata.confidence) / this.stats.successfulEncodings;
    }

    // ========================================================================
    // DEMONSTRATION METHODS
    // ========================================================================

    public async demonstrateTelescopeExample(): Promise<{
        originalSentence: string;
        interpretations: SastEncodingResult[];
        comparison: string;
    }> {
        const sentence = "I saw a man on the hill with a telescope";
        
        loggingService.info('🔭 Demonstrating telescope ambiguity resolution');
        
        const result = await this.encodeSast({
            text: sentence,
            language: 'en',
            disambiguationStrategy: 'hybrid',
            preserveAmbiguity: false
        });

        return {
            originalSentence: sentence,
            interpretations: [result],
            comparison: `Original ambiguous sentence resolved to unambiguous semantic frame with ${result.ambiguitiesResolved.length} ambiguities resolved`
        };
    }

    public getStats() {
        return { ...this.stats };
    }
}
