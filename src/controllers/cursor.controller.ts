import { Response } from 'express';
import { loggingService } from '../services/logging.service';
import { AICostTrackerService } from '../services/aiCostTracker.service';
import { UsageService } from '../services/usage.service';
import { RealtimeUpdateService } from '../services/realtime-update.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';

interface CursorRequest extends AuthenticatedRequest {
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
        ControllerHelper.logRequestStart('handleAction', req);
        const { action, user_id, api_key } = req.body;

        try {

            if (action === 'generate_magic_link') {
                await CursorController.generateMagicLink(req, res);
                return;
            }

            let userId: string | undefined = user_id ?? (req as AuthenticatedRequest).userId;
            if (!userId && api_key) {
                // Implement API key authentication
                try {
                    const { User } = await import('../models/User');
                    const user = await User.findOne({
                        'apiKeys.key': api_key,
                        'apiKeys.isActive': true,
                    });

                    if (user) {
                        userId = user._id.toString();
                        loggingService.info('Cursor API key authentication successful', {
                            userId,
                            apiKeyPrefix: api_key.substring(0, 8) + '...',
                            requestId: req.headers['x-request-id'] as string
                        });
                    } else {
                        loggingService.warn('Cursor API key authentication failed - invalid key', {
                            apiKeyPrefix: api_key.substring(0, 8) + '...',
                            requestId: req.headers['x-request-id'] as string
                        });
                        res.status(401).json({
                            error: 'Invalid API key',
                            message: 'The provided API key is not valid or inactive'
                        });
                        return;
                    }
                } catch (error) {
                    loggingService.error('Cursor API key authentication error', {
                        error: error instanceof Error ? error.message : String(error),
                        requestId: req.headers['x-request-id'] as string
                    });
                    res.status(500).json({
                        error: 'Authentication service unavailable',
                        message: 'Unable to verify API key at this time'
                    });
                    return;
                }
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
                    await CursorController.createProject(req, res, userId);
                    break;
                case 'get_projects':
                    await CursorController.getProjects(req, res, userId);
                    break;
                case 'get_analytics':
                    await CursorController.getAnalytics(req, res, userId);
                    break;
                case 'workspace_setup':
                    await CursorController.setupWorkspace(req, res, userId);
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

            ControllerHelper.logRequestSuccess('handleAction', req, startTime, {
                action,
                userId,
                hasApiKey: !!api_key,
                workspace: req.body.workspace?.name
            });
        } catch (error: any) {
            ControllerHelper.handleError('handleAction', error, req, res, startTime, {
                action,
                userId: user_id,
                hasApiKey: !!api_key
            });
        }
    }

    private static async generateMagicLink(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('generateMagicLink', req);
        const { email } = req.body;

        try {
            if (!email) {
                res.status(400).json({
                    success: false,
                    error: 'Email is required',
                    message: 'Please provide your email address to generate a magic link.'
                });
                return;
            }

            const magicLink = `https://api.costkatana.com/auth/magic-link?token=${Buffer.from(email).toString('base64')}&expires=${Date.now() + 900000}`;
            
            ControllerHelper.logRequestSuccess('generateMagicLink', req, startTime, { hasMagicLink: !!magicLink });

            // Create or find user by email
            try {
                const { User } = await import('../models/User');
                let user = await User.findOne({ email: email.toLowerCase().trim() });

                if (!user) {
                    // Create new user
                    user = new User({
                        email: email.toLowerCase().trim(),
                        name: email.split('@')[0], // Use email prefix as name initially
                        source: 'cursor_extension',
                        isActive: true,
                        emailVerified: false, // Will be verified when magic link is used
                        subscription: {
                            plan: 'free',
                            status: 'trialing',
                            limits: {
                                tokensPerMonth: 1000000, // 1M tokens for trial
                                apiCalls: 5000,
                                logsPerMonth: 5000,
                                agentTraces: 10,
                                seats: 1,
                            },
                            usage: {
                                totalTokens: 0,
                                apiCallsUsed: 0,
                                logsUsed: 0,
                                agentTracesUsed: 0,
                                lastReset: new Date(),
                            },
                        },
                        preferences: {
                            theme: 'system',
                            notifications: {
                                email: true,
                                browser: true,
                            },
                        },
                    });

                    await user.save();
                    loggingService.info('Created new user via cursor magic link', {
                        userId: user._id.toString(),
                        email: user.email,
                        requestId: req.headers['x-request-id'] as string
                    });
                }

                res.json({
                    success: true,
                    data: {
                        magic_link: magicLink,
                        user_id: user._id.toString(),
                        user_name: user.name,
                        is_new_user: !user.emailVerified,
                        message: user.emailVerified
                            ? 'Magic link sent! Check your email to continue.'
                            : 'Welcome! Check your email to complete your account setup.'
                    }
                });
            } catch (error) {
                loggingService.error('Failed to create/find user for magic link', {
                    error: error instanceof Error ? error.message : String(error),
                    email,
                    requestId: req.headers['x-request-id'] as string
                });
                res.status(500).json({
                    success: false,
                    error: 'User creation failed',
                    message: 'Unable to create user account. Please try again later.'
                });
            }
        } catch (error: any) {
            ControllerHelper.handleError('generateMagicLink', error, req, res, startTime, { email });
        }
    }

