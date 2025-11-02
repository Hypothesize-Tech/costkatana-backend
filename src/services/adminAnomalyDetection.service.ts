import { Usage } from '../models/Usage';
import { Project } from '../models/Project';
import { EmailService } from './email.service';
import { loggingService } from './logging.service';
import { User } from '../models/User';

export interface Anomaly {
    type: 'spending_spike' | 'error_spike' | 'budget_exceeded' | 'unusual_pattern';
    severity: 'low' | 'medium' | 'high' | 'critical';
    userId?: string;
    userEmail?: string;
    projectId?: string;
    projectName?: string;
    service?: string;
    model?: string;
    message: string;
    value: number;
    threshold: number;
    deviation: number;
    detectedAt: Date;
    resolved?: boolean;
    resolvedAt?: Date;
}

export interface Alert {
    id: string;
    type: 'spending' | 'error' | 'budget' | 'anomaly';
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    message: string;
    userId?: string;
    userEmail?: string;
    projectId?: string;
    timestamp: Date;
    acknowledged?: boolean;
    acknowledgedAt?: Date;
}

export class AdminAnomalyDetectionService {
    /**
     * Detect spending anomalies using statistical analysis
     */
    static async detectSpendingAnomalies(
        timeWindow: 'hour' | 'day' | 'week' = 'day',
        threshold: number = 2.0 // Z-score threshold
    ): Promise<Anomaly[]> {
        try {
            const now = new Date();
            let windowStart: Date;
            
            switch (timeWindow) {
                case 'hour':
                    windowStart = new Date(now.getTime() - 60 * 60 * 1000);
                    break;
                case 'day':
                    windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                case 'week':
                    windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
            }

            // Get historical baseline (previous period)
            const baselineStart = new Date(windowStart.getTime() - (now.getTime() - windowStart.getTime()));
            
            // Calculate baseline statistics
            const baseline = await Usage.aggregate([
                {
                    $match: {
                        createdAt: { $gte: baselineStart, $lt: windowStart }
                    }
                },
                {
                    $group: {
                        _id: { 
                            $dateToString: { 
                                format: timeWindow === 'hour' ? '%Y-%m-%d-%H' : timeWindow === 'day' ? '%Y-%m-%d' : '%Y-%W',
                                date: '$createdAt' 
                            }
                        },
                        totalCost: { $sum: '$cost' }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgCost: { $avg: '$totalCost' },
                        stdDev: { $stdDevPop: '$totalCost' }
                    }
                }
            ]);

            const avgCost = baseline[0]?.avgCost ?? 0;
            const stdDev = baseline[0]?.stdDev ?? 0;

            // Get current period spending
            const current = await Usage.aggregate([
                {
                    $match: {
                        createdAt: { $gte: windowStart, $lte: now }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        userCosts: {
                            $push: {
                                userId: '$userId',
                                cost: '$cost'
                            }
                        }
                    }
                }
            ]);

            const currentCost = current[0]?.totalCost ?? 0;
            const zScore = stdDev > 0 ? (currentCost - avgCost) / stdDev : 0;

            const anomalies: Anomaly[] = [];

            if (Math.abs(zScore) > threshold) {
                // Group by user to find top contributors
                const userSpending = await Usage.aggregate([
                    {
                        $match: {
                            createdAt: { $gte: windowStart, $lte: now }
                        }
                    },
                    {
                        $group: {
                            _id: '$userId',
                            totalCost: { $sum: '$cost' }
                        }
                    },
                    { $sort: { totalCost: -1 } },
                    { $limit: 10 }
                ]);

                const userIds = userSpending.map(u => u._id).filter(Boolean);
                const users = await User.find({ _id: { $in: userIds } }, { email: 1, name: 1 }).lean();

                const userMap = new Map(users.map(u => [u._id.toString(), u]));

                for (const item of userSpending) {
                    const userId = item._id?.toString();
                    if (!userId) continue;
                    
                    const user = userMap.get(userId);
                    const userCost = item.totalCost;

                    if (userCost > avgCost + (threshold * stdDev)) {
                        anomalies.push({
                            type: 'spending_spike',
                            severity: zScore > 3 ? 'critical' : zScore > 2.5 ? 'high' : 'medium',
                            userId,
                            userEmail: user?.email,
                            message: `Unusual spending detected: ${userCost.toFixed(2)} vs baseline ${avgCost.toFixed(2)}`,
                            value: userCost,
                            threshold: avgCost + (threshold * stdDev),
                            deviation: zScore,
                            detectedAt: new Date()
                        });
                    }
                }
            }

            return anomalies;
        } catch (error) {
            loggingService.error('Error detecting spending anomalies:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminAnomalyDetectionService',
                operation: 'detectSpendingAnomalies'
            });
            throw error;
        }
    }

    /**
     * Detect error rate spikes by service/model
     */
    static async detectErrorAnomalies(
        timeWindow: 'hour' | 'day' | 'week' = 'day',
        threshold: number = 0.1 // 10% error rate threshold
    ): Promise<Anomaly[]> {
        try {
            const now = new Date();
            let windowStart: Date;
            
            switch (timeWindow) {
                case 'hour':
                    windowStart = new Date(now.getTime() - 60 * 60 * 1000);
                    break;
                case 'day':
                    windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                case 'week':
                    windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
            }

            // Get error rates by service and model
            const errorStats = await Usage.aggregate([
                {
                    $match: {
                        createdAt: { $gte: windowStart, $lte: now }
                    }
                },
                {
                    $group: {
                        _id: {
                            service: '$service',
                            model: '$model'
                        },
                        totalRequests: { $sum: 1 },
                        errorCount: {
                            $sum: { $cond: ['$errorOccurred', 1, 0] }
                        }
                    }
                },
                {
                    $project: {
                        service: '$_id.service',
                        model: '$_id.model',
                        totalRequests: 1,
                        errorCount: 1,
                        errorRate: {
                            $cond: [
                                { $gt: ['$totalRequests', 0] },
                                { $divide: ['$errorCount', '$totalRequests'] },
                                0
                            ]
                        }
                    }
                },
                {
                    $match: {
                        errorRate: { $gte: threshold },
                        totalRequests: { $gte: 10 } // Minimum requests for statistical significance
                    }
                }
            ]);

            const anomalies: Anomaly[] = [];

            for (const stat of errorStats) {
                const severity = stat.errorRate > 0.3 ? 'critical' :
                               stat.errorRate > 0.2 ? 'high' :
                               stat.errorRate > 0.15 ? 'medium' : 'low';

                anomalies.push({
                    type: 'error_spike',
                    severity,
                    service: stat.service,
                    model: stat.model,
                    message: `High error rate detected: ${(stat.errorRate * 100).toFixed(1)}% (${stat.errorCount}/${stat.totalRequests} errors) for ${stat.service}/${stat.model}`,
                    value: stat.errorRate,
                    threshold,
                    deviation: stat.errorRate - threshold,
                    detectedAt: new Date()
                });
            }

            return anomalies;
        } catch (error) {
            loggingService.error('Error detecting error anomalies:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminAnomalyDetectionService',
                operation: 'detectErrorAnomalies'
            });
            throw error;
        }
    }

    /**
     * Check project budgets and alert if exceeded
     */
    static async checkBudgetThresholds(): Promise<Anomaly[]> {
        try {
            const projects = await Project.find({ isActive: true }).lean();
            const anomalies: Anomaly[] = [];

            for (const project of projects) {
                const currentSpending = project.spending?.current || 0;
                const budgetAmount = project.budget?.amount || 0;
                const budgetThreshold = project.budget?.alerts?.[0]?.threshold ?? 80; // Default 80%

                if (budgetAmount > 0) {
                    const usagePercentage = (currentSpending / budgetAmount) * 100;

                    if (usagePercentage >= budgetThreshold) {
                        const severity = usagePercentage >= 100 ? 'critical' :
                                       usagePercentage >= 95 ? 'high' :
                                       usagePercentage >= 90 ? 'medium' : 'low';

                        anomalies.push({
                            type: 'budget_exceeded',
                            severity,
                            projectId: project._id.toString(),
                            projectName: project.name,
                            message: `Project "${project.name}" has used ${usagePercentage.toFixed(1)}% of budget ($${currentSpending.toFixed(2)} / $${budgetAmount.toFixed(2)})`,
                            value: usagePercentage,
                            threshold: budgetThreshold,
                            deviation: usagePercentage - budgetThreshold,
                            detectedAt: new Date()
                        });
                    }
                }
            }

            return anomalies;
        } catch (error) {
            loggingService.error('Error checking budget thresholds:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminAnomalyDetectionService',
                operation: 'checkBudgetThresholds'
            });
            throw error;
        }
    }

    /**
     * Get current alerts from detected anomalies
     */
    static async getCurrentAlerts(): Promise<Alert[]> {
        try {
            const [spendingAnomalies, errorAnomalies, budgetAnomalies] = await Promise.all([
                this.detectSpendingAnomalies('day', 2.0),
                this.detectErrorAnomalies('day', 0.1),
                this.checkBudgetThresholds()
            ]);

            const alerts: Alert[] = [];

            // Convert spending anomalies to alerts
            for (const anomaly of spendingAnomalies) {
                alerts.push({
                    id: `spending-${anomaly.userId}-${anomaly.detectedAt.getTime()}`,
                    type: 'spending',
                    severity: anomaly.severity,
                    title: 'Spending Anomaly Detected',
                    message: anomaly.message,
                    userId: anomaly.userId,
                    userEmail: anomaly.userEmail,
                    timestamp: anomaly.detectedAt
                });
            }

            // Convert error anomalies to alerts
            for (const anomaly of errorAnomalies) {
                alerts.push({
                    id: `error-${anomaly.service}-${anomaly.model}-${anomaly.detectedAt.getTime()}`,
                    type: 'error',
                    severity: anomaly.severity,
                    title: 'Error Rate Spike',
                    message: anomaly.message,
                    timestamp: anomaly.detectedAt
                });
            }

            // Convert budget anomalies to alerts
            for (const anomaly of budgetAnomalies) {
                alerts.push({
                    id: `budget-${anomaly.projectId}-${anomaly.detectedAt.getTime()}`,
                    type: 'budget',
                    severity: anomaly.severity,
                    title: 'Budget Threshold Exceeded',
                    message: anomaly.message,
                    projectId: anomaly.projectId,
                    timestamp: anomaly.detectedAt
                });
            }

            return alerts.sort((a, b) => {
                const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                return severityOrder[b.severity] - severityOrder[a.severity];
            });
        } catch (error) {
            loggingService.error('Error getting current alerts:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminAnomalyDetectionService',
                operation: 'getCurrentAlerts'
            });
            throw error;
        }
    }

    /**
     * Send email notification for critical/high severity alerts
     */
    static async sendAlertNotifications(anomalies: Anomaly[]): Promise<void> {
        try {
            const criticalAnomalies = anomalies.filter(a => 
                a.severity === 'critical' || a.severity === 'high'
            );

            if (criticalAnomalies.length === 0) return;

            // Get admin users
            const admins = await User.find({ role: 'admin' }, { email: 1, name: 1 }).lean();

            for (const admin of admins) {
                const alertSummary = criticalAnomalies.map(a => `- ${a.message}`).join('\n');

                await EmailService.sendEmail({
                    to: admin.email,
                    subject: `CostKatana Alert: ${criticalAnomalies.length} Critical Anomalies Detected`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #dc2626;">⚠️ Critical Alerts Detected</h2>
                            <p>${criticalAnomalies.length} critical or high-severity anomalies have been detected in your CostKatana platform.</p>
                            <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="color: #991b1b; margin-top: 0;">Alerts:</h3>
                                <pre style="white-space: pre-wrap; color: #7f1d1d;">${alertSummary}</pre>
                            </div>
                            <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/admin/user-spending" style="background: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Dashboard</a></p>
                        </div>
                    `
                });
            }
        } catch (error) {
            loggingService.error('Error sending alert notifications:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminAnomalyDetectionService',
                operation: 'sendAlertNotifications'
            });
            // Don't throw - email failures shouldn't break the flow
        }
    }
}

