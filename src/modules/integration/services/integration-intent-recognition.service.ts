import { Injectable, Logger } from '@nestjs/common';

export interface RecognizedIntent {
  action: string;
  integrationType: string | null;
  entities: Record<string, string | string[]>;
  confidence: number;
  rawText: string;
}

const INTENT_PATTERNS: Array<{
  pattern: RegExp;
  action: string;
  integrationType: string | null;
  entityKeys: string[];
}> = [
  {
    pattern: /create\s+(?:a\s+)?jira\s+issue/i,
    action: 'create_issue',
    integrationType: 'jira_oauth',
    entityKeys: ['title', 'description', 'project'],
  },
  {
    pattern: /create\s+(?:a\s+)?linear\s+issue/i,
    action: 'create_issue',
    integrationType: 'linear_oauth',
    entityKeys: ['title', 'description', 'team'],
  },
  {
    pattern: /post\s+to\s+slack/i,
    action: 'send_message',
    integrationType: 'slack_webhook',
    entityKeys: ['channel', 'message'],
  },
  {
    pattern: /send\s+to\s+discord/i,
    action: 'send_message',
    integrationType: 'discord_webhook',
    entityKeys: ['channel', 'message'],
  },
  {
    pattern: /notify\s+(?:via\s+)?(slack|discord|webhook)/i,
    action: 'send_message',
    integrationType: null,
    entityKeys: ['target', 'message'],
  },
  {
    pattern: /test\s+integration/i,
    action: 'test_integration',
    integrationType: null,
    entityKeys: [],
  },
  {
    pattern: /list\s+(?:my\s+)?integrations/i,
    action: 'list_integrations',
    integrationType: null,
    entityKeys: [],
  },
];

@Injectable()
export class IntegrationIntentRecognitionService {
  private readonly logger = new Logger(
    IntegrationIntentRecognitionService.name,
  );

  /**
   * Parse user text into a structured intent for integration routing.
   */
  recognize(text: string): RecognizedIntent {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      return {
        action: 'unknown',
        integrationType: null,
        entities: {},
        confidence: 0,
        rawText: trimmed,
      };
    }

    for (const {
      pattern,
      action,
      integrationType,
      entityKeys,
    } of INTENT_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        const entities = this.extractEntities(trimmed, entityKeys);
        return {
          action,
          integrationType,
          entities,
          confidence: 0.85,
          rawText: trimmed,
        };
      }
    }

    if (/\b(slack|discord|jira|linear|webhook)\b/i.test(trimmed)) {
      return {
        action: 'generic_integration',
        integrationType: null,
        entities: { query: trimmed },
        confidence: 0.5,
        rawText: trimmed,
      };
    }

    return {
      action: 'unknown',
      integrationType: null,
      entities: {},
      confidence: 0,
      rawText: trimmed,
    };
  }

  private extractEntities(
    text: string,
    keys: string[],
  ): Record<string, string | string[]> {
    const entities: Record<string, string | string[]> = {};
    for (const key of keys) {
      const quoted = text.match(
        new RegExp(`${key}\\s*[:=]\\s*["']([^"']+)["']`, 'i'),
      );
      if (quoted) entities[key] = quoted[1];
    }
    return entities;
  }
}
