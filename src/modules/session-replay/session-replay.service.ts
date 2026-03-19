import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import {
  SessionReplay,
  SessionReplayDocument,
} from '@/schemas/analytics/session-replay.schema';
import { Telemetry, TelemetryDocument } from '@/schemas/core/telemetry.schema';

const MAX_DB_FAILURES = 5;
const CIRCUIT_BREAKER_RESET_MS = 300_000;
const SEARCH_WINDOW_MS = 5 * 60 * 1000;

export interface CreateSessionInput {
  userId: string;
  workspaceId?: string;
  label?: string;
  startedAt: Date;
  metadata?: Record<string, unknown>;
  trackingEnabled?: boolean;
  sessionReplayEnabled?: boolean;
}

export interface AddReplayDataInput {
  sessionId: string;
  codeContext?: { filePath: string; content: string; language?: string };
  aiInteraction?: {
    model: string;
    prompt: string;
    response: string;
    parameters?: Record<string, unknown>;
    tokens?: { input: number; output: number };
    cost?: number;
    latency?: number;
    provider?: string;
    requestMetadata?: Record<string, unknown>;
    responseMetadata?: Record<string, unknown>;
  };
  userAction?: { action: string; details?: unknown };
  captureSystemMetrics?: boolean;
}

@Injectable()
export class SessionReplayService {
  private readonly logger = new Logger(SessionReplayService.name);
  private dbFailureCount = 0;
  private lastDbFailureTime = 0;
  private sessionTimeoutMs = 30 * 60 * 1000;

  constructor(
    @InjectModel(SessionReplay.name)
    private readonly sessionModel: Model<SessionReplayDocument>,
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
  ) {
    const envTimeout = parseInt(process.env.SESSION_REPLAY_TIMEOUT || '30', 10);
    this.sessionTimeoutMs = envTimeout * 60 * 1000;
  }

  isCircuitBreakerOpen(): boolean {
    if (this.dbFailureCount < MAX_DB_FAILURES) return false;
    const elapsed = Date.now() - this.lastDbFailureTime;
    if (elapsed < CIRCUIT_BREAKER_RESET_MS) return true;
    this.dbFailureCount = 0;
    return false;
  }

  private recordDbFailure(): void {
    this.dbFailureCount += 1;
    this.lastDbFailureTime = Date.now();
  }

  async createOrMergeSession(
    input: CreateSessionInput,
  ): Promise<SessionReplayDocument> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      const sessionId = uuidv4();
      const from = new Date(input.startedAt.getTime() - SEARCH_WINDOW_MS);
      const to = new Date(input.startedAt.getTime() + SEARCH_WINDOW_MS);

      const telemetryMatch = await this.telemetryModel
        .findOne({
          user_id: input.userId,
          ...(input.workspaceId && { workspace_id: input.workspaceId }),
          timestamp: { $gte: from, $lte: to },
        })
        .sort({ timestamp: -1 })
        .limit(1)
        .lean();

      const doc: Record<string, unknown> = {
        sessionId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        label: input.label,
        startedAt: input.startedAt,
        status: 'active',
        source: telemetryMatch ? 'unified' : 'manual',
        trackingEnabled: input.trackingEnabled ?? false,
        sessionReplayEnabled: input.sessionReplayEnabled ?? false,
        trackingEnabledAt: input.trackingEnabled ? new Date() : undefined,
        metadata: input.metadata,
        summary: {
          totalSpans: 0,
          totalTokens: { input: 0, output: 0 },
        },
      };

      if (telemetryMatch) {
        (doc as any).telemetryTraceId = (telemetryMatch as any).trace_id;
        await this.sessionModel.create(doc);
        await this.telemetryModel.updateOne(
          { trace_id: (telemetryMatch as any).trace_id },
          {
            $set: {
              'attributes.session_id': sessionId,
              'attributes.session_source': 'unified',
            },
          },
        );
      } else {
        await this.sessionModel.create(doc);
      }

