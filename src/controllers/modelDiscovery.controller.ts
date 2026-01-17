import { Response } from 'express';
import { ModelDiscoveryService } from '../services/modelDiscovery.service';
import { ModelDiscoveryJob } from '../jobs/modelDiscovery.job';
import { AIModelPricing } from '../models/AIModelPricing';
import { loggingService } from '../services/logging.service';

/**
 * Model Discovery Controller
 * Handles API endpoints for model discovery management
 */
export class ModelDiscoveryController {
    /**
     * Manually trigger model discovery for all providers
     * POST /api/model-discovery/trigger
     */
    static async triggerDiscovery(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            loggingService.info('Manual model discovery triggered', {
                triggeredBy: userId
            });

            const results = await ModelDiscoveryJob.trigger();

            res.json({
                success: true,
                message: 'Model discovery initiated',
                ...results
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error triggering model discovery', {
                error: errorMessage
            });

            res.status(500).json({
                success: false,
                error: 'Failed to trigger model discovery',
                details: errorMessage
            });
        }
    }

    /**
     * Trigger discovery for a specific provider
     * POST /api/model-discovery/trigger/:provider
     */
    static async triggerProviderDiscovery(req: any, res: Response): Promise<void> {
        try {
            const { provider } = req.params;

            if (!provider) {
                res.status(400).json({
                    success: false,
                    error: 'Provider parameter is required'
                });
                return;
            }

            loggingService.info(`Manual model discovery triggered for ${provider}`, {
                provider,
                triggeredBy: req.userId
            });

            const result = await ModelDiscoveryService.discoverModelsForProvider(provider);

            res.json({
                success: true,
                result
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Error triggering discovery for provider`, {
                provider: req.params.provider,
                error: errorMessage
            });

            res.status(500).json({
                success: false,
                error: 'Failed to trigger provider discovery',
                details: errorMessage
            });
        }
    }

    /**
     * Get discovery job status
     * GET /api/model-discovery/status
     */
    static async getStatus(_req: any, res: Response): Promise<void> {
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error getting discovery status', {
                error: errorMessage
            });

            res.status(500).json({
                success: false,
                error: 'Failed to get discovery status',
                details: errorMessage
            });
        }
    }

    /**
     * Get all discovered models
     * GET /api/model-discovery/models
     */
    static async getAllModels(req: any, res: Response): Promise<void> {
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

            res.json({
                success: true,
                data: {
                    models,
                    count: models.length
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error getting models', {
                error: errorMessage
            });

            res.status(500).json({
                success: false,
                error: 'Failed to get models',
                details: errorMessage
            });
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
    static async updateModel(req: any, res: Response): Promise<void> {
        try {
            const { modelId } = req.params;
            const updates = req.body;

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

            const userId = req.user?.id || req.userId;
            loggingService.info(`Model updated manually: ${modelId}`, {
                modelId,
                updatedBy: userId
            });

            res.json({
                success: true,
                data: model
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error updating model', {
                modelId: req.params.modelId,
                error: errorMessage
            });

            res.status(500).json({
                success: false,
                error: 'Failed to update model',
                details: errorMessage
            });
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
