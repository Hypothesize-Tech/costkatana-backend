import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, AWS_CONFIG } from '../../config/aws';

@Injectable()
export class ReferenceImageS3Service {
  private readonly logger = new Logger(ReferenceImageS3Service.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Upload reference image for a template
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
      Bucket: AWS_CONFIG.s3.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: fileType,
      Metadata: sanitizedMetadata,
    });

    try {
      await s3Client.send(command);

      const s3Url = `s3://${AWS_CONFIG.s3.bucketName}/${key}`;

      this.logger.log('Reference image uploaded to S3', {
        component: 'ReferenceImageS3Service',
        operation: 'uploadReferenceImage',
        userId,
        templateId,
        fileName,
        s3Key: key,
        fileSize: fileBuffer.length,
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
        component: 'ReferenceImageS3Service',
        operation: 'uploadReferenceImage',
        error: errorMessage,
        errorDetails,
        bucket: AWS_CONFIG.s3.bucketName,
        region: AWS_CONFIG.s3.region,
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
      Bucket: AWS_CONFIG.s3.bucketName,
      Key: s3Key,
    });

    try {
      await s3Client.send(command);

      this.logger.log('Reference image deleted from S3', {
        component: 'ReferenceImageS3Service',
        operation: 'deleteReferenceImage',
        s3Key,
      });
    } catch (error) {
      this.logger.error('Error deleting reference image from S3', {
        component: 'ReferenceImageS3Service',
        operation: 'deleteReferenceImage',
        error: error instanceof Error ? error.message : String(error),
        s3Key,
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
      Bucket: AWS_CONFIG.s3.bucketName,
      Key: s3Key,
    });

    try {
      const url = await getSignedUrl(s3Client, command, { expiresIn });

      this.logger.log('Presigned URL generated for reference image', {
        component: 'ReferenceImageS3Service',
        operation: 'generatePresignedUrl',
        s3Key,
        expiresIn,
      });

      return url;
    } catch (error) {
      this.logger.error('Error generating presigned URL', {
        component: 'ReferenceImageS3Service',
        operation: 'generatePresignedUrl',
        error: error instanceof Error ? error.message : String(error),
        s3Key,
      });
      throw new Error('Could not generate presigned URL.');
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
    throw new Error('Invalid S3 URL format');
  }

  /**
   * Download image from S3 and convert to base64
   * Required because NestJS BedrockService.invokeWithImage needs base64, not URL
   */
  async downloadImageAsBase64(s3Key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: AWS_CONFIG.s3.bucketName,
      Key: s3Key,
    });

    try {
      const response = await s3Client.send(command);

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      if (response.Body) {
        for await (const chunk of response.Body) {
          chunks.push(Buffer.from(chunk));
        }
      }

      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString('base64');

      this.logger.log('Reference image downloaded and converted to base64', {
        component: 'ReferenceImageS3Service',
        operation: 'downloadImageAsBase64',
        s3Key,
        fileSize: buffer.length,
      });

      return base64;
    } catch (error) {
      this.logger.error('Error downloading image from S3', {
        component: 'ReferenceImageS3Service',
        operation: 'downloadImageAsBase64',
        error: error instanceof Error ? error.message : String(error),
        s3Key,
      });
      throw new Error('Could not download image from S3.');
    }
  }
}
