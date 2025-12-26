import { s3Client } from '../config/aws';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AWS_CONFIG } from '../config/aws';
import { loggingService } from './logging.service';

export class S3Service {
    static async getPresignedAvatarUploadUrl(
        userId: string,
        fileName: string,
        fileType: string
    ): Promise<{ uploadUrl: string; key: string }> {
        const key = `avatars/${userId}/${fileName}`;

        const command = new PutObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: key,
            ContentType: fileType,
        });

        try {
            const uploadUrl = await getSignedUrl(s3Client, command, {
                expiresIn: 3600, // 1 hour
            });
            return { uploadUrl, key };
        } catch (error) {
            loggingService.error('Error creating pre-signed URL', { error, userId, fileName });
            throw new Error('Could not create pre-signed URL for S3 upload.');
        }
    }

    /**
     * Upload document to S3 with user-specific folder structure
     */
    static async uploadDocument(
        userId: string,
        fileName: string,
        fileBuffer: Buffer,
        fileType: string,
        metadata?: Record<string, string>
    ): Promise<{ s3Key: string; s3Url: string }> {
        // Create folder structure: documents/{userId}/{fileName}
        const timestamp = Date.now();
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `documents/${userId}/${timestamp}-${sanitizedFileName}`;

        const command = new PutObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: key,
            Body: fileBuffer,
            ContentType: fileType,
            Metadata: {
                userId,
                originalFileName: fileName,
                uploadDate: new Date().toISOString(),
                ...metadata
            }
        });

        try {
            await s3Client.send(command);

            const s3Url = `s3://${AWS_CONFIG.s3.bucketName}/${key}`;

            loggingService.info('Document uploaded to S3', {
                component: 'S3Service',
                operation: 'uploadDocument',
                userId,
                fileName,
                s3Key: key,
                fileSize: fileBuffer.length
            });

            return { s3Key: key, s3Url };
        } catch (error) {
            loggingService.error('Error uploading document to S3', {
                component: 'S3Service',
                operation: 'uploadDocument',
                error: error instanceof Error ? error.message : String(error),
                userId,
                fileName
            });
            throw new Error('Could not upload document to S3.');
        }
    }

    /**
     * Convert S3 URL to S3 key
     */
    static s3UrlToKey(s3Url: string): string {
        // Convert s3://bucket-name/path/to/file to path/to/file
        const match = s3Url.match(/^s3:\/\/[^/]+\/(.+)$/);
        if (match) {
            return match[1];
        }
        // If it's already a key (no s3:// prefix), return as-is
        return s3Url;
    }

    /**
     * Get presigned download URL for a document
     */
    static async getPresignedDocumentUrl(
        s3Key: string,
        expiresIn: number = 3600
    ): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: s3Key
        });

        try {
            const url = await getSignedUrl(s3Client, command, { expiresIn });
            return url;
        } catch (error) {
            loggingService.error('Error creating presigned download URL', {
                component: 'S3Service',
                operation: 'getPresignedDocumentUrl',
                error: error instanceof Error ? error.message : String(error),
                s3Key
            });
            throw new Error('Could not create presigned download URL.');
        }
    }

    /**
     * Download document from S3
     */
    static async downloadDocument(s3Key: string): Promise<Buffer> {
        const command = new GetObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: s3Key
        });

        try {
            const response = await s3Client.send(command);
            
            // Convert stream to buffer
            const chunks: Buffer[] = [];
            if (response.Body) {
                // @ts-expect-error - Body is a ReadableStream which is not fully typed
                for await (const chunk of response.Body) {
                    chunks.push(Buffer.from(chunk));
                }
            }
            
            return Buffer.concat(chunks);
        } catch (error) {
            loggingService.error('Error downloading document from S3', {
                component: 'S3Service',
                operation: 'downloadDocument',
                error: error instanceof Error ? error.message : String(error),
                s3Key
            });
            throw new Error('Could not download document from S3.');
        }
    }

    /**
     * Upload reference image for visual compliance template
     */
    static async uploadReferenceImage(
        templateId: string,
        userId: string,
        fileBuffer: Buffer,
        fileName: string,
        fileType: string
    ): Promise<{ s3Key: string; s3Url: string }> {
        const timestamp = Date.now();
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `reference-images/${userId}/${templateId}/${timestamp}-${sanitizedFileName}`;

        // Sanitize metadata values - S3 metadata must be ASCII
        const sanitizedMetadata = {
            userId,
            templateId,
            originalFileName: fileName.replace(/[^\x00-\x7F]/g, ''), // Remove non-ASCII characters
            uploadDate: new Date().toISOString(),
            type: 'reference-image'
        };

        const command = new PutObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: key,
            Body: fileBuffer,
            ContentType: fileType,
            Metadata: sanitizedMetadata
        });

        try {
            await s3Client.send(command);

            const s3Url = `s3://${AWS_CONFIG.s3.bucketName}/${key}`;

            loggingService.info('Reference image uploaded to S3', {
                component: 'S3Service',
                operation: 'uploadReferenceImage',
                userId,
                templateId,
                fileName,
                s3Key: key,
                fileSize: fileBuffer.length
            });

            return { s3Key: key, s3Url };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorDetails = error instanceof Error ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
                ...(error as any)
            } : error;
            
            loggingService.error('Error uploading reference image to S3', {
                component: 'S3Service',
                operation: 'uploadReferenceImage',
                error: errorMessage,
                errorDetails,
                bucket: AWS_CONFIG.s3.bucketName,
                region: AWS_CONFIG.s3.region,
                userId,
                templateId,
                fileName
            });
            
            // Throw the original error message for better debugging
            throw new Error(`S3 Upload Error: ${errorMessage}`);
        }
    }

    /**
     * Delete reference image from S3
     */
    static async deleteReferenceImage(s3Key: string): Promise<void> {
        const command = new DeleteObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: s3Key
        });

        try {
            await s3Client.send(command);

            loggingService.info('Reference image deleted from S3', {
                component: 'S3Service',
                operation: 'deleteReferenceImage',
                s3Key
            });
        } catch (error) {
            loggingService.error('Error deleting reference image from S3', {
                component: 'S3Service',
                operation: 'deleteReferenceImage',
                error: error instanceof Error ? error.message : String(error),
                s3Key
            });
            throw new Error('Could not delete reference image from S3.');
        }
    }

    /**
     * Generate presigned URL for reference image with custom expiration
     */
    static async generatePresignedUrl(s3Key: string, expiresIn: number = 3600): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: s3Key
        });

        try {
            const url = await getSignedUrl(s3Client, command, { expiresIn });
            
            loggingService.info('Presigned URL generated for reference image', {
                component: 'S3Service',
                operation: 'generatePresignedUrl',
                s3Key,
                expiresIn
            });

            return url;
        } catch (error) {
            loggingService.error('Error generating presigned URL', {
                component: 'S3Service',
                operation: 'generatePresignedUrl',
                error: error instanceof Error ? error.message : String(error),
                s3Key
            });
            throw new Error('Could not generate presigned URL.');
        }
    }

    /**
     * Upload a chat attachment file to S3
     */
    static async uploadChatFile(
        userId: string,
        fileName: string,
        fileBuffer: Buffer,
        mimeType: string
    ): Promise<{ s3Key: string; presignedUrl: string }> {
        const timestamp = Date.now();
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `chat-uploads/${userId}/${timestamp}-${sanitizedFileName}`;

        const command = new PutObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: key,
            Body: fileBuffer,
            ContentType: mimeType,
            Metadata: {
                userId,
                originalFileName: fileName,
                uploadedAt: new Date().toISOString(),
            }
        });

        try {
            await s3Client.send(command);

            // Generate presigned URL for 7 days
            const presignedUrl = await S3Service.generatePresignedUrl(key, 7 * 24 * 60 * 60);

            loggingService.info('Chat file uploaded to S3', {
                component: 'S3Service',
                operation: 'uploadChatFile',
                userId,
                fileName,
                s3Key: key,
                fileSize: fileBuffer.length
            });

            return { s3Key: key, presignedUrl };
        } catch (error) {
            loggingService.error('Error uploading chat file to S3', {
                component: 'S3Service',
                operation: 'uploadChatFile',
                error: error instanceof Error ? error.message : String(error),
                userId,
                fileName
            });
            throw new Error('Could not upload chat file to S3.');
        }
    }

    /**
     * Get file buffer from S3 (for text extraction)
     */
    static async getFileBuffer(s3Key: string): Promise<Buffer> {
        try {
            return await S3Service.downloadDocument(s3Key);
        } catch (error) {
            loggingService.error('Error getting file buffer from S3', {
                component: 'S3Service',
                operation: 'getFileBuffer',
                error: error instanceof Error ? error.message : String(error),
                s3Key
            });
            throw new Error('Could not get file buffer from S3.');
        }
    }

    /**
     * Delete a chat file from S3
     */
    static async deleteChatFile(s3Key: string): Promise<void> {
        const command = new DeleteObjectCommand({
            Bucket: AWS_CONFIG.s3.bucketName,
            Key: s3Key
        });

        try {
            await s3Client.send(command);

            loggingService.info('Chat file deleted from S3', {
                component: 'S3Service',
                operation: 'deleteChatFile',
                s3Key
            });
        } catch (error) {
            loggingService.error('Error deleting chat file from S3', {
                component: 'S3Service',
                operation: 'deleteChatFile',
                error: error instanceof Error ? error.message : String(error),
                s3Key
            });
            throw new Error('Could not delete chat file from S3.');
        }
    }
} 