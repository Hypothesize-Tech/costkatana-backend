import { Response } from 'express';
import { TraceService, CreateTraceRequest, AddSpanRequest, TraceQuery, TraceReplayRequest } from '../services/trace.service';
import { logger } from '../utils/logger';
import { validationResult } from 'express-validator';

export class TraceController {
    /**
     * Create a new trace
     * POST /api/traces
     */
    static async createTrace(req: any, res: Response): Promise<void> {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors.array()
                });
                return;
            }

            const userId = req.user!.id;
            const request: CreateTraceRequest = {
                name: req.body.name,
                projectId: req.body.projectId,
                metadata: req.body.metadata
            };

            const trace = await TraceService.createTrace(userId, request);

            res.status(201).json({
                success: true,
                message: 'Trace created successfully',
                data: {
                    traceId: trace.traceId,
                    name: trace.name,
                    status: trace.status,
                    startTime: trace.startTime
                }
            });
        } catch (error) {
            logger.error('Error creating trace', { error, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to create trace',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get traces with filtering and pagination
     * GET /api/traces
     */
    static async getTraces(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const query: TraceQuery = {};

            if (req.query.projectId) query.projectId = req.query.projectId as string;
            if (req.query.status) query.status = req.query.status as string;
            if (req.query.search) query.search = req.query.search as string;
            if (req.query.provider) query.provider = req.query.provider as string;
            if (req.query.model) query.model = req.query.model as string;
            if (req.query.minCost) query.minCost = parseFloat(req.query.minCost as string);
            if (req.query.maxCost) query.maxCost = parseFloat(req.query.maxCost as string);
            if (req.query.tags) {
                query.tags = Array.isArray(req.query.tags)
                    ? req.query.tags as string[]
                    : [req.query.tags as string];
            }
            if (req.query.startDate) {
                query.startDate = new Date(req.query.startDate as string);
            }
            if (req.query.endDate) {
                query.endDate = new Date(req.query.endDate as string);
            }

            const result = await TraceService.getTraces(userId, query, { page, limit });

            res.json({
                success: true,
                data: result.traces,
                pagination: {
                    page,
                    limit,
                    total: result.total,
                    pages: result.pages
                }
            });
        } catch (error) {
            logger.error('Error getting traces', { error, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to get traces',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get a single trace by ID
     * GET /api/traces/:traceId
     */
    static async getTrace(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user!.id;

            const trace = await TraceService.getTrace(traceId, userId);

            if (!trace) {
                res.status(404).json({
                    success: false,
                    message: 'Trace not found'
                });
                return;
            }

            res.json({
                success: true,
                data: trace
            });
        } catch (error) {
            logger.error('Error getting trace', { error, traceId: req.params.traceId, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to get trace',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Add a span to a trace
     * POST /api/traces/:traceId/spans
     */
    static async addSpan(req: any, res: Response): Promise<void> {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors.array()
                });
                return;
            }

            const { traceId } = req.params;
            const userId = req.user!.id;

            const spanRequest: AddSpanRequest = {
                name: req.body.name,
                operation: req.body.operation,
                parentSpanId: req.body.parentSpanId,
                aiCall: req.body.aiCall,
                performance: req.body.performance,
                tags: req.body.tags,
                error: req.body.error
            };

            const updatedTrace = await TraceService.addSpan(traceId, userId, spanRequest);

            res.status(201).json({
                success: true,
                message: 'Span added successfully',
                data: {
                    traceId: updatedTrace.traceId,
                    spanCount: updatedTrace.spans.length,
                    lastSpan: updatedTrace.spans[updatedTrace.spans.length - 1]
                }
            });
        } catch (error) {
            logger.error('Error adding span', { error, traceId: req.params.traceId, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to add span',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Complete a span
     * PUT /api/traces/:traceId/spans/:spanId/complete
     */
    static async completeSpan(req: any, res: Response): Promise<void> {
        try {
            const { traceId, spanId } = req.params;
            const userId = req.user!.id;

            const completion = {
                endTime: req.body.endTime ? new Date(req.body.endTime) : undefined,
                duration: req.body.duration,
                aiCall: req.body.aiCall,
                logs: req.body.logs
            };

            const updatedTrace = await TraceService.completeSpan(traceId, spanId, userId, completion);

            res.json({
                success: true,
                message: 'Span completed successfully',
                data: {
                    traceId: updatedTrace.traceId,
                    spanId,
                    status: 'completed'
                }
            });
        } catch (error) {
            logger.error('Error completing span', {
                error,
                traceId: req.params.traceId,
                spanId: req.params.spanId,
                userId: req.user?.id
            });
            res.status(500).json({
                success: false,
                message: 'Failed to complete span',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Complete a trace
     * PUT /api/traces/:traceId/complete
     */
    static async completeTrace(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user!.id;

            const completedTrace = await TraceService.completeTrace(traceId, userId);

            res.json({
                success: true,
                message: 'Trace completed successfully',
                data: {
                    traceId: completedTrace.traceId,
                    status: completedTrace.status,
                    duration: completedTrace.duration,
                    totalCost: completedTrace.totalCost,
                    totalTokens: completedTrace.totalTokens,
                    spanCount: completedTrace.callCount,
                    performance: completedTrace.performance
                }
            });
        } catch (error) {
            logger.error('Error completing trace', { error, traceId: req.params.traceId, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to complete trace',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Analyze a trace
     * GET /api/traces/:traceId/analysis
     */
    static async analyzeTrace(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user!.id;

            const analysis = await TraceService.analyzeTrace(traceId, userId);

            res.json({
                success: true,
                data: analysis
            });
        } catch (error) {
            logger.error('Error analyzing trace', { error, traceId: req.params.traceId, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to analyze trace',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Delete a trace
     * DELETE /api/traces/:traceId
     */
    static async deleteTrace(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user!.id;

            await TraceService.deleteTrace(traceId, userId);

            res.json({
                success: true,
                message: 'Trace deleted successfully'
            });
        } catch (error) {
            logger.error('Error deleting trace', { error, traceId: req.params.traceId, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to delete trace',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get trace statistics
     * GET /api/traces/stats
     */
    static async getTraceStats(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const projectId = req.query.projectId as string;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const stats = await TraceService.getTraceStats(userId, projectId, startDate, endDate);

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            logger.error('Error getting trace stats', { error, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to get trace statistics',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Search traces by prompt content
     * POST /api/traces/search
     */
    static async searchTraces(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const { promptText, model, provider, timeRange } = req.body;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            // Build search query
            const query: TraceQuery = {};

            if (model) query.model = model;
            if (provider) query.provider = provider;
            if (timeRange) {
                if (timeRange.start) query.startDate = new Date(timeRange.start);
                if (timeRange.end) query.endDate = new Date(timeRange.end);
            }

            // Use text search if provided
            if (promptText) {
                query.search = promptText;
            }

            const result = await TraceService.getTraces(userId, query, { page, limit });

            // If we have prompt text, further filter by span content
            let filteredTraces = result.traces;
            if (promptText) {
                filteredTraces = result.traces.filter(trace =>
                    trace.spans.some(span =>
                        span.aiCall?.prompt?.toLowerCase().includes(promptText.toLowerCase()) ||
                        span.aiCall?.completion?.toLowerCase().includes(promptText.toLowerCase())
                    )
                );
            }

            res.json({
                success: true,
                data: filteredTraces,
                pagination: {
                    page,
                    limit,
                    total: filteredTraces.length,
                    pages: Math.ceil(filteredTraces.length / limit)
                }
            });
        } catch (error) {
            logger.error('Error searching traces', { error, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to search traces',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get trace performance insights
     * GET /api/traces/:traceId/insights
     */
    static async getTraceInsights(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user!.id;

            const trace = await TraceService.getTrace(traceId, userId);
            if (!trace) {
                res.status(404).json({
                    success: false,
                    message: 'Trace not found'
                });
                return;
            }

            // Generate insights
            const insights = {
                performance: {
                    totalDuration: trace.duration,
                    totalCost: trace.totalCost,
                    totalTokens: trace.totalTokens,
                    spanCount: trace.spans.length,
                    averageSpanDuration: trace.spans.length > 0
                        ? trace.spans.reduce((sum, span) => sum + (span.duration || 0), 0) / trace.spans.length
                        : 0
                },
                efficiency: {
                    cacheHitRate: trace.spans.filter(s => s.aiCall?.cacheHit).length /
                        Math.max(trace.spans.filter(s => s.operation === 'ai_call').length, 1),
                    errorRate: trace.spans.filter(s => s.status === 'failed').length / trace.spans.length,
                    parallelizationScore: trace.performance?.parallelizable?.length || 0
                },
                costs: {
                    breakdown: trace.spans
                        .filter(s => s.aiCall)
                        .map(s => ({
                            spanId: s.spanId,
                            name: s.name,
                            provider: s.aiCall!.provider,
                            model: s.aiCall!.model,
                            cost: s.aiCall!.cost,
                            tokens: s.aiCall!.totalTokens
                        }))
                        .sort((a, b) => b.cost - a.cost),
                    topExpensive: trace.spans
                        .filter(s => s.aiCall)
                        .sort((a, b) => (b.aiCall?.cost || 0) - (a.aiCall?.cost || 0))
                        .slice(0, 5)
                        .map(s => ({
                            spanId: s.spanId,
                            name: s.name,
                            cost: s.aiCall!.cost,
                            percentage: ((s.aiCall!.cost / trace.totalCost) * 100).toFixed(2)
                        }))
                },
                recommendations: trace.performance?.bottlenecks?.map(bottleneck => ({
                    type: 'performance',
                    description: `Span ${bottleneck.spanId} is a bottleneck: ${bottleneck.reason}`,
                    impact: bottleneck.impact,
                    action: 'Consider optimizing this operation or running it in parallel'
                })) || []
            };

            res.json({
                success: true,
                data: insights
            });
        } catch (error) {
            logger.error('Error getting trace insights', { error, traceId: req.params.traceId, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to get trace insights',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Export trace data
     * GET /api/traces/:traceId/export
     */
    static async exportTrace(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user!.id;
            const format = req.query.format as string || 'json';

            const trace = await TraceService.getTrace(traceId, userId);
            if (!trace) {
                res.status(404).json({
                    success: false,
                    message: 'Trace not found'
                });
                return;
            }

            if (format === 'json') {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="trace-${traceId}.json"`);
                res.json(trace);
            } else if (format === 'csv') {
                // Convert spans to CSV format
                const csvData = trace.spans.map(span => ({
                    spanId: span.spanId,
                    parentSpanId: span.parentSpanId,
                    name: span.name,
                    operation: span.operation,
                    startTime: span.startTime,
                    endTime: span.endTime,
                    duration: span.duration,
                    status: span.status,
                    provider: span.aiCall?.provider,
                    model: span.aiCall?.model,
                    promptTokens: span.aiCall?.promptTokens,
                    completionTokens: span.aiCall?.completionTokens,
                    totalTokens: span.aiCall?.totalTokens,
                    cost: span.aiCall?.cost,
                    latency: span.performance?.latency,
                    cacheHit: span.aiCall?.cacheHit,
                    error: span.error?.message
                }));

                const csvHeader = Object.keys(csvData[0] || {}).join(',');
                const csvRows = csvData.map(row => Object.values(row).join(','));
                const csv = [csvHeader, ...csvRows].join('\n');

                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="trace-${traceId}.csv"`);
                res.send(csv);
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Unsupported export format. Use json or csv.'
                });
            }
        } catch (error) {
            logger.error('Error exporting trace', { error, traceId: req.params.traceId, userId: req.user?.id });
            res.status(500).json({
                success: false,
                message: 'Failed to export trace',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Replay a trace for time-travel debugging
     */
    static async replayTrace(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const replayRequest: TraceReplayRequest = {
                preservePrompts: req.body.preservePrompts !== false,
                preserveParameters: req.body.preserveParameters !== false,
                allowModelSubstitution: req.body.allowModelSubstitution || false,
                compareOutputs: req.body.compareOutputs !== false,
                targetEnvironment: req.body.targetEnvironment,
                targetModels: req.body.targetModels || {}
            };

            const result = await TraceService.replayTrace(traceId, userId, replayRequest);

            logger.info('Trace replay initiated', {
                traceId,
                replayId: result.replayId,
                userId
            });

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            logger.error('Failed to replay trace', { error, traceId: req.params.traceId });
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to replay trace'
            });
        }
    }

    /**
     * Get replay history for a trace
     */
    static async getReplayHistory(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const history = await TraceService.getReplayHistory(traceId, userId);

            res.status(200).json({
                success: true,
                data: history
            });
        } catch (error) {
            logger.error('Failed to get replay history', { error, traceId: req.params.traceId });
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to get replay history'
            });
        }
    }

    /**
     * Get detailed replay comparison
     */
    static async getReplayComparison(req: any, res: Response): Promise<void> {
        try {
            const { traceId, replayId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            // Get original trace
            const originalTrace = await TraceService.getTrace(traceId, userId);
            if (!originalTrace) {
                res.status(404).json({
                    success: false,
                    message: 'Original trace not found'
                });
                return;
            }

            // Get replay trace by searching for the replay metadata
            const traces = await TraceService.getTraces(userId, {
                limit: 1
            });
            const replayTrace = traces.traces.find(t =>
                t.metadata.customAttributes?.replayId === replayId &&
                t.metadata.customAttributes?.replayOf === traceId
            );

            if (!replayTrace) {
                res.status(404).json({
                    success: false,
                    message: 'Replay trace not found'
                });
                return;
            }

            const comparison = {
                original: {
                    traceId: originalTrace.traceId,
                    name: originalTrace.name,
                    duration: originalTrace.duration,
                    totalCost: originalTrace.totalCost,
                    totalTokens: originalTrace.totalTokens,
                    spanCount: originalTrace.spans.length,
                    status: originalTrace.status
                },
                replay: {
                    traceId: replayTrace.traceId,
                    name: replayTrace.name,
                    duration: replayTrace.duration,
                    totalCost: replayTrace.totalCost,
                    totalTokens: replayTrace.totalTokens,
                    spanCount: replayTrace.spans.length,
                    status: replayTrace.status
                },
                differences: {
                    durationDiff: (replayTrace.duration || 0) - (originalTrace.duration || 0),
                    costDiff: replayTrace.totalCost - originalTrace.totalCost,
                    tokenDiff: replayTrace.totalTokens - originalTrace.totalTokens,
                    spanCountDiff: replayTrace.spans.length - originalTrace.spans.length
                },
                spanComparisons: originalTrace.spans.map(originalSpan => {
                    const replaySpan = replayTrace.spans.find(s =>
                        s.tags?.originalSpanId === originalSpan.spanId
                    );

                    return {
                        originalSpanId: originalSpan.spanId,
                        replaySpanId: replaySpan?.spanId || null,
                        name: originalSpan.name,
                        operation: originalSpan.operation,
                        matched: !!replaySpan,
                        original: {
                            duration: originalSpan.duration,
                            cost: originalSpan.aiCall?.cost || 0,
                            tokens: originalSpan.aiCall?.totalTokens || 0,
                            status: originalSpan.status
                        },
                        replay: replaySpan ? {
                            duration: replaySpan.duration,
                            cost: replaySpan.aiCall?.cost || 0,
                            tokens: replaySpan.aiCall?.totalTokens || 0,
                            status: replaySpan.status
                        } : null
                    };
                })
            };

            res.status(200).json({
                success: true,
                data: comparison
            });
        } catch (error) {
            logger.error('Failed to get replay comparison', { error });
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to get replay comparison'
            });
        }
    }

    /**
     * Cancel an ongoing replay
     */
    static async cancelReplay(req: any, res: Response): Promise<void> {
        try {
            const { replayId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            // Find and update the replay trace status
            const traces = await TraceService.getTraces(userId, {});
            const replayTrace = traces.traces.find(t =>
                t.metadata.customAttributes?.replayId === replayId
            );

            if (!replayTrace) {
                res.status(404).json({
                    success: false,
                    message: 'Replay not found'
                });
                return;
            }

            if (replayTrace.status === 'completed') {
                res.status(400).json({
                    success: false,
                    message: 'Replay already completed'
                });
                return;
            }

            // Update status to cancelled by completing the trace
            await TraceService.completeTrace(replayTrace.traceId, userId);

            logger.info('Replay cancelled', { replayId, userId });

            res.status(200).json({
                success: true,
                message: 'Replay cancelled successfully'
            });
        } catch (error) {
            logger.error('Failed to cancel replay', { error });
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to cancel replay'
            });
        }
    }

    /**
     * Analyze trace performance and get optimization insights
     */
    static async analyzePerformance(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const insights = await TraceService.analyzePerformance(traceId, userId);

            logger.info('Performance analysis completed', {
                traceId,
                bottlenecks: insights.bottlenecks.length,
                optimizations: insights.optimizations.length,
                estimatedSavings: insights.summary.estimatedSavings,
                userId
            });

            res.status(200).json({
                success: true,
                data: insights
            });
        } catch (error) {
            logger.error('Failed to analyze performance', { error, traceId: req.params.traceId });
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to analyze performance'
            });
        }
    }

    /**
     * Generate optimization suggestions for a trace
     */
    static async generateOptimizationSuggestions(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const suggestions = await TraceService.generateOptimizationSuggestions(traceId, userId);

            logger.info('Optimization suggestions generated', {
                traceId,
                suggestionCount: suggestions.length,
                userId
            });

            res.status(200).json({
                success: true,
                data: suggestions
            });
        } catch (error) {
            logger.error('Failed to generate optimization suggestions', { error, traceId: req.params.traceId });
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to generate optimization suggestions'
            });
        }
    }

    /**
     * Get performance benchmark comparison
     */
    static async getPerformanceBenchmark(req: any, res: Response): Promise<void> {
        try {
            const { traceId } = req.params;
            const { compareWith } = req.query;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const mainTrace = await TraceService.getTrace(traceId, userId);
            if (!mainTrace) {
                res.status(404).json({
                    success: false,
                    message: 'Trace not found'
                });
                return;
            }

            let comparison = null;
            if (compareWith && typeof compareWith === 'string') {
                const compareTrace = await TraceService.getTrace(compareWith, userId);
                if (compareTrace) {
                    comparison = {
                        baseline: {
                            traceId: mainTrace.traceId,
                            duration: mainTrace.duration,
                            cost: mainTrace.totalCost,
                            tokens: mainTrace.totalTokens,
                            spanCount: mainTrace.spans.length
                        },
                        comparison: {
                            traceId: compareTrace.traceId,
                            duration: compareTrace.duration,
                            cost: compareTrace.totalCost,
                            tokens: compareTrace.totalTokens,
                            spanCount: compareTrace.spans.length
                        },
                        improvements: {
                            durationImprovement: ((mainTrace.duration || 0) - (compareTrace.duration || 0)) / (mainTrace.duration || 1) * 100,
                            costImprovement: (mainTrace.totalCost - compareTrace.totalCost) / mainTrace.totalCost * 100,
                            tokenImprovement: (mainTrace.totalTokens - compareTrace.totalTokens) / mainTrace.totalTokens * 100
                        }
                    };
                }
            }

            // Get industry benchmarks or averages (simplified for demo)
            const benchmark = {
                traceId: mainTrace.traceId,
                metrics: {
                    duration: mainTrace.duration,
                    cost: mainTrace.totalCost,
                    tokens: mainTrace.totalTokens,
                    spanCount: mainTrace.spans.length,
                    aiCallCount: mainTrace.spans.filter(s => s.operation === 'ai_call').length
                },
                benchmarks: {
                    averageDuration: 8500, // Industry average
                    averageCost: 0.15,
                    averageTokens: 2000,
                    averageSpanCount: 5
                },
                performanceScore: {
                    overall: Math.min(100, Math.max(0, 100 - (
                        (Math.max(0, (mainTrace.duration || 0) - 8500) / 8500 * 30) +
                        (Math.max(0, mainTrace.totalCost - 0.15) / 0.15 * 30) +
                        (Math.max(0, mainTrace.totalTokens - 2000) / 2000 * 20) +
                        (Math.max(0, mainTrace.spans.length - 5) / 5 * 20)
                    ))),
                    categories: {
                        latency: Math.min(100, Math.max(0, 100 - (Math.max(0, (mainTrace.duration || 0) - 8500) / 8500 * 100))),
                        cost: Math.min(100, Math.max(0, 100 - (Math.max(0, mainTrace.totalCost - 0.15) / 0.15 * 100))),
                        efficiency: Math.min(100, Math.max(0, 100 - (Math.max(0, mainTrace.totalTokens - 2000) / 2000 * 100))),
                        complexity: Math.min(100, Math.max(0, 100 - (Math.max(0, mainTrace.spans.length - 5) / 5 * 100)))
                    }
                },
                comparison
            };

            res.status(200).json({
                success: true,
                data: benchmark
            });
        } catch (error) {
            logger.error('Failed to get performance benchmark', { error, traceId: req.params.traceId });
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to get performance benchmark'
            });
        }
    }

    /**
     * Get aggregated performance analytics across multiple traces
     */
    static async getPerformanceAnalytics(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            const { projectId, timeRange = '7d', limit = 100 } = req.query;

            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            // Calculate date range
            const endDate = new Date();
            const startDate = new Date();
            const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 7;
            startDate.setDate(endDate.getDate() - days);

            const query: any = {
                userId,
                startTime: { $gte: startDate, $lte: endDate }
            };

            if (projectId) {
                query.projectId = projectId;
            }

            const traces = await TraceService.getTraces(userId, {
                ...query,
                limit: Number(limit)
            });

            if (!traces.traces || traces.traces.length === 0) {
                res.status(200).json({
                    success: true,
                    data: {
                        summary: { totalTraces: 0 },
                        trends: [],
                        topBottlenecks: [],
                        recommendations: []
                    }
                });
                return;
            }

            // Calculate aggregated analytics
            const analytics = {
                summary: {
                    totalTraces: traces.traces.length,
                    avgDuration: traces.traces.reduce((sum, t) => sum + (t.duration || 0), 0) / traces.traces.length,
                    totalCost: traces.traces.reduce((sum, t) => sum + t.totalCost, 0),
                    avgCost: traces.traces.reduce((sum, t) => sum + t.totalCost, 0) / traces.traces.length,
                    totalTokens: traces.traces.reduce((sum, t) => sum + t.totalTokens, 0),
                    avgTokens: traces.traces.reduce((sum, t) => sum + t.totalTokens, 0) / traces.traces.length
                },
                trends: {
                    dailyCosts: this.calculateDailyTrends(traces.traces, 'totalCost', days),
                    dailyDurations: this.calculateDailyTrends(traces.traces, 'duration', days),
                    dailyTokens: this.calculateDailyTrends(traces.traces, 'totalTokens', days)
                },
                topBottlenecks: this.identifyTopBottlenecks(traces.traces),
                modelUsage: this.analyzeModelUsage(traces.traces),
                recommendations: this.generateAggregatedRecommendations(traces.traces)
            };

            res.status(200).json({
                success: true,
                data: analytics
            });
        } catch (error) {
            logger.error('Failed to get performance analytics', { error });
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : 'Failed to get performance analytics'
            });
        }
    }

    // Helper methods for analytics
    private static calculateDailyTrends(traces: any[], metric: string, days: number): Array<{ date: string; value: number }> {
        const dailyData = new Map<string, number>();

        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            dailyData.set(dateStr, 0);
        }

        traces.forEach(trace => {
            const dateStr = new Date(trace.createdAt).toISOString().split('T')[0];
            const currentValue = dailyData.get(dateStr) || 0;
            const traceValue = metric === 'duration' ? (trace[metric] || 0) : trace[metric] || 0;
            dailyData.set(dateStr, currentValue + traceValue);
        });

        return Array.from(dailyData.entries())
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    private static identifyTopBottlenecks(traces: any[]): Array<{ type: string; count: number; avgImpact: number }> {
        const bottlenecks = new Map<string, { count: number; totalImpact: number }>();

        traces.forEach(trace => {
            // Analyze each trace for bottlenecks
            const aiSpans = trace.spans?.filter((s: any) => s.operation === 'ai_call') || [];

            aiSpans.forEach((span: any) => {
                if ((span.duration || 0) > 10000) {
                    const key = 'high_latency';
                    const current = bottlenecks.get(key) || { count: 0, totalImpact: 0 };
                    current.count++;
                    current.totalImpact += (span.duration || 0) / (trace.duration || 1) * 100;
                    bottlenecks.set(key, current);
                }

                if ((span.aiCall?.cost || 0) > 0.05) {
                    const key = 'high_cost';
                    const current = bottlenecks.get(key) || { count: 0, totalImpact: 0 };
                    current.count++;
                    current.totalImpact += (span.aiCall?.cost || 0) / trace.totalCost * 100;
                    bottlenecks.set(key, current);
                }
            });
        });

        return Array.from(bottlenecks.entries())
            .map(([type, data]) => ({
                type,
                count: data.count,
                avgImpact: data.totalImpact / data.count
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }

    private static analyzeModelUsage(traces: any[]): Array<{ model: string; usage: number; avgCost: number; avgDuration: number }> {
        const modelStats = new Map<string, { count: number; totalCost: number; totalDuration: number }>();

        traces.forEach(trace => {
            const aiSpans = trace.spans?.filter((s: any) => s.operation === 'ai_call') || [];

            aiSpans.forEach((span: any) => {
                const model = span.aiCall?.model;
                if (!model) return;

                const current = modelStats.get(model) || { count: 0, totalCost: 0, totalDuration: 0 };
                current.count++;
                current.totalCost += span.aiCall?.cost || 0;
                current.totalDuration += span.duration || 0;
                modelStats.set(model, current);
            });
        });

        return Array.from(modelStats.entries())
            .map(([model, stats]) => ({
                model,
                usage: stats.count,
                avgCost: stats.totalCost / stats.count,
                avgDuration: stats.totalDuration / stats.count
            }))
            .sort((a, b) => b.usage - a.usage);
    }

    private static generateAggregatedRecommendations(traces: any[]): Array<{ type: string; priority: string; description: string; estimatedSavings: number }> {
        const recommendations = [];

        // Calculate total costs for percentage savings
        const totalCost = traces.reduce((sum, t) => sum + t.totalCost, 0);

        // High cost reduction opportunity
        const expensiveTraces = traces.filter(t => t.totalCost > 0.5);
        if (expensiveTraces.length > traces.length * 0.2) {
            recommendations.push({
                type: 'cost_optimization',
                priority: 'high',
                description: `${expensiveTraces.length} traces have high costs. Consider model optimization or caching.`,
                estimatedSavings: totalCost * 0.25
            });
        }

        // High latency reduction opportunity  
        const slowTraces = traces.filter(t => (t.duration || 0) > 15000);
        if (slowTraces.length > traces.length * 0.15) {
            recommendations.push({
                type: 'latency_optimization',
                priority: 'medium',
                description: `${slowTraces.length} traces have high latency. Consider parallelization.`,
                estimatedSavings: 0 // Time savings, not cost
            });
        }

        return recommendations;
    }
} 