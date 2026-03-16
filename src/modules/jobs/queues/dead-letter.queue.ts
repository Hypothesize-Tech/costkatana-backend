import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EmailService } from '../../email/email.service';
// Twilio is optional - use dynamic require to avoid hard dependency; install twilio + @types/twilio when using SMS
let twilio: any;
try {
  twilio = require('twilio');
} catch {
  twilio = null;
}

interface DeadLetterStats {
  totalJobs: number;
  pendingJobs: number;
  retryingJobs: number;
  archivedJobs: number;
  resolvedJobs: number;
  criticalJobs: number;
  avgProcessingTime: number;
}

@Injectable()
@Processor('dead-letter')
export class DeadLetterQueue implements OnModuleInit {
  private readonly logger = new Logger(DeadLetterQueue.name);

  // Configuration
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_MS = 60000; // 1 minute
  private readonly ARCHIVE_AGE_DAYS = 30;
  private readonly BATCH_SIZE = 50;

  constructor(
    @InjectQueue('dead-letter') private queue: Queue,
    @InjectModel('DeadLetterJob') private deadLetterModel: Model<any>,
    @InjectConnection() private readonly connection: Connection,
    private readonly httpService: HttpService,
    @Optional() private readonly emailService: EmailService | null = null,
  ) {}

  async onModuleInit() {
    this.logger.log('📋 Dead Letter Queue initialized');

    // Set up recurring cleanup job
    setInterval(() => this.cleanupOldJobs(), 24 * 60 * 60 * 1000); // Daily cleanup
  }

