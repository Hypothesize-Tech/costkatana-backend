import { s3Client } from '../config/aws';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
} 