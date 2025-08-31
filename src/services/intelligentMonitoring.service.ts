import { User } from '../models/User';
import { Usage } from '../models/Usage';
import { EmailService } from './email.service';
import { BedrockService } from './bedrock.service';
import { loggingService } from './logging.service';

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
     */
    static async monitorUserUsage(userId: string): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user) return;

            // Get comprehensive usage data for AI analysis
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const monthlyUsage = await Usage.find({
                userId: userId,
                service: 'openai',
                createdAt: { $gte: startOfMonth },
                'metadata.source': 'chatgpt-custom-gpt'
            }).sort({ createdAt: -1 });

            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const dailyUsage = await Usage.find({
                userId: userId,
                service: 'openai',
                createdAt: { $gte: startOfDay },
                'metadata.source': 'chatgpt-custom-gpt'
            });

            // Get historical data for better AI context (last 3 months)
            const startOf3Months = new Date();
            startOf3Months.setMonth(startOf3Months.getMonth() - 3);

            const historicalUsage = await Usage.find({
                userId: userId,
                service: 'openai',
                createdAt: { $gte: startOf3Months },
                'metadata.source': 'chatgpt-custom-gpt'
            }).sort({ createdAt: -1 }).limit(500); // Limit for performance

            // AI-powered comprehensive analysis
            const usagePattern = await this.generateAIUsageAnalysis(userId, monthlyUsage, historicalUsage);
            const chatGPTPlan = this.detectChatGPTPlan(monthlyUsage, dailyUsage);
            
            // Generate 100% AI-powered personalized recommendations
            const recommendations = await this.generateAIPersonalizedRecommendations(
                userId, 
                user,
                monthlyUsage, 
                dailyUsage, 
                usagePattern, 
                chatGPTPlan
            );

            // Send notifications if needed
            if (recommendations.length > 0) {
                await this.sendIntelligentNotifications(user, recommendations, usagePattern);
            }

            loggingService.info('AI-powered intelligent monitoring completed', {
                userId,
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

        // Extract topics using basic analysis (will be enhanced by AI)
        const commonTopics = this.extractCommonTopics(monthlyUsage);

        // Get AI-powered comprehensive insights
        let aiInsights = undefined;
        let personalizedAnalysis = undefined;

        if (monthlyUsage.length >= 3) {
            try {
                // Prepare comprehensive data for AI analysis
                const usageData = monthlyUsage.map(u => ({
                    prompt: u.prompt || 'No prompt available',
                    tokens: u.totalTokens,
                    cost: u.cost,
                    model: u.model,
                    timestamp: u.createdAt,
                    promptTokens: u.promptTokens || 0,
                    completionTokens: u.completionTokens || 0,
                    responseTime: u.responseTime || 0,
                    metadata: u.metadata || {}
                }));

                // Historical context for better AI analysis
                const historicalData = historicalUsage.map(u => ({
                    prompt: u.prompt || 'No prompt available',
                    tokens: u.totalTokens,
                    cost: u.cost,
                    model: u.model,
                    timestamp: u.createdAt,
                    metadata: u.metadata || {}
                }));

                // AI-powered usage pattern analysis
                aiInsights = await BedrockService.analyzeUsagePatterns({
                    usageData,
                    timeframe: 'monthly'
                });

                // Get personalized user profile analysis using AI
                personalizedAnalysis = await this.generatePersonalizedUserProfile(userId, usageData, historicalData);

                loggingService.info('AI insights and personalization generated successfully', { value:  { 
                    userId,
                    potentialSavings: aiInsights.potentialSavings,
                    patternsFound: aiInsights.patterns.length,
                    userProfile: personalizedAnalysis.userProfile,
                    technicalLevel: personalizedAnalysis.technicalLevel
                 } });

            } catch (error) {
                loggingService.warn('Failed to generate AI insights and personalization:', { error: error instanceof Error ? error.message : String(error) });
            }
        }

        // Calculate inefficiency score (basic calculation, enhanced by AI insights)
        const inefficiencyScore = this.calculateInefficiencyScore(monthlyUsage, averageTokensPerRequest);

        return {
            averageTokensPerRequest,
            mostUsedModels,
            peakUsageHours,
            commonTopics,
            inefficiencyScore,
            aiInsights,
            personalizedAnalysis
        };
    }

    /**
     * Generate personalized user profile using AI analysis
     */
    private static async generatePersonalizedUserProfile(
        _userId: string, 
        usageData: any[], 
        historicalData: any[]
    ): Promise<{
        userProfile: string;
        usagePersonality: string;
        optimizationStyle: string;
        preferredModels: string[];
        costSensitivity: 'low' | 'medium' | 'high';
        technicalLevel: 'beginner' | 'intermediate' | 'advanced';
    }> {
        try {
            const profileAnalysisPrompt = `You are an AI user behavior analyst. Analyze this user's AI usage patterns to create a comprehensive personality profile for personalized optimization recommendations.

CURRENT MONTH USAGE DATA:
${usageData.slice(0, 20).map(u => 
    `- ${u.timestamp.toISOString().split('T')[0]}: "${u.prompt.substring(0, 100)}..." (${u.tokens} tokens, ${u.model}, $${u.cost.toFixed(4)})`
).join('\n')}

HISTORICAL USAGE PATTERNS:
- Total historical requests: ${historicalData.length}
- Average tokens over time: ${historicalData.reduce((sum, u) => sum + u.tokens, 0) / historicalData.length || 0}
- Most used models: ${[...new Set(historicalData.map(u => u.model))].slice(0, 5).join(', ')}
- Usage frequency: ${historicalData.length > 50 ? 'Heavy user' : historicalData.length > 20 ? 'Regular user' : 'Light user'}

Please analyze and provide a detailed user profile in JSON format:

{
    "userProfile": "one_sentence_description_of_user_type",
    "usagePersonality": "description_of_how_they_use_AI", 
    "optimizationStyle": "what_optimization_approach_would_work_best",
    "preferredModels": ["list", "of", "models", "they", "prefer"],
    "costSensitivity": "low|medium|high based on spending patterns",
    "technicalLevel": "beginner|intermediate|advanced based on prompt complexity",
    "personalizedTips": [
        "specific_tip_1_for_this_user",
        "specific_tip_2_for_this_user",
        "specific_tip_3_for_this_user"
    ],
    "optimizationPriorities": [
        "what_to_optimize_first",
        "what_to_optimize_second",
        "what_to_optimize_third"
    ]
}

Make this highly specific to the user's actual usage patterns, not generic advice.`;

            const response = await BedrockService.invokeModel(profileAnalysisPrompt, process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0');
            const cleanedResponse = BedrockService.extractJson(response);
            const profileData = JSON.parse(cleanedResponse);

            return {
                userProfile: profileData.userProfile || 'General AI user',
                usagePersonality: profileData.usagePersonality || 'Mixed usage patterns',
                optimizationStyle: profileData.optimizationStyle || 'Balanced optimization approach',
                preferredModels: profileData.preferredModels || [],
                costSensitivity: profileData.costSensitivity || 'medium',
                technicalLevel: profileData.technicalLevel || 'intermediate'
            };

        } catch (error) {
            loggingService.warn('Failed to generate personalized user profile:', { error: error instanceof Error ? error.message : String(error) });
            return {
                userProfile: 'AI user with mixed patterns',
                usagePersonality: 'Varied AI usage',
                optimizationStyle: 'Balanced approach',
                preferredModels: [],
                costSensitivity: 'medium',
                technicalLevel: 'intermediate'
            };
        }
    }

    /**
     * Generate 100% AI-powered personalized recommendations
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
            // Check for critical limits first (these can be rule-based for immediate action)
            const monthlyGPT4Count = monthlyUsage.filter(u => u.model.includes('gpt-4')).length;
            const dailyCount = dailyUsage.length;

            // Critical limit warnings (immediate, rule-based)
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

            // Now generate AI-powered personalized recommendations
            if (monthlyUsage.length >= 3) {
                const aiRecommendations = await this.generateComprehensiveAIRecommendations(
                    userId, 
                    user, 
                    monthlyUsage, 
                    pattern, 
                    plan
                );
                recommendations.push(...aiRecommendations);
            }

            // If we don't have enough data, generate AI-powered onboarding recommendations
            if (monthlyUsage.length < 3) {
                const onboardingRecommendations = await this.generateAIOnboardingRecommendations(userId, user, monthlyUsage);
                recommendations.push(...onboardingRecommendations);
            }

        } catch (error) {
            loggingService.error('Error generating AI personalized recommendations:', { error: error instanceof Error ? error.message : String(error) });
            
            // Fallback: Generate at least one helpful recommendation
            recommendations.push({
                type: 'ai_insights',
                priority: 'medium',
                title: 'AI Analysis Temporarily Unavailable',
                message: 'Our AI optimization engine is temporarily unavailable, but we\'re still tracking your usage patterns.',
                suggestedAction: 'Check your Cost Katana dashboard for basic optimization insights, and we\'ll provide AI-powered recommendations once the service is restored.',
                costKatanaUrl: `${process.env.FRONTEND_URL}/dashboard?source=ai_fallback`,
                aiGenerated: false,
                personalized: false,
                confidence: 70
            });
        }

        return recommendations;
    }

    /**
     * Generate comprehensive AI-powered recommendations based on user data
     */
    private static async generateComprehensiveAIRecommendations(
        _userId: string,
        user: any,
        monthlyUsage: any[],
        pattern: UsagePattern,
        plan: ChatGPTPlan
    ): Promise<SmartRecommendation[]> {
        try {
            const totalCost = monthlyUsage.reduce((sum, u) => sum + u.cost, 0);
            const avgTokens = pattern.averageTokensPerRequest;
            
            // Comprehensive AI analysis prompt
            const recommendationPrompt = `You are an AI cost optimization expert for Cost Katana. Analyze this user's ChatGPT usage and create highly personalized, actionable recommendations.

USER PROFILE:
- Name: ${user.name}
- User Type: ${pattern.personalizedAnalysis?.userProfile || 'Regular AI user'}
- Technical Level: ${pattern.personalizedAnalysis?.technicalLevel || 'intermediate'}
- Cost Sensitivity: ${pattern.personalizedAnalysis?.costSensitivity || 'medium'}
- Usage Personality: ${pattern.personalizedAnalysis?.usagePersonality || 'Mixed usage'}

CURRENT USAGE ANALYSIS:
- ChatGPT Plan: ${plan.name} ($${plan.cost}/month)
- Monthly Usage: ${monthlyUsage.length} requests
- Total Monthly Cost: $${totalCost.toFixed(2)}
- Average Tokens/Request: ${avgTokens.toFixed(0)}
- Most Used Models: ${pattern.mostUsedModels.join(', ')}
- Common Topics: ${pattern.commonTopics.join(', ')}
- Peak Hours: ${pattern.peakUsageHours.map(h => `${h}:00`).join(', ')}
- Inefficiency Score: ${pattern.inefficiencyScore}/100

TOP RECENT CONVERSATIONS:
${monthlyUsage.slice(0, 10).map((u, i) => 
    `${i+1}. ${u.model} (${u.totalTokens} tokens, $${u.cost.toFixed(4)}): "${(u.prompt || '').substring(0, 80)}..."`
).join('\n')}

AI DETECTED PATTERNS:
${pattern.aiInsights ? `
- Patterns: ${pattern.aiInsights.patterns.join(', ')}
- AI Recommendations: ${pattern.aiInsights.recommendations.join('; ')}
- Potential Savings: $${pattern.aiInsights.potentialSavings.toFixed(2)}
` : 'No AI insights available'}

Please generate 3-5 highly personalized recommendations in JSON format. Each recommendation should be:
1. Specific to this user's actual usage patterns
2. Actionable with clear next steps
3. Include estimated savings when possible
4. Prioritized by impact and user preference
5. Use their technical level and cost sensitivity

JSON Format:
{
    "recommendations": [
        {
            "type": "prompt_optimization|model_switch|cost_reduction|timing|personalized_coaching",
            "priority": "low|medium|high",
            "title": "specific_actionable_title",
            "message": "personalized_message_explaining_the_insight",
            "suggestedAction": "specific_next_step_for_this_user",
            "potentialSavings": {
                "tokens": estimated_token_savings,
                "cost": estimated_cost_savings_per_request,
                "percentage": percentage_improvement
            },
            "confidence": confidence_score_0_to_100,
            "userContext": "why_this_is_relevant_to_this_specific_user",
            "reasoning": "detailed_explanation_of_the_analysis"
        }
    ]
}

Make recommendations highly specific to their usage patterns, not generic advice.`;

            const response = await BedrockService.invokeModel(recommendationPrompt, process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0');
            const cleanedResponse = BedrockService.extractJson(response);
            const aiRecommendations = JSON.parse(cleanedResponse);

            // Convert AI recommendations to our format
            const recommendations: SmartRecommendation[] = aiRecommendations.recommendations.map((rec: any) => ({
                type: rec.type || 'personalized_coaching',
                priority: rec.priority || 'medium',
                title: rec.title,
                message: rec.message,
                suggestedAction: rec.suggestedAction,
                potentialSavings: rec.potentialSavings ? {
                    tokens: rec.potentialSavings.tokens || 0,
                    cost: rec.potentialSavings.cost || 0,
                    percentage: rec.potentialSavings.percentage || 0
                } : undefined,
                costKatanaUrl: this.generatePersonalizedURL(rec.type, _userId, rec.userContext),
                aiGenerated: true,
                personalized: true,
                userContext: rec.userContext || '',
                confidence: rec.confidence || 80
            }));

            loggingService.info('AI-powered personalized recommendations generated', {
                userId: _userId,
                recommendationsCount: recommendations.length,
                avgConfidence: recommendations.reduce((sum, r) => sum + r.confidence, 0) / recommendations.length,
                types: recommendations.map(r => r.type)
            });

            return recommendations;

        } catch (error) {
            loggingService.error('Error generating comprehensive AI recommendations:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Generate AI-powered onboarding recommendations for new users
     */
    private static async generateAIOnboardingRecommendations(
        _userId: string,
        user: any,
        limitedUsage: any[]
    ): Promise<SmartRecommendation[]> {
        try {
            const onboardingPrompt = `You are an AI onboarding specialist for Cost Katana. This user just started using our ChatGPT cost tracking. Create personalized onboarding recommendations.

USER INFO:
- Name: ${user.name}
- Email: ${user.email}
- Usage So Far: ${limitedUsage.length} ChatGPT conversations tracked

EARLY USAGE PATTERNS:
${limitedUsage.map((u, i) => 
    `${i+1}. ${u.model} (${u.totalTokens} tokens): "${(u.prompt || '').substring(0, 60)}..."`
).join('\n')}

Create 2-3 welcoming, educational recommendations that help them:
1. Understand Cost Katana's value
2. Learn optimization best practices
3. Set up their account for success
4. Get early wins

JSON Format:
{
    "recommendations": [
        {
            "title": "welcome_focused_title",
            "message": "encouraging_educational_message",
            "suggestedAction": "specific_next_step",
            "confidence": 90
        }
    ]
}`;

            const response = await BedrockService.invokeModel(onboardingPrompt, process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0');
            const cleanedResponse = BedrockService.extractJson(response);
            const onboardingData = JSON.parse(cleanedResponse);

            return onboardingData.recommendations.map((rec: any) => ({
                type: 'personalized_coaching' as const,
                priority: 'medium' as const,
                title: rec.title,
                message: rec.message,
                suggestedAction: rec.suggestedAction,
                costKatanaUrl: `${process.env.FRONTEND_URL}/onboarding?source=ai_welcome`,
                aiGenerated: true,
                personalized: true,
                userContext: 'New user onboarding',
                confidence: rec.confidence || 85
            }));

        } catch (error) {
            loggingService.error('Error generating AI onboarding recommendations:', { error: error instanceof Error ? error.message : String(error) });
            
            // Fallback onboarding recommendation
            return [{
                type: 'personalized_coaching',
                priority: 'medium',
                title: 'Welcome to Cost Katana!',
                message: 'Great start! You\'ve begun tracking your ChatGPT usage. Keep using ChatGPT normally, and we\'ll provide personalized optimization insights as we learn your patterns.',
                suggestedAction: 'Continue using ChatGPT and check back in a few days for AI-powered personalized recommendations.',
                costKatanaUrl: `${process.env.FRONTEND_URL}/getting-started?source=welcome`,
                aiGenerated: false,
                personalized: true,
                userContext: 'New user encouragement',
                confidence: 80
            }];
        }
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
     */
    private static async sendIntelligentNotifications(
        user: any,
        recommendations: SmartRecommendation[],
        pattern: UsagePattern
    ): Promise<void> {
        // Group recommendations by priority
        const urgentRecs = recommendations.filter(r => r.priority === 'urgent');
        const highRecs = recommendations.filter(r => r.priority === 'high');
        const mediumRecs = recommendations.filter(r => r.priority === 'medium');

        // Send urgent notifications immediately
        if (urgentRecs.length > 0) {
            await this.sendUrgentAlert(user, urgentRecs[0]);
        }

        // Send personalized weekly digest for medium/high priority recommendations
        const shouldSendWeeklyDigest = await this.shouldSendWeeklyDigest(user._id);
        if (shouldSendWeeklyDigest && (highRecs.length > 0 || mediumRecs.length > 0)) {
            await this.sendPersonalizedWeeklyDigest(user, [...highRecs, ...mediumRecs], pattern);
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
        const repetitiveScore = this.calculateRepetitiveScore(usage);
        inefficiencyFactors += repetitiveScore * 10;
        
        return Math.min(100, Math.max(0, inefficiencyFactors));
    }

    private static calculateRepetitiveScore(usage: any[]): number {
        if (usage.length < 2) return 0;
        
        const prompts = usage.map(u => (u.prompt || '').toLowerCase().substring(0, 100));
        let similarCount = 0;
        
        for (let i = 0; i < prompts.length; i++) {
            for (let j = i + 1; j < prompts.length; j++) {
                const similarity = this.calculateSimilarity(prompts[i], prompts[j]);
                if (similarity > 0.7) similarCount++;
            }
        }
        
        return prompts.length > 0 ? similarCount / prompts.length : 0;
    }

    private static calculateSimilarity(str1: string, str2: string): number {
        if (!str1 || !str2) return 0;
        
        const words1 = str1.split(' ');
        const words2 = str2.split(' ');
        const common = words1.filter(word => words2.includes(word)).length;
        return common / Math.max(words1.length, words2.length);
    }

    private static async shouldSendWeeklyDigest(userId: string): Promise<boolean> {
        const user = await User.findById(userId);
        if (!user || !user.preferences.weeklyReports) return false;
        
        const lastDigest = user.preferences.lastDigestSent;
        if (!lastDigest) return true;
        
        const daysSinceLastDigest = (Date.now() - lastDigest.getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceLastDigest >= 7;
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
} 