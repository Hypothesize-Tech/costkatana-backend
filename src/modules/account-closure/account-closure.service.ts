import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../schemas/user/user.schema';
import { EmailService } from '../email/email.service';
import * as crypto from 'crypto';

@Injectable()
export class AccountClosureService {
  private readonly logger = new Logger(AccountClosureService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly emailService: EmailService,
  ) {}

  async initiateAccountClosure(
    userId: string,
    password: string,
    reason?: string,
  ): Promise<{ message: string; scheduledDeletionAt?: Date }> {
    const user = await this.userModel.findById(userId).select('+password');
    if (!user) throw new NotFoundException('User not found');

    const isMatch = await (
      user as User & { comparePassword?(p: string): Promise<boolean> }
    ).comparePassword?.(password);
    if (!isMatch) {
      throw new BadRequestException('Invalid password');
    }

    const cooldownDays = 7;
    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setDate(scheduledDeletionAt.getDate() + cooldownDays);
    const deletionToken = crypto.randomBytes(32).toString('hex');

    const accountClosure = {
      status: 'pending_deletion' as const,
      requestedAt: new Date(),
      scheduledDeletionAt,
      deletionToken,
      confirmationStatus: {
        passwordConfirmed: true,
        emailConfirmed: false,
        cooldownCompleted: false,
      },
      cooldownStartedAt: new Date(),
      reason: reason ?? undefined,
      reactivationCount: (user as any).accountClosure?.reactivationCount ?? 0,
    };

    await this.userModel.updateOne(
      { _id: userId },
      { $set: { accountClosure } },
    );

    this.logger.log('Account closure initiated', { userId });
    return {
      message: 'Account closure initiated. Check your email to confirm.',
      scheduledDeletionAt,
    };
  }

  async confirmClosureViaEmail(token: string): Promise<{ message: string }> {
    const user = await this.userModel.findOne({
      'accountClosure.deletionToken': token,
      'accountClosure.status': 'pending_deletion',
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired confirmation token');
    }

    await this.userModel.updateOne(
      { _id: user._id },
      {
        $set: {
          'accountClosure.status': 'deleted',
          'accountClosure.confirmationStatus.emailConfirmed': true,
        },
        $unset: { 'accountClosure.deletionToken': 1 },
      },
    );

    this.logger.log('Account closure confirmed', {
      userId: user._id.toString(),
    });
    return { message: 'Account has been permanently closed.' };
  }

  async cancelAccountClosure(userId: string): Promise<{ message: string }> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if ((user as any).accountClosure?.status !== 'pending_deletion') {
      throw new BadRequestException('No pending account closure to cancel');
    }

    await this.userModel.updateOne(
      { _id: userId },
      {
        $set: {
          'accountClosure.status': 'active',
          'accountClosure.confirmationStatus': {
            passwordConfirmed: false,
            emailConfirmed: false,
            cooldownCompleted: false,
          },
        },
        $unset: {
          'accountClosure.requestedAt': 1,
          'accountClosure.scheduledDeletionAt': 1,
          'accountClosure.deletionToken': 1,
          'accountClosure.cooldownStartedAt': 1,
          'accountClosure.reason': 1,
        },
      },
    );

    this.logger.log('Account closure cancelled', { userId });
    return { message: 'Account closure has been cancelled.' };
  }

  async getAccountClosureStatus(userId: string): Promise<{
    status: string;
    requestedAt?: Date;
    scheduledDeletionAt?: Date;
    confirmationStatus?: unknown;
  }> {
    const user = await this.userModel
      .findById(userId)
      .select('accountClosure')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const ac = (user as any).accountClosure ?? { status: 'active' };
    return {
      status: ac.status ?? 'active',
      requestedAt: ac.requestedAt,
      scheduledDeletionAt: ac.scheduledDeletionAt,
      confirmationStatus: ac.confirmationStatus,
    };
  }

  async reactivateAccount(userId: string): Promise<{ message: string }> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if ((user as any).accountClosure?.status !== 'deleted') {
      throw new BadRequestException('Account is not in deleted state');
    }

    const reactivationCount =
      ((user as any).accountClosure?.reactivationCount ?? 0) + 1;
    await this.userModel.updateOne(
      { _id: userId },
      {
        $set: {
          'accountClosure.status': 'active',
          'accountClosure.reactivationCount': reactivationCount,
          'accountClosure.confirmationStatus': {
            passwordConfirmed: false,
            emailConfirmed: false,
            cooldownCompleted: false,
          },
        },
        $unset: {
          'accountClosure.requestedAt': 1,
          'accountClosure.scheduledDeletionAt': 1,
          'accountClosure.deletionToken': 1,
          'accountClosure.cooldownStartedAt': 1,
          'accountClosure.reason': 1,
        },
      },
    );

    this.logger.log('Account reactivated', { userId });
    return { message: 'Account has been reactivated.' };
  }

  async cleanupExpiredAccounts(): Promise<{
    deletedCount: number;
    finalizedCount: number;
  }> {
    const now = new Date();

    // Find accounts that are scheduled for deletion and past their deletion date
    const expiredAccounts = await this.userModel.find({
      'accountClosure.status': 'pending_deletion',
      'accountClosure.scheduledDeletionAt': { $lt: now },
      'accountClosure.confirmationStatus.emailConfirmed': true,
    });

    const deletedCount = 0;
    let finalizedCount = 0;

    for (const account of expiredAccounts) {
      try {
        await this.userModel.updateOne(
          { _id: account._id },
          {
            $set: {
              'accountClosure.status': 'deleted',
              'accountClosure.confirmationStatus.cooldownCompleted': true,
            },
          },
        );
        finalizedCount++;
        this.logger.log('Account automatically deleted', {
          userId: account._id.toString(),
        });
      } catch (error) {
        this.logger.error('Failed to delete account', {
          userId: account._id.toString(),
          error: (error as Error).message,
        });
      }
    }

    return { deletedCount, finalizedCount };
  }

  async sendDeletionWarnings(): Promise<number> {
    const now = new Date();
    // Send warnings 24 hours before deletion
    const warningThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const accountsToWarn = await this.userModel.find({
      'accountClosure.status': 'pending_deletion',
      'accountClosure.scheduledDeletionAt': { $lte: warningThreshold },
      'accountClosure.confirmationStatus.emailConfirmed': true,
      'accountClosure.confirmationStatus.cooldownCompleted': false,
    });

    let sentCount = 0;

    for (const account of accountsToWarn) {
      try {
        const scheduledAt = account.accountClosure?.scheduledDeletionAt;
        if (!scheduledAt) continue;
        // Send deletion warning email
        await this.emailService.sendDeletionWarning(account.email, scheduledAt);
        this.logger.log('Deletion warning sent successfully', {
          userId: account._id.toString(),
        });
        sentCount++;
      } catch (error) {
        this.logger.error('Failed to send deletion warning', {
          userId: account._id.toString(),
          error: (error as Error).message,
        });
      }
    }

    return sentCount;
  }
}
