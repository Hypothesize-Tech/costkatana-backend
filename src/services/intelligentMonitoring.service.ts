import { User } from '../models/User';
import { Usage } from '../models/Usage';
import { EmailService } from './email.service';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import { RecommendationRulesService } from './recommendationRules.service';

interface ChatGPTPlan {
    name: 'free' | 'plus' | 'team' | 'enterprise';
    monthlyLimit?: number;
    dailyLimit?: number;
    features: string[];
    cost: number;
}

interface UsagePattern {
    averageTokensPerRequest: number;
    mostUsedModels: string[];
    peakUsageHours: number[];
    commonTopics: string[];
    inefficiencyScore: number; // 0-100, higher means less efficient
    aiInsights?: {
        patterns: string[];
        recommendations: string[];
        potentialSavings: number;
        optimizationOpportunities: Array<{
            prompt: string;
            reason: string;
            estimatedSaving: number;
        }>;
    };
    personalizedAnalysis?: {
        userProfile: string;
        usagePersonality: string;
        optimizationStyle: string;
        preferredModels: string[];
        costSensitivity: 'low' | 'medium' | 'high';
        technicalLevel: 'beginner' | 'intermediate' | 'advanced';
    };
}

interface SmartRecommendation {
    type: 'prompt_optimization' | 'model_switch' | 'timing' | 'cost_reduction' | 'limit_warning' | 'ai_insights' | 'personalized_coaching';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    title: string;
    message: string;
    suggestedAction: string;
    potentialSavings?: {
        tokens: number;
        cost: number;
        percentage: number;
    };
    costKatanaUrl?: string;
    aiGenerated: boolean;
    personalized: boolean;
    userContext?: string;
    confidence: number; // 0-100, AI confidence in recommendation
}

export class IntelligentMonitoringService {
    // Circuit breaker for AI service reliability
    private static aiFailureCount = 0;
    private static readonly MAX_AI_FAILURES = 3;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 5 * 60 * 1000; // 5 minutes
    private static lastFailureTime = 0;

    // Distributed locking for weekly digest sending
    private static readonly WEEKLY_DIGEST_LOCK_TTL = 3600; // 1 hour in seconds
    private static readonly WEEKLY_DIGEST_COOLDOWN = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    /**
     * Safely parse JSON from AI responses with multiple fallback strategies
     */
    private static safeJsonParse(text: string, fallback: any = {}): any {
        if (!text || typeof text !== 'string') {
            return fallback;
        }

        const cleanedText = text.trim();

        // Strategy 1: Try direct parsing
        try {
            return JSON.parse(cleanedText);
        } catch (e) {
            // Continue to other strategies
        }

        // Strategy 2: Try to extract JSON using regex patterns
        const jsonPatterns = [
            /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,  // JSON in code blocks
            /\{[\s\S]*\}/,                            // JSON objects
            /\[[\s\S]*\]/                             // JSON arrays
        ];

        for (const pattern of jsonPatterns) {
            const match = cleanedText.match(pattern);
            if (match) {
                try {
                    const extracted = match[1] || match[0];
                    return JSON.parse(extracted);
                } catch (e) {
                    // Continue to next pattern
                }
            }
        }

        // Strategy 3: Try to fix common JSON issues
        try {
            let fixedText = cleanedText;

            // Remove trailing commas
            fixedText = fixedText.replace(/,(\s*[}\]])/g, '$1');

            // Fix unquoted keys (basic)
            fixedText = fixedText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

            // Remove any remaining invalid characters at start/end
            fixedText = fixedText.replace(/^[^{[]*[{\[]/, match => match.slice(-1));
            fixedText = fixedText.replace(/[}\]][^}\]]*?$/, match => match.slice(0, 1));

