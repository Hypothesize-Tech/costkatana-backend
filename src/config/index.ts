import dotenv from 'dotenv';
import path from 'path';

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
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}

export const config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '8000', 10),
    cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
        credentials: true,
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
};

export * from './database';
export * from './aws';
export * from './email';