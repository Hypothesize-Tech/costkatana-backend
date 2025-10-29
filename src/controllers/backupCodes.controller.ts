import { Request, Response } from 'express';
import { User } from '../models/User';
import { BackupCodesService } from '../services/backupCodes.service';
import { loggingService } from '../services/logging.service';
import bcrypt from 'bcryptjs';

/**
 * Backup Codes Controller
 * Handles HTTP requests for backup code operations
 */
export class BackupCodesController {
    /**
     * Generate new backup codes
     * POST /api/backup-codes/generate
     * Requires password verification
     */
    static async generateBackupCodes(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id || (req as any).user?._id?.toString();
        const { password } = req.body;

        try {
            loggingService.info('Backup codes generation initiated', {
                component: 'BackupCodesController',
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            // Validate password is provided
            if (!password) {
                res.status(400).json({
                    success: false,
                    error: 'Password is required'
                });
                return;
            }

            // Get user from database
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
                return;
            }

            // Verify password
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                loggingService.warn('Backup codes generation failed - invalid password', {
                    component: 'BackupCodesController',
                    userId
                });
                
                res.status(401).json({
                    success: false,
                    error: 'Invalid password'
                });
                return;
            }

            // Generate new backup codes
            const plainCodes = BackupCodesService.generateBackupCodes();
            
            // Hash the codes before storing
            const hashedCodes = await BackupCodesService.hashBackupCodes(plainCodes);
            
            // Update user's backup codes in database
            user.mfa.totp.backupCodes = hashedCodes;
            user.mfa.totp.lastUsed = new Date();
            await user.save();

            const duration = Date.now() - startTime;

            loggingService.info('Backup codes generated successfully', {
                component: 'BackupCodesController',
                userId,
                duration,
                codesCount: plainCodes.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'backup_codes_generated',
                category: 'security',
                value: duration,
                metadata: {
                    userId,
                    codesCount: plainCodes.length
                }
            });

            // Return plain codes (only time they're visible)
            res.json({
                success: true,
                data: {
                    codes: plainCodes,
                    count: plainCodes.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Backup codes generation failed', {
                component: 'BackupCodesController',
                userId,
                duration,
                error: error.message || 'Unknown error',
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                error: 'Failed to generate backup codes'
            });
        }
    }

    /**
     * Verify user password
     * POST /api/backup-codes/verify-password
     * Used before showing backup code operations
     */
    static async verifyPassword(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id || (req as any).user?._id?.toString();
        const { password } = req.body;

        try {
            loggingService.info('Password verification initiated', {
                component: 'BackupCodesController',
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            // Validate password is provided
            if (!password) {
                res.status(400).json({
                    success: false,
                    error: 'Password is required'
                });
                return;
            }

            // Get user from database
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
                return;
            }

            // Verify password
            const isPasswordValid = await bcrypt.compare(password, user.password);
            
            const duration = Date.now() - startTime;

            if (!isPasswordValid) {
                loggingService.warn('Password verification failed', {
                    component: 'BackupCodesController',
                    userId,
                    duration
                });
                
                res.status(401).json({
                    success: false,
                    error: 'Invalid password'
                });
                return;
            }

            loggingService.info('Password verified successfully', {
                component: 'BackupCodesController',
                userId,
                duration
            });

            res.json({
                success: true,
                data: {
                    verified: true
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Password verification failed', {
                component: 'BackupCodesController',
                userId,
                duration,
                error: error.message || 'Unknown error',
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                error: 'Failed to verify password'
            });
        }
    }

    /**
     * Get backup codes metadata
     * GET /api/backup-codes/metadata
     * Returns count and last generated date (not the actual codes)
     */
    static async getBackupCodesMetadata(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id || (req as any).user?._id?.toString();

        try {
            loggingService.info('Backup codes metadata retrieval initiated', {
                component: 'BackupCodesController',
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            // Get user from database
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
                return;
            }

            const hasBackupCodes = user.mfa.totp.backupCodes && user.mfa.totp.backupCodes.length > 0;
            const codesCount = hasBackupCodes ? user.mfa.totp.backupCodes.length : 0;
            const lastGenerated = user.mfa.totp.lastUsed;

            const duration = Date.now() - startTime;

            loggingService.info('Backup codes metadata retrieved successfully', {
                component: 'BackupCodesController',
                userId,
                duration,
                hasBackupCodes,
                codesCount
            });

            res.json({
                success: true,
                data: {
                    hasBackupCodes,
                    codesCount,
                    lastGenerated: lastGenerated?.toISOString() || null
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Backup codes metadata retrieval failed', {
                component: 'BackupCodesController',
                userId,
                duration,
                error: error.message || 'Unknown error',
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve backup codes metadata'
            });
        }
    }
}


