import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  UseGuards,
  OnModuleDestroy,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UserNotificationService } from '../services/user-notification.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Controller('user/notifications')
@UseGuards(JwtAuthGuard)
export class UserNotificationController implements OnModuleDestroy {
  constructor(private readonly notificationService: UserNotificationService) {}

  onModuleDestroy() {
    // The service handles cleanup
  }

  /**
   * SSE endpoint for user notifications
   */
  @Get('stream')
  async streamNotifications(
    @Req() req: any,
    @Res() res: Response,
  ): Promise<void> {
    const user = req.user as AuthenticatedUser;

    // Add client to notification stream
    this.notificationService.addClient(user.id, res);

    // Handle client disconnect
    req.on('close', () => {
      this.notificationService.removeClient(user.id, res);
    });

    // Keep connection open - SSE will handle the rest
  }

  /**
   * Approve an approval request
   */
  @Post('approvals/:confirmationId/approve')
  async approveRequest(
    @Param('confirmationId') confirmationId: string,
    @Req() req: any,
  ): Promise<{ success: boolean; message: string }> {
    const user = req.user as AuthenticatedUser;

    const success = this.notificationService.handleApprovalResponse(
      confirmationId,
      true,
    );

    if (success) {
      return {
        success: true,
        message: 'Request approved successfully',
      };
    } else {
      return {
        success: false,
        message: 'Approval request not found or already processed',
      };
    }
  }

  /**
   * Reject an approval request
   */
  @Post('approvals/:confirmationId/reject')
  async rejectRequest(
    @Param('confirmationId') confirmationId: string,
    @Req() req: any,
  ): Promise<{ success: boolean; message: string }> {
    const user = req.user as AuthenticatedUser;

    const success = this.notificationService.handleApprovalResponse(
      confirmationId,
      false,
    );

    if (success) {
      return {
        success: true,
        message: 'Request rejected successfully',
      };
    } else {
      return {
        success: false,
        message: 'Approval request not found or already processed',
      };
    }
  }

  /**
   * Get notification status
   */
  @Get('status')
  async getNotificationStatus(@Req() req: any): Promise<{
    online: boolean;
    clientCount: number;
  }> {
    const user = req.user as AuthenticatedUser;

    return {
      online: this.notificationService.isUserOnline(user.id),
      clientCount: this.notificationService.getUserClientCount(user.id),
    };
  }
}
