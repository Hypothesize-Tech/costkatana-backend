/**
 * Coreference Resolver
 * Resolves pronouns and references in messages using context
 */

import { Injectable } from '@nestjs/common';
import { CoreferenceResult, ConversationContext } from './types/context.types';

@Injectable()
export class CoreferenceResolver {
  /**
   * Resolve coreferences in message using conversation context
   */
  async resolve(
    message: string,
    context: ConversationContext,
    recentMessages: any[],
  ): Promise<CoreferenceResult> {
    let resolvedMessage = message;
    const substitutions: Array<{
      original: string;
      replacement: string;
      confidence: number;
    }> = [];

    // Extract entities from context
    const entities = [
      ...context.lastReferencedEntities,
      context.currentSubject,
      context.lastToolUsed,
    ].filter(Boolean) as string[];

    // Common pronouns and their possible replacements
    const pronouns: Array<{ pattern: RegExp; type: 'singular' | 'plural' }> = [
      { pattern: /\bit\b/gi, type: 'singular' },
      { pattern: /\bthis\b/gi, type: 'singular' },
      { pattern: /\bthat\b/gi, type: 'singular' },
      { pattern: /\bthese\b/gi, type: 'plural' },
      { pattern: /\bthose\b/gi, type: 'plural' },
      { pattern: /\bthem\b/gi, type: 'plural' },
    ];

    for (const pronoun of pronouns) {
      const matches = resolvedMessage.match(pronoun.pattern);
      if (matches) {
        for (const match of matches) {
          // Find the most likely entity to replace this pronoun
          const replacement = this.findBestEntityReplacement(
            entities,
            context,
            recentMessages,
            pronoun.type,
          );

          if (replacement) {
            resolvedMessage = resolvedMessage.replace(
              match,
              replacement.entity,
            );
            substitutions.push({
              original: match,
              replacement: replacement.entity,
              confidence: replacement.confidence,
            });
          }
        }
      }
    }

    return {
      resolvedMessage,
      substitutions,
      entities: entities,
    };
  }

  /**
   * Find the best entity to replace a pronoun
   */
  private findBestEntityReplacement(
    entities: string[],
    context: ConversationContext,
    recentMessages: any[],
    pronounType: 'singular' | 'plural',
  ): { entity: string; confidence: number } | null {
    if (entities.length === 0) return null;

    // Score entities based on relevance
    const scoredEntities = entities.map((entity) => {
      let score = 0;

      // Prefer recently mentioned entities
      if (context.lastReferencedEntities.includes(entity)) {
        score += 0.3;
      }

      // Prefer current subject
      if (entity === context.currentSubject) {
        score += 0.4;
      }

      // Prefer last tool used
      if (entity === context.lastToolUsed) {
        score += 0.2;
      }

      // Check if entity appears in recent messages
      const recentText = recentMessages
        .slice(-3)
        .map((msg) => msg.content || msg.message || '')
        .join(' ')
        .toLowerCase();

      if (recentText.includes(entity.toLowerCase())) {
        score += 0.2;
      }

      // Length preference (shorter entities are often better for pronouns)
      if (entity.length < 50) {
        score += 0.1;
      }

      return { entity, score };
    });

    // Sort by score and return the best match
    scoredEntities.sort((a, b) => b.score - a.score);
    const bestMatch = scoredEntities[0];

    if (bestMatch.score > 0.2) {
      // Minimum confidence threshold
      return {
        entity: bestMatch.entity,
        confidence: Math.min(bestMatch.score, 1.0),
      };
    }

    return null;
  }
}
