import { Request, Response, NextFunction } from 'express';
import { TrainingDatasetService, CreateDatasetData, DatasetExportFormat } from '../services/trainingDataset.service';
import { PIIDetectionService } from '../services/piiDetection.service';
import { loggingService } from '../services/logging.service';

export class TrainingDatasetController {
    /**
     * Create a new training dataset
     * POST /api/training/datasets
     */
    static async createDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset creation initiated', {
                requestId,
                userId,
                hasUserId: !!userId
            });

            if (!userId) {
                loggingService.warn('Training dataset creation failed - authentication required', {
                    requestId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const datasetData: CreateDatasetData = req.body;

            loggingService.info('Training dataset creation parameters received', {
                requestId,
                userId,
                datasetName: datasetData.name,
                hasName: !!datasetData.name,
                targetUseCase: datasetData.targetUseCase,
                hasTargetUseCase: !!datasetData.targetUseCase,
                targetModel: datasetData.targetModel,
                hasTargetModel: !!datasetData.targetModel,
                hasDescription: !!datasetData.description,
                hasFilters: !!datasetData.filters,
                hasExportFormat: !!(datasetData as any).exportFormat
            });

            // Validate required fields
            if (!datasetData.name || !datasetData.targetUseCase || !datasetData.targetModel) {
                loggingService.warn('Training dataset creation failed - missing required fields', {
                    requestId,
                    userId,
                    hasName: !!datasetData.name,
                    hasTargetUseCase: !!datasetData.targetUseCase,
                    hasTargetModel: !!datasetData.targetModel
                });

                res.status(400).json({ 
                    success: false, 
                    message: 'Name, target use case, and target model are required' 
                });
                return;
            }

            const dataset = await TrainingDatasetService.createDataset(userId, datasetData);
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset created successfully', {
                requestId,
                duration,
                userId,
                datasetId: dataset._id,
                datasetName: dataset.name,
                targetUseCase: dataset.targetUseCase,
                targetModel: dataset.targetModel,
                hasDescription: !!dataset.description,
                hasFilters: !!dataset.filters,
                hasExportFormat: !!dataset.exportFormat
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_created',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId: dataset._id,
                    datasetName: dataset.name,
                    targetUseCase: dataset.targetUseCase,
                    targetModel: dataset.targetModel
                }
            });

            res.status(201).json({
                success: true,
                data: dataset,
                message: 'Training dataset created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset creation failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetName: req.body?.name,
                targetUseCase: req.body?.targetUseCase,
                targetModel: req.body?.targetModel,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Get all datasets for the authenticated user
     * GET /api/training/datasets
     */
    static async getUserDatasets(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Get user training datasets initiated', {
                requestId,
                userId,
                hasUserId: !!userId
            });

            if (!userId) {
                loggingService.warn('Get user training datasets failed - authentication required', {
                    requestId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const datasets = await TrainingDatasetService.getUserDatasets(userId);
            const duration = Date.now() - startTime;

            loggingService.info('User training datasets retrieved successfully', {
                requestId,
                duration,
                userId,
                datasetCount: datasets.length,
                hasDatasets: datasets.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_training_datasets_retrieved',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetCount: datasets.length
                }
            });

            res.json({
                success: true,
                data: datasets
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Get user training datasets failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Get a specific dataset
     * GET /api/training/datasets/:datasetId
     */
    static async getDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Get training dataset initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Get training dataset failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);

            if (!dataset) {
                loggingService.warn('Get training dataset failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                res.status(404).json({ 
                    success: false, 
                    message: 'Dataset not found' 
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Training dataset retrieved successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                targetUseCase: dataset.targetUseCase,
                targetModel: dataset.targetModel,
                itemCount: dataset.items?.length || 0,
                hasDescription: !!dataset.description,
                hasFilters: !!dataset.filters
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_retrieved',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    itemCount: dataset.items?.length || 0
                }
            });

            res.json({
                success: true,
                data: dataset
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Get training dataset failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Auto-populate dataset with high-scoring requests
     * POST /api/training/datasets/:datasetId/populate
     */
    static async populateDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset population initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset population failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const dataset = await TrainingDatasetService.populateDataset(userId, datasetId);
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset populated successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                requestCount: dataset.requestIds.length,
                hasRequests: dataset.requestIds.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_populated',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    requestCount: dataset.requestIds.length
                }
            });

            res.json({
                success: true,
                data: dataset,
                message: `Dataset populated with ${dataset.requestIds.length} high-quality requests`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset population failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Add requests to dataset manually
     * POST /api/training/datasets/:datasetId/requests
     */
    static async addRequestsToDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Add requests to training dataset initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Add requests to training dataset failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const { requestIds } = req.body;

            loggingService.info('Add requests to training dataset parameters received', {
                requestId,
                userId,
                datasetId,
                requestIds,
                requestCount: requestIds?.length || 0,
                hasRequestIds: !!requestIds,
                isArray: Array.isArray(requestIds)
            });

            if (!Array.isArray(requestIds) || requestIds.length === 0) {
                loggingService.warn('Add requests to training dataset failed - invalid request IDs', {
                    requestId,
                    userId,
                    datasetId,
                    requestIds,
                    requestCount: requestIds?.length || 0,
                    isArray: Array.isArray(requestIds),
                    isEmpty: requestIds?.length === 0
                });

                res.status(400).json({ 
                    success: false, 
                    message: 'Request IDs array is required' 
                });
                return;
            }

            const dataset = await TrainingDatasetService.addRequestsToDataset(userId, datasetId, requestIds);
            const duration = Date.now() - startTime;

            loggingService.info('Requests added to training dataset successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                requestCount: requestIds.length,
                hasRequests: requestIds.length > 0,
                finalRequestCount: dataset.requestIds?.length || 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'requests_added_to_training_dataset',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    requestCount: requestIds.length,
                    finalRequestCount: dataset.requestIds?.length || 0
                }
            });

            res.json({
                success: true,
                data: dataset,
                message: `Added ${requestIds.length} requests to dataset`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Add requests to training dataset failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                requestIds: req.body?.requestIds,
                requestCount: req.body?.requestIds?.length || 0,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Remove requests from dataset
     * DELETE /api/training/datasets/:datasetId/requests
     */
    static async removeRequestsFromDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Remove requests from training dataset initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Remove requests from training dataset failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const { requestIds } = req.body;

            loggingService.info('Remove requests from training dataset parameters received', {
                requestId,
                userId,
                datasetId,
                requestIds,
                requestCount: requestIds?.length || 0,
                hasRequestIds: !!requestIds,
                isArray: Array.isArray(requestIds)
            });

            if (!Array.isArray(requestIds) || requestIds.length === 0) {
                loggingService.warn('Remove requests from training dataset failed - invalid request IDs', {
                    requestId,
                    userId,
                    datasetId,
                    requestIds,
                    requestCount: requestIds?.length || 0,
                    isArray: Array.isArray(requestIds),
                    isEmpty: requestIds?.length === 0
                });

                res.status(400).json({ 
                    success: false, 
                    message: 'Request IDs array is required' 
                });
                return;
            }

            const dataset = await TrainingDatasetService.removeRequestsFromDataset(userId, datasetId, requestIds);
            const duration = Date.now() - startTime;

            loggingService.info('Requests removed from training dataset successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                requestCount: requestIds.length,
                hasRequests: requestIds.length > 0,
                finalRequestCount: dataset.requestIds?.length || 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'requests_removed_from_training_dataset',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    requestCount: requestIds.length,
                    finalRequestCount: dataset.requestIds?.length || 0
                }
            });

            res.json({
                success: true,
                data: dataset,
                message: `Removed ${requestIds.length} requests from dataset`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Remove requests from training dataset failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                requestIds: req.body?.requestIds,
                requestCount: req.body?.requestIds?.length || 0,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Export dataset in specified format
     * POST /api/training/datasets/:datasetId/export
     */
    static async exportDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset export initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset export failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const exportFormat: DatasetExportFormat = req.body;

            loggingService.info('Training dataset export parameters received', {
                requestId,
                userId,
                datasetId,
                exportFormat: exportFormat.format,
                hasFormat: !!exportFormat.format,
                hasCustomFormat: !!(exportFormat as any).customFormat,
                hasIncludeMetadata: !!(exportFormat as any).includeMetadata
            });

            // Validate export format
            const validFormats = ['openai-jsonl', 'anthropic-jsonl', 'huggingface-jsonl', 'custom'];
            if (!exportFormat.format || !validFormats.includes(exportFormat.format)) {
                loggingService.warn('Training dataset export failed - invalid export format', {
                    requestId,
                    userId,
                    datasetId,
                    exportFormat: exportFormat.format,
                    validFormats,
                    isValidFormat: validFormats.includes(exportFormat.format || '')
                });

                res.status(400).json({ 
                    success: false, 
                    message: `Export format must be one of: ${validFormats.join(', ')}` 
                });
                return;
            }

            const exportResult = await TrainingDatasetService.exportDataset(userId, datasetId, exportFormat);
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset exported successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                exportFormat: exportFormat.format,
                contentType: exportResult.contentType,
                filename: exportResult.filename,
                dataSize: exportResult.data.length,
                hasData: exportResult.data.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_exported',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    exportFormat: exportFormat.format,
                    contentType: exportResult.contentType,
                    filename: exportResult.filename,
                    dataSize: exportResult.data.length
                }
            });

            // Set appropriate headers for file download
            res.setHeader('Content-Type', exportResult.contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);

            res.send(exportResult.data);
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset export failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                exportFormat: req.body?.format,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Get dataset export preview (first 10 records)
     * GET /api/training/datasets/:datasetId/preview
     */
    static async previewDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset preview initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                format: req.query.format
            });

            if (!userId) {
                loggingService.warn('Training dataset preview failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const format = (req.query.format as string) || 'openai-jsonl';

            // Get dataset with limited requests for preview
            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                loggingService.warn('Training dataset preview failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                res.status(404).json({ success: false, message: 'Dataset not found' });
                return;
            }

            const exportResult = await TrainingDatasetService.exportDataset(userId, datasetId, { 
                format: format as any,
                includeMetadata: true 
            });

            // Parse the export data to show as JSON for preview
            const lines = exportResult.data.split('\n').slice(0, 10);
            const preview = lines.map(line => line ? JSON.parse(line) : null).filter(Boolean);
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset preview generated successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                format,
                totalRecords: dataset.requestIds.length,
                previewRecords: preview.length,
                hasPreview: preview.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_preview_generated',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    format,
                    totalRecords: dataset.requestIds.length,
                    previewRecords: preview.length
                }
            });

            res.json({
                success: true,
                data: {
                    format,
                    totalRecords: dataset.requestIds.length,
                    previewRecords: preview.length,
                    preview
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset preview failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                format: req.query.format,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Update dataset configuration
     * PUT /api/training/datasets/:datasetId
     */
    static async updateDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset update initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset update failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const updates = req.body;

            loggingService.info('Training dataset update parameters received', {
                requestId,
                userId,
                datasetId,
                updates,
                hasName: !!updates.name,
                hasDescription: updates.description !== undefined,
                hasTargetUseCase: !!updates.targetUseCase,
                hasTargetModel: !!updates.targetModel,
                hasMinScore: updates.minScore !== undefined,
                hasMaxTokens: updates.maxTokens !== undefined,
                hasMaxCost: updates.maxCost !== undefined,
                hasFilters: !!updates.filters,
                hasExportFormat: !!updates.exportFormat
            });

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                loggingService.warn('Training dataset update failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                res.status(404).json({ success: false, message: 'Dataset not found' });
                return;
            }

            // Update allowed fields
            if (updates.name) dataset.name = updates.name;
            if (updates.description !== undefined) dataset.description = updates.description;
            if (updates.targetUseCase) dataset.targetUseCase = updates.targetUseCase;
            if (updates.targetModel) dataset.targetModel = updates.targetModel;
            if (updates.minScore !== undefined) dataset.minScore = updates.minScore;
            if (updates.maxTokens !== undefined) dataset.maxTokens = updates.maxTokens;
            if (updates.maxCost !== undefined) dataset.maxCost = updates.maxCost;
            if (updates.filters) dataset.filters = updates.filters;
            if (updates.exportFormat) dataset.exportFormat = updates.exportFormat;

            const updatedDataset = await dataset.save();
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset updated successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: updatedDataset.name,
                targetUseCase: updatedDataset.targetUseCase,
                targetModel: updatedDataset.targetModel,
                hasDescription: !!updatedDataset.description,
                hasFilters: !!updatedDataset.filters,
                hasExportFormat: !!updatedDataset.exportFormat,
                updatedFields: Object.keys(updates)
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_updated',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: updatedDataset.name,
                    updatedFields: Object.keys(updates)
                }
            });

            res.json({
                success: true,
                data: updatedDataset,
                message: 'Dataset updated successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset update failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                updates: req.body,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Delete a dataset
     * DELETE /api/training/datasets/:datasetId
     */
    static async deleteDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset deletion initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset deletion failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const deleted = await TrainingDatasetService.deleteDataset(userId, datasetId);
            const duration = Date.now() - startTime;

            if (!deleted) {
                loggingService.warn('Training dataset deletion failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId,
                    duration
                });

                res.status(404).json({ 
                    success: false, 
                    message: 'Dataset not found' 
                });
                return;
            }

            loggingService.info('Training dataset deleted successfully', {
                requestId,
                duration,
                userId,
                datasetId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_deleted',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId
                }
            });

            res.json({
                success: true,
                message: 'Dataset deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset deletion failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Create a new version of an existing dataset
     * POST /api/training/datasets/:datasetId/versions
     */
    static async createDatasetVersion(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset version creation initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset version creation failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const versionData = req.body;

            loggingService.info('Training dataset version creation parameters received', {
                requestId,
                userId,
                datasetId,
                versionData,
                hasVersionNotes: !!versionData.versionNotes,
                hasDescription: !!versionData.description,
                hasFilters: !!versionData.filters
            });

            const newDataset = await TrainingDatasetService.createDatasetVersion(userId, datasetId, versionData);
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset version created successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                newDatasetId: newDataset._id,
                newDatasetName: newDataset.name,
                newDatasetVersion: newDataset.version,
                hasDescription: !!newDataset.description,
                hasFilters: !!newDataset.filters
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_version_created',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    newDatasetId: newDataset._id,
                    newDatasetName: newDataset.name,
                    newDatasetVersion: newDataset.version
                }
            });

            return res.status(201).json({
                success: true,
                data: newDataset,
                message: 'Dataset version created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset version creation failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                versionData: req.body,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Add items to dataset with ground truth labels
     * POST /api/training/datasets/:datasetId/items
     */
    static async addDatasetItems(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset items addition initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset items addition failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const { items } = req.body;

            loggingService.info('Training dataset items addition parameters received', {
                requestId,
                userId,
                datasetId,
                items,
                itemCount: items?.length || 0,
                hasItems: !!items,
                isArray: Array.isArray(items)
            });

            const dataset = await TrainingDatasetService.addDatasetItems(userId, datasetId, items);
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset items added successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                itemCount: items.length,
                hasItems: items.length > 0,
                finalItemCount: dataset.items?.length || 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_items_added',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    itemCount: items.length,
                    finalItemCount: dataset.items?.length || 0
                }
            });

            return res.json({
                success: true,
                data: dataset,
                message: `Added ${items.length} items to dataset`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset items addition failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                items: req.body?.items,
                itemCount: req.body?.items?.length || 0,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Analyze PII in dataset
     * POST /api/training/datasets/:datasetId/analyze-pii
     */
    static async analyzePII(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset PII analysis initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset PII analysis failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);

            if (!dataset) {
                loggingService.warn('Training dataset PII analysis failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            // Extract texts for PII analysis
            const texts = dataset.items.map(item => item.input);
            
            loggingService.info('Training dataset PII analysis parameters processed', {
                requestId,
                userId,
                datasetId,
                datasetName: dataset.name,
                itemCount: dataset.items.length,
                textCount: texts.length,
                hasTexts: texts.length > 0
            });
            
            if (texts.length === 0) {
                loggingService.info('Training dataset PII analysis completed - empty dataset', {
                    requestId,
                    userId,
                    datasetId,
                    duration: Date.now() - startTime
                });

                return res.json({
                    success: true,
                    data: {
                        results: [],
                        totalProcessed: 0,
                        totalWithPII: 0,
                        overallRiskAssessment: 'low',
                        summary: { piiTypeBreakdown: {}, highRiskItems: 0, recommendedActions: ['Dataset is empty'] }
                    }
                });
            }

            const piiAnalysis = await PIIDetectionService.detectPIIBatch(texts, true);
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset PII analysis completed successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                totalProcessed: piiAnalysis.totalProcessed,
                totalWithPII: piiAnalysis.totalWithPII,
                overallRiskAssessment: piiAnalysis.overallRiskAssessment,
                hasResults: piiAnalysis.results.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_pii_analyzed',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    totalProcessed: piiAnalysis.totalProcessed,
                    totalWithPII: piiAnalysis.totalWithPII,
                    overallRiskAssessment: piiAnalysis.overallRiskAssessment
                }
            });

            return res.json({
                success: true,
                data: piiAnalysis,
                message: 'PII analysis completed'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset PII analysis failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Sanitize PII in dataset
     * POST /api/training/datasets/:datasetId/sanitize-pii
     */
    static async sanitizePII(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset PII sanitization initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset PII sanitization failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const { action } = req.body; // 'mask', 'remove', 'replace'

            loggingService.info('Training dataset PII sanitization parameters received', {
                requestId,
                userId,
                datasetId,
                action,
                hasAction: !!action,
                isValidAction: ['mask', 'remove', 'replace'].includes(action)
            });

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                loggingService.warn('Training dataset PII sanitization failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            let processedCount = 0;
            let removedCount = 0;

            // Process each item based on action
            for (let i = dataset.items.length - 1; i >= 0; i--) {
                const item = dataset.items[i];
                if (item.piiFlags?.hasPII) {
                    if (action === 'remove') {
                        dataset.items.splice(i, 1);
                        removedCount++;
                    } else if (action === 'mask') {
                        const piiResult = item.metadata?.piiDetectionResult;
                        if (piiResult) {
                            item.input = PIIDetectionService.sanitizeText(item.input, piiResult);
                            processedCount++;
                        }
                    }
                }
            }

            await dataset.save();
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset PII sanitization completed successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                action,
                processedCount,
                removedCount,
                finalItemCount: dataset.items.length,
                hasItems: dataset.items.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_pii_sanitized',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    action,
                    processedCount,
                    removedCount,
                    finalItemCount: dataset.items.length
                }
            });

            return res.json({
                success: true,
                data: dataset,
                message: `PII sanitization completed. Processed: ${processedCount}, Removed: ${removedCount}`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset PII sanitization failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                action: req.body?.action,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Update dataset splits
     * POST /api/training/datasets/:datasetId/split
     */
    static async updateSplits(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset splits update initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset splits update failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const { trainPercentage, devPercentage, testPercentage } = req.body;

            loggingService.info('Training dataset splits update parameters received', {
                requestId,
                userId,
                datasetId,
                trainPercentage,
                devPercentage,
                testPercentage,
                totalPercentage: trainPercentage + devPercentage + testPercentage,
                isValidTotal: trainPercentage + devPercentage + testPercentage === 100
            });

            // Validate percentages sum to 100
            if (trainPercentage + devPercentage + testPercentage !== 100) {
                loggingService.warn('Training dataset splits update failed - invalid percentages', {
                    requestId,
                    userId,
                    datasetId,
                    trainPercentage,
                    devPercentage,
                    testPercentage,
                    totalPercentage: trainPercentage + devPercentage + testPercentage,
                    isValidTotal: false
                });

                return res.status(400).json({
                    success: false,
                    message: 'Split percentages must sum to 100'
                });
            }

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                loggingService.warn('Training dataset splits update failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            // Update split configuration
            dataset.splits.train.percentage = trainPercentage;
            dataset.splits.dev.percentage = devPercentage;
            dataset.splits.test.percentage = testPercentage;

            // Reassign items to new splits
            const items = dataset.items.map(item => ({ ...item }));
            await (TrainingDatasetService as any).assignItemsToSplits(dataset, items);

            await dataset.save();
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset splits updated successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                trainPercentage,
                devPercentage,
                testPercentage,
                itemCount: dataset.items.length,
                hasItems: dataset.items.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_splits_updated',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    trainPercentage,
                    devPercentage,
                    testPercentage,
                    itemCount: dataset.items.length
                }
            });

            return res.json({
                success: true,
                data: dataset,
                message: 'Dataset splits updated successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset splits update failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                trainPercentage: req.body?.trainPercentage,
                devPercentage: req.body?.devPercentage,
                testPercentage: req.body?.testPercentage,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Get split data
     * GET /api/training/datasets/:datasetId/splits/:splitType
     */
    static async getSplitData(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset split data retrieval initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                splitType: req.params.splitType
            });

            if (!userId) {
                loggingService.warn('Training dataset split data retrieval failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId,
                    splitType: req.params.splitType
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId, splitType } = req.params;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                loggingService.warn('Training dataset split data retrieval failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId,
                    splitType
                });

                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            const splitItems = dataset.items.filter(item => item.split === splitType);
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset split data retrieved successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                splitType,
                itemCount: splitItems.length,
                percentage: dataset.splits[splitType as keyof typeof dataset.splits]?.percentage || 0,
                hasItems: splitItems.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_split_data_retrieved',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    splitType,
                    itemCount: splitItems.length,
                    percentage: dataset.splits[splitType as keyof typeof dataset.splits]?.percentage || 0
                }
            });

            return res.json({
                success: true,
                data: {
                    splitType,
                    count: splitItems.length,
                    percentage: dataset.splits[splitType as keyof typeof dataset.splits]?.percentage || 0,
                    items: splitItems
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset split data retrieval failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                splitType: req.params.splitType,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Get dataset lineage
     * GET /api/training/datasets/:datasetId/lineage
     */
    static async getDatasetLineage(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset lineage retrieval initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset lineage retrieval failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                loggingService.warn('Training dataset lineage retrieval failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            // Get parent dataset if exists
            let parentDataset = null;
            if (dataset.parentDatasetId) {
                parentDataset = await TrainingDatasetService.getDataset(userId, dataset.parentDatasetId.toString());
            }

            // Get derived datasets
            const derivedDatasets = await TrainingDatasetService.getUserDatasets(userId);
            const children = derivedDatasets.filter(d => 
                d.parentDatasetId && d.parentDatasetId.toString() === datasetId
            );
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset lineage retrieved successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                hasParent: !!parentDataset,
                hasChildren: children.length > 0,
                childCount: children.length,
                hasLineage: !!dataset.lineage
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_lineage_retrieved',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    hasParent: !!parentDataset,
                    childCount: children.length,
                    hasLineage: !!dataset.lineage
                }
            });

            return res.json({
                success: true,
                data: {
                    current: {
                        id: dataset._id,
                        name: dataset.name,
                        version: dataset.version
                    },
                    parent: parentDataset ? {
                        id: parentDataset._id,
                        name: parentDataset.name,
                        version: parentDataset.version
                    } : null,
                    children: children.map(child => ({
                        id: child._id,
                        name: child.name,
                        version: child.version
                    })),
                    lineage: dataset.lineage
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset lineage retrieval failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Get dataset versions
     * GET /api/training/datasets/:datasetId/versions
     */
    static async getDatasetVersions(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset versions retrieval initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset versions retrieval failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                loggingService.warn('Training dataset versions retrieval failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            // Get all datasets with the same base name
            const allUserDatasets = await TrainingDatasetService.getUserDatasets(userId);
            const versions = allUserDatasets.filter(d => 
                d.name === dataset.name || 
                (d.parentDatasetId && d.parentDatasetId.toString() === datasetId) ||
                (dataset.parentDatasetId && (d._id as any).toString() === dataset.parentDatasetId.toString())
            );
            const duration = Date.now() - startTime;

            loggingService.info('Training dataset versions retrieved successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                versionCount: versions.length,
                hasVersions: versions.length > 0,
                baseDatasetName: dataset.name
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_versions_retrieved',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    versionCount: versions.length
                }
            });

            return res.json({
                success: true,
                data: versions.map(v => ({
                    id: v._id,
                    name: v.name,
                    version: v.version,
                    versionNotes: v.versionNotes,
                    createdAt: v.createdAt,
                    status: v.status,
                    itemCount: v.items?.length || 0
                }))
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset versions retrieval failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }

    /**
     * Validate dataset for training readiness
     * POST /api/training/datasets/:datasetId/validate
     */
    static async validateDataset(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Training dataset validation initiated', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId
            });

            if (!userId) {
                loggingService.warn('Training dataset validation failed - authentication required', {
                    requestId,
                    datasetId: req.params.datasetId
                });

                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                loggingService.warn('Training dataset validation failed - dataset not found', {
                    requestId,
                    userId,
                    datasetId
                });

                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            const validation = {
                isValid: true,
                issues: [] as string[],
                warnings: [] as string[],
                recommendations: [] as string[]
            };

            // Check minimum dataset size
            if (dataset.items.length < 10) {
                validation.isValid = false;
                validation.issues.push('Dataset must have at least 10 training examples');
            }

            // Check for ground truth labels
            const itemsWithoutLabels = dataset.items.filter(item => !item.expectedOutput);
            if (itemsWithoutLabels.length > 0) {
                validation.warnings.push(`${itemsWithoutLabels.length} items missing expected output`);
                if (itemsWithoutLabels.length > dataset.items.length * 0.5) {
                    validation.isValid = false;
                    validation.issues.push('More than 50% of items missing expected output');
                }
            }

            // Check PII
            const itemsWithHighRiskPII = dataset.items.filter(item => 
                item.piiFlags?.hasPII && item.metadata?.riskLevel === 'high'
            );
            if (itemsWithHighRiskPII.length > 0) {
                validation.isValid = false;
                validation.issues.push(`${itemsWithHighRiskPII.length} items contain high-risk PII`);
            }

            // Check splits
            const trainCount = dataset.items.filter(item => item.split === 'train').length;
            const devCount = dataset.items.filter(item => item.split === 'dev').length;
            
            if (trainCount < 5) {
                validation.isValid = false;
                validation.issues.push('Training split must have at least 5 examples');
            }

            if (devCount === 0) {
                validation.warnings.push('No validation split - recommended for monitoring training progress');
            }

            // Add recommendations
            if (dataset.items.length < 100) {
                validation.recommendations.push('Consider adding more training examples for better performance');
            }

            if (validation.isValid) {
                validation.recommendations.push('Dataset is ready for training');
            }

            const duration = Date.now() - startTime;

            loggingService.info('Training dataset validation completed successfully', {
                requestId,
                duration,
                userId,
                datasetId,
                datasetName: dataset.name,
                itemCount: dataset.items.length,
                isValid: validation.isValid,
                issueCount: validation.issues.length,
                warningCount: validation.warnings.length,
                recommendationCount: validation.recommendations.length,
                hasIssues: validation.issues.length > 0,
                hasWarnings: validation.warnings.length > 0,
                hasRecommendations: validation.recommendations.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'training_dataset_validated',
                category: 'training',
                value: duration,
                metadata: {
                    userId,
                    datasetId,
                    datasetName: dataset.name,
                    itemCount: dataset.items.length,
                    isValid: validation.isValid,
                    issueCount: validation.issues.length,
                    warningCount: validation.warnings.length
                }
            });

            return res.json({
                success: true,
                data: validation,
                message: validation.isValid ? 'Dataset validation passed' : 'Dataset validation failed'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training dataset validation failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                datasetId: req.params.datasetId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            next(error);
        }
    }
}