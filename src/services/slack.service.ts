import axios from 'axios';
import { IAlert } from '../models/Alert';
import { loggingService } from './logging.service';
import { formatCurrency } from '../utils/helpers';

export interface SlackBlock {
    type: string;
    [key: string]: any;
}

export interface SlackMessage {
    text: string;
    blocks?: SlackBlock[];
    attachments?: any[];
}

export class SlackService {
    private static readonly SLACK_API_BASE = 'https://slack.com/api';
    private static readonly QUICKCHART_API = 'https://quickchart.io/chart';

    /**
     * Send a message to Slack via webhook
     */
    static async sendWebhookMessage(webhookUrl: string, message: SlackMessage): Promise<{ success: boolean; responseTime: number }> {
        const startTime = Date.now();
        
        try {
            await axios.post(webhookUrl, message, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            const responseTime = Date.now() - startTime;
            loggingService.info('Slack webhook message sent successfully', { responseTime });
            
            return { success: true, responseTime };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to send Slack webhook message', { 
                error: error.message,
                responseTime 
            });
            throw error;
        }
    }

    /**
     * Send a message to Slack via OAuth API
     */
    static async sendOAuthMessage(
        accessToken: string, 
        channelId: string, 
        message: SlackMessage
    ): Promise<{ success: boolean; responseTime: number; messageTs?: string }> {
        const startTime = Date.now();
        
        try {
            const response = await axios.post(
                `${this.SLACK_API_BASE}/chat.postMessage`,
                {
                    channel: channelId,
                    text: message.text,
                    blocks: message.blocks,
                    attachments: message.attachments
                },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const responseTime = Date.now() - startTime;

            if (!response.data.ok) {
                throw new Error(`Slack API error: ${response.data.error}`);
            }

            loggingService.info('Slack OAuth message sent successfully', { 
                responseTime,
                messageTs: response.data.ts 
            });
            
            return { 
                success: true, 
                responseTime,
                messageTs: response.data.ts 
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to send Slack OAuth message', { 
                error: error.message,
                responseTime 
            });
            throw error;
        }
    }

    /**
     * Format an alert as a Slack Block Kit message
     */
    static formatAlertMessage(alert: IAlert, dashboardUrl?: string): SlackMessage {
        const severityEmoji = this.getSeverityEmoji(alert.severity);
        const severityColor = this.getSeverityColor(alert.severity);
        
        const text = `${severityEmoji} ${alert.title}`;
        
        const blocks: SlackBlock[] = [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `${severityEmoji} ${alert.title}`,
                    emoji: true
                }
            },
            {
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Type:*\n${this.formatAlertType(alert.type)}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Severity:*\n${alert.severity.toUpperCase()}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Time:*\n<!date^${Math.floor(alert.createdAt.getTime() / 1000)}^{date_short_pretty} at {time}|${alert.createdAt.toISOString()}>`
                    }
                ]
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: alert.message
                }
            }
        ];

        // Add type-specific rich content
        switch (alert.type) {
            case 'cost_threshold':
            case 'cost':
                blocks.push(...this.buildCostAlertBlocks(alert));
                break;
            case 'optimization_available':
            case 'optimization':
                blocks.push(...this.buildOptimizationAlertBlocks(alert));
                break;
            case 'anomaly':
                blocks.push(...this.buildAnomalyAlertBlocks(alert));
                break;
            case 'usage_spike':
                blocks.push(...this.buildUsageSpikeBlocks(alert));
                break;
        }

        // Add action buttons
        if (dashboardUrl) {
            blocks.push({
                type: 'actions',
                elements: this.buildActionButtons(alert, dashboardUrl)
            });
        }

        // Add context footer
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `🤖 Cost Katana Alert System | Alert ID: \`${alert._id}\``
                }
            ]
        });

        return {
            text,
            blocks,
            attachments: [{
                color: severityColor,
                fallback: text
            }]
        };
    }

    /**
     * Build cost alert specific blocks
     */
    private static buildCostAlertBlocks(alert: IAlert): SlackBlock[] {
        const blocks: SlackBlock[] = [];
        
        if (alert.data.currentValue !== undefined && alert.data.threshold !== undefined) {
            const percentage = alert.data.percentage || 
                ((alert.data.currentValue / alert.data.threshold) * 100);
            
            blocks.push({
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Current Cost:*\n${formatCurrency(alert.data.currentValue)}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Threshold:*\n${formatCurrency(alert.data.threshold)}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Percentage:*\n${percentage.toFixed(1)}%`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Period:*\n${alert.data.period || 'N/A'}`
                    }
                ]
            });

            // Add progress bar visualization
            const progressBar = this.createProgressBar(percentage);
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Budget Usage:*\n${progressBar} ${percentage.toFixed(1)}%`
                }
            });
        }

        return blocks;
    }

    /**
     * Build optimization alert specific blocks
     */
    private static buildOptimizationAlertBlocks(alert: IAlert): SlackBlock[] {
        const blocks: SlackBlock[] = [];
        
        if (alert.data.potentialSavings !== undefined) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*💰 Potential Savings:* ${formatCurrency(alert.data.potentialSavings)}`
                }
            });
        }

        if (alert.data.recommendations && Array.isArray(alert.data.recommendations)) {
            const recommendations = alert.data.recommendations
                .slice(0, 5)
                .map((rec, idx) => `${idx + 1}. ${rec}`)
                .join('\n');
            
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*📋 Recommendations:*\n${recommendations}`
                }
            });
        }

        return blocks;
    }

    /**
     * Build anomaly alert specific blocks
     */
    private static buildAnomalyAlertBlocks(alert: IAlert): SlackBlock[] {
        const blocks: SlackBlock[] = [];
        
        if (alert.data.expectedValue !== undefined && alert.data.actualValue !== undefined) {
            const deviation = ((alert.data.actualValue - alert.data.expectedValue) / alert.data.expectedValue) * 100;
            
            blocks.push({
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Expected:*\n${formatCurrency(alert.data.expectedValue)}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Actual:*\n${formatCurrency(alert.data.actualValue)}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Deviation:*\n${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%`
                    }
                ]
            });
        }

        return blocks;
    }

    /**
     * Build usage spike specific blocks
     */
    private static buildUsageSpikeBlocks(alert: IAlert): SlackBlock[] {
        const blocks: SlackBlock[] = [];
        
        if (alert.data.currentUsage !== undefined && alert.data.averageUsage !== undefined) {
            const increasePercentage = ((alert.data.currentUsage - alert.data.averageUsage) / alert.data.averageUsage) * 100;
            
            blocks.push({
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Current Usage:*\n${alert.data.currentUsage.toLocaleString()}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Average Usage:*\n${alert.data.averageUsage.toLocaleString()}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Increase:*\n+${increasePercentage.toFixed(1)}%`
                    }
                ]
            });
        }

        return blocks;
    }

    /**
     * Build action buttons for the alert
     */
    private static buildActionButtons(alert: IAlert, dashboardUrl: string): any[] {
        const buttons: any[] = [
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '📊 View Dashboard',
                    emoji: true
                },
                url: dashboardUrl,
                style: 'primary'
            }
        ];

        if (alert.actionRequired) {
            buttons.push({
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '⚡ Take Action',
                    emoji: true
                },
                url: `${dashboardUrl}/alerts/${alert._id}`,
                style: 'danger'
            });
        }

        if (alert.type === 'optimization_available' || alert.type === 'optimization') {
            buttons.push({
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '🔧 View Optimization',
                    emoji: true
                },
                url: `${dashboardUrl}/optimizations`
            });
        }

        return buttons;
    }

    /**
     * Get emoji for severity level
     */
    private static getSeverityEmoji(severity: string): string {
        const emojiMap: Record<string, string> = {
            low: '🔵',
            medium: '🟡',
            high: '🟠',
            critical: '🔴'
        };
        return emojiMap[severity] || '⚪';
    }

    /**
     * Get color for severity level
     */
    private static getSeverityColor(severity: string): string {
        const colorMap: Record<string, string> = {
            low: '#36a64f',
            medium: '#ffb700',
            high: '#ff6b00',
            critical: '#ff0000'
        };
        return colorMap[severity] || '#808080';
    }

    /**
     * Format alert type for display
     */
    private static formatAlertType(type: string): string {
        return type
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Create a visual progress bar
     */
    private static createProgressBar(percentage: number, length: number = 10): string {
        const filled = Math.round((percentage / 100) * length);
        const empty = length - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    /**
     * Test Slack integration
     */
    static async testIntegration(
        webhookUrl?: string,
        accessToken?: string,
        channelId?: string
    ): Promise<{ success: boolean; message: string; responseTime: number }> {
        const testMessage: SlackMessage = {
            text: '✅ Slack Integration Test',
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '✅ Slack Integration Test',
                        emoji: true
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: 'Your Slack integration is working correctly! Cost Katana is now connected and ready to send alerts.'
                    }
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `🤖 Test sent at <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`
                        }
                    ]
                }
            ]
        };

        try {
            let result;
            if (webhookUrl) {
                result = await this.sendWebhookMessage(webhookUrl, testMessage);
            } else if (accessToken && channelId) {
                result = await this.sendOAuthMessage(accessToken, channelId, testMessage);
            } else {
                throw new Error('Either webhookUrl or (accessToken and channelId) must be provided');
            }

            return {
                success: true,
                message: 'Test message sent successfully',
                responseTime: result.responseTime
            };
        } catch (error: any) {
            return {
                success: false,
                message: error.message || 'Failed to send test message',
                responseTime: 0
            };
        }
    }

    /**
     * Get list of channels (OAuth only)
     */
    static async listChannels(accessToken: string): Promise<any[]> {
        try {
            const response = await axios.get(
                `${this.SLACK_API_BASE}/conversations.list`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                    params: {
                        types: 'public_channel,private_channel',
                        limit: 100
                    }
                }
            );

            if (!response.data.ok) {
                throw new Error(`Slack API error: ${response.data.error}`);
            }

            return response.data.channels || [];
        } catch (error: any) {
            loggingService.error('Failed to list Slack channels', { error: error.message });
            throw error;
        }
    }
}

