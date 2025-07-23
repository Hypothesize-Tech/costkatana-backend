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

// Server capabilities - MUST be empty objects for basic servers
const SERVER_CAPABILITIES = {
    prompts: {},
    resources: {},
    tools: {},
    logging: {}
};

// SSE Endpoint - For server-to-client messages (OFFICIAL MCP PATTERN)
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
        
        // Send endpoint event FIRST (REQUIRED by MCP SSE spec)
        const postEndpoint = `${req.protocol}://${req.get('host')}/api/mcp`;
        res.write(`event: endpoint\ndata: ${JSON.stringify({
            uri: postEndpoint
        })}\n\n`);
        
        // Send ready event with capabilities (REQUIRED by MCP spec)
        res.write(`event: ready\ndata: ${JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: SERVER_CAPABILITIES,
            serverInfo: {
                name: 'ai-cost-optimizer-mcp',
                version: '1.0.0'
            }
        })}\n\n`);
        
        // Keep connection alive with heartbeat
        const heartbeat = setInterval(() => {
            res.write(`event: heartbeat\ndata: {"timestamp":"${new Date().toISOString()}"}\n\n`);
        }, 30000); // Every 30 seconds
        
        // Track connection
        const connectionId = Date.now().toString();
        MCPConnectionMonitor.trackConnection(connectionId);
        
        // Handle connection close
        req.on('close', () => {
            clearInterval(heartbeat);
            MCPConnectionMonitor.removeConnection(connectionId);
            logger.info('MCP SSE connection closed by client');
        });
        
        req.on('error', (error) => {
            clearInterval(heartbeat);
            MCPConnectionMonitor.removeConnection(connectionId);
            logger.error('MCP SSE connection error', { error });
        });
        
        // Keep connection open for 5 minutes
        setTimeout(() => {
            clearInterval(heartbeat);
            MCPConnectionMonitor.removeConnection(connectionId);
            res.end();
        }, 300000);
        
    } else {
        // Non-SSE request - return JSON status
        res.json({
            status: 'ready',
            protocol: PROTOCOL_VERSION,
            capabilities: SERVER_CAPABILITIES,
            serverInfo: {
                name: 'ai-cost-optimizer-mcp',
                version: '1.0.0'
            }
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
                            version: '1.0.0'
                        }
                    }
                });
                break;

            case 'notifications/initialized':
                // Acknowledge initialization complete
                res.json({
                    jsonrpc: '2.0'
                });
                break;

            case 'tools/list':
                await mcpController.listTools(req, res);
                break;

            case 'tools/call':
                await mcpController.callTool(req, res);
                break;

            case 'resources/list':
                await mcpController.listResources(req, res);
                break;

            case 'resources/read':
                // This method doesn't exist in the controller, return error
                res.status(501).json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: 'resources/read not implemented'
                    }
                });
                break;

            case 'prompts/list':
                await mcpController.listPrompts(req, res);
                break;

            case 'prompts/get':
                // This method doesn't exist in the controller, return error
                res.status(501).json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: 'prompts/get not implemented'
                    }
                });
                break;

            default:
                res.status(400).json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${method}`
                    }
                });
        }
    } catch (error) {
        logger.error('MCP request error', { method, error });
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

// Health check endpoint
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