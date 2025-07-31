import { logger } from '../utils/logger';
import { agentService } from './agent.service';

// Define the structure for conversation states
export interface ConversationState {
    taskType: string;
    currentStep: number;
    totalSteps: number;
    collectedData: Record<string, any>;
    requiredFields: string[];
    optionalFields: string[];
    isComplete: boolean;
    lastQuestion?: string;
    context?: any;
}

// Define task templates
export interface TaskTemplate {
    name: string;
    description: string;
    steps: ConversationStep[];
    mcpAction?: string; // The MCP action to call when complete
}

export interface ConversationStep {
    field: string;
    question: string;
    type: 'required' | 'optional';
    validation?: (value: any) => boolean;
    options?: string[] | (() => Promise<string[]>); // Predefined options or function to get them
    followUp?: (value: any) => string; // Follow-up question based on answer
}

export class ConversationalFlowService {
    private conversationStates: Map<string, ConversationState> = new Map();
    private taskTemplates: Map<string, TaskTemplate> = new Map();

    constructor() {
        this.initializeTaskTemplates();
    }

    /**
     * Initialize predefined task templates
     */
    private initializeTaskTemplates(): void {
        // Project Creation Template
        this.taskTemplates.set('create_project', {
            name: 'Create Project',
            description: 'Step-by-step project creation',
            mcpAction: 'project_manager',
            steps: [
                {
                    field: 'projectName',
                    question: 'What would you like to call your project?',
                    type: 'required',
                    validation: (value) => typeof value === 'string' && value.trim().length > 0
                },
                {
                    field: 'budget',
                    question: 'What\'s your budget for this project? (e.g., $1000, €500, or just "flexible")',
                    type: 'required',
                    validation: (value) => typeof value === 'string' && value.trim().length > 0
                },
                {
                    field: 'description',
                    question: 'How would you describe this project? What will it be used for?',
                    type: 'required',
                    validation: (value) => typeof value === 'string' && value.trim().length > 0
                },
                {
                    field: 'setupMethod',
                    question: 'How would you like to set up this project?',
                    type: 'required',
                    options: ['Manual Setup', 'Gateway Integration', 'NPM Package'],
                    followUp: (value) => {
                        if (value?.toLowerCase().includes('npm')) {
                            return 'Great! I\'ll provide you with the NPM package details and setup instructions.';
                        } else if (value?.toLowerCase().includes('gateway')) {
                            return 'Perfect! Gateway integration provides centralized management and monitoring.';
                        } else {
                            return 'Manual setup gives you full control over the configuration.';
                        }
                    }
                },
                {
                    field: 'aiModels',
                    question: 'Which AI models are you planning to use? (e.g., Claude, GPT, Llama, or "not sure yet")',
                    type: 'optional'
                },
                {
                    field: 'expectedUsage',
                    question: 'What\'s your expected monthly usage? (e.g., "1000 requests", "heavy usage", or "just testing")',
                    type: 'optional'
                }
            ]
        });

        // Cost Optimization Template
        this.taskTemplates.set('cost_optimization', {
            name: 'Cost Optimization',
            description: 'Analyze and optimize costs',
            mcpAction: 'optimization_manager',
            steps: [
                {
                    field: 'timeframe',
                    question: 'What time period would you like me to analyze? (e.g., "last month", "last 7 days", "this year")',
                    type: 'required',
                    options: ['Last 7 days', 'Last month', 'Last 3 months', 'This year', 'Custom range']
                },
                {
                    field: 'focusArea',
                    question: 'What would you like me to focus on?',
                    type: 'required',
                    options: ['Model costs', 'Token usage', 'API calls', 'Overall spending', 'All areas']
                },
                {
                    field: 'targetReduction',
                    question: 'Do you have a target cost reduction in mind? (e.g., "20%", "save $500/month", or "just show me options")',
                    type: 'optional'
                },
                {
                    field: 'constraints',
                    question: 'Are there any constraints I should consider? (e.g., "maintain response quality", "keep current models", or "none")',
                    type: 'optional'
                }
            ]
        });

        // Model Selection Template
        this.taskTemplates.set('model_selection', {
            name: 'Model Selection',
            description: 'Help choose the right AI model',
            mcpAction: 'model_selector',
            steps: [
                {
                    field: 'useCase',
                    question: 'What will you be using this model for? (e.g., "chatbot", "content generation", "data analysis")',
                    type: 'required'
                },
                {
                    field: 'responseQuality',
                    question: 'How important is response quality vs cost?',
                    type: 'required',
                    options: ['High quality (cost is secondary)', 'Balanced', 'Cost-effective (basic quality is fine)']
                },
                {
                    field: 'responseSpeed',
                    question: 'How important is response speed?',
                    type: 'required',
                    options: ['Very fast responses needed', 'Moderate speed is fine', 'Speed is not important']
                },
                {
                    field: 'expectedVolume',
                    question: 'What\'s your expected usage volume? (e.g., "100 requests/day", "high volume", "just testing")',
                    type: 'optional'
                },
                {
                    field: 'specificRequirements',
                    question: 'Any specific requirements? (e.g., "multilingual", "code generation", "long context", or "none")',
                    type: 'optional'
                }
            ]
        });

        // Analytics Request Template
        this.taskTemplates.set('analytics_request', {
            name: 'Analytics Request',
            description: 'Get detailed analytics and insights',
            mcpAction: 'analytics_manager',
            steps: [
                {
                    field: 'analyticsType',
                    question: 'What kind of analytics would you like to see?',
                    type: 'required',
                    options: ['Cost breakdown', 'Usage patterns', 'Model performance', 'Token usage', 'All metrics']
                },
                {
                    field: 'timeframe',
                    question: 'For what time period?',
                    type: 'required',
                    options: ['Today', 'Last 7 days', 'Last month', 'Last 3 months', 'Custom range']
                },
                {
                    field: 'format',
                    question: 'How would you like the results?',
                    type: 'optional',
                    options: ['Summary overview', 'Detailed breakdown', 'Charts and graphs', 'Raw numbers']
                },
                {
                    field: 'specificProjects',
                    question: 'Any specific projects to focus on? (or "all projects")',
                    type: 'optional'
                }
            ]
        });

        // Usage Analysis Template
        this.taskTemplates.set('usage_analysis', {
            name: 'Usage Analysis',
            description: 'Analyze your AI usage patterns and costs',
            mcpAction: 'analytics_manager',
            steps: [
                {
                    field: 'analysisType',
                    question: 'What aspect of your usage would you like me to analyze?',
                    type: 'required',
                    options: ['Token usage', 'Model performance', 'Cost breakdown', 'API calls', 'All metrics']
                },
                {
                    field: 'timeframe',
                    question: 'What time period should I look at?',
                    type: 'required',
                    options: ['Today', 'Last 7 days', 'Last month', 'Last 3 months', 'Custom period']
                },
                {
                    field: 'comparisonNeeded',
                    question: 'Would you like me to compare with previous periods?',
                    type: 'optional',
                    options: ['Yes, show trends', 'No, just current data']
                }
            ]
        });

        // Help and Support Template
        this.taskTemplates.set('help_request', {
            name: 'Help Request',
            description: 'Get personalized help and guidance',
            mcpAction: 'knowledge_base_search',
            steps: [
                {
                    field: 'helpTopic',
                    question: 'What do you need help with?',
                    type: 'required',
                    options: ['Getting started', 'API integration', 'Cost optimization', 'Model selection', 'Troubleshooting', 'Best practices']
                },
                {
                    field: 'experienceLevel',
                    question: 'How would you describe your experience level?',
                    type: 'required',
                    options: ['Beginner - new to AI APIs', 'Intermediate - some experience', 'Advanced - experienced user']
                },
                {
                    field: 'specificIssue',
                    question: 'Can you describe the specific issue or question you have?',
                    type: 'optional'
                }
            ]
        });

        // API Integration Template  
        this.taskTemplates.set('api_integration', {
            name: 'API Integration',
            description: 'Help with API setup and integration',
            mcpAction: 'knowledge_base_search',
            steps: [
                {
                    field: 'integrationType',
                    question: 'What type of integration are you setting up?',
                    type: 'required',
                    options: ['REST API', 'SDK/Library', 'Gateway proxy', 'Direct model access']
                },
                {
                    field: 'programmingLanguage',
                    question: 'What programming language are you using?',
                    type: 'required',
                    options: ['JavaScript/Node.js', 'Python', 'Java', 'C#/.NET', 'PHP', 'Other']
                },
                {
                    field: 'currentChallenge',
                    question: 'What specific challenge are you facing?',
                    type: 'optional'
                }
            ]
        });

        // Performance Issues Template
        this.taskTemplates.set('performance_issues', {
            name: 'Performance Issues',
            description: 'Troubleshoot and optimize performance',
            mcpAction: 'optimization_manager',
            steps: [
                {
                    field: 'issueType',
                    question: 'What kind of performance issue are you experiencing?',
                    type: 'required',
                    options: ['Slow response times', 'High costs', 'Rate limiting', 'Error rates', 'Quality issues']
                },
                {
                    field: 'whenOccurs',
                    question: 'When does this issue typically occur?',
                    type: 'required',
                    options: ['Always', 'Peak hours', 'Specific operations', 'Randomly', 'Recently started']
                },
                {
                    field: 'impactLevel',
                    question: 'How is this impacting your application?',
                    type: 'required',
                    options: ['Critical - blocking users', 'High - affecting experience', 'Medium - manageable', 'Low - minor annoyance']
                }
            ]
        });

        // Monitoring Setup Template
        this.taskTemplates.set('monitoring_setup', {
            name: 'Monitoring Setup',
            description: 'Set up monitoring and alerts',
            mcpAction: 'mongodb_reader',
            steps: [
                {
                    field: 'monitoringGoals',
                    question: 'What do you want to monitor?',
                    type: 'required',
                    options: ['Cost thresholds', 'Usage patterns', 'Error rates', 'Performance metrics', 'All metrics']
                },
                {
                    field: 'alertPreferences',
                    question: 'How would you like to receive alerts?',
                    type: 'required',
                    options: ['Email notifications', 'Dashboard alerts', 'Webhook/API', 'SMS alerts']
                },
                {
                    field: 'thresholds',
                    question: 'What thresholds should trigger alerts? (e.g., "$100/month", "1000 requests/hour")',
                    type: 'optional'
                }
            ]
        });

        // General Information Template
        this.taskTemplates.set('general_inquiry', {
            name: 'General Inquiry',
            description: 'Get information and answers',
            mcpAction: 'knowledge_base_search',
            steps: [
                {
                    field: 'topicArea',
                    question: 'What topic would you like to know more about?',
                    type: 'required',
                    options: ['Pricing and costs', 'Available models', 'API features', 'Best practices', 'Technical documentation', 'Other']
                },
                {
                    field: 'specificQuestion',
                    question: 'What specific question can I help answer?',
                    type: 'required'
                },
                {
                    field: 'detailLevel',
                    question: 'How detailed would you like the explanation?',
                    type: 'optional',
                    options: ['Quick overview', 'Detailed explanation', 'Technical deep-dive']
                }
            ]
        });
    }

