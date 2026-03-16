/**
 * Entity Extractor
 * Extracts entities from messages and conversation history
 */

import { Injectable } from '@nestjs/common';

@Injectable()
export class EntityExtractor {
  /**
   * Extract entities from message and recent messages
   */
  extractEntities(message: string, recentMessages: any[]): string[] {
    const entities: string[] = [];

    // Extract from current message
    const currentEntities = this.extractFromText(message);
    entities.push(...currentEntities);

    // Extract from recent messages (last 3)
    const recentEntities = recentMessages
      .slice(-3)
      .flatMap((msg) => this.extractFromText(msg.content || msg.message || ''))
      .filter((entity) => entity.length > 2); // Filter out very short entities

    entities.push(...recentEntities);

    // Remove duplicates and return
    return [...new Set(entities)];
  }

  /**
   * Extract entities from text
   */
  private extractFromText(text: string): string[] {
    const entities: string[] = [];

    // Simple regex patterns for common entities
    const patterns = [
      // File extensions
      /\b\w+\.(js|ts|py|java|cpp|html|css|json|md|txt)\b/gi,
      // URLs
      /(https?:\/\/[^\s]+)/gi,
      // Email-like patterns
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      // Code identifiers (camelCase, snake_case)
      /\b[a-z]+[A-Z][a-zA-Z]*\b/g,
      /\b[a-z]+_[a-z_]+\b/g,
      // Numbers with context
      /\b\d+\s*(lines?|files?|items?|requests?|tokens?)\b/gi,
    ];

    patterns.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        entities.push(...matches);
      }
    });

    return entities;
  }
}
