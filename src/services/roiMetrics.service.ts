import mongoose from 'mongoose';
import { loggingService } from './logging.service';
import { SimulationTrackingService } from './simulationTracking.service';
import { Usage } from '../models/Usage';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { EmailService } from './email.service';

export interface ProjectROIMetrics {
    projectId: string;
    projectName: string;
    timeRange: {
        startDate: Date;
        endDate: Date;
    };
    
    // Cost metrics
    totalCost: number;
    previousPeriodCost: number;
    costChange: number;
    costChangePercentage: number;
    
    // Optimization metrics
    totalSimulations: number;
    optimizationsApplied: number;
    potentialSavings: number;
    actualSavings: number;
    savingsRate: number; // actualSavings / totalCost
    
    // Usage metrics
    totalRequests: number;
    totalTokens: number;
    averageCostPerRequest: number;
    averageTokensPerRequest: number;
    
    // Model breakdown
    modelBreakdown: Array<{
        model: string;
        cost: number;
        requests: number;
        tokens: number;
        percentage: number;
    }>;
    
    // Top optimizations
    topOptimizations: Array<{
        type: string;
        count: number;
        totalSavings: number;
        averageSavings: number;
    }>;
    
    // Efficiency trends
    trends: {
        dailyCosts: Array<{ date: string; cost: number; savings: number }>;
        modelEfficiency: Array<{ model: string; costPerToken: number; trend: 'up' | 'down' | 'stable' }>;
    };
}

export interface UserROISummary {
    userId: string;
    userName: string;
    email: string;
    timeRange: {
        startDate: Date;
        endDate: Date;
    };
    
    // Overall metrics
    totalSavings: number;
    totalOptimizations: number;
    rank: number;
    totalUsers: number;
    
    // Project-level metrics
    projects: ProjectROIMetrics[];
    
    // Achievements
    achievements: Array<{
        type: 'cost_saver' | 'efficiency_expert' | 'optimization_champion' | 'consistent_user';
        title: string;
        description: string;
        earnedAt: Date;
    }>;
    
    // Recommendations
    recommendations: Array<{
        priority: 'high' | 'medium' | 'low';
        title: string;
        description: string;
        potentialSavings: number;
        action: string;
    }>;
}

export class ROIMetricsService {
    
