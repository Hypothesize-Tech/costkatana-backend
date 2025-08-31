import { Response } from 'express';
import { ExperimentationService } from '../services/experimentation.service';
import { loggingService } from '../services/logging.service';

export class ExperimentationController {

    /**
     * Get available models for experimentation
     * GET /api/experimentation/available-models
     */
    static async getAvailableModels(_req: any, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('Available models retrieval initiated', {
                requestId: _req.headers['x-request-id'] as string
            });

            // Get actually available models from AWS Bedrock
            const availableModels = await ExperimentationService.getAccessibleBedrockModels();
            
            const duration = Date.now() - startTime;

            loggingService.info('Available models retrieved successfully from AWS Bedrock', {
                duration,
                totalModels: availableModels.length,
                providers: [...new Set(availableModels.map(m => m.provider))],
                requestId: _req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_available_models_retrieved',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    totalModels: availableModels.length,
                    providers: [...new Set(availableModels.map(m => m.provider))],
                    source: 'aws_bedrock'
                }
            });

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
            const duration = Date.now() - startTime;
            
            loggingService.error('Available models retrieval failed - falling back to curated models', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });
            
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

            loggingService.info('Fallback models provided due to AWS Bedrock API unavailability', {
                fallbackModelsCount: fallbackModels.length,
                requestId: _req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('Experiment history retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Experiment history retrieval failed - user not authenticated', {
                    requestId: req.headers['x-request-id'] as string
                });

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

            loggingService.info('Experiment history retrieval processing started', {
                userId,
                filters,
                requestId: req.headers['x-request-id'] as string
            });

            const history = await ExperimentationService.getExperimentHistory(userId, filters);

            const duration = Date.now() - startTime;

            loggingService.info('Experiment history retrieved successfully', {
                userId,
                duration,
                totalExperiments: history.length,
                hasFilters: !!type || !!status || !!startDate || !!endDate,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_history_retrieved',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    totalExperiments: history.length,
                    hasFilters: !!type || !!status || !!startDate || !!endDate
                }
            });

            res.json({
                success: true,
                data: history,
                metadata: {
                    totalExperiments: history.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Experiment history retrieval failed', {
                userId,
                filters: req.query,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const { prompt, models, evaluationCriteria, iterations = 1 } = req.body;

        try {
            loggingService.info('Model comparison experiment initiated', {
                userId,
                hasUserId: !!userId,
                hasPrompt: !!prompt,
                modelsCount: models?.length || 0,
                evaluationCriteria,
                iterations,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Model comparison experiment failed - user not authenticated', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            if (!prompt || !models || !Array.isArray(models) || models.length === 0) {
                loggingService.warn('Model comparison experiment failed - missing required fields', {
                    userId,
                    hasPrompt: !!prompt,
                    hasModels: !!models,
                    isModelsArray: Array.isArray(models),
                    modelsLength: models?.length || 0,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Prompt and models array are required'
                });
                return;
            }

            loggingService.info('Model comparison experiment processing started', {
                userId,
                promptLength: prompt.length,
                models,
                evaluationCriteria,
                iterations,
                requestId: req.headers['x-request-id'] as string
            });

            const experiment = await ExperimentationService.runModelComparison(userId, {
                prompt,
                models,
                evaluationCriteria,
                iterations
            });

            const duration = Date.now() - startTime;

            loggingService.info('Model comparison experiment completed successfully', {
                userId,
                experimentId: experiment.id,
                duration,
                promptLength: prompt.length,
                modelsCount: models.length,
                iterations,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_model_comparison_completed',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    experimentId: experiment.id,
                    promptLength: prompt.length,
                    modelsCount: models.length,
                    evaluationCriteria,
                    iterations
                }
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Model comparison experiment failed', {
                userId,
                hasPrompt: !!prompt,
                modelsCount: models?.length || 0,
                evaluationCriteria,
                iterations,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const { experimentId } = req.params;

        try {
            loggingService.info('Specific experiment retrieval initiated', {
                userId,
                hasUserId: !!userId,
                experimentId,
                hasExperimentId: !!experimentId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Specific experiment retrieval failed - user not authenticated', {
                    experimentId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Specific experiment retrieval processing started', {
                userId,
                experimentId,
                requestId: req.headers['x-request-id'] as string
            });

            const experiment = await ExperimentationService.getExperimentById(experimentId, userId);

            if (!experiment) {
                loggingService.warn('Specific experiment not found', {
                    userId,
                    experimentId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    message: 'Experiment not found'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Specific experiment retrieved successfully', {
                userId,
                experimentId,
                duration,
                hasExperiment: !!experiment,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_specific_experiment_retrieved',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    experimentId,
                    hasExperiment: !!experiment
                }
            });

            res.json({
                success: true,
                data: experiment
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Specific experiment retrieval failed', {
                userId,
                experimentId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const { experimentId } = req.params;

        try {
            loggingService.info('Experiment deletion initiated', {
                userId,
                hasUserId: !!userId,
                experimentId,
                hasExperimentId: !!experimentId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Experiment deletion failed - user not authenticated', {
                    experimentId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Experiment deletion processing started', {
                userId,
                experimentId,
                requestId: req.headers['x-request-id'] as string
            });

            await ExperimentationService.deleteExperiment(experimentId, userId);

            const duration = Date.now() - startTime;

            loggingService.info('Experiment deleted successfully', {
                userId,
                experimentId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_experiment_deleted',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    experimentId
                }
            });

            res.json({
                success: true,
                message: 'Experiment deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Experiment deletion failed', {
                userId,
                experimentId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const { type, parameters } = req.body;

        try {
            loggingService.info('Experiment cost estimation initiated', {
                type,
                hasParameters: !!parameters,
                parametersKeys: parameters ? Object.keys(parameters) : [],
                requestId: req.headers['x-request-id'] as string
            });

            if (!type || !parameters) {
                loggingService.warn('Experiment cost estimation failed - missing required fields', {
                    hasType: !!type,
                    hasParameters: !!parameters,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Type and parameters are required'
                });
                return;
            }

            loggingService.info('Experiment cost estimation processing started', {
                type,
                parametersKeys: Object.keys(parameters),
                requestId: req.headers['x-request-id'] as string
            });

            const costEstimate = await ExperimentationService.estimateExperimentCost(type, parameters);

            const duration = Date.now() - startTime;

            loggingService.info('Experiment cost estimation completed successfully', {
                type,
                duration,
                hasCostEstimate: !!costEstimate,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_cost_estimated',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    type,
                    parametersKeys: Object.keys(parameters),
                    hasCostEstimate: !!costEstimate
                }
            });

            res.json({
                success: true,
                data: costEstimate
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Experiment cost estimation failed', {
                type,
                hasParameters: !!parameters,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('Experiment recommendations retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Experiment recommendations retrieval failed - user not authenticated', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Experiment recommendations retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const recommendations = await ExperimentationService.getExperimentRecommendations(userId);

            const duration = Date.now() - startTime;

            loggingService.info('Experiment recommendations retrieved successfully', {
                userId,
                duration,
                totalRecommendations: recommendations.length,
                hasRecommendations: !!recommendations && recommendations.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_recommendations_retrieved',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    totalRecommendations: recommendations.length,
                    hasRecommendations: !!recommendations && recommendations.length > 0
                }
            });

            res.json({
                success: true,
                data: recommendations,
                metadata: {
                    totalRecommendations: recommendations.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Experiment recommendations retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('What-if scenarios retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            const scenarios = await ExperimentationService.getWhatIfScenarios(userId);

            const duration = Date.now() - startTime;

            loggingService.info('What-if scenarios retrieved successfully', {
                userId,
                duration,
                totalScenarios: scenarios.length,
                hasScenarios: !!scenarios && scenarios.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_what_if_scenarios_retrieved',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    totalScenarios: scenarios.length,
                    hasScenarios: !!scenarios && scenarios.length > 0
                }
            });

            res.json({
                success: true,
                data: scenarios,
                metadata: {
                    totalScenarios: scenarios.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('What-if scenarios retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const scenarioData = req.body;

        try {
            loggingService.info('What-if scenario creation initiated', {
                userId,
                hasUserId: !!userId,
                hasScenarioData: !!scenarioData,
                scenarioDataType: scenarioData?.type,
                scenarioDataName: scenarioData?.name,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('What-if scenario creation processing started', {
                userId,
                scenarioDataType: scenarioData?.type,
                scenarioDataName: scenarioData?.name,
                scenarioDataKeys: scenarioData ? Object.keys(scenarioData) : [],
                requestId: req.headers['x-request-id'] as string
            });
            
            const scenario = await ExperimentationService.createWhatIfScenario(userId, scenarioData);

            const duration = Date.now() - startTime;

            loggingService.info('What-if scenario created successfully', {
                userId,
                scenarioId: scenario.id || scenario._id,
                scenarioName: scenario.name,
                duration,
                hasScenario: !!scenario,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_what_if_scenario_created',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    scenarioId: scenario.id || scenario._id,
                    scenarioName: scenario.name,
                    scenarioType: scenario.type,
                    hasScenario: !!scenario
                }
            });

            res.status(201).json({
                success: true,
                data: scenario,
                message: 'What-if scenario created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('What-if scenario creation failed', {
                userId,
                hasScenarioData: !!scenarioData,
                scenarioDataType: scenarioData?.type,
                scenarioDataName: scenarioData?.name,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const { scenarioName } = req.params;

        try {
            loggingService.info('What-if analysis initiated', {
                userId,
                hasUserId: !!userId,
                scenarioName,
                hasScenarioName: !!scenarioName,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('What-if analysis processing started', {
                userId,
                scenarioName,
                requestId: req.headers['x-request-id'] as string
            });
            
            const analysis = await ExperimentationService.runWhatIfAnalysis(userId, scenarioName);

            const duration = Date.now() - startTime;

            loggingService.info('What-if analysis completed successfully', {
                userId,
                scenarioName,
                duration,
                hasAnalysis: !!analysis,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_what_if_analysis_completed',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    scenarioName,
                    hasAnalysis: !!analysis
                }
            });

            res.json({
                success: true,
                data: analysis,
                message: 'What-if analysis completed successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('What-if analysis failed', {
                userId,
                scenarioName,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const simulationRequest = req.body;

        try {
            loggingService.info('Real-time simulation initiated', {
                simulationType: simulationRequest.simulationType,
                hasSimulationType: !!simulationRequest.simulationType,
                hasPrompt: !!simulationRequest.prompt,
                hasCurrentModel: !!simulationRequest.currentModel,
                requestId: req.headers['x-request-id'] as string
            });

            // Validate request
            if (!simulationRequest.simulationType) {
                loggingService.warn('Real-time simulation failed - missing simulation type', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Simulation type is required'
                });
                return;
            }

            // For prompt-level simulations, ensure prompt and model are provided
            if (['prompt_optimization', 'context_trimming', 'real_time_analysis'].includes(simulationRequest.simulationType)) {
                if (!simulationRequest.prompt || !simulationRequest.currentModel) {
                    loggingService.warn('Real-time simulation failed - missing prompt or model for prompt-level simulation', {
                        simulationType: simulationRequest.simulationType,
                        hasPrompt: !!simulationRequest.prompt,
                        hasCurrentModel: !!simulationRequest.currentModel,
                        requestId: req.headers['x-request-id'] as string
                    });

                    res.status(400).json({
                        success: false,
                        message: 'Prompt and current model are required for prompt-level simulations'
                    });
                    return;
                }
            }

            loggingService.info('Real-time simulation processing started', {
                simulationType: simulationRequest.simulationType,
                hasPrompt: !!simulationRequest.prompt,
                hasCurrentModel: !!simulationRequest.currentModel,
                requestId: req.headers['x-request-id'] as string
            });

            const simulation = await ExperimentationService.runRealTimeWhatIfSimulation(simulationRequest);

            const duration = Date.now() - startTime;

            loggingService.info('Real-time simulation completed successfully', {
                simulationType: simulationRequest.simulationType,
                duration,
                hasSimulation: !!simulation,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_real_time_simulation_completed',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    simulationType: simulationRequest.simulationType,
                    hasPrompt: !!simulationRequest.prompt,
                    hasCurrentModel: !!simulationRequest.currentModel,
                    hasSimulation: !!simulation
                }
            });

            res.json({
                success: true,
                data: simulation,
                message: 'Real-time simulation completed successfully'
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Real-time simulation failed', {
                simulationType: simulationRequest.simulationType,
                hasPrompt: !!simulationRequest.prompt,
                hasCurrentModel: !!simulationRequest.currentModel,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const { scenarioName } = req.params;

        try {
            loggingService.info('What-if scenario deletion initiated', {
                userId,
                hasUserId: !!userId,
                scenarioName,
                hasScenarioName: !!scenarioName,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('What-if scenario deletion processing started', {
                userId,
                scenarioName,
                requestId: req.headers['x-request-id'] as string
            });
            
            await ExperimentationService.deleteWhatIfScenario(userId, scenarioName);

            const duration = Date.now() - startTime;

            loggingService.info('What-if scenario deleted successfully', {
                userId,
                scenarioName,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_what_if_scenario_deleted',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    scenarioName
                }
            });

            res.json({
                success: true,
                message: 'What-if scenario deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('What-if scenario deletion failed', {
                userId,
                scenarioName,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const { 
            prompt, 
            models, 
            evaluationCriteria, 
            iterations = 1,
            executeOnBedrock = true,
            evaluationPrompt,
            comparisonMode = 'comprehensive'
        } = req.body;

        try {
            loggingService.info('Real-time model comparison initiated', {
                userId,
                hasUserId: !!userId,
                hasPrompt: !!prompt,
                modelsCount: models?.length || 0,
                evaluationCriteria,
                iterations,
                executeOnBedrock,
                comparisonMode,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Real-time model comparison failed - user not authenticated', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            if (!prompt || !models || !Array.isArray(models) || models.length === 0) {
                loggingService.warn('Real-time model comparison failed - missing required fields', {
                    userId,
                    hasPrompt: !!prompt,
                    hasModels: !!models,
                    isModelsArray: Array.isArray(models),
                    modelsLength: models?.length || 0,
                    requestId: req.headers['x-request-id'] as string
                });

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

            loggingService.info('Real-time model comparison processing started', {
                userId,
                sessionId,
                promptLength: prompt.length,
                models,
                evaluationCriteria: request.evaluationCriteria,
                iterations,
                executeOnBedrock,
                comparisonMode,
                requestId: req.headers['x-request-id'] as string
            });

            // Start the comparison asynchronously
            ExperimentationService.runRealTimeModelComparison(userId, request)
                .catch((error: any) => {
                    loggingService.error('Real-time comparison failed', {
                        userId,
                        sessionId,
                        error: error.message || 'Unknown error',
                        stack: error.stack,
                        requestId: req.headers['x-request-id'] as string
                    });
                });

            const duration = Date.now() - startTime;

            loggingService.info('Real-time model comparison started successfully', {
                userId,
                sessionId,
                duration,
                promptLength: prompt.length,
                modelsCount: models.length,
                iterations,
                executeOnBedrock,
                comparisonMode,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_real_time_comparison_started',
                category: 'experimentation_operations',
                value: duration,
                metadata: {
                    userId,
                    sessionId,
                    promptLength: prompt.length,
                    modelsCount: models.length,
                    evaluationCriteria: request.evaluationCriteria,
                    iterations,
                    executeOnBedrock,
                    comparisonMode
                }
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Real-time model comparison failed', {
                userId,
                hasPrompt: !!prompt,
                modelsCount: models?.length || 0,
                evaluationCriteria,
                iterations,
                executeOnBedrock,
                comparisonMode,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const { sessionId } = req.params;

        try {
            loggingService.info('SSE connection initiated for comparison progress', {
                sessionId,
                hasSessionId: !!sessionId,
                requestId: req.headers['x-request-id'] as string
            });
            
            if (!sessionId) {
                loggingService.warn('SSE connection failed - missing session ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({ message: 'Session ID is required' });
                return;
            }

            // Validate session instead of requiring auth token
            const sessionValidation = ExperimentationService.validateSession(sessionId);
            if (!sessionValidation.isValid) {
                loggingService.warn('SSE connection failed - invalid session', {
                    sessionId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.writeHead(401, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify({ message: 'Invalid or expired session' }));
                return;
            }

            loggingService.info('SSE connection established for comparison progress', {
                sessionId,
                duration: Date.now() - startTime,
                requestId: req.headers['x-request-id'] as string
            });

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
                loggingService.info('SSE connection closed for comparison progress', {
                    sessionId,
                    requestId: req.headers['x-request-id'] as string
                });
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
            const duration = Date.now() - startTime;
            
            loggingService.error('SSE stream error for comparison progress', {
                sessionId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({ message: 'SSE stream error' });
        }
    }
} 