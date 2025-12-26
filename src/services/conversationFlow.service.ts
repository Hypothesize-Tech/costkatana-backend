import { loggingService } from './logging.service';
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
            loggingService.error('Error processing conversation message:', { error: error instanceof Error ? error.message : String(error) });
            return {
                response: 'I apologize, but I encountered an error processing your message. Could you please try again?',
                isComplete: false,
                requiresMcpCall: false
            };
        }
    }

    /**
     * Detect what task the user wants to accomplish using AI
     * Uses Nova Pro to intelligently determine if a multi-step workflow is needed
     */
    private async detectTaskIntent(message: string): Promise<string | null> {
        const lowerMessage = message.toLowerCase();
        
        // Skip conversational flow for direct agent commands
        if (lowerMessage.startsWith('execute ') && lowerMessage.includes('with data:')) {
            return null; // Let it go directly to handleGeneralQuery
        }

        try {
            // Use Nova Pro to analyze the message intent
            const { BedrockService } = await import('./bedrock.service');
            
            const analysisPrompt = `Analyze this user message and determine if it requires a multi-step guided workflow or can be answered directly.

User Message: "${message}"

Available Workflows:
1. create_project - User wants to create a new project (requires project details collection)
2. cost_optimization - User wants to actively optimize/reduce costs (requires analysis and action)
3. model_selection - User wants help selecting/choosing a specific model (requires preference gathering)
4. null - Simple question that can be answered directly without workflow

Rules:
- Return "null" for informational questions (What is X? How does Y work? Explain Z, etc.)
- Return "null" for questions in any language (Arabic, English, etc.) that just need an answer
- Return "null" for analysis requests (analyze my usage, show me data, etc.)
- Return a workflow ONLY if the user explicitly wants to SET UP or CREATE something multi-step
- Return "null" for questions about cost optimization methods (how to optimize, best practices)
- Return "cost_optimization" ONLY if user says "optimize my costs now" or "reduce my spending"

Respond with ONLY the workflow name or "null" (no quotes, no explanation):`;

            const response = await BedrockService.invokeModel(
                analysisPrompt,
                'us.amazon.nova-pro-v1:0'
            );

            const intent = (response || '').toString().trim().toLowerCase();
            
            // Validate the response
            const validIntents = [
                'null',
                'create_project', 
                'cost_optimization',
                'model_selection'
            ];

            if (validIntents.includes(intent)) {
                loggingService.info('AI-detected task intent', {
                    message: message.substring(0, 100),
                    detectedIntent: intent
                });
                return intent === 'null' ? null : intent;
            }

            // If AI returns something invalid, default to null (direct answer)
            loggingService.warn('AI returned invalid intent, defaulting to null', {
                message: message.substring(0, 100),
                aiResponse: intent
            });
            return null;

        } catch (error) {
            loggingService.error('Error in AI intent detection, falling back to null', {
                error: error instanceof Error ? error.message : String(error),
                message: message.substring(0, 100)
            });
            // On error, default to null (direct answer) - safer than triggering wrong workflow
            return null;
        }
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
        // Check if this is a knowledge base query first
        if (this.isKnowledgeBaseQuery(message)) {
            return await this.handleKnowledgeBaseQuery(userId, message, context);
        }

        // For truly general queries, still provide a conversational approach
        // but execute immediately since they don't need structured data collection
        try {
            const agentResponse = await agentService.query({
                userId,
                query: message,
                context
            });

            // Debug logging to understand the response structure
            loggingService.info('ConversationFlow - Agent response structure:', {
                success: agentResponse.success,
                hasResponse: !!agentResponse.response,
                responseLength: agentResponse.response?.length || 0,
                responsePreview: agentResponse.response?.substring(0, 100) + '...',
                error: agentResponse.error
            });

            // Check if agent was successful and has a response
            if (agentResponse.success && agentResponse.response) {
                return {
                    response: agentResponse.response,
                    isComplete: true,
                    requiresMcpCall: false,
                    thinking: agentResponse.thinking
                };
            } else if (agentResponse.success && !agentResponse.response) {
                // Agent succeeded but returned empty response - this shouldn't happen but handle gracefully
                loggingService.warn('ConversationFlow - Agent succeeded but no response:', { value:  { success: agentResponse.success,
                    metadata: agentResponse.metadata
                 } });
                
                return {
                    response: 'I processed your request successfully, but the response was empty. Please try asking your question again.',
                    isComplete: true,
                    requiresMcpCall: false,
                    thinking: agentResponse.thinking
                };
            } else {
                // Log the failure case
                loggingService.warn('ConversationFlow - Agent failed:', { value:  { success: agentResponse.success,
                    error: agentResponse.error,
                    metadata: agentResponse.metadata
                 } });
                
                return {
                    response: agentResponse.error || 'I apologize, but I encountered an error processing your request. Please try rephrasing your question or being more specific about what you\'d like to know.',
                    isComplete: true,
                    requiresMcpCall: false,
                    thinking: agentResponse.thinking
                };
            }
        } catch (error) {
            loggingService.error('Error handling general query:', { error: error instanceof Error ? error.message : String(error) });
            return {
                response: 'I apologize, but I encountered an error. Could you please rephrase your question or be more specific about what you\'d like me to help you with?',
                isComplete: true,
                requiresMcpCall: false
            };
        }
    }

    /**
     * Check if a message is a knowledge base query
     */
    private isKnowledgeBaseQuery(message: string): boolean {
        const knowledgeBaseMentions = [
            '@knowledge-base/',
            '@knowledge-base',
            'knowledge base',
            'knowledge-base',
            'cost katana',
            'costkatana',
            'what is cost katana',
            'what is costkatana',
            'cost optimization platform',
            'costkatana',
            'ai cost optimization',
            'cost optimizer platform',
            'cost optimization system',
            'costkatana platform',
            'cost katana platform',
            'what does costkatana do',
            'what does costkatana do'
        ];
        
        const messageLower = message.toLowerCase();
        
        // Special handling for Cost Katana variations to prevent confusion with sword katana
        const costKatanaPatterns = [
            /cost\s*katana/i,
            /costkatana/i,
            /what\s+is\s+cost\s*katana/i,
            /what\s+is\s+costkatana/i,
            /tell\s+me\s+about\s+cost\s*katana/i,
            /explain\s+cost\s*katana/i,
            /ai\s+cost\s+optimizer/i,
            /cost\s+optimization\s+platform/i,
            /what\s+does\s+cost\s*katana\s+do/i,
            /what\s+does\s+costkatana\s+do/i
        ];
        
        // Check for Cost Katana specific patterns first
        if (costKatanaPatterns.some(pattern => pattern.test(message))) {
            return true;
        }
        
        // Check for general knowledge base mentions
        return knowledgeBaseMentions.some(mention => messageLower.includes(mention.toLowerCase()));
    }

    /**
     * Handle knowledge base queries directly
     */
    private async handleKnowledgeBaseQuery(
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
            // Import the KnowledgeBaseTool here to avoid circular dependencies
            const { KnowledgeBaseTool } = await import('../tools/knowledgeBase.tool');
            const knowledgeBaseTool = new KnowledgeBaseTool();
            
            // Clean the message to extract the actual query
            let cleanQuery = message
                .replace(/@knowledge-base\/?/gi, '')
                .replace(/knowledge[\s-]?base/gi, '')
                .trim();
            
            // If the query is empty after cleaning, use the original message
            if (!cleanQuery) {
                cleanQuery = message;
            }

            // Enhance the query with context information
            let contextualQuery = cleanQuery;
            if (context) {
                // Add conversation context for better search results
                if (context.previousMessages && context.previousMessages.length > 0) {
                    const recentContext = context.previousMessages
                        .slice(-3) // Last 3 messages for context
                        .map((msg: any) => `${msg.role}: ${msg.content}`)
                        .join('\n');
                    
                    contextualQuery = `Context from conversation:\n${recentContext}\n\nCurrent query: ${cleanQuery}`;
                }

                // Add model context if available
                if (context.selectedModel) {
                    contextualQuery += `\n\nUser is currently using model: ${context.selectedModel}`;
                }

                // Add any additional context information
                if (context.conversationId) {
                    contextualQuery += `\n\nConversation ID: ${context.conversationId}`;
                }
            }
            
            loggingService.info('Processing knowledge base query with context:', {
                originalMessage: message,
                cleanQuery: cleanQuery,
                contextualQuery: contextualQuery,
                userId: userId,
                hasContext: !!context,
                contextKeys: context ? Object.keys(context) : []
            });
            
            const knowledgeResponse = await knowledgeBaseTool._call(contextualQuery);
            
            return {
                response: knowledgeResponse,
                isComplete: true,
                requiresMcpCall: false,
                thinking: {
                    title: 'Knowledge Base Search with Context',
                    steps: [
                        {
                            step: 1,
                            description: 'Detected knowledge base query',
                            reasoning: 'Message contains knowledge base mention or Cost Katana reference',
                            outcome: 'Routing to knowledge base tool'
                        },
                        {
                            step: 2,
                            description: 'Enhanced query with conversation context',
                            reasoning: context ? 'Added previous messages and model context for better search results' : 'No additional context available',
                            outcome: `Enhanced query: "${contextualQuery.substring(0, 100)}${contextualQuery.length > 100 ? '...' : ''}"`
                        },
                        {
                            step: 3,
                            description: 'Searching knowledge base',
                            reasoning: `Searching with contextual query for more relevant results`,
                            outcome: 'Knowledge base results retrieved with context consideration'
                        }
                    ],
                    summary: 'Successfully retrieved contextual information from the CostKatana knowledge base'
                }
            };
            
        } catch (error) {
            loggingService.error('Error handling knowledge base query:', { error: error instanceof Error ? error.message : String(error) });
            return {
                response: 'I apologize, but I encountered an error accessing the knowledge base. Please try rephrasing your question about Cost Katana or the CostKatana.',
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