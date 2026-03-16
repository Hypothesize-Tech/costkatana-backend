import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../../modules/email/email.service';

interface IUser {
  _id?: { toString: () => string };
  name: string;
  email: string;
}

interface IUserSession {
  userSessionId: string;
  deviceName: string;
  browser?: string;
  os?: string;
  ipAddress: string;
  createdAt: Date;
  location: {
    city?: string;
    country?: string;
  };
}

@Injectable()
export class UserSessionEmailService {
  private readonly logger = new Logger(UserSessionEmailService.name);

  constructor(private readonly emailService: EmailService) {}

  private getCurrentYear(): number {
    return new Date().getFullYear();
  }

  /**
   * Send email notification for new device login
   */
  async sendNewDeviceLoginEmail(
    user: IUser,
    userSession: IUserSession,
    revokeUrl: string,
    changePasswordUrl: string,
  ): Promise<void> {
    try {
      const year = this.getCurrentYear();
      const locationText =
        userSession.location.city && userSession.location.country
          ? `${userSession.location.city}, ${userSession.location.country}`
          : (userSession.location.country ??
            userSession.location.city ??
            'Unknown Location');

      const timestamp = new Date(userSession.createdAt).toLocaleString(
        'en-US',
        {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        },
      );

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                line-height: 1.6;
                color: #0f172a;
                background: radial-gradient(circle at top right, #f8fafc, #ffffff 70%);
                margin: 0;
                padding: 40px 20px;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background: #ffffff;
                border-radius: 24px;
                overflow: hidden;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
              }
              .header {
                background: linear-gradient(135deg, #06ec9e, #009454);
                color: white;
                padding: 40px 30px;
                text-align: center;
              }
              .header h1 {
                margin: 0;
                font-size: 32px;
                font-weight: 700;
                letter-spacing: -0.5px;
              }
              .content {
                padding: 40px 30px;
                background: white;
              }
              .content h2 {
                color: #0f172a;
                font-size: 24px;
                font-weight: 600;
                margin: 0 0 20px 0;
              }
              .content p {
                color: #475569;
                margin: 16px 0;
                font-size: 16px;
              }
              .device-info {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 20px;
                margin: 24px 0;
              }
              .device-info-item {
                display: flex;
                justify-content: space-between;
                padding: 12px 0;
                border-bottom: 1px solid #e2e8f0;
              }
              .device-info-item:last-child {
                border-bottom: none;
              }
              .device-info-label {
                font-weight: 600;
                color: #334155;
              }
              .device-info-value {
                color: #64748b;
              }
              .warning-box {
                background: #fef9c3;
                border-left: 4px solid #eab308;
                padding: 16px;
                margin: 20px 0;
                border-radius: 8px;
                display: flex;
                align-items: flex-start;
                gap: 12px;
              }
              .warning-box p {
                margin: 0;
                color: #713f12;
                font-size: 14px;
              }
              .button-container {
                text-align: center;
                margin: 32px 0;
                display: flex;
                flex-direction: column;
                gap: 16px;
              }
              .button {
                display: inline-block;
                padding: 14px 32px;
                color: white;
                text-decoration: none;
                border-radius: 12px;
                font-weight: 600;
                font-size: 16px;
                transition: transform 0.2s;
                text-align: center;
              }
              .button-danger {
                background: linear-gradient(135deg, #ef4444, #dc2626);
                box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
              }
              .button-primary {
                background: linear-gradient(135deg, #06ec9e, #009454);
                box-shadow: 0 4px 15px rgba(6, 236, 158, 0.4);
              }
              .footer {
                text-align: center;
                padding: 30px;
                color: #64748b;
                font-size: 14px;
                background: #f8fafc;
              }
              @media only screen and (max-width: 600px) {
                .container {
                  border-radius: 0;
                }
                .content {
                  padding: 30px 20px;
                }
                .button-container {
                  flex-direction: column;
                }
                .button {
                  width: 100%;
                  display: block;
                }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>New Device Login Detected</h1>
              </div>
              <div class="content">
                <h2>Hi ${user.name},</h2>
                <p>We detected a login to your Cost Katana account from a new device. If this was you, you can safely ignore this email.</p>

                <div class="device-info">
                  <div class="device-info-item">
                    <span class="device-info-label">Device:</span>
                    <span class="device-info-value">${userSession.deviceName}</span>
                  </div>
                  <div class="device-info-item">
                    <span class="device-info-label">Browser:</span>
                    <span class="device-info-value">${userSession.browser ?? 'Unknown'}</span>
                  </div>
                  <div class="device-info-item">
                    <span class="device-info-label">Operating System:</span>
                    <span class="device-info-value">${userSession.os ?? 'Unknown'}</span>
                  </div>
                  <div class="device-info-item">
                    <span class="device-info-label">Location:</span>
                    <span class="device-info-value">${locationText}</span>
                  </div>
                  <div class="device-info-item">
                    <span class="device-info-label">IP Address:</span>
                    <span class="device-info-value">${userSession.ipAddress}</span>
                  </div>
                  <div class="device-info-item">
                    <span class="device-info-label">Time:</span>
                    <span class="device-info-value">${timestamp}</span>
                  </div>
                </div>

                <div class="warning-box">
                  <p><strong>Wasn't you?</strong> If you didn't log in from this device, please revoke this session immediately and change your password to secure your account.</p>
                </div>

                <div class="button-container">
                  <a href="${revokeUrl}" class="button button-danger">Revoke This Session</a>
                  <a href="${changePasswordUrl}" class="button button-primary">Change Password</a>
                </div>

                <p style="margin-top: 24px; font-size: 14px; color: #64748b;">
                  <strong>Note:</strong> These links will expire in 24 hours for security reasons. If you need to take action after that, please log in to your account and manage your sessions from the Security Settings page.
                </p>

                <p style="margin-top: 16px; font-size: 14px; color: #64748b;">
                  If this was you, no action is needed. You can continue using Cost Katana as usual.
                </p>
              </div>
              <div class="footer">
                <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
                <p>© ${year} Cost Katana. All rights reserved.</p>
                <p style="margin-top: 12px; font-size: 12px;">
                  This is an automated security notification. Please do not reply to this email.
                </p>
              </div>
            </div>
          </body>
        </html>
      `;

      await this.emailService.sendEmail({
        to: user.email,
        subject: 'New Device Login Detected - Cost Katana',
        html,
      });

      const userId = user._id?.toString() ?? 'unknown';
      this.logger.log('New device login email sent', {
        operation: 'sendNewDeviceLoginEmail',
        userId,
        userSessionId: userSession.userSessionId,
      });
    } catch (error) {
      const userId = user._id?.toString() ?? 'unknown';
      this.logger.error('Error sending new device login email', {
        operation: 'sendNewDeviceLoginEmail',
        userId,
        userSessionId: userSession.userSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - email failure shouldn't block session creation
    }
  }

  /**
   * Generate revoke session URL
   */
  generateRevokeSessionUrl(userSessionId: string, revokeToken: string): string {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return `${frontendUrl}/auth/user-sessions/revoke/${userSessionId}/${revokeToken}`;
  }

  /**
   * Generate change password URL
   */
  generateChangePasswordUrl(userId: string, token: string): string {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return `${frontendUrl}/reset-password/${userId}/${token}`;
  }
}
