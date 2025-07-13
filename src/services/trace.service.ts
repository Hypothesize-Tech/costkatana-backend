import { Trace, ITrace, ITraceSpan } from '../models/Trace';
import { logger } from '../utils/logger';
import { PaginationOptions } from '../utils/helpers';
import { v4 as uuidv4 } from 'uuid';
import { ActivityService } from './activity.service';
import mongoose from 'mongoose';

export interface CreateTraceRequest {
    name: string;
    projectId?: string;
    metadata?: {
        environment?: string;
        version?: string;
        sessionId?: string;
        tags?: string[];
        customAttributes?: Record<string, any>;
    };
}

export interface AddSpanRequest {
    name: string;
    operation: 'ai_call' | 'processing' | 'database' | 'http_request' | 'custom';
    parentSpanId?: string;
    aiCall?: {
        provider: string;
        model: string;
        prompt: string;
        completion?: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost: number;
        parameters: Record<string, any>;
        cacheHit?: boolean;
        retryCount?: number;
    };
    performance?: {
        latency: number;
        queueTime?: number;
        processingTime?: number;
        networkTime?: number;
    };
    tags?: Record<string, string>;
    error?: {
        message: string;
        code?: string;
        stack?: string;
        recoverable: boolean;
    };
}

export interface TraceQuery {
    userId?: string;
    projectId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
    search?: string;
    minCost?: number;
    maxCost?: number;
    provider?: string;
    model?: string;
    limit?: number;
}

export interface TraceAnalysis {
    criticalPath: {
        spans: string[];
        totalDuration: number;
        bottlenecks: Array<{
            spanId: string;
            duration: number;
            percentage: number;
        }>;
    };
    dependencies: {
        graph: Record<string, string[]>;
        services: string[];
        models: string[];
        providers: string[];
    };
    performance: {
        totalCost: number;
        totalTokens: number;
        averageLatency: number;
        cacheHitRate: number;
        errorRate: number;
        parallelizationOpportunities: string[];
    };
    optimizations: Array<{
        type: 'parallelization' | 'caching' | 'model_optimization' | 'prompt_optimization';
        description: string;
        estimatedSavings: number;
        confidence: number;
        spans: string[];
    }>;
}

export interface TraceReplayRequest {
    preservePrompts?: boolean;
    preserveParameters?: boolean;
    allowModelSubstitution?: boolean;
    compareOutputs?: boolean;
    targetEnvironment?: string;
    targetModels?: Record<string, string>; // originalModel -> targetModel mapping
}

export interface TraceReplayResult {
    replayId: string;
    originalTraceId: string;
    status: 'running' | 'completed' | 'failed';
    startTime: Date;
    endTime?: Date;
    spanResults: Array<{
        originalSpanId: string;
        replaySpanId: string;
        status: 'success' | 'failed' | 'skipped';
        replayable: boolean;
        differences?: Array<{
            field: string;
            original: any;
            replay: any;
            significant: boolean;
        }>;
        error?: string;
        performance: {
            originalDuration: number;
            replayDuration: number;
            comparison: number; // percentage difference
        };
    }>;
    summary: {
        totalSpans: number;
        replayableSpans: number;
        successfulReplays: number;
        failedReplays: number;
        significantDifferences: number;
        totalCostOriginal: number;
        totalCostReplay: number;
    };
}

export interface PerformanceInsights {
    traceId: string;
    analysisTime: Date;
    summary: {
        totalDuration: number;
        totalCost: number;
        totalTokens: number;
        spanCount: number;
        aiCallCount: number;
        parallelizableSpans: number;
        cacheOpportunities: number;
        estimatedSavings: number;
        bottlenecks: number;
    };
    bottlenecks: Array<{
        spanId: string;
        name: string;
        type: 'latency' | 'cost' | 'token_usage' | 'retry_count' | 'queue_time';
        severity: 'low' | 'medium' | 'high' | 'critical';
        impact: number; // percentage of total impact
        currentValue: number;
        recommendedValue?: number;
        description: string;
        solution: string;
    }>;
    optimizations: Array<{
        type: 'parallelization' | 'caching' | 'model_substitution' | 'prompt_optimization' | 'batch_processing';
        priority: 'low' | 'medium' | 'high' | 'critical';
        estimatedSavings: {
            cost: number;
            time: number;
            tokens?: number;
        };
        effort: 'low' | 'medium' | 'high';
        description: string;
        implementation: string;
        affectedSpans: string[];
        confidence: number; // 0-1
    }>;
    modelRecommendations: Array<{
        currentModel: string;
        recommendedModel: string;
        reason: string;
        estimatedSavings: {
            cost: number;
            time?: number;
        };
        tradeoffs: string[];
        spanIds: string[];
    }>;
    cacheAnalysis: {
        totalPrompts: number;
        duplicatePrompts: number;
        cacheablePrompts: number;
        estimatedCacheSavings: {
            cost: number;
            time: number;
        };
        recommendations: Array<{
            promptHash: string;
            frequency: number;
            estimatedSavings: number;
            spanIds: string[];
        }>;
    };
}

export interface OptimizationSuggestion {
    id: string;
    type: 'cost' | 'latency' | 'throughput' | 'quality';
    title: string;
    description: string;
    impact: 'low' | 'medium' | 'high' | 'critical';
    effort: 'low' | 'medium' | 'high';
    estimatedSavings?: {
        cost?: number;
        time?: number;
        tokens?: number;
    };
    implementation: {
        steps: string[];
        codeExample?: string;
        configChanges?: Record<string, any>;
    };
    metrics: {
        before: Record<string, number>;
        after: Record<string, number>;
    };
}

export class TraceService {
    /**
     * Create a new trace
     */
    static async createTrace(
        userId: string,
        request: CreateTraceRequest
    ): Promise<ITrace> {
        try {
            const traceId = uuidv4();

            const trace = new Trace({
                traceId,
                userId: new mongoose.Types.ObjectId(userId),
                projectId: request.projectId ? new mongoose.Types.ObjectId(request.projectId) : undefined,
                name: request.name,
                status: 'running',
                startTime: new Date(),
                totalCost: 0,
                totalTokens: 0,
                callCount: 0,
                spans: [],
                metadata: request.metadata || {},
                dependencies: {
                    services: [],
                    models: [],
                    providers: []
                },
                performance: {
                    criticalPath: [],
                    bottlenecks: [],
                    parallelizable: [],
                    cacheOpportunities: []
                },
                errors: [],
                sampling: {
                    sampled: true,
                    sampleRate: 1.0
                }
            });

            const savedTrace = await trace.save();

            // Log activity
            await ActivityService.trackActivity(userId, {
                type: 'trace_created',
                title: `Created new trace: ${request.name}`,
                description: `Started tracing workflow with ID ${traceId}`,
                metadata: {
                    traceId,
                    traceName: request.name,
                    projectId: request.projectId
                }
            });

            logger.info('Trace created', { traceId, userId, name: request.name });
            return savedTrace;
        } catch (error) {
            logger.error('Failed to create trace', { error, userId, request });
            throw error;
        }
    }

