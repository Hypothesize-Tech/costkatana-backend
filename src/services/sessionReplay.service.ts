import { v4 as uuidv4 } from 'uuid';
import { Session, ISession } from '../models/Session';
import { Telemetry } from '../models/Telemetry';
import { loggingService } from './logging.service';
import os from 'os';

export interface CreateSessionInput {
    userId: string;
    workspaceId?: string;
    label?: string;
    startedAt: Date;
    metadata?: Record<string, any>;
    trackingEnabled?: boolean;
    sessionReplayEnabled?: boolean;
}

export interface SessionOptions {
    workspaceId?: string;
    metadata?: Record<string, any>;
}

export interface AddReplayDataInput {
    sessionId: string;
    codeContext?: {
        filePath: string;
        content: string;
        language?: string;
    };
    aiInteraction?: {
        model: string;
        prompt: string;
        response: string;
        parameters?: Record<string, any>;
        tokens?: {
            input: number;
            output: number;
        };
        cost?: number;
    };
    userAction?: {
        action: string;
        details?: any;
    };
    captureSystemMetrics?: boolean;
}

class SessionReplayService {
    private static SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes default
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;

    /**
     * Set session timeout from environment or config
     */
    static setSessionTimeout(minutes: number): void {
        this.SESSION_TIMEOUT_MS = minutes * 60 * 1000;
        loggingService.info('Session replay timeout updated', {
            component: 'SessionReplayService',
            timeoutMinutes: minutes
        });
    }

