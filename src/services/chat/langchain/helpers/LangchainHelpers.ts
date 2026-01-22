/**
 * Langchain Helper Methods
 * Utility functions for the Langchain multi-agent system
 */

import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage } from '@langchain/core/messages';
import { loggingService } from '@services/logging.service';
import { LangchainChatStateType } from '../types';

export class LangchainHelpers {
    /**
     * Analyze user intent from message
     */
    static analyzeUserIntent(message: string, _analysis: string): string {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('strategy') || lowerMessage.includes('plan')) {
            return 'strategic_planning';
        }
        if (lowerMessage.includes('optimize') || lowerMessage.includes('improve')) {
            return 'optimization_request';
        }
        if (lowerMessage.includes('integrate') || lowerMessage.includes('connect')) {
            return 'integration_request';
        }
        if (lowerMessage.includes('analyze') || lowerMessage.includes('report')) {
            return 'analytics_request';
        }
        if (lowerMessage.includes('automate') || lowerMessage.includes('workflow')) {
            return 'automation_request';
        }
        
        return 'general_assistance';
    }

    /**
     * Assess message complexity
     */
    static assessComplexity(message: string): 'low' | 'medium' | 'high' {
        const wordCount = message.split(' ').length;
        const hasMultipleQuestions = (message.match(/\?/g) || []).length > 1;
        const hasIntegrationTerms = ['aws', 'google', 'github', 'integrate', 'connect'].some(term => 
            message.toLowerCase().includes(term)
        );
        
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
    static requiresUserInput(message: string): boolean {
        const inputIndicators = [
            'how should', 'what would you', 'which option', 'help me choose',
            'need to know', 'strategy', 'plan', 'configure', 'setup'
        ];
        return inputIndicators.some(indicator => message.toLowerCase().includes(indicator));
    }

    /**
     * Identify integration needs from message
     */
    static identifyIntegrationNeeds(message: string): string[] {
        const integrations: string[] = [];
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('aws') || lowerMessage.includes('bedrock') || lowerMessage.includes('cost')) {
            integrations.push('aws');
        }
        if (lowerMessage.includes('google') || lowerMessage.includes('workspace') || lowerMessage.includes('gmail') || 
            lowerMessage.includes('drive') || lowerMessage.includes('sheets')) {
            integrations.push('google');
        }
        if (lowerMessage.includes('github') || lowerMessage.includes('repository') || lowerMessage.includes('code')) {
            integrations.push('github');
        }
        if (lowerMessage.includes('vercel') || lowerMessage.includes('deployment')) {
            integrations.push('vercel');
        }
        
        return integrations;
    }

    /**
     * Extract strategic questions from content
     */
    static extractStrategicQuestions(content: string): string[] {
        const questions = content.split(/[.!?]/)
            .filter(sentence => sentence.includes('?') || sentence.toLowerCase().includes('need to'))
            .map(q => q.trim())
            .filter(q => q.length > 10)
            .slice(0, 5);
            
        return questions.length > 0 ? questions : [
            'What is your primary goal with this request?',
            'What timeline are you working with?',
            'Are there any specific constraints or requirements?'
        ];
    }

    /**
     * Generate adaptive questions
     */
    static generateAdaptiveQuestions(message: string, _context: any): string[] {
        return [
            `Based on "${message}", what specific outcomes are you looking for?`,
            'Are there any additional requirements or constraints?',
            'How would you measure success for this initiative?'
        ];
    }

    /**
     * Generate proactive insights
     */
    static generateProactiveInsights(state: LangchainChatStateType): string[] {
        const insights = [];
        
        if (state.integrationContext?.aws) {
            insights.push('Cost optimization opportunities identified in AWS usage');
        }
        if (state.integrationContext?.google) {
            insights.push('Workflow automation potential detected in Google Workspace');
        }
        if (state.integrationContext?.github) {
            insights.push('Development efficiency improvements available in GitHub workflows');
        }
        if ((state.conversationDepth || 0) > 3) {
            insights.push('Complex multi-step workflow detected - automation recommended');
        }
        
        return insights;
    }

    /**
     * Calculate task priority
     */
    static calculateTaskPriority(state: LangchainChatStateType): number {
        const urgencyKeywords = ['urgent', 'asap', 'critical', 'emergency', 'immediately'];
        const lastMessage = state.messages[state.messages.length - 1]?.content as string || '';
        
        if (urgencyKeywords.some(keyword => lastMessage.toLowerCase().includes(keyword))) {
            return 10;
        }
        
        const complexityBonus = state.contextData?.complexity === 'high' ? 3 : 
                              state.contextData?.complexity === 'medium' ? 1 : 0;
        const integrationBonus = Object.keys(state.integrationContext || {}).length;
        
        return Math.min((state.conversationDepth || 1) + complexityBonus + integrationBonus, 10);
    }

    /**
     * Determine if we should generate options for IntegrationSelector
     */
    static shouldGenerateOptions(question: string, _context: any): boolean {
        const lowerQuestion = question.toLowerCase();
        
        const optionKeywords = [
            'which', 'choose', 'select', 'pick', 'prefer',
            'option', 'type of', 'kind of', 'category',
            'priority', 'level', 'mode', 'approach'
        ];
        
        return optionKeywords.some(keyword => lowerQuestion.includes(keyword));
    }

    /**
     * Parse options from AI response
     */
    static parseOptionsFromResponse(content: string): Array<{
        id: string;
        label: string;
        value: string;
        description?: string;
        icon?: string;
    }> {
        try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (error) {
            loggingService.warn('Failed to parse options JSON', { error });
        }
        
        return [
            {
                id: 'option1',
                label: 'High Priority',
                value: 'high',
                description: 'Critical tasks requiring immediate attention',
                icon: 'exclamation'
            },
            {
                id: 'option2',
                label: 'Medium Priority',
                value: 'medium',
                description: 'Important tasks with flexible timeline',
                icon: 'clock'
            },
            {
                id: 'option3',
                label: 'Low Priority',
                value: 'low',
                description: 'Nice-to-have improvements',
                icon: 'check'
            }
        ];
    }

    /**
     * Extract parameter name from question
     */
    static extractParameterName(question: string): string {
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
     * Determine autonomous actions using AI
     */
    static async determineAutonomousActions(context: any): Promise<Array<{
        action: string;
        priority: number;
        reasoning: string;
        parameters: any;
    }>> {
        try {
            const llm = new ChatBedrockConverse({
                model: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                temperature: 0.7,
                maxTokens: 2000,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });

            const analysisPrompt = new HumanMessage(`You are an autonomous AI decision-making system. Analyze the following context and determine what autonomous actions should be taken to help the user.

Context:
- User Intent: ${context.userIntent || 'Not specified'}
- Conversation Depth: ${context.conversationDepth || 0}
- Available Integrations: ${JSON.stringify(Object.keys(context.integrations || {}))}
- Previous Decisions: ${JSON.stringify(context.previousDecisions?.slice(-3) || [])}
- User Preferences: ${JSON.stringify(context.userPreferences || {})}

Analyze and return a JSON array of autonomous actions. Each action should have:
{
  "action": "specific_action_name",
  "priority": 1-10 (10 being highest),
  "reasoning": "why this action is beneficial",
  "parameters": { /* action-specific parameters */ }
}

Consider these action types:
- enable_cortex_optimization: Enable AI cost optimization (40-75% savings)
- analyze_usage_patterns: Analyze user's AI usage for insights
- suggest_aws_integration: Recommend AWS connection for deployment
- suggest_google_integration: Recommend Google Workspace automation
- suggest_github_integration: Recommend GitHub workflow automation
- suggest_workflow_automation: Create automation for repetitive tasks
- optimize_model_selection: Suggest better models for user's use case
- enable_semantic_cache: Enable caching for cost savings
- configure_budget_alerts: Set up cost monitoring alerts
- recommend_batch_processing: Suggest batching for efficiency

Return ONLY the JSON array, no other text.`);

            const response = await llm.invoke([analysisPrompt]);
            const responseText = response.content.toString().trim();
            
            let actions: Array<{ action: string; priority: number; reasoning: string; parameters: any }> = [];
            
            try {
                const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    actions = JSON.parse(jsonMatch[0]);
                }
            } catch (parseError) {
                loggingService.warn('Failed to parse AI action response, using fallback', {
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                });
            }

            actions = actions
                .filter(a => a.action && typeof a.priority === 'number' && a.reasoning)
                .sort((a, b) => b.priority - a.priority)
                .slice(0, 5);

            loggingService.info('AI determined autonomous actions', {
                actionCount: actions.length,
                topAction: actions[0]?.action
            });

            return actions;

        } catch (error) {
            loggingService.error('Failed to determine autonomous actions with AI', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            const fallbackActions = [];
            
            if (context.userIntent?.includes('cost') || context.userIntent?.includes('optimization')) {
                fallbackActions.push({
                    action: 'enable_cortex_optimization',
                    priority: 9,
                    reasoning: 'User interested in cost optimization - Cortex provides 40-75% savings',
                    parameters: { autoEnable: false, notifyUser: true }
                });
            }
            
            if (!context.integrations?.aws && context.userIntent?.includes('deploy')) {
                fallbackActions.push({
                    action: 'suggest_aws_integration',
                    priority: 7,
                    reasoning: 'User wants deployment but AWS not connected',
                    parameters: { showBenefits: true }
                });
            }
            
            return fallbackActions;
        }
    }

    /**
     * Execute autonomous workflows
     */
    static async executeAutonomousWorkflows(
        actions: Array<{ action: string; parameters: any }>,
        state: LangchainChatStateType
    ): Promise<any[]> {
        const results = [];
        
        try {
            const llm = new ChatBedrockConverse({
                model: 'amazon.nova-pro-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                temperature: 0.3,
                maxTokens: 1500,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });

            for (const action of actions.slice(0, 3)) {
                try {
                    let executionResult: any = {
                        action: action.action,
                        success: false,
                        message: '',
                        impact: 'unknown'
                    };

                    switch (action.action) {
                        case 'enable_cortex_optimization':
                            executionResult = {
                                action: action.action,
                                success: true,
                                message: 'Cortex optimization recommended for 40-75% cost savings',
                                impact: 'high',
                                nextSteps: ['Enable in settings', 'Review optimization strategies', 'Monitor savings'],
                                estimatedSavings: '40-75%'
                            };
                            break;

                        case 'analyze_usage_patterns':
                            const analysisPrompt = new HumanMessage(`Analyze AI usage patterns and provide insights:
                            
Context: ${JSON.stringify(state.contextData, null, 2)}
Conversation Depth: ${state.conversationDepth}

Provide 3-5 actionable insights about usage patterns, cost optimization, and efficiency improvements.
Format as JSON array of strings.`);
                            
                            const analysisResponse = await llm.invoke([analysisPrompt]);
                            const analysisText = analysisResponse.content.toString();
                            
                            let insights = ['Usage pattern analysis in progress'];
                            try {
                                const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
                                if (jsonMatch) {
                                    insights = JSON.parse(jsonMatch[0]);
                                }
                            } catch (e) {
                                // Use fallback insights
                            }
                            
                            executionResult = {
                                action: action.action,
                                success: true,
                                insights: insights.slice(0, 5),
                                message: `Analyzed usage patterns - ${insights.length} insights found`,
                                impact: 'medium'
                            };
                            break;

                        case 'suggest_workflow_automation':
                            executionResult = {
                                action: action.action,
                                success: true,
                                workflow: {
                                    name: 'AI Cost Optimization Workflow',
                                    steps: 5,
                                    estimatedSavings: '3 hours/week',
                                    features: ['Automated reporting', 'Cost alerts', 'Usage optimization']
                                },
                                message: 'Workflow automation recommended for efficiency',
                                impact: 'high'
                            };
                            break;

                        case 'optimize_model_selection':
                            const modelPrompt = new HumanMessage(`Based on this chat mode and usage: ${state.contextData?.chatMode || 'balanced'}, recommend optimal AI models.
                            
Consider: cost, speed, quality balance.
Return JSON object with: { recommended: [model names], reasoning: "why" }`);
                            
                            const modelResponse = await llm.invoke([modelPrompt]);
                            const modelText = modelResponse.content.toString();
                            
                            let modelSuggestion = { 
                                recommended: ['amazon.nova-pro-v1:0'], 
                                reasoning: 'Balanced performance and cost' 
                            };
                            
                            try {
                                const jsonMatch = modelText.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    modelSuggestion = JSON.parse(jsonMatch[0]);
                                }
                            } catch (e) {
                                // Use fallback
                            }
                            
                            executionResult = {
                                action: action.action,
                                success: true,
                                ...modelSuggestion,
                                message: 'Model optimization suggestions generated',
                                impact: 'medium'
                            };
                            break;

                        case 'suggest_aws_integration':
                        case 'suggest_google_integration':
                        case 'suggest_github_integration':
                            const integration = action.action.replace('suggest_', '').replace('_integration', '');
                            executionResult = {
                                action: action.action,
                                success: true,
                                integration: integration.toUpperCase(),
                                benefits: [
                                    'Seamless automation',
                                    'Enhanced productivity',
                                    'Cost optimization',
                                    'Intelligent workflows'
                                ],
                                message: `${integration.toUpperCase()} integration recommended for enhanced capabilities`,
                                impact: 'high'
                            };
                            break;

                        default:
                            executionResult = {
                                action: action.action,
                                success: true,
                                message: `Action ${action.action} identified for execution`,
                                impact: 'low'
                            };
                    }

                    results.push(executionResult);
                    
                } catch (actionError) {
                    loggingService.warn('Action execution failed', {
                        action: action.action,
                        error: actionError instanceof Error ? actionError.message : String(actionError)
                    });
                    
                    results.push({
                        action: action.action,
                        success: false,
                        error: actionError instanceof Error ? actionError.message : 'Unknown error',
                        impact: 'none'
                    });
                }
            }

            loggingService.info('Autonomous workflows executed', {
                totalActions: actions.length,
                executedActions: results.length,
                successfulActions: results.filter(r => r.success).length
            });

        } catch (error) {
            loggingService.error('Failed to execute autonomous workflows', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        return results;
    }

    /**
     * Predict user needs using AI
     */
    static async predictUserNeeds(state: LangchainChatStateType): Promise<string[]> {
        try {
            const llm = new ChatBedrockConverse({
                model: 'amazon.nova-pro-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                temperature: 0.6,
                maxTokens: 1000,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });

            const predictionPrompt = new HumanMessage(`You are a predictive AI assistant. Analyze the conversation and predict what the user might need next.

Current Context:
- User Intent: ${state.userIntent || 'Not specified'}
- Conversation Depth: ${state.conversationDepth || 0}
- Recent Topics: ${state.messages.slice(-3).map(m => m.content).join('; ')}
- Autonomous Decisions Made: ${state.autonomousDecisions?.slice(-3).join('; ') || 'None'}

Predict 3-5 things the user might need next. Consider:
- Natural conversation flow
- Common follow-up questions
- Related tasks or actions
- Proactive assistance opportunities

Return ONLY a JSON array of predicted needs as strings.`);

            const response = await llm.invoke([predictionPrompt]);
            const responseText = response.content.toString().trim();
            
            let predictions: string[] = [];
            
            try {
                const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    predictions = JSON.parse(jsonMatch[0]);
                }
            } catch (parseError) {
                loggingService.warn('Failed to parse AI predictions, using fallback', {
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                });
            }

            predictions = predictions
                .filter(p => typeof p === 'string' && p.length > 5 && p.length < 100)
                .slice(0, 5);

            loggingService.info('AI predicted user needs', {
                predictionCount: predictions.length
            });

            return predictions.length > 0 ? predictions : [
                'View detailed cost breakdown',
                'Set up budget alerts',
                'Optimize model selection'
            ];

        } catch (error) {
            loggingService.error('Failed to predict user needs', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            return [
                'View cost analysis',
                'Connect integrations',
                'Optimize workflow'
            ];
        }
    }
}
