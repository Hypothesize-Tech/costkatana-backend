import * as winston from 'winston';
import * as path from 'path';
import { config } from '../config';

// Log levels enum
export enum LogLevel {
    OFF = 0,
    ERROR = 1,
    WARN = 2,
    INFO = 3,
    DEBUG = 4,
    VERBOSE = 5
}

// Log context interface
export interface LogContext {
    requestId?: string;
    userId?: string;
    sessionId?: string;
    correlationId?: string;
    component?: string;
    operation?: string;
    className?: string;
    executionTime?: number;
    [key: string]: any;
}

// Performance metric interface
export interface PerformanceMetric {
    operation: string;
    duration: number;
    success: boolean;
    error?: string;
    metadata?: Record<string, any>;
}

/**
 * Custom Logger Service
 * 
 * Features:
 * - Request-scoped service (one instance per request)
 * - Structured JSON logging with consistent format
 * - Log levels: OFF, ERROR, WARN, INFO, DEBUG, VERBOSE
 * - Request ID tracking
 * - Execution time measurement
 * - Class name context
 * - Safe JSON stringification (prevents circular references)
 * - Configurable log levels via LOG_LEVEL env var
 */
export class CustomLoggerService {
    private requestId: string;
    private userId?: string;
    private startTime: number;
    private logger: winston.Logger;
    private logLevel: LogLevel;

    constructor(requestId: string, className?: string) {
        this.requestId = requestId;
        this.startTime = Date.now();
        this.logLevel = this.getLogLevelFromEnv();
        
        // Create Winston logger instance
        this.logger = this.createLogger(className);
    }

    /**
     * Get log level from environment variable
     */
    private getLogLevelFromEnv(): LogLevel {
        const envLevel = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
        
        switch (envLevel) {
            case 'OFF': return LogLevel.OFF;
            case 'ERROR': return LogLevel.ERROR;
            case 'WARN': return LogLevel.WARN;
            case 'INFO': return LogLevel.INFO;
            case 'DEBUG': return LogLevel.DEBUG;
            case 'VERBOSE': return LogLevel.VERBOSE;
            default: return LogLevel.INFO;
        }
    }

    /**
     * Create Winston logger instance
     */
    private createLogger(className?: string): winston.Logger {
        const { combine, timestamp, printf, colorize, errors } = winston.format;

        // Custom format for structured logging
        const customFormat = printf(({ level, message, timestamp, requestId, userId, className: cls, executionTime, ...metadata }) => {
            const logEntry: any = {
                timestamp,
                level: level.toUpperCase(),
                message,
                requestId: requestId || this.requestId,
                userId: userId || this.userId,
                executionTime: executionTime || this.getExecutionTime(),
                ...(cls ? { className: cls } : {}),
                ...(metadata && Object.keys(metadata).length > 0 ? { metadata: this.safeStringify(metadata) } : {})
            };

            return JSON.stringify(logEntry);
        });

        // Console format for development
        const consoleFormat = printf(({ level, message, timestamp, requestId, userId, className: cls, executionTime, ...metadata }) => {
            let msg = `${timestamp} [${level.toUpperCase()}]`;
            
            if (requestId || this.requestId) {
                msg += ` [${requestId || this.requestId}]`;
            }
            
            if (userId || this.userId) {
                msg += ` [User: ${userId || this.userId}]`;
            }
            
            if (cls || className) {
                msg += ` [${cls || className}]`;
            }
            
            msg += `: ${message}`;

            const execTime = executionTime || this.getExecutionTime();
            if (typeof execTime === 'number' && execTime > 0) {
                msg += ` (${execTime}ms)`;
            }

            if (metadata && Object.keys(metadata).length > 0) {
                try {
                    msg += ` ${this.safeStringify(metadata)}`;
                } catch (error) {
                    msg += ` [Unable to stringify metadata]`;
                }
            }

            return msg;
        });

        // Create logs directory
        const logsDir = path.resolve(process.cwd(), config.logging?.filePath || 'logs');

        return winston.createLogger({
            level: this.getWinstonLevel(),
            format: combine(
                errors({ stack: true }),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            ),
            defaultMeta: {
                requestId: this.requestId,
                className
            },
            transports: [
                // Console transport for development
                new winston.transports.Console({
                    format: combine(
                        colorize(),
                        consoleFormat
                    ),
                }),
                // File transport for errors
                new winston.transports.File({
                    filename: path.join(logsDir, 'error.log'),
                    level: 'error',
                    format: combine(customFormat),
                }),
                // File transport for all logs
                new winston.transports.File({
                    filename: path.join(logsDir, 'combined.log'),
                    format: combine(customFormat),
                }),
            ],
        });
    }

    /**
     * Convert custom log level to Winston level
     */
    private getWinstonLevel(): string {
        switch (this.logLevel) {
            case LogLevel.ERROR: return 'error';
            case LogLevel.WARN: return 'warn';
            case LogLevel.INFO: return 'info';
            case LogLevel.DEBUG: return 'debug';
            case LogLevel.VERBOSE: return 'verbose';
            default: return 'info';
        }
    }

