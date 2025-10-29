import crypto from 'crypto';
import { User } from '../models/User';
import { loggingService } from './logging.service';
import { EmailService } from './email.service';

export class AccountClosureService {
    /**
     * Initiate account closure process with password confirmation
     */
    static async initiateAccountClosure(
        userId: string,
        password: string,
        reason?: string
    ): Promise<{ requiresEmailConfirmation: boolean }> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Verify password
            const isPasswordValid = await user.comparePassword(password);
            if (!isPasswordValid) {
                throw new Error('Invalid password');
            }

            // Check if already in process
            if (user.accountClosure.status === 'pending_deletion') {
                throw new Error('Account closure already in progress');
            }

            if (user.accountClosure.status === 'deleted') {
                throw new Error('Account is already deleted');
            }

            // Generate deletion token
            const deletionToken = crypto.randomBytes(32).toString('hex');

            // Update user with initial closure state
            user.accountClosure = {
                status: 'active', // Still active until email confirmed
                requestedAt: new Date(),
                deletionToken,
                confirmationStatus: {
                    passwordConfirmed: true,
                    emailConfirmed: false,
                    cooldownCompleted: false,
                },
                reason,
                scheduledDeletionAt: undefined,
                cooldownStartedAt: undefined,
                reactivationCount: user.accountClosure?.reactivationCount || 0,
            };

            await user.save();

            // Send confirmation email
            await this.sendClosureConfirmationEmail(user._id.toString());

            loggingService.info('Account closure initiated', {
                userId: user._id.toString(),
                email: user.email,
                reason,
            });

