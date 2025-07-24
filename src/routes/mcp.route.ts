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
mcpRoute.use(mcpRateLimit(200, 60000)); // Increased rate limit for better performance

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

// Pre-computed static responses for better performance
const STATIC_TOOLS_LIST = {
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
};

const STATIC_RESOURCES_LIST = {
    resources: [
        {
            uri: "cost-katana://pricing/ai-models",
            name: "AI Model Pricing Database",
            description: "Real-time pricing data for all major AI models (OpenAI, Anthropic, Google, etc.)",
            mimeType: "application/json"
        },
        {
            uri: "cost-katana://analytics/cost-trends",
            name: "Cost Analytics Dashboard",
            description: "Your AI spending trends, model usage patterns, and cost optimization opportunities",
            mimeType: "application/json"
        },
        {
            uri: "cost-katana://projects/active",
            name: "Active Projects",
            description: "All your Cost Katana projects with current budgets, spending, and usage metrics",
            mimeType: "application/json"
        },
        {
            uri: "cost-katana://optimization/recommendations",
            name: "Cost Optimization Recommendations",
            description: "AI-powered recommendations to reduce your AI costs based on usage patterns",
            mimeType: "application/json"
        },
        {
            uri: "cost-katana://alerts/budget",
            name: "Budget Alerts & Notifications",
            description: "Active budget alerts, spending thresholds, and notification settings",
            mimeType: "application/json"
        },
        {
            uri: "cost-katana://comparison/models",
            name: "Model Performance vs Cost Comparison",
            description: "Side-by-side comparison of AI models showing performance, cost, and efficiency ratings",
            mimeType: "application/json"
        }
    ]
};

const STATIC_PROMPTS_LIST = {
    prompts: [
        {
            name: "analyze_spending_pattern",
            description: "Analyze my AI spending patterns and identify cost optimization opportunities",
            arguments: [
                {
                    name: "timeframe",
                    description: "Analysis timeframe (7d, 30d, 90d)",
                    required: false
                },
                {
                    name: "focus_area",
                    description: "Specific area to focus on (models, projects, usage_patterns)",
                    required: false
                }
            ]
        },
        {
            name: "suggest_model_alternatives",
            description: "Get recommendations for cheaper AI models that maintain similar performance",
            arguments: [
                {
                    name: "current_model",
                    description: "Current AI model you're using",
                    required: true
                },
                {
                    name: "use_case",
                    description: "What you use the model for (coding, writing, analysis, etc.)",
                    required: true
                }
            ]
        },
        {
            name: "create_budget_plan",
            description: "Create a comprehensive budget plan for AI usage across projects",
            arguments: [
                {
                    name: "monthly_budget",
                    description: "Total monthly budget for AI costs",
                    required: true
                },
                {
                    name: "project_count",
                    description: "Number of projects to distribute budget across",
                    required: false
                }
            ]
        },
        {
            name: "optimize_prompt_efficiency",
            description: "Get suggestions to make your prompts more cost-effective while maintaining quality",
            arguments: [
                {
                    name: "sample_prompt",
                    description: "A sample prompt you frequently use",
                    required: true
                },
                {
                    name: "expected_output",
                    description: "What you expect the prompt to produce",
                    required: false
                }
            ]
        },
        {
            name: "setup_cost_alerts",
            description: "Configure intelligent cost alerts and spending notifications",
            arguments: [
                {
                    name: "alert_type",
                    description: "Type of alert (daily, weekly, budget_threshold, anomaly)",
                    required: true
                },
                {
                    name: "threshold_amount",
                    description: "Dollar amount to trigger alert",
                    required: false
                }
            ]
        },
        {
            name: "project_cost_analysis",
            description: "Detailed cost analysis and optimization recommendations for a specific project",
            arguments: [
                {
                    name: "project_name",
                    description: "Name of the project to analyze",
                    required: true
                },
                {
                    name: "analysis_depth",
                    description: "Depth of analysis (quick, detailed, comprehensive)",
                    required: false
                }
            ]
        }
    ]
};