    /**
     * Add a span to an existing trace
     */
    static async addSpan(
        traceId: string,
        userId: string,
        spanRequest: AddSpanRequest
    ): Promise<ITrace> {
        try {
            const trace = await Trace.findOne({ traceId, userId });
            if (!trace) {
                throw new Error('Trace not found');
            }

            const spanId = uuidv4();
            const now = new Date();

            // Create span with proper hash for caching
            const span: ITraceSpan = {
                spanId,
                parentSpanId: spanRequest.parentSpanId,
                name: spanRequest.name,
                operation: spanRequest.operation,
                startTime: now,
                status: 'running',
                performance: spanRequest.performance || { latency: 0 },
                relationships: {
                    children: [],
                    dependencies: [],
                    triggers: []
                },
                tags: spanRequest.tags || {},
                logs: []
            };

            // Add AI-specific data if provided
            if (spanRequest.aiCall) {
                span.aiCall = {
                    ...spanRequest.aiCall,
                    promptHash: this.generatePromptHash(spanRequest.aiCall.prompt),
                    cacheHit: spanRequest.aiCall.cacheHit || false,
                    retryCount: spanRequest.aiCall.retryCount || 0
                };

                // Update trace dependencies
                if (!trace.dependencies.providers.includes(spanRequest.aiCall.provider)) {
                    trace.dependencies.providers.push(spanRequest.aiCall.provider);
                }
                if (!trace.dependencies.models.includes(spanRequest.aiCall.model)) {
                    trace.dependencies.models.push(spanRequest.aiCall.model);
                }
            }

            // Add error if provided
            if (spanRequest.error) {
                span.error = spanRequest.error;
                span.status = 'failed';

                // Add to trace errors
                trace.errors.push({
                    spanId,
                    error: spanRequest.error.message,
                    timestamp: now,
                    severity: spanRequest.error.recoverable ? 'medium' : 'high'
                });
            }

            // Add span to trace
            trace.spans.push(span);
            trace.callCount = trace.spans.length;

            // Update parent-child relationships
            if (spanRequest.parentSpanId) {
                const parentSpan = trace.spans.find(s => s.spanId === spanRequest.parentSpanId);
                if (parentSpan) {
                    parentSpan.relationships.children.push(spanId);
                }
            } else {
                // This is a root span
                trace.rootSpanId = spanId;
            }

            const updatedTrace = await trace.save();
            logger.info('Span added to trace', { traceId, spanId, operation: spanRequest.operation });

            return updatedTrace;
        } catch (error) {
            logger.error('Failed to add span to trace', { error, traceId, userId });
            throw error;
        }
    }

    /**
     * Complete a span
     */
    static async completeSpan(
        traceId: string,
        spanId: string,
        userId: string,
        completion?: {
            endTime?: Date;
            duration?: number;
            aiCall?: {
                completion?: string;
                completionTokens?: number;
                totalTokens?: number;
                cost?: number;
            };
            logs?: Array<{
                level: 'debug' | 'info' | 'warn' | 'error';
                message: string;
                data?: any;
            }>;
        }
    ): Promise<ITrace> {
        try {
            const trace = await Trace.findOne({ traceId, userId });
            if (!trace) {
                throw new Error('Trace not found');
            }

            const span = trace.spans.find(s => s.spanId === spanId);
            if (!span) {
                throw new Error('Span not found');
            }

            const endTime = completion?.endTime || new Date();
            const duration = completion?.duration || (endTime.getTime() - span.startTime.getTime());

            // Update span
            span.endTime = endTime;
            span.duration = duration;
            span.status = 'completed';

            // Update AI call data if provided
            if (completion?.aiCall && span.aiCall) {
                Object.assign(span.aiCall, completion.aiCall);
            }

            // Add logs if provided
            if (completion?.logs) {
                span.logs.push(...completion.logs.map(log => ({
                    timestamp: new Date(),
                    level: log.level,
                    message: log.message,
                    data: log.data
                })));
            }

            const updatedTrace = await trace.save();
            logger.info('Span completed', { traceId, spanId, duration });

            return updatedTrace;
        } catch (error) {
            logger.error('Failed to complete span', { error, traceId, spanId, userId });
            throw error;
        }
    }

    /**
     * Complete a trace and perform analysis
     */
    static async completeTrace(traceId: string, userId: string): Promise<ITrace> {
        try {
            const trace = await Trace.findOne({ traceId, userId });
            if (!trace) {
                throw new Error('Trace not found');
            }

            // Complete the trace
            trace.status = 'completed';
            trace.endTime = new Date();
            trace.duration = trace.endTime.getTime() - trace.startTime.getTime();

            // Calculate totals
            trace.totalCost = trace.spans.reduce((sum: number, span: any) =>
                sum + (span.aiCall?.cost || 0), 0);
            trace.totalTokens = trace.spans.reduce((sum: number, span: any) =>
                sum + (span.aiCall?.totalTokens || 0), 0);

            // Perform analysis
            const analysis = await this.analyzeTrace(traceId, userId);

            // Update trace with analysis results
            trace.performance.criticalPath = analysis.criticalPath.spans;
            trace.performance.bottlenecks = analysis.criticalPath.bottlenecks.map(b => ({
                spanId: b.spanId,
                reason: `High latency: ${b.duration}ms (${b.percentage}% of total)`,
                impact: b.percentage / 100
            }));
            trace.performance.parallelizable = analysis.performance.parallelizationOpportunities;

            // Find cache opportunities
            const cacheOpportunities = this.findCacheOpportunities(trace);
            trace.performance.cacheOpportunities = cacheOpportunities;

            const completedTrace = await trace.save();

            // Log activity
            await ActivityService.trackActivity(userId, {
                type: 'trace_completed',
                title: `Completed trace: ${trace.name}`,
                description: `Trace completed with ${trace.callCount} spans, cost $${trace.totalCost.toFixed(6)}`,
                metadata: {
                    traceId,
                    duration: trace.duration,
                    totalCost: trace.totalCost,
                    totalTokens: trace.totalTokens,
                    spanCount: trace.callCount
                }
            });

            logger.info('Trace completed', {
                traceId,
                duration: trace.duration,
                cost: trace.totalCost,
                spanCount: trace.callCount
            });

            return completedTrace;
        } catch (error) {
            logger.error('Failed to complete trace', { error, traceId, userId });
            throw error;
        }
    }

