/**
 * Context Management Types
 * Types for conversation context, coreference resolution, and message analysis
 */

export interface ConversationContext {
    conversationId: string;
    currentSubject?: string;
    currentIntent?: string;
    lastReferencedEntities: string[];
    lastToolUsed?: string;
    lastDomain?: string;
    languageFramework?: string;
    subjectConfidence: number;
    timestamp: Date;
}

export interface CoreferenceResult {
    resolved: boolean;
    subject?: string;
    confidence: number;
    method: 'rule-based' | 'llm-fallback';
}

export interface MessageAnalysisResult {
    subject?: string;
    intent?: string;
    domain?: string;
    confidence: number;
}

export type LanguageFramework = 'python' | 'javascript' | 'typescript' | 'frontend' | undefined;

export interface EntityExtractionResult {
    entities: string[];
    packages: string[];
    services: string[];
}
