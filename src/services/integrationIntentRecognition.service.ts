import { AIRouterService } from './aiRouter.service';
import { loggingService } from './logging.service';
import { ParsedMention, IntegrationCommand } from './integrationChat.service';

export interface RecognizedIntent {
  integration: string;
  commandType: 'create' | 'get' | 'list' | 'update' | 'delete' | 'send' | 'add' | 'assign' | 'remove' | 'ban' | 'unban' | 'kick';
  entity: string;
  params: Record<string, any>;
  confidence: number;
  modelUsed?: string;
  validationErrors?: string[];
}

interface ValidationResult {
  valid: boolean;
  normalized: Record<string, any>;
  errors: string[];
}

/**
 * AI-based integration intent recognition service with tiered model selection
 * Uses intelligent fallback chain: micro → lite → haiku based on integration complexity
 */
export class IntegrationIntentRecognitionService {
  // Tiered model configuration based on integration complexity
  private static readonly MODEL_TIERS = {
    simple: 'amazon.nova-micro-v1:0',
    medium: 'amazon.nova-lite-v1:0',
    complex: 'anthropic.claude-3-5-haiku-20241022-v1:0'
  };

  private static readonly INTEGRATION_COMPLEXITY: Record<string, 'simple' | 'medium' | 'complex'> = {
    discord: 'simple',
    slack: 'simple',
    webhook: 'simple',
    linear: 'medium',
    jira: 'medium',
    github: 'complex',
    vercel: 'complex',
    google: 'complex',
    gmail: 'complex',
    calendar: 'medium',
    drive: 'medium',
    sheets: 'medium',
    docs: 'medium',
    slides: 'medium',
    forms: 'medium'
  };

  /**
   * Recognize integration intent from a chat message using AI with smart fallback
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
    const complexity = this.INTEGRATION_COMPLEXITY[mention.integration.toLowerCase()] || 'medium';

    // Determine model progression based on integration complexity
    const modelChain = this.getModelChain(complexity);

    loggingService.info('Starting AI intent recognition with fallback chain', {
      component: 'IntegrationIntentRecognition',
      operation: 'recognizeIntent',
      integration: mention.integration,
      complexity,
      modelChain,
      messageLength: message.length
    });

    // Try each model in the chain
    for (let i = 0; i < modelChain.length; i++) {
      const model = modelChain[i];
      const attemptStart = Date.now();

      try {
        loggingService.info(`Attempting intent recognition with model ${i + 1}/${modelChain.length}`, {
          component: 'IntegrationIntentRecognition',
          model,
          attempt: i + 1
        });

        const intent = await this.tryModelRecognition(message, mention, model);

        if (intent) {
          // Validate and normalize parameters
          const validation = this.validateAndNormalizeParams(
            intent.params,
            mention.integration,
            intent.entity,
            intent.commandType
          );

          if (validation.valid) {
            intent.params = validation.normalized;
            intent.modelUsed = model;

            loggingService.info('Intent recognized and validated successfully', {
              component: 'IntegrationIntentRecognition',
              integration: mention.integration,
              commandType: intent.commandType,
              entity: intent.entity,
              confidence: intent.confidence,
              modelUsed: model,
              attempt: i + 1,
              duration: Date.now() - startTime
            });

            return intent;
          } else {
            loggingService.warn('Intent validation failed', {
              component: 'IntegrationIntentRecognition',
              model,
              errors: validation.errors,
              attempt: i + 1
            });

            // If this is the last model, return with validation errors
            if (i === modelChain.length - 1) {
              intent.validationErrors = validation.errors;
              intent.modelUsed = model;
              return intent;
            }
          }
        } else {
          loggingService.warn('Model returned no intent or low confidence', {
            component: 'IntegrationIntentRecognition',
            model,
            attempt: i + 1,
            duration: Date.now() - attemptStart
          });
        }
      } catch (error: any) {
        loggingService.error(`Model attempt ${i + 1} failed`, {
          component: 'IntegrationIntentRecognition',
          model,
          error: error.message,
          attempt: i + 1,
          duration: Date.now() - attemptStart
        });
      }
    }

    loggingService.warn('All AI models failed, falling back to manual parsing', {
      component: 'IntegrationIntentRecognition',
      integration: mention.integration,
      totalDuration: Date.now() - startTime
    });

    // Return null to fallback to manual parsing
    return null;
  }

  /**
   * Get model chain based on complexity
   */
  private static getModelChain(complexity: 'simple' | 'medium' | 'complex'): string[] {
    switch (complexity) {
      case 'simple':
        return [this.MODEL_TIERS.simple, this.MODEL_TIERS.medium];
      case 'medium':
        return [this.MODEL_TIERS.medium, this.MODEL_TIERS.complex];
      case 'complex':
        return [this.MODEL_TIERS.complex];
      default:
        return [this.MODEL_TIERS.medium, this.MODEL_TIERS.complex];
    }
  }

