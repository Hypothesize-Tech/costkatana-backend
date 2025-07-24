import express, { Request, Response, NextFunction } from 'express';
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

// MCP-specific CORS middleware
mcpRoute.use((req: Request, res: Response, next: NextFunction) => {
    // Allow all origins for MCP compatibility
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, User-Agent, Accept, Cache-Control, X-Requested-With');
    res.header('Access-Control-Expose-Headers', 'X-Response-Time-Priority, Cache-Control');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    next();
});

// MCP Health check endpoint
mcpRoute.get('/health', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        mcp: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: Object.keys(SERVER_CAPABILITIES),
            cacheStatus: {
                toolsListCached: MCPController.toolsListCache !== null,
                cacheAge: MCPController.toolsListCache ? 
                    Math.floor((Date.now() - MCPController.toolsListCacheTime) / 1000) : 0
            }
        }
    });
});

// Simple ping endpoint for connectivity testing
mcpRoute.get('/ping', (_req: Request, res: Response) => {
    res.json({
        pong: true,
        timestamp: new Date().toISOString(),
        server: 'Cost Katana MCP'
    });
});

// MCP test endpoint for client connectivity
mcpRoute.post('/test', (req: Request, res: Response) => {
    const { id, method } = req.body || {};
    
    if (method !== 'test') {
        res.json({
            jsonrpc: '2.0',
            id: id || null,
            error: {
                code: -32600,
                message: 'Invalid Request - method must be "test"'
            }
        });
        return;
    }
    
    res.json({
        jsonrpc: '2.0',
        id: id || null,
        result: {
            message: 'MCP connection test successful',
            timestamp: new Date().toISOString(),
            server: 'Cost Katana MCP'
        }
    });
});

// MCP protocol version
const PROTOCOL_VERSION = '2025-06-18';

