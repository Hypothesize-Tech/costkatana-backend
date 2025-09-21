import { Response, NextFunction } from 'express';
import { UsageService } from '../services/usage.service';
import { trackUsageSchema, paginationSchema, sdkTrackUsageSchema } from '../utils/validators';
import { loggingService } from '../services/logging.service';
import jwt from 'jsonwebtoken';
import { RealtimeUpdateService } from '../services/realtime-update.service';
import { calculateCost } from '../utils/pricing'; 
import { sanitizeModelName } from '../utils/optimizationUtils';
import { extractErrorDetails } from '../utils/helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export function getUserIdFromToken(req: any): string | null {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/, '');
    if (!token) return null;
    try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        return decoded.id || decoded.userId || null;
    } catch (err) {
        return null;
    }
}

export class UsageController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // Request timeout configuration
    private static readonly DEFAULT_TIMEOUT = 15000; // 15 seconds
    private static readonly ANALYTICS_TIMEOUT = 30000; // 30 seconds for analytics
    private static readonly BULK_TIMEOUT = 45000; // 45 seconds for bulk operations
    
    // User data sharing within request scope
    private static userCache = new Map<string, { user: any; timestamp: number }>();
    private static readonly USER_CACHE_TTL = 30000; // 30 seconds
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }
    static async trackUsage(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = req.user?.id || req.userId;

        try {
            loggingService.info('Usage tracking initiated', {
                requestId,
                userId
            });

            // Validate authentication
            if (!UsageController.validateAuthentication(userId, requestId, res)) {
                return;
            }

            // Check circuit breaker
            if (UsageController.isDbCircuitBreakerOpen()) {
                throw new Error('Service temporarily unavailable');
            }

            const validatedData = trackUsageSchema.parse(req.body);

            const usage = await UsageService.trackUsage({
                userId,
                ...validatedData,
            });
            const duration = Date.now() - startTime;

            loggingService.info('Usage tracked successfully', {
                requestId,
                duration,
                userId,
                usageId: usage?._id,
                cost: usage?.cost
            });

            // Queue background business event logging
            UsageController.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'usage_tracked',
                    category: 'usage',
                    value: duration,
                    metadata: {
                        userId,
                        usageId: usage?._id,
                        service: validatedData.service,
                        model: validatedData.model,
                        cost: usage?.cost,
                        totalTokens: usage?.totalTokens,
                        optimizationApplied: usage?.optimizationApplied
                    }
                });
            });

            res.status(201).json({
                success: true,
                message: 'Usage tracked successfully',
                data: {
                    id: usage?._id,
                    cost: usage?.cost,
                    tokens: usage?.totalTokens,
                    optimizationApplied: usage?.optimizationApplied,
                },
            });
        } catch (error: any) {
            UsageController.recordDbFailure();
            const duration = Date.now() - startTime;
            
            if (error.message === 'Service temporarily unavailable') {
                loggingService.warn('Usage service unavailable', {
                    requestId,
                    duration
                });
                
                res.status(503).json({
                    success: false,
                    error: 'Service temporarily unavailable',
                    message: 'Please try again later'
                });
                return;
            }
            
            loggingService.error('Usage tracking failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
                duration
            });
            
            next(error);
        }
    }

    static async trackUsageFromSDK(req: any, res: Response): Promise<void> {
        try {

            // Normalize payload
            let body = { ...req.body };
            let transformed = false;
            // Flatten 'usage' object if exists
            if (body.usage && typeof body.usage === 'object') {
                body = { ...body, ...body.usage };
                delete body.usage;
                transformed = true;
            }
            // Convert 'provider' to 'service' (model expects 'service')
            if (body.provider && !body.service) {
                body.service = body.provider;
                delete body.provider;
                transformed = true;
            }
            // Handle cost field
            if (body.estimatedCost && !body.cost) {
                body.cost = body.estimatedCost;
                delete body.estimatedCost;
                transformed = true;
            }
            if (transformed) {
                loggingService.warn('trackUsageFromSDK: Transformed payload', { 
                    requestId: req.headers['x-request-id'] as string,
                    original: req.body, 
                    transformed: body 
                });
            }
            

            // Get userId from JWT token
            let userId = getUserIdFromToken(req);
            if (!userId) {
                userId = req.user?.id || req.user?._id || req.userId;
            }
            if (!userId) {
                loggingService.error('No user ID found in request or token', {
                    requestId: req.headers['x-request-id'] as string,
                    hasUser: !!req.user,
                    hasUserId: !!req.userId,
                    hasToken: !!req.headers.authorization
                });
                res.status(401).json({
                    success: false,
                    error: 'User authentication required'
                });
                return;
            }
            console.log('Found userId:', userId);
            // Validate transformed data
            const validationResult = sdkTrackUsageSchema.safeParse(body);
            if (!validationResult.success) {
                loggingService.error('SDK usage validation failed', {
                    requestId: req.headers['x-request-id'] as string,
                    userId,
                    validationErrors: validationResult.error.issues,
                    errorCount: validationResult.error.issues.length
                });
                res.status(400).json({
                    success: false,
                    error: 'Invalid usage data',
                    details: validationResult.error.issues
                });
                return;
            }
            const data: any = validationResult.data;
            
            // DEBUG: Check workflow fields after validation
            console.log('🔍 WORKFLOW DEBUG - After validation:', {
                workflowId: data.workflowId,
                workflowName: data.workflowName,
                workflowStep: data.workflowStep,
                workflowSequence: data.workflowSequence
            });

            // Extract projectId from multiple possible sources
            let projectId = data.projectId || req.query.projectId;

            // If projectId is not found at top level, check in metadata (legacy support)
            if (!projectId && data.metadata && typeof data.metadata === 'object' && data.metadata.projectId) {
                projectId = data.metadata.projectId;
                console.log('Found projectId in metadata (legacy approach):', projectId);
            }

            // Extract error details if present
            const errorInfo = extractErrorDetails(data, req);
            const hasError = data.errorOccurred || errorInfo.httpStatusCode || data.error || data.errorMessage;
            
            // Ensure all required fields have values
            const usageData = {
                userId,
                service: data.service || data.provider || 'openai',
                model: sanitizeModelName(data.model),
                prompt: data.prompt || '',
                completion: data.completion,
                promptTokens: data.promptTokens,
                completionTokens: data.completionTokens,
                totalTokens: data.totalTokens || (data.promptTokens + data.completionTokens),
                cost: data.cost || data.estimatedCost || (() => {
                    try {
                        return calculateCost(
                            data.promptTokens,
                            data.completionTokens,
                            data.service || data.provider || 'openai',
                            data.model
                        );
                    } catch (error: any) {
                        console.warn(`Failed to calculate cost for ${data.service || data.provider}/${data.model}:`, error.message);
                        // Return 0 cost but still track the usage attempt
                        return 0;
                    }
                })(),
                responseTime: data.responseTime || 0,
                metadata: {
                    ...data.metadata,
                    // Enhanced request/response data
                    messages: data.messages,
                    system: data.system,
                    input: data.input,
                    output: data.output,
                    // Enhanced metadata for comprehensive tracking
                    requestMetadata: data.requestMetadata,
                    responseMetadata: data.responseMetadata
                },
                tags: data.tags || [],
                projectId: data.projectId,
                // Workflow tracking
                workflowId: data.workflowId,
                workflowName: data.workflowName,
                workflowStep: data.workflowStep,
                workflowSequence: data.workflowSequence,
                // Email tracking
                userAgent: req.headers['user-agent'],
                userEmail: data.userEmail,
                customerEmail: data.customerEmail,
                // Error tracking fields
                optimizationApplied: false,
                errorOccurred: hasError || false,
                errorMessage: data.errorMessage || (data.error?.message) || undefined,
                httpStatusCode: errorInfo.httpStatusCode,
                errorType: errorInfo.errorType,
                errorDetails: errorInfo.errorDetails,
                isClientError: errorInfo.isClientError || false,
                isServerError: errorInfo.isServerError || false,
                ipAddress: req.ip || req.connection?.remoteAddress
            };

            // Only add projectId if it exists and is valid
            if (projectId && typeof projectId === 'string' && projectId.trim() !== '') {
                (usageData as any).projectId = projectId.trim();
            }
            
            // DEBUG: Check workflow fields in usageData before service call
            console.log('🔍 WORKFLOW DEBUG - Before service call:', {
                workflowId: usageData.workflowId,
                workflowName: usageData.workflowName,
                workflowStep: usageData.workflowStep,
                workflowSequence: usageData.workflowSequence
            });

            // DEBUG: Log error information if present
            if (hasError) {
                console.log('🚨 ERROR TRACKING - Client integration error detected:', {
                    httpStatusCode: usageData.httpStatusCode,
                    errorType: usageData.errorType,
                    errorMessage: usageData.errorMessage,
                    isClientError: usageData.isClientError,
                    isServerError: usageData.isServerError,
                    service: usageData.service,
                    model: usageData.model,
                    userAgent: usageData.userAgent
                });
            }

            // Track usage
            const usage = await UsageService.trackUsage(usageData);
            if (!usage) {
                throw new Error('Usage creation returned null');
            }
            console.log('Usage tracked successfully:', usage._id);
            res.status(201).json({
                success: true,
                message: 'Usage tracked successfully from SDK',
                data: {
                    id: usage?._id,
                    cost: usage?.cost,
                    totalTokens: usage?.totalTokens
                }
            });
        } catch (error: any) {
            loggingService.error('Track usage from SDK failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            console.error('Full error:', error);
            // Always return a response
            res.status(500).json({
                success: false,
                error: 'Failed to track usage',
                message: error.message || 'Internal server error'
            });
        }
    }

    static async getUsage(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            // Handle both authenticated and unauthenticated requests
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            
            const { page, limit, sort, order } = paginationSchema.parse(req.query);

            // Parse custom properties from query parameters
            const customProperties: Record<string, string> = {};
            const propertyExists: string[] = [];
            
            Object.keys(req.query).forEach(key => {
                if (key.startsWith('property.')) {
                    const propertyName = key.substring(9); // Remove 'property.' prefix
                    const value = req.query[key] as string;
                    if (value && value !== '') {
                        // Try to parse JSON if the value looks like JSON, otherwise use as-is
                        try {
                            if (value.startsWith('{') || value.startsWith('[')) {
                                const parsed = JSON.parse(value);
                                customProperties[propertyName] = typeof parsed === 'string' ? parsed : value;
                            } else {
                                customProperties[propertyName] = value;
                            }
                        } catch {
                            customProperties[propertyName] = value;
                        }
                    }
                } else if (key.startsWith('propertyExists.')) {
                    const propertyName = key.substring(15); // Remove 'propertyExists.' prefix
                    if (req.query[key] === 'true') {
                        propertyExists.push(propertyName);
                    }
                }
            });

            const filters = {
                userId,
                projectId: req.query.projectId as string,
                service: req.query.service as string,
                model: req.query.model as string,
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
                minCost: req.query.minCost ? parseFloat(req.query.minCost as string) : undefined,
                maxCost: req.query.maxCost ? parseFloat(req.query.maxCost as string) : undefined,
                customProperties: Object.keys(customProperties).length > 0 ? customProperties : undefined,
                propertyExists: propertyExists.length > 0 ? propertyExists : undefined,
            };

            // Log custom properties for debugging
            loggingService.info('Raw query parameters received', {
                requestId: req.headers['x-request-id'] as string,
                userId,
                queryParams: req.query,
                hasCustomProperties: Object.keys(customProperties).length > 0
            });
            if (Object.keys(customProperties).length > 0) {
                loggingService.info('Custom properties filter applied', {
                    requestId: req.headers['x-request-id'] as string,
                    userId,
                    customProperties,
                    propertyExists
                });
            }

            // Handle search query
            const searchQuery = req.query.q as string;
            
            let result;
            if (searchQuery) {
                // Use search functionality if query is provided
                result = await UsageService.searchUsage(userId, searchQuery, {
                    page,
                    limit,
                    sort,
                    order,
                }, filters.projectId, filters);
            } else {
                // Use regular getUsage if no search query
                result = await UsageService.getUsage(filters, {
                    page,
                    limit,
                    sort,
                    order,
                });
            }

            res.json({
                success: true,
                data: result.data,
                pagination: result.pagination,
            });
        } catch (error: any) {
            loggingService.error('Get usage failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async getUsageByProject(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const { projectId } = req.params;
            const { page, limit, sort, order } = paginationSchema.parse(req.query);

            const filters = {
                userId,
                projectId,
                service: req.query.service as string,
                model: req.query.model as string,
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
                minCost: req.query.minCost ? parseFloat(req.query.minCost as string) : undefined,
                maxCost: req.query.maxCost ? parseFloat(req.query.maxCost as string) : undefined,
            };

            const result = await UsageService.getUsage(filters, {
                page,
                limit,
                sort,
                order,
            });

            res.json({
                success: true,
                data: result.data,
                pagination: result.pagination,
            });
        } catch (error: any) {
            loggingService.error('Get usage by project failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                projectId: req.params.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async getUsageStats(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const period = (req.query.period as 'daily' | 'weekly' | 'monthly') || 'monthly';
            const projectId = req.query.projectId as string;

            const stats = await UsageService.getUsageStats(userId, period, projectId);

            res.json({
                success: true,
                data: stats,
            });
        } catch (error: any) {
            loggingService.error('Get usage stats failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                period: req.query.period,
                projectId: req.query.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async bulkUploadUsage(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const { usageData } = req.body;

            if (!Array.isArray(usageData)) {
                res.status(400).json({
                    success: false,
                    message: 'Usage data must be an array',
                });
                return;
            }

            // Use timeout handling for bulk operations
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Bulk operation timeout')), UsageController.BULK_TIMEOUT);
            });

            const bulkPromise = UsageService.bulkTrackUsage(
                usageData.map(data => ({ userId, ...data }))
            );

            const bulkResults = await Promise.race([bulkPromise, timeoutPromise]);
            
            const results = bulkResults.map((usage, index) => ({
                index,
                id: usage?._id,
                success: true,
            }));
            
            const errors: any[] = []; // Will be populated by service if needed

            res.json({
                success: true,
                message: `Processed ${usageData.length} usage records`,
                data: {
                    successful: results.length,
                    failed: errors.length,
                    results,
                    errors,
                },
            });
        } catch (error: any) {
            loggingService.error('Bulk upload usage failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                usageDataCount: req.body?.usageData?.length || 0,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async updateUsage(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const { usageId } = req.params;
            const updateData = req.body;

            // Validate that the usage belongs to the user
            const existingUsage = await UsageService.getUsageById(usageId, userId);
            if (!existingUsage) {
                res.status(404).json({
                    success: false,
                    message: 'Usage record not found',
                });
                return;
            }

            const updatedUsage = await UsageService.updateUsage(usageId, updateData);

            res.json({
                success: true,
                message: 'Usage updated successfully',
                data: updatedUsage,
            });
        } catch (error: any) {
            loggingService.error('Update usage failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                usageId: req.params.usageId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async deleteUsage(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const { usageId } = req.params;

            // Validate that the usage belongs to the user
            const existingUsage = await UsageService.getUsageById(usageId, userId);
            if (!existingUsage) {
                res.status(404).json({
                    success: false,
                    message: 'Usage record not found',
                });
                return;
            }

            await UsageService.deleteUsage(usageId);

            res.json({
                success: true,
                message: 'Usage deleted successfully',
            });
        } catch (error: any) {
            loggingService.error('Delete usage failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                usageId: req.params.usageId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async detectAnomalies(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const projectId = req.query.projectId as string;

            const anomalies = await UsageService.detectAnomalies(userId, projectId);

            res.json({
                success: true,
                data: anomalies,
            });
        } catch (error: any) {
            loggingService.error('Detect anomalies failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                projectId: req.query.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async searchUsage(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const { q, page, limit, projectId } = req.query;

            if (!q) {
                res.status(400).json({
                    success: false,
                    message: 'Search query is required',
                });
            }

            const paginationOptions = paginationSchema.parse({ page, limit });
            const result = await UsageService.searchUsage(
                userId,
                q as string,
                paginationOptions,
                projectId as string
            );

            res.json({
                success: true,
                data: result.data,
                pagination: result.pagination,
            });
        } catch (error: any) {
            loggingService.error('Search usage failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                searchQuery: req.query.q,
                projectId: req.query.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async exportUsage(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const format = (req.query.format as 'json' | 'csv') || 'json';

            const filters = {
                userId,
                projectId: req.query.projectId as string,
                service: req.query.service as string,
                model: req.query.model as string,
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
            };

            // Get all data without pagination for export
            const result = await UsageService.getUsage(filters, {
                page: 1,
                limit: 10000, // Max export limit
            });

            if (format === 'csv') {
                const csv = [
                    'Date,Service,Model,Prompt,Tokens,Cost,Response Time',
                    ...result.data.map(u =>
                        `"${u.createdAt}","${u.service}","${u.model}","${u.prompt.replace(/"/g, '""')}",${u.totalTokens},${u.cost},${u.responseTime}`
                    ),
                ].join('\n');

                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=usage-export.csv');
                res.send(csv);
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename=usage-export.json');
                res.json(result.data);
            }
        } catch (error: any) {
            loggingService.error('Export usage failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                format: req.query.format,
                projectId: req.query.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async getRealTimeUsageSummary(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const { projectId } = req.query;

            const summary = await UsageService.getRealTimeUsageSummary(userId, projectId);

            res.json({
                success: true,
                data: summary
            });
        } catch (error: any) {
            loggingService.error('Get real-time usage summary failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                projectId: req.query.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async getRealTimeRequests(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const { projectId, limit = 100 } = req.query;

            const requests = await UsageService.getRealTimeRequests(userId, projectId, parseInt(limit as string));

            res.json({
                success: true,
                data: requests
            });
        } catch (error: any) {
            loggingService.error('Get real-time requests failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                projectId: req.query.projectId,
                limit: req.query.limit,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async getUsageAnalytics(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }
            const { 
                timeRange, 
                status, 
                model, 
                service, 
                projectId 
            } = req.query;

            // Use timeout handling for analytics
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Analytics timeout')), UsageController.ANALYTICS_TIMEOUT);
            });

            const analyticsPromise = UsageService.getUsageAnalytics(userId, {
                timeRange: timeRange as '1h' | '24h' | '7d' | '30d',
                status: status as 'all' | 'success' | 'error',
                model: model as string,
                service: service as string,
                projectId: projectId as string
            });

            const analytics = await Promise.race([analyticsPromise, timeoutPromise]);

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            loggingService.error('Get usage analytics failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                timeRange: req.query.timeRange,
                status: req.query.status,
                model: req.query.model,
                service: req.query.service,
                projectId: req.query.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async getCLIAnalytics(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }

            const { days = 30, project, user } = req.query;
            const daysNum = parseInt(days as string) || 30;

            const analytics = await UsageService.getCLIAnalytics(userId, {
                days: daysNum,
                project: project as string,
                user: user as string
            });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            loggingService.error('Get CLI analytics failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                days: req.query.days,
                project: req.query.project,
                user: req.query.user,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async getPropertyAnalytics(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }

            const { groupBy, startDate, endDate, projectId } = req.query;

            if (!groupBy) {
                return res.status(400).json({
                    success: false,
                    message: 'groupBy parameter is required',
                });
            }

            const options = {
                groupBy: groupBy as string,
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                projectId: projectId as string,
            };

            const analytics = await UsageService.getPropertyAnalytics(userId, options);

            res.json({
                success: true,
                data: analytics,
            });
        } catch (error: any) {
            loggingService.error('Get property analytics failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                groupBy: req.query.groupBy,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                projectId: req.query.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async getAvailableProperties(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }

            const { startDate, endDate, projectId } = req.query;

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                projectId: projectId as string,
            };

            const properties = await UsageService.getAvailableProperties(userId, options);

            res.json({
                success: true,
                data: properties,
            });
        } catch (error: any) {
            loggingService.error('Get available properties failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                projectId: req.query.projectId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async updateUsageProperties(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }

            const { usageId } = req.params;
            const properties = req.body;

            if (!usageId) {
                return res.status(400).json({
                    success: false,
                    message: 'Usage ID is required',
                });
            }

            if (!properties || typeof properties !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: 'Properties object is required',
                });
            }

            const updatedUsage = await UsageService.updateUsageProperties(usageId, userId, properties);

            if (!updatedUsage) {
                return res.status(404).json({
                    success: false,
                    message: 'Usage record not found or access denied',
                });
            }

            res.json({
                success: true,
                message: 'Usage properties updated successfully',
                data: {
                    id: updatedUsage._id,
                    updatedProperties: Object.keys(properties),
                    metadata: updatedUsage.metadata
                },
            });
        } catch (error: any) {
            loggingService.error('Update usage properties failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id || req.userId,
                hasUserId: !!(req.user?.id || req.userId),
                usageId: req.params.usageId,
                propertiesCount: req.body ? Object.keys(req.body).length : 0,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    /**
     * SSE endpoint for real-time usage updates
     * GET /api/usage/stream
     */
    static async streamUsageUpdates(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId || req.query.userId;
            
            if (!userId) {
                res.status(401).json({ message: 'User ID is required' });
                return;
            }

            loggingService.info('Initializing SSE connection for user', {
                requestId: req.headers['x-request-id'] as string,
                userId,
                hasUserId: !!userId
            });
            
            // Initialize SSE connection
            RealtimeUpdateService.initializeSSEConnection(userId, res);
            
            // Send initial usage data
            const recentUsage = await UsageService.getRecentUsageForUser(userId, 5);
            const stats = await UsageService.getUsageStats(userId, 'daily');
            
            res.write(`data: ${JSON.stringify({
                type: 'initial_data',
                data: {
                    recentUsage,
                    stats
                },
                timestamp: new Date().toISOString()
            })}\n\n`);

        } catch (error: any) {
            loggingService.error('SSE stream error', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.userId || req.query.userId,
                hasUserId: !!(req.userId || req.query.userId),
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            res.status(500).json({ message: 'SSE stream error' });
        }
    }

    /**
     * Authentication validation utility
     */
    private static validateAuthentication(userId: string, requestId: string, res: Response): boolean {
        if (!userId) {
            loggingService.warn('Authentication required', { requestId });
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return false;
        }
        return true;
    }

    /**
     * User data management utilities
     */
    private static getCachedUser(userId: string): any | null {
        const cached = this.userCache.get(userId);
        if (cached && (Date.now() - cached.timestamp) < this.USER_CACHE_TTL) {
            return cached.user;
        }
        if (cached) {
            this.userCache.delete(userId);
        }
        return null;
    }

    private static setCachedUser(userId: string, user: any): void {
        this.userCache.set(userId, {
            user,
            timestamp: Date.now()
        });
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.DB_CIRCUIT_BREAKER_RESET_TIME) {
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
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }

        // Clear user cache
        this.userCache.clear();
    }
}