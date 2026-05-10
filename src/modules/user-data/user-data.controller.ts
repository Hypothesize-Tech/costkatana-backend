/**
 * GDPR endpoints for user data export and erasure.
 *
 * Both routes are JWT-authenticated; the user can only act on their
 * own data. The controller deliberately does NOT accept a userId in
 * the path — the JWT subject is the authoritative identity.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserDataService, UserDataExport } from './user-data.service';

interface AuthedUser {
  id?: string;
  _id?: string;
  userId?: string;
}

interface DeleteRequestBody {
  /** Re-auth: user must confirm with their password to perform the destructive action. */
  password: string;
  reason?: string;
}

@Controller('api/user')
@UseGuards(JwtAuthGuard)
export class UserDataController {
  private readonly logger = new Logger(UserDataController.name);

  constructor(private readonly userDataService: UserDataService) {}

  /**
   * Returns a JSON snapshot of the user's data (conversations, messages,
   * files, profile). Synchronous + size-capped.
   *
   * Pass `?delivery=s3` to instead upload to S3 and return a 24h signed
   * URL — useful for downloads larger than the synchronous-response
   * cap, or for email-friendly download links.
   */
  @Post('export')
  async exportUserData(
    @CurrentUser() user: AuthedUser,
    @Query('delivery') delivery?: string,
  ): Promise<
    | { success: true; data: UserDataExport }
    | { success: true; downloadUrl: string; expiresIn: number; s3Key: string }
  > {
    const userId = String(user?.id ?? user?._id ?? user?.userId ?? '');
    this.logger.log('User data export requested', { userId, delivery });

    if (delivery === 's3') {
      const { signedUrl, expiresIn, s3Key } =
        await this.userDataService.exportUserDataToS3(userId);
      return {
        success: true,
        downloadUrl: signedUrl,
        expiresIn,
        s3Key,
      };
    }

    const data = await this.userDataService.exportUserData(userId);
    return { success: true, data };
  }

  /**
   * Async variant — kicks off a background job and returns a jobId
   * the caller can poll. Use when the synchronous path is too slow
   * (large exports) or when integrating with a UI that wants to show
   * "your export is being prepared" while it runs.
   */
  @Post('export/async')
  async startAsyncExport(
    @CurrentUser() user: AuthedUser,
  ): Promise<{ success: true; jobId: string }> {
    const userId = String(user?.id ?? user?._id ?? user?.userId ?? '');
    const { jobId } = await this.userDataService.startExportJob(userId);
    return { success: true, jobId };
  }

  /**
   * Poll for job status. Returns 404 if the jobId doesn't belong to
   * the caller — the controller does NOT reveal "exists for someone
   * else" vs "doesn't exist" distinction.
   */
  @Get('export/:jobId')
  async getExportStatus(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthedUser,
  ): Promise<{
    success: true;
    status: 'pending' | 'ready' | 'failed';
    downloadUrl?: string;
    expiresAt?: Date;
    error?: string;
  }> {
    const userId = String(user?.id ?? user?._id ?? user?.userId ?? '');
    const job = await this.userDataService.getExportJob(userId, jobId);
    if (!job) throw new NotFoundException('Export job not found');
    return { success: true, ...job };
  }

  /**
   * GDPR erasure request: starts the 30-day soft-delete grace period
   * via AccountClosureService.
   */
  @Delete('delete')
  async deleteUser(
    @CurrentUser() user: AuthedUser,
    @Body() body: DeleteRequestBody,
  ): Promise<{ success: true; message: string; gracePeriodDays: number }> {
    const userId = String(user?.id ?? user?._id ?? user?.userId ?? '');
    this.logger.log('User data deletion requested', { userId });
    const result = await this.userDataService.requestDeletion(
      userId,
      body?.password,
      body?.reason,
    );
    return { success: true, ...result };
  }
}
