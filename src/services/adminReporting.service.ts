import mongoose from 'mongoose';
import { EmailService } from './email.service';
import { loggingService } from './logging.service';
import { AdminUserAnalyticsService } from './adminUserAnalytics.service';
import { AdminUserGrowthService } from './adminUserGrowth.service';
import { AdminModelComparisonService } from './adminModelComparison.service';
import { AdminFeatureAnalyticsService } from './adminFeatureAnalytics.service';
import { AdminProjectAnalyticsService } from './adminProjectAnalytics.service';
import { ScheduledReport } from '../models/ScheduledReport';
import * as XLSX from 'xlsx';

export interface ReportConfig {
    format: 'csv' | 'excel' | 'json';
    startDate?: Date;
    endDate?: Date;
    includeCharts?: boolean;
    sections?: string[];
}

export interface ScheduledReport {
    id: string;
    name: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    format: 'csv' | 'excel' | 'json';
    recipients: string[];
    config: ReportConfig;
    lastSent?: Date;
    nextSend?: Date;
    isActive: boolean;
}

export class AdminReportingService {
    /**
     * Generate CSV report
     */
    static async generateCSVReport(
        config: ReportConfig,
        data: any[]
    ): Promise<string> {
        try {
            const csvRows: string[] = [];
            
            // Add report metadata header if config includes it
            if (config.startDate || config.endDate || config.sections) {
                csvRows.push('"Report Configuration"');
                if (config.startDate) {
                    csvRows.push(`"Start Date","${config.startDate.toISOString()}"`);
                }
                if (config.endDate) {
                    csvRows.push(`"End Date","${config.endDate.toISOString()}"`);
                }
                if (config.sections && config.sections.length > 0) {
                    csvRows.push(`"Sections","${config.sections.join(', ')}"`);
                }
                csvRows.push(''); // Empty row separator
            }

            if (!data || data.length === 0) {
                csvRows.push('"No data available"');
                return csvRows.join('\n');
            }

            // Get headers from first object
            const headers = Object.keys(data[0]);
            
            // Header row
            csvRows.push(headers.map(h => `"${h}"`).join(','));
            
            // Data rows
            for (const row of data) {
                const values = headers.map(header => {
                    const value = row[header];
                    if (value === null || value === undefined) {
                        return '';
                    }
                    if (typeof value === 'object') {
                        return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
                    }
                    return `"${String(value).replace(/"/g, '""')}"`;
                });
                csvRows.push(values.join(','));
            }
            
            // Add summary footer if config includes charts
            if (config.includeCharts && data.length > 0) {
                csvRows.push(''); // Empty row separator
                csvRows.push('"Summary Statistics"');
                csvRows.push(`"Total Records","${data.length}"`);
                if (data[0].totalCost !== undefined) {
                    const totalCost = data.reduce((sum, row) => sum + (row.totalCost || 0), 0);
                    csvRows.push(`"Total Cost","${totalCost.toFixed(2)}"`);
                }
            }
            
            return csvRows.join('\n');
        } catch (error) {
            loggingService.error('Error generating CSV report:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Generate Excel report using xlsx package
     */
    static async generateExcelReport(
        config: ReportConfig,
        data: any[]
    ): Promise<Buffer> {
        try {
            const wb = XLSX.utils.book_new();
            
            // Add metadata sheet if config includes relevant info
            if (config.startDate || config.endDate || config.sections) {
                const metadataRows: any[][] = [
                    ['Report Configuration'],
                    [''],
                ];
                
                if (config.startDate) {
                    metadataRows.push(['Start Date', config.startDate.toISOString()]);
                }
                if (config.endDate) {
                    metadataRows.push(['End Date', config.endDate.toISOString()]);
                }
                if (config.sections && config.sections.length > 0) {
                    metadataRows.push(['Sections', config.sections.join(', ')]);
                }
                if (config.format) {
                    metadataRows.push(['Format', config.format.toUpperCase()]);
                }
                metadataRows.push(['Generated At', new Date().toISOString()]);
                
                const metadataWs = XLSX.utils.aoa_to_sheet(metadataRows);
                XLSX.utils.book_append_sheet(wb, metadataWs, 'Metadata');
            }

            if (!data || data.length === 0) {
                // Create empty worksheet
                const ws = XLSX.utils.aoa_to_sheet([['No data available']]);
                XLSX.utils.book_append_sheet(wb, ws, 'Report');
                return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            }

            // Convert data array to worksheet
            const ws = XLSX.utils.json_to_sheet(data);
            
            // Set column widths for better readability
            const colWidths = Object.keys(data[0]).map((key) => {
                const maxLength = Math.max(
                    key.length,
                    ...data.map(row => String(row[key] || '').length)
                );
                return { wch: Math.min(maxLength + 2, 50) }; // Max width 50
            });
            ws['!cols'] = colWidths;

            // Add summary statistics if config includes charts
            if (config.includeCharts && data.length > 0) {
                const summaryRows: any[][] = [
                    ['Summary Statistics'],
                    [''],
                ];
                
                summaryRows.push(['Total Records', data.length]);
                
                if (data[0].totalCost !== undefined) {
                    const totalCost = data.reduce((sum, row) => sum + (row.totalCost || 0), 0);
                    summaryRows.push(['Total Cost', totalCost.toFixed(2)]);
                }
                
                if (data[0].totalTokens !== undefined) {
                    const totalTokens = data.reduce((sum, row) => sum + (row.totalTokens || 0), 0);
                    summaryRows.push(['Total Tokens', totalTokens]);
                }
                
                if (data[0].totalRequests !== undefined) {
                    const totalRequests = data.reduce((sum, row) => sum + (row.totalRequests || 0), 0);
                    summaryRows.push(['Total Requests', totalRequests]);
                }

                const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
                XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
            }

            // Add main data sheet
            XLSX.utils.book_append_sheet(wb, ws, 'Report Data');

            // Generate buffer
            return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        } catch (error) {
            loggingService.error('Error generating Excel report:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Generate comprehensive admin report
     */
    static async generateComprehensiveReport(
        config: ReportConfig
    ): Promise<any> {
        try {
            const report: any = {
                generatedAt: new Date().toISOString(),
                period: {
                    startDate: config.startDate?.toISOString(),
                    endDate: config.endDate?.toISOString()
                },
                sections: {}
            };

            // User spending summary
            if (!config.sections || config.sections.includes('user_spending')) {
                const userSpending = await AdminUserAnalyticsService.getAllUsersSpending({
                    startDate: config.startDate,
                    endDate: config.endDate
                });
                report.sections.userSpending = userSpending;
            }

            // User growth
            if (!config.sections || config.sections.includes('user_growth')) {
                const growthTrends = await AdminUserGrowthService.getUserGrowthTrends(
                    'daily',
                    config.startDate,
                    config.endDate
                );
                report.sections.userGrowth = growthTrends;
            }

            // Model comparison
            if (!config.sections || config.sections.includes('model_comparison')) {
                const modelComparison = await AdminModelComparisonService.getModelComparison({
                    startDate: config.startDate,
                    endDate: config.endDate
                });
                report.sections.modelComparison = modelComparison;
            }

            // Feature analytics
            if (!config.sections || config.sections.includes('feature_analytics')) {
                const featureStats = await AdminFeatureAnalyticsService.getFeatureUsageStats({
                    startDate: config.startDate,
                    endDate: config.endDate
                });
                report.sections.featureAnalytics = featureStats;
            }

            // Project analytics
            if (!config.sections || config.sections.includes('project_analytics')) {
                const projectAnalytics = await AdminProjectAnalyticsService.getProjectAnalytics({
                    startDate: config.startDate,
                    endDate: config.endDate
                });
                report.sections.projectAnalytics = projectAnalytics;
            }

            // Summary statistics
            const totalCost = report.sections.userSpending?.reduce(
                (sum: number, u: any) => sum + (u.totalCost || 0),
                0
            ) || 0;

            const totalUsers = report.sections.userSpending?.length || 0;

            report.summary = {
                totalCost,
                totalUsers,
                averageCostPerUser: totalUsers > 0 ? totalCost / totalUsers : 0
            };

            return report;
        } catch (error) {
            loggingService.error('Error generating comprehensive report:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Export report in specified format
     */
    static async exportReport(
        config: ReportConfig
    ): Promise<string | Buffer> {
        try {
            const report = await this.generateComprehensiveReport(config);

            switch (config.format) {
                case 'json':
                    const jsonReport: any = {
                        ...report,
                        metadata: {
                            generatedAt: report.generatedAt,
                            format: config.format,
                            includeCharts: config.includeCharts || false,
                            sections: config.sections || [],
                            period: report.period
                        }
                    };
                    
                    // Add chart data if requested
                    if (config.includeCharts && report.sections.userSpending) {
                        jsonReport.charts = {
                            userSpendingDistribution: report.sections.userSpending.map((u: any) => ({
                                name: u.userName || u.userEmail,
                                cost: u.totalCost
                            })),
                            summary: report.summary
                        };
                    }
                    
                    return JSON.stringify(jsonReport, null, 2);
                case 'csv':
                    // Flatten report for CSV based on config sections
                    const csvData: any[] = [];
                    
                    // User spending section
                    if (!config.sections || config.sections.includes('user_spending')) {
                        if (report.sections.userSpending) {
                            for (const user of report.sections.userSpending) {
                                csvData.push({
                                    section: 'user_spending',
                                    userId: user.userId,
                                    userEmail: user.userEmail,
                                    userName: user.userName,
                                    totalCost: user.totalCost,
                                    totalTokens: user.totalTokens,
                                    totalRequests: user.totalRequests
                                });
                            }
                        }
                    }
                    
                    // Model comparison section
                    if (!config.sections || config.sections.includes('model_comparison')) {
                        if (report.sections.modelComparison) {
                            for (const model of report.sections.modelComparison) {
                                csvData.push({
                                    section: 'model_comparison',
                                    model: model.model,
                                    totalCost: model.totalCost,
                                    totalTokens: model.totalTokens,
                                    totalRequests: model.totalRequests,
                                    errorRate: model.errorRate,
                                    efficiencyScore: model.efficiencyScore
                                });
                            }
                        }
                    }
                    
                    // Feature analytics section
                    if (!config.sections || config.sections.includes('feature_analytics')) {
                        if (report.sections.featureAnalytics) {
                            for (const feature of report.sections.featureAnalytics) {
                                csvData.push({
                                    section: 'feature_analytics',
                                    feature: feature.feature,
                                    totalCost: feature.totalCost,
                                    totalTokens: feature.totalTokens,
                                    totalRequests: feature.totalRequests,
                                    uniqueUsers: feature.uniqueUsers
                                });
                            }
                        }
                    }
                    
                    // Project analytics section
                    if (!config.sections || config.sections.includes('project_analytics')) {
                        if (report.sections.projectAnalytics) {
                            for (const project of report.sections.projectAnalytics) {
                                csvData.push({
                                    section: 'project_analytics',
                                    projectName: project.projectName,
                                    totalCost: project.totalCost,
                                    totalTokens: project.totalTokens,
                                    totalRequests: project.totalRequests,
                                    budgetUsagePercentage: project.budgetUsagePercentage
                                });
                            }
                        }
                    }
                    
                    return this.generateCSVReport(config, csvData);
                case 'excel':
                    // Flatten report for Excel based on config sections
                    const excelData: any[] = [];
                    
                    // User spending section
                    if (!config.sections || config.sections.includes('user_spending')) {
                        if (report.sections.userSpending) {
                            for (const user of report.sections.userSpending) {
                                excelData.push({
                                    section: 'user_spending',
                                    userId: user.userId,
                                    userEmail: user.userEmail,
                                    userName: user.userName,
                                    totalCost: user.totalCost,
                                    totalTokens: user.totalTokens,
                                    totalRequests: user.totalRequests
                                });
                            }
                        }
                    }
                    
                    // Model comparison section
                    if (!config.sections || config.sections.includes('model_comparison')) {
                        if (report.sections.modelComparison) {
                            for (const model of report.sections.modelComparison) {
                                excelData.push({
                                    section: 'model_comparison',
                                    model: model.model,
                                    totalCost: model.totalCost,
                                    totalTokens: model.totalTokens,
                                    totalRequests: model.totalRequests,
                                    errorRate: model.errorRate,
                                    efficiencyScore: model.efficiencyScore
                                });
                            }
                        }
                    }
                    
                    // Feature analytics section
                    if (!config.sections || config.sections.includes('feature_analytics')) {
                        if (report.sections.featureAnalytics) {
                            for (const feature of report.sections.featureAnalytics) {
                                excelData.push({
                                    section: 'feature_analytics',
                                    feature: feature.feature,
                                    totalCost: feature.totalCost,
                                    totalTokens: feature.totalTokens,
                                    totalRequests: feature.totalRequests,
                                    uniqueUsers: feature.uniqueUsers
                                });
                            }
                        }
                    }
                    
                    // Project analytics section
                    if (!config.sections || config.sections.includes('project_analytics')) {
                        if (report.sections.projectAnalytics) {
                            for (const project of report.sections.projectAnalytics) {
                                excelData.push({
                                    section: 'project_analytics',
                                    projectName: project.projectName,
                                    totalCost: project.totalCost,
                                    totalTokens: project.totalTokens,
                                    totalRequests: project.totalRequests,
                                    budgetUsagePercentage: project.budgetUsagePercentage
                                });
                            }
                        }
                    }
                    
                    return this.generateExcelReport(config, excelData);
                default:
                    throw new Error(`Unsupported format: ${config.format}`);
            }
        } catch (error) {
            loggingService.error('Error exporting report:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Send report via email
     */
    static async sendReportEmail(
        recipients: string[],
        reportData: string | Buffer,
        reportName: string,
        format: 'csv' | 'excel' | 'json'
    ): Promise<void> {
        try {
            const attachment = {
                filename: `${reportName}.${format === 'excel' ? 'xlsx' : format}`,
                content: reportData,
                contentType: format === 'json' ? 'application/json' :
                           format === 'csv' ? 'text/csv' :
                           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            };

            for (const recipient of recipients) {
                await EmailService.sendEmail({
                    to: recipient,
                    subject: `CostKatana Admin Report: ${reportName}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2>Admin Report: ${reportName}</h2>
                            <p>Please find the attached report in ${format.toUpperCase()} format.</p>
                            <p>Generated at: ${new Date().toLocaleString()}</p>
                            <p>Best regards,<br>CostKatana Admin</p>
                        </div>
                    `,
                    attachments: [attachment]
                });
            }
        } catch (error) {
            loggingService.error('Error sending report email:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Create scheduled report configuration
     */
    static async createScheduledReport(
        report: Omit<ScheduledReport, 'id' | 'lastSent' | 'nextSend'>,
        createdBy?: string
    ): Promise<ScheduledReport> {
        try {
            const nextSend = this.calculateNextSend(report.frequency);
            
            const scheduledReport = new ScheduledReport({
                name: report.name,
                frequency: report.frequency,
                format: report.format,
                recipients: report.recipients,
                config: report.config,
                lastSent: undefined,
                nextSend,
                isActive: report.isActive !== false,
                createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : undefined
            });

            await scheduledReport.save();

            loggingService.info('Scheduled report created', {
                reportId: (scheduledReport._id as mongoose.Types.ObjectId).toString(),
                name: report.name,
                frequency: report.frequency
            });

            return {
                id: (scheduledReport._id as mongoose.Types.ObjectId).toString(),
                name: scheduledReport.name,
                frequency: scheduledReport.frequency,
                format: scheduledReport.format,
                recipients: scheduledReport.recipients,
                config: scheduledReport.config,
                lastSent: scheduledReport.lastSent,
                nextSend: scheduledReport.nextSend,
                isActive: scheduledReport.isActive
            };
        } catch (error) {
            loggingService.error('Error creating scheduled report:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get scheduled report by ID
     */
    static async getScheduledReport(reportId: string): Promise<ScheduledReport | null> {
        try {
            const report = await ScheduledReport.findById(reportId).lean();
            if (!report) return null;

            return {
                id: report._id.toString(),
                name: report.name,
                frequency: report.frequency,
                format: report.format,
                recipients: report.recipients,
                config: report.config,
                lastSent: report.lastSent,
                nextSend: report.nextSend,
                isActive: report.isActive
            };
        } catch (error) {
            loggingService.error('Error getting scheduled report:', {
                error: error instanceof Error ? error.message : String(error),
                reportId
            });
            throw error;
        }
    }

    /**
     * Get all scheduled reports
     */
    static async getAllScheduledReports(
        filters?: { isActive?: boolean; createdBy?: string }
    ): Promise<ScheduledReport[]> {
        try {
            const query: any = {};
            
            if (filters?.isActive !== undefined) {
                query.isActive = filters.isActive;
            }
            
            if (filters?.createdBy) {
                query.createdBy = new mongoose.Types.ObjectId(filters.createdBy);
            }

            const reports = await ScheduledReport.find(query)
                .sort({ createdAt: -1 })
                .lean();

            return reports.map(report => ({
                id: report._id.toString(),
                name: report.name,
                frequency: report.frequency,
                format: report.format,
                recipients: report.recipients,
                config: report.config,
                lastSent: report.lastSent,
                nextSend: report.nextSend,
                isActive: report.isActive
            }));
        } catch (error) {
            loggingService.error('Error getting all scheduled reports:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Update scheduled report
     */
    static async updateScheduledReport(
        reportId: string,
        updates: Partial<Omit<ScheduledReport, 'id'>>
    ): Promise<ScheduledReport | null> {
        try {
            const report = await ScheduledReport.findById(reportId);
            if (!report) return null;

            // Update fields
            if (updates.name !== undefined) report.name = updates.name;
            if (updates.frequency !== undefined) {
                report.frequency = updates.frequency;
                report.nextSend = this.calculateNextSend(updates.frequency);
            }
            if (updates.format !== undefined) report.format = updates.format;
            if (updates.recipients !== undefined) report.recipients = updates.recipients;
            if (updates.config !== undefined) report.config = updates.config;
            if (updates.isActive !== undefined) report.isActive = updates.isActive;

            await report.save();

            loggingService.info('Scheduled report updated', {
                reportId,
                updates: Object.keys(updates)
            });

            return {
                id: (report._id as mongoose.Types.ObjectId).toString(),
                name: report.name,
                frequency: report.frequency,
                format: report.format,
                recipients: report.recipients,
                config: report.config,
                lastSent: report.lastSent,
                nextSend: report.nextSend,
                isActive: report.isActive
            };
        } catch (error) {
            loggingService.error('Error updating scheduled report:', {
                error: error instanceof Error ? error.message : String(error),
                reportId
            });
            throw error;
        }
    }

    /**
     * Delete scheduled report
     */
    static async deleteScheduledReport(reportId: string): Promise<boolean> {
        try {
            const result = await ScheduledReport.findByIdAndDelete(reportId);
            
            if (result) {
                loggingService.info('Scheduled report deleted', { reportId });
                return true;
            }
            
            return false;
        } catch (error) {
            loggingService.error('Error deleting scheduled report:', {
                error: error instanceof Error ? error.message : String(error),
                reportId
            });
            throw error;
        }
    }

    /**
     * Get scheduled reports ready to send
     */
    static async getReportsReadyToSend(): Promise<ScheduledReport[]> {
        try {
            const now = new Date();
            
            const reports = await ScheduledReport.find({
                isActive: true,
                nextSend: { $lte: now }
            }).lean();

            return reports.map(report => ({
                id: report._id.toString(),
                name: report.name,
                frequency: report.frequency,
                format: report.format,
                recipients: report.recipients,
                config: report.config,
                lastSent: report.lastSent,
                nextSend: report.nextSend,
                isActive: report.isActive
            }));
        } catch (error) {
            loggingService.error('Error getting reports ready to send:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Mark report as sent and update next send date
     */
    static async markReportAsSent(reportId: string): Promise<void> {
        try {
            const report = await ScheduledReport.findById(reportId);
            if (!report) {
                throw new Error(`Scheduled report not found: ${reportId}`);
            }

            report.lastSent = new Date();
            report.nextSend = this.calculateNextSend(report.frequency);
            
            await report.save();

            loggingService.info('Scheduled report marked as sent', {
                reportId,
                lastSent: report.lastSent,
                nextSend: report.nextSend
            });
        } catch (error) {
            loggingService.error('Error marking report as sent:', {
                error: error instanceof Error ? error.message : String(error),
                reportId
            });
            throw error;
        }
    }

    /**
     * Calculate next send date based on frequency
     */
    private static calculateNextSend(frequency: 'daily' | 'weekly' | 'monthly'): Date {
        const now = new Date();
        
        switch (frequency) {
            case 'daily':
                now.setDate(now.getDate() + 1);
                now.setHours(9, 0, 0, 0); // 9 AM
                break;
            case 'weekly':
                now.setDate(now.getDate() + 7);
                now.setHours(9, 0, 0, 0);
                break;
            case 'monthly':
                now.setMonth(now.getMonth() + 1);
                now.setDate(1);
                now.setHours(9, 0, 0, 0);
                break;
        }
        
        return now;
    }

    /**
     * Generate custom report with selected metrics
     */
    static async generateCustomReport(
        config: ReportConfig & {
            metrics: string[];
        }
    ): Promise<any> {
        try {
            const report: any = {
                generatedAt: new Date().toISOString(),
                period: {
                    startDate: config.startDate?.toISOString(),
                    endDate: config.endDate?.toISOString()
                },
                metrics: {}
            };

            // Generate selected metrics
            if (config.metrics.includes('user_spending')) {
                const userSpending = await AdminUserAnalyticsService.getAllUsersSpending({
                    startDate: config.startDate,
                    endDate: config.endDate
                });
                report.metrics.userSpending = userSpending;
            }

            if (config.metrics.includes('model_comparison')) {
                const modelComparison = await AdminModelComparisonService.getModelComparison({
                    startDate: config.startDate,
                    endDate: config.endDate
                });
                report.metrics.modelComparison = modelComparison;
            }

            if (config.metrics.includes('feature_usage')) {
                const featureStats = await AdminFeatureAnalyticsService.getFeatureUsageStats({
                    startDate: config.startDate,
                    endDate: config.endDate
                });
                report.metrics.featureUsage = featureStats;
            }

            if (config.metrics.includes('project_spending')) {
                const projectAnalytics = await AdminProjectAnalyticsService.getProjectAnalytics({
                    startDate: config.startDate,
                    endDate: config.endDate
                });
                report.metrics.projectSpending = projectAnalytics;
            }

            return report;
        } catch (error) {
            loggingService.error('Error generating custom report:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}

