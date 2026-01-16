#!/usr/bin/env node

/**
 * MCP Server CLI
 * stdio transport for local development and Claude Desktop
 */

import { MCPServer } from '../mcp/server';
import { initializeMCP } from '../mcp/init';
import { loggingService } from '../services/logging.service';

// Suppress non-critical logs for stdio
process.env.LOG_LEVEL = 'error';

async function main() {
  try {
    // Get API key from environment variable or command line
    const apiKey = process.env.COST_KATANA_API_KEY ?? process.argv[2];

    if (!apiKey) {
      console.error('Error: API key required');
      console.error('Usage: cost-katana-mcp <api-key>');
      console.error('Or set COST_KATANA_API_KEY environment variable');
      process.exit(1);
    }

    // Initialize MCP integrations
    initializeMCP();

    // Create and start MCP server with stdio transport
    const server = new MCPServer({
      name: 'cost-katana-mcp',
      version: '1.0.0',
      transport: 'stdio',
    });

    // Start server
    await server.start(apiKey);

    loggingService.info('MCP Server started with stdio transport', {
      apiKey: apiKey.substring(0, 10) + '...',
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      loggingService.info('Shutting down MCP server...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      loggingService.info('Shutting down MCP server...');
      await server.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start MCP server:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
