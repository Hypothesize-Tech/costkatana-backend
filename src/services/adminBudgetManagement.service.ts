import { Project } from '../models/Project';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface BudgetOverview {
    totalBudget: number;
    totalSpent: number;
    remainingBudget: number;
    budgetUtilization: number; // percentage
    budgetAlerts: number;
    overBudgetProjects: number;
    nearBudgetProjects: number; // >80% utilization
}

export interface BudgetAlert {
    projectId: string;
    projectName: string;
    workspaceId?: string;
    workspaceName?: string;
    budgetAmount: number;
    spent: number;
    utilization: number;
    threshold: number;
    alertType: 'warning' | 'critical' | 'over_budget';
    message: string;
}

export interface ProjectBudgetStatus {
    projectId: string;
    projectName: string;
    workspaceId?: string;
    workspaceName?: string;
    budgetAmount: number;
    spent: number;
    remaining: number;
    utilization: number;
    period: 'monthly' | 'quarterly' | 'yearly' | 'one-time';
    startDate: Date;
    endDate?: Date;
    status: 'on_track' | 'near_limit' | 'over_budget';
    alerts: Array<{
        threshold: number;
        triggered: boolean;
    }>;
}

export interface BudgetTrend {
    date: string;
    budget: number;
    spent: number;
    utilization: number;
}

