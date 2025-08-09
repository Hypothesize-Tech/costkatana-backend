import { Request, Response, NextFunction } from 'express';
import { TrainingDatasetService, CreateDatasetData, DatasetExportFormat } from '../services/trainingDataset.service';
import { logger } from '../utils/logger';

export class TrainingDatasetController {
    /**
     * Create a new training dataset
     * POST /api/training/datasets
     */
    static async createDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const datasetData: CreateDatasetData = req.body;

            // Validate required fields
            if (!datasetData.name || !datasetData.targetUseCase || !datasetData.targetModel) {
                res.status(400).json({ 
                    success: false, 
                    message: 'Name, target use case, and target model are required' 
                });
                return;
            }

            const dataset = await TrainingDatasetService.createDataset(userId, datasetData);

            res.status(201).json({
                success: true,
                data: dataset,
                message: 'Training dataset created successfully'
            });
        } catch (error) {
            logger.error('Create dataset error:', error);
            next(error);
        }
    }

    /**
     * Get all datasets for the authenticated user
     * GET /api/training/datasets
     */
    static async getUserDatasets(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const datasets = await TrainingDatasetService.getUserDatasets(userId);

            res.json({
                success: true,
                data: datasets
            });
        } catch (error) {
            logger.error('Get user datasets error:', error);
            next(error);
        }
    }

    /**
     * Get a specific dataset
     * GET /api/training/datasets/:datasetId
     */
    static async getDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);

            if (!dataset) {
                res.status(404).json({ 
                    success: false, 
                    message: 'Dataset not found' 
                });
                return;
            }

            res.json({
                success: true,
                data: dataset
            });
        } catch (error) {
            logger.error('Get dataset error:', error);
            next(error);
        }
    }

    /**
     * Auto-populate dataset with high-scoring requests
     * POST /api/training/datasets/:datasetId/populate
     */
    static async populateDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const dataset = await TrainingDatasetService.populateDataset(userId, datasetId);

            res.json({
                success: true,
                data: dataset,
                message: `Dataset populated with ${dataset.requestIds.length} high-quality requests`
            });
        } catch (error) {
            logger.error('Populate dataset error:', error);
            next(error);
        }
    }

    /**
     * Add requests to dataset manually
     * POST /api/training/datasets/:datasetId/requests
     */
    static async addRequestsToDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const { requestIds } = req.body;

            if (!Array.isArray(requestIds) || requestIds.length === 0) {
                res.status(400).json({ 
                    success: false, 
                    message: 'Request IDs array is required' 
                });
                return;
            }

            const dataset = await TrainingDatasetService.addRequestsToDataset(userId, datasetId, requestIds);

            res.json({
                success: true,
                data: dataset,
                message: `Added ${requestIds.length} requests to dataset`
            });
        } catch (error) {
            logger.error('Add requests to dataset error:', error);
            next(error);
        }
    }

    /**
     * Remove requests from dataset
     * DELETE /api/training/datasets/:datasetId/requests
     */
    static async removeRequestsFromDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const { requestIds } = req.body;

            if (!Array.isArray(requestIds) || requestIds.length === 0) {
                res.status(400).json({ 
                    success: false, 
                    message: 'Request IDs array is required' 
                });
                return;
            }

            const dataset = await TrainingDatasetService.removeRequestsFromDataset(userId, datasetId, requestIds);

            res.json({
                success: true,
                data: dataset,
                message: `Removed ${requestIds.length} requests from dataset`
            });
        } catch (error) {
            logger.error('Remove requests from dataset error:', error);
            next(error);
        }
    }

    /**
     * Export dataset in specified format
     * POST /api/training/datasets/:datasetId/export
     */
    static async exportDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const exportFormat: DatasetExportFormat = req.body;

            // Validate export format
            const validFormats = ['openai-jsonl', 'anthropic-jsonl', 'huggingface-jsonl', 'custom'];
            if (!exportFormat.format || !validFormats.includes(exportFormat.format)) {
                res.status(400).json({ 
                    success: false, 
                    message: `Export format must be one of: ${validFormats.join(', ')}` 
                });
                return;
            }

            const exportResult = await TrainingDatasetService.exportDataset(userId, datasetId, exportFormat);

            // Set appropriate headers for file download
            res.setHeader('Content-Type', exportResult.contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);

            res.send(exportResult.data);
        } catch (error) {
            logger.error('Export dataset error:', error);
            next(error);
        }
    }

    /**
     * Get dataset export preview (first 10 records)
     * GET /api/training/datasets/:datasetId/preview
     */
    static async previewDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const format = (req.query.format as string) || 'openai-jsonl';

            // Get dataset with limited requests for preview
            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
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

            res.json({
                success: true,
                data: {
                    format,
                    totalRecords: dataset.requestIds.length,
                    previewRecords: preview.length,
                    preview
                }
            });
        } catch (error) {
            logger.error('Preview dataset error:', error);
            next(error);
        }
    }

    /**
     * Update dataset configuration
     * PUT /api/training/datasets/:datasetId
     */
    static async updateDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const updates = req.body;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
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

            res.json({
                success: true,
                data: updatedDataset,
                message: 'Dataset updated successfully'
            });
        } catch (error) {
            logger.error('Update dataset error:', error);
            next(error);
        }
    }

    /**
     * Delete a dataset
     * DELETE /api/training/datasets/:datasetId
     */
    static async deleteDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { datasetId } = req.params;
            const deleted = await TrainingDatasetService.deleteDataset(userId, datasetId);

            if (!deleted) {
                res.status(404).json({ 
                    success: false, 
                    message: 'Dataset not found' 
                });
                return;
            }

            res.json({
                success: true,
                message: 'Dataset deleted successfully'
            });
        } catch (error) {
            logger.error('Delete dataset error:', error);
            next(error);
        }
    }
}