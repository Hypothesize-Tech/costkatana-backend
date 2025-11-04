import { BedrockService } from './tracedBedrock.service';
import { loggingService } from './logging.service';
import { ParsedMention, IntegrationCommand } from './integrationChat.service';

export interface RecognizedIntent {
  integration: string;
  commandType: 'create' | 'get' | 'list' | 'update' | 'delete' | 'send' | 'add';
  entity: string;
  params: Record<string, any>;
  confidence: number;
}

/**
 * AI-based integration intent recognition service
 * Uses the cheapest LLM (Nova Micro) to recognize integration commands from natural language
 */
export class IntegrationIntentRecognitionService {
  // Use the cheapest model for intent recognition
  private static readonly INTENT_MODEL = 'amazon.nova-micro-v1:0';

  /**
   * Recognize integration intent from a chat message using AI
   */
  static async recognizeIntent(
    message: string,
    mentions: ParsedMention[]
  ): Promise<RecognizedIntent | null> {
    if (mentions.length === 0) {
      return null;
    }

    const mention = mentions[0];
    const startTime = Date.now();

    try {
      // Build prompt for intent recognition
      const prompt = this.buildIntentRecognitionPrompt(message, mention);

      loggingService.info('Recognizing integration intent with AI', {
        component: 'IntegrationIntentRecognition',
        operation: 'recognizeIntent',
        integration: mention.integration,
        messageLength: message.length,
        model: this.INTENT_MODEL
      });

      // Call AI model for intent recognition
      const response = await BedrockService.invokeModel(
        prompt,
        this.INTENT_MODEL,
        { useSystemPrompt: false }
      );

      // Parse AI response
      const intent = this.parseIntentResponse(response, mention);

      if (intent) {
        loggingService.info('Intent recognized successfully', {
          component: 'IntegrationIntentRecognition',
          operation: 'recognizeIntent',
          integration: mention.integration,
          commandType: intent.commandType,
          entity: intent.entity,
          confidence: intent.confidence,
          duration: Date.now() - startTime
        });
      }

      return intent;
    } catch (error: any) {
      loggingService.error('AI intent recognition failed', {
        component: 'IntegrationIntentRecognition',
        operation: 'recognizeIntent',
        integration: mention.integration,
        error: error.message,
        duration: Date.now() - startTime
      });

      // Return null to fallback to manual parsing
      return null;
    }
  }

  /**
   * Build prompt for intent recognition
   */
  private static buildIntentRecognitionPrompt(
    message: string,
    mention: ParsedMention
  ): string {
    return `You are an integration intent recognition system. Analyze the following user message and identify the integration command intent.

User Message: "${message}"
Integration: ${mention.integration}

Available command types:
- list: List/search entities (issues, projects, channels, users, etc.)
- get: Get details of a specific entity
- create: Create a new entity (issue, project, PR, etc.)
- update: Update an existing entity
- delete: Delete an entity
- send: Send a message/notification
- add: Add something (comment, attachment, etc.)

Available entities for ${mention.integration}:
${this.getEntityListForIntegration(mention.integration)}

Your task:
1. Identify the command type (list, get, create, update, delete, send, add)
2. Identify the entity type (issue, project, channel, user, etc.)
3. Extract any parameters (IDs, titles, descriptions, filters, etc.)

Respond ONLY with a valid JSON object in this exact format:
{
  "commandType": "list|get|create|update|delete|send|add",
  "entity": "issue|project|channel|user|etc",
  "params": {
    "id": "entity-id-if-mentioned",
    "title": "title-if-mentioned",
    "description": "description-if-mentioned",
    "filter": "any-filter-criteria"
  },
  "confidence": 0.0-1.0
}

IMPORTANT SECURITY RULES:
- NEVER use MCP (Model Context Protocol) for fetching integration data
- Integration data (Linear projects, JIRA issues, GitHub repos, etc.) MUST come from the integration's API
- Only use APIs to fetch data from external services (Linear, JIRA, GitHub, Slack, Discord)
- Be confident only if you're certain (>0.7). Otherwise return confidence <0.7
- Extract entity IDs from mentions like @integration:entityType:entityId
- Return JSON only, no other text.`;
  }

  /**
   * Get entity list for a specific integration
   */
  private static getEntityListForIntegration(integration: string): string {
    const entities: Record<string, string[]> = {
      jira: ['issue', 'project', 'board', 'sprint', 'user', 'filter'],
      linear: ['issue', 'project', 'team', 'cycle', 'user', 'workflow'],
      slack: ['channel', 'message', 'user', 'workspace', 'thread'],
      discord: ['channel', 'message', 'user', 'guild', 'thread'],
      github: ['issue', 'pullrequest', 'repository', 'branch', 'commit', 'user'],
      webhook: ['webhook', 'event', 'delivery']
    };

    const integrationEntities = entities[integration.toLowerCase()] || ['issue', 'project', 'user'];
    return integrationEntities.map(e => `- ${e}`).join('\n');
  }

  /**
   * Parse AI response into RecognizedIntent
   */
  private static parseIntentResponse(
    response: string,
    mention: ParsedMention
  ): RecognizedIntent | null {
    try {
      // Extract JSON from response (may have markdown code blocks)
      let jsonStr = response.trim();
      
      // Remove markdown code blocks if present
      if (jsonStr.includes('```')) {
        const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) {
          jsonStr = match[1].trim();
        }
      }

      // Parse JSON
      const parsed = JSON.parse(jsonStr);

      // Validate structure
      if (!parsed.commandType || !parsed.entity) {
        return null;
      }

      // Validate command type
      const validCommandTypes = ['create', 'get', 'list', 'update', 'delete', 'send', 'add'];
      if (!validCommandTypes.includes(parsed.commandType)) {
        return null;
      }

      // Extract entity ID from mention if present
      const params = parsed.params || {};
      if (mention.entityId) {
        params.id = mention.entityId;
      }
      if (mention.entityType && !params.entityType) {
        params.entityType = mention.entityType;
      }

      return {
        integration: mention.integration,
        commandType: parsed.commandType,
        entity: parsed.entity,
        params,
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1)
      };
    } catch (error: any) {
      loggingService.error('Failed to parse intent response', {
        component: 'IntegrationIntentRecognition',
        operation: 'parseIntentResponse',
        error: error.message,
        responsePreview: response.substring(0, 200)
      });
      return null;
    }
  }

  /**
   * Convert recognized intent to IntegrationCommand
   */
  static intentToCommand(
    intent: RecognizedIntent,
    mention: ParsedMention
  ): IntegrationCommand {
    return {
      type: intent.commandType,
      entity: intent.entity,
      mention,
      params: intent.params,
      naturalLanguage: `AI recognized: ${intent.commandType} ${intent.entity}`
    };
  }
}

