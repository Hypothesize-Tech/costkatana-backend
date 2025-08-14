import { Request, Response, NextFunction } from 'express';
import { TrainingDatasetService, CreateDatasetData, DatasetExportFormat } from '../services/trainingDataset.service';
import { PIIDetectionService } from '../services/piiDetection.service';
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

    /**
     * Create a new version of an existing dataset
     * POST /api/training/datasets/:datasetId/versions
     */
    static async createDatasetVersion(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const versionData = req.body;

            const newDataset = await TrainingDatasetService.createDatasetVersion(userId, datasetId, versionData);

            return res.status(201).json({
                success: true,
                data: newDataset,
                message: 'Dataset version created successfully'
            });
        } catch (error) {
            logger.error('Create dataset version error:', error);
            next(error);
        }
    }

    /**
     * Add items to dataset with ground truth labels
     * POST /api/training/datasets/:datasetId/items
     */
    static async addDatasetItems(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const { items } = req.body;

            const dataset = await TrainingDatasetService.addDatasetItems(userId, datasetId, items);

            return res.json({
                success: true,
                data: dataset,
                message: `Added ${items.length} items to dataset`
            });
        } catch (error) {
            logger.error('Add dataset items error:', error);
            next(error);
        }
    }

    /**
     * Analyze PII in dataset
     * POST /api/training/datasets/:datasetId/analyze-pii
     */
    static async analyzePII(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);

            if (!dataset) {
                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            // Extract texts for PII analysis
            const texts = dataset.items.map(item => item.input);
            
            if (texts.length === 0) {
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

            return res.json({
                success: true,
                data: piiAnalysis,
                message: 'PII analysis completed'
            });
        } catch (error) {
            logger.error('Analyze PII error:', error);
            next(error);
        }
    }

    /**
     * Sanitize PII in dataset
     * POST /api/training/datasets/:datasetId/sanitize-pii
     */
    static async sanitizePII(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const { action } = req.body; // 'mask', 'remove', 'replace'

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
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

            return res.json({
                success: true,
                data: dataset,
                message: `PII sanitization completed. Processed: ${processedCount}, Removed: ${removedCount}`
            });
        } catch (error) {
            logger.error('Sanitize PII error:', error);
            next(error);
        }
    }

    /**
     * Update dataset splits
     * POST /api/training/datasets/:datasetId/split
     */
    static async updateSplits(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;
            const { trainPercentage, devPercentage, testPercentage } = req.body;

            // Validate percentages sum to 100
            if (trainPercentage + devPercentage + testPercentage !== 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Split percentages must sum to 100'
                });
            }

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
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

            return res.json({
                success: true,
                data: dataset,
                message: 'Dataset splits updated successfully'
            });
        } catch (error) {
            logger.error('Update splits error:', error);
            next(error);
        }
    }

    /**
     * Get split data
     * GET /api/training/datasets/:datasetId/splits/:splitType
     */
    static async getSplitData(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId, splitType } = req.params;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            const splitItems = dataset.items.filter(item => item.split === splitType);

            return res.json({
                success: true,
                data: {
                    splitType,
                    count: splitItems.length,
                    percentage: dataset.splits[splitType as keyof typeof dataset.splits]?.percentage || 0,
                    items: splitItems
                }
            });
        } catch (error) {
            logger.error('Get split data error:', error);
            next(error);
        }
    }

    /**
     * Get dataset lineage
     * GET /api/training/datasets/:datasetId/lineage
     */
    static async getDatasetLineage(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
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
        } catch (error) {
            logger.error('Get dataset lineage error:', error);
            next(error);
        }
    }

    /**
     * Get dataset versions
     * GET /api/training/datasets/:datasetId/versions
     */
    static async getDatasetVersions(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
                return res.status(404).json({ success: false, message: 'Dataset not found' });
            }

            // Get all datasets with the same base name
            const allUserDatasets = await TrainingDatasetService.getUserDatasets(userId);
            const versions = allUserDatasets.filter(d => 
                d.name === dataset.name || 
                (d.parentDatasetId && d.parentDatasetId.toString() === datasetId) ||
                (dataset.parentDatasetId && (d._id as any).toString() === dataset.parentDatasetId.toString())
            );

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
        } catch (error) {
            logger.error('Get dataset versions error:', error);
            next(error);
        }
    }

    /**
     * Validate dataset for training readiness
     * POST /api/training/datasets/:datasetId/validate
     */
    static async validateDataset(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { datasetId } = req.params;

            const dataset = await TrainingDatasetService.getDataset(userId, datasetId);
            if (!dataset) {
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

            return res.json({
                success: true,
                data: validation,
                message: validation.isValid ? 'Dataset validation passed' : 'Dataset validation failed'
            });
        } catch (error) {
            logger.error('Validate dataset error:', error);
            next(error);
        }
    }
}