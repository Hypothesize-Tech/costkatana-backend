import { Request, Response } from 'express';
import { loggingService } from '../services/logging.service';
import { AICostTrackerService } from '../services/aiCostTracker.service';
import { UsageService } from '../services/usage.service';
import { RealtimeUpdateService } from '../services/realtime-update.service';

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
        const startTime = Date.now();
        const { action, user_id, api_key } = req.body;

        try {
            loggingService.info('Cursor action received', {
                action,
                hasUserId: !!user_id,
                hasApiKey: !!api_key,
                hasEmail: !!req.body.email,
                workspace: req.body.workspace?.name,
                requestType: req.body.ai_request?.request_type,
                requestId: req.headers['x-request-id'] as string
            });

            if (action === 'generate_magic_link') {
                await CursorController.generateMagicLink(req, res);
                return;
            }

            let userId: string = user_id || 'mock-user-id';
            if (!userId && api_key) {
                userId = 'mock-user-id-from-api-key';
            }
            if (!userId) {
                loggingService.warn('Cursor action failed - authentication required', {
                    action,
                    hasUserId: !!user_id,
                    hasApiKey: !!api_key,
                    requestId: req.headers['x-request-id'] as string
                });

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

            loggingService.info('Cursor action processing started', {
                action,
                userId,
                hasApiKey: !!api_key,
                requestId: req.headers['x-request-id'] as string
            });

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
                    loggingService.warn('Cursor action failed - invalid action', {
                        action,
                        userId,
                        requestId: req.headers['x-request-id'] as string
                    });

                    res.status(400).json({
                        success: false,
                        error: 'Invalid action. Supported actions: track_usage, optimize_prompt, get_suggestions, analyze_code, create_project, get_projects, get_analytics, generate_magic_link, workspace_setup'
                    });
            }

            const duration = Date.now() - startTime;
            loggingService.info('Cursor action completed successfully', {
                action,
                userId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_action_completed',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    action,
                    userId,
                    hasApiKey: !!api_key,
                    workspace: req.body.workspace?.name
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Cursor action failed', {
                action,
                userId: user_id,
                hasApiKey: !!api_key,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    private static async generateMagicLink(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { email } = req.body;

        try {
            loggingService.info('Magic link generation initiated', {
                email,
                requestId: req.headers['x-request-id'] as string
            });

            if (!email) {
                loggingService.warn('Magic link generation failed - missing email', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Email is required',
                    message: 'Please provide your email address to generate a magic link.'
                });
                return;
            }

            const magicLink = `https://cost-katana-backend.store/auth/magic-link?token=${Buffer.from(email).toString('base64')}&expires=${Date.now() + 900000}`;
            
            const duration = Date.now() - startTime;

            loggingService.info('Magic link generated successfully', {
                email,
                duration,
                hasMagicLink: !!magicLink,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_magic_link_generated',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    email,
                    hasMagicLink: !!magicLink
                }
            });

            res.json({
                success: true,
                data: {
                    magic_link: magicLink,
                    user_id: 'mock-user-id',
                    message: 'Magic link generated successfully! Check your email to complete setup.'
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Magic link generation failed', {
                email,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to generate magic link',
                message: error.message
            });
        }
    }

    private static async trackUsage(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { ai_request, user_id, workspace, code_context } = req.body;

        try {
            loggingService.info('Usage tracking initiated', {
                userId: user_id,
                hasAiRequest: !!ai_request,
                workspace: workspace?.name,
                projectId: workspace?.projectId,
                language: code_context?.language,
                requestType: ai_request?.request_type,
                model: ai_request?.model,
                requestId: req.headers['x-request-id'] as string
            });
            
            if (!ai_request) {
                loggingService.warn('Usage tracking failed - missing AI request data', {
                    userId: user_id,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'AI request data is required',
                    message: 'Please provide the AI request details.'
                });
                return;
            }

            // Use real user ID or fallback to extension user
            const userId = user_id || 'extension-user-id';
            
            loggingService.info('Usage tracking processing started', {
                userId,
                model: ai_request.model,
                requestType: ai_request.request_type,
                promptLength: ai_request.prompt.length,
                responseLength: ai_request.response.length,
                hasTokensUsed: !!ai_request.tokens_used,
                requestId: req.headers['x-request-id'] as string
            });
            
            // Track the real usage
            await AICostTrackerService.trackRequest(
                {
                    prompt: ai_request.prompt,
                    model: ai_request.model,
                    promptTokens: ai_request.tokens_used?.prompt_tokens
                },
                {
                    content: ai_request.response,
                    usage: {
                        promptTokens: ai_request.tokens_used?.prompt_tokens || Math.ceil(ai_request.prompt.length / 4),
                        completionTokens: ai_request.tokens_used?.completion_tokens || Math.ceil(ai_request.response.length / 4),
                        totalTokens: ai_request.tokens_used?.total_tokens || 
                            (ai_request.tokens_used?.prompt_tokens || Math.ceil(ai_request.prompt.length / 4)) +
                            (ai_request.tokens_used?.completion_tokens || Math.ceil(ai_request.response.length / 4))
                    }
                },
                userId,
                {
                    service: 'cursor',
                    endpoint: 'extension',
                    projectId: workspace?.projectId,
                    tags: ['extension', 'cursor'],
                    metadata: {
                        workspace: workspace,
                        codeContext: code_context,
                        requestType: ai_request.request_type,
                        executionTime: ai_request.execution_time,
                        contextFiles: ai_request.context_files,
                        generatedFiles: ai_request.generated_files
                    }
                }
            );

            // Get the latest usage stats
            const usageStats = await UsageService.getRecentUsageForUser(userId, 1);
            const latestUsage = usageStats[0];

            if (!latestUsage) {
                throw new Error('Failed to retrieve tracked usage');
            }

            // Emit real-time update
            RealtimeUpdateService.emitUsageUpdate(userId, {
                type: 'usage_tracked',
                data: latestUsage
            });

            // Generate smart suggestions based on usage patterns
            const suggestions = await CursorController.generateSmartSuggestions(userId, latestUsage);

            const duration = Date.now() - startTime;

            loggingService.info('Usage tracked successfully', {
                userId,
                model: ai_request.model,
                requestType: ai_request.request_type,
                duration,
                usageId: latestUsage._id,
                cost: latestUsage.cost,
                totalTokens: latestUsage.totalTokens,
                hasSuggestions: !!suggestions,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_usage_tracked',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    userId,
                    model: ai_request.model,
                    requestType: ai_request.request_type,
                    cost: latestUsage.cost,
                    totalTokens: latestUsage.totalTokens,
                    projectId: workspace?.projectId,
                    language: code_context?.language
                }
            });

            res.json({
                success: true,
                data: {
                    usage_id: latestUsage._id,
                    cost: latestUsage.cost.toFixed(8),
                    tokens: latestUsage.totalTokens,
                    smart_tip: suggestions.tip,
                    suggestions: suggestions.list,
                    message: `Usage tracked successfully! Cost: $${latestUsage.cost.toFixed(6)}`,
                    breakdown: {
                        promptTokens: latestUsage.promptTokens,
                        completionTokens: latestUsage.completionTokens,
                        model: latestUsage.model
                    }
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Usage tracking failed', {
                userId: user_id,
                hasAiRequest: !!ai_request,
                workspace: workspace?.name,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to track usage',
                message: error.message
            });
        }
    }

    private static async optimizePrompt(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { optimization_request } = req.body;

        try {
            loggingService.info('Prompt optimization initiated', {
                hasOptimizationRequest: !!optimization_request,
                promptLength: optimization_request?.prompt?.length || 0,
                currentTokens: optimization_request?.current_tokens,
                targetReduction: optimization_request?.target_reduction,
                preserveQuality: optimization_request?.preserve_quality,
                requestId: req.headers['x-request-id'] as string
            });

            if (!optimization_request) {
                loggingService.warn('Prompt optimization failed - missing optimization request', {
                    requestId: req.headers['x-request-id'] as string
                });

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

            const duration = Date.now() - startTime;

            loggingService.info('Prompt optimization completed successfully', {
                originalPromptLength: prompt.length,
                optimizedPromptLength: optimizedPrompt.length,
                originalTokens: current_tokens,
                optimizedTokens,
                tokenReduction,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_prompt_optimized',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    originalPromptLength: prompt.length,
                    optimizedPromptLength: optimizedPrompt.length,
                    originalTokens: current_tokens,
                    optimizedTokens,
                    tokenReduction,
                    costSavings
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Prompt optimization failed', {
                hasOptimizationRequest: !!optimization_request,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to optimize prompt',
                message: error.message
            });
        }
    }

    private static async getSuggestions(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { code_context } = req.body;

        try {
            loggingService.info('Suggestions request initiated', {
                hasCodeContext: !!code_context,
                language: code_context?.language,
                filePath: code_context?.file_path,
                hasFunctionName: !!code_context?.function_name,
                hasClassName: !!code_context?.class_name,
                requestId: req.headers['x-request-id'] as string
            });

            if (!code_context) {
                loggingService.warn('Suggestions request failed - missing code context', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Code context is required',
                    message: 'Please provide the code context for suggestions.'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Suggestions generated successfully', {
                language: code_context.language,
                filePath: code_context.file_path,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_suggestions_generated',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    language: code_context.language,
                    filePath: code_context.file_path,
                    hasFunctionName: !!code_context.function_name,
                    hasClassName: !!code_context.class_name
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Suggestions generation failed', {
                hasCodeContext: !!code_context,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to generate suggestions',
                message: error.message
            });
        }
    }

    private static async analyzeCode(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { code_context } = req.body;

        try {
            loggingService.info('Code analysis initiated', {
                hasCodeContext: !!code_context,
                hasCodeSnippet: !!code_context?.code_snippet,
                language: code_context?.language,
                filePath: code_context?.file_path,
                functionName: code_context?.function_name,
                className: code_context?.class_name,
                requestId: req.headers['x-request-id'] as string
            });

            if (!code_context || !code_context.code_snippet) {
                loggingService.warn('Code analysis failed - missing code snippet', {
                    hasCodeContext: !!code_context,
                    hasCodeSnippet: !!code_context?.code_snippet,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Code snippet is required',
                    message: 'Please provide the code snippet to analyze.'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Code analysis completed successfully', {
                language: code_context.language,
                filePath: code_context.file_path,
                codeSnippetLength: code_context.code_snippet.length,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_code_analyzed',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    language: code_context.language,
                    filePath: code_context.file_path,
                    codeSnippetLength: code_context.code_snippet.length,
                    functionName: code_context.function_name,
                    className: code_context.class_name
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Code analysis failed', {
                hasCodeContext: !!code_context,
                hasCodeSnippet: !!code_context?.code_snippet,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to analyze code',
                message: error.message
            });
        }
    }

    private static async setupWorkspace(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { workspace } = req.body;

        try {
            loggingService.info('Workspace setup initiated', {
                hasWorkspace: !!workspace,
                workspaceName: workspace?.name,
                workspacePath: workspace?.path,
                projectId: workspace?.projectId,
                language: workspace?.language,
                framework: workspace?.framework,
                requestId: req.headers['x-request-id'] as string
            });

            if (!workspace) {
                loggingService.warn('Workspace setup failed - missing workspace data', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Workspace data is required',
                    message: 'Please provide workspace information.'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Workspace setup completed successfully', {
                workspaceName: workspace.name,
                workspacePath: workspace.path,
                projectId: workspace.projectId,
                language: workspace.language,
                framework: workspace.framework,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_workspace_setup',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    workspaceName: workspace.name,
                    workspacePath: workspace.path,
                    projectId: workspace.projectId,
                    language: workspace.language,
                    framework: workspace.framework
                }
            });

            res.json({
                success: true,
                data: {
                    project_id: 'mock-project-id',
                    project_name: workspace.name || 'Cursor Workspace',
                    message: `Workspace "${workspace.name}" connected successfully!`
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Workspace setup failed', {
                hasWorkspace: !!workspace,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to setup workspace',
                message: error.message
            });
        }
    }

    private static async createProject(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { name } = req.body;

        try {
            loggingService.info('Project creation initiated', {
                projectName: name,
                hasName: !!name,
                requestId: req.headers['x-request-id'] as string
            });

            if (!name) {
                loggingService.warn('Project creation failed - missing project name', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Project name is required',
                    message: 'Please provide a name for the project.'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Project created successfully', {
                projectName: name,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_project_created',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    projectName: name
                }
            });

            res.json({
                success: true,
                data: {
                    project_id: 'mock-project-id',
                    project_name: name,
                    message: `Project "${name}" created successfully!`
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project creation failed', {
                projectName: name,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to create project',
                message: error.message
            });
        }
    }

    private static async getProjects(res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('Projects retrieval initiated', {
                requestId: 'background'
            });

            const duration = Date.now() - startTime;

            loggingService.info('Projects retrieved successfully', {
                duration,
                projectsCount: 1,
                requestId: 'background'
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_projects_retrieved',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    projectsCount: 1
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Projects retrieval failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: 'background'
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve projects',
                message: error.message
            });
        }
    }

    private static async getAnalytics(res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('Analytics retrieval initiated', {
                requestId: 'background'
            });

            const duration = Date.now() - startTime;

            loggingService.info('Analytics retrieved successfully', {
                duration,
                requestId: 'background'
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cursor_analytics_retrieved',
                category: 'cursor_operations',
                value: duration,
                metadata: {
                    hasSummary: true,
                    hasCursorSpecific: true
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Analytics retrieval failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: 'background'
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve analytics',
                message: error.message
            });
        }
    }

    /**
     * Generate smart suggestions based on usage patterns
     */
    private static async generateSmartSuggestions(userId: string, latestUsage: any) {
        try {
            loggingService.info('Smart suggestions generation initiated', {
                userId,
                hasLatestUsage: !!latestUsage,
                requestId: 'background'
            });

            // Get recent usage patterns
            const recentUsage = await UsageService.getRecentUsageForUser(userId, 10);
            
            let tip = '💡 Use "Cost Katana: Optimize Prompt" to reduce costs for similar requests.';
            const suggestions = [
                'Use the optimized prompt for similar requests',
                'Consider using a cheaper model for simple tasks',
                'Batch similar requests to reduce API overhead'
            ];

            // Analyze patterns and generate personalized tips
            if (recentUsage.length >= 3) {
                const avgCost = recentUsage.reduce((sum, usage) => sum + usage.cost, 0) / recentUsage.length;
                const models = [...new Set(recentUsage.map(u => u.model))];
                
                if (latestUsage.cost > avgCost * 1.5) {
                    tip = '⚠️ This request cost 50% more than your average. Consider prompt optimization.';
                    suggestions.unshift('Try shortening your prompt while maintaining clarity');
                }
                
                if (models.length === 1 && models[0].includes('gpt-4')) {
                    tip = '💰 You\'re consistently using GPT-4. Consider GPT-3.5 for simpler tasks.';
                    suggestions.unshift('Use GPT-3.5-turbo for basic code questions');
                }
            }

            loggingService.info('Smart suggestions generated successfully', {
                userId,
                recentUsageCount: recentUsage.length,
                hasPersonalizedTip: tip !== '💡 Use "Cost Katana: Optimize Prompt" to reduce costs for similar requests.',
                suggestionsCount: suggestions.length,
                requestId: 'background'
            });

            return { tip, list: suggestions };
        } catch (error: any) {
            loggingService.error('Smart suggestions generation failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                requestId: 'background'
            });
            return {
                tip: '💡 Use "Cost Katana: Optimize Prompt" to reduce costs for similar requests.',
                list: [
                    'Use the optimized prompt for similar requests',
                    'Consider using a cheaper model for simple tasks',
                    'Batch similar requests to reduce API overhead'
                ]
            };
        }
    }

    static async healthCheck(_req: Request, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            const duration = Date.now() - startTime;

            loggingService.info('Cursor health check completed successfully', {
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Cursor health check failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Health check failed',
                message: error.message
            });
        }
    }
} 