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
    
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-email');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    
    next();
});

// Main MCP endpoint - handles all MCP protocol messages
router.options('/', (_req, res) => res.sendStatus(200));
router.post('/', mcpController.handleMCP);

// Legacy endpoints for backwards compatibility
router.options('/initialize', (_req, res) => res.sendStatus(200));
router.post('/initialize', mcpController.initialize);

router.options('/tools/list', (_req, res) => res.sendStatus(200));
router.post('/tools/list', mcpController.listTools);

router.options('/tools/call', (_req, res) => res.sendStatus(200));
router.post('/tools/call', mcpController.callTool);

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
                "create_project"
            ],
            features: [
                "Real-time cost tracking",
                "Project-level cost monitoring", 
                "AI-powered optimization recommendations",
                "Budget alerts and notifications",
                "Integration with Claude projects"
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