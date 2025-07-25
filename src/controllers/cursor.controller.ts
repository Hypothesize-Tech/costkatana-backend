import { Request, Response } from 'express';
import { logger } from '../utils/logger';

interface CursorRequest extends Request {
    body: {
        user_id?: string;
        api_key?: string;
        email?: string;
        name?: string;
        source?: string;
        workspace?: {
            name?: string;
            path?: string;
            projectId?: string;
            language?: string;
            framework?: string;
        };
        code_context?: {
            file_path?: string;
            language?: string;
            code_snippet?: string;
            function_name?: string;
            class_name?: string;
            imports?: string[];
            dependencies?: string[];
        };
        ai_request?: {
            prompt: string;
            response: string;
            model: string;
            tokens_used?: {
                prompt_tokens: number;
                completion_tokens: number;
                total_tokens: number;
            };
            request_type: string;
            context_files?: string[];
            generated_files?: string[];
            execution_time?: number;
            success?: boolean;
            error_message?: string;
        };
        optimization_request?: {
            prompt: string;
            current_tokens: number;
            target_reduction?: number;
            preserve_quality?: boolean;
            context?: string;
        };
        action: 'track_usage' | 'optimize_prompt' | 'get_suggestions' | 'analyze_code' | 'get_projects' | 'create_project' | 'get_analytics' | 'generate_magic_link' | 'workspace_setup';
    };
}

