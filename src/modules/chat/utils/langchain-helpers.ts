import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';

export interface LangchainChatStateType {
  messages: any[];
  integrationContext?: {
    aws?: boolean;
    google?: boolean;
    github?: boolean;
    vercel?: boolean;
  };
  conversationDepth?: number;
  currentRoute?: string;
  userIntent?: string;
  complexity?: 'low' | 'medium' | 'high';
}

/** Context passed into generateConversationalResponse (conversation state, routing, etc.) */
export interface ConversationalContext {
  currentSubject?: string;
  lastDomain?: string;
  conversationId?: string;
  previousMessages?: Array<{ role: string; content: string }>;
  integrationContext?: LangchainChatStateType['integrationContext'];
  conversationDepth?: number;
  userIntent?: string;
}

/** Intent analysis result (may be a plain string from analyzeUserIntent or a richer object) */
export type IntentAnalysisResult =
  | string
  | { intent?: string; confidence?: number; entities?: string[] };

@Injectable()
export class LangchainHelpers {
  constructor(private readonly loggingService: LoggerService) {}

  /**
   * Analyze user intent from message
   */
  analyzeUserIntent(message: string, _analysis: string): string {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('strategy') || lowerMessage.includes('plan')) {
      return 'strategic_planning';
    }
    if (lowerMessage.includes('optimize') || lowerMessage.includes('improve')) {
      return 'optimization_request';
    }
    if (
      lowerMessage.includes('integrate') ||
      lowerMessage.includes('connect')
    ) {
      return 'integration_request';
    }
    if (lowerMessage.includes('analyze') || lowerMessage.includes('report')) {
      return 'analytics_request';
    }
    if (
      lowerMessage.includes('automate') ||
      lowerMessage.includes('workflow')
    ) {
      return 'automation_request';
    }

