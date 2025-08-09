import { Request, Response, NextFunction } from 'express';
import { agentService, AgentQuery } from '../services/agent.service';
import { validationResult } from 'express-validator';

interface AuthenticatedRequest extends Request {
    userId?: string;
}

export class AgentController {
    /**
     * Handle agent queries from users
     */
    static async query(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            // Check validation errors
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: errors.array()
                });
                return;
            }

            const { query, context } = req.body;
            const userId = req.userId;

            if (!userId) {
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

            // Execute agent query
            const result = await agentService.query(agentQuery);

            res.status(result.success ? 200 : 500).json(result);

        } catch (error) {
            console.error('Agent query error:', error);
            next(error);
        }
    }

    /**
     * Stream agent response for real-time interaction
     */
    static async streamQuery(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { query, context } = req.body;
            const userId = req.userId;

            if (!userId) {
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

                // Execute agent query
                const result = await agentService.query(agentQuery);

                // Send final result
                res.write(`data: ${JSON.stringify({ 
                    type: 'result', 
                    data: result 
                })}\n\n`);

            } catch (error) {
                res.write(`data: ${JSON.stringify({ 
                    type: 'error', 
                    error: error instanceof Error ? error.message : 'Unknown error' 
                })}\n\n`);
            }

            // End the stream
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();

        } catch (error) {
            console.error('Agent stream error:', error);
            next(error);
        }
    }

    /**
     * Get agent status and statistics
     */
    static async getStatus(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const status = agentService.getStatus();
            res.json({
                success: true,
                data: status
            });
        } catch (error) {
            console.error('Agent status error:', error);
            next(error);
        }
    }

    /**
     * Initialize agent (for admin use)
     */
    static async initialize(_req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            // Check if user has admin rights (you might want to add this check)
            await agentService.initialize();
            
            res.json({
                success: true,
                message: 'Agent initialized successfully'
            });
        } catch (error) {
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
        try {
            const { insight, metadata, rating } = req.body;
            const userId = req.userId;

            if (!insight) {
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

            res.json({
                success: true,
                message: 'Feedback added successfully'
            });

        } catch (error) {
            console.error('Agent feedback error:', error);
            next(error);
        }
    }

    /**
     * Get conversation history with the agent
     */
    static async getConversationHistory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.userId;
            const { conversationId } = req.query;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            // This would integrate with your existing conversation service
            // For now, we'll return a placeholder response
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
            console.error('Agent conversation history error:', error);
            next(error);
        }
    }

    /**
     * Get suggested queries for the user
     */
    static async getSuggestedQueries(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
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
            console.error('Agent suggestions error:', error);
            next(error);
        }
    }

    /**
     * Start conversational project creation wizard
     */
    static async startProjectWizard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.userId;
            const { projectType, quickStart } = req.body;

            if (!userId) {
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

            // Get agent response
            const result = await agentService.query(agentQuery);

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
            console.error('Project wizard error:', error);
            next(error);
        }
    }

    /**
     * Continue project creation wizard conversation
     */
    static async continueProjectWizard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.userId;
            const { response, wizardState } = req.body;

            if (!userId) {
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

            const result = await agentService.query(agentQuery);

            res.json({
                success: true,
                wizard: {
                    step: (wizardState?.step || 1) + 1,
                    totalSteps: 4,
                    stepName: this.getWizardStepName((wizardState?.step || 1) + 1),
                    response: result.response,
                    isComplete: (wizardState?.step || 1) >= 4
                },
                metadata: result.metadata
            });

        } catch (error) {
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