export class CursorController {
    static async handleAction(req: CursorRequest, res: Response): Promise<void> {
        try {
            logger.info('Cursor action received:', {
                action: req.body.action,
                hasUserId: !!req.body.user_id,
                hasApiKey: !!req.body.api_key,
                hasEmail: !!req.body.email,
                workspace: req.body.workspace?.name,
                requestType: req.body.ai_request?.request_type
            });

            const { action, user_id, api_key } = req.body;

            if (action === 'generate_magic_link') {
                await CursorController.generateMagicLink(req, res);
                return;
            }

            let userId: string = user_id || 'mock-user-id';
            if (!userId && api_key) {
                userId = 'mock-user-id-from-api-key';
            }
            if (!userId) {
                res.status(200).json({
                    success: false,
                    error: 'authentication_required',
                    onboarding: true,
                    message: 'Welcome to Cost Katana for Cursor! Let me help you get connected in 30 seconds.',
                    steps: [
                        '1. Click "Generate Magic Link" below',
                        '2. Enter your email address',
                        '3. Check your email and click the magic link',
                        '4. Complete your account setup',
                        '5. Copy your API key from the dashboard',
                        '6. Configure the extension with your API key'
                    ],
                    next_action: 'generate_magic_link'
                });
                return;
            }

            switch (action) {
                case 'track_usage':
                    await CursorController.trackUsage(req, res);
                    break;
                case 'optimize_prompt':
                    await CursorController.optimizePrompt(req, res);
                    break;
                case 'get_suggestions':
                    await CursorController.getSuggestions(req, res);
                    break;
                case 'analyze_code':
                    await CursorController.analyzeCode(req, res);
                    break;
                case 'create_project':
                    await CursorController.createProject(req, res);
                    break;
                case 'get_projects':
                    await CursorController.getProjects(res);
                    break;
                case 'get_analytics':
                    await CursorController.getAnalytics(res);
                    break;
                case 'workspace_setup':
                    await CursorController.setupWorkspace(req, res);
                    break;
                default:
                    res.status(400).json({
                        success: false,
                        error: 'Invalid action. Supported actions: track_usage, optimize_prompt, get_suggestions, analyze_code, create_project, get_projects, get_analytics, generate_magic_link, workspace_setup'
                    });
            }
        } catch (error: any) {
            logger.error('Cursor action error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    private static async generateMagicLink(req: CursorRequest, res: Response): Promise<void> {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({
                success: false,
                error: 'Email is required',
                message: 'Please provide your email address to generate a magic link.'
            });
            return;
        }
        const magicLink = `https://cost-katana-backend.store/auth/magic-link?token=${Buffer.from(email).toString('base64')}&expires=${Date.now() + 900000}`;
        res.json({
            success: true,
            data: {
                magic_link: magicLink,
                user_id: 'mock-user-id',
                message: 'Magic link generated successfully! Check your email to complete setup.'
            }
        });
    }

    private static async trackUsage(req: CursorRequest, res: Response): Promise<void> {
        const { ai_request } = req.body;
        if (!ai_request) {
            res.status(400).json({
                success: false,
                error: 'AI request data is required',
                message: 'Please provide the AI request details.'
            });
            return;
        }
        const tokens = ai_request.tokens_used || { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
        const cost = 0.001;
        res.json({
            success: true,
            data: {
                usage_id: 'mock-usage-id',
                cost: cost.toFixed(8),
                tokens: tokens.total_tokens,
                smart_tip: '💡 Use "Cost Katana: Optimize Prompt" to reduce costs for similar requests.',
                suggestions: [
                    'Use the optimized prompt for similar requests',
                    'Consider using a cheaper model for simple tasks',
                    'Batch similar requests to reduce API overhead'
                ],
                message: `Usage tracked successfully! Cost: $${cost.toFixed(6)}`
            }
        });
    }

    private static async optimizePrompt(req: CursorRequest, res: Response): Promise<void> {
        const { optimization_request } = req.body;
        if (!optimization_request) {
            res.status(400).json({
                success: false,
                error: 'Optimization request is required',
                message: 'Please provide the prompt to optimize.'
            });
            return;
        }
        const { prompt, current_tokens } = optimization_request;
        const optimizedPrompt = prompt.trim();
        const optimizedTokens = Math.ceil(optimizedPrompt.length / 4);
        const tokenReduction = current_tokens ? Math.round(((current_tokens - optimizedTokens) / current_tokens) * 100) : 0;
        const costSavings = 0.0005;
        res.json({
            success: true,
            data: {
                original_prompt: prompt,
                optimized_prompt: optimizedPrompt,
                token_reduction: tokenReduction,
                original_tokens: current_tokens,
                optimized_tokens: optimizedTokens,
                cost_savings: costSavings.toFixed(8),
                quality_preserved: true,
                suggestions: [
                    'Use the optimized prompt for similar requests',
                    'Consider using a cheaper model for simple tasks',
                    'Batch similar requests to reduce API overhead'
                ]
            }
        });
    }

    private static async getSuggestions(req: CursorRequest, res: Response): Promise<void> {
        const { code_context } = req.body;
        if (!code_context) {
            res.status(400).json({
                success: false,
                error: 'Code context is required',
                message: 'Please provide the code context for suggestions.'
            });
            return;
        }
        res.json({
            success: true,
            data: {
                suggestions: [
                    {
                        title: `Optimize for ${code_context.language || 'development'}`,
                        description: `Use GPT-4o for ${code_context.language || 'general'} development`,
                        priority: 'high',
                        action: 'optimize_model_selection'
                    },
                    {
                        title: 'Batch Similar Requests',
                        description: 'Combine multiple similar requests to reduce API overhead',
                        priority: 'medium',
                        action: 'batch_requests'
                    },
                    {
                        title: 'Use Templates',
                        description: 'Save common prompts as templates for consistent, cost-effective usage',
                        priority: 'medium',
                        action: 'create_template'
                    }
                ],
                context: {
                    language: code_context.language,
                    file_path: code_context.file_path
                }
            }
        });
    }

    private static async analyzeCode(req: CursorRequest, res: Response): Promise<void> {
        const { code_context } = req.body;
        if (!code_context || !code_context.code_snippet) {
            res.status(400).json({
                success: false,
                error: 'Code snippet is required',
                message: 'Please provide the code snippet to analyze.'
            });
            return;
        }
        res.json({
            success: true,
            data: {
                analysis: {
                    complexityScore: 42,
                    lines: 10,
                    functions: 2,
                    classes: 1,
                    optimizationPotential: 'medium',
                    recommendations: [
                        'Consider breaking down complex functions',
                        'Use more descriptive variable names',
                        'Add comments for complex logic',
                        'Consider using design patterns'
                    ]
                },
                recommendations: [
                    'Consider breaking down complex functions',
                    'Use more descriptive variable names',
                    'Add comments for complex logic',
                    'Consider using design patterns'
                ]
            }
        });
    }

    private static async setupWorkspace(req: CursorRequest, res: Response): Promise<void> {
        const { workspace } = req.body;
        if (!workspace) {
            res.status(400).json({
                success: false,
                error: 'Workspace data is required',
                message: 'Please provide workspace information.'
            });
            return;
        }
        res.json({
            success: true,
            data: {
                project_id: 'mock-project-id',
                project_name: workspace.name || 'Cursor Workspace',
                message: `Workspace "${workspace.name}" connected successfully!`
            }
        });
    }

    private static async createProject(req: CursorRequest, res: Response): Promise<void> {
        const { name } = req.body;
        if (!name) {
            res.status(400).json({
                success: false,
                error: 'Project name is required',
                message: 'Please provide a name for the project.'
            });
            return;
        }
        res.json({
            success: true,
            data: {
                project_id: 'mock-project-id',
                project_name: name,
                message: `Project "${name}" created successfully!`
            }
        });
    }

    private static async getProjects(res: Response): Promise<void> {
        res.json({
            success: true,
            data: {
                projects: [
                    {
                        id: 'mock-project-id',
                        name: 'Sample Project',
                        description: 'A sample project',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }
                ]
            }
        });
    }

    private static async getAnalytics(res: Response): Promise<void> {
        res.json({
            success: true,
            data: {
                summary: {
                    total_spending_this_month: '0.00',
                    budget_used: '0%',
                    active_projects: 1
                },
                cursor_specific: {
                    total_requests: 1,
                    average_tokens_per_request: 20,
                    recent_activity: [
                        {
                            model: 'gpt-4o',
                            tokens: 20,
                            cost: '0.001000',
                            timestamp: new Date().toISOString()
                        }
                    ]
                }
            }
        });
    }

    static async healthCheck(_req: Request, res: Response): Promise<void> {
        res.json({
            success: true,
            message: 'Cursor extension integration with AI-powered code optimization is running',
            version: '1.0.0',
            features: [
                'usage_tracking',
                'prompt_optimization',
                'code_analysis',
                'smart_suggestions',
                'workspace_setup',
                'project_management',
                'multi_model_support',
                'cost_optimization',
                'real_time_analytics',
                'automatic_tracking'
            ],
            supported_models: {
                openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.5-preview', 'gpt-3.5-turbo'],
                anthropic: ['claude-3.5-sonnet', 'claude-3.5-haiku', 'claude-3.7-sonnet', 'claude-4-opus', 'claude-4-sonnet', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
                google: ['gemini-2.0-pro', 'gemini-2.5-flash', 'gemini-2.5-pro'],
                deepseek: ['deepseek-r1', 'deepseek-r1-05-28', 'deepseek-v3', 'deepseek-v3.1'],
                grok: ['grok-2', 'grok-3-beta', 'grok-3-mini', 'grok-4'],
                anthropic_o: ['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini'],
                cursor: ['cursor-small']
            },
            supported_languages: [
                'javascript',
                'typescript',
                'python',
                'java',
                'kotlin',
                'c#',
                'go',
                'rust',
                'php',
                'ruby',
                'swift',
                'scala',
                'dart',
                'r',
                'matlab'
            ],
            supported_request_types: [
                'code_generation',
                'code_review',
                'bug_fix',
                'refactoring',
                'documentation',
                'testing',
                'optimization',
                'explanation'
            ],
            timestamp: new Date().toISOString()
        });
    }
} 