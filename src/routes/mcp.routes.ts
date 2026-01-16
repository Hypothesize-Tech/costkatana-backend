/**
 * MCP Routes
 * API endpoints for MCP server
 */

import express from 'express';
import { MCPController } from '../controllers/mcp.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

/**
 * @route   GET /api/mcp/health
 * @desc    Health check
 * @access  Public
 */
router.get('/health', MCPController.health);

/**
 * @route   POST /api/mcp/initialize
 * @desc    Initialize MCP system
 * @access  Private (JWT)
 */
router.post('/initialize', authenticate, MCPController.initialize);

/**
 * @route   GET /api/mcp/sse
 * @desc    SSE connection endpoint
 * @access  Private (JWT)
 */
router.get('/sse', authenticate, MCPController.connectSSE);

/**
 * @route   POST /api/mcp/message
 * @desc    Handle client messages
 * @access  Private (JWT)
 */
router.post('/message', authenticate, MCPController.handleMessage);

/**
 * @route   GET /api/mcp/tools
 * @desc    List available tools
 * @access  Private (JWT)
 */
router.get('/tools', authenticate, MCPController.listTools);

/**
 * @route   GET /api/mcp/stats
 * @desc    Get tool registry stats
 * @access  Public
 */
router.get('/stats', MCPController.getStats);

/**
 * @route   GET /api/mcp/permissions
 * @desc    Get user permissions
 * @access  Private (JWT)
 */
router.get('/permissions', authenticate, MCPController.getUserPermissions);

/**
 * @route   POST /api/mcp/confirmation
 * @desc    Submit confirmation response
 * @access  Private (JWT)
 */
router.post('/confirmation', authenticate, MCPController.submitConfirmation);

/**
 * @route   GET /api/mcp/mongodb/connections
 * @desc    Get MongoDB connections
 * @access  Private (JWT)
 */
router.get('/mongodb/connections', authenticate, MCPController.getMongoDBConnections);

/**
 * @route   GET /api/mcp/connections
 * @desc    Get all integration connections
 * @access  Private (JWT)
 */
router.get('/connections', authenticate, MCPController.getAllConnections);

export default router;
