#!/usr/bin/env node

/**
 * MongoDB MCP Server - stdio Transport
 * 
 * Entry point for local development with Cursor, Claude Desktop, etc.
 * Communicates via stdin/stdout using JSON-RPC 2.0
 * 
 * Usage:
 *   node dist/services/mongodbMcpStdio.service.js
 * 
 * Environment Variables:
 *   - MONGODB_USER_ID: User ID (required)
 *   - MONGODB_CONNECTION_ID: MongoDB connection ID (required)
 *   - MONGODB_URI: CostKatana database URI (required)
 */

import { MongoDBMCPService } from './mongodbMcp.service';
import { connectDatabase } from '../config/database';
import { loggingService } from './logging.service';

async function main() {
    try {
        // Get configuration from environment
        const userId = process.env.MONGODB_USER_ID;
        const connectionId = process.env.MONGODB_CONNECTION_ID;
        const mongodbUri = process.env.MONGODB_URI;

        if (!userId) {
            console.error('Error: MONGODB_USER_ID environment variable is required');
            process.exit(1);
        }

        if (!connectionId) {
            console.error('Error: MONGODB_CONNECTION_ID environment variable is required');
            process.exit(1);
        }

        if (!mongodbUri) {
            console.error('Error: MONGODB_URI environment variable is required');
            process.exit(1);
        }

        loggingService.info('Starting MongoDB MCP server (stdio)', {
            component: 'mongodbMcpStdio',
            operation: 'main',
            userId,
            connectionId,
        });

        // Connect to CostKatana database (to fetch connection metadata)
        await connectDatabase();

        // Create MCP service
        const mcpService = new MongoDBMCPService({
            userId,
            connectionId,
            transport: 'stdio',
        });

        // Run stdio server
        await mcpService.runStdio();

        loggingService.info('MongoDB MCP server started successfully (stdio)', {
            component: 'mongodbMcpStdio',
            operation: 'main',
        });

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            loggingService.info('Shutting down MongoDB MCP server', {
                component: 'mongodbMcpStdio',
                operation: 'shutdown',
            });
            await mcpService.close();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            loggingService.info('Shutting down MongoDB MCP server', {
                component: 'mongodbMcpStdio',
                operation: 'shutdown',
            });
            await mcpService.close();
            process.exit(0);
        });
    } catch (error) {
        loggingService.error('Failed to start MongoDB MCP server', {
            component: 'mongodbMcpStdio',
            operation: 'main',
            error: error instanceof Error ? error.message : String(error),
        });
        console.error('Fatal error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main();
