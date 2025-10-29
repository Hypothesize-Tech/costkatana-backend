import { Response } from 'express';
import { ingestionService, UploadProgress } from '../services/ingestion.service';
import { DocumentModel } from '../models/Document';
import { loggingService } from '../services/logging.service';
import { S3Service } from '../services/s3.service';


// Allowed file types for document upload
const ALLOWED_FILE_EXTENSIONS = ['.md', '.txt', '.pdf', '.json', '.csv', '.ts', '.js', '.py', '.java', '.cpp', '.go', '.rs', '.rb', '.doc', '.docx'];
const ALLOWED_MIME_TYPES = [
    'text/plain',
    'text/markdown',
    'application/json',
    'application/pdf',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream' // For files without specific mime type
];

/**
 * Validate file upload
 */
function validateFileUpload(fileName: string, fileSize: number, mimeType: string): { valid: boolean; error?: string } {
    const maxSize = parseInt(process.env.MAX_DOCUMENT_SIZE_MB ?? '10') * 1024 * 1024;

    // Check file size
    if (fileSize > maxSize) {
        return {
            valid: false,
            error: `File size exceeds maximum allowed size of ${process.env.MAX_DOCUMENT_SIZE_MB ?? '10'}MB`
        };
    }

    // Check file extension
    const ext = fileName.toLowerCase().match(/\.[^.]*$/)?.[0];
    if (!ext || !ALLOWED_FILE_EXTENSIONS.includes(ext)) {
        return {
            valid: false,
            error: `File type not supported. Allowed types: ${ALLOWED_FILE_EXTENSIONS.join(', ')}`
        };
    }

    // Check mime type (relaxed check)
    if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType)) {
        // Allow if extension is valid even if mime type doesn't match
        loggingService.warn('File uploaded with unexpected mime type but valid extension', {
            fileName,
            mimeType,
            ext
        });
    }

    return { valid: true };
}

/**
 * Trigger manual ingestion (admin only)
 */
