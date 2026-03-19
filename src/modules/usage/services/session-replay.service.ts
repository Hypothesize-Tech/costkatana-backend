import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Session,
  SessionDocument,
  SharedSession,
  SharedSessionDocument,
} from '@/schemas/misc/session.schema';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';

interface CreateSessionParams {
  userId: string;
  workspaceId?: string;
  source?: string;
  appFeature?: string;
  metadata?: Record<string, any>;
}

interface AddReplayDataParams {
  sessionId: string;
  aiInteraction?: {
    model: string;
    prompt: string;
    response: string;
    parameters: Record<string, any>;
    tokens: {
      input: number;
      output: number;
    };
    cost: number;
  };
  userAction?: {
    type: string;
    data: Record<string, any>;
    timestamp: Date;
  };
  systemMetrics?: {
    cpuUsage: number;
    memoryUsage: number;
    networkLatency: number;
    timestamp: Date;
  };
  captureSystemMetrics?: boolean;
}

interface SessionReplayFilter {
  userId?: string;
  workspaceId?: string;
  source?: string;
  appFeature?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  hasErrors?: boolean;
  minCost?: number;
  maxCost?: number;
}

interface SessionExportOptions {
  format: 'json' | 'csv';
  includeSystemMetrics?: boolean;
  includeUserActions?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

@Injectable()
export class SessionReplayService {
  private readonly logger = new Logger(SessionReplayService.name);

  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    @InjectModel(SharedSession.name)
    private sharedSessionModel: Model<SharedSessionDocument>,
    private configService: ConfigService,
  ) {}

