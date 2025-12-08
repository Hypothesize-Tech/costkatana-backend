import { GoogleConnection } from '../models/GoogleConnection';
import { CalendarAlertSettings } from '../models/CalendarAlertSettings';
import { GoogleService } from './google.service';
import { loggingService } from './logging.service';
import { Project } from '../models/Project';
import { Usage } from '../models/Usage';
import mongoose from 'mongoose';

interface BudgetData {
    budgetId: string;
    name: string;
    totalBudget: number;
    currentSpend: number;
    percentage: number;
    period: string;
}

export class BudgetAlertCalendarService {
    /**
     * Monitor budget thresholds and create calendar events
     */
    static async monitorAndCreateAlerts(userId: mongoose.Types.ObjectId): Promise<void> {
        try {
            // Get user's calendar alert settings
            const settings = await CalendarAlertSettings.findOne({ userId, enabled: true });
            if (!settings) {
                loggingService.debug('No calendar alert settings found for user', { userId: userId.toString() });
                return;
            }

            // Get active Google connection
            const connection = await GoogleConnection.findOne({
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                loggingService.warn('No active Google connection for calendar alerts', { userId: userId.toString() });
                return;
            }

            // Get budget data (placeholder - integrate with actual budget service)
            const budgets = await this.getBudgetData(userId);

            for (const budget of budgets) {
                await this.processbudget(budget, settings, connection);
            }

            loggingService.info('Budget alert calendar monitoring completed', {
                userId: userId.toString(),
                budgetsProcessed: budgets.length
            });
        } catch (error: any) {
            loggingService.error('Failed to monitor budget alerts', {
                userId: userId.toString(),
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Process individual budget and create alerts if thresholds are hit
     */
    private static async processbudget(
        budget: BudgetData,
        settings: any,
        connection: any
    ): Promise<void> {
        const matchedThreshold = settings.thresholds.find(
            (t: any) => budget.percentage >= t.percentage
        );

        if (!matchedThreshold) {
            return;
        }

        // Check if alert already exists
        const existingEvents = await GoogleService.listCalendarEvents(
            connection,
            new Date(),
            undefined,
            10
        );

        const alertTitle = `Budget Alert: ${budget.name} - ${budget.percentage}% Used`;
        const eventExists = existingEvents.some((event: any) =>
            event.summary?.includes(alertTitle)
        );

        if (eventExists) {
            loggingService.debug('Alert event already exists', { budgetId: budget.budgetId });
            return;
        }

        // Create calendar event
        const alertDescription = `Budget: ${budget.name}\nTotal Budget: $${budget.totalBudget}\nCurrent Spend: $${budget.currentSpend}\nPercentage: ${budget.percentage}%\n\nThreshold Alert: ${matchedThreshold.percentage}%`;
        const startTime = new Date(Date.now() + matchedThreshold.notifyBefore * 60 * 60 * 1000);
        const endTime = new Date(Date.now() + (matchedThreshold.notifyBefore + 1) * 60 * 60 * 1000);
        const attendees = settings.recipients;

        await GoogleService.createCalendarEvent(
            connection,
            alertTitle,
            startTime,
            endTime,
            alertDescription,
            attendees
        );

        loggingService.info('Created budget alert calendar event', {
            budgetId: budget.budgetId,
            percentage: budget.percentage,
            threshold: matchedThreshold.percentage
        });
    }

    /**
     * Get budget data from actual project budgets and usage
     */
    private static async getBudgetData(userId: mongoose.Types.ObjectId): Promise<BudgetData[]> {
        try {
            // Get all active projects for the user
            const projects = await Project.find({
                $or: [
                    { ownerId: userId },
                    { 'budget.alerts.recipients': { $exists: true } }
                ],
                isActive: true
            });

            const budgetDataList: BudgetData[] = [];

            for (const project of projects) {
                if (!project.budget || !project.budget.amount) continue;

                // Calculate current period spending
                const now = new Date();
                const budgetStartDate = new Date(project.budget.startDate);
                let periodEndDate: Date;

                // Calculate period end based on budget period
                switch (project.budget.period) {
                    case 'monthly':
                        periodEndDate = new Date(budgetStartDate);
                        periodEndDate.setMonth(periodEndDate.getMonth() + 1);
                        break;
                    case 'quarterly':
                        periodEndDate = new Date(budgetStartDate);
                        periodEndDate.setMonth(periodEndDate.getMonth() + 3);
                        break;
                    case 'yearly':
                        periodEndDate = new Date(budgetStartDate);
                        periodEndDate.setFullYear(periodEndDate.getFullYear() + 1);
                        break;
                    case 'one-time':
                        periodEndDate = project.budget.endDate ? new Date(project.budget.endDate) : new Date(now.getFullYear(), 11, 31);
                        break;
                    default:
                        periodEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                }

                // Get actual spending from Usage collection
                const usage = await Usage.aggregate([
                    {
                        $match: {
                            projectId: project._id,
                            createdAt: {
                                $gte: budgetStartDate,
                                $lte: periodEndDate
                            }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalCost: { $sum: '$cost' }
                        }
                    }
                ]);

                const currentSpend = usage.length > 0 ? usage[0].totalCost : project.spending?.current || 0;
                const percentage = project.budget.amount > 0 
                    ? Math.round((currentSpend / project.budget.amount) * 100) 
                    : 0;

                budgetDataList.push({
                    budgetId: project._id.toString(),
                    name: `${project.name} - ${project.budget.period}`,
                    totalBudget: project.budget.amount,
                    currentSpend: parseFloat(currentSpend.toFixed(2)),
                    percentage,
                    period: `${budgetStartDate.toLocaleDateString()} - ${periodEndDate.toLocaleDateString()}`
                });
            }

            loggingService.debug('Retrieved budget data', {
                userId: userId.toString(),
                projectsFound: projects.length,
                budgetsProcessed: budgetDataList.length
            });

            return budgetDataList;
        } catch (error: any) {
            loggingService.error('Failed to get budget data', {
                userId: userId.toString(),
                error: error.message
            });
            // Return empty array on error to prevent sync failure
            return [];
        }
    }

    /**
     * Map threshold color to Google Calendar color ID
     */
    private static getColorId(color: string): string {
        const colorMap: Record<string, string> = {
            green: '10', // Green
            yellow: '5', // Yellow
            orange: '6', // Orange
            red: '11'    // Red
        };
        return colorMap[color] || '1';
    }

    /**
     * Update existing calendar event with new budget data
     */
    static async updateBudgetAlert(
        userId: mongoose.Types.ObjectId,
        budgetId: string,
        newData: Partial<BudgetData>
    ): Promise<void> {
        try {
            const settings = await CalendarAlertSettings.findOne({ userId, enabled: true });
            if (!settings) return;

            const connection = await GoogleConnection.findOne({
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) return;

            // Find and update the event
            const events = await GoogleService.listCalendarEvents(connection);
            const targetEvent = events.find((event: any) =>
                event.description?.includes(budgetId)
            );

            if (targetEvent) {
                await GoogleService.updateCalendarEvent(connection, targetEvent.id, {
                    description: `Budget: ${newData.name}\nCurrent Spend: $${newData.currentSpend}\nPercentage: ${newData.percentage}%`
                });

                loggingService.info('Updated budget alert calendar event', { budgetId });
            }
        } catch (error: any) {
            loggingService.error('Failed to update budget alert', {
                userId: userId.toString(),
                budgetId,
                error: error.message
            });
        }
    }

    /**
     * Delete budget alert calendar events
     */
    static async deleteBudgetAlert(userId: mongoose.Types.ObjectId, budgetId: string): Promise<void> {
        try {
            const connection = await GoogleConnection.findOne({
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) return;

            const events = await GoogleService.listCalendarEvents(connection);
            const targetEvents = events.filter((event: any) =>
                event.description?.includes(budgetId)
            );

            for (const event of targetEvents) {
                await GoogleService.deleteCalendarEvent(connection, event.id);
            }

            loggingService.info('Deleted budget alert calendar events', {
                userId: userId.toString(),
                budgetId,
                eventsDeleted: targetEvents.length
            });
        } catch (error: any) {
            loggingService.error('Failed to delete budget alert', {
                userId: userId.toString(),
                budgetId,
                error: error.message
            });
        }
    }
}

