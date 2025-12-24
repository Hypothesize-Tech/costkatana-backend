import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { redisService } from '../services/redis.service';
import { googleSearchService } from '../services/googleSearch.service';

/**
 * Middleware to audit and track web search operations
 * Logs all search queries with user context and quota usage
 */
export async function searchAuditMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Only audit if this is a search-related operation
        const isSearchOperation = req.body?.operation === 'search' || 
                                 req.body?.query || 
                                 req.path.includes('search');

        if (!isSearchOperation) {
            return next();
        }

        const userId = (req as any).user?.id || 'anonymous';
        const query = req.body?.query || req.query?.q || '';
        const operation = req.body?.operation || 'search';

        // Log search request
        loggingService.info('Web search audit', {
            userId,
            query,
            operation,
            timestamp: new Date().toISOString(),
            ip: req.ip,
            userAgent: req.get('user-agent')
        });

        // Check quota and warn if approaching limit
        if (googleSearchService.isConfigured()) {
            const quotaStatus = await googleSearchService.getQuotaStatus();
            
            if (quotaStatus.percentage >= 80) {
                loggingService.warn('Search quota warning', {
                    userId,
                    quotaUsed: quotaStatus.count,
                    quotaLimit: quotaStatus.limit,
                    percentage: quotaStatus.percentage.toFixed(1)
                });

                // Add quota status to response headers
                res.setHeader('X-Search-Quota-Used', quotaStatus.count.toString());
                res.setHeader('X-Search-Quota-Limit', quotaStatus.limit.toString());
                res.setHeader('X-Search-Quota-Remaining', (quotaStatus.limit - quotaStatus.count).toString());
            }
        }

        next();

    } catch (error) {
        loggingService.error('Search audit middleware error', {
            error: error instanceof Error ? error.message : String(error)
        });
        // Don't block the request if audit fails
        next();
    }
}

/**
 * Middleware to log search results
 * Should be called after the search operation completes
 */
export function searchResultsLogger(resultCount: number, processingTime: number, userId?: string): void {
    loggingService.info('Search results logged', {
        userId: userId || 'anonymous',
        resultCount,
        processingTime,
        timestamp: new Date().toISOString()
    });
}

/**
 * Get search audit logs for a specific user
 * Can be called from admin/analytics endpoints
 */
export async function getSearchAuditLogs(userId: string, limit: number = 100): Promise<any[]> {
    try {
        // Query Redis for search audit logs
        const cacheKey = `search_audit:${userId}`;
        const logs = await redisService.get(cacheKey);
        
        if (logs) {
            const parsedLogs = JSON.parse(logs);
            loggingService.info('Retrieved search audit logs from cache', { 
                userId, 
                logCount: parsedLogs.length,
                limit 
            });
            return parsedLogs.slice(0, limit);
        }

        // If no cached logs, return empty array
        loggingService.info('No search audit logs found', { userId, limit });
        return [];
    } catch (error) {
        loggingService.error('Failed to retrieve search audit logs', {
            userId,
            error: error instanceof Error ? error.message : String(error)
        });
        return [];
    }
}

/**
 * Get quota status for a specific user or globally
 */
export async function getQuotaStatus(userId?: string): Promise<{
    count: number;
    limit: number;
    percentage: number;
    resetTime?: Date;
}> {
    if (!googleSearchService.isConfigured()) {
        loggingService.debug('Google Search service not configured', { userId: userId || 'anonymous' });
        return {
            count: 0,
            limit: 0,
            percentage: 0
        };
    }

    const quotaStatus = await googleSearchService.getQuotaStatus();
    
    // Calculate reset time (midnight)
    const now = new Date();
    const resetTime = new Date(now);
    resetTime.setDate(resetTime.getDate() + 1);
    resetTime.setHours(0, 0, 0, 0);

    loggingService.debug('Retrieved quota status', { 
        userId: userId || 'anonymous',
        count: quotaStatus.count,
        limit: quotaStatus.limit,
        percentage: quotaStatus.percentage
    });

    return {
        ...quotaStatus,
        resetTime
    };
}

