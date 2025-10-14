import { ServiceError } from '../shared/BaseService';
import { loggingService } from '../services/logging.service';
import * as Sentry from '@sentry/node';

export enum ErrorSeverity {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
}

export enum ErrorCategory {
    VALIDATION = 'validation',
    AUTHENTICATION = 'authentication',
    AUTHORIZATION = 'authorization',
    DATABASE = 'database',
    EXTERNAL_SERVICE = 'external_service',
    BUSINESS_LOGIC = 'business_logic',
    SYSTEM = 'system',
    NETWORK = 'network',
    TIMEOUT = 'timeout',
    RATE_LIMIT = 'rate_limit'
}

export interface ErrorContext {
    userId?: string;
    requestId?: string;
    operation?: string;
    component?: string;
    additionalData?: Record<string, any>;
}

export interface ProcessedError {
    id: string;
    message: string;
    code: string;
    statusCode: number;
    severity: ErrorSeverity;
    category: ErrorCategory;
    context: ErrorContext;
    timestamp: Date;
    stack?: string;
    shouldRetry: boolean;
    retryAfter?: number;
}

/**
 * Centralized Error Handler
 * Provides standardized error processing, categorization, and reporting
 */
export class ErrorHandler {
    private static errorCount = new Map<string, number>();
    private static lastErrorTime = new Map<string, number>();
    
    // Error classification patterns
    private static readonly ERROR_PATTERNS = {
        [ErrorCategory.DATABASE]: [
            /connection.*refused/i,
            /timeout.*database/i,
            /mongodb.*error/i,
            /duplicate.*key/i,
            /validation.*failed/i
        ],
        [ErrorCategory.NETWORK]: [
            /network.*error/i,
            /connection.*timeout/i,
            /socket.*hang.*up/i,
            /econnreset/i,
            /enotfound/i
        ],
        [ErrorCategory.AUTHENTICATION]: [
            /invalid.*token/i,
            /unauthorized/i,
            /authentication.*failed/i,
            /invalid.*credentials/i
        ],
        [ErrorCategory.AUTHORIZATION]: [
            /forbidden/i,
            /access.*denied/i,
            /insufficient.*permissions/i,
            /not.*authorized/i
        ],
        [ErrorCategory.VALIDATION]: [
            /validation.*error/i,
            /invalid.*input/i,
            /bad.*request/i,
            /missing.*required/i
        ],
        [ErrorCategory.RATE_LIMIT]: [
            /rate.*limit/i,
            /too.*many.*requests/i,
            /quota.*exceeded/i,
            /throttled/i
        ],
        [ErrorCategory.TIMEOUT]: [
            /timeout/i,
            /operation.*exceeded.*time/i,
            /request.*timeout/i
        ]
    };

    /**
     * Process and categorize an error
     */
    public static processError(
        error: Error | ServiceError | any,
        context: ErrorContext = {}
    ): ProcessedError {
        const errorId = this.generateErrorId();
        const timestamp = new Date();
        
        // Extract error information
        const message = error?.message || 'Unknown error occurred';
        const stack = error?.stack;
        
        // Determine if it's already a ServiceError
        let code: string;
        let statusCode: number;
        
        if (error instanceof ServiceError) {
            code = error.code;
            statusCode = error.statusCode;
        } else {
            const classification = this.classifyError(error);
            code = classification.code;
            statusCode = classification.statusCode;
        }

        // Categorize and determine severity
        const category = this.categorizeError(message);
        const severity = this.determineSeverity(statusCode, category, message);
        
        // Determine retry behavior
        const { shouldRetry, retryAfter } = this.determineRetryBehavior(
            category, 
            statusCode, 
            context.component || 'unknown'
        );

        const processedError: ProcessedError = {
            id: errorId,
            message,
            code,
            statusCode,
            severity,
            category,
            context,
            timestamp,
            stack,
            shouldRetry,
            retryAfter
        };

        // Log the error
        this.logError(processedError);
        
        // Report to monitoring systems
        this.reportError(processedError, error);
        
        // Track error patterns
        this.trackErrorPattern(processedError);

        return processedError;
    }

