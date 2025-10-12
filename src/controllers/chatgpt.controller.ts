import { Request, Response } from 'express';
import { ProjectService } from '../services/project.service';
import { UsageService } from '../services/usage.service';
import { loggingService } from '../services/logging.service';

interface ChatGPTRequest extends Request {
    body: {
        user_id?: string;
        api_key?: string;
        email?: string; // For magic link generation
        name?: string; // For magic link generation
        source?: string; // For magic link generation
        onboarding?: {
            email: string;
            name?: string;
            source?: string;
            preferences?: {
                use_case?: string;
                ai_coaching?: boolean;
                email_insights?: boolean;
            };
        };
        conversation_data?: {
            prompt: string;
            response: string;
            model: string;
            tokens_used?: {
                prompt_tokens: number;
                completion_tokens: number;
                total_tokens: number;
            };
            conversation_id?: string;
            timestamp?: string;
        };
        project?: {
            name?: string;
            description?: string;
            budget_amount?: number;
            budget_period?: 'monthly' | 'quarterly' | 'yearly';
        };
        action: 'track_usage' | 'create_project' | 'get_projects' | 'get_analytics' | 'generate_magic_link' | 'check_connection';
    };
}

interface ConnectionStatus {
    connected: boolean;
    userId?: string;
    user?: any;
    message: string;
    needsOnboarding?: boolean;
    magicLinkRequired?: boolean;
}

