import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class VisualComplianceS3Service {
  private s3Client: S3Client;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
        )!,
      },
    });
  }

  /**
   * Upload document to S3
   */
  async uploadDocument(
    userId: string,
    fileName: string,
    fileBuffer: Buffer,
    fileType: string,
    metadata?: Record<string, string>,
  ): Promise<{ s3Key: string; s3Url: string }> {
    const bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME');

    if (!bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME is not configured');
    }

    // Create folder structure: documents/{userId}/{fileName}
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `documents/${userId}/${timestamp}-${sanitizedFileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
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

      const s3Url = `s3://${bucketName}/${key}`;

      this.logger.info('Document uploaded to S3', {
        component: 'VisualComplianceS3Service',
        operation: 'uploadDocument',
        userId,
        fileName,
        s3Key: key,
        fileSize: fileBuffer.length,
      });

      return { s3Key: key, s3Url };
    } catch (error) {
      this.logger.error('Error uploading document to S3', {
        component: 'VisualComplianceS3Service',
        operation: 'uploadDocument',
        error: error instanceof Error ? error.message : String(error),
        userId,
        fileName,
      });
      throw new Error('Could not upload document to S3.');
    }
  }

  /**
   * Generate presigned URL for S3 object
   */
  async generatePresignedUrl(
    s3Key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME');

    if (!bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME is not configured');
    }

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    try {
      const url = await getSignedUrl(this.s3Client, command, { expiresIn });

      this.logger.info('Presigned URL generated for reference image', {
        component: 'VisualComplianceS3Service',
        operation: 'generatePresignedUrl',
        s3Key,
        expiresIn,
      });

      return url;
    } catch (error) {
      this.logger.error('Error generating presigned URL', {
        component: 'VisualComplianceS3Service',
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
}