    return 'general_assistance';
  }

  /**
   * Assess message complexity
   */
  assessComplexity(message: string): 'low' | 'medium' | 'high' {
    const wordCount = message.split(' ').length;
    const hasMultipleQuestions = (message.match(/\?/g) || []).length > 1;
    const hasIntegrationTerms = [
      'aws',
      'google',
      'github',
      'integrate',
      'connect',
    ].some((term) => message.toLowerCase().includes(term));

    if (wordCount > 100 || hasMultipleQuestions || hasIntegrationTerms) {
      return 'high';
    } else if (wordCount > 30) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Check if message requires user input
   */
  requiresUserInput(message: string): boolean {
    const inputIndicators = [
      'how should',
      'what would you',
      'which option',
      'help me choose',
      'need to know',
      'strategy',
      'plan',
      'configure',
      'setup',
    ];
    return inputIndicators.some((indicator) =>
      message.toLowerCase().includes(indicator),
    );
  }

  /**
   * Identify integration needs from message
   */
  identifyIntegrationNeeds(message: string): string[] {
    const integrations: string[] = [];
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes('aws') ||
      lowerMessage.includes('bedrock') ||
      lowerMessage.includes('cost')
    ) {
      integrations.push('aws');
    }
    if (
      lowerMessage.includes('google') ||
      lowerMessage.includes('workspace') ||
      lowerMessage.includes('gmail') ||
      lowerMessage.includes('drive') ||
      lowerMessage.includes('sheets')
    ) {
      integrations.push('google');
    }
    if (
      lowerMessage.includes('github') ||
      lowerMessage.includes('repository') ||
      lowerMessage.includes('code')
    ) {
      integrations.push('github');
    }
    if (
      lowerMessage.includes('vercel') ||
      lowerMessage.includes('deployment')
    ) {
      integrations.push('vercel');
    }
    if (
      lowerMessage.includes('jira') ||
      lowerMessage.includes('ticket') ||
      lowerMessage.includes('issue')
    ) {
      integrations.push('jira');
    }
    if (
      lowerMessage.includes('linear') ||
      lowerMessage.includes('linear.app')
    ) {
      integrations.push('linear');
    }
    if (lowerMessage.includes('slack') || lowerMessage.includes('channel')) {
      integrations.push('slack');
    }
    if (lowerMessage.includes('discord') || lowerMessage.includes('server')) {
      integrations.push('discord');
    }

    return integrations;
  }

  /**
   * Extract strategic questions from content
   */
  extractStrategicQuestions(content: string): string[] {
    const questions = content
      .split(/[.!?]/)
      .filter(
        (sentence) =>
          sentence.includes('?') || sentence.toLowerCase().includes('need to'),
      )
      .map((q) => q.trim())
      .filter((q) => q.length > 10)
      .slice(0, 5);

    return questions.length > 0
      ? questions
      : [
          'What is your primary goal with this request?',
          'What timeline are you working with?',
          'Are there any specific constraints or requirements?',
        ];
  }

  /**
   * Generate adaptive questions
   */
  generateAdaptiveQuestions(message: string, _context: any): string[] {
    return [
      `Based on "${message}", what specific outcomes are you looking for?`,
      'Are there any additional requirements or constraints?',
      'How would you measure success for this initiative?',
    ];
  }

  /**
   * Determine if web search should be used
   */
  shouldUseWebSearch(
    query: string,
    context?: any,
  ): { required: boolean; reason: string } {
    const lowerQuery = query.toLowerCase();

    // Check for current events or time-sensitive information
    const currentEventIndicators = [
      'latest',
      'recent',
      'current',
      'today',
      'this week',
      'this month',
      'breaking',
      'news',
      'update',
      'announcement',
      'release',
    ];

    // Check for specific domains requiring fresh data
    const freshDataDomains = [
      'pricing',
      'rates',
      'costs',
      'market',
      'trends',
      'statistics',
      'weather',
      'sports',
      'politics',
      'elections',
      'economy',
    ];

    // Check for version or release information
    const versionIndicators = [
      'version',
      'release',
      'update',
      'latest version',
      'current version',
    ];

    const needsCurrentData = currentEventIndicators.some((indicator) =>
      lowerQuery.includes(indicator),
    );
    const needsFreshData = freshDataDomains.some((domain) =>
      lowerQuery.includes(domain),
    );
    const needsVersionInfo = versionIndicators.some((indicator) =>
      lowerQuery.includes(indicator),
    );

    // Check if context indicates this is a follow-up that doesn't need web search
    const isFollowUp =
      context?.conversationId && context?.previousMessages?.length > 0;

    if (needsCurrentData || needsFreshData || needsVersionInfo) {
      return {
        required: true,
        reason: needsCurrentData
          ? 'Query involves current events or time-sensitive information'
          : needsFreshData
            ? 'Query requires up-to-date market or statistical data'
            : 'Query requests specific version or release information',
      };
    }

    // For follow-up questions, be more conservative about web search
    if (isFollowUp) {
      return {
        required: false,
        reason: 'Follow-up question that can be answered with existing context',
      };
    }

    return {
      required: false,
      reason: 'Query can be answered using existing knowledge and context',
    };
  }

  /**
   * Generate conversational response using intent, context, and optional follow-up questions.
   * Uses structured templates; can be replaced or augmented by an LLM in the caller when available.
   */
  generateConversationalResponse(
    query: string,
    context?: ConversationalContext | Record<string, unknown>,
    intentAnalysis?: IntentAnalysisResult,
  ): Promise<string> {
    const intent =
      typeof intentAnalysis === 'string'
        ? intentAnalysis
        : (intentAnalysis?.intent ??
          this.analyzeUserIntent(query, 'conversational'));
    const complexity = this.assessComplexity(query);
    const integrations = this.identifyIntegrationNeeds(query);

    const ctx = context as ConversationalContext | undefined;
    const subjectLine = ctx?.currentSubject
      ? ` You've been discussing ${ctx.currentSubject}.`
      : '';
    const integrationLine =
      ctx?.integrationContext && Object.keys(ctx.integrationContext).length > 0
        ? ` I see you're working with ${Object.keys(ctx.integrationContext).join(', ')}.`
        : '';

    let response = '';

    switch (intent) {
      case 'strategic_planning':
        response = `I understand you're looking for strategic planning assistance.${subjectLine}${integrationLine} Let me help you think through this systematically. What are the key objectives you're trying to achieve, and what constraints are you working with?`;
        break;

      case 'optimization_request':
        response = `Optimization is a great goal!${integrationLine} To provide the best recommendations, could you share more details about what you're currently doing and what specific improvements you're targeting?`;
        break;

      case 'integration_request':
        response = `Integration setup can be complex but rewarding.${integrationLine} What systems are you looking to connect, and what's your primary use case for this integration?`;
        break;

      case 'analytics_request':
        response = `Analytics and reporting are crucial for data-driven decisions.${subjectLine} What kind of insights are you hoping to gain, and what data sources do you have available?`;
        break;

      case 'automation_request':
        response = `Automation can save significant time and reduce errors.${integrationLine} What processes are you currently doing manually that you'd like to automate?`;
        break;

      case 'general_assistance':
        if (integrations.length > 0) {
          response = `I can help with ${integrations.join(', ')} and cost optimization. What would you like to do—for example list resources, create something, or get details on a specific item?`;
        } else if (complexity === 'high') {
          response = `This seems like a complex request.${subjectLine} Let me break this down—could you clarify the most important aspects you'd like me to focus on first?`;
        } else {
          response = `I understand your request.${subjectLine}${integrationLine} How can I help—cost optimization, integrations, or something else?`;
        }
        break;

      default:
        if (complexity === 'high') {
          response = `This seems like a complex request.${subjectLine} Let me break this down—could you clarify the most important aspects you'd like me to focus on first?`;
        } else {
          response = `I understand your request.${subjectLine}${integrationLine} Could you provide any additional context or specific requirements?`;
        }
    }

    if (
      (intent === 'strategic_planning' || complexity === 'high') &&
      (ctx?.conversationDepth ?? 0) < 5
    ) {
      const questions = this.extractStrategicQuestions(query);
      if (questions.length > 0) {
        const followUp = questions
          .slice(0, 2)
          .map((q, i) => `${i + 1}. ${q}`)
          .join('\n');
        if (followUp) {
          response += `\n\nYou might also consider:\n${followUp}`;
        }
      }
    }

    return Promise.resolve(response);
  }

  /**
   * Generate proactive insights
   */
  generateProactiveInsights(state: LangchainChatStateType): string[] {
    const insights = [];

    if (state.integrationContext?.aws) {
      insights.push('Cost optimization opportunities identified in AWS usage');
    }
    if (state.integrationContext?.google) {
      insights.push(
        'Workflow automation potential detected in Google Workspace',
      );
    }
    if (state.integrationContext?.github) {
      insights.push(
        'Development efficiency improvements available in GitHub workflows',
      );
    }
    if ((state.conversationDepth || 0) > 3) {
      insights.push(
        'Complex multi-step workflow detected - automation recommended',
      );
    }

    return insights;
  }

  /**
   * Calculate task priority
   */
  calculateTaskPriority(state: LangchainChatStateType): number {
    const urgencyKeywords = [
      'urgent',
      'asap',
      'critical',
      'emergency',
      'immediately',
    ];
    const lastMessage =
      (state.messages[state.messages.length - 1]?.content as string) || '';

    if (
      urgencyKeywords.some((keyword) =>
        lastMessage.toLowerCase().includes(keyword),
      )
    ) {
      return 10;
    }

    // High priority for complex multi-step tasks
    if ((state.conversationDepth || 0) > 5) {
      return 8;
    }

    // Medium priority for integration tasks
    if (
      state.integrationContext &&
      Object.keys(state.integrationContext).length > 0
    ) {
      return 6;
    }

    // Default priority
    return 5;
  }

  /**
   * Convert chat messages to Langchain format
   */
  convertToLangchainMessages(chatMessages: any[]): any[] {
    return chatMessages.map((msg) => {
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      return {
        role,
        content: msg.content || '',
        metadata: {
          messageId: msg._id,
          createdAt: msg.createdAt,
          ...msg.metadata,
        },
      };
    });
  }

  /**
   * Build system prompt with context
   */
  buildSystemPrompt(context: any, preamble?: string): string {
    let prompt = `You are CostKatana, an AI assistant specialized in cost optimization and workflow automation.

Core Capabilities:
- AI API cost monitoring and optimization
- Multi-provider model recommendations
- Workflow automation across platforms
- Integration management (GitHub, AWS, Google, Vercel, etc.)
- Strategic planning and implementation guidance

`;

    if (preamble) {
      prompt += `\nContext Information:\n${preamble}\n`;
    }

    if (context?.currentSubject) {
      prompt += `\nCurrent Subject: ${context.currentSubject}`;
    }

    if (context?.lastDomain) {
      prompt += `\nDomain: ${context.lastDomain}`;
    }

    prompt += `

Guidelines:
- Provide actionable, cost-conscious recommendations
- Suggest integrations when relevant
- Focus on automation and efficiency improvements
- Be proactive about cost optimization opportunities
- Use clear, structured responses

How can I help you optimize costs and workflows today?`;

    return prompt;
  }

  /**
   * Validate message format for Langchain
   */
  validateMessageFormat(message: any): boolean {
    return (
      message &&
      typeof message === 'object' &&
      typeof message.role === 'string' &&
      typeof message.content === 'string'
    );
  }

  /**
   * Estimate token usage for Langchain messages
   */
  estimateTokenUsage(messages: any[]): number {
    const charsPerToken = 4;
    const messageOverhead = 4; // Tokens per message for formatting

    return messages.reduce((total, msg) => {
      const contentTokens = Math.ceil(
        (msg.content || '').length / charsPerToken,
      );
      return total + contentTokens + messageOverhead;
    }, 0);
  }

  /**
   * Check if question should generate selection options
   */
  shouldGenerateOptions(question: string, _context: any): boolean {
    const lowerQuestion = question.toLowerCase();

    // Questions that benefit from options
    const optionKeywords = [
      'which',
      'choose',
      'select',
      'pick',
      'prefer',
      'option',
      'type of',
      'kind of',
      'category',
      'priority',
      'level',
      'mode',
      'approach',
    ];

    return optionKeywords.some((keyword) => lowerQuestion.includes(keyword));
  }

  /**
   * Parse options from AI response content
   */
  parseOptionsFromResponse(content: string): Array<{
    id: string;
    label: string;
    value: string;
    description?: string;
    icon?: string;
  }> {
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      this.loggingService.warn('Failed to parse options JSON', { error });
    }

    // Fallback: Generate default options
    return [
      {
        id: 'option1',
        label: 'High Priority',
        value: 'high',
        description: 'Critical tasks requiring immediate attention',
        icon: 'exclamation',
      },
      {
        id: 'option2',
        label: 'Medium Priority',
        value: 'medium',
        description: 'Important tasks with flexible timeline',
        icon: 'clock',
      },
      {
        id: 'option3',
        label: 'Low Priority',
        value: 'low',
        description: 'Nice-to-have improvements',
        icon: 'check',
      },
    ];
  }

  /**
   * Extract parameter name from question text
   */
  extractParameterName(question: string): string {
    const lowerQuestion = question.toLowerCase();

    if (lowerQuestion.includes('priority')) return 'priority';
    if (lowerQuestion.includes('timeline')) return 'timeline';
    if (lowerQuestion.includes('budget')) return 'budget';
    if (lowerQuestion.includes('approach')) return 'approach';
    if (lowerQuestion.includes('integration')) return 'integration';
    if (lowerQuestion.includes('feature')) return 'feature';

    return 'parameter';
  }

  /**
   * Log Langchain operation for debugging
   */
  logOperation(operation: string, data: any): void {
    this.loggingService.debug(`Langchain operation: ${operation}`, {
      component: 'LangchainHelpers',
      operation,
      ...data,
    });
  }
}
