import winston from 'winston';
import path from 'path';
import { config } from '../config';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom format for console logging
const consoleFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;

    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
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