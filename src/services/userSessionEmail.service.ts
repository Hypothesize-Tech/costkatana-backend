import { EmailService } from './email.service';
import { IUser } from '../models/User';
import { IUserSession } from '../models/UserSession';
import { loggingService } from './logging.service';

export class UserSessionEmailService {
    private static getCurrentYear(): number {
        return new Date().getFullYear();
    }

    /**
     * Send email notification for new device login
     */
    static async sendNewDeviceLoginEmail(
        user: IUser,
        userSession: IUserSession,
        revokeUrl: string,
        changePasswordUrl: string
    ): Promise<void> {
        try {
            const year = this.getCurrentYear();
            const locationText = userSession.location.city && userSession.location.country
                ? `${userSession.location.city}, ${userSession.location.country}`
                : userSession.location.country ?? userSession.location.city ?? 'Unknown Location';
            
            const timestamp = new Date(userSession.createdAt).toLocaleString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZoneName: 'short'
            });

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
            .icon-inline {
              flex-shrink: 0;
              margin-top: 2px;
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
            .button:hover {
              transform: translateY(-2px);
            }
            .button-danger:hover {
              box-shadow: 0 8px 25px rgba(239, 68, 68, 0.6);
            }
            .button-primary:hover {
              box-shadow: 0 8px 25px rgba(6, 236, 158, 0.6);
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #64748b;
              font-size: 14px;
              background: #f8fafc;
            }
            .icon-container {
              margin-bottom: 10px;
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
              <div class="icon-container">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 1C8.69 1 6 3.69 6 7V10C4.9 10 4 10.9 4 12V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V12C20 10.9 19.1 10 18 10V7C18 3.69 15.31 1 12 1ZM12 3C14.21 3 16 4.79 16 7V10H8V7C8 4.79 9.79 3 12 3ZM12 17C10.9 17 10 16.1 10 15C10 13.9 10.9 13 12 13C13.1 13 14 13.9 14 15C14 16.1 13.1 17 12 17Z" fill="white"/>
                </svg>
              </div>
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
                <svg class="icon-inline" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="#eab308"/>
                </svg>
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

            await EmailService.sendEmail({
                to: user.email,
                subject: 'New Device Login Detected - Cost Katana',
                html
            });

            const userId = (user as { _id?: { toString: () => string } })._id?.toString() ?? 'unknown';
            loggingService.info('New device login email sent', {
                component: 'UserSessionEmailService',
                operation: 'sendNewDeviceLoginEmail',
                userId,
                userSessionId: userSession.userSessionId
            });
        } catch (error) {
            const userId = (user as { _id?: { toString: () => string } })._id?.toString() ?? 'unknown';
            loggingService.error('Error sending new device login email', {
                component: 'UserSessionEmailService',
                operation: 'sendNewDeviceLoginEmail',
                userId,
                userSessionId: userSession.userSessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            // Don't throw - email failure shouldn't block session creation
        }
    }

    /**
     * Generate revoke session URL
     */
    static generateRevokeSessionUrl(userSessionId: string, revokeToken: string): string {
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
        return `${frontendUrl}/auth/user-sessions/revoke/${userSessionId}/${revokeToken}`;
    }

    /**
     * Generate change password URL
     */
    static generateChangePasswordUrl(userId: string, token: string): string {
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
        return `${frontendUrl}/reset-password/${userId}/${token}`;
    }
}
