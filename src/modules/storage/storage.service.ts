import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(private configService: ConfigService) {
    this.bucketName =
      this.configService.get<string>('AWS_S3_BUCKET_NAME') ||
      this.configService.get<string>('AWS_S3_BUCKETNAME') ||
      'costkatana-storage';

    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION') || 'us-east-1',
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
    });
  }

  /**
   * Get presigned URL for avatar upload
   */
  async getPresignedAvatarUploadUrl(
    userId: string,
    fileName: string,
    fileType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    const key = `avatars/${userId}/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: fileType,
    });

    try {
      const uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600, // 1 hour
      });

      this.logger.log(`Generated presigned URL for avatar upload`, {
        userId,
        fileName,
        key,
        bucket: this.bucketName,
      });

      return { uploadUrl, key };
    } catch (error) {
      this.logger.error('Error creating presigned URL for avatar upload', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        fileName,
        bucket: this.bucketName,
      });
      throw new Error('Could not create presigned URL for avatar upload.');
    }
  }

  /**
   * Upload document to S3 with user-specific folder structure
   */
  async uploadDocument(
    userId: string,
    fileName: string,
    fileBuffer: Buffer,
    fileType: string,
    metadata?: Record<string, string>,
  ): Promise<{ s3Key: string; s3Url: string }> {
    // Create folder structure: documents/{userId}/{timestamp}-{fileName}
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `documents/${userId}/${timestamp}-${sanitizedFileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: fileType,
      Metadata: {
        userId,
        originalFileName: fileName,
        uploadDate: new Date().toISOString(),
        ...metadata,
      },
    });

    try {
      await this.s3Client.send(command);

      const s3Url = `s3://${this.bucketName}/${key}`;

      this.logger.log('Document uploaded to S3', {
        userId,
        fileName,
        s3Key: key,
        fileSize: fileBuffer.length,
        bucket: this.bucketName,
      });

      return { s3Key: key, s3Url };
    } catch (error) {
      this.logger.error('Error uploading document to S3', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        fileName,
        bucket: this.bucketName,
      });
      throw new Error('Could not upload document to S3.');
    }
  }

  /**
   * Convert S3 URL to S3 key
   */
  s3UrlToKey(s3Url: string): string {
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
  async getPresignedDocumentUrl(
    s3Key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    try {
      const url = await getSignedUrl(this.s3Client, command, { expiresIn });

      this.logger.log('Generated presigned download URL', {
        s3Key,
        expiresIn,
        bucket: this.bucketName,
      });

      return url;
    } catch (error) {
      this.logger.error('Error creating presigned download URL', {
        error: error instanceof Error ? error.message : String(error),
        s3Key,
        bucket: this.bucketName,
      });
      throw new Error('Could not create presigned download URL.');
    }
  }

  /**
   * Download document from S3
   */
  async downloadDocument(s3Key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    try {
      const response = await this.s3Client.send(command);

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      if (response.Body) {
        // @ts-expect-error - Body is a ReadableStream which is not fully typed
        for await (const chunk of response.Body) {
          chunks.push(Buffer.from(chunk));
        }
      }

      const buffer = Buffer.concat(chunks);

      this.logger.log('Document downloaded from S3', {
        s3Key,
        size: buffer.length,
        bucket: this.bucketName,
      });

      return buffer;
    } catch (error) {
      this.logger.error('Error downloading document from S3', {
        error: error instanceof Error ? error.message : String(error),
        s3Key,
        bucket: this.bucketName,
      });
      throw new Error('Could not download document from S3.');
    }
  }

  /**
   * Upload reference image for visual compliance template
   */
  async uploadReferenceImage(
    templateId: string,
    userId: string,
    fileBuffer: Buffer,
    fileName: string,
    fileType: string,
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
      type: 'reference-image',
    };

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: fileType,
      Metadata: sanitizedMetadata,
    });

    try {
      await this.s3Client.send(command);

      const s3Url = `s3://${this.bucketName}/${key}`;

      this.logger.log('Reference image uploaded to S3', {
        userId,
        templateId,
        fileName,
        s3Key: key,
        fileSize: fileBuffer.length,
        bucket: this.bucketName,
      });

      return { s3Key: key, s3Url };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorDetails =
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
              ...(error as any),
            }
          : error;

      this.logger.error('Error uploading reference image to S3', {
        error: errorMessage,
        errorDetails,
        bucket: this.bucketName,
        region: this.configService.get<string>('AWS_REGION'),
        userId,
        templateId,
        fileName,
      });

      // Throw the original error message for better debugging
      throw new Error(`S3 Upload Error: ${errorMessage}`);
    }
  }

  /**
   * Delete reference image from S3
   */
  async deleteReferenceImage(s3Key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    try {
      await this.s3Client.send(command);

      this.logger.log('Reference image deleted from S3', {
        s3Key,
        bucket: this.bucketName,
      });
    } catch (error) {
      this.logger.error('Error deleting reference image from S3', {
        error: error instanceof Error ? error.message : String(error),
        s3Key,
        bucket: this.bucketName,
      });
      throw new Error('Could not delete reference image from S3.');
    }
  }

  /**
   * Generate presigned URL for reference image with custom expiration
   */
  async generatePresignedUrl(
    s3Key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    try {
      const url = await getSignedUrl(this.s3Client, command, { expiresIn });

      this.logger.log('Presigned URL generated for reference image', {
        s3Key,
        expiresIn,
        bucket: this.bucketName,
      });

      return url;
    } catch (error) {
      this.logger.error('Error generating presigned URL', {
        error: error instanceof Error ? error.message : String(error),
        s3Key,
        bucket: this.bucketName,
      });
      throw new Error('Could not generate presigned URL.');
    }
  }

  /**
   * Upload a chat attachment file to S3
   */
  async uploadChatFile(
    userId: string,
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
  ): Promise<{ s3Key: string; presignedUrl: string }> {
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `chat-uploads/${userId}/${timestamp}-${sanitizedFileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      Metadata: {
        userId,
        originalFileName: fileName,
        uploadedAt: new Date().toISOString(),
      },
    });

    try {
      await this.s3Client.send(command);

      // Generate presigned URL for 7 days
      const presignedUrl = await this.generatePresignedUrl(
        key,
        7 * 24 * 60 * 60,
      );

      this.logger.log('Chat file uploaded to S3', {
        userId,
        fileName,
        s3Key: key,
        fileSize: fileBuffer.length,
        bucket: this.bucketName,
      });

      return { s3Key: key, presignedUrl };
    } catch (error) {
      this.logger.error('Error uploading chat file to S3', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        fileName,
        bucket: this.bucketName,
      });
      throw new Error('Could not upload chat file to S3.');
    }
  }

  /**
   * Get file buffer from S3 (for text extraction)
   */
  async getFileBuffer(s3Key: string): Promise<Buffer> {
    try {
      return await this.downloadDocument(s3Key);
    } catch (error) {
      this.logger.error('Error getting file buffer from S3', {
        error: error instanceof Error ? error.message : String(error),
        s3Key,
        bucket: this.bucketName,
      });
      throw new Error('Could not get file buffer from S3.');
    }
  }

  /**
   * Delete a chat file from S3
   */
  async deleteChatFile(s3Key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    try {
      await this.s3Client.send(command);

      this.logger.log('Chat file deleted from S3', {
        s3Key,
        bucket: this.bucketName,
      });
    } catch (error) {
      this.logger.error('Error deleting chat file from S3', {
        error: error instanceof Error ? error.message : String(error),
        s3Key,
        bucket: this.bucketName,
      });
      throw new Error('Could not delete chat file from S3.');
    }
  }
}
