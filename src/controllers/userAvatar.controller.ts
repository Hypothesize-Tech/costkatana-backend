import { Response, NextFunction } from 'express';
import { S3Service } from '../services/s3.service';
import { loggingService } from '../services/logging.service';
import { z } from 'zod';

const presignedUrlSchema = z.object({
    fileName: z.string(),
    fileType: z.string(),
});

/**
 * Controller for managing user avatar uploads and S3 operations
 */
export class UserAvatarController {
    // Circuit breaker for S3 operations
    private static s3FailureCount: number = 0;
    private static readonly MAX_S3_FAILURES = 3;
    private static readonly S3_CIRCUIT_BREAKER_RESET_TIME = 180000; // 3 minutes
    private static lastS3FailureTime: number = 0;

    /**
     * Circuit breaker utilities for S3 operations
     */
    private static isS3CircuitBreakerOpen(): boolean {
        if (UserAvatarController.s3FailureCount >= UserAvatarController.MAX_S3_FAILURES) {
            const timeSinceLastFailure = Date.now() - UserAvatarController.lastS3FailureTime;
            if (timeSinceLastFailure < UserAvatarController.S3_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                UserAvatarController.s3FailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordS3Failure(): void {
        this.s3FailureCount++;
        this.lastS3FailureTime = Date.now();
    }

    /**
     * Authentication validation utility
     */
    private static validateAuthentication(req: any, res: Response): { requestId: string; userId: string } | { requestId: null; userId: null } {
        const requestId = req.headers['x-request-id'] as string;
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
            return { requestId: null, userId: null };
        }

        return { requestId, userId };
    }

    /**
     * Get presigned URL for avatar upload
     * POST /api/user/profile/avatar-upload-url
     */
    static async getPresignedAvatarUrl(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { requestId, userId } = UserAvatarController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check S3 circuit breaker
            if (UserAvatarController.isS3CircuitBreakerOpen()) {
                throw new Error('S3 service circuit breaker is open');
            }

            const { fileName, fileType } = presignedUrlSchema.parse(req.body);

            const { uploadUrl, key } = await S3Service.getPresignedAvatarUploadUrl(userId, fileName, fileType);

            const finalUrl = `https://${process.env.AWS_S3_BUCKETNAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
            const duration = Date.now() - startTime;

            // Log business event
            loggingService.logBusiness({
                event: 'presigned_avatar_url_generated',
                category: 'user_management',
                value: duration,
                metadata: {
                    userId,
                    fileName,
                    fileType
                }
            });

            // Reset failure count on success
            UserAvatarController.s3FailureCount = 0;

            res.json({
                success: true,
                data: {
                    uploadUrl,
                    key,
                    finalUrl
                },
            });
        } catch (error: any) {
            UserAvatarController.recordS3Failure();
            const duration = Date.now() - startTime;
            
            loggingService.error('Get presigned avatar URL failed', {
                requestId,
                userId,
                fileName: req.body?.fileName,
                fileType: req.body?.fileType,
                error: error.message || 'Unknown error',
                duration
            });
            
            next(error);
        }
    }
}
