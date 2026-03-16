/**
 * Discord integration service – production implementation.
 * Send alerts via webhook/bot, list guilds/channels, test.
 */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { formatCurrency } from '../../../utils/helpers';

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
  thumbnail?: { url: string };
  image?: { url: string };
}

export interface DiscordActionRow {
  type: 1;
  components: Array<{
    type: 2;
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

export interface AlertLike {
  _id: unknown;
  title: string;
  message: string;
  type: string;
  severity: string;
  createdAt: Date;
  data: Record<string, unknown>;
  actionRequired?: boolean;
}

@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);
  private static readonly DISCORD_API_BASE = 'https://discord.com/api/v10';

  constructor(private readonly httpService: HttpService) {}

  async sendWebhookMessage(
    webhookUrl: string,
    message: DiscordMessage,
  ): Promise<{ success: boolean; responseTime: number }> {
    const startTime = Date.now();
    try {
      await firstValueFrom(
        this.httpService.post(webhookUrl, message, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }),
      );
      const responseTime = Date.now() - startTime;
      this.logger.log('Discord webhook message sent successfully');
      return { success: true, responseTime };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      this.logger.error('Failed to send Discord webhook message', {
        error: error instanceof Error ? error.message : String(error),
        responseTime,
      });
      throw error;
    }
  }

  async sendBotMessage(
    botToken: string,
    channelId: string,
    message: DiscordMessage,
  ): Promise<{ success: boolean; responseTime: number; messageId?: string }> {
    const startTime = Date.now();
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${DiscordService.DISCORD_API_BASE}/channels/${channelId}/messages`,
          message,
          {
            headers: {
              Authorization: `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        ),
      );
      const responseTime = Date.now() - startTime;
      this.logger.log('Discord bot message sent successfully');
      return { success: true, responseTime, messageId: data?.id };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      this.logger.error('Failed to send Discord bot message', {
        error: error instanceof Error ? error.message : String(error),
        responseTime,
      });
      throw error;
    }
  }

  formatAlertMessage(alert: AlertLike, dashboardUrl?: string): DiscordMessage {
    const severityEmoji = this.getSeverityEmoji(alert.severity);
    const severityColor = this.getSeverityColor(alert.severity);
    const createdAt =
      alert.createdAt instanceof Date
        ? alert.createdAt
        : new Date(alert.createdAt as unknown as string);
    const embed: DiscordEmbed = {
      title: `${severityEmoji} ${alert.title}`,
      description: alert.message,
      color: severityColor,
      fields: [
        {
          name: '📋 Type',
          value: this.formatAlertType(alert.type),
          inline: true,
        },
        {
          name: '⚠️ Severity',
          value: alert.severity.toUpperCase(),
          inline: true,
        },
        {
          name: '🕐 Time',
          value: `<t:${Math.floor(createdAt.getTime() / 1000)}:F>`,
          inline: true,
        },
      ],
      footer: { text: `Cost Katana Alert System | Alert ID: ${alert._id}` },
      timestamp: createdAt.toISOString(),
    };
    if (!embed.fields) embed.fields = [];
    switch (alert.type) {
      case 'cost_threshold':
      case 'cost':
        if (
          alert.data?.currentValue !== undefined &&
          alert.data?.threshold !== undefined
        ) {
          const pct =
            (alert.data.percentage as number) ??
            ((alert.data.currentValue as number) /
              (alert.data.threshold as number)) *
              100;
          embed.fields.push(
            {
              name: '💰 Current Cost',
              value: formatCurrency(alert.data.currentValue as number),
              inline: true,
            },
            {
              name: '🎯 Threshold',
              value: formatCurrency(alert.data.threshold as number),
              inline: true,
            },
            {
              name: '📊 Percentage',
              value: `${Number(pct).toFixed(1)}%`,
              inline: true,
            },
          );
        }
        break;
      case 'optimization_available':
      case 'optimization':
        if (alert.data?.potentialSavings !== undefined) {
          embed.fields.push({
            name: '💰 Potential Savings',
            value: formatCurrency(alert.data.potentialSavings as number),
            inline: false,
          });
        }
        break;
    }
    const message: DiscordMessage = {
      content: alert.actionRequired ? '⚠️ **Action Required**' : undefined,
      embeds: [embed],
    };
    if (dashboardUrl) {
      const buttons: DiscordActionRow['components'] = [
        { type: 2, style: 5, label: '📊 View Dashboard', url: dashboardUrl },
      ];
      if (alert.actionRequired) {
        buttons.push({
          type: 2,
          style: 5,
          label: '⚡ Take Action',
          url: `${dashboardUrl}/alerts/${alert._id}`,
        });
      }
      message.components = [{ type: 1, components: buttons.slice(0, 5) }];
    }
    return message;
  }

  private getSeverityEmoji(severity: string): string {
    const map: Record<string, string> = {
      low: '🔵',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    };
    return map[severity] ?? '⚪';
  }

  private getSeverityColor(severity: string): number {
    const map: Record<string, number> = {
      low: 0x36a64f,
      medium: 0xffb700,
      high: 0xff6b00,
      critical: 0xff0000,
    };
    return map[severity] ?? 0x808080;
  }

  private formatAlertType(type: string): string {
    return type
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  async testIntegration(
    webhookUrl?: string,
    botToken?: string,
    channelId?: string,
  ): Promise<{ success: boolean; message: string; responseTime: number }> {
    const testEmbed: DiscordEmbed = {
      title: '✅ Discord Integration Test',
      description:
        'Your Discord integration is working correctly! Cost Katana is now connected and ready to send alerts.',
      color: 0x36a64f,
      footer: { text: 'Cost Katana Alert System' },
      timestamp: new Date().toISOString(),
    };
    const testMessage: DiscordMessage = { embeds: [testEmbed] };
    try {
      let result: { responseTime: number };
      if (webhookUrl) {
        result = await this.sendWebhookMessage(webhookUrl, testMessage);
      } else if (botToken && channelId) {
        result = await this.sendBotMessage(botToken, channelId, testMessage);
      } else {
        throw new Error(
          'Either webhookUrl or (botToken and channelId) must be provided',
        );
      }
      return {
        success: true,
        message: 'Test message sent successfully',
        responseTime: result.responseTime,
      };
    } catch (error: unknown) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to send test message',
        responseTime: 0,
      };
    }
  }

  async listGuilds(botToken: string): Promise<unknown[]> {
    const { data } = await firstValueFrom(
      this.httpService.get(
        `${DiscordService.DISCORD_API_BASE}/users/@me/guilds`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      ),
    );
    return Array.isArray(data) ? data : [];
  }

  async listGuildChannels(
    botToken: string,
    guildId: string,
  ): Promise<unknown[]> {
    const { data } = await firstValueFrom(
      this.httpService.get(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/channels`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      ),
    );
    return Array.isArray(data) ? data : [];
  }

  async listGuildMembers(
    botToken: string,
    guildId: string,
    options?: { limit?: number },
  ): Promise<Array<{ id: string; username: string; discriminator: string }>> {
    const limit = options?.limit ?? 100;
    const { data } = await firstValueFrom(
      this.httpService.get(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/members`,
        {
          headers: { Authorization: `Bot ${botToken}` },
          params: { limit },
        },
      ),
    );
    const members = Array.isArray(data) ? data : [];
    return members.map((m: { user?: { id: string; username: string; discriminator?: string }; id?: string }) => ({
      id: m.user?.id ?? m.id ?? '',
      username: m.user?.username ?? 'Unknown',
      discriminator: m.user?.discriminator ?? '0',
    }));
  }

  async createChannel(
    botToken: string,
    guildId: string,
    options: { name: string; type?: number; parentId?: string },
  ): Promise<{ id: string; name: string }> {
    const { data } = await firstValueFrom(
      this.httpService.post(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/channels`,
        {
          name: options.name,
          type: options.type ?? 0,
          parent_id: options.parentId,
        },
        {
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    return { id: data.id, name: data.name };
  }

  async deleteChannel(botToken: string, channelId: string): Promise<void> {
    await firstValueFrom(
      this.httpService.delete(
        `${DiscordService.DISCORD_API_BASE}/channels/${channelId}`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      ),
    );
  }

  async kickMember(
    botToken: string,
    guildId: string,
    userId: string,
    reason?: string,
  ): Promise<void> {
    await firstValueFrom(
      this.httpService.delete(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`,
        {
          headers: {
            Authorization: `Bot ${botToken}`,
            ...(reason ? { 'X-Audit-Log-Reason': reason } : {}),
          },
        },
      ),
    );
  }

  async banMember(
    botToken: string,
    guildId: string,
    userId: string,
    options?: { reason?: string; deleteMessageDays?: number },
  ): Promise<void> {
    await firstValueFrom(
      this.httpService.put(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/bans/${userId}`,
        {
          delete_message_days: options?.deleteMessageDays ?? 0,
          reason: options?.reason,
        },
        {
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
            ...(options?.reason
              ? { 'X-Audit-Log-Reason': options.reason }
              : {}),
          },
        },
      ),
    );
  }

  async unbanMember(
    botToken: string,
    guildId: string,
    userId: string,
  ): Promise<void> {
    await firstValueFrom(
      this.httpService.delete(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/bans/${userId}`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      ),
    );
  }

  async listRoles(botToken: string, guildId: string): Promise<Array<{ id: string; name: string; color: number }>> {
    const { data } = await firstValueFrom(
      this.httpService.get(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/roles`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      ),
    );
    const roles = Array.isArray(data) ? data : [];
    return roles.map((r: { id: string; name: string; color: number }) => ({
      id: r.id,
      name: r.name,
      color: r.color,
    }));
  }

  async createRole(
    botToken: string,
    guildId: string,
    options: { name: string; permissions?: string; color?: number },
  ): Promise<{ id: string; name: string }> {
    const { data } = await firstValueFrom(
      this.httpService.post(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/roles`,
        {
          name: options.name,
          permissions: options.permissions,
          color: options.color,
        },
        {
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    return { id: data.id, name: data.name };
  }

  async assignRole(
    botToken: string,
    guildId: string,
    userId: string,
    roleId: string,
  ): Promise<void> {
    await firstValueFrom(
      this.httpService.put(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        {},
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      ),
    );
  }

  async removeRole(
    botToken: string,
    guildId: string,
    userId: string,
    roleId: string,
  ): Promise<void> {
    await firstValueFrom(
      this.httpService.delete(
        `${DiscordService.DISCORD_API_BASE}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      ),
    );
  }
}
