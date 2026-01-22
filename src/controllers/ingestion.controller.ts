import { Response } from 'express';
import { ingestionService, UploadProgress } from '../services/ingestion.service';
import { DocumentModel } from '../models/Document';
import { loggingService } from '../services/logging.service';
import { S3Service } from '../services/s3.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';


// Allowed file types for document upload
const ALLOWED_FILE_EXTENSIONS = [
    // Documents
    '.md', '.txt', '.pdf', '.doc', '.docx', '.rtf',
    // Data
    '.json', '.csv', '.xlsx', '.xls', '.xml',
    // Code
    '.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.r', '.sql', '.sh', '.bash',
    // Config
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    // Web
    '.html', '.htm',
    // Images (for OCR)
    '.png', '.jpg', '.jpeg', '.webp',
    // Presentations
    '.pptx', '.ppt',
    // Logs
    '.log'
];
const ALLOWED_MIME_TYPES = [
    'text/plain',
    'text/markdown',
    'text/html',
    'text/csv',
    'text/xml',
    'text/x-python',
    'text/x-java',
    'text/x-c',
    'text/x-cpp',
    'text/x-ruby',
    'text/x-php',
    'text/x-sql',
    'text/x-shellscript',
    'text/x-yaml',
    'application/json',
    'application/pdf',
    'application/xml',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'application/octet-stream' // For files without specific mime type
];

/**
 * Validate file upload
 */
function validateFileUpload(fileName: string, fileSize: number, mimeType: string): { valid: boolean; error?: string } {
    // Check file extension
    const ext = fileName.toLowerCase().match(/\.[^.]*$/)?.[0];
    if (!ext || !ALLOWED_FILE_EXTENSIONS.includes(ext)) {
        return {
            valid: false,
            error: `File type not supported. Allowed types: documents (pdf, docx, txt, md, rtf), data (csv, json, xlsx), code (js, ts, py, java, etc.), web (html), images (png, jpg, jpeg, webp)`
        };
    }

    // Different max sizes for images vs documents
    const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    const maxSize = parseInt(process.env.MAX_DOCUMENT_SIZE_MB ?? (isImage ? '25' : '10')) * 1024 * 1024;

    // Check file size
    if (fileSize > maxSize) {
        return {
            valid: false,
            error: `File size exceeds maximum allowed size of ${isImage ? 25 : 10}MB`
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
export const triggerIngestion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { type, userId, since } = req.body as { type?: string; userId?: string; since?: string };
    
    ControllerHelper.logRequestStart('triggerIngestion', req, { type });

    try {

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
export const uploadDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('uploadDocument', req);

    try {

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
 * Check document ingestion status by documentId
 * Returns whether the document exists and how many chunks were created
 */
export const checkDocumentStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId ?? undefined;
    const { documentId } = req.params as { documentId: string };
    
    ControllerHelper.logRequestStart('checkDocumentStatus', req, { documentId });

    try {

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        loggingService.info('Checking document status', {
            component: 'IngestionController',
            operation: 'checkDocumentStatus',
            userId,
            documentId
        });

        // Check for document chunks with any status
        const activeChunks = await DocumentModel.countDocuments({
            'metadata.userId': userId,
            'metadata.documentId': documentId,
            status: 'active'
        });

        const archivedChunks = await DocumentModel.countDocuments({
            'metadata.userId': userId,
            'metadata.documentId': documentId,
            status: 'archived'
        });

        const deletedChunks = await DocumentModel.countDocuments({
            'metadata.userId': userId,
            'metadata.documentId': documentId,
            status: 'deleted'
        });

        const totalChunks = activeChunks + archivedChunks + deletedChunks;

        if (totalChunks === 0) {
            res.json({
                success: true,
                data: {
                    documentId,
                    exists: false,
                    status: 'not_found',
                    message: 'Document not found. It may still be processing or the ingestion may have failed.',
                    activeChunks: 0,
                    archivedChunks: 0,
                    deletedChunks: 0
                }
            });
            return;
        }

        // Get sample chunk for metadata
        const sampleChunk = await DocumentModel.findOne({
            'metadata.userId': userId,
            'metadata.documentId': documentId
        }).select('metadata status createdAt ingestedAt');

        ControllerHelper.logRequestSuccess('checkDocumentStatus', req, startTime, {
            documentId,
            totalChunks
        });

        res.json({
            success: true,
            data: {
                documentId,
                exists: true,
                status: activeChunks > 0 ? 'ready' : (archivedChunks > 0 ? 'archived' : 'deleted'),
                fileName: sampleChunk?.metadata.fileName,
                fileType: sampleChunk?.metadata.fileType,
                fileSize: sampleChunk?.metadata.fileSize,
                source: sampleChunk?.metadata.source,
                createdAt: sampleChunk?.createdAt,
                ingestedAt: sampleChunk?.ingestedAt,
                activeChunks,
                archivedChunks,
                deletedChunks,
                totalChunks,
                message: activeChunks > 0 
                    ? `Document is ready with ${activeChunks} chunks available`
                    : `Document exists but is ${archivedChunks > 0 ? 'archived' : 'deleted'}`
            }
        });

    } catch (error) {
        ControllerHelper.handleError('checkDocumentStatus', error, req, res, startTime, { documentId });
    }
};

/**
 * Get document preview
 */
export const getDocumentPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { documentId } = req.params as { documentId: string };
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getDocumentPreview', req, { documentId });

    try {

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
            .select('metadata.documentId metadata.fileName createdAt')
            .limit(10)
            .sort({ createdAt: -1 });

            // Check if document exists with different status
            const archivedDoc = await DocumentModel.findOne({
                'metadata.userId': userId,
                'metadata.documentId': documentId,
                status: { $ne: 'active' }
            }).select('status');

            const recentDocList = recentDocs.map(d => ({
                documentId: d.metadata.documentId,
                fileName: d.metadata.fileName,
                createdAt: d.createdAt
            }));

            loggingService.warn('Document not found for preview', {
                component: 'IngestionController',
                operation: 'getDocumentPreview',
                userId,
                requestedDocumentId: documentId,
                totalUserDocs: userDocsCount,
                isArchived: !!archivedDoc,
                archivedStatus: archivedDoc?.status,
                recentDocuments: recentDocList
            });

            res.status(404).json({
                success: false,
                message: archivedDoc 
                    ? `Document found but status is "${archivedDoc.status}". Only active documents can be previewed.`
                    : 'Document not found. It may still be processing or the upload may have failed.',
                debug: {
                    requestedDocumentId: documentId,
                    totalDocuments: userDocsCount,
                    isArchived: !!archivedDoc,
                    recentDocuments: recentDocList.slice(0, 5), // Only show 5 in response
                    suggestion: archivedDoc
                        ? 'The document exists but is not active. It may have been deleted or archived.'
                        : 'The document might still be processing. Check the upload progress or try uploading again. Recent document IDs are listed above for reference.'
                }
            });
            return;
        }

        // Combine ALL chunks to show complete document
        const previewText = chunks
            .map(chunk => chunk.content)
            .join('\n\n');

        ControllerHelper.logRequestSuccess('getDocumentPreview', req, startTime, {
            documentId,
            previewChunks: chunks.length
        });

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
        ControllerHelper.handleError('getDocumentPreview', error, req, res, startTime, { documentId });
    }
};

/**
 * Get ingestion job status
 */
export const getJobStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { jobId } = req.params as { jobId: string };
    
    ControllerHelper.logRequestStart('getJobStatus', req, { jobId });

    try {
        const job = ingestionService.getJobStatus(jobId);

        if (!job) {
            res.status(404).json({
                success: false,
                message: 'Job not found'
            });
            return;
        }

        ControllerHelper.logRequestSuccess('getJobStatus', req, startTime, { jobId });

        res.json({
            success: true,
            data: job
        });
    } catch (error) {
        ControllerHelper.handleError('getJobStatus', error, req, res, startTime, { jobId });
    }
};

/**
 * Get ingestion statistics
 */
export const getStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    
    ControllerHelper.logRequestStart('getStats', req);

    try {
        const stats = await ingestionService.getStats(userId ?? undefined);

        ControllerHelper.logRequestSuccess('getStats', req, startTime);

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        ControllerHelper.handleError('getStats', error, req, res, startTime);
    }
};

