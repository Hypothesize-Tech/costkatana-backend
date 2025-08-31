import { s3Client } from '../config/aws';
import { PutObjectCommand } from '@aws-sdk/client-s3';
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
} 