  /**
   * Try recognition with a specific model
   */
  private static async tryModelRecognition(
    message: string,
    mention: ParsedMention,
    model: string
  ): Promise<RecognizedIntent | null> {
    try {
      // Build prompt for intent recognition
      const prompt = this.buildIntentRecognitionPrompt(message, mention);

      // Call AI model for intent recognition
      const response = await AIRouterService.invokeModel(
        prompt,
        model
      );

      // Parse AI response
      const intent = this.parseIntentResponse(response, mention);

      // Check confidence threshold
      const minConfidence = model === this.MODEL_TIERS.complex ? 0.5 : 0.7;
      if (intent && intent.confidence >= minConfidence) {
        return intent;
      }

      return null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Build comprehensive prompt for intent recognition
   */
  private static buildIntentRecognitionPrompt(
    message: string,
    mention: ParsedMention
  ): string {
    const integration = mention.integration.toLowerCase();

    return `You are an integration intent recognition system. Analyze the following user message and identify the integration command intent.

User Message: "${message}"
Integration: ${mention.integration}

Available command types:
- list: List/search entities (issues, projects, channels, users, roles, etc.)
- get: Get details of a specific entity
- create: Create a new entity (issue, project, channel, role, etc.)
- update: Update an existing entity
- delete: Delete an entity
- send: Send a message/notification
- add: Add something (comment, attachment, etc.)
- assign: Assign something (role to user, issue to person, etc.)
- remove: Remove something (role from user, member from channel, etc.)
- ban: Ban a user
- unban: Unban a user
- kick: Kick a user

Available entities for ${mention.integration}:
${this.getEntityListForIntegration(integration)}

Command Schemas and Parameters:
${this.getCommandSchemaForIntegration(integration)}

Example Commands:
${this.getExampleCommandsForIntegration(integration)}

Your task:
1. Identify the command type (list, get, create, update, delete, send, add, assign, remove, ban, unban, kick)
2. Identify the entity type (issue, project, channel, user, role, etc.)
3. Extract ALL parameters from the message (names, IDs, titles, descriptions, etc.)
4. Ensure parameter names match the schema exactly
5. Extract text values intelligently (e.g., "create channel QA" should extract name: "QA")

Respond ONLY with a valid JSON object in this exact format:
{
  "commandType": "list|get|create|update|delete|send|add|assign|remove|ban|unban|kick",
  "entity": "issue|project|channel|user|role|etc",
  "params": {
    "name": "extracted-name-if-mentioned",
    "title": "title-if-mentioned",
    "message": "message-content",
    "description": "description-if-mentioned",
    "userId": "user-id-if-mentioned",
    "channelId": "channel-id-if-mentioned",
    "roleId": "role-id-if-mentioned"
  },
  "confidence": 0.0-1.0
}

IMPORTANT RULES:
- Extract text intelligently: "create channel QA" → name: "QA"
- Extract from patterns like "called X", "named Y", "create X"
- Be confident (>0.7) if command and parameters are clear
- Return confidence <0.7 if ambiguous or missing critical parameters
- Parameter names must match the schema (e.g., "name" for channel/role names)
- Return JSON only, no other text.`;
  }

  /**
   * Get comprehensive entity list for integration
   */
  private static getEntityListForIntegration(integration: string): string {
    const entities: Record<string, string[]> = {
      discord: ['channel', 'message', 'user', 'guild', 'role', 'thread', 'webhook'],
      slack: ['channel', 'message', 'user', 'workspace', 'thread', 'file'],
      jira: ['issue', 'project', 'board', 'sprint', 'user', 'filter', 'comment', 'attachment'],
      linear: ['issue', 'project', 'team', 'cycle', 'user', 'workflow', 'comment', 'label'],
      github: ['issue', 'pullrequest', 'repository', 'branch', 'commit', 'user', 'release', 'comment'],
      vercel: ['project', 'deployment', 'domain', 'env', 'log'],
      webhook: ['webhook', 'event', 'delivery', 'retry']
    };

    const integrationEntities = entities[integration] || ['issue', 'project', 'user'];
    return integrationEntities.map(e => `- ${e}`).join('\n');
  }

  /**
   * Get command schema for integration
   */
  private static getCommandSchemaForIntegration(integration: string): string {
    const schemas: Record<string, string> = {
      discord: `
- create channel: {name: string (required), type?: 0|2|4|13|15, isPrivate?: boolean}
- create role: {name: string (required), color?: hex, permissions?: number}
- send message: {message: string (required), channelId?: snowflake, channelName?: string (will lookup by name if ID not provided)}
- assign role: {userId: snowflake (required), roleId: snowflake (required)}
- remove role: {userId: snowflake (required), roleId: snowflake (required)}
- ban user: {userId: snowflake (required), reason?: string, days?: number}
- unban user: {userId: snowflake (required)}
- kick user: {userId: snowflake (required), reason?: string}
- delete channel: {channelId?: snowflake, name?: string (one required, will lookup by name if ID not provided)}
- list channels: {}
- list users: {}
- list roles: {}`,
      slack: `
- create channel: {name: string (required), isPrivate?: boolean}
- send message: {message: string (required), channelId?: string, channelName?: string (will lookup by name if ID not provided, uses first available channel if both omitted)}
- list channels: {}
- list users: {}`,
      jira: `
- create issue: {title: string (required), description?: string, projectKey?: string, issueType?: string}
- update issue: {issueKey: string (required), title?: string, description?: string}
- get issue: {issueKey: string (required)}
- list issues: {projectKey?: string, filter?: string}
- list projects: {}`,
      linear: `
- create issue: {title: string (required), description?: string, projectId?: string, teamId?: string}
- update issue: {issueId: string (required), title?: string, description?: string, state?: string}
- get issue: {issueId: string (required)}
- list issues: {projectId?: string, teamId?: string, filter?: string}
- list projects: {}`,
      github: `
- create pullrequest: {title: string (required), head: string (required), base: string (required), body?: string}
- create issue: {title: string (required), body?: string, labels?: string[]}
- create repository: {name: string (required), description?: string, private?: boolean}
- list issues: {state?: string, labels?: string}
- list pullrequests: {state?: string}`,
      vercel: `
- list projects: {}
- create deployment: {projectName: string (required), target?: 'production'|'preview'}
- get deployment: {projectName: string (required)}
- list deployments: {projectName: string (required)}
- get log: {projectName: string (required)}
- create domain: {projectName: string (required), domain: string (required)}
- list domains: {projectName: string (required)}
- delete domain: {projectName: string (required), domain: string (required)}
- list env: {projectName: string (required)}
- create env: {projectName: string (required), key: string (required), value: string (required), target?: string[]}
- delete env: {projectName: string (required), key: string (required)}
- update deployment: {projectName: string (required), deploymentId: string (required), action: 'rollback'|'promote'}`,
      webhook: `
- send webhook: {url: string (required), payload: object (required)}
- list webhooks: {}
- get delivery: {deliveryId: string (required)}`
    };

    return schemas[integration] || 'No specific schema defined';
  }

  /**
   * Get example commands for integration
   */
  private static getExampleCommandsForIntegration(integration: string): string {
    const examples: Record<string, string[]> = {
      discord: [
        '@discord create channel QA → {name: "QA"}',
        '@discord create channel called testing → {name: "testing"}',
        '@discord:create-role create role "Moderator" → {name: "Moderator"}',
        '@discord send message "Hello team" → {message: "Hello team"}',
        '@discord send hi message to general → {message: "hi", channelName: "general"}',
        '@discord:send-message send hi to any channel → {message: "hi"}',
        '@discord delete channel QA → {name: "QA"}',
        '@discord:delete-channel delete the channel QA → {name: "QA"}',
        '@discord:channel:123456 delete → {channelId: "123456"}',
        '@discord assign role user:123456 role:789012 → {userId: "123456", roleId: "789012"}',
        '@discord ban user 123456 → {userId: "123456"}',
        '@discord list channels',
        '@discord list roles'
      ],
      slack: [
        '@slack create channel general → {name: "general"}',
        '@slack create channel "project-qa" → {name: "project-qa"}',
        '@slack send message to #general Hello team → {channelName: "general", message: "Hello team"}',
        '@slack send hi to general → {channelName: "general", message: "hi"}',
        '@slack send "Meeting at 3pm" to #announcements → {channelName: "announcements", message: "Meeting at 3pm"}',
        '@slack send hi message to any channel → {message: "hi"}',
        '@slack:send-message send update without specifying channel → {message: "update"}',
        '@slack list channels',
        '@slack list users'
      ],
      jira: [
        '@jira create issue "Fix login bug" → {title: "Fix login bug"}',
        '@jira create issue "Add feature" in PROJECT-123 → {title: "Add feature", projectKey: "PROJECT-123"}',
        '@jira list issues',
        '@jira get issue PROJECT-456'
      ],
      linear: [
        '@linear create issue "Update docs" → {title: "Update docs"}',
        '@linear list issues in project ABC → {projectId: "ABC"}',
        '@linear update issue LIN-123 status "In Progress" → {issueId: "LIN-123", state: "In Progress"}'
      ],
      github: [
        '@github create pull request from feature to main → {head: "feature", base: "main"}',
        '@github create issue "Bug in auth" → {title: "Bug in auth"}',
        '@github list pull requests',
        '@github create repository my-app → {name: "my-app"}'
      ],
      vercel: [
        '@vercel list projects',
        '@vercel deploy my-app → {projectName: "my-app"}',
        '@vercel deploy my-app to production → {projectName: "my-app", target: "production"}',
        '@vercel show deployments for my-app → {projectName: "my-app"}',
        '@vercel get logs for my-app → {projectName: "my-app"}',
        '@vercel rollback my-app → {projectName: "my-app", action: "rollback"}',
        '@vercel add domain example.com to my-app → {projectName: "my-app", domain: "example.com"}',
        '@vercel list domains for my-app → {projectName: "my-app"}',
        '@vercel set env API_KEY to xyz123 for my-app → {projectName: "my-app", key: "API_KEY", value: "xyz123"}',
        '@vercel list env vars for my-app → {projectName: "my-app"}'
      ],
      google: [
        '@google send email to team@company.com about monthly costs → {action: "gmail", subAction: "send", params: {to: "team@company.com", subject: "Monthly costs"}}',
        '@google export cost data to sheets → {action: "sheets", subAction: "export"}',
        '@google create cost report in docs → {action: "docs", subAction: "report"}',
        '@google schedule budget review meeting next Friday → {action: "calendar", subAction: "create", params: {summary: "Budget review"}}',
        '@google list my calendar events → {action: "calendar", subAction: "list"}',
        '@google create feedback form for AI usage → {action: "forms", subAction: "create", params: {title: "AI usage feedback"}}',
        '@google create QBR slides → {action: "slides", subAction: "create", params: {title: "QBR"}}',
        '@google upload file to drive → {action: "drive", subAction: "upload"}',
        '@google share file with finance@company.com → {action: "drive", subAction: "share"}',
        '@google search emails about AWS billing → {action: "gmail", subAction: "search", params: {query: "AWS billing"}}'
      ],
      drive: [
        '@drive search monthly ai spend → {action: "drive", subAction: "search", params: {query: "monthly ai spend"}}',
        '@drive search budget report → {action: "drive", subAction: "search", params: {query: "budget report"}}',
        '@drive upload cost report → {action: "drive", subAction: "upload"}',
        '@drive create folder Budget Reports → {action: "drive", subAction: "folder", params: {folderName: "Budget Reports"}}',
        '@drive share file with team → {action: "drive", subAction: "share"}',
        '@drive list recent files → {action: "drive", subAction: "list"}'
      ],
      sheets: [
        '@sheets export monthly costs → {action: "sheets", subAction: "export"}',
        '@sheets create budget tracking sheet → {action: "sheets", subAction: "create"}',
        '@sheets list my spreadsheets → {action: "sheets", subAction: "list"}'
      ],
      docs: [
        '@docs create cost analysis report → {action: "docs", subAction: "report"}',
        '@docs create document → {action: "docs", subAction: "create"}',
        '@docs list documents → {action: "docs", subAction: "list"}'
      ],
      slides: [
        '@slides create QBR presentation → {action: "slides", subAction: "create", params: {title: "QBR"}}',
        '@slides export to PDF → {action: "slides", subAction: "pdf"}',
        '@slides add slide with cost chart → {action: "slides", subAction: "add-slide"}'
      ],
      forms: [
        '@forms create feedback form → {action: "forms", subAction: "create"}',
        '@forms add question to form → {action: "forms", subAction: "question"}',
        '@forms get responses → {action: "forms", subAction: "responses"}'
      ]
    };

    const integrationExamples = examples[integration] || [];
    return integrationExamples.join('\n');
  }

  /**
   * Validate and normalize parameters
   */
  private static validateAndNormalizeParams(
    params: Record<string, any>,
    integration: string,
    entity: string,
    commandType: string
  ): ValidationResult {
    const errors: string[] = [];
    const normalized: Record<string, any> = { ...params };

    // Integration-specific validation
    switch (integration.toLowerCase()) {
      case 'discord':
        this.validateDiscordParams(normalized, entity, commandType, errors);
        break;
      case 'slack':
        this.validateSlackParams(normalized, entity, commandType, errors);
        break;
      case 'jira':
        this.validateJiraParams(normalized, entity, commandType, errors);
        break;
      case 'github':
        this.validateGitHubParams(normalized, entity, commandType, errors);
        break;
      case 'google':
      case 'gmail':
      case 'calendar':
      case 'drive':
      case 'sheets':
      case 'docs':
      case 'slides':
      case 'forms':
        this.validateGoogleParams(normalized, entity, commandType, errors);
        break;
    }

    return {
      valid: errors.length === 0,
      normalized,
      errors
    };
  }

  /**
   * Validate Discord parameters
   */
  private static validateDiscordParams(
    params: Record<string, any>,
    entity: string,
    commandType: string,
    errors: string[]
  ): void {
    // Channel creation
    if (commandType === 'create' && entity === 'channel') {
      if (!params.name && !params.channelName) {
        errors.push('Channel name is required. Example: @discord create channel "QA"');
      }
      // Normalize channel name
      if (params.channelName && !params.name) {
        params.name = params.channelName;
        delete params.channelName;
      }
      // Validate channel type
      if (params.type !== undefined) {
        const validTypes = [0, 2, 4, 13, 15];
        if (!validTypes.includes(Number(params.type))) {
          errors.push('Invalid channel type. Must be 0 (text), 2 (voice), 4 (category), 13 (stage), or 15 (forum)');
        }
        params.type = Number(params.type);
      }
    }

    // Role creation
    if (commandType === 'create' && entity === 'role') {
      if (!params.name && !params.roleName) {
        errors.push('Role name is required. Example: @discord create role "Moderator"');
      }
      // Normalize role name
      if (params.roleName && !params.name) {
        params.name = params.roleName;
        delete params.roleName;
      }
      // Validate color
      if (params.color) {
        if (!/^#?[0-9A-Fa-f]{6}$/.test(params.color)) {
          errors.push('Invalid color format. Must be hex color (e.g., #FF0000 or FF0000)');
        }
      }
      // Validate permissions
      if (params.permissions !== undefined) {
        if (typeof params.permissions === 'string') {
          params.permissions = parseInt(params.permissions);
        }
        if (!Number.isInteger(params.permissions) || params.permissions < 0) {
          errors.push('Permissions must be a positive integer (bit flags)');
        }
      }
    }

    // User operations (ban, kick, unban, assign role, remove role)
    if (['ban', 'kick', 'unban'].includes(commandType) || 
        (commandType === 'assign' && entity === 'role') ||
        (commandType === 'remove' && entity === 'role')) {
      if (!params.userId) {
        errors.push('User ID is required. Must be a Discord snowflake ID (18-19 digits)');
      } else if (!this.isValidSnowflake(params.userId)) {
        errors.push('Invalid user ID format. Must be 18-19 digit Discord snowflake ID');
      }
    }

    // Role assignment/removal
    if ((commandType === 'assign' || commandType === 'remove') && entity === 'role') {
      if (!params.roleId) {
        errors.push('Role ID is required. Must be a Discord snowflake ID (18-19 digits)');
      } else if (!this.isValidSnowflake(params.roleId)) {
        errors.push('Invalid role ID format. Must be 18-19 digit Discord snowflake ID');
      }
    }

    // Message sending
    if (commandType === 'send' && entity === 'message') {
      if (!params.message) {
        errors.push('Message content is required');
      }
      if (params.channelId && !this.isValidSnowflake(params.channelId)) {
        errors.push('Invalid channel ID format. Must be 18-19 digit Discord snowflake ID');
      }
    }
  }

  /**
   * Validate Slack parameters
   */
  private static validateSlackParams(
    params: Record<string, any>,
    entity: string,
    commandType: string,
    errors: string[]
  ): void {
    if (commandType === 'create' && entity === 'channel') {
      if (!params.name && !params.channelName) {
        errors.push('Channel name is required');
      }
      if (params.channelName && !params.name) {
        params.name = params.channelName;
        delete params.channelName;
      }
    }

    if (commandType === 'send' && entity === 'message') {
      if (!params.message) {
        errors.push('Message content is required');
      }
    }
  }

  /**
   * Validate JIRA parameters
   */
  private static validateJiraParams(
    params: Record<string, any>,
    entity: string,
    commandType: string,
    errors: string[]
  ): void {
    if (commandType === 'create' && entity === 'issue') {
      if (!params.title) {
        errors.push('Issue title is required');
      }
    }

    if (commandType === 'update' && entity === 'issue') {
      if (!params.issueKey) {
        errors.push('Issue key is required for updates');
      }
    }
  }

  /**
   * Validate GitHub parameters
   */
  private static validateGitHubParams(
    params: Record<string, any>,
    entity: string,
    commandType: string,
    errors: string[]
  ): void {
    if (commandType === 'create' && entity === 'pullrequest') {
      if (!params.title) {
        errors.push('Pull request title is required');
      }
      if (!params.head) {
        errors.push('Source branch (head) is required');
      }
      if (!params.base) {
        errors.push('Target branch (base) is required');
      }
    }

    if (commandType === 'create' && entity === 'issue') {
      if (!params.title) {
        errors.push('Issue title is required');
      }
    }

    if (commandType === 'create' && entity === 'repository') {
      if (!params.name) {
        errors.push('Repository name is required');
      }
    }
  }

  /**
   * Validate Google Workspace parameters
   */
  private static validateGoogleParams(
    params: Record<string, any>,
    entity: string,
    commandType: string,
    errors: string[]
  ): void {
    const action = params.action || entity;
    const subAction = params.subAction || commandType;

    // Gmail validation
    if (action === 'gmail' || action === 'email') {
      if (subAction === 'send') {
        if (!params.params?.to && !params.to) {
          errors.push('Email recipient (to) is required');
        }
      }
    }

    // Calendar validation
    if (action === 'calendar') {
      if (subAction === 'create') {
        if (!params.params?.summary && !params.summary && !params.eventSummary) {
          errors.push('Event summary/title is required');
        }
      }
    }

    // Drive validation
    if (action === 'drive') {
      if (subAction === 'upload') {
        if (!params.params?.fileName && !params.fileName) {
          errors.push('File name is required');
        }
      }
      if (subAction === 'share') {
        if (!params.params?.fileId && !params.fileId) {
          errors.push('File ID is required for sharing');
        }
      }
    }

    // Forms validation
    if (action === 'forms' || action === 'form') {
      if (subAction === 'question' || subAction === 'add-question') {
        if (!params.params?.formId && !params.formId) {
          errors.push('Form ID is required');
        }
      }
    }
  }

  /**
   * Validate Discord snowflake ID format
   */
  private static isValidSnowflake(id: string): boolean {
    return /^\d{17,19}$/.test(String(id));
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
      const validCommandTypes = ['create', 'get', 'list', 'update', 'delete', 'send', 'add', 'assign', 'remove', 'ban', 'unban', 'kick'];
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
      naturalLanguage: `AI recognized: ${intent.commandType} ${intent.entity} (model: ${intent.modelUsed || 'unknown'})`
    };
  }
}
