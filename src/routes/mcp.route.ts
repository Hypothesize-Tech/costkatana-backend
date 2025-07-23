import express, { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { 
    validateMCPRequest, 
    mcpResponseTimer,
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

// Server capabilities - Basic HTTP-only MCP server
const SERVER_CAPABILITIES = {
    prompts: {},
    resources: {},
    tools: {},
    logging: {}
};

// Server info
const SERVER_INFO = {
    name: 'ai-cost-optimizer-mcp',
    version: '1.0.0',
    description: 'AI Cost Optimization MCP Server'
};

// Main MCP endpoint - HTTP-only transport
mcpRoute.all('/', async (req: Request, res: Response) => {
    const method = req.method;
    const { method: rpcMethod, params, id } = req.body || {};
    
    logger.info('MCP Request received', {
        httpMethod: method,
        rpcMethod,
        params,
        id,
        headers: req.headers,
        userAgent: req.get('User-Agent')
    });

    // Handle GET requests (capability discovery)
    if (method === 'GET') {
        res.json({
            jsonrpc: '2.0',
            result: {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: SERVER_CAPABILITIES,
                serverInfo: SERVER_INFO,
                transport: 'http',
                endpoints: {
                    rpc: `${req.protocol}://${req.get('host')}/api/mcp`
                }
            }
        });
        return;
    }

    // Handle OPTIONS requests (CORS preflight)
    if (method === 'OPTIONS') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, User-Agent');
        res.status(200).end();
        return;
    }

    // Handle POST requests (JSON-RPC calls)
    if (method === 'POST') {
        try {
            // Validate JSON-RPC format
            if (!rpcMethod || !req.body.jsonrpc) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: id || null,
                    error: {
                        code: -32600,
                        message: 'Invalid Request - Missing method or jsonrpc field'
                    }
                });
                return;
            }

            switch (rpcMethod) {
                case 'initialize':
                    logger.info('MCP Initialize request', { params });
                    res.json({
                        jsonrpc: '2.0',
                        id,
                        result: {
                            protocolVersion: PROTOCOL_VERSION,
                            capabilities: SERVER_CAPABILITIES,
                            serverInfo: SERVER_INFO
                        }
                    });
                    break;

                case 'notifications/initialized':
                    logger.info('MCP Initialized notification received');
                    res.status(200).json({
                        jsonrpc: '2.0'
                    });
                    break;

                case 'tools/list':
                    logger.info('MCP Tools list requested');
                    await mcpController.listTools(req, res);
                    break;

                case 'tools/call':
                    logger.info('MCP Tool call requested', { toolName: params?.name });
                    await mcpController.callTool(req, res);
                    break;

                case 'resources/list':
                    logger.info('MCP Resources list requested');
                    await mcpController.listResources(req, res);
                    break;

                case 'resources/read':
                    logger.info('MCP Resource read requested', { uri: params?.uri });
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
                    logger.info('MCP Prompts list requested');
                    await mcpController.listPrompts(req, res);
                    break;

                case 'prompts/get':
                    logger.info('MCP Prompt get requested', { name: params?.name });
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
                    logger.warn('Unknown MCP method requested', { method: rpcMethod });
                    res.status(400).json({
                        jsonrpc: '2.0',
                        id,
                        error: {
                            code: -32601,
                            message: `Method not found: ${rpcMethod}`
                        }
                    });
            }
        } catch (error) {
            logger.error('MCP request processing error', { 
                method: rpcMethod, 
                error: error instanceof Error ? error.message : error 
            });
            res.status(500).json({
                jsonrpc: '2.0',
                id: id || null,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : 'Unknown error'
                }
            });
        }
        return;
    }

    // Handle unsupported HTTP methods
    res.status(405).json({
        jsonrpc: '2.0',
        error: {
            code: -32000,
            message: `HTTP method ${method} not supported`
        }
    });
});

// Health check endpoint
mcpRoute.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        protocol: PROTOCOL_VERSION,
        transport: 'http',
        capabilities: SERVER_CAPABILITIES,
        serverInfo: SERVER_INFO,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Status endpoint for monitoring
mcpRoute.get('/status', (_req: Request, res: Response) => {
    res.json({
        status: 'ready',
        protocol: PROTOCOL_VERSION,
        transport: 'http',
        capabilities: SERVER_CAPABILITIES,
        serverInfo: SERVER_INFO,
        endpoints: {
            main: '/api/mcp',
            health: '/api/mcp/health',
            status: '/api/mcp/status'
        },
        timestamp: new Date().toISOString()
    });
});

export default mcpRoute; 