    /**
     * Process a user message and determine the conversation flow
     */
    async processMessage(
        conversationId: string,
        userId: string,
        message: string,
        context?: any
    ): Promise<{
        response: string;
        isComplete: boolean;
        requiresMcpCall: boolean;
        mcpAction?: string;
        mcpData?: any;
        thinking?: any;
    }> {
        try {
            // Get or initialize conversation state
            let state = this.conversationStates.get(conversationId);

            if (!state) {
                // New conversation - detect intent
                const taskType = await this.detectTaskIntent(message);
                
                if (taskType) {
                    state = this.initializeConversationState(taskType);
                    this.conversationStates.set(conversationId, state);
                } else {
                    // Handle general queries without specific task flow
                    return await this.handleGeneralQuery(userId, message, context);
                }
            }

            // Process the message within the conversation flow
            return await this.processConversationStep(conversationId, userId, message, state, context);

        } catch (error) {
            logger.error('Error processing conversation message:', error);
            return {
                response: 'I apologize, but I encountered an error processing your message. Could you please try again?',
                isComplete: false,
                requiresMcpCall: false
            };
        }
    }

    /**
     * Detect what task the user wants to accomplish
     */
    private async detectTaskIntent(message: string): Promise<string | null> {
        const lowerMessage = message.toLowerCase();

        // Project creation intents
        if (lowerMessage.includes('create project') || 
            lowerMessage.includes('new project') || 
            lowerMessage.includes('setup project') ||
            lowerMessage.includes('start a project')) {
            return 'create_project';
        }

        // Cost optimization intents
        if (lowerMessage.includes('optimize cost') || 
            lowerMessage.includes('reduce cost') || 
            lowerMessage.includes('save money') ||
            lowerMessage.includes('cost analysis') ||
            (lowerMessage.includes('spending') && (lowerMessage.includes('reduce') || lowerMessage.includes('optimize')))) {
            return 'cost_optimization';
        }

        // Model selection intents
        if (lowerMessage.includes('choose model') || 
            lowerMessage.includes('select model') || 
            lowerMessage.includes('recommend model') ||
            lowerMessage.includes('which model') ||
            lowerMessage.includes('best model')) {
            return 'model_selection';
        }

        // Analytics and usage intents
        if (lowerMessage.includes('analytics') || 
            lowerMessage.includes('usage data') || 
            lowerMessage.includes('metrics') ||
            lowerMessage.includes('dashboard') ||
            lowerMessage.includes('performance')) {
            return 'analytics_request';
        }

        // Usage analysis intents
        if (lowerMessage.includes('token usage') ||
            lowerMessage.includes('analyze usage') ||
            lowerMessage.includes('usage patterns') ||
            lowerMessage.includes('my usage') ||
            lowerMessage.includes('how much') ||
            lowerMessage.includes('spending')) {
            return 'usage_analysis';
        }

        // Help and support intents
        if (lowerMessage.includes('help') ||
            lowerMessage.includes('how to') ||
            lowerMessage.includes('guide') ||
            lowerMessage.includes('support') ||
            lowerMessage.includes('getting started') ||
            lowerMessage.includes('tutorial')) {
            return 'help_request';
        }

        // API integration intents
        if (lowerMessage.includes('api') ||
            lowerMessage.includes('integration') ||
            lowerMessage.includes('sdk') ||
            lowerMessage.includes('setup') ||
            lowerMessage.includes('connect') ||
            lowerMessage.includes('implement')) {
            return 'api_integration';
        }

        // Performance issues intents
        if (lowerMessage.includes('slow') ||
            lowerMessage.includes('error') ||
            lowerMessage.includes('issue') ||
            lowerMessage.includes('problem') ||
            lowerMessage.includes('not working') ||
            lowerMessage.includes('performance') ||
            lowerMessage.includes('rate limit')) {
            return 'performance_issues';
        }

        // Monitoring setup intents
        if (lowerMessage.includes('monitor') ||
            lowerMessage.includes('alert') ||
            lowerMessage.includes('notification') ||
            lowerMessage.includes('track') ||
            lowerMessage.includes('watch')) {
            return 'monitoring_setup';
        }

        // General inquiry - catch more general questions
        if (lowerMessage.includes('what') ||
            lowerMessage.includes('why') ||
            lowerMessage.includes('explain') ||
            lowerMessage.includes('tell me') ||
            lowerMessage.includes('show me') ||
            lowerMessage.includes('information') ||
            lowerMessage.includes('about') ||
            message.endsWith('?')) {
            return 'general_inquiry';
        }

        return null;
    }

