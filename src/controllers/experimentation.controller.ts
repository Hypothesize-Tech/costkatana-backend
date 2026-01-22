import { Response } from 'express';
import { ExperimentationService } from '../services/experimentation.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class ExperimentationController {

    /**
     * Get available models for experimentation
     * GET /api/experimentation/available-models
     */
    static async getAvailableModels(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            // Log request start (no auth required for this public endpoint)
            ControllerHelper.logRequestStart('Available models', req);

            // Get actually available models from AWS Bedrock
            const availableModels = await ExperimentationService.getAccessibleBedrockModels();

            // Log success
            ControllerHelper.logRequestSuccess('Available models', req, startTime, {
                totalModels: availableModels.length,
                providers: [...new Set(availableModels.map(m => m.provider))]
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_available_models_retrieved',
                category: 'experimentation_operations',
                value: Date.now() - startTime,
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
            // Fallback to curated models if AWS call fails
            
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
                requestId: req.headers['x-request-id'] as string
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
    static async getExperimentHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

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

            // Log request start
            ControllerHelper.logRequestStart('Experiment history', req, { filters });

            const history = await ExperimentationService.getExperimentHistory(userId, filters);

            // Log success
            ControllerHelper.logRequestSuccess('Experiment history', req, startTime, {
                totalExperiments: history.length,
                hasFilters: !!type || !!status || !!startDate || !!endDate
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_history_retrieved',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                {
                    totalExperiments: history.length,
                    hasFilters: !!type || !!status || !!startDate || !!endDate
                }
            );

            res.json({
                success: true,
                data: history,
                metadata: {
                    totalExperiments: history.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('Experiment history retrieval', error, req, res, startTime, {
                filters: req.query
            });
        }
    }

    /**
     * Run model comparison experiment
     * POST /api/experimentation/model-comparison
     */
    static async runModelComparison(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { prompt, models, evaluationCriteria, iterations = 1 } = req.body;

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            if (!prompt || !models || !Array.isArray(models) || models.length === 0) {
                ControllerHelper.sendError(res, 400, 'Prompt and models array are required');
                return;
            }

            // Log request start
            ControllerHelper.logRequestStart('Model comparison experiment', req, {
                promptLength: prompt.length,
                modelsCount: models.length,
                evaluationCriteria,
                iterations
            });

            const experiment = await ExperimentationService.runModelComparison(userId, {
                prompt,
                models,
                evaluationCriteria,
                iterations
            });

            // Log success
            ControllerHelper.logRequestSuccess('Model comparison experiment', req, startTime, {
                experimentId: experiment.id,
                promptLength: prompt.length,
                modelsCount: models.length,
                iterations
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_model_comparison_completed',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                {
                    experimentId: experiment.id,
                    promptLength: prompt.length,
                    modelsCount: models.length,
                    evaluationCriteria,
                    iterations
                }
            );

            res.json({
                success: true,
                data: experiment,
                metadata: {
                    experimentId: experiment.id,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('Model comparison experiment', error, req, res, startTime, {
                hasPrompt: !!prompt,
                modelsCount: models?.length || 0,
                evaluationCriteria,
                iterations
            });
        }
    }

    /**
     * Get experiment by ID
     * GET /api/experimentation/:experimentId
     */
    static async getExperimentById(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { experimentId } = req.params;

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            // Validate ObjectId
            ServiceHelper.validateObjectId(experimentId, 'experimentId');

            // Log request start
            ControllerHelper.logRequestStart('Get experiment by ID', req, { experimentId });

            const experiment = await ExperimentationService.getExperimentById(experimentId, userId);

            if (!experiment) {
                ControllerHelper.sendError(res, 404, 'Experiment not found');
                return;
            }

            // Log success
            ControllerHelper.logRequestSuccess('Get experiment by ID', req, startTime, {
                experimentId
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_specific_experiment_retrieved',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                { experimentId }
            );

            ControllerHelper.sendSuccess(res, experiment);
        } catch (error: any) {
            ControllerHelper.handleError('Get experiment by ID', error, req, res, startTime, {
                experimentId
            });
        }
    }

    /**
     * Delete experiment
     * DELETE /api/experimentation/:experimentId
     */
    static async deleteExperiment(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { experimentId } = req.params;

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            // Validate ObjectId
            ServiceHelper.validateObjectId(experimentId, 'experimentId');

            // Log request start
            ControllerHelper.logRequestStart('Experiment deletion', req, { experimentId });

            await ExperimentationService.deleteExperiment(experimentId, userId);

            // Log success
            ControllerHelper.logRequestSuccess('Experiment deletion', req, startTime, {
                experimentId
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_experiment_deleted',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                { experimentId }
            );

            ControllerHelper.sendSuccess(res, null, 'Experiment deleted successfully');
        } catch (error: any) {
            ControllerHelper.handleError('Experiment deletion', error, req, res, startTime, {
                experimentId
            });
        }
    }

    /**
     * Estimate experiment cost
     * POST /api/experimentation/estimate-cost
     */
    static async estimateExperimentCost(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { type, parameters } = req.body;

        try {
            // Log request start (no auth required for this endpoint)
            ControllerHelper.logRequestStart('Experiment cost estimation', req, {
                type,
                parametersKeys: parameters ? Object.keys(parameters) : []
            });

            if (!type || !parameters) {
                ControllerHelper.sendError(res, 400, 'Type and parameters are required');
                return;
            }

            const costEstimate = await ExperimentationService.estimateExperimentCost(type, parameters);

            // Log success
            ControllerHelper.logRequestSuccess('Experiment cost estimation', req, startTime, {
                type,
                hasCostEstimate: !!costEstimate
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_cost_estimated',
                category: 'experimentation_operations',
                value: Date.now() - startTime,
                metadata: {
                    type,
                    parametersKeys: Object.keys(parameters),
                    hasCostEstimate: !!costEstimate
                }
            });

            ControllerHelper.sendSuccess(res, costEstimate);
        } catch (error: any) {
            ControllerHelper.handleError('Experiment cost estimation', error, req, res, startTime, {
                type,
                hasParameters: !!parameters
            });
        }
    }

    /**
     * Get experiment recommendations
     * GET /api/experimentation/recommendations/:userId
     */
    static async getExperimentRecommendations(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            // Log request start
            ControllerHelper.logRequestStart('Experiment recommendations', req);

            const recommendations = await ExperimentationService.getExperimentRecommendations(userId);

            // Log success
            ControllerHelper.logRequestSuccess('Experiment recommendations', req, startTime, {
                totalRecommendations: recommendations.length
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_recommendations_retrieved',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                {
                    totalRecommendations: recommendations.length
                }
            );

            res.json({
                success: true,
                data: recommendations,
                metadata: {
                    totalRecommendations: recommendations.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('Experiment recommendations retrieval', error, req, res, startTime);
        }
    }

    // ============================================================================
    // WHAT-IF SCENARIOS METHODS
    // ============================================================================

    /**
     * Get all what-if scenarios for user
     * GET /api/experimentation/what-if-scenarios
     */
    static async getWhatIfScenarios(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            // Log request start
            ControllerHelper.logRequestStart('What-if scenarios', req);

            const scenarios = await ExperimentationService.getWhatIfScenarios(userId);

            // Log success
            ControllerHelper.logRequestSuccess('What-if scenarios', req, startTime, {
                totalScenarios: scenarios.length
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_what_if_scenarios_retrieved',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                {
                    totalScenarios: scenarios.length
                }
            );

            res.json({
                success: true,
                data: scenarios,
                metadata: {
                    totalScenarios: scenarios.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('What-if scenarios retrieval', error, req, res, startTime);
        }
    }

    /**
     * Create new what-if scenario
     * POST /api/experimentation/what-if-scenarios
     */
    static async createWhatIfScenario(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const scenarioData = req.body;

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            // Log request start
            ControllerHelper.logRequestStart('What-if scenario creation', req, {
                scenarioDataType: scenarioData?.type,
                scenarioDataName: scenarioData?.name
            });
            
            const scenario = await ExperimentationService.createWhatIfScenario(userId, scenarioData);

            // Log success
            ControllerHelper.logRequestSuccess('What-if scenario creation', req, startTime, {
                scenarioId: scenario.id || scenario._id,
                scenarioName: scenario.name,
                scenarioType: scenario.type
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_what_if_scenario_created',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                {
                    scenarioId: scenario.id || scenario._id,
                    scenarioName: scenario.name,
                    scenarioType: scenario.type
                }
            );

            res.status(201).json({
                success: true,
                data: scenario,
                message: 'What-if scenario created successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('What-if scenario creation', error, req, res, startTime, {
                scenarioDataType: scenarioData?.type,
                scenarioDataName: scenarioData?.name
            });
        }
    }

    /**
     * Run what-if analysis
     * POST /api/experimentation/what-if-scenarios/:scenarioName/analyze
     */
    static async runWhatIfAnalysis(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { scenarioName } = req.params;

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            // Log request start
            ControllerHelper.logRequestStart('What-if analysis', req, { scenarioName });
            
            const analysis = await ExperimentationService.runWhatIfAnalysis(userId, scenarioName);

            // Log success
            ControllerHelper.logRequestSuccess('What-if analysis', req, startTime, {
                scenarioName,
                hasAnalysis: !!analysis
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_what_if_analysis_completed',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                {
                    scenarioName,
                    hasAnalysis: !!analysis
                }
            );

            res.json({
                success: true,
                data: analysis,
                message: 'What-if analysis completed successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('What-if analysis', error, req, res, startTime, {
                scenarioName
            });
        }
    }

    /**
     * Real-time What-If Cost Simulator
     * POST /api/experimentation/real-time-simulation
     */
    static async runRealTimeSimulation(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const simulationRequest = req.body;

        try {
            // Log request start (no auth required for this endpoint)
            ControllerHelper.logRequestStart('Real-time simulation', req, {
                simulationType: simulationRequest.simulationType
            });

            // Validate request
            if (!simulationRequest.simulationType) {
                ControllerHelper.sendError(res, 400, 'Simulation type is required');
                return;
            }

            // For prompt-level simulations, ensure prompt and model are provided
            if (['prompt_optimization', 'context_trimming', 'real_time_analysis'].includes(simulationRequest.simulationType)) {
                if (!simulationRequest.prompt || !simulationRequest.currentModel) {
                    ControllerHelper.sendError(res, 400, 'Prompt and current model are required for prompt-level simulations');
                    return;
                }
            }

            const simulation = await ExperimentationService.runRealTimeWhatIfSimulation(simulationRequest);

            // Log success
            ControllerHelper.logRequestSuccess('Real-time simulation', req, startTime, {
                simulationType: simulationRequest.simulationType,
                hasSimulation: !!simulation
            });

            // Log business event
            loggingService.logBusiness({
                event: 'experimentation_real_time_simulation_completed',
                category: 'experimentation_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('Real-time simulation', error, req, res, startTime, {
                simulationType: simulationRequest.simulationType
            });
        }
    }

    /**
     * Delete what-if scenario
     * DELETE /api/experimentation/what-if-scenarios/:scenarioName
     */
    static async deleteWhatIfScenario(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { scenarioName } = req.params;

        try {
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            // Log request start
            ControllerHelper.logRequestStart('What-if scenario deletion', req, { scenarioName });
            
            await ExperimentationService.deleteWhatIfScenario(userId, scenarioName);

            // Log success
            ControllerHelper.logRequestSuccess('What-if scenario deletion', req, startTime, {
                scenarioName
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_what_if_scenario_deleted',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                { scenarioName }
            );

            ControllerHelper.sendSuccess(res, null, 'What-if scenario deleted successfully');
        } catch (error: any) {
            ControllerHelper.handleError('What-if scenario deletion', error, req, res, startTime, {
                scenarioName
            });
        }
    }

    /**
     * Start real-time model comparison with Bedrock execution
     * POST /api/experimentation/real-time-comparison
     */
    static async startRealTimeComparison(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
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
            // Auth check using helper
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;

            if (!prompt || !models || !Array.isArray(models) || models.length === 0) {
                ControllerHelper.sendError(res, 400, 'Prompt and models array are required');
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

            // Log request start
            ControllerHelper.logRequestStart('Real-time model comparison', req, {
                sessionId,
                promptLength: prompt.length,
                modelsCount: models.length,
                iterations,
                executeOnBedrock,
                comparisonMode
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

            // Log success
            ControllerHelper.logRequestSuccess('Real-time model comparison', req, startTime, {
                sessionId,
                promptLength: prompt.length,
                modelsCount: models.length,
                iterations
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'experimentation_real_time_comparison_started',
                'experimentation_operations',
                userId,
                Date.now() - startTime,
                {
                    sessionId,
                    promptLength: prompt.length,
                    modelsCount: models.length,
                    evaluationCriteria: request.evaluationCriteria,
                    iterations,
                    executeOnBedrock,
                    comparisonMode
                }
            );

            res.json({
                success: true,
                data: {
                    sessionId,
                    message: 'Real-time model comparison started. Connect to SSE endpoint for progress updates.',
                    estimatedDuration: models.length * 10 // seconds
                }
            });

        } catch (error: any) {
            ControllerHelper.handleError('Real-time model comparison', error, req, res, startTime, {
                hasPrompt: !!prompt,
                modelsCount: models?.length || 0,
                evaluationCriteria,
                iterations,
                executeOnBedrock,
                comparisonMode
            });
        }
    }

    /**
     * SSE endpoint for real-time model comparison progress
     * GET /api/experimentation/comparison-progress/:sessionId
     */
    static async streamComparisonProgress(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { sessionId } = req.params;

        try {
            // Log request start (no auth required - uses session validation)
            ControllerHelper.logRequestStart('SSE comparison progress', req, { sessionId });
            
            if (!sessionId) {
                ControllerHelper.sendError(res, 400, 'Session ID is required');
                return;
            }

            // Validate session instead of requiring auth token
            const sessionValidation = ExperimentationService.validateSession(sessionId);
            if (!sessionValidation.isValid) {
                res.writeHead(401, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify({ message: 'Invalid or expired session' }));
                return;
            }

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
            // Only send JSON error if headers haven't been sent yet
            if (!res.headersSent) {
                ControllerHelper.handleError('SSE comparison progress', error, req, res, startTime, {
                    sessionId
                });
            } else {
                // Headers already sent, just log the error
                loggingService.error('SSE stream error for comparison progress', {
                    sessionId,
                    error: error.message || 'Unknown error',
                    stack: error.stack,
                    duration: Date.now() - startTime,
                    requestId: req.headers['x-request-id'] as string
                });
            }
        }
    }
} 