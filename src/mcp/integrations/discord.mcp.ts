/**
 * Discord MCP Server
 * Full operations for Discord integration
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter, CommonParameters } from '../registry/tool-metadata';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export class DiscordMCP extends BaseIntegrationMCP {
  constructor() {
    super('discord', '1.0.0');
  }

  registerTools(): void {
    // ===== CHANNEL OPERATIONS =====

    // List channels
    this.registerTool(
      createToolSchema(
        'discord_list_channels',
        'discord',
        'List Discord channels in a guild',
        'GET',
        [createParameter('guildId', 'string', 'Guild (server) ID', { required: true })],
        { requiredScopes: ['channels:read'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${DISCORD_API_BASE}/guilds/${params.guildId}/channels`,
          { timeout: 300000 } // 5 minute timeout
        );

        return {
          channels: data,
          count: data.length,
        };
      }
    );

    // Create channel
    this.registerTool(
      createToolSchema(
        'discord_create_channel',
        'discord',
        'Create a new Discord channel',
        'POST',
        [
          createParameter('guildId', 'string', 'Guild (server) ID', { required: true }),
          createParameter('name', 'string', 'Channel name', { required: true }),
          createParameter('type', 'number', 'Channel type (0=text, 2=voice)', {
            required: false,
            default: 0,
          }),
          createParameter('topic', 'string', 'Channel topic', { required: false }),
        ],
        { requiredScopes: ['channels:write'] }
      ),
      async (params, context) => {
        const body: any = {
          name: params.name,
          type: params.type || 0,
        };

        if (params.topic) {
          body.topic = params.topic;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${DISCORD_API_BASE}/guilds/${params.guildId}/channels`,
          { body }
        );

        return data;
      }
    );

    // Delete channel
    this.registerTool(
      createToolSchema(
        'discord_delete_channel',
        'discord',
        'Delete a Discord channel',
        'DELETE',
        [createParameter('channelId', 'string', 'Channel ID', { required: true })],
        {
          requiredScopes: ['channels:write'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${DISCORD_API_BASE}/channels/${params.channelId}`,
          { timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: `Channel ${params.channelId} deleted successfully`,
        };
      }
    );

    // ===== MESSAGE OPERATIONS =====

    // Send message
    this.registerTool(
      createToolSchema(
        'discord_send_message',
        'discord',
        'Send a message to a Discord channel',
        'POST',
        [
          createParameter('channelId', 'string', 'Channel ID', { required: true }),
          createParameter('content', 'string', 'Message content', { required: true }),
          createParameter('embeds', 'array', 'Message embeds', { required: false }),
        ],
        { requiredScopes: ['messages:write'] }
      ),
      async (params, context) => {
        const body: any = {
          content: params.content,
        };

        if (params.embeds) {
          body.embeds = params.embeds;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${DISCORD_API_BASE}/channels/${params.channelId}/messages`,
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Edit message
    this.registerTool(
      createToolSchema(
        'discord_edit_message',
        'discord',
        'Edit an existing message',
        'PATCH',
        [
          createParameter('channelId', 'string', 'Channel ID', { required: true }),
          createParameter('messageId', 'string', 'Message ID', { required: true }),
          createParameter('content', 'string', 'New message content', { required: true }),
        ],
        { requiredScopes: ['messages:write'] }
      ),
      async (params, context) => {
        const body = {
          content: params.content,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${DISCORD_API_BASE}/channels/${params.channelId}/messages/${params.messageId}`,
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Delete message
    this.registerTool(
      createToolSchema(
        'discord_delete_message',
        'discord',
        'Delete a message',
        'DELETE',
        [
          createParameter('channelId', 'string', 'Channel ID', { required: true }),
          createParameter('messageId', 'string', 'Message ID', { required: true }),
        ],
        {
          requiredScopes: ['messages:write'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${DISCORD_API_BASE}/channels/${params.channelId}/messages/${params.messageId}`,
          { timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: 'Message deleted successfully',
        };
      }
    );

    // ===== MEMBER OPERATIONS =====

    // List users (members)
    this.registerTool(
      createToolSchema(
        'discord_list_users',
        'discord',
        'List members in a guild',
        'GET',
        [
          createParameter('guildId', 'string', 'Guild (server) ID', { required: true }),
          CommonParameters.limit,
        ],
        { requiredScopes: ['members:read'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          limit: params.limit || 20,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${DISCORD_API_BASE}/guilds/${params.guildId}/members`,
          { params: queryParams, timeout: 300000 } // 5 minutes
        );

        return {
          members: data,
          count: data.length,
        };
      }
    );

    // Kick user
    this.registerTool(
      createToolSchema(
        'discord_kick_user',
        'discord',
        'Kick a member from a guild',
        'DELETE',
        [
          createParameter('guildId', 'string', 'Guild (server) ID', { required: true }),
          createParameter('userId', 'string', 'User ID', { required: true }),
          createParameter('reason', 'string', 'Kick reason', { required: false }),
        ],
        {
          requiredScopes: ['members:manage'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        const headers: any = {};
        if (params.reason) {
          headers['X-Audit-Log-Reason'] = params.reason;
        }

        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${DISCORD_API_BASE}/guilds/${params.guildId}/members/${params.userId}`,
          { headers, timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: `User ${params.userId} kicked from guild`,
        };
      }
    );

    // Ban user
    this.registerTool(
      createToolSchema(
        'discord_ban_user',
        'discord',
        'Ban a member from a guild',
        'POST',
        [
          createParameter('guildId', 'string', 'Guild (server) ID', { required: true }),
          createParameter('userId', 'string', 'User ID', { required: true }),
          createParameter('reason', 'string', 'Ban reason', { required: false }),
          createParameter('deleteMessageDays', 'number', 'Days of messages to delete', {
            required: false,
            default: 0,
          }),
        ],
        {
          requiredScopes: ['members:manage'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        const body: any = {
          delete_message_days: params.deleteMessageDays || 0,
        };

        const headers: any = {};
        if (params.reason) {
          headers['X-Audit-Log-Reason'] = params.reason;
        }

        await this.makeRequest(
          context.connectionId,
          'PUT',
          `${DISCORD_API_BASE}/guilds/${params.guildId}/bans/${params.userId}`,
          { body, headers, timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: `User ${params.userId} banned from guild`,
        };
      }
    );
  }
}

// Initialize and register Discord tools
export function initializeDiscordMCP(): void {
  const discordMCP = new DiscordMCP();
  discordMCP.registerTools();
}
