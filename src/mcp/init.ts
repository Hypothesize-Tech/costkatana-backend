/**
 * MCP Initialization
 * Registers all integration tools
 */

import { loggingService } from '../services/logging.service';
import { initializeVercelMCP } from './integrations/vercel.mcp';
import { initializeGitHubMCP } from './integrations/github.mcp';
import { initializeGoogleMCP } from './integrations/google.mcp';
import { initializeSlackMCP } from './integrations/slack.mcp';
import { initializeDiscordMCP } from './integrations/discord.mcp';
import { initializeJiraMCP } from './integrations/jira.mcp';
import { initializeLinearMCP } from './integrations/linear.mcp';
import { initializeMongoDBMCP } from './integrations/mongodb.mcp';
import { initializeAWSMCP } from './integrations/aws.mcp';
import { initializeGenericHTTPTool } from './tools/generic-http.tool';
import { ToolRegistry } from './registry/tool-registry';

let initialized = false;

/**
 * Initialize all MCP integrations and tools
 */
export function initializeMCP(): void {
  if (initialized) {
    loggingService.debug('MCP already initialized');
    return;
  }

  loggingService.info('Initializing MCP integrations...');

  try {
    // Initialize all integration MCP servers
    initializeVercelMCP();
    initializeGitHubMCP();
    initializeGoogleMCP();
    initializeSlackMCP();
    initializeDiscordMCP();
    initializeJiraMCP();
    initializeLinearMCP();
    initializeMongoDBMCP();
    initializeAWSMCP();

    // Initialize generic HTTP tool
    initializeGenericHTTPTool();

    initialized = true;

    const stats = ToolRegistry.getStats();
    loggingService.info('MCP initialization complete', {
      totalTools: stats.totalTools,
      enabledTools: stats.enabledTools,
      integrations: Object.keys(stats.byIntegration).length,
      toolsByIntegration: stats.byIntegration,
    });
  } catch (error) {
    loggingService.error('Failed to initialize MCP', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Check if MCP is initialized
 */
export function isMCPInitialized(): boolean {
  return initialized;
}

/**
 * Reset MCP (for testing)
 */
export function resetMCP(): void {
  ToolRegistry.clear();
  initialized = false;
  loggingService.info('MCP reset');
}
