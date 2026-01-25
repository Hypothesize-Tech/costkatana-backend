import { loggingService } from './logging.service';
import { BedrockService } from './bedrock.service';
import {
    EnrichedMetadata,
    MetadataEnrichmentResult,
    DomainType,
    ContentType,
    ImportanceLevel,
    TechnicalLevel,
    EnrichmentContext
} from '../types/metadata.types';

const METADATA_CONFIG = {
    ENABLED: true,
    MODEL: 'anthropic.claude-3-haiku-20240307-v1:0',
    BATCH_SIZE: 100,
    FRESHNESS_DECAY_DAYS: 90,
    MAX_TOPICS: 5,
    QUALITY_THRESHOLD: 0.5,
    ENRICHMENT_TIMEOUT: 10000, // 10 seconds per document
};

/**
 * Metadata Enrichment Service
 * 
 * Automatically extracts semantic metadata from document content using LLMs.
 * This service enriches documents with domain classification, topics, content types,
 * quality scores, and other metadata to improve retrieval precision.
 * 
 * **Architecture Note:**
 * This service uses the shared BedrockService for all LLM invocations to:
 * - Avoid duplicate Bedrock client instances
 * - Reuse existing telemetry and cost tracking
 * - Maintain consistency with retry/error handling patterns
 * - Reduce maintenance burden across the codebase
 */
export class MetadataEnrichmentService {
    private config = METADATA_CONFIG;

    /**
     * Main enrichment method - extracts all metadata from content
     */
    async enrichMetadata(
        content: string,
        context?: EnrichmentContext
    ): Promise<MetadataEnrichmentResult> {
        const startTime = Date.now();

        try {
            if (!this.config.ENABLED) {
                return {
                    enrichedMetadata: {},
                    confidence: 0,
                    processingTime: 0
                };
            }

            // Truncate content for LLM processing (first 4000 chars for efficiency)
            const truncatedContent = content.substring(0, 4000);

            // Run all enrichment tasks in parallel for efficiency
            const [
                topics,
                contentType,
                technicalLevel,
                semanticTags,
                qualityScore,
                importance,
                domain,
                structure
            ] = await Promise.all([
                this.extractTopics(truncatedContent),
                this.classifyContentType(truncatedContent),
                this.detectTechnicalLevel(truncatedContent),
                this.generateSemanticTags(truncatedContent),
                this.assessQuality(truncatedContent),
                this.determineImportance(truncatedContent, context),
                this.detectDomain(truncatedContent, context),
                this.analyzeStructure(content)
            ]);

            const enrichedMetadata: EnrichedMetadata = {
                domain,
                topic: topics[0],
                topics,
                contentType,
                technicalLevel,
                semanticTags,
                importance,
                qualityScore,
                lastVerified: new Date(),
                ...structure
            };

            const processingTime = Date.now() - startTime;

            loggingService.info('Metadata enrichment completed', {
                component: 'MetadataEnrichmentService',
                operation: 'enrichMetadata',
                processingTime,
                topicsFound: topics.length,
                contentType,
                domain
            });

            return {
                enrichedMetadata,
                confidence: 0.85,
                processingTime
            };
        } catch (error) {
            loggingService.error('Metadata enrichment failed', {
                component: 'MetadataEnrichmentService',
                operation: 'enrichMetadata',
                error: error instanceof Error ? error.message : String(error)
            });

            // Return empty metadata on error
            return {
                enrichedMetadata: {},
                confidence: 0,
                processingTime: Date.now() - startTime
            };
        }
    }

