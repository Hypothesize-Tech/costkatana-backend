import { IAlert, Alert } from '../models/Alert';
import { Integration, IIntegration } from '../models/Integration';
import { User } from '../models/User';
import { SlackService } from './slack.service';
import { DiscordService } from './discord.service';
import { IntegrationService } from './integration.service';
import { loggingService } from './logging.service';
import { EmailService } from './email.service';
import mongoose from 'mongoose';

export interface NotificationContext {
    alert: IAlert;
    userId: string;
    dashboardUrl?: string;
}

export class NotificationService {
    private static readonly DEFAULT_DASHBOARD_URL = process.env.FRONTEND_URL || 'https://app.costkatana.com';

    /**
     * Send alert to all configured channels
     */
    static async sendAlert(alert: IAlert): Promise<void> {
        try {
            const userId = alert.userId.toString();
            const dashboardUrl = this.DEFAULT_DASHBOARD_URL;

            // Get user preferences
            const user = await User.findById(userId).lean();
            if (!user) {
                loggingService.error('User not found for alert', { userId, alertId: alert._id });
                return;
            }

            // Determine which integrations should receive this alert
            const targetIntegrations = await this.getTargetIntegrations(alert, user);

            if (targetIntegrations.length === 0) {
                loggingService.info('No integrations configured for alert', { 
                    alertId: alert._id,
                    userId 
                });
                
                // Fallback to email if configured
                if (user.preferences?.integrations?.fallbackToEmail !== false && user.preferences?.emailAlerts) {
                    await this.sendEmailNotification(alert, user);
                }
                return;
            }

            // Initialize delivery tracking
            alert.deliveryChannels = targetIntegrations.map(i => (i._id as any).toString());
            alert.deliveryStatus = new Map();

            for (const integration of targetIntegrations) {
                alert.deliveryStatus.set((integration._id as any).toString(), {
                    status: 'pending',
                    attempts: 0
                });
            }

            if (typeof (alert as any).save === 'function') {
                await (alert as any).save();
            }

            // Send to all integrations in parallel
            const deliveryPromises = targetIntegrations.map(integration =>
                this.deliverToIntegration(alert, integration, dashboardUrl)
            );

            await Promise.allSettled(deliveryPromises);

            loggingService.info('Alert sent to integrations', {
                alertId: alert._id,
                userId,
                integrationCount: targetIntegrations.length
            });
        } catch (error: any) {
            loggingService.error('Failed to send alert', {
                error: error.message,
                alertId: alert._id
            });
        }
    }

    /**
     * Determine which integrations should receive this alert
     */
    private static async getTargetIntegrations(alert: IAlert, user: any): Promise<IIntegration[]> {
        const userId = alert.userId.toString();
        
        // Get all active integrations for the user
        const allIntegrations = await Integration.find({
            userId: new mongoose.Types.ObjectId(userId),
            status: 'active'
        });

        if (allIntegrations.length === 0) {
            return [];
        }

        // Filter integrations based on alert routing rules
        const targetIntegrations: IIntegration[] = [];

        for (const integration of allIntegrations) {
                // Check if this integration has routing rules for this alert type
                const routingRule = integration.alertRouting?.get(alert.type as any);

                if (routingRule) {
                // If rule exists, check if it's enabled and matches severity
                if (routingRule.enabled) {
                    if (routingRule.severities.length === 0 || routingRule.severities.includes(alert.severity)) {
                        targetIntegrations.push(integration);
                    }
                }
                } else {
                    // No specific rule for this alert type
                    // Check user's default preferences
                    const defaultChannels = user.preferences?.integrations?.defaultChannels || [];
                    const alertTypeRouting = user.preferences?.integrations?.alertTypeRouting?.get(alert.type) || [];

                    const integrationId = (integration._id as any).toString();
                    if (alertTypeRouting.includes(integrationId) ||
                        defaultChannels.includes(integrationId)) {
                        targetIntegrations.push(integration);
                    }
                }
        }

        return targetIntegrations;
    }

