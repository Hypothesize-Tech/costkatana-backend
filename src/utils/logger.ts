import winston from 'winston';
import path from 'path';
import { config } from '../config';
import { trace } from '@opentelemetry/api';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Safe JSON.stringify that handles circular references
const safeStringify = (obj: any): string => {
    const seen = new WeakSet();
    return JSON.stringify(obj, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular]';
            }
            seen.add(value);
        }
        // Handle Error objects specifically
        if (value instanceof Error) {
            return {
                name: value.name,
                message: value.message,
                stack: value.stack,
                cause: value.cause
            };
        }
        return value;
    });
};

// Format to inject trace context
const traceFormat = winston.format((info) => {
    const span = trace.getActiveSpan();
    if (span) {
        const spanContext = span.spanContext();
        info.trace_id = spanContext.traceId;
        info.span_id = spanContext.spanId;
        info.trace_flags = spanContext.traceFlags;
    }
    return info;
});

// Custom format for console logging
const consoleFormat = printf(({ level, message, timestamp, stack, trace_id, span_id, ...metadata }) => {
    let msg = `${timestamp} [${level}]`;
    
    // Add trace context if available
    if (trace_id && span_id) {
        msg += ` [trace_id=${trace_id} span_id=${span_id}]`;
    }
    
    msg += `: ${message}`;

    if (Object.keys(metadata).length > 0) {
        try {
            msg += ` ${safeStringify(metadata)}`;
        } catch (error) {
            msg += ` [Unable to stringify metadata]`;
        }
    }

    if (stack) {
        msg += `\n${stack}`;
    }

    return msg;
});

// Create logs directory
const logsDir = path.resolve(process.cwd(), config.logging.filePath);

// Logger configuration
export const logger = winston.createLogger({
    level: config.logging.level,
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        traceFormat(),
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
            format: combine(
                winston.format.json()
            ),
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            format: combine(
                winston.format.json()
            ),
        }),
    ],
});

// Create a stream object for Morgan
export const stream = {
    write: (message: string) => {
        logger.info(message.trim());
    },
};