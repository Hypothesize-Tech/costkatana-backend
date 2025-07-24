import { Request, Response } from 'express';
import { ProjectService } from '../services/project.service';
import { UsageService } from '../services/usage.service';
import { OptimizationService } from '../services/optimization.service';
import { IntelligentMonitoringService } from '../services/intelligentMonitoring.service';
import { BedrockService } from '../services/bedrock.service';
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
            request_type: 'code_generation' | 'code_review' | 'bug_fix' | 'refactoring' | 'documentation' | 'testing' | 'optimization' | 'explanation';
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
    /**
     * Main endpoint for Cursor/VS Code extension actions
     */
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

            // Handle magic link generation first (no auth required)
            if (action === 'generate_magic_link') {
                await CursorController.generateMagicLink(req, res);
                return;
            }

            // Authenticate user for other actions
            let userId: string;
            if (user_id) {
                // Check if user_id is an email or ObjectId
                if (user_id.includes('@')) {
                    // It's an email, look up the actual user ObjectId
                    const { User } = await import('../models/User');
                    const user = await User.findOne({ email: user_id });
                    if (!user) {
                        res.status(404).json({
                            success: false,
                            error: 'User not found',
                            message: `No account found for email: ${user_id}. Please complete the magic link setup first.`,
                            onboarding_required: true
                        });
                        return;
                    }
                    userId = user._id.toString();
                    logger.info('Resolved email to userId:', { email: user_id, userId });
                } else {
                    userId = user_id;
                }
            } else if (api_key) {
                // Try both Cursor integration keys and dashboard API keys
                let validation: any = null;
                
                // First try Cursor integration API keys (ck_user_ format)
                if (api_key.startsWith('ck_user_')) {
                    const { ApiKeyController } = await import('./apiKey.controller');
                    validation = await ApiKeyController.validateApiKey(api_key);
                }
                
                // If no validation yet, try dashboard API keys
                if (!validation) {
                    try {
                        const { User } = await import('../models/User');
                        const { AuthService } = await import('../services/auth.service');
                        const { decrypt } = await import('../utils/helpers');
                        
                        // Handle dashboard API keys (dak_ format)
                        if (api_key.startsWith('dak_')) {
                            const parsedKey = AuthService.parseApiKey(api_key);
                            if (parsedKey) {
                                const user = await User.findById(parsedKey.userId);
                                if (user) {
                                    const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === parsedKey.keyId);
                                    if (userApiKey && (!userApiKey.expiresAt || new Date() <= userApiKey.expiresAt)) {
                                        try {
                                            const [iv, authTag, encrypted] = userApiKey.encryptedKey.split(':');
                                            const decryptedKey = decrypt(encrypted, iv, authTag);
                                            if (decryptedKey === api_key) {
                                                userApiKey.lastUsed = new Date();
                                                await user.save();
                                                validation = { userId: user._id.toString(), user };
                                            }
                                        } catch (error) {
                                            logger.warn('Failed to decrypt dashboard API key:', error);
                                        }
                                    }
                                }
                            }
                        } 
                        // Handle full dashboard API keys
                        else {
                            const userIdMatch = api_key.match(/^[a-f0-9]{24}_/);
                            if (userIdMatch) {
                                const potentialUserId = userIdMatch[0].slice(0, -1);
                                const user = await User.findById(potentialUserId);
                                if (user && user.dashboardApiKeys) {
                                    for (const userApiKey of user.dashboardApiKeys) {
                                        if (!userApiKey.expiresAt || new Date() <= userApiKey.expiresAt) {
                                            try {
                                                const [iv, authTag, encrypted] = userApiKey.encryptedKey.split(':');
                                                const decryptedKey = decrypt(encrypted, iv, authTag);
                                                if (decryptedKey === api_key) {
                                                    userApiKey.lastUsed = new Date();
                                                    await user.save();
                                                    validation = { userId: user._id.toString(), user };
                                                    break;
                                                }
                                            } catch (error) {
                                                continue;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        logger.error('Error validating dashboard API key:', error);
                    }
                }
                
                if (!validation) {
                    res.status(401).json({
                        success: false,
                        error: 'Invalid or inactive API key. Please check your API key in the Cost Katana dashboard.',
                        debug: {
                            keyFormat: api_key.startsWith('ck_user_') ? 'Cursor Integration Key' : 
                                      api_key.startsWith('dak_') ? 'Dashboard API Key (dak_)' : 
                                      'Dashboard API Key (full)',
                            keyLength: api_key.length,
                            keyPrefix: api_key.substring(0, 10) + '...'
                        }
                    });
                    return;
                }
                userId = validation.userId;
            } else {
                // No authentication provided - guide user through magic link onboarding
                res.status(200).json({
                    success: false,
                    error: 'authentication_required',
                    onboarding: true,
                    message: 'Welcome to Cost Katana for Cursor! Let me help you get connected in 30 seconds.',
                    instructions: {
                        step1: 'I need your email to create a magic link',
                        step2: 'Click the magic link to instantly connect your account',
                        step3: 'Come back to Cursor and start optimizing your AI costs!',
                        example: 'Just say: "My email is john@example.com" and I\'ll create your magic link!'
                    }
                });
                return;
            }

            // Route to appropriate handler
            switch (action) {
                case 'track_usage':
                    await CursorController.trackUsage(req, res, userId);
                    break;
                case 'optimize_prompt':
                    await CursorController.optimizePrompt(req, res, userId);
                    break;
                case 'get_suggestions':
                    await CursorController.getSuggestions(req, res, userId);
                    break;
                case 'analyze_code':
                    await CursorController.analyzeCode(req, res, userId);
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
                    res.status(400).json({
                        success: false,
                        error: 'Invalid action. Supported actions: track_usage, optimize_prompt, get_suggestions, analyze_code, create_project, get_projects, get_analytics, generate_magic_link, workspace_setup'
                    });
            }
        } catch (error: any) {
            logger.error('Cursor controller error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    /**
     * Generate magic link for seamless onboarding
     */
    private static async generateMagicLink(req: CursorRequest, res: Response): Promise<void> {
        try {
            const email = req.body.email;
            const name = req.body.name;
            const source = req.body.source || 'cursor';

            if (!email) {
                res.status(400).json({
                    success: false,
                    error: 'Email is required for magic link generation',
                    message: 'Please provide your email address to create a magic link.'
                });
                return;
            }

            // Generate magic link using the onboarding controller
            const { OnboardingController } = await import('./onboarding.controller');
            
            const mockReq = {
                body: { 
                    email, 
                    name,
                    source: source || 'cursor'
                }
            } as Request;

            let magicLinkResponse: any;
            const mockRes = {
                json: (data: any) => { magicLinkResponse = data; },
                status: () => mockRes,
                setHeader: () => mockRes,
                send: () => mockRes
            } as any;

            await OnboardingController.generateMagicLink(mockReq, mockRes);

            if (magicLinkResponse?.success) {
                res.json({
                    success: true,
                    message: 'Magic link created successfully!',
                    data: {
                        magic_link: magicLinkResponse.data.magic_link,
                        expires_in_minutes: 15,
                        instructions: [
                            '🔗 Click the magic link above',
                            '📝 Complete the quick setup (30 seconds)',
                            '🔄 Return to Cursor',
                            '🎉 Start optimizing your AI costs!'
                        ],
                        message: `Magic link sent! Click the link above to connect your account in 30 seconds. The link expires in 15 minutes.`
                    }
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Failed to generate magic link',
                    message: magicLinkResponse?.error || 'Please try again'
                });
            }

        } catch (error: any) {
            logger.error('Generate magic link error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate magic link',
                message: error.message
            });
        }
    }

    /**
     * Track Cursor AI usage with code-specific insights
     */
    private static async trackUsage(req: CursorRequest, res: Response, userId: string): Promise<void> {
        try {
            const { ai_request, workspace, code_context } = req.body;

            if (!ai_request) {
                res.status(400).json({
                    success: false,
                    error: 'ai_request is required for track_usage action'
                });
                return;
            }

            // Estimate tokens if not provided
            let promptTokens = ai_request.tokens_used?.prompt_tokens || 0;
            let completionTokens = ai_request.tokens_used?.completion_tokens || 0;
            let totalTokens = ai_request.tokens_used?.total_tokens || 0;

            if (!promptTokens && ai_request.prompt) {
                promptTokens = Math.ceil(ai_request.prompt.length / 4);
            }

            if (!completionTokens && ai_request.response) {
                completionTokens = Math.ceil(ai_request.response.length / 4);
            }

            if (!totalTokens) {
                totalTokens = promptTokens + completionTokens;
            }

            // Calculate cost based on model
            const cost = CursorController.calculateCursorCost(
                ai_request.model || 'gpt-4',
                promptTokens,
                completionTokens
            );

            // Track the usage
            const usageData = {
                userId,
                service: 'openai',
                model: ai_request.model || 'gpt-4',
                prompt: ai_request.prompt,
                completion: ai_request.response,
                promptTokens,
                completionTokens,
                totalTokens,
                cost,
                responseTime: ai_request.execution_time || 0,
                metadata: {
                    source: 'cursor-extension',
                    request_type: ai_request.request_type,
                    workspace_name: workspace?.name,
                    workspace_path: workspace?.path,
                    project_id: workspace?.projectId,
                    language: code_context?.language || workspace?.language,
                    framework: workspace?.framework,
                    file_path: code_context?.file_path,
                    function_name: code_context?.function_name,
                    class_name: code_context?.class_name,
                    context_files: ai_request.context_files,
                    generated_files: ai_request.generated_files,
                    success: ai_request.success,
                    error_message: ai_request.error_message
                },
                tags: ['cursor', 'ide', ai_request.request_type, code_context?.language || 'unknown'],
                optimizationApplied: false,
                errorOccurred: !ai_request.success
            };

            const usage = await UsageService.trackUsage(usageData);

            // Trigger intelligent monitoring in background
            IntelligentMonitoringService.monitorUserUsage(userId).catch(error => 
                logger.error('Background monitoring failed:', error)
            );

            // Generate code-specific smart tip
            const smartTip = await CursorController.generateCodeSmartTip(
                userId, 
                ai_request.model, 
                totalTokens, 
                cost,
                ai_request.request_type,
                code_context,
                ai_request.success || false
            );

            res.json({
                success: true,
                message: 'Usage tracked successfully',
                data: {
                    usage_id: usage?._id,
                    cost: usage?.cost,
                    tokens: usage?.totalTokens,
                    request_type: ai_request.request_type,
                    language: code_context?.language,
                    estimated_monthly_cost: cost * 30,
                    message: `Tracked ${totalTokens} tokens for $${cost.toFixed(6)} (${ai_request.request_type})`,
                    smart_tip: smartTip
                }
            });
        } catch (error: any) {
            logger.error('Track usage error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to track usage',
                message: error.message
            });
        }
    }

    /**
     * Optimize prompts for code generation
     */
    private static async optimizePrompt(req: CursorRequest, res: Response, userId: string): Promise<void> {
        try {
            const { optimization_request, code_context } = req.body;

            if (!optimization_request?.prompt) {
                res.status(400).json({
                    success: false,
                    error: 'optimization_request with prompt is required'
                });
                return;
            }

            const optimizationRequest = {
                prompt: optimization_request.prompt,
                model: 'gpt-4',
                service: 'openai',
                context: `Code context: ${code_context?.language || 'unknown'} language, ${code_context?.function_name ? `function: ${code_context.function_name}` : ''} ${code_context?.class_name ? `class: ${code_context.class_name}` : ''}`,
                targetReduction: optimization_request.target_reduction || 20,
                preserveIntent: optimization_request.preserve_quality !== false
            };

            const optimization = await BedrockService.optimizePrompt(optimizationRequest);

            // Create optimization record
            const optimizationData = {
                userId,
                prompt: optimization_request.prompt,
                originalPrompt: optimization_request.prompt,
                optimizedPrompt: optimization.optimizedPrompt,
                optimizationTechniques: optimization.techniques,
                originalTokens: optimization_request.current_tokens,
                optimizedTokens: Math.ceil(optimization_request.current_tokens * (1 - optimization.estimatedTokenReduction / 100)),
                tokensSaved: Math.ceil(optimization_request.current_tokens * (optimization.estimatedTokenReduction / 100)),
                originalCost: CursorController.calculateCursorCost('gpt-4', optimization_request.current_tokens, 0),
                optimizedCost: CursorController.calculateCursorCost('gpt-4', Math.ceil(optimization_request.current_tokens * (1 - optimization.estimatedTokenReduction / 100)), 0),
                costSaved: 0, // Will be calculated
                improvementPercentage: optimization.estimatedTokenReduction,
                service: 'openai',
                model: 'gpt-4',
                category: 'prompt_reduction',
                suggestions: optimization.suggestions.map(s => ({
                    type: 'optimization',
                    description: s,
                    impact: 'medium',
                    implemented: false
                })),
                metadata: {
                    source: 'cursor-extension',
                    language: code_context?.language,
                    context: optimizationRequest.context
                },
                applied: false,
                appliedCount: 0,
                tags: ['cursor', 'prompt-optimization', code_context?.language || 'unknown']
            };

            optimizationData.costSaved = optimizationData.originalCost - optimizationData.optimizedCost;

            const savedOptimization = await OptimizationService.createOptimization(optimizationData);

            res.json({
                success: true,
                message: 'Prompt optimized successfully',
                data: {
                    optimization_id: savedOptimization._id,
                    original_prompt: optimization_request.prompt,
                    optimized_prompt: optimization.optimizedPrompt,
                    token_reduction: `${optimization.estimatedTokenReduction.toFixed(1)}%`,
                    tokens_saved: optimizationData.tokensSaved,
                    cost_saved: optimizationData.costSaved,
                    techniques: optimization.techniques,
                    suggestions: optimization.suggestions,
                    message: `Optimized prompt to save ${optimization.estimatedTokenReduction.toFixed(1)}% tokens (${optimizationData.tokensSaved} tokens, $${optimizationData.costSaved.toFixed(6)} saved)`
                }
            });
        } catch (error: any) {
            logger.error('Optimize prompt error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to optimize prompt',
                message: error.message
            });
        }
    }

    /**
     * Get AI-powered suggestions for code optimization
     */
    private static async getSuggestions(req: CursorRequest, res: Response, userId: string): Promise<void> {
        try {
            const { code_context, workspace } = req.body;

            if (!code_context?.code_snippet) {
                res.status(400).json({
                    success: false,
                    error: 'code_context with code_snippet is required'
                });
                return;
            }

            // Get user's recent usage patterns
            const { Usage } = await import('../models/Usage');
            const recentUsage = await Usage.find({
                userId,
                'metadata.source': 'cursor-extension'
            }).limit(20).sort({ createdAt: -1 });

            // Analyze code and generate suggestions
            const suggestions = await CursorController.generateCodeSuggestions(
                code_context,
                workspace,
                recentUsage
            );

            res.json({
                success: true,
                data: {
                    suggestions,
                    context: {
                        language: code_context.language,
                        framework: workspace?.framework,
                        recent_usage_patterns: recentUsage.length > 0 ? {
                            total_requests: recentUsage.length,
                            avg_tokens: Math.round(recentUsage.reduce((sum, u) => sum + u.totalTokens, 0) / recentUsage.length),
                            most_used_request_type: recentUsage.reduce((acc, u) => {
                                const type = u.metadata?.request_type || 'unknown';
                                acc[type] = (acc[type] || 0) + 1;
                                return acc;
                            }, {} as Record<string, number>)
                        } : null
                    }
                }
            });
        } catch (error: any) {
            logger.error('Get suggestions error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get suggestions',
                message: error.message
            });
        }
    }

    /**
     * Analyze code for optimization opportunities
     */
    private static async analyzeCode(req: CursorRequest, res: Response, _userId: string): Promise<void> {
        try {
            const { code_context, workspace } = req.body;

            if (!code_context?.code_snippet) {
                res.status(400).json({
                    success: false,
                    error: 'code_context with code_snippet is required'
                });
                return;
            }

            // Analyze code complexity and potential optimizations
            const analysis = await CursorController.analyzeCodeComplexity(
                code_context,
                workspace
            );

            res.json({
                success: true,
                data: {
                    analysis,
                    recommendations: analysis.recommendations,
                    complexity_score: analysis.complexityScore,
                    optimization_potential: analysis.optimizationPotential
                }
            });
        } catch (error: any) {
            logger.error('Analyze code error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to analyze code',
                message: error.message
            });
        }
    }

    /**
     * Setup workspace for project tracking
     */
    private static async setupWorkspace(req: CursorRequest, res: Response, userId: string): Promise<void> {
        try {
            const { workspace } = req.body;

            if (!workspace?.name) {
                res.status(400).json({
                    success: false,
                    error: 'workspace with name is required'
                });
                return;
            }

            // Check if project already exists
            const existingProjects = await ProjectService.getUserProjects(userId);
            const existingProject = existingProjects.find(p => 
                p.name.toLowerCase() === workspace.name?.toLowerCase()
            );

            if (existingProject) {
                res.json({
                    success: true,
                    message: 'Workspace already connected to existing project',
                    data: {
                        project_id: existingProject._id,
                        project_name: existingProject.name,
                        workspace_name: workspace.name,
                        message: `Workspace "${workspace.name}" is connected to project "${existingProject.name}"`
                    }
                });
                return;
            }

            // Create new project for workspace
            const projectData = {
                name: workspace.name,
                description: `Project for workspace: ${workspace.path || 'Unknown path'}`,
                budget: {
                    amount: 100,
                    period: 'monthly' as const,
                    currency: 'USD'
                },
                settings: {
                    enablePromptLibrary: true,
                    enableCostAllocation: true
                },
                tags: ['cursor', 'workspace', workspace.language || 'unknown']
            };

            const newProject = await ProjectService.createProject(userId, projectData);

            res.json({
                success: true,
                message: 'Workspace setup successfully',
                data: {
                    project_id: newProject._id,
                    project_name: newProject.name,
                    workspace_name: workspace.name,
                    language: workspace.language,
                    framework: workspace.framework,
                    message: `Workspace "${workspace.name}" connected to new project "${newProject.name}"`
                }
            });
        } catch (error: any) {
            logger.error('Setup workspace error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to setup workspace',
                message: error.message
            });
        }
    }

    /**
     * Create a new project from Cursor
     */
    private static async createProject(req: CursorRequest, res: Response, userId: string): Promise<void> {
        try {
            const { workspace } = req.body;

            if (!workspace?.name) {
                res.status(400).json({
                    success: false,
                    error: 'workspace with name is required for create_project action'
                });
                return;
            }

            const projectData = {
                name: workspace.name,
                description: workspace.path ? `Project for ${workspace.path}` : `Project created via Cursor on ${new Date().toLocaleDateString()}`,
                budget: {
                    amount: 100,
                    period: 'monthly' as const,
                    currency: 'USD'
                },
                settings: {
                    enablePromptLibrary: true,
                    enableCostAllocation: true
                },
                tags: ['cursor', 'auto-created', workspace.language || 'unknown']
            };

            const newProject = await ProjectService.createProject(userId, projectData);

            res.json({
                success: true,
                message: 'Project created successfully',
                data: {
                    project_id: newProject._id,
                    project_name: newProject.name,
                    workspace_name: workspace.name,
                    language: workspace.language,
                    framework: workspace.framework,
                    budget: `$${newProject.budget.amount} ${newProject.budget.period}`,
                    message: `Project "${newProject.name}" created successfully! You can now track usage against this project.`
                }
            });
        } catch (error: any) {
            logger.error('Create project error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create project',
                message: error.message
            });
        }
    }

    /**
     * Get user's projects
     */
    private static async getProjects(_req: CursorRequest, res: Response, userId: string): Promise<void> {
        try {
            const projects = await ProjectService.getUserProjects(userId);

            const projectSummary = projects.map(project => ({
                id: project._id,
                name: project.name,
                description: project.description,
                budget: `$${project.budget.amount} ${project.budget.period}`,
                current_spending: `$${project.spending.current.toFixed(2)}`,
                budget_used: project.budget.amount > 0 ? `${((project.spending.current / project.budget.amount) * 100).toFixed(1)}%` : '0%',
                status: project.isActive ? 'Active' : 'Inactive',
                tags: project.tags
            }));

            res.json({
                success: true,
                data: {
                    projects: projectSummary,
                    total_projects: projects.length,
                    message: projects.length > 0 
                        ? `You have ${projects.length} project(s). Select one to track usage or create a new one.`
                        : 'No projects found. Create your first project to start tracking AI costs!'
                }
            });
        } catch (error: any) {
            logger.error('Get projects error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get projects',
                message: error.message
            });
        }
    }

    /**
     * Get analytics summary
     */
    private static async getAnalytics(_req: CursorRequest, res: Response, userId: string): Promise<void> {
        try {
            const stats = await UsageService.getUsageStats(userId, 'monthly');
            const projects = await ProjectService.getUserProjects(userId);

            const totalSpending = projects.reduce((sum, project) => sum + project.spending.current, 0);
            const totalBudget = projects.reduce((sum, project) => sum + project.budget.amount, 0);

            // Get Cursor-specific stats
            const { Usage } = await import('../models/Usage');
            const cursorUsage = await Usage.find({
                userId,
                'metadata.source': 'cursor-extension'
            }).sort({ createdAt: -1 }).limit(10);

            const requestTypeBreakdown = cursorUsage.reduce((acc, usage) => {
                const type = usage.metadata?.request_type || 'unknown';
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            res.json({
                success: true,
                data: {
                    summary: {
                        total_spending_this_month: `$${totalSpending.toFixed(2)}`,
                        total_budget: `$${totalBudget.toFixed(2)}`,
                        budget_used: totalBudget > 0 ? `${((totalSpending / totalBudget) * 100).toFixed(1)}%` : '0%',
                        active_projects: projects.filter(p => p.isActive).length,
                        total_projects: projects.length
                    },
                    cursor_specific: {
                        total_requests: cursorUsage.length,
                        request_types: requestTypeBreakdown,
                        most_used_language: cursorUsage.reduce((acc, usage) => {
                            const lang = usage.metadata?.language || 'unknown';
                            acc[lang] = (acc[lang] || 0) + 1;
                            return acc;
                        }, {} as Record<string, number>),
                        average_tokens_per_request: cursorUsage.length > 0 ? 
                            Math.round(cursorUsage.reduce((sum, u) => sum + u.totalTokens, 0) / cursorUsage.length) : 0
                    },
                    recent_activity: {
                        total_requests: stats.summary?.totalCalls || 0,
                        total_tokens: stats.summary?.totalTokens || 0,
                        average_cost_per_request: stats.summary?.avgCost || 0
                    },
                    message: `This month: $${totalSpending.toFixed(2)} spent across ${projects.length} projects. Budget utilization: ${totalBudget > 0 ? ((totalSpending / totalBudget) * 100).toFixed(1) : 0}%`
                }
            });
        } catch (error: any) {
            logger.error('Get analytics error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get analytics',
                message: error.message
            });
        }
    }

    /**
     * Generate code-specific smart tips
     */
    private static async generateCodeSmartTip(
        userId: string, 
        model: string, 
        tokens: number, 
        cost: number,
        requestType: string,
        codeContext: any,
        success: boolean
    ): Promise<string> {
        try {
            const { Usage } = await import('../models/Usage');
            const recentUsage = await Usage.find({
                userId,
                'metadata.source': 'cursor-extension'
            }).limit(10).sort({ createdAt: -1 });

            if (recentUsage.length < 2) {
                return "💡 Tip: Track more code generation requests to get AI-powered optimization recommendations!";
            }

            const avgTokens = recentUsage.reduce((sum, u) => sum + u.totalTokens, 0) / recentUsage.length;
            const language = codeContext?.language || 'unknown';

            // Request type specific tips
            if (requestType === 'code_generation' && tokens > avgTokens * 1.3) {
                return `💡 Code Generation Tip: This request used ${Math.round(((tokens - avgTokens) / avgTokens) * 100)}% more tokens than average. Try breaking complex functions into smaller, focused requests.`;
            }

            if (requestType === 'code_review' && tokens < 100) {
                return "💡 Code Review Tip: For thorough code reviews, provide more context about the code's purpose and requirements for better AI analysis.";
            }

            if (requestType === 'bug_fix' && !success) {
                return "💡 Bug Fix Tip: Include error messages, stack traces, and expected vs actual behavior for more accurate bug fixes.";
            }

            if (requestType === 'refactoring' && tokens > avgTokens * 1.5) {
                return "💡 Refactoring Tip: For large refactoring tasks, break them into smaller, focused changes for better AI assistance.";
            }

            // Language specific tips
            if (language === 'javascript' || language === 'typescript') {
                return "💡 JS/TS Tip: Include TypeScript types and JSDoc comments in your prompts for better code generation.";
            }

            if (language === 'python') {
                return "💡 Python Tip: Specify Python version and mention if you're using specific frameworks (Django, Flask, etc.) for better code generation.";
            }

            if (language === 'java' || language === 'kotlin') {
                return "💡 Java/Kotlin Tip: Include package structure and class hierarchy context for more accurate code generation.";
            }

            // Cost optimization tips
            if (cost > 0.01) {
                return `💡 Cost Tip: High-cost request detected ($${cost.toFixed(4)}). Consider using GPT-3.5 for simpler code tasks to reduce costs.`;
            }

            if (model.includes('gpt-4') && tokens < 200) {
                return "💡 Efficiency Tip: For simple code tasks, GPT-3.5 Turbo could save you 95% while providing similar quality!";
            }

            return "📊 Visit your Cost Katana dashboard for detailed code generation analytics and optimization insights.";

        } catch (error) {
            logger.error('Error generating code smart tip:', error);
            return "🤖 Tip: Check your Cost Katana dashboard for AI-powered code optimization insights!";
        }
    }

    /**
     * Generate code-specific suggestions
     */
    private static async generateCodeSuggestions(
        codeContext: any,
        _workspace: any,
        recentUsage: any[]
    ): Promise<any[]> {
        const suggestions = [];

        // Language-specific suggestions
        if (codeContext.language === 'javascript' || codeContext.language === 'typescript') {
            suggestions.push({
                type: 'optimization',
                title: 'Add TypeScript Types',
                description: 'Consider adding TypeScript types to improve code quality and AI assistance',
                impact: 'medium',
                potential_savings: '10-20% tokens'
            });
        }

        if (codeContext.language === 'python') {
            suggestions.push({
                type: 'optimization',
                title: 'Add Type Hints',
                description: 'Add Python type hints for better code documentation and AI understanding',
                impact: 'medium',
                potential_savings: '5-15% tokens'
            });
        }

        // Framework-specific suggestions
        if (_workspace?.framework) {
            suggestions.push({
                type: 'context',
                title: 'Framework Context',
                description: `Mention ${_workspace.framework} in your prompts for more accurate code generation`,
                impact: 'high',
                potential_savings: '20-30% tokens'
            });
        }

        // Usage pattern suggestions
        if (recentUsage.length > 0) {
            const avgTokens = recentUsage.reduce((sum, u) => sum + u.totalTokens, 0) / recentUsage.length;
            if (avgTokens > 500) {
                suggestions.push({
                    type: 'efficiency',
                    title: 'Break Down Large Requests',
                    description: 'Consider breaking large code generation requests into smaller, focused tasks',
                    impact: 'high',
                    potential_savings: '30-50% tokens'
                });
            }
        }

        return suggestions;
    }

    /**
     * Analyze code complexity
     */
    private static async analyzeCodeComplexity(
        codeContext: any,
        _workspace: any
    ): Promise<any> {
        const code = codeContext.code_snippet;

        // Simple complexity analysis
        const lines = code.split('\n').length;
        const functions = (code.match(/function\s+\w+|def\s+\w+|public\s+\w+|private\s+\w+/g) || []).length;
        const classes = (code.match(/class\s+\w+/g) || []).length;
        const imports = (code.match(/import\s+|from\s+|require\(/g) || []).length;

        let complexityScore = 0;
        let recommendations = [];

        // Calculate complexity score
        complexityScore += lines * 0.1;
        complexityScore += functions * 2;
        complexityScore += classes * 5;
        complexityScore += imports * 0.5;

        // Generate recommendations
        if (complexityScore > 50) {
            recommendations.push({
                type: 'refactoring',
                title: 'Consider Refactoring',
                description: 'This code has high complexity. Consider breaking it into smaller functions.',
                priority: 'high'
            });
        }

        if (functions > 10) {
            recommendations.push({
                type: 'structure',
                title: 'Organize Functions',
                description: 'Consider organizing functions into classes or modules.',
                priority: 'medium'
            });
        }

        if (imports > 5) {
            recommendations.push({
                type: 'dependencies',
                title: 'Review Dependencies',
                description: 'Consider if all imports are necessary for this code.',
                priority: 'low'
            });
        }

        return {
            complexityScore: Math.round(complexityScore),
            lines,
            functions,
            classes,
            imports,
            recommendations,
            optimizationPotential: complexityScore > 30 ? 'high' : complexityScore > 15 ? 'medium' : 'low'
        };
    }

    /**
     * Calculate cost for Cursor AI models
     */
    private static calculateCursorCost(model: string, promptTokens: number, completionTokens: number): number {
        const pricing: Record<string, { prompt: number; completion: number }> = {
            // OpenAI Models
            'gpt-4o': { prompt: 2.5, completion: 10.0 },
            'gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
            'gpt-4.1': { prompt: 30.0, completion: 60.0 },
            'gpt-4.5-preview': { prompt: 10.0, completion: 30.0 },
            'gpt-4': { prompt: 30.0, completion: 60.0 },
            'gpt-4-turbo': { prompt: 10.0, completion: 30.0 },
            'gpt-4-turbo-preview': { prompt: 10.0, completion: 30.0 },
            'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
            'gpt-3.5-turbo-16k': { prompt: 3.0, completion: 4.0 },
            
            // Anthropic Claude Models
            'claude-3.5-sonnet': { prompt: 3.0, completion: 15.0 },
            'claude-3.5-haiku': { prompt: 0.25, completion: 1.25 },
            'claude-3.7-sonnet': { prompt: 3.0, completion: 15.0 },
            'claude-4-opus': { prompt: 15.0, completion: 75.0 },
            'claude-4-sonnet': { prompt: 3.0, completion: 15.0 },
            'claude-3-opus': { prompt: 15.0, completion: 75.0 },
            'claude-3-sonnet': { prompt: 3.0, completion: 15.0 },
            'claude-3-haiku': { prompt: 0.25, completion: 1.25 },
            
            // Google Gemini Models
            'gemini-2.0-pro': { prompt: 3.5, completion: 10.5 },
            'gemini-2.5-flash': { prompt: 0.075, completion: 0.3 },
            'gemini-2.5-pro': { prompt: 3.5, completion: 10.5 },
            
            // Deepseek Models
            'deepseek-r1': { prompt: 0.14, completion: 0.28 },
            'deepseek-r1-05-28': { prompt: 0.14, completion: 0.28 },
            'deepseek-v3': { prompt: 0.14, completion: 0.28 },
            'deepseek-v3.1': { prompt: 0.14, completion: 0.28 },
            
            // Grok Models
            'grok-2': { prompt: 0.1, completion: 0.3 },
            'grok-3-beta': { prompt: 0.1, completion: 0.3 },
            'grok-3-mini': { prompt: 0.1, completion: 0.3 },
            'grok-4': { prompt: 0.1, completion: 0.3 },
            
            // Anthropic o1/o3 Models
            'o1': { prompt: 15.0, completion: 60.0 },
            'o1-mini': { prompt: 3.0, completion: 15.0 },
            'o3': { prompt: 15.0, completion: 60.0 },
            'o3-mini': { prompt: 3.0, completion: 15.0 },
            'o4-mini': { prompt: 3.0, completion: 15.0 },
            
            // Cursor Models
            'cursor-small': { prompt: 0.1, completion: 0.3 }
        };

        const modelPricing = pricing[model] || pricing['gpt-4'];
        const promptCost = (promptTokens / 1000000) * modelPricing.prompt;
        const completionCost = (completionTokens / 1000000) * modelPricing.completion;
        
        return Number((promptCost + completionCost).toFixed(8));
    }

    /**
     * Health check endpoint
     */
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
                'real_time_analytics'
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