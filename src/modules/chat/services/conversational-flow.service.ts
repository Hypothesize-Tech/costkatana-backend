/**
 * Conversational Flow Service (NestJS)
 *
 * Port from Express conversationFlow.service.ts.
 * Step-wise conversation handling for chat; routes to agent for general queries.
 */

import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from './agent.service';

export interface ConversationState {
  taskType: string;
  currentStep: number;
  totalSteps: number;
  collectedData: Record<string, unknown>;
  requiredFields: string[];
  optionalFields: string[];
  isComplete: boolean;
  lastQuestion?: string;
  context?: unknown;
}

export interface ConversationStep {
  field: string;
  question: string;
  type: 'required' | 'optional';
  validation?: (value: unknown) => boolean;
  options?: string[] | (() => Promise<string[]>);
  followUp?: (value: unknown) => string;
}

export interface TaskTemplate {
  name: string;
  description: string;
  steps: ConversationStep[];
  mcpAction?: string;
}

export interface ProcessMessageResult {
  response: string;
  isComplete: boolean;
  requiresMcpCall: boolean;
  mcpAction?: string;
  mcpData?: unknown;
  thinking?: unknown;
}

@Injectable()
export class ConversationalFlowService {
  private readonly logger = new Logger(ConversationalFlowService.name);
  private readonly conversationStates = new Map<string, ConversationState>();
  private readonly taskTemplates = new Map<string, TaskTemplate>();

  constructor(private readonly agentService: AgentService) {
    this.initializeTaskTemplates();
  }

  private initializeTaskTemplates(): void {
    this.taskTemplates.set('create_project', {
      name: 'Create Project',
      description: 'Step-by-step project creation',
      mcpAction: 'project_manager',
      steps: [
        {
          field: 'projectName',
          question: 'What would you like to call your project?',
          type: 'required',
          validation: (v) => typeof v === 'string' && v.trim().length > 0,
        },
        {
          field: 'budget',
          question: "What's your budget for this project?",
          type: 'required',
          validation: (v) => typeof v === 'string' && v.trim().length > 0,
        },
        {
          field: 'description',
          question: 'How would you describe this project?',
          type: 'required',
          validation: (v) => typeof v === 'string' && v.trim().length > 0,
        },
        {
          field: 'setupMethod',
          question: 'How would you like to set up this project?',
          type: 'required',
          options: ['Manual Setup', 'Gateway Integration', 'NPM Package'],
        },
        {
          field: 'aiModels',
          question: 'Which AI models are you planning to use?',
          type: 'optional',
        },
        {
          field: 'expectedUsage',
          question: "What's your expected monthly usage?",
          type: 'optional',
        },
      ],
    });
    this.taskTemplates.set('cost_optimization', {
      name: 'Cost Optimization',
      description: 'Analyze and optimize costs',
      mcpAction: 'optimization_manager',
      steps: [
        {
          field: 'timeframe',
          question: 'What time period would you like me to analyze?',
          type: 'required',
          options: ['Last 7 days', 'Last month', 'Last 3 months', 'This year'],
        },
        {
          field: 'focusArea',
          question: 'What would you like me to focus on?',
          type: 'required',
          options: [
            'Model costs',
            'Token usage',
            'API calls',
            'Overall spending',
          ],
        },
        {
          field: 'targetReduction',
          question: 'Do you have a target cost reduction in mind?',
          type: 'optional',
        },
      ],
    });
    this.taskTemplates.set('model_selection', {
      name: 'Model Selection',
      description: 'Help choose the right AI model',
      mcpAction: 'model_selector',
      steps: [
        {
          field: 'useCase',
          question: 'What will you be using this model for?',
          type: 'required',
        },
        {
          field: 'responseQuality',
          question: 'How important is response quality vs cost?',
          type: 'required',
          options: ['High quality', 'Balanced', 'Cost-effective'],
        },
        {
          field: 'responseSpeed',
          question: 'How important is response speed?',
          type: 'required',
          options: ['Very fast', 'Moderate', 'Not important'],
        },
      ],
    });
  }

  /**
   * Process a user message and return response (or next step in a workflow).
   * Currently routes all messages to direct agent answer (workflows disabled, matching Express).
   */
  async processMessage(
    conversationId: string,
    userId: string,
    message: string,
    context?: {
      callbacks?: unknown[];
      previousMessages?: unknown[];
      selectedModel?: string;
    } & Record<string, unknown>,
  ): Promise<ProcessMessageResult> {
    try {
      let state = this.conversationStates.get(conversationId);

      if (!state) {
        const taskType = await this.detectTaskIntent(message);
        if (taskType) {
          state = this.initializeConversationState(taskType);
          this.conversationStates.set(conversationId, state);
        } else {
          return await this.handleGeneralQuery(userId, message, context);
        }
      }

      return await this.processConversationStep(
        conversationId,
        userId,
        message,
        state,
        context,
      );
    } catch (error) {
      this.logger.error('Error processing conversation message', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        response:
          'I apologize, but I encountered an error processing your message. Could you please try again?',
        isComplete: false,
        requiresMcpCall: false,
      };
    }
  }

