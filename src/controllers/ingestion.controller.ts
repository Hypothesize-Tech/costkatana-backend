import { Response } from 'express';
import { ingestionService } from '../services/ingestion.service';
import { DocumentModel } from '../models/Document';
import { loggingService } from '../services/logging.service';
import { S3Service } from '../services/s3.service';

// Request interface with userId from auth middleware
export interface AuthenticatedRequest {
    userId?: string;
    body: any;
    params: any;
    query: any;
}

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
export const triggerIngestion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
export const uploadDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

        // Process and ingest file
        const result = await ingestionService.ingestFileBuffer(
            fileBuffer,
            fileName,
            userId,
            {
                projectId,
                tags: tags ? tags.split(',').map((t: string) => t.trim()) : [],
                customMetadata: {
                    description,
                    uploadedAt: new Date(),
                    s3Key,
                    s3Url
                }
            }
        );

        if (result.success) {
            res.json({
                success: true,
                message: 'Document uploaded and ingested successfully',
                data: {
                    documentId: result.documentId,
                    fileName,
                    documentsCreated: result.documentsIngested,
                    duration: result.duration,
                    s3Key,
                    s3Url
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Document ingestion failed',
                errors: result.errors
            });
        }
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
export const getUserDocuments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
export const getDocumentPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

        // Get first few chunks of the document
        const chunks = await DocumentModel.find({
            'metadata.userId': userId,
            'metadata.documentId': documentId,
            status: 'active'
        })
        .sort({ chunkIndex: 1 })
        .limit(3)
        .select('content metadata chunkIndex totalChunks');

        if (!chunks || chunks.length === 0) {
            res.status(404).json({
                success: false,
                message: 'Document not found'
            });
            return;
        }

        // Combine first chunks for preview (up to 1000 chars)
        const previewText = chunks
            .map(chunk => chunk.content)
            .join('\n')
            .substring(0, 1000);

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
export const getJobStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
export const getStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
export const listDocuments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
export const deleteDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
export const reindexAll = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