  @Process('dead-letter')
  async handleDeadLetter(job: Job) {
    const startTime = Date.now();

    try {
      this.logger.warn('💀 Processing dead letter job', {
        jobId: job.id,
        data: job.data,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
      });

      // Extract job information
      const deadLetterData = {
        originalQueue: job.data?.originalQueue || 'unknown',
        originalJobId: job.data?.originalJobId || job.id,
        jobData: job.data,
        failedReason: job.failedReason || 'Unknown failure',
        attemptsMade: job.attemptsMade || 0,
        maxAttempts: job.opts?.attempts || 3,
        failedAt: new Date(),
        retryCount: 0,
        status: 'pending' as const,
        priority: this.determinePriority(job),
        tags: this.extractTags(job),
      };

      // Store in database for tracking
      const savedJob = await this.deadLetterModel.create(deadLetterData);

      // Determine action based on failure type
      const action = await this.determineAction(savedJob);

      switch (action.type) {
        case 'retry':
          await this.scheduleRetry(
            savedJob,
            action.delay ?? this.RETRY_BACKOFF_MS,
          );
          break;

        case 'archive':
          await this.archiveJob(savedJob, action.reason ?? 'Archived');
          break;

        case 'alert':
          await this.sendAlert(savedJob, action.level ?? 'error');
          await this.archiveJob(savedJob, 'Alert sent to administrators');
          break;

        case 'escalate':
          await this.escalateJob(savedJob);
          break;

        default:
          await this.archiveJob(savedJob, 'No action determined');
      }

      const processingTime = Date.now() - startTime;
      this.logger.log('✅ Dead letter job processed', {
        jobId: job.id,
        savedJobId: savedJob._id,
        action: action.type,
        processingTimeMs: processingTime,
      });
    } catch (error) {
      this.logger.error('❌ Failed to process dead letter job', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });

      // If processing the dead letter fails, we need to handle it gracefully
      try {
        await this.handleProcessingFailure(job, error);
      } catch (secondaryError) {
        this.logger.error(
          '❌ Critical: Failed to handle dead letter processing failure',
          {
            jobId: job.id,
            originalError:
              error instanceof Error ? error.message : String(error),
            secondaryError:
              secondaryError instanceof Error
                ? secondaryError.message
                : String(secondaryError),
          },
        );
      }
    }
  }

  /**
   * Determine the priority of a failed job
   */
  private determinePriority(job: Job): 'low' | 'medium' | 'high' | 'critical' {
    const failedReason = job.failedReason || '';

    // Critical failures
    if (
      failedReason.includes('authentication') ||
      failedReason.includes('authorization') ||
      failedReason.includes('database') ||
      failedReason.includes('connection')
    ) {
      return 'critical';
    }

    // High priority failures
    if (
      failedReason.includes('timeout') ||
      failedReason.includes('rate limit') ||
      failedReason.includes('quota')
    ) {
      return 'high';
    }

    // Medium priority failures
    if (
      failedReason.includes('validation') ||
      failedReason.includes('parsing')
    ) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Extract tags from job data for categorization
   */
  private extractTags(job: Job): string[] {
    const tags: string[] = [];
    const data = job.data || {};

    if (data.userId) tags.push('user-specific');
    if (data.tenantId) tags.push('tenant-specific');
    if (data.priority) tags.push(`priority-${data.priority}`);
    if (data.type) tags.push(data.type);
    if (data.service) tags.push(data.service);

    return tags;
  }

  /**
   * Determine what action to take for a failed job
   */
  private async determineAction(job: any): Promise<{
    type: 'retry' | 'archive' | 'alert' | 'escalate';
    delay?: number;
    reason?: string;
    level?: 'info' | 'warning' | 'error' | 'critical';
  }> {
    // Critical jobs always get alerts
    if (job.priority === 'critical') {
      return { type: 'alert', level: 'critical' };
    }

    // High priority jobs get retries with alerts
    if (job.priority === 'high' && job.retryCount < 2) {
      return {
        type: 'retry',
        delay: this.RETRY_BACKOFF_MS * (job.retryCount + 1),
      };
    }

    // Medium priority jobs get retries
    if (job.priority === 'medium' && job.retryCount < 3) {
      return {
        type: 'retry',
        delay: this.RETRY_BACKOFF_MS * 2 * (job.retryCount + 1),
      };
    }

    // Check if this is a recurring failure pattern
    const similarFailures = await this.deadLetterModel.countDocuments({
      originalQueue: job.originalQueue,
      failedReason: job.failedReason,
      failedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
    });

    if (similarFailures >= 5) {
      return {
        type: 'alert',
        level: 'warning',
        reason: 'Recurring failure pattern detected',
      };
    }

    // Low priority or exhausted retries go to archive
    if (job.retryCount >= this.MAX_RETRY_ATTEMPTS) {
      return { type: 'archive', reason: 'Max retry attempts exceeded' };
    }

    // Default retry for low priority jobs
    return {
      type: 'retry',
      delay: this.RETRY_BACKOFF_MS * 5 * (job.retryCount + 1),
    };
  }

  /**
   * Schedule a retry for a failed job
   */
  private async scheduleRetry(job: any, delay: number): Promise<void> {
    try {
      // Update job status
      await this.deadLetterModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'retrying',
            lastRetryAt: new Date(),
            retryCount: job.retryCount + 1,
          },
        },
      );

      // Schedule retry job
      await this.queue.add(
        'retry-job',
        {
          deadLetterJobId: job._id,
          originalData: job.jobData,
          retryAttempt: job.retryCount + 1,
        },
        {
          delay,
          priority:
            job.priority === 'critical' ? 10 : job.priority === 'high' ? 5 : 1,
          attempts: 1,
        },
      );

      this.logger.log('🔄 Scheduled retry for dead letter job', {
        jobId: job._id,
        delayMs: delay,
        retryAttempt: job.retryCount + 1,
      });
    } catch (error) {
      this.logger.error('Failed to schedule retry', { jobId: job._id, error });
      throw error;
    }
  }

  /**
   * Archive a job that cannot be retried
   */
  private async archiveJob(job: any, reason: string): Promise<void> {
    await this.deadLetterModel.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'archived',
          archivedAt: new Date(),
        },
      },
    );

    this.logger.log('📦 Archived dead letter job', {
      jobId: job._id,
      reason,
    });
  }

  /**
   * Send alert for critical failures
   */
  private async sendAlert(
    job: any,
    level: 'info' | 'warning' | 'error' | 'critical',
  ): Promise<void> {
    try {
      const alertData = {
        level,
        timestamp: new Date(),
        jobId: job._id.toString(),
        originalQueue: job.originalQueue,
        originalJobId: job.originalJobId,
        failedReason: job.failedReason,
        priority: job.priority,
        attemptsMade: job.attemptsMade,
        tags: job.tags,
        metadata: {
          error: job.failedReason,
          queue: job.originalQueue,
          priority: job.priority,
          retryCount: job.retryCount,
        },
      };

      // 1. Log structured alert
      this.logger.warn('🚨 Dead letter alert triggered', alertData);

      // 2. Store alert in database for tracking
      const db = this.connection?.db;
      if (db) {
        const alertCollection = db.collection('alerts');
        await alertCollection.insertOne({
          ...alertData,
          type: 'dead_letter_job',
          status: 'active',
          createdAt: new Date(),
        });
      }

      // 3. Send email alert for critical issues
      if (level === 'critical' || level === 'error') {
        await this.sendEmailAlert(alertData);
      }

      // 4. Send Slack notification for high-priority alerts
      if (
        level === 'critical' ||
        (level === 'error' && job.priority === 'high')
      ) {
        await this.sendSlackAlert(alertData);
      }

      // 5. For critical alerts, also send SMS
      if (level === 'critical') {
        await this.sendSMSAlert(alertData);
      }

      // 6. Create incident in monitoring system (if available)
      if (process.env.MONITORING_SYSTEM_URL) {
        await this.createMonitoringIncident(alertData);
      }
    } catch (alertError) {
      this.logger.error('Failed to send alert', {
        jobId: job._id,
        alertError:
          alertError instanceof Error ? alertError.message : String(alertError),
      });
    }
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(alertData: any): Promise<void> {
    try {
      const emailData = {
        to: process.env.ALERT_EMAIL_RECIPIENTS?.split(',') || [
          'admin@costkatana.com',
        ],
        subject: `🚨 ${alertData.level.toUpperCase()}: Dead Letter Job Alert`,
        html: this.generateEmailTemplate(alertData),
        text: this.generateEmailText(alertData),
      };

      if (this.emailService) {
        await this.emailService.sendEmail(emailData);
        this.logger.log('📧 Email alert sent successfully', {
          to: emailData.to,
          subject: emailData.subject,
          jobId: alertData.jobId,
        });
      } else {
        this.logger.warn(
          'Email service not configured - cannot send dead letter alert',
          {
            jobId: alertData.jobId,
            level: alertData.level,
          },
        );
      }
    } catch (error) {
      this.logger.error('Failed to send email alert', {
        error: error instanceof Error ? error.message : String(error),
        jobId: alertData.jobId,
      });
    }
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(alertData: any): Promise<void> {
    try {
      if (!process.env.SLACK_WEBHOOK_URL) {
        this.logger.debug('Slack webhook not configured, skipping Slack alert');
        return;
      }

      const slackMessage = {
        channel: process.env.SLACK_ALERT_CHANNEL || '#alerts',
        username: 'Cost Katana Monitor',
        icon_emoji: ':warning:',
        attachments: [
          {
            color: alertData.level === 'critical' ? 'danger' : 'warning',
            title: `🚨 Dead Letter Job Alert - ${alertData.level.toUpperCase()}`,
            fields: [
              {
                title: 'Job ID',
                value: alertData.jobId,
                short: true,
              },
              {
                title: 'Queue',
                value: alertData.originalQueue,
                short: true,
              },
              {
                title: 'Priority',
                value: alertData.priority,
                short: true,
              },
              {
                title: 'Failed Reason',
                value: alertData.failedReason,
                short: false,
              },
            ],
            footer: 'Cost Katana Monitoring',
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      await firstValueFrom(
        this.httpService.post(process.env.SLACK_WEBHOOK_URL, slackMessage, {
          timeout: 5000,
        }),
      );

      this.logger.log('💬 Slack alert sent', { jobId: alertData.jobId });
    } catch (error) {
      this.logger.error('Failed to send Slack alert', error);
    }
  }

  /**
   * Send SMS alert for critical issues
   */
  private async sendSMSAlert(alertData: any): Promise<void> {
    try {
      if (
        !process.env.TWILIO_ACCOUNT_SID ||
        !process.env.TWILIO_AUTH_TOKEN ||
        !process.env.TWILIO_PHONE_NUMBER ||
        !process.env.ALERT_PHONE_NUMBERS
      ) {
        this.logger.debug('Twilio not fully configured, skipping SMS alert', {
          hasAccountSid: !!process.env.TWILIO_ACCOUNT_SID,
          hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
          hasPhoneNumber: !!process.env.TWILIO_PHONE_NUMBER,
          hasAlertNumbers: !!process.env.ALERT_PHONE_NUMBERS,
        });
        return;
      }

      if (!twilio) {
        this.logger.debug('Twilio package not installed, skipping SMS alert');
        return;
      }

      const phoneNumbers = process.env.ALERT_PHONE_NUMBERS.split(',').map(
        (num) => num.trim(),
      );
      const message = `🚨 CRITICAL: Dead letter job ${alertData.jobId} in ${alertData.originalQueue} - ${alertData.failedReason}`;

      // Ensure message is within SMS limits (160 characters for single SMS)
      const truncatedMessage =
        message.length > 160 ? message.substring(0, 157) + '...' : message;

      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
      );

      // Send SMS to all configured numbers
      const smsPromises = phoneNumbers.map(async (phoneNumber) => {
        try {
          const result = await twilioClient.messages.create({
            body: truncatedMessage,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phoneNumber,
          });

          this.logger.log('📱 SMS alert sent successfully', {
            to: phoneNumber,
            messageId: result.sid,
            jobId: alertData.jobId,
          });

          return { phoneNumber, success: true, messageId: result.sid };
        } catch (smsError) {
          this.logger.error('Failed to send SMS to individual number', {
            phoneNumber,
            error:
              smsError instanceof Error ? smsError.message : String(smsError),
            jobId: alertData.jobId,
          });
          return { phoneNumber, success: false, error: smsError };
        }
      });

      const results = await Promise.allSettled(smsPromises);
      const successful = results.filter(
        (r) => r.status === 'fulfilled' && r.value.success,
      ).length;
      const failed = results.length - successful;

      this.logger.log('📱 SMS alert batch completed', {
        total: phoneNumbers.length,
        successful,
        failed,
        jobId: alertData.jobId,
      });
    } catch (error) {
      this.logger.error('Failed to send SMS alert', {
        error: error instanceof Error ? error.message : String(error),
        jobId: alertData.jobId,
      });
    }
  }

  /**
   * Create incident in monitoring system
   */
  private async createMonitoringIncident(alertData: any): Promise<void> {
    try {
      const incidentData = {
        title: `Dead Letter Job: ${alertData.originalQueue} - ${alertData.priority} priority`,
        description: `Job ${alertData.jobId} failed ${alertData.attemptsMade} times: ${alertData.failedReason}`,
        severity: alertData.level === 'critical' ? 'critical' : 'major',
        service: 'job-queue',
        tags: ['dead-letter', alertData.priority, alertData.originalQueue],
        metadata: alertData,
      };

      await firstValueFrom(
        this.httpService.post(
          `${process.env.MONITORING_SYSTEM_URL}/incidents`,
          incidentData,
          {
            headers: {
              Authorization: `Bearer ${process.env.MONITORING_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 5000,
          },
        ),
      );

      this.logger.log('📊 Monitoring incident created', {
        jobId: alertData.jobId,
      });
    } catch (error) {
      this.logger.error('Failed to create monitoring incident', error);
    }
  }

  /**
   * Generate HTML email template
   */
  private generateEmailTemplate(alertData: any): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${alertData.level === 'critical' ? '#dc3545' : '#ffc107'}">
          🚨 Dead Letter Job Alert - ${alertData.level.toUpperCase()}
        </h2>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Job ID:</strong> ${alertData.jobId}</p>
          <p><strong>Original Queue:</strong> ${alertData.originalQueue}</p>
          <p><strong>Priority:</strong> ${alertData.priority}</p>
          <p><strong>Attempts Made:</strong> ${alertData.attemptsMade}</p>
          <p><strong>Failed Reason:</strong> ${alertData.failedReason}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        </div>

        <p>This job has been moved to the dead letter queue and requires attention.</p>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px;">
          <p>Cost Katana Job Monitoring System</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate plain text email
   */
  private generateEmailText(alertData: any): string {
    return `
🚨 Dead Letter Job Alert - ${alertData.level.toUpperCase()}

Job ID: ${alertData.jobId}
Original Queue: ${alertData.originalQueue}
Priority: ${alertData.priority}
Attempts Made: ${alertData.attemptsMade}
Failed Reason: ${alertData.failedReason}
Time: ${new Date().toISOString()}

This job has been moved to the dead letter queue and requires attention.

---
Cost Katana Job Monitoring System
    `.trim();
  }

  /**
   * Escalate job to human intervention
   */
  private async escalateJob(job: any): Promise<void> {
    try {
      this.logger.error(
        '🚨 Escalating dead letter job for human intervention',
        {
          jobId: job._id,
          originalQueue: job.originalQueue,
          failedReason: job.failedReason,
          priority: job.priority,
          attemptsMade: job.attemptsMade,
        },
      );

      // 1. Mark job as escalated in database
      await this.deadLetterModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'escalated',
            escalatedAt: new Date(),
            tags: [
              ...(job.tags || []),
              'escalated',
              'needs-review',
              'human-intervention-required',
            ],
          },
        },
      );

      // 2. Create escalation ticket/incident
      const escalationData = {
        ticketId: `ESC-${Date.now()}-${job._id.toString().slice(-6)}`,
        type: 'dead_letter_escalation',
        priority: job.priority,
        severity: job.priority === 'critical' ? 'high' : 'medium',
        title: `Escalated: Dead Letter Job in ${job.originalQueue}`,
        description: `
Job Details:
- Job ID: ${job.originalJobId}
- Dead Letter ID: ${job._id}
- Original Queue: ${job.originalQueue}
- Priority: ${job.priority}
- Attempts Made: ${job.attemptsMade}
- Failed Reason: ${job.failedReason}

Job Data:
${JSON.stringify(job.jobData, null, 2)}

This job has exceeded maximum retry attempts and requires manual intervention.
        `.trim(),
        assignedTo: 'platform-team', // Could be configurable
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        metadata: {
          deadLetterJobId: job._id,
          originalJobId: job.originalJobId,
          originalQueue: job.originalQueue,
          failedReason: job.failedReason,
          attemptsMade: job.attemptsMade,
          retryCount: job.retryCount,
        },
        status: 'open',
        createdAt: new Date(),
      };

      // Store escalation ticket
      const db = this.connection?.db;
      if (db) {
        const escalationCollection = db.collection('escalation_tickets');
        await escalationCollection.insertOne(escalationData);
      }

      // 3. Notify escalation team
      await this.notifyEscalationTeam(escalationData);

      // 4. Create detailed incident report
      await this.createEscalationIncident(job, escalationData);

      this.logger.log('✅ Job escalated successfully', {
        jobId: job._id,
        ticketId: escalationData.ticketId,
        assignedTo: escalationData.assignedTo,
      });
    } catch (error) {
      this.logger.error('Failed to escalate job', {
        jobId: job._id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Notify escalation team about the ticket
   */
  private async notifyEscalationTeam(escalationData: any): Promise<void> {
    try {
      // Send email to escalation team
      const emailData = {
        to: process.env.ESCALATION_TEAM_EMAILS?.split(',') || [
          'escalation@costkatana.com',
        ],
        subject: `🚨 ESCALATION: ${escalationData.title}`,
        html: this.generateEscalationEmailTemplate(escalationData),
        text: this.generateEscalationEmailText(escalationData),
      };

      this.logger.log('📧 Escalation notification sent', {
        ticketId: escalationData.ticketId,
        to: emailData.to,
        subject: emailData.subject,
      });

      if (this.emailService) {
        await this.emailService.sendEmail(emailData);
      }

      // Send Slack notification to escalation channel
      if (process.env.ESCALATION_SLACK_WEBHOOK_URL) {
        const slackMessage = {
          channel: process.env.ESCALATION_SLACK_CHANNEL || '#escalations',
          username: 'Cost Katana Escalation',
          icon_emoji: ':rotating_light:',
          attachments: [
            {
              color: 'danger',
              title: `🚨 Escalation Ticket: ${escalationData.ticketId}`,
              text: escalationData.description.substring(0, 500) + '...',
              fields: [
                {
                  title: 'Priority',
                  value: escalationData.priority,
                  short: true,
                },
                {
                  title: 'Severity',
                  value: escalationData.severity,
                  short: true,
                },
                {
                  title: 'Assigned To',
                  value: escalationData.assignedTo,
                  short: true,
                },
                {
                  title: 'Due Date',
                  value: escalationData.dueDate.toISOString(),
                  short: true,
                },
              ],
              footer: 'Cost Katana Escalation System',
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        };

        await firstValueFrom(
          this.httpService.post(
            process.env.ESCALATION_SLACK_WEBHOOK_URL,
            slackMessage,
            {
              timeout: 5000,
            },
          ),
        );

        this.logger.log('💬 Escalation Slack notification sent', {
          ticketId: escalationData.ticketId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to notify escalation team', error);
    }
  }

  /**
   * Create detailed incident report for escalation
   */
  private async createEscalationIncident(
    job: any,
    escalationData: any,
  ): Promise<void> {
    try {
      const incidentData = {
        incidentId: `INC-${escalationData.ticketId}`,
        title: escalationData.title,
        description: escalationData.description,
        severity: escalationData.severity,
        status: 'investigating',
        service: 'job-queue',
        component: job.originalQueue,
        tags: ['escalation', 'dead-letter', job.priority, job.originalQueue],
        metadata: {
          ...escalationData.metadata,
          escalationTicketId: escalationData.ticketId,
          escalatedAt: new Date(),
          escalationReason: 'Maximum retry attempts exceeded',
        },
        timeline: [
          {
            timestamp: new Date(),
            event: 'incident_created',
            description: 'Incident created due to job escalation',
            actor: 'system',
          },
        ],
        createdAt: new Date(),
      };

      const db = this.connection?.db;
      if (db) {
        const incidentCollection = db.collection('incidents');
        await incidentCollection.insertOne(incidentData);
      }

      this.logger.log('📋 Escalation incident created', {
        incidentId: incidentData.incidentId,
        ticketId: escalationData.ticketId,
      });
    } catch (error) {
      this.logger.error('Failed to create escalation incident', error);
    }
  }

  /**
   * Generate escalation email HTML template
   */
  private generateEscalationEmailTemplate(escalationData: any): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h1 style="color: #dc3545; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">
          🚨 ESCALATION REQUIRED
        </h1>

        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h2>Ticket: ${escalationData.ticketId}</h2>
          <p><strong>Title:</strong> ${escalationData.title}</p>
          <p><strong>Priority:</strong> ${escalationData.priority}</p>
          <p><strong>Severity:</strong> ${escalationData.severity}</p>
          <p><strong>Assigned To:</strong> ${escalationData.assignedTo}</p>
          <p><strong>Due Date:</strong> ${escalationData.dueDate.toISOString()}</p>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3>Description:</h3>
          <pre style="white-space: pre-wrap; font-family: monospace; background: white; padding: 10px; border-radius: 3px;">${escalationData.description}</pre>
        </div>

        <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h4>⚠️ Action Required</h4>
          <p>This job has failed multiple times and requires manual intervention. Please investigate the root cause and take appropriate action.</p>
          <ul>
            <li>Review the job failure reason and logs</li>
            <li>Check system dependencies and configurations</li>
            <li>Determine if this is a systemic issue</li>
            <li>Implement a fix or workaround</li>
            <li>Update the escalation ticket with resolution</li>
          </ul>
        </div>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px;">
          <p><strong>Cost Katana Escalation System</strong></p>
          <p>Ticket created at: ${escalationData.createdAt.toISOString()}</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate escalation email plain text
   */
  private generateEscalationEmailText(escalationData: any): string {
    return `
🚨 ESCALATION REQUIRED

Ticket: ${escalationData.ticketId}
Title: ${escalationData.title}
Priority: ${escalationData.priority}
Severity: ${escalationData.severity}
Assigned To: ${escalationData.assignedTo}
Due Date: ${escalationData.dueDate.toISOString()}

Description:
${escalationData.description}

⚠️ Action Required:
This job has failed multiple times and requires manual intervention. Please investigate the root cause and take appropriate action.

- Review the job failure reason and logs
- Check system dependencies and configurations
- Determine if this is a systemic issue
- Implement a fix or workaround
- Update the escalation ticket with resolution

---
Cost Katana Escalation System
Ticket created at: ${escalationData.createdAt.toISOString()}
    `.trim();
  }

  /**
   * Handle failures in dead letter processing itself
   */
  private async handleProcessingFailure(job: Job, error: any): Promise<void> {
    // Create emergency dead letter entry
    const emergencyEntry = {
      originalQueue: 'dead-letter-processing',
      originalJobId: job.id,
      jobData: job.data,
      failedReason: `Dead letter processing failed: ${error instanceof Error ? error.message : String(error)}`,
      attemptsMade: 1,
      maxAttempts: 1,
      failedAt: new Date(),
      retryCount: 0,
      status: 'archived' as const,
      priority: 'critical' as const,
      tags: ['emergency', 'processing-failure'],
    };

    await this.deadLetterModel.create(emergencyEntry);

    this.logger.error('🚨 Emergency dead letter entry created', {
      originalJobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Clean up old archived jobs
   */
  private async cleanupOldJobs(): Promise<void> {
    try {
      const cutoffDate = new Date(
        Date.now() - this.ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000,
      );

      const result = await this.deadLetterModel.deleteMany({
        status: 'archived',
        archivedAt: { $lt: cutoffDate },
      });

      if (result.deletedCount && result.deletedCount > 0) {
        this.logger.log('🧹 Cleaned up old dead letter jobs', {
          deletedCount: result.deletedCount,
        });
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old dead letter jobs', error);
    }
  }

  /**
   * Get dead letter queue statistics
   */
  async getStats(): Promise<DeadLetterStats> {
    try {
      const [
        totalJobs,
        pendingJobs,
        retryingJobs,
        archivedJobs,
        resolvedJobs,
        criticalJobs,
        avgProcessingTimeResult,
      ] = await Promise.all([
        this.deadLetterModel.countDocuments(),
        this.deadLetterModel.countDocuments({ status: 'pending' }),
        this.deadLetterModel.countDocuments({ status: 'retrying' }),
        this.deadLetterModel.countDocuments({ status: 'archived' }),
        this.deadLetterModel.countDocuments({ status: 'resolved' }),
        this.deadLetterModel.countDocuments({ priority: 'critical' }),
        this.deadLetterModel.aggregate([
          { $match: { archivedAt: { $exists: true } } },
          {
            $group: {
              _id: null,
              avgTime: {
                $avg: {
                  $subtract: ['$archivedAt', '$failedAt'],
                },
              },
            },
          },
        ]),
      ]);

      const avgProcessingTime =
        avgProcessingTimeResult.length > 0
          ? avgProcessingTimeResult[0].avgTime / 1000 // Convert to seconds
          : 0;

      return {
        totalJobs,
        pendingJobs,
        retryingJobs,
        archivedJobs,
        resolvedJobs,
        criticalJobs,
        avgProcessingTime,
      };
    } catch (error) {
      this.logger.error('Failed to get dead letter stats', error);
      throw error;
    }
  }
}