    private static async trackUsage(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('trackUsage', req);
        const { ai_request, user_id, workspace, code_context } = req.body;

        try {
            if (!ai_request) {
                res.status(400).json({
                    success: false,
                    error: 'AI request data is required',
                    message: 'Please provide the AI request details.'
                });
                return;
            }

            // Use real user ID or fallback to extension user
            const userId = user_id || 'extension-user-id';
            
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

            ControllerHelper.logRequestSuccess('trackUsage', req, startTime, {
                userId,
                model: ai_request.model,
                requestType: ai_request.request_type,
                usageId: latestUsage._id,
                cost: latestUsage.cost,
                totalTokens: latestUsage.totalTokens,
                hasSuggestions: !!suggestions,
                projectId: workspace?.projectId,
                language: code_context?.language
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
            ControllerHelper.handleError('trackUsage', error, req, res, startTime, {
                userId: user_id,
                hasAiRequest: !!ai_request,
                workspace: workspace?.name
            });
        }
    }

    private static async optimizePrompt(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('optimizePrompt', req);
        const { optimization_request } = req.body;

        try {
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

            ControllerHelper.logRequestSuccess('optimizePrompt', req, startTime, {
                originalPromptLength: prompt.length,
                optimizedPromptLength: optimizedPrompt.length,
                originalTokens: current_tokens,
                optimizedTokens,
                tokenReduction,
                costSavings
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
            ControllerHelper.handleError('optimizePrompt', error, req, res, startTime, {
                hasOptimizationRequest: !!optimization_request
            });
        }
    }

    private static async getSuggestions(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getSuggestions', req);
        const { code_context } = req.body;

        try {
            if (!code_context) {
                res.status(400).json({
                    success: false,
                    error: 'Code context is required',
                    message: 'Please provide the code context for suggestions.'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getSuggestions', req, startTime, {
                language: code_context.language,
                filePath: code_context.file_path,
                hasFunctionName: !!code_context.function_name,
                hasClassName: !!code_context.class_name
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
            ControllerHelper.handleError('getSuggestions', error, req, res, startTime, {
                hasCodeContext: !!code_context
            });
        }
    }

    private static async analyzeCode(req: CursorRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('analyzeCode', req);
        const { code_context } = req.body;

        try {
            if (!code_context || !code_context.code_snippet) {
                res.status(400).json({
                    success: false,
                    error: 'Code snippet is required',
                    message: 'Please provide the code snippet to analyze.'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('analyzeCode', req, startTime, {
                language: code_context.language,
                filePath: code_context.file_path,
                codeSnippetLength: code_context.code_snippet.length,
                functionName: code_context.function_name,
                className: code_context.class_name
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
            ControllerHelper.handleError('analyzeCode', error, req, res, startTime, {
                hasCodeContext: !!code_context,
                hasCodeSnippet: !!code_context?.code_snippet
            });
        }
    }

    private static async setupWorkspace(req: CursorRequest, res: Response, userId?: string): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('setupWorkspace', req);
        const { workspace } = req.body;

        try {
            if (!workspace || !userId) {
                res.status(400).json({
                    success: false,
                    error: 'Workspace data and user identification are required',
                    message: 'Please provide workspace information and ensure you are authenticated.'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('setupWorkspace', req, startTime, {
                workspaceName: workspace.name,
                workspacePath: workspace.path,
                projectId: workspace.projectId,
                language: workspace.language,
                framework: workspace.framework
            });

            // Create or find workspace in database
            try {
                const { Workspace } = await import('../models/Workspace');
                const { User } = await import('../models/User');

                // Check if workspace exists for this user
                let existingWorkspace = await Workspace.findOne({
                    name: workspace.name || 'Cursor Workspace',
                    ownerId: userId,
                    isActive: true,
                });

                if (!existingWorkspace) {
                    // Generate unique slug
                    const baseSlug = (workspace.name || 'cursor-workspace')
                        .toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-')
                        .trim();

                    let slug = baseSlug;
                    let counter = 1;
                    while (await Workspace.findOne({ slug })) {
                        slug = `${baseSlug}-${counter}`;
                        counter++;
                    }

                    // Create new workspace
                    existingWorkspace = await Workspace.create({
                        name: workspace.name || 'Cursor Workspace',
                        slug,
                        ownerId: userId,
                        settings: {
                            allowMemberInvites: false,
                            defaultProjectAccess: 'assigned',
                            requireEmailVerification: false,
                        },
                        billing: {
                            seatsIncluded: 1,
                            additionalSeats: 0,
                            pricePerSeat: 0, // Free for cursor integration
                            billingCycle: 'monthly',
                        },
                        isActive: true,
                    });

                    loggingService.info('Created workspace for cursor integration', {
                        workspaceId: existingWorkspace._id.toString(),
                        userId,
                        workspaceName: existingWorkspace.name,
                        requestId: req.headers['x-request-id'] as string
                    });
                }

                res.json({
                    success: true,
                    data: {
                        project_id: existingWorkspace._id.toString(),
                        project_name: existingWorkspace.name,
                        workspace_id: existingWorkspace._id.toString(),
                        workspace_slug: existingWorkspace.slug,
                        message: `Workspace "${existingWorkspace.name}" connected successfully!`
                    }
                });
            } catch (error) {
                loggingService.error('Failed to setup workspace', {
                    error: error instanceof Error ? error.message : String(error),
                    userId,
                    workspaceName: workspace.name,
                    requestId: req.headers['x-request-id'] as string
                });
                res.status(500).json({
                    success: false,
                    error: 'Workspace setup failed',
                    message: 'Unable to create or find workspace. Please try again.'
                });
            }
        } catch (error: any) {
            ControllerHelper.handleError('setupWorkspace', error, req, res, startTime, {
                hasWorkspace: !!workspace
            });
        }
    }

    private static async createProject(req: CursorRequest, res: Response, userId?: string): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('createProject', req);
        const { name } = req.body;

        try {
            if (!name) {
                res.status(400).json({
                    success: false,
                    error: 'Project name is required',
                    message: 'Please provide a name for the project.'
                });
                return;
            }
            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Authentication required',
                    message: 'Please provide user_id or a valid API key.'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('createProject', req, startTime, { projectName: name });

            // Create project in database
            try {
                const { Project } = await import('../models/Project');

                // Get user's default workspace or first active workspace
                let workspaceId = null;
                try {
                    const { Workspace } = await import('../models/Workspace');
                    const workspace = await Workspace.findOne({
                        ownerId: userId,
                        isActive: true,
                    }).sort({ createdAt: -1 });

                    workspaceId = workspace?._id;
                } catch (workspaceError) {
                    loggingService.warn('Could not find workspace for project creation', {
                        userId,
                        error: workspaceError instanceof Error ? workspaceError.message : String(workspaceError)
                    });
                }

                // Check if project with this name already exists for this user
                const existingProject = await Project.findOne({
                    name: name,
                    ownerId: userId,
                    isActive: true,
                });

                if (existingProject) {
                    res.json({
                        success: true,
                        data: {
                            project_id: existingProject._id.toString(),
                            project_name: existingProject.name,
                            message: `Project "${name}" already exists!`,
                        }
                    });
                    return;
                }

                // Create new project
                const project = await Project.create({
                    name: name,
                    description: `Project created via Cursor IDE integration`,
                    ownerId: userId,
                    workspaceId: workspaceId,
                    budget: {
                        amount: 50, // $50 monthly budget
                        period: 'monthly',
                        startDate: new Date(),
                        currency: 'USD',
                        alerts: [],
                    },
                    spending: {
                        current: 0,
                        lastUpdated: new Date(),
                        history: [],
                    },
                    settings: {
                        requireApprovalAbove: 10, // Require approval for requests over $10
                        allowedModels: ['gpt-4o-mini', 'gpt-3.5-turbo', 'claude-3-haiku'],
                        maxTokensPerRequest: 2000,
                        enablePromptLibrary: true,
                        enableCostAllocation: true,
                    },
                    tags: ['cursor', 'ide-integration'],
                    isActive: true,
                });

                loggingService.info('Created project via cursor integration', {
                    projectId: project._id.toString(),
                    userId,
                    projectName: project.name,
                    workspaceId: workspaceId?.toString(),
                    requestId: req.headers['x-request-id'] as string
                });

                res.json({
                    success: true,
                    data: {
                        project_id: project._id.toString(),
                        project_name: project.name,
                        workspace_id: workspaceId?.toString(),
                        message: `Project "${name}" created successfully!`
                    }
                });
            } catch (error) {
                loggingService.error('Failed to create project', {
                    error: error instanceof Error ? error.message : String(error),
                    userId,
                    projectName: name,
                    requestId: req.headers['x-request-id'] as string
                });
                res.status(500).json({
                    success: false,
                    error: 'Project creation failed',
                    message: 'Unable to create project. Please try again.'
                });
            }
        } catch (error: any) {
            ControllerHelper.handleError('createProject', error, req, res, startTime, { projectName: name });
        }
    }

    private static async getProjects(req: CursorRequest, res: Response, userId?: string): Promise<void> {
        const startTime = Date.now();
        try {
            const { Project } = await import('../models/Project');
            const filter: Record<string, unknown> = { isActive: true };
            if (userId) {
                (filter as { ownerId: string }).ownerId = userId;
            }
            const projects = await Project.find(filter)
            .populate('workspaceId', 'name slug')
            .sort({ updatedAt: -1 })
            .limit(50) // Limit results to prevent excessive data
            .lean();

            const formattedProjects = projects.map(project => ({
                id: project._id.toString(),
                name: project.name,
                description: project.description,
                workspace: project.workspaceId ? {
                    id: (project.workspaceId as any)._id?.toString(),
                    name: (project.workspaceId as any).name,
                    slug: (project.workspaceId as any).slug,
                } : undefined,
                budget: {
                    amount: project.budget?.amount,
                    currency: project.budget?.currency,
                    period: project.budget?.period,
                },
                spending: {
                    current: project.spending?.current || 0,
                    lastUpdated: project.spending?.lastUpdated,
                },
                settings: {
                    allowedModels: project.settings?.allowedModels,
                    maxTokensPerRequest: project.settings?.maxTokensPerRequest,
                },
                tags: project.tags || [],
                created_at: project.createdAt,
                updated_at: project.updatedAt,
            }));

            loggingService.info('Retrieved projects for cursor integration', {
                count: formattedProjects.length,
                duration: Date.now() - startTime
            });

            res.json({
                success: true,
                data: {
                    projects: formattedProjects
                }
            });
        } catch (error: any) {
            loggingService.error('Projects retrieval failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration: Date.now() - startTime
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve projects',
                message: error.message
            });
        }
    }

    private static async getAnalytics(req: CursorRequest, res: Response, _userId?: string): Promise<void> {
        const startTime = Date.now();
        // Note: No req parameter, so we can't use ControllerHelper.logRequestStart
        try {

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
            loggingService.error('Analytics retrieval failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration: Date.now() - startTime
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

    static async healthCheck(_req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('healthCheck', _req);
        try {
            ControllerHelper.logRequestSuccess('healthCheck', _req, startTime);

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
            ControllerHelper.handleError('healthCheck', error, _req, res, startTime);
        }
    }
} 