      const session = await this.sessionModel.findOne({ sessionId }).exec();
      if (!session) throw new Error('Failed to create session');
      this.dbFailureCount = 0;
      return session;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error creating or merging session',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async getOrCreateActiveSession(
    userId: string,
    options: { workspaceId?: string; metadata?: Record<string, unknown> },
  ): Promise<string> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      const cutoffTime = new Date(Date.now() - this.sessionTimeoutMs);
      const active = await this.sessionModel
        .findOne({
          userId,
          ...(options.workspaceId && { workspaceId: options.workspaceId }),
          status: 'active',
          updatedAt: { $gte: cutoffTime },
        })
        .sort({ updatedAt: -1 })
        .lean();

      if (active) {
        await this.sessionModel.updateOne(
          { sessionId: active.sessionId },
          { $set: { updatedAt: new Date() } },
        );
        this.dbFailureCount = 0;
        return active.sessionId;
      }

      const session = await this.createOrMergeSession({
        userId,
        workspaceId: options.workspaceId,
        startedAt: new Date(),
        metadata: options.metadata,
        trackingEnabled: true,
        sessionReplayEnabled: true,
      });
      this.dbFailureCount = 0;
      return session.sessionId;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error getting or creating active session',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async addReplayData(input: AddReplayDataInput): Promise<void> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      const update: Record<string, unknown> = {
        $set: { updatedAt: new Date() },
      };
      const push: Record<string, unknown> = {};

      if (input.codeContext) {
        push['replayData.codeContext'] = {
          ...input.codeContext,
          timestamp: new Date(),
        };
      }
      if (input.aiInteraction) {
        push['replayData.aiInteractions'] = {
          ...input.aiInteraction,
          timestamp: new Date(),
        };
      }
      if (input.userAction) {
        push['replayData.userActions'] = {
          ...input.userAction,
          timestamp: new Date(),
        };
      }
      if (input.captureSystemMetrics) {
        const memUsage = process.memoryUsage();
        const loadAvg = os.loadavg();
        push['replayData.systemMetrics'] = {
          timestamp: new Date(),
          cpu: loadAvg[0],
          memory: (memUsage.heapUsed / memUsage.heapTotal) * 100,
          network: { sent: 0, received: 0 },
        };
      }
      if (Object.keys(push).length > 0) {
        (update as any).$push = push;
      }
      await this.sessionModel.updateOne({ sessionId: input.sessionId }, update);
      this.dbFailureCount = 0;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error adding replay data',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async linkWithTelemetry(
    sessionId: string,
    telemetryTraceId: string,
  ): Promise<void> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      await this.sessionModel.updateOne(
        { sessionId },
        { $set: { source: 'unified', telemetryTraceId } },
      );
      await this.telemetryModel.updateOne(
        { trace_id: telemetryTraceId },
        {
          $set: {
            'attributes.session_id': sessionId,
            'attributes.session_source': 'unified',
          },
        },
      );
      this.dbFailureCount = 0;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error linking session with telemetry',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async getSessionReplay(
    sessionId: string,
  ): Promise<SessionReplayDocument | null> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      const session = await this.sessionModel.findOne({ sessionId }).exec();
      this.dbFailureCount = 0;
      return session;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error getting session replay',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async listSessionReplays(filters: {
    userId?: string;
    workspaceId?: string;
    source?: string;
    from?: Date;
    to?: Date;
    status?: string;
    hasErrors?: boolean;
    minCost?: number;
    maxCost?: number;
    minTokens?: number;
    maxTokens?: number;
    minDuration?: number;
    maxDuration?: number;
    aiModel?: string;
    searchQuery?: string;
    appFeature?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<{
    sessions: SessionReplayDocument[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      const query: Record<string, unknown> = {};
      if (filters.userId) query.userId = filters.userId;
      if (filters.workspaceId) query.workspaceId = filters.workspaceId;
      if (filters.source) query.source = filters.source;
      if (filters.status) query.status = filters.status;
      if (filters.hasErrors !== undefined) query.hasErrors = filters.hasErrors;
      if (filters.appFeature) query.appFeature = filters.appFeature;

      if (filters.from || filters.to) {
        query.startedAt = {};
        if (filters.from) (query.startedAt as any).$gte = filters.from;
        if (filters.to) (query.startedAt as any).$lte = filters.to;
      }
      if (filters.minCost !== undefined || filters.maxCost !== undefined) {
        query['summary.totalCost'] = {};
        if (filters.minCost !== undefined)
          (query['summary.totalCost'] as any).$gte = filters.minCost;
        if (filters.maxCost !== undefined)
          (query['summary.totalCost'] as any).$lte = filters.maxCost;
      }
      if (
        filters.minDuration !== undefined ||
        filters.maxDuration !== undefined
      ) {
        query.duration = {};
        if (filters.minDuration !== undefined)
          (query.duration as any).$gte = filters.minDuration;
        if (filters.maxDuration !== undefined)
          (query.duration as any).$lte = filters.maxDuration;
      }
      if (filters.aiModel) {
        query['replayData.aiInteractions.model'] = filters.aiModel;
      }
      if (filters.searchQuery) {
        query.$or = [
          { label: { $regex: filters.searchQuery, $options: 'i' } },
          { sessionId: { $regex: filters.searchQuery, $options: 'i' } },
        ];
      }
      if (filters.minTokens !== undefined || filters.maxTokens !== undefined) {
        (query as any).$expr = (query as any).$expr || { $and: [] };
        const tokenCond: unknown[] = [];
        const totalTokensExpr = {
          $add: [
            { $ifNull: ['$summary.totalTokens.input', 0] },
            { $ifNull: ['$summary.totalTokens.output', 0] },
          ],
        };
        if (filters.minTokens !== undefined)
          tokenCond.push({ $gte: [totalTokensExpr, filters.minTokens] });
        if (filters.maxTokens !== undefined)
          tokenCond.push({ $lte: [totalTokensExpr, filters.maxTokens] });
        (query as any).$expr = { $and: tokenCond };
      }

      const page = filters.page ?? 1;
      const limit = filters.limit ?? 20;
      const skip = (page - 1) * limit;
      const sortField =
        filters.sortBy === 'totalCost'
          ? 'summary.totalCost'
          : filters.sortBy === 'duration'
            ? 'duration'
            : 'startedAt';
      const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
      const sort: Record<string, 1 | -1> = { [sortField]: sortOrder };

      const [sessions, total] = await Promise.all([
        this.sessionModel
          .find(query)
          .sort(sort as any)
          .skip(skip)
          .limit(limit)
          .exec(),
        this.sessionModel.countDocuments(query),
      ]);
      this.dbFailureCount = 0;
      const totalPages = Math.ceil(total / limit);
      return { sessions, total, page, totalPages };
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error listing session replays',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async getSessionStats(userId: string): Promise<{
    totalSessions: number;
    bySource: Record<string, number>;
    byStatus: Record<string, number>;
    byAppFeature: Record<string, number>;
    totalCost: number;
    totalTokens: { input: number; output: number };
    averageDuration: number;
    errorRate: number;
    topModels: Array<{ model: string; count: number }>;
    costBySource: Record<string, number>;
  }> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      const pipeline: PipelineStage[] = [
        { $match: { userId } },
        {
          $facet: {
            totalSessions: [{ $count: 'count' }],
            bySource: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            byAppFeature: [
              { $match: { appFeature: { $exists: true, $ne: null } } },
              { $group: { _id: '$appFeature', count: { $sum: 1 } } },
            ],
            totalCost: [
              {
                $group: {
                  _id: null,
                  total: { $sum: '$summary.totalCost' },
                },
              },
            ],
            totalTokens: [
              {
                $group: {
                  _id: null,
                  input: { $sum: '$summary.totalTokens.input' },
                  output: { $sum: '$summary.totalTokens.output' },
                },
              },
            ],
            averageDuration: [
              { $match: { duration: { $exists: true, $ne: null } } },
              { $group: { _id: null, avg: { $avg: '$duration' } } },
            ],
            errorCount: [{ $match: { hasErrors: true } }, { $count: 'count' }],
            topModels: [
              { $unwind: '$replayData.aiInteractions' },
              {
                $group: {
                  _id: '$replayData.aiInteractions.model',
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            costBySource: [
              {
                $group: {
                  _id: '$source',
                  totalCost: { $sum: '$summary.totalCost' },
                },
              },
            ],
          },
        },
      ];

      const result = await this.sessionModel.aggregate(pipeline);
      const stats = result[0];
      const totalSessions = stats?.totalSessions?.[0]?.count ?? 0;
      const errorCount = stats?.errorCount?.[0]?.count ?? 0;
      this.dbFailureCount = 0;

      return {
        totalSessions,
        bySource: (stats?.bySource ?? []).reduce(
          (
            acc: Record<string, number>,
            item: { _id: string; count: number },
          ) => {
            acc[item._id] = item.count;
            return acc;
          },
          {},
        ),
        byStatus: (stats?.byStatus ?? []).reduce(
          (
            acc: Record<string, number>,
            item: { _id: string; count: number },
          ) => {
            acc[item._id] = item.count;
            return acc;
          },
          {},
        ),
        byAppFeature: (stats?.byAppFeature ?? []).reduce(
          (
            acc: Record<string, number>,
            item: { _id: string; count: number },
          ) => {
            acc[item._id] = item.count;
            return acc;
          },
          {},
        ),
        totalCost: stats?.totalCost?.[0]?.total ?? 0,
        totalTokens: stats?.totalTokens?.[0] ?? { input: 0, output: 0 },
        averageDuration: stats?.averageDuration?.[0]?.avg ?? 0,
        errorRate: totalSessions > 0 ? (errorCount / totalSessions) * 100 : 0,
        topModels: (stats?.topModels ?? []).map(
          (item: { _id: string; count: number }) => ({
            model: item._id,
            count: item.count,
          }),
        ),
        costBySource: (stats?.costBySource ?? []).reduce(
          (
            acc: Record<string, number>,
            item: { _id: string; totalCost: number },
          ) => {
            acc[item._id] = item.totalCost;
            return acc;
          },
          {},
        ),
      };
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error getting session stats',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async exportSession(
    sessionId: string,
    format: 'json' | 'csv',
  ): Promise<unknown> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      const session = await this.sessionModel.findOne({ sessionId }).lean();
      if (!session) {
        throw new Error('Session not found');
      }
      this.dbFailureCount = 0;

      if (format === 'json') {
        return session;
      }
      const flat: unknown[] = [];
      const s = session as any;
      flat.push({
        type: 'session',
        sessionId: s.sessionId,
        userId: s.userId,
        label: s.label,
        source: s.source,
        appFeature: s.appFeature,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        duration: s.duration,
        totalCost: s.summary?.totalCost,
        totalTokensInput: s.summary?.totalTokens?.input,
        totalTokensOutput: s.summary?.totalTokens?.output,
        hasErrors: s.hasErrors,
        errorCount: s.errorCount,
      });
      if (s.replayData?.aiInteractions) {
        s.replayData.aiInteractions.forEach((i: any, idx: number) => {
          flat.push({
            type: 'ai_interaction',
            sessionId: s.sessionId,
            index: idx,
            timestamp: i.timestamp,
            model: i.model,
            prompt: i.prompt?.substring(0, 500),
            response: i.response?.substring(0, 500),
            tokensInput: i.tokens?.input,
            tokensOutput: i.tokens?.output,
            cost: i.cost,
            latency: i.latency,
          });
        });
      }
      return flat;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error exporting session',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async shareSession(
    sessionId: string,
    options: {
      accessLevel?: 'public' | 'team' | 'password';
      expiresIn?: number;
      password?: string;
    },
  ): Promise<{
    shareToken: string;
    shareUrl: string;
    expiresAt?: Date;
  }> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }
    try {
      const session = await this.sessionModel.findOne({ sessionId }).lean();
      if (!session) {
        throw new Error('Session not found');
      }
      const shareToken = `share_${sessionId}_${crypto.randomUUID()}`;
      const expiresAt = options.expiresIn
        ? new Date(Date.now() + options.expiresIn * 60 * 60 * 1000)
        : undefined;
      await this.sessionModel.updateOne(
        { sessionId },
        {
          $set: {
            'metadata.shareInfo': {
              shareToken,
              accessLevel: options.accessLevel ?? 'team',
              createdAt: new Date(),
              expiresAt,
              password: options.password,
            },
          },
        },
      );
      this.dbFailureCount = 0;
      const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
      return {
        shareToken,
        shareUrl: `${baseUrl}/session-replay/shared/${shareToken}`,
        expiresAt,
      };
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error creating share link',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /** Start in-app recording (creates session with source 'in-app') */
  async startRecording(
    userId: string,
    feature: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const sessionId = `inapp_${feature}_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const label =
      (metadata?.label as string) ||
      (feature === 'chat' ? 'Chat Conversation' : feature);
    await this.sessionModel.create({
      sessionId,
      userId,
      label,
      startedAt: new Date(),
      status: 'active',
      source: 'in-app',
      appFeature: feature,
      trackingEnabled: true,
      sessionReplayEnabled: true,
      metadata: {
        ...metadata,
        startedBy: 'in-app-recording',
        feature,
        featureLabel: label,
      },
      summary: {
        totalSpans: 0,
        totalTokens: { input: 0, output: 0 },
        totalCost: 0,
      },
      replayData: {
        aiInteractions: [],
        userActions: [],
        codeContext: [],
        systemMetrics: [],
      },
    });
    return sessionId;
  }

  /** Record AI interaction (in-app snapshot) */
  async recordInteraction(
    sessionId: string,
    interaction: {
      model: string;
      prompt: string;
      response: string;
      parameters?: Record<string, unknown>;
      tokens?: { input: number; output: number };
      cost?: number;
      latency?: number;
      provider?: string;
      requestMetadata?: Record<string, unknown>;
      responseMetadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const now = new Date();
    await this.sessionModel.updateOne(
      { sessionId },
      {
        $push: {
          'replayData.aiInteractions': {
            timestamp: now,
            model: interaction.model,
            prompt: interaction.prompt,
            response: interaction.response,
            parameters: interaction.parameters ?? {},
            tokens: interaction.tokens ?? { input: 0, output: 0 },
            cost: interaction.cost ?? 0,
            latency: interaction.latency,
            provider: interaction.provider ?? 'aws-bedrock',
            requestMetadata: interaction.requestMetadata ?? {},
            responseMetadata: interaction.responseMetadata ?? {},
          },
        },
        $inc: {
          'summary.totalSpans': 1,
          'summary.totalCost': interaction.cost ?? 0,
          'summary.totalTokens.input': interaction.tokens?.input ?? 0,
          'summary.totalTokens.output': interaction.tokens?.output ?? 0,
        },
        $set: { updatedAt: now },
      },
    );
  }

  /** Record user action */
  async recordUserAction(
    sessionId: string,
    action: { action: string; details?: unknown },
  ): Promise<void> {
    const now = new Date();
    await this.sessionModel.updateOne(
      { sessionId },
      {
        $push: {
          'replayData.userActions': {
            timestamp: now,
            action: action.action,
            details: action.details,
          },
        },
        $set: { updatedAt: now },
      },
    );
  }

  /** Record code context */
  async recordCodeContext(
    sessionId: string,
    context: { filePath: string; content: string; language?: string },
  ): Promise<void> {
    const now = new Date();
    await this.sessionModel.updateOne(
      { sessionId },
      {
        $push: {
          'replayData.codeContext': {
            timestamp: now,
            filePath: context.filePath,
            content: context.content,
            language: context.language,
          },
        },
        $set: { updatedAt: now },
      },
    );
  }

  /** Capture system metrics */
  async captureSystemMetrics(sessionId: string): Promise<void> {
    try {
      const now = new Date();
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const cpuUsage =
        cpus.reduce((acc, cpu) => {
          const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
          const idle = cpu.times.idle;
          return acc + ((total - idle) / total) * 100;
        }, 0) / cpus.length;
      await this.sessionModel.updateOne(
        { sessionId },
        {
          $push: {
            'replayData.systemMetrics': {
              timestamp: now,
              cpu: Math.round(cpuUsage * 10) / 10,
              memory: Math.round((usedMem / 1024 / 1024) * 10) / 10,
              network: { sent: 0, received: 0 },
            },
          },
          $set: { updatedAt: now },
        },
      );
    } catch (err) {
      this.logger.warn(
        'System metrics capture failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  onModuleDestroy(): void {
    this.dbFailureCount = 0;
    this.lastDbFailureTime = 0;
  }
}
