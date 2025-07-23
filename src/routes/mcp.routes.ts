import { Router } from 'express';
import { MCPController } from '../controllers/mcp.controller';

const router = Router();
const mcpController = new MCPController();

// Add CORS headers for Claude MCP requests
router.use((req, res, next) => {
    console.log(`MCP Request: ${req.method} ${req.url} from ${req.get('Origin') || 'unknown origin'}`);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('Body:', JSON.stringify(req.body, null, 2));
    }
    
    // Enhanced CORS headers for Claude compatibility
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-email, User-Agent, Cache-Control, Pragma');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    
    // Set connection headers to prevent premature closing
    res.header('Connection', 'keep-alive');
    res.header('Keep-Alive', 'timeout=30, max=1000');
    
    // Handle preflight requests immediately
    if (req.method === 'OPTIONS') {
        console.log('Handling OPTIONS preflight request');
        res.status(200).end();
        return;
    }
    
    next();
});

// Main MCP endpoint - handles all MCP protocol messages
router.options('/', (_req, res) => {
    console.log('Direct OPTIONS request to MCP root');
    res.status(200).end();
});

// Handle GET requests for Server-Sent Events (SSE) that Claude expects
router.get('/', (req, res) => {
    console.log('MCP GET request - Setting up SSE connection');
    
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Cache-Control'
    });
    
    // Send initial connection confirmation
    res.write('event: connected\n');
    res.write('data: {"status": "MCP connection established", "server": "cost-katana-mcp", "version": "1.0.0"}\n\n');
    
    // Keep connection alive with periodic heartbeat
    const heartbeat = setInterval(() => {
        if (!res.destroyed) {
            res.write('event: heartbeat\n');
            res.write(`data: {"timestamp": "${new Date().toISOString()}", "status": "alive"}\n\n`);
        } else {
            clearInterval(heartbeat);
        }
    }, 30000); // 30 second heartbeat
    
    // Handle client disconnect
    req.on('close', () => {
        console.log('MCP SSE connection closed by client');
        clearInterval(heartbeat);
    });
    
    req.on('aborted', () => {
        console.log('MCP SSE connection aborted');
        clearInterval(heartbeat);
    });
});

// Wrap MCP controller with enhanced error handling
router.post('/', async (req, res) => {
    try {
        console.log(`Processing MCP request: ${req.body?.method || 'unknown method'}`);
        // Ensure we don't close the connection prematurely
        req.setTimeout(30000); // 30 second timeout
        await mcpController.handleMCP(req, res);
    } catch (error) {
        console.error('MCP Request Error:', error);
        
        // Ensure we send a proper JSON-RPC error response
        if (!res.headersSent) {
            res.status(200).json({
                jsonrpc: '2.0',
                id: req.body?.id || null,
                error: {
                    code: -32603,
                    message: 'Internal server error',
                    data: error instanceof Error ? error.message : 'Unknown error'
                }
            });
        }
    }
});

// Legacy endpoints for backwards compatibility
router.options('/initialize', (_req, res) => res.sendStatus(200));
router.post('/initialize', mcpController.initialize);

router.options('/tools/list', (_req, res) => res.sendStatus(200));
router.post('/tools/list', mcpController.listTools);

router.options('/tools/call', (_req, res) => res.sendStatus(200));
router.post('/tools/call', mcpController.callTool);

router.options('/resources/list', (_req, res) => res.sendStatus(200));
router.post('/resources/list', mcpController.listResources);

router.options('/prompts/list', (_req, res) => res.sendStatus(200));
router.post('/prompts/list', mcpController.listPrompts);

// Auto-tracking endpoint
router.post('/auto-track', mcpController.autoTrack);

// Health check for MCP server
router.get('/health', (_req, res) => {
    res.json({
        status: 'healthy',
        service: 'cost-katana-mcp',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        capabilities: [
            'usage_tracking',
            'cost_analytics', 
            'project_management',
            'cost_optimization',
            'budget_alerts'
        ]
    });
});

// MCP Configuration endpoint - returns the connection details for Claude
router.get('/config', (_req, res) => {
    const baseUrl = process.env.BASE_URL || 'https://cost-katana-backend.store';
    
    res.json({
        name: "cost-katana-mcp",
        description: "Cost Katana AI Cost Intelligence & Optimization",
        version: "1.0.0",
        connection: {
            type: "http",
            url: `${baseUrl}/api/mcp`,
            method: "POST"
        },
        capabilities: {
            tools: [
                "track_claude_usage",
                "get_cost_analytics", 
                "create_project",
                "optimize_costs",
                "compare_models",
                "setup_budget_alerts",
                "forecast_costs",
                "audit_project_costs"
            ],
            resources: [
                "AI Model Pricing Database",
                "Cost Analytics Dashboard", 
                "Active Projects",
                "Cost Optimization Recommendations",
                "Budget Alerts & Notifications",
                "Model Performance Comparison"
            ],
            prompts: [
                "Analyze Spending Patterns",
                "Suggest Model Alternatives",
                "Create Budget Plans",
                "Optimize Prompt Efficiency",
                "Setup Cost Alerts",
                "Project Cost Analysis"
            ],
            features: [
                "Real-time cost tracking & analytics",
                "AI-powered optimization recommendations", 
                "Comprehensive model comparison",
                "Budget alerts & forecasting",
                "Project-level cost auditing",
                "Usage pattern analysis",
                "Cross-provider cost comparison",
                "Automated prompt optimization"
            ]
        },
        setup_instructions: {
            "1": "Copy the connection URL above",
            "2": "Go to claude.ai → Settings → Feature Preview",
            "3": "Enable 'Model Context Protocol (MCP)'",
            "4": "Add Custom Connector with the URL",
            "5": "Start chatting - Cost Katana will auto-track your usage!"
        }
    });
});

export { router as mcpRoutes }; 