import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  TraceSession,
  TraceSessionDocument,
} from '@/schemas/trace/trace-session.schema';
import {
  TraceSpan,
  TraceSpanDocument,
} from '@/schemas/trace/trace-span.schema';
import {
  TraceMessage,
  TraceMessageDocument,
} from '@/schemas/trace/trace-message.schema';

const MAX_DB_FAILURES = 5;
const CIRCUIT_BREAKER_RESET_MS = 300_000; // 5 minutes
const SENSITIVE_KEYS = [
  'authorization',
  'api-key',
  'apikey',
  'password',
  'email',
  'phone',
  'ssn',
  'credit_card',
];

export interface SessionGraph {
  nodes: Array<{
    id: string;
    label: string;
    start: Date;
    end?: Date;
    status: 'ok' | 'error';
    depth: number;
    aiModel?: string;
    tokens?: { input: number; output: number };
    costUSD?: number;
    type: string;
    duration?: number;
  }>;
  edges: Array<{ from: string; to: string }>;
}

export interface SessionSummary {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  errorSessions: number;
  totalCost: number;
  totalTokens: { input: number; output: number };
  averageDuration: number;
}

@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name);
  private static dbFailureCount = 0;
  private static lastDbFailureTime = 0;
  private sensitiveKeyRegex: RegExp;

  constructor(
    @InjectModel(TraceSession.name)
    private readonly traceSessionModel: Model<TraceSessionDocument>,
    @InjectModel(TraceSpan.name)
    private readonly traceSpanModel: Model<TraceSpanDocument>,
    @InjectModel(TraceMessage.name)
    private readonly traceMessageModel: Model<TraceMessageDocument>,
  ) {
    const customKeys = process.env.TRACE_REDACT_KEYS
      ? process.env.TRACE_REDACT_KEYS.split(',').map((k) => k.trim())
      : [];
    this.sensitiveKeyRegex = new RegExp(
      [...SENSITIVE_KEYS, ...customKeys].join('|'),
      'i',
    );
  }

  private redactSensitive(obj: unknown): unknown {
    if (obj == null || typeof obj !== 'object') return obj;
    const redacted = Array.isArray(obj)
      ? [...obj]
      : { ...(obj as Record<string, unknown>) };
    for (const key of Object.keys(redacted as Record<string, unknown>)) {
      if (this.sensitiveKeyRegex.test(key)) {
        (redacted as Record<string, unknown>)[key] = '[REDACTED]';
      } else {
        const val = (redacted as Record<string, unknown>)[key];
        if (typeof val === 'object' && val !== null) {
          (redacted as Record<string, unknown>)[key] =
            this.redactSensitive(val);
        }
      }
    }
    return redacted;
  }

  private static isCircuitBreakerOpen(): boolean {
    if (TraceService.dbFailureCount >= MAX_DB_FAILURES) {
      const elapsed = Date.now() - TraceService.lastDbFailureTime;
      if (elapsed < CIRCUIT_BREAKER_RESET_MS) return true;
      TraceService.dbFailureCount = 0;
    }
    return false;
  }

  private static recordDbFailure(): void {
    TraceService.dbFailureCount++;
    TraceService.lastDbFailureTime = Date.now();
  }

  async startSpan(
    input: {
      sessionId?: string;
      parentId?: string;
      name: string;
      type?: 'http' | 'llm' | 'tool' | 'database' | 'custom';
      metadata?: Record<string, unknown>;
    },
    userId?: string,
  ): Promise<TraceSpanDocument> {
    const traceId = uuidv4();
    const sessionId = input.sessionId ?? uuidv4();

    const [session, parentTrace] = await Promise.all([
      this.traceSessionModel.findOne({ sessionId }).exec(),
      input.parentId
        ? this.traceSpanModel
            .findOne({ traceId: input.parentId }, { depth: 1 })
            .lean()
            .exec()
        : null,
    ]);

    const depth = parentTrace
      ? (parentTrace as { depth: number }).depth + 1
      : 0;

    const createdSession = !session && userId;
    if (createdSession && userId) {
      await this.traceSessionModel.create({
        sessionId,
        userId,
        startedAt: new Date(),
        status: 'active',
        source: 'telemetry',
        summary: { totalSpans: 0, totalTokens: { input: 0, output: 0 } },
      });
    }

    const trace = await this.traceSpanModel.create({
      traceId,
      sessionId,
      parentId: input.parentId,
      name: input.name,
      type: input.type ?? 'custom',
      startedAt: new Date(),
      status: 'ok',
      depth,
      metadata: input.metadata
        ? (this.redactSensitive(input.metadata) as Record<string, unknown>)
        : undefined,
    });

    if (session || createdSession) {
      await this.traceSessionModel
        .updateOne({ sessionId }, { $inc: { 'summary.totalSpans': 1 } })
        .exec();
    }

    return trace as TraceSpanDocument;
  }

  async endSpan(
    traceId: string,
    input: {
      status?: 'ok' | 'error';
      error?: { message: string; stack?: string };
      aiModel?: string;
      tokens?: { input: number; output: number };
      costUSD?: number;
      tool?: string;
      resourceIds?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<TraceSpanDocument | null> {
    const endedAt = new Date();
    const updateData: Record<string, unknown> = {
      endedAt,
      status: input.status ?? 'ok',
    };
    if (input.metadata) {
      updateData.metadata = this.redactSensitive(input.metadata);
    }
    if (input.error) {
      updateData.error = input.error;
      updateData.status = 'error';
    }
    if (input.aiModel != null) updateData.aiModel = input.aiModel;
    if (input.tokens) updateData.tokens = input.tokens;
    if (input.costUSD !== undefined) updateData.costUSD = input.costUSD;
    if (input.tool) updateData.tool = input.tool;
    if (input.resourceIds) updateData.resourceIds = input.resourceIds;

    const trace = await this.traceSpanModel
      .findOneAndUpdate({ traceId }, updateData, { new: true })
      .exec();

    if (trace) {
      const duration = endedAt.getTime() - new Date(trace.startedAt).getTime();
      await this.traceSpanModel.updateOne({ traceId }, { duration }).exec();

      const sessionUpdate: Record<string, unknown> = {};
      if (input.tokens) {
        sessionUpdate['$inc'] = {
          'summary.totalTokens.input': input.tokens.input ?? 0,
          'summary.totalTokens.output': input.tokens.output ?? 0,
        };
      }
      if (input.costUSD !== undefined) {
        if (!(sessionUpdate['$inc'] as object)) sessionUpdate['$inc'] = {};
        (sessionUpdate['$inc'] as Record<string, number>)['summary.totalCost'] =
          input.costUSD;
      }
      if (input.status === 'error' && !trace.parentId) {
        sessionUpdate['status'] = 'error';
        sessionUpdate['error'] = updateData.error;
      }
      if (Object.keys(sessionUpdate).length > 0) {
        await this.traceSessionModel
          .updateOne({ sessionId: trace.sessionId }, sessionUpdate)
          .exec();
      }
    }

    return trace;
  }

  async getSessionGraph(
    sessionId: string,
    userId?: string,
  ): Promise<SessionGraph> {
    if (userId) {
      const session = await this.traceSessionModel
        .findOne({ sessionId, userId })
        .lean()
        .exec();
      if (!session) throw new Error('Session not found');
    }
    const traces = await this.traceSpanModel
      .find({ sessionId })
      .sort({ startedAt: 1 })
      .lean()
      .exec();

    const nodes = traces.map((t) => ({
      id: t.traceId,
      label: t.name,
      start: t.startedAt,
      end: t.endedAt,
      status: t.status,
      depth: t.depth,
      aiModel: t.aiModel,
      tokens: t.tokens,
      costUSD: t.costUSD,
      type: t.type,
      duration: t.duration,
    }));

    const edges = traces
      .filter((t) => t.parentId)
      .map((t) => ({ from: t.parentId!, to: t.traceId }));

    return { nodes, edges };
  }

  async getSessionDetails(
    sessionId: string,
    userId?: string,
  ): Promise<{
    session: TraceSessionDocument | null;
    messages: TraceMessageDocument[];
  }> {
    const sessionQuery: Record<string, string> = { sessionId };
    if (userId) sessionQuery.userId = userId;
    const [session, messages] = await Promise.all([
      this.traceSessionModel.findOne(sessionQuery).exec(),
      this.traceMessageModel.find({ sessionId }).sort({ timestamp: 1 }).exec(),
    ]);
    return {
      session,
      messages: messages as TraceMessageDocument[],
    };
  }

  async endSession(
    sessionId: string,
    userId?: string,
  ): Promise<TraceSessionDocument | null> {
    const sessionQuery: Record<string, string> = { sessionId };
    if (userId) sessionQuery.userId = userId;
    const session = await this.traceSessionModel.findOne(sessionQuery).exec();
    if (!session) return null;

    const endedAt = new Date();
    const totalDuration =
      endedAt.getTime() - new Date(session.startedAt).getTime();

    const updated = await this.traceSessionModel
      .findOneAndUpdate(
        { sessionId },
        {
          endedAt,
          status: 'completed',
          'summary.totalDuration': totalDuration,
        },
        { new: true },
      )
      .exec();

    return updated;
  }

  async listSessions(filters: {
    userId: string;
    label?: string;
    from?: Date;
    to?: Date;
    status?: string;
    source?: string;
    minCost?: number;
    maxCost?: number;
    minSpans?: number;
    maxSpans?: number;
    page?: number;
    limit?: number;
  }): Promise<{
    sessions: TraceSessionDocument[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    if (TraceService.isCircuitBreakerOpen()) {
      throw new Error('Service temporarily unavailable');
    }

    const query: Record<string, unknown> = { userId: filters.userId };
    if (filters.label) query.label = new RegExp(String(filters.label), 'i');
    if (filters.status) query.status = filters.status;
    if (filters.source) query.source = filters.source;
    if (filters.from || filters.to) {
      query.startedAt = {};
      if (filters.from)
        (query.startedAt as Record<string, Date>).$gte = filters.from;
      if (filters.to)
        (query.startedAt as Record<string, Date>).$lte = filters.to;
    }
    if (filters.minCost !== undefined || filters.maxCost !== undefined) {
      const costQ: Record<string, unknown> = {
        $exists: true,
        $ne: null,
        $type: 'number',
      };
      if (filters.minCost != null) costQ.$gte = filters.minCost;
      if (filters.maxCost != null) costQ.$lte = filters.maxCost;
      query['summary.totalCost'] = costQ;
    }
    if (filters.minSpans !== undefined || filters.maxSpans !== undefined) {
      const spansQ: Record<string, unknown> = {
        $exists: true,
        $ne: null,
        $type: 'number',
      };
      if (filters.minSpans != null) spansQ.$gte = filters.minSpans;
      if (filters.maxSpans != null) spansQ.$lte = filters.maxSpans;
      query['summary.totalSpans'] = spansQ;
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    try {
      const [sessions, total] = await Promise.all([
        this.traceSessionModel
          .find(query)
          .sort({ startedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        this.traceSessionModel.countDocuments(query).exec(),
      ]);
      TraceService.dbFailureCount = 0;
      const totalPages = Math.ceil(total / limit);
      return {
        sessions: sessions as unknown as TraceSessionDocument[],
        total,
        page,
        totalPages,
      };
    } catch (err) {
      TraceService.recordDbFailure();
      this.logger.error('listSessions failed', err);
      throw err;
    }
  }

  async getSessionsSummary(userId: string): Promise<SessionSummary> {
    if (TraceService.isCircuitBreakerOpen()) {
      throw new Error('Service temporarily unavailable');
    }

    try {
      const result = await this.traceSessionModel
        .aggregate([
          { $match: { userId } },
          {
            $group: {
              _id: null,
              totalSessions: { $sum: 1 },
              activeSessions: {
                $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
              },
              completedSessions: {
                $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
              },
              errorSessions: {
                $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] },
              },
              totalCost: {
                $sum: { $ifNull: ['$summary.totalCost', 0] },
              },
              totalInputTokens: {
                $sum: { $ifNull: ['$summary.totalTokens.input', 0] },
              },
              totalOutputTokens: {
                $sum: { $ifNull: ['$summary.totalTokens.output', 0] },
              },
              averageDuration: {
                $avg: { $ifNull: ['$summary.totalDuration', 0] },
              },
            },
          },
        ])
        .exec();

      TraceService.dbFailureCount = 0;

      if (!result.length) {
        return {
          totalSessions: 0,
          activeSessions: 0,
          completedSessions: 0,
          errorSessions: 0,
          totalCost: 0,
          totalTokens: { input: 0, output: 0 },
          averageDuration: 0,
        };
      }

      const s = result[0];
      return {
        totalSessions: s.totalSessions ?? 0,
        activeSessions: s.activeSessions ?? 0,
        completedSessions: s.completedSessions ?? 0,
        errorSessions: s.errorSessions ?? 0,
        totalCost: s.totalCost ?? 0,
        totalTokens: {
          input: s.totalInputTokens ?? 0,
          output: s.totalOutputTokens ?? 0,
        },
        averageDuration: s.averageDuration ?? 0,
      };
    } catch (err) {
      TraceService.recordDbFailure();
      this.logger.error('getSessionsSummary failed', err);
      throw err;
    }
  }

  async ingestTrace(
    body: {
      sessionId?: string;
      parentId?: string;
      name: string;
      type?: 'http' | 'llm' | 'tool' | 'database' | 'custom';
      status?: 'ok' | 'error';
      startedAt: string;
      endedAt?: string;
      error?: { message: string; stack?: string };
      aiModel?: string;
      tokens?: { input: number; output: number };
      costUSD?: number;
      tool?: string;
      resourceIds?: string[];
      metadata?: Record<string, unknown>;
    },
    userId: string,
  ): Promise<{ traceId: string; sessionId: string }> {
    const trace = await this.startSpan(
      {
        sessionId: body.sessionId,
        parentId: body.parentId,
        name: body.name,
        type: body.type,
        metadata: body.metadata,
      },
      userId,
    );

    if (body.endedAt) {
      await this.endSpan(trace.traceId, {
        status: body.status,
        error:
          body.error?.message != null
            ? {
                message: body.error.message,
                stack: body.error.stack,
              }
            : undefined,
        aiModel: body.aiModel,
        tokens:
          body.tokens != null &&
          typeof body.tokens.input === 'number' &&
          typeof body.tokens.output === 'number'
            ? body.tokens
            : undefined,
        costUSD: body.costUSD,
        tool: body.tool,
        resourceIds: body.resourceIds,
        metadata: body.metadata,
      });
    }

    return { traceId: trace.traceId, sessionId: trace.sessionId };
  }
}
