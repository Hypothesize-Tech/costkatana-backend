import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { TraceController } from '../controllers/trace.controller';
import { authenticate } from '../middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Validation middleware
const createTraceValidation = [
    body('name')
        .notEmpty()
        .withMessage('Trace name is required')
        .isLength({ min: 1, max: 100 })
        .withMessage('Trace name must be between 1 and 100 characters'),
    body('projectId')
        .optional()
        .isMongoId()
        .withMessage('Project ID must be a valid MongoDB ObjectId'),
    body('metadata.environment')
        .optional()
        .isString()
        .withMessage('Environment must be a string'),
    body('metadata.version')
        .optional()
        .isString()
        .withMessage('Version must be a string'),
    body('metadata.sessionId')
        .optional()
        .isString()
        .withMessage('Session ID must be a string'),
    body('metadata.tags')
        .optional()
        .isArray()
        .withMessage('Tags must be an array'),
    body('metadata.tags.*')
        .optional()
        .isString()
        .withMessage('Each tag must be a string')
];

const addSpanValidation = [
    param('traceId')
        .notEmpty()
        .withMessage('Trace ID is required'),
    body('name')
        .notEmpty()
        .withMessage('Span name is required')
        .isLength({ min: 1, max: 100 })
        .withMessage('Span name must be between 1 and 100 characters'),
    body('operation')
        .isIn(['ai_call', 'processing', 'database', 'http_request', 'custom'])
        .withMessage('Operation must be one of: ai_call, processing, database, http_request, custom'),
    body('parentSpanId')
        .optional()
        .isString()
        .withMessage('Parent span ID must be a string'),
    body('aiCall.provider')
        .optional()
        .isString()
        .withMessage('AI call provider must be a string'),
    body('aiCall.model')
        .optional()
        .isString()
        .withMessage('AI call model must be a string'),
    body('aiCall.prompt')
        .optional()
        .isString()
        .withMessage('AI call prompt must be a string'),
    body('aiCall.completion')
        .optional()
        .isString()
        .withMessage('AI call completion must be a string'),
    body('aiCall.promptTokens')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Prompt tokens must be a non-negative integer'),
    body('aiCall.completionTokens')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Completion tokens must be a non-negative integer'),
    body('aiCall.totalTokens')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Total tokens must be a non-negative integer'),
    body('aiCall.cost')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Cost must be a non-negative number'),
    body('performance.latency')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Latency must be a non-negative integer'),
    body('performance.queueTime')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Queue time must be a non-negative integer'),
    body('performance.processingTime')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Processing time must be a non-negative integer'),
    body('performance.networkTime')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Network time must be a non-negative integer'),
    body('error.message')
        .optional()
        .isString()
        .withMessage('Error message must be a string'),
    body('error.code')
        .optional()
        .isString()
        .withMessage('Error code must be a string'),
    body('error.recoverable')
        .optional()
        .isBoolean()
        .withMessage('Error recoverable must be a boolean')
];

const traceIdValidation = [
    param('traceId')
        .notEmpty()
        .withMessage('Trace ID is required')
];

const spanIdValidation = [
    param('spanId')
        .notEmpty()
        .withMessage('Span ID is required')
];

const searchValidation = [
    body('promptText')
        .optional()
        .isString()
        .withMessage('Prompt text must be a string'),
    body('model')
        .optional()
        .isString()
        .withMessage('Model must be a string'),
    body('provider')
        .optional()
        .isString()
        .withMessage('Provider must be a string'),
    body('timeRange.start')
        .optional()
        .isISO8601()
        .withMessage('Start date must be a valid ISO 8601 date'),
    body('timeRange.end')
        .optional()
        .isISO8601()
        .withMessage('End date must be a valid ISO 8601 date')
];

// Routes

/**
 * @route   POST /api/traces
 * @desc    Create a new trace
 * @access  Private
 */
router.post('/', createTraceValidation, TraceController.createTrace);

/**
 * @route   GET /api/traces
 * @desc    Get traces with filtering and pagination
 * @access  Private
 * @query   {string} projectId - Filter by project ID
 * @query   {string} status - Filter by status (running, completed, failed, cancelled)
 * @query   {string} search - Search in trace name or ID
 * @query   {string} provider - Filter by AI provider
 * @query   {string} model - Filter by AI model
 * @query   {number} minCost - Minimum cost filter
 * @query   {number} maxCost - Maximum cost filter
 * @query   {string[]} tags - Filter by tags
 * @query   {string} startDate - Start date filter (ISO 8601)
 * @query   {string} endDate - End date filter (ISO 8601)
 * @query   {number} page - Page number (default: 1)
 * @query   {number} limit - Items per page (default: 20)
 */