    /**
     * Extract 1-5 main topics using Claude Haiku
     */
    private async extractTopics(content: string): Promise<string[]> {
        try {
            const prompt = `Analyze this document excerpt and extract 1-5 main topics. Be concise and specific.

Document excerpt:
${content}

Return ONLY a JSON array of topics like: ["topic1", "topic2", "topic3"]`;

            const response = await this.invokeLLM(prompt);
            const topics = this.parseJSONResponse<string[]>(response, []);

            return topics.slice(0, this.config.MAX_TOPICS);
        } catch (error) {
            loggingService.warn('Topic extraction failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Classify content type using AI
     */
    private async classifyContentType(content: string): Promise<ContentType> {
        try {
            const prompt = `Analyze this document excerpt and classify it into ONE of these content types:
- code: Contains programming code, functions, classes, or code snippets
- explanation: Explanatory text, concepts, or theoretical content
- example: Practical examples or demonstrations
- configuration: Configuration files, settings, or setup instructions
- troubleshooting: Problem-solving guides, debugging, or error resolution
- tutorial: Step-by-step instructional content

Document excerpt:
${content}

Return ONLY the type (one word).`;

            const response = await this.invokeLLM(prompt);
            const contentType = response.trim().toLowerCase();

            const validTypes: ContentType[] = ['code', 'explanation', 'example', 'configuration', 'troubleshooting', 'tutorial'];
            return validTypes.includes(contentType as ContentType) ? (contentType as ContentType) : 'explanation';
        } catch (error) {
            return 'explanation';
        }
    }

    /**
     * Detect technical level using AI
     */
    private async detectTechnicalLevel(content: string): Promise<TechnicalLevel> {
        try {
            const prompt = `Analyze this document excerpt and determine its technical complexity level:
- beginner: Basic concepts, introductory material, simple explanations
- intermediate: Moderate complexity, some technical knowledge required
- advanced: Complex concepts, deep technical knowledge, sophisticated implementations

Consider factors like:
- Vocabulary complexity and technical jargon
- Assumed prior knowledge
- Depth of technical detail
- Complexity of concepts presented

Document excerpt:
${content}

Return ONLY the level (beginner, intermediate, or advanced).`;

            const response = await this.invokeLLM(prompt);
            const level = response.trim().toLowerCase();

            const validLevels: TechnicalLevel[] = ['beginner', 'intermediate', 'advanced'];
            return validLevels.includes(level as TechnicalLevel) ? (level as TechnicalLevel) : 'intermediate';
        } catch (error) {
            return 'intermediate';
        }
    }

    /**
     * Generate semantic tags using LLM
     */
    private async generateSemanticTags(content: string): Promise<string[]> {
        try {
            const prompt = `Generate 3-5 descriptive tags for this document. Tags should be single words or short phrases that capture the key concepts, technologies, or themes.

Document excerpt:
${content}

Return ONLY a JSON array of tags like: ["tag1", "tag2", "tag3"]`;

            const response = await this.invokeLLM(prompt);
            const tags = this.parseJSONResponse<string[]>(response, []);

            return tags.slice(0, 5);
        } catch (error) {
            return [];
        }
    }

    /**
     * Assess content quality using AI
     */
    private async assessQuality(content: string): Promise<number> {
        try {
            const prompt = `Assess the quality of this document excerpt on a scale from 0.0 to 1.0, considering:
- Clarity and coherence of writing
- Completeness of information
- Structure and organization
- Usefulness and practical value
- Accuracy and reliability (based on content presentation)

Document excerpt:
${content}

Return ONLY a decimal number between 0.0 and 1.0 (e.g., 0.75)`;

            const response = await this.invokeLLM(prompt);
            const scoreMatch = response.match(/\d+\.?\d*/);
            
            if (scoreMatch) {
                const score = parseFloat(scoreMatch[0]);
                return Math.min(Math.max(score, 0), 1); // Clamp between 0 and 1
            }

            return 0.5;
        } catch (error) {
            return 0.5;
        }
    }

    /**
     * Determine importance level using AI
     */
    private async determineImportance(
        content: string,
        context?: EnrichmentContext
    ): Promise<ImportanceLevel> {
        try {
            const contextInfo = context ? `\nContext: ${JSON.stringify(context)}` : '';
            
            const prompt = `Analyze this document excerpt and determine its importance level:
- critical: Essential information, core concepts, or critical procedures
- high: Important information that significantly impacts understanding or implementation
- medium: Useful information with moderate impact
- low: Supplementary or optional information

Consider factors like:
- Impact on user success or understanding
- Frequency of use or reference
- Consequences of missing this information
- Relationship to core functionality${contextInfo}

Document excerpt:
${content}

Return ONLY the importance level (critical, high, medium, or low).`;

            const response = await this.invokeLLM(prompt);
            const importance = response.trim().toLowerCase();

            const validLevels: ImportanceLevel[] = ['critical', 'high', 'medium', 'low'];
            return validLevels.includes(importance as ImportanceLevel) ? (importance as ImportanceLevel) : 'medium';
        } catch (error) {
            return 'medium';
        }
    }

    /**
     * Detect domain using AI
     */
    private async detectDomain(
        content: string,
        context?: EnrichmentContext
    ): Promise<DomainType> {
        try {
            const contextInfo = context ? `\nContext: ${JSON.stringify(context)}` : '';
            
            const prompt = `Analyze this document excerpt and classify it into ONE of these domains:
- ai-optimization: AI model optimization, prompt engineering, LLM usage, machine learning
- cost-tracking: Cost management, budget tracking, spending analysis, financial monitoring
- api-usage: API documentation, endpoint usage, request/response handling, integration
- documentation: General documentation, guides, references, explanatory content
- general: Content that doesn't fit into the above specific domains

Consider the primary focus and purpose of the content.${contextInfo}

Document excerpt:
${content}

Return ONLY the domain (ai-optimization, cost-tracking, api-usage, documentation, or general).`;

            const response = await this.invokeLLM(prompt);
            const domain = response.trim().toLowerCase();

            const validDomains: DomainType[] = ['ai-optimization', 'cost-tracking', 'api-usage', 'documentation', 'general'];
            return validDomains.includes(domain as DomainType) ? (domain as DomainType) : 'general';
        } catch (error) {
            return 'general';
        }
    }

    /**
     * Analyze document structure using AI
     */
    private async analyzeStructure(content: string): Promise<Partial<EnrichedMetadata>> {
        try {
            const prompt = `Analyze this document and identify its structural elements. Return a JSON object with these boolean/array properties:
- containsCode: true if document contains programming code, functions, or code blocks
- containsEquations: true if document contains mathematical equations or formulas
- containsLinks: array of URLs found in the document (max 10)
- containsImages: true if document contains images or image references
- sectionTitle: the main title or heading if present (string or null)

Document:
${content}

Return ONLY a valid JSON object with the above properties.`;

            const response = await this.invokeLLM(prompt);
            const structure = this.parseJSONResponse<Partial<EnrichedMetadata>>(response, {});

            // Ensure containsLinks is an array and limit to 10 items
            if (structure.containsLinks && Array.isArray(structure.containsLinks)) {
                structure.containsLinks = structure.containsLinks.slice(0, 10);
            }

            return structure;
        } catch (error) {
            loggingService.warn('Structure analysis failed, using fallback', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Simple fallback analysis
            return {
                containsCode: /```|function|class |def |import |<\w+/.test(content),
                containsEquations: /\$\$|\\\(|\\\[/.test(content),
                containsLinks: content.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g)?.slice(0, 10) ?? [],
                containsImages: /!\[|<img/.test(content),
                sectionTitle: content.match(/^#+ (.+)$/m)?.[1]?.trim()
            };
        }
    }

    /**
     * Invoke LLM with timeout and error handling
     * 
     * Uses the shared BedrockService to avoid duplication and ensure:
     * - Consistent telemetry and cost tracking
     * - Proper retry logic and error handling
     * - Single source of truth for Bedrock interactions
     */
    private async invokeLLM(prompt: string): Promise<string> {
        // Use shared BedrockService with timeout wrapper
        const response = await Promise.race([
            BedrockService.invokeModel(prompt, this.config.MODEL),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('LLM invocation timeout')), this.config.ENRICHMENT_TIMEOUT)
            )
        ]);

        return response as string;
    }

    /**
     * Parse JSON response with fallback
     */
    private parseJSONResponse<T>(response: string, fallback: T): T {
        try {
            // Try to extract JSON from response (object or array)
            const jsonMatch = response.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as T;
            }
            return fallback;
        } catch (error) {
            return fallback;
        }
    }
}

// Singleton instance
export const metadataEnrichmentService = new MetadataEnrichmentService();
