import { Request, Response } from 'express';
import multer from 'multer';
import { S3Service } from '../services/s3.service';
import { UploadedFile } from '../models/UploadedFile';
import { loggingService } from '../services/logging.service';

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
    async uploadFile(req: Request, res: Response): Promise<Response> {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No file provided',
                });
            }

            const userId = (req as any).user?._id || (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                });
            }

            const { buffer, originalname, mimetype, size } = req.file;
            const fileType = originalname.split('.').pop()?.toLowerCase() || 'unknown';

            // Upload to S3
            const { s3Key, presignedUrl } = await S3Service.uploadChatFile(
                userId.toString(),
                originalname,
                buffer,
                mimetype
            );

            // No text extraction - let AI handle file processing directly
            // Save to database
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

            loggingService.info('File uploaded successfully', {
                fileId: uploadedFile._id,
                fileName: originalname,
                fileType,
                fileSize: size,
                userId,
            });

            return res.status(200).json({
                success: true,
                data: {
                    fileId: uploadedFile._id,
                    fileName: originalname,
                    fileSize: size,
                    mimeType: mimetype,
                    fileType,
                    url: presignedUrl,
                    uploadedAt: uploadedFile.uploadedAt,
                },
            });
        } catch (error) {
            loggingService.error('File upload failed', {
                error,
                userId: (req as any).user?._id,
            });

            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'File upload failed',
            });
        }
    }


    /**
     * Delete a file
     */
    async deleteFile(req: Request, res: Response): Promise<Response> {
        try {
            const { fileId } = req.params;
            const userId = (req as any).user?._id || (req as any).user?.id;

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

            loggingService.info('File deleted successfully', {
                fileId,
                fileName: file.fileName,
                userId,
            });

            return res.status(200).json({
                success: true,
                message: 'File deleted successfully',
            });
        } catch (error) {
            loggingService.error('Failed to delete file', {
                error,
                fileId: req.params.fileId,
            });

            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete file',
            });
        }
    }

    /**
     * Get user's uploaded files
     */
    async getUserFiles(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user?._id || (req as any).user?.id;
            const { conversationId } = req.query;

            const query: any = { userId };
            if (conversationId) {
                query.conversationId = conversationId;
            }

            const files = await UploadedFile.find(query)
                .sort({ uploadedAt: -1 })
                .limit(50);

            return res.status(200).json({
                success: true,
                data: files.map((file) => ({
                    fileId: file._id,
                    fileName: file.fileName,
                    fileSize: file.fileSize,
                    mimeType: file.mimeType,
                    fileType: file.fileType,
                    uploadedAt: file.uploadedAt,
                    hasExtractedText: !!file.extractedText,
                })),
            });
        } catch (error) {
            loggingService.error('Failed to get user files', {
                error,
                userId: (req as any).user?._id,
            });

            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get user files',
            });
        }
    }
}

export const fileUploadController = new FileUploadController();

