import { Injectable } from '@nestjs/common';

export interface CollectionSuggestion {
  name: string;
  description?: string;
}

@Injectable()
export class MongodbSuggestionsService {
  /**
   * Suggest collection names based on common patterns and optional known list.
   */
  suggestCollections(knownNames: string[] = []): CollectionSuggestion[] {
    const common = [
      'users',
      'projects',
      'usage',
      'telemetries',
      'integrations',
      'workflows',
      'alerts',
    ];
    const set = new Set([...common, ...knownNames]);
    return Array.from(set).map((name) => ({
      name,
      description: `Collection: ${name}`,
    }));
  }

  /**
   * Suggest query hints for a collection (e.g. common fields).
   */
  suggestQueryHints(collectionName: string): string[] {
    const hints: Record<string, string[]> = {
      users: ['userId', 'email', 'createdAt'],
      usage: ['userId', 'model', 'cost', 'createdAt', 'workflowId'],
      telemetries: ['trace_id', 'span_id', 'timestamp', 'cost_usd'],
      integrations: ['userId', 'type', 'status'],
    };
    return hints[collectionName] ?? ['_id', 'createdAt'];
  }
}