    /**
     * Safe JSON stringification that handles circular references
     */
    private safeStringify(obj: any): string {
        const seen = new WeakSet();
        try {
            return JSON.stringify(obj, (_key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) {
                        return '[Circular]';
                    }
                    seen.add(value);
                }
                
                // Handle Error objects
                if (value instanceof Error) {
                    return {
                        name: value.name,
                        message: value.message,
                        stack: value.stack,
                        cause: (value as any).cause
                    };
                }
                
                return value;
            });
        } catch (error) {
            return '[Unable to stringify]';
        }
    }

    /**
     * Get execution time since logger creation
     */
    private getExecutionTime(): number {
        return Date.now() - this.startTime;
    }

    /**
     * Check if logging level is enabled
     */
    private isLevelEnabled(level: LogLevel): boolean {
        return this.logLevel >= level;
    }

    /**
     * Set request context
     */
    setRequestContext(requestId: string, userId?: string): void {
        this.requestId = requestId;
        this.userId = userId;
        this.logger.defaultMeta = {
            ...this.logger.defaultMeta,
            requestId,
            userId
        };
    }

    /**
     * Clear request context
     */
    clearRequestContext(): void {
        this.userId = undefined;
    }

    // ===== BASIC LOGGING METHODS =====

    /**
     * Log error message
     */
    error(message: string, context: LogContext = {}): void {
        if (!this.isLevelEnabled(LogLevel.ERROR)) return;
        
        this.logger.error(message, {
            ...(context || {}),
            requestId: this.requestId,
            userId: this.userId,
            executionTime: this.getExecutionTime()
        });
    }

    /**
     * Log warning message
     */
    warn(message: string, context: LogContext = {}): void {
        if (!this.isLevelEnabled(LogLevel.WARN)) return;
        
        this.logger.warn(message, {
            ...(context || {}),
            requestId: this.requestId,
            userId: this.userId,
            executionTime: this.getExecutionTime()
        });
    }

    /**
     * Log info message
     */
    info(message: string, context: LogContext = {}): void {
        if (!this.isLevelEnabled(LogLevel.INFO)) return;
        
        this.logger.info(message, {
            ...(context || {}),
            requestId: this.requestId,
            userId: this.userId,
            executionTime: this.getExecutionTime()
        });
    }

    /**
     * Log debug message
     */
    debug(message: string, context: LogContext = {}): void {
        if (!this.isLevelEnabled(LogLevel.DEBUG)) return;
        
        this.logger.debug(message, {
            ...(context || {}),
            requestId: this.requestId,
            userId: this.userId,
            executionTime: this.getExecutionTime()
        });
    }

    /**
     * Log verbose message
     */
    verbose(message: string, context: LogContext = {}): void {
        if (!this.isLevelEnabled(LogLevel.VERBOSE)) return;
        
        this.logger.verbose(message, {
            ...(context || {}),
            requestId: this.requestId,
            userId: this.userId,
            executionTime: this.getExecutionTime()
        });
    }

    // ===== SPECIALIZED LOGGING METHODS =====

    /**
     * Log error with stack trace
     */
    logError(error: Error, context: LogContext = {}): void {
        this.error(error.message, {
            ...(context || {}),
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
                cause: (error as any).cause
            }
        });
    }

    /**
     * Log performance metrics
     */
    logPerformance(operation: string, duration: number, context: LogContext = {}): void {
        this.info(`Performance: ${operation}`, {
            ...context,
            performance: {
                operation,
                duration,
                durationMs: `${duration}ms`
            }
        });
    }

    /**
     * Log security events
     */
    logSecurity(event: string, context: LogContext = {}): void {
        this.warn(`Security: ${event}`, {
            ...context,
            security: true,
            event
        });
    }

    /**
     * Log business events
     */
    logBusiness(event: string, context: LogContext = {}): void {
        this.info(`Business: ${event}`, {
            ...context,
            business: true,
            event
        });
    }

    /**
     * Log HTTP request
     */
    logRequest(method: string, endpoint: string, context: LogContext = {}): void {
        this.info(`Request: ${method} ${endpoint}`, {
            ...context,
            request: {
                method,
                endpoint,
                type: 'incoming'
            }
        });
    }

    /**
     * Log HTTP response
     */
    logResponse(method: string, endpoint: string, statusCode: number, responseTime: number, context: LogContext = {}): void {
        const level = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'info';
        
        this.logger[level](`Response: ${method} ${endpoint} ${statusCode} ${responseTime}ms`, {
            ...context,
            response: {
                method,
                endpoint,
                statusCode,
                responseTime,
                type: 'outgoing'
            }
        });
    }

    /**
     * Log database operations
     */
    logDatabase(operation: string, collection: string, duration: number, context: LogContext = {}): void {
        this.debug(`Database: ${operation} on ${collection}`, {
            ...context,
            database: {
                operation,
                collection,
                duration,
                durationMs: `${duration}ms`
            }
        });
    }

    /**
     * Log external API calls
     */
    logExternalApi(method: string, url: string, statusCode: number, duration: number, context: LogContext = {}): void {
        const level = statusCode >= 400 ? 'error' : 'info';
        
        this.logger[level](`External API: ${method} ${url} ${statusCode} ${duration}ms`, {
            ...context,
            externalApi: {
                method,
                url,
                statusCode,
                duration,
                durationMs: `${duration}ms`
            }
        });
    }

    /**
     * Log cache operations
     */
    logCache(operation: string, key: string, hit: boolean, context: LogContext = {}): void {
        this.debug(`Cache: ${operation} ${key} ${hit ? 'HIT' : 'MISS'}`, {
            ...context,
            cache: {
                operation,
                key,
                hit,
                result: hit ? 'HIT' : 'MISS'
            }
        });
    }

    /**
     * Create child logger with additional context
     */
    child(context: LogContext): CustomLoggerService {
        const childLogger = new CustomLoggerService(this.requestId, context.className);
        childLogger.userId = this.userId;
        childLogger.logger.defaultMeta = {
            ...childLogger.logger.defaultMeta,
            ...context
        };
        return childLogger;
    }
}