// Main MCP endpoint - HTTP-only transport with optimized performance
mcpRoute.all('/', async (req: Request, res: Response) => {
    const method = req.method;
    const { method: rpcMethod, params, id } = req.body || {};
    
    // Set response headers for better performance and connection stability
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=60, max=1000');
    res.setHeader('X-Response-Time-Priority', 'high');
    
    // Handle GET requests (capability discovery) - IMMEDIATE RESPONSE
    if (method === 'GET') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
        
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

    // Handle OPTIONS requests (CORS preflight) - IMMEDIATE RESPONSE
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

            // Set a global timeout for all MCP requests (10 seconds)
            const requestTimeout = setTimeout(() => {
                if (!res.headersSent) {
                    logger.warn('MCP request timeout', { method: rpcMethod, id });
                    res.status(200).json({
                        jsonrpc: '2.0',
                        id: id || null,
                        error: {
                            code: -32001,
                            message: 'Request timed out'
                        }
                    });
                }
            }, 10000);

            const clearTimeoutAndRespond = (response: any) => {
                clearTimeout(requestTimeout);
                if (!res.headersSent) {
                    res.json(response);
                }
            };

            // Handle different MCP methods with optimized responses
            switch (rpcMethod) {
                case 'initialize':
                    logger.info('MCP Initialize request', { params });
                    clearTimeoutAndRespond({
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
                    clearTimeoutAndRespond({
                        jsonrpc: '2.0',
                        id,
                        result: null
                    });
                    break;

                case 'tools/list':
                    logger.info('MCP Tools list requested - returning static response');
                    
                    // Set cache headers for better performance
                    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
                    
                    // IMMEDIATE STATIC RESPONSE - No processing, no delays
                    clearTimeoutAndRespond({
                        jsonrpc: '2.0',
                        id,
                        result: STATIC_TOOLS_LIST
                    });
                    break;

                case 'tools/call':
                    logger.info('MCP Tool call requested', { toolName: params?.name });
                    try {
                        await mcpController.callTool(req, res);
                        clearTimeout(requestTimeout);
                    } catch (error) {
                        clearTimeoutAndRespond({
                            jsonrpc: '2.0',
                            id: id || null,
                            error: {
                                code: -32603,
                                message: 'Internal error',
                                data: error instanceof Error ? error.message : 'Unknown error'
                            }
                        });
                    }
                    break;

                case 'resources/list':
                    logger.info('MCP Resources list requested - returning static response');
                    
                    // Set cache headers for better performance
                    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
                    
                    // IMMEDIATE STATIC RESPONSE - No processing, no delays
                    clearTimeoutAndRespond({
                        jsonrpc: '2.0',
                        id,
                        result: STATIC_RESOURCES_LIST
                    });
                    break;

                case 'resources/read':
                    logger.info('MCP Resource read requested', { uri: params?.uri });
                    clearTimeoutAndRespond({
                        jsonrpc: '2.0',
                        id,
                        error: {
                            code: -32601,
                            message: 'resources/read not implemented'
                        }
                    });
                    break;

                case 'prompts/list':
                    logger.info('MCP Prompts list requested - returning static response');
                    
                    // Set cache headers for better performance
                    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
                    
                    // IMMEDIATE STATIC RESPONSE - No processing, no delays
                    clearTimeoutAndRespond({
                        jsonrpc: '2.0',
                        id,
                        result: STATIC_PROMPTS_LIST
                    });
                    break;

                case 'prompts/get':
                    logger.info('MCP Prompt get requested', { name: params?.name });
                    clearTimeoutAndRespond({
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
                    clearTimeoutAndRespond({
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
            
            res.status(200).json({
                jsonrpc: '2.0',
                id: id || null,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : 'Unknown error'
                }
            });
        }
    }
});

// Add config.json route for MCP compatibility
mcpRoute.get('/config.json', (_req: Request, res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    res.json({
        name: "Cost Katana MCP Server",
        version: "1.0.0",
        description: "AI Cost Optimization MCP Server",
        capabilities: SERVER_CAPABILITIES,
        endpoints: {
            health: "/api/mcp/health",
            main: "/api/mcp"
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