/**
 * Budget Alert Calendar Service for NestJS
 * Manages budget alerts and calendar-based notifications for cost monitoring
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BudgetAlert {
  alertId: string;
  userId: string;
  projectId?: string;
  type:
    | 'budget_limit'
    | 'spending_rate'
    | 'forecasted_overrun'
    | 'monthly_reset';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  threshold: {
    amount: number;
    percentage?: number;
    period: 'daily' | 'weekly' | 'monthly' | 'yearly';
    /** Required for percentage-based triggers: total budget in the same unit as currentSpending */
    totalBudget?: number;
  };
  currentSpending: number;
  predictedSpending?: number;
  scheduledDate: Date;
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'none';
  isActive: boolean;
  notifications: {
    email: boolean;
    slack?: boolean;
    webhook?: string;
  };
  metadata: {
    createdAt: Date;
    lastTriggered?: Date;
    triggerCount: number;
    tags: string[];
  };
}

export interface CalendarEvent {
  eventId: string;
  title: string;
  description: string;
  startDate: Date;
  endDate?: Date;
  type: 'alert' | 'reset' | 'review' | 'budget_change';
  relatedAlertId?: string;
  attendees?: string[];
  metadata: Record<string, any>;
}

@Injectable()
export class BudgetAlertCalendarService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BudgetAlertCalendarService.name);

  private alerts: Map<string, BudgetAlert> = new Map();
  private calendarEvents: Map<string, CalendarEvent> = new Map();
  private alertCheckInterval?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.startAlertMonitoring();
  }

  onModuleDestroy(): void {
    this.stopAlertMonitoring();
  }

  /**
   * Create a budget alert
   */
  async createAlert(
    alertData: Omit<BudgetAlert, 'alertId' | 'metadata'> & {
      metadata?: { tags?: string[] };
    },
  ): Promise<string> {
    const alertId = this.generateAlertId();

    const alert: BudgetAlert = {
      ...alertData,
      alertId,
      metadata: {
        createdAt: new Date(),
        triggerCount: 0,
        tags: alertData.metadata?.tags ?? [],
      },
    };

    this.alerts.set(alertId, alert);

    // Schedule calendar event if needed
    if (alert.scheduledDate) {
      this.scheduleCalendarEvent(alert);
    }

    this.logger.log('Budget alert created', {
      alertId,
      userId: alert.userId,
      type: alert.type,
      severity: alert.severity,
    });

    return alertId;
  }

  /**
   * Update an existing alert
   */
  async updateAlert(
    alertId: string,
    updates: Partial<BudgetAlert>,
  ): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    const updatedAlert = { ...alert, ...updates };
    this.alerts.set(alertId, updatedAlert);

    // Update calendar event if schedule changed
    if (updates.scheduledDate) {
      await this.updateCalendarEvent(alertId, updatedAlert);
    }

    this.logger.log('Budget alert updated', { alertId });
  }

  /**
   * Delete an alert
   */
  async deleteAlert(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    this.alerts.delete(alertId);
    this.removeCalendarEvent(alertId);

    this.logger.log('Budget alert deleted', { alertId });
  }

  /**
   * Get alerts for a user
   */
  getUserAlerts(userId: string, activeOnly: boolean = true): BudgetAlert[] {
    return Array.from(this.alerts.values())
      .filter((alert) => alert.userId === userId)
      .filter((alert) => !activeOnly || alert.isActive);
  }

  /**
   * Check if any alerts should be triggered
   */
  async checkAlerts(): Promise<BudgetAlert[]> {
    const triggeredAlerts: BudgetAlert[] = [];

    for (const [, alert] of this.alerts.entries()) {
      if (!alert.isActive) continue;

      const shouldTrigger = this.shouldTriggerAlert(alert);
      if (shouldTrigger) {
        await this.triggerAlert(alert);
        triggeredAlerts.push(alert);
      }
    }

    return triggeredAlerts;
  }

  /**
   * Get upcoming calendar events (from now through the next `days` days)
   */
  getUpcomingEvents(days: number = 7): CalendarEvent[] {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    cutoff.setHours(23, 59, 59, 999);

    return Array.from(this.calendarEvents.values())
      .filter((event) => event.startDate >= now && event.startDate <= cutoff)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  /**
   * Schedule monthly budget resets
   */
  async scheduleMonthlyResets(userId: string): Promise<void> {
    const resetDate = new Date();
    resetDate.setMonth(resetDate.getMonth() + 1, 1); // First day of next month
    resetDate.setHours(9, 0, 0, 0); // 9 AM

    const alertId = await this.createAlert({
      userId,
      type: 'monthly_reset',
      severity: 'info',
      title: 'Monthly Budget Reset',
      message: 'Your monthly budget has been reset. New spending cycle begins.',
      threshold: {
        amount: 0,
        period: 'monthly',
      },
      currentSpending: 0,
      scheduledDate: resetDate,
      recurrence: 'monthly',
      isActive: true,
      notifications: {
        email: true,
      },
    });

    this.logger.log('Monthly budget reset scheduled', {
      userId,
      alertId,
      resetDate,
    });
  }

  /**
   * Get budget calendar for a specific month
   */
  getBudgetCalendar(
    userId: string,
    year: number,
    month: number,
  ): {
    events: CalendarEvent[];
    alerts: BudgetAlert[];
    spendingProjection: Array<{
      date: string;
      projected: number;
      actual?: number;
    }>;
  } {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);

    const events = Array.from(this.calendarEvents.values()).filter(
      (event) => event.startDate >= startDate && event.startDate <= endDate,
    );

    const alerts = this.getUserAlerts(userId).filter(
      (alert) =>
        alert.scheduledDate >= startDate && alert.scheduledDate <= endDate,
    );

    // Spending projection from alerts: attribute each alert's currentSpending to its scheduled day
    const spendingByDay: Record<
      string,
      { projected: number; actual?: number }
    > = {};
    for (let day = 1; day <= endDate.getDate(); day++) {
      const dateKey = new Date(year, month, day).toISOString().split('T')[0];
      spendingByDay[dateKey] = { projected: 0, actual: undefined };
    }

    for (const alert of this.getUserAlerts(userId)) {
      if (
        alert.scheduledDate >= startDate &&
        alert.scheduledDate <= endDate &&
        (alert.currentSpending > 0 || (alert.predictedSpending ?? 0) > 0)
      ) {
        const dateKey = alert.scheduledDate.toISOString().split('T')[0];
        const projected = spendingByDay[dateKey];
        if (projected) {
          projected.projected +=
            alert.predictedSpending ?? alert.currentSpending;
          if (alert.currentSpending > 0) {
            projected.actual = (projected.actual ?? 0) + alert.currentSpending;
          }
        }
      }
    }

    const spendingProjection = Object.entries(spendingByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { projected, actual }]) => ({ date, projected, actual }));

    return {
      events,
      alerts,
      spendingProjection,
    };
  }

  /**
   * Schedule calendar event for alert
   */
  private scheduleCalendarEvent(alert: BudgetAlert): void {
    const event: CalendarEvent = {
      eventId: `event_${alert.alertId}`,
      title: alert.title,
      description: alert.message,
      startDate: alert.scheduledDate,
      type: 'alert',
      relatedAlertId: alert.alertId,
      metadata: {
        severity: alert.severity,
        type: alert.type,
      },
    };

    this.calendarEvents.set(event.eventId, event);
  }

  /**
   * Update calendar event
   */
  private async updateCalendarEvent(
    alertId: string,
    alert: BudgetAlert,
  ): Promise<void> {
    const eventId = `event_${alertId}`;
    const existingEvent = this.calendarEvents.get(eventId);

    if (existingEvent) {
      existingEvent.startDate = alert.scheduledDate;
      existingEvent.title = alert.title;
      existingEvent.description = alert.message;
    } else {
      this.scheduleCalendarEvent(alert);
    }
  }

  /**
   * Remove calendar event
   */
  private removeCalendarEvent(alertId: string): void {
    const eventId = `event_${alertId}`;
    this.calendarEvents.delete(eventId);
  }

  /**
   * Check if alert should be triggered (amount or percentage vs current spending)
   */
  private shouldTriggerAlert(alert: BudgetAlert): boolean {
    if (alert.type === 'monthly_reset') return false;

    const { threshold, currentSpending } = alert;

    if (
      threshold.percentage != null &&
      threshold.totalBudget != null &&
      threshold.totalBudget > 0
    ) {
      const pct = (currentSpending / threshold.totalBudget) * 100;
      return pct >= threshold.percentage;
    }

    if (threshold.amount > 0 && currentSpending >= threshold.amount) {
      return true;
    }

    return false;
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(alert: BudgetAlert): Promise<void> {
    alert.metadata.lastTriggered = new Date();
    alert.metadata.triggerCount++;

    // Send notifications
    if (alert.notifications.email) {
      this.sendEmailNotification(alert);
    }

    if (alert.notifications.slack) {
      await this.sendSlackNotification(alert);
    }

    if (alert.notifications.webhook) {
      await this.sendWebhookNotification(alert);
    }

    this.logger.log('Budget alert triggered', {
      alertId: alert.alertId,
      type: alert.type,
      severity: alert.severity,
    });
  }

  /**
   * Send email notification (integration point: set BUDGET_ALERT_EMAIL_ENABLED and email service)
   */
  private sendEmailNotification(alert: BudgetAlert): void {
    const enabled = this.configService.get<boolean>(
      'BUDGET_ALERT_EMAIL_ENABLED',
      false,
    );
    if (!enabled) {
      this.logger.debug('Email notifications disabled by config');
      return;
    }

    this.logger.log('Email notification sent', {
      alertId: alert.alertId,
      userId: alert.userId,
      severity: alert.severity,
      title: alert.title,
    });
  }

  /**
   * Send Slack notification (integration point: set BUDGET_ALERT_SLACK_ENABLED and Slack webhook)
   */
  private async sendSlackNotification(alert: BudgetAlert): Promise<void> {
    const enabled = this.configService.get<boolean>(
      'BUDGET_ALERT_SLACK_ENABLED',
      false,
    );
    if (!enabled) {
      this.logger.debug('Slack notifications disabled by config');
      return;
    }

    const slackWebhook = this.configService.get<string>(
      'BUDGET_ALERT_SLACK_WEBHOOK_URL',
    );
    if (slackWebhook) {
      try {
        await fetch(slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `[${alert.severity}] ${alert.title}`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*${alert.title}*\n${alert.message}\nSpending: $${alert.currentSpending.toFixed(2)}`,
                },
              },
            ],
          }),
        });
      } catch (error) {
        this.logger.error('Slack webhook failed', {
          alertId: alert.alertId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log('Slack notification sent', {
      alertId: alert.alertId,
      userId: alert.userId,
    });
  }

  /**
   * Send webhook notification (POST JSON to configured webhook URL)
   */
  private async sendWebhookNotification(alert: BudgetAlert): Promise<void> {
    const webhookUrl = alert.notifications.webhook;
    if (!webhookUrl) return;

    const enabled = this.configService.get<boolean>(
      'BUDGET_ALERT_WEBHOOK_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('Webhook notifications disabled by config');
      return;
    }

    try {
      const body = {
        alertId: alert.alertId,
        userId: alert.userId,
        projectId: alert.projectId,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        currentSpending: alert.currentSpending,
        threshold: alert.threshold,
        scheduledDate: alert.scheduledDate.toISOString(),
        timestamp: new Date().toISOString(),
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        this.logger.warn('Webhook returned non-OK status', {
          alertId: alert.alertId,
          status: res.status,
          url: webhookUrl,
        });
      } else {
        this.logger.log('Webhook notification sent', {
          alertId: alert.alertId,
          webhook: webhookUrl,
        });
      }
    } catch (error) {
      this.logger.error('Webhook notification failed', {
        alertId: alert.alertId,
        webhook: webhookUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Start alert monitoring
   */
  private startAlertMonitoring(): void {
    this.alertCheckInterval = setInterval(() => {
      void this.checkAlerts().catch((error) => {
        this.logger.error('Alert check failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 300000); // Check every 5 minutes

    this.logger.log('Budget alert monitoring started');
  }

  /**
   * Stop alert monitoring
   */
  private stopAlertMonitoring(): void {
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
    }
  }

  /**
   * Generate alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get service statistics
   */
  getStatistics(): {
    totalAlerts: number;
    activeAlerts: number;
    triggeredToday: number;
    upcomingEvents: number;
    mostActiveUsers: Array<{ userId: string; alertCount: number }>;
  } {
    const totalAlerts = this.alerts.size;
    const activeAlerts = Array.from(this.alerts.values()).filter(
      (a) => a.isActive,
    ).length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const triggeredToday = Array.from(this.alerts.values()).filter(
      (a) => a.metadata.lastTriggered && a.metadata.lastTriggered >= today,
    ).length;

    const upcomingEvents = this.getUpcomingEvents(1).length;

    // Most active users
    const userCounts = new Map<string, number>();
    for (const alert of this.alerts.values()) {
      userCounts.set(alert.userId, (userCounts.get(alert.userId) || 0) + 1);
    }
    const mostActiveUsers = Array.from(userCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([userId, alertCount]) => ({ userId, alertCount }));

    return {
      totalAlerts,
      activeAlerts,
      triggeredToday,
      upcomingEvents,
      mostActiveUsers,
    };
  }
}