            return JSON.parse(fixedText);
        } catch (e) {
            // All strategies failed
        }

        // Strategy 4: Return fallback
        loggingService.warn('Failed to parse AI response as JSON, using fallback', {
            responseSnippet: cleanedText.substring(0, 200),
            error: 'JSON parsing failed after all strategies'
        });

        return fallback;
    }
    
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    private static readonly CHATGPT_PLANS: Record<string, ChatGPTPlan> = {
        'free': {
            name: 'free',
            dailyLimit: 15,
            features: ['GPT-3.5', 'Limited GPT-4'],
            cost: 0
        },
        'plus': {
            name: 'plus',
            monthlyLimit: 50,
            dailyLimit: 100,
            features: ['GPT-4', 'GPT-3.5 Unlimited', 'DALL-E', 'Advanced Data Analysis'],
            cost: 20
        },
        'team': {
            name: 'team',
            monthlyLimit: 100,
            dailyLimit: 200,
            features: ['Higher Limits', 'Team Management', 'Admin Console'],
            cost: 25
        },
        'enterprise': {
            name: 'enterprise',
            monthlyLimit: -1,
            dailyLimit: -1,
            features: ['Unlimited', 'SSO', 'Advanced Security'],
            cost: 60
        }
    };

    /**
     * Monitor user's ChatGPT usage and send intelligent alerts
     * @param userId - User ID to monitor
     * @param urgentOnly - If true, only sends urgent alerts (not weekly digests)
     */
    static async monitorUserUsage(userId: string, urgentOnly: boolean = false): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user) return;

            // Unified database query with facet for all usage data
            const usageResults = await this.getUnifiedUsageData(userId);
            const { monthlyUsage, dailyUsage, historicalUsage } = usageResults;

            // AI-powered comprehensive analysis
            const usagePattern = await this.generateAIUsageAnalysis(userId, monthlyUsage, historicalUsage);
            const chatGPTPlan = this.detectChatGPTPlan(monthlyUsage, dailyUsage);
            
            // Parallel processing for recommendations and notifications
            const [recommendations] = await Promise.all([
                this.generateAIPersonalizedRecommendations(
                    userId, 
                    user,
                    monthlyUsage, 
                    dailyUsage, 
                    usagePattern, 
                    chatGPTPlan
                )
            ]);

            // Queue notifications for background processing
            if (recommendations.length > 0) {
                this.queueBackgroundOperation(() => 
                    this.sendIntelligentNotifications(user, recommendations, usagePattern, urgentOnly)
                );
            }

            loggingService.info('AI-powered intelligent monitoring completed', {
                userId,
                urgentOnly,
                monthlyRequests: monthlyUsage.length,
                dailyRequests: dailyUsage.length,
                recommendationsCount: recommendations.length,
                aiRecommendations: recommendations.filter(r => r.aiGenerated).length,
                personalizedRecommendations: recommendations.filter(r => r.personalized).length,
                detectedPlan: chatGPTPlan.name,
                aiInsightsGenerated: !!usagePattern.aiInsights,
                userProfile: usagePattern.personalizedAnalysis?.userProfile
            });

        } catch (error) {
            loggingService.error('Error in AI-powered intelligent monitoring:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Generate comprehensive AI-powered usage analysis with personalization
     */
    private static async generateAIUsageAnalysis(userId: string, monthlyUsage: any[], historicalUsage: any[]): Promise<UsagePattern> {
        if (monthlyUsage.length === 0) {
            return {
                averageTokensPerRequest: 0,
                mostUsedModels: [],
                peakUsageHours: [],
                commonTopics: [],
                inefficiencyScore: 0
            };
        }

        // Calculate basic metrics
        const totalTokens = monthlyUsage.reduce((sum, u) => sum + u.totalTokens, 0);
        const averageTokensPerRequest = totalTokens / monthlyUsage.length;

        // Find most used models
        const modelUsage = monthlyUsage.reduce((acc, u) => {
            acc[u.model] = (acc[u.model] || 0) + 1;
            return acc;
        }, {});
        const mostUsedModels = Object.entries(modelUsage)
            .sort(([,a], [,b]) => (b as number) - (a as number))
            .slice(0, 3)
            .map(([model]) => model);

        // Find peak usage hours
        const hourUsage = monthlyUsage.reduce((acc, u) => {
            const hour = new Date(u.createdAt).getHours();
            acc[hour] = (acc[hour] || 0) + 1;
            return acc;
        }, {} as Record<number, number>);
        const peakUsageHours = Object.entries(hourUsage)
            .sort(([,a], [,b]) => (b as number) - (a as number))
            .slice(0, 3)
            .map(([hour]) => parseInt(hour));

        // Extract topics using basic analysis
        const commonTopics = this.extractCommonTopics(monthlyUsage);

        // Calculate inefficiency score
        const inefficiencyScore = this.calculateInefficiencyScore(monthlyUsage, averageTokensPerRequest);

        // Generate heuristic profile instead of AI (eliminates AI costs)
        const personalizedAnalysis = this.generateHeuristicUserProfile(monthlyUsage, historicalUsage);

        return {
            averageTokensPerRequest,
            mostUsedModels,
            peakUsageHours,
            commonTopics,
            inefficiencyScore,
            personalizedAnalysis
        };
    }

    /**
     * Generate heuristic user profile (replaces AI-powered analysis)
     */
    private static generateHeuristicUserProfile(
        monthlyUsage: any[],
        historicalData: any[]
    ): {
        userProfile: string;
        usagePersonality: string;
        optimizationStyle: string;
        preferredModels: string[];
        costSensitivity: 'low' | 'medium' | 'high';
        technicalLevel: 'beginner' | 'intermediate' | 'advanced';
    } {
        const totalRequests = historicalData.length;
        const totalCost = historicalData.reduce((sum, u) => sum + u.cost, 0);
        const avgCost = totalRequests > 0 ? totalCost / totalRequests : 0;
        
        // Model usage analysis
        const modelCounts = historicalData.reduce((acc, u) => {
            acc[u.model] = (acc[u.model] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        const preferredModels = Object.entries(modelCounts)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 3)
            .map(([model]) => model);
        
        // Determine user type
        let userProfile = 'General AI user';
        if (totalRequests > 100) userProfile = 'Power user with high engagement';
        else if (totalRequests > 50) userProfile = 'Regular AI user';
        else userProfile = 'Occasional AI user';
        
        // Usage personality
        const usesGPT4 = preferredModels.some(m => m.includes('gpt-4'));
        const usagePersonality = usesGPT4 
            ? 'Prefers advanced models for complex tasks'
            : 'Cost-conscious user focusing on efficient models';
        
        // Optimization style
        const optimizationStyle = totalCost > 100 
            ? 'Focus on cost reduction through model switching'
            : 'Focus on efficiency and quality';
        
        // Cost sensitivity
        let costSensitivity: 'low' | 'medium' | 'high' = 'medium';
        if (avgCost > 0.05) costSensitivity = 'low';
        else if (avgCost < 0.01) costSensitivity = 'high';
        
        // Technical level based on prompt complexity
        const avgPromptLength = monthlyUsage.length > 0
            ? monthlyUsage.reduce((sum, u) => sum + ((u.prompt || '').length), 0) / monthlyUsage.length
            : 0;
        
        let technicalLevel: 'beginner' | 'intermediate' | 'advanced' = 'intermediate';
        if (avgPromptLength > 500) technicalLevel = 'advanced';
        else if (avgPromptLength < 200) technicalLevel = 'beginner';
        
        return {
            userProfile,
            usagePersonality,
            optimizationStyle,
            preferredModels,
            costSensitivity,
            technicalLevel
        };
    }

    /**
     * Generate rule-based personalized recommendations (replaces AI-powered)
     */
    private static async generateAIPersonalizedRecommendations(
        userId: string,
        user: any,
        monthlyUsage: any[],
        dailyUsage: any[],
        pattern: UsagePattern,
        plan: ChatGPTPlan
    ): Promise<SmartRecommendation[]> {
        const recommendations: SmartRecommendation[] = [];

        try {
            // Check for critical limits first (these are rule-based for immediate action)
            const monthlyGPT4Count = monthlyUsage.filter(u => u.model.includes('gpt-4')).length;
            const dailyCount = dailyUsage.length;

            // Critical limit warnings
            if (plan.monthlyLimit && plan.monthlyLimit > 0) {
                const monthlyPercentage = (monthlyGPT4Count / plan.monthlyLimit) * 100;
                
                if (monthlyPercentage >= 90) {
                    recommendations.push({
                        type: 'limit_warning',
                        priority: 'urgent',
                        title: 'Critical: Monthly ChatGPT Limit Almost Reached',
                        message: `You've used ${monthlyPercentage.toFixed(1)}% (${monthlyGPT4Count}/${plan.monthlyLimit}) of your monthly ChatGPT ${plan.name} plan limit.`,
                        suggestedAction: 'Immediate action required: Switch to GPT-3.5 or use Cost Katana\'s API access.',
                        costKatanaUrl: `${process.env.FRONTEND_URL}/emergency-optimization?source=critical_limit`,
                        aiGenerated: false,
                        personalized: false,
                        confidence: 100
                    });
                }
            }

            if (plan.dailyLimit && plan.dailyLimit > 0) {
                const dailyPercentage = (dailyCount / plan.dailyLimit) * 100;
                
                if (dailyPercentage >= 95) {
                    recommendations.push({
                        type: 'limit_warning',
                        priority: 'urgent',
                        title: 'Critical: Daily ChatGPT Limit Almost Reached',
                        message: `You've used ${dailyCount}/${plan.dailyLimit} of your daily ChatGPT messages (${dailyPercentage.toFixed(1)}%).`,
                        suggestedAction: 'Switch to Cost Katana\'s unlimited API access immediately to continue.',
                        costKatanaUrl: `${process.env.FRONTEND_URL}/api-access?source=daily_critical`,
                        aiGenerated: false,
                        personalized: false,
                        confidence: 100
                    });
                }
            }

            // Generate rule-based recommendations (replaces AI calls)
            const ruleRecommendations = RecommendationRulesService.generateRecommendations(
                userId,
                monthlyUsage,
                pattern,
                plan
            );
            recommendations.push(...ruleRecommendations);

        } catch (error) {
            loggingService.error('Error generating recommendations:', { 
                error: error instanceof Error ? error.message : String(error) 
            });
        }

        return recommendations;
    }


    /**
     * Generate personalized URLs based on recommendation context
     */
    private static generatePersonalizedURL(type: string, userId: string, context: string): string {
        const baseUrl = process.env.FRONTEND_URL || 'https://costkatana.com';
        const params = new URLSearchParams({
            source: 'ai_personalized',
            user: userId.substring(0, 8), // Privacy-safe user identifier
            context: context.substring(0, 50) // Truncate for URL safety
        });

        const pathMap: Record<string, string> = {
            'prompt_optimization': '/prompt-optimizer',
            'model_switch': '/model-selector', 
            'cost_reduction': '/cost-optimization',
            'timing': '/usage-patterns',
            'personalized_coaching': '/ai-coaching'
        };

        const path = pathMap[type] || '/dashboard';
        return `${baseUrl}${path}?${params.toString()}`;
    }

    /**
     * Detect user's ChatGPT plan based on usage patterns
     */
    private static detectChatGPTPlan(monthlyUsage: any[], dailyUsage: any[]): ChatGPTPlan {
        const monthlyGPT4Count = monthlyUsage.filter(u => u.model.includes('gpt-4')).length;
        const dailyCount = dailyUsage.length;

        // Detection logic based on usage patterns
        if (monthlyGPT4Count > 100 || dailyCount > 200) {
            return this.CHATGPT_PLANS.enterprise;
        } else if (monthlyGPT4Count > 50 || dailyCount > 100) {
            return this.CHATGPT_PLANS.team;
        } else if (monthlyGPT4Count > 10 || dailyCount > 25) {
            return this.CHATGPT_PLANS.plus;
        } else {
            return this.CHATGPT_PLANS.free;
        }
    }

    /**
     * Send intelligent email notifications with AI-personalized content
     * Separated urgent alerts from weekly digests to prevent duplicate sends
     * @param urgentOnly - If true, only sends urgent alerts (skips weekly digest)
     */
    private static async sendIntelligentNotifications(
        user: any,
        recommendations: SmartRecommendation[],
        pattern: UsagePattern,
        urgentOnly: boolean = false
    ): Promise<void> {
        const userId = user._id.toString();
        
        loggingService.info('Processing intelligent notifications', {
            userId,
            email: user.email,
            totalRecommendations: recommendations.length,
            urgentOnly,
            component: 'IntelligentMonitoring',
            operation: 'sendIntelligentNotifications'
        });
        
        // Group recommendations by priority
        const urgentRecs = recommendations.filter(r => r.priority === 'urgent');
        const highRecs = recommendations.filter(r => r.priority === 'high');
        const mediumRecs = recommendations.filter(r => r.priority === 'medium');

        loggingService.debug('Recommendations grouped by priority', {
            userId,
            urgent: urgentRecs.length,
            high: highRecs.length,
            medium: mediumRecs.length
        });

        // Send urgent notifications immediately (separate from weekly digest)
        if (urgentRecs.length > 0) {
            loggingService.info('Sending urgent alert', {
                userId,
                urgentRecsCount: urgentRecs.length
            });
            await this.sendUrgentAlert(user, urgentRecs[0]);
        }

        // Skip weekly digest if urgentOnly flag is set (used by urgent alerts cron)
        if (urgentOnly) {
            loggingService.debug('Skipping weekly digest (urgent only mode)', { userId });
            return;
        }

        // Smart weekly digest logic with engagement tracking
        if (highRecs.length > 0 || mediumRecs.length > 0) {
            const shouldSendWeeklyDigest = await this.shouldSendWeeklyDigest(userId);
            if (!shouldSendWeeklyDigest) {
                loggingService.debug('Weekly digest skipped (cooldown active)', { userId });
                return;
            }

            // Initialize email engagement if not exists
            if (!user.preferences.emailEngagement) {
                user.preferences.emailEngagement = {
                    totalSent: 0,
                    totalOpened: 0,
                    totalClicked: 0,
                    consecutiveIgnored: 0
                };
            }

            const engagement = user.preferences.emailEngagement;

            // Auto-disable for non-engaged users (3+ consecutive ignores)
            if (engagement.consecutiveIgnored >= 3) {
                loggingService.info('User has ignored 3+ consecutive emails, auto-disabling digest', { userId });
                await User.findByIdAndUpdate(user._id, {
                    'preferences.weeklyReports': false,
                    'preferences.emailEngagement.consecutiveIgnored': 0
                });
                return;
            }

            // Calculate total potential savings
            const totalSavings = recommendations.reduce((sum, r) => 
                sum + (r.potentialSavings?.cost || 0), 0
            );

            // Only send if meaningful savings (>$10) OR first-time user
            const isFirstTime = !user.preferences.lastDigestSent;
            if (totalSavings < 10 && !isFirstTime) {
                loggingService.info('Insufficient savings to warrant email', { 
                    userId, 
                    totalSavings,
                    threshold: 10
                });
                return;
            }

            // Send weekly digest
            loggingService.info('Sending weekly digest', {
                userId,
                email: user.email,
                highRecs: highRecs.length,
                mediumRecs: mediumRecs.length,
                totalSavings
            });
            
            await this.sendPersonalizedWeeklyDigest(user, [...highRecs, ...mediumRecs], pattern);
            
            // Update engagement tracking
            await User.findByIdAndUpdate(user._id, {
                'preferences.emailEngagement.totalSent': engagement.totalSent + 1,
                'preferences.emailEngagement.consecutiveIgnored': engagement.consecutiveIgnored + 1
            });
        } else {
            loggingService.debug('No weekly digest needed', {
                userId,
                reason: 'No high or medium priority recommendations'
            });
        }
    }

    /**
     * Send urgent alert email
     */
    private static async sendUrgentAlert(user: any, recommendation: SmartRecommendation): Promise<void> {
        const aiLabel = recommendation.aiGenerated ? '🤖 AI-Powered ' : '';
        const personalizedLabel = recommendation.personalized ? '👤 Personalized ' : '';
        const subject = `🚨 ${aiLabel}${personalizedLabel}${recommendation.title}`;
        
        const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h2 style="color: #dc2626; margin: 0 0 10px 0;">⚠️ ${aiLabel}${personalizedLabel}${recommendation.title}</h2>
                <p style="color: #991b1b; margin: 0;">${recommendation.message}</p>
                ${recommendation.aiGenerated ? '<p style="color: #059669; font-size: 12px; margin: 5px 0 0 0;">🤖 Generated by AI analysis of your usage patterns</p>' : ''}
                ${recommendation.personalized ? '<p style="color: #7c3aed; font-size: 12px; margin: 5px 0 0 0;">👤 Personalized for your specific usage style</p>' : ''}
                ${recommendation.confidence ? `<p style="color: #6b7280; font-size: 11px; margin: 5px 0 0 0;">Confidence: ${recommendation.confidence}%</p>` : ''}
            </div>
            
            <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #374151; margin: 0 0 10px 0;">💡 Personalized Action:</h3>
                <p style="color: #4b5563; margin: 0 0 15px 0;">${recommendation.suggestedAction}</p>
                ${recommendation.userContext ? `<p style="color: #6b7280; font-size: 14px; font-style: italic; margin: 0 0 15px 0;">Context: ${recommendation.userContext}</p>` : ''}
                
                ${recommendation.costKatanaUrl ? `
                <a href="${recommendation.costKatanaUrl}" style="background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    ${recommendation.aiGenerated ? '🤖' : ''} ${recommendation.personalized ? '👤' : ''} Take Action →
                </a>
                ` : ''}
            </div>
            
            <p style="color: #6b7280; font-size: 14px; text-align: center;">
                This ${recommendation.aiGenerated ? 'AI-powered' : 'automated'} alert was ${recommendation.personalized ? 'personalized' : 'generated'} for you by Cost Katana.
                <br><a href="${process.env.FRONTEND_URL}/settings/notifications">Manage preferences</a>
            </p>
        </div>
        `;

        await EmailService.sendEmail({
            to: user.email,
            subject,
            html
        });
        
        loggingService.info('Urgent alert sent', { value:  { 
            userId: user._id,
            email: user.email,
            alertType: recommendation.type,
            priority: recommendation.priority,
            aiGenerated: recommendation.aiGenerated,
            personalized: recommendation.personalized,
            confidence: recommendation.confidence
         } });
    }

    /**
     * Send personalized weekly optimization digest with full AI insights
     */
    private static async sendPersonalizedWeeklyDigest(
        user: any,
        recommendations: SmartRecommendation[],
        pattern: UsagePattern
    ): Promise<void> {
        const aiRecommendations = recommendations.filter(r => r.aiGenerated);
        const personalizedRecommendations = recommendations.filter(r => r.personalized);
        
        const subject = `📊 Your AI-Personalized Weekly Optimization Report`;
        
        const personalizedSection = personalizedRecommendations.length > 0 ? `
            <div style="background: #f3e8ff; border: 1px solid #c4b5fd; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #7c3aed; margin: 0 0 15px 0;">👤 Personalized Just For You</h3>
                <p style="color: #553c9a; margin: 0 0 15px 0;">Based on your ${pattern.personalizedAnalysis?.userProfile || 'usage patterns'} and ${pattern.personalizedAnalysis?.technicalLevel || 'intermediate'} technical level:</p>
                ${personalizedRecommendations.map(rec => `
                    <div style="border-left: 4px solid #8b5cf6; padding: 15px; margin: 15px 0; background: #faf5ff;">
                        <h4 style="color: #7c3aed; margin: 0 0 8px 0;">${rec.aiGenerated ? '🤖' : ''}👤 ${rec.title}</h4>
                        <p style="color: #553c9a; margin: 0 0 10px 0;">${rec.message}</p>
                        <p style="color: #8b5cf6; font-weight: 500; margin: 0;">${rec.suggestedAction}</p>
                        ${rec.userContext ? `<p style="color: #6b7280; font-size: 12px; font-style: italic; margin: 5px 0 0 0;">Why this matters to you: ${rec.userContext}</p>` : ''}
                        ${rec.potentialSavings ? `
                        <div style="background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 4px; padding: 10px; margin-top: 10px;">
                            <strong style="color: #7c3aed;">Personalized Savings:</strong> 
                            $${rec.potentialSavings.cost.toFixed(4)} per request (${rec.potentialSavings.percentage}% improvement)
                        </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        ` : '';

        const aiSection = aiRecommendations.length > 0 ? `
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #047857; margin: 0 0 15px 0;">🤖 AI-Powered Insights</h3>
                <p style="color: #065f46; margin: 0 0 15px 0;">Our AI analyzed your unique usage patterns and discovered:</p>
                ${aiRecommendations.map(rec => `
                    <div style="border-left: 4px solid #10b981; padding: 15px; margin: 15px 0; background: #f0fdf4;">
                        <h4 style="color: #047857; margin: 0 0 8px 0;">🤖 ${rec.title} ${rec.confidence ? `(${rec.confidence}% confidence)` : ''}</h4>
                        <p style="color: #065f46; margin: 0 0 10px 0;">${rec.message}</p>
                        <p style="color: #10b981; font-weight: 500; margin: 0;">${rec.suggestedAction}</p>
                        ${rec.potentialSavings ? `
                        <div style="background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 4px; padding: 10px; margin-top: 10px;">
                            <strong style="color: #047857;">AI-Calculated Savings:</strong> 
                            $${rec.potentialSavings.cost.toFixed(4)} per request (${rec.potentialSavings.percentage}%)
                        </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        ` : '';

        const userProfileSection = pattern.personalizedAnalysis ? `
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #92400e; margin: 0 0 15px 0;">🧬 Your AI Usage Profile</h3>
                <div style="color: #78350f;">
                    <p><strong>Profile:</strong> ${pattern.personalizedAnalysis.userProfile}</p>
                    <p><strong>Usage Style:</strong> ${pattern.personalizedAnalysis.usagePersonality}</p>
                    <p><strong>Technical Level:</strong> ${pattern.personalizedAnalysis.technicalLevel}</p>
                    <p><strong>Cost Sensitivity:</strong> ${pattern.personalizedAnalysis.costSensitivity}</p>
                    <p><strong>Optimization Style:</strong> ${pattern.personalizedAnalysis.optimizationStyle}</p>
                </div>
            </div>
        ` : '';

        const aiInsightsSection = pattern.aiInsights ? `
            <div style="background: #f0f9ff; border: 1px solid #7dd3fc; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #0369a1; margin: 0 0 15px 0;">🧠 Deep AI Pattern Analysis</h3>
                <p style="color: #0c4a6e; margin: 0 0 10px 0;"><strong>AI-Detected Patterns:</strong> ${pattern.aiInsights.patterns.join(', ')}</p>
                <p style="color: #0c4a6e; margin: 0 0 10px 0;"><strong>Total Potential Savings:</strong> $${pattern.aiInsights.potentialSavings.toFixed(2)}/month</p>
                <p style="color: #0c4a6e; margin: 0;"><strong>Top AI Recommendations:</strong></p>
                <ul style="color: #0c4a6e; margin: 10px 0 0 20px; padding: 0;">
                    ${pattern.aiInsights.recommendations.slice(0, 3).map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            </div>
        ` : '';

        const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; padding: 20px 0; border-bottom: 1px solid #e5e7eb;">
                <h1 style="color: #059669; margin: 0;">🤖👤 Cost Katana AI</h1>
                <p style="color: #6b7280; margin: 5px 0 0 0;">Personalized AI Cost Optimization Intelligence</p>
            </div>
            
            <div style="padding: 20px 0;">
                <h2 style="color: #374151;">Hi ${user.name},</h2>
                <p style="color: #4b5563;">Here's your personalized AI-enhanced optimization report:</p>
                
                <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #374151; margin: 0 0 15px 0;">📈 Your Usage Patterns</h3>
                    <ul style="color: #4b5563; padding-left: 20px;">
                        <li>Average tokens per request: <strong>${pattern.averageTokensPerRequest.toFixed(0)}</strong></li>
                        <li>Most used models: <strong>${pattern.mostUsedModels.join(', ')}</strong></li>
                        <li>Peak usage hours: <strong>${pattern.peakUsageHours.map(h => `${h}:00`).join(', ')}</strong></li>
                        <li>Common topics: <strong>${pattern.commonTopics.join(', ')}</strong></li>
                        <li>Efficiency score: <strong>${(100 - pattern.inefficiencyScore).toFixed(0)}%</strong></li>
                        ${pattern.aiInsights ? `<li>AI analysis: <strong>${pattern.aiInsights.patterns.length} patterns detected</strong></li>` : ''}
                        ${pattern.personalizedAnalysis ? `<li>Profile: <strong>${pattern.personalizedAnalysis.userProfile}</strong></li>` : ''}
                    </ul>
                </div>
                
                ${personalizedSection}
                ${aiSection}
                ${userProfileSection}
                ${aiInsightsSection}
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL}/dashboard?source=ai_personalized_digest&user=${user._id.toString().substring(0, 8)}" style="background: #059669; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 500;">
                        🤖👤 View Personalized Dashboard →
                    </a>
                </div>
            </div>
            
            <div style="border-top: 1px solid #e5e7eb; padding: 20px 0; text-align: center;">
                <p style="color: #6b7280; font-size: 14px; margin: 0;">
                    This report was personalized for you using AI analysis via AWS Bedrock.
                    <br><a href="${process.env.FRONTEND_URL}/settings/notifications">Manage preferences</a> | 
                    <a href="${process.env.FRONTEND_URL}/unsubscribe?token=${user._id}">Unsubscribe</a>
                </p>
            </div>
        </div>
        `;

        await EmailService.sendEmail({
            to: user.email,
            subject,
            html
        });
        
        // Update user's last digest sent timestamp
        await User.findByIdAndUpdate(user._id, {
            'preferences.lastDigestSent': new Date()
        });

        loggingService.info('AI-personalized weekly digest sent', { value:  { 
            userId: user._id,
            email: user.email,
            recommendationsCount: recommendations.length,
            aiRecommendations: aiRecommendations.length,
            personalizedRecommendations: personalizedRecommendations.length,
            aiInsightsIncluded: !!pattern.aiInsights,
            userProfile: pattern.personalizedAnalysis?.userProfile
         } });
    }

    /**
     * Helper methods
     */
    private static extractCommonTopics(usage: any[]): string[] {
        const topics: Record<string, number> = {};
        
        usage.forEach(u => {
            const text = ((u.prompt || '') + ' ' + (u.completion || '')).toLowerCase();
            
            // Enhanced keyword detection
            const keywords = {
                'coding': ['code', 'function', 'programming', 'debug', 'algorithm', 'javascript', 'python', 'react', 'api', 'software', 'development', 'bug', 'error'],
                'writing': ['write', 'essay', 'article', 'content', 'blog', 'copy', 'email', 'letter', 'document', 'draft', 'edit', 'proofread'],
                'analysis': ['analyze', 'data', 'research', 'study', 'report', 'statistics', 'metrics', 'insights', 'findings', 'conclusions'],
                'creative': ['creative', 'story', 'poem', 'design', 'brainstorm', 'ideas', 'marketing', 'campaign', 'concept', 'innovative'],
                'business': ['business', 'strategy', 'marketing', 'sales', 'plan', 'meeting', 'proposal', 'revenue', 'growth', 'market'],
                'education': ['learn', 'teach', 'explain', 'understand', 'tutorial', 'lesson', 'course', 'study', 'knowledge', 'concept'],
                'technical': ['technical', 'system', 'architecture', 'infrastructure', 'deployment', 'configuration', 'setup', 'implementation']
            };
            
            Object.entries(keywords).forEach(([topic, words]) => {
                const matches = words.filter(word => text.includes(word)).length;
                if (matches > 0) {
                    topics[topic] = (topics[topic] || 0) + matches;
                }
            });
        });
        
        return Object.entries(topics)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 4) // Increased to 4 for better context
            .map(([topic]) => topic);
    }

    private static calculateInefficiencyScore(usage: any[], _avgTokens: number): number {
        if (usage.length === 0) return 0;
        
        // Calculate inefficiency factors
        let inefficiencyFactors = 0;
        
        // Long prompts factor
        const longPrompts = usage.filter(u => (u.promptTokens || 0) > 500).length;
        inefficiencyFactors += (longPrompts / usage.length) * 30;
        
        // Poor response ratio factor
        const inefficientRatio = usage.filter(u => 
            (u.completionTokens || 0) < (u.promptTokens || 0) * 0.2 && (u.promptTokens || 0) > 100
        ).length;
        inefficiencyFactors += (inefficientRatio / usage.length) * 25;
        
        // GPT-4 for simple tasks factor
        const simpleGPT4Tasks = usage.filter(u => 
            u.model.includes('gpt-4') && u.totalTokens < 200
        ).length;
        inefficiencyFactors += (simpleGPT4Tasks / usage.length) * 35;
        
        // Repetitive patterns factor
        const repetitiveScore = this.calculateRepetitiveScoreOptimized(usage);
        inefficiencyFactors += repetitiveScore * 10;
        
        return Math.min(100, Math.max(0, inefficiencyFactors));
    }

    /**
     * Robust weekly digest check with distributed locking to prevent duplicates
     * Uses Redis for distributed locking across multiple server instances
     */
    private static async shouldSendWeeklyDigest(userId: string): Promise<boolean> {
        try {
            const user = await User.findById(userId);
            if (!user || !user.preferences.weeklyReports) {
                loggingService.debug('Weekly digest check: user preferences disabled', {
                    userId,
                    hasUser: !!user,
                    weeklyReportsEnabled: user?.preferences.weeklyReports
                });
                return false;
            }
            
            // Check last digest sent time in database
            const lastDigest = user.preferences.lastDigestSent;
            if (lastDigest) {
                const timeSinceLastDigest = Date.now() - lastDigest.getTime();
                if (timeSinceLastDigest < this.WEEKLY_DIGEST_COOLDOWN) {
                    const daysRemaining = Math.ceil((this.WEEKLY_DIGEST_COOLDOWN - timeSinceLastDigest) / (1000 * 60 * 60 * 24));
                    loggingService.debug('Weekly digest check: cooldown period not met', {
                        userId,
                        lastDigestSent: lastDigest.toISOString(),
                        daysRemaining,
                        cooldownDays: 7
                    });
                    return false;
                }
            }
            
            // Distributed lock check using Redis
            const lockKey = `weekly_digest_lock:${userId}`;
            
            try {
                // Check if Redis is connected
                if (!redisService.isConnected) {
                    loggingService.warn('Weekly digest check: Redis not connected, using database fallback', {
                        userId
                    });
                    throw new Error('Redis not connected');
                }
                
                // Try to acquire lock with NX (only set if not exists) and EX (expiration)
                // This ensures only ONE cron job/process can send the weekly digest
                const lockAcquired = await redisService.client.set(lockKey, Date.now().toString(), {
                    NX: true, // Only set if key doesn't exist
                    EX: this.WEEKLY_DIGEST_LOCK_TTL // Expire after 1 hour
                });
                
                if (!lockAcquired) {
                    loggingService.info('Weekly digest check: lock already held by another process', {
                        userId,
                        lockKey,
                        component: 'IntelligentMonitoring',
                        operation: 'shouldSendWeeklyDigest',
                        preventedDuplicate: true
                    });
                    return false;
                }
                
                loggingService.info('Weekly digest check: lock acquired successfully', {
                    userId,
                    lockKey,
                    component: 'IntelligentMonitoring',
                    operation: 'shouldSendWeeklyDigest'
                });
                
                return true;
            } catch (redisError) {
                // If Redis is unavailable, fall back to in-memory check with database
                loggingService.warn('Weekly digest check: Redis unavailable, using database fallback', {
                    userId,
                    error: redisError instanceof Error ? redisError.message : String(redisError)
                });
                
                // Use database update with atomic operation as fallback
                const now = new Date();
                const updateResult = await User.findOneAndUpdate(
                    {
                        _id: userId,
                        $or: [
                            { 'preferences.lastDigestSent': { $exists: false } },
                            { 'preferences.lastDigestSent': { $lt: new Date(Date.now() - this.WEEKLY_DIGEST_COOLDOWN) } }
                        ]
                    },
                    {
                        $set: { 'preferences.lastDigestSent': now }
                    },
                    { new: true }
                );
                
                return !!updateResult;
            }
        } catch (error) {
            loggingService.error('Error checking weekly digest eligibility', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Utility method to clear weekly digest lock for a user (admin/debugging only)
     * Use this if a lock is stuck and preventing reports from being sent
     */
    static async clearWeeklyDigestLock(userId: string): Promise<boolean> {
        try {
            if (!redisService.isConnected) {
                loggingService.warn('Cannot clear lock: Redis not connected', { userId });
                return false;
            }
            
            const lockKey = `weekly_digest_lock:${userId}`;
            const result = await redisService.client.del(lockKey);
            
            loggingService.info('Weekly digest lock cleared', {
                userId,
                lockKey,
                existed: result > 0,
                component: 'IntelligentMonitoring',
                operation: 'clearWeeklyDigestLock'
            });
            
            return result > 0;
        } catch (error) {
            loggingService.error('Error clearing weekly digest lock', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Run intelligent monitoring for all active users
     */
    static async runDailyMonitoring(): Promise<void> {
        try {
            const activeUsers = await User.find({
                isActive: true,
                'preferences.emailAlerts': true
            }).select('_id');

            loggingService.info(`Running AI-powered daily monitoring for ${activeUsers.length} users`);

            const promises = activeUsers.map(user => 
                this.monitorUserUsage(user._id.toString()).catch(error => 
                    loggingService.error(`Failed to monitor user ${user._id}:`, error)
                )
            );

            await Promise.all(promises);
            
            loggingService.info('AI-powered daily monitoring completed successfully');
        } catch (error) {
            loggingService.error('Error in daily monitoring:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Unified database query with facet for all usage data
     */
    private static async getUnifiedUsageData(userId: string): Promise<{
        monthlyUsage: any[];
        dailyUsage: any[];
        historicalUsage: any[];
    }> {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const startOf3Months = new Date();
        startOf3Months.setMonth(startOf3Months.getMonth() - 3);

        const results = await Usage.aggregate([
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
                        { $sort: { createdAt: -1 } },
                        {
                            $project: {
                                prompt: 1,
                                completion: 1,
                                totalTokens: 1,
                                promptTokens: 1,
                                completionTokens: 1,
                                cost: 1,
                                model: 1,
                                createdAt: 1,
                                responseTime: 1,
                                metadata: 1
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
                    ],
                    historicalUsage: [
                        { $match: { createdAt: { $gte: startOf3Months } } },
                        { $sort: { createdAt: -1 } },
                        { $limit: 500 },
                        {
                            $project: {
                                prompt: 1,
                                completion: 1,
                                totalTokens: 1,
                                cost: 1,
                                model: 1,
                                createdAt: 1,
                                metadata: 1
                            }
                        }
                    ]
                }
            }
        ]);

        const result = results[0] || {};
        return {
            monthlyUsage: result.monthlyUsage || [],
            dailyUsage: result.dailyUsage || [],
            historicalUsage: result.historicalUsage || []
        };
    }

    /**
     * Execute operation with circuit breaker pattern
     */
    private static async executeWithCircuitBreaker<T>(operation: () => Promise<T>): Promise<T | null> {
        // Check if circuit breaker is open
        if (this.isCircuitBreakerOpen()) {
            loggingService.warn('AI service circuit breaker is open, skipping operation');
            return null;
        }

        try {
            const result = await Promise.race([
                operation(),
                new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('AI operation timeout')), 15000)
                )
            ]);
            
            // Reset failure count on success
            this.aiFailureCount = 0;
            return result;
        } catch (error) {
            this.recordFailure();
            loggingService.error('AI operation failed:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    /**
     * Check if circuit breaker is open
     */
    private static isCircuitBreakerOpen(): boolean {
        if (this.aiFailureCount < this.MAX_AI_FAILURES) {
            return false;
        }

        const timeSinceLastFailure = Date.now() - this.lastFailureTime;
        if (timeSinceLastFailure > this.CIRCUIT_BREAKER_RESET_TIME) {
            this.aiFailureCount = 0;
            return false;
        }

        return true;
    }

    /**
     * Record AI service failure
     */
    private static recordFailure(): void {
        this.aiFailureCount++;
        this.lastFailureTime = Date.now();
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
        }, 100);
    }

    /**
     * Process background queue
     */
    private static async processBackgroundQueue(): Promise<void> {
        const operations = this.backgroundQueue.splice(0, 2); // Process 2 at a time
        await Promise.allSettled(operations.map(op => op()));
    }

    /**
     * Optimized repetitive score calculation
     */
    private static calculateRepetitiveScoreOptimized(usage: any[]): number {
        if (usage.length < 2) return 0;
        
        // Use Map for faster lookups
        const promptMap = new Map<string, number>();
        let similarCount = 0;
        
        usage.forEach((u, i) => {
            const prompt = (u.prompt || '').toLowerCase().substring(0, 100);
            const similar = Array.from(promptMap.entries()).filter(([key]) => 
                this.calculateSimilarityOptimized(prompt, key) > 0.7
            );
            
            if (similar.length > 0) {
                similarCount += similar.length;
            }
            
            promptMap.set(prompt, i);
        });
        
        return usage.length > 0 ? similarCount / usage.length : 0;
    }

    /**
     * Optimized similarity calculation using vectorized operations
     */
    private static calculateSimilarityOptimized(str1: string, str2: string): number {
        if (!str1 || !str2) return 0;
        
        const words1 = new Set(str1.toLowerCase().split(' '));
        const words2 = new Set(str2.toLowerCase().split(' '));
        
        // Use Set intersection for faster comparison
        const intersection = new Set(Array.from(words1).filter(x => words2.has(x)));
        const union = new Set([...Array.from(words1), ...Array.from(words2)]);
        
        return intersection.size / union.size;
    }
} 