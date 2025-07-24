import { Request, Response } from 'express';
import { ProjectService } from '../services/project.service';
import { UsageService } from '../services/usage.service';
import { IntelligentMonitoringService } from '../services/intelligentMonitoring.service';
import { BedrockService } from '../services/bedrock.service';
import { logger } from '../utils/logger';

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
        action: 'track_usage' | 'create_project' | 'get_projects' | 'get_analytics' | 'generate_magic_link';
    };
}

export class ChatGPTController {
    /**
     * Main endpoint for ChatGPT Custom GPT actions
     */
    static async handleAction(req: ChatGPTRequest, res: Response): Promise<void> {
        try {
            logger.info('ChatGPT action received:', {
                action: req.body.action,
                hasUserId: !!req.body.user_id,
                hasApiKey: !!req.body.api_key,
                hasEmail: !!req.body.email
            });

            const { action, user_id, api_key } = req.body;

            // Handle magic link generation first (no auth required)
            if (action === 'generate_magic_link') {
                await ChatGPTController.generateMagicLink(req, res);
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
                // Try both ChatGPT integration keys and dashboard API keys
                let validation: any = null;
                
                // First try ChatGPT integration API keys (ck_user_ format)
                if (api_key.startsWith('ck_user_')) {
                const { ApiKeyController } = await import('./apiKey.controller');
                    validation = await ApiKeyController.validateApiKey(api_key);
                }
                
                // If no validation yet, try dashboard API keys (dak_ format or full key)
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
                        // Handle full dashboard API keys (starts with user ID)
                        else {
                            // Try to extract user ID from the key format
                            const userIdMatch = api_key.match(/^[a-f0-9]{24}_/);
                            if (userIdMatch) {
                                const potentialUserId = userIdMatch[0].slice(0, -1); // Remove trailing underscore
                                const user = await User.findById(potentialUserId);
                                if (user && user.dashboardApiKeys) {
                                    // Check if this key matches any encrypted key
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
                                                // Continue to next key
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
                            keyFormat: api_key.startsWith('ck_user_') ? 'ChatGPT Integration Key' : 
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
                    message: 'Welcome to Cost Katana! Let me help you get connected in 30 seconds.',
                    instructions: {
                        step1: 'I need your email to create a magic link',
                        step2: 'Click the magic link to instantly connect your account',
                        step3: 'Come back here and start tracking your AI costs!',
                        example: 'Just say: "My email is john@example.com" and I\'ll create your magic link!'
                    }
                });
                return;
            }

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
                    res.status(400).json({
                        success: false,
                        error: 'Invalid action. Supported actions: track_usage, create_project, get_projects, get_analytics, generate_magic_link'
                    });
            }
        } catch (error: any) {
            logger.error('ChatGPT controller error:', error);
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
        try {
            // Extract email from either direct body or onboarding object
            const email = req.body.email || req.body.onboarding?.email;
            const name = req.body.name || req.body.onboarding?.name;
            const source = req.body.source || req.body.onboarding?.source || 'chatgpt';

            if (!email) {
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
     * Track ChatGPT conversation usage with AI-powered insights
     */
    private static async trackUsage(req: ChatGPTRequest, res: Response, userId: string): Promise<void> {
        try {
            const { conversation_data } = req.body;

            if (!conversation_data) {
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

            // Trigger intelligent monitoring in background (non-blocking)
            IntelligentMonitoringService.monitorUserUsage(userId).catch(error => 
                logger.error('Background monitoring failed:', error)
            );

            // Generate AI-powered smart tip
            const smartTip = await ChatGPTController.generateAISmartTip(
                userId, 
                conversation_data.model, 
                totalTokens, 
                cost,
                conversation_data.prompt,
                conversation_data.response
            );

            res.json({
                success: true,
                message: 'Usage tracked successfully',
                data: {
                    usage_id: usage?._id,
                    cost: usage?.cost,
                    tokens: usage?.totalTokens,
                    estimated_monthly_cost: cost * 30, // Rough estimate
                    message: `Tracked ${totalTokens} tokens for $${cost.toFixed(6)}`,
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
     * Generate AI-powered smart tip using Bedrock service
     */
    private static async generateAISmartTip(
        userId: string, 
        model: string, 
        tokens: number, 
        cost: number,
        prompt: string,
        response: string
    ): Promise<string> {
        try {
            // Get recent usage to provide context-aware tips
            const { Usage } = await import('../models/Usage');
            const recentUsage = await Usage.find({
                userId,
                service: 'openai',
                'metadata.source': 'chatgpt-custom-gpt'
            }).limit(10).sort({ createdAt: -1 });

            if (recentUsage.length < 2) {
                return "💡 Tip: Track more conversations to get AI-powered personalized optimization recommendations!";
            }

            // Calculate basic metrics for context
            const avgTokens = recentUsage.reduce((sum, u) => sum + u.totalTokens, 0) / recentUsage.length;
            const gpt4Usage = recentUsage.filter(u => u.model.includes('gpt-4')).length;

            // Try to get AI-powered optimization tip
            try {
                const optimizationRequest = {
                    prompt,
                    model,
                    service: 'openai',
                    context: `User's average tokens: ${avgTokens.toFixed(0)}, Current tokens: ${tokens}, Model: ${model}, Response quality: ${response.length > 100 ? 'detailed' : 'concise'}`,
                    targetReduction: 20,
                    preserveIntent: true
                };

                const aiOptimization = await BedrockService.optimizePrompt(optimizationRequest);
                
                if (aiOptimization.estimatedTokenReduction > 15) {
                    return `🤖 AI Tip: Your prompt can be optimized to save ${aiOptimization.estimatedTokenReduction}% tokens. Try: "${aiOptimization.optimizedPrompt.substring(0, 80)}..." - Technique: ${aiOptimization.techniques[0]}`;
                }
            } catch (aiError) {
                logger.warn('AI optimization tip failed, using fallback:', aiError);
            }

            // Fallback to pattern-based tips
            if (tokens > avgTokens * 1.5) {
                return `💡 Smart Tip: This conversation used ${Math.round(((tokens - avgTokens) / avgTokens) * 100)}% more tokens than your average. Try shorter, more focused prompts for better efficiency.`;
            }

            if (model.includes('gpt-4') && tokens < 200) {
                return "💡 Efficiency Tip: For simple tasks like this, GPT-3.5 Turbo could save you 95% while providing similar quality!";
            }

            if (gpt4Usage / recentUsage.length > 0.7) {
                return "💡 Cost Tip: You use GPT-4 frequently. Consider using GPT-3.5 for simpler tasks to significantly reduce costs.";
            }

            if (cost > 0.01) {
                return `💡 Budget Tip: High-cost conversation detected ($${cost.toFixed(4)}). Break complex requests into smaller parts for better cost control.`;
            }

            // Positive reinforcement for good usage patterns
            if (tokens < avgTokens * 0.8) {
                return "✨ Excellent! This conversation was very token-efficient. Keep up the concise prompting!";
            }

            // Topic-specific AI tips
            const promptLower = prompt.toLowerCase();
            if (promptLower.includes('code') || promptLower.includes('programming') || promptLower.includes('debug')) {
                return "🤖 Coding Tip: For programming questions, start with specific error messages or code snippets to get more targeted, efficient responses.";
            }

            if (promptLower.includes('explain') || promptLower.includes('how does')) {
                return "🤖 Learning Tip: For explanations, specify your knowledge level (beginner/intermediate/advanced) to get appropriately detailed responses.";
            }

            return "📊 Visit your Cost Katana dashboard for AI-powered analytics and personalized optimization recommendations.";

        } catch (error) {
            logger.error('Error generating AI smart tip:', error);
            return "🤖 Tip: Check your Cost Katana dashboard for AI-powered optimization insights!";
        }
    }

    /**
     * Create a new project from ChatGPT
     */
    private static async createProject(req: ChatGPTRequest, res: Response, userId: string): Promise<void> {
        try {
            const { project } = req.body;

            if (!project || !project.name) {
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
    private static async getProjects(_req: ChatGPTRequest, res: Response, userId: string): Promise<void> {
        try {
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
    private static async getAnalytics(_req: ChatGPTRequest, res: Response, userId: string): Promise<void> {
        try {
            // Get user's recent usage stats
            const stats = await UsageService.getUsageStats(userId, 'monthly');
            const projects = await ProjectService.getUserProjects(userId);

            const totalSpending = projects.reduce((sum, project) => sum + project.spending.current, 0);
            const totalBudget = projects.reduce((sum, project) => sum + project.budget.amount, 0);

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
            logger.error('Get analytics error:', error);
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
            ai_features: ['bedrock_optimization', 'smart_tips', 'usage_analysis'],
            timestamp: new Date().toISOString()
        });
    }
} 