    /**
     * Initialize conversation state for a task
     */
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
            requiredFields: template.steps.filter(step => step.type === 'required').map(step => step.field),
            optionalFields: template.steps.filter(step => step.type === 'optional').map(step => step.field),
            isComplete: false
        };
    }

    /**
     * Process a conversation step
     */
    private async processConversationStep(
        _conversationId: string,
        _userId: string,
        message: string,
        state: ConversationState,
        _context?: any
    ): Promise<{
        response: string;
        isComplete: boolean;
        requiresMcpCall: boolean;
        mcpAction?: string;
        mcpData?: any;
        thinking?: any;
    }> {
        const template = this.taskTemplates.get(state.taskType);
        if (!template) {
            throw new Error(`Template not found for task: ${state.taskType}`);
        }

        // If we're collecting data from previous question
        if (state.lastQuestion && state.currentStep > 0) {
            const currentField = template.steps[state.currentStep - 1];
            
            // Validate and store the answer
            if (currentField.validation && !currentField.validation(message)) {
                return {
                    response: `I need a valid answer for that. ${currentField.question}`,
                    isComplete: false,
                    requiresMcpCall: false
                };
            }

            // Store the collected data
            state.collectedData[currentField.field] = message;

            // Check for follow-up message
            if (currentField.followUp) {
                const followUpMessage = currentField.followUp(message);
                if (followUpMessage) {
                    // Don't increment step yet, just acknowledge
                    const nextQuestion = this.getNextQuestion(state, template);
                    return {
                        response: `${followUpMessage}\n\n${nextQuestion}`,
                        isComplete: false,
                        requiresMcpCall: false
                    };
                }
            }
        }

        // Move to next step
        if (state.currentStep < template.steps.length) {
            const nextQuestion = this.getNextQuestion(state, template);
            state.lastQuestion = nextQuestion;
            
            return {
                response: nextQuestion,
                isComplete: false,
                requiresMcpCall: false
            };
        }

        // All steps completed - check if we have enough data
        const missingRequired = state.requiredFields.filter(field => !state.collectedData[field]);
        
        if (missingRequired.length > 0) {
            return {
                response: `I still need some information: ${missingRequired.join(', ')}. Let me ask about the first missing item.`,
                isComplete: false,
                requiresMcpCall: false
            };
        }

        // Ready to execute the task
        state.isComplete = true;
        
        return {
            response: `Perfect! I have all the information I need. Let me ${template.description.toLowerCase()} for you now.`,
            isComplete: true,
            requiresMcpCall: true,
            mcpAction: template.mcpAction,
            mcpData: this.prepareMcpData(state, template),
            thinking: {
                title: `Executing ${template.name}`,
                steps: [
                    {
                        step: 1,
                        description: 'Information gathering completed',
                        reasoning: 'All required information has been collected through conversation',
                        outcome: 'Ready to execute task'
                    },
                    {
                        step: 2,
                        description: 'Calling MCP service',
                        reasoning: `Using ${template.mcpAction} with collected data`,
                        outcome: 'Task execution in progress'
                    }
                ],
                summary: `Completed information gathering for ${template.name} and executing task`
            }
        };
    }

    /**
     * Get the next question to ask
     */
    private getNextQuestion(state: ConversationState, template: TaskTemplate): string {
        if (state.currentStep >= template.steps.length) {
            return '';
        }

        const step = template.steps[state.currentStep];
        state.currentStep++;

        let question = step.question;

        // Add options if available
        if (step.options) {
            if (typeof step.options === 'function') {
                // For dynamic options, we'd need to handle this differently
                question += '\n\nI\'ll provide you with available options.';
            } else {
                question += '\n\nOptions:\n' + step.options.map((option, index) => `${index + 1}. ${option}`).join('\n');
            }
        }

        // No progress indicator - clean question only
        return question;
    }

    /**
     * Prepare data for MCP call
     */
    private prepareMcpData(state: ConversationState, _template: TaskTemplate): any {
        const mcpData: any = {
            operation: this.getMcpOperation(state.taskType),
            userId: 'placeholder_user_id', // This will be replaced with actual userId
            ...state.collectedData
        };

        // Task-specific data preparation
        switch (state.taskType) {
            case 'create_project':
                mcpData.projectData = {
                    name: state.collectedData.projectName,
                    description: state.collectedData.description,
                    budget: state.collectedData.budget,
                    setupMethod: state.collectedData.setupMethod,
                    aiModels: state.collectedData.aiModels,
                    expectedUsage: state.collectedData.expectedUsage
                };
                break;
            
            case 'cost_optimization':
                mcpData.analysisParams = {
                    timeframe: state.collectedData.timeframe,
                    focusArea: state.collectedData.focusArea,
                    targetReduction: state.collectedData.targetReduction,
                    constraints: state.collectedData.constraints
                };
                break;
            
            case 'model_selection':
                mcpData.selectionCriteria = {
                    useCase: state.collectedData.useCase,
                    responseQuality: state.collectedData.responseQuality,
                    responseSpeed: state.collectedData.responseSpeed,
                    expectedVolume: state.collectedData.expectedVolume,
                    specificRequirements: state.collectedData.specificRequirements
                };
                break;
                
                            case 'analytics_request':
                mcpData.analyticsParams = {
                    analyticsType: state.collectedData.analyticsType,
                    timeframe: state.collectedData.timeframe,
                    format: state.collectedData.format,
                    specificProjects: state.collectedData.specificProjects
                };
                break;

            case 'usage_analysis':
                mcpData.analysisParams = {
                    analysisType: state.collectedData.analysisType,
                    timeframe: state.collectedData.timeframe,
                    comparisonNeeded: state.collectedData.comparisonNeeded
                };
                break;
                
            case 'help_request':
                mcpData.helpParams = {
                    helpTopic: state.collectedData.helpTopic,
                    experienceLevel: state.collectedData.experienceLevel,
                    specificIssue: state.collectedData.specificIssue
                };
                break;
                
            case 'api_integration':
                mcpData.integrationParams = {
                    integrationType: state.collectedData.integrationType,
                    programmingLanguage: state.collectedData.programmingLanguage,
                    currentChallenge: state.collectedData.currentChallenge
                };
                break;
                
            case 'performance_issues':
                mcpData.troubleshootParams = {
                    issueType: state.collectedData.issueType,
                    whenOccurs: state.collectedData.whenOccurs,
                    impactLevel: state.collectedData.impactLevel
                };
                break;
                
            case 'monitoring_setup':
                mcpData.monitoringParams = {
                    monitoringGoals: state.collectedData.monitoringGoals,
                    alertPreferences: state.collectedData.alertPreferences,
                    thresholds: state.collectedData.thresholds
                };
                break;
                
            case 'general_inquiry':
                mcpData.inquiryParams = {
                    topicArea: state.collectedData.topicArea,
                    specificQuestion: state.collectedData.specificQuestion,
                    detailLevel: state.collectedData.detailLevel
                };
                break;
        }

        return mcpData;
    }

    /**
     * Get MCP operation for task type
     */
    private getMcpOperation(taskType: string): string {
        const operationMap: Record<string, string> = {
            'create_project': 'create',
            'cost_optimization': 'optimize',
            'model_selection': 'recommend',
            'analytics_request': 'analyze',
            'usage_analysis': 'analyze',
            'help_request': 'help',
            'api_integration': 'guide',
            'performance_issues': 'troubleshoot',
            'monitoring_setup': 'configure',
            'general_inquiry': 'query'
        };

        return operationMap[taskType] || 'query';
    }

    /**
     * Handle general queries that don't fit specific task flows
     */
    private async handleGeneralQuery(
        userId: string,
        message: string,
        context?: any
    ): Promise<{
        response: string;
        isComplete: boolean;
        requiresMcpCall: boolean;
        mcpAction?: string;
        mcpData?: any;
        thinking?: any;
    }> {
        // For truly general queries, still provide a conversational approach
        // but execute immediately since they don't need structured data collection
        try {
            const agentResponse = await agentService.query({
                userId,
                query: message,
                context
            });

            return {
                response: agentResponse.response || 'I apologize, but I couldn\'t process your request.',
                isComplete: true,
                requiresMcpCall: false,
                thinking: agentResponse.thinking
            };
        } catch (error) {
            logger.error('Error handling general query:', error);
            return {
                response: 'I apologize, but I encountered an error. Could you please rephrase your question or be more specific about what you\'d like me to help you with?',
                isComplete: true,
                requiresMcpCall: false
            };
        }
    }

    /**
     * Clear conversation state (useful for starting over)
     */
    clearConversationState(conversationId: string): void {
        this.conversationStates.delete(conversationId);
    }

    /**
     * Get conversation state for debugging
     */
    getConversationState(conversationId: string): ConversationState | undefined {
        return this.conversationStates.get(conversationId);
    }

    /**
     * Get available task templates
     */
    getAvailableTaskTemplates(): Array<{ name: string; description: string }> {
        return Array.from(this.taskTemplates.values()).map(template => ({
            name: template.name,
            description: template.description
        }));
    }
}

// Export singleton instance
export const conversationalFlowService = new ConversationalFlowService();