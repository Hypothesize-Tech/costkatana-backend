import { emailTransporter, EMAIL_CONFIG } from '../config/email';
import { IUser } from '../models/User';
import { IAlert } from '../models/Alert';
import { logger } from '../utils/logger';
import { formatCurrency } from '../utils/helpers';

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

export class EmailService {
  private static getCurrentYear(): number {
    return new Date().getFullYear();
  }

  private static async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const transporter = await emailTransporter;

      const mailOptions = {
        from: EMAIL_CONFIG.from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || this.stripHtml(options.html),
        attachments: options.attachments,
      };

      const info = await transporter.sendMail(mailOptions);

      logger.info('Email sent successfully', {
        messageId: info.messageId,
        to: options.to,
        subject: options.subject,
      });
    } catch (error) {
      logger.error('Error sending email:', error);
      throw error;
    }
  }

  static async sendVerificationEmail(user: IUser, verificationUrl: string): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4a90e2; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background-color: #4a90e2; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to Cost Katana!</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.name},</h2>
              <p>Thank you for signing up! Please verify your email address to complete your registration.</p>
              <p style="text-align: center;">
                <a href="${verificationUrl}" class="button">Verify Email</a>
              </p>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #4a90e2;">${verificationUrl}</p>
              <p>This link will expire in 24 hours.</p>
            </div>
            <div class="footer">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: 'Verify your Cost Katana account',
      html,
    });
  }

  static async sendPasswordResetEmail(user: IUser, resetUrl: string): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #e74c3c; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background-color: #e74c3c; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.name},</h2>
              <p>We received a request to reset your password. Click the button below to create a new password:</p>
              <p style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </p>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #e74c3c;">${resetUrl}</p>
              <p>This link will expire in 1 hour.</p>
              <p><strong>If you didn't request this password reset, please ignore this email.</strong></p>
            </div>
            <div class="footer">
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

  static async sendCostAlert(user: IUser, currentCost: number, threshold: number): Promise<void> {
    const year = this.getCurrentYear();
    const percentage = ((currentCost / threshold) * 100).toFixed(1);

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
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
          <div class="container">
            <div class="header">
              <h1>⚠️ Cost Alert</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.name},</h2>
              <div class="alert-box">
                <p><strong>Your AI API usage has exceeded your cost threshold!</strong></p>
              </div>
              <div class="stats">
                <div class="stat">
                  <div class="stat-value">${formatCurrency(currentCost)}</div>
                  <div>Current Cost</div>
                </div>
                <div class="stat">
                  <div class="stat-value">${formatCurrency(threshold)}</div>
                  <div>Your Threshold</div>
                </div>
                <div class="stat">
                  <div class="stat-value">${percentage}%</div>
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
              <p style="text-align: center;">
                <a href="${process.env.FRONTEND_URL}/dashboard" class="button">View Dashboard</a>
              </p>
            </div>
            <div class="footer">
              <p>You can update your alert preferences in your account settings.</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: EMAIL_CONFIG.templates.costAlert.subject,
      html,
    });
  }

  static async sendOptimizationAlert(user: IUser, optimization: any): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #27ae60; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .savings-box { background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 4px; margin: 20px 0; }
            .comparison { background-color: white; padding: 15px; border-radius: 4px; margin: 20px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #27ae60; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💡 Optimization Opportunity</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.name},</h2>
              <p>We've identified a way to optimize one of your frequently used prompts!</p>
              <div class="savings-box">
                <h3 style="margin-top: 0;">Potential Savings</h3>
                <p><strong>${optimization.improvementPercentage.toFixed(1)}%</strong> token reduction</p>
                <p><strong>${formatCurrency(optimization.costSaved)}</strong> estimated savings per use</p>
              </div>
              <div class="comparison">
                <h4>Optimization Techniques Applied:</h4>
                <ul>
                  ${optimization.optimizationTechniques.map((t: string) => `<li>${t}</li>`).join('')}
                </ul>
              </div>
              <p style="text-align: center;">
                <a href="${process.env.FRONTEND_URL}/optimizations/${optimization._id}" class="button">View Optimization</a>
              </p>
            </div>
            <div class="footer">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: EMAIL_CONFIG.templates.optimizationAvailable.subject,
      html,
    });
  }

  static async sendWeeklyReport(user: IUser, reportData: any): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4a90e2; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0; }
            .stat-card { background-color: white; padding: 15px; border-radius: 4px; text-align: center; }
            .stat-value { font-size: 20px; font-weight: bold; color: #4a90e2; }
            .chart { background-color: white; padding: 15px; border-radius: 4px; margin: 20px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #4a90e2; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📊 Weekly AI Usage Report</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.name},</h2>
              <p>Here's your AI usage summary for the past week:</p>
              
              <div class="stats-grid">
                <div class="stat-card">
                  <div class="stat-value">${formatCurrency(reportData.totalCost)}</div>
                  <div>Total Cost</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">${reportData.totalCalls}</div>
                  <div>API Calls</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">${reportData.totalTokens.toLocaleString()}</div>
                  <div>Tokens Used</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">${formatCurrency(reportData.savedThisWeek)}</div>
                  <div>Saved via Optimizations</div>
                </div>
              </div>

              <div class="chart">
                <h3>Top Services by Cost</h3>
                <ul>
                  ${reportData.topServices.map((s: any) =>
      `<li>${s.service}: ${formatCurrency(s.cost)} (${s.percentage.toFixed(1)}%)</li>`
    ).join('')}
                </ul>
              </div>

              ${reportData.recommendations.length > 0 ? `
                <div class="chart">
                  <h3>Recommendations</h3>
                  <ul>
                    ${reportData.recommendations.map((r: string) => `<li>${r}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}

              <p style="text-align: center;">
                <a href="${process.env.FRONTEND_URL}/analytics" class="button">View Detailed Analytics</a>
              </p>
            </div>
            <div class="footer">
              <p>You're receiving this because weekly reports are enabled in your settings.</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: EMAIL_CONFIG.templates.weeklyReport.subject,
      html,
    });
  }

  static async sendAlertNotification(user: IUser, alert: IAlert): Promise<void> {
    const year = this.getCurrentYear();
    const severityColors = {
      low: '#3498db',
      medium: '#f39c12',
      high: '#e74c3c',
      critical: '#c0392b',
    };

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: ${severityColors[alert.severity]}; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .alert-details { background-color: white; padding: 15px; border-radius: 4px; margin: 20px 0; }
            .button { display: inline-block; padding: 12px 24px; background-color: #4a90e2; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${alert.title}</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.name},</h2>
              <div class="alert-details">
                <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
                <p><strong>Type:</strong> ${alert.type.replace(/_/g, ' ').toUpperCase()}</p>
                <p>${alert.message}</p>
              </div>
              ${alert.actionRequired ? `
                <p style="text-align: center;">
                  <a href="${process.env.FRONTEND_URL}/alerts/${alert._id}" class="button">Take Action</a>
                </p>
              ` : ''}
            </div>
            <div class="footer">
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      html,
    });
  }

  private static stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}