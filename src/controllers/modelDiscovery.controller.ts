import { Response } from 'express';
import { ModelDiscoveryService } from '../services/modelDiscovery.service';
import { ModelDiscoveryJob } from '../jobs/modelDiscovery.job';
import { AIModelPricing } from '../models/AIModelPricing';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

/**
 * Model Discovery Controller
 * Handles API endpoints for model discovery management
 */
export class ModelDiscoveryController {
    /**
     * Manually trigger model discovery for all providers
     * POST /api/model-discovery/trigger
     */
    static async triggerDiscovery(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('triggerDiscovery', req);

        try {
            const results = await ModelDiscoveryJob.trigger();

            ControllerHelper.logRequestSuccess('triggerDiscovery', req, startTime);

            res.json({
                success: true,
                message: 'Model discovery initiated',
                ...results
            });
        } catch (error) {
            ControllerHelper.handleError('triggerDiscovery', error, req, res, startTime);
        }
    }

    /**
     * Trigger discovery for a specific provider
     * POST /api/model-discovery/trigger/:provider
     */
    static async triggerProviderDiscovery(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { provider } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('triggerProviderDiscovery', req, { provider });

        try {
            if (!provider) {
                res.status(400).json({
                    success: false,
                    error: 'Provider parameter is required'
                });
                return;
            }

            const result = await ModelDiscoveryService.discoverModelsForProvider(provider);

            ControllerHelper.logRequestSuccess('triggerProviderDiscovery', req, startTime, { provider });

            res.json({
                success: true,
                result
            });
        } catch (error) {
            ControllerHelper.handleError('triggerProviderDiscovery', error, req, res, startTime, { provider });
        }
    }

    /**
     * Get discovery job status
     * GET /api/model-discovery/status
     */
    static async getStatus(_req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            const jobStatus = ModelDiscoveryJob.getStatus();
            const discoveryStatus = await ModelDiscoveryService.getDiscoveryStatus();

            res.json({
                success: true,
                data: {
                    ...jobStatus,
                    ...discoveryStatus
                }
            });
        } catch (error) {
            ControllerHelper.handleError('getStatus', error, _req, res, startTime);
        }
    }

    /**
     * Get all discovered models
     * GET /api/model-discovery/models
     */
    static async getAllModels(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getAllModels', req, { query: req.query });

        try {
            const { provider, active, latest } = req.query;
            const query: any = {};

            if (provider) {
                query.provider = provider;
            }
            if (active === 'true') {
                query.isActive = true;
                query.isDeprecated = false;
            }
            if (latest === 'true') {
                query.isLatest = true;
            }

            const models = await AIModelPricing.find(query)
                .sort({ provider: 1, isLatest: -1, modelName: 1 })
                .select('-llmExtractionPrompt -googleSearchSnippet -searchQuery');

            ControllerHelper.logRequestSuccess('getAllModels', req, startTime, { count: models.length });

            res.json({
                success: true,
                data: {
                    models,
                    count: models.length
                }
            });
        } catch (error) {
            ControllerHelper.handleError('getAllModels', error, req, res, startTime);
        }
    }

    /**
     * Get models by provider
     * GET /api/model-discovery/models/:provider
     */
    static async getModelsByProvider(req: any, res: Response): Promise<void> {
        try {
            const { provider } = req.params;

            if (!provider) {
                res.status(400).json({
                    success: false,
                    error: 'Provider parameter is required'
                });
                return;
            }

            const models = await AIModelPricing.find({
                provider,
                isActive: true,
                validationStatus: 'verified'
            }).sort({ isLatest: -1, modelName: 1 });

            res.json({
                success: true,
                data: {
                    provider,
                    models,
                    count: models.length,
                    lastUpdated: models[0]?.lastUpdated || null
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error getting models by provider', {
                provider: req.params.provider,
                error: errorMessage
            });

            res.status(500).json({
                success: false,
                error: 'Failed to get models by provider',
                details: errorMessage
            });
        }
    }

    /**
     * Manually update a model
     * PUT /api/model-discovery/models/:modelId
     */
    static async updateModel(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { modelId } = req.params;
        const updates = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('updateModel', req, { modelId });

        try {
            if (!modelId) {
                res.status(400).json({
                    success: false,
                    error: 'Model ID is required'
                });
                return;
            }

            const model = await AIModelPricing.findOne({ modelId });

            if (!model) {
                res.status(404).json({
                    success: false,
                    error: 'Model not found'
                });
                return;
            }

            // Update allowed fields
            const allowedFields = [
                'modelName',
                'inputPricePerMToken',
                'outputPricePerMToken',
                'cachedInputPricePerMToken',
                'contextWindow',
                'capabilities',
                'category',
                'isLatest',
                'isActive',
                'isDeprecated'
            ];

            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    (model as any)[field] = updates[field];
                }
            }

            model.lastUpdated = new Date();
            model.discoverySource = 'manual';
            
            await model.save();

            ControllerHelper.logRequestSuccess('updateModel', req, startTime, { modelId });

            res.json({
                success: true,
                data: model
            });
        } catch (error) {
            ControllerHelper.handleError('updateModel', error, req, res, startTime, { modelId });
        }
    }

    /**
     * Validate a model's pricing data
     * POST /api/model-discovery/validate/:modelId
     */
    static async validateModel(req: any, res: Response): Promise<void> {
        try {
            const { modelId } = req.params;

            if (!modelId) {
                res.status(400).json({
                    success: false,
                    error: 'Model ID is required'
                });
                return;
            }

            const model = await AIModelPricing.findOne({ modelId });

            if (!model) {
                res.status(404).json({
                    success: false,
                    error: 'Model not found'
                });
                return;
            }

            // Perform validation checks
            const validationResults = {
                priceRange: model.inputPricePerMToken >= 0 && model.inputPricePerMToken <= 1000 &&
                           model.outputPricePerMToken >= 0 && model.outputPricePerMToken <= 1000,
                contextWindow: model.contextWindow >= 1000 && model.contextWindow <= 10000000,
                hasCapabilities: model.capabilities.length > 0,
                validCategory: ['text', 'multimodal', 'embedding', 'code'].includes(model.category)
            };

            const isValid = Object.values(validationResults).every(v => v);

            model.validationStatus = isValid ? 'verified' : 'failed';
            model.lastValidated = new Date();
            await model.save();

            res.json({
                success: true,
                data: {
                    modelId,
                    isValid,
                    validationResults,
                    validationStatus: model.validationStatus
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error validating model', {
                modelId: req.params.modelId,
                error: errorMessage
            });

            res.status(500).json({
                success: false,
                error: 'Failed to validate model',
                details: errorMessage
            });
        }
    }
}
