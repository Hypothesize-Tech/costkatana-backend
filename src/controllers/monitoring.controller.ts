import { Response } from 'express';
import { IntelligentMonitoringService } from '../services/intelligentMonitoring.service';
import { Usage } from '../models/Usage';
import { logger } from '../utils/logger';

export class MonitoringController {
    /**
     * Trigger intelligent monitoring for a specific user
     */
    static async triggerUserMonitoring(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            
            await IntelligentMonitoringService.monitorUserUsage(userId);
            
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
            logger.error('Error triggering user monitoring:', error);
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
        try {
            const userId = req.user!.id;
            
            // Get current month usage
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const monthlyUsage = await Usage.find({
                userId: userId,
                service: 'openai',
                createdAt: { $gte: startOfMonth },
                'metadata.source': 'chatgpt-custom-gpt'
            });

            // Get today's usage
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const dailyUsage = await Usage.find({
                userId: userId,
                service: 'openai',
                createdAt: { $gte: startOfDay },
                'metadata.source': 'chatgpt-custom-gpt'
            });

            // Calculate statistics
            const monthlyGPT4Count = monthlyUsage.filter(u => u.model.includes('gpt-4')).length;
            const monthlyGPT35Count = monthlyUsage.filter(u => u.model.includes('gpt-3.5')).length;
            const totalMonthlyCost = monthlyUsage.reduce((sum, u) => sum + u.cost, 0);
            const averageTokensPerRequest = monthlyUsage.length > 0 
                ? monthlyUsage.reduce((sum, u) => sum + u.totalTokens, 0) / monthlyUsage.length 
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
                            potential_savings: 'Up to 95% cost reduction on suitable tasks'
                        }] : [])
                    ]
                }
            });

        } catch (error: any) {
            logger.error('Error getting user usage status:', error);
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
        try {
            const userId = req.user!.id;
            
            // This would normally come from a cache or recent analysis
            // For now, we'll trigger a quick analysis
            
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const recentUsage = await Usage.find({
                userId: userId,
                service: 'openai',
                createdAt: { $gte: startOfMonth },
                'metadata.source': 'chatgpt-custom-gpt'
            }).limit(50).sort({ createdAt: -1 });

            const recommendations = [];

            if (recentUsage.length === 0) {
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

            res.json({
                success: true,
                data: {
                    recommendations,
                    analysis_based_on: `${recentUsage.length} recent ChatGPT interactions`,
                    last_updated: new Date().toISOString()
                }
            });

        } catch (error: any) {
            logger.error('Error getting smart recommendations:', error);
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
        try {
            // Check if user is admin
            if (req.user.role !== 'admin') {
                res.status(403).json({
                    success: false,
                    error: 'Admin access required'
                });
                return;
            }

            // Run monitoring in background
            IntelligentMonitoringService.runDailyMonitoring().catch(error => 
                logger.error('Background monitoring failed:', error)
            );

            res.json({
                success: true,
                message: 'Daily monitoring triggered for all users',
                timestamp: new Date().toISOString()
            });

        } catch (error: any) {
            logger.error('Error triggering daily monitoring:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to trigger daily monitoring',
                message: error.message
            });
        }
    }
} 