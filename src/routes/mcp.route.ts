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

// Store active SSE connections
const sseConnections = new Map<string, Response>();

// MCP protocol version
const PROTOCOL_VERSION = '2025-06-18';

// Server capabilities from old controller
const SERVER_CAPABILITIES = {
    prompts: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    tools: { listChanged: true }, // Added from old controller
    logging: {}
};

// Handle POST requests (JSON-RPC)
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

// Handle GET requests (SSE)
mcpRoute.get('/', (req: Request, res: Response) => {
    logger.info('MCP SSE connection initiated', {
        headers: req.headers,
        ip: req.ip
    });
    
    // Disable all server-side timeouts for this connection
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 60000);

    // Generate unique connection ID
    const connectionId = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
        'Access-Control-Allow-Origin': '*'
    });
    
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connection\ndata: ${JSON.stringify({ 
        status: 'connected', 
        connectionId,
        protocol: PROTOCOL_VERSION 
    })}\n\n`);

    // Store connection
    sseConnections.set(connectionId, res);
    MCPConnectionMonitor.trackConnection(connectionId);

    // Set up heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
        try {
            if (!res.writableEnded) {
                res.write('event: heartbeat\n');
                res.write(`data: {"timestamp":"${new Date().toISOString()}"}\n\n`);
            } else {
                clearInterval(heartbeatInterval);
            }
        } catch (error) {
            logger.error('Heartbeat error', { connectionId, error });
            MCPConnectionMonitor.recordError(connectionId);
            clearInterval(heartbeatInterval);
        }
    }, 15000); // 15 seconds

    // Handle client disconnect
    req.on('close', () => {
        logger.info('MCP SSE connection closed', { connectionId });
        clearInterval(heartbeatInterval);
        sseConnections.delete(connectionId);
        MCPConnectionMonitor.removeConnection(connectionId);
        res.end();
    });

    req.on('error', (error) => {
        logger.error('MCP SSE connection error', { connectionId, error });
        MCPConnectionMonitor.recordError(connectionId);
        clearInterval(heartbeatInterval);
        sseConnections.delete(connectionId);
        MCPConnectionMonitor.removeConnection(connectionId);
        res.end();
    });

    // Send initial ready event almost immediately
    setTimeout(() => {
        sendSSEEvent(connectionId, 'ready', {
            message: 'MCP server ready',
            capabilities: SERVER_CAPABILITIES
        });
    }, 100);
});

// Helper function to send events to specific connections
function sendSSEEvent(connectionId: string, event: string, data: any) {
    const connection = sseConnections.get(connectionId);
    if (connection && !connection.destroyed) {
        try {
            connection.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            logger.error('Failed to send SSE event', { connectionId, event, error });
            sseConnections.delete(connectionId);
        }
    }
}

// Broadcast events to all connected clients
export function broadcastMCPEvent(event: string, data: any) {
    sseConnections.forEach((_connection, connectionId) => {
        sendSSEEvent(connectionId, event, data);
    });
}

// Health check endpoint for monitoring
mcpRoute.get('/health', (_req: Request, res: Response) => {
    const connections = MCPConnectionMonitor.getActiveConnections();
    res.json({
        status: 'healthy',
        protocol: PROTOCOL_VERSION,
        connections: {
            total: sseConnections.size,
            active: connections.filter(c => c.active).length,
            details: connections
        },
        uptime: process.uptime()
    });
});

export default mcpRoute; 