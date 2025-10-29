import { emailTransporter, EMAIL_CONFIG } from '../config/email';
import { IUser } from '../models/User';
import { IAlert } from '../models/Alert';
import { loggingService } from './logging.service';
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

  static async sendEmail(options: EmailOptions): Promise<void> {
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

      loggingService.info('Email sent successfully', { value:  { 
        messageId: info.messageId,
        to: options.to,
        subject: options.subject,
       } });
    } catch (error) {
      loggingService.error('Error sending email:', { error: error instanceof Error ? error.message : String(error) });
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
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .button-container {
              text-align: center;
              margin: 32px 0;
            }
            .button {
              display: inline-block;
              padding: 14px 32px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              text-decoration: none;
              border-radius: 12px;
              font-weight: 600;
              font-size: 16px;
              box-shadow: 0 10px 25px -5px rgba(102, 126, 234, 0.4);
              transition: transform 0.2s;
            }
            .button:hover {
              transform: translateY(-2px);
            }
            .link-box {
              background: #f3f4f6;
              padding: 16px;
              border-radius: 8px;
              word-break: break-all;
              color: #667eea;
              font-size: 14px;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .info-box {
              background: #ede9fe;
              border-left: 4px solid #8b5cf6;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .info-box p {
              margin: 0;
              color: #5b21b6;
              font-size: 14px;
            }
            .warning-box {
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .warning-box p {
              margin: 0;
              color: #78350f;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">✉️</div>
              <h1>Welcome to Cost Katana!</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.name},</h2>
              <p>Thank you for signing up! We're excited to help you optimize your AI costs and maximize your ROI.</p>
              
              <div class="info-box">
                <p><strong>🚀 Get Started:</strong> Verify your email to unlock full access to Cost Katana's powerful AI cost optimization features.</p>
              </div>
              
              <p>Click the button below to verify your email address:</p>
              
              <div class="button-container">
                <a href="${verificationUrl}" class="button">Verify Email Address</a>
              </div>
              
              <p>Or copy and paste this link into your browser:</p>
              <div class="link-box">${verificationUrl}</div>
              
              <div class="warning-box">
                <p><strong>⏰ This link will expire in 24 hours</strong> for security reasons.</p>
              </div>

              <p><strong>Didn't create an account?</strong> If you didn't sign up for Cost Katana, you can safely ignore this email.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: '✉️ Verify your Cost Katana account',
      html,
    });
  }

  static async sendSecondaryEmailVerification(email: string, verificationUrl: string, userName: string): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .button-container {
              text-align: center;
              margin: 32px 0;
            }
            .button {
              display: inline-block;
              padding: 14px 32px;
              background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
              color: white;
              text-decoration: none;
              border-radius: 12px;
              font-weight: 600;
              font-size: 16px;
              box-shadow: 0 10px 25px -5px rgba(6, 182, 212, 0.4);
              transition: transform 0.2s;
            }
            .button:hover {
              transform: translateY(-2px);
            }
            .link-box {
              background: #f3f4f6;
              padding: 16px;
              border-radius: 8px;
              word-break: break-all;
              color: #0891b2;
              font-size: 14px;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .info-box {
              background: #dbeafe;
              border-left: 4px solid #3b82f6;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .info-box p {
              margin: 0;
              color: #1e3a8a;
              font-size: 14px;
            }
            .warning-box {
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .warning-box p {
              margin: 0;
              color: #78350f;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">📧</div>
              <h1>Verify Secondary Email</h1>
            </div>
            <div class="content">
              <h2>Hi ${userName},</h2>
              <p>You've added this email address as a secondary email for your Cost Katana account.</p>
              <div class="info-box">
                <p><strong>ℹ️ Why verify?</strong> Verifying this email allows you to use it as a backup and potentially set it as your primary email.</p>
              </div>
              <p>Click the button below to verify this email address:</p>
              <div class="button-container">
                <a href="${verificationUrl}" class="button">Verify Email Address</a>
              </div>
              <p>Or copy and paste this link into your browser:</p>
              <div class="link-box">${verificationUrl}</div>
              <div class="warning-box">
                <p><strong>⏰ This link will expire in 24 hours</strong> for security reasons.</p>
              </div>
              <p><strong>Didn't add this email?</strong> If you didn't request this, you can safely ignore this email. The email won't be added to your account without verification.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Verify your secondary email - Cost Katana',
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
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .button-container {
              text-align: center;
              margin: 32px 0;
            }
            .button {
              display: inline-block;
              padding: 14px 32px;
              background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
              color: white;
              text-decoration: none;
              border-radius: 12px;
              font-weight: 600;
              font-size: 16px;
              box-shadow: 0 10px 25px -5px rgba(239, 68, 68, 0.4);
              transition: transform 0.2s;
            }
            .button:hover {
              transform: translateY(-2px);
            }
            .link-box {
              background: #f3f4f6;
              padding: 16px;
              border-radius: 8px;
              word-break: break-all;
              color: #ef4444;
              font-size: 14px;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .warning-box {
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .warning-box p {
              margin: 0;
              color: #78350f;
              font-size: 14px;
            }
            .danger-box {
              background: #fee2e2;
              border-left: 4px solid #dc2626;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .danger-box p {
              margin: 0;
              color: #7f1d1d;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">🔐</div>
              <h1>Password Reset Request</h1>
            </div>
            <div class="content">
              <h2>Hi ${user.name},</h2>
              <p>We received a request to reset your password for your Cost Katana account.</p>
              
              <p>Click the button below to create a new password:</p>
              
              <div class="button-container">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </div>
              
              <p>Or copy and paste this link into your browser:</p>
              <div class="link-box">${resetUrl}</div>
              
              <div class="warning-box">
                <p><strong>⏰ This link will expire in 1 hour</strong> for security reasons.</p>
              </div>

              <div class="danger-box">
                <p><strong>⚠️ Didn't request this?</strong> If you didn't request a password reset, please ignore this email and ensure your account is secure. Your password will not change unless you click the link above.</p>
              </div>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: user.email,
      subject: '🔐 Password Reset - Cost Katana',
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

  /**
   * Send account closure confirmation email
   */
  static async sendAccountClosureConfirmation(
    email: string,
    confirmationUrl: string,
    userName: string
  ): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .button-container {
              text-align: center;
              margin: 32px 0;
            }
            .button {
              display: inline-block;
              padding: 14px 32px;
              background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
              color: white;
              text-decoration: none;
              border-radius: 12px;
              font-weight: 600;
              font-size: 16px;
              box-shadow: 0 10px 25px -5px rgba(220, 38, 38, 0.4);
              transition: transform 0.2s;
            }
            .button:hover {
              transform: translateY(-2px);
            }
            .link-box {
              background: #f3f4f6;
              padding: 16px;
              border-radius: 8px;
              word-break: break-all;
              color: #dc2626;
              font-size: 14px;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .warning-box {
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .warning-box p {
              margin: 0;
              color: #78350f;
              font-size: 14px;
            }
            .danger-box {
              background: #fee2e2;
              border-left: 4px solid #dc2626;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .danger-box p {
              margin: 0;
              color: #7f1d1d;
              font-size: 14px;
            }
            .danger-box ul {
              margin: 8px 0 0 20px;
              color: #7f1d1d;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">⚠️</div>
              <h1>Confirm Account Closure</h1>
            </div>
            <div class="content">
              <h2>Hi ${userName},</h2>
              <p>We received a request to close your Cost Katana account. This is a serious action that will permanently delete your account after a grace period.</p>
              
              <div class="danger-box">
                <p><strong>⚠️ Important: What happens next?</strong></p>
                <ul>
                  <li><strong>24-hour cooldown:</strong> After confirming, there's a 24-hour waiting period</li>
                  <li><strong>30-day grace period:</strong> After cooldown, you have 30 days to change your mind</li>
                  <li><strong>Automatic reactivation:</strong> Simply log in during the grace period to reactivate</li>
                  <li><strong>Permanent deletion:</strong> After 30 days, all your data will be permanently deleted</li>
                </ul>
              </div>

              <p><strong>Click the button below to confirm account closure and start the 24-hour cooldown:</strong></p>
              
              <div class="button-container">
                <a href="${confirmationUrl}" class="button">Confirm Account Closure</a>
              </div>
              
              <p>Or copy and paste this link into your browser:</p>
              <div class="link-box">${confirmationUrl}</div>
              
              <div class="warning-box">
                <p><strong>⏰ This link will expire in 24 hours</strong> for security reasons.</p>
              </div>

              <p><strong>Didn't request this?</strong> If you didn't try to close your account, please ignore this email and your account will remain active. We recommend changing your password immediately.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: '⚠️ Confirm Account Closure - Cost Katana',
      html,
    });
  }

  /**
   * Send final warning before account deletion
   */
  static async sendAccountClosureFinalWarning(
    email: string,
    userName: string,
    daysRemaining: number
  ): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .button-container {
              text-align: center;
              margin: 32px 0;
            }
            .button {
              display: inline-block;
              padding: 14px 32px;
              background: linear-gradient(135deg, #059669 0%, #047857 100%);
              color: white;
              text-decoration: none;
              border-radius: 12px;
              font-weight: 600;
              font-size: 16px;
              box-shadow: 0 10px 25px -5px rgba(5, 150, 105, 0.4);
              transition: transform 0.2s;
            }
            .button:hover {
              transform: translateY(-2px);
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .warning-box {
              background: #fee2e2;
              border-left: 4px solid #dc2626;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
              text-align: center;
            }
            .warning-box h3 {
              margin: 0 0 8px 0;
              color: #991b1b;
              font-size: 20px;
            }
            .warning-box p {
              margin: 0;
              color: #7f1d1d;
              font-size: 16px;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">⏰</div>
              <h1>Account Deletion Warning</h1>
            </div>
            <div class="content">
              <h2>Hi ${userName},</h2>
              
              <div class="warning-box">
                <h3>⚠️ ${daysRemaining} Days Remaining</h3>
                <p>Your account will be permanently deleted in ${daysRemaining} days</p>
              </div>

              <p>This is a friendly reminder that you requested to close your Cost Katana account, and it is currently scheduled for permanent deletion.</p>
              
              <p><strong>Changed your mind?</strong> You can easily reactivate your account by simply logging in. All your data will be restored immediately.</p>

              <div class="button-container">
                <a href="${process.env.FRONTEND_URL}/login" class="button">Reactivate My Account</a>
              </div>

              <p><strong>If you do nothing:</strong> Your account and all associated data will be permanently deleted in ${daysRemaining} days. This action cannot be undone after the deletion date.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `⏰ Account Deletion in ${daysRemaining} Days - Cost Katana`,
      html,
    });
  }

  /**
   * Send account reactivated confirmation
   */
  static async sendAccountReactivated(email: string, userName: string): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #059669 0%, #047857 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #059669 0%, #047857 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .success-box {
              background: #d1fae5;
              border-left: 4px solid #059669;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .success-box p {
              margin: 0;
              color: #065f46;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">🎉</div>
              <h1>Account Reactivated!</h1>
            </div>
            <div class="content">
              <h2>Welcome back, ${userName}!</h2>
              
              <div class="success-box">
                <p><strong>✅ Your account has been successfully reactivated!</strong></p>
              </div>

              <p>Great news! Your Cost Katana account is now active again, and all your data has been fully restored.</p>
              
              <p>The account closure request has been cancelled, and you can continue using all features as before.</p>

              <p>We're glad to have you back! If you have any questions or need assistance, please don't hesitate to reach out to our support team.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: '🎉 Account Reactivated - Welcome Back! - Cost Katana',
      html,
    });
  }

  /**
   * Send account deleted confirmation
   */
  static async sendAccountDeleted(email: string, userName: string): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">👋</div>
              <h1>Account Deleted</h1>
            </div>
            <div class="content">
              <h2>Goodbye, ${userName}</h2>
              
              <p>Your Cost Katana account has been permanently deleted as requested. All your data, including:</p>
              
              <ul>
                <li>Profile information</li>
                <li>API keys and credentials</li>
                <li>Usage data and analytics</li>
                <li>Preferences and settings</li>
              </ul>

              <p>...has been permanently removed from our systems.</p>

              <p>We're sorry to see you go. If you change your mind in the future, you're always welcome to create a new account.</p>

              <p>Thank you for using Cost Katana. We wish you all the best!</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Account Deleted - Cost Katana',
      html,
    });
  }

  /**
   * Send team invitation email
   */
  static async sendTeamInvitation(email: string, inviterName: string, workspaceName: string, inviteUrl: string, role: string): Promise<void> {
    const year = this.getCurrentYear();
    const roleDescription = {
      admin: 'Administrator - Manage team members and projects',
      developer: 'Developer - Access assigned projects and create API keys',
      viewer: 'Viewer - Read-only access to assigned projects',
    }[role] || 'Team Member';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .button {
              display: inline-block;
              padding: 16px 32px;
              margin: 24px 0;
              background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
              color: white;
              text-decoration: none;
              border-radius: 12px;
              font-weight: 600;
              font-size: 16px;
              box-shadow: 0 4px 6px -1px rgba(6, 182, 212, 0.3);
              transition: all 0.2s;
            }
            .button:hover {
              transform: translateY(-2px);
              box-shadow: 0 10px 15px -3px rgba(6, 182, 212, 0.4);
            }
            .info-box {
              background: linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);
              border-left: 4px solid #06b6d4;
              padding: 16px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .role-badge {
              display: inline-block;
              padding: 8px 16px;
              background: rgba(6, 182, 212, 0.1);
              color: #0891b2;
              border-radius: 8px;
              font-weight: 600;
              font-size: 14px;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">👥</div>
              <h1>Team Invitation</h1>
            </div>
            <div class="content">
              <h2>You're invited to join ${workspaceName}!</h2>
              
              <p><strong>${inviterName}</strong> has invited you to join their workspace on Cost Katana.</p>
              
              <div class="role-badge">Role: ${role.charAt(0).toUpperCase() + role.slice(1)}</div>
              
              <p style="color: #6b7280; font-size: 14px;">${roleDescription}</p>
              
              <div class="info-box">
                <p style="margin: 0;"><strong>What is Cost Katana?</strong></p>
                <p style="margin: 8px 0 0 0; font-size: 14px;">Cost Katana is an AI cost optimization platform that helps teams track, analyze, and reduce their AI API costs.</p>
              </div>

              <p>Click the button below to accept the invitation:</p>

              <a href="${inviteUrl}" class="button">Accept Invitation</a>

              <p style="font-size: 14px; color: #6b7280;">This invitation will expire in 7 days.</p>
              
              <p style="font-size: 14px; color: #6b7280;">If you didn't expect this invitation, you can safely ignore this email.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
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
   * Send member removed email
   */
  static async sendMemberRemoved(email: string, workspaceName: string, removedBy: string): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">👋</div>
              <h1>Team Access Removed</h1>
            </div>
            <div class="content">
              <h2>Access to ${workspaceName} has been removed</h2>
              
              <p>Your access to the <strong>${workspaceName}</strong> workspace has been removed by ${removedBy}.</p>
              
              <p>You will no longer be able to access projects, data, or resources in this workspace.</p>

              <p>If you believe this was done in error, please contact the workspace administrator.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `Team access removed - ${workspaceName}`,
      html,
    });
  }

  /**
   * Send role changed email
   */
  static async sendRoleChanged(email: string, workspaceName: string, oldRole: string, newRole: string): Promise<void> {
    const year = this.getCurrentYear();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .role-change {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 16px;
              margin: 24px 0;
              padding: 20px;
              background: #f9fafb;
              border-radius: 12px;
            }
            .role-badge {
              padding: 8px 16px;
              border-radius: 8px;
              font-weight: 600;
              font-size: 14px;
            }
            .role-old {
              background: rgba(239, 68, 68, 0.1);
              color: #dc2626;
            }
            .role-new {
              background: rgba(34, 197, 94, 0.1);
              color: #16a34a;
            }
            .arrow {
              font-size: 24px;
              color: #6b7280;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">🔄</div>
              <h1>Role Updated</h1>
            </div>
            <div class="content">
              <h2>Your role has been updated</h2>
              
              <p>Your role in the <strong>${workspaceName}</strong> workspace has been changed.</p>
              
              <div class="role-change">
                <span class="role-badge role-old">${oldRole.charAt(0).toUpperCase() + oldRole.slice(1)}</span>
                <span class="arrow">→</span>
                <span class="role-badge role-new">${newRole.charAt(0).toUpperCase() + newRole.slice(1)}</span>
              </div>

              <p>Your permissions and access have been updated to reflect your new role.</p>

              <p>If you have any questions about your new permissions, please contact your workspace administrator.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `Role updated in ${workspaceName}`,
      html,
    });
  }

  /**
   * Send project assigned email
   */
  static async sendProjectAssigned(email: string, workspaceName: string, projectNames: string[]): Promise<void> {
    const year = this.getCurrentYear();
    const projectList = projectNames.map(name => `<li>${name}</li>`).join('');
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #1f2937;
              background: linear-gradient(135deg, #10b981 0%, #059669 100%);
              margin: 0;
              padding: 40px 20px;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: rgba(255, 255, 255, 0.95);
              backdrop-filter: blur(10px);
              border-radius: 24px;
              overflow: hidden;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            .header {
              background: linear-gradient(135deg, #10b981 0%, #059669 100%);
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
              color: #1f2937;
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #4b5563;
              margin: 16px 0;
              font-size: 16px;
            }
            .project-list {
              background: #f9fafb;
              padding: 20px;
              border-radius: 12px;
              margin: 20px 0;
            }
            .project-list ul {
              margin: 0;
              padding-left: 24px;
            }
            .project-list li {
              margin: 8px 0;
              color: #1f2937;
              font-weight: 500;
            }
            .footer {
              text-align: center;
              padding: 30px;
              color: #6b7280;
              font-size: 14px;
              background: #f9fafb;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">📁</div>
              <h1>Projects Assigned</h1>
            </div>
            <div class="content">
              <h2>New projects assigned to you</h2>
              
              <p>You've been assigned to new projects in the <strong>${workspaceName}</strong> workspace.</p>
              
              <div class="project-list">
                <p style="margin: 0 0 12px 0; font-weight: 600; color: #1f2937;">Your Projects:</p>
                <ul>${projectList}</ul>
              </div>

              <p>You can now access and work on these projects based on your role permissions.</p>
            </div>
            <div class="footer">
              <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
              <p>© ${year} Cost Katana. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `New projects assigned in ${workspaceName}`,
      html,
    });
  }
}