/**
 * Context Types
 * Type definitions for conversation context management
 */

export interface ConversationContext {
  conversationId: string;
  currentSubject?: string;
  currentIntent?: string;
  lastReferencedEntities: string[];
  lastToolUsed?: string;
  lastDomain?: string;
  languageFramework?: string;
  subjectConfidence?: number;
  timestamp: Date;
}

export interface CoreferenceResult {
  resolvedMessage: string;
  substitutions: Array<{
    original: string;
    replacement: string;
    confidence: number;
  }>;
  entities: string[];
}

export interface EntityExtraction {
  entities: string[];
  types: Record<string, string>;
  confidence: Record<string, number>;
}

export interface MessageAnalysis {
  subject?: string;
  intent?: string;
  domain?: string;
  confidence: number;
  languageFramework?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  complexity: 'simple' | 'medium' | 'complex';
}
