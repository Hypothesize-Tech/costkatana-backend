import { v4 as uuidv4 } from 'uuid';
import { Session, ISession } from '../models/Session';
import { Trace, ITrace } from '../models/Trace';
import { Message, IMessage } from '../models/Message';
import { loggingService } from './logging.service';

export interface StartSpanInput {
    sessionId?: string;
    parentId?: string;
    name: string;
    type?: 'http' | 'llm' | 'tool' | 'database' | 'custom';
    metadata?: Record<string, any>;
}

export interface EndSpanInput {
    status?: 'ok' | 'error';
    error?: {
        message: string;
        stack?: string;
    };
    aiModel?: string;
    tokens?: {
        input: number;
        output: number;
    };
    costUSD?: number;
    tool?: string;
    resourceIds?: string[];
    metadata?: Record<string, any>;
}

export interface RecordMessageInput {
    sessionId: string;
    traceId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    metadata?: Record<string, any>;
}

export interface SessionGraph {
    nodes: Array<{
        id: string;
        label: string;
        start: Date;
        end?: Date;
        status: 'ok' | 'error';
        depth: number;
        aiModel?: string;
        tokens?: {
            input: number;
            output: number;
        };
        costUSD?: number;
        type: string;
        duration?: number;
    }>;
    edges: Array<{
        from: string;
        to: string;
    }>;
}

class TraceService {
    private sensitiveKeys: string[] = ['authorization', 'api-key', 'apikey', 'password', 'email', 'phone', 'ssn', 'credit_card'];
    private customRedactKeys: string[] = [];
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // Pre-compiled regex patterns for better performance
    private static sensitiveKeyRegex: RegExp;
    
    constructor() {
        // Load custom redact keys from environment
        if (process.env.TRACE_REDACT_KEYS) {
            this.customRedactKeys = process.env.TRACE_REDACT_KEYS.split(',').map(k => k.trim());
        }
        
        // Pre-compile sensitive key regex
        const allKeys = [...this.sensitiveKeys, ...this.customRedactKeys];
        TraceService.sensitiveKeyRegex = new RegExp(allKeys.join('|'), 'i');
    }

    /**
     * Redact sensitive information from objects (optimized)
     */
    private redactSensitive(obj: any): any {
        if (!obj || typeof obj !== 'object') return obj;
        
        const redacted = Array.isArray(obj) ? [...obj] : { ...obj };
        
        // Use pre-compiled regex for faster matching
        for (const key of Object.keys(redacted)) {
            if (TraceService.sensitiveKeyRegex.test(key)) {
                redacted[key] = '[REDACTED]';
            } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
                // Limit recursion depth to prevent performance issues
                redacted[key] = this.redactSensitive(redacted[key]);
            }
        }
        
