import axios from 'axios';
import { IAlert } from '../models/Alert';
import { loggingService } from './logging.service';
import { formatCurrency } from '../utils/helpers';

export interface DiscordEmbed {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{
        name: string;
        value: string;
        inline?: boolean;
    }>;
    footer?: {
        text: string;
        icon_url?: string;
    };
    timestamp?: string;
    thumbnail?: {
        url: string;
    };
    image?: {
        url: string;
    };
}

export interface DiscordActionRow {
    type: 1; // Action row
    components: Array<{
        type: 2; // Button
        style: number;
        label: string;
        url?: string;
        custom_id?: string;
    }>;
}

export interface DiscordMessage {
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordActionRow[];
}

export class DiscordService {
    private static readonly DISCORD_API_BASE = 'https://discord.com/api/v10';

    /**
     * Send a message to Discord via webhook
     */
    static async sendWebhookMessage(webhookUrl: string, message: DiscordMessage): Promise<{ success: boolean; responseTime: number }> {
        const startTime = Date.now();
        
        try {
            await axios.post(webhookUrl, message, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            const responseTime = Date.now() - startTime;
            loggingService.info('Discord webhook message sent successfully', { responseTime });
            
            return { success: true, responseTime };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to send Discord webhook message', { 
                error: error.message,
                responseTime 
            });
            throw error;
        }
    }

    /**
     * Send a message to Discord via bot API
     */
    static async sendBotMessage(
        botToken: string,
        channelId: string,
        message: DiscordMessage
    ): Promise<{ success: boolean; responseTime: number; messageId?: string }> {
        const startTime = Date.now();
        
        try {
            const response = await axios.post(
                `${this.DISCORD_API_BASE}/channels/${channelId}/messages`,
                message,
                {
                    headers: {
                        'Authorization': `Bot ${botToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const responseTime = Date.now() - startTime;
            loggingService.info('Discord bot message sent successfully', { 
                responseTime,
                messageId: response.data.id 
            });
            
            return { 
                success: true, 
                responseTime,
                messageId: response.data.id 
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to send Discord bot message', { 
                error: error.message,
                responseTime 
            });
            throw error;
        }
    }

    /**
     * Format an alert as a Discord embed message
     */
    static formatAlertMessage(alert: IAlert, dashboardUrl?: string): DiscordMessage {
        const severityEmoji = this.getSeverityEmoji(alert.severity);
        const severityColor = this.getSeverityColor(alert.severity);
        
        const embed: DiscordEmbed = {
            title: `${severityEmoji} ${alert.title}`,
            description: alert.message,
            color: severityColor,
            fields: [
                {
                    name: '📋 Type',
                    value: this.formatAlertType(alert.type),
                    inline: true
                },
                {
                    name: '⚠️ Severity',
                    value: alert.severity.toUpperCase(),
                    inline: true
                },
                {
                    name: '🕐 Time',
                    value: `<t:${Math.floor(alert.createdAt.getTime() / 1000)}:F>`,
                    inline: true
                }
            ],
            footer: {
                text: `Cost Katana Alert System | Alert ID: ${alert._id}`
            },
            timestamp: alert.createdAt.toISOString()
        };

        // Add type-specific rich content
        if (!embed.fields) {
            embed.fields = [];
        }
        
        switch (alert.type) {
            case 'cost_threshold':
            case 'cost':
                embed.fields.push(...this.buildCostAlertFields(alert));
                break;
            case 'optimization_available':
            case 'optimization':
                embed.fields.push(...this.buildOptimizationAlertFields(alert));
                break;
            case 'anomaly':
                embed.fields.push(...this.buildAnomalyAlertFields(alert));
                break;
            case 'usage_spike':
                embed.fields.push(...this.buildUsageSpikeFields(alert));
                break;
        }

        const message: DiscordMessage = {
            content: alert.actionRequired ? '⚠️ **Action Required**' : undefined,
            embeds: [embed]
        };

        // Add action buttons
        if (dashboardUrl) {
            message.components = [this.buildActionButtons(alert, dashboardUrl)];
        }

        return message;
    }

    /**
     * Build cost alert specific fields
     */
    private static buildCostAlertFields(alert: IAlert): Array<{ name: string; value: string; inline?: boolean }> {
        const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
        
        if (alert.data.currentValue !== undefined && alert.data.threshold !== undefined) {
            const percentage = alert.data.percentage || 
                ((alert.data.currentValue / alert.data.threshold) * 100);
            
            fields.push(
                {
                    name: '💰 Current Cost',
                    value: formatCurrency(alert.data.currentValue),
                    inline: true
                },
                {
                    name: '🎯 Threshold',
                    value: formatCurrency(alert.data.threshold),
                    inline: true
                },
                {
                    name: '📊 Percentage',
                    value: `${percentage.toFixed(1)}%`,
                    inline: true
                }
            );

            if (alert.data.period) {
                fields.push({
                    name: '📅 Period',
                    value: alert.data.period,
                    inline: true
                });
            }

            // Add progress bar visualization
            const progressBar = this.createProgressBar(percentage);
            fields.push({
                name: '📈 Budget Usage',
                value: `${progressBar} ${percentage.toFixed(1)}%`,
                inline: false
            });
        }

        return fields;
    }

    /**
     * Build optimization alert specific fields
     */
    private static buildOptimizationAlertFields(alert: IAlert): Array<{ name: string; value: string; inline?: boolean }> {
        const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
        
        if (alert.data.potentialSavings !== undefined) {
            fields.push({
                name: '💰 Potential Savings',
                value: formatCurrency(alert.data.potentialSavings),
                inline: false
            });
        }

        if (alert.data.recommendations && Array.isArray(alert.data.recommendations)) {
            const recommendations = alert.data.recommendations
                .slice(0, 5)
                .map((rec, idx) => `${idx + 1}. ${rec}`)
                .join('\n');
            
            fields.push({
                name: '📋 Recommendations',
                value: recommendations,
                inline: false
            });
        }

        return fields;
    }

    /**
     * Build anomaly alert specific fields
     */
    private static buildAnomalyAlertFields(alert: IAlert): Array<{ name: string; value: string; inline?: boolean }> {
        const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
        
        if (alert.data.expectedValue !== undefined && alert.data.actualValue !== undefined) {
            const deviation = ((alert.data.actualValue - alert.data.expectedValue) / alert.data.expectedValue) * 100;
            
            fields.push(
                {
                    name: '📊 Expected',
                    value: formatCurrency(alert.data.expectedValue),
                    inline: true
                },
                {
                    name: '📈 Actual',
                    value: formatCurrency(alert.data.actualValue),
                    inline: true
                },
                {
                    name: '⚡ Deviation',
                    value: `${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%`,
                    inline: true
                }
            );
        }

        return fields;
    }

    /**
     * Build usage spike specific fields
     */
    private static buildUsageSpikeFields(alert: IAlert): Array<{ name: string; value: string; inline?: boolean }> {
        const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
        
        if (alert.data.currentUsage !== undefined && alert.data.averageUsage !== undefined) {
            const increasePercentage = ((alert.data.currentUsage - alert.data.averageUsage) / alert.data.averageUsage) * 100;
            
            fields.push(
                {
                    name: '📊 Current Usage',
                    value: alert.data.currentUsage.toLocaleString(),
                    inline: true
                },
                {
                    name: '📉 Average Usage',
                    value: alert.data.averageUsage.toLocaleString(),
                    inline: true
                },
                {
                    name: '📈 Increase',
                    value: `+${increasePercentage.toFixed(1)}%`,
                    inline: true
                }
            );
        }

        return fields;
    }

    /**
     * Build action buttons for the alert
     */
    private static buildActionButtons(alert: IAlert, dashboardUrl: string): DiscordActionRow {
        const buttons: DiscordActionRow['components'] = [
            {
                type: 2,
                style: 5, // Link button
                label: '📊 View Dashboard',
                url: dashboardUrl
            }
        ];

        if (alert.actionRequired) {
            buttons.push({
                type: 2,
                style: 5,
                label: '⚡ Take Action',
                url: `${dashboardUrl}/alerts/${alert._id}`
            });
        }

        if (alert.type === 'optimization_available' || alert.type === 'optimization') {
            buttons.push({
                type: 2,
                style: 5,
                label: '🔧 View Optimization',
                url: `${dashboardUrl}/optimizations`
            });
        }

        return {
            type: 1,
            components: buttons.slice(0, 5) // Discord limit: 5 buttons per row
        };
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
     * Get color for severity level (Discord uses decimal color codes)
     */
    private static getSeverityColor(severity: string): number {
        const colorMap: Record<string, number> = {
            low: 0x36a64f,      // Green
            medium: 0xffb700,   // Yellow
            high: 0xff6b00,     // Orange
            critical: 0xff0000  // Red
        };
        return colorMap[severity] || 0x808080;
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
     * Test Discord integration
     */
    static async testIntegration(
        webhookUrl?: string,
        botToken?: string,
        channelId?: string
    ): Promise<{ success: boolean; message: string; responseTime: number }> {
        const testEmbed: DiscordEmbed = {
            title: '✅ Discord Integration Test',
            description: 'Your Discord integration is working correctly! Cost Katana is now connected and ready to send alerts.',
            color: 0x36a64f,
            footer: {
                text: 'Cost Katana Alert System'
            },
            timestamp: new Date().toISOString()
        };

        const testMessage: DiscordMessage = {
            embeds: [testEmbed]
        };

        try {
            let result;
            if (webhookUrl) {
                result = await this.sendWebhookMessage(webhookUrl, testMessage);
            } else if (botToken && channelId) {
                result = await this.sendBotMessage(botToken, channelId, testMessage);
            } else {
                throw new Error('Either webhookUrl or (botToken and channelId) must be provided');
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
     * Get list of guild channels (Bot only)
     */
    static async listGuildChannels(botToken: string, guildId: string): Promise<any[]> {
        try {
            const response = await axios.get(
                `${this.DISCORD_API_BASE}/guilds/${guildId}/channels`,
                {
                    headers: {
                        'Authorization': `Bot ${botToken}`
                    }
                }
            );

            return response.data || [];
        } catch (error: any) {
            loggingService.error('Failed to list Discord channels', { error: error.message });
            throw error;
        }
    }

    /**
     * Get bot guilds
     */
    static async listGuilds(botToken: string): Promise<any[]> {
        try {
            const response = await axios.get(
                `${this.DISCORD_API_BASE}/users/@me/guilds`,
                {
                    headers: {
                        'Authorization': `Bot ${botToken}`
                    }
                }
            );

            return response.data || [];
        } catch (error: any) {
            loggingService.error('Failed to list Discord guilds', { error: error.message });
            throw error;
        }
    }

    /**
     * List channels in a Discord guild
     */
    static async listChannels(botToken: string, guildId: string): Promise<any[]> {
        try {
            const response = await axios.get(
                `${this.DISCORD_API_BASE}/guilds/${guildId}/channels`,
                {
                    headers: {
                        'Authorization': `Bot ${botToken}`
                    }
                }
            );

            return response.data || [];
        } catch (error: any) {
            loggingService.error('Failed to list Discord channels', { error: error.message, guildId });
            throw error;
        }
    }

    /**
     * Create a new Discord channel
     */
    static async createChannel(
        botToken: string,
        guildId: string,
        name: string,
        type: number = 0 // 0 = text channel, 2 = voice channel
    ): Promise<{ success: boolean; channelId?: string }> {
        try {
            const response = await axios.post(
                `${this.DISCORD_API_BASE}/guilds/${guildId}/channels`,
                {
                    name,
                    type
                },
                {
                    headers: {
                        'Authorization': `Bot ${botToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            loggingService.info('Discord channel created successfully', {
                channelId: response.data.id,
                name,
                guildId
            });

            return {
                success: true,
                channelId: response.data.id
            };
        } catch (error: any) {
            loggingService.error('Failed to create Discord channel', {
                error: error.message,
                name,
                guildId
            });
            throw error;
        }
    }

    /**
     * Send a simple message to Discord channel
     */
    static async sendMessage(botToken: string, channelId: string, message: string): Promise<{ success: boolean; messageId?: string }> {
        return await this.sendBotMessage(botToken, channelId, { content: message });
    }

    /**
     * Send a direct message to a Discord user
     */
    static async sendDirectMessage(botToken: string, userId: string, message: string): Promise<{ success: boolean; messageId?: string }> {
        try {
            // Create a DM channel
            const dmResponse = await axios.post(
                `${this.DISCORD_API_BASE}/users/@me/channels`,
                {
                    recipient_id: userId
                },
                {
                    headers: {
                        'Authorization': `Bot ${botToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const channelId = dmResponse.data.id;

            // Send message to the DM channel
            return await this.sendMessage(botToken, channelId, message);
        } catch (error: any) {
            loggingService.error('Failed to send Discord direct message', {
                error: error.message,
                userId
            });
            throw error;
        }
    }
}