export const triggerIngestion = async (req: any, res: Response): Promise<void> => {
    try {
        const { type, userId, since } = req.body as { type?: string; userId?: string; since?: string };

        loggingService.info('Manual ingestion triggered', {
            component: 'IngestionController',
            operation: 'triggerIngestion',
            type,
            userId,
            triggeredBy: req.userId
        });

        let result;

        switch (type) {
            case 'knowledge-base':
                result = await ingestionService.ingestKnowledgeBase();
                break;
            case 'conversations':
                result = await ingestionService.ingestConversations(userId, since ? new Date(since) : undefined);
                break;
            case 'telemetry':
                result = await ingestionService.ingestTelemetry(userId, since ? new Date(since) : undefined);
                break;
            default:
                res.status(400).json({
                    success: false,
                    message: 'Invalid ingestion type. Allowed: knowledge-base, conversations, telemetry'
                });
                return;
        }

        res.json({
            success: result.success,
            data: {
                documentsIngested: result.documentsIngested,
                duration: result.duration,
                errors: result.errors
            }
        });
    } catch (error) {
        loggingService.error('Manual ingestion failed', {
            component: 'IngestionController',
            operation: 'triggerIngestion',
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Ingestion failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Upload custom document (with S3 storage)
 * Expects base64 encoded file in request body
 */
export const uploadDocument = async (req: any, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        const { fileName, fileData, mimeType, projectId, tags, description } = req.body as {
            fileName?: string;
            fileData?: string;
            mimeType?: string;
            projectId?: string;
            tags?: string;
            description?: string;
        };

        if (!fileName || !fileData) {
            res.status(400).json({
                success: false,
                message: 'fileName and fileData are required'
            });
            return;
        }

        // Decode base64 file data
        let fileBuffer: Buffer;
        try {
            fileBuffer = Buffer.from(fileData, 'base64');
        } catch (error) {
            res.status(400).json({
                success: false,
                message: 'Invalid file data format. Expected base64 encoded string.'
            });
            return;
        }

        // Validate file
        const validation = validateFileUpload(fileName, fileBuffer.length, mimeType || 'application/octet-stream');
        if (!validation.valid) {
            res.status(400).json({
                success: false,
                message: validation.error
            });
            return;
        }

        loggingService.info('Document upload initiated', {
            component: 'IngestionController',
            operation: 'uploadDocument',
            userId,
            fileName,
            fileSize: fileBuffer.length
        });

        // Upload to S3 with user-specific folder structure
        const { s3Key, s3Url } = await S3Service.uploadDocument(
            userId,
            fileName,
            fileBuffer,
            mimeType || 'application/octet-stream',
            {
                projectId: projectId || '',
                tags: tags || '',
                description: description || ''
            }
        );

        // Generate document ID and upload ID immediately
        const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Emit initial progress
        ingestionService.emitProgress({
            uploadId,
            stage: 'preparing',
            progress: 10,
            message: 'Preparing document for processing...',
            totalChunks: 0,
            processedChunks: 0
        });

        // Start background processing ASYNCHRONOUSLY (don't await!)
        ingestionService.ingestFileBuffer(
            fileBuffer,
            fileName,
            userId,
            {
                projectId,
                documentId,
                tags: tags ? tags.split(',').map((t: string) => t.trim()) : [],
                customMetadata: {
                    description,
                    uploadedAt: new Date(),
                    s3Key,
                    s3Url
                }
            },
            uploadId
        ).then((ingestionResult) => {
            if (ingestionResult.success) {
                loggingService.info('Document ingestion completed successfully (background)', {
                    component: 'IngestionController',
                    operation: 'uploadDocument',
                    documentId,
                    uploadId,
                    fileName,
                    chunksCreated: ingestionResult.documentsIngested,
                    duration: ingestionResult.duration
                });

                // Emit final completion event
                ingestionService.emitProgress({
                    uploadId,
                    stage: 'complete',
                    progress: 100,
                    message: 'Document processing complete!',
                    totalChunks: ingestionResult.documentsIngested,
                    processedChunks: ingestionResult.documentsIngested
                });
            } else {
                loggingService.error('Document ingestion failed (background)', {
                    component: 'IngestionController',
                    operation: 'uploadDocument',
                    documentId,
                    fileName,
                    errors: ingestionResult.errors
                });

                // Emit error event
                ingestionService.emitProgress({
                    uploadId,
                    stage: 'error',
                    progress: 0,
                    message: 'Document processing failed',
                    error: ingestionResult.errors.join(', ')
                });
            }
        }).catch((error) => {
            loggingService.error('Document ingestion crashed (background)', {
                component: 'IngestionController',
                operation: 'uploadDocument',
                documentId,
                fileName,
                error: error instanceof Error ? error.message : String(error)
            });

            // Emit error event
            ingestionService.emitProgress({
                uploadId,
                stage: 'error',
                progress: 0,
                message: 'Document processing crashed',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        });

        // Return response IMMEDIATELY with uploadId for SSE tracking
        loggingService.info('Document upload initiated, processing in background', {
            component: 'IngestionController',
            operation: 'uploadDocument',
            documentId,
            uploadId,
            fileName
        });

        res.json({
            success: true,
            message: 'Document uploaded successfully, processing in background',
            data: {
                documentId,
                uploadId,
                fileName,
                status: 'processing',
                s3Key,
                s3Url
            }
        });
    } catch (error) {
        loggingService.error('Document upload failed', {
            component: 'IngestionController',
            operation: 'uploadDocument',
            userId: req.userId,
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Upload failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get user's uploaded documents
 */
export const getUserDocuments = async (req: any, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        // Get distinct documents for this user
        const documents = await DocumentModel.aggregate([
            {
                $match: {
                    'metadata.userId': userId,
                    'metadata.documentId': { $exists: true },
                    status: 'active'
                }
            },
            {
                $group: {
                    _id: '$metadata.documentId',
                    fileName: { $first: '$metadata.fileName' },
                    fileType: { $first: '$metadata.fileType' },
                    uploadDate: { $first: '$ingestedAt' },
                    chunksCount: { $sum: 1 },
                    s3Key: { $first: '$metadata.s3Key' },
                    tags: { $first: '$metadata.tags' },
                    description: { $first: '$metadata.description' }
                }
            },
            {
                $sort: { uploadDate: -1 }
            },
            {
                $limit: 100 // Limit to last 100 documents
            }
        ]);

        res.json({
            success: true,
            data: documents.map(doc => ({
                documentId: doc._id,
                fileName: doc.fileName,
                fileType: doc.fileType,
                uploadDate: doc.uploadDate,
                chunksCount: doc.chunksCount,
                s3Key: doc.s3Key,
                tags: doc.tags || [],
                description: doc.description
            }))
        });

    } catch (error) {
        loggingService.error('Get user documents failed', {
            component: 'IngestionController',
            operation: 'getUserDocuments',
            userId: req.userId,
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get documents',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get document preview
 */
export const getDocumentPreview = async (req: any, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { documentId } = req.params as { documentId: string };

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        loggingService.info('Fetching document preview', {
            component: 'IngestionController',
            operation: 'getDocumentPreview',
            userId,
            documentId
        });

        // Get ALL chunks of the document for complete preview
        const chunks = await DocumentModel.find({
            'metadata.userId': userId,
            'metadata.documentId': documentId,
            status: 'active'
        })
        .sort({ chunkIndex: 1 })
        .select('content metadata chunkIndex totalChunks');

        if (!chunks || chunks.length === 0) {
            // Log what documents exist for this user to debug
            const userDocsCount = await DocumentModel.countDocuments({
                'metadata.userId': userId,
                status: 'active'
            });
            
            const recentDocs = await DocumentModel.find({
                'metadata.userId': userId,
                status: 'active'
            })
            .select('metadata.documentId metadata.fileName')
            .limit(5)
            .sort({ createdAt: -1 });

            loggingService.warn('Document not found for preview', {
                component: 'IngestionController',
                operation: 'getDocumentPreview',
                userId,
                requestedDocumentId: documentId,
                totalUserDocs: userDocsCount,
                recentDocuments: recentDocs.map(d => ({
                    documentId: d.metadata.documentId,
                    fileName: d.metadata.fileName
                }))
            });

            res.status(404).json({
                success: false,
                message: 'Document not found. It may still be processing.',
                debug: {
                    requestedDocumentId: documentId,
                    totalDocuments: userDocsCount,
                    suggestion: 'The document might still be processing. Please wait a moment and try again.'
                }
            });
            return;
        }

        // Combine ALL chunks to show complete document
        const previewText = chunks
            .map(chunk => chunk.content)
            .join('\n\n');

        res.json({
            success: true,
            data: {
                documentId,
                fileName: chunks[0].metadata.fileName,
                fileType: chunks[0].metadata.fileType,
                preview: previewText,
                totalChunks: chunks[0].totalChunks,
                previewChunks: chunks.length
            }
        });

    } catch (error) {
        loggingService.error('Get document preview failed', {
            component: 'IngestionController',
            operation: 'getDocumentPreview',
            userId: req.userId,
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get document preview',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get ingestion job status
 */
export const getJobStatus = async (req: any, res: Response): Promise<void> => {
    try {
        const { jobId } = req.params as { jobId: string };

        const job = ingestionService.getJobStatus(jobId);

        if (!job) {
            res.status(404).json({
                success: false,
                message: 'Job not found'
            });
            return;
        }

        res.json({
            success: true,
            data: job
        });
    } catch (error) {
        loggingService.error('Get job status failed', {
            component: 'IngestionController',
            operation: 'getJobStatus',
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get job status',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get ingestion statistics
 */
export const getStats = async (req: any, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        const stats = await ingestionService.getStats(userId ?? undefined);

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        loggingService.error('Get ingestion stats failed', {
            component: 'IngestionController',
            operation: 'getStats',
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get statistics',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * List user's uploaded documents
 */
export const listDocuments = async (req: any, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        const { limit = 20, skip = 0, source } = req.query as { 
            limit?: string | number; 
            skip?: string | number; 
            source?: string 
        };

        const query: Record<string, any> = {
            'metadata.userId': userId,
            status: 'active'
        };

        if (source) {
            query['metadata.source'] = source;
        }

        const documents = await DocumentModel.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit as string))
            .skip(parseInt(skip as string))
            .select('metadata.fileName metadata.source metadata.fileSize createdAt chunkIndex totalChunks');

        const total = await DocumentModel.countDocuments(query);

        res.json({
            success: true,
            data: {
                documents,
                total,
                limit: parseInt(limit as string),
                skip: parseInt(skip as string)
            }
        });
    } catch (error) {
        loggingService.error('List documents failed', {
            component: 'IngestionController',
            operation: 'listDocuments',
            userId: req.userId,
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Failed to list documents',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Delete document
 */
export const deleteDocument = async (req: any, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params as { id: string };

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        const success = await ingestionService.deleteDocument(id, userId ?? '');

        if (success) {
            res.json({
                success: true,
                message: 'Document deleted successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Document not found or access denied'
            });
        }
    } catch (error) {
        loggingService.error('Delete document failed', {
            component: 'IngestionController',
            operation: 'deleteDocument',
            userId: req.userId,
            documentId: req.params.id,
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Failed to delete document',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Reindex all documents (admin only)
 */
export const reindexAll = async (req: any, res: Response): Promise<void> => {
    try {
        loggingService.info('Full reindex initiated', {
            component: 'IngestionController',
            operation: 'reindexAll',
            triggeredBy: req.userId
        });

        // Start all ingestion tasks
        const results = await Promise.allSettled([
            ingestionService.ingestKnowledgeBase(),
            ingestionService.ingestConversations(),
            ingestionService.ingestTelemetry()
        ]);

        const summary = results.map((result, index) => {
            const type = ['knowledge-base', 'conversations', 'telemetry'][index];
            if (result.status === 'fulfilled') {
                return {
                    type,
                    success: result.value.success,
                    documentsIngested: result.value.documentsIngested,
                    duration: result.value.duration,
                    errors: result.value.errors
                };
            } else {
                return {
                    type,
                    success: false,
                    error: result.reason
                };
            }
        });

        res.json({
            success: true,
            message: 'Reindex completed',
            data: summary
        });
    } catch (error) {
        loggingService.error('Reindex failed', {
            component: 'IngestionController',
            operation: 'reindexAll',
            error: error instanceof Error ? error.message : String(error)
        });

        res.status(500).json({
            success: false,
            message: 'Reindex failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * SSE endpoint for upload progress tracking
 */
export const getUploadProgress = async (req: any, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { uploadId } = req.params as { uploadId: string };

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        if (!uploadId) {
            res.status(400).json({
                success: false,
                message: 'uploadId is required'
            });
            return;
        }

        // Set headers for SSE with comprehensive CORS support
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        
        // Get origin from request or use default
        const origin = req.headers.origin || 'http://localhost:3000';
        
        // CORS headers for SSE - must use specific origin when credentials are true
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, User-Agent, Accept, Cache-Control, X-Requested-With');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Cache-Control, X-Accel-Buffering');

        // Send initial connection message
        res.write(`data: ${JSON.stringify({ uploadId, stage: 'connected', progress: 0, message: 'Connected to progress stream' })}\n\n`);

        // Set up keep-alive heartbeat to prevent timeout
        const heartbeatInterval = setInterval(() => {
            res.write(`: heartbeat ${Date.now()}\n\n`);
        }, 15000); // Send heartbeat every 15 seconds

        // Listen for progress events
        const progressHandler = (progress: UploadProgress) => {
            try {
                res.write(`data: ${JSON.stringify(progress)}\n\n`);
                
                // Close connection when complete or error
                if (progress.stage === 'complete' || progress.stage === 'error') {
                    // Clear heartbeat interval
                    clearInterval(heartbeatInterval);
                    
                    // Wait a bit before closing to ensure client receives the message
                    setTimeout(() => {
                        ingestionService.offProgress(uploadId, progressHandler);
                        res.end();
                    }, 500);
                }
            } catch (writeError) {
                loggingService.error('Failed to write SSE progress', {
                    component: 'IngestionController',
                    operation: 'getUploadProgress',
                    uploadId,
                    error: writeError instanceof Error ? writeError.message : String(writeError)
                });
            }
        };

        ingestionService.onProgress(uploadId, progressHandler);

        // Handle client disconnect
        req.on('close', () => {
            clearInterval(heartbeatInterval);
            ingestionService.offProgress(uploadId, progressHandler);
            
            loggingService.info('SSE connection closed for upload progress', {
                component: 'IngestionController',
                operation: 'getUploadProgress',
                uploadId,
                userId
            });
            
            if (!res.writableEnded) {
                res.end();
            }
        });

        // Handle response errors
        res.on('error', (error) => {
            clearInterval(heartbeatInterval);
            ingestionService.offProgress(uploadId, progressHandler);
            
            loggingService.error('SSE response error for upload progress', {
                component: 'IngestionController',
                operation: 'getUploadProgress',
                uploadId,
                userId,
                error: error.message
            });
        });

        loggingService.info('SSE connection established for upload progress', {
            component: 'IngestionController',
            operation: 'getUploadProgress',
            userId,
            uploadId
        });

    } catch (error) {
        loggingService.error('Upload progress SSE failed', {
            component: 'IngestionController',
            operation: 'getUploadProgress',
            error: error instanceof Error ? error.message : String(error)
        });

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Failed to establish progress stream',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
};

