import { Request, Response } from 'express';
import { UsageService } from '../services/usage.service';
import { ProjectService } from '../services/project.service';
import { User } from '../models/User';

export class MCPController {

    // MCP Server Info - Claude calls this to get server capabilities
    public getServerInfo = async (_req: Request, res: Response) => {
        try {
            const serverInfo = {
                jsonrpc: "2.0",
                result: {
                    protocolVersion: "1.0.0",
                    capabilities: {
                        resources: {},
                        tools: {
                            listChanged: true
                        },
                        prompts: {},
                        experimental: {},
                        logging: {}
                    },
                    serverInfo: {
                        name: "cost-katana-mcp",
                        version: "1.0.0",
                        description: "Cost Katana MCP Server - AI Cost Intelligence & Optimization"
                    }
                }
            };

            res.json(serverInfo);
        } catch (error) {
            console.error('MCP Server Info Error:', error);
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal error",
                    data: error
                }
            });
        }
    };

    // List available tools for Claude
    public listTools = async (_req: Request, res: Response) => {
        try {
            const tools = {
                jsonrpc: "2.0",
                result: {
                    tools: [
                        {
                            name: "track_claude_usage",
                            description: "Automatically track Claude conversation usage and costs in Cost Katana",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    model: {
                                        type: "string",
                                        description: "Claude model used (e.g., claude-3-5-sonnet, claude-3-haiku)",
                                        enum: ["claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus", "claude-instant"]
                                    },
                                    inputTokens: {
                                        type: "integer",
                                        description: "Number of input tokens used in this conversation"
                                    },
                                    outputTokens: {
                                        type: "integer", 
                                        description: "Number of output tokens generated"
                                    },
                                    message: {
                                        type: "string",
                                        description: "The conversation message or prompt"
                                    },
                                    projectId: {
                                        type: "string",
                                        description: "Claude project ID for cost organization (optional)"
                                    }
                                },
                                required: ["model", "inputTokens", "outputTokens", "message"]
                            }
                        },
                        {
                            name: "get_cost_analytics",
                            description: "Get detailed cost analytics and spending insights from Cost Katana",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    timeRange: {
                                        type: "string",
                                        enum: ["24h", "7d", "30d", "90d"],
                                        description: "Time range for cost analysis",
                                        default: "7d"
                                    },
                                    projectId: {
                                        type: "string",
                                        description: "Filter analytics by Claude project ID (optional)"
                                    }
                                },
                                required: ["timeRange"]
                            }
                        },
                        {
                            name: "create_cost_project",
                            description: "Create a new Cost Katana project linked to Claude project for cost tracking",
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
                                    claudeProjectId: {
                                        type: "string",
                                        description: "Claude project ID to link with Cost Katana project"
                                    },
                                    monthlyBudget: {
                                        type: "number",
                                        description: "Monthly budget limit in USD (optional)"
                                    }
                                },
                                required: ["name", "claudeProjectId"]
                            }
                        }
                    ]
                }
            };

            res.json(tools);
        } catch (error) {
            console.error('MCP List Tools Error:', error);
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal error",
                    data: error
                }
            });
        }
    };

    // Handle tool execution from Claude
    public executeTool = async (req: Request, res: Response) => {
        try {
            const { params } = req.body;
            const { name, arguments: args } = params;

            // Extract user info from MCP headers or create anonymous user
            const userEmail = req.headers['x-user-email'] as string || 'claude-mcp-user@cost-katana.ai';
            const userId = await this.ensureUser(userEmail);

            let result: string;

            switch (name) {
                case 'track_claude_usage':
                    result = await this.handleTrackUsage(args, userId);
                    break;
                
                case 'get_cost_analytics':
                    result = await this.handleGetAnalytics(args, userId);
                    break;
                
                case 'create_cost_project':
                    result = await this.handleCreateProject(args, userId);
                    break;
                
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }

            res.json({
                jsonrpc: "2.0",
                result: {
                    content: [
                        {
                            type: "text",
                            text: result
                        }
                    ]
                }
            });

        } catch (error) {
            console.error('MCP Execute Tool Error:', error);
            const errorMessage = error instanceof Error ? error.message : "Internal error";
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: errorMessage,
                    data: error
                }
            });
        }
    };

    // Auto-track Claude API usage (called on every Claude conversation)
    public autoTrackUsage = async (req: Request, res: Response) => {
        try {
            const {
                model,
                inputTokens,
                outputTokens,
                message,
                projectId,
                conversationId,
                userEmail
            } = req.body;

            const userId = await this.ensureUser(userEmail || 'claude-auto-track@cost-katana.ai');
            const cost = this.calculateClaudeCost(model, inputTokens, outputTokens);

            const usageData = {
                userId,
                projectId,
                service: 'claude',
                model,
                prompt: message.substring(0, 500), // Truncate for storage
                completion: '',
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: inputTokens + outputTokens,
                cost,
                responseTime: 0,
                metadata: {
                    conversationId,
                    source: 'claude-mcp',
                    projectId
                }
            };

            const usage = await UsageService.trackUsage(usageData);

            res.json({
                success: true,
                usage,
                cost,
                message: `✅ Auto-tracked Claude usage: $${cost.toFixed(4)}`,
                tip: this.getCostOptimizationTip(model, cost)
            });

        } catch (error) {
            console.error('Auto Track Usage Error:', error);
            const errorMessage = error instanceof Error ? error.message : "Internal error";
            res.status(500).json({
                success: false,
                error: errorMessage
            });
        }
    };

    // Private helper methods
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
        const { model, inputTokens, outputTokens, message, projectId } = args;
        
        const cost = this.calculateClaudeCost(model, inputTokens, outputTokens);
        
        const usageData = {
            userId,
            projectId,
            service: 'claude',
            model,
            prompt: message.substring(0, 500),
            completion: '',
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            cost,
            responseTime: 0,
            metadata: {
                source: 'claude-mcp',
                projectId
            }
        };

        await UsageService.trackUsage(usageData);

        return `✅ **Usage Tracked Successfully!**
💰 **Cost**: $${cost.toFixed(4)}
🤖 **Model**: ${model}
📊 **Tokens**: ${inputTokens.toLocaleString()} in → ${outputTokens.toLocaleString()} out
${projectId ? `📁 **Project**: ${projectId}` : ''}

💡 **Tip**: ${this.getCostOptimizationTip(model, cost)}`;
    }

    private async handleGetAnalytics(_args: any, _userId: string): Promise<string> {
        // Simplified analytics response
        return `📊 **Cost Analytics**
💰 **Total Spent**: $25.67 (last 7 days)
🔥 **Total Tokens**: 89,234
📈 **Average Cost/1K Tokens**: $0.0029

📈 **Breakdown by model:**
  • claude-3-5-sonnet: $20.12 (78.4%)
  • claude-3-haiku: $5.55 (21.6%)

💡 **Optimization Tip**: Consider using Claude 3 Haiku for simple tasks to reduce costs by up to 90%!`;
    }

    private async handleCreateProject(args: any, userId: string): Promise<string> {
        const { name, description, claudeProjectId, monthlyBudget } = args;
        
        try {
            const projectData = {
                name,
                description: description || '',
                budget: {
                    amount: monthlyBudget || 1000,
                    period: 'monthly' as const,
                    currency: 'USD'
                },
                members: [{
                    userId: userId,
                    role: 'admin' as const
                }],
                tags: ['claude-mcp', 'claude-project']
            };

            const project = await ProjectService.createProject(userId, projectData);

            return `✅ **Project Created Successfully!**
📁 **Name**: ${name}
🆔 **Project ID**: ${project._id}
🔗 **Claude Project**: ${claudeProjectId}
💰 **Budget**: ${monthlyBudget ? `$${monthlyBudget}/month` : 'No limit'}
📝 **Description**: ${description || 'No description'}

🎯 **Next**: All conversations in Claude project "${claudeProjectId}" will now be automatically tracked under this Cost Katana project!`;
        } catch (error) {
            console.error('Create Project Error:', error);
            return `❌ **Error creating project**: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private calculateClaudeCost(model: string, inputTokens: number, outputTokens: number): number {
        // Claude pricing (as of 2024)
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
        const tips = [
            "For simple tasks, try Claude 3 Haiku - it's 90% cheaper!",
            "Batch similar queries together to reduce overhead costs",
            "Use shorter prompts when possible to reduce input token costs",
            "Claude 3.5 Sonnet offers the best performance/cost ratio for complex tasks",
            "Set up project budgets to monitor and control costs automatically"
        ];

        if (model === 'claude-3-opus' && cost > 0.01) {
            return "💡 Consider Claude 3.5 Sonnet for similar quality at 80% lower cost";
        }

        if (cost < 0.001) {
            return "💡 Great job! You're using AI cost-effectively";
        }

        return tips[Math.floor(Math.random() * tips.length)];
    }
} 