    /**
     * Create a new session or merge with existing telemetry
     */
    async createOrMergeSession(input: CreateSessionInput): Promise<ISession> {
        try {
            // Check circuit breaker
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const sessionId = uuidv4();
            const searchWindow = 5 * 60 * 1000; // 5 minutes

            // Check for existing telemetry within time window
            const telemetryMatch = await Telemetry.findOne({
                user_id: input.userId,
                ...(input.workspaceId && { workspace_id: input.workspaceId }),
                timestamp: {
                    $gte: new Date(input.startedAt.getTime() - searchWindow),
                    $lte: new Date(input.startedAt.getTime() + searchWindow)
                }
            }).sort({ timestamp: -1 }).limit(1);

            let session: ISession;

            if (telemetryMatch) {
                // Create unified session
                loggingService.info('Creating unified session with telemetry', {
                    component: 'SessionReplayService',
                    operation: 'createOrMergeSession',
                    sessionId,
                    telemetryTraceId: telemetryMatch.trace_id,
                    userId: input.userId
                });

                session = await Session.create({
                    sessionId,
                    userId: input.userId,
                    workspaceId: input.workspaceId,
                    label: input.label,
                    startedAt: input.startedAt,
                    status: 'active',
                    source: 'unified',
                    telemetryTraceId: telemetryMatch.trace_id,
                    trackingEnabled: input.trackingEnabled ?? false,
                    sessionReplayEnabled: input.sessionReplayEnabled ?? false,
                    trackingEnabledAt: input.trackingEnabled ? new Date() : undefined,
                    metadata: input.metadata,
                    summary: {
                        totalSpans: 0,
                        totalTokens: { input: 0, output: 0 }
                    }
                });

                // Update telemetry with session reference
                await Telemetry.updateOne(
                    { trace_id: telemetryMatch.trace_id },
                    { 
                        $set: { 
                            'attributes.session_id': sessionId,
                            'attributes.session_source': 'unified'
                        } 
                    }
                );
            } else {
                // Create manual session
                loggingService.info('Creating manual session', {
                    component: 'SessionReplayService',
                    operation: 'createOrMergeSession',
                    sessionId,
                    userId: input.userId
                });

                session = await Session.create({
                    sessionId,
                    userId: input.userId,
                    workspaceId: input.workspaceId,
                    label: input.label,
                    startedAt: input.startedAt,
                    status: 'active',
                    source: 'manual',
                    trackingEnabled: input.trackingEnabled ?? false,
                    sessionReplayEnabled: input.sessionReplayEnabled ?? false,
                    trackingEnabledAt: input.trackingEnabled ? new Date() : undefined,
                    metadata: input.metadata,
                    summary: {
                        totalSpans: 0,
                        totalTokens: { input: 0, output: 0 }
                    }
                });
            }

            SessionReplayService.dbFailureCount = 0;
            return session;
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error creating or merging session', {
                error: error instanceof Error ? error.message : String(error),
                userId: input.userId
            });
            throw error;
        }
    }

    /**
     * Get or create an active session for a user
     */
    async getOrCreateActiveSession(
        userId: string,
        options: SessionOptions
    ): Promise<string> {
        try {
            // Check circuit breaker
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Find active session within timeout window
            const cutoffTime = new Date(Date.now() - SessionReplayService.SESSION_TIMEOUT_MS);
            
            const activeSession = await Session.findOne({
                userId,
                ...(options.workspaceId && { workspaceId: options.workspaceId }),
                status: 'active',
                updatedAt: { $gte: cutoffTime }
            }).sort({ updatedAt: -1 });

            if (activeSession) {
                loggingService.debug('Found active session', {
                    component: 'SessionReplayService',
                    operation: 'getOrCreateActiveSession',
                    sessionId: activeSession.sessionId,
                    userId
                });

                // Update last activity
                await Session.updateOne(
                    { sessionId: activeSession.sessionId },
                    { $set: { updatedAt: new Date() } }
                );

                SessionReplayService.dbFailureCount = 0;
                return activeSession.sessionId;
            }

            // Create new session
            loggingService.info('No active session found, creating new one', {
                component: 'SessionReplayService',
                operation: 'getOrCreateActiveSession',
                userId
            });

            const session = await this.createOrMergeSession({
                userId,
                workspaceId: options.workspaceId,
                startedAt: new Date(),
                metadata: options.metadata,
                trackingEnabled: true,
                sessionReplayEnabled: true
            });

            SessionReplayService.dbFailureCount = 0;
            return session.sessionId;
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error getting or creating active session', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Add replay data to an existing session
     */
    async addReplayData(input: AddReplayDataInput): Promise<void> {
        try {
            // Check circuit breaker
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const updateData: any = {
                $set: { updatedAt: new Date() }
            };

            if (input.codeContext) {
                updateData.$push = updateData.$push || {};
                updateData.$push['replayData.codeContext'] = {
                    ...input.codeContext,
                    timestamp: new Date()
                };
            }

            if (input.aiInteraction) {
                updateData.$push = updateData.$push || {};
                updateData.$push['replayData.aiInteractions'] = {
                    ...input.aiInteraction,
                    timestamp: new Date()
                };
            }

            if (input.userAction) {
                updateData.$push = updateData.$push || {};
                updateData.$push['replayData.userActions'] = {
                    ...input.userAction,
                    timestamp: new Date()
                };
            }

            if (input.captureSystemMetrics) {
                const cpuUsage = process.cpuUsage();
                const memUsage = process.memoryUsage();
                const loadAvg = os.loadavg();

                updateData.$push = updateData.$push || {};
                updateData.$push['replayData.systemMetrics'] = {
                    timestamp: new Date(),
                    cpu: loadAvg[0],
                    memory: (memUsage.heapUsed / memUsage.heapTotal) * 100,
                    network: {
                        sent: 0, // Would need additional tracking
                        received: 0
                    }
                };
            }

            await Session.updateOne(
                { sessionId: input.sessionId },
                updateData
            );

            SessionReplayService.dbFailureCount = 0;

            loggingService.debug('Added replay data to session', {
                component: 'SessionReplayService',
                operation: 'addReplayData',
                sessionId: input.sessionId,
                hasCodeContext: !!input.codeContext,
                hasAIInteraction: !!input.aiInteraction,
                hasUserAction: !!input.userAction
            });
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error adding replay data', {
                error: error instanceof Error ? error.message : String(error),
                sessionId: input.sessionId
            });
            throw error;
        }
    }

    /**
     * Link manual session with telemetry trace
     */
    async linkWithTelemetry(sessionId: string, telemetryTraceId: string): Promise<void> {
        try {
            // Check circuit breaker
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            await Session.updateOne(
                { sessionId },
                {
                    $set: {
                        source: 'unified',
                        telemetryTraceId
                    }
                }
            );

            await Telemetry.updateOne(
                { trace_id: telemetryTraceId },
                {
                    $set: {
                        'attributes.session_id': sessionId,
                        'attributes.session_source': 'unified'
                    }
                }
            );

            SessionReplayService.dbFailureCount = 0;

            loggingService.info('Linked session with telemetry', {
                component: 'SessionReplayService',
                operation: 'linkWithTelemetry',
                sessionId,
                telemetryTraceId
            });
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error linking session with telemetry', {
                error: error instanceof Error ? error.message : String(error),
                sessionId,
                telemetryTraceId
            });
            throw error;
        }
    }

    /**
     * Get session with full replay data
     */
    async getSessionReplay(sessionId: string): Promise<ISession | null> {
        try {
            // Check circuit breaker
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const session = await Session.findOne({ sessionId });
            
            SessionReplayService.dbFailureCount = 0;
            return session;
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error getting session replay', {
                error: error instanceof Error ? error.message : String(error),
                sessionId
            });
            throw error;
        }
    }

    /**
     * List sessions with replay data
     */
    async listSessionReplays(filters: {
        userId?: string;
        workspaceId?: string;
        source?: 'telemetry' | 'manual' | 'unified' | 'in-app' | 'integration';
        from?: Date;
        to?: Date;
        status?: 'active' | 'completed' | 'error';
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
        sortBy?: 'startedAt' | 'totalCost' | 'totalTokens' | 'duration';
        sortOrder?: 'asc' | 'desc';
    }): Promise<{
        sessions: ISession[];
        total: number;
        page: number;
        totalPages: number;
    }> {
        try {
            // Check circuit breaker
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const query: any = {};

            // Basic filters
            if (filters.userId) query.userId = filters.userId;
            if (filters.workspaceId) query.workspaceId = filters.workspaceId;
            if (filters.source) query.source = filters.source;
            if (filters.status) query.status = filters.status;
            if (filters.hasErrors !== undefined) query.hasErrors = filters.hasErrors;
            if (filters.appFeature) query.appFeature = filters.appFeature;

            // Date range filter
            if (filters.from || filters.to) {
                query.startedAt = {};
                if (filters.from) query.startedAt.$gte = filters.from;
                if (filters.to) query.startedAt.$lte = filters.to;
            }

            // Cost range filter
            if (filters.minCost !== undefined || filters.maxCost !== undefined) {
                query['summary.totalCost'] = {};
                if (filters.minCost !== undefined) query['summary.totalCost'].$gte = filters.minCost;
                if (filters.maxCost !== undefined) query['summary.totalCost'].$lte = filters.maxCost;
            }

            // Token range filter
            if (filters.minTokens !== undefined || filters.maxTokens !== undefined) {
                query.$expr = query.$expr || { $and: [] };
                const tokenConditions: any = [];
                const totalTokensExpr = {
                    $add: [
                        { $ifNull: ['$summary.totalTokens.input', 0] },
                        { $ifNull: ['$summary.totalTokens.output', 0] }
                    ]
                };
                if (filters.minTokens !== undefined) {
                    tokenConditions.push({ $gte: [totalTokensExpr, filters.minTokens] });
                }
                if (filters.maxTokens !== undefined) {
                    tokenConditions.push({ $lte: [totalTokensExpr, filters.maxTokens] });
                }
                if (!Array.isArray(query.$expr.$and)) {
                    query.$expr = { $and: tokenConditions };
                } else {
                    query.$expr.$and.push(...tokenConditions);
                }
            }

            // Duration range filter
            if (filters.minDuration !== undefined || filters.maxDuration !== undefined) {
                query.duration = {};
                if (filters.minDuration !== undefined) query.duration.$gte = filters.minDuration;
                if (filters.maxDuration !== undefined) query.duration.$lte = filters.maxDuration;
            }

            // AI model filter
            if (filters.aiModel) {
                query['replayData.aiInteractions.model'] = filters.aiModel;
            }

            // Search query filter (label or metadata)
            if (filters.searchQuery) {
                query.$or = [
                    { label: { $regex: filters.searchQuery, $options: 'i' } },
                    { sessionId: { $regex: filters.searchQuery, $options: 'i' } }
                ];
            }

            const page = filters.page || 1;
            const limit = filters.limit || 20;
            const skip = (page - 1) * limit;

            // Determine sort field and order
            let sortField = 'startedAt';
            if (filters.sortBy === 'totalCost') sortField = 'summary.totalCost';
            else if (filters.sortBy === 'duration') sortField = 'duration';
            // Note: totalTokens requires aggregation for proper sorting
            
            const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
            const sortQuery: any = { [sortField]: sortOrder };

            const [sessions, total] = await Promise.all([
                Session.find(query)
                    .sort(sortQuery)
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Session.countDocuments(query)
            ]);

            SessionReplayService.dbFailureCount = 0;

            const totalPages = Math.ceil(total / limit);

            return { sessions: sessions as any as ISession[], total, page, totalPages };
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error listing session replays', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get session statistics aggregated by various dimensions
     */
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
        try {
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const aggregation = await Session.aggregate([
                { $match: { userId } },
                {
                    $facet: {
                        totalSessions: [{ $count: 'count' }],
                        bySource: [
                            { $group: { _id: '$source', count: { $sum: 1 } } }
                        ],
                        byStatus: [
                            { $group: { _id: '$status', count: { $sum: 1 } } }
                        ],
                        byAppFeature: [
                            { $match: { appFeature: { $exists: true, $ne: null } } },
                            { $group: { _id: '$appFeature', count: { $sum: 1 } } }
                        ],
                        totalCost: [
                            { $group: { _id: null, total: { $sum: '$summary.totalCost' } } }
                        ],
                        totalTokens: [
                            {
                                $group: {
                                    _id: null,
                                    input: { $sum: '$summary.totalTokens.input' },
                                    output: { $sum: '$summary.totalTokens.output' }
                                }
                            }
                        ],
                        averageDuration: [
                            { $match: { duration: { $exists: true, $ne: null } } },
                            { $group: { _id: null, avg: { $avg: '$duration' } } }
                        ],
                        errorCount: [
                            { $match: { hasErrors: true } },
                            { $count: 'count' }
                        ],
                        topModels: [
                            { $unwind: '$replayData.aiInteractions' },
                            {
                                $group: {
                                    _id: '$replayData.aiInteractions.model',
                                    count: { $sum: 1 }
                                }
                            },
                            { $sort: { count: -1 } },
                            { $limit: 10 }
                        ],
                        costBySource: [
                            {
                                $group: {
                                    _id: '$source',
                                    totalCost: { $sum: '$summary.totalCost' }
                                }
                            }
                        ]
                    }
                }
            ]);

            const stats = aggregation[0];
            const totalSessions = stats.totalSessions[0]?.count || 0;
            const errorCount = stats.errorCount[0]?.count || 0;

            SessionReplayService.dbFailureCount = 0;

            return {
                totalSessions,
                bySource: stats.bySource.reduce((acc: any, item: any) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
                byStatus: stats.byStatus.reduce((acc: any, item: any) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
                byAppFeature: stats.byAppFeature.reduce((acc: any, item: any) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
                totalCost: stats.totalCost[0]?.total || 0,
                totalTokens: stats.totalTokens[0] || { input: 0, output: 0 },
                averageDuration: stats.averageDuration[0]?.avg || 0,
                errorRate: totalSessions > 0 ? (errorCount / totalSessions) * 100 : 0,
                topModels: stats.topModels.map((item: any) => ({
                    model: item._id,
                    count: item.count
                })),
                costBySource: stats.costBySource.reduce((acc: any, item: any) => {
                    acc[item._id] = item.totalCost;
                    return acc;
                }, {})
            };
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error getting session stats', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Export session data in specified format
     */
    async exportSession(sessionId: string, format: 'json' | 'csv'): Promise<any> {
        try {
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const session = await Session.findOne({ sessionId }).lean();
            if (!session) {
                throw new Error('Session not found');
            }

            SessionReplayService.dbFailureCount = 0;

            if (format === 'json') {
                return session;
            } else if (format === 'csv') {
                // Flatten session data for CSV export
                const flatData: any[] = [];
                
                // Add session summary row
                flatData.push({
                    type: 'session',
                    sessionId: session.sessionId,
                    userId: session.userId,
                    label: session.label,
                    source: session.source,
                    appFeature: session.appFeature,
                    status: session.status,
                    startedAt: session.startedAt,
                    endedAt: session.endedAt,
                    duration: session.duration,
                    totalCost: session.summary?.totalCost,
                    totalTokensInput: session.summary?.totalTokens?.input,
                    totalTokensOutput: session.summary?.totalTokens?.output,
                    hasErrors: session.hasErrors,
                    errorCount: session.errorCount
                });

                // Add AI interactions
                if (session.replayData?.aiInteractions) {
                    session.replayData.aiInteractions.forEach((interaction: any, index: number) => {
                        flatData.push({
                            type: 'ai_interaction',
                            sessionId: session.sessionId,
                            index,
                            timestamp: interaction.timestamp,
                            model: interaction.model,
                            prompt: interaction.prompt?.substring(0, 500), // Truncate for CSV
                            response: interaction.response?.substring(0, 500),
                            tokensInput: interaction.tokens?.input,
                            tokensOutput: interaction.tokens?.output,
                            cost: interaction.cost,
                            latency: interaction.latency
                        });
                    });
                }

                return flatData;
            }
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error exporting session', {
                sessionId,
                format,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Generate shareable link for session
     */
    async shareSession(sessionId: string, options: {
        accessLevel?: 'public' | 'team' | 'password';
        expiresIn?: number; // hours
        password?: string;
    }): Promise<{
        shareToken: string;
        shareUrl: string;
        expiresAt?: Date;
    }> {
        try {
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const session = await Session.findOne({ sessionId });
            if (!session) {
                throw new Error('Session not found');
            }

            // Generate unique share token
            const shareToken = `share_${sessionId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            
            const expiresAt = options.expiresIn 
                ? new Date(Date.now() + options.expiresIn * 60 * 60 * 1000)
                : undefined;

            // Store share metadata in session metadata
            const shareMetadata = {
                shareToken,
                accessLevel: options.accessLevel || 'team',
                createdAt: new Date(),
                expiresAt,
                password: options.password // In production, hash this
            };

            await Session.updateOne(
                { sessionId },
                { $set: { 'metadata.shareInfo': shareMetadata } }
            );

            SessionReplayService.dbFailureCount = 0;

            const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const shareUrl = `${baseUrl}/session-replay/shared/${shareToken}`;

            return {
                shareToken,
                shareUrl,
                expiresAt
            };
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error creating share link', {
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Auto-end inactive sessions
     */
    async autoEndInactiveSessions(): Promise<number> {
        try {
            // Check circuit breaker
            if (SessionReplayService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const cutoffTime = new Date(Date.now() - SessionReplayService.SESSION_TIMEOUT_MS);

            const result = await Session.updateMany(
                {
                    status: 'active',
                    updatedAt: { $lt: cutoffTime }
                },
                {
                    $set: {
                        status: 'completed',
                        endedAt: new Date()
                    }
                }
            );

            SessionReplayService.dbFailureCount = 0;

            if (result.modifiedCount > 0) {
                loggingService.info('Auto-ended inactive sessions', {
                    component: 'SessionReplayService',
                    operation: 'autoEndInactiveSessions',
                    count: result.modifiedCount
                });
            }

            return result.modifiedCount;
        } catch (error) {
            SessionReplayService.recordDbFailure();
            loggingService.error('Error auto-ending inactive sessions', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Circuit breaker utilities
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        this.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
    }
}

// Initialize session timeout from environment
const envTimeout = parseInt(process.env.SESSION_REPLAY_TIMEOUT || '30');
SessionReplayService.setSessionTimeout(envTimeout);

export const sessionReplayService = new SessionReplayService();

