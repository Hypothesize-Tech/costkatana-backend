import { loggingService } from '../src/services/logging.service';
import { enhancedLoggerMiddleware } from '../src/middleware/enhanced-logger.middleware';
import { EnhancedRequest } from '../src/middleware/enhanced-logger.middleware';

// ===== EXAMPLE 1: BASIC USAGE IN CONTROLLERS =====

export class ExampleController {
    async getUserData(req: EnhancedRequest, res: any) {
        const startTime = Date.now();
        
        try {
            // Set request context for logging
            loggingService.setRequestContext(req.requestId, req.userId);
            
            // Log the request
            loggingService.logRequest(req.method, req.originalUrl, {
                component: 'UserController',
                operation: 'getUserData',
                userId: req.params.userId,
            });

            // Simulate database operation
            const dbStartTime = Date.now();
            const userData = await this.fetchUserFromDatabase(req.params.userId);
            const dbDuration = Date.now() - dbStartTime;
            
            // Log database performance
            loggingService.logDatabaseOperation('read', 'users', dbDuration, true, {
                component: 'UserController',
                operation: 'getUserData',
                userId: req.params.userId,
            });

            // Simulate external API call
            const apiStartTime = Date.now();
            const externalData = await this.fetchExternalData(userData.externalId);
            const apiDuration = Date.now() - apiStartTime;
            
            // Log external API performance
            loggingService.logExternalAPI('ExternalProvider', '/api/data', apiDuration, true, 200, {
                component: 'UserController',
                operation: 'getUserData',
                userId: req.params.userId,
            });

            const totalDuration = Date.now() - startTime;
            
            // Log the response
            loggingService.logResponse(req.method, req.originalUrl, 200, totalDuration, {
                component: 'UserController',
                operation: 'getUserData',
                userId: req.params.userId,
            });

            // Log business event
            loggingService.logBusiness({
                event: 'UserDataRetrieved',
                category: 'UserActivity',
                value: 1,
                metadata: {
                    userId: req.params.userId,
                    dataSize: JSON.stringify(userData).length,
                },
            }, {
                component: 'UserController',
                operation: 'getUserData',
            });

            res.json({ success: true, data: userData });
            
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            
            // Log error
            loggingService.logError(error as Error, {
                component: 'UserController',
                operation: 'getUserData',
                userId: req.params.userId,
                requestId: req.requestId,
            });

            // Log security event for failed authentication
            if ((error as any).code === 'UNAUTHORIZED') {
                loggingService.logSecurity({
                    event: 'UnauthorizedAccess',
                    severity: 'MEDIUM',
                    source: 'UserController',
                    target: req.params.userId,
                    metadata: {
                        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
                        userAgent: req.headers['user-agent'],
                    },
                }, {
                    component: 'UserController',
                    operation: 'getUserData',
                });
            }

            // Log the error response
            loggingService.logResponse(req.method, req.originalUrl, 500, totalDuration, {
                component: 'UserController',
                operation: 'getUserData',
                userId: req.params.userId,
                error: (error as Error).message,
            });

            res.status(500).json({ success: false, error: 'Internal server error' });
        } finally {
            // Clear request context
            loggingService.clearRequestContext();
        }
    }

    private async fetchUserFromDatabase(userId: string) {
        // Simulate database operation
        return { id: userId, name: 'John Doe', externalId: 'ext123' };
    }

    private async fetchExternalData(externalId: string) {
        // Simulate external API call
        return { externalData: 'some data' };
    }
}

// ===== EXAMPLE 2: CACHE OPERATIONS =====

export class CacheService {
    async getCachedData(key: string, context: any = {}) {
        const startTime = Date.now();
        
        try {
            // Simulate cache hit/miss
            const cachedData = await this.checkCache(key);
            
            if (cachedData) {
                const duration = Date.now() - startTime;
                loggingService.logCacheOperation('hit', key, duration, {
                    ...context,
                    component: 'CacheService',
                    operation: 'getCachedData',
                });
                return cachedData;
            } else {
                const duration = Date.now() - startTime;
                loggingService.logCacheOperation('miss', key, duration, {
                    ...context,
                    component: 'CacheService',
                    operation: 'getCachedData',
                });
                
                // Fetch and cache data
                const data = await this.fetchData(key);
                await this.setCache(key, data);
                
                loggingService.logCacheOperation('set', key, undefined, {
                    ...context,
                    component: 'CacheService',
                    operation: 'getCachedData',
                });
                
                return data;
            }
        } catch (error) {
            loggingService.logError(error as Error, {
                ...context,
                component: 'CacheService',
                operation: 'getCachedData',
                key,
            });
            throw error;
        }
    }

    private async checkCache(key: string) {
        // Simulate cache check
        return null;
    }

    private async setCache(key: string, data: any) {
        // Simulate cache set
    }

    private async fetchData(key: string) {
        // Simulate data fetch
        return { data: 'fetched data' };
    }
}

// ===== EXAMPLE 3: PERFORMANCE MONITORING =====

export class PerformanceMonitor {
    async measureOperation<T>(
        operation: string,
        operationFn: () => Promise<T>,
        context: any = {}
    ): Promise<T> {
        const startTime = Date.now();
        
        try {
            const result = await operationFn();
            const duration = Date.now() - startTime;
            
            // Log successful performance
            loggingService.logPerformance({
                operation,
                duration,
                success: true,
                metadata: context,
            }, context);
            
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            
            // Log failed performance
            loggingService.logPerformance({
                operation,
                duration,
                success: false,
                error: (error as Error).message,
                metadata: context,
            }, context);
            
            throw error;
        }
    }
}