    /**
     * Get traces with filtering and pagination
     */
    static async getTraces(
        userId: string,
        query: TraceQuery = {},
        pagination: PaginationOptions = { page: 1, limit: 20 }
    ): Promise<{ traces: ITrace[]; total: number; pages: number }> {
        try {
            const filter: any = { userId: new mongoose.Types.ObjectId(userId) };

            // Add query filters
            if (query.projectId) {
                filter.projectId = new mongoose.Types.ObjectId(query.projectId);
            }
            if (query.status) {
                filter.status = query.status;
            }
            if (query.startDate || query.endDate) {
                filter.startTime = {};
                if (query.startDate) filter.startTime.$gte = query.startDate;
                if (query.endDate) filter.startTime.$lte = query.endDate;
            }
            if (query.minCost !== undefined || query.maxCost !== undefined) {
                filter.totalCost = {};
                if (query.minCost !== undefined) filter.totalCost.$gte = query.minCost;
                if (query.maxCost !== undefined) filter.totalCost.$lte = query.maxCost;
            }
            if (query.provider) {
                filter['dependencies.providers'] = query.provider;
            }
            if (query.model) {
                filter['dependencies.models'] = query.model;
            }
            if (query.tags && query.tags.length > 0) {
                filter['metadata.tags'] = { $in: query.tags };
            }
            if (query.search) {
                filter.$or = [
                    { name: { $regex: query.search, $options: 'i' } },
                    { traceId: { $regex: query.search, $options: 'i' } }
                ];
            }

            const page = pagination.page || 1;
            const limit = pagination.limit || 20;
            const skip = (page - 1) * limit;

            const [traces, total] = await Promise.all([
                Trace.find(filter)
                    .populate('projectId', 'name')
                    .sort({ startTime: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Trace.countDocuments(filter)
            ]);

            return {
                traces: traces as ITrace[],
                total,
                pages: Math.ceil(total / limit)
            };
        } catch (error) {
            logger.error('Failed to get traces', { error, userId, query });
            throw error;
        }
    }

    /**
     * Get a single trace by ID
     */
    static async getTrace(traceId: string, userId: string): Promise<ITrace | null> {
        try {
            const trace = await Trace.findOne({ traceId, userId })
                .populate('projectId', 'name')
                .lean();

            return trace;
        } catch (error) {
            logger.error('Failed to get trace', { error, traceId, userId });
            throw error;
        }
    }

    /**
     * Analyze a trace for performance insights
     */
    static async analyzeTrace(traceId: string, userId: string): Promise<TraceAnalysis> {
        try {
            const trace = await this.getTrace(traceId, userId);
            if (!trace) {
                throw new Error('Trace not found');
            }

            // Calculate critical path
            const criticalPath = this.calculateCriticalPath(trace);

            // Build dependency graph
            const dependencies = this.buildDependencyGraph(trace);

            // Calculate performance metrics
            const performance = this.calculatePerformanceMetrics(trace);

            // Generate optimization suggestions
            const optimizations = this.generateTraceOptimizationSuggestions(trace);

            return {
                criticalPath,
                dependencies,
                performance,
                optimizations
            };
        } catch (error) {
            logger.error('Failed to analyze trace', { error, traceId, userId });
            throw error;
        }
    }

    /**
     * Analyze trace performance and generate optimization insights
     */
    static async analyzePerformance(
        traceId: string,
        userId: string
    ): Promise<PerformanceInsights> {
        try {
            const trace = await this.getTrace(traceId, userId);
            if (!trace) {
                throw new Error('Trace not found');
            }

            logger.info('Starting performance analysis', { traceId, userId });

            const insights: PerformanceInsights = {
                traceId,
                analysisTime: new Date(),
                summary: {
                    totalDuration: trace.duration || 0,
                    totalCost: trace.totalCost,
                    totalTokens: trace.totalTokens,
                    spanCount: trace.spans.length,
                    aiCallCount: trace.spans.filter(s => s.operation === 'ai_call').length,
                    parallelizableSpans: 0,
                    cacheOpportunities: 0,
                    estimatedSavings: 0,
                    bottlenecks: 0
                },
                bottlenecks: [],
                optimizations: [],
                modelRecommendations: [],
                cacheAnalysis: {
                    totalPrompts: 0,
                    duplicatePrompts: 0,
                    cacheablePrompts: 0,
                    estimatedCacheSavings: { cost: 0, time: 0 },
                    recommendations: []
                }
            };

            // Analyze bottlenecks
            insights.bottlenecks = this.identifyBottlenecks(trace);
            insights.summary.bottlenecks = insights.bottlenecks.length;

            // Analyze parallelization opportunities
            const parallelizationAnalysis = this.analyzeParallelization(trace);
            insights.optimizations.push(...parallelizationAnalysis.optimizations);
            insights.summary.parallelizableSpans = parallelizationAnalysis.parallelizableSpans;

            // Analyze caching opportunities
            insights.cacheAnalysis = this.analyzeCaching(trace);
            insights.summary.cacheOpportunities = insights.cacheAnalysis.recommendations.length;

            // Analyze model optimization opportunities
            insights.modelRecommendations = this.analyzeModelOptimizations(trace);

            // Generate cost optimization suggestions
            const costOptimizations = this.generateCostOptimizations(trace);
            insights.optimizations.push(...costOptimizations);

            // Generate latency optimization suggestions
            const latencyOptimizations = this.generateLatencyOptimizations(trace);
            insights.optimizations.push(...latencyOptimizations);

            // Calculate total estimated savings
            insights.summary.estimatedSavings = insights.optimizations.reduce(
                (sum, opt) => sum + (opt.estimatedSavings.cost || 0), 0
            ) + insights.cacheAnalysis.estimatedCacheSavings.cost;

            logger.info('Performance analysis completed', {
                traceId,
                bottlenecks: insights.bottlenecks.length,
                optimizations: insights.optimizations.length,
                estimatedSavings: insights.summary.estimatedSavings
            });

            return insights;
        } catch (error) {
            logger.error('Failed to analyze performance', { error, traceId, userId });
            throw error;
        }
    }

    /**
     * Identify performance bottlenecks in a trace
     */
    private static identifyBottlenecks(trace: any): PerformanceInsights['bottlenecks'] {
        const bottlenecks: PerformanceInsights['bottlenecks'] = [];
        const aiSpans = trace.spans.filter((s: any) => s.operation === 'ai_call');

        if (aiSpans.length === 0) return bottlenecks;

        // Calculate percentiles for comparison
        const durations = aiSpans.map((s: any) => s.duration || 0).sort((a: number, b: number) => a - b);
        const costs = aiSpans.map((s: any) => s.aiCall?.cost || 0).sort((a: number, b: number) => a - b);

        const durationP95 = durations[Math.floor(durations.length * 0.95)];
        const costP95 = costs[Math.floor(costs.length * 0.95)];

        aiSpans.forEach((span: any) => {
            // High latency bottleneck
            if ((span.duration || 0) > durationP95 && (span.duration || 0) > 5000) {
                bottlenecks.push({
                    spanId: span.spanId,
                    name: span.name,
                    type: 'latency',
                    severity: (span.duration || 0) > 15000 ? 'critical' : 'high',
                    impact: ((span.duration || 0) / (trace.duration || 1)) * 100,
                    currentValue: span.duration || 0,
                    recommendedValue: Math.max(1000, (span.duration || 0) * 0.5),
                    description: `Span has high latency of ${span.duration}ms`,
                    solution: 'Consider model optimization, prompt reduction, or parallelization'
                });
            }

            // High cost bottleneck
            if ((span.aiCall?.cost || 0) > costP95 && (span.aiCall?.cost || 0) > 0.01) {
                bottlenecks.push({
                    spanId: span.spanId,
                    name: span.name,
                    type: 'cost',
                    severity: (span.aiCall?.cost || 0) > 0.1 ? 'critical' : 'high',
                    impact: ((span.aiCall?.cost || 0) / trace.totalCost) * 100,
                    currentValue: span.aiCall?.cost || 0,
                    description: `Span has high cost of $${span.aiCall?.cost?.toFixed(4)}`,
                    solution: 'Consider cheaper model, prompt optimization, or caching'
                });
            }

            // High token usage
            if ((span.aiCall?.totalTokens || 0) > 8000) {
                bottlenecks.push({
                    spanId: span.spanId,
                    name: span.name,
                    type: 'token_usage',
                    severity: (span.aiCall?.totalTokens || 0) > 15000 ? 'critical' : 'medium',
                    impact: ((span.aiCall?.totalTokens || 0) / trace.totalTokens) * 100,
                    currentValue: span.aiCall?.totalTokens || 0,
                    recommendedValue: Math.min(4000, (span.aiCall?.totalTokens || 0) * 0.7),
                    description: `Span uses ${span.aiCall?.totalTokens} tokens`,
                    solution: 'Optimize prompt length, use summarization, or split into smaller calls'
                });
            }

            // High retry count
            if ((span.aiCall?.retryCount || 0) > 2) {
                bottlenecks.push({
                    spanId: span.spanId,
                    name: span.name,
                    type: 'retry_count',
                    severity: 'medium',
                    impact: 20, // Assume 20% impact for retries
                    currentValue: span.aiCall?.retryCount || 0,
                    recommendedValue: 0,
                    description: `Span has ${span.aiCall?.retryCount} retries`,
                    solution: 'Improve error handling, validate inputs, or adjust model parameters'
                });
            }
        });

        return bottlenecks.sort((a, b) => b.impact - a.impact);
    }

    /**
     * Analyze parallelization opportunities
     */
    private static analyzeParallelization(trace: any): {
        parallelizableSpans: number;
        optimizations: PerformanceInsights['optimizations'];
    } {
        const optimizations: PerformanceInsights['optimizations'] = [];
        const spans = trace.spans;
        let parallelizableSpans = 0;

        // Find independent AI calls that could be parallelized
        const aiSpans = spans.filter((s: any) => s.operation === 'ai_call');
        const dependencyMap = new Map<string, string[]>();

        // Build dependency graph
        aiSpans.forEach((span: any) => {
            const dependencies = span.relationships?.dependencies || [];
            dependencyMap.set(span.spanId, dependencies);
        });

        // Find groups of independent spans
        const independentGroups: string[][] = [];
        const processed = new Set<string>();

        aiSpans.forEach((span: any) => {
            if (processed.has(span.spanId)) return;

            const group = this.findIndependentSpans(span.spanId, dependencyMap, aiSpans);
            if (group.length > 1) {
                independentGroups.push(group);
                group.forEach(spanId => processed.add(spanId));
                parallelizableSpans += group.length;
            }
        });

        // Generate parallelization optimizations
        independentGroups.forEach(group => {
            const groupSpans = aiSpans.filter((s: any) => group.includes(s.spanId));
            const totalDuration = groupSpans.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
            const maxDuration = Math.max(...groupSpans.map((s: any) => s.duration || 0));
            const timeSavings = totalDuration - maxDuration;

            optimizations.push({
                type: 'parallelization',
                priority: timeSavings > 5000 ? 'high' : 'medium',
                estimatedSavings: {
                    cost: 0,
                    time: timeSavings
                },
                effort: 'medium',
                description: `Parallelize ${group.length} independent AI calls`,
                implementation: 'Use Promise.all() or async execution to run these calls concurrently',
                affectedSpans: group,
                confidence: 0.8
            });
        });

        return { parallelizableSpans, optimizations };
    }

    /**
     * Find independent spans for parallelization
     */
    private static findIndependentSpans(
        startSpanId: string,
        dependencyMap: Map<string, string[]>,
        allSpans: any[]
    ): string[] {
        const group = [startSpanId];
        const visited = new Set([startSpanId]);

        // Find all spans with no dependencies on each other
        allSpans.forEach(span => {
            if (visited.has(span.spanId)) return;

            const dependencies = dependencyMap.get(span.spanId) || [];
            const hasGroupDependency = dependencies.some(dep => group.includes(dep));
            const groupHasDependencyOnSpan = group.some(groupSpanId => {
                const groupDeps = dependencyMap.get(groupSpanId) || [];
                return groupDeps.includes(span.spanId);
            });

            if (!hasGroupDependency && !groupHasDependencyOnSpan) {
                group.push(span.spanId);
                visited.add(span.spanId);
            }
        });

        return group;
    }

    /**
     * Analyze caching opportunities
     */
    private static analyzeCaching(trace: any): PerformanceInsights['cacheAnalysis'] {
        const aiSpans = trace.spans.filter((s: any) => s.operation === 'ai_call');
        const promptHashes = new Map<string, { count: number; spans: any[]; cost: number }>();

        // Group spans by prompt hash
        aiSpans.forEach((span: any) => {
            const hash = span.aiCall?.promptHash;
            if (!hash) return;

            if (!promptHashes.has(hash)) {
                promptHashes.set(hash, { count: 0, spans: [], cost: 0 });
            }

            const entry = promptHashes.get(hash)!;
            entry.count++;
            entry.spans.push(span);
            entry.cost += span.aiCall?.cost || 0;
        });

        // Find cacheable prompts (repeated more than once)
        const duplicatePrompts = Array.from(promptHashes.entries())
            .filter(([_, data]) => data.count > 1);

        const totalCacheSavings = duplicatePrompts.reduce(
            (sum, [_, data]) => sum + (data.cost * (data.count - 1)), 0
        );

        const timeEstimate = duplicatePrompts.reduce(
            (sum, [_, data]) => {
                const avgDuration = data.spans.reduce((s: number, span: any) => s + (span.duration || 0), 0) / data.spans.length;
                return sum + (avgDuration * (data.count - 1));
            }, 0
        );

        return {
            totalPrompts: promptHashes.size,
            duplicatePrompts: duplicatePrompts.length,
            cacheablePrompts: duplicatePrompts.length,
            estimatedCacheSavings: {
                cost: totalCacheSavings,
                time: timeEstimate
            },
            recommendations: duplicatePrompts.map(([hash, data]) => ({
                promptHash: hash,
                frequency: data.count,
                estimatedSavings: data.cost * (data.count - 1),
                spanIds: data.spans.map(s => s.spanId)
            })).sort((a, b) => b.estimatedSavings - a.estimatedSavings)
        };
    }

    /**
     * Analyze model optimization opportunities
     */
    private static analyzeModelOptimizations(trace: any): PerformanceInsights['modelRecommendations'] {
        const recommendations: PerformanceInsights['modelRecommendations'] = [];
        const aiSpans = trace.spans.filter((s: any) => s.operation === 'ai_call');

        // Model substitution opportunities
        const modelUsage = new Map<string, { spans: any[]; cost: number; avgLatency: number }>();

        aiSpans.forEach((span: any) => {
            const model = span.aiCall?.model;
            if (!model) return;

            if (!modelUsage.has(model)) {
                modelUsage.set(model, { spans: [], cost: 0, avgLatency: 0 });
            }

            const entry = modelUsage.get(model)!;
            entry.spans.push(span);
            entry.cost += span.aiCall?.cost || 0;
            entry.avgLatency += span.duration || 0;
        });

        // Calculate average latency for each model
        modelUsage.forEach((data) => {
            data.avgLatency = data.avgLatency / data.spans.length;
        });

        // Suggest cheaper alternatives for expensive models
        modelUsage.forEach((data, currentModel) => {
            if (currentModel.includes('gpt-4') && data.cost > 0.01) {
                recommendations.push({
                    currentModel,
                    recommendedModel: 'gpt-3.5-turbo',
                    reason: 'Significant cost savings with minimal quality trade-off for most tasks',
                    estimatedSavings: {
                        cost: data.cost * 0.7, // Approximate 70% savings
                        time: data.avgLatency * -0.2 // 20% faster
                    },
                    tradeoffs: ['Slightly lower reasoning capability', 'May require prompt adjustments'],
                    spanIds: data.spans.map(s => s.spanId)
                });
            }

            if (currentModel.includes('claude-3-opus') && data.cost > 0.01) {
                recommendations.push({
                    currentModel,
                    recommendedModel: 'claude-3-sonnet',
                    reason: 'Good balance of performance and cost',
                    estimatedSavings: {
                        cost: data.cost * 0.8, // Approximate 80% savings
                    },
                    tradeoffs: ['Reduced context window', 'Lower performance on complex reasoning'],
                    spanIds: data.spans.map(s => s.spanId)
                });
            }
        });

        return recommendations;
    }

    /**
     * Generate cost optimization suggestions
     */
    private static generateCostOptimizations(trace: any): PerformanceInsights['optimizations'] {
        const optimizations: PerformanceInsights['optimizations'] = [];
        const aiSpans = trace.spans.filter((s: any) => s.operation === 'ai_call');

        // High-cost spans that could benefit from optimization
        const expensiveSpans = aiSpans.filter((s: any) => (s.aiCall?.cost || 0) > 0.05);

        if (expensiveSpans.length > 0) {
            const totalExpensiveCost = expensiveSpans.reduce((sum: number, s: any) => sum + (s.aiCall?.cost || 0), 0);

            optimizations.push({
                type: 'prompt_optimization',
                priority: 'high',
                estimatedSavings: {
                    cost: totalExpensiveCost * 0.3, // 30% cost reduction
                    time: 0, // No time savings from prompt optimization
                    tokens: expensiveSpans.reduce((sum: number, span: any) => sum + (span.aiCall?.totalTokens || 0), 0) * 0.3
                },
                effort: 'medium',
                description: 'Optimize prompts for expensive AI calls',
                implementation: 'Reduce prompt length, use more specific instructions, implement prompt templates',
                affectedSpans: expensiveSpans.map((span: any) => span.spanId),
                confidence: 0.7
            });
        }

        return optimizations;
    }

    /**
     * Generate latency optimization suggestions
     */
    private static generateLatencyOptimizations(trace: any): PerformanceInsights['optimizations'] {
        const optimizations: PerformanceInsights['optimizations'] = [];
        const aiSpans = trace.spans.filter((s: any) => s.operation === 'ai_call');

        // High-latency spans
        const slowSpans = aiSpans.filter((s: any) => (s.duration || 0) > 10000);

        if (slowSpans.length > 0) {
            optimizations.push({
                type: 'model_substitution',
                priority: 'medium',
                estimatedSavings: {
                    cost: 0,
                    time: slowSpans.reduce((sum: number, s: any) => sum + (s.duration || 0), 0) * 0.4
                },
                effort: 'low',
                description: 'Use faster models for high-latency calls',
                implementation: 'Switch to streaming models or lighter variants for non-critical tasks',
                affectedSpans: slowSpans.map((span: any) => span.spanId),
                confidence: 0.6
            });
        }

        return optimizations;
    }

    /**
     * Generate optimization suggestions for a trace
     */
    static async generateOptimizationSuggestions(
        traceId: string,
        userId: string
    ): Promise<OptimizationSuggestion[]> {
        try {
            const insights = await this.analyzePerformance(traceId, userId);
            const suggestions: OptimizationSuggestion[] = [];

            // Convert insights to actionable suggestions
            insights.optimizations.forEach((opt, index) => {
                suggestions.push({
                    id: `${traceId}-opt-${index}`,
                    type: this.mapOptimizationType(opt.type),
                    title: this.generateOptimizationTitle(opt),
                    description: opt.description,
                    impact: opt.priority,
                    effort: opt.effort,
                    estimatedSavings: opt.estimatedSavings,
                    implementation: {
                        steps: this.generateImplementationSteps(opt),
                        codeExample: this.generateCodeExample(opt),
                        configChanges: this.generateConfigChanges(opt)
                    },
                    metrics: {
                        before: {
                            cost: opt.estimatedSavings.cost || 0,
                            time: opt.estimatedSavings.time || 0
                        },
                        after: {
                            cost: 0,
                            time: 0
                        }
                    }
                });
            });

            return suggestions;
        } catch (error) {
            logger.error('Failed to generate optimization suggestions', { error, traceId, userId });
            throw error;
        }
    }

    // Helper methods for suggestion generation
    private static mapOptimizationType(type: string): OptimizationSuggestion['type'] {
        const mapping: Record<string, OptimizationSuggestion['type']> = {
            'parallelization': 'latency',
            'caching': 'cost',
            'model_substitution': 'cost',
            'prompt_optimization': 'cost',
            'batch_processing': 'throughput'
        };
        return mapping[type] || 'cost';
    }

    private static generateOptimizationTitle(opt: any): string {
        const titles: Record<string, string> = {
            'parallelization': 'Parallelize Independent AI Calls',
            'caching': 'Implement Response Caching',
            'model_substitution': 'Switch to Faster/Cheaper Models',
            'prompt_optimization': 'Optimize Prompt Efficiency',
            'batch_processing': 'Implement Batch Processing'
        };
        return titles[opt.type] || 'Optimize AI Workflow';
    }

    private static generateImplementationSteps(opt: any): string[] {
        const steps: Record<string, string[]> = {
            'parallelization': [
                'Identify independent AI calls in your workflow',
                'Refactor sequential calls to use Promise.all() or similar',
                'Ensure proper error handling for concurrent operations',
                'Monitor performance improvements'
            ],
            'caching': [
                'Implement a caching layer (Redis, in-memory, etc.)',
                'Generate consistent cache keys from prompts',
                'Set appropriate TTL based on content freshness needs',
                'Monitor cache hit rates and adjust strategy'
            ],
            'model_substitution': [
                'Analyze quality requirements for each use case',
                'Test alternative models with sample inputs',
                'Implement model selection logic',
                'Monitor quality metrics after changes'
            ],
            'prompt_optimization': [
                'Analyze current prompt structure and length',
                'Remove unnecessary context and examples',
                'Use more specific and concise instructions',
                'Implement prompt templates for consistency'
            ]
        };
        return steps[opt.type] || ['Implement the suggested optimization'];
    }

    private static generateCodeExample(opt: any): string {
        const examples: Record<string, string> = {
            'parallelization': `
// Before: Sequential execution
const result1 = await aiCall1();
const result2 = await aiCall2();
const result3 = await aiCall3();

// After: Parallel execution
const [result1, result2, result3] = await Promise.all([
    aiCall1(),
    aiCall2(),
    aiCall3()
]);`,
            'caching': `
// Implement caching wrapper
const cachedAICall = async (prompt, params) => {
    const cacheKey = generateCacheKey(prompt, params);
    const cached = await cache.get(cacheKey);
    
    if (cached) return cached;
    
    const result = await aiCall(prompt, params);
    await cache.set(cacheKey, result, 3600); // 1 hour TTL
    return result;
};`
        };
        return examples[opt.type] || '';
    }

    private static generateConfigChanges(opt: any): Record<string, any> {
        const configs: Record<string, Record<string, any>> = {
            'model_substitution': {
                'models': {
                    'gpt-4': 'gpt-3.5-turbo',
                    'claude-3-opus': 'claude-3-sonnet'
                }
            },
            'caching': {
                'cache': {
                    'enabled': true,
                    'ttl': 3600,
                    'maxSize': 1000
                }
            }
        };
        return configs[opt.type] || {};
    }

    /**
     * Delete a trace
     */
    static async deleteTrace(traceId: string, userId: string): Promise<void> {
        try {
            const result = await Trace.deleteOne({ traceId, userId });
            if (result.deletedCount === 0) {
                throw new Error('Trace not found');
            }

            logger.info('Trace deleted', { traceId, userId });
        } catch (error) {
            logger.error('Failed to delete trace', { error, traceId, userId });
            throw error;
        }
    }

    /**
     * Get trace statistics for analytics
     */
    static async getTraceStats(
        userId: string,
        projectId?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<{
        totalTraces: number;
        totalCost: number;
        totalTokens: number;
        averageDuration: number;
        completedTraces: number;
        failedTraces: number;
        topProviders: Array<{ provider: string; count: number; cost: number }>;
        topModels: Array<{ model: string; count: number; cost: number }>;
    }> {
        try {
            const filter: any = { userId: new mongoose.Types.ObjectId(userId) };

            if (projectId) {
                filter.projectId = new mongoose.Types.ObjectId(projectId);
            }
            if (startDate || endDate) {
                filter.startTime = {};
                if (startDate) filter.startTime.$gte = startDate;
                if (endDate) filter.startTime.$lte = endDate;
            }

            const [stats] = await Trace.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        totalTraces: { $sum: 1 },
                        totalCost: { $sum: '$totalCost' },
                        totalTokens: { $sum: '$totalTokens' },
                        averageDuration: { $avg: '$duration' },
                        completedTraces: {
                            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                        },
                        failedTraces: {
                            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                        }
                    }
                }
            ]);

            // Get provider statistics
            const providerStats = await Trace.aggregate([
                { $match: filter },
                { $unwind: '$dependencies.providers' },
                {
                    $group: {
                        _id: '$dependencies.providers',
                        count: { $sum: 1 },
                        cost: { $sum: '$totalCost' }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 5 },
                {
                    $project: {
                        provider: '$_id',
                        count: 1,
                        cost: 1,
                        _id: 0
                    }
                }
            ]);

            // Get model statistics
            const modelStats = await Trace.aggregate([
                { $match: filter },
                { $unwind: '$dependencies.models' },
                {
                    $group: {
                        _id: '$dependencies.models',
                        count: { $sum: 1 },
                        cost: { $sum: '$totalCost' }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 5 },
                {
                    $project: {
                        model: '$_id',
                        count: 1,
                        cost: 1,
                        _id: 0
                    }
                }
            ]);

            return {
                totalTraces: stats?.totalTraces || 0,
                totalCost: stats?.totalCost || 0,
                totalTokens: stats?.totalTokens || 0,
                averageDuration: stats?.averageDuration || 0,
                completedTraces: stats?.completedTraces || 0,
                failedTraces: stats?.failedTraces || 0,
                topProviders: providerStats,
                topModels: modelStats
            };
        } catch (error) {
            logger.error('Failed to get trace stats', { error, userId, projectId });
            throw error;
        }
    }

    /**
     * Replay a trace for time-travel debugging
     */
    static async replayTrace(
        traceId: string,
        userId: string,
        replayRequest: TraceReplayRequest = {}
    ): Promise<TraceReplayResult> {
        try {
            const originalTrace = await this.getTrace(traceId, userId);
            if (!originalTrace) {
                throw new Error('Original trace not found');
            }

            const replayId = uuidv4();
            logger.info('Starting trace replay', {
                traceId,
                replayId,
                userId,
                config: replayRequest
            });

            // Create a new trace for the replay
            const replayTrace = await this.createTrace(userId, {
                name: `REPLAY: ${originalTrace.name}`,
                projectId: originalTrace.projectId?.toString(),
                metadata: {
                    ...originalTrace.metadata,
                    customAttributes: {
                        ...originalTrace.metadata?.customAttributes,
                        replayOf: traceId,
                        replayId,
                        replayConfig: replayRequest
                    }
                }
            });

            const replayResult: TraceReplayResult = {
                replayId,
                originalTraceId: traceId,
                status: 'running',
                startTime: new Date(),
                spanResults: [],
                summary: {
                    totalSpans: originalTrace.spans.length,
                    replayableSpans: 0,
                    successfulReplays: 0,
                    failedReplays: 0,
                    significantDifferences: 0,
                    totalCostOriginal: originalTrace.totalCost,
                    totalCostReplay: 0
                }
            };

            // Replay spans in chronological order
            const sortedSpans = [...originalTrace.spans].sort((a, b) =>
                new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            );

            for (const originalSpan of sortedSpans) {
                try {
                    const replaySpanResult = await this.replaySpan(
                        originalSpan,
                        replayTrace.traceId,
                        replayRequest
                    );

                    replayResult.spanResults.push(replaySpanResult);

                    if (replaySpanResult.replayable) {
                        replayResult.summary.replayableSpans++;
                        if (replaySpanResult.status === 'success') {
                            replayResult.summary.successfulReplays++;
                        } else if (replaySpanResult.status === 'failed') {
                            replayResult.summary.failedReplays++;
                        }

                        if (replaySpanResult.differences?.some(d => d.significant)) {
                            replayResult.summary.significantDifferences++;
                        }
                    }
                } catch (error) {
                    logger.error('Failed to replay span', {
                        spanId: originalSpan.spanId,
                        error: error instanceof Error ? error.message : String(error)
                    });

                    replayResult.spanResults.push({
                        originalSpanId: originalSpan.spanId,
                        replaySpanId: '',
                        status: 'failed',
                        replayable: false,
                        error: error instanceof Error ? error.message : String(error),
                        performance: {
                            originalDuration: originalSpan.duration || 0,
                            replayDuration: 0,
                            comparison: 0
                        }
                    });
                }
            }

            // Complete the replay trace
            const updatedTrace = await Trace.findOne({ traceId: replayTrace.traceId, userId: new mongoose.Types.ObjectId(userId) });
            if (updatedTrace) {
                updatedTrace.status = 'completed';
                updatedTrace.endTime = new Date();
                updatedTrace.duration = updatedTrace.endTime.getTime() - updatedTrace.startTime.getTime();

                // Calculate totals
                updatedTrace.totalCost = updatedTrace.spans.reduce((sum: number, span: any) =>
                    sum + (span.aiCall?.cost || 0), 0);
                updatedTrace.totalTokens = updatedTrace.spans.reduce((sum: number, span: any) =>
                    sum + (span.aiCall?.totalTokens || 0), 0);

                await updatedTrace.save();
                replayResult.summary.totalCostReplay = updatedTrace.totalCost;
            }
            replayResult.status = 'completed';
            replayResult.endTime = new Date();

            logger.info('Trace replay completed', {
                replayId,
                summary: replayResult.summary
            });

            return replayResult;
        } catch (error) {
            logger.error('Failed to replay trace', { error, traceId, userId });
            throw error;
        }
    }

    /**
     * Replay a single span
     */
    private static async replaySpan(
        originalSpan: ITraceSpan,
        replayTraceId: string,
        replayRequest: TraceReplayRequest
    ): Promise<TraceReplayResult['spanResults'][0]> {
        const startTime = Date.now();

        // Check if span is replayable
        if (!originalSpan.aiCall || originalSpan.operation !== 'ai_call') {
            return {
                originalSpanId: originalSpan.spanId,
                replaySpanId: '',
                status: 'skipped',
                replayable: false,
                performance: {
                    originalDuration: originalSpan.duration || 0,
                    replayDuration: 0,
                    comparison: 0
                }
            };
        }

        try {
            const replaySpanId = uuidv4();

            // Prepare replay parameters
            let replayModel = originalSpan.aiCall.model;
            if (replayRequest.targetModels?.[originalSpan.aiCall.model]) {
                replayModel = replayRequest.targetModels[originalSpan.aiCall.model];
            }

            const replayPrompt = replayRequest.preservePrompts !== false
                ? originalSpan.aiCall.prompt
                : originalSpan.aiCall.prompt;

            const replayParameters = replayRequest.preserveParameters !== false
                ? originalSpan.aiCall.parameters
                : { ...originalSpan.aiCall.parameters };

            // Simulate AI call replay (in real implementation, make actual API call)
            const replayStartTime = new Date();
            const replayResponse = await this.simulateAICallReplay(
                originalSpan.aiCall.provider,
                replayModel,
                replayPrompt,
                replayParameters
            );
            const replayEndTime = new Date();
            const replayDuration = replayEndTime.getTime() - replayStartTime.getTime();

            // Add replay span to trace
            await this.addSpan(replayTraceId, 'system', {
                name: `REPLAY: ${originalSpan.name}`,
                operation: 'ai_call',
                parentSpanId: originalSpan.parentSpanId,
                aiCall: {
                    provider: originalSpan.aiCall.provider,
                    model: replayModel,
                    prompt: replayPrompt,
                    completion: replayResponse.completion,
                    promptTokens: replayResponse.promptTokens,
                    completionTokens: replayResponse.completionTokens,
                    totalTokens: replayResponse.totalTokens,
                    cost: replayResponse.cost,
                    parameters: replayParameters,
                    cacheHit: false,
                    retryCount: 0
                },
                performance: {
                    latency: replayDuration,
                    processingTime: replayDuration
                },
                tags: {
                    ...originalSpan.tags,
                    replay: 'true',
                    originalSpanId: originalSpan.spanId
                }
            });

            // Compare results
            const differences = this.compareSpanResults(originalSpan, {
                completion: replayResponse.completion,
                tokens: replayResponse.totalTokens,
                cost: replayResponse.cost,
                duration: replayDuration
            });

            const endTime = Date.now();
            const totalReplayTime = endTime - startTime;

            return {
                originalSpanId: originalSpan.spanId,
                replaySpanId,
                status: 'success',
                replayable: true,
                differences,
                performance: {
                    originalDuration: originalSpan.duration || 0,
                    replayDuration: totalReplayTime,
                    comparison: ((totalReplayTime - (originalSpan.duration || 0)) / (originalSpan.duration || 1)) * 100
                }
            };

        } catch (error) {
            return {
                originalSpanId: originalSpan.spanId,
                replaySpanId: '',
                status: 'failed',
                replayable: true,
                error: error instanceof Error ? error.message : String(error),
                performance: {
                    originalDuration: originalSpan.duration || 0,
                    replayDuration: Date.now() - startTime,
                    comparison: 0
                }
            };
        }
    }

    /**
     * Simulate AI call replay (replace with actual API calls in production)
     */
    private static async simulateAICallReplay(
        provider: string,
        model: string,
        prompt: string,
        _parameters: Record<string, any>
    ): Promise<{
        completion: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost: number;
    }> {
        // In a real implementation, this would make actual API calls
        // For simulation, we'll generate realistic-looking responses

        const promptTokens = Math.ceil(prompt.length / 4); // Rough token estimation
        const completionTokens = Math.floor(Math.random() * 500) + 50;
        const totalTokens = promptTokens + completionTokens;

        // Simulate cost calculation
        const costPerToken = this.getCostPerToken(provider, model);
        const cost = (promptTokens * costPerToken.input + completionTokens * costPerToken.output) / 1000000;

        // Simulate response time
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));

