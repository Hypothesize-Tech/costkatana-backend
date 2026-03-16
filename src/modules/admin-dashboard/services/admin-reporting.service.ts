import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { Response } from 'express';
import { User, UserDocument } from '../../../schemas/user/user.schema';
import {
  Project,
  ProjectDocument,
} from '../../../schemas/team-project/project.schema';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  Workspace,
  WorkspaceDocument,
} from '../../../schemas/user/workspace.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../../../schemas/core/subscription.schema';
import {
  ScheduledReport,
  ScheduledReportDocument,
} from '../../../schemas/logging/scheduled-report.schema';
import { EmailService } from '../../email/email.service';

@Injectable()
export class AdminReportingService {
  private readonly logger = new Logger(AdminReportingService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(ScheduledReport.name)
    private scheduledReportModel: Model<ScheduledReportDocument>,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Generate user activity report
   */
  async generateUserActivityReport(
    startDate?: Date,
    endDate?: Date,
  ): Promise<Buffer> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Get user activity data
      const userActivity = await this.userModel.aggregate([
        {
          $match: { isActive: true },
        },
        {
          $lookup: {
            from: 'usages',
            localField: '_id',
            foreignField: 'userId',
            as: 'usage',
            pipeline: [
              {
                $match: matchQuery,
              },
              {
                $group: {
                  _id: null,
                  totalRequests: { $sum: 1 },
                  totalCost: { $sum: '$cost' },
                  totalTokens: { $sum: '$tokens' },
                  avgResponseTime: { $avg: '$responseTime' },
                  lastActivity: { $max: '$createdAt' },
                },
              },
            ],
          },
        },
        {
          $lookup: {
            from: 'projects',
            localField: '_id',
            foreignField: 'userId',
            as: 'projects',
          },
        },
        {
          $project: {
            email: 1,
            role: 1,
            isActive: 1,
            createdAt: 1,
            lastLogin: 1,
            totalRequests: {
              $ifNull: [{ $arrayElemAt: ['$usage.totalRequests', 0] }, 0],
            },
            totalCost: {
              $ifNull: [{ $arrayElemAt: ['$usage.totalCost', 0] }, 0],
            },
            totalTokens: {
              $ifNull: [{ $arrayElemAt: ['$usage.totalTokens', 0] }, 0],
            },
            avgResponseTime: {
              $ifNull: [{ $arrayElemAt: ['$usage.avgResponseTime', 0] }, 0],
            },
            lastActivity: {
              $ifNull: [{ $arrayElemAt: ['$usage.lastActivity', 0] }, null],
            },
            projectCount: { $size: '$projects' },
          },
        },
        {
          $sort: { totalCost: -1 },
        },
      ]);

      // Create Excel workbook
      const workbook = XLSX.utils.book_new();

      // User Activity Sheet
      const userActivityData = userActivity.map((user) => ({
        Email: user.email,
        Role: user.role,
        Status: user.isActive ? 'Active' : 'Inactive',
        'Registration Date': user.createdAt
          ? new Date(user.createdAt).toLocaleDateString()
          : '',
        'Last Login': user.lastLogin
          ? new Date(user.lastLogin).toLocaleDateString()
          : '',
        'Total Requests': user.totalRequests,
        'Total Cost ($)': user.totalCost.toFixed(2),
        'Total Tokens': user.totalTokens,
        'Avg Response Time (ms)': user.avgResponseTime.toFixed(2),
        'Last Activity': user.lastActivity
          ? new Date(user.lastActivity).toLocaleDateString()
          : '',
        'Projects Count': user.projectCount,
      }));

      const userActivitySheet = XLSX.utils.json_to_sheet(userActivityData);
      XLSX.utils.book_append_sheet(
        workbook,
        userActivitySheet,
        'User Activity',
      );

      // Summary Sheet
      const summaryData = [
        {
          Metric: 'Total Users',
          Value: userActivity.length,
        },
        {
          Metric: 'Active Users',
          Value: userActivity.filter((u) => u.isActive).length,
        },
        {
          Metric: 'Total Requests',
          Value: userActivity.reduce((sum, u) => sum + u.totalRequests, 0),
        },
        {
          Metric: 'Total Cost ($)',
          Value: userActivity
            .reduce((sum, u) => sum + u.totalCost, 0)
            .toFixed(2),
        },
        {
          Metric: 'Total Tokens',
          Value: userActivity.reduce((sum, u) => sum + u.totalTokens, 0),
        },
      ];

      const summarySheet = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      return buffer;
    } catch (error) {
      this.logger.error('Error generating user activity report:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminReportingService',
        operation: 'generateUserActivityReport',
      });
      throw error;
    }
  }

  /**
   * Generate cost analysis report
   */
  async generateCostAnalysisReport(
    startDate?: Date,
    endDate?: Date,
  ): Promise<Buffer> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Get cost analysis by service and model
      const costAnalysis = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: {
              service: '$service',
              model: '$model',
            },
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$tokens' },
            inputTokens: { $sum: '$inputTokens' },
            outputTokens: { $sum: '$outputTokens' },
            avgCostPerRequest: { $avg: '$cost' },
            avgCostPerToken: {
              $cond: [
                { $eq: ['$totalTokens', 0] },
                0,
                { $divide: ['$totalCost', '$totalTokens'] },
              ],
            },
          },
        },
        {
          $sort: { totalCost: -1 },
        },
      ] as any[]);

      // Get cost by project
      const projectCosts = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'projectId',
            foreignField: '_id',
            as: 'project',
          },
        },
        {
          $group: {
            _id: '$projectId',
            projectName: { $first: { $arrayElemAt: ['$project.name', 0] } },
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$tokens' },
          },
        },
        {
          $sort: { totalCost: -1 },
        },
        {
          $limit: 50, // Top 50 projects
        },
      ]);

      // Create Excel workbook
      const workbook = XLSX.utils.book_new();

      // Cost by Service/Model Sheet
      const serviceModelData = costAnalysis.map((item) => ({
        Service: item._id.service,
        Model: item._id.model,
        'Total Requests': item.totalRequests,
        'Total Cost ($)': item.totalCost.toFixed(4),
        'Total Tokens': item.totalTokens,
        'Input Tokens': item.inputTokens,
        'Output Tokens': item.outputTokens,
        'Avg Cost per Request ($)': item.avgCostPerRequest.toFixed(4),
        'Avg Cost per Token ($)': item.avgCostPerToken.toFixed(6),
      }));

      const serviceModelSheet = XLSX.utils.json_to_sheet(serviceModelData);
      XLSX.utils.book_append_sheet(
        workbook,
        serviceModelSheet,
        'Cost by Service/Model',
      );

      // Cost by Project Sheet
      const projectData = projectCosts.map((item) => ({
        'Project ID': item._id,
        'Project Name': item.projectName || 'Unknown',
        'Total Requests': item.totalRequests,
        'Total Cost ($)': item.totalCost.toFixed(2),
        'Total Tokens': item.totalTokens,
      }));

      const projectSheet = XLSX.utils.json_to_sheet(projectData);
      XLSX.utils.book_append_sheet(workbook, projectSheet, 'Cost by Project');

      // Cost Summary Sheet
      const totalCost = costAnalysis.reduce(
        (sum, item) => sum + item.totalCost,
        0,
      );
      const totalRequests = costAnalysis.reduce(
        (sum, item) => sum + item.totalRequests,
        0,
      );
      const totalTokens = costAnalysis.reduce(
        (sum, item) => sum + item.totalTokens,
        0,
      );

      const summaryData = [
        {
          Metric: 'Total Cost ($)',
          Value: totalCost.toFixed(2),
        },
        {
          Metric: 'Total Requests',
          Value: totalRequests,
        },
        {
          Metric: 'Total Tokens',
          Value: totalTokens,
        },
        {
          Metric: 'Avg Cost per Request ($)',
          Value:
            totalRequests > 0 ? (totalCost / totalRequests).toFixed(4) : '0',
        },
        {
          Metric: 'Avg Cost per Token ($)',
          Value: totalTokens > 0 ? (totalCost / totalTokens).toFixed(6) : '0',
        },
      ];

      const summarySheet = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Cost Summary');

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      return buffer;
    } catch (error) {
      this.logger.error('Error generating cost analysis report:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminReportingService',
        operation: 'generateCostAnalysisReport',
      });
      throw error;
    }
  }

  /**
   * Generate performance report
   */
  async generatePerformanceReport(
    startDate?: Date,
    endDate?: Date,
  ): Promise<Buffer> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Get performance metrics by endpoint (pipeline typed as any[] for $cond/$percentile)
      const performancePipeline: any[] = [
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$endpoint',
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            minResponseTime: { $min: '$responseTime' },
            maxResponseTime: { $max: '$responseTime' },
            errorCount: {
              $sum: {
                $cond: [{ $gt: ['$errorCode', 0] }, 1, 0],
              },
            },
            successCount: {
              $sum: {
                $cond: [{ $eq: ['$errorCode', 0] }, 1, 0],
              },
            },
            p95ResponseTime: {
              $percentile: { input: '$responseTime', p: [0.95] },
            },
            p99ResponseTime: {
              $percentile: { input: '$responseTime', p: [0.99] },
            },
          },
        },
        {
          $project: {
            endpoint: '$_id',
            totalRequests: 1,
            avgResponseTime: 1,
            minResponseTime: 1,
            maxResponseTime: 1,
            errorCount: 1,
            successCount: 1,
            errorRate: {
              $multiply: [{ $divide: ['$errorCount', '$totalRequests'] }, 100],
            },
            successRate: {
              $multiply: [
                { $divide: ['$successCount', '$totalRequests'] },
                100,
              ],
            },
            p95ResponseTime: { $arrayElemAt: ['$p95ResponseTime', 0] },
            p99ResponseTime: { $arrayElemAt: ['$p99ResponseTime', 0] },
          },
        },
        {
          $sort: { totalRequests: -1 },
        },
        {
          $limit: 100, // Top 100 endpoints
        },
      ];
      const endpointPerformance =
        await this.usageModel.aggregate(performancePipeline);

      // Get performance by service
      const servicePerformance = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$service',
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            errorRate: {
              $avg: {
                $cond: [{ $gt: ['$errorCode', 0] }, 1, 0],
              },
            },
            throughput: {
              $sum: {
                $divide: [1, { $ifNull: ['$responseTime', 1000] }], // Simplified throughput
              },
            },
          },
        },
        {
          $project: {
            service: '$_id',
            totalRequests: 1,
            avgResponseTime: 1,
            errorRate: { $multiply: ['$errorRate', 100] },
            throughput: 1,
          },
        },
        {
          $sort: { totalRequests: -1 },
        },
      ] as any[]);
      const workbook = XLSX.utils.book_new();

      // Endpoint Performance Sheet
      const endpointData = endpointPerformance.map((item) => ({
        Endpoint: item.endpoint,
        'Total Requests': item.totalRequests,
        'Avg Response Time (ms)': item.avgResponseTime?.toFixed(2) || '0',
        'Min Response Time (ms)': item.minResponseTime || 0,
        'Max Response Time (ms)': item.maxResponseTime || 0,
        'P95 Response Time (ms)': item.p95ResponseTime?.toFixed(2) || '0',
        'P99 Response Time (ms)': item.p99ResponseTime?.toFixed(2) || '0',
        'Error Rate (%)': item.errorRate?.toFixed(2) || '0',
        'Success Rate (%)': item.successRate?.toFixed(2) || '0',
      }));

      const endpointSheet = XLSX.utils.json_to_sheet(endpointData);
      XLSX.utils.book_append_sheet(
        workbook,
        endpointSheet,
        'Endpoint Performance',
      );

      // Service Performance Sheet
      const serviceData = servicePerformance.map((item) => ({
        Service: item.service,
        'Total Requests': item.totalRequests,
        'Avg Response Time (ms)': item.avgResponseTime?.toFixed(2) || '0',
        'Error Rate (%)': item.errorRate?.toFixed(2) || '0',
        'Throughput (req/sec)': item.throughput?.toFixed(2) || '0',
      }));

      const serviceSheet = XLSX.utils.json_to_sheet(serviceData);
      XLSX.utils.book_append_sheet(
        workbook,
        serviceSheet,
        'Service Performance',
      );

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      return buffer;
    } catch (error) {
      this.logger.error('Error generating performance report:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminReportingService',
        operation: 'generatePerformanceReport',
      });
      throw error;
    }
  }

  /**
   * Schedule a report
   */
  async scheduleReport(
    reportType: string,
    frequency: 'daily' | 'weekly' | 'monthly',
    recipients: string[],
    config: any = {},
  ): Promise<string> {
    try {
      const scheduledReport = new this.scheduledReportModel({
        reportType,
        frequency,
        recipients,
        config,
        isActive: true,
        nextRun: this.calculateNextRun(frequency),
        createdAt: new Date(),
      });

      await scheduledReport.save();

      this.logger.log(
        `Scheduled ${reportType} report with ID: ${scheduledReport._id}`,
      );

      return scheduledReport._id.toString();
    } catch (error) {
      this.logger.error('Error scheduling report:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminReportingService',
        operation: 'scheduleReport',
      });
      throw error;
    }
  }

  /**
   * Send report via email
   */
  async sendReportEmail(
    reportType: string,
    recipients: string[],
    reportBuffer: Buffer,
    filename: string,
  ): Promise<void> {
    try {
      await this.emailService.sendEmail({
        to: recipients.join(','),
        subject: `Cost Katana ${reportType} Report`,
        html: `
          <h2>${reportType} Report</h2>
          <p>Please find attached the latest ${reportType.toLowerCase()} report.</p>
          <p>Report generated on: ${new Date().toLocaleString()}</p>
        `,
        attachments: [
          {
            filename,
            content: reportBuffer,
            contentType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      });

      this.logger.log(
        `Sent ${reportType} report to ${recipients.length} recipients`,
      );
    } catch (error) {
      this.logger.error('Error sending report email:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminReportingService',
        operation: 'sendReportEmail',
      });
      throw error;
    }
  }

  /**
   * Get scheduled reports
   */
  async getScheduledReports(): Promise<any[]> {
    try {
      const reports = await this.scheduledReportModel
        .find({ isActive: true })
        .sort({ createdAt: -1 })
        .lean();

      return reports;
    } catch (error) {
      this.logger.error('Error getting scheduled reports:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminReportingService',
        operation: 'getScheduledReports',
      });
      throw error;
    }
  }

  /**
   * Calculate next run date based on frequency
   */
  private calculateNextRun(frequency: 'daily' | 'weekly' | 'monthly'): Date {
    const now = new Date();

    switch (frequency) {
      case 'daily':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
      case 'weekly':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Next week
      case 'monthly':
        const nextMonth = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          now.getDate(),
        );
        return nextMonth;
      default:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Process scheduled reports (to be called by a cron job)
   */
  async processScheduledReports(): Promise<void> {
    try {
      const now = new Date();
      const dueReports = await this.scheduledReportModel.find({
        isActive: true,
        nextRun: { $lte: now },
      });

      for (const report of dueReports) {
        const r = report as unknown as ScheduledReport & {
          save: () => Promise<typeof report>;
        };
        try {
          let reportBuffer: Buffer;
          let filename: string;
          const reportType = r.reportType;

          switch (reportType) {
            case 'user-activity':
              reportBuffer = await this.generateUserActivityReport(
                r.config?.startDate,
                r.config?.endDate,
              );
              filename = `user-activity-report-${now.toISOString().split('T')[0]}.xlsx`;
              break;
            case 'cost-analysis':
              reportBuffer = await this.generateCostAnalysisReport(
                r.config?.startDate,
                r.config?.endDate,
              );
              filename = `cost-analysis-report-${now.toISOString().split('T')[0]}.xlsx`;
              break;
            case 'performance':
              reportBuffer = await this.generatePerformanceReport(
                r.config?.startDate,
                r.config?.endDate,
              );
              filename = `performance-report-${now.toISOString().split('T')[0]}.xlsx`;
              break;
            default:
              this.logger.warn(`Unknown report type: ${reportType}`);
              continue;
          }

          await this.sendReportEmail(
            reportType,
            r.recipients,
            reportBuffer,
            filename,
          );

          // Update next run (set on document so save() persists)
          const doc = report as unknown as ScheduledReportDocument;
          doc.lastRun = now;
          doc.nextRun = this.calculateNextRun(r.frequency);
          await doc.save();
        } catch (error) {
          this.logger.error(
            `Error processing scheduled report ${report._id}:`,
            error,
          );
        }
      }

      this.logger.log(`Processed ${dueReports.length} scheduled reports`);
    } catch (error) {
      this.logger.error('Error processing scheduled reports:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminReportingService',
        operation: 'processScheduledReports',
      });
      throw error;
    }
  }
}
