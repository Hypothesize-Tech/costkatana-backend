import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import morgan from 'morgan';
import { config } from './config';
import { connectDatabase } from './config/database';
import { errorHandler, notFoundHandler, securityLogger } from './middleware/error.middleware';
import { sanitizeInput } from './middleware/validation.middleware';
import { logger, stream } from './utils/logger';
import { apiRouter } from './routes';
import { intelligenceService } from './services/intelligence.service';
import { setupCronJobs } from './utils/cronJobs';
import cookieParser from 'cookie-parser';
import { recordRateLimit, securityMonitor } from './utils/security-monitor';

// Create Express app
const app: Application = express();

// Trust proxy
app.set('trust proxy', 1);

// Memory optimization settings
if (process.env.NODE_ENV === 'production') {
    // Force garbage collection more frequently
    if (global.gc && typeof global.gc === 'function') {
        setInterval(() => {
            if (global.gc) {
                global.gc();
            }
        }, 30000); // Every 30 seconds
    }
}

// Enhanced security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// Security logging middleware
app.use(securityLogger);

// CORS
app.use(cors(config.cors));

// Body parsing with stricter limits to prevent memory issues
app.use(express.json({ 
    limit: '100mb', // Reduced from 10mb to prevent memory issues
    verify: (_req: Request, res: Response, buf: Buffer) => {
        // Stream large requests to prevent memory buildup
        if (buf.length > 1024 * 1024 * 100) { // 100MB
            res.status(413).json({ error: 'Request too large' });
            return;
        }
    }
}));
app.use(express.urlencoded({ 
    extended: true, 
    limit: '100mb', // Reduced from 10mb
    parameterLimit: 100 // Limit number of parameters
}));

// Cookie parsing
app.use(cookieParser());

// Compression
app.use(compression());

// Custom logging middleware to filter health checks
const customLogger = morgan('combined', {
    stream,
    skip: (req: Request, res: Response) => {
        // Skip logging for health checks from ELB
        const isHealthCheck = req.path === '/' &&
            req.method === 'GET' &&
            req.get('User-Agent')?.includes('ELB-HealthChecker');

        // Skip logging for successful requests from health checkers
        if (isHealthCheck && res.statusCode < 400) {
            return true;
        }

        return false;
    }
});

// Apply custom logging
app.use(customLogger);

// Enhanced rate limiting
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window per IP
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: 15 * 60 // seconds
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
        // Use forwarded IP for rate limiting in case of proxy
        return req.ip || 'unknown';
    },
    handler: (req: Request, res: Response) => {
        recordRateLimit(req.ip || 'unknown', req.path, req.method, req.get('User-Agent') || 'unknown', {
            type: 'global_rate_limit',
            windowMs: 15 * 60 * 1000,
            max: 100
        });
        res.status(429).json({
            error: 'Too many requests from this IP, please try again later.',
            retryAfter: 15 * 60
        });
    }
});

// Apply global rate limiting to all routes
app.use('/api/', globalLimiter);

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: 15 * 60
    },
    skipSuccessfulRequests: true,
    keyGenerator: (req: Request) => {
        return req.ip || 'unknown';
    },
    handler: (req: Request, res: Response) => {
        recordRateLimit(req.ip || 'unknown', req.path, req.method, req.get('User-Agent') || 'unknown', {
            type: 'auth_rate_limit',
            windowMs: 15 * 60 * 1000,
            max: 5
        });
        res.status(429).json({
            error: 'Too many authentication attempts, please try again later.',
            retryAfter: 15 * 60
        });
    }
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Sanitize input
app.use(sanitizeInput);

// API routes
app.use('/api', apiRouter);

// Health check route with minimal logging
app.get('/', (req, res) => {
    const isHealthCheck = req.get('User-Agent')?.includes('ELB-HealthChecker');

    if (!isHealthCheck) {
        logger.info('Health check accessed', {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
    }

    res.json({
        success: true,
        message: 'AI Cost Optimizer Backend API',
        version: '1.0.0',
        docs: '/api-docs',
        timestamp: new Date().toISOString()
    });
});

// Health check route specifically for load balancers
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Security monitoring dashboard (protected endpoint)
app.get('/security-dashboard', (req, res): any => {
    // Simple IP-based protection for security dashboard
    const allowedIPs = ['*'];
    const clientIP = req.ip || 'unknown';

    // For production, you should implement proper authentication
    if (process.env.NODE_ENV === 'production') {
        // In production, require authentication or IP whitelisting
        const isInternalIP = allowedIPs.some(range => {
            if (range.includes('/')) {
                // CIDR notation check would go here
                return false;
            }
            return clientIP === range;
        });

        if (!isInternalIP) {
            return res.status(403).json({ error: 'Access denied' });
        }
    }

    const report = securityMonitor.generateSecurityReport();
    res.json({
        success: true,
        data: report,
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 8000;

export const startServer = async () => {
    try {
        logger.info('Starting server...');
        await connectDatabase();
        logger.info('MongoDB connected');

        // Initialize default tips
        await intelligenceService.initializeDefaultTips();
        // logger.info('Default tips initialized');
        setupCronJobs();

        app.listen(PORT, () => {
            logger.info(`Server is running on port ${PORT}`);
            logger.info('Security middleware enabled');
            logger.info('Rate limiting enabled');
            logger.info('Health check logging filtered');
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

export default app;