/**
 * List user's uploaded documents
 */
export const listDocuments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('listDocuments', req, { query: req.query });

    try {

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

        ControllerHelper.logRequestSuccess('listDocuments', req, startTime, {
            total,
            count: documents.length
        });

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
        ControllerHelper.handleError('listDocuments', error, req, res, startTime);
    }
};

/**
 * Delete document
 */
export const deleteDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { id } = req.params as { id: string };
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('deleteDocument', req, { documentId: id });

    try {
        ServiceHelper.validateObjectId(id, 'documentId');

        const success = await ingestionService.deleteDocument(id, userId ?? '');

        if (success) {
            ControllerHelper.logRequestSuccess('deleteDocument', req, startTime, { documentId: id });

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
        ControllerHelper.handleError('deleteDocument', error, req, res, startTime, { documentId: id });
    }
};

/**
 * Reindex all documents (admin only)
 */
export const reindexAll = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    ControllerHelper.logRequestStart('reindexAll', req);

    try {

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

        ControllerHelper.logRequestSuccess('reindexAll', req, startTime, {
            summaryCount: summary.length
        });

        res.json({
            success: true,
            message: 'Reindex completed',
            data: summary
        });
    } catch (error) {
        ControllerHelper.handleError('reindexAll', error, req, res, startTime);
    }
};

/**
 * SSE endpoint for upload progress tracking
 */
export const getUploadProgress = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { uploadId } = req.params as { uploadId: string };
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getUploadProgress', req, { uploadId });

    try {
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

        // SSE connection established - logging handled by event handlers
    } catch (error) {
        if (!res.headersSent) {
            ControllerHelper.handleError('getUploadProgress', error, req, res, startTime, { uploadId });
        }
    }
};

