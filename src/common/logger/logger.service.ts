import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import * as path from 'path';
import { trace } from '@opentelemetry/api';
import type { LoggingConfig } from '../../config/app.config';

const { combine, timestamp, printf, colorize, errors } = winston.format;

function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: value.cause,
      };
    }
    return value;
  });
}

const traceFormat = winston.format((info) => {
  const span = trace.getActiveSpan();
  if (span) {
    const ctx = span.spanContext();
    info.trace_id = ctx.traceId;
    info.span_id = ctx.spanId;
    info.trace_flags = ctx.traceFlags;
  }
  return info;
});

const consoleFormat = printf(
  ({ level, message, timestamp, stack, trace_id, span_id, ...meta }) => {
    let msg = `${timestamp} [${level}]`;
    if (trace_id && span_id)
      msg += ` [trace_id=${trace_id} span_id=${span_id}]`;
    msg += `: ${message}`;
    if (Object.keys(meta).length > 0) {
      try {
        msg += ` ${safeStringify(meta)}`;
      } catch {
        msg += ' [Unable to stringify metadata]';
      }
    }
    if (stack) msg += `\n${stack}`;
    return msg;
  },
);

@Injectable()
export class LoggerService {
  private logger: winston.Logger;

  constructor(private configService: ConfigService) {
    const logging = this.configService.get<LoggingConfig>('logging');
    const level = logging?.level ?? 'info';
    const filePath = logging?.filePath ?? './logs';
    const logsDir = path.resolve(process.cwd(), filePath);

    this.logger = winston.createLogger({
      level,
      format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        traceFormat(),
      ),
      transports: [
        new winston.transports.Console({
          format: combine(colorize(), consoleFormat),
        }),
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          format: winston.format.json(),
        }),
        new winston.transports.File({
          filename: path.join(logsDir, 'combined.log'),
          format: winston.format.json(),
        }),
      ],
    });
  }

  log(message: string, context?: string | Record<string, unknown>): void {
    const meta = typeof context === 'string' ? { context } : (context ?? {});
    this.logger.info(message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, meta);
  }

  logError(err: Error, meta?: Record<string, unknown>): void {
    this.logger.error(err.message, {
      ...meta,
      stack: err.stack,
      name: err.name,
      cause: err.cause,
    });
  }

  getWinston(): winston.Logger {
    return this.logger;
  }
}
