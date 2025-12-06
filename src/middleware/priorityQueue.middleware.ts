/**
 * Priority Queue Middleware
 * 
 * Extracts priority information from requests and manages queue entry/exit.
 * Supports priority headers and automatic priority calculation based on user tier.
 */

import { Request, Response, NextFunction } from 'express';
import { priorityQueueService, PriorityLevel } from '../services/priorityQueue.service';
import { loggingService } from '../services/logging.service';

/**
 * Parse priority from header
 */
function parsePriorityHeader(priorityHeader?: string): number | undefined {
    if (!priorityHeader) {
        return undefined;
    }
    
    const lower = priorityHeader.toLowerCase();
    
    switch (lower) {
        case 'critical':
            return PriorityLevel.CRITICAL;
        case 'high':
            return PriorityLevel.HIGH;
        case 'normal':
            return PriorityLevel.NORMAL;
        case 'low':
            return PriorityLevel.LOW;
        case 'bulk':
            return PriorityLevel.BULK;
        default:
            // Try to parse as number
            const numPriority = parseInt(priorityHeader, 10);
            return isNaN(numPriority) ? undefined : numPriority;
    }
}

/**
 * Priority Queue Middleware
 * 
 * Can be used in two modes:
 * 1. Queue mode: Enqueues requests for later processing (not implemented yet - requires worker system)
 * 2. Passthrough mode: Just tracks priority metadata without actual queuing
 */
export async function priorityQueueMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Check if priority queue is enabled
        const enablePriorityQueue = process.env.ENABLE_PRIORITY_QUEUE !== 'false';
        
        if (!enablePriorityQueue) {
            return next();
        }
        
        // Extract priority from header
        const priorityHeader = Array.isArray(req.headers['costkatana-priority']) 
            ? req.headers['costkatana-priority'][0] 
            : req.headers['costkatana-priority'];
        const explicitPriority = parsePriorityHeader(priorityHeader);
        
        // Get user tier from gateway context (set by auth middleware)
        const context = req.gatewayContext;
        const userTier = (context as any)?.userTier || 'free';
        
        // Extract request ID safely
        const requestIdHeader = req.headers['x-request-id'];
        const requestId = Array.isArray(requestIdHeader) 
            ? requestIdHeader[0] 
            : requestIdHeader;
        
        // Check if queue is over capacity
        if (priorityQueueService.isQueueOverCapacity()) {
            loggingService.warn('Priority queue over capacity', {
                requestId: requestId || 'unknown',
                userTier
            });
            
            // For now, just log and continue (in production, you might want to reject low-priority requests)
            res.setHeader('CostKatana-Queue-Status', 'over-capacity');
        }
        
        // Check if max wait time would be exceeded
        if (priorityQueueService.wouldExceedMaxWaitTime()) {
            loggingService.warn('Priority queue max wait time would be exceeded', {
                requestId: requestId || 'unknown',
                userTier
            });
            
            res.setHeader('CostKatana-Queue-Status', 'high-latency');
        }
        
        // Store priority metadata in context
        if (context) {
            (context as any).requestPriority = explicitPriority || PriorityLevel.NORMAL;
            (context as any).userTier = userTier;
        }
        
        // Add priority header to response for debugging
        if (explicitPriority) {
            res.setHeader('CostKatana-Request-Priority', explicitPriority.toString());
        }
        
        // Get queue stats
        const stats = priorityQueueService.getQueueStats();
        res.setHeader('CostKatana-Queue-Depth', stats.queueDepth.toString());
        
        loggingService.debug('Priority queue middleware processed', {
            requestId: requestId || 'unknown',
            explicitPriority,
            userTier,
            queueDepth: stats.queueDepth
        });
        
        // Continue to next middleware (passthrough mode for now)
        next();
        
    } catch (error) {
        const errorRequestId = Array.isArray(req.headers['x-request-id']) 
            ? req.headers['x-request-id'][0] 
            : req.headers['x-request-id'];
        loggingService.error('Priority queue middleware error', {
            error: error instanceof Error ? error.message : String(error),
            requestId: errorRequestId || 'unknown'
        });
        
        // Don't block requests on queue errors
        next();
    }
}

/**
 * Queue status endpoint handler
 */
export async function getQueueStatus(
    _req: Request,
    res: Response
): Promise<void> {
    try {
        const stats = priorityQueueService.getQueueStats();
        
        res.status(200).json({
            success: true,
            data: {
                ...stats,
                isOverCapacity: priorityQueueService.isQueueOverCapacity(),
                wouldExceedMaxWait: priorityQueueService.wouldExceedMaxWaitTime(),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        loggingService.error('Failed to get queue status', {
            error: error instanceof Error ? error.message : String(error)
        });
        
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve queue status'
        });
    }
}