    /**
     * Calculate ROI metrics for a project
     */
    static async calculateProjectROI(
        projectId: string,
        startDate: Date,
        endDate: Date
    ): Promise<ProjectROIMetrics> {
        try {
            const project = await Project.findById(projectId).lean();
            if (!project) {
                throw new Error('Project not found');
            }

            // Calculate previous period for comparison
            const periodDuration = endDate.getTime() - startDate.getTime();
            const previousStartDate = new Date(startDate.getTime() - periodDuration);
            const previousEndDate = new Date(startDate.getTime());

            // Get usage data for current period
            const currentUsage = await Usage.find({
                projectId: new mongoose.Types.ObjectId(projectId),
                createdAt: { $gte: startDate, $lte: endDate }
            }).lean();

            // Get usage data for previous period
            const previousUsage = await Usage.find({
                projectId: new mongoose.Types.ObjectId(projectId),
                createdAt: { $gte: previousStartDate, $lte: previousEndDate }
            }).lean();

            // Calculate basic metrics
            const totalCost = currentUsage.reduce((sum, usage) => sum + usage.cost, 0);
            const previousPeriodCost = previousUsage.reduce((sum, usage) => sum + usage.cost, 0);
            const costChange = totalCost - previousPeriodCost;
            const costChangePercentage = previousPeriodCost > 0 ? (costChange / previousPeriodCost) * 100 : 0;

            const totalRequests = currentUsage.length;
            const totalTokens = currentUsage.reduce((sum, usage) => sum + usage.totalTokens, 0);
            const averageCostPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;
            const averageTokensPerRequest = totalRequests > 0 ? totalTokens / totalRequests : 0;

            // Get simulation data
            const simulationStats = await SimulationTrackingService.getSimulationStats(
                undefined, // Get all users for this project
                { startDate, endDate }
            );

            // Calculate model breakdown
            const modelMap = new Map<string, { cost: number; requests: number; tokens: number }>();
            currentUsage.forEach(usage => {
                const existing = modelMap.get(usage.model) || { cost: 0, requests: 0, tokens: 0 };
                modelMap.set(usage.model, {
                    cost: existing.cost + usage.cost,
                    requests: existing.requests + 1,
                    tokens: existing.tokens + usage.totalTokens
                });
            });

            const modelBreakdown = Array.from(modelMap.entries()).map(([model, data]) => ({
                model,
                cost: data.cost,
                requests: data.requests,
                tokens: data.tokens,
                percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0
            })).sort((a, b) => b.cost - a.cost);

            // Calculate actual savings from applied optimizations
            const actualSavings = await this.calculateActualSavings(projectId, startDate, endDate);

            // Generate daily cost trends with actual savings
            const dailyCosts = await this.generateDailyCostTrends(currentUsage, projectId, startDate, endDate);

            // Calculate model efficiency trends
            const modelEfficiency = this.calculateModelEfficiencyTrends(currentUsage, previousUsage);

            return {
                projectId,
                projectName: project.name,
                timeRange: { startDate, endDate },
                totalCost,
                previousPeriodCost,
                costChange,
                costChangePercentage,
                totalSimulations: simulationStats.totalSimulations,
                optimizationsApplied: simulationStats.totalOptimizationsApplied,
                potentialSavings: simulationStats.totalPotentialSavings,
                actualSavings,
                savingsRate: totalCost > 0 ? actualSavings / totalCost : 0,
                totalRequests,
                totalTokens,
                averageCostPerRequest,
                averageTokensPerRequest,
                modelBreakdown,
                topOptimizations: simulationStats.topOptimizationTypes.map(opt => ({
                    type: opt.type,
                    count: opt.count,
                    totalSavings: opt.averageSavings * opt.count,
                    averageSavings: opt.averageSavings
                })),
                trends: {
                    dailyCosts,
                    modelEfficiency
                }
            };
        } catch (error) {
            loggingService.error('Error calculating project ROI:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Generate user ROI summary
     */
    static async generateUserROISummary(
        userId: string,
        startDate: Date,
        endDate: Date
    ): Promise<UserROISummary> {
        try {
            const user = await User.findById(userId).lean();
            if (!user) {
                throw new Error('User not found');
            }

            // Get user's projects
            const projects = await Project.find({
                $or: [
                    { ownerId: new mongoose.Types.ObjectId(userId) },
                    { 'members.userId': new mongoose.Types.ObjectId(userId) }
                ]
            }).lean();

            // Calculate metrics for each project
            const projectMetrics = await Promise.all(
                projects.map(project => 
                    this.calculateProjectROI(project._id.toString(), startDate, endDate)
                )
            );

            // Calculate overall user metrics
            const totalSavings = projectMetrics.reduce((sum, project) => sum + project.actualSavings, 0);
            const totalOptimizations = projectMetrics.reduce((sum, project) => sum + project.optimizationsApplied, 0);

            // Get user's rank
            const leaderboard = await SimulationTrackingService.getTopOptimizationWins(
                { startDate, endDate },
                1000 // Get a large number to find user's rank
            );
            
            const userRank = leaderboard.findIndex(entry => entry.userId === userId) + 1;
            const totalUsers = leaderboard.length;

            // Generate achievements
            const achievements = this.generateAchievements(userId, projectMetrics, leaderboard);

            // Generate recommendations
            const recommendations = this.generateRecommendations(projectMetrics);

            return {
                userId,
                userName: user.name || user.email,
                email: user.email,
                timeRange: { startDate, endDate },
                totalSavings,
                totalOptimizations,
                rank: userRank || totalUsers + 1,
                totalUsers,
                projects: projectMetrics,
                achievements,
                recommendations
            };
        } catch (error) {
            loggingService.error('Error generating user ROI summary:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Send weekly ROI summary email
     */
    static async sendWeeklyROISummary(userId: string): Promise<void> {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 7); // Last 7 days

            const summary = await this.generateUserROISummary(userId, startDate, endDate);

            if (summary.totalSavings === 0 && summary.totalOptimizations === 0) {
                loggingService.info(`No activity for user ${userId}, skipping weekly summary`);
                return;
            }

            const emailContent = this.generateEmailContent(summary);

            await EmailService.sendEmail({
                to: summary.email,
                subject: 'Your Weekly Cost Optimization Summary 📊',
                text: emailContent.text,
                html: emailContent.html
            });

            loggingService.info(`Sent weekly ROI summary to user: ${userId}`);
        } catch (error) {
            loggingService.error('Error sending weekly ROI summary:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Send weekly summaries to all active users
     */
    static async sendWeeklyROISummariesToAllUsers(): Promise<void> {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 7);

            // Get users who had activity in the last week
            const activeUsers = await Usage.distinct('userId', {
                createdAt: { $gte: startDate, $lte: endDate }
            });

            loggingService.info(`Sending weekly ROI summaries to ${activeUsers.length} active users`);

            for (const userId of activeUsers) {
                try {
                    await this.sendWeeklyROISummary(userId.toString());
                    // Add small delay to avoid overwhelming email service
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    loggingService.error(`Error sending summary to user ${userId}:`, { error: error instanceof Error ? error.message : String(error) });
                }
            }

            loggingService.info('Completed sending weekly ROI summaries');
        } catch (error) {
            loggingService.error('Error sending weekly ROI summaries to all users:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Calculate actual savings from applied optimizations
     */
    private static async calculateActualSavings(
        _projectId: string,
        _startDate: Date,
        _endDate: Date
    ): Promise<number> {
        try {
            // Get all applied optimizations for the project in the time range
            const appliedOptimizations = await SimulationTrackingService.getAppliedOptimizations(
                undefined,
                _projectId,
                { startDate: _startDate, endDate: _endDate }
            );

            let totalSavings = 0;

            for (const applied of appliedOptimizations) {
                const optimization = applied.optimization;
                const originalUsage = applied.originalUsage;

                if (!originalUsage || !optimization) continue;

                // Calculate actual savings based on optimization type
                switch (optimization.type) {
                    case 'model_switch':
                        totalSavings += await SimulationTrackingService.calculateModelSwitchActualSavings(
                            optimization,
                            originalUsage,
                            applied.appliedAt
                        );
                        break;
                    
                    case 'context_trim':
                        totalSavings += await SimulationTrackingService.calculateContextTrimActualSavings(
                            optimization,
                            originalUsage,
                            applied.appliedAt
                        );
                        break;
                    
                    case 'prompt_optimize':
                        totalSavings += await SimulationTrackingService.calculatePromptOptimizeActualSavings(
                            optimization,
                            originalUsage,
                            applied.appliedAt
                        );
                        break;
                    
                    default:
                        // For unknown optimization types, use the estimated savings
                        totalSavings += optimization.estimatedSavings || 0;
                }
            }

            return totalSavings;
            
            /*
            let totalSavings = 0;

            for (const optimization of appliedOptimizations) {
                // Calculate savings based on optimization type
                switch (optimization.type) {
                    case 'model_switch':
                        totalSavings += await this.calculateModelSwitchSavings(
                            optimization,
                            projectId,
                            startDate,
                            endDate
                        );
                        break;
                    
                    case 'prompt_optimization':
                        totalSavings += await this.calculatePromptOptimizationSavings(
                            optimization,
                            projectId,
                            startDate,
                            endDate
                        );
                        break;
                    
                    case 'batch_processing':
                        totalSavings += await this.calculateBatchProcessingSavings(
                            optimization,
                            projectId,
                            startDate,
                            endDate
                        );
                        break;
                    
                    case 'caching':
                        totalSavings += await this.calculateCachingSavings(
                            optimization,
                            projectId,
                            startDate,
                            endDate
                        );
                        break;
                    
                    default:
                        // For unknown optimization types, use the estimated savings
                        totalSavings += optimization.estimatedSavings || 0;
                }
            }

            return totalSavings;
            */
        } catch (error) {
            loggingService.error('Error calculating actual savings:', { error: error instanceof Error ? error.message : String(error) });
            return 0;
        }
    }



    /**
     * Generate daily cost trends with actual savings
     */
    private static async generateDailyCostTrends(
        usage: any[],
        projectId: string,
        startDate: Date,
        endDate: Date
    ): Promise<Array<{ date: string; cost: number; savings: number }>> {
        const trends = [];
        const currentDate = new Date(startDate);

        while (currentDate <= endDate) {
            const dayStart = new Date(currentDate);
            const dayEnd = new Date(currentDate);
            dayEnd.setHours(23, 59, 59, 999);

            const dayUsage = usage.filter(u => {
                const usageDate = new Date(u.createdAt);
                return usageDate >= dayStart && usageDate <= dayEnd;
            });

            const cost = dayUsage.reduce((sum, u) => sum + u.cost, 0);
            
            // Calculate actual savings for this day
            const daySavings = await this.calculateActualSavings(
                projectId,
                dayStart,
                dayEnd
            );
            
            trends.push({
                date: currentDate.toISOString().split('T')[0],
                cost,
                savings: daySavings
            });

            currentDate.setDate(currentDate.getDate() + 1);
        }

        return trends;
    }

    /**
     * Calculate model efficiency trends
     */
    private static calculateModelEfficiencyTrends(
        currentUsage: any[],
        previousUsage: any[]
    ): Array<{ model: string; costPerToken: number; trend: 'up' | 'down' | 'stable' }> {
        const currentModelStats = new Map<string, { cost: number; tokens: number }>();
        const previousModelStats = new Map<string, { cost: number; tokens: number }>();

        // Calculate current period stats
        currentUsage.forEach(usage => {
            const existing = currentModelStats.get(usage.model) || { cost: 0, tokens: 0 };
            currentModelStats.set(usage.model, {
                cost: existing.cost + usage.cost,
                tokens: existing.tokens + usage.totalTokens
            });
        });

        // Calculate previous period stats
        previousUsage.forEach(usage => {
            const existing = previousModelStats.get(usage.model) || { cost: 0, tokens: 0 };
            previousModelStats.set(usage.model, {
                cost: existing.cost + usage.cost,
                tokens: existing.tokens + usage.totalTokens
            });
        });

        const trends = [];
        for (const [model, stats] of currentModelStats) {
            const costPerToken = stats.tokens > 0 ? stats.cost / stats.tokens : 0;
            const previousStats = previousModelStats.get(model);
            const previousCostPerToken = previousStats && previousStats.tokens > 0 
                ? previousStats.cost / previousStats.tokens 
                : 0;

            let trend: 'up' | 'down' | 'stable' = 'stable';
            if (previousCostPerToken > 0) {
                const change = (costPerToken - previousCostPerToken) / previousCostPerToken;
                if (change > 0.05) trend = 'up';
                else if (change < -0.05) trend = 'down';
            }

            trends.push({
                model,
                costPerToken,
                trend
            });
        }

        return trends.sort((a, b) => b.costPerToken - a.costPerToken);
    }

    /**
     * Generate achievements based on user performance
     */
    private static generateAchievements(
        userId: string,
        projectMetrics: ProjectROIMetrics[],
        leaderboard: any[]
    ): Array<{
        type: 'cost_saver' | 'efficiency_expert' | 'optimization_champion' | 'consistent_user';
        title: string;
        description: string;
        earnedAt: Date;
    }> {
        const achievements = [];
        const userRank = leaderboard.findIndex(entry => entry.userId === userId) + 1;
        const totalSavings = projectMetrics.reduce((sum, project) => sum + project.actualSavings, 0);
        const totalOptimizations = projectMetrics.reduce((sum, project) => sum + project.optimizationsApplied, 0);

        // Cost Saver achievements
        if (totalSavings > 100) {
            achievements.push({
                type: 'cost_saver' as const,
                title: '💰 Major Cost Saver',
                description: `Saved over $${totalSavings.toFixed(2)} this week!`,
                earnedAt: new Date()
            });
        } else if (totalSavings > 10) {
            achievements.push({
                type: 'cost_saver' as const,
                title: '💵 Cost Conscious',
                description: `Saved $${totalSavings.toFixed(2)} through optimizations`,
                earnedAt: new Date()
            });
        }

        // Ranking achievements
        if (userRank === 1) {
            achievements.push({
                type: 'optimization_champion' as const,
                title: '🏆 Optimization Champion',
                description: 'You\'re #1 on the leaderboard this week!',
                earnedAt: new Date()
            });
        } else if (userRank <= 3) {
            achievements.push({
                type: 'optimization_champion' as const,
                title: '🥉 Top Optimizer',
                description: `You're in the top 3 optimizers (rank #${userRank})!`,
                earnedAt: new Date()
            });
        }

        // Optimization frequency
        if (totalOptimizations >= 10) {
            achievements.push({
                type: 'efficiency_expert' as const,
                title: '⚡ Efficiency Expert',
                description: `Applied ${totalOptimizations} optimizations this week`,
                earnedAt: new Date()
            });
        }

        return achievements;
    }

    /**
     * Generate personalized recommendations
     */
    private static generateRecommendations(
        projectMetrics: ProjectROIMetrics[]
    ): Array<{
        priority: 'high' | 'medium' | 'low';
        title: string;
        description: string;
        potentialSavings: number;
        action: string;
    }> {
        const recommendations = [];

        // Find most expensive models
        const allModels = projectMetrics.flatMap(p => p.modelBreakdown);
        const expensiveModels = allModels
            .filter(m => m.cost > 1) // Models costing more than $1
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 3);

        expensiveModels.forEach(model => {
            recommendations.push({
                priority: 'high' as const,
                title: `Optimize ${model.model} Usage`,
                description: `${model.model} accounts for $${model.cost.toFixed(2)} (${model.percentage.toFixed(1)}%) of your costs`,
                potentialSavings: model.cost * 0.3, // Estimate 30% savings
                action: 'Consider switching to a more cost-effective model or optimizing prompts'
            });
        });

        // Low optimization rate
        const totalCost = projectMetrics.reduce((sum, p) => sum + p.totalCost, 0);
        const totalOptimizations = projectMetrics.reduce((sum, p) => sum + p.optimizationsApplied, 0);
        
        if (totalCost > 5 && totalOptimizations < 3) {
            recommendations.push({
                priority: 'medium' as const,
                title: 'Increase Optimization Activity',
                description: 'You have significant costs but few optimizations applied',
                potentialSavings: totalCost * 0.2,
                action: 'Try the What-If Simulator to find cost-saving opportunities'
            });
        }

        return recommendations.slice(0, 5); // Limit to top 5 recommendations
    }

    /**
     * Generate email content for ROI summary
     */
    private static generateEmailContent(summary: UserROISummary): { text: string; html: string } {
        const totalCost = summary.projects.reduce((sum, p) => sum + p.totalCost, 0);
        const savingsRate = totalCost > 0 ? (summary.totalSavings / totalCost) * 100 : 0;

        const text = `
Weekly Cost Optimization Summary

Hi ${summary.userName},

Here's your cost optimization summary for the past week:

💰 SAVINGS OVERVIEW
- Total Savings: $${summary.totalSavings.toFixed(2)}
- Optimizations Applied: ${summary.totalOptimizations}
- Savings Rate: ${savingsRate.toFixed(1)}%
- Your Rank: #${summary.rank} out of ${summary.totalUsers}

🏆 ACHIEVEMENTS
${summary.achievements.map(a => `- ${a.title}: ${a.description}`).join('\n')}

📊 PROJECT BREAKDOWN
${summary.projects.map(p => `
${p.projectName}:
- Cost: $${p.totalCost.toFixed(2)} (${p.costChangePercentage > 0 ? '+' : ''}${p.costChangePercentage.toFixed(1)}%)
- Savings: $${p.actualSavings.toFixed(2)}
- Requests: ${p.totalRequests}
`).join('\n')}

💡 RECOMMENDATIONS
${summary.recommendations.map(r => `- ${r.title}: ${r.description}`).join('\n')}

Keep optimizing!
The Cost Katana Team
        `;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .metric { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 8px; }
        .achievement { background: #fff3cd; padding: 10px; margin: 5px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
        .recommendation { background: #d1ecf1; padding: 10px; margin: 5px 0; border-radius: 5px; border-left: 4px solid #17a2b8; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Weekly Cost Optimization Summary</h1>
        <p>Hi ${summary.userName}!</p>
    </div>
    
    <div class="content">
        <div class="metric">
            <h2>💰 Savings Overview</h2>
            <p><strong>Total Savings:</strong> $${summary.totalSavings.toFixed(2)}</p>
            <p><strong>Optimizations Applied:</strong> ${summary.totalOptimizations}</p>
            <p><strong>Savings Rate:</strong> ${savingsRate.toFixed(1)}%</p>
            <p><strong>Your Rank:</strong> #${summary.rank} out of ${summary.totalUsers}</p>
        </div>
        
        ${summary.achievements.length > 0 ? `
        <h2>🏆 Achievements</h2>
        ${summary.achievements.map(a => `
            <div class="achievement">
                <strong>${a.title}</strong><br>
                ${a.description}
            </div>
        `).join('')}
        ` : ''}
        
        <h2>📊 Project Breakdown</h2>
        ${summary.projects.map(p => `
            <div class="metric">
                <h3>${p.projectName}</h3>
                <p><strong>Cost:</strong> $${p.totalCost.toFixed(2)} (${p.costChangePercentage > 0 ? '+' : ''}${p.costChangePercentage.toFixed(1)}%)</p>
                <p><strong>Savings:</strong> $${p.actualSavings.toFixed(2)}</p>
                <p><strong>Requests:</strong> ${p.totalRequests}</p>
            </div>
        `).join('')}
        
        ${summary.recommendations.length > 0 ? `
        <h2>💡 Recommendations</h2>
        ${summary.recommendations.map(r => `
            <div class="recommendation">
                <strong>${r.title}</strong><br>
                ${r.description}<br>
                <em>Potential savings: $${r.potentialSavings.toFixed(2)}</em>
            </div>
        `).join('')}
        ` : ''}
    </div>
    
    <div class="footer">
        <p>Keep optimizing! 🚀</p>
        <p>The Cost Katana Team</p>
    </div>
</body>
</html>
        `;

        return { text, html };
    }
}

export default ROIMetricsService;
