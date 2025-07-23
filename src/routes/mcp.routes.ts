import { Router } from 'express';
import { MCPController } from '../controllers/mcp.controller';

const router = Router();
const mcpController = new MCPController();

// MCP Server endpoints for Claude to discover and interact with
router.post('/server-info', mcpController.getServerInfo);
router.post('/list-tools', mcpController.listTools);
router.post('/execute-tool', mcpController.executeTool);

// Auto-tracking endpoint for monitoring Claude usage
router.post('/auto-track', mcpController.autoTrackUsage);

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
                "create_cost_project",
                "get_project_costs",
                "optimize_costs",
                "setup_cost_alerts"
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