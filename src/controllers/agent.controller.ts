import { Request, Response, NextFunction } from 'express';
import { agentService, AgentQuery } from '../services/agent.service';
import { validationResult } from 'express-validator';
import { loggingService } from '../services/logging.service';

interface AuthenticatedRequest extends Request {
    userId?: string;
}

export class AgentController {
    /**
     * Handle agent queries from users
     */
    static async query(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.userId;
        const { query, context } = req.body;

        try {
            loggingService.info('Agent query initiated', {
                userId,
                queryLength: query?.length || 0,
                hasContext: !!context,
                requestId: req.headers['x-request-id'] as string
            });

            // Check validation errors
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                loggingService.warn('Agent query validation failed', {
                    userId,
                    errors: errors.array(),
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: errors.array()
                });
                return;
            }

            if (!userId) {
                loggingService.warn('Agent query attempted without authentication', {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            // Build agent query
            const agentQuery: AgentQuery = {
                userId,
                query,
                context
            };

            loggingService.info('Executing agent query', {
                userId,
                queryType: context?.type || 'general',
                requestId: req.headers['x-request-id'] as string
            });

            // Execute agent query
            const result = await agentService.query(agentQuery);

            const duration = Date.now() - startTime;

            loggingService.info('Agent query completed', {
                userId,
                success: result.success,
                duration,
                responseLength: result.response?.length || 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business metrics
            loggingService.logBusiness({
                event: 'agent_query_completed',
                category: 'agent_interaction',
                value: duration,
                metadata: {
                    success: result.success,
                    queryLength: query?.length || 0,
                    responseLength: result.response?.length || 0,
                    userId
                }
            });

            res.status(result.success ? 200 : 500).json(result);

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent query failed', {
                userId,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            console.error('Agent query error:', error);
            next(error);
        }
    }

    /**
     * Stream agent response for real-time interaction
     */
    static async streamQuery(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.userId;
        const { query, context } = req.body;

        try {
            loggingService.info('Agent stream query initiated', {
                userId,
                queryLength: query?.length || 0,
                hasContext: !!context,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Agent stream query attempted without authentication', {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            // Set up Server-Sent Events
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });

            loggingService.info('SSE connection established for agent stream', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            // Send initial connection message
            res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Agent query started' })}\n\n`);

            try {
                // Build agent query
                const agentQuery: AgentQuery = {
                    userId,
                    query,
                    context
                };

                // Send thinking message
                res.write(`data: ${JSON.stringify({ type: 'thinking', message: 'Analyzing your query...' })}\n\n`);

                loggingService.info('Processing agent stream query', {
                    userId,
                    requestId: req.headers['x-request-id'] as string
                });

                // Execute agent query
                const result = await agentService.query(agentQuery);

                const duration = Date.now() - startTime;

                loggingService.info('Agent stream query completed', {
                    userId,
                    success: result.success,
                    duration,
                    responseLength: result.response?.length || 0,
                    requestId: req.headers['x-request-id'] as string
                });

                // Send final result
                res.write(`data: ${JSON.stringify({ 
                    type: 'result', 
                    data: result 
                })}\n\n`);

                // Log business metrics
                loggingService.logBusiness({
                    event: 'agent_stream_query_completed',
                    category: 'agent_interaction',
                    value: duration,
                    metadata: {
                        success: result.success,
                        queryLength: query?.length || 0,
                        responseLength: result.response?.length || 0,
                        userId
                    }
                });

            } catch (error) {
                const duration = Date.now() - startTime;
                
                loggingService.error('Agent stream query processing failed', {
                    userId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                    duration,
                    requestId: req.headers['x-request-id'] as string
                });

                res.write(`data: ${JSON.stringify({ 
                    type: 'error', 
                    error: error instanceof Error ? error.message : 'Unknown error' 
                })}\n\n`);
            }

            // End the stream
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();

            loggingService.info('Agent stream connection closed', {
                userId,
                totalDuration: Date.now() - startTime,
                requestId: req.headers['x-request-id'] as string
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent stream query failed', {
                userId,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            console.error('Agent stream error:', error);
            next(error);
        }
    }

    /**
     * Get agent status and statistics
     */
    static async getStatus(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('Agent status request initiated', {
                requestId: _req.headers['x-request-id'] as string
            });

            const status = agentService.getStatus();
            
            const duration = Date.now() - startTime;

            loggingService.info('Agent status retrieved successfully', {
                duration,
                statusKeys: Object.keys(status),
                requestId: _req.headers['x-request-id'] as string
            });

            res.json({
                success: true,
                data: status
            });
        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent status retrieval failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            console.error('Agent status error:', error);
            next(error);
        }
    }

    /**
     * Initialize agent (for admin use)
     */
    static async initialize(_req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('Agent initialization requested', {
                requestId: _req.headers['x-request-id'] as string,
                userAgent: _req.headers['user-agent']
            });

            // Check if user has admin rights (you might want to add this check)
            await agentService.initialize();
            
            const duration = Date.now() - startTime;

            loggingService.info('Agent initialized successfully', {
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'agent_initialized',
                category: 'system_operation',
                value: duration,
                metadata: {
                    timestamp: new Date().toISOString()
                }
            });
            
            res.json({
                success: true,
                message: 'Agent initialized successfully'
            });
        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent initialization failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            console.error('Agent initialization error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to initialize agent'
            });
        }
    }

    /**
     * Add learning/feedback to the agent
     */
    static async addFeedback(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.userId;
        const { insight, metadata, rating } = req.body;

        try {
            loggingService.info('Agent feedback submission initiated', {
                userId,
                hasInsight: !!insight,
                rating,
                metadataKeys: metadata ? Object.keys(metadata) : [],
                requestId: req.headers['x-request-id'] as string
            });

            if (!insight) {
                loggingService.warn('Agent feedback submission failed - missing insight', {
                    userId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Insight content is required'
                });
                return;
            }

            await agentService.addLearning(insight, {
                ...metadata,
                userId,
                rating,
                timestamp: new Date().toISOString()
            });

            const duration = Date.now() - startTime;

            loggingService.info('Agent feedback added successfully', {
                userId,
                rating,
                insightLength: insight.length,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'agent_feedback_added',
                category: 'user_engagement',
                value: rating || 0,
                metadata: {
                    insightLength: insight.length,
                    duration,
                    userId
                }
            });

            res.json({
                success: true,
                message: 'Feedback added successfully'
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent feedback submission failed', {
                userId,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            console.error('Agent feedback error:', error);
            next(error);
        }
    }

    /**
     * Get conversation history with the agent
     */
    static async getConversationHistory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.userId;
        const { conversationId } = req.query;

        try {
            loggingService.info('Agent conversation history request initiated', {
                userId,
                conversationId: conversationId as string,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Agent conversation history attempted without authentication', {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            // This would integrate with your existing conversation service
            // For now, we'll return a placeholder response
            const duration = Date.now() - startTime;

            loggingService.info('Agent conversation history retrieved', {
                userId,
                conversationId: conversationId as string,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'conversation_history_accessed',
                category: 'data_access',
                value: duration,
                metadata: {
                    userId,
                    conversationId: conversationId as string
                }
            });

            res.json({
                success: true,
                data: {
                    conversationId,
                    messages: [],
                    totalMessages: 0
                },
                message: 'Conversation history integration pending'
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent conversation history retrieval failed', {
                userId,
                conversationId: conversationId as string,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            console.error('Agent conversation history error:', error);
            next(error);
        }
    }

    /**
     * Get suggested queries for the user
     */
    static async getSuggestedQueries(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('Agent suggested queries request initiated', {
                requestId: _req.headers['x-request-id'] as string
            });

            // Generate contextual suggestions based on user's data and new capabilities
            const suggestions = [
                "Create a new AI project for my chatbot",
                "Help me choose the best model for content generation", 
                "Analyze my cost trends for the past month",
                "What are the most expensive API calls in my project?",
                "Compare Claude vs GPT models for my use case",
                "Show me my current projects and their settings",
                "Suggest ways to optimize my prompt costs",
                "Test model integration for my API",
                "What's the most cost-effective model for summarization?",
                "Configure model settings for my content generation project"
            ];

            // Shuffle and take 4 suggestions
            const shuffled = suggestions.sort(() => 0.5 - Math.random());
            
            const duration = Date.now() - startTime;

            loggingService.info('Agent suggested queries generated successfully', {
                duration,
                totalSuggestions: suggestions.length,
                returnedSuggestions: 4,
                requestId: _req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'suggested_queries_generated',
                category: 'user_assistance',
                value: duration,
                metadata: {
                    totalSuggestions: suggestions.length,
                    returnedSuggestions: 4
                }
            });
            
            res.json({
                success: true,
                data: {
                    suggestions: shuffled.slice(0, 4),
                    categories: {
                        projectManagement: [
                            "Create a new AI project",
                            "Show me my current projects",
                            "Update my project settings"
                        ],
                        modelSelection: [
                            "Recommend models for my use case",
                            "Compare different AI models",
                            "Test model integration"
                        ],
                        costOptimization: [
                            "Analyze my spending patterns",
                            "Find cost-saving opportunities",
                            "Optimize my prompt costs"
                        ]
                    },
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent suggested queries generation failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            console.error('Agent suggestions error:', error);
            next(error);
        }
    }

    /**
     * Start conversational project creation wizard
     */
    static async startProjectWizard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.userId;
        const { projectType, quickStart } = req.body;

        try {
            loggingService.info('Agent project wizard initiated', {
                userId,
                projectType,
                quickStart: !!quickStart,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Agent project wizard attempted without authentication', {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            let wizardPrompt = "I'd like to help you create a new AI project! ";
            
            if (quickStart && projectType) {
                wizardPrompt += `I see you want to create a ${projectType} project. `;
            }

            wizardPrompt += "To recommend the best setup for you, I need to understand your requirements better. What type of AI project are you planning to build?";

            // Build agent query
            const agentQuery = {
                userId,
                query: wizardPrompt,
                context: {
                    isProjectWizard: true,
                    projectType: projectType || null
                }
            };

            loggingService.info('Processing project wizard initial query', {
                userId,
                projectType,
                requestId: req.headers['x-request-id'] as string
            });

            // Get agent response
            const result = await agentService.query(agentQuery);

            const duration = Date.now() - startTime;

            loggingService.info('Agent project wizard started successfully', {
                userId,
                projectType,
                success: result.success,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_wizard_started',
                category: 'project_management',
                value: duration,
                metadata: {
                    userId,
                    projectType,
                    quickStart: !!quickStart,
                    success: result.success
                }
            });

            res.json({
                success: true,
                wizard: {
                    step: 1,
                    totalSteps: 4,
                    stepName: 'Project Type',
                    response: result.response,
                    nextQuestions: [
                        "API Integration - Connect AI to your existing systems",
                        "Chatbot - Conversational AI for customer service",
                        "Content Generation - Create articles, marketing copy, etc.",
                        "Data Analysis - Process and analyze data with AI",
                        "Custom - Something specific to your needs"
                    ]
                },
                metadata: result.metadata
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent project wizard start failed', {
                userId,
                projectType,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            console.error('Project wizard error:', error);
            next(error);
        }
    }

    /**
     * Continue project creation wizard conversation
     */
    static async continueProjectWizard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.userId;
        const { response, wizardState } = req.body;

        try {
            loggingService.info('Agent project wizard continuation initiated', {
                userId,
                currentStep: wizardState?.step || 1,
                hasResponse: !!response,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Agent project wizard continuation attempted without authentication', {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            // Build conversational query based on wizard state
            let wizardPrompt = `User response: "${response}". `;
            
            if (wizardState?.step === 1) {
                wizardPrompt += "Great! Now, what's your expected usage volume - will this be handling a few requests per day (low), hundreds per day (medium), or thousands per day (high)?";
            } else if (wizardState?.step === 2) {
                wizardPrompt += "Perfect! What's most important for your project - keeping costs low, maintaining high quality responses, or getting fast response times?";
            } else if (wizardState?.step === 3) {
                wizardPrompt += "Excellent! Do you have any specific requirements, constraints, or preferences I should know about? For example, certain AI providers you prefer, budget limits, or specific features you need?";
            } else if (wizardState?.step === 4) {
                wizardPrompt += "Thanks for all that information! Now I have everything I need to create your project with optimal settings. Let me set this up for you.";
            }

            const agentQuery = {
                userId,
                query: wizardPrompt,
                context: {
                    isProjectWizard: true,
                    wizardState,
                    previousResponses: wizardState?.responses || []
                }
            };

            loggingService.info('Processing project wizard continuation query', {
                userId,
                currentStep: wizardState?.step || 1,
                nextStep: (wizardState?.step || 1) + 1,
                requestId: req.headers['x-request-id'] as string
            });

            const result = await agentService.query(agentQuery);

            const duration = Date.now() - startTime;
            const nextStep = (wizardState?.step || 1) + 1;
            const isComplete = (wizardState?.step || 1) >= 4;

            loggingService.info('Agent project wizard continuation completed', {
                userId,
                currentStep: wizardState?.step || 1,
                nextStep,
                isComplete,
                success: result.success,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: isComplete ? 'project_wizard_completed' : 'project_wizard_step_completed',
                category: 'project_management',
                value: duration,
                metadata: {
                    userId,
                    currentStep: wizardState?.step || 1,
                    nextStep,
                    isComplete,
                    success: result.success
                }
            });

            res.json({
                success: true,
                wizard: {
                    step: nextStep,
                    totalSteps: 4,
                    stepName: this.getWizardStepName(nextStep),
                    response: result.response,
                    isComplete
                },
                metadata: result.metadata
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Agent project wizard continuation failed', {
                userId,
                currentStep: wizardState?.step || 1,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            console.error('Project wizard continuation error:', error);
            next(error);
        }
    }

    private static getWizardStepName(step: number): string {
        const stepNames = {
            1: 'Project Type',
            2: 'Usage Volume', 
            3: 'Priority',
            4: 'Requirements',
            5: 'Complete'
        };
        return stepNames[step as keyof typeof stepNames] || 'Complete';
    }
} 