export class AdminBudgetManagementService {
    /**
     * Get budget overview
     */
    static async getBudgetOverview(
        startDate?: Date,
        endDate?: Date
    ): Promise<BudgetOverview> {
        try {
            const projects = await Project.find({ isActive: true })
                .select('budget spending')
                .lean();

            let totalBudget = 0;
            let totalSpent = 0;
            let overBudgetProjects = 0;
            let nearBudgetProjects = 0;

            for (const project of projects) {
                const budget = project.budget;
                const spending = project.spending;

                if (!budget || budget.amount === 0) continue;

                // Calculate budget for current period
                let periodBudget = budget.amount;

                if (budget.period === 'monthly') {
                    // Monthly budget
                    periodBudget = budget.amount;
                } else if (budget.period === 'quarterly') {
                    // Quarterly budget / 3 = monthly
                    periodBudget = budget.amount / 3;
                } else if (budget.period === 'yearly') {
                    // Yearly budget / 12 = monthly
                    periodBudget = budget.amount / 12;
                }

                totalBudget += periodBudget;
                totalSpent += spending.current || 0;

                const utilization = (spending.current || 0) / periodBudget * 100;

                if (utilization > 100) {
                    overBudgetProjects++;
                } else if (utilization > 80) {
                    nearBudgetProjects++;
                }
            }

            const remainingBudget = totalBudget - totalSpent;
            const budgetUtilization = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

            // Get budget alerts
            const budgetAlerts = await this.getBudgetAlerts(startDate, endDate);

            return {
                totalBudget,
                totalSpent,
                remainingBudget,
                budgetUtilization,
                budgetAlerts: budgetAlerts.length,
                overBudgetProjects,
                nearBudgetProjects
            };
        } catch (error) {
            loggingService.error('Error getting budget overview:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get budget alerts
     */
    static async getBudgetAlerts(
        _startDate?: Date,
        _endDate?: Date
    ): Promise<BudgetAlert[]> {
        try {
            const projects = await Project.find({ isActive: true })
                .populate('workspaceId', 'name')
                .select('name budget spending workspaceId')
                .lean() as Array<{
                    _id: any;
                    name: string;
                    budget: any;
                    spending: any;
                    workspaceId?: any;
                }>;

            const alerts: BudgetAlert[] = [];

            for (const project of projects) {
                const budget = project.budget;
                const spending = project.spending;

                if (!budget || budget.amount === 0) continue;

                // Calculate budget for current period
                let periodBudget = budget.amount;
                if (budget.period === 'monthly') {
                    periodBudget = budget.amount;
                } else if (budget.period === 'quarterly') {
                    periodBudget = budget.amount / 3;
                } else if (budget.period === 'yearly') {
                    periodBudget = budget.amount / 12;
                }

                // Get actual spending for the specified date range
                let spent = spending.current || 0;
                if (_startDate || _endDate) {
                    const usageMatch: any = { projectId: project._id };
                    if (_startDate || _endDate) {
                        usageMatch.createdAt = {};
                        if (_startDate) usageMatch.createdAt.$gte = _startDate;
                        if (_endDate) usageMatch.createdAt.$lte = _endDate;
                    }

                    const usage = await Usage.aggregate([
                        { $match: usageMatch },
                        {
                            $group: {
                                _id: null,
                                totalCost: { $sum: '$cost' }
                            }
                        }
                    ]);

                    spent = usage[0]?.totalCost || 0;
                }

                const utilization = periodBudget > 0 ? (spent / periodBudget) * 100 : 0;

                // Check alert thresholds
                const budgetAlerts = budget.alerts || [];
                for (const alert of budgetAlerts) {
                    if (utilization >= alert.threshold) {
                        let alertType: 'warning' | 'critical' | 'over_budget';
                        if (utilization >= 100) {
                            alertType = 'over_budget';
                        } else if (utilization >= 90) {
                            alertType = 'critical';
                        } else {
                            alertType = 'warning';
                        }

                        alerts.push({
                            projectId: project._id.toString(),
                            projectName: project.name,
                            workspaceId: project.workspaceId 
                                ? (typeof project.workspaceId === 'object' && project.workspaceId !== null
                                    ? project.workspaceId._id?.toString() || project.workspaceId.toString()
                                    : project.workspaceId.toString())
                                : undefined,
                            workspaceName: project.workspaceId 
                                ? (typeof project.workspaceId === 'object' && project.workspaceId !== null && 'name' in project.workspaceId
                                    ? (project.workspaceId as any).name 
                                    : undefined)
                                : undefined,
                            budgetAmount: periodBudget,
                            spent,
                            utilization,
                            threshold: alert.threshold,
                            alertType,
                            message: `Project "${project.name}" has reached ${utilization.toFixed(1)}% of budget (threshold: ${alert.threshold}%)`
                        });
                    }
                }

                // Also add over-budget alert if not already included
                if (utilization >= 100 && alerts.findIndex(a => a.projectId === project._id.toString() && a.alertType === 'over_budget') === -1) {
                    alerts.push({
                        projectId: project._id.toString(),
                        projectName: project.name,
                        workspaceId: project.workspaceId 
                            ? (typeof project.workspaceId === 'object' 
                                ? project.workspaceId._id.toString() 
                                : project.workspaceId.toString())
                            : undefined,
                        workspaceName: project.workspaceId 
                            ? (typeof project.workspaceId === 'object' 
                                ? project.workspaceId.name 
                                : undefined)
                            : undefined,
                        budgetAmount: periodBudget,
                        spent,
                        utilization,
                        threshold: 100,
                        alertType: 'over_budget',
                        message: `Project "${project.name}" has exceeded budget by ${((utilization - 100) * periodBudget / 100).toFixed(2)}`
                    });
                }
            }

            return alerts.sort((a, b) => {
                // Sort by severity first
                const severityOrder = { 'over_budget': 0, 'critical': 1, 'warning': 2 };
                const severityDiff = (severityOrder[a.alertType] || 3) - (severityOrder[b.alertType] || 3);
                if (severityDiff !== 0) return severityDiff;
                
                // Then by utilization
                return b.utilization - a.utilization;
            });
        } catch (error) {
            loggingService.error('Error getting budget alerts:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get project budget status
     */
    static async getProjectBudgetStatus(
        projectId?: string,
        _startDate?: Date,
        _endDate?: Date
    ): Promise<ProjectBudgetStatus[]> {
        try {
            const matchStage: any = { isActive: true };
            if (projectId) {
                matchStage._id = projectId;
            }

            const projects = await Project.find(matchStage)
                .populate('workspaceId', 'name')
                .select('name budget spending workspaceId')
                .lean() as Array<{
                    _id: any;
                    name: string;
                    budget: any;
                    spending: any;
                    workspaceId?: any;
                }>;

            const statuses: ProjectBudgetStatus[] = [];

            for (const project of projects) {
                const budget = project.budget;
                const spending = project.spending;

                if (!budget) continue;

                // Calculate budget for current period
                let periodBudget = budget.amount;
                if (budget.period === 'monthly') {
                    periodBudget = budget.amount;
                } else if (budget.period === 'quarterly') {
                    periodBudget = budget.amount / 3;
                } else if (budget.period === 'yearly') {
                    periodBudget = budget.amount / 12;
                }

                // Get actual spending for the specified date range
                let spent = spending.current || 0;
                if (_startDate || _endDate) {
                    const usageMatch: any = { projectId: project._id };
                    if (_startDate || _endDate) {
                        usageMatch.createdAt = {};
                        if (_startDate) usageMatch.createdAt.$gte = _startDate;
                        if (_endDate) usageMatch.createdAt.$lte = _endDate;
                    }

                    const usageResult = await Usage.aggregate([
                        { $match: usageMatch },
                        { $group: { _id: null, totalCost: { $sum: '$cost' } } }
                    ]);

                    spent = usageResult.length > 0 ? usageResult[0].totalCost : 0;
                }

                const remaining = Math.max(0, periodBudget - spent);
                const utilization = periodBudget > 0 ? (spent / periodBudget) * 100 : 0;

                let status: 'on_track' | 'near_limit' | 'over_budget';
                if (utilization >= 100) {
                    status = 'over_budget';
                } else if (utilization >= 80) {
                    status = 'near_limit';
                } else {
                    status = 'on_track';
                }

                const alerts = (budget.alerts || []).map((alert: { threshold: number }) => ({
                    threshold: alert.threshold,
                    triggered: utilization >= alert.threshold
                }));

                statuses.push({
                    projectId: project._id.toString(),
                    projectName: project.name,
                    workspaceId: project.workspaceId 
                        ? (typeof project.workspaceId === 'object' 
                            ? project.workspaceId._id.toString() 
                            : project.workspaceId.toString())
                        : undefined,
                    workspaceName: project.workspaceId 
                        ? (typeof project.workspaceId === 'object' 
                            ? project.workspaceId.name 
                            : undefined)
                        : undefined,
                    budgetAmount: periodBudget,
                    spent,
                    remaining,
                    utilization,
                    period: budget.period,
                    startDate: budget.startDate,
                    endDate: budget.endDate,
                    status,
                    alerts
                });
            }

            return statuses.sort((a, b) => b.utilization - a.utilization);
        } catch (error) {
            loggingService.error('Error getting project budget status:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get budget trends
     */
    static async getBudgetTrends(
        projectId?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<BudgetTrend[]> {
        try {
            // Get projects
            const matchStage: any = { isActive: true };
            if (projectId) {
                matchStage._id = projectId;
            }

            const projects = await Project.find(matchStage)
                .select('budget spending')
                .lean();

            // Get usage data by date
            const usageMatch: any = {};
            if (startDate || endDate) {
                usageMatch.createdAt = {};
                if (startDate) usageMatch.createdAt.$gte = startDate;
                if (endDate) usageMatch.createdAt.$lte = endDate;
            }

            const projectIds = projects.map(p => p._id);

            if (projectIds.length === 0) return [];

            const usageByDate = await Usage.aggregate([
                {
                    $match: {
                        ...usageMatch,
                        projectId: { $in: projectIds }
                    }
                },
                {
                    $group: {
                        _id: {
                            date: {
                                year: { $year: '$createdAt' },
                                month: { $month: '$createdAt' },
                                day: { $dayOfMonth: '$createdAt' }
                            },
                            projectId: '$projectId'
                        },
                        cost: { $sum: '$cost' }
                    }
                },
                {
                    $group: {
                        _id: '$_id.date',
                        totalSpent: { $sum: '$cost' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        date: {
                            $dateFromParts: {
                                year: '$_id.year',
                                month: '$_id.month',
                                day: '$_id.day'
                            }
                        },
                        totalSpent: 1
                    }
                },
                { $sort: { date: 1 } }
            ]);

            // Calculate total budget
            let totalMonthlyBudget = 0;
            for (const project of projects) {
                const budget = project.budget;
                if (!budget || budget.amount === 0) continue;

                if (budget.period === 'monthly') {
                    totalMonthlyBudget += budget.amount;
                } else if (budget.period === 'quarterly') {
                    totalMonthlyBudget += budget.amount / 3;
                } else if (budget.period === 'yearly') {
                    totalMonthlyBudget += budget.amount / 12;
                }
            }

            const trends: BudgetTrend[] = [];
            let cumulativeSpent = 0;

            for (const item of usageByDate) {
                cumulativeSpent += item.totalSpent;
                trends.push({
                    date: item.date.toISOString().split('T')[0],
                    budget: totalMonthlyBudget,
                    spent: cumulativeSpent,
                    utilization: totalMonthlyBudget > 0 ? (cumulativeSpent / totalMonthlyBudget) * 100 : 0
                });
            }

            return trends;
        } catch (error) {
            loggingService.error('Error getting budget trends:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}