    /**
     * Deliver alert to a specific integration
     */
    private static async deliverToIntegration(
        alert: IAlert,
        integration: IIntegration,
        dashboardUrl: string
    ): Promise<void> {
        const integrationId = (integration._id as any).toString();
        const maxRetries = integration.deliveryConfig.retryEnabled ? integration.deliveryConfig.maxRetries : 0;
        let attempts = 0;
        let lastError: string | undefined;

        while (attempts <= maxRetries) {
            try {
                attempts++;

                // Update delivery status
                const currentStatus = alert.deliveryStatus?.get(integrationId);
                if (currentStatus) {
                    currentStatus.status = attempts > 1 ? 'retrying' : 'pending';
                    currentStatus.attempts = attempts;
                    if (typeof (alert as any).save === 'function') {
                        await (alert as any).save();
                    }
                }

                // Send the alert based on integration type
                const result = await this.sendToIntegration(alert, integration, dashboardUrl);

                // Update delivery status on success
                if (currentStatus) {
                    currentStatus.status = 'sent';
                    currentStatus.sentAt = new Date();
                    currentStatus.responseTime = result.responseTime;
                    if (typeof (alert as any).save === 'function') {
                        await (alert as any).save();
                    }
                }

                // Update integration stats
                await IntegrationService.updateDeliveryStats(integrationId, true, result.responseTime);

                loggingService.info('Alert delivered to integration', {
                    alertId: alert._id,
                    integrationId,
                    attempts,
                    responseTime: result.responseTime
                });

                return; // Success, exit retry loop
            } catch (error: any) {
                lastError = error.message;
                loggingService.error('Failed to deliver alert to integration', {
                    error: error.message,
                    alertId: alert._id,
                    integrationId,
                    attempt: attempts,
                    maxRetries
                });

                // If this was the last attempt, update status to failed
                if (attempts > maxRetries) {
                    const currentStatus = alert.deliveryStatus?.get(integrationId);
                    if (currentStatus) {
                        currentStatus.status = 'failed';
                        currentStatus.lastError = lastError;
                        if (typeof (alert as any).save === 'function') {
                            await (alert as any).save();
                        }
                    }

                    // Update integration stats
                    await IntegrationService.updateDeliveryStats(integrationId, false, 0);
                } else {
                    // Wait before retrying (exponential backoff)
                    const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
    }

    /**
     * Send alert to a specific integration based on its type
     */
    private static async sendToIntegration(
        alert: IAlert,
        integration: IIntegration,
        dashboardUrl: string
    ): Promise<{ responseTime: number }> {
        const credentials = integration.getCredentials();

        switch (integration.type) {
            case 'slack_webhook':
                if (!credentials.webhookUrl) {
                    throw new Error('Slack webhook URL not configured');
                }
                const slackMessage = SlackService.formatAlertMessage(alert, dashboardUrl);
                return await SlackService.sendWebhookMessage(credentials.webhookUrl, slackMessage);

            case 'slack_oauth':
                if (!credentials.accessToken || !credentials.channelId) {
                    throw new Error('Slack OAuth credentials not configured');
                }
                const slackOAuthMessage = SlackService.formatAlertMessage(alert, dashboardUrl);
                return await SlackService.sendOAuthMessage(
                    credentials.accessToken,
                    credentials.channelId,
                    slackOAuthMessage
                );

            case 'discord_webhook':
                if (!credentials.webhookUrl) {
                    throw new Error('Discord webhook URL not configured');
                }
                const discordMessage = DiscordService.formatAlertMessage(alert, dashboardUrl);
                return await DiscordService.sendWebhookMessage(credentials.webhookUrl, discordMessage);

            case 'discord_oauth':
                if (!credentials.botToken || !credentials.channelId) {
                    throw new Error('Discord bot credentials not configured');
                }
                const discordBotMessage = DiscordService.formatAlertMessage(alert, dashboardUrl);
                return await DiscordService.sendBotMessage(
                    credentials.botToken,
                    credentials.channelId,
                    discordBotMessage
                );

            case 'custom_webhook':
                if (!credentials.webhookUrl) {
                    throw new Error('Custom webhook URL not configured');
                }
                // For custom webhooks, send as JSON payload
                const startTime = Date.now();
                const axios = require('axios');
                await axios.post(credentials.webhookUrl, {
                    alert: {
                        id: alert._id,
                        type: alert.type,
                        title: alert.title,
                        message: alert.message,
                        severity: alert.severity,
                        data: alert.data,
                        createdAt: alert.createdAt
                    }
                }, {
                    timeout: integration.deliveryConfig.timeout,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'CostKatana-Alert-System/1.0'
                    }
                });
                const responseTime = Date.now() - startTime;
                return { responseTime };

            default:
                throw new Error(`Unsupported integration type: ${integration.type}`);
        }
    }

    /**
     * Send email notification as fallback
     */
    private static async sendEmailNotification(alert: IAlert, user: any): Promise<void> {
        try {
            await EmailService.sendAlertNotification(user, alert);
            loggingService.info('Fallback email notification sent', {
                alertId: alert._id,
                userId: user._id
            });
        } catch (error: any) {
            loggingService.error('Failed to send fallback email notification', {
                error: error.message,
                alertId: alert._id,
                userId: user._id
            });
        }
    }

    /**
     * Retry failed deliveries for an alert
     */
    static async retryFailedDeliveries(alertId: string): Promise<void> {
        try {
            const alert = await Alert.findById(alertId);
            if (!alert) {
                throw new Error('Alert not found');
            }

            const failedIntegrationIds: string[] = [];
            alert.deliveryStatus?.forEach((status, integrationId) => {
                if (status.status === 'failed') {
                    failedIntegrationIds.push(integrationId);
                }
            });

            if (failedIntegrationIds.length === 0) {
                loggingService.info('No failed deliveries to retry', { alertId });
                return;
            }

            // Get failed integrations
            const integrations = await Integration.find({
                _id: { $in: failedIntegrationIds.map(id => new mongoose.Types.ObjectId(id)) },
                status: 'active'
            });

            const dashboardUrl = this.DEFAULT_DASHBOARD_URL;

            // Retry deliveries in parallel
            const retryPromises = integrations.map(integration =>
                this.deliverToIntegration(alert, integration, dashboardUrl)
            );

            await Promise.allSettled(retryPromises);

            loggingService.info('Retried failed deliveries', {
                alertId,
                retriedCount: integrations.length
            });
        } catch (error: any) {
            loggingService.error('Failed to retry deliveries', {
                error: error.message,
                alertId
            });
        }
    }

    /**
     * Get delivery logs for an integration
     */
    static async getDeliveryLogs(
        userId: string,
        integrationId?: string,
        filters?: {
            status?: string;
            alertType?: string;
            startDate?: Date;
            endDate?: Date;
            limit?: number;
        }
    ): Promise<any[]> {
        try {
            const query: any = { userId: new mongoose.Types.ObjectId(userId) };

            if (integrationId) {
                query.deliveryChannels = integrationId;
            }

            if (filters?.alertType) {
                query.type = filters.alertType;
            }

            if (filters?.startDate || filters?.endDate) {
                query.createdAt = {};
                if (filters.startDate) query.createdAt.$gte = filters.startDate;
                if (filters.endDate) query.createdAt.$lte = filters.endDate;
            }

            const alerts = await Alert.find(query)
                .sort({ createdAt: -1 })
                .limit(filters?.limit || 100)
                .lean();

            // Format delivery logs
            const logs = alerts.flatMap(alert => {
                if (!alert.deliveryStatus) return [];

                const deliveryLogs: any[] = [];
                const deliveryStatusMap = alert.deliveryStatus as any;
                deliveryStatusMap.forEach((status: any, intId: string) => {
                    if (!integrationId || intId === integrationId) {
                        if (!filters?.status || status.status === filters.status) {
                            deliveryLogs.push({
                                alertId: alert._id,
                                alertType: alert.type,
                                alertTitle: alert.title,
                                alertSeverity: alert.severity,
                                integrationId: intId,
                                status: status.status,
                                sentAt: status.sentAt,
                                responseTime: status.responseTime,
                                attempts: status.attempts,
                                lastError: status.lastError,
                                createdAt: alert.createdAt
                            });
                        }
                    }
                });

                return deliveryLogs;
            });

            return logs;
        } catch (error: any) {
            loggingService.error('Failed to get delivery logs', {
                error: error.message,
                userId,
                integrationId
            });
            throw error;
        }
    }
}

