import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Observable, Subject, interval, merge, of } from 'rxjs';
import { map, catchError, finalize } from 'rxjs/operators';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import { ActivityEvent, ActivityFilters } from '../interfaces';
import { generateSecureId } from '../../../common/utils/secure-id.util';

interface AdminConnection {
  connectionId: string;
  adminId: string;
  filters?: ActivityFilters;
  subject: Subject<object>;
  lastActivity: Date;
  createdAt: Date;
}

@Injectable()
export class AdminActivityFeedService {
  private readonly logger = new Logger(AdminActivityFeedService.name);
  private adminConnections = new Map<string, AdminConnection>();
  private recentEvents: ActivityEvent[] = [];
  private readonly MAX_RECENT_EVENTS = 1000;
  private readonly HEARTBEAT_INTERVAL_MS = 15000;
  private readonly CONNECTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private readonly RECENT_EVENTS_BATCH_SIZE = 50;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
  ) {
    this.cleanupIntervalId = setInterval(
      () => this.cleanupInactiveConnections(),
      2 * 60 * 1000,
    );
  }

  onModuleDestroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.adminConnections.forEach((conn) => conn.subject.complete());
    this.adminConnections.clear();
  }

  /**
   * Initialize SSE connection for admin activity feed.
   * Returns an Observable that emits heartbeat messages and real-time events.
   * Recent events are pushed to the stream shortly after subscription.
   */
  initializeAdminFeed(
    adminId: string,
    filters?: ActivityFilters,
  ): Observable<object> {
    const connectionId = generateSecureId(`admin_${adminId}`);
    const subject = new Subject<object>();

    const connection: AdminConnection = {
      connectionId,
      adminId,
      filters,
      subject,
      lastActivity: new Date(),
      createdAt: new Date(),
    };
    this.adminConnections.set(connectionId, connection);

    this.logger.log(
      `Admin activity feed connection established: ${connectionId}`,
    );

    const heartbeat$ = interval(this.HEARTBEAT_INTERVAL_MS).pipe(
      map(() => ({
        type: 'heartbeat',
        timestamp: new Date().toISOString(),
        connectionId,
      })),
    );

    const events$ = subject.asObservable().pipe(
      catchError((err) => {
        this.logger.warn(
          `Activity feed subject error for ${connectionId}:`,
          err,
        );
        return of({ type: 'error', message: 'Stream error' });
      }),
    );

    const stream$ = merge(heartbeat$, events$).pipe(
      finalize(() => {
        this.adminConnections.delete(connectionId);
        this.logger.log(`Activity feed connection closed: ${connectionId}`);
      }),
    );

    setImmediate(() => {
      this.pushRecentEventsToConnection(connectionId);
    });

    return stream$;
  }

  /**
   * Push recent events to a single connection (used on connect and for testing).
   */
  sendRecentEvents(connectionId: string, filters?: ActivityFilters): void {
    this.pushRecentEventsToConnection(connectionId, filters);
  }

  private pushRecentEventsToConnection(
    connectionId: string,
    filters?: ActivityFilters,
  ): void {
    const connection = this.adminConnections.get(connectionId);
    if (!connection) return;

    const effectiveFilters = filters ?? connection.filters;
    let events = [...this.recentEvents]
      .reverse()
      .slice(0, this.RECENT_EVENTS_BATCH_SIZE);

    if (effectiveFilters) {
      events = this.filterEvents(events, effectiveFilters);
    }

    events.forEach((event) => {
      connection.subject.next({
        type: 'event',
        event,
        timestamp: new Date().toISOString(),
      });
    });
    connection.lastActivity = new Date();

    if (events.length > 0) {
      this.logger.debug(
        `Pushed ${events.length} recent events to connection ${connectionId}`,
      );
    }
  }

  /**
   * Record a new activity event and broadcast to all matching admin connections.
   */
  async recordEvent(
    event: Omit<ActivityEvent, 'id' | 'timestamp'>,
  ): Promise<void> {
    try {
      const fullEvent: ActivityEvent = {
        ...event,
        id: generateSecureId(event.type),
        timestamp: new Date(),
      };

      this.recentEvents.push(fullEvent);
      if (this.recentEvents.length > this.MAX_RECENT_EVENTS) {
        this.recentEvents.shift();
      }

      this.broadcastToAdmins(fullEvent);
    } catch (error) {
      this.logger.error('Error recording activity event:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private broadcastToAdmins(event: ActivityEvent): void {
    const payload = {
      type: 'event',
      event,
      timestamp: new Date().toISOString(),
    };

    for (const [connectionId, connection] of this.adminConnections.entries()) {
      if (
        connection.filters &&
        !this.eventMatchesFilters(event, connection.filters)
      ) {
        continue;
      }
      try {
        connection.subject.next(payload);
        connection.lastActivity = new Date();
      } catch (err) {
        this.logger.warn(`Failed to push to connection ${connectionId}:`, err);
      }
    }
  }

  private eventMatchesFilters(
    event: ActivityEvent,
    filters: ActivityFilters,
  ): boolean {
    if (filters.userId && event.userId !== filters.userId) return false;
    if (filters.service && event.service !== filters.service) return false;
    if (filters.model && event.model !== filters.model) return false;
    if (filters.errorType && event.errorType !== filters.errorType)
      return false;
    if (
      filters.types &&
      filters.types.length > 0 &&
      !filters.types.includes(event.type)
    )
      return false;
    if (
      filters.severities &&
      filters.severities.length > 0 &&
      event.severity &&
      !filters.severities.includes(event.severity)
    )
      return false;
    return true;
  }

  private filterEvents(
    events: ActivityEvent[],
    filters: ActivityFilters,
  ): ActivityEvent[] {
    return events.filter((event) => this.eventMatchesFilters(event, filters));
  }

  /**
   * Get recent activity events from database (Usage-based) with optional filters.
   */
  async getRecentEvents(
    limit: number = 50,
    filters?: ActivityFilters,
  ): Promise<ActivityEvent[]> {
    try {
      const matchStage: Record<string, unknown> = {};

      if (filters?.userId) {
        matchStage.userId = filters.userId;
      }
      if (filters?.projectId) {
        matchStage.projectId = filters.projectId;
      }
      if (filters?.service) {
        matchStage.service = filters.service;
      }
      if (filters?.model) {
        matchStage.model = filters.model;
      }

      const recentUsage = await this.usageModel
        .find(matchStage)
        .sort({ createdAt: -1 })
        .limit(Math.min(limit * 2, 500))
        .populate('userId', 'email name')
        .populate('projectId', 'name')
        .lean();

      const events: ActivityEvent[] = [];

      for (const usage of recentUsage) {
        const u = usage as any;
        const userId =
          u.userId == null
            ? undefined
            : typeof u.userId === 'string'
              ? u.userId
              : u.userId._id?.toString();
        const user =
          u.userId && typeof u.userId === 'object' && 'email' in u.userId
            ? (u.userId as { email?: string; name?: string })
            : null;
        const project =
          u.projectId &&
          typeof u.projectId === 'object' &&
          'name' in u.projectId
            ? (u.projectId as { _id?: string; name?: string })
            : null;

        if (u.cost && u.cost > 0.1) {
          events.push({
            id: `usage_${u._id}`,
            type: 'high_cost',
            userId,
            userEmail: user?.email,
            userName: user?.name,
            projectId: project?._id,
            projectName: project?.name,
            service: u.service,
            model: u.model,
            cost: u.cost,
            tokens: u.totalTokens,
            message: `High cost request: $${u.cost.toFixed(4)} for ${u.service}/${u.model}`,
            timestamp: u.createdAt,
            severity: u.cost > 1 ? 'high' : u.cost > 0.5 ? 'medium' : 'low',
          });
        }

        if (u.errorOccurred) {
          events.push({
            id: `error_${u._id}`,
            type: 'error',
            userId,
            userEmail: user?.email,
            userName: user?.name,
            projectId: project?._id,
            projectName: project?.name,
            service: u.service,
            model: u.model,
            errorType: u.errorType,
            message: `Error in ${u.service}/${u.model}: ${u.errorType ?? u.errorMessage ?? 'Unknown error'}`,
            timestamp: u.createdAt,
            severity: u.errorType === 'rate_limit' ? 'high' : 'medium',
          });
        }
      }

      let result = events;
      if (filters) {
        result = this.filterEvents(events, filters);
      }

      return result
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting recent events:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  cleanupInactiveConnections(): void {
    const now = Date.now();
    for (const [connectionId, connection] of this.adminConnections.entries()) {
      if (
        now - connection.lastActivity.getTime() >
        this.CONNECTION_TIMEOUT_MS
      ) {
        connection.subject.complete();
        this.adminConnections.delete(connectionId);
        this.logger.warn(`Cleaned up inactive connection: ${connectionId}`);
      }
    }
  }

  getConnectionStats(): {
    totalConnections: number;
    uniqueAdmins: number;
    adminCounts: Record<string, number>;
    recentEventsCount: number;
  } {
    const connections = Array.from(this.adminConnections.values());
    const adminCounts: Record<string, number> = {};
    for (const conn of connections) {
      adminCounts[conn.adminId] = (adminCounts[conn.adminId] ?? 0) + 1;
    }
    return {
      totalConnections: connections.length,
      uniqueAdmins: Object.keys(adminCounts).length,
      adminCounts,
      recentEventsCount: this.recentEvents.length,
    };
  }
}