// ===== EXAMPLE 4: BUSINESS INTELLIGENCE =====

export class BusinessIntelligenceService {
    trackUserAction(action: string, userId: string, metadata: any = {}) {
        loggingService.logBusiness({
            event: action,
            category: 'UserAction',
            value: 1,
            metadata: {
                userId,
                ...metadata,
            },
        }, {
            component: 'BusinessIntelligenceService',
            operation: 'trackUserAction',
        });
    }

    trackRevenue(amount: number, currency: string, source: string, metadata: any = {}) {
        loggingService.logBusiness({
            event: 'RevenueGenerated',
            category: 'Financial',
            value: amount,
            currency,
            metadata: {
                source,
                ...metadata,
            },
        }, {
            component: 'BusinessIntelligenceService',
            operation: 'trackRevenue',
        });
    }
}

// ===== EXAMPLE 5: SECURITY MONITORING =====

export class SecurityMonitor {
    trackLoginAttempt(userId: string, success: boolean, ip: string, userAgent: string) {
        if (success) {
            loggingService.logSecurity({
                event: 'LoginSuccess',
                severity: 'LOW',
                source: 'AuthenticationService',
                target: userId,
                metadata: { ip, userAgent },
            }, {
                component: 'SecurityMonitor',
                operation: 'trackLoginAttempt',
            });
        } else {
            loggingService.logSecurity({
                event: 'LoginFailure',
                severity: 'MEDIUM',
                source: 'AuthenticationService',
                target: userId,
                metadata: { ip, userAgent },
            }, {
                component: 'SecurityMonitor',
                operation: 'trackLoginAttempt',
            });
        }
    }

    trackSuspiciousActivity(activity: string, severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', metadata: any = {}) {
        loggingService.logSecurity({
            event: activity,
            severity,
            source: 'SecurityMonitor',
            metadata,
        }, {
            component: 'SecurityMonitor',
            operation: 'trackSuspiciousActivity',
        });
    }
}

// ===== EXAMPLE 6: MIDDLEWARE INTEGRATION =====

export function setupEnhancedLogging(app: any) {
    // Use the enhanced logger middleware
    app.use(enhancedLoggerMiddleware);
    
    // Add error handling middleware
    app.use((error: any, req: EnhancedRequest, res: any, next: any) => {
        loggingService.logError(error, {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            requestId: req.requestId,
            userId: req.userId,
            method: req.method,
            endpoint: req.originalUrl,
        });
        
        // Log security event for 4xx/5xx errors
        if (error.status >= 400) {
            loggingService.logSecurity({
                event: 'HTTPError',
                severity: error.status >= 500 ? 'HIGH' : 'MEDIUM',
                source: 'ErrorMiddleware',
                target: req.originalUrl,
                metadata: {
                    statusCode: error.status,
                    error: error.message,
                    stack: error.stack,
                },
            }, {
                component: 'ErrorMiddleware',
                operation: 'errorHandler',
            });
        }
        
        next(error);
    });
}

// ===== EXAMPLE 7: ENVIRONMENT VARIABLES =====

/*
Add these environment variables to your .env file:

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Logging Configuration
LOG_LEVEL=info
LOG_FILE_PATH=./logs
NODE_ENV=production

# CloudWatch Configuration (optional)
CLOUDWATCH_LOG_GROUP=/ai-cost-optimizer/production
CLOUDWATCH_METRICS_NAMESPACE=AI-Cost-Optimizer

# Hostname for log identification
HOSTNAME=your-server-hostname
*/

// ===== EXAMPLE 8: CLOUDWATCH QUERIES =====

/*
Here are some useful CloudWatch Insights queries for analyzing your logs:

# Find all errors in the last hour
fields @timestamp, @message, level, error.name, error.message, requestId, userId
| filter level = "error"
| sort @timestamp desc

# Find slow requests (>1s) in the last hour
fields @timestamp, @message, method, endpoint, responseTime, requestId, userId
| filter responseTime > 1000
| sort responseTime desc

# Find security events in the last hour
fields @timestamp, @message, event, severity, source, target, ip
| filter type = "security"
| sort @timestamp desc

# Find performance metrics for specific operations
fields @timestamp, @message, operation, duration, success
| filter type = "performance"
| sort duration desc

# Find business events by category
fields @timestamp, @message, event, category, value, currency
| filter type = "business"
| sort @timestamp desc

# Find requests by specific user
fields @timestamp, @message, method, endpoint, statusCode, responseTime
| filter userId = "specific-user-id"
| sort @timestamp desc

# Find requests by IP address
fields @timestamp, @message, method, endpoint, ip, userAgent
| filter ip = "specific-ip-address"
| sort @timestamp desc
*/

// ===== EXAMPLE 9: CLOUDWATCH DASHBOARDS =====

/*
Create CloudWatch dashboards with these widgets:

1. HTTP Metrics Dashboard:
   - Request Count by Status Code
   - Response Time by Endpoint
   - Error Rate by Endpoint
   - Request Count by Method

2. Performance Dashboard:
   - Operation Duration by Operation
   - Success Rate by Operation
   - Cache Hit/Miss Ratio
   - Database Operation Duration

3. Security Dashboard:
   - Security Events by Severity
   - Security Events by Type
   - Failed Login Attempts
   - Suspicious Activity Count

4. Business Dashboard:
   - Business Events by Category
   - Revenue by Source
   - User Actions by Type
   - Event Count by Event Type

5. Infrastructure Dashboard:
   - Error Rate by Environment
   - Request Count by Environment
   - Response Time by Environment
   - Cache Performance by Environment
*/