  /**
   * Create or merge with existing active session
   */
  async createOrMergeSession(params: CreateSessionParams): Promise<string> {
    try {
      const {
        userId,
        workspaceId,
        source = 'api',
        appFeature,
        metadata = {},
      } = params;

      // Check for existing active session
      const existingSession = await this.sessionModel
        .findOne({
          userId,
          workspaceId,
          source,
          status: 'active',
          expiresAt: { $gt: new Date() },
        })
        .sort({ lastActivityAt: -1 });

      if (existingSession) {
        // Update existing session with new metadata
        existingSession.appFeature =
          (appFeature as any) || existingSession.appFeature;
        existingSession.metadata = { ...existingSession.metadata, ...metadata };
        existingSession.lastActivityAt = new Date();

        await existingSession.save();
        this.logger.log(
          `Merged with existing session ${existingSession.sessionId} for user ${userId}`,
        );

        return existingSession.sessionId;
      }

      // Create new session
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      const newSession = new this.sessionModel({
        sessionId,
        userId,
        workspaceId,
        source,
        appFeature,
        status: 'active',
        replayData: {
          aiInteractions: [],
          userActions: [],
          systemMetrics: [],
          metadata,
        },
        trackingHistory: [],
        metadata,
        expiresAt,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        timeoutMs: 30 * 60 * 1000,
      });

      await newSession.save();
      this.logger.log(`Created new session ${sessionId} for user ${userId}`);

      return sessionId;
    } catch (error) {
      this.logger.error(
        `Failed to create or merge session for user ${params.userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get or create active session
   */
  async getOrCreateActiveSession(
    userId: string,
    context: {
      workspaceId?: string;
      metadata?: Record<string, any>;
    } = {},
  ): Promise<string> {
    try {
      const { workspaceId, metadata } = context;

      // Try to find existing active session
      const existingSession = await this.sessionModel
        .findOne({
          userId,
          workspaceId,
          status: 'active',
          expiresAt: { $gt: new Date() },
        })
        .sort({ lastActivityAt: -1 });

      if (existingSession) {
        existingSession.lastActivityAt = new Date();
        if (metadata) {
          existingSession.metadata = {
            ...existingSession.metadata,
            ...metadata,
          };
        }
        await existingSession.save();
        return existingSession.sessionId;
      }

      // Create new session
      return await this.createOrMergeSession({
        userId,
        workspaceId,
        metadata,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get or create active session for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Add replay data to session
   */
  async addReplayData(params: AddReplayDataParams): Promise<void> {
    try {
      const { sessionId } = params;

      const session = await this.sessionModel.findOne({ sessionId });
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.status !== 'active') {
        this.logger.warn(
          `Attempted to add replay data to inactive session ${sessionId}`,
        );
        return;
      }

      // Add AI interaction
      if (params.aiInteraction) {
        if (!session.replayData.aiInteractions) {
          session.replayData.aiInteractions = [];
        }

        const interaction = {
          ...params.aiInteraction,
          timestamp: new Date(),
        };

        session.replayData.aiInteractions.push(interaction);

        // Update session statistics
        session.totalInteractions += 1;
        session.totalCost += interaction.cost;
        session.totalTokens +=
          interaction.tokens.input + interaction.tokens.output;
      }

      // Add user action
      if (params.userAction) {
        if (!session.replayData.userActions) {
          session.replayData.userActions = [];
        }

        session.replayData.userActions.push(params.userAction);
      }

      // Add system metrics
      if (params.captureSystemMetrics && params.systemMetrics) {
        if (!session.replayData.systemMetrics) {
          session.replayData.systemMetrics = [];
        }

        session.replayData.systemMetrics.push(params.systemMetrics);
      }

      session.lastActivityAt = new Date();
      await session.save();

      this.logger.debug(`Added replay data to session ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to add replay data to session ${params.sessionId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Link session with telemetry traces
   */
  async linkWithTelemetry(
    sessionId: string,
    telemetryData: {
      traceId: string;
      traceName?: string;
      traceStep?: string;
      traceSequence?: number;
    },
  ): Promise<void> {
    try {
      const session = await this.sessionModel.findOne({ sessionId });
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      session.traceId = telemetryData.traceId;
      session.traceName = telemetryData.traceName;
      session.traceStep = telemetryData.traceStep
        ? parseInt(telemetryData.traceStep.toString())
        : undefined;
      session.traceSequence = telemetryData.traceSequence
        ? telemetryData.traceSequence.toString()
        : undefined;

      await session.save();
      this.logger.log(
        `Linked session ${sessionId} with telemetry trace ${telemetryData.traceId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to link session ${sessionId} with telemetry`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get session replay data
   */
  async getSessionReplay(sessionId: string, userId: string): Promise<any> {
    try {
      const session = await this.sessionModel.findOne({
        sessionId,
        userId,
      });

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      return {
        sessionId: session.sessionId,
        status: session.status,
        source: session.source,
        appFeature: session.appFeature,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        duration: session.durationMs,
        replayData: session.replayData,
        summary: session.summary,
        metadata: session.metadata,
      };
    } catch (error) {
      this.logger.error(`Failed to get session replay for ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * List session replays with filtering
   */
  async listSessionReplays(
    userId: string,
    filter: SessionReplayFilter = {},
    options: {
      page?: number;
      limit?: number;
      sort?: Record<string, 1 | -1>;
    } = {},
  ): Promise<{
    sessions: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const { page = 1, limit = 20, sort = { startedAt: -1 } } = options;

      const query: any = { userId };

      // Apply filters
      if (filter.workspaceId) query.workspaceId = filter.workspaceId;
      if (filter.source) query.source = filter.source;
      if (filter.appFeature) query.appFeature = filter.appFeature;
      if (filter.status) query.status = filter.status;

      if (filter.startDate || filter.endDate) {
        query.startedAt = {};
        if (filter.startDate) query.startedAt.$gte = filter.startDate;
        if (filter.endDate) query.startedAt.$lte = filter.endDate;
      }

      if (filter.hasErrors !== undefined) {
        query.errorCount = filter.hasErrors ? { $gt: 0 } : 0;
      }

      if (filter.minCost !== undefined || filter.maxCost !== undefined) {
        query.totalCost = {};
        if (filter.minCost !== undefined) query.totalCost.$gte = filter.minCost;
        if (filter.maxCost !== undefined) query.totalCost.$lte = filter.maxCost;
      }

      const total = await this.sessionModel.countDocuments(query);
      const sessions = await this.sessionModel
        .find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const totalPages = Math.ceil(total / limit);

      // Add computed fields
      const enhancedSessions = sessions.map((session) => ({
        ...session,
        duration: session.endedAt
          ? session.endedAt.getTime() - session.startedAt.getTime()
          : Date.now() - session.startedAt.getTime(),
        summary: this.calculateSessionSummary(session),
      }));

      return {
        sessions: enhancedSessions,
        total,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list session replays for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(
    userId: string,
    timeRange?: {
      start: Date;
      end: Date;
    },
  ): Promise<{
    totalSessions: number;
    activeSessions: number;
    totalDuration: number;
    totalCost: number;
    totalTokens: number;
    averageSessionDuration: number;
    sessionsBySource: Record<string, number>;
    sessionsByFeature: Record<string, number>;
    errorRate: number;
  }> {
    try {
      const matchQuery: any = { userId };
      if (timeRange) {
        matchQuery.startedAt = {
          $gte: timeRange.start,
          $lte: timeRange.end,
        };
      }

      const stats = await this.sessionModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalSessions: { $sum: 1 },
            activeSessions: {
              $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
            },
            totalDuration: {
              $sum: {
                $subtract: [
                  { $ifNull: ['$endedAt', new Date()] },
                  '$startedAt',
                ],
              },
            },
            totalCost: { $sum: '$totalCost' },
            totalTokens: { $sum: '$totalTokens' },
            averageSessionDuration: {
              $avg: { $subtract: [new Date(), '$startedAt'] },
            },
            sessionsBySource: {
              $push: '$source',
            },
            sessionsByFeature: {
              $push: '$appFeature',
            },
            totalErrors: { $sum: '$errorCount' },
          },
        },
      ]);

      if (stats.length === 0) {
        return {
          totalSessions: 0,
          activeSessions: 0,
          totalDuration: 0,
          totalCost: 0,
          totalTokens: 0,
          averageSessionDuration: 0,
          sessionsBySource: {},
          sessionsByFeature: {},
          errorRate: 0,
        };
      }

      const result = stats[0];

      // Count occurrences
      const sessionsBySource = result.sessionsBySource.reduce(
        (acc: Record<string, number>, source: string) => {
          acc[source] = (acc[source] || 0) + 1;
          return acc;
        },
        {},
      );

      const sessionsByFeature = result.sessionsByFeature
        .filter((feature: string | undefined) => feature)
        .reduce((acc: Record<string, number>, feature: string) => {
          acc[feature] = (acc[feature] || 0) + 1;
          return acc;
        }, {});

      return {
        totalSessions: result.totalSessions,
        activeSessions: result.activeSessions,
        totalDuration: result.totalDuration,
        totalCost: result.totalCost,
        totalTokens: result.totalTokens,
        averageSessionDuration: result.averageSessionDuration,
        sessionsBySource,
        sessionsByFeature,
        errorRate:
          result.totalSessions > 0
            ? (result.totalErrors / result.totalSessions) * 100
            : 0,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get session stats for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Export session data
   */
  async exportSession(
    sessionId: string,
    userId: string,
    options: SessionExportOptions & {
      shareId?: string; // For shared session access
      password?: string; // For password-protected shared sessions
    },
  ): Promise<any> {
    try {
      let session: any;
      let accessControl: any = { allowDownload: true, allowRawData: true };

      if (options.shareId) {
        // Access via shared link
        const sharedResult = await this.getSharedSession(
          options.shareId,
          options.password,
        );

        if (!sharedResult.accessGranted) {
          throw new Error('Access denied to shared session');
        }

        if (!sharedResult.accessControl.allowDownload) {
          throw new Error('Download not permitted for this shared session');
        }

        session = sharedResult.session;
        accessControl = sharedResult.accessControl;
      } else {
        // Direct access by owner
        session = await this.sessionModel.findOne({
          sessionId,
          userId,
        });

        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
        }
      }

      const {
        format,
        includeSystemMetrics = true,
        includeUserActions = true,
        dateRange,
      } = options;

      const replayData = { ...session.replayData };

      // Filter by date range if specified
      if (dateRange) {
        replayData.aiInteractions =
          replayData.aiInteractions?.filter(
            (interaction: any) =>
              interaction.timestamp >= dateRange.start &&
              interaction.timestamp <= dateRange.end,
          ) || [];

        if (includeUserActions && accessControl.allowRawData) {
          replayData.userActions =
            replayData.userActions?.filter(
              (action: any) =>
                action.timestamp >= dateRange.start &&
                action.timestamp <= dateRange.end,
            ) || [];
        }

        if (includeSystemMetrics && accessControl.allowRawData) {
          replayData.systemMetrics =
            replayData.systemMetrics?.filter(
              (metrics: any) =>
                metrics.timestamp >= dateRange.start &&
                metrics.timestamp <= dateRange.end,
            ) || [];
        }
      }

      // Apply access control restrictions
      if (!includeSystemMetrics || !accessControl.allowRawData) {
        delete replayData.systemMetrics;
      }

      if (!includeUserActions || !accessControl.allowRawData) {
        delete replayData.userActions;
      }

      // Remove sensitive metadata if not owner
      if (options.shareId) {
        // Remove internal metadata for shared sessions
        if (replayData.metadata) {
          const safeMetadata = { ...replayData.metadata };
          delete safeMetadata.internal;
          delete safeMetadata.sensitive;
          replayData.metadata = safeMetadata;
        }
      }

      if (format === 'csv') {
        return this.convertToCSV(replayData);
      }

      return {
        sessionId: session.sessionId,
        metadata: {
          userId: options.shareId ? undefined : session.userId, // Hide userId for shared sessions
          workspaceId: session.workspaceId,
          source: session.source,
          appFeature: session.appFeature,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          duration: session.durationMs,
          totalInteractions: session.totalInteractions,
          totalCost: session.totalCost,
          totalTokens: session.totalTokens,
          isShared: !!options.shareId,
          accessControl: options.shareId ? accessControl : undefined,
        },
        replayData,
        summary: session.summary || session.getSummary(),
      };
    } catch (error) {
      this.logger.error(`Failed to export session ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Generate shareable link for session replay
   */
  async shareSession(
    sessionId: string,
    userId: string,
    options: {
      expiresIn?: number; // hours
      password?: string;
      accessControl?: {
        allowDownload?: boolean;
        allowRawData?: boolean;
        restrictToDomain?: string[];
      };
    } = {},
  ): Promise<{
    shareId: string;
    shareUrl: string;
    expiresAt: Date;
    accessToken?: string;
  }> {
    try {
      const session = await this.sessionModel.findOne({
        sessionId,
        userId,
      });

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Check if session is already shared and active
      const existingShare = await this.sharedSessionModel.findOne({
        sessionId,
        userId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      });

      if (existingShare) {
        // Return existing share if it's still valid
        const shareUrl = `${this.configService.getOrThrow<string>('FRONTEND_URL')}/shared/session/${existingShare.shareId}`;
        return {
          shareId: existingShare.shareId,
          shareUrl,
          expiresAt: existingShare.expiresAt,
          accessToken: existingShare.password ? 'protected' : undefined,
        };
      }

      // Generate new share
      const shareId = uuidv4();
      const expiresAt = new Date(
        Date.now() + (options.expiresIn || 24) * 60 * 60 * 1000,
      );

      // Hash password if provided
      let hashedPassword: string | undefined;
      if (options.password) {
        // Hash the password using bcrypt for security
        const saltRounds = 12;
        hashedPassword = await bcrypt.hash(options.password, saltRounds);
      }

      // Create shared session record
      const sharedSession = new this.sharedSessionModel({
        shareId,
        sessionId,
        userId,
        workspaceId: session.workspaceId,
        expiresAt,
        password: hashedPassword,
        accessControl: {
          allowDownload: options.accessControl?.allowDownload ?? true,
          allowRawData: options.accessControl?.allowRawData ?? false,
          restrictToDomain: options.accessControl?.restrictToDomain,
        },
        accessCount: 0,
        isActive: true,
        metadata: {
          originalSessionId: session._id,
          sharedAt: new Date(),
          sharedBy: userId,
        },
      });

      await sharedSession.save();

      const shareUrl = `${this.configService.getOrThrow<string>('FRONTEND_URL')}/shared/session/${shareId}`;

      this.logger.log(
        `Created shareable link for session ${sessionId} with shareId ${shareId}`,
      );

      return {
        shareId,
        shareUrl,
        expiresAt,
        accessToken: hashedPassword ? 'protected' : undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to share session ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Auto-end inactive sessions
   */
  async autoEndInactiveSessions(
    inactiveThresholdMs: number = 30 * 60 * 1000,
  ): Promise<number> {
    try {
      const threshold = new Date(Date.now() - inactiveThresholdMs);

      const result = await this.sessionModel.updateMany(
        {
          status: 'active',
          lastActivityAt: { $lt: threshold },
          expiresAt: { $gt: new Date() },
        },
        {
          status: 'completed',
          endedAt: new Date(),
        },
      );

      this.logger.log(`Auto-ended ${result.modifiedCount} inactive sessions`);
      return result.modifiedCount;
    } catch (error) {
      this.logger.error('Failed to auto-end inactive sessions', error);
      throw error;
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await this.sessionModel.updateMany(
        {
          status: 'active',
          expiresAt: { $lt: new Date() },
        },
        {
          status: 'expired',
          endedAt: new Date(),
        },
      );

      this.logger.log(`Cleaned up ${result.modifiedCount} expired sessions`);
      return result.modifiedCount;
    } catch (error) {
      this.logger.error('Failed to cleanup expired sessions', error);
      throw error;
    }
  }

  /**
   * Calculate session summary
   */
  private calculateSessionSummary(session: any): any {
    const interactions = session.replayData?.aiInteractions || [];
    const userActions = session.replayData?.userActions || [];

    const modelUsage = interactions.reduce(
      (acc: Record<string, number>, interaction: any) => {
        acc[interaction.model] = (acc[interaction.model] || 0) + 1;
        return acc;
      },
      {},
    );

    const mostUsedModel =
      Object.entries(modelUsage).sort(
        ([, a], [, b]) => (b as number) - (a as number),
      )[0]?.[0] || '';

    const averageResponseTime =
      interactions.length > 0
        ? interactions.reduce(
            (sum: number, i: any) => sum + (i.parameters?.responseTime || 0),
            0,
          ) / interactions.length
        : 0;

    const errorCount = interactions.filter(
      (i: any) =>
        i.parameters?.errorOccurred ||
        i.response?.includes('error') ||
        i.response?.includes('Error'),
    ).length;

    const successRate =
      interactions.length > 0
        ? ((interactions.length - errorCount) / interactions.length) * 100
        : 0;

    return {
      totalInteractions: interactions.length,
      totalUserActions: userActions.length,
      totalCost: session.totalCost,
      totalTokens: session.totalTokens,
      averageResponseTime,
      mostUsedModel,
      errorCount,
      successRate,
      duration: session.endedAt
        ? session.endedAt.getTime() - session.startedAt.getTime()
        : Date.now() - session.startedAt.getTime(),
    };
  }

  /**
   * Get shared session by shareId
   */
  async getSharedSession(
    shareId: string,
    password?: string,
  ): Promise<{
    session: any;
    accessGranted: boolean;
    accessControl: any;
  }> {
    try {
      const sharedSession = await this.sharedSessionModel.findOne({
        shareId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      });

      if (!sharedSession) {
        throw new Error('Shared session not found or expired');
      }

      // Check password if required
      if (sharedSession.password && password) {
        const isPasswordValid = await bcrypt.compare(
          password,
          sharedSession.password,
        );
        if (!isPasswordValid) {
          return {
            session: null,
            accessGranted: false,
            accessControl: sharedSession.accessControl,
          };
        }
      } else if (sharedSession.password && !password) {
        // Password required but not provided
        return {
          session: null,
          accessGranted: false,
          accessControl: sharedSession.accessControl,
        };
      }

      // Get the actual session data
      const session = await this.sessionModel.findOne({
        sessionId: sharedSession.sessionId,
      });

      if (!session) {
        throw new Error('Original session not found');
      }

      // Update access statistics
      sharedSession.accessCount += 1;
      sharedSession.lastAccessedAt = new Date();
      await sharedSession.save();

      this.logger.log(
        `Accessed shared session ${shareId} (${sharedSession.accessCount} total accesses)`,
      );

      return {
        session: {
          sessionId: session.sessionId,
          status: session.status,
          source: session.source,
          appFeature: session.appFeature,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          duration: session.durationMs,
          replayData: session.replayData,
          summary: session.summary,
          metadata: session.metadata,
          // Include sharing info
          sharedInfo: {
            sharedAt: sharedSession.createdAt,
            expiresAt: sharedSession.expiresAt,
            accessCount: sharedSession.accessCount,
          },
        },
        accessGranted: true,
        accessControl: sharedSession.accessControl,
      };
    } catch (error) {
      this.logger.error(`Failed to get shared session ${shareId}`, error);
      throw error;
    }
  }

  /**
   * List shared sessions for a user
   */
  async listSharedSessions(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      includeExpired?: boolean;
    } = {},
  ): Promise<{
    sharedSessions: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const { page = 1, limit = 20, includeExpired = false } = options;

      const query: any = { userId };
      if (!includeExpired) {
        query.expiresAt = { $gt: new Date() };
        query.isActive = true;
      }

      const total = await this.sharedSessionModel.countDocuments(query);
      const sharedSessions = await this.sharedSessionModel
        .find(query)
        .populate(
          'sessionId',
          'sessionId source appFeature startedAt endedAt totalInteractions totalCost',
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const enhancedSessions = await Promise.all(
        sharedSessions.map(async (shared) => {
          const session = await this.sessionModel
            .findOne({ sessionId: shared.sessionId })
            .lean();
          return {
            shareId: shared.shareId,
            sessionId: shared.sessionId,
            expiresAt: shared.expiresAt,
            accessCount: shared.accessCount,
            lastAccessedAt: shared.lastAccessedAt,
            isActive: shared.isActive,
            hasPassword: !!shared.password,
            accessControl: shared.accessControl,
            sessionInfo: session
              ? {
                  source: session.source,
                  appFeature: session.appFeature,
                  startedAt: session.startedAt,
                  endedAt: session.endedAt,
                  totalInteractions: session.totalInteractions,
                  totalCost: session.totalCost,
                }
              : null,
          };
        }),
      );

      return {
        sharedSessions: enhancedSessions,
        total,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list shared sessions for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Revoke shared session access
   */
  async revokeSharedSession(shareId: string, userId: string): Promise<void> {
    try {
      const result = await this.sharedSessionModel.updateOne(
        { shareId, userId },
        {
          isActive: false,
          expiresAt: new Date(), // Expire immediately
        },
      );

      if (result.modifiedCount === 0) {
        throw new Error('Shared session not found or already revoked');
      }

      this.logger.log(`Revoked shared session ${shareId} for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to revoke shared session ${shareId}`, error);
      throw error;
    }
  }

  /**
   * Update shared session access control
   */
  async updateSharedSessionAccess(
    shareId: string,
    userId: string,
    accessControl: {
      allowDownload?: boolean;
      allowRawData?: boolean;
      restrictToDomain?: string[];
    },
  ): Promise<void> {
    try {
      const result = await this.sharedSessionModel.updateOne(
        { shareId, userId },
        { $set: { accessControl: accessControl } },
      );

      if (result.modifiedCount === 0) {
        throw new Error('Shared session not found');
      }

      this.logger.log(`Updated access control for shared session ${shareId}`);
    } catch (error) {
      this.logger.error(
        `Failed to update shared session access for ${shareId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Clean up expired shared sessions
   */
  async cleanupExpiredSharedSessions(): Promise<number> {
    try {
      const result = await this.sharedSessionModel.updateMany(
        {
          isActive: true,
          expiresAt: { $lt: new Date() },
        },
        { isActive: false },
      );

      this.logger.log(
        `Cleaned up ${result.modifiedCount} expired shared sessions`,
      );
      return result.modifiedCount;
    } catch (error) {
      this.logger.error('Failed to cleanup expired shared sessions', error);
      throw error;
    }
  }

  /**
   * Convert session data to CSV format
   */
  private convertToCSV(replayData: any): string {
    const lines: string[] = [];

    // CSV headers
    lines.push(
      'timestamp,type,model,prompt,response,tokens_input,tokens_output,cost,user_action_type,user_action_data,cpu_usage,memory_usage,network_latency',
    );

    // Add AI interactions
    replayData.aiInteractions?.forEach((interaction: any) => {
      lines.push(
        [
          interaction.timestamp.toISOString(),
          'ai_interaction',
          interaction.model,
          `"${interaction.prompt.replace(/"/g, '""')}"`,
          `"${interaction.response.replace(/"/g, '""')}"`,
          interaction.tokens.input,
          interaction.tokens.output,
          interaction.cost,
          '',
          '',
          '',
          '',
          '',
        ].join(','),
      );
    });

    // Add user actions
    replayData.userActions?.forEach((action: any) => {
      lines.push(
        [
          action.timestamp.toISOString(),
          'user_action',
          '',
          '',
          '',
          '',
          '',
          '',
          action.type,
          `"${JSON.stringify(action.data).replace(/"/g, '""')}"`,
          '',
          '',
          '',
        ].join(','),
      );
    });

    // Add system metrics
    replayData.systemMetrics?.forEach((metrics: any) => {
      lines.push(
        [
          metrics.timestamp.toISOString(),
          'system_metrics',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          metrics.cpuUsage,
          metrics.memoryUsage,
          metrics.networkLatency,
        ].join(','),
      );
    });

    return lines.join('\n');
  }
}