  private detectTaskIntent(message: string): string | null {
    const lowerMessage = message.toLowerCase().trim();

    // Skip MCP execution commands
    if (
      lowerMessage.startsWith('execute ') &&
      lowerMessage.includes('with data:')
    ) {
      return null;
    }

    // Project creation keywords and patterns
    const projectKeywords = [
      'create',
      'new',
      'setup',
      'start',
      'build',
      'initiate',
      'project',
      'workspace',
      'application',
      'app',
    ];

    const projectPatterns = [
      /\b(create|start|setup|build)\s+(a|an|new)?\s*project\b/i,
      /\b(new|another)\s+workspace\b/i,
      /\b(initiate|begin)\s+(a|an)?\s*application\b/i,
      /\bset\s+up\s+(a|an)?\s*project\b/i,
    ];

    // Cost optimization keywords and patterns
    const costKeywords = [
      'cost',
      'optimize',
      'optimization',
      'spending',
      'budget',
      'expensive',
      'cheap',
      'cheaper',
      'reduce',
      'saving',
      'analysis',
      'analytics',
      'monitor',
      'tracking',
      'usage',
      'consumption',
      'efficiency',
    ];

    const costPatterns = [
      /\b(cost|spending|budget)\s+(optimization|analysis|reduction|monitoring)\b/i,
      /\boptimize\s+(my|our|the)\s+costs?\b/i,
      /\b(reduce|cut|lower)\s+(costs?|spending|budget)\b/i,
      /\b(cost|spending)\s+(saving|efficiency|analysis)\b/i,
      /\bhow\s+much\s+(am\s+i|are\s+we)\s+spending\b/i,
      /\b(analyze|check|review)\s+(my|our)\s+(costs?|usage|spending)\b/i,
    ];

    // Model selection keywords and patterns
    const modelKeywords = [
      'model',
      'choose',
      'select',
      'recommend',
      'best',
      'which',
      'compare',
      'comparison',
      'option',
      'alternative',
      'suggest',
      'pick',
      'decide',
      'help me choose',
    ];

    const modelPatterns = [
      /\b(choose|select|recommend|pick)\s+(a|an|the best)\s*model\b/i,
      /\bwhich\s+model\s+(should|to)\s+(i|we)\s+use\b/i,
      /\b(best|right|appropriate)\s+model\s+for\b/i,
      /\bmodel\s+(selection|recommendation|choice)\b/i,
      /\bcompare\s+models?\b/i,
      /\bmodel\s+(option|alternative)s?\b/i,
    ];

    // Check for project creation intent
    const hasProjectKeywords = projectKeywords.some((keyword) =>
      lowerMessage.includes(keyword),
    );

    const hasProjectPattern = projectPatterns.some((pattern) =>
      pattern.test(message),
    );

    if (hasProjectKeywords || hasProjectPattern) {
      this.logger.log('Detected project creation intent', {
        message: message.substring(0, 100),
        keywords: hasProjectKeywords,
        pattern: hasProjectPattern,
      });
      return 'create_project';
    }

    // Check for cost optimization intent
    const hasCostKeywords = costKeywords.some((keyword) =>
      lowerMessage.includes(keyword),
    );

    const hasCostPattern = costPatterns.some((pattern) =>
      pattern.test(message),
    );

    if (hasCostKeywords || hasCostPattern) {
      this.logger.log('Detected cost optimization intent', {
        message: message.substring(0, 100),
        keywords: hasCostKeywords,
        pattern: hasCostPattern,
      });
      return 'cost_optimization';
    }

    // Check for model selection intent
    const hasModelKeywords = modelKeywords.some((keyword) =>
      lowerMessage.includes(keyword),
    );

    const hasModelPattern = modelPatterns.some((pattern) =>
      pattern.test(message),
    );

    if (hasModelKeywords || hasModelPattern) {
      this.logger.log('Detected model selection intent', {
        message: message.substring(0, 100),
        keywords: hasModelKeywords,
        pattern: hasModelPattern,
      });
      return 'model_selection';
    }

    // No specific task detected, route to direct answer
    this.logger.log(
      'No specific task intent detected, routing to direct answer',
      {
        message: message.substring(0, 100),
      },
    );
    return null;
  }

