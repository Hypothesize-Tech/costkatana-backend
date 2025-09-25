import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({
    path: path.resolve(process.cwd(), process.env.NODE_ENV === 'production' ? '.env.production' : '.env'),
});

// Validate required environment variables
const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}

export const config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '8000', 10),
    cors: {
        origin: process.env.CORS_ORIGIN || '*', // Allow all origins for MCP compatibility
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'User-Agent', 'Accept', 'Cache-Control'],
        exposedHeaders: ['X-Response-Time-Priority', 'Cache-Control']
    },
    jwt: {
        secret: process.env.JWT_SECRET!,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!,
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    },
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
        max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        filePath: process.env.LOG_FILE_PATH || './logs',
    },
    encryption: {
        key: process.env.ENCRYPTION_KEY || 'default-encryption-key-change-this',
    },
    redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0', 10),
        url: process.env.REDIS_URL,
        // Connection options for BullMQ
        prefix: 'bull',
        enableOfflineQueue: true,
        // BullMQ requires maxRetriesPerRequest to be null
        maxRetriesPerRequest: null,
        connectTimeout: 5000,
        disconnectTimeout: 2000,
        lazyConnect: true,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    },
};

export * from './database';
export * from './aws';
export * from './email';
export * from './redis';
export * from './telemetry';
export * from './sentry'; 