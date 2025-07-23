import express, { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { 
    validateMCPRequest, 
    mcpResponseTimer, 
    MCPConnectionMonitor,
    mcpRateLimit 
} from '../middleware/mcp.middleware';
import { MCPController } from '../controllers/mcp.controller';

const mcpRoute = express.Router();
const mcpController = new MCPController();

// Apply middleware
mcpRoute.use(validateMCPRequest);
mcpRoute.use(mcpResponseTimer);
mcpRoute.use(mcpRateLimit(100, 60000)); // 100 requests per minute

// MCP protocol version
const PROTOCOL_VERSION = '2025-06-18';

// Server capabilities from old controller
const SERVER_CAPABILITIES = {
    prompts: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    tools: { listChanged: true },
    logging: {}
};

// Handle POST requests (JSON-RPC) - This works perfectly
mcpRoute.post('/', async (req: Request, res: Response) => {
    const { method, params, id } = req.body;
    
    logger.info('MCP Request received', {
        method,
        params,
        id,
        headers: req.headers
    });

    try {
        switch (method) {
            case 'initialize':
                res.json({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: PROTOCOL_VERSION,
                        capabilities: SERVER_CAPABILITIES,
                        serverInfo: {
                            name: 'ai-cost-optimizer-mcp',
                            version: '1.0.0',
                            description: "AI Cost Intelligence & Optimization Platform - Your Complete AI Cost Management Solution"
                        }
                    }
                });
                break;
                
            case 'notifications/initialized':
                res.status(200).end();
                break;

            case 'prompts/list':
                mcpController.listPrompts(req, res);
                break;

            case 'resources/list':
                mcpController.listResources(req, res);
                break;
                
            case 'tools/list':
                mcpController.listTools(req, res);
                break;
                
            case 'tools/call':
                mcpController.callTool(req, res);
                break;

            default:
                res.status(404).json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: 'Method not found'
                    }
                });
        }
    } catch (error) {
        logger.error('MCP request error', { error, method });
        res.status(500).json({
            jsonrpc: '2.0',
            id,
            error: {
                code: -32603,
                message: 'Internal error',
                data: error instanceof Error ? error.message : 'Unknown error'
            }
        });
    }
});

// Handle GET requests - Simple status response (replaces SSE)
mcpRoute.get('/', (req: Request, res: Response) => {
    logger.info('MCP GET request received', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        headers: req.headers
    });

    // Return simple JSON instead of SSE
    res.json({
        status: 'ready',
        protocol: PROTOCOL_VERSION,
        capabilities: SERVER_CAPABILITIES,
        serverInfo: {
            name: 'ai-cost-optimizer-mcp',
            version: '1.0.0',
            description: "AI Cost Intelligence & Optimization Platform"
        },
        message: 'MCP server is ready. Use POST requests for JSON-RPC calls.',
        timestamp: new Date().toISOString()
    });
});

// Simple status endpoint for MCP health checks (replaces problematic SSE)
mcpRoute.get('/status', (req: Request, res: Response) => {
    logger.info('MCP Status check', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    res.json({
        status: 'ready',
        protocol: PROTOCOL_VERSION,
        capabilities: SERVER_CAPABILITIES,
        serverInfo: {
            name: 'ai-cost-optimizer-mcp',
            version: '1.0.0',
            uptime: process.uptime()
        },
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint for monitoring
mcpRoute.get('/health', (_req: Request, res: Response) => {
    const connections = MCPConnectionMonitor.getActiveConnections();
    res.json({
        status: 'healthy',
        protocol: PROTOCOL_VERSION,
        connections: {
            active: connections.filter(c => c.active).length,
            details: connections
        },
        uptime: process.uptime()
    });
});

export default mcpRoute; 