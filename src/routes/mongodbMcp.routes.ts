import { Router, Request, Response } from 'express';
import { validateMCPRequest, mcpResponseTimer } from '../middleware/mcp.middleware';
import { mongodbMcpMiddleware, validateMongoDBConnectionAccess } from '../middleware/mongodbMcp.middleware';
import { authenticate } from '../middleware/auth.middleware';
import {
    handleMongoDBMCPToolCall,
    listMongoDBMCPTools,
    getUserMongoDBConnections,
    getMongoDBConnection,
    createMongoDBConnection,
    updateMongoDBConnection,
    deleteMongoDBConnection,
    validateMongoDBConnectionEndpoint,
} from '../controllers/mongodbMcp.controller';

const router = Router();

/**
 * MongoDB MCP Routes
 * 
 * Endpoints for MongoDB MCP server operations via HTTP/SSE
 * All routes require authentication
 */

// Apply authentication to all routes
router.use(authenticate);

// ==================== MCP Protocol Endpoints ====================

/**
 * @route   POST /api/mcp/mongodb
 * @desc    Execute MongoDB MCP tool (JSON-RPC 2.0)
 * @access  Private
 */
router.post(
    '/mongodb',
    validateMCPRequest,
    mcpResponseTimer,
    mongodbMcpMiddleware,
    handleMongoDBMCPToolCall
);

/**
 * @route   GET /api/mcp/mongodb/tools
 * @desc    List available MongoDB MCP tools
 * @access  Private
 */
router.get('/mongodb/tools', listMongoDBMCPTools);

// ==================== Connection Management Endpoints ====================

/**
 * @route   GET /api/mcp/mongodb/connections
 * @desc    Get user's MongoDB connections
 * @access  Private
 */
router.get('/mongodb/connections', getUserMongoDBConnections);

/**
 * @route   GET /api/mcp/mongodb/connections/:connectionId
 * @desc    Get a single MongoDB connection
 * @access  Private
 */
router.get('/mongodb/connections/:connectionId', getMongoDBConnection);

/**
 * @route   POST /api/mcp/mongodb/connections
 * @desc    Create new MongoDB connection
 * @access  Private
 */
router.post('/mongodb/connections', createMongoDBConnection);

/**
 * @route   PUT /api/mcp/mongodb/connections/:connectionId
 * @desc    Update MongoDB connection
 * @access  Private
 */
router.put('/mongodb/connections/:connectionId', updateMongoDBConnection);

/**
 * @route   DELETE /api/mcp/mongodb/connections/:connectionId
 * @desc    Delete MongoDB connection
 * @access  Private
 */
router.delete('/mongodb/connections/:connectionId', deleteMongoDBConnection);

/**
 * @route   POST /api/mcp/mongodb/connections/:connectionId/validate
 * @desc    Validate MongoDB connection
 * @access  Private
 */
router.post(
    '/mongodb/connections/:connectionId/validate',
    validateMongoDBConnectionAccess,
    validateMongoDBConnectionEndpoint
);

export default router;
