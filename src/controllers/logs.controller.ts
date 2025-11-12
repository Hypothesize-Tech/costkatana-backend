import { Request, Response } from 'express';
import { AILog } from '../models/AILog';
import { loggingService } from '../services/logging.service';
import mongoose from 'mongoose';

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
}

