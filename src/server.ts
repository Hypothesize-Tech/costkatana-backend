import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { config } from './config';
import { connectDatabase } from './config/database';
import { errorHandler, notFoundHandler, securityLogger } from './middleware/error.middleware';
import { sanitizeInput } from './middleware/validation.middleware';
import { 
    trackApiRequests, 
    trackAuthEvents, 
    trackAnalyticsEvents, 
    trackProjectEvents, 
    trackUserSession, 
    trackOptimizationEvents 
} from './middleware/mixpanel.middleware';
import { logger, stream } from './utils/logger';
import { apiRouter } from './routes';
import { intelligenceService } from './services/intelligence.service';
import { initializeCronJobs } from './utils/cronJobs';
import cookieParser from 'cookie-parser';
import { agentService } from './services/agent.service';

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

// Sanitize input
app.use(sanitizeInput);

// Mixpanel tracking middleware
app.use(trackApiRequests);
app.use(trackAuthEvents);
app.use(trackAnalyticsEvents);
app.use(trackProjectEvents);
app.use(trackUserSession);
app.use(trackOptimizationEvents);

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
        message: 'Cost Katana Backend API',
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

    res.json({
        success: true,
        data: {},
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
        
        // Initialize AIOps Agent
        try {
            await agentService.initialize();
            logger.info('🤖 AIOps Agent initialized successfully');
        } catch (error) {
            logger.warn('⚠️  AIOps Agent initialization failed, will initialize on first request:', error);
        }
        
        initializeCronJobs();

        const server = app.listen(PORT, () => {
            logger.info(`🚀 AI Cost Optimizer Backend running on port ${PORT}`);
            logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
            logger.info(`🔗 Database: ${process.env.MONGODB_URI ? 'Connected' : 'Not configured'}`);
        });

        // Configure server timeouts for MCP compatibility
        server.keepAliveTimeout = 65000; // 65 seconds (longer than client timeouts)
        server.headersTimeout = 66000; // 66 seconds (longer than keepAliveTimeout)
        
        // Enable TCP keep-alive with optimized settings for MCP
        server.on('connection', (socket) => {
            socket.setKeepAlive(true, 60000); // Enable keep-alive with 60s initial delay
            socket.setTimeout(30000); // 30 second socket timeout
            
            // Handle connection errors gracefully
            socket.on('error', (err) => {
                logger.warn('Socket error:', err.message);
            });
            
            // Handle connection close
            socket.on('close', (hadError) => {
                if (hadError) {
                    logger.warn('Socket closed with error');
                }
            });
        });
        
        // Handle server errors gracefully
        server.on('error', (err) => {
            logger.error('Server error:', err);
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

export default app;