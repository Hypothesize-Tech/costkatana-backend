import { Response } from 'express';
import { IntelligentMonitoringService } from '../services/intelligentMonitoring.service';
import { Usage } from '../models/Usage';
import { loggingService } from '../services/logging.service';

export class MonitoringController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Date range utilities
    private static dateRanges = new Map<string, { start: Date; end: Date }>();
    /**
     * Trigger intelligent monitoring for a specific user
     */
    static async triggerUserMonitoring(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;

        try {
            loggingService.info('User monitoring trigger initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('User monitoring processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });
            
            await IntelligentMonitoringService.monitorUserUsage(userId);

            const duration = Date.now() - startTime;

            loggingService.info('User monitoring triggered successfully', {
                userId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_monitoring_triggered',
                category: 'monitoring_operations',
                value: duration,
                metadata: {
                    userId
                }
            });
            
            res.json({
                success: true,
                message: 'Intelligent monitoring triggered successfully',
                data: {
                    userId,
                    timestamp: new Date().toISOString(),
                    message: 'Your usage patterns have been analyzed and recommendations will be sent if applicable.'
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User monitoring trigger failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to trigger monitoring',
                message: error.message
            });
        }
    }

    /**
     * Get user's current usage status and predictions
     */
    static async getUserUsageStatus(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;

        try {
            loggingService.info('User usage status retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('User usage status processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });
            
            // Get optimized date ranges
            const { startOfMonth, startOfDay } = this.getOptimizedDateRanges();

            // Unified query with facet for all usage data
            const usageResults = await Usage.aggregate([
                {
                    $match: {
                        userId: userId,
                        service: 'openai',
                        'metadata.source': 'chatgpt-custom-gpt'
                    }
                },
                {
                    $facet: {
                        monthlyUsage: [
                            { $match: { createdAt: { $gte: startOfMonth } } },
                            {
                                $project: {
                                    model: 1,
                                    cost: 1,
                                    totalTokens: 1,
                                    createdAt: 1
                                }
                            }
                        ],
                        dailyUsage: [
                            { $match: { createdAt: { $gte: startOfDay } } },
                            {
                                $project: {
                                    model: 1,
                                    createdAt: 1
                                }
                            }
                        ]
                    }
                }
            ]);

            const monthlyUsage = usageResults[0]?.monthlyUsage || [];
            const dailyUsage = usageResults[0]?.dailyUsage || [];

            // Calculate statistics
            const monthlyGPT4Count = monthlyUsage.filter((u: any) => u.model.includes('gpt-4')).length;
            const monthlyGPT35Count = monthlyUsage.filter((u: any) => u.model.includes('gpt-3.5')).length;
            const totalMonthlyCost = monthlyUsage.reduce((sum: number, u: any) => sum + u.cost, 0);
            const averageTokensPerRequest = monthlyUsage.length > 0 
                ? monthlyUsage.reduce((sum: number, u: any) => sum + u.totalTokens, 0) / monthlyUsage.length 
                : 0;

            // Detect likely ChatGPT plan
            let detectedPlan = 'free';
            let estimatedLimits = { monthly: 15, daily: 15 };

            if (monthlyGPT4Count > 100 || dailyUsage.length > 200) {
                detectedPlan = 'enterprise';
                estimatedLimits = { monthly: -1, daily: -1 };
            } else if (monthlyGPT4Count > 50 || dailyUsage.length > 100) {
                detectedPlan = 'team';
                estimatedLimits = { monthly: 100, daily: 200 };
            } else if (monthlyGPT4Count > 10 || dailyUsage.length > 25) {
                detectedPlan = 'plus';
                estimatedLimits = { monthly: 50, daily: 100 };
            }

            // Calculate usage percentages
            const monthlyUsagePercentage = estimatedLimits.monthly > 0 
                ? (monthlyGPT4Count / estimatedLimits.monthly) * 100 
                : 0;
            const dailyUsagePercentage = estimatedLimits.daily > 0 
                ? (dailyUsage.length / estimatedLimits.daily) * 100 
                : 0;

            // Generate predictions
            const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            const currentDay = new Date().getDate();
            const projectedMonthlyUsage = estimatedLimits.monthly > 0 
                ? Math.ceil((monthlyGPT4Count / currentDay) * daysInMonth)
                : monthlyGPT4Count;

            // Generate warnings
            const warnings = [];
            if (monthlyUsagePercentage >= 80) {
                warnings.push({
                    type: 'monthly_limit',
                    severity: 'high',
                    message: `You've used ${monthlyUsagePercentage.toFixed(1)}% of your estimated monthly limit`,
                    suggestion: 'Consider optimizing prompts or switching to GPT-3.5 for simpler tasks'
                });
            }

            if (dailyUsagePercentage >= 90) {
                warnings.push({
                    type: 'daily_limit',
                    severity: 'urgent',
                    message: `You've used ${dailyUsagePercentage.toFixed(1)}% of your estimated daily limit`,
                    suggestion: 'You may hit your daily limit soon. Consider using Cost Katana\'s direct API access.'
                });
            }

            if (projectedMonthlyUsage > estimatedLimits.monthly && estimatedLimits.monthly > 0) {
                warnings.push({
                    type: 'projection',
                    severity: 'medium',
                    message: `At current pace, you'll use ${projectedMonthlyUsage} requests this month (${((projectedMonthlyUsage / estimatedLimits.monthly) * 100).toFixed(1)}% of limit)`,
                    suggestion: 'Consider optimizing your usage patterns to stay within limits'
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('User usage status retrieved successfully', {
                userId,
                duration,
                monthlyUsageCount: monthlyUsage.length,
                dailyUsageCount: dailyUsage.length,
                monthlyGPT4Count,
                monthlyGPT35Count,
                totalMonthlyCost,
                averageTokensPerRequest: Math.round(averageTokensPerRequest),
                detectedPlan,
                monthlyUsagePercentage: Math.round(monthlyUsagePercentage * 100) / 100,
                dailyUsagePercentage: Math.round(dailyUsagePercentage * 100) / 100,
                projectedMonthlyUsage,
                warningsCount: warnings.length,
                hasWarnings: warnings.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_usage_status_retrieved',
                category: 'monitoring_operations',
                value: duration,
                metadata: {
                    userId,
                    monthlyUsageCount: monthlyUsage.length,
                    dailyUsageCount: dailyUsage.length,
                    monthlyGPT4Count,
                    monthlyGPT35Count,
                    totalMonthlyCost,
                    averageTokensPerRequest: Math.round(averageTokensPerRequest),
                    detectedPlan,
                    monthlyUsagePercentage: Math.round(monthlyUsagePercentage * 100) / 100,
                    dailyUsagePercentage: Math.round(dailyUsagePercentage * 100) / 100,
                    projectedMonthlyUsage,
                    warningsCount: warnings.length,
                    hasWarnings: warnings.length > 0
                }
            });

            res.json({
                success: true,
                data: {
                    current_usage: {
                        today: {
                            total_requests: dailyUsage.length,
                            percentage_of_limit: dailyUsagePercentage,
                            estimated_limit: estimatedLimits.daily
                        },
                        this_month: {
                            total_requests: monthlyUsage.length,
                            gpt4_requests: monthlyGPT4Count,
                            gpt35_requests: monthlyGPT35Count,
                            total_cost: totalMonthlyCost,
                            percentage_of_limit: monthlyUsagePercentage,
                            estimated_limit: estimatedLimits.monthly
                        }
                    },
                    patterns: {
                        average_tokens_per_request: Math.round(averageTokensPerRequest),
                        preferred_model: monthlyGPT4Count > monthlyGPT35Count ? 'GPT-4' : 'GPT-3.5',
                        daily_average: Math.round(monthlyUsage.length / currentDay)
                    },
                    predictions: {
                        projected_monthly_requests: projectedMonthlyUsage,
                        projected_monthly_cost: (totalMonthlyCost / currentDay) * daysInMonth,
                        days_until_limit: estimatedLimits.monthly > 0 && monthlyGPT4Count > 0
                            ? Math.ceil((estimatedLimits.monthly - monthlyGPT4Count) / (monthlyGPT4Count / currentDay))
                            : null
                    },
                    detected_plan: {
                        name: detectedPlan,
                        confidence: detectedPlan === 'free' ? 0.7 : 0.85,
                        estimated_monthly_cost: detectedPlan === 'free' ? 0 : detectedPlan === 'plus' ? 20 : detectedPlan === 'team' ? 25 : 60
                    },
                    warnings,
                    optimization_opportunities: [
                        ...(averageTokensPerRequest > 300 ? [{
                            type: 'prompt_optimization',
                            message: 'Your prompts average ' + Math.round(averageTokensPerRequest) + ' tokens. Consider using more concise prompts.',
                            potential_savings: Math.round(averageTokensPerRequest * 0.3) + ' tokens per request'
                        }] : []),
                        ...(monthlyGPT4Count > monthlyGPT35Count && monthlyUsage.length > 20 ? [{
                            type: 'model_selection',
                            message: 'You use GPT-4 frequently. Many tasks could work with GPT-3.5 at 95% lower cost.',
                            potential_benefit: 'Up to 95% cost reduction on suitable tasks'
                        }] : [])
                    ]
                }
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User usage status retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to get usage status',
                message: error.message
            });
        }
    }

    /**
     * Get smart recommendations for the user
     */
    static async getSmartRecommendations(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;

        try {
            loggingService.info('Smart recommendations retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('Smart recommendations processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });
            
            // Get optimized date ranges
            const { startOfMonth } = this.getOptimizedDateRanges();

            // Memory-efficient usage query with projection
            const recentUsage = await Usage.find({
                userId: userId,
                service: 'openai',
                createdAt: { $gte: startOfMonth },
                'metadata.source': 'chatgpt-custom-gpt'
            })
            .select('model totalTokens promptTokens createdAt')
            .limit(50)
            .sort({ createdAt: -1 })
            .lean();

            const recommendations = [];

            if (recentUsage.length === 0) {
                const duration = Date.now() - startTime;

                loggingService.info('Smart recommendations retrieved successfully - no usage data', {
                    userId,
                    duration,
                    recentUsageCount: recentUsage.length,
                    recommendationsCount: recommendations.length,
                    requestId: req.headers['x-request-id'] as string
                });

                // Log business event
                loggingService.logBusiness({
                    event: 'smart_recommendations_retrieved',
                    category: 'monitoring_operations',
                    value: duration,
                    metadata: {
                        userId,
                        recentUsageCount: recentUsage.length,
                        recommendationsCount: recommendations.length,
                        hasRecommendations: false
                    }
                });

                res.json({
                    success: true,
                    data: {
                        recommendations: [],
                        message: 'Start using ChatGPT with Cost Katana to get personalized recommendations!'
                    }
                });
                return;
            }

            // Analyze recent patterns for quick recommendations
            const avgTokens = recentUsage.reduce((sum, u) => sum + u.totalTokens, 0) / recentUsage.length;
            const gpt4Usage = recentUsage.filter(u => u.model.includes('gpt-4')).length;
            const longPrompts = recentUsage.filter(u => u.promptTokens > 400).length;

            if (avgTokens > 350) {
                recommendations.push({
                    type: 'prompt_optimization',
                    priority: 'high',
                    title: 'Optimize Your Prompt Length',
                    description: `Your prompts average ${Math.round(avgTokens)} tokens. Shorter, more focused prompts often get better results.`,
                    action: 'Try Cost Katana\'s Prompt Optimizer',
                    potential_benefit: 'Save 30-50% on tokens',
                    url: `${process.env.FRONTEND_URL}/prompt-optimizer?avg_tokens=${Math.round(avgTokens)}`
                });
            }

            if (gpt4Usage / recentUsage.length > 0.6) {
                recommendations.push({
                    type: 'model_selection',
                    priority: 'high',
                    title: 'Smart Model Selection',
                    description: `You use GPT-4 for ${Math.round((gpt4Usage / recentUsage.length) * 100)}% of requests. Many could work with GPT-3.5.`,
                    action: 'Use Smart Model Selector',
                    potential_benefit: 'Save up to 95% on suitable tasks',
                    url: `${process.env.FRONTEND_URL}/model-selector?current_usage=${gpt4Usage}`
                });
            }

            if (longPrompts > recentUsage.length * 0.3) {
                recommendations.push({
                    type: 'prompt_structure',
                    priority: 'medium',
                    title: 'Improve Prompt Structure',
                    description: `${Math.round((longPrompts / recentUsage.length) * 100)}% of your prompts are very long. Consider breaking complex requests into steps.`,
                    action: 'Learn prompt structuring techniques',
                    potential_benefit: 'Better results with fewer tokens',
                    url: `${process.env.FRONTEND_URL}/guides/prompt-structuring`
                });
            }

            // Add general recommendations
            recommendations.push({
                type: 'analytics',
                priority: 'low',
                title: 'Track Your Progress',
                description: 'Monitor your optimization progress with detailed analytics and insights.',
                action: 'View Analytics Dashboard',
                potential_benefit: 'Understand your AI usage patterns',
                url: `${process.env.FRONTEND_URL}/analytics?source=recommendations`
            });

            const duration = Date.now() - startTime;

            loggingService.info('Smart recommendations retrieved successfully', {
                userId,
                duration,
                recentUsageCount: recentUsage.length,
                recommendationsCount: recommendations.length,
                hasRecommendations: recommendations.length > 0,
                avgTokens: Math.round(avgTokens),
                gpt4Usage,
                gpt4UsagePercentage: Math.round((gpt4Usage / recentUsage.length) * 100),
                longPrompts,
                longPromptsPercentage: Math.round((longPrompts / recentUsage.length) * 100),
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'smart_recommendations_retrieved',
                category: 'monitoring_operations',
                value: duration,
                metadata: {
                    userId,
                    recentUsageCount: recentUsage.length,
                    recommendationsCount: recommendations.length,
                    hasRecommendations: recommendations.length > 0,
                    avgTokens: Math.round(avgTokens),
                    gpt4Usage,
                    gpt4UsagePercentage: Math.round((gpt4Usage / recentUsage.length) * 100),
                    longPrompts,
                    longPromptsPercentage: Math.round((longPrompts / recentUsage.length) * 100)
                }
            });

            res.json({
                success: true,
                data: {
                    recommendations,
                    analysis_based_on: `${recentUsage.length} recent ChatGPT interactions`,
                    last_updated: new Date().toISOString()
                }
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Smart recommendations retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to get recommendations',
                message: error.message
            });
        }
    }

    /**
     * Manually trigger daily monitoring for all users (admin only)
     */
    static async triggerDailyMonitoring(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const userRole = req.user?.role;

        try {
            loggingService.info('Daily monitoring trigger initiated', {
                userId,
                hasUserId: !!userId,
                userRole,
                hasUserRole: !!userRole,
                requestId: req.headers['x-request-id'] as string
            });

            // Check if user is admin
            if (req.user.role !== 'admin') {
                loggingService.warn('Daily monitoring trigger failed - admin access required', {
                    userId,
                    userRole,
                    hasUserRole: !!userRole,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(403).json({
                    success: false,
                    error: 'Admin access required'
                });
                return;
            }

            loggingService.info('Daily monitoring trigger processing started', {
                userId,
                userRole,
                requestId: req.headers['x-request-id'] as string
            });

            // Run monitoring in background
            IntelligentMonitoringService.runDailyMonitoring().catch(error => 
                loggingService.error('Background monitoring failed', {
                    userId,
                    userRole,
                    error: error.message || 'Unknown error',
                    stack: error.stack,
                    requestId: req.headers['x-request-id'] as string
                })
            );

            const duration = Date.now() - startTime;

            loggingService.info('Daily monitoring triggered successfully for all users', {
                userId,
                userRole,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'daily_monitoring_triggered',
                category: 'monitoring_operations',
                value: duration,
                metadata: {
                    userId,
                    userRole
                }
            });

            res.json({
                success: true,
                message: 'Daily monitoring triggered for all users',
                timestamp: new Date().toISOString()
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Daily monitoring trigger failed', {
                userId,
                userRole,
                hasUserRole: !!userRole,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to trigger daily monitoring',
                message: error.message
            });
        }
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Get optimized date ranges with memoization
     */
    private static getOptimizedDateRanges(): { startOfMonth: Date; startOfDay: Date } {
        const today = new Date().toDateString();
        
        if (!this.dateRanges.has(today)) {
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            this.dateRanges.set(today, { start: startOfMonth, end: startOfDay });
            
            // Clean old entries (keep only today)
            if (this.dateRanges.size > 1) {
                const keysToDelete = Array.from(this.dateRanges.keys()).filter(key => key !== today);
                keysToDelete.forEach(key => this.dateRanges.delete(key));
            }
        }

        const ranges = this.dateRanges.get(today)!;
        return { startOfMonth: ranges.start, startOfDay: ranges.end };
    }

    /**
     * Queue background operation
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
        this.startBackgroundProcessor();
    }

    /**
     * Start background processor
     */
    private static startBackgroundProcessor(): void {
        if (this.backgroundProcessor) return;

        this.backgroundProcessor = setTimeout(async () => {
            await this.processBackgroundQueue();
            this.backgroundProcessor = undefined;

            if (this.backgroundQueue.length > 0) {
                this.startBackgroundProcessor();
            }
        }, 50);
    }

    /**
     * Process background queue
     */
    private static async processBackgroundQueue(): Promise<void> {
        const operations = this.backgroundQueue.splice(0, 3); // Process 3 at a time
        await Promise.allSettled(operations.map(op => op()));
    }
} 