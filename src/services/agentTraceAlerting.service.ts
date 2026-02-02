import mongoose from 'mongoose';
import { Usage } from '../models/Usage';
import { Alert as AlertModel, IAlert } from '../models/Alert';
import { loggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { GuardrailsService } from './guardrails.service';

export interface WorkflowAlertConfig {
    workflowId?: string; // If undefined, applies to all workflows
    userId: string;
    budgetThreshold?: number; // Cost threshold in dollars
    budgetThresholdPercentages?: number[]; // Alert at 50%, 80%, 90%, 100%
    spikeThreshold?: number; // Percentage increase to trigger spike alert (e.g., 200 = 200% increase)
    inefficiencyThreshold?: number; // Cost per execution threshold
    failureRateThreshold?: number; // Percentage of failed executions
    enabled: boolean;
    channels?: string[]; // Notification channels: 'email', 'in-app', 'webhook'
}

export class WorkflowAlertingService {
    /**
     * Check and create workflow budget alerts
     */
    static async checkWorkflowBudgetAlerts(
        userId: string,
        workflowId?: string,
        config?: WorkflowAlertConfig
    ): Promise<IAlert[]> {
        try {
            const alerts: IAlert[] = [];
            
            // Get workflow quota status
            const quotaCheck = await GuardrailsService.checkWorkflowQuota(userId);
            if (quotaCheck && quotaCheck.type === 'warning') {
                // Check if alert already exists
                const existingAlert = await AlertModel.findOne({
                    userId: new mongoose.Types.ObjectId(userId),
                    type: 'agent_trace_budget',
                    'data.traceId': workflowId || 'all',
                    sent: false,
                    expiresAt: { $gt: new Date() }
                });

                if (!existingAlert) {
                    const alert = new AlertModel({
                        userId: new mongoose.Types.ObjectId(userId),
                        type: 'agent_trace_budget',
                        title: 'Agent Trace Quota Warning',
                        message: quotaCheck.message,
                        severity: quotaCheck.percentage >= 90 ? 'high' : 'medium',
                        data: {
                            currentValue: quotaCheck.current,
                            threshold: quotaCheck.limit,
                            percentage: quotaCheck.percentage,
                            traceId: workflowId || 'all',
                            suggestions: quotaCheck.suggestions
                        },
                        actionRequired: quotaCheck.percentage >= 95,
                        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
                    });

                    await alert.save();
                    alerts.push(alert);

                    // Send notification
                    await NotificationService.sendAlert(alert);
                }
            }

            // Check budget thresholds if configured
            if (config?.budgetThreshold) {
                const startOfMonth = new Date();
                startOfMonth.setDate(1);
                startOfMonth.setHours(0, 0, 0, 0);

                const match: any = {
                    userId: new mongoose.Types.ObjectId(userId),
                    automationPlatform: { $exists: true, $ne: null },
                    createdAt: { $gte: startOfMonth }
                };

                if (workflowId) {
                    match.traceId = workflowId;
                }

                const workflowCost = await Usage.aggregate([
                    { $match: match },
                    {
                        $group: {
                            _id: null,
                            totalCost: { $sum: { $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }] } }
                        }
                    }
                ]);

                const currentCost = workflowCost[0]?.totalCost || 0;
                const percentage = (currentCost / config.budgetThreshold) * 100;

                // Check threshold percentages
                const thresholds = config.budgetThresholdPercentages || [50, 80, 90, 100];
                for (const threshold of thresholds) {
                    if (percentage >= threshold && percentage < threshold + 5) {
                        // Check if alert already exists for this threshold
                        const existingAlert = await AlertModel.findOne({
                            userId: new mongoose.Types.ObjectId(userId),
                            type: 'workflow_budget',
                            'data.workflowId': workflowId || 'all',
                            'data.thresholdPercentage': threshold,
                            sent: false,
                            expiresAt: { $gt: new Date() }
                        });

                        if (!existingAlert) {
                            const alert = new AlertModel({
                                userId: new mongoose.Types.ObjectId(userId),
                                type: 'workflow_budget',
                                title: `Workflow Budget Alert: ${threshold}% Used`,
                                message: `Workflow ${workflowId ? `"${workflowId}"` : 'costs'} have reached ${percentage.toFixed(1)}% of the monthly budget ($${currentCost.toFixed(2)} / $${config.budgetThreshold.toFixed(2)})`,
                                severity: threshold >= 90 ? 'high' : threshold >= 80 ? 'medium' : 'low',
                                data: {
                                    currentValue: currentCost,
                                    threshold: config.budgetThreshold,
                                    percentage: Math.round(percentage * 100) / 100,
                                    thresholdPercentage: threshold,
                                    workflowId: workflowId || 'all'
                                },
                                actionRequired: threshold >= 90,
                                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                            });

                            await alert.save();
                            alerts.push(alert);

                            // Send notification
                            await NotificationService.sendAlert(alert);
                        }
                    }
                }
            }

            return alerts;
        } catch (error) {
            loggingService.error('Error checking workflow budget alerts', {
                component: 'WorkflowAlertingService',
                operation: 'checkWorkflowBudgetAlerts',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            throw error;
        }
    }

    /**
     * Check for workflow cost spikes
     */
    static async checkWorkflowSpikeAlerts(
        userId: string,
        workflowId: string,
        spikeThreshold: number = 200 // 200% increase
    ): Promise<IAlert | null> {
        try {
            const now = new Date();
            const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const previous24Hours = new Date(now.getTime() - 48 * 60 * 60 * 1000);

            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: workflowId,
                automationPlatform: { $exists: true, $ne: null }
            };

            // Get current 24h cost
            const currentCost = await Usage.aggregate([
                {
                    $match: {
                        ...match,
                        createdAt: { $gte: last24Hours, $lte: now }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: { $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }] } }
                    }
                }
            ]);

            // Get previous 24h cost
            const previousCost = await Usage.aggregate([
                {
                    $match: {
                        ...match,
                        createdAt: { $gte: previous24Hours, $lt: last24Hours }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: { $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }] } }
                    }
                }
            ]);

            const current = currentCost[0]?.totalCost || 0;
            const previous = previousCost[0]?.totalCost || 0;

            if (previous > 0) {
                const increasePercentage = ((current - previous) / previous) * 100;

                if (increasePercentage >= spikeThreshold) {
                    // Check if alert already exists
                    const existingAlert = await AlertModel.findOne({
                        userId: new mongoose.Types.ObjectId(userId),
                        type: 'workflow_spike',
                        'data.workflowId': workflowId,
                        sent: false,
                        expiresAt: { $gt: new Date() }
                    });

                    if (!existingAlert) {
                        const alert = new AlertModel({
                            userId: new mongoose.Types.ObjectId(userId),
                            type: 'workflow_spike',
                            title: 'Workflow Cost Spike Detected',
                            message: `Workflow "${workflowId}" has increased by ${increasePercentage.toFixed(1)}% in the last 24 hours ($${current.toFixed(2)} vs $${previous.toFixed(2)})`,
                            severity: increasePercentage >= 500 ? 'critical' : increasePercentage >= 300 ? 'high' : 'medium',
                            data: {
                                workflowId,
                                currentCost: current,
                                previousCost: previous,
                                increasePercentage: Math.round(increasePercentage * 100) / 100
                            },
                            actionRequired: increasePercentage >= 300,
                            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
                        });

                        await alert.save();

                        // Send notification
                        await NotificationService.sendAlert(alert);

                        return alert;
                    }
                }
            }

            return null;
        } catch (error) {
            loggingService.error('Error checking workflow spike alerts', {
                component: 'WorkflowAlertingService',
                operation: 'checkWorkflowSpikeAlerts',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            return null;
        }
    }

    /**
     * Check for workflow inefficiency alerts
     */
    static async checkWorkflowInefficiencyAlerts(
        userId: string,
        workflowId: string,
        inefficiencyThreshold: number = 0.10 // $0.10 per execution
    ): Promise<IAlert | null> {
        try {
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: workflowId,
                automationPlatform: { $exists: true, $ne: null },
                createdAt: { $gte: startOfMonth }
            };

            const workflowStats = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: { $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }] } },
                        totalExecutions: { $sum: 1 },
                        workflowName: { $first: '$workflowName' }
                    }
                }
            ]);

            if (workflowStats && workflowStats.length > 0) {
                const stats = workflowStats[0];
                const averageCostPerExecution = stats.totalExecutions > 0 
                    ? stats.totalCost / stats.totalExecutions 
                    : 0;

                if (averageCostPerExecution > inefficiencyThreshold) {
                    // Check if alert already exists
                    const existingAlert = await AlertModel.findOne({
                        userId: new mongoose.Types.ObjectId(userId),
                        type: 'workflow_inefficiency',
                        'data.workflowId': workflowId,
                        sent: false,
                        expiresAt: { $gt: new Date() }
                    });

                    if (!existingAlert) {
                        const alert = new AlertModel({
                            userId: new mongoose.Types.ObjectId(userId),
                            type: 'workflow_inefficiency',
                            title: 'Workflow Inefficiency Detected',
                            message: `Workflow "${stats.workflowName || workflowId}" has an average cost of $${averageCostPerExecution.toFixed(4)} per execution, which exceeds the threshold of $${inefficiencyThreshold.toFixed(2)}`,
                            severity: averageCostPerExecution > inefficiencyThreshold * 2 ? 'high' : 'medium',
                            data: {
                                workflowId,
                                workflowName: stats.workflowName,
                                averageCostPerExecution: Math.round(averageCostPerExecution * 10000) / 10000,
                                threshold: inefficiencyThreshold,
                                totalCost: stats.totalCost,
                                totalExecutions: stats.totalExecutions
                            },
                            actionRequired: true,
                            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                        });

                        await alert.save();

                        // Send notification
                        await NotificationService.sendAlert(alert);

                        return alert;
                    }
                }
            }

            return null;
        } catch (error) {
            loggingService.error('Error checking workflow inefficiency alerts', {
                component: 'WorkflowAlertingService',
                operation: 'checkWorkflowInefficiencyAlerts',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            return null;
        }
    }

    /**
     * Check for workflow failure rate alerts
     */
    static async checkWorkflowFailureAlerts(
        userId: string,
        workflowId: string,
        failureRateThreshold: number = 10 // 10% failure rate
    ): Promise<IAlert | null> {
        try {
            const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: workflowId,
                automationPlatform: { $exists: true, $ne: null },
                createdAt: { $gte: last24Hours }
            };

            const failureStats = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        totalExecutions: { $sum: 1 },
                        failedExecutions: {
                            $sum: {
                                $cond: [{ $eq: ['$errorOccurred', true] }, 1, 0]
                            }
                        },
                        workflowName: { $first: '$workflowName' }
                    }
                }
            ]);

            if (failureStats && failureStats.length > 0) {
                const stats = failureStats[0];
                const failureRate = stats.totalExecutions > 0 
                    ? (stats.failedExecutions / stats.totalExecutions) * 100 
                    : 0;

                if (failureRate >= failureRateThreshold) {
                    // Check if alert already exists
                    const existingAlert = await AlertModel.findOne({
                        userId: new mongoose.Types.ObjectId(userId),
                        type: 'workflow_failure',
                        'data.workflowId': workflowId,
                        sent: false,
                        expiresAt: { $gt: new Date() }
                    });

                    if (!existingAlert) {
                        const alert = new AlertModel({
                            userId: new mongoose.Types.ObjectId(userId),
                            type: 'workflow_failure',
                            title: 'High Workflow Failure Rate',
                            message: `Workflow "${stats.workflowName || workflowId}" has a ${failureRate.toFixed(1)}% failure rate in the last 24 hours (${stats.failedExecutions} failures out of ${stats.totalExecutions} executions)`,
                            severity: failureRate >= 50 ? 'critical' : failureRate >= 25 ? 'high' : 'medium',
                            data: {
                                workflowId,
                                workflowName: stats.workflowName,
                                failureRate: Math.round(failureRate * 100) / 100,
                                failedExecutions: stats.failedExecutions,
                                totalExecutions: stats.totalExecutions,
                                threshold: failureRateThreshold
                            },
                            actionRequired: true,
                            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
                        });

                        await alert.save();

                        // Send notification
                        await NotificationService.sendAlert(alert);

                        return alert;
                    }
                }
            }

            return null;
        } catch (error) {
            loggingService.error('Error checking workflow failure alerts', {
                component: 'WorkflowAlertingService',
                operation: 'checkWorkflowFailureAlerts',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            return null;
        }
    }

    /**
     * Check all workflow alerts for a user
     */
    static async checkAllWorkflowAlerts(
        userId: string,
        config?: WorkflowAlertConfig
    ): Promise<IAlert[]> {
        try {
            const alerts: IAlert[] = [];

            // Get all active workflows
            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                automationPlatform: { $exists: true, $ne: null },
                workflowId: { $exists: true, $ne: null }
            };

            if (config?.workflowId) {
                match.workflowId = config.workflowId;
            }

            const workflows = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$workflowId'
                    }
                }
            ]);

            // Check budget alerts
            const budgetAlerts = await this.checkWorkflowBudgetAlerts(userId, config?.workflowId, config);
            alerts.push(...budgetAlerts);

            // Check each workflow for spikes, inefficiency, and failures
            for (const workflow of workflows) {
                const workflowId = workflow._id;

                // Check spike alerts
                if (config?.spikeThreshold !== undefined) {
                    const spikeAlert = await this.checkWorkflowSpikeAlerts(userId, workflowId, config.spikeThreshold);
                    if (spikeAlert) alerts.push(spikeAlert);
                }

                // Check inefficiency alerts
                if (config?.inefficiencyThreshold !== undefined) {
                    const inefficiencyAlert = await this.checkWorkflowInefficiencyAlerts(
                        userId,
                        workflowId,
                        config.inefficiencyThreshold
                    );
                    if (inefficiencyAlert) alerts.push(inefficiencyAlert);
                }

                // Check failure rate alerts
                if (config?.failureRateThreshold !== undefined) {
                    const failureAlert = await this.checkWorkflowFailureAlerts(
                        userId,
                        workflowId,
                        config.failureRateThreshold
                    );
                    if (failureAlert) alerts.push(failureAlert);
                }
            }

            return alerts;
        } catch (error) {
            loggingService.error('Error checking all workflow alerts', {
                component: 'WorkflowAlertingService',
                operation: 'checkAllWorkflowAlerts',
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }
}