// Server capabilities - Empty objects indicate features are available (per MCP specification)
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
        // For HTTP-only transport, always return JSON regardless of Accept header
        // The Accept: text/event-stream is likely a legacy header from old implementations
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        
        res.json({
            jsonrpc: '2.0',
            result: {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: SERVER_CAPABILITIES,
                serverInfo: SERVER_INFO
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
        // Add CORS headers for Claude compatibility
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, User-Agent, Accept');
        
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
                    
                    // Send acknowledgment
                    res.status(200).json({
                        jsonrpc: '2.0'
                    });
                    
                    // After successful initialization, we should trigger Claude to request capabilities
                    // This is done by ensuring our capabilities are non-empty
                    logger.info('MCP handshake completed - server ready for capability requests');
                    break;

                case 'tools/list':
                    logger.info('MCP Tools list requested - returning 8 cost optimization tools');
                    
                    // Set immediate response headers to prevent client-side timeouts
                    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
                    res.setHeader('X-Response-Time-Priority', 'high');
                    res.setHeader('Connection', 'keep-alive');
                    res.setHeader('Keep-Alive', 'timeout=30, max=100');
                    
                    // IMMEDIATE STATIC RESPONSE - No processing, no delays
                    res.json({
                        jsonrpc: '2.0',
                        id,
                        result: {
                            tools: [
                                {
                                    name: 'track_claude_usage',
                                    description: 'Track Claude conversation usage and costs in real-time',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            model: {
                                                type: 'string',
                                                description: 'Claude model used',
                                                enum: ['claude-3-5-sonnet', 'claude-3-haiku', 'claude-3-opus', 'claude-instant']
                                            },
                                            inputTokens: { type: 'number', description: 'Input tokens used' },
                                            outputTokens: { type: 'number', description: 'Output tokens generated' },
                                            message: { type: 'string', description: 'The conversation message' },
                                            projectId: { type: 'string', description: 'Project ID to associate this usage with (optional)' }
                                        },
                                        required: ['model', 'inputTokens', 'outputTokens', 'message']
                                    }
                                },
                                {
                                    name: 'get_cost_analytics',
                                    description: 'Get detailed cost analytics, spending trends, and optimization insights',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            timeRange: {
                                                type: 'string',
                                                enum: ['24h', '7d', '30d', '90d'],
                                                description: 'Time range for analysis',
                                                default: '7d'
                                            },
                                            breakdown: {
                                                type: 'string',
                                                enum: ['model', 'project', 'date', 'provider'],
                                                description: 'How to break down the analytics',
                                                default: 'model'
                                            },
                                            includeOptimization: {
                                                type: 'boolean',
                                                description: 'Include optimization recommendations',
                                                default: true
                                            }
                                        },
                                        required: ['timeRange']
                                    }
                                },
                                {
                                    name: 'create_project',
                                    description: 'Create a new Cost Katana project for organized cost tracking',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            name: { type: 'string', description: 'Project name' },
                                            description: { type: 'string', description: 'Project description' },
                                            budget: { type: 'number', description: 'Monthly budget in USD' },
                                            alertThreshold: {
                                                type: 'number',
                                                description: 'Budget alert threshold (percentage, e.g., 80 for 80%)',
                                                default: 80
                                            }
                                        },
                                        required: ['name']
                                    }
                                },
                                {
                                    name: 'optimize_costs',
                                    description: 'Get AI-powered cost optimization recommendations based on your usage patterns',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            analysisType: {
                                                type: 'string',
                                                enum: ['quick', 'detailed', 'comprehensive'],
                                                description: 'Depth of optimization analysis',
                                                default: 'detailed'
                                            },
                                            focusArea: {
                                                type: 'string',
                                                enum: ['models', 'prompts', 'usage_patterns', 'projects', 'all'],
                                                description: 'Specific area to focus optimization on',
                                                default: 'all'
                                            },
                                            targetSavings: {
                                                type: 'number',
                                                description: 'Target percentage savings (e.g., 20 for 20%)',
                                                default: 25
                                            }
                                        }
                                    }
                                },
                                {
                                    name: 'compare_models',
                                    description: 'Compare AI models by cost, performance, and efficiency for your specific use case',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            useCase: { type: 'string', description: 'Your use case (coding, writing, analysis, chat, etc.)' },
                                            currentModel: { type: 'string', description: 'Current model you\'re using' },
                                            priorityFactor: {
                                                type: 'string',
                                                enum: ['cost', 'performance', 'balanced'],
                                                description: 'What to prioritize in recommendations',
                                                default: 'balanced'
                                            },
                                            includeAlternatives: {
                                                type: 'boolean',
                                                description: 'Include alternative providers (OpenAI, Google, etc.)',
                                                default: true
                                            }
                                        },
                                        required: ['useCase']
                                    }
                                },
                                {
                                    name: 'setup_budget_alerts',
                                    description: 'Configure intelligent budget alerts and spending notifications',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            alertType: {
                                                type: 'string',
                                                enum: ['budget_threshold', 'daily_limit', 'weekly_summary', 'cost_spike', 'model_efficiency'],
                                                description: 'Type of alert to set up'
                                            },
                                            threshold: { type: 'number', description: 'Alert threshold (dollar amount or percentage)' },
                                            frequency: {
                                                type: 'string',
                                                enum: ['immediate', 'daily', 'weekly', 'monthly'],
                                                description: 'How often to check and send alerts',
                                                default: 'immediate'
                                            },
                                            projectId: { type: 'string', description: 'Specific project to monitor (optional, defaults to all)' }
                                        },
                                        required: ['alertType', 'threshold']
                                    }
                                },
                                {
                                    name: 'forecast_costs',
                                    description: 'Predict future AI costs based on current usage patterns and trends',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            forecastPeriod: {
                                                type: 'string',
                                                enum: ['7d', '30d', '90d', '1y'],
                                                description: 'Period to forecast',
                                                default: '30d'
                                            },
                                            includeTrends: {
                                                type: 'boolean',
                                                description: 'Include usage trend analysis',
                                                default: true
                                            },
                                            scenarios: {
                                                type: 'string',
                                                enum: ['conservative', 'realistic', 'aggressive'],
                                                description: 'Forecast scenario based on usage growth',
                                                default: 'realistic'
                                            }
                                        }
                                    }
                                },
                                {
                                    name: 'audit_project_costs',
                                    description: 'Comprehensive cost audit of a specific project with detailed recommendations',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            projectId: { type: 'string', description: 'Project ID to audit' },
                                            auditDepth: {
                                                type: 'string',
                                                enum: ['surface', 'detailed', 'comprehensive'],
                                                description: 'Depth of the audit analysis',
                                                default: 'detailed'
                                            },
                                            includeRecommendations: {
                                                type: 'boolean',
                                                description: 'Include specific optimization recommendations',
                                                default: true
                                            },
                                            compareToBaseline: {
                                                type: 'boolean',
                                                description: 'Compare to industry benchmarks',
                                                default: true
                                            }
                                        },
                                        required: ['projectId']
                                    }
                                }
                            ]
                        }
                    });
                    break;

                case 'tools/call':
                    logger.info('MCP Tool call requested', { toolName: params?.name });
                    await mcpController.callTool(req, res);
                    break;

                case 'resources/list':
                    logger.info('MCP Resources list requested - returning 6 cost analytics resources');
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
                    logger.info('MCP Prompts list requested - returning 6 optimization workflow prompts');
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