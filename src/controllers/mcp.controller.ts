/**
 * MCP Controller
 * Handles HTTP requests for MCP server
 */

import { Request, Response } from 'express';
import { loggingService } from '../services/logging.service';
import { SSETransport } from '../mcp/transports/sse.transport';
import { MCPAuthService } from '../mcp/auth/mcp-auth';
import { ToolRegistry } from '../mcp/registry/tool-registry';
import { PermissionManager } from '../mcp/permissions/permission-manager';
import { ConfirmationService } from '../mcp/permissions/confirmation-service';
import { initializeMCP } from '../mcp/init';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

// Global SSE transport instance
let sseTransport: SSETransport | null = null;

export class MCPController {
  /**
   * Initialize MCP system
   */
  static async initialize(_req: Request, res: Response): Promise<Response> {
    try {
      initializeMCP();

      return res.status(200).json({
        success: true,
        message: 'MCP initialized successfully',
        stats: ToolRegistry.getStats(),
      });
    } catch (error) {
      loggingService.error('MCP initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Initialization failed',
      });
    }
  }

  /**
   * SSE endpoint for web-based MCP clients
   */
  static async connectSSE(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) return;
      const userId = req.userId!;
      ControllerHelper.logRequestStart('connectSSE', req);

      // Authenticate with userId
      const auth = await MCPAuthService.authenticate(userId);
      if (!auth) {
        res.status(401).json({ error: 'Authentication failed' });
        return;
      }

      // Initialize SSE transport if not exists
      if (!sseTransport) {
        sseTransport = new SSETransport();
      }

      // Create connection
      const connectionId = sseTransport.createConnection(req, res, auth.userId);

      ControllerHelper.logRequestSuccess('connectSSE', req, startTime, {
        connectionId,
        userId: auth.userId
      });

      // Connection will remain open until client disconnects
    } catch (error) {
      if (!res.headersSent) {
        ControllerHelper.handleError('connectSSE', error, req, res, startTime);
      }
    }
  }

  /**
   * Handle client messages (POST endpoint for SSE clients)
   */
  static async handleMessage(req: Request, res: Response): Promise<Response> {
    try {
      const { connectionId, message } = req.body;

      if (!connectionId || !message) {
        return res.status(400).json({ error: 'connectionId and message required' });
      }

      if (!sseTransport) {
        return res.status(503).json({ error: 'SSE transport not initialized' });
      }

      // Handle incoming message
      sseTransport.handleClientMessage(connectionId, message);

      return res.status(200).json({ success: true });
    } catch (error) {
      loggingService.error('Failed to handle client message', {
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to handle message',
      });
    }
  }

  /**
   * List available tools
   */
  static async listTools(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) return res.status(401).json({ error: 'Authentication required' });
      const userId = req.userId!;
      ControllerHelper.logRequestStart('listTools', req);

      const auth = await MCPAuthService.authenticate(userId);
      if (!auth) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      // Get tools filtered by user's integrations
      const tools = ToolRegistry.toMCPDefinitions(auth.integrations);

      ControllerHelper.logRequestSuccess('listTools', req, startTime, {
        toolsCount: tools.length
      });

      return res.status(200).json({
        success: true,
        tools,
        count: tools.length,
        integrations: auth.integrations,
      });
    } catch (error) {
      ControllerHelper.handleError('listTools', error, req, res, startTime);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to list tools',
      });
    }
  }

  /**
   * Get tool registry stats
   */
  static async getStats(_req: Request, res: Response): Promise<Response> {
    try {
      const stats = ToolRegistry.getStats();

      return res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get stats',
      });
    }
  }

  /**
   * Get user permissions
   */
  static async getUserPermissions(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) return res.status(401).json({ error: 'Authentication required' });
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getUserPermissions', req);

      const auth = await MCPAuthService.authenticate(userId);
      if (!auth) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      const permissions = await PermissionManager.getUserPermissions(auth.userId);

      ControllerHelper.logRequestSuccess('getUserPermissions', req, startTime, {
        permissionsCount: permissions.length
      });

      return res.status(200).json({
        success: true,
        permissions,
        count: permissions.length,
      });
    } catch (error) {
      ControllerHelper.handleError('getUserPermissions', error, req, res, startTime);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get permissions',
      });
    }
  }

  /**
   * Submit confirmation response
   */
  static async submitConfirmation(req: Request, res: Response): Promise<Response> {
    try {
      const { confirmationId, confirmed } = req.body;

      if (!confirmationId || confirmed === undefined) {
        return res.status(400).json({ error: 'confirmationId and confirmed required' });
      }

      const success = await ConfirmationService.submitConfirmation(confirmationId, confirmed);

      return res.status(200).json({
        success,
        message: success ? 'Confirmation submitted' : 'Confirmation request not found or expired',
      });
    } catch (error) {
      loggingService.error('Failed to submit confirmation', {
        error: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to submit confirmation',
      });
    }
  }

  /**
   * Health check endpoint
   */
  static async health(_req: Request, res: Response): Promise<Response> {
    return res.status(200).json({
      success: true,
      message: 'MCP server is running',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get MongoDB connections for the authenticated user
   */
  static async getMongoDBConnections(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) return res.status(401).json({ error: 'Authentication required' });
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getMongoDBConnections', req);

      const { MongoDBConnection } = await import('../models/MongoDBConnection');
      const connections = await MongoDBConnection.find({
        userId,
        isActive: true,
      }).select('_id alias database metadata.environment metadata.provider createdAt lastUsed');

      ControllerHelper.logRequestSuccess('getMongoDBConnections', req, startTime, {
        connectionsCount: connections.length
      });

      return res.status(200).json({
        success: true,
        connections,
        count: connections.length,
      });
    } catch (error) {
      ControllerHelper.handleError('getMongoDBConnections', error, req, res, startTime);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get connections',
      });
    }
  }

  /**
   * Get all integration connections for the authenticated user
   */
  static async getAllConnections(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) return res.status(401).json({ error: 'Authentication required' });
      const userId = req.userId!;
      ControllerHelper.logRequestStart('getAllConnections', req);

      const connections: any = {};

      // Get Vercel connections
      try {
        const { VercelConnection } = await import('../models/VercelConnection');
        const vercelConns = await VercelConnection.find({
          userId,
          isActive: true,
        }).select('_id userId vercelUsername teamId createdAt lastSyncedAt');
        connections.vercel = vercelConns;
      } catch (error) {
        loggingService.warn('Failed to fetch Vercel connections', { error });
        connections.vercel = [];
      }

      // Get GitHub connections
      try {
        const { GitHubConnection } = await import('../models/GitHubConnection');
        const githubConns = await GitHubConnection.find({
          userId,
          isActive: true,
        }).select('_id userId login installationId createdAt lastSyncedAt');
        connections.github = githubConns;
      } catch (error) {
        loggingService.warn('Failed to fetch GitHub connections', { error });
        connections.github = [];
      }

      // Get Google connections
      try {
        const { GoogleConnection } = await import('../models/GoogleConnection');
        const googleConns = await GoogleConnection.find({
          userId,
          isActive: true,
        }).select('_id userId googleEmail googleName createdAt lastSyncedAt');
        connections.google = googleConns;
      } catch (error) {
        loggingService.warn('Failed to fetch Google connections', { error });
        connections.google = [];
      }

      // Get MongoDB connections
      try {
        const { MongoDBConnection } = await import('../models/MongoDBConnection');
        const mongoConns = await MongoDBConnection.find({
          userId,
          isActive: true,
        }).select('_id alias database metadata.environment createdAt lastUsed');
        connections.mongodb = mongoConns;
      } catch (error) {
        loggingService.warn('Failed to fetch MongoDB connections', { error });
        connections.mongodb = [];
      }

      // Get AWS connections
      try {
        const { AWSConnection } = await import('../models/AWSConnection');
        const awsConns = await AWSConnection.find({
          userId,
          status: 'active',
        }).select('_id userId awsAccountId region alias createdAt lastUsedAt');
        connections.aws = awsConns;
      } catch (error) {
        loggingService.warn('Failed to fetch AWS connections', { error });
        connections.aws = [];
      }

      // Get generic Integration connections (Slack, Discord, Jira, Linear)
      try {
        const { Integration } = await import('../models/Integration');
        const integrationConns = await Integration.find({
          userId,
          status: 'active',
        }).select('_id userId type name metadata createdAt lastUsedAt');

        // Group by type
        connections.slack = integrationConns.filter(c => c.type?.toLowerCase() === 'slack');
        connections.discord = integrationConns.filter(c => c.type?.toLowerCase() === 'discord');
        connections.jira = integrationConns.filter(c => c.type?.toLowerCase() === 'jira');
        connections.linear = integrationConns.filter(c => c.type?.toLowerCase() === 'linear');
      } catch (error) {
        loggingService.warn('Failed to fetch Integration connections', { error });
        connections.slack = [];
        connections.discord = [];
        connections.jira = [];
        connections.linear = [];
      }

      const totalCount = Object.values(connections).reduce(
        (sum: number, conns: any) => sum + (Array.isArray(conns) ? conns.length : 0),
        0
      );

      ControllerHelper.logRequestSuccess('getAllConnections', req, startTime, {
        totalCount
      });

      return res.status(200).json({
        success: true,
        connections,
        totalCount,
      });
    } catch (error) {
      ControllerHelper.handleError('getAllConnections', error, req, res, startTime);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get connections',
      });
    }
  }
}
