/**
 * Alert Service - Persists budget and cost alerts to the Alert collection.
 * Used by budget enforcement and other modules to record and surface alerts.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Alert, AlertDocument } from '../../schemas/core/alert.schema';

export interface CreateBudgetAlertOptions {
  userId?: string;
  projectId?: string;
  budgetId?: string;
  alertType: string;
  message: string;
  metadata: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    @InjectModel(Alert.name) private readonly alertModel: Model<AlertDocument>,
  ) {}

  /**
   * Create a budget/cost alert and persist it to the database.
   * Alerts appear in the user's alert list and can trigger notifications.
   */
  async createBudgetAlert(
    opts: CreateBudgetAlertOptions,
  ): Promise<AlertDocument | null> {
    if (!opts.userId) {
      this.logger.warn('createBudgetAlert skipped: no userId');
      return null;
    }
    try {
      const severity =
        opts.severity === 'low' ||
        opts.severity === 'medium' ||
        opts.severity === 'high' ||
        opts.severity === 'critical'
          ? opts.severity
          : 'medium';

      const title =
        opts.alertType === 'HIGH_COST_TRANSACTION'
          ? 'High-cost transaction'
          : opts.alertType.replace(/_/g, ' ');

      const doc = await this.alertModel.create({
        userId: new Types.ObjectId(opts.userId),
        type: 'cost',
        title,
        message: opts.message,
        severity,
        data: {
          alertType: opts.alertType,
          projectId: opts.projectId,
          budgetId: opts.budgetId,
          ...opts.metadata,
        },
        metadata: {
          projectId: opts.projectId,
          budgetId: opts.budgetId,
          ...opts.metadata,
        },
        sent: false,
        read: false,
        actionRequired: severity === 'high' || severity === 'critical',
      });

      this.logger.log('Budget alert created', {
        alertId: doc._id.toString(),
        userId: opts.userId,
        alertType: opts.alertType,
        severity,
      });

      return doc;
    } catch (error) {
      this.logger.error('Failed to create budget alert', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: opts.userId,
        alertType: opts.alertType,
      });
      return null;
    }
  }
}
