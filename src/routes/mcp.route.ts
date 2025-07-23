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

// SSE Endpoint - For server-to-client messages
mcpRoute.get('/', (req: Request, res: Response) => {
    logger.info('MCP SSE connection initiated', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        headers: req.headers
    });

    // Check if client expects SSE (like Claude does)
    const acceptsSSE = req.get('Accept')?.includes('text/event-stream');
    
    if (acceptsSSE) {
        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        
        // Send endpoint event with POST URL (REQUIRED by MCP spec)
        const postEndpoint = `${req.protocol}://${req.get('host')}/api/mcp/message`;
        res.write(`event: endpoint\ndata: ${JSON.stringify({
            uri: postEndpoint
        })}\n\n`);
        
        // Send ready event
        res.write(`event: ready\ndata: ${JSON.stringify({
            status: 'ready',
            protocol: PROTOCOL_VERSION,
            capabilities: SERVER_CAPABILITIES,
            message: 'Server ready for JSON-RPC calls'
        })}\n\n`);
        
        // Keep connection alive with heartbeat for 60 seconds
        let heartbeatCount = 0;
        const maxHeartbeats = 12; // 60 seconds / 5 seconds
        
        const heartbeatInterval = setInterval(() => {
            heartbeatCount++;
            
            if (heartbeatCount >= maxHeartbeats || res.writableEnded) {
                clearInterval(heartbeatInterval);
                if (!res.writableEnded) {
                    res.end();
                }
                return;
            }
            
            try {
                res.write(`event: heartbeat\ndata: {"timestamp":"${new Date().toISOString()}"}\n\n`);
            } catch (error) {
                logger.error('SSE heartbeat error', { error });
                clearInterval(heartbeatInterval);
                res.end();
            }
        }, 5000); // Every 5 seconds
        
        // Handle client disconnect
        req.on('close', () => {
            logger.info('MCP SSE connection closed by client');
            clearInterval(heartbeatInterval);
            res.end();
        });
        
        req.on('error', (error) => {
            logger.error('MCP SSE connection error', { error });
            clearInterval(heartbeatInterval);
            res.end();
        });
        
    } else {
        // Return simple JSON for non-SSE clients
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
    }
});

// HTTP POST Endpoint - For client-to-server JSON-RPC messages (REQUIRED by MCP spec)
mcpRoute.post('/message', async (req: Request, res: Response) => {
    const { method, params, id } = req.body;
    
    logger.info('MCP JSON-RPC Request received', {
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
                res.json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: 'Method not found'
                    }
                });
        }
    } catch (error) {
        logger.error('MCP JSON-RPC request error', { error, method });
        res.json({
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

// Legacy POST endpoint for backwards compatibility
mcpRoute.post('/', async (req: Request, res: Response) => {
    // Forward to the new message endpoint by calling the same handler
    const { method, params, id } = req.body;
    
    logger.info('MCP JSON-RPC Request received (legacy endpoint)', {
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
                res.json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: 'Method not found'
                    }
                });
        }
    } catch (error) {
        logger.error('MCP JSON-RPC request error (legacy endpoint)', { error, method });
        res.json({
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

// Simple status endpoint for MCP health checks
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