import { Request, Response } from 'express';
import multer from 'multer';
import { S3Service } from '../services/s3.service';
import { UploadedFile } from '../models/UploadedFile';
import { loggingService } from '../services/logging.service';
import { ChatMessage } from '../models/ChatMessage';
import { ingestionService } from '../services/ingestion.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB limit
    },
});

export const uploadMiddleware = upload.single('file');

class FileUploadController {
    /**
     * Upload a file
     */
    async uploadFile(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return res.status(401).json({
                success: false,
                error: 'Unauthorized',
            });
            const userId = req.userId!;
            ControllerHelper.logRequestStart('uploadFile', req);

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No file provided',
                });
            }

            const { buffer, originalname, mimetype, size } = req.file;
            const fileType = originalname.split('.').pop()?.toLowerCase() || 'unknown';

            // Generate documentId for this upload
            const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Upload to S3
            const { s3Key, presignedUrl } = await S3Service.uploadChatFile(
                userId.toString(),
                originalname,
                buffer,
                mimetype
            );

            // Save to UploadedFile database
            const uploadedFile = new UploadedFile({
                userId,
                fileName: originalname,
                originalName: originalname,
                fileSize: size,
                mimeType: mimetype,
                s3Key,
                fileType,
                uploadedAt: new Date(),
            });

            await uploadedFile.save();

            loggingService.info('File uploaded to S3 and database', {
                fileId: uploadedFile._id,
                fileName: originalname,
                fileType,
                fileSize: size,
                userId,
                documentId,
            });

            // Ingest file into Document collection for RAG search
            try {
                loggingService.info('Starting file ingestion for RAG search', {
                    documentId,
                    fileName: originalname,
                    userId,
                });

                loggingService.info('🔵 BEFORE ingestion - userId check', {
                    userId,
                    userIdType: typeof userId,
                    userIdString: userId.toString(),
                    documentId,
                });

                const ingestionResult = await ingestionService.ingestFileBuffer(
                    buffer,
                    originalname,
                    userId.toString(),
                    {
                        documentId,
                        source: 'user-upload',
                        fileName: originalname,
                        fileType,
                        fileSize: size,
                        conversationId: undefined, // Not attached to conversation yet
                    }
                );

                ControllerHelper.logRequestSuccess('uploadFile', req, startTime, {
                    fileId: uploadedFile._id,
                    documentId,
                    chunksCreated: ingestionResult.documentsIngested
                });

                return res.status(200).json({
                    success: true,
                    data: {
                        fileId: uploadedFile._id,
                        documentId, // Include documentId for frontend to track
                        fileName: originalname,
                        fileSize: size,
                        mimeType: mimetype,
                        fileType,
                        url: presignedUrl,
                        uploadedAt: uploadedFile.uploadedAt,
                        ingested: true,
                        chunksCreated: ingestionResult.documentsIngested,
                    },
                });
            } catch (ingestionError) {
                // Return success for upload but indicate ingestion failure
                ControllerHelper.logRequestSuccess('uploadFile', req, startTime, {
                    fileId: uploadedFile._id,
                    documentId,
                    ingested: false
                });

                return res.status(200).json({
                    success: true,
                    data: {
                        fileId: uploadedFile._id,
                        documentId,
                        fileName: originalname,
                        fileSize: size,
                        mimeType: mimetype,
                        fileType,
                        url: presignedUrl,
                        uploadedAt: uploadedFile.uploadedAt,
                        ingested: false,
                        ingestionError: ingestionError instanceof Error ? ingestionError.message : 'Unknown error',
                    },
                });
            }
        } catch (error) {
            ControllerHelper.handleError('uploadFile', error, req, res, startTime);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'File upload failed',
            });
        }
    }


    /**
     * Delete a file
     */
    async deleteFile(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return res.status(401).json({
                success: false,
                error: 'Unauthorized',
            });
            const userId = req.userId!;
            ControllerHelper.logRequestStart('deleteFile', req);

            const { fileId } = req.params;
            ServiceHelper.validateObjectId(fileId, 'fileId');

            const file = await UploadedFile.findOne({
                _id: fileId,
                userId,
            });

            if (!file) {
                return res.status(404).json({
                    success: false,
                    error: 'File not found',
                });
            }

            // Delete from S3
            await S3Service.deleteChatFile(file.s3Key);

            // Delete from database
            await UploadedFile.deleteOne({ _id: fileId });

            ControllerHelper.logRequestSuccess('deleteFile', req, startTime, {
                fileId
            });

            return res.status(200).json({
                success: true,
                message: 'File deleted successfully',
            });
        } catch (error) {
            ControllerHelper.handleError('deleteFile', error, req, res, startTime);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete file',
            });
        }
    }

    /**
     * Get user's uploaded files
     */
    async getUserFiles(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return res.status(401).json({
                success: false,
                error: 'Unauthorized',
            });
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getUserFiles', req);

            const { conversationId } = req.query;

            const query: any = { userId };
            if (conversationId) {
                ServiceHelper.validateObjectId(conversationId as string, 'conversationId');
                query.conversationId = conversationId;
            }

            const files = await UploadedFile.find(query)
                .sort({ uploadedAt: -1 })
                .limit(50);

            // Generate presigned URLs for each file
            const filesWithUrls = await Promise.all(
                files.map(async (file) => {
                    const url = await S3Service.generatePresignedUrl(file.s3Key, 3600);
                    return {
                        fileId: String(file._id),
                        fileName: file.fileName,
                        fileSize: file.fileSize,
                        mimeType: file.mimeType,
                        fileType: file.fileType,
                        uploadedAt: file.uploadedAt,
                        hasExtractedText: !!file.extractedText,
                        url, // Add the S3 presigned URL
                        conversationId: file.conversationId?.toString(),
                    };
                })
            );

            ControllerHelper.logRequestSuccess('getUserFiles', req, startTime, {
                filesCount: filesWithUrls.length
            });

            return res.status(200).json({
                success: true,
                data: filesWithUrls,
            });
        } catch (error) {
            ControllerHelper.handleError('getUserFiles', error, req, res, startTime);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get user files',
            });
        }
    }

    /**
     * Get ALL user's files from all sources (uploaded, Google Drive, and documents)
     */
    async getAllUserFiles(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return res.status(401).json({
                success: false,
                error: 'Unauthorized',
            });
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getAllUserFiles', req);

            const { conversationId } = req.query;

            const allFiles: any[] = [];

            // 1. Get uploaded files
            const uploadQuery: any = { userId };
            if (conversationId) {
                ServiceHelper.validateObjectId(conversationId as string, 'conversationId');
                uploadQuery.conversationId = conversationId;
            }

            const uploadedFiles = await UploadedFile.find(uploadQuery)
                .sort({ uploadedAt: -1 })
                .limit(100);

            for (const file of uploadedFiles) {
                const url = await S3Service.generatePresignedUrl(file.s3Key, 3600);
                allFiles.push({
                    id: String(file._id),
                    name: file.fileName,
                    size: file.fileSize,
                    type: 'uploaded',
                    mimeType: file.mimeType,
                    fileType: file.fileType,
                    url,
                    uploadedAt: file.uploadedAt,
                    source: 'Uploaded',
                    conversationId: file.conversationId?.toString(),
                });
            }

            // 2. Get Google Drive files and attached documents from chat messages
            const messageQuery: any = { userId };
            if (conversationId) {
                messageQuery.conversationId = conversationId;
            }

            const messages = await ChatMessage.find(messageQuery)
                .select('attachments attachedDocuments conversationId createdAt')
                .sort({ createdAt: -1 })
                .limit(500);

            const seenGoogleFiles = new Set<string>();
            const seenDocuments = new Set<string>();

            for (const message of messages) {
                // Process Google Drive attachments
                if (message.attachments) {
                    for (const att of message.attachments) {
                        if (att.type === 'google') {
                            const fileId = att.googleFileId || att.fileId;
                            if (!seenGoogleFiles.has(fileId)) {
                                seenGoogleFiles.add(fileId);
                                allFiles.push({
                                    id: fileId,
                                    name: att.fileName,
                                    size: att.fileSize || 0,
                                    type: 'google',
                                    mimeType: att.mimeType,
                                    fileType: att.fileType,
                                    url: att.webViewLink || att.url,
                                    uploadedAt: att.createdTime ? new Date(att.createdTime) : message.createdAt,
                                    source: 'Google Drive',
                                    conversationId: message.conversationId?.toString(),
                                });
                            }
                        }
                    }
                }

                // Process attached documents
                if (message.attachedDocuments) {
                    for (const doc of message.attachedDocuments) {
                        if (!seenDocuments.has(doc.documentId)) {
                            seenDocuments.add(doc.documentId);
                            allFiles.push({
                                id: doc.documentId,
                                name: doc.fileName,
                                size: 0,
                                type: 'document',
                                fileType: doc.fileType,
                                uploadedAt: message.createdAt,
                                source: 'Document',
                                chunksCount: doc.chunksCount,
                                documentId: doc.documentId,
                                conversationId: message.conversationId?.toString(),
                            });
                        }
                    }
                }
            }

            // Sort all files by uploadedAt descending
            allFiles.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

            ControllerHelper.logRequestSuccess('getAllUserFiles', req, startTime, {
                filesCount: allFiles.length
            });

            return res.status(200).json({
                success: true,
                data: allFiles,
            });
        } catch (error) {
            ControllerHelper.handleError('getAllUserFiles', error, req, res, startTime);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get all user files',
            });
        }
    }
}

export const fileUploadController = new FileUploadController();