        return {
            completion: `Replayed response for prompt: ${prompt.substring(0, 50)}...`,
            promptTokens,
            completionTokens,
            totalTokens,
            cost
        };
    }

    /**
     * Compare original and replay span results
     */
    private static compareSpanResults(
        originalSpan: ITraceSpan,
        replayResult: {
            completion: string;
            tokens: number;
            cost: number;
            duration: number;
        }
    ): Array<{
        field: string;
        original: any;
        replay: any;
        significant: boolean;
    }> {
        const differences = [];

        // Compare completion length (tokens as proxy)
        const tokenDifference = Math.abs(
            (originalSpan.aiCall?.totalTokens || 0) - replayResult.tokens
        );
        if (tokenDifference > 0) {
            differences.push({
                field: 'tokens',
                original: originalSpan.aiCall?.totalTokens || 0,
                replay: replayResult.tokens,
                significant: tokenDifference > (originalSpan.aiCall?.totalTokens || 0) * 0.1 // 10% difference
            });
        }

        // Compare cost
        const costDifference = Math.abs((originalSpan.aiCall?.cost || 0) - replayResult.cost);
        if (costDifference > 0.001) { // $0.001 threshold
            differences.push({
                field: 'cost',
                original: originalSpan.aiCall?.cost || 0,
                replay: replayResult.cost,
                significant: costDifference > (originalSpan.aiCall?.cost || 0) * 0.2 // 20% difference
            });
        }

        // Compare duration
        const durationDifference = Math.abs((originalSpan.duration || 0) - replayResult.duration);
        if (durationDifference > 100) { // 100ms threshold
            differences.push({
                field: 'duration',
                original: originalSpan.duration || 0,
                replay: replayResult.duration,
                significant: durationDifference > (originalSpan.duration || 0) * 0.5 // 50% difference
            });
        }

        return differences;
    }

    /**
     * Get cost per token for provider/model
     */
    private static getCostPerToken(provider: string, model: string): { input: number; output: number } {
        // Default cost per token mapping (prices per million tokens)
        const costs: Record<string, Record<string, { input: number; output: number }>> = {
            'openai': {
                'gpt-4o': { input: 2.5, output: 10.0 },
                'gpt-4o-mini': { input: 0.15, output: 0.6 },
                'gpt-4-turbo': { input: 10.0, output: 30.0 },
                'gpt-4': { input: 30.0, output: 60.0 },
                'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
                'default': { input: 1.0, output: 2.0 }
            },
            'anthropic': {
                'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
                'claude-3-opus': { input: 15.0, output: 75.0 },
                'claude-3-sonnet': { input: 3.0, output: 15.0 },
                'claude-3-haiku': { input: 0.25, output: 1.25 },
                'default': { input: 3.0, output: 15.0 }
            },
            'google': {
                'gemini-1.5-pro': { input: 1.25, output: 5.0 },
                'gemini-1.5-flash': { input: 0.075, output: 0.3 },
                'gemini-1.0-pro': { input: 0.5, output: 1.5 },
                'default': { input: 0.5, output: 1.5 }
            },
            'default': {
                'default': { input: 1.0, output: 2.0 }
            }
        };

        return costs[provider]?.[model] || costs[provider]?.['default'] || costs['default']['default'];
    }

    /**
     * Get replay history for a trace
     */
    static async getReplayHistory(
        traceId: string,
        userId: string
    ): Promise<Array<{
        replayId: string;
        replayTime: Date;
        status: string;
        summary: TraceReplayResult['summary'];
    }>> {
        try {
            // Find all replay traces for this original trace
            const replayTraces = await Trace.find({
                userId: new mongoose.Types.ObjectId(userId),
                'metadata.replayOf': traceId
            }).sort({ createdAt: -1 });

            return replayTraces.map(trace => ({
                replayId: trace.metadata.replayId || trace.traceId,
                replayTime: trace.createdAt,
                status: trace.status,
                summary: {
                    totalSpans: trace.spans.length,
                    replayableSpans: trace.spans.filter(s => s.operation === 'ai_call').length,
                    successfulReplays: trace.spans.filter(s => s.status === 'completed').length,
                    failedReplays: trace.spans.filter(s => s.status === 'failed').length,
                    significantDifferences: 0, // Would need to calculate from span metadata
                    totalCostOriginal: 0, // Would need to fetch from original trace
                    totalCostReplay: trace.totalCost
                }
            }));
        } catch (error) {
            logger.error('Failed to get replay history', { error, traceId, userId });
            throw error;
        }
    }

    // Private helper methods

    private static generatePromptHash(prompt: string): string {
        // Simple hash function for prompt caching
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(prompt).digest('hex');
    }

    private static calculateCriticalPath(trace: ITrace): {
        spans: string[];
        totalDuration: number;
        bottlenecks: Array<{ spanId: string; duration: number; percentage: number }>;
    } {
        const spans = trace.spans;
        if (spans.length === 0) {
            return { spans: [], totalDuration: 0, bottlenecks: [] };
        }

        // Build dependency graph
        const graph: Record<string, string[]> = {};
        const inDegree: Record<string, number> = {};
        const spanDurations: Record<string, number> = {};

        spans.forEach(span => {
            graph[span.spanId] = span.relationships.children;
            inDegree[span.spanId] = 0;
            spanDurations[span.spanId] = span.duration || 0;
        });

        spans.forEach(span => {
            span.relationships.children.forEach(childId => {
                inDegree[childId] = (inDegree[childId] || 0) + 1;
            });
        });

        // Find critical path using longest path algorithm
        const dist: Record<string, number> = {};
        const parent: Record<string, string | null> = {};

        spans.forEach(span => {
            dist[span.spanId] = -Infinity;
            parent[span.spanId] = null;
        });

        // Start from root spans (inDegree 0)
        const queue: string[] = [];
        spans.forEach(span => {
            if (inDegree[span.spanId] === 0) {
                dist[span.spanId] = spanDurations[span.spanId];
                queue.push(span.spanId);
            }
        });

        // Process spans in topological order
        while (queue.length > 0) {
            const u = queue.shift()!;

            graph[u]?.forEach(v => {
                if (dist[u] + spanDurations[v] > dist[v]) {
                    dist[v] = dist[u] + spanDurations[v];
                    parent[v] = u;
                }

                inDegree[v]--;
                if (inDegree[v] === 0) {
                    queue.push(v);
                }
            });
        }

        // Find the span with maximum distance (end of critical path)
        let maxDist = -Infinity;
        let endSpan = '';
        Object.entries(dist).forEach(([spanId, distance]) => {
            if (distance > maxDist) {
                maxDist = distance;
                endSpan = spanId;
            }
        });

        // Reconstruct critical path
        const criticalPath: string[] = [];
        let current: string | null = endSpan;
        while (current) {
            criticalPath.unshift(current);
            current = parent[current];
        }

        // Find bottlenecks (spans taking > 20% of total time)
        const totalDuration = maxDist;
        const bottlenecks = spans
            .filter(span => span.duration && span.duration > totalDuration * 0.2)
            .map(span => ({
                spanId: span.spanId,
                duration: span.duration!,
                percentage: (span.duration! / totalDuration) * 100
            }))
            .sort((a, b) => b.duration - a.duration);

        return {
            spans: criticalPath,
            totalDuration,
            bottlenecks
        };
    }

    private static buildDependencyGraph(trace: ITrace): {
        graph: Record<string, string[]>;
        services: string[];
        models: string[];
        providers: string[];
    } {
        const graph: Record<string, string[]> = {};

        trace.spans.forEach(span => {
            graph[span.spanId] = span.relationships.children;
        });

        return {
            graph,
            services: trace.dependencies.services,
            models: trace.dependencies.models,
            providers: trace.dependencies.providers
        };
    }

    private static calculatePerformanceMetrics(trace: ITrace): {
        totalCost: number;
        totalTokens: number;
        averageLatency: number;
        cacheHitRate: number;
        errorRate: number;
        parallelizationOpportunities: string[];
    } {
        const aiSpans = trace.spans.filter(s => s.operation === 'ai_call' && s.aiCall);
        const totalSpans = trace.spans.length;

        const totalLatency = trace.spans.reduce((sum, span) =>
            sum + (span.performance?.latency || 0), 0);
        const averageLatency = totalSpans > 0 ? totalLatency / totalSpans : 0;

        const cacheHits = aiSpans.filter(s => s.aiCall?.cacheHit).length;
        const cacheHitRate = aiSpans.length > 0 ? cacheHits / aiSpans.length : 0;

        const errors = trace.spans.filter(s => s.status === 'failed').length;
        const errorRate = totalSpans > 0 ? errors / totalSpans : 0;

        // Find parallelization opportunities (spans that could run in parallel)
        const parallelizationOpportunities = this.findParallelizationOpportunities(trace);

        return {
            totalCost: trace.totalCost,
            totalTokens: trace.totalTokens,
            averageLatency,
            cacheHitRate,
            errorRate,
            parallelizationOpportunities
        };
    }

    private static findParallelizationOpportunities(trace: ITrace): string[] {
        const opportunities: string[] = [];

        // Find spans that have the same parent but don't depend on each other
        const spansByParent: Record<string, string[]> = {};

        trace.spans.forEach(span => {
            const parentId = span.parentSpanId || 'root';
            if (!spansByParent[parentId]) {
                spansByParent[parentId] = [];
            }
            spansByParent[parentId].push(span.spanId);
        });

        Object.entries(spansByParent).forEach(([_parentId, children]) => {
            if (children.length > 1) {
                // Check if these spans could run in parallel
                const canParallelize = children.every(childId => {
                    const child = trace.spans.find(s => s.spanId === childId);
                    return child && child.relationships.dependencies.length === 0;
                });

                if (canParallelize) {
                    opportunities.push(...children);
                }
            }
        });

        return opportunities;
    }

    private static generateTraceOptimizationSuggestions(trace: ITrace): Array<{
        type: 'parallelization' | 'caching' | 'model_optimization' | 'prompt_optimization';
        description: string;
        estimatedSavings: number;
        confidence: number;
        spans: string[];
    }> {
        const suggestions: Array<{
            type: 'parallelization' | 'caching' | 'model_optimization' | 'prompt_optimization';
            description: string;
            estimatedSavings: number;
            confidence: number;
            spans: string[];
        }> = [];

        // Check for parallelization opportunities
        const parallelizable = this.findParallelizationOpportunities(trace);
        if (parallelizable.length > 1) {
            const estimatedSavings = parallelizable.length * 0.1 * trace.totalCost; // Estimate 10% savings per parallelizable span
            suggestions.push({
                type: 'parallelization',
                description: `${parallelizable.length} spans could potentially run in parallel`,
                estimatedSavings,
                confidence: 0.7,
                spans: parallelizable
            });
        }

        // Check for caching opportunities
        const cacheOpportunities = this.findCacheOpportunities(trace);
        if (cacheOpportunities.length > 0) {
            const totalSavings = cacheOpportunities.reduce((sum, opp) => sum + opp.estimatedSavings, 0);
            suggestions.push({
                type: 'caching',
                description: `${cacheOpportunities.length} repeated prompts could be cached`,
                estimatedSavings: totalSavings,
                confidence: 0.9,
                spans: cacheOpportunities.map(opp => opp.spanId)
            });
        }

        // Check for expensive models that could be optimized
        const expensiveSpans = trace.spans.filter(span =>
            span.aiCall && span.aiCall.cost > 0.01
        );
        if (expensiveSpans.length > 0) {
            suggestions.push({
                type: 'model_optimization',
                description: `${expensiveSpans.length} spans use expensive models that could be optimized`,
                estimatedSavings: expensiveSpans.reduce((sum, span) => sum + (span.aiCall?.cost || 0) * 0.3, 0),
                confidence: 0.6,
                spans: expensiveSpans.map(span => span.spanId)
            });
        }

        return suggestions;
    }

    private static findCacheOpportunities(trace: ITrace): Array<{
        spanId: string;
        promptHash: string;
        estimatedSavings: number;
    }> {
        const promptCounts: Record<string, { count: number; cost: number; spans: string[] }> = {};

        trace.spans.forEach(span => {
            if (span.aiCall?.promptHash) {
                const hash = span.aiCall.promptHash;
                if (!promptCounts[hash]) {
                    promptCounts[hash] = { count: 0, cost: 0, spans: [] };
                }
                promptCounts[hash].count++;
                promptCounts[hash].cost += span.aiCall.cost || 0;
                promptCounts[hash].spans.push(span.spanId);
            }
        });

        const opportunities: Array<{
            spanId: string;
            promptHash: string;
            estimatedSavings: number;
        }> = [];

        Object.entries(promptCounts).forEach(([hash, data]) => {
            if (data.count > 1) {
                // Could save cost of all but the first call
                const savings = data.cost * (data.count - 1) / data.count;
                data.spans.forEach(spanId => {
                    opportunities.push({
                        spanId,
                        promptHash: hash,
                        estimatedSavings: savings / data.spans.length
                    });
                });
            }
        });

        return opportunities;
    }
} 