  private initializeConversationState(taskType: string): ConversationState {
    const template = this.taskTemplates.get(taskType);
    if (!template) {
      throw new Error(`Unknown task type: ${taskType}`);
    }
    return {
      taskType,
      currentStep: 0,
      totalSteps: template.steps.length,
      collectedData: {},
      requiredFields: template.steps
        .filter((s) => s.type === 'required')
        .map((s) => s.field),
      optionalFields: template.steps
        .filter((s) => s.type === 'optional')
        .map((s) => s.field),
      isComplete: false,
    };
  }

  private async processConversationStep(
    _conversationId: string,
    _userId: string,
    message: string,
    state: ConversationState,
    _context?: unknown,
  ): Promise<ProcessMessageResult> {
    const template = this.taskTemplates.get(state.taskType);
    if (!template) {
      throw new Error(`Template not found for task: ${state.taskType}`);
    }

    if (state.lastQuestion && state.currentStep > 0) {
      const currentField = template.steps[state.currentStep - 1];
      if (currentField.validation && !currentField.validation(message)) {
        return {
          response: `I need a valid answer for that. ${currentField.question}`,
          isComplete: false,
          requiresMcpCall: false,
        };
      }
      state.collectedData[currentField.field] = message;
      if (currentField.followUp) {
        const followUpMessage = currentField.followUp(message);
        if (followUpMessage) {
          const nextQuestion = this.getNextQuestion(state, template);
          return {
            response: `${followUpMessage}\n\n${nextQuestion}`,
            isComplete: false,
            requiresMcpCall: false,
          };
        }
      }
    }

    if (state.currentStep < template.steps.length) {
      const nextQuestion = this.getNextQuestion(state, template);
      state.lastQuestion = nextQuestion;
      return {
        response: nextQuestion,
        isComplete: false,
        requiresMcpCall: false,
      };
    }

    const missingRequired = state.requiredFields.filter(
      (field) => !state.collectedData[field],
    );
    if (missingRequired.length > 0) {
      return {
        response: `I still need some information: ${missingRequired.join(', ')}.`,
        isComplete: false,
        requiresMcpCall: false,
      };
    }

    state.isComplete = true;
    return {
      response: `Perfect! I have all the information I need. Let me ${template.description.toLowerCase()} for you now.`,
      isComplete: true,
      requiresMcpCall: true,
      mcpAction: template.mcpAction,
      mcpData: { ...state.collectedData, operation: 'query' },
      thinking: {
        title: `Executing ${template.name}`,
        summary: 'Information gathering completed.',
      },
    };
  }

  private getNextQuestion(
    state: ConversationState,
    template: TaskTemplate,
  ): string {
    if (state.currentStep >= template.steps.length) return '';
    const step = template.steps[state.currentStep];
    state.currentStep++;
    let question = step.question;
    if (step.options && Array.isArray(step.options)) {
      question +=
        '\n\nOptions:\n' +
        step.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
    }
    return question;
  }

  private async handleGeneralQuery(
    userId: string,
    message: string,
    context?: {
      callbacks?: unknown[];
      previousMessages?: unknown[];
      selectedModel?: string;
    } & Record<string, unknown>,
  ): Promise<ProcessMessageResult> {
    let actualQuery = message;
    const userQueryMatch = message.match(/User query:\s*(.+?)(?:\n|$)/is);
    if (userQueryMatch) {
      actualQuery = userQueryMatch[1].trim();
    }

    try {
      const agentResponse = await this.agentService.executeAgent({
        userId,
        query: actualQuery,
        context: context
          ? {
              ...context,
              previousMessages: (context.previousMessages ?? []) as Array<{
                role: string;
                content: string;
              }>,
              selectedModel: context.selectedModel,
            }
          : undefined,
        callbacks: context?.callbacks,
      });

      this.logger.debug('ConversationFlow - Agent response', {
        success: agentResponse.success,
        hasResponse: !!agentResponse.response,
      });

      if (agentResponse.success && agentResponse.response) {
        return {
          response: agentResponse.response,
          isComplete: true,
          requiresMcpCall: false,
          thinking: agentResponse.thinking,
        };
      }
      if (agentResponse.success && !agentResponse.response) {
        return {
          response:
            'I processed your request successfully, but the response was empty. Please try asking your question again.',
          isComplete: true,
          requiresMcpCall: false,
          thinking: agentResponse.thinking,
        };
      }
      return {
        response:
          agentResponse.error ||
          'I apologize, but I encountered an error processing your request. Please try rephrasing your question.',
        isComplete: true,
        requiresMcpCall: false,
        thinking: agentResponse.thinking,
      };
    } catch (error) {
      this.logger.error('Error handling general query', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        response:
          'I apologize, but I encountered an error. Could you please rephrase your question?',
        isComplete: true,
        requiresMcpCall: false,
      };
    }
  }

  getState(conversationId: string): ConversationState | undefined {
    return this.conversationStates.get(conversationId);
  }

  getAvailableTemplates(): TaskTemplate[] {
    return Array.from(this.taskTemplates.values());
  }
}
