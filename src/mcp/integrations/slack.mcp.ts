/**
 * Slack MCP Server
 * Full operations for Slack integration
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter, CommonParameters } from '../registry/tool-metadata';

const SLACK_API_BASE = 'https://slack.com/api';

export class SlackMCP extends BaseIntegrationMCP {
  constructor() {
    super('slack', '1.0.0');
  }

  registerTools(): void {
    // ===== CHANNEL OPERATIONS =====

    // List channels
    this.registerTool(
      createToolSchema(
        'slack_list_channels',
        'slack',
        'List Slack channels',
        'GET',
        [
          createParameter('types', 'string', 'Channel types', {
            required: false,
            default: 'public_channel,private_channel',
          }),
          CommonParameters.limit,
        ],
        { requiredScopes: ['channels:read'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          types: params.types || 'public_channel,private_channel',
          limit: params.limit || 20,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${SLACK_API_BASE}/conversations.list`,
          { params: queryParams, timeout: 300000 } // 5 minute timeout
        );

        return {
          channels: data.channels || [],
          count: data.channels?.length || 0,
        };
      }
    );

    // Create channel
    this.registerTool(
      createToolSchema(
        'slack_create_channel',
        'slack',
        'Create a new Slack channel',
        'POST',
        [
          createParameter('name', 'string', 'Channel name', { required: true }),
          createParameter('isPrivate', 'boolean', 'Make channel private', { default: false }),
        ],
        { requiredScopes: ['channels:write'] }
      ),
      async (params, context) => {
        const body = {
          name: params.name,
          is_private: params.isPrivate || false,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${SLACK_API_BASE}/conversations.create`,
          { body, timeout: 300000 } // 5 minute timeout
        );

        return data.channel;
      }
    );

    // Archive channel
    this.registerTool(
      createToolSchema(
        'slack_archive_channel',
        'slack',
        'Archive a Slack channel',
        'POST',
        [createParameter('channelId', 'string', 'Channel ID', { required: true })],
        { requiredScopes: ['channels:write'] }
      ),
      async (params, context) => {
        const body = {
          channel: params.channelId,
        };

        await this.makeRequest(
          context.connectionId,
          'POST',
          `${SLACK_API_BASE}/conversations.archive`,
          { body, timeout: 300000 } // 5 minute timeout
        );

        return {
          success: true,
          message: `Channel ${params.channelId} archived successfully`,
        };
      }
    );

    // ===== MESSAGE OPERATIONS =====

    // Send message
    this.registerTool(
      createToolSchema(
        'slack_send_message',
        'slack',
        'Send a message to a Slack channel',
        'POST',
        [
          createParameter('channelId', 'string', 'Channel ID', { required: true }),
          createParameter('text', 'string', 'Message text', { required: true }),
          createParameter('blocks', 'array', 'Block Kit blocks', { required: false }),
        ],
        { requiredScopes: ['chat:write'] }
      ),
      async (params, context) => {
        const body: any = {
          channel: params.channelId,
          text: params.text,
        };

        if (params.blocks) {
          body.blocks = params.blocks;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${SLACK_API_BASE}/chat.postMessage`,
          { body, timeout: 300000 } // 5 minute timeout
        );

        return data;
      }
    );

    // Update message
    this.registerTool(
      createToolSchema(
        'slack_update_message',
        'slack',
        'Update an existing message',
        'PUT',
        [
          createParameter('channelId', 'string', 'Channel ID', { required: true }),
          createParameter('timestamp', 'string', 'Message timestamp', { required: true }),
          createParameter('text', 'string', 'New message text', { required: true }),
        ],
        { requiredScopes: ['chat:write'] }
      ),
      async (params, context) => {
        const body = {
          channel: params.channelId,
          ts: params.timestamp,
          text: params.text,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${SLACK_API_BASE}/chat.update`,
          { body, timeout: 300000 } // 5 minute timeout
        );

        return data;
      }
    );

    // Delete message
    this.registerTool(
      createToolSchema(
        'slack_delete_message',
        'slack',
        'Delete a message',
        'DELETE',
        [
          createParameter('channelId', 'string', 'Channel ID', { required: true }),
          createParameter('timestamp', 'string', 'Message timestamp', { required: true }),
        ],
        {
          requiredScopes: ['chat:write'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        const body = {
          channel: params.channelId,
          ts: params.timestamp,
        };

        await this.makeRequest(
          context.connectionId,
          'POST',
          `${SLACK_API_BASE}/chat.delete`,
          { body, timeout: 300000 } // 5 minute timeout
        );

        return {
          success: true,
          message: 'Message deleted successfully',
        };
      }
    );

    // ===== USER OPERATIONS =====

    // List users
    this.registerTool(
      createToolSchema(
        'slack_list_users',
        'slack',
        'List Slack workspace users',
        'GET',
        [CommonParameters.limit],
        { requiredScopes: ['users:read'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          limit: params.limit || 20,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${SLACK_API_BASE}/users.list`,
          { params: queryParams, timeout: 300000 } // 5 minute timeout
        );

        return {
          users: data.members || [],
          count: data.members?.length || 0,
        };
      }
    );
  }
}

// Initialize and register Slack tools
export function initializeSlackMCP(): void {
  const slackMCP = new SlackMCP();
  slackMCP.registerTools();
}