    /**
     * Create a standardized ServiceError from any error
     */
    public static createServiceError(
        error: Error | any,
        context: ErrorContext = {}
    ): ServiceError {
        const processed = this.processError(error, context);
        
        return new ServiceError(
            processed.message,
            processed.code,
            processed.statusCode,
            {
                ...processed.context,
                errorId: processed.id,
                category: processed.category,
                severity: processed.severity
            }
        );
    }

    /**
     * Handle async operation with comprehensive error processing
     */
    public static async handleAsync<T>(
        operation: () => Promise<T>,
        context: ErrorContext = {}
    ): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            throw this.createServiceError(error, context);
        }
    }

    /**
     * Classify unknown errors
     */
    private static classifyError(error: any): { code: string; statusCode: number } {
        const message = error?.message?.toLowerCase() || '';
        
        // Network errors
        if (message.includes('econnrefused') || message.includes('network')) {
            return { code: 'NETWORK_ERROR', statusCode: 503 };
        }
        
        // Timeout errors
        if (message.includes('timeout')) {
            return { code: 'TIMEOUT_ERROR', statusCode: 408 };
        }
        
        // Database errors
        if (message.includes('mongodb') || message.includes('database')) {
            return { code: 'DATABASE_ERROR', statusCode: 500 };
        }
        
        // Validation errors
        if (message.includes('validation') || message.includes('invalid')) {
            return { code: 'VALIDATION_ERROR', statusCode: 400 };
        }
        
        // Default classification
        return { code: 'INTERNAL_ERROR', statusCode: 500 };
    }

    /**
     * Categorize error based on message patterns
     */
    private static categorizeError(message: string): ErrorCategory {
        const lowerMessage = message.toLowerCase();
        
        for (const [category, patterns] of Object.entries(this.ERROR_PATTERNS)) {
            for (const pattern of patterns) {
                if (pattern.test(lowerMessage)) {
                    return category as ErrorCategory;
                }
            }
        }
        
        return ErrorCategory.SYSTEM;
    }

    /**
     * Determine error severity
     */
    private static determineSeverity(
        statusCode: number,
        category: ErrorCategory,
        message: string
    ): ErrorSeverity {
        // Critical errors
        if (statusCode >= 500 && (
            category === ErrorCategory.DATABASE ||
            category === ErrorCategory.SYSTEM ||
            message.toLowerCase().includes('critical')
        )) {
            return ErrorSeverity.CRITICAL;
        }
        
        // High severity errors
        if (statusCode >= 500 || 
            category === ErrorCategory.AUTHENTICATION ||
            category === ErrorCategory.AUTHORIZATION) {
            return ErrorSeverity.HIGH;
        }
        
        // Medium severity errors
        if (statusCode >= 400 ||
            category === ErrorCategory.VALIDATION ||
            category === ErrorCategory.BUSINESS_LOGIC) {
            return ErrorSeverity.MEDIUM;
        }
        
        return ErrorSeverity.LOW;
    }

    /**
     * Determine retry behavior
     */
    private static determineRetryBehavior(
        category: ErrorCategory,
        statusCode: number,
        component: string
    ): { shouldRetry: boolean; retryAfter?: number } {
        // Never retry these categories
        const nonRetryableCategories = [
            ErrorCategory.AUTHENTICATION,
            ErrorCategory.AUTHORIZATION,
            ErrorCategory.VALIDATION
        ];
        
        if (nonRetryableCategories.includes(category)) {
            return { shouldRetry: false };
        }
        
        // Never retry 4xx client errors (except 408, 429)
        if (statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
            return { shouldRetry: false };
        }
        
        // Rate limit - retry with delay
        if (category === ErrorCategory.RATE_LIMIT || statusCode === 429) {
            return { shouldRetry: true, retryAfter: 60000 }; // 1 minute
        }
        
        // Timeout - retry with shorter delay
        if (category === ErrorCategory.TIMEOUT || statusCode === 408) {
            return { shouldRetry: true, retryAfter: 5000 }; // 5 seconds
        }
        
        // Network/Database - retry with exponential backoff
        if (category === ErrorCategory.NETWORK || category === ErrorCategory.DATABASE) {
            const errorKey = `${component}_${category}`;
            const errorCount = this.errorCount.get(errorKey) || 0;
            const retryAfter = Math.min(1000 * Math.pow(2, errorCount), 30000); // Max 30 seconds
            
            return { shouldRetry: errorCount < 3, retryAfter };
        }
        
        return { shouldRetry: false };
    }

    /**
     * Log error with appropriate level
     */
    private static logError(error: ProcessedError): void {
        const logData = {
            errorId: error.id,
            code: error.code,
            category: error.category,
            severity: error.severity,
            component: error.context.component,
            operation: error.context.operation,
            userId: error.context.userId,
            requestId: error.context.requestId,
            shouldRetry: error.shouldRetry,
            retryAfter: error.retryAfter,
            additionalData: error.context.additionalData
        };

        switch (error.severity) {
            case ErrorSeverity.CRITICAL:
                loggingService.error(`CRITICAL ERROR: ${error.message}`, logData);
                break;
            case ErrorSeverity.HIGH:
                loggingService.error(`HIGH SEVERITY: ${error.message}`, logData);
                break;
            case ErrorSeverity.MEDIUM:
                loggingService.warn(`MEDIUM SEVERITY: ${error.message}`, logData);
                break;
            case ErrorSeverity.LOW:
                loggingService.info(`LOW SEVERITY: ${error.message}`, logData);
                break;
        }
    }

    /**
     * Report error to monitoring systems
     */
    private static reportError(processedError: ProcessedError, originalError: any): void {
        try {
            // Report to Sentry for critical and high severity errors
            if (processedError.severity === ErrorSeverity.CRITICAL || 
                processedError.severity === ErrorSeverity.HIGH) {
                
                Sentry.withScope((scope) => {
                    scope.setTag('errorCategory', processedError.category);
                    scope.setTag('errorSeverity', processedError.severity);
                    scope.setTag('errorCode', processedError.code);
                    scope.setLevel(processedError.severity === ErrorSeverity.CRITICAL ? 'fatal' : 'error');
                    
                    if (processedError.context.userId) {
                        scope.setUser({ id: processedError.context.userId });
                    }
                    
                    if (processedError.context.component) {
                        scope.setTag('component', processedError.context.component);
                    }
                    
                    scope.setContext('errorDetails', {
                        errorId: processedError.id,
                        shouldRetry: processedError.shouldRetry,
                        retryAfter: processedError.retryAfter,
                        additionalData: processedError.context.additionalData
                    });
                    
                    Sentry.captureException(originalError || new Error(processedError.message));
                });
            }
        } catch (reportingError) {
            loggingService.warn('Failed to report error to monitoring systems', {
                errorId: processedError.id,
                reportingError: reportingError instanceof Error ? reportingError.message : String(reportingError)
            });
        }
    }

    /**
     * Track error patterns for analysis
     */
    private static trackErrorPattern(error: ProcessedError): void {
        const patternKey = `${error.context.component || 'unknown'}_${error.category}`;
        const currentCount = this.errorCount.get(patternKey) || 0;
        
        this.errorCount.set(patternKey, currentCount + 1);
        this.lastErrorTime.set(patternKey, Date.now());
        
        // Alert on error spikes
        if (currentCount > 0 && currentCount % 10 === 0) {
            loggingService.warn('Error pattern detected', {
                pattern: patternKey,
                count: currentCount,
                category: error.category,
                component: error.context.component,
                recentErrorId: error.id
            });
        }
    }

    /**
     * Generate unique error ID
     */
    private static generateErrorId(): string {
        return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get error statistics
     */
    public static getErrorStats(): {
        errorCounts: Record<string, number>;
        recentErrors: Array<{ pattern: string; count: number; lastOccurrence: Date }>;
    } {
        const recentErrors = Array.from(this.errorCount.entries()).map(([pattern, count]) => ({
            pattern,
            count,
            lastOccurrence: new Date(this.lastErrorTime.get(pattern) || 0)
        })).sort((a, b) => b.lastOccurrence.getTime() - a.lastOccurrence.getTime());

        return {
            errorCounts: Object.fromEntries(this.errorCount),
            recentErrors: recentErrors.slice(0, 20) // Top 20 recent error patterns
        };
    }

    /**
     * Reset error tracking (useful for testing)
     */
    public static resetTracking(): void {
        this.errorCount.clear();
        this.lastErrorTime.clear();
    }
}
