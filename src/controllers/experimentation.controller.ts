import { Response } from 'express';
import { ExperimentationService } from '../services/experimentation.service';
import { logger } from '../utils/logger';

export class ExperimentationController {

    /**
     * Get available models for experimentation
     * GET /api/experimentation/available-models
     */
    static async getAvailableModels(_req: any, res: Response): Promise<void> {
        try {
            // Get actually available models from AWS Bedrock
            const availableModels = await ExperimentationService.getAccessibleBedrockModels();
            console.log("availableModels", availableModels)
            res.json({
                success: true,
                data: availableModels,
                metadata: {
                    totalModels: availableModels.length,
                    providers: [...new Set(availableModels.map(m => m.provider))],
                    note: 'Only showing models accessible in your AWS account',
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            logger.error('Error fetching available models:', error);
            
            // Fallback to curated safe models if AWS call fails
            const fallbackModels = [
                {
                    provider: 'Amazon',
                    model: 'amazon.nova-micro-v1:0',
                    modelName: 'Nova Micro',
                    pricing: { input: 0.035, output: 0.14, unit: 'Per 1M tokens' },
                    capabilities: ['text'],
                    contextWindow: 128000,
                    category: 'general',
                    isLatest: true,
                    notes: 'Smallest, fastest Nova model - usually accessible'
                },
                {
                    provider: 'Amazon',
                    model: 'amazon.nova-lite-v1:0', 
                    modelName: 'Nova Lite',
                    pricing: { input: 0.6, output: 2.4, unit: 'Per 1M tokens' },
                    capabilities: ['text'],
                    contextWindow: 300000,
                    category: 'general',
                    isLatest: true,
                    notes: 'Balanced performance and cost - recommended for testing'
                },
                {
                    provider: 'Amazon',
                    model: 'amazon.titan-text-express-v1',
                    modelName: 'Titan Text Express',
                    pricing: { input: 0.2, output: 0.6, unit: 'Per 1M tokens' },
                    capabilities: ['text'],
                    contextWindow: 8192,
                    category: 'general',
                    isLatest: true,
                    notes: 'Amazon Titan model - generally accessible'
                }
            ];

            res.json({
                success: true,
                data: fallbackModels,
                metadata: {
                    totalModels: fallbackModels.length,
                    providers: ['Amazon', 'Anthropic'],
                    note: 'Fallback model list (AWS Bedrock API unavailable)',
                    generatedAt: new Date().toISOString()
                }
            });
        }
    }

    /**
     * Get experiment history
     * GET /api/experimentation/history
     */
    static async getExperimentHistory(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const {
                type,
                status,
                startDate,
                endDate,
                limit = 20
            } = req.query;

            const filters = {
                type: type as string,
                status: status as string,
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                limit: parseInt(limit as string, 10)
            };

            const history = await ExperimentationService.getExperimentHistory(userId, filters);

            res.json({
                success: true,
                data: history,
                metadata: {
                    totalExperiments: history.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            logger.error('Error getting experiment history:', error);
            res.status(400).json({
                success: false,
                message: 'Invalid user ID or failed to get experiment history'
            });
        }
    }

    /**
     * Run model comparison experiment
     * POST /api/experimentation/model-comparison
     */
    static async runModelComparison(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const { prompt, models, evaluationCriteria, iterations = 1 } = req.body;

            if (!prompt || !models || !Array.isArray(models) || models.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Prompt and models array are required'
                });
                return;
            }

            const experiment = await ExperimentationService.runModelComparison(userId, {
                prompt,
                models,
                evaluationCriteria,
                iterations
            });

            res.json({
                success: true,
                data: experiment,
                metadata: {
                    experimentId: experiment.id,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            logger.error('Error running model comparison:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to run model comparison'
            });
        }
    }

    /**
     * Get experiment by ID
     * GET /api/experimentation/:experimentId
     */
    static async getExperimentById(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const { experimentId } = req.params;

            const experiment = await ExperimentationService.getExperimentById(experimentId, userId);

            if (!experiment) {
                res.status(404).json({
                    success: false,
                    message: 'Experiment not found'
                });
                return;
            }

            res.json({
                success: true,
                data: experiment
            });
        } catch (error: any) {
            logger.error('Error getting experiment:', error);
            res.status(400).json({
                success: false,
                message: 'Invalid experiment ID or failed to get experiment'
            });
        }
    }

    /**
     * Delete experiment
     * DELETE /api/experimentation/:experimentId
     */
    static async deleteExperiment(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const { experimentId } = req.params;

            await ExperimentationService.deleteExperiment(experimentId, userId);

            res.json({
                success: true,
                message: 'Experiment deleted successfully'
            });
        } catch (error: any) {
            logger.error('Error deleting experiment:', error);
            res.status(400).json({
                success: false,
                message: 'Invalid experiment ID or failed to delete experiment'
            });
        }
    }

    /**
     * Estimate experiment cost
     * POST /api/experimentation/estimate-cost
     */
    static async estimateExperimentCost(req: any, res: Response): Promise<void> {
        try {
            const { type, parameters } = req.body;

            if (!type || !parameters) {
                res.status(400).json({
                    success: false,
                    message: 'Type and parameters are required'
                });
                return;
            }

            const costEstimate = await ExperimentationService.estimateExperimentCost(type, parameters);

            res.json({
                success: true,
                data: costEstimate
            });
        } catch (error: any) {
            logger.error('Error estimating experiment cost:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to estimate experiment cost'
            });
        }
    }

    /**
     * Get experiment recommendations
     * GET /api/experimentation/recommendations/:userId
     */
    static async getExperimentRecommendations(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const recommendations = await ExperimentationService.getExperimentRecommendations(userId);

            res.json({
                success: true,
                data: recommendations,
                metadata: {
                    totalRecommendations: recommendations.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            logger.error('Error getting experiment recommendations:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get experiment recommendations'
            });
        }
    }

    // ============================================================================
    // WHAT-IF SCENARIOS METHODS
    // ============================================================================

    /**
     * Get all what-if scenarios for user
     * GET /api/experimentation/what-if-scenarios
     */
    static async getWhatIfScenarios(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            const scenarios = await ExperimentationService.getWhatIfScenarios(userId);

            res.json({
                success: true,
                data: scenarios,
                metadata: {
                    totalScenarios: scenarios.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            logger.error('Error getting what-if scenarios:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get what-if scenarios'
            });
        }
    }

    /**
     * Create new what-if scenario
     * POST /api/experimentation/what-if-scenarios
     */
    static async createWhatIfScenario(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            const scenarioData = req.body;
            
            const scenario = await ExperimentationService.createWhatIfScenario(userId, scenarioData);

            res.status(201).json({
                success: true,
                data: scenario,
                message: 'What-if scenario created successfully'
            });
        } catch (error: any) {
            logger.error('Error creating what-if scenario:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create what-if scenario'
            });
        }
    }

    /**
     * Run what-if analysis
     * POST /api/experimentation/what-if-scenarios/:scenarioName/analyze
     */
    static async runWhatIfAnalysis(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            const { scenarioName } = req.params;
            
            const analysis = await ExperimentationService.runWhatIfAnalysis(userId, scenarioName);

            res.json({
                success: true,
                data: analysis,
                message: 'What-if analysis completed successfully'
            });
        } catch (error: any) {
            logger.error('Error running what-if analysis:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to run what-if analysis'
            });
        }
    }

    /**
     * Real-time What-If Cost Simulator
     * POST /api/experimentation/real-time-simulation
     */
    static async runRealTimeSimulation(req: any, res: Response): Promise<void> {
        try {
            const simulationRequest = req.body;

            // Validate request
            if (!simulationRequest.simulationType) {
                res.status(400).json({
                    success: false,
                    message: 'Simulation type is required'
                });
                return;
            }

            // For prompt-level simulations, ensure prompt and model are provided
            if (['prompt_optimization', 'context_trimming', 'real_time_analysis'].includes(simulationRequest.simulationType)) {
                if (!simulationRequest.prompt || !simulationRequest.currentModel) {
                    res.status(400).json({
                        success: false,
                        message: 'Prompt and current model are required for prompt-level simulations'
                    });
                    return;
                }
            }

            const simulation = await ExperimentationService.runRealTimeWhatIfSimulation(simulationRequest);

            res.json({
                success: true,
                data: simulation,
                message: 'Real-time simulation completed successfully'
            });

        } catch (error) {
            logger.error('Error running real-time simulation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to run real-time simulation'
            });
        }
    }

    /**
     * Delete what-if scenario
     * DELETE /api/experimentation/what-if-scenarios/:scenarioName
     */
    static async deleteWhatIfScenario(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            const { scenarioName } = req.params;
            
            await ExperimentationService.deleteWhatIfScenario(userId, scenarioName);

            res.json({
                success: true,
                message: 'What-if scenario deleted successfully'
            });
        } catch (error: any) {
            logger.error('Error deleting what-if scenario:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete what-if scenario'
            });
        }
    }

    /**
     * Start real-time model comparison with Bedrock execution
     * POST /api/experimentation/real-time-comparison
     */
    static async startRealTimeComparison(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const { 
                prompt, 
                models, 
                evaluationCriteria, 
                iterations = 1,
                executeOnBedrock = true,
                evaluationPrompt,
                comparisonMode = 'comprehensive'
            } = req.body;

            if (!prompt || !models || !Array.isArray(models) || models.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Prompt and models array are required'
                });
                return;
            }

            // Generate session ID for tracking progress
            const sessionId = `comparison_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const request = {
                sessionId,
                prompt,
                models,
                evaluationCriteria: evaluationCriteria || ['accuracy', 'relevance', 'completeness'],
                iterations,
                executeOnBedrock,
                evaluationPrompt,
                comparisonMode
            };

            // Start the comparison asynchronously
            ExperimentationService.runRealTimeModelComparison(userId, request)
                .catch((error: any) => {
                    logger.error('Real-time comparison failed:', error);
                });

            res.json({
                success: true,
                data: {
                    sessionId,
                    message: 'Real-time model comparison started. Connect to SSE endpoint for progress updates.',
                    estimatedDuration: models.length * 10 // seconds
                }
            });

        } catch (error: any) {
            logger.error('Error starting real-time comparison:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to start real-time comparison'
            });
        }
    }

    /**
     * SSE endpoint for real-time model comparison progress
     * GET /api/experimentation/comparison-progress/:sessionId
     */
    static async streamComparisonProgress(req: any, res: Response): Promise<void> {
        try {
            const { sessionId } = req.params;
            
            if (!sessionId) {
                res.status(400).json({ message: 'Session ID is required' });
                return;
            }

            // Validate session instead of requiring auth token
            const sessionValidation = ExperimentationService.validateSession(sessionId);
            if (!sessionValidation.isValid) {
                logger.warn(`Invalid session attempt: ${sessionId}`);
                res.writeHead(401, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify({ message: 'Invalid or expired session' }));
                return;
            }

            logger.info(`SSE connection established for session: ${sessionId}`);

            // Set SSE headers
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control',
            });

            // Send initial connection confirmation
            res.write(`data: ${JSON.stringify({
                type: 'connection',
                sessionId,
                message: 'Connected to progress stream'
            })}\n\n`);

            // Get progress emitter from service
            const progressEmitter = ExperimentationService.getProgressEmitter();

            // Listen for progress updates
            const progressHandler = (progressData: any) => {
                if (progressData.sessionId === sessionId) {
                    res.write(`data: ${JSON.stringify({
                        type: 'progress',
                        ...progressData
                    })}\n\n`);

                    // Close connection when completed or failed
                    if (progressData.stage === 'completed' || progressData.stage === 'failed') {
                        res.write(`data: ${JSON.stringify({
                            type: 'close',
                            message: 'Comparison finished'
                        })}\n\n`);
                        res.end();
                    }
                }
            };

            progressEmitter.on('progress', progressHandler);

            // Handle client disconnect
            req.on('close', () => {
                progressEmitter.off('progress', progressHandler);
                logger.info(`SSE connection closed for session: ${sessionId}`);
            });

            // Keep-alive heartbeat
            const heartbeat = setInterval(() => {
                res.write(`data: ${JSON.stringify({
                    type: 'heartbeat',
                    timestamp: new Date().toISOString()
                })}\n\n`);
            }, 30000); // Every 30 seconds

            req.on('close', () => {
                clearInterval(heartbeat);
            });

        } catch (error: any) {
            logger.error('Error in SSE stream:', error);
            res.status(500).json({ message: 'SSE stream error' });
        }
    }
} 