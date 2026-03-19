import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { User } from '../../schemas/user/user.schema';
import { Alert } from '../../schemas/user/alert.schema';

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  private async initializeTransporter() {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.get('SMTP_PORT', 587),
      secure: this.configService.get('SMTP_SECURE', false),
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
    });
  }

  private getCurrentYear(): number {
    return new Date().getFullYear();
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const mailOptions = {
        from: this.configService.get('EMAIL_FROM', 'noreply@costkatana.com'),
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || this.stripHtml(options.html),
        attachments: options.attachments,
      };
      await this.transporter.sendMail(mailOptions);
      this.logger.log('Email sent', {
        to: mailOptions.to,
        subject: mailOptions.subject,
      });
    } catch (error) {
      this.logger.error('Failed to send email', {
        error: error instanceof Error ? error.message : String(error),
        to: options.to,
        subject: options.subject,
      });
      throw error;
    }
  }

  async sendMFAEmail(to: string, code: string): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .code-block { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; font-family: ui-monospace, monospace; font-size: 24px; font-weight: bold; text-align: center; margin: 20px 0; letter-spacing: 4px; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Cost Katana Security Code</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>You requested a security code for your Cost Katana account. Use the code below to complete your sign-in:</p>
            <div class="code-block">${code}</div>
            <p>This code will expire in 10 minutes. If you didn't request this code, please ignore this email.</p>
            <p>For your security, never share this code with anyone.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Your Cost Katana Security Code',
      html,
    });
  }

  async sendOnboardingCredentialsEmail(
    to: string,
    userName: string,
    apiKey: string,
    projectId: string,
  ): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .code-block { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; font-family: ui-monospace, monospace; font-size: 13px; word-break: break-all; margin: 8px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #059669; color: white; padding: 20px; text-align: center;">
              <h1>Your Cost Katana API Key and Project</h1>
            </div>
            <div style="padding: 20px; background-color: #f9f9f9;">
              <p>Hi ${userName},</p>
              <p>Here are your API credentials for Cost Katana. Save them securely; the API key is shown only once.</p>
              <p><strong>API Key:</strong></p>
              <div class="code-block">${apiKey}</div>
              <p><strong>Default Project ID:</strong></p>
              <div class="code-block">${projectId}</div>
              <p>Usage: CostKatana-Auth: Bearer &lt;api_key&gt; and optional CostKatana-Project-Id: &lt;project_id&gt;</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Your Cost Katana API key and project',
      html,
    });
  }

  async sendPasswordResetEmail(
    user: User | { name: string; email: string },
    resetUrl: string,
  ): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #ef4444; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #ef4444; color: white; padding: 20px; text-align: center;">
              <h1>Password Reset Request</h1>
            </div>
            <div style="padding: 20px; background-color: #f9f9f9;">
              <h2>Hi ${user.name},</h2>
              <p>We received a request to reset your password.</p>
              <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0;">Reset Password</a>
              <p>Link: ${resetUrl}</p>
              <p>If you didn't request this, please ignore this email.</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: 'Password Reset - Cost Katana',
      html,
    });
  }

  async sendNewDeviceLoginNotification(
    user: User | { name: string; email: string },
    deviceInfo: {
      deviceName?: string;
      ipAddress?: string;
      location?: { country: string; region: string; city: string };
      userAgent?: string;
    },
  ): Promise<void> {
    const year = this.getCurrentYear();
    const location = deviceInfo.location
      ? `${deviceInfo.location.city}, ${deviceInfo.location.region}, ${deviceInfo.location.country}`
      : 'Unknown location';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f59e0b; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .device-info { background-color: #fff; border: 1px solid #ddd; padding: 15px; margin: 15px 0; border-radius: 4px; }
            .warning { background-color: #fef3c7; border: 1px solid #f59e0b; padding: 15px; margin: 15px 0; border-radius: 4px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f59e0b; color: white; padding: 20px; text-align: center;">
              <h1>New Device Login Detected</h1>
            </div>
            <div style="padding: 20px; background-color: #f9f9f9;">
              <h2>Hi ${user.name},</h2>
              <p>We detected a login to your Cost Katana account from a new device. For your security, we're letting you know about this activity.</p>

              <div style="background-color: #fff; border: 1px solid #ddd; padding: 15px; margin: 15px 0; border-radius: 4px;">
                <h3>Device Information:</h3>
                <p><strong>Device:</strong> ${deviceInfo.deviceName || 'Unknown device'}</p>
                <p><strong>IP Address:</strong> ${deviceInfo.ipAddress || 'Unknown'}</p>
                <p><strong>Location:</strong> ${location}</p>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              </div>

              <div style="background-color: #fef3c7; border: 1px solid #f59e0b; padding: 15px; margin: 15px 0; border-radius: 4px;">
                <p><strong>If this was you:</strong> No action is needed. Your account is secure.</p>
                <p><strong>If this wasn't you:</strong> Please change your password immediately and contact our support team.</p>
              </div>

              <a href="${this.configService.getOrThrow<string>('FRONTEND_URL')}/security" style="display: inline-block; padding: 12px 24px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0;">Review Account Security</a>

              <p>If you have any concerns about your account security, please don't hesitate to contact our support team.</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
              <p>This is an automated security notification from Cost Katana.</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: 'New Device Login - Cost Katana Security Alert',
      html,
    });
  }

  async sendCostAlert(
    user: User | { name: string; email: string },
    currentCost: number,
    threshold: number,
  ): Promise<void> {
    const year = this.getCurrentYear();
    const percentage = ((currentCost / threshold) * 100).toFixed(1);
    const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f39c12; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .alert-box { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; }
            .stats { display: flex; justify-content: space-around; margin: 20px 0; }
            .stat { text-align: center; }
            .stat-value { font-size: 24px; font-weight: bold; color: #f39c12; }
            .button { display: inline-block; padding: 12px 24px; background-color: #4a90e2; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f39c12; color: white; padding: 20px; text-align: center;">
              <h1>Cost Alert</h1>
            </div>
            <div style="padding: 20px; background-color: #f9f9f9;">
              <h2>Hi ${user.name},</h2>
              <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0;">
                <p><strong>Your AI API usage has exceeded your cost threshold!</strong></p>
              </div>
              <div style="display: flex; justify-content: space-around; margin: 20px 0;">
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #f39c12;">${formatCurrency(currentCost)}</div>
                  <div>Current Cost</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold;">${formatCurrency(threshold)}</div>
                  <div>Your Threshold</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold;">${percentage}%</div>
                  <div>Usage</div>
                </div>
              </div>
              <p>Here are some recommendations to reduce your costs:</p>
              <ul>
                <li>Review and optimize your most expensive prompts</li>
                <li>Consider using more cost-effective models for simple tasks</li>
                <li>Batch similar requests to reduce overhead</li>
                <li>Enable prompt caching where applicable</li>
              </ul>
              <a href="${this.configService.getOrThrow<string>('FRONTEND_URL')}/dashboard" style="display: inline-block; padding: 12px 24px; background-color: #4a90e2; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0;">View Dashboard</a>
            </div>
            <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
              <p>You can update your alert preferences in your account settings.</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: 'Cost Alert - Cost Katana',
      html,
    });
  }

  async sendTeamInvitation(
    email: string,
    inviterName: string,
    workspaceName: string,
    inviteUrl: string,
    role: string,
  ): Promise<void> {
    const year = this.getCurrentYear();
    const roleDescription =
      {
        admin: 'Administrator - Manage team members and projects',
        developer: 'Developer - Access assigned projects and create API keys',
        viewer: 'Viewer - Read-only access to assigned projects',
      }[role] || 'Team Member';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #06b6d4; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background-color: #06b6d4; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #06b6d4; color: white; padding: 20px; text-align: center;">
              <h1>Team Invitation</h1>
            </div>
            <div style="padding: 20px; background-color: #f9f9f9;">
              <h2>You're invited to join ${workspaceName}!</h2>
              <p><strong>${inviterName}</strong> has invited you to join their workspace on Cost Katana.</p>
              <p><strong>Role:</strong> ${role.charAt(0).toUpperCase() + role.slice(1)}</p>
              <p>${roleDescription}</p>
              <a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background-color: #06b6d4; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0;">Accept Invitation</a>
              <p>This invitation will expire in 7 days.</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `You're invited to join ${workspaceName} on Cost Katana`,
      html,
    });
  }

  /**
   * Send an alert email to a recipient. Uses alert title, message, type, and severity to build the email.
   */
  async sendAlert(
    alert: Alert | AlertEmailPayload,
    recipientEmail: string,
  ): Promise<void> {
    const title = alert.title ?? 'Cost Katana Alert';
    const message = alert.message ?? 'You have a new alert.';
    const type = alert.type ?? 'alert';
    const severity = 'severity' in alert ? alert.severity : 'medium';
    const year = this.getCurrentYear();
    const dashboardUrl =
      this.configService.getOrThrow<string>('FRONTEND_URL') +
      '/dashboard/alerts';
    const headerColor = this.getSeverityColor(severity ?? 'medium');
    const typeLabel = type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .message-box { background-color: #fff; border-left: 4px solid ${headerColor}; padding: 16px; margin: 16px 0; border-radius: 0 4px 4px 0; }
            .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
            .button { display: inline-block; padding: 12px 24px; background-color: ${headerColor}; color: white; text-decoration: none; border-radius: 4px; margin: 16px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div class="header" style="background-color: ${headerColor};">
              <h1 style="margin: 0;">${this.escapeHtml(title)}</h1>
              <span class="badge" style="background-color: rgba(255,255,255,0.25); margin-top: 8px;">${this.escapeHtml(typeLabel)}</span>
            </div>
            <div class="content">
              <div class="message-box">
                <p style="margin: 0 0 12px; white-space: pre-wrap;">${this.escapeHtml(message)}</p>
              </div>
              <a href="${this.escapeHtml(dashboardUrl)}" class="button">View in Dashboard</a>
            </div>
            <div class="footer">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: recipientEmail,
      subject: `[Cost Katana] ${title}`,
      html,
    });
  }

  /**
   * Send alert notification to a user (used when user and alert are available, e.g. from UserService).
   */
  async sendAlertNotification(
    user: User | { email: string },
    alert: Alert | AlertEmailPayload,
  ): Promise<void> {
    const email =
      typeof user === 'object' && user !== null && 'email' in user
        ? user.email
        : '';
    if (!email) {
      this.logger.warn(
        'sendAlertNotification: no email on user, skipping send',
      );
      return;
    }
    await this.sendAlert(alert, email);
  }

  private getSeverityColor(severity: string): string {
    const colors: Record<string, string> = {
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#f59e0b',
      low: '#22c55e',
    };
    return colors[severity?.toLowerCase()] ?? '#f59e0b';
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (c) => map[c] ?? c);
  }

  /**
   * Send notification when a team member is removed
   */
  async sendMemberRemoved(
    email: string,
    memberName: string,
    workspaceName: string,
    removedBy: string,
  ): Promise<void> {
    const year = this.getCurrentYear();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #ef4444; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #ef4444; color: white; padding: 20px; text-align: center;">
              <h1>Team Membership Update</h1>
            </div>
            <div style="padding: 20px; background-color: #f9f9f9;">
              <h2>Your access has been removed</h2>
              <p>Hello ${memberName},</p>
              <p>Your membership in the <strong>${workspaceName}</strong> workspace on Cost Katana has been removed by ${removedBy}.</p>
              <p>If you believe this was done in error, please contact your workspace administrator.</p>
              <p>You will no longer have access to projects and resources in this workspace.</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `Your access to ${workspaceName} has been removed`,
      html,
    });
  }

  /**
   * Send notification when a team member's role is changed
   */
  async sendRoleChanged(
    email: string,
    memberName: string,
    workspaceName: string,
    oldRole: string,
    newRole: string,
    changedBy: string,
  ): Promise<void> {
    const year = this.getCurrentYear();

    const roleDescriptions = {
      admin: 'Administrator - Manage team members and projects',
      developer: 'Developer - Access assigned projects and create API keys',
      viewer: 'Viewer - Read-only access to assigned projects',
    };

    const oldRoleDescription =
      roleDescriptions[oldRole as keyof typeof roleDescriptions] || oldRole;
    const newRoleDescription =
      roleDescriptions[newRole as keyof typeof roleDescriptions] || newRole;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f59e0b; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .role-change { background-color: #fff; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f59e0b; color: white; padding: 20px; text-align: center;">
              <h1>Role Update</h1>
            </div>
            <div style="padding: 20px; background-color: #f9f9f9;">
              <h2>Your role has been updated</h2>
              <p>Hello ${memberName},</p>
              <p>Your role in the <strong>${workspaceName}</strong> workspace on Cost Katana has been changed by ${changedBy}.</p>

              <div style="background-color: #fff; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0;">
                <p><strong>Previous role:</strong> ${oldRole.charAt(0).toUpperCase() + oldRole.slice(1)}</p>
                <p><em>${oldRoleDescription}</em></p>
                <br>
                <p><strong>New role:</strong> ${newRole.charAt(0).toUpperCase() + newRole.slice(1)}</p>
                <p><em>${newRoleDescription}</em></p>
              </div>

              <p>Your permissions and access levels have been updated accordingly.</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `Your role in ${workspaceName} has been updated`,
      html,
    });
  }

  async sendSecondaryEmailVerification(
    email: string,
    verificationUrl: string,
    userName: string,
  ): Promise<void> {
    const year = this.getCurrentYear();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #10b981; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background-color: #10b981; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Verify Your Secondary Email</h1>
          </div>
          <div class="content">
            <h2>Hi ${userName},</h2>
            <p>Please verify your secondary email address by clicking the button below:</p>
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
            <p>This verification link will expire in 24 hours.</p>
            <p>If you didn't add this email address to your account, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Verify Your Secondary Email - Cost Katana',
      html,
    });
  }

  async sendOptimizationAlert(
    user: User | { name: string; email: string },
    optimization: any,
  ): Promise<void> {
    const year = this.getCurrentYear();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #8b5cf6; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .optimization-box { background-color: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #8b5cf6; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Optimization Opportunity Found</h1>
          </div>
          <div class="content">
            <h2>Hi ${user.name},</h2>
            <p>We've identified a new optimization opportunity for your AI usage:</p>

            <div class="optimization-box">
              <h3>${optimization.title || 'AI Optimization Opportunity'}</h3>
              <p>${optimization.description || 'A new way to reduce your AI costs has been identified.'}</p>
              ${optimization.potentialSavings ? `<p><strong>Potential Savings:</strong> $${optimization.potentialSavings.toFixed(2)} per month</p>` : ''}
              ${optimization.type ? `<p><strong>Type:</strong> ${optimization.type}</p>` : ''}
            </div>

            <a href="${this.configService.getOrThrow<string>('FRONTEND_URL')}/optimizations" class="button">View Optimization</a>

            <p>You can apply this optimization directly from your dashboard.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: 'New Optimization Opportunity - Cost Katana',
      html,
    });
  }

  async sendPerformanceAlertNotification(
    user: User | { name: string; email: string },
    alert: any,
  ): Promise<void> {
    const year = this.getCurrentYear();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f59e0b; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .alert-box { background-color: #fff3cd; border: 1px solid #f59e0b; padding: 15px; border-radius: 4px; margin: 20px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #f59e0b; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Performance Alert</h1>
          </div>
          <div class="content">
            <h2>Hi ${user.name},</h2>
            <div class="alert-box">
              <p><strong>${alert.title || 'Performance Alert'}</strong></p>
              <p>${alert.message || 'There is a performance issue that requires your attention.'}</p>
            </div>

            <a href="${this.configService.getOrThrow<string>('FRONTEND_URL')}/dashboard" class="button">View Dashboard</a>

            <p>Please review the performance metrics and take appropriate action.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: `Performance Alert - Cost Katana`,
      html,
    });
  }

  async sendAccountClosureConfirmation(
    user: User | { name: string; email: string },
    deletionScheduledAt: Date,
  ): Promise<void> {
    const year = this.getCurrentYear();
    const deletionDate = deletionScheduledAt.toLocaleDateString();
    const deletionTime = deletionScheduledAt.toLocaleTimeString();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .confirmation-box { background-color: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .warning { background-color: #fef2f2; border: 1px solid #dc2626; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Account Closure Initiated</h1>
          </div>
          <div class="content">
            <h2>Hi ${user.name},</h2>
            <p>You have initiated the closure of your Cost Katana account.</p>

            <div class="confirmation-box">
              <h3>Account Closure Details</h3>
              <p><strong>Scheduled Deletion:</strong> ${deletionDate} at ${deletionTime}</p>
              <p><strong>Grace Period:</strong> You have 24 hours to cancel this action</p>
            </div>

            <div class="warning">
              <p><strong>Important:</strong> After the deletion date, your account and all associated data will be permanently removed and cannot be recovered.</p>
            </div>

            <p>If you wish to cancel this action:</p>
            <a href="${this.configService.getOrThrow<string>('FRONTEND_URL')}/settings/account" class="button">Cancel Account Closure</a>

            <p>If you have any questions or need assistance, please contact our support team.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: 'Account Closure Initiated - Cost Katana',
      html,
    });
  }

  async sendAccountClosureFinalWarning(
    user: User | { name: string; email: string },
    immediateDeletionAt: Date,
  ): Promise<void> {
    const year = this.getCurrentYear();
    const deletionDate = immediateDeletionAt.toLocaleDateString();
    const deletionTime = immediateDeletionAt.toLocaleTimeString();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .urgent { background-color: #fff; border: 2px solid #dc2626; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>⚠️ FINAL WARNING - Account Deletion Imminent</h1>
          </div>
          <div class="content">
            <h2>Hi ${user.name},</h2>

            <div class="urgent">
              <h3>URGENT: Your Account Will Be Deleted in 1 Hour</h3>
              <p><strong>Final Deletion:</strong> ${deletionDate} at ${deletionTime}</p>
              <p>This is your final warning. Your account closure was initiated and the deletion process will complete in 1 hour.</p>
            </div>

            <p><strong>This action cannot be undone.</strong> Once your account is deleted:</p>
            <ul>
              <li>All your data will be permanently removed</li>
              <li>You will lose access to all projects and API keys</li>
              <li>Your billing history will be archived</li>
              <li>You cannot recover your account or data</li>
            </ul>

            <p>If you wish to stop this deletion:</p>
            <a href="${this.configService.getOrThrow<string>('FRONTEND_URL')}/settings/account" class="button">Cancel Deletion Immediately</a>

            <p>If you have already left the platform or this was intentional, no further action is needed.</p>

            <p>For urgent assistance, contact our support team immediately.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: '⚠️ FINAL WARNING - Account Deletion in 1 Hour - Cost Katana',
      html,
    });
  }

  async sendAccountReactivated(email: string, userName: string): Promise<void> {
    const year = this.getCurrentYear();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #10b981; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .success-box { background-color: #f0fdf4; border: 1px solid #10b981; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #10b981; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Account Reactivated</h1>
          </div>
          <div class="content">
            <h2>Welcome back, ${userName}!</h2>

            <div class="success-box">
              <p><strong>✅ Your Cost Katana account has been successfully reactivated.</strong></p>
              <p>Your account closure has been cancelled and you now have full access to all your data and features.</p>
            </div>

            <p>You can now:</p>
            <ul>
              <li>Access all your projects and conversations</li>
              <li>Use your API keys for new requests</li>
              <li>View your billing and usage history</li>
              <li>Continue optimizing your AI costs</li>
            </ul>

            <a href="${this.configService.getOrThrow<string>('FRONTEND_URL')}/dashboard" class="button">Go to Dashboard</a>

            <p>If you have any questions about your account reactivation, please contact our support team.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Account Reactivated - Welcome Back to Cost Katana',
      html,
    });
  }

  async sendAccountDeleted(email: string, userName: string): Promise<void> {
    const year = this.getCurrentYear();
    const deletionDate = new Date().toLocaleDateString();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #6b7280; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .info-box { background-color: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Account Deletion Completed</h1>
          </div>
          <div class="content">
            <h2>Goodbye, ${userName}</h2>
            <h3>Account Deletion Confirmation</h3>
            <p>This is to confirm that your Cost Katana account has been permanently deleted on ${deletionDate}.</p>

            <div class="info-box">
              <h3>What Was Deleted</h3>
              <ul>
                <li>Your account profile and personal information</li>
                <li>All conversations and chat history</li>
                <li>All projects and associated data</li>
                <li>API keys and authentication credentials</li>
                <li>Billing history and payment methods</li>
                <li>Usage analytics and optimization data</li>
              </ul>
            </div>

            <p><strong>This action was permanent and cannot be undone.</strong></p>

            <p>If you wish to use Cost Katana again in the future, you will need to create a new account.</p>

            <p>Thank you for using Cost Katana, ${userName}. We hope our service was helpful during your time with us.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Account Deletion Completed - Cost Katana',
      html,
    });
  }

  async sendProjectAssigned(
    email: string,
    workspaceName: string,
    projectNames: string[],
  ): Promise<void> {
    const year = this.getCurrentYear();
    const projectList = projectNames.map((name) => `<li>${name}</li>`).join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #3b82f6; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .project-box { background-color: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>New Project Assignment</h1>
          </div>
          <div class="content">
            <h2>You've been assigned to new projects!</h2>
            <p>You have been granted access to the following project(s) in the <strong>${workspaceName}</strong> workspace:</p>

            <div class="project-box">
              <h3>Assigned Projects:</h3>
              <ul>
                ${projectList}
              </ul>
            </div>

            <p>You now have access to view and work with these projects in your dashboard.</p>

            <a href="${this.configService.getOrThrow<string>('FRONTEND_URL')}/dashboard" class="button">View Projects</a>

            <p>If you have any questions about these projects or need additional permissions, please contact your workspace administrator.</p>
          </div>
          <div class="footer">
            <p>&copy; ${year} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `New Project Assignment - ${workspaceName}`,
      html,
    });
  }

  async sendDeletionWarning(
    to: string,
    scheduledDeletionAt: Date,
  ): Promise<void> {
    const deletionDate = scheduledDeletionAt.toLocaleDateString();
    const deletionTime = scheduledDeletionAt.toLocaleTimeString();

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .warning { background-color: #fff; padding: 15px; border-left: 4px solid #dc2626; margin: 15px 0; }
            .actions { text-align: center; margin: 20px 0; }
            .button { display: inline-block; padding: 10px 20px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 5px; margin: 0 10px; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>⚠️ Account Deletion Warning</h1>
          </div>
          <div class="content">
            <h2>Your Account Will Be Deleted Soon</h2>
            <div class="warning">
              <p><strong>Scheduled Deletion:</strong> ${deletionDate} at ${deletionTime}</p>
              <p>You initiated account closure, and your account is scheduled for permanent deletion in 24 hours.</p>
            </div>
            <p>If you did not request this deletion or have changed your mind, you can cancel the deletion process:</p>
            <div class="actions">
              <a href="#" class="button">Cancel Deletion</a>
              <a href="#" class="button">Reactivate Account</a>
            </div>
            <p>If you do not take action, your account and all associated data will be permanently deleted.</p>
            <p>This action cannot be undone.</p>
          </div>
          <div class="footer">
            <p>If you have any questions, please contact our support team.</p>
            <p>&copy; ${this.getCurrentYear()} Cost Katana. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    const text = `
Account Deletion Warning

Your Cost Katana account is scheduled for deletion on ${deletionDate} at ${deletionTime}.

If you did not request this deletion or have changed your mind, please log in to your account and cancel the deletion process.

This action cannot be undone. All your data will be permanently deleted.

Questions? Contact our support team.
    `;

    await this.sendEmail({
      to,
      subject: '⚠️ Your Cost Katana Account Will Be Deleted in 24 Hours',
      html,
      text,
    });
  }
}

/** Minimal alert shape needed to send an alert email */
export interface AlertEmailPayload {
  title?: string;
  message: string;
  type: string;
  severity?: string;
  _id?: unknown;
}
