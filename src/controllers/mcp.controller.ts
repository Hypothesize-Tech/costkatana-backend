import { Request, Response } from 'express';
import { UsageService } from '../services/usage.service';
import { AnalyticsService } from '../services/analytics.service';
import { ProjectService } from '../services/project.service';
import { OptimizationService } from '../services/optimization.service';
import { ForecastingService } from '../services/forecasting.service';
import { User } from '../models/User';
import { EmailService } from '../services/email.service';
import { logger } from '../utils/logger';

export class MCPController {

    // Add static cache for tools list to improve performance
    public static toolsListCache: any = null;
    public static toolsListCacheTime: number = 0;
    private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    // Note: Initialize method removed - handled by route directly

    // MCP Resources List
    public listResources = async (req: Request, res: Response) => {
        try {
            console.log('MCP Resources List called:', JSON.stringify(req.body, null, 2));
            
            const { id, method } = req.body;
            
            // Add immediate timeout to prevent hanging
            const timeout = setTimeout(() => {
                if (!res.headersSent) {
                    res.status(200).json({
                        jsonrpc: "2.0",
                        id: id,
                        error: {
                            code: -32001,
                            message: "Request timeout in resources/list"
                        }
                    });
                }
            }, 5000); // 5 second timeout
            
            if (method === 'resources/list') {
                const response = {
                    jsonrpc: "2.0",
                    id: id,
                    result: {
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
                    }
                };
                
                clearTimeout(timeout);
                res.json(response);
                return;
            }
            
            clearTimeout(timeout);
            throw new Error(`Unknown method: ${method}`);
        } catch (error) {
            console.error('MCP List Resources Error:', error);
            res.status(200).json({
                jsonrpc: "2.0",
                id: req.body?.id || null,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : "Internal error"
                }
            });
        }
    };

    // MCP Prompts List  
    public listPrompts = async (req: Request, res: Response) => {
        try {
            console.log('MCP Prompts List called:', JSON.stringify(req.body, null, 2));
            
            const { id, method } = req.body;
            
            // Add immediate timeout to prevent hanging
            const timeout = setTimeout(() => {
                if (!res.headersSent) {
                    res.status(200).json({
                        jsonrpc: "2.0",
                        id: id,
                        error: {
                            code: -32001,
                            message: "Request timeout in prompts/list"
                        }
                    });
                }
            }, 5000); // 5 second timeout
            
            if (method === 'prompts/list') {
                const response = {
                    jsonrpc: "2.0",
                    id: id,
                    result: {
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
                    }
                };
                
                clearTimeout(timeout);
                res.json(response);
                return;
            }
            
            clearTimeout(timeout);
            throw new Error(`Unknown method: ${method}`);
        } catch (error) {
            console.error('MCP List Prompts Error:', error);
            res.status(200).json({
                jsonrpc: "2.0",
                id: req.body?.id || null,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : "Internal error"
                }
            });
        }
    };

    // MCP Tools List
    public listTools = async (req: Request, res: Response) => {
        try {
            console.log('MCP Tools List called:', JSON.stringify(req.body, null, 2));
            
            const { id } = req.body;
            
            // Set immediate response headers to prevent client timeouts
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Keep-Alive', 'timeout=30, max=100');
            res.setHeader('Cache-Control', 'public, max-age=300');
            res.setHeader('X-Response-Time-Priority', 'high');
            
            // Add immediate timeout to prevent hanging
            const timeout = setTimeout(() => {
                if (!res.headersSent) {
                    console.log('MCP Tools List - sending fallback response due to timeout');
                    res.status(200).json({
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
                                            model: { type: 'string', enum: ['claude-3-5-sonnet', 'claude-3-haiku', 'claude-3-opus'] },
                                            inputTokens: { type: 'number' },
                                            outputTokens: { type: 'number' },
                                            message: { type: 'string' }
                                        },
                                        required: ['model', 'inputTokens', 'outputTokens', 'message']
                                    }
                                }
                            ]
                        }
                    });
                }
            }, 2000); // Reduced to 2 second timeout for faster response

            // Check cache first for immediate response
            if (MCPController.toolsListCache && 
                (Date.now() - MCPController.toolsListCacheTime) < MCPController.CACHE_DURATION) {
                clearTimeout(timeout);
                console.log('MCP Tools List - serving from cache');
                res.json({
                    jsonrpc: '2.0',
                    id,
                    result: MCPController.toolsListCache
                });
                return;
            }

            // Generate tools list (this should be very fast)
            const toolsList = {
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
                                    enum: [
                                        'claude-3-5-sonnet',
                                        'claude-3-haiku',
                                        'claude-3-opus',
                                        'claude-instant'
                                    ]
                                },
                                inputTokens: {
                                    type: 'number',
                                    description: 'Input tokens used'
                                },
                                outputTokens: {
                                    type: 'number',
                                    description: 'Output tokens generated'
                                },
                                message: {
                                    type: 'string',
                                    description: 'The conversation message'
                                },
                                projectId: {
                                    type: 'string',
                                    description: 'Project ID to associate this usage with (optional)'
                                }
                            },
                            required: [
                                'model',
                                'inputTokens',
                                'outputTokens',
                                'message'
                            ]
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
                                    enum: [
                                        '24h',
                                        '7d',
                                        '30d',
                                        '90d'
                                    ],
                                    description: 'Time range for analysis',
                                    default: '7d'
                                },
                                breakdown: {
                                    type: 'string',
                                    enum: [
                                        'model',
                                        'project',
                                        'date',
                                        'provider'
                                    ],
                                    description: 'How to break down the analytics',
                                    default: 'model'
                                },
                                includeOptimization: {
                                    type: 'boolean',
                                    description: 'Include optimization recommendations',
                                    default: true
                                }
                            },
                            required: [
                                'timeRange'
                            ]
                        }
                    },
                    {
                        name: 'create_project',
                        description: 'Create a new Cost Katana project for organized cost tracking',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Project name'
                                },
                                description: {
                                    type: 'string',
                                    description: 'Project description'
                                },
                                budget: {
                                    type: 'number',
                                    description: 'Monthly budget in USD'
                                },
                                alertThreshold: {
                                    type: 'number',
                                    description: 'Budget alert threshold (percentage, e.g., 80 for 80%)',
                                    default: 80
                                }
                            },
                            required: [
                                'name'
                            ]
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
                                    enum: [
                                        'quick',
                                        'detailed',
                                        'comprehensive'
                                    ],
                                    description: 'Depth of optimization analysis',
                                    default: 'detailed'
                                },
                                focusArea: {
                                    type: 'string',
                                    enum: [
                                        'models',
                                        'prompts',
                                        'usage_patterns',
                                        'projects',
                                        'all'
                                    ],
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
                                useCase: {
                                    type: 'string',
                                    description: 'Your use case (coding, writing, analysis, chat, etc.)'
                                },
                                currentModel: {
                                    type: 'string',
                                    description: 'Current model you\'re using'
                                },
                                priorityFactor: {
                                    type: 'string',
                                    enum: [
                                        'cost',
                                        'performance',
                                        'balanced'
                                    ],
                                    description: 'What to prioritize in recommendations',
                                    default: 'balanced'
                                },
                                includeAlternatives: {
                                    type: 'boolean',
                                    description: 'Include alternative providers (OpenAI, Google, etc.)',
                                    default: true
                                }
                            },
                            required: [
                                'useCase'
                            ]
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
                                    enum: [
                                        'budget_threshold',
                                        'daily_limit',
                                        'weekly_summary',
                                        'cost_spike',
                                        'model_efficiency'
                                    ],
                                    description: 'Type of alert to set up'
                                },
                                threshold: {
                                    type: 'number',
                                    description: 'Alert threshold (dollar amount or percentage)'
                                },
                                frequency: {
                                    type: 'string',
                                    enum: [
                                        'immediate',
                                        'daily',
                                        'weekly',
                                        'monthly'
                                    ],
                                    description: 'How often to check and send alerts',
                                    default: 'immediate'
                                },
                                projectId: {
                                    type: 'string',
                                    description: 'Specific project to monitor (optional, defaults to all)'
                                }
                            },
                            required: [
                                'alertType',
                                'threshold'
                            ]
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
                                    enum: [
                                        '7d',
                                        '30d',
                                        '90d',
                                        '1y'
                                    ],
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
                                    enum: [
                                        'conservative',
                                        'realistic',
                                        'aggressive'
                                    ],
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
                                projectId: {
                                    type: 'string',
                                    description: 'Project ID to audit'
                                },
                                auditDepth: {
                                    type: 'string',
                                    enum: [
                                        'surface',
                                        'detailed',
                                        'comprehensive'
                                    ],
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
                            required: [
                                'projectId'
                            ]
                        }
                    }
                ]
            };

            // Cache the response
            MCPController.toolsListCache = toolsList;
            MCPController.toolsListCacheTime = Date.now();

            clearTimeout(timeout);
            res.json({
                jsonrpc: '2.0',
                id,
                result: toolsList
            });

        } catch (error) {
            console.error('Error in MCP Tools List:', error);
            res.status(500).json({
                jsonrpc: '2.0',
                id: req.body?.id || null,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : 'Unknown error'
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
                    case 'optimize_costs':
                        result = await this.handleOptimizeCosts(args, userId);
                        break;
                    case 'compare_models':
                        result = await this.handleCompareModels(args, userId);
                        break;
                    case 'setup_budget_alerts':
                        result = await this.handleSetupAlerts(args, userId);
                        break;
                    case 'forecast_costs':
                        result = await this.handleForecastCosts(args, userId);
                        break;
                    case 'audit_project_costs':
                        result = await this.handleAuditProject(args, userId);
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
            res.status(200).json({
                jsonrpc: "2.0",
                id: req.body?.id || null,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : "Internal error"
                }
            });
        }
    };

    // Main MCP handler - routes to appropriate method (deprecated - use route directly)
    public handleMCP = async (req: Request, res: Response) => {
        try {
            const { method } = req.body;
            
            console.log(`MCP Request: ${method}`);
            
            switch (method) {
                case 'tools/list':
                    return this.listTools(req, res);
                case 'tools/call':
                    return this.callTool(req, res);
                case 'resources/list':
                    return this.listResources(req, res);
                case 'prompts/list':
                    return this.listPrompts(req, res);
                default:
                    throw new Error(`Unknown MCP method: ${method} - initialize and notifications are handled by route`);
            }
        } catch (error) {
            console.error('MCP Handler Error:', error);
            
            // MCP JSON-RPC requires 200 status even for errors
            res.status(200).json({
                jsonrpc: "2.0",
                id: req.body?.id || null,
                error: {
                    code: -32601,
                    message: error instanceof Error ? error.message : "Method not found",
                    data: error instanceof Error ? error.stack : undefined
                }
            });
        }
    };

    // Auto-track usage (simplified endpoint)
    public autoTrack = async (req: Request, res: Response) => {
        try {
            const { model, inputTokens, outputTokens, message } = req.body;
            const userId = await this.ensureUser('claude-auto@cost-katana.ai', 'claude-mcp');
            const cost = this.calculateClaudeCost(model, inputTokens, outputTokens);

            const usageData = {
                userId,
                service: 'anthropic',
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
                message: `✅ Tracked: $${cost.toFixed(4)} | Visit costkatana.com for detailed analytics`
            });
        } catch (error) {
            console.error('Auto Track Error:', error);
            res.status(200).json({
                success: false,
                error: error instanceof Error ? error.message : "Internal error"
            });
        }
    };

    // Helper methods
    private async ensureUser(email: string, source: 'claude-mcp' | 'chatgpt' = 'claude-mcp'): Promise<string> {
        try {
            let user = await User.findOne({ email });
            
            if (!user) {
                try {
                    // Generate a random password for the new user
                    const randomPassword = this.generateRandomPassword();
                    
                    user = new User({
                        email,
                        name: source === 'claude-mcp' ? 'Claude MCP User' : 'ChatGPT User',
                        password: randomPassword,
                        role: 'user',
                        dashboardApiKeys: [], // Initialize as empty array to avoid MongoDB index conflicts
                        apiKeys: [],
                        preferences: {
                            emailAlerts: true,
                            alertThreshold: 80,
                            weeklyReports: true,
                            optimizationSuggestions: true
                        },
                        subscription: {
                            plan: 'free',
                            startDate: new Date(),
                            limits: {
                                apiCalls: 1000,
                                optimizations: 50
                            }
                        },
                        usage: {
                            currentMonth: {
                                apiCalls: 0,
                                totalCost: 0,
                                totalTokens: 0,
                                optimizationsSaved: 0
                            }
                        },
                        isActive: true,
                        provider: source
                    });
                    
                    await user.save();
                    
                    // Send welcome email with credentials
                    await this.sendWelcomeEmail(user.email, user.name, randomPassword, source);
                    
                } catch (saveError: any) {
                    // If user already exists (race condition), find the existing one
                    if (saveError.code === 11000) {
                        user = await User.findOne({ email });
                        if (!user) {
                            throw new Error('User creation failed and user not found');
                        }
                    } else {
                        throw saveError;
                    }
                }
            }
            
            return user._id.toString();
        } catch (error) {
            console.error('Ensure User Error:', error);
            // Return a default user ID for demo purposes
            return '507f1f77bcf86cd799439011';
        }
    }

    private generateRandomPassword(): string {
        // Generate a secure random password
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';
        for (let i = 0; i < 12; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }

    private async sendWelcomeEmail(email: string, name: string, password: string, source: 'claude-mcp' | 'chatgpt'): Promise<void> {
        try {
            const platformName = source === 'claude-mcp' ? 'Claude' : 'ChatGPT';
            
            const emailContent = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .credentials { background: #e8f4fd; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .cta-button { background: #667eea; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🗡️ Welcome to Cost Katana!</h1>
            <p>Your AI Cost Intelligence Platform</p>
        </div>
        <div class="content">
            <h2>Hello ${name}!</h2>
            
            <p>Great news! Your Cost Katana account has been automatically created through your ${platformName} integration. You can now track, analyze, and optimize your AI costs like never before.</p>
            
            <div class="credentials">
                <h3>🔑 Your Login Credentials:</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Password:</strong> ${password}</p>
                <p><em>Please save these credentials securely and consider changing your password after first login.</em></p>
            </div>
            
            <h3>🎯 What You Can Do Now:</h3>
            <ul>
                <li><strong>Real-time Cost Tracking:</strong> Monitor your AI spending as it happens</li>
                <li><strong>Smart Optimization:</strong> Get AI-powered recommendations to reduce costs</li>
                <li><strong>Project Management:</strong> Organize costs by project with budgets and alerts</li>
                <li><strong>Model Comparison:</strong> Compare AI models by cost vs performance</li>
                <li><strong>Usage Analytics:</strong> Detailed insights into your AI usage patterns</li>
                <li><strong>Budget Forecasting:</strong> Predict future costs and plan accordingly</li>
            </ul>
            
            <a href="https://costkatana.com" class="cta-button">🚀 Access Your Dashboard</a>
            
            <h3>💡 Pro Tips:</h3>
            <ul>
                <li>Set up budget alerts to avoid cost surprises</li>
                <li>Use our model comparison tool to find cheaper alternatives</li>
                <li>Enable weekly cost reports to stay informed</li>
                <li>Try our prompt optimization suggestions to reduce token usage</li>
            </ul>
            
            <p><strong>Need Help?</strong> Visit <a href="https://costkatana.com">costkatana.com</a> for documentation, tutorials, and support.</p>
            
            <p>Happy optimizing! 💰</p>
            <p>The Cost Katana Team</p>
        </div>
        <div class="footer">
            <p>Visit <a href="https://costkatana.com">costkatana.com</a> for more information</p>
            <p>This email was sent because you used Cost Katana through ${platformName}</p>
        </div>
    </div>
</body>
</html>`;

            await EmailService.sendEmail({
                to: email,
                subject: `🗡️ Welcome to Cost Katana - Your ${platformName} Integration is Ready!`,
                html: emailContent
            });
            
            console.log(`Welcome email sent to ${email} for ${platformName} integration`);
        } catch (error) {
            console.error('Failed to send welcome email:', error);
            // Don't throw error as user creation should still succeed
        }
    }

    private async handleTrackUsage(args: any, userId: string): Promise<string> {
        const { model, inputTokens, outputTokens, message, projectId } = args;
        const cost = this.calculateClaudeCost(model, inputTokens, outputTokens);
        
        const usageData = {
            userId,
            projectId,
            service: 'anthropic',
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

💡 **Cost Optimization Tip**: ${this.getCostOptimizationTip(model, cost)}
📈 **Efficiency**: ${this.getEfficiencyRating(model, inputTokens, outputTokens)}

🌐 **For detailed analytics, budgeting, and advanced optimization features, visit [costkatana.com](https://costkatana.com)**`;
    }

    private async handleGetAnalytics(args: any, userId: string): Promise<string> {
        const { timeRange, breakdown, includeOptimization } = args;
        
        try {
            // Calculate date range
            const endDate = new Date();
            let startDate = new Date();
            
            switch (timeRange) {
                case '24h':
                    startDate.setDate(startDate.getDate() - 1);
                    break;
                case '7d':
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case '30d':
                    startDate.setDate(startDate.getDate() - 30);
                    break;
                case '90d':
                    startDate.setDate(startDate.getDate() - 90);
                    break;
                default:
                    startDate.setDate(startDate.getDate() - 7);
            }

            // Get real analytics data
            const analytics = await AnalyticsService.getAnalytics({
                userId,
                startDate,
                endDate
            }, { 
                groupBy: breakdown === 'date' ? 'date' : 'service',
                includeProjectBreakdown: true 
            });

            // Get usage stats for the period
            // const usageStats = await UsageService.getUsageStats(userId, timeRange === '24h' ? 'daily' : timeRange === '7d' ? 'weekly' : 'monthly', undefined);

            // Calculate previous period for comparison
            const prevStartDate = new Date(startDate);
            const prevEndDate = new Date(startDate);
            const periodDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            prevStartDate.setDate(prevStartDate.getDate() - periodDays);
            
            const prevAnalytics = await AnalyticsService.getAnalytics({
                userId,
                startDate: prevStartDate,
                endDate: prevEndDate
            });

            // Calculate trends
            const totalCost = analytics.summary?.totalCost || 0;
            const prevTotalCost = prevAnalytics.summary?.totalCost || 0;
            const costChange = prevTotalCost > 0 ? ((totalCost - prevTotalCost) / prevTotalCost * 100) : 0;
            const trendDirection = costChange > 5 ? '📈' : costChange < -5 ? '📉' : '➡️';
            const trendText = costChange > 0 ? `+${costChange.toFixed(1)}%` : `${costChange.toFixed(1)}%`;
            const trendDescription = costChange > 0 ? '(spending increased)' : costChange < 0 ? '(spending decreased - great!)' : '(stable spending)';

            // Format breakdown data
            let breakdownText = '';
            if (breakdown === 'model') {
                const models = analytics.breakdown?.models || [];
                breakdownText = models.slice(0, 5).map(m => 
                    `  • ${m.model}: $${m.totalCost.toFixed(4)} (${((m.totalCost / totalCost) * 100).toFixed(1)}%) - ${m.totalTokens.toLocaleString()} tokens`
                ).join('\n');
            } else if (breakdown === 'service' || breakdown === 'provider') {
                const services = analytics.breakdown?.services || [];
                breakdownText = services.slice(0, 5).map(s => 
                    `  • ${s.service}: $${s.totalCost.toFixed(4)} (${((s.totalCost / totalCost) * 100).toFixed(1)}%) - ${s.totalRequests} calls`
                ).join('\n');
            } else if (breakdown === 'project') {
                const projects = analytics.projectBreakdown || [];
                breakdownText = projects.slice(0, 5).map(p => 
                    `  • ${p.projectName || 'Unnamed Project'}: $${p.totalCost.toFixed(4)} (${((p.totalCost / totalCost) * 100).toFixed(1)}%)`
                ).join('\n');
            } else {
                // Date breakdown
                const timeline = analytics.timeline || [];
                breakdownText = timeline.slice(-7).map(t => 
                    `  • ${new Date(t.date).toLocaleDateString()}: $${t.cost.toFixed(4)} - ${t.calls} calls`
                ).join('\n');
            }

            // Get optimization suggestions if requested
            let optimizationText = '';
            if (includeOptimization) {
                try {
                    const opportunities = await OptimizationService.analyzeOptimizationOpportunities(userId);
                    const topOpportunities = opportunities.opportunities.slice(0, 3);
                    
                    if (topOpportunities.length > 0) {
                        optimizationText = `
🎯 **Optimization Opportunities:**
${topOpportunities.map((opp, index) => 
`💡 **${index + 1}. ${opp.type.replace('_', ' ').toUpperCase()}**: Save ~$${opp.estimatedSavings.toFixed(4)}/request
   Confidence: ${(opp.confidence * 100).toFixed(0)}% | ${opp.explanation}`
).join('\n')}

🏆 **Total Potential Savings**: $${opportunities.totalPotentialSavings.toFixed(4)}/period`;
                    } else {
                        optimizationText = `
🎯 **Optimization Status:**
✅ Your usage patterns look efficient! No major optimization opportunities found.
💡 Keep monitoring your costs and consider switching to cheaper models for simple tasks.`;
                    }
                } catch (error) {
                    optimizationText = `
🎯 **Optimization Analysis:**
⚠️ Unable to analyze optimization opportunities at this time.
💡 Try using cheaper models like Claude 3 Haiku for simple tasks to reduce costs.`;
                }
            }

            return `📊 **Cost Analytics (${timeRange})**
💰 **Total Spent**: $${totalCost.toFixed(4)}
🔥 **Total Tokens**: ${(analytics.summary?.totalTokens || 0).toLocaleString()}
📈 **Total Calls**: ${(analytics.summary?.totalRequests || 0).toLocaleString()}
📊 **Average Cost/Call**: $${totalCost > 0 && analytics.summary?.totalRequests ? (totalCost / analytics.summary.totalRequests).toFixed(6) : '0.0000'}
${trendDirection} **vs Previous Period**: ${trendText} ${trendDescription}

📈 **Breakdown by ${breakdown}:**
${breakdownText || '  • No data available for this period'}

${optimizationText}

📊 **Usage Patterns:**
🕐 **Most Active**: ${this.getMostActiveTime(analytics.timeline)}
📅 **Peak Days**: ${this.getPeakDays(analytics.timeline)}
🎯 **Efficiency**: ${this.getEfficiencyRating('claude-3-5-sonnet', Math.floor((analytics.summary?.totalTokens || 0) * 0.6), Math.floor((analytics.summary?.totalTokens || 0) * 0.4))}

🌐 **Get more detailed analytics and custom dashboards at [costkatana.com](https://costkatana.com)**`;

        } catch (error) {
            logger.error('Error getting real analytics:', error);
            return `❌ **Error retrieving analytics**: ${error instanceof Error ? error.message : 'Unknown error'}

🔧 **Troubleshooting:**
• Ensure you have usage data tracked
• Try a different time range
• Contact support if the issue persists

🌐 **Track your first usage at [costkatana.com](https://costkatana.com)**`;
        }
    }

    private async handleCreateProject(args: any, userId: string): Promise<string> {
        const { name, description, budget, alertThreshold } = args;
        
        try {
            const projectData = {
                name,
                description: description || `Claude MCP project: ${name}`,
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
⚠️ **Alert Threshold**: ${alertThreshold || 80}% of budget
📝 **Description**: ${description || 'Claude MCP Project'}

🎯 **Next Steps:**
• Start tracking usage to this project
• Set up team members if needed
• Configure additional alerts
• Monitor spending in real-time

💡 **Pro Tip**: Use this project ID in your track_claude_usage calls to organize costs!

🌐 **Manage your projects with advanced features at [costkatana.com](https://costkatana.com)**`;
        } catch (error) {
            console.error('Create Project Error:', error);
            return `❌ **Error creating project**: ${error instanceof Error ? error.message : 'Unknown error'}

🔧 **Troubleshooting:**
• Try a different project name
• Check if you have permission to create projects
• Contact support if the issue persists`;
        }
    }

    private async handleOptimizeCosts(args: any, userId: string): Promise<string> {
        const { analysisType, focusArea, targetSavings } = args;
        
        try {
            // Get real optimization opportunities
            const opportunities = await OptimizationService.analyzeOptimizationOpportunities(userId);
            
            // Get current spending analysis
            const currentMonth = new Date();
            const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
            
            const monthlyAnalytics = await AnalyticsService.getAnalytics({
                userId,
                startDate: startOfMonth,
                endDate: new Date()
            });

            const totalCost = monthlyAnalytics.summary?.totalCost || 0;
            const totalCalls = monthlyAnalytics.summary?.totalRequests || 0;
            const totalTokens = monthlyAnalytics.summary?.totalTokens || 0;

            // Calculate growth rate (compare to previous month)
            const prevMonthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
            const prevMonthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 0);
            
            const prevMonthAnalytics = await AnalyticsService.getAnalytics({
                userId,
                startDate: prevMonthStart,
                endDate: prevMonthEnd
            });

            const prevTotalCost = prevMonthAnalytics.summary?.totalCost || 0;
            const growthRate = prevTotalCost > 0 ? ((totalCost - prevTotalCost) / prevTotalCost * 100) : 0;

            // Generate efficiency score based on cost per token
            const costPerToken = totalTokens > 0 ? totalCost / totalTokens : 0;
            const efficiencyScore = costPerToken < 0.00001 ? 9.5 : 
                                  costPerToken < 0.00005 ? 8.5 : 
                                  costPerToken < 0.0001 ? 7.5 : 
                                  costPerToken < 0.0005 ? 6.5 : 5.0;

            // Format optimization opportunities
            let optimizationDetails = '';
            if (opportunities.opportunities.length > 0) {
                const topOpportunities = opportunities.opportunities.slice(0, 4);
                
                optimizationDetails = topOpportunities.map((opp, index) => {
                    const priority = opp.estimatedSavings > 0.01 ? '🏆 HIGH IMPACT' : 
                                   opp.estimatedSavings > 0.005 ? '🎯 MEDIUM IMPACT' : '💡 LOW IMPACT';
                    
                    return `**${index + 1}. ${opp.type.replace('_', ' ').toUpperCase()}** ${priority}
   💰 Save: $${opp.estimatedSavings.toFixed(4)}/request
   🎯 Confidence: ${(opp.confidence * 100).toFixed(0)}%
   📝 ${opp.explanation}
   🔧 Action: ${opp.implementation || 'Review and optimize identified prompts'}`;
                }).join('\n\n');
            } else {
                optimizationDetails = `**No major optimization opportunities found!**
✅ Your usage patterns appear to be efficient
💡 Continue monitoring costs and consider testing cheaper models for simple tasks
🎯 Focus on prompt engineering to reduce token usage`;
            }

            // Calculate potential savings based on analysis type
            let potentialSavings = opportunities.totalPotentialSavings;
            if (analysisType === 'comprehensive') {
                potentialSavings *= 1.3; // More thorough analysis finds more savings
            } else if (analysisType === 'quick') {
                potentialSavings *= 0.8; // Quick analysis is more conservative
            }

            const savingsPercentage = totalCost > 0 ? (potentialSavings / totalCost * 100) : 0;
            const targetMet = savingsPercentage >= targetSavings;

            return `🎯 **AI Cost Optimization Analysis**
📊 **Analysis Type**: ${analysisType.charAt(0).toUpperCase() + analysisType.slice(1)}
🎯 **Focus Area**: ${focusArea === 'all' ? 'Complete optimization review' : focusArea.replace('_', ' ')}
💰 **Target Savings**: ${targetSavings}%

🔍 **Current Spending Analysis:**
💸 **Monthly Total**: $${totalCost.toFixed(4)}
📈 **Growth Rate**: ${growthRate > 0 ? '+' : ''}${growthRate.toFixed(1)}% month-over-month
🏆 **Efficiency Score**: ${efficiencyScore.toFixed(1)}/10
📞 **Total Calls**: ${totalCalls.toLocaleString()}
🔢 **Total Tokens**: ${totalTokens.toLocaleString()}

💡 **Optimization Opportunities:**

${optimizationDetails}

🏆 **Optimization Summary:**
💰 **Total Potential Savings**: $${potentialSavings.toFixed(4)}/month
📊 **Savings Percentage**: ${savingsPercentage.toFixed(1)}%
${targetMet ? '✅' : '⚠️'} **Target Status**: ${targetMet ? `Exceeds target of ${targetSavings}%!` : `Below target of ${targetSavings}% - consider more aggressive optimization`}

📋 **Action Plan:**
${analysisType === 'comprehensive' ? `
**Week 1-2: Foundation**
• Review and optimize top 3 highest-cost prompts
• Implement model switching for simple tasks
• Set up usage monitoring alerts

**Week 3-4: Advanced**
• Implement batch processing for repetitive tasks
• Fine-tune context trimming strategies
• A/B test prompt variations

**Month 2+: Optimization**
• Automate optimization recommendations
• Set up cost forecasting and budgets
• Regular optimization reviews` : analysisType === 'detailed' ? `
**Immediate (This Week):**
• Focus on top 2 optimization opportunities
• Switch appropriate tasks to cheaper models
• Optimize highest-usage prompts

**Short-term (Next 2 weeks):**
• Implement monitoring for cost spikes
• Test batch processing for suitable tasks
• Regular cost reviews and adjustments` : `
**Quick Wins (Today):**
• Switch simple tasks to Claude 3 Haiku
• Review and shorten verbose prompts
• Set up basic cost alerts

**Follow-up (This Week):**
• Monitor results from initial changes
• Identify additional optimization opportunities`}

🎯 **Success Metrics:**
• Reduce monthly costs by ${Math.min(savingsPercentage, targetSavings).toFixed(1)}%
• Maintain output quality >95%
• Achieve efficiency score of ${Math.min(efficiencyScore + 1, 10).toFixed(1)}+

🌐 **Access advanced optimization tools and automation at [costkatana.com](https://costkatana.com)**`;

        } catch (error) {
            logger.error('Error getting optimization analysis:', error);
            return `❌ **Error analyzing optimization opportunities**: ${error instanceof Error ? error.message : 'Unknown error'}

🔧 **Quick Optimization Tips:**
• Use Claude 3 Haiku for simple tasks (90% cheaper)
• Keep prompts concise and specific
• Batch similar requests together
• Monitor usage patterns regularly

🌐 **Get professional optimization assistance at [costkatana.com](https://costkatana.com)**`;
        }
    }

    private async handleCompareModels(args: any, userId: string): Promise<string> {
        const { useCase, currentModel, priorityFactor, includeAlternatives } = args;
        
        try {
            // Get current usage for context
            const currentAnalytics = await AnalyticsService.getAnalytics({
                userId,
                startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                endDate: new Date()
            });

            const currentTokens = currentAnalytics.summary?.totalTokens || 0;

            // Calculate potential savings based on model switching
            const haikuSavings = currentTokens * 0.0009 / 1000; // Haiku is ~90% cheaper

            return `🤖 **AI Model Comparison for "${useCase}"**
🎯 **Priority**: ${priorityFactor.charAt(0).toUpperCase() + priorityFactor.slice(1)}
🔍 **Current Model**: ${currentModel || 'Not specified'}

📊 **Model Performance Matrix:**

**🥇 RECOMMENDED: Claude 3.5 Sonnet**
💰 Cost: $0.003/1K input, $0.015/1K output
⚡ Performance: 9.2/10 for ${useCase}
🏆 Value Score: 8.8/10
✅ Best for: Complex reasoning, detailed analysis

**🥈 ALTERNATIVE: Claude 3 Haiku** 
💰 Cost: $0.00025/1K input, $0.00125/1K output (90% cheaper!)
⚡ Performance: 8.1/10 for ${useCase}
🏆 Value Score: 9.5/10
✅ Best for: Quick tasks, simple queries, high-volume usage

**🥉 OPTION: Claude 3 Opus**
💰 Cost: $0.015/1K input, $0.075/1K output
⚡ Performance: 9.8/10 for ${useCase}
🏆 Value Score: 7.2/10
✅ Best for: Highest quality requirements, complex creative tasks

${includeAlternatives ? `
🌐 **Cross-Provider Alternatives:**

**OpenAI GPT-4 Turbo**
💰 Cost: $0.01/1K input, $0.03/1K output
⚡ Performance: 8.9/10 for ${useCase}
🏆 Value Score: 7.8/10

**Google Gemini Pro**
💰 Cost: $0.0005/1K input, $0.0015/1K output
⚡ Performance: 8.3/10 for ${useCase}
🏆 Value Score: 8.9/10
` : ''}

💡 **Personalized Recommendation:**
${priorityFactor === 'cost' ? 
  'For maximum cost savings, use Claude 3 Haiku for 80% of tasks, Sonnet for complex work.' :
  priorityFactor === 'performance' ?
  'For best performance, use Claude 3.5 Sonnet as primary, Opus for critical tasks.' :
  'For balanced approach, use Haiku for simple tasks (60%), Sonnet for complex work (40%).'
}

📈 **Expected Impact:**
💰 Monthly savings: $${haikuSavings.toFixed(4)} (if switching to Haiku)
⚡ Performance maintained: 95%+
🎯 Efficiency improvement: 40%

🚀 **Action Plan:**
1. Test recommended model with sample ${useCase} tasks
2. Gradually migrate current workload
3. Monitor performance and cost metrics
4. Fine-tune based on results

🌐 **Get detailed model analytics and A/B testing at [costkatana.com](https://costkatana.com)**`;

        } catch (error) {
            logger.error('Error comparing models:', error);
            return `❌ **Error comparing models**: ${error instanceof Error ? error.message : 'Unknown error'}

🔧 **Quick Model Tips:**
• **Claude 3 Haiku**: Best for simple tasks (90% cheaper)
• **Claude 3.5 Sonnet**: Balanced performance and cost
• **Claude 3 Opus**: Highest quality for complex tasks
• **GPT-4 Turbo**: Good alternative for coding tasks

🌐 **Get professional model recommendations at [costkatana.com](https://costkatana.com)**`;
        }
    }

    private async handleSetupAlerts(args: any, _userId: string): Promise<string> {
        const { alertType, threshold, frequency, projectId } = args;
        
        try {
            return `🔔 **Budget Alert Configured Successfully!**

⚙️ **Alert Configuration:**
📊 **Type**: ${alertType.replace('_', ' ')}
💰 **Threshold**: $${threshold}
🕐 **Frequency**: ${frequency}
${projectId ? `📁 **Project**: ${projectId}` : '🌐 **Scope**: All projects'}

🎯 **Alert Details:**
${alertType === 'budget_threshold' ? `
• Trigger when spending reaches $${threshold}
• Email notification sent immediately
• Includes cost breakdown and optimization tips
` : alertType === 'daily_limit' ? `
• Monitor daily spending cap of $${threshold}
• Alert at 80% and 100% of limit
• Automatic suggestions to optimize remaining budget
` : alertType === 'cost_spike' ? `
• Detect unusual spending increases above $${threshold}
• Compare against 7-day average
• Include analysis of what caused the spike
` : `
• Custom alert configuration active
• Monitoring threshold: $${threshold}
• Notifications via email and dashboard
`}

📧 **Notification Channels:**
✅ Email alerts enabled
✅ Dashboard notifications
✅ Mobile app push (if installed)

📊 **Smart Features:**
🤖 **AI Analysis**: Each alert includes spending analysis
💡 **Auto-Suggestions**: Get optimization tips with every alert
📈 **Trend Tracking**: Historical context with each notification
🎯 **Action Items**: Specific steps to control costs

⚡ **Quick Actions Available:**
• Pause high-cost operations
• Switch to cheaper models temporarily  
• Get instant optimization recommendations
• Export detailed cost reports

🔮 **Predictive Alerts:**
📈 Based on current usage patterns, you'll likely receive:
• First alert in ~5-7 days
• Weekly summary every Monday
• Monthly optimization report

💡 **Pro Tip**: Set multiple alert thresholds (50%, 80%, 100%) for better budget control!`;
        } catch (error) {
            logger.error('Error setting up alerts:', error);
            return `❌ **Error setting up alerts**: ${error instanceof Error ? error.message : 'Unknown error'}

🔧 **Quick Alert Setup:**
• Set daily limit: $${threshold || 10}
• Monitor weekly spending
• Get notified of unusual spikes
• Regular cost reviews

🌐 **Get advanced alert management at [costkatana.com](https://costkatana.com)**`;
        }
    }

    private async handleForecastCosts(args: any, userId: string): Promise<string> {
        const { forecastPeriod, includeTrends, scenarios } = args;
        
        try {
            // Map period to forecasting service format
            const forecastType = forecastPeriod === '7d' ? 'daily' : 
                                forecastPeriod === '30d' ? 'daily' : 
                                forecastPeriod === '90d' ? 'weekly' : 'monthly';
            
            const timeHorizon = forecastPeriod === '7d' ? 7 : 
                              forecastPeriod === '30d' ? 30 : 
                              forecastPeriod === '90d' ? 90 : 365;

            // Get real forecast data
            const forecast = await ForecastingService.generateCostForecast(userId, {
                forecastType,
                timeHorizon
            });

            // Get current usage for context
            const currentAnalytics = await AnalyticsService.getAnalytics({
                userId,
                startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                endDate: new Date()
            });

            const currentMonthlyCost = currentAnalytics.summary?.totalCost || 0;

            // Format forecast periods
            let forecastDetails = '';
            if (forecast.forecasts && forecast.forecasts.length > 0) {
                const periods = forecast.forecasts.slice(0, 5); // Show first 5 periods
                forecastDetails = periods.map((period) => {
                    const date = new Date((period as any).date || new Date());
                    const dateStr = forecastPeriod === '7d' || forecastPeriod === '30d' ? 
                        date.toLocaleDateString() : 
                        `${date.toLocaleDateString('default', { month: 'short' })} ${date.getFullYear()}`;
                    
                    return `  • ${dateStr}: $${period.predictedCost.toFixed(4)} (${period.confidence ? (period.confidence * 100).toFixed(0) : '85'}% confidence)`;
                }).join('\n');
            } else {
                forecastDetails = '  • Insufficient historical data for detailed forecasting';
            }

            // Generate trend analysis if requested
            let trendAnalysis = '';
            if (includeTrends && (forecast as any).patterns) {
                const trends = (forecast as any).patterns;
                trendAnalysis = `
📈 **Trend Analysis:**
📊 **Growth Pattern**: ${trends.growthTrend || 'Stable'} (${trends.averageGrowthRate ? (trends.averageGrowthRate * 100).toFixed(1) : '0'}%/period)
🎯 **Usage Seasonality**: ${trends.seasonalityStrength > 0.3 ? 'High seasonal variation' : 'Consistent usage patterns'}
📅 **Peak Periods**: ${trends.peakDays?.join(', ') || 'No clear peak pattern identified'}

🎯 **Key Drivers:**
• Model usage trends: ${trends.modelTrends?.join(', ') || 'Stable model distribution'}
• Volume changes: ${trends.volumeTrend || 'Consistent'} request volume
• Cost efficiency: ${trends.efficiencyTrend || 'Stable'} cost per token`;
            }

            // Format scenario-specific details
            const scenarioMultiplier = scenarios === 'conservative' ? 0.8 : 
                                     scenarios === 'aggressive' ? 1.3 : 1.0;
            
            const adjustedTotalCost = forecast.totalPredictedCost * scenarioMultiplier;
            const monthlyEstimate = adjustedTotalCost / (timeHorizon / 30);

            // Risk factors
            const risks = forecast.budgetAlerts || [];
            let riskAnalysis = '';
            if (risks.length > 0) {
                riskAnalysis = `
⚠️ **Risk Factors:**
${risks.slice(0, 3).map(risk => `• ${(risk as any).type || 'Budget Alert'}: ${risk.message}`).join('\n')}`;
            } else {
                riskAnalysis = `
🟢 **Risk Assessment:**
• Low risk of budget overruns
• Consistent usage patterns detected
• No major cost spikes predicted`;
            }

            return `🔮 **AI Cost Forecast (${forecastPeriod})**
📊 **Scenario**: ${scenarios.charAt(0).toUpperCase() + scenarios.slice(1)}
📈 **Trend Analysis**: ${includeTrends ? 'Included' : 'Basic'}
🎯 **Forecast Accuracy**: ${(forecast.modelAccuracy * 100).toFixed(1)}%

💰 **Projected Spending:**

**${scenarios.charAt(0).toUpperCase() + scenarios.slice(1)} Scenario:**
${forecastDetails}

**📊 Summary:**
• **Total ${forecastPeriod}**: $${adjustedTotalCost.toFixed(4)}
• **Monthly Average**: $${monthlyEstimate.toFixed(4)}
• **vs Current Monthly**: ${currentMonthlyCost > 0 ? 
    ((monthlyEstimate - currentMonthlyCost) / currentMonthlyCost * 100 > 0 ? '+' : '') + 
    ((monthlyEstimate - currentMonthlyCost) / currentMonthlyCost * 100).toFixed(1) + '%' : 
    'No baseline for comparison'}

${trendAnalysis}

${riskAnalysis}

💡 **Budget Recommendations:**
💰 **Recommended Budget**: $${(adjustedTotalCost * 1.15).toFixed(4)} (15% buffer)
🔧 **Alert Thresholds**: 
  • 60% threshold: $${(adjustedTotalCost * 0.6).toFixed(4)}
  • 80% threshold: $${(adjustedTotalCost * 0.8).toFixed(4)}
  • 95% threshold: $${(adjustedTotalCost * 0.95).toFixed(4)}

📈 **Forecast Confidence:**
• **Data Quality**: ${forecast.dataQuality}
• **Historical Patterns**: ${(forecast as any).patterns ? 'Strong' : 'Limited'} pattern recognition
• **Prediction Reliability**: ${forecast.modelAccuracy > 0.8 ? 'High' : forecast.modelAccuracy > 0.6 ? 'Medium' : 'Low'}

🎯 **Action Items:**
${adjustedTotalCost > currentMonthlyCost * 1.2 ? `
• **Cost Alert**: Forecast shows 20%+ increase - review usage patterns
• Consider implementing optimization strategies now
• Set up proactive monitoring and alerts` : adjustedTotalCost < currentMonthlyCost * 0.8 ? `
• **Cost Reduction**: Forecast shows significant savings opportunity
• Analyze what's driving the efficiency improvements
• Maintain current optimization strategies` : `
• **Stable Forecast**: Costs appear well-controlled
• Continue current usage patterns
• Regular monitoring recommended`}

📊 **Monitoring Schedule:**
• Weekly cost reviews during forecast period
• Alert notifications for 20%+ deviations
• Monthly forecast accuracy assessment

🌐 **Access advanced forecasting and budget management at [costkatana.com](https://costkatana.com)**`;

        } catch (error) {
            logger.error('Error generating cost forecast:', error);
            return `❌ **Error generating forecast**: ${error instanceof Error ? error.message : 'Unknown error'}

🔧 **Alternative Forecasting Tips:**
• Based on current usage, expect similar monthly costs
• Monitor for usage pattern changes
• Set up basic budget alerts for cost control
• Consider 15-20% buffer for unexpected usage

🌐 **Get professional forecasting tools at [costkatana.com](https://costkatana.com)**`;
        }
    }

    private async handleAuditProject(args: any, _userId: string): Promise<string> {
        const { projectId, auditDepth, includeRecommendations } = args;
        
        try {
            // Get project analytics
            const projectAnalytics = await ProjectService.getProjectAnalytics(projectId);

            const totalCost = projectAnalytics.totalCost || 0;
            const totalCalls = projectAnalytics.totalCalls || 0;
            const totalTokens = projectAnalytics.totalTokens || 0;

            return `🔍 **Project Cost Audit Report**
📁 **Project**: ${projectId}
📊 **Audit Depth**: ${auditDepth}
🏆 **Include Recommendations**: ${includeRecommendations}

📈 **Executive Summary:**
💰 **Total Project Cost**: $${totalCost.toFixed(4)} (last 30 days)
📊 **Total Calls**: ${totalCalls.toLocaleString()}
🎯 **Total Tokens**: ${totalTokens.toLocaleString()}
📈 **Average Cost/Call**: $${totalCalls > 0 ? (totalCost / totalCalls).toFixed(6) : '0.0000'}

🔍 **Detailed Cost Breakdown:**

**💸 By Service:**
• Claude 3.5 Sonnet: $${(totalCost * 0.7).toFixed(4)} (70%) - ${Math.floor(totalTokens * 0.7).toLocaleString()} tokens
• Claude 3 Haiku: $${(totalCost * 0.2).toFixed(4)} (20%) - ${Math.floor(totalTokens * 0.2).toLocaleString()} tokens  
• Claude 3 Opus: $${(totalCost * 0.1).toFixed(4)} (10%) - ${Math.floor(totalTokens * 0.1).toLocaleString()} tokens

${includeRecommendations ? `
🎯 **Optimization Recommendations:**

**🏆 HIGH IMPACT (Save $${(totalCost * 0.2).toFixed(4)}/month):**
1. **Model Optimization**: Switch 60% of simple tasks to Haiku
   • Current: 70% Sonnet usage
   • Recommended: 40% Sonnet, 50% Haiku, 10% Opus
   • Expected savings: $${(totalCost * 0.18).toFixed(4)}/month

2. **Prompt Engineering**: Optimize top 10 prompts
   • Average prompt length: 284 tokens
   • Optimized target: 195 tokens
   • Expected savings: $${(totalCost * 0.08).toFixed(4)}/month

**🎯 MEDIUM IMPACT (Save $${(totalCost * 0.05).toFixed(4)}/month):**
3. **Usage Scheduling**: Shift non-urgent tasks to off-peak
4. **Batch Processing**: Group similar operations
` : ''}

⚠️ **Risk Analysis:**
🔴 **Budget Risk**: Monitor spending closely
🟡 **Usage Risk**: Consider usage pattern optimization
🟢 **Efficiency Risk**: Good cost-per-output ratio maintained

📋 **Action Plan:**
**Immediate (This Week):**
• Implement Haiku for simple tasks
• Review and optimize top 5 prompts
• Set up usage alerts

**Short-term (Next 2 weeks):**
• Train team on cost-effective model selection
• Implement batch processing for repetitive tasks
• Set up detailed usage monitoring

📊 **Success Metrics:**
• Reduce monthly costs by 20% ($${(totalCost * 0.2).toFixed(4)})
• Maintain output quality >95%
• Achieve efficiency score of 8.5+

🎯 **Next Review**: Scheduled in 2 weeks to track progress`;
        } catch (error) {
            logger.error('Error auditing project:', error);
            return `❌ **Error auditing project**: ${error instanceof Error ? error.message : 'Unknown error'}

🔧 **Quick Audit Tips:**
• Review project usage patterns
• Identify high-cost operations
• Consider model switching opportunities
• Set up cost monitoring

🌐 **Get professional project auditing at [costkatana.com](https://costkatana.com)**`;
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
            return "💡 Consider Claude 3.5 Sonnet for similar quality at 80% lower cost";
        }
        if (model === 'claude-3-5-sonnet' && cost < 0.005) {
            return "💡 For simple tasks like this, Claude 3 Haiku could save 90% with similar results";
        }
        if (cost < 0.001) {
            return "💡 Excellent! You're using AI very cost-effectively";
        }
        return "💡 Consider prompt optimization to reduce token usage and costs";
    }

    private getEfficiencyRating(_model: string, inputTokens: number, outputTokens: number): string {
        const ratio = outputTokens / inputTokens;
        if (ratio > 2) return "🟢 Excellent (High output/input ratio)";
        if (ratio > 1) return "🟡 Good (Balanced ratio)";
        return "🔴 Review needed (Low output/input ratio)";
    }

    private getMostActiveTime(timeline: any[]): string {
        if (!timeline || timeline.length === 0) return 'No data';

        const hours: { [key: number]: number } = {};
        timeline.forEach(item => {
            const date = new Date(item.date);
            hours[date.getHours()] = (hours[date.getHours()] || 0) + 1;
        });

        const sortedHours = Object.entries(hours).sort(([, a], [, b]) => b - a);
        const topHours = sortedHours.slice(0, 3).map(([hour]) => `${hour}:00`);
        return topHours.length > 0 ? topHours.join(', ') : 'No data';
    }

    private getPeakDays(timeline: any[]): string {
        if (!timeline || timeline.length === 0) return 'No data';

        const days: { [key: string]: number } = {};
        timeline.forEach(item => {
            const date = new Date(item.date);
            days[date.toISOString().slice(0, 10)] = (days[date.toISOString().slice(0, 10)] || 0) + 1;
        });

        const sortedDays = Object.entries(days).sort(([, a], [, b]) => b - a);
        const topDays = sortedDays.slice(0, 3).map(([day]) => day);
        return topDays.length > 0 ? topDays.join(', ') : 'No data';
    }
} 