router.get('/', TraceController.getTraces);

/**
 * @route   GET /api/traces/stats
 * @desc    Get trace statistics
 * @access  Private
 * @query   {string} projectId - Filter by project ID
 * @query   {string} startDate - Start date filter (ISO 8601)
 * @query   {string} endDate - End date filter (ISO 8601)
 */
router.get('/stats', TraceController.getTraceStats);

/**
 * @route   POST /api/traces/search
 * @desc    Search traces by prompt content
 * @access  Private
 */
router.post('/search', searchValidation, TraceController.searchTraces);

/**
 * @route   GET /api/traces/:traceId
 * @desc    Get a single trace by ID
 * @access  Private
 */
router.get('/:traceId', traceIdValidation, TraceController.getTrace);

/**
 * @route   DELETE /api/traces/:traceId
 * @desc    Delete a trace
 * @access  Private
 */
router.delete('/:traceId', traceIdValidation, TraceController.deleteTrace);

/**
 * @route   PUT /api/traces/:traceId/complete
 * @desc    Complete a trace and perform analysis
 * @access  Private
 */
router.put('/:traceId/complete', traceIdValidation, TraceController.completeTrace);

/**
 * @route   GET /api/traces/:traceId/analysis
 * @desc    Analyze a trace for performance insights
 * @access  Private
 */
router.get('/:traceId/analysis', traceIdValidation, TraceController.analyzeTrace);

/**
 * @route   GET /api/traces/:traceId/insights
 * @desc    Get detailed trace performance insights
 * @access  Private
 */
router.get('/:traceId/insights', traceIdValidation, TraceController.getTraceInsights);

/**
 * @route   GET /api/traces/:traceId/export
 * @desc    Export trace data
 * @access  Private
 * @query   {string} format - Export format (json, csv)
 */
router.get('/:traceId/export', traceIdValidation, TraceController.exportTrace);

/**
 * @route   POST /api/traces/:traceId/spans
 * @desc    Add a span to a trace
 * @access  Private
 */
router.post('/:traceId/spans', [...traceIdValidation, ...addSpanValidation], TraceController.addSpan);

/**
 * @route   PUT /api/traces/:traceId/spans/:spanId/complete
 * @desc    Complete a span
 * @access  Private
 */
router.put('/:traceId/spans/:spanId/complete',
    [...traceIdValidation, ...spanIdValidation],
    TraceController.completeSpan
);

// Trace replay routes
router.post('/:traceId/replay',
    authenticate,
    [
        param('traceId').isString().notEmpty().withMessage('Trace ID is required')
    ],
    TraceController.replayTrace
);

router.get('/:traceId/replays',
    authenticate,
    [
        param('traceId').isString().notEmpty().withMessage('Trace ID is required')
    ],
    TraceController.getReplayHistory
);

router.get('/:traceId/replays/:replayId/comparison',
    authenticate,
    [
        param('traceId').isString().notEmpty().withMessage('Trace ID is required'),
        param('replayId').isString().notEmpty().withMessage('Replay ID is required')
    ],
    TraceController.getReplayComparison
);

router.delete('/replays/:replayId',
    authenticate,
    [
        param('replayId').isString().notEmpty().withMessage('Replay ID is required')
    ],
    TraceController.cancelReplay
);

// Performance optimization routes
router.get('/:traceId/performance/analyze',
    authenticate,
    [
        param('traceId').isString().notEmpty().withMessage('Trace ID is required')
    ],
    TraceController.analyzePerformance
);

router.get('/:traceId/performance/suggestions',
    authenticate,
    [
        param('traceId').isString().notEmpty().withMessage('Trace ID is required')
    ],
    TraceController.generateOptimizationSuggestions
);

router.get('/:traceId/performance/benchmark',
    authenticate,
    [
        param('traceId').isString().notEmpty().withMessage('Trace ID is required'),
        query('compareWith').optional().isString().withMessage('Compare with trace ID must be a string')
    ],
    TraceController.getPerformanceBenchmark
);

router.get('/performance/analytics',
    authenticate,
    [
        query('projectId').optional().isString().withMessage('Project ID must be a string'),
        query('timeRange').optional().isIn(['7d', '30d']).withMessage('Time range must be 7d or 30d'),
        query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000')
    ],
    TraceController.getPerformanceAnalytics
);

export default router; 