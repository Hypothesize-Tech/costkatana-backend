import * as winston from 'winston';
import * as path from 'path';
import { config } from '../config';

// Log levels enum
export enum BasicLogLevel {
    OFF = 0,
    ERROR = 1,
    WARN = 2,
    INFO = 3,
    DEBUG = 4,
    VERBOSE = 5
}

// Basic log context interface
export interface BasicLogContext {
    component?: string;
    operation?: string;
    userId?: string;
    sessionId?: string;
    correlationId?: string;
    [key: string]: any;
}

/**
 * Basic Logger Service
 * 
 * Features:
 * - Static utility class for simple logging
 * - Sentry integration for error tracking
 * - Same log level system as Custom Logger
 * - Used for non-request-scoped logging
 * - Structured JSON output for easy parsing
 * - Environment-based configuration
 * - Circular reference protection
 */
export class BasicLoggerService {
    private static instance: BasicLoggerService;
    private logger: winston.Logger;
    private logLevel: BasicLogLevel;
    private sentryInitialized: boolean = false;

    private constructor() {
        this.logLevel = this.getLogLevelFromEnv();
        this.initializeSentry();
        this.logger = this.createLogger();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): BasicLoggerService {
        if (!BasicLoggerService.instance) {
            BasicLoggerService.instance = new BasicLoggerService();
        }
        return BasicLoggerService.instance;
    }

    /**
     * Initialize Sentry for error tracking
     */
    private initializeSentry(): void {
        const sentryDsn = process.env.SENTRY_DSN;

        if (sentryDsn && !this.sentryInitialized) {
            try {
                // Uncomment and configure Sentry if needed
                /*
                Sentry.init({
                    dsn: sentryDsn,
                    environment,
                    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
                    integrations: [
                        new Sentry.Integrations.Http({ tracing: true }),
                        new Sentry.Integrations.Express({ app: undefined }),
                    ],
                    beforeSend(event: any) {
                        // Filter out non-critical errors in production
                        if (environment === 'production' && event.level === 'warning') {
                            return null;
                        }
                        return event;
                    }
                });
                */
                this.sentryInitialized = true;
            } catch (error) {
                console.error('Failed to initialize Sentry:', error);
            }
        }
    }

    /**
     * Get log level from environment variable
     */
    private getLogLevelFromEnv(): BasicLogLevel {
        const envLevel = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
        
        switch (envLevel) {
            case 'OFF': return BasicLogLevel.OFF;
            case 'ERROR': return BasicLogLevel.ERROR;
            case 'WARN': return BasicLogLevel.WARN;
            case 'INFO': return BasicLogLevel.INFO;
            case 'DEBUG': return BasicLogLevel.DEBUG;
            case 'VERBOSE': return BasicLogLevel.VERBOSE;
            default: return BasicLogLevel.INFO;
        }
    }

