/**
 * Metadata Type Definitions for Enhanced RAG System
 * 
 * These types define the semantic metadata fields used to improve
 * document retrieval precision and relevance in the RAG system.
 */

// Domain categorization for Cost Katana content
export type DomainType = 
    | 'ai-optimization'    // AI model optimization, prompt engineering
    | 'cost-tracking'      // Budget management, cost analysis
    | 'api-usage'          // API integration, usage tracking
    | 'documentation'      // Technical documentation, guides
    | 'general';           // General content

// Content type classification
export type ContentType = 
    | 'code'               // Code examples, implementations
    | 'explanation'        // Conceptual explanations
    | 'example'            // Usage examples, tutorials
    | 'configuration'      // Configuration files, setup
    | 'troubleshooting'    // Problem-solving, debugging
    | 'tutorial';          // Step-by-step guides

// Importance level for ranking
export type ImportanceLevel = 
    | 'low'                // Optional content
    | 'medium'             // Standard content
    | 'high'               // Important content
    | 'critical';          // Critical, must-read content

// Technical complexity level
export type TechnicalLevel = 
    | 'beginner'           // Basic concepts, getting started
    | 'intermediate'       // Moderate complexity
    | 'advanced';          // Advanced topics, expert level

/**
 * Enriched metadata structure
 * All fields are optional to support gradual enrichment
 */
export interface EnrichedMetadata {
    // Domain and topic classification
    domain?: DomainType;
    topic?: string;                    // Primary topic
    topics?: string[];                 // Multiple topics for multi-topic documents
    contentType?: ContentType;
    
    // Quality and importance indicators
    importance?: ImportanceLevel;
    qualityScore?: number;             // 0-1 range, higher is better
    
    // Technical level
    technicalLevel?: TechnicalLevel;
    
    // Semantic tags (auto-generated)
    semanticTags?: string[];           // e.g., ['technical', 'beginner-friendly', 'production-ready']
    
    // Relationship metadata
    relatedDocumentIds?: string[];     // IDs of related documents
    prerequisites?: string[];          // Prerequisites for understanding this document
    
    // Freshness tracking
    version?: string;                  // Document version
    lastVerified?: Date;               // When content was last verified
    deprecationDate?: Date;            // When content becomes deprecated
    
    // Hierarchical structure
    sectionTitle?: string;             // Section or chapter title
    sectionLevel?: number;             // Heading level (1-6)
    sectionPath?: string[];            // Breadcrumb path (e.g., ['Guide', 'Advanced', 'Optimization'])
    
    // Context preservation
    precedingContext?: string;         // Previous chunk's last sentence
    followingContext?: string;         // Next chunk's first sentence
    
    // Content indicators
    containsCode?: boolean;            // Has code blocks
    containsEquations?: boolean;       // Has mathematical equations
    containsLinks?: string[];          // URLs referenced in content
    containsImages?: boolean;          // Has images or diagrams
}

/**
 * Result of metadata enrichment process
 */
export interface MetadataEnrichmentResult {
    enrichedMetadata: EnrichedMetadata;
    confidence: number;                // Confidence score (0-1)
    processingTime: number;            // Time taken to enrich (ms)
}

/**
 * Configuration for metadata enrichment
 */
export interface MetadataEnrichmentConfig {
    enabled: boolean;
    model: string;                     // LLM model to use
    batchSize: number;                 // Documents per batch
    freshnessDecayDays: number;        // Days for freshness decay
    maxTopics: number;                 // Maximum topics to extract
    qualityThreshold: number;          // Minimum quality score
    enrichmentTimeout: number;         // Timeout in milliseconds
}

/**
 * Metadata enrichment context
 * Additional context to improve enrichment accuracy
 */
export interface EnrichmentContext {
    userId?: string;
    projectId?: string;
    source?: string;
    existingTags?: string[];
    fileName?: string;
    language?: string;
}
