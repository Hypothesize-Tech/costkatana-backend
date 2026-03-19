import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExperimentSession } from '../../../schemas/analytics/experiment-session.schema';
import { Experiment } from '../../../schemas/analytics/experiment.schema';
import { generateSecureId } from '../../../common/utils/secure-id.util';

export interface ExperimentResult {
  id: string;
  name: string;
  type: 'model_comparison' | 'what_if' | 'fine_tuning';
  status: 'running' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  results: Record<string, unknown>;
  metadata: {
    duration: number;
    iterations: number;
    confidence: number;
  };
  userId: string;
  createdAt: Date;
}

export interface ExperimentSessionData {
  sessionId: string;
  userId: string;
  createdAt: Date;
  status: 'active' | 'completed' | 'cancelled';
  experimentType: string;
}

/**
 * Experiment Manager Service - NestJS equivalent of Express ExperimentManagerService
 * Handles experiment lifecycle management, session tracking, and real-time progress updates
 */
@Injectable()
export class ExperimentManagerService {
  private readonly logger = new Logger(ExperimentManagerService.name);

  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CONCURRENT_SESSIONS = 100;
  private readonly MAX_SESSIONS_PER_USER = 5;

  private sessionTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private eventEmitter: EventEmitter2,
    @InjectModel(ExperimentSession.name)
    private readonly sessionModel: Model<ExperimentSession>,
    @InjectModel(Experiment.name)
    private readonly experimentModel: Model<Experiment>,
  ) {
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
  }

  /**
   * Create a new experiment session
   */
  async createExperimentSession(
    userId: string,
    experimentType: string,
    _metadata?: Record<string, unknown>,
  ): Promise<string> {
    try {
      const userIdObj = new Types.ObjectId(userId);

      const activeCount = await this.sessionModel.countDocuments({
        userId: userIdObj,
        status: 'active',
      });
      if (activeCount >= this.MAX_SESSIONS_PER_USER) {
        throw new Error('Maximum concurrent experiments reached for user');
      }

      const totalActive = await this.sessionModel.countDocuments({
        status: 'active',
      });
      if (totalActive >= this.MAX_CONCURRENT_SESSIONS) {
        throw new Error('System at maximum experiment capacity');
      }

      const sessionId = this.generateSessionId();
      await this.sessionModel.create({
        sessionId,
        userId: userIdObj,
        createdAt: new Date(),
        status: 'active',
        experimentType,
      });

      const timeout = setTimeout(() => {
        this.expireSession(sessionId);
      }, this.SESSION_TIMEOUT);
      this.sessionTimeouts.set(sessionId, timeout);

      this.logger.log(`Experiment session created: ${sessionId}`, {
        userId,
        experimentType,
      });

      const session: ExperimentSessionData = {
        sessionId,
        userId,
        createdAt: new Date(),
        status: 'active',
        experimentType,
      };
      this.eventEmitter.emit('experiment.session.created', session);

      return sessionId;
    } catch (error) {
      this.logger.error('Error creating experiment session', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        experimentType,
      });
      throw error;
    }
  }

  /**
   * Get experiment session by ID (from DB).
   */
  async getExperimentSession(
    sessionId: string,
  ): Promise<ExperimentSessionData | null> {
    const doc = await this.sessionModel.findOne({ sessionId }).lean().exec();
    if (!doc) return null;
    return {
      sessionId: doc.sessionId,
      userId: String(doc.userId),
      createdAt: doc.createdAt,
      status: doc.status,
      experimentType: doc.experimentType,
    };
  }

  /**
   * Update experiment session status
   */
  async updateExperimentSession(
    sessionId: string,
    updates: Partial<Pick<ExperimentSessionData, 'status'>>,
  ): Promise<void> {
    const session = await this.sessionModel.findOne({ sessionId }).exec();
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (updates.status) {
      session.status = updates.status;
      await session.save();
    }

    if (updates.status === 'completed' || updates.status === 'cancelled') {
      const timeout = this.sessionTimeouts.get(sessionId);
      if (timeout) {
        clearTimeout(timeout);
        this.sessionTimeouts.delete(sessionId);
      }
    }

    this.eventEmitter.emit('experiment.session.updated', {
      sessionId: session.sessionId,
      userId: String(session.userId),
      createdAt: session.createdAt,
      status: session.status,
      experimentType: session.experimentType,
    });

    this.logger.log(`Experiment session updated: ${sessionId}`, {
      status: updates.status,
      userId: String(session.userId),
    });
  }

  /**
   * Create and store experiment result
   */
  async createExperimentResult(
    sessionId: string,
    resultData: Omit<ExperimentResult, 'id' | 'createdAt'>,
  ): Promise<ExperimentResult> {
    const session = await this.sessionModel.findOne({ sessionId }).exec();
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const resultId = this.generateResultId();
    const userIdObj = new Types.ObjectId(resultData.userId);

    await this.experimentModel.create({
      resultId,
      sessionId,
      userId: userIdObj,
      name: resultData.name,
      type: resultData.type,
      status: resultData.status,
      startTime:
        typeof resultData.startTime === 'string'
          ? new Date(resultData.startTime)
          : resultData.startTime,
      endTime: resultData.endTime ? new Date(resultData.endTime) : undefined,
      results: resultData.results ?? {},
      metadata: resultData.metadata,
    });

    if (resultData.status === 'completed' || resultData.status === 'failed') {
      await this.updateExperimentSession(sessionId, { status: 'completed' });
    }

    const result: ExperimentResult = {
      ...resultData,
      id: resultId,
      createdAt: new Date(),
    };
    this.eventEmitter.emit('experiment.result.created', {
      session: {
        sessionId: session.sessionId,
        userId: String(session.userId),
        createdAt: session.createdAt,
        status: session.status,
        experimentType: session.experimentType,
      },
      result,
    });

    this.logger.log(`Experiment result created: ${resultId}`, {
      sessionId,
      type: result.type,
      status: result.status,
      userId: result.userId,
    });

    return result;
  }

  /**
   * Get experiment result by ID (from DB).
   */
  async getExperimentResult(
    resultId: string,
  ): Promise<ExperimentResult | null> {
    const doc = await this.experimentModel.findOne({ resultId }).lean().exec();
    if (!doc) return null;
    return this.toExperimentResult(doc);
  }

  /**
   * Get all experiment results for a user
   */
  async getUserExperimentResults(
    userId: string,
    options: {
      type?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<ExperimentResult[]> {
    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (options.type) query.type = options.type;
    if (options.status) query.status = options.status;

    const docs = await this.experimentModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(options.offset ?? 0)
      .limit(options.limit ?? 50)
      .lean()
      .exec();

    return docs.map((d) => this.toExperimentResult(d));
  }

  /**
   * Get active sessions for a user (from DB).
   */
  async getActiveSessions(userId: string): Promise<ExperimentSessionData[]> {
    const docs = await this.sessionModel
      .find({ userId: new Types.ObjectId(userId), status: 'active' })
      .lean()
      .exec();
    return docs.map((d) => ({
      sessionId: d.sessionId,
      userId: String(d.userId),
      createdAt: d.createdAt,
      status: d.status,
      experimentType: d.experimentType,
    }));
  }

  /**
   * Cancel experiment session
   */
  async cancelExperimentSession(sessionId: string): Promise<void> {
    const session = await this.sessionModel.findOne({ sessionId }).exec();
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    await this.updateExperimentSession(sessionId, { status: 'cancelled' });

    this.eventEmitter.emit('experiment.session.cancelled', {
      sessionId: session.sessionId,
      userId: String(session.userId),
      createdAt: session.createdAt,
      status: session.status,
      experimentType: session.experimentType,
    });

    this.logger.log(`Experiment session cancelled: ${sessionId}`, {
      userId: String(session.userId),
    });
  }

  /**
   * Send progress update for experiment session
   */
  async sendProgressUpdate(
    sessionId: string,
    progress: {
      stage: string;
      progress: number;
      message?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<void> {
    const session = await this.sessionModel
      .findOne({ sessionId })
      .lean()
      .exec();
    if (!session) return;

    this.eventEmitter.emit('experiment.progress', {
      sessionId,
      session: {
        sessionId: session.sessionId,
        userId: String(session.userId),
        createdAt: session.createdAt,
        status: session.status,
        experimentType: session.experimentType,
      },
      progress,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Progress update for session ${sessionId}: ${progress.progress}%`,
      { stage: progress.stage, message: progress.message },
    );
  }

  /**
   * Get experiment statistics for a user
   */
  async getExperimentStatistics(userId: string): Promise<{
    totalExperiments: number;
    activeExperiments: number;
    completedExperiments: number;
    failedExperiments: number;
    totalDuration: number;
    averageDuration: number;
    experimentsByType: Record<string, number>;
  }> {
    try {
      const docs = await this.experimentModel
        .find({ userId: new Types.ObjectId(userId) })
        .lean()
        .exec();

      const activeCount = await this.sessionModel.countDocuments({
        userId: new Types.ObjectId(userId),
        status: 'active',
      });

      const completed = docs.filter((d) => d.status === 'completed').length;
      const failed = docs.filter((d) => d.status === 'failed').length;
      const totalDuration = docs
        .filter((d) => d.metadata?.duration)
        .reduce((sum, d) => sum + (d.metadata?.duration ?? 0), 0);
      const averageDuration = docs.length > 0 ? totalDuration / docs.length : 0;
      const experimentsByType: Record<string, number> = {};
      docs.forEach((d) => {
        experimentsByType[d.type] = (experimentsByType[d.type] ?? 0) + 1;
      });

      return {
        totalExperiments: docs.length,
        activeExperiments: activeCount,
        completedExperiments: completed,
        failedExperiments: failed,
        totalDuration,
        averageDuration,
        experimentsByType,
      };
    } catch (error) {
      this.logger.error('Error getting experiment statistics', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return {
        totalExperiments: 0,
        activeExperiments: 0,
        completedExperiments: 0,
        failedExperiments: 0,
        totalDuration: 0,
        averageDuration: 0,
        experimentsByType: {},
      };
    }
  }

  private toExperimentResult(doc: {
    resultId?: string;
    _id?: unknown;
    userId: unknown;
    name: string;
    type: ExperimentResult['type'];
    status: ExperimentResult['status'];
    startTime: Date | string;
    endTime?: Date;
    results?: Record<string, unknown>;
    metadata: ExperimentResult['metadata'];
    createdAt: Date;
  }): ExperimentResult {
    return {
      id: doc.resultId ?? String(doc._id),
      name: doc.name,
      type: doc.type,
      status: doc.status,
      startTime:
        typeof doc.startTime === 'string'
          ? doc.startTime
          : doc.startTime.toISOString(),
      endTime: doc.endTime?.toISOString(),
      results: doc.results ?? {},
      metadata: doc.metadata,
      userId: String(doc.userId),
      createdAt: doc.createdAt,
    };
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - this.SESSION_TIMEOUT);
    const expired = await this.sessionModel
      .find({ status: 'active', createdAt: { $lt: cutoff } })
      .select('sessionId')
      .lean()
      .exec();

    for (const s of expired) {
      await this.expireSession(s.sessionId);
    }
    if (expired.length > 0) {
      this.logger.log(
        `Cleaned up ${expired.length} expired experiment sessions`,
      );
    }
  }

  /**
   * Expire a session (update DB and clear timeout).
   */
  private async expireSession(sessionId: string): Promise<void> {
    const session = await this.sessionModel.findOne({ sessionId }).exec();
    if (session) {
      session.status = 'cancelled';
      await session.save();
      this.eventEmitter.emit('experiment.session.expired', {
        sessionId: session.sessionId,
        userId: String(session.userId),
        createdAt: session.createdAt,
        status: session.status,
        experimentType: session.experimentType,
      });
      this.logger.warn(`Experiment session expired: ${sessionId}`, {
        userId: String(session.userId),
        createdAt: session.createdAt,
      });
    }

    const timeout = this.sessionTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionId);
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return generateSecureId('exp');
  }

  /**
   * Generate unique result ID
   */
  private generateResultId(): string {
    return generateSecureId('res');
  }
}