    /**
     * Create Winston logger instance
     */
    private createLogger(): winston.Logger {
        const { combine, timestamp, printf, colorize, errors } = winston.format;

        // Custom format for structured logging
        const customFormat = printf(({ level, message, timestamp, component, operation, ...metadata }) => {
            const logEntry: any = {
                timestamp,
                level: level.toUpperCase(),
                message,
                ...(component ? { component } : {}),
                ...(operation ? { operation } : {}),
                ...(metadata && Object.keys(metadata).length > 0 ? { metadata: this.safeStringify(metadata) } : {})
            };

            return JSON.stringify(logEntry);
        });

        // Console format for development
        const consoleFormat = printf(({ level, message, timestamp, component, operation, ...metadata }) => {
            let msg = `${timestamp} [${level.toUpperCase()}]`;
            
            if (component) {
                msg += ` [${component}]`;
            }
            
            if (operation) {
                msg += ` [${operation}]`;
            }
            
            msg += `: ${message}`;

            if (Object.keys(metadata).length > 0) {
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
            transports: [
                // Console transport
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
            case BasicLogLevel.ERROR: return 'error';
            case BasicLogLevel.WARN: return 'warn';
            case BasicLogLevel.INFO: return 'info';
            case BasicLogLevel.DEBUG: return 'debug';
            case BasicLogLevel.VERBOSE: return 'verbose';
            default: return 'info';
        }
    }

    /**
     * Safe JSON stringification that handles circular references
     */
    private safeStringify(obj: any): string {
        const seen = new WeakSet();
        try {
            return JSON.stringify(obj, (_, value) => {
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
     * Check if logging level is enabled
     */
    private isLevelEnabled(level: BasicLogLevel): boolean {
        return this.logLevel >= level;
    }

    // ===== STATIC LOGGING METHODS =====

    /**
     * Log error message
     */
    static error(message: string, context: BasicLogContext = {}): void {
        const instance = BasicLoggerService.getInstance();
        if (!instance.isLevelEnabled(BasicLogLevel.ERROR)) return;
        instance.logger.error(message, context || {});
    }

    /**
     * Log warning message
     */
    static warn(message: string, context: BasicLogContext = {}): void {
        const instance = BasicLoggerService.getInstance();
        if (!instance.isLevelEnabled(BasicLogLevel.WARN)) return;
        
        instance.logger.warn(message, context || {});
    
    }

    /**
     * Log info message
     */
    static info(message: string, context: BasicLogContext = {}): void {
        const instance = BasicLoggerService.getInstance();
        if (!instance.isLevelEnabled(BasicLogLevel.INFO)) return;
        
        instance.logger.info(message, context);
    }

    /**
     * Log debug message
     */
    static debug(message: string, context: BasicLogContext = {}): void {
        const instance = BasicLoggerService.getInstance();
        if (!instance.isLevelEnabled(BasicLogLevel.DEBUG)) return;
        
        instance.logger.debug(message, context);
    }

    /**
     * Log verbose message
     */
    static verbose(message: string, context: BasicLogContext = {}): void {
        const instance = BasicLoggerService.getInstance();
        if (!instance.isLevelEnabled(BasicLogLevel.VERBOSE)) return;
        
        instance.logger.verbose(message, context);
    }

    // ===== SPECIALIZED STATIC METHODS =====

    /**
     * Log error with stack trace and Sentry integration
     */
    static logError(error: Error, context: BasicLogContext = {}): void {
        const instance = BasicLoggerService.getInstance();
        
        const errorContext = {
            ...context,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
                cause: (error as any).cause
            }
        };

        instance.logger.error(error.message, errorContext);
        
        // Send to Sentry if initialized
        if (instance.sentryInitialized) {
            // Uncomment if using Sentry
            /*
            Sentry.captureException(error, {
                tags: {
                    component: context.component,
                    operation: context.operation
                },
                extra: context
            });
            */
        }
    }

    /**
     * Log performance metrics
     */
    static logPerformance(operation: string, duration: number, context: BasicLogContext = {}): void {
        BasicLoggerService.info(`Performance: ${operation} took ${duration}ms`, {
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
    static logSecurity(event: string, context: BasicLogContext = {}): void {
        const instance = BasicLoggerService.getInstance();
        
        const securityContext = {
            ...context,
            security: true,
            event,
            timestamp: new Date().toISOString()
        };

        instance.logger.warn(`Security: ${event}`, securityContext);
        
        // Always send security events to Sentry if initialized
        if (instance.sentryInitialized) {
            // Uncomment if using Sentry
            // Sentry.captureMessage(`Security Event: ${event}`, 'warning');
        }
    }

    /**
     * Log business events
     */
    static logBusiness(event: string, context: BasicLogContext = {}): void {
        BasicLoggerService.info(`Business: ${event}`, {
            ...context,
            business: true,
            event,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log application startup events
     */
    static logStartup(message: string, context: BasicLogContext = {}): void {
        BasicLoggerService.info(`Startup: ${message}`, {
            ...context,
            startup: true,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log application shutdown events
     */
    static logShutdown(message: string, context: BasicLogContext = {}): void {
        BasicLoggerService.info(`Shutdown: ${message}`, {
            ...context,
            shutdown: true,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log system health events
     */
    static logHealth(status: 'healthy' | 'unhealthy' | 'degraded', context: BasicLogContext = {}): void {
        const level = status === 'healthy' ? 'info' : status === 'degraded' ? 'warn' : 'error';
        
        const instance = BasicLoggerService.getInstance();
        instance.logger[level](`Health: System is ${status}`, {
            ...context,
            health: {
                status,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Flush all logs and close Sentry
     */
    static async shutdown(): Promise<void> {
        const instance = BasicLoggerService.getInstance();
        
        return new Promise((resolve) => {
            instance.logger.end(() => {
                if (instance.sentryInitialized) {
                    // Uncomment if using Sentry
                    // Sentry.close(2000).then(() => resolve());
                    resolve();
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Set Sentry user context
     */
    static setSentryUser(_user: { id?: string; email?: string; username?: string }): void {
        const instance = BasicLoggerService.getInstance();
        if (instance.sentryInitialized) {
            // Uncomment if using Sentry
            // Sentry.setUser(user);
        }
    }

    /**
     * Add Sentry breadcrumb
     */
    static addBreadcrumb(_message: string, _category: string, _level: 'info' | 'warning' | 'error' = 'info'): void {
        const instance = BasicLoggerService.getInstance();
        if (instance.sentryInitialized) {
            // Uncomment if using Sentry
            /*
            Sentry.addBreadcrumb({
                message,
                category,
                level,
                timestamp: Date.now() / 1000
            });
            */
        }
    }
}

// Export singleton instance for convenience
export const basicLogger = BasicLoggerService.getInstance();
