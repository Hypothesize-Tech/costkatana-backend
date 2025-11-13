import { Request, Response } from 'express';
import { AILog } from '../models/AILog';
import { LogQueryConversation, ILogQueryMessage } from '../models/LogQueryConversation';
import { LogQueryAudit } from '../models/LogQueryAudit';
import { loggingService } from '../services/logging.service';
import { CKQLService } from '../services/ckql.service';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

/**
 * Logs Controller
 * Handles AI log queries, streaming, analytics, and exports
 */

export class LogsController {
    /**
     * Query AI logs with comprehensive filtering
     * GET /api/logs/ai
     */
    static async queryLogs(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user.id;
            const userRole = (req as any).user.role;
            
            // Extract query parameters
            const {
                projectId,
                service,
                model,
                operation,
                status, // 'success', 'error', 'all'
                startDate,
                endDate,
                minLatency,
                maxLatency,
                minCost,
                maxCost,
                search, // Full-text search
                workflowId,
                experimentId,
                sessionId,
                cortexEnabled,
                cacheHit,
                logLevel,
                page = 1,
                limit = 50,
                sortBy = 'timestamp',
                sortOrder = 'desc'
            } = req.query;
            
            // Build query
            const query: any = {};
            
            // Authorization: Users can only see their own logs unless admin
            if (userRole !== 'admin' && userRole !== 'owner') {
                // Get user's projects
                const Project = mongoose.model('Project');
                const userProjects = await Project.find({
                    $or: [
                        { ownerId: userId },
                        { 'members.userId': userId }
                    ]
                }).select('_id');
                
                const projectIds = userProjects.map(p => p._id);
                
                query.$or = [
                    { userId },
                    { projectId: { $in: projectIds } }
                ];
            }
            
            // Apply filters
            if (projectId) {
                query.projectId = projectId;
            }
            
            if (service) {
                if (Array.isArray(service)) {
                    query.service = { $in: service };
                } else {
                    query.service = service;
                }
            }
            
            if (model) {
                if (Array.isArray(model)) {
                    query.aiModel = { $in: model };
                } else {
                    query.aiModel = typeof model === 'string' && model.includes('*') 
                        ? new RegExp(model.replace(/\*/g, '.*'), 'i')
                        : model;
                }
            }
            
            if (operation) {
                query.operation = operation;
            }
            
            if (status === 'success') {
                query.success = true;
            } else if (status === 'error') {
                query.success = false;
            }
            
            if (startDate || endDate) {
                query.timestamp = {};
                if (startDate) {
                    query.timestamp.$gte = new Date(startDate as string);
                }
                if (endDate) {
                    query.timestamp.$lte = new Date(endDate as string);
                }
            }
            
            if (minLatency || maxLatency) {
                query.responseTime = {};
                if (minLatency) {
                    query.responseTime.$gte = Number(minLatency);
                }
                if (maxLatency) {
                    query.responseTime.$lte = Number(maxLatency);
                }
            }
            
            if (minCost || maxCost) {
                query.cost = {};
                if (minCost) {
                    query.cost.$gte = Number(minCost);
                }
                if (maxCost) {
                    query.cost.$lte = Number(maxCost);
                }
            }
            
            if (search) {
                // Full-text search on error messages and operations
                query.$text = { $search: search as string };
            }
            
            if (workflowId) {
                query.workflowId = workflowId;
            }
            
            if (experimentId) {
                query.experimentId = experimentId;
            }
            
            if (sessionId) {
                query.sessionId = sessionId;
            }
            
            if (cortexEnabled !== undefined) {
                query.cortexEnabled = cortexEnabled === 'true';
            }
            
            if (cacheHit !== undefined) {
                query.cacheHit = cacheHit === 'true';
            }
            
            if (logLevel) {
                query.logLevel = Array.isArray(logLevel) ? { $in: logLevel } : logLevel;
            }
            
            // Pagination
            const pageNum = Math.max(1, Number(page));
            const limitNum = Math.min(100, Math.max(1, Number(limit)));
            const skip = (pageNum - 1) * limitNum;
            
            // Sort
            const sort: any = {};
            sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;
            
            // Execute query
            const [logs, total] = await Promise.all([
                AILog.find(query)
                    .sort(sort)
                    .skip(skip)
                    .limit(limitNum)
                    .lean(),
                AILog.countDocuments(query)
            ]);
            
            // Calculate pagination metadata
            const totalPages = Math.ceil(total / limitNum);
            const hasNext = pageNum < totalPages;
            const hasPrev = pageNum > 1;
            
            return res.json({
                success: true,
                data: logs,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages,
                    hasNext,
                    hasPrev
                },
                filters: {
                    projectId,
                    service,
                    model,
                    operation,
                    status,
                    startDate,
                    endDate
                }
            });
            
        } catch (error) {
            loggingService.error('Failed to query AI logs', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to query logs'
            });
        }
    }
    
    /**
     * Stream AI logs in real-time (SSE)
     * GET /api/logs/ai/stream
     */
    static async streamLogs(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user.id;
            const userRole = (req as any).user.role;
            
            // Set SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
            
            // Extract filters
            const { projectId, service, model, status } = req.query;
            
            // Build match query for authorization
            const matchQuery: any = {};
            
            if (userRole !== 'admin' && userRole !== 'owner') {
                const Project = mongoose.model('Project');
                const userProjects = await Project.find({
                    $or: [
                        { ownerId: userId },
                        { 'members.userId': userId }
                    ]
                }).select('_id');
                
                const projectIds = userProjects.map(p => p._id);
                matchQuery.$or = [
                    { userId },
                    { projectId: { $in: projectIds } }
                ];
            }
            
            // Apply filters
            if (projectId) matchQuery.projectId = new mongoose.Types.ObjectId(projectId as string);
            if (service) matchQuery.service = service;
            if (model) matchQuery.aiModel = model;
            if (status === 'success') matchQuery.success = true;
            if (status === 'error') matchQuery.success = false;
            
            // Send initial connection message
            res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Stream established' })}\n\n`);
            
            // Set up change stream on AILog collection
            const changeStream = AILog.watch([
                {
                    $match: {
                        operationType: 'insert',
                        ...Object.keys(matchQuery).length > 0 && {
                            $or: Object.entries(matchQuery).map(([key, value]) => ({
                                [`fullDocument.${key}`]: value
                            }))
                        }
                    }
                }
            ], { fullDocument: 'updateLookup' });
            
            changeStream.on('change', (change: any) => {
                if (change.operationType === 'insert' && change.fullDocument) {
                    res.write(`data: ${JSON.stringify({
                        type: 'log',
                        data: change.fullDocument
                    })}\n\n`);
                }
            });
            
            changeStream.on('error', (error) => {
                loggingService.error('Change stream error', {
                    component: 'LogsController',
                    error: error.message
                });
                res.write(`data: ${JSON.stringify({ 
                    type: 'error', 
                    message: 'Stream error occurred' 
                })}\n\n`);
            });
            
            // Send heartbeat every 30 seconds
            const heartbeat = setInterval(() => {
                res.write(`: heartbeat\n\n`);
            }, 30000);
            
            // Clean up on client disconnect
            req.on('close', () => {
                clearInterval(heartbeat);
                changeStream.close();
                loggingService.debug('Client disconnected from log stream', {
                    component: 'LogsController',
                    userId
                });
            });
            
        } catch (error) {
            loggingService.error('Failed to establish log stream', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            res.status(500).json({
                success: false,
                error: 'Failed to establish stream'
            });
        }
    }
    
    /**
     * Get single log entry with full details
     * GET /api/logs/ai/:logId
     */
    static async getLogById(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user.id;
            const userRole = (req as any).user.role;
            const { logId } = req.params;
            
            const log = await AILog.findById(logId).lean();
            
            if (!log) {
                return res.status(404).json({
                    success: false,
                    error: 'Log not found'
                });
            }
            
            // Authorization check
            if (userRole !== 'admin' && userRole !== 'owner') {
                if (log.userId.toString() !== userId) {
                    // Check if user has access to project
                    if (log.projectId) {
                        const Project = mongoose.model('Project');
                        const project = await Project.findOne({
                            _id: log.projectId,
                            $or: [
                                { ownerId: userId },
                                { 'members.userId': userId }
                            ]
                        });
                        
                        if (!project) {
                            return res.status(403).json({
                                success: false,
                                error: 'Access denied'
                            });
                        }
                    } else {
                        return res.status(403).json({
                            success: false,
                            error: 'Access denied'
                        });
                    }
                }
            }
            
            // Get related logs in the same request chain
            const relatedLogs = await AILog.find({
                requestId: log.requestId,
                _id: { $ne: log._id }
            })
            .sort({ timestamp: 1 })
            .limit(20)
            .lean();
            
            return res.json({
                success: true,
                data: log,
                related: relatedLogs
            });
            
        } catch (error) {
            loggingService.error('Failed to get log by ID', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve log'
            });
        }
    }
    
    /**
     * Get aggregated statistics
     * GET /api/logs/ai/stats
     */
    static async getStats(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user.id;
            const userRole = (req as any).user.role;
            
            const {
                projectId,
                startDate,
                endDate,
                groupBy = 'service' // service, model, project, hour, day
            } = req.query;
            
            // Build match query
            const matchQuery: any = {};
            
            if (userRole !== 'admin' && userRole !== 'owner') {
                const Project = mongoose.model('Project');
                const userProjects = await Project.find({
                    $or: [
                        { ownerId: userId },
                        { 'members.userId': userId }
                    ]
                }).select('_id');
                
                const projectIds = userProjects.map(p => p._id);
                matchQuery.$or = [
                    { userId },
                    { projectId: { $in: projectIds } }
                ];
            }
            
            if (projectId) {
                matchQuery.projectId = new mongoose.Types.ObjectId(projectId as string);
            }
            
            if (startDate || endDate) {
                matchQuery.timestamp = {};
                if (startDate) matchQuery.timestamp.$gte = new Date(startDate as string);
                if (endDate) matchQuery.timestamp.$lte = new Date(endDate as string);
            }
            
            // Determine grouping
            let groupId: any;
            if (groupBy === 'hour') {
                groupId = {
                    year: { $year: '$timestamp' },
                    month: { $month: '$timestamp' },
                    day: { $dayOfMonth: '$timestamp' },
                    hour: { $hour: '$timestamp' }
                };
            } else if (groupBy === 'day') {
                groupId = {
                    year: { $year: '$timestamp' },
                    month: { $month: '$timestamp' },
                    day: { $dayOfMonth: '$timestamp' }
                };
            } else {
                groupId = `$${groupBy}`;
            }
            
            // Aggregate stats
            const stats = await AILog.aggregate([
                { $match: matchQuery },
                {
                    $group: {
                        _id: groupId,
                        totalCalls: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalInputTokens: { $sum: '$inputTokens' },
                        totalOutputTokens: { $sum: '$outputTokens' },
                        avgLatency: { $avg: '$responseTime' },
                        minLatency: { $min: '$responseTime' },
                        maxLatency: { $max: '$responseTime' },
                        errors: {
                            $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] }
                        },
                        cacheHits: {
                            $sum: { $cond: ['$cacheHit', 1, 0] }
                        }
                    }
                },
                {
                    $addFields: {
                        errorRate: {
                            $cond: [
                                { $eq: ['$totalCalls', 0] },
                                0,
                                { $divide: ['$errors', '$totalCalls'] }
                            ]
                        },
                        cacheHitRate: {
                            $cond: [
                                { $eq: ['$totalCalls', 0] },
                                0,
                                { $divide: ['$cacheHits', '$totalCalls'] }
                            ]
                        },
                        avgCostPerCall: {
                            $cond: [
                                { $eq: ['$totalCalls', 0] },
                                0,
                                { $divide: ['$totalCost', '$totalCalls'] }
                            ]
                        }
                    }
                },
                { $sort: { '_id': 1 } }
            ]);
            
            // Overall summary
            const summary = stats.reduce((acc, stat) => ({
                totalCalls: acc.totalCalls + stat.totalCalls,
                totalCost: acc.totalCost + stat.totalCost,
                totalTokens: acc.totalTokens + stat.totalTokens,
                errors: acc.errors + stat.errors
            }), { totalCalls: 0, totalCost: 0, totalTokens: 0, errors: 0 });
            
            return res.json({
                success: true,
                summary: {
                    ...summary,
                    errorRate: summary.totalCalls > 0 ? summary.errors / summary.totalCalls : 0,
                    avgCostPerCall: summary.totalCalls > 0 ? summary.totalCost / summary.totalCalls : 0
                },
                breakdown: stats,
                groupBy
            });
            
        } catch (error) {
            loggingService.error('Failed to get log stats', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve statistics'
            });
        }
    }
    
    /**
     * Export logs
     * GET /api/logs/ai/export
     */
    static async exportLogs(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user.id;
            const userRole = (req as any).user.role;
            
            const {
                format = 'json', // json, csv, jsonl
                projectId,
                startDate,
                endDate,
                limit = 1000
            } = req.query;
            
            // Build query (same authorization as queryLogs)
            const query: any = {};
            
            if (userRole !== 'admin' && userRole !== 'owner') {
                const Project = mongoose.model('Project');
                const userProjects = await Project.find({
                    $or: [
                        { ownerId: userId },
                        { 'members.userId': userId }
                    ]
                }).select('_id');
                
                const projectIds = userProjects.map(p => p._id);
                query.$or = [
                    { userId },
                    { projectId: { $in: projectIds } }
                ];
            }
            
            if (projectId) query.projectId = projectId;
            if (startDate || endDate) {
                query.timestamp = {};
                if (startDate) query.timestamp.$gte = new Date(startDate as string);
                if (endDate) query.timestamp.$lte = new Date(endDate as string);
            }
            
            const logs = await AILog.find(query)
                .sort({ timestamp: -1 })
                .limit(Math.min(Number(limit), 10000))
                .lean();
            
            if (format === 'csv') {
                // CSV export
                const csvHeaders = [
                    'timestamp', 'service', 'model', 'operation', 'statusCode',
                    'success', 'responseTime', 'inputTokens', 'outputTokens',
                    'cost', 'errorMessage'
                ];
                
                const csvRows = logs.map(log => [
                    log.timestamp.toISOString(),
                    log.service,
                    log.aiModel,
                    log.operation,
                    log.statusCode,
                    log.success,
                    log.responseTime,
                    log.inputTokens,
                    log.outputTokens,
                    log.cost,
                    log.errorMessage || ''
                ]);
                
                const csv = [
                    csvHeaders.join(','),
                    ...csvRows.map(row => row.map(cell => 
                        typeof cell === 'string' && cell.includes(',') 
                            ? `"${cell.replace(/"/g, '""')}"` 
                            : cell
                    ).join(','))
                ].join('\n');
                
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename=ai-logs-${Date.now()}.csv`);
                res.send(csv);
                
            } else if (format === 'jsonl') {
                // JSON Lines export
                const jsonl = logs.map(log => JSON.stringify(log)).join('\n');
                
                res.setHeader('Content-Type', 'application/jsonl');
                res.setHeader('Content-Disposition', `attachment; filename=ai-logs-${Date.now()}.jsonl`);
                res.send(jsonl);
                
            } else {
                // JSON export
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename=ai-logs-${Date.now()}.json`);
                res.json({
                    exportedAt: new Date().toISOString(),
                    count: logs.length,
                    logs
                });
            }
            
        } catch (error) {
            loggingService.error('Failed to export logs', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            res.status(500).json({
                success: false,
                error: 'Failed to export logs'
            });
        }
    }
    
    /**
     * Sanitize MongoDB query to prevent security risks
     * @private
     */
    private static sanitizeMongoQuery(query: any): any {
        const dangerousOperators = ['$where', '$function', '$accumulator'];
        const sensitiveFields = ['apiKeys', 'tokens', 'credentials', 'password', 'apiKey', 'secret'];
        
        const sanitize = (obj: any): any => {
            if (typeof obj !== 'object' || obj === null) return obj;
            
            if (Array.isArray(obj)) {
                return obj.map(item => sanitize(item));
            }
            
            const sanitized: any = {};
            for (const [key, value] of Object.entries(obj)) {
                // Block dangerous operators
                if (dangerousOperators.includes(key)) {
                    throw new Error(`Security violation: Operator ${key} is not allowed`);
                }
                
                // Block $expr with potential code execution
                if (key === '$expr' && typeof value === 'object') {
                    const exprStr = JSON.stringify(value);
                    if (exprStr.includes('$function') || exprStr.includes('$where')) {
                        throw new Error('Security violation: $expr with code execution is not allowed');
                    }
                }
                
                // Block sensitive field access
                if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
                    throw new Error(`Security violation: Access to sensitive field ${key} is not allowed`);
                }
                
                sanitized[key] = sanitize(value);
            }
            
            return sanitized;
        };
        
        return sanitize(query);
    }
    
    /**
     * Determine visualization type based on query and results
     * @private
     */
    private static determineVisualizationType(naturalQuery: string, results: any[]): {
        type: 'stat-card' | 'line' | 'bar' | 'pie' | 'area' | 'table';
        metric: string;
        title: string;
        size: 'small' | 'medium' | 'large' | 'full';
        data?: any;
        chartConfig?: any;
    } {
        const lowerQuery = naturalQuery.toLowerCase();
        
        // Stat card patterns
        if (lowerQuery.match(/^(what|show|get|total|count|sum|average|avg|how much|how many)/)) {
            if (results.length === 1 && typeof results[0] === 'object') {
                const keys = Object.keys(results[0]);
                const numericKey = keys.find(k => typeof results[0][k] === 'number');
                
                if (numericKey) {
                    return {
                        type: 'stat-card',
                        metric: numericKey,
                        title: naturalQuery,
                        size: 'small',
                        data: results[0][numericKey]
                    };
                }
            }
        }
        
        // Time series patterns (line or area chart)
        if (lowerQuery.includes('over time') || lowerQuery.includes('trend') || lowerQuery.includes('timeline')) {
            return {
                type: 'line',
                metric: 'timeSeries',
                title: naturalQuery,
                size: 'large',
                data: results
            };
        }
        
        // Comparison patterns (bar chart)
        if (lowerQuery.includes('compare') || lowerQuery.includes('vs') || lowerQuery.includes('versus') ||
            lowerQuery.includes('by service') || lowerQuery.includes('by model') || lowerQuery.includes('slowest') ||
            lowerQuery.includes('fastest') || lowerQuery.includes('most') || lowerQuery.includes('least')) {
            return {
                type: 'bar',
                metric: 'comparison',
                title: naturalQuery,
                size: 'medium',
                data: results.slice(0, 10)
            };
        }
        
        // Distribution patterns (pie chart)
        if (lowerQuery.includes('distribution') || lowerQuery.includes('breakdown') || 
            lowerQuery.includes('percentage') || lowerQuery.includes('proportion')) {
            return {
                type: 'pie',
                metric: 'distribution',
                title: naturalQuery,
                size: 'medium',
                data: results.slice(0, 8)
            };
        }
        
        // Error patterns (table)
        if (lowerQuery.includes('error') || lowerQuery.includes('failure') || lowerQuery.includes('failed')) {
            return {
                type: 'table',
                metric: 'errors',
                title: naturalQuery,
                size: 'full',
                data: results.slice(0, 10)
            };
        }
        
        // Default to table for list-like results
        if (results.length > 3) {
            return {
                type: 'table',
                metric: 'list',
                title: naturalQuery,
                size: 'full',
                data: results.slice(0, 10)
            };
        }
        
        // Default to stat card for single values
        return {
            type: 'stat-card',
            metric: 'value',
            title: naturalQuery,
            size: 'small',
            data: results.length > 0 ? results[0] : null
        };
    }
    
    /**
     * Generate natural language summary using Claude
     * @private
     */
    private static async generateSummary(query: string, results: any[], visualization: any): Promise<string> {
        try {
            const bedrockClient = new BedrockRuntimeClient({
                region: process.env.AWS_BEDROCK_REGION || 'us-east-1'
            });
            
            const summaryPrompt = `You are an AI assistant analyzing log query results. Generate a concise, natural language summary of the results.

Query: "${query}"
Results count: ${results.length}
Visualization type: ${visualization.type}

Results data: ${JSON.stringify(results.slice(0, 5), null, 2)}

Provide a clear, 1-2 sentence summary that directly answers the user's question. Include specific numbers and insights. Be conversational and helpful.`;
            
            const payload = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 200,
                temperature: 0.3,
                messages: [
                    {
                        role: 'user',
                        content: summaryPrompt
                    }
                ]
            };
            
            const command = new InvokeModelCommand({
                modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(payload)
            });
            
            const response = await bedrockClient.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            
            return responseBody.content[0].text;
        } catch (error) {
            loggingService.error('Failed to generate summary', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback summary
            return `Found ${results.length} result${results.length !== 1 ? 's' : ''} for your query.`;
        }
    }
    
    /**
     * Natural language query for logs
     * POST /api/logs/ai/chat
     */
    static async naturalLanguageQuery(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const userId = (req as any).user.id;
        const userRole = (req as any).user.role;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        
        try {
            const { query, conversationId, additionalFilters } = req.body;
            
            if (!query || typeof query !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Query is required and must be a string'
                });
            }
            
            // Check for blocked keywords (security guardrail)
            const blockedKeywords = ['api key', 'apikey', 'password', 'token', 'secret', 'credential'];
            if (blockedKeywords.some(keyword => query.toLowerCase().includes(keyword))) {
                // Log blocked attempt
                await LogQueryAudit.create({
                    userId,
                    naturalLanguageQuery: query,
                    generatedMongoQuery: {},
                    resultsCount: 0,
                    executionTime: Date.now() - startTime,
                    status: 'blocked',
                    error: 'Query contains blocked keywords (sensitive data)',
                    ipAddress,
                    userAgent
                });
                
                return res.json({
                    success: true,
                    data: [],
                    visualization: null,
                    summary: 'I cannot access sensitive fields like API keys, passwords, or tokens for security reasons. I can help analyze costs, performance, errors, and usage patterns instead.',
                    suggestedQueries: [
                        'Show my most expensive requests today',
                        'What are my error rates by service?',
                        'Show me slowest API calls this week'
                    ],
                    conversationId: conversationId || uuidv4(),
                    blocked: true
                });
            }
            
            // Build base authorization query
            const baseQuery: any = {};
            console.log('User role:', userRole, 'User ID:', userId);
            
            if (userRole !== 'admin' && userRole !== 'owner') {
                const Project = mongoose.model('Project');
                const userProjects = await Project.find({
                    $or: [
                        { ownerId: userId },
                        { 'members.userId': userId }
                    ]
                }).select('_id');
                
                const projectIds = userProjects.map(p => p._id);
                console.log('Non-admin user, found', projectIds.length, 'projects');
                
                baseQuery.$or = [
                    { userId },
                    { projectId: { $in: projectIds } }
                ];
            } else {
                console.log('Admin/Owner user - no base query restrictions');
            }
            
            // Parse natural language query using CKQL
            const ckqlService = CKQLService.getInstance();
            let parsedQuery: any;
            let useFallback = false;
            
            try {
                parsedQuery = await ckqlService.parseQuery(query, {
                    tenant_id: userId,
                    workspace_id: 'default'
                });
                
                // Log the parsed query for debugging
                console.log('Parsed CKQL Query:', JSON.stringify(parsedQuery, null, 2));
                
                // Check if CKQL returned an empty query
                if (!parsedQuery || !parsedQuery.mongoQuery || Object.keys(parsedQuery.mongoQuery).length === 0) {
                    console.log('CKQL returned empty query, using fallback');
                    useFallback = true;
                }
            } catch (ckqlError: any) {
                console.error('CKQL Parsing Error:', ckqlError);
                useFallback = true;
            }
            
            // For cost-related queries, use aggregation approach
            const isCostQuery = query.toLowerCase().includes('cost') || query.toLowerCase().includes('expensive') || query.toLowerCase().includes('price');
            const isServiceQuery = query.toLowerCase().includes('service');
            
            if (useFallback || (isCostQuery && isServiceQuery)) {
                console.log('Using fallback: cost/service query detected');
                parsedQuery = {
                    mongoQuery: {},
                    confidence: 0.5
                };
            }
            
            // Ensure parsedQuery is defined
            if (!parsedQuery) {
                parsedQuery = {
                    mongoQuery: {},
                    confidence: 0
                };
            }
            
            // Clean up malformed queries from CKQL (e.g., empty timestamp objects)
            let cleanedMongoQuery = parsedQuery.mongoQuery || {};
            
            // Helper function to recursively clean empty objects
            const cleanEmptyObjects = (obj: any): any => {
                if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
                    return obj;
                }
                
                const cleaned: any = {};
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                        // If it's an empty object, skip it
                        if (Object.keys(value).length === 0) {
                            console.log(`Detected empty object at key "${key}", removing it`);
                            continue;
                        }
                        // Recursively clean nested objects
                        const cleanedValue = cleanEmptyObjects(value);
                        if (Object.keys(cleanedValue).length > 0) {
                            cleaned[key] = cleanedValue;
                        }
                    } else {
                        cleaned[key] = value;
                    }
                }
                return cleaned;
            };
            
            cleanedMongoQuery = cleanEmptyObjects(cleanedMongoQuery);
            
            // Sanitize generated query
            let sanitizedQuery;
            try {
                sanitizedQuery = LogsController.sanitizeMongoQuery(cleanedMongoQuery);
            } catch (sanitizeError: any) {
                // Log security violation
                await LogQueryAudit.create({
                    userId,
                    naturalLanguageQuery: query,
                    generatedMongoQuery: cleanedMongoQuery,
                    resultsCount: 0,
                    executionTime: Date.now() - startTime,
                    status: 'blocked',
                    error: sanitizeError.message,
                    ipAddress,
                    userAgent
                });
                
                return res.status(400).json({
                    success: false,
                    error: 'Query contains unsafe operations',
                    details: sanitizeError.message
                });
            }
            
            // Add time-based filters if query mentions time periods
            const timeBasedQuery: any = {};
            const queryLower = query.toLowerCase();
            
            if (queryLower.includes('today')) {
                const startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);
                timeBasedQuery.timestamp = { $gte: startOfDay };
            } else if (queryLower.includes('yesterday')) {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                yesterday.setHours(0, 0, 0, 0);
                const endOfYesterday = new Date(yesterday);
                endOfYesterday.setHours(23, 59, 59, 999);
                timeBasedQuery.timestamp = { $gte: yesterday, $lte: endOfYesterday };
            } else if (queryLower.includes('this week') || queryLower.includes('last 7 days')) {
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                timeBasedQuery.timestamp = { $gte: weekAgo };
            } else if (queryLower.includes('this month') || queryLower.includes('last 30 days')) {
                const monthAgo = new Date();
                monthAgo.setDate(monthAgo.getDate() - 30);
                timeBasedQuery.timestamp = { $gte: monthAgo };
            }
            
            // Merge with base authorization query and additional filters
            // Note: timeBasedQuery is added after sanitizedQuery to override any malformed timestamp queries from CKQL
            const finalQuery = {
                ...baseQuery,
                ...sanitizedQuery,
                ...timeBasedQuery, // This will override any timestamp field from sanitizedQuery
                ...(additionalFilters && typeof additionalFilters === 'object' && Object.keys(additionalFilters).length > 0 ? additionalFilters : {})
            };
            
            console.log('Final MongoDB Query:', JSON.stringify(finalQuery, null, 2));
            console.log('Query has', Object.keys(finalQuery).length, 'conditions');
            console.log('Base query OR conditions:', baseQuery.$or?.length || 0);
            
            // Execute query with limit
            const results = await AILog.find(finalQuery)
                .sort({ timestamp: -1 })
                .limit(1000)
                .lean();
            
            console.log('Query returned', results.length, 'results');
            
            // Determine visualization type
            const visualization = LogsController.determineVisualizationType(query, results);
            
            // Generate natural language summary
            const summary = await LogsController.generateSummary(query, results, visualization);
            
            // Save to conversation
            const newConversationId = conversationId || uuidv4();
            const userMessage: ILogQueryMessage = {
                role: 'user',
                content: query,
                timestamp: new Date()
            };
            
            const assistantMessage: ILogQueryMessage = {
                role: 'assistant',
                content: summary,
                query,
                mongoQuery: finalQuery,
                resultsCount: results.length,
                visualization: {
                    ...visualization,
                    data: results
                },
                timestamp: new Date()
            };
            
            await LogQueryConversation.findOneAndUpdate(
                { conversationId: newConversationId },
                {
                    $setOnInsert: { userId, conversationId: newConversationId },
                    $push: { messages: { $each: [userMessage, assistantMessage] } }
                },
                { upsert: true, new: true }
            );
            
            // Create audit log
            await LogQueryAudit.create({
                userId,
                naturalLanguageQuery: query,
                generatedMongoQuery: finalQuery,
                resultsCount: results.length,
                executionTime: Date.now() - startTime,
                status: 'success',
                ipAddress,
                userAgent
            });
            
            // Suggest follow-up queries
            const suggestedQueries = [
                'Show me the cost breakdown for these requests',
                'What are the error rates?',
                'Show me latency statistics'
            ];
            
            return res.json({
                success: true,
                data: results,
                visualization,
                summary,
                conversationId: newConversationId,
                suggestedQueries
            });
            
        } catch (error) {
            // Log error
            await LogQueryAudit.create({
                userId,
                naturalLanguageQuery: req.body.query || '',
                generatedMongoQuery: {},
                resultsCount: 0,
                executionTime: Date.now() - startTime,
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
                ipAddress,
                userAgent
            }).catch(() => {});  // Ignore audit log errors
            
            loggingService.error('Failed to process natural language query', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to process query',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        }
    }
    
    /**
     * Get chat history for user
     * GET /api/logs/ai/chat/history
     */
    static async getChatHistory(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user.id;
            const { limit = 10, offset = 0 } = req.query;
            
            const conversations = await LogQueryConversation.find({ userId })
                .sort({ updatedAt: -1 })
                .skip(Number(offset))
                .limit(Math.min(Number(limit), 50))
                .lean();
            
            const total = await LogQueryConversation.countDocuments({ userId });
            
            return res.json({
                success: true,
                data: conversations,
                pagination: {
                    total,
                    limit: Number(limit),
                    offset: Number(offset),
                    hasMore: total > Number(offset) + conversations.length
                }
            });
            
        } catch (error) {
            loggingService.error('Failed to get chat history', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve chat history'
            });
        }
    }
    
    /**
     * Delete a conversation
     * DELETE /api/logs/ai/chat/:conversationId
     */
    static async deleteChatConversation(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user.id;
            const { conversationId } = req.params;
            
            const result = await LogQueryConversation.deleteOne({
                conversationId,
                userId  // Ensure user can only delete their own conversations
            });
            
            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Conversation not found or access denied'
                });
            }
            
            return res.json({
                success: true,
                message: 'Conversation deleted successfully'
            });
            
        } catch (error) {
            loggingService.error('Failed to delete conversation', {
                component: 'LogsController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to delete conversation'
            });
        }
    }
}