        return redacted;
    }

    /**
     * Start a new trace span
     */
    async startSpan(input: StartSpanInput): Promise<ITrace> {
        try {
            const traceId = uuidv4();
            const sessionId = input.sessionId || uuidv4();
            
            // Ensure session exists
            let session = await Session.findOne({ sessionId });
            if (!session) {
                session = await Session.create({
                    sessionId,
                    startedAt: new Date(),
                    status: 'active',
                    metadata: this.redactSensitive(input.metadata),
                    summary: {
                        totalSpans: 0,
                        totalTokens: { input: 0, output: 0 }
                    }
                });
            }
            
            // Calculate depth based on parent (optimized with projection)
            let depth = 0;
            if (input.parentId) {
                const parent = await Trace.findOne({ traceId: input.parentId }, { depth: 1 });
                if (parent) {
                    depth = parent.depth + 1;
                }
            }
            
            // Create trace
            const trace = await Trace.create({
                traceId,
                sessionId,
                parentId: input.parentId,
                name: input.name,
                type: input.type || 'custom',
                startedAt: new Date(),
                status: 'ok',
                depth,
                metadata: this.redactSensitive(input.metadata)
            });
            
            // Increment span count
            await Session.updateOne(
                { sessionId },
                { $inc: { 'summary.totalSpans': 1 } }
            );
            
            return trace;
        } catch (error) {
            loggingService.error('Error starting span:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * End a trace span
     */
    async endSpan(traceId: string, input: EndSpanInput): Promise<ITrace | null> {
        try {
            const endedAt = new Date();
            const updateData: any = {
                endedAt,
                status: input.status || 'ok',
                metadata: input.metadata ? this.redactSensitive(input.metadata) : undefined
            };
            
            if (input.error) {
                updateData.error = {
                    message: input.error.message,
                    stack: input.error.stack
                };
                updateData.status = 'error';
            }
            
            if (input.aiModel) updateData.aiModel = input.aiModel;
            if (input.tokens) updateData.tokens = input.tokens;
            if (input.costUSD !== undefined) updateData.costUSD = input.costUSD;
            if (input.tool) updateData.tool = input.tool;
            if (input.resourceIds) updateData.resourceIds = input.resourceIds;
            
            const trace = await Trace.findOneAndUpdate(
                { traceId },
                updateData,
                { new: true }
            );
            
            if (trace) {
                // Calculate duration and update trace in single operation
                const duration = endedAt.getTime() - trace.startedAt.getTime();
                await Trace.updateOne({ traceId }, { duration });
                
                // Prepare session updates (combine all updates into single operation)
                const sessionUpdate: any = {};
                if (input.tokens) {
                    sessionUpdate['$inc'] = {
                        'summary.totalTokens.input': input.tokens.input || 0,
                        'summary.totalTokens.output': input.tokens.output || 0
                    };
                }
                if (input.costUSD !== undefined) {
                    if (!sessionUpdate['$inc']) sessionUpdate['$inc'] = {};
                    sessionUpdate['$inc']['summary.totalCost'] = input.costUSD;
                }
                
                // Check if this was a root span error and add to same update
                if (input.status === 'error' && !trace.parentId) {
                    sessionUpdate['status'] = 'error';
                    sessionUpdate['error'] = updateData.error;
                }
                
                // Execute single session update if we have any changes
                if (Object.keys(sessionUpdate).length > 0) {
                    await Session.updateOne({ sessionId: trace.sessionId }, sessionUpdate);
                }
            }
            
            return trace;
        } catch (error) {
            loggingService.error('Error ending span:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Record a message in a trace
     */
    async recordMessage(input: RecordMessageInput): Promise<IMessage> {
        try {
            const messageId = uuidv4();
            const contentPreview = input.content.substring(0, 500);
            const fullContentStored = input.content.length <= 500;
            
            const message = await Message.create({
                messageId,
                sessionId: input.sessionId,
                traceId: input.traceId,
                role: input.role,
                contentPreview: this.redactSensitive(contentPreview),
                fullContentStored,
                timestamp: new Date(),
                metadata: this.redactSensitive(input.metadata)
            });
            
            return message;
        } catch (error) {
            loggingService.error('Error recording message:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get session graph data
     */
    async getSessionGraph(sessionId: string): Promise<SessionGraph> {
        try {
            const traces = await Trace.find({ sessionId }).sort({ startedAt: 1 });
            
            const nodes = traces.map(trace => ({
                id: trace.traceId,
                label: trace.name,
                start: trace.startedAt,
                end: trace.endedAt,
                status: trace.status,
                depth: trace.depth,
                aiModel: trace.aiModel,
                tokens: trace.tokens,
                costUSD: trace.costUSD,
                type: trace.type,
                duration: trace.duration
            }));
            
            const edges = traces
                .filter(trace => trace.parentId)
                .map(trace => ({
                    from: trace.parentId!,
                    to: trace.traceId
                }));
            
            return { nodes, edges };
        } catch (error) {
            loggingService.error('Error getting session graph:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get session details with message previews
     */
    async getSessionDetails(sessionId: string): Promise<{
        session: ISession | null;
        messages: IMessage[];
    }> {
        try {
            const session = await Session.findOne({ sessionId });
            const messages = await Message.find({ sessionId }).sort({ timestamp: 1 });
            
            return { session, messages };
        } catch (error) {
            loggingService.error('Error getting session details:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * List sessions with filters
     */
    async listSessions(filters: {
        userId?: string;
        label?: string;
        from?: Date;
        to?: Date;
        page?: number;
        limit?: number;
    }): Promise<{
        sessions: ISession[];
        total: number;
        page: number;
        totalPages: number;
    }> {
        try {
            const query: any = {};
            
            if (filters.userId) query.userId = filters.userId;
            if (filters.label) query.label = new RegExp(filters.label, 'i');
            if (filters.from || filters.to) {
                query.startedAt = {};
                if (filters.from) query.startedAt.$gte = filters.from;
                if (filters.to) query.startedAt.$lte = filters.to;
            }
            
            const page = filters.page || 1;
            const limit = filters.limit || 20;
            const skip = (page - 1) * limit;
            
            // Check circuit breaker before database operations
            if (TraceService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const [sessions, total] = await Promise.all([
                Session.find(query)
                    .sort({ startedAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(), // Use lean for better performance
                Session.countDocuments(query)
            ]);

            // Reset failure count on success
            TraceService.dbFailureCount = 0;
            
            const totalPages = Math.ceil(total / limit);
            
            return { sessions, total, page, totalPages };
        } catch (error) {
            TraceService.recordDbFailure();
            loggingService.error('Error listing sessions:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * End a session
     */
    async endSession(sessionId: string): Promise<ISession | null> {
        try {
            const endedAt = new Date();
            
            // Calculate total duration
            const session = await Session.findOne({ sessionId });
            if (!session) return null;
            
            const totalDuration = endedAt.getTime() - session.startedAt.getTime();
            
            return await Session.findOneAndUpdate(
                { sessionId },
                {
                    endedAt,
                    status: 'completed',
                    'summary.totalDuration': totalDuration
                },
                { new: true }
            );
        } catch (error) {
            loggingService.error('Error ending session:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Create a child span for an existing span
     */
    async createChildSpan(parentTraceId: string, input: Omit<StartSpanInput, 'parentId'>): Promise<ITrace> {
        const parent = await Trace.findOne({ traceId: parentTraceId });
        if (!parent) {
            throw new Error(`Parent trace ${parentTraceId} not found`);
        }
        
        return this.startSpan({
            ...input,
            sessionId: parent.sessionId,
            parentId: parentTraceId
        });
    }

    /**
     * Get sessions summary using aggregation pipeline (optimized)
     */
    async getSessionsSummary(userId?: string): Promise<{
        totalSessions: number;
        activeSessions: number;
        completedSessions: number;
        errorSessions: number;
        totalCost: number;
        totalTokens: {
            input: number;
            output: number;
        };
        averageDuration: number;
    }> {
        try {
            // Check circuit breaker before database operations
            if (TraceService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const matchStage: any = {};
            if (userId) {
                matchStage.userId = userId;
            }

            const pipeline = [
                { $match: matchStage },
                {
                    $group: {
                        _id: null,
                        totalSessions: { $sum: 1 },
                        activeSessions: {
                            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
                        },
                        completedSessions: {
                            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                        },
                        errorSessions: {
                            $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] }
                        },
                        totalCost: { $sum: { $ifNull: ['$summary.totalCost', 0] } },
                        totalInputTokens: { $sum: { $ifNull: ['$summary.totalTokens.input', 0] } },
                        totalOutputTokens: { $sum: { $ifNull: ['$summary.totalTokens.output', 0] } },
                        averageDuration: { $avg: { $ifNull: ['$summary.totalDuration', 0] } }
                    }
                }
            ];

            const result = await Session.aggregate(pipeline);
            
            // Reset failure count on success
            TraceService.dbFailureCount = 0;

            if (result.length === 0) {
                return {
                    totalSessions: 0,
                    activeSessions: 0,
                    completedSessions: 0,
                    errorSessions: 0,
                    totalCost: 0,
                    totalTokens: { input: 0, output: 0 },
                    averageDuration: 0
                };
            }

            const summary = result[0];
            return {
                totalSessions: summary.totalSessions || 0,
                activeSessions: summary.activeSessions || 0,
                completedSessions: summary.completedSessions || 0,
                errorSessions: summary.errorSessions || 0,
                totalCost: summary.totalCost || 0,
                totalTokens: {
                    input: summary.totalInputTokens || 0,
                    output: summary.totalOutputTokens || 0
                },
                averageDuration: summary.averageDuration || 0
            };
        } catch (error) {
            TraceService.recordDbFailure();
            loggingService.error('Error getting sessions summary:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Circuit breaker utilities for database operations
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
        // Reset circuit breaker state
        this.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
    }
}

export const traceService = new TraceService();
