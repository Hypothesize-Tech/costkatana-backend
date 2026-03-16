/**
 * MCP Initialization Service
 * Registers all MCP integration tools on module initialization
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { ToolRegistryService } from './tool-registry.service';
import { VercelMcpService } from './integrations/vercel-mcp.service';
import { GitHubMcpService } from './integrations/github-mcp.service';
import { MongoDbMcpService } from './integrations/mongodb-mcp.service';
import { SlackMcpService } from './integrations/slack-mcp.service';
import { DiscordMcpService } from './integrations/discord-mcp.service';
import { JiraMcpService } from './integrations/jira-mcp.service';
import { LinearMcpService } from './integrations/linear-mcp.service';
import { GoogleMcpService } from './integrations/google-mcp.service';
import { AwsMcpService } from './integrations/aws-mcp.service';

@Injectable()
export class McpInitializationService implements OnModuleInit {
  constructor(
    private logger: LoggerService,
    private toolRegistry: ToolRegistryService,
    private vercelMcpService: VercelMcpService,
    private githubMcpService: GitHubMcpService,
    private mongodbMcpService: MongoDbMcpService,
    private slackMcpService: SlackMcpService,
    private discordMcpService: DiscordMcpService,
    private jiraMcpService: JiraMcpService,
    private linearMcpService: LinearMcpService,
    private googleMcpService: GoogleMcpService,
    private awsMcpService: AwsMcpService,
  ) {}

  async onModuleInit() {
    await this.initializeMCP();
  }

  /**
   * Initialize all MCP integrations and tools.
   * Ensures all integration services are initialized
   * and logs the summary and any registration issues.
   */
  private async initializeMCP(): Promise<void> {
    this.logger.log('Initializing MCP integrations...');

    try {
      // Explicitly call onModuleInit for each integration service.
      // This ensures all services have a chance to perform their initialization
      // (in case NestJS lifecycle hooks are not always guaranteed here).
      // Consider batching these if performance becomes important.

      await Promise.all([
        this.vercelMcpService.onModuleInit?.(),
        this.githubMcpService.onModuleInit?.(),
        this.mongodbMcpService.onModuleInit?.(),
        this.slackMcpService.onModuleInit?.(),
        this.discordMcpService.onModuleInit?.(),
        this.jiraMcpService.onModuleInit?.(),
        this.linearMcpService.onModuleInit?.(),
        this.googleMcpService.onModuleInit?.(),
        this.awsMcpService.onModuleInit?.(),
      ]);

      // Retrieve tool registry stats
      const stats = this.toolRegistry.getStats();

      this.logger.log('MCP initialization complete', {
        totalTools: stats.totalTools,
        enabledTools: stats.enabledTools,
        integrations: Object.keys(stats.byIntegration).length,
        toolsByIntegration: stats.byIntegration,
      });

      // Log available tools for debugging and visibility
      const enabledTools = this.toolRegistry.getEnabledTools();
      if (enabledTools.length === 0) {
        this.logger.warn('No MCP tools are enabled or registered.');
      } else {
        this.logger.debug('Available MCP tools', {
          tools: enabledTools.map((tool) => ({
            name: tool.schema.name,
            integration: tool.schema.integration,
            httpMethod: tool.schema.httpMethod,
          })),
        });
      }
    } catch (error) {
      this.logger.error('Failed to initialize MCP', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error && error.stack ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Get initialization status
   */
  getInitializationStatus() {
    const stats = this.toolRegistry.getStats();
    return {
      initialized: true,
      stats,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reset MCP initialization (for testing)
   */
  reset(): void {
    this.toolRegistry.clear();
    this.logger.log('MCP initialization reset');
  }
}
