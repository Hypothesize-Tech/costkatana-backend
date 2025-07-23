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

// Server capabilities
const SERVER_CAPABILITIES = {
    prompts: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    tools: { listChanged: true },
    logging: {}
};

// SSE Endpoint (GET) - For server-to-client messages
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
        
        // Send ready event (Claude expects this immediately)
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

// JSON-RPC Endpoint (POST) - For client-to-server messages
mcpRoute.post('/', async (req: Request, res: Response) => {
    const { method, params, id } = req.body;
    
    logger.info('MCP JSON-RPC Request received', {
        method,
        params,
        id,
        headers: req.headers,
        body: req.body
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
                logger.warn('Unknown MCP method requested', { method, id });
                res.json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: `Method '${method}' not found`
                    }
                });
        }
    } catch (error) {
        logger.error('MCP JSON-RPC request error', { error, method, id });
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

// Status endpoint for MCP health checks
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