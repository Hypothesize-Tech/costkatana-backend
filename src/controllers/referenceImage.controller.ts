import { Response } from 'express';
import { S3Service } from '../services/s3.service';
import { ReferenceImageAnalysisService } from '../services/referenceImageAnalysis.service';
import { PromptTemplate } from '../models/PromptTemplate';
import { Activity } from '../models/Activity';
import { loggingService } from '../services/logging.service';
import mongoose from 'mongoose';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class ReferenceImageController {
    /**
     * Get presigned URL for viewing a reference image
     * GET /api/reference-image/presigned-url?s3Key=...
     */
    static async getPresignedUrl(req: any, res: Response): Promise<void> {
        try {
            const { s3Key } = req.query;

            if (!s3Key || typeof s3Key !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'S3 key is required'
                });
                return;
            }

            loggingService.info('Generating presigned URL', {
                component: 'ReferenceImageController',
                operation: 'getPresignedUrl',
                s3Key
            });

            // Generate presigned URL (valid for 1 hour)
            const presignedUrl = await S3Service.generatePresignedUrl(s3Key, 3600);

            res.status(200).json({
                success: true,
                data: {
                    presignedUrl,
                    expiresIn: 3600
                }
            });

        } catch (error) {
            loggingService.error('Error generating presigned URL', {
                component: 'ReferenceImageController',
                operation: 'getPresignedUrl',
                error: error instanceof Error ? error.message : String(error)
            });

            res.status(500).json({
                success: false,
                message: 'Failed to generate presigned URL',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Pre-upload reference image before template creation
     * POST /api/reference-image/pre-upload
     */
    static async preUploadReferenceImage(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?._id || req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
                return;
            }

            // Check if file was uploaded
            if (!req.file) {
                res.status(400).json({
                    success: false,
                    message: 'No file uploaded'
                });
                return;
            }

            // Validate file type
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.'
                });
                return;
            }

            // Validate file size (10MB max)
            const maxSize = 10 * 1024 * 1024; // 10MB
            if (req.file.size > maxSize) {
                res.status(400).json({
                    success: false,
                    message: 'File size exceeds 10MB limit'
                });
                return;
            }

            loggingService.info('Pre-uploading reference image', {
                component: 'ReferenceImageController',
                operation: 'preUploadReferenceImage',
                userId,
                fileName: req.file.originalname,
                fileSize: req.file.size
            });

            // Upload to S3 with temporary path (will be moved when template is created)
            const tempTemplateId = `temp-${Date.now()}`;
            const { s3Key, s3Url } = await S3Service.uploadReferenceImage(
                tempTemplateId,
                userId,
                req.file.buffer,
                req.file.originalname,
                req.file.mimetype
            );

            res.status(200).json({
                success: true,
                message: 'Reference image pre-uploaded successfully',
                data: {
                    s3Url,
                    s3Key,
                    uploadedAt: new Date(),
                    uploadedBy: userId,
                    fileName: req.file.originalname,
                    fileSize: req.file.size,
                    fileType: req.file.mimetype
                }
            });

        } catch (error) {
            loggingService.error('Error pre-uploading reference image', {
                component: 'ReferenceImageController',
                operation: 'preUploadReferenceImage',
                error: error instanceof Error ? error.message : String(error)
            });

            res.status(500).json({
                success: false,
                message: 'Failed to upload reference image',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Upload reference image for a template
     * POST /api/templates/:templateId/reference-image/upload
     */
    static async uploadReferenceImage(req: any, res: Response): Promise<void> {
        try {
            const { templateId } = req.params;
            const userId = req.user?._id || req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
                return;
            }

            // Check if file was uploaded
            if (!req.file) {
                res.status(400).json({
                    success: false,
                    message: 'No file uploaded'
                });
                return;
            }

            // Validate file type
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.'
                });
                return;
            }

            // Validate file size (10MB max)
            const maxSize = 10 * 1024 * 1024; // 10MB
            if (req.file.size > maxSize) {
                res.status(400).json({
                    success: false,
                    message: 'File size exceeds 10MB limit'
                });
                return;
            }

            // Find template
            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                res.status(404).json({
                    success: false,
                    message: 'Template not found'
                });
                return;
            }

            // Check if user owns template or has access
            if (template.createdBy.toString() !== userId) {
                res.status(403).json({
                    success: false,
                    message: 'Forbidden: You do not have access to this template'
                });
                return;
            }

            // Check if template is visual compliance
            if (!template.isVisualCompliance) {
                res.status(400).json({
                    success: false,
                    message: 'Template is not a visual compliance template'
                });
                return;
            }

            loggingService.info('Uploading reference image', {
                component: 'ReferenceImageController',
                operation: 'uploadReferenceImage',
                templateId,
                userId,
                fileName: req.file.originalname,
                fileSize: req.file.size
            });

            // Upload to S3
            const { s3Key, s3Url } = await S3Service.uploadReferenceImage(
                templateId,
                userId,
                req.file.buffer,
                req.file.originalname,
                req.file.mimetype
            );

            // Update template with reference image info
            template.referenceImage = {
                s3Url,
                s3Key,
                uploadedAt: new Date(),
                uploadedBy: userId,
                extractedFeatures: {
                    extractedAt: new Date(),
                    extractedBy: '',
                    status: 'pending',
                    analysis: {
                        visualDescription: '',
                        structuredData: {
                            colors: { dominant: [], accent: [], background: '' },
                            layout: { composition: '', orientation: '', spacing: '' },
                            objects: [],
                            text: { detected: [], prominent: [], language: '' },
                            lighting: { type: '', direction: '', quality: '' },
                            quality: { sharpness: '', clarity: '', professionalGrade: false }
                        },
                        criteriaAnalysis: []
                    },
                    extractionCost: {
                        initialCallTokens: { input: 0, output: 0, cost: 0 },
                        followUpCalls: [],
                        totalTokens: 0,
                        totalCost: 0
                    },
                    usage: {
                        checksPerformed: 0,
                        totalTokensSaved: 0,
                        totalCostSaved: 0,
                        averageConfidence: 0,
                        lowConfidenceCount: 0
                    }
                }
            };

            await template.save();

            // Log activity
            await Activity.create({
                userId: new mongoose.Types.ObjectId(userId),
                type: 'reference_image_uploaded',
                title: 'Reference Image Uploaded',
                description: `Uploaded reference image for template "${template.name}"`,
                metadata: {
                    templateId: new mongoose.Types.ObjectId(templateId),
                    templateName: template.name,
                    fileName: req.file.originalname,
                    fileSize: req.file.size,
                    s3Key
                }
            });

            // Trigger async feature extraction
            // Don't await this - let it run in background
            ReferenceImageAnalysisService.extractReferenceFeatures(
                s3Url,
                template.variables
                    .filter(v => v.name.startsWith('criterion_'))
                    .map(v => ({
                        name: v.name,
                        text: v.defaultValue || v.description || ''
                    })),
                template.visualComplianceConfig?.industry || 'retail',
                templateId,
                userId
            ).catch(error => {
                loggingService.error('Background feature extraction failed', {
                    component: 'ReferenceImageController',
                    error: error instanceof Error ? error.message : String(error),
                    templateId
                });
            });

            res.status(200).json({
                success: true,
                message: 'Reference image uploaded successfully. Feature extraction started in background.',
                data: template
            });

        } catch (error) {
            loggingService.error('Error uploading reference image', {
                component: 'ReferenceImageController',
                operation: 'uploadReferenceImage',
                error: error instanceof Error ? error.message : String(error)
            });

            res.status(500).json({
                success: false,
                message: 'Failed to upload reference image',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Manually trigger feature extraction
     * POST /api/templates/:templateId/reference-image/extract
     */
    static async triggerExtraction(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('triggerExtraction', req);

            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');
            const { forceRefresh } = req.body;

            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                res.status(404).json({
                    success: false,
                    message: 'Template not found'
                });
                return;
            }

            // Check access
            if (template.createdBy.toString() !== userId) {
                res.status(403).json({
                    success: false,
                    message: 'Forbidden'
                });
                return;
            }

            // Check if reference image exists
            if (!template.referenceImage || !template.referenceImage.s3Url) {
                res.status(400).json({
                    success: false,
                    message: 'No reference image found for this template'
                });
                return;
            }

            // Check if already processing
            if (template.referenceImage.extractedFeatures?.status === 'processing' && !forceRefresh) {
                res.status(409).json({
                    success: false,
                    message: 'Feature extraction already in progress'
                });
                return;
            }

            // Trigger extraction (don't await)
            ReferenceImageAnalysisService.retryExtraction(templateId, userId)
                .catch(error => {
                    loggingService.error('Manual feature extraction failed', {
                        component: 'ReferenceImageController',
                        error: error instanceof Error ? error.message : String(error),
                        templateId
                    });
                });

            ControllerHelper.logRequestSuccess('triggerExtraction', req, startTime, {
                templateId,
                forceRefresh
            });

            res.status(202).json({
                success: true,
                message: 'Feature extraction started',
                data: {
                    templateId,
                    status: 'processing'
                }
            });

        } catch (error) {
            ControllerHelper.handleError('triggerExtraction', error, req, res, startTime);
        }
    }

    /**
     * Get extraction status
     * GET /api/templates/:templateId/reference-image/status
     */
    static async getExtractionStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getExtractionStatus', req);

            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                res.status(404).json({
                    success: false,
                    message: 'Template not found'
                });
                return;
            }

            if (!template.referenceImage) {
                res.status(404).json({
                    success: false,
                    message: 'No reference image found'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getExtractionStatus', req, startTime, {
                templateId,
                status: template.referenceImage.extractedFeatures?.status || 'pending'
            });

            res.status(200).json({
                success: true,
                data: {
                    status: template.referenceImage.extractedFeatures?.status || 'pending',
                    extractedAt: template.referenceImage.extractedFeatures?.extractedAt,
                    extractedBy: template.referenceImage.extractedFeatures?.extractedBy,
                    errorMessage: template.referenceImage.extractedFeatures?.errorMessage,
                    extractionCost: template.referenceImage.extractedFeatures?.extractionCost,
                    usage: template.referenceImage.extractedFeatures?.usage
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getExtractionStatus', error, req, res, startTime);
        }
    }

    /**
     * Stream extraction status updates via SSE
     * GET /api/templates/:templateId/reference-image/stream
     */
    static async streamExtractionStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('streamExtractionStatus', req);

            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            // Verify template exists
            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                res.status(404).json({
                    success: false,
                    message: 'Template not found'
                });
                return;
            }

            // Get origin from request or use default
            const origin = req.headers.origin || 'http://localhost:3000';

            // Set SSE headers with CORS support
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, User-Agent, Accept, Cache-Control, X-Requested-With');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Cache-Control, X-Accel-Buffering');

            // Send initial connection message with current status
            const currentStatus = template.referenceImage?.extractedFeatures?.status || 'pending';
            res.write(`data: ${JSON.stringify({
                type: 'connected',
                message: 'Extraction status stream connected',
                templateId,
                status: currentStatus,
                extractedAt: template.referenceImage?.extractedFeatures?.extractedAt,
                extractedBy: template.referenceImage?.extractedFeatures?.extractedBy,
                usage: template.referenceImage?.extractedFeatures?.usage,
                extractionCost: template.referenceImage?.extractedFeatures?.extractionCost?.totalCost,
                errorMessage: template.referenceImage?.extractedFeatures?.errorMessage
            })}\n\n`);

            // Set up heartbeat to prevent timeout
            const heartbeatInterval = setInterval(() => {
                res.write(`: heartbeat ${Date.now()}\n\n`);
            }, 30000); // Send heartbeat every 30 seconds

            // Listen for extraction status updates
            const extractionEmitter = ReferenceImageAnalysisService.getExtractionEmitter();
            const statusUpdateHandler = (data: any) => {
                // Filter events for this specific template
                if (data.templateId === templateId) {
                    res.write(`data: ${JSON.stringify({
                        type: 'status_update',
                        ...data
                    })}\n\n`);

                    // Close connection when extraction completes or fails
                    if (data.status === 'completed' || data.status === 'failed') {
                        res.write(`data: ${JSON.stringify({
                            type: 'close',
                            message: 'Extraction finished'
                        })}\n\n`);
                        
                        // Clean up and close
                        clearInterval(heartbeatInterval);
                        extractionEmitter.off('status_update', statusUpdateHandler);
                        res.end();

                    }
                }
            };

            extractionEmitter.on('status_update', statusUpdateHandler);

            // Handle client disconnect
            req.on('close', () => {
                clearInterval(heartbeatInterval);
                extractionEmitter.off('status_update', statusUpdateHandler);
            });

            // Set timeout to auto-close after 5 minutes
            const timeout = setTimeout(() => {
                res.write(`data: ${JSON.stringify({
                    type: 'timeout',
                    message: 'Stream timeout - exceeded maximum duration'
                })}\n\n`);
                clearInterval(heartbeatInterval);
                extractionEmitter.off('status_update', statusUpdateHandler);
                res.end();
            }, 300000); // 5 minutes

            // Clean up timeout on manual close
            req.on('close', () => {
                clearTimeout(timeout);
            });

        } catch (error) {
            // Only send JSON error if headers haven't been sent
            if (!res.headersSent) {
                ControllerHelper.handleError('streamExtractionStatus', error, req, res, startTime);
            }
        }
    }

    /**
     * Get extracted features
     * GET /api/templates/:templateId/reference-image/features
     */
    static async getExtractedFeatures(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getExtractedFeatures', req);

            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                res.status(404).json({
                    success: false,
                    message: 'Template not found'
                });
                return;
            }

            if (!template.referenceImage?.extractedFeatures) {
                res.status(404).json({
                    success: false,
                    message: 'No extracted features found'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getExtractedFeatures', req, startTime, {
                templateId
            });

            res.status(200).json({
                success: true,
                data: template.referenceImage.extractedFeatures
            });

        } catch (error) {
            ControllerHelper.handleError('getExtractedFeatures', error, req, res, startTime);
        }
    }

    /**
     * Delete reference image
     * DELETE /api/templates/:templateId/reference-image
     */
    static async deleteReferenceImage(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('deleteReferenceImage', req);

            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                res.status(404).json({
                    success: false,
                    message: 'Template not found'
                });
                return;
            }

            // Check access
            if (template.createdBy.toString() !== userId) {
                res.status(403).json({
                    success: false,
                    message: 'Forbidden'
                });
                return;
            }

            if (!template.referenceImage) {
                res.status(404).json({
                    success: false,
                    message: 'No reference image found'
                });
                return;
            }

            const s3Key = template.referenceImage.s3Key;

            // Delete from S3
            await S3Service.deleteReferenceImage(s3Key);

            // Remove from template
            template.referenceImage = undefined;
            await template.save();

            ControllerHelper.logRequestSuccess('deleteReferenceImage', req, startTime, {
                templateId
            });

            res.status(200).json({
                success: true,
                message: 'Reference image deleted successfully'
            });

        } catch (error) {
            ControllerHelper.handleError('deleteReferenceImage', error, req, res, startTime);
        }
    }

    /**
     * Get cost savings statistics
     * GET /api/templates/:templateId/cost-savings
     */
    static async getCostSavings(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getCostSavings', req);

            const { templateId } = req.params;
            ServiceHelper.validateObjectId(templateId, 'templateId');

            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                res.status(404).json({
                    success: false,
                    message: 'Template not found'
                });
                return;
            }

            if (!template.referenceImage?.extractedFeatures) {
                res.status(404).json({
                    success: false,
                    message: 'No extracted features found'
                });
                return;
            }

            const { extractionCost, usage } = template.referenceImage.extractedFeatures;

            // Calculate break-even status
            const breakEven = usage.totalCostSaved >= extractionCost.totalCost;
            const checksToBreakEven = breakEven ? 0 : 
                Math.ceil((extractionCost.totalCost - usage.totalCostSaved) / 
                    (usage.totalCostSaved / Math.max(usage.checksPerformed, 1)));

            // Calculate ROI
            const roi = extractionCost.totalCost > 0 
                ? ((usage.totalCostSaved - extractionCost.totalCost) / extractionCost.totalCost) * 100 
                : 0;

            ControllerHelper.logRequestSuccess('getCostSavings', req, startTime, {
                templateId,
                netSavings: usage.totalCostSaved - extractionCost.totalCost
            });

            res.status(200).json({
                success: true,
                data: {
                    extractionCost: {
                        totalTokens: extractionCost.totalTokens,
                        totalCost: extractionCost.totalCost
                    },
                    usage: {
                        checksPerformed: usage.checksPerformed,
                        totalTokensSaved: usage.totalTokensSaved,
                        totalCostSaved: usage.totalCostSaved,
                        averageTokensPerCheck: usage.checksPerformed > 0 
                            ? Math.round(usage.totalTokensSaved / usage.checksPerformed)
                            : 0,
                        averageCostPerCheck: usage.checksPerformed > 0
                            ? usage.totalCostSaved / usage.checksPerformed
                            : 0,
                        averageConfidence: usage.averageConfidence,
                        lowConfidenceCount: usage.lowConfidenceCount
                    },
                    savings: {
                        netSavings: usage.totalCostSaved - extractionCost.totalCost,
                        breakEven,
                        checksToBreakEven,
                        roi: Math.round(roi * 100) / 100 // Round to 2 decimals
                    }
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getCostSavings', error, req, res, startTime);
        }
    }
}

