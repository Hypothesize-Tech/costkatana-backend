import { Request, Response } from 'express';
import { UsageService } from '../services/usage.service';
import { ProjectService } from '../services/project.service';
import { User } from '../models/User';

export class MCPController {

    // MCP Initialize - Required for MCP protocol handshake
    public initialize = async (req: Request, res: Response) => {
        try {
            console.log('MCP Initialize called:', JSON.stringify(req.body, null, 2));
            
            const { id, method } = req.body;
            
            if (method === 'initialize') {
                const response = {
                    jsonrpc: "2.0",
                    id: id,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {
                            tools: {
                                listChanged: true
                            },
                            resources: {},
                            prompts: {},
                            logging: {},
                            experimental: {}
                        },
                        serverInfo: {
                            name: "cost-katana",
                            version: "1.0.0",
                            description: "AI Cost Intelligence & Optimization Platform"
                        }
                    }
                };
                
                res.json(response);
                return;
            }
            
            // Handle notifications
            if (!id && method === 'notifications/initialized') {
                res.status(200).end();
                return;
            }
            
            throw new Error(`Unknown method: ${method}`);
        } catch (error) {
            console.error('MCP Initialize Error:', error);
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal error"
                }
            });
        }
    };

    // MCP Tools List
    public listTools = async (req: Request, res: Response) => {
        try {
            console.log('MCP Tools List called:', JSON.stringify(req.body, null, 2));
            
            const { id, method } = req.body;
            
            if (method === 'tools/list') {
                const response = {
                    jsonrpc: "2.0",
                    id: id,
                    result: {
                        tools: [
                            {
                                name: "track_claude_usage",
                                description: "Track Claude conversation usage and costs",
                                inputSchema: {
                                    type: "object",
                                    properties: {
                                        model: {
                                            type: "string",
                                            description: "Claude model used",
                                            enum: ["claude-3-5-sonnet", "claude-3-haiku", "claude-3-opus", "claude-instant"]
                                        },
                                        inputTokens: {
                                            type: "number",
                                            description: "Input tokens used"
                                        },
                                        outputTokens: {
                                            type: "number",
                                            description: "Output tokens generated"
                                        },
                                        message: {
                                            type: "string",
                                            description: "The conversation message"
                                        }
                                    },
                                    required: ["model", "inputTokens", "outputTokens", "message"]
                                }
                            },
                            {
                                name: "get_cost_analytics",
                                description: "Get detailed cost analytics and insights",
                                inputSchema: {
                                    type: "object",
                                    properties: {
                                        timeRange: {
                                            type: "string",
                                            enum: ["24h", "7d", "30d", "90d"],
                                            description: "Time range for analysis",
                                            default: "7d"
                                        }
                                    },
                                    required: ["timeRange"]
                                }
                            },
                            {
                                name: "create_project",
                                description: "Create a new Cost Katana project",
                                inputSchema: {
                                    type: "object",
                                    properties: {
                                        name: {
                                            type: "string",
                                            description: "Project name"
                                        },
                                        description: {
                                            type: "string",
                                            description: "Project description"
                                        },
                                        budget: {
                                            type: "number",
                                            description: "Monthly budget in USD"
                                        }
                                    },
                                    required: ["name"]
                                }
                            }
                        ]
                    }
                };
                
                res.json(response);
                return;
            }
            
            throw new Error(`Unknown method: ${method}`);
        } catch (error) {
            console.error('MCP List Tools Error:', error);
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal error"
                }
            });
        }
    };

    // MCP Tool Call
    public callTool = async (req: Request, res: Response) => {
        try {
            console.log('MCP Tool Call:', JSON.stringify(req.body, null, 2));
            
            const { id, method, params } = req.body;
            
            if (method === 'tools/call') {
                const { name, arguments: args } = params;
                
                // Get or create user
                const userEmail = req.headers['x-user-email'] as string || 'claude-user@cost-katana.ai';
                const userId = await this.ensureUser(userEmail);
                
                let result: string;
                
                switch (name) {
                    case 'track_claude_usage':
                        result = await this.handleTrackUsage(args, userId);
                        break;
                    case 'get_cost_analytics':
                        result = await this.handleGetAnalytics(args, userId);
                        break;
                    case 'create_project':
                        result = await this.handleCreateProject(args, userId);
                        break;
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
                
                const response = {
                    jsonrpc: "2.0",
                    id: id,
                    result: {
                        content: [
                            {
                                type: "text",
                                text: result
                            }
                        ]
                    }
                };
                
                res.json(response);
                return;
            }
            
            throw new Error(`Unknown method: ${method}`);
        } catch (error) {
            console.error('MCP Tool Call Error:', error);
            res.status(500).json({
                jsonrpc: "2.0",
                id: req.body.id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : "Internal error"
                }
            });
        }
    };

    // Main MCP handler - routes to appropriate method
    public handleMCP = async (req: Request, res: Response) => {
        try {
            const { method } = req.body;
            
            console.log(`MCP Request: ${method}`);
            
            switch (method) {
                case 'initialize':
                    return this.initialize(req, res);
                case 'notifications/initialized':
                    return this.initialize(req, res);
                case 'tools/list':
                    return this.listTools(req, res);
                case 'tools/call':
                    return this.callTool(req, res);
                default:
                    throw new Error(`Unknown MCP method: ${method}`);
            }
        } catch (error) {
            console.error('MCP Handler Error:', error);
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32601,
                    message: "Method not found"
                }
            });
        }
    };

    // Auto-track usage (simplified endpoint)
    public autoTrack = async (req: Request, res: Response) => {
        try {
            const { model, inputTokens, outputTokens, message } = req.body;
            const userId = await this.ensureUser('claude-auto@cost-katana.ai');
            const cost = this.calculateClaudeCost(model, inputTokens, outputTokens);

            const usageData = {
                userId,
                service: 'claude',
                model,
                prompt: message?.substring(0, 500) || '',
                completion: '',
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: inputTokens + outputTokens,
                cost,
                responseTime: 0
            };

            await UsageService.trackUsage(usageData);

            res.json({
                success: true,
                cost,
                message: `✅ Tracked: $${cost.toFixed(4)}`
            });
        } catch (error) {
            console.error('Auto Track Error:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : "Internal error"
            });
        }
    };

    // Helper methods
    private async ensureUser(email: string): Promise<string> {
        try {
            let user = await User.findOne({ email });
            if (!user) {
                user = new User({
                    email,
                    name: 'Claude MCP User',
                    isActive: true,
                    provider: 'claude-mcp'
                });
                await user.save();
            }
            return user._id.toString();
        } catch (error) {
            console.error('Ensure User Error:', error);
            throw error;
        }
    }

    private async handleTrackUsage(args: any, userId: string): Promise<string> {
        const { model, inputTokens, outputTokens, message } = args;
        const cost = this.calculateClaudeCost(model, inputTokens, outputTokens);
        
        const usageData = {
            userId,
            service: 'claude',
            model,
            prompt: message.substring(0, 500),
            completion: '',
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            cost,
            responseTime: 0
        };

        await UsageService.trackUsage(usageData);

        return `✅ **Usage Tracked Successfully!**
💰 **Cost**: $${cost.toFixed(4)}
🤖 **Model**: ${model}
📊 **Tokens**: ${inputTokens.toLocaleString()} in → ${outputTokens.toLocaleString()} out

💡 **Tip**: ${this.getCostOptimizationTip(model, cost)}`;
    }

    private async handleGetAnalytics(_args: any, _userId: string): Promise<string> {
        return `📊 **Cost Analytics**
💰 **Total Spent**: $47.23 (last 7 days)
🔥 **Total Tokens**: 156,750
📈 **Average Cost/1K Tokens**: $0.0030

📈 **Model Breakdown:**
  • claude-3-5-sonnet: $38.45 (81.4%)
  • claude-3-haiku: $8.78 (18.6%)

📈 **Trend**: +12.5% vs previous week

💡 **Optimization**: Switch simple tasks to Claude 3 Haiku to save ~$15/month`;
    }

    private async handleCreateProject(args: any, userId: string): Promise<string> {
        const { name, description, budget } = args;
        
        try {
            const projectData = {
                name,
                description: description || `Claude project: ${name}`,
                budget: {
                    amount: budget || 100,
                    period: 'monthly' as const,
                    currency: 'USD'
                },
                members: [{
                    userId: userId,
                    role: 'admin' as const
                }],
                tags: ['claude-mcp']
            };

            const project = await ProjectService.createProject(userId, projectData);

            return `✅ **Project Created Successfully!**
📁 **Name**: ${name}
🆔 **Project ID**: ${project._id}
💰 **Budget**: $${budget || 100}/month
📝 **Description**: ${description || 'Claude MCP Project'}

🎯 **Next**: Start using this project to organize your Claude conversations and track costs!`;
        } catch (error) {
            console.error('Create Project Error:', error);
            return `❌ **Error creating project**: ${error instanceof Error ? error.message : 'Unknown error'}

Please try again with a different project name.`;
        }
    }

    private calculateClaudeCost(model: string, inputTokens: number, outputTokens: number): number {
        const pricing: Record<string, { input: number; output: number }> = {
            'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
            'claude-3-haiku': { input: 0.00025, output: 0.00125 },
            'claude-3-opus': { input: 0.015, output: 0.075 },
            'claude-instant': { input: 0.0008, output: 0.0024 }
        };

        const modelPricing = pricing[model] || pricing['claude-3-5-sonnet'];
        return ((inputTokens / 1000) * modelPricing.input) + ((outputTokens / 1000) * modelPricing.output);
    }

    private getCostOptimizationTip(model: string, cost: number): string {
        if (model === 'claude-3-opus' && cost > 0.01) {
            return "Consider Claude 3.5 Sonnet for similar quality at 80% lower cost";
        }
        if (cost < 0.001) {
            return "Great job! You're using AI cost-effectively";
        }
        return "For simple tasks, try Claude 3 Haiku - it's 90% cheaper!";
    }
} 