export class ChatGPTController {
    /**
     * Check user connection status automatically
     */
    private static async checkConnectionStatus(req: ChatGPTRequest): Promise<ConnectionStatus> {
        const startTime = Date.now();
        const { user_id, api_key } = req.body;

        try {
            loggingService.info('Connection status check initiated', {
                hasUserId: !!user_id,
                hasApiKey: !!api_key,
                userIdType: user_id?.includes('@') ? 'email' : user_id ? 'objectId' : 'none',
                requestId: req.headers['x-request-id'] as string
            });

            // If no authentication provided at all
            if (!user_id && !api_key) {
                loggingService.warn('Connection check failed - no authentication provided', {
                    requestId: req.headers['x-request-id'] as string
                });

                return {
                    connected: false,
                    message: 'Welcome to Cost Katana! I need to connect you to start tracking your AI costs.',
                    needsOnboarding: true,
                    magicLinkRequired: true
                };
            }

            let userId: string | undefined;
            let user: any;

            // Check user_id authentication
            if (user_id) {
                if (user_id.includes('@')) {
                    // It's an email, look up the actual user ObjectId
                    const { User } = await import('../models/User');
                    user = await User.findOne({ email: user_id });
                    if (!user) {
                        loggingService.warn('Connection check failed - email not found', {
                            email: user_id,
                            requestId: req.headers['x-request-id'] as string
                        });

                        return {
                            connected: false,
                            message: `I don't see an account for ${user_id}. Let me create one for you with a magic link!`,
                            needsOnboarding: true,
                            magicLinkRequired: true
                        };
                    }
                    userId = user._id.toString();
                } else {
                    // It's an ObjectId
                    const { User } = await import('../models/User');
                    user = await User.findById(user_id);
                    if (!user) {
                        loggingService.warn('Connection check failed - user ID not found', {
                            userId: user_id,
                            requestId: req.headers['x-request-id'] as string
                        });

                        return {
                            connected: false,
                            message: 'I found your user ID, but the account seems to be missing. Let me help you reconnect!',
                            needsOnboarding: true,
                            magicLinkRequired: true
                        };
                    }
                    userId = user_id;
                }
            }
            // Check API key authentication
            else if (api_key) {
                let validation: any = null;
                
                // Try ChatGPT integration API keys (ck_user_ format)
                if (api_key.startsWith('ck_user_')) {
                    const { ApiKeyController } = await import('./apiKey.controller');
                    validation = await ApiKeyController.validateApiKey(api_key);
                }
                
                // Try dashboard API keys (dak_ format or full key)
                if (!validation) {
                    try {
                        const { User } = await import('../models/User');
                        const { AuthService } = await import('../services/auth.service');
                        const { decrypt } = await import('../utils/helpers');
                        
                        if (api_key.startsWith('dak_')) {
                            const parsedKey = AuthService.parseApiKey(api_key);
                            if (parsedKey) {
                                user = await User.findById(parsedKey.userId);
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
                                            loggingService.warn('Failed to decrypt dashboard API key', {
                                                error: error instanceof Error ? error.message : 'Unknown error',
                                                requestId: req.headers['x-request-id'] as string
                                            });
                                        }
                                    }
                                }
                            }
                        } else {
                            // Handle full dashboard API keys
                            const userIdMatch = api_key.match(/^[a-f0-9]{24}_/);
                            if (userIdMatch) {
                                const potentialUserId = userIdMatch[0].slice(0, -1);
                                user = await User.findById(potentialUserId);
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
                        loggingService.error('Error validating dashboard API key', {
                            error: error instanceof Error ? error.message : 'Unknown error',
                            stack: error instanceof Error ? error.stack : undefined,
                            requestId: req.headers['x-request-id'] as string
                        });
                    }
                }
                
                if (!validation) {
                    loggingService.warn('Connection check failed - invalid or expired API key', {
                        apiKeyPrefix: api_key.substring(0, 8) + '...',
                        requestId: req.headers['x-request-id'] as string
                    });

                    return {
                        connected: false,
                        message: 'I found your API key, but it seems to be invalid or expired. Let me help you get a new one!',
                        needsOnboarding: true,
                        magicLinkRequired: true
                    };
                }
                userId = validation.userId;
                user = validation.user;
            }

            // User is connected
            if (userId && user) {
                const duration = Date.now() - startTime;

                loggingService.info('Connection status check successful', {
                    userId,
                    userEmail: user.email,
                    duration,
                    requestId: req.headers['x-request-id'] as string
                });

                // Log business event
                loggingService.logBusiness({
                    event: 'chatgpt_connection_verified',
                    category: 'chatgpt_integration',
                    value: duration,
                    metadata: {
                        userId,
                        userEmail: user.email,
                        authMethod: user_id ? 'user_id' : 'api_key'
                    }
                });

                return {
                    connected: true,
                    userId,
                    user,
                    message: `Great! You're connected as ${user.email}. I'm ready to help you track and optimize your AI costs!`
                };
            }

            // Fallback case - should not reach here
            loggingService.warn('Connection check reached fallback case', {
                requestId: req.headers['x-request-id'] as string
            });

            return {
                connected: false,
                message: 'I encountered an issue with your connection. Let me help you reconnect!',
                needsOnboarding: true,
                magicLinkRequired: true
            };
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Connection status check failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            return {
                connected: false,
                message: 'I encountered an issue with your connection. Let me help you reconnect!',
                needsOnboarding: true,
                magicLinkRequired: true
            };
        }
    }

    /**
     * Main endpoint for ChatGPT Custom GPT actions with automatic connection checking
     */
    static async handleAction(req: ChatGPTRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { action } = req.body;

        try {
            loggingService.info('ChatGPT action received', {
                action,
                hasUserId: !!req.body.user_id,
                hasApiKey: !!req.body.api_key,
                hasEmail: !!req.body.email,
                requestId: req.headers['x-request-id'] as string
            });

            // Handle magic link generation first (no auth required)
            if (action === 'generate_magic_link') {
                await ChatGPTController.generateMagicLink(req, res);
                return;
            }

            // Handle connection check action
            if (action === 'check_connection') {
                const connectionStatus = await ChatGPTController.checkConnectionStatus(req);
                res.json({
                    success: true,
                    data: connectionStatus
                });
                return;
            }

            // For all other actions, automatically check connection status first
            const connectionStatus = await ChatGPTController.checkConnectionStatus(req);

            // If not connected, guide user through onboarding
            if (!connectionStatus.connected) {
                loggingService.warn('ChatGPT action failed - authentication required', {
                    action,
                    connectionStatus: connectionStatus.message,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(200).json({
                    success: false,
                    error: 'authentication_required',
                    onboarding: true,
                    connection_status: connectionStatus,
                    message: connectionStatus.message,
                    instructions: {
                        step1: 'I need your email to create a magic link',
                        step2: 'Click the magic link to instantly connect your account',
                        step3: 'Come back here and start tracking your AI costs!',
                        example: 'Just say: "My email is john@example.com" and I\'ll create your magic link!'
                    }
                });
                return;
            }

            // User is connected - proceed with the requested action
            const userId = connectionStatus.userId!;

            // Route to appropriate handler
            switch (action) {
                case 'track_usage':
                    await ChatGPTController.trackUsage(req, res, userId);
                    break;
                case 'create_project':
                    await ChatGPTController.createProject(req, res, userId);
                    break;
                case 'get_projects':
                    await ChatGPTController.getProjects(req, res, userId);
                    break;
                case 'get_analytics':
                    await ChatGPTController.getAnalytics(req, res, userId);
                    break;
                default:
                    loggingService.warn('ChatGPT action failed - invalid action', {
                        action,
                        userId,
                        requestId: req.headers['x-request-id'] as string
                    });

                    res.status(400).json({
                        success: false,
                        error: 'Invalid action. Supported actions: track_usage, create_project, get_projects, get_analytics, generate_magic_link, check_connection'
                    });
            }
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('ChatGPT controller error', {
                action,
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

    /**
     * Generate magic link for seamless onboarding
     */
    private static async generateMagicLink(req: ChatGPTRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const email = req.body.email || req.body.onboarding?.email;
        const name = req.body.name || req.body.onboarding?.name;
        const source = req.body.source || req.body.onboarding?.source || 'chatgpt';

        try {
            loggingService.info('Magic link generation initiated', {
                email,
                name,
                source,
                requestId: req.headers['x-request-id'] as string
            });

            if (!email) {
                loggingService.warn('Magic link generation failed - email required', {
                    receivedBody: req.body,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Email is required for magic link generation',
                    message: 'Please provide your email address to create a magic link.',
                    debug: {
                        received_body: req.body,
                        expected_structure: 'email should be in req.body.email or req.body.onboarding.email'
                    }
                });
                return;
            }

            // Generate magic link using the onboarding controller
            const { OnboardingController } = await import('./onboarding.controller');
            
            // Create a mock request for the onboarding controller
            const mockReq = {
                body: { 
                    email, 
                    name,
                    source: source || 'chatgpt'
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
                const duration = Date.now() - startTime;

                loggingService.info('Magic link generated successfully', {
                    email,
                    source,
                    duration,
                    requestId: req.headers['x-request-id'] as string
                });

                // Log business event
                loggingService.logBusiness({
                    event: 'chatgpt_magic_link_generated',
                    category: 'chatgpt_integration',
                    value: duration,
                    metadata: {
                        email,
                        source,
                        hasName: !!name
                    }
                });

                res.json({
                    success: true,
                    message: 'Magic link created successfully!',
                    data: {
                        magic_link: magicLinkResponse.data.magic_link,
                        expires_in_minutes: 15,
                        instructions: [
                            '🔗 Click the magic link above',
                            '📝 Complete the quick setup (30 seconds)',
                            '🔄 Come back to this chat',
                            '🎉 Start tracking your AI costs!'
                        ],
                        message: `Magic link sent! Click the link above to connect your account in 30 seconds. The link expires in 15 minutes.`
                    }
                });
            } else {
                loggingService.error('Magic link generation failed', {
                    email,
                    source,
                    error: magicLinkResponse?.error || 'Unknown error',
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(500).json({
                    success: false,
                    error: 'Failed to generate magic link',
                    message: magicLinkResponse?.error || 'Please try again'
                });
            }

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Generate magic link error', {
                email,
                source,
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

    /**
     * Track ChatGPT conversation usage with AI-powered insights
     */
    private static async trackUsage(req: ChatGPTRequest, res: Response, userId: string): Promise<void> {
        const startTime = Date.now();
        const { conversation_data } = req.body;

        try {
            loggingService.info('ChatGPT usage tracking initiated', {
                userId,
                model: conversation_data?.model,
                hasPrompt: !!conversation_data?.prompt,
                hasResponse: !!conversation_data?.response,
                conversationId: conversation_data?.conversation_id,
                requestId: req.headers['x-request-id'] as string
            });

            if (!conversation_data) {
                loggingService.warn('Usage tracking failed - conversation data required', {
                    userId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'conversation_data is required for track_usage action'
                });
                return;
            }

            // Estimate tokens if not provided
            let promptTokens = conversation_data.tokens_used?.prompt_tokens || 0;
            let completionTokens = conversation_data.tokens_used?.completion_tokens || 0;
            let totalTokens = conversation_data.tokens_used?.total_tokens || 0;

            if (!promptTokens && conversation_data.prompt) {
                promptTokens = Math.ceil(conversation_data.prompt.length / 4); // Rough estimation
            }

            if (!completionTokens && conversation_data.response) {
                completionTokens = Math.ceil(conversation_data.response.length / 4); // Rough estimation
            }

            if (!totalTokens) {
                totalTokens = promptTokens + completionTokens;
            }

            // Calculate cost based on model
            const cost = ChatGPTController.calculateChatGPTCost(
                conversation_data.model || 'gpt-3.5-turbo',
                promptTokens,
                completionTokens
            );

            // Track the usage
            const usageData = {
                userId,
                service: 'openai',
                model: conversation_data.model || 'gpt-3.5-turbo',
                prompt: conversation_data.prompt,
                completion: conversation_data.response,
                promptTokens,
                completionTokens,
                totalTokens,
                cost,
                responseTime: 0,
                metadata: {
                    source: 'chatgpt-custom-gpt',
                    conversation_id: conversation_data.conversation_id,
                    timestamp: conversation_data.timestamp
                },
                tags: ['chatgpt', 'custom-gpt'],
                optimizationApplied: false,
                errorOccurred: false
            };

            const usage = await UsageService.trackUsage(usageData);

            const duration = Date.now() - startTime;

            loggingService.info('ChatGPT usage tracked successfully', {
                userId,
                model: conversation_data.model || 'gpt-3.5-turbo',
                totalTokens,
                cost,
                duration,
                conversationId: conversation_data.conversation_id,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'chatgpt_usage_tracked',
                category: 'chatgpt_integration',
                value: duration,
                metadata: {
                    userId,
                    model: conversation_data.model || 'gpt-3.5-turbo',
                    totalTokens,
                    cost,
                    conversationId: conversation_data.conversation_id,
                }
            });

            res.json({
                success: true,
                message: 'Usage tracked successfully',
                data: {
                    usage_id: usage?._id,
                    cost: usage?.cost,
                    tokens: usage?.totalTokens,
                    estimated_monthly_cost: cost * 30, // Rough estimate
                    message: `Tracked ${totalTokens} tokens for $${cost.toFixed(6)}`,
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Track usage error', {
                userId,
                model: conversation_data?.model,
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


    /**
     * Create a new project from ChatGPT
     */
    private static async createProject(req: ChatGPTRequest, res: Response, userId: string): Promise<void> {
        const startTime = Date.now();
        const { project } = req.body;

        try {
            loggingService.info('ChatGPT project creation initiated', {
                userId,
                projectName: project?.name,
                hasDescription: !!project?.description,
                budgetAmount: project?.budget_amount,
                budgetPeriod: project?.budget_period,
                requestId: req.headers['x-request-id'] as string
            });

            if (!project || !project.name) {
                loggingService.warn('Project creation failed - project data with name required', {
                    userId,
                    hasProject: !!project,
                    hasName: !!project?.name,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Project data with name is required for create_project action'
                });
                return;
            }

            const projectData = {
                name: project.name,
                description: project.description || `Project created via ChatGPT on ${new Date().toLocaleDateString()}`,
                budget: {
                    amount: project.budget_amount || 100,
                    period: project.budget_period || 'monthly',
                    currency: 'USD'
                },
                settings: {
                    enablePromptLibrary: true,
                    enableCostAllocation: true
                },
                tags: ['chatgpt', 'auto-created']
            };

            const newProject = await ProjectService.createProject(userId, projectData);

            const duration = Date.now() - startTime;

            loggingService.info('ChatGPT project created successfully', {
                userId,
                projectId: newProject._id,
                projectName: newProject.name,
                budget: `${newProject.budget.amount} ${newProject.budget.period}`,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'chatgpt_project_created',
                category: 'chatgpt_integration',
                value: duration,
                metadata: {
                    userId,
                    projectId: newProject._id,
                    projectName: newProject.name,
                    budget: `${newProject.budget.amount} ${newProject.budget.period}`,
                    source: 'chatgpt'
                }
            });

            res.json({
                success: true,
                message: 'Project created successfully',
                data: {
                    project_id: newProject._id,
                    project_name: newProject.name,
                    budget: `$${newProject.budget.amount} ${newProject.budget.period}`,
                    message: `Project "${newProject.name}" created successfully! You can now track usage against this project.`
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Create project error', {
                userId,
                projectName: project?.name,
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

    /**
     * Get user's projects
     */
    private static async getProjects(_req: ChatGPTRequest, res: Response, userId: string): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('ChatGPT projects retrieval initiated', {
                userId,
                requestId: _req.headers['x-request-id'] as string
            });

            const projects = await ProjectService.getUserProjects(userId);

            const projectSummary = projects.map(project => ({
                id: project._id,
                name: project.name,
                description: project.description,
                budget: `$${project.budget.amount} ${project.budget.period}`,
                current_spending: `$${project.spending.current.toFixed(2)}`,
                budget_used: project.budget.amount > 0 ? `${((project.spending.current / project.budget.amount) * 100).toFixed(1)}%` : '0%',
                status: project.isActive ? 'Active' : 'Inactive'
            }));

            const duration = Date.now() - startTime;

            loggingService.info('ChatGPT projects retrieved successfully', {
                userId,
                projectsCount: projects.length,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'chatgpt_projects_retrieved',
                category: 'chatgpt_integration',
                value: duration,
                metadata: {
                    userId,
                    projectsCount: projects.length,
                    activeProjects: projects.filter(p => p.isActive).length
                }
            });

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
            const duration = Date.now() - startTime;
            
            loggingService.error('Get projects error', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

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
    private static async getAnalytics(_req: ChatGPTRequest, res: Response, userId: string): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('ChatGPT analytics retrieval initiated', {
                userId,
                requestId: _req.headers['x-request-id'] as string
            });

            // Get user's recent usage stats
            const stats = await UsageService.getUsageStats(userId, 'monthly');
            const projects = await ProjectService.getUserProjects(userId);

            const totalSpending = projects.reduce((sum, project) => sum + project.spending.current, 0);
            const totalBudget = projects.reduce((sum, project) => sum + project.budget.amount, 0);

            const duration = Date.now() - startTime;

            loggingService.info('ChatGPT analytics retrieved successfully', {
                userId,
                totalSpending,
                totalBudget,
                projectsCount: projects.length,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'chatgpt_analytics_retrieved',
                category: 'chatgpt_integration',
                value: duration,
                metadata: {
                    userId,
                    totalSpending,
                    totalBudget,
                    projectsCount: projects.length,
                    activeProjects: projects.filter(p => p.isActive).length
                }
            });

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
                    recent_activity: {
                        total_requests: stats.summary?.totalCalls || 0,
                        total_tokens: stats.summary?.totalTokens || 0,
                        average_cost_per_request: stats.summary?.avgCost || 0
                    },
                    message: `This month: $${totalSpending.toFixed(2)} spent across ${projects.length} projects. Budget utilization: ${totalBudget > 0 ? ((totalSpending / totalBudget) * 100).toFixed(1) : 0}%`
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Get analytics error', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to get analytics',
                message: error.message
            });
        }
    }

    /**
     * Calculate cost for ChatGPT models
     */
    private static calculateChatGPTCost(model: string, promptTokens: number, completionTokens: number): number {
        const pricing: Record<string, { prompt: number; completion: number }> = {
            'gpt-4o': { prompt: 2.5, completion: 10.0 },
            'gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
            'gpt-4': { prompt: 30.0, completion: 60.0 },
            'gpt-4-turbo': { prompt: 10.0, completion: 30.0 },
            'gpt-4-turbo-preview': { prompt: 10.0, completion: 30.0 },
            'gpt-4-1106-preview': { prompt: 10.0, completion: 30.0 },
            'gpt-4-0125-preview': { prompt: 10.0, completion: 30.0 },
            'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
            'gpt-3.5-turbo-16k': { prompt: 3.0, completion: 4.0 },
            'gpt-3.5-turbo-1106': { prompt: 1.0, completion: 2.0 }
        };

        const modelPricing = pricing[model] || pricing['gpt-3.5-turbo'];
        const promptCost = (promptTokens / 1000000) * modelPricing.prompt; // Cost per million tokens
        const completionCost = (completionTokens / 1000000) * modelPricing.completion;
        
        return Number((promptCost + completionCost).toFixed(8));
    }

    /**
     * Health check endpoint
     */
    static async healthCheck(_req: Request, res: Response): Promise<void> {
        res.json({
            success: true,
            message: 'ChatGPT integration with AI-powered insights is running',
            version: '2.0.0',
            ai_features: ['bedrock_optimization', 'smart_tips', 'usage_analysis', 'automatic_connection_checking'],
            timestamp: new Date().toISOString()
        });
    }
} 