            return { requiresEmailConfirmation: true };
        } catch (error: unknown) {
            loggingService.error('Error initiating account closure:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            throw error;
        }
    }

    /**
     * Send account closure confirmation email
     */
    static async sendClosureConfirmationEmail(userId: string): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user || !user.accountClosure.deletionToken) {
                throw new Error('User or deletion token not found');
            }

            const confirmationUrl = `${process.env.FRONTEND_URL}/confirm-account-closure/${user.accountClosure.deletionToken}`;

            await EmailService.sendAccountClosureConfirmation(
                user.email,
                confirmationUrl,
                user.name
            );

            loggingService.info('Account closure confirmation email sent', {
                userId: user._id.toString(),
                email: user.email,
            });
        } catch (error: unknown) {
            loggingService.error('Error sending closure confirmation email:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            throw error;
        }
    }

    /**
     * Confirm account closure via email token
     */
    static async confirmClosureViaEmail(token: string): Promise<{
        success: boolean;
        cooldownEndsAt: Date;
    }> {
        try {
            const user = await User.findOne({ 'accountClosure.deletionToken': token });

            if (!user) {
                throw new Error('Invalid or expired deletion token');
            }

            // Check if already confirmed
            if (user.accountClosure.confirmationStatus.emailConfirmed) {
                // Return existing cooldown info
                const cooldownEndsAt = user.accountClosure.cooldownStartedAt
                    ? new Date(user.accountClosure.cooldownStartedAt.getTime() + 24 * 60 * 60 * 1000)
                    : new Date(Date.now() + 24 * 60 * 60 * 1000);
                
                return { success: true, cooldownEndsAt };
            }

            // Start cooldown period
            const cooldownStartedAt = new Date();
            const cooldownEndsAt = new Date(cooldownStartedAt.getTime() + 24 * 60 * 60 * 1000);

            user.accountClosure.confirmationStatus.emailConfirmed = true;
            user.accountClosure.cooldownStartedAt = cooldownStartedAt;
            user.accountClosure.deletionToken = undefined; // Token used

            await user.save();

            loggingService.info('Account closure email confirmed, cooldown started', {
                userId: user._id.toString(),
                email: user.email,
                cooldownStartedAt,
                cooldownEndsAt,
            });

            // Schedule finalization after cooldown (this will be picked up by cron)
            return { success: true, cooldownEndsAt };
        } catch (error: unknown) {
            loggingService.error('Error confirming closure via email:', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Finalize closure to pending_deletion status (called after cooldown)
     */
    static async finalizeClosurePending(userId: string): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Verify cooldown completed
            if (!user.accountClosure.cooldownStartedAt) {
                throw new Error('Cooldown not started');
            }

            const cooldownEndTime = new Date(
                user.accountClosure.cooldownStartedAt.getTime() + 24 * 60 * 60 * 1000
            );

            if (new Date() < cooldownEndTime) {
                throw new Error('Cooldown period not yet completed');
            }

            // Calculate 30-day deletion date
            const scheduledDeletionAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

            user.accountClosure.status = 'pending_deletion';
            user.accountClosure.scheduledDeletionAt = scheduledDeletionAt;
            user.accountClosure.confirmationStatus.cooldownCompleted = true;

            await user.save();

            loggingService.info('Account closure finalized to pending_deletion', {
                userId: user._id.toString(),
                email: user.email,
                scheduledDeletionAt,
            });
        } catch (error: unknown) {
            loggingService.error('Error finalizing closure:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            throw error;
        }
    }

    /**
     * Cancel account closure
     */
    static async cancelAccountClosure(userId: string): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Can only cancel before cooldown completes
            if (user.accountClosure.confirmationStatus.cooldownCompleted) {
                throw new Error('Cannot cancel after cooldown period. Please reactivate your account instead.');
            }

            // Reset closure state
            user.accountClosure = {
                status: 'active',
                confirmationStatus: {
                    passwordConfirmed: false,
                    emailConfirmed: false,
                    cooldownCompleted: false,
                },
                reactivationCount: user.accountClosure.reactivationCount || 0,
                requestedAt: undefined,
                scheduledDeletionAt: undefined,
                deletionToken: undefined,
                cooldownStartedAt: undefined,
                reason: undefined,
            };

            await user.save();

            loggingService.info('Account closure cancelled', {
                userId: user._id.toString(),
                email: user.email,
            });
        } catch (error: unknown) {
            loggingService.error('Error cancelling account closure:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            throw error;
        }
    }

    /**
     * Reactivate account during grace period
     */
    static async reactivateAccount(userId: string): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            if (user.accountClosure.status !== 'pending_deletion') {
                throw new Error('Account is not pending deletion');
            }

            // Check if within grace period
            if (user.accountClosure.scheduledDeletionAt && new Date() > user.accountClosure.scheduledDeletionAt) {
                throw new Error('Grace period has expired. Account cannot be reactivated.');
            }

            // Reset closure state and increment reactivation count
            const reactivationCount = (user.accountClosure.reactivationCount || 0) + 1;
            
            user.accountClosure = {
                status: 'active',
                confirmationStatus: {
                    passwordConfirmed: false,
                    emailConfirmed: false,
                    cooldownCompleted: false,
                },
                reactivationCount,
                requestedAt: undefined,
                scheduledDeletionAt: undefined,
                deletionToken: undefined,
                cooldownStartedAt: undefined,
                reason: undefined,
            };

            await user.save();

            // Send reactivation confirmation email
            await EmailService.sendAccountReactivated(user.email, user.name);

            loggingService.info('Account reactivated', {
                userId: user._id.toString(),
                email: user.email,
                reactivationCount,
            });
        } catch (error: unknown) {
            loggingService.error('Error reactivating account:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            throw error;
        }
    }

    /**
     * Permanently delete account and all associated data
     */
    static async permanentlyDeleteAccount(userId: string): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                loggingService.warn('User not found for deletion', { userId });
                return;
            }

            const userEmail = user.email;
            const userName = user.name;

            // Delete all associated data
            // Note: Add more cleanup here based on your data model
            // For example: delete user's projects, usage records, API logs, etc.

            // Delete the user
            await User.findByIdAndDelete(userId);

            // Send final deletion email
            try {
                await EmailService.sendAccountDeleted(userEmail, userName);
            } catch (emailError) {
                loggingService.error('Failed to send account deleted email', {
                    error: emailError instanceof Error ? emailError.message : String(emailError),
                    email: userEmail,
                });
            }

            loggingService.info('Account permanently deleted', {
                userId,
                email: userEmail,
            });
        } catch (error: unknown) {
            loggingService.error('Error permanently deleting account:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            throw error;
        }
    }

    /**
     * Get account closure status for a user
     */
    static async getAccountClosureStatus(userId: string): Promise<any> {
        try {
            const user = await User.findById(userId).select('accountClosure');
            if (!user) {
                throw new Error('User not found');
            }

            const status = user.accountClosure;
            
            // Calculate days remaining if pending deletion
            let daysRemaining;
            if (status.status === 'pending_deletion' && status.scheduledDeletionAt) {
                const now = new Date();
                const deletionDate = new Date(status.scheduledDeletionAt);
                const diffTime = deletionDate.getTime() - now.getTime();
                daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }

            // Calculate cooldown end time
            let cooldownEndsAt;
            if (status.cooldownStartedAt && !status.confirmationStatus.cooldownCompleted) {
                cooldownEndsAt = new Date(status.cooldownStartedAt.getTime() + 24 * 60 * 60 * 1000);
            }

            return {
                status: status.status,
                requestedAt: status.requestedAt,
                scheduledDeletionAt: status.scheduledDeletionAt,
                daysRemaining,
                confirmationStatus: status.confirmationStatus,
                cooldownEndsAt,
                reason: status.reason,
                reactivationCount: status.reactivationCount,
            };
        } catch (error: unknown) {
            loggingService.error('Error getting account closure status:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            throw error;
        }
    }

    /**
     * Cleanup expired accounts (called by cron job)
     */
    static async cleanupExpiredAccounts(): Promise<{
        deletedCount: number;
        finalizedCount: number;
    }> {
        try {
            const now = new Date();
            let deletedCount = 0;
            let finalizedCount = 0;

            // Find accounts that need to be finalized (cooldown completed)
            const accountsToFinalize = await User.find({
                'accountClosure.status': 'active',
                'accountClosure.confirmationStatus.passwordConfirmed': true,
                'accountClosure.confirmationStatus.emailConfirmed': true,
                'accountClosure.confirmationStatus.cooldownCompleted': false,
                'accountClosure.cooldownStartedAt': { $lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            });

            for (const user of accountsToFinalize) {
                try {
                    await this.finalizeClosurePending(user._id.toString());
                    finalizedCount++;
                } catch (error) {
                    loggingService.error('Error finalizing account closure', {
                        userId: user._id.toString(),
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            // Find accounts past 30-day grace period
            const accountsToDelete = await User.find({
                'accountClosure.status': 'pending_deletion',
                'accountClosure.scheduledDeletionAt': { $lte: now },
            });

            for (const user of accountsToDelete) {
                try {
                    await this.permanentlyDeleteAccount(user._id.toString());
                    deletedCount++;
                } catch (error) {
                    loggingService.error('Error deleting account', {
                        userId: user._id.toString(),
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            loggingService.info('Account cleanup completed', {
                deletedCount,
                finalizedCount,
            });

            return { deletedCount, finalizedCount };
        } catch (error: unknown) {
            loggingService.error('Error in cleanup expired accounts:', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Send warning emails to accounts approaching deletion (7 days before)
     */
    static async sendDeletionWarnings(): Promise<number> {
        try {
            const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const sixDaysFromNow = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);

            // Find accounts scheduled for deletion in 7 days
            const accountsNearDeletion = await User.find({
                'accountClosure.status': 'pending_deletion',
                'accountClosure.scheduledDeletionAt': {
                    $gte: sixDaysFromNow,
                    $lte: sevenDaysFromNow,
                },
            });

            let sentCount = 0;
            for (const user of accountsNearDeletion) {
                try {
                    await EmailService.sendAccountClosureFinalWarning(
                        user.email,
                        user.name,
                        7
                    );
                    sentCount++;
                } catch (error) {
                    loggingService.error('Error sending deletion warning', {
                        userId: user._id.toString(),
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            loggingService.info('Deletion warnings sent', { sentCount });
            return sentCount;
        } catch (error: unknown) {
            loggingService.error('Error sending deletion warnings:', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}

export const accountClosureService = AccountClosureService;

