import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Request, Response } from 'express';
import { Model } from 'mongoose';
import { McpPermissionService } from './services/mcp-permission.service';
import { ConfirmationService } from './services/confirmation.service';
import { McpAuthService } from './services/mcp-auth.service';
import { McpServerService } from './services/mcp-server.service';
import { SseTransportService } from './services/sse-transport.service';
import { ToolRegistryService } from './services/tool-registry.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { submitConfirmationSchema, handleMessageSchema } from './dto/mcp.dto';
import type { SubmitConfirmationDto, HandleMessageDto } from './dto/mcp.dto';
import { MongoDBConnection } from '@/schemas/integration/mongodb-connection.schema';
import { VercelConnection } from '@/schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '@/schemas/integration/github-connection.schema';
import { GoogleConnection } from '@/schemas/integration/google-connection.schema';
import { AWSConnection } from '@/schemas/integration/aws-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';

@Controller('api/mcp')
export class McpController {
  constructor(
    private mcpPermissionService: McpPermissionService,
    private confirmationService: ConfirmationService,
    private authService: McpAuthService,
    private mcpServer: McpServerService,
    private sseTransport: SseTransportService,
    private toolRegistry: ToolRegistryService,
    @InjectModel(MongoDBConnection.name)
    private mongodbConnectionModel: Model<MongoDBConnection>,
    @InjectModel(VercelConnection.name)
    private vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(GitHubConnection.name)
    private githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(GoogleConnection.name)
    private googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(AWSConnection.name)
    private awsConnectionModel: Model<AWSConnection>,
    @InjectModel(Integration.name) private integrationModel: Model<Integration>,
  ) {}

  /**
   * Health check endpoint
   */
  @Public()
  @Get('health')
  async health() {
    return {
      success: true,
      message: 'MCP server is running',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get user permissions
   */
  @UseGuards(JwtAuthGuard)
  @Get('permissions')
  async getUserPermissions(@CurrentUser('id') userId: string) {
    const permissions =
      await this.mcpPermissionService.getUserPermissions(userId);

    return {
      success: true,
      permissions,
      count: permissions.length,
    };
  }

  /**
   * Get pending confirmation requests for the current user (Express parity)
   */
  @UseGuards(JwtAuthGuard)
  @Get('confirmations/pending')
  async getPendingConfirmations(@CurrentUser('id') userId: string) {
    const pending =
      await this.confirmationService.getPendingConfirmations(userId);
    return {
      success: true,
      pending,
      count: pending.length,
    };
  }

  /**
   * Submit confirmation response
   */
  @UseGuards(JwtAuthGuard)
  @Post('confirmation')
  async submitConfirmation(
    @Body(ZodPipe(submitConfirmationSchema)) body: SubmitConfirmationDto,
  ) {
    const { confirmationId, confirmed } = body;

    const success = await this.confirmationService.submitConfirmation(
      confirmationId,
      confirmed,
    );

    return {
      success,
      message: success
        ? 'Confirmation submitted'
        : 'Confirmation request not found or expired',
    };
  }

  /**
   * Initialize MCP system
   */
  @UseGuards(JwtAuthGuard)
  @Post('initialize')
  async initialize() {
    // MCP initialization is handled automatically by McpInitializationService
    // This endpoint just returns success
    return {
      success: true,
      message: 'MCP initialized successfully',
      stats: this.toolRegistry.getStats(),
    };
  }

  /**
   * SSE connection endpoint for web-based MCP clients
   */
  /**
   * SSE connection endpoint for web-based MCP clients
   * Keeps the connection open; the transport manages lifecycle/events.
   * Responds with SSE protocol for real-time updates.
   */
  @UseGuards(JwtAuthGuard)
  @Get('sse')
  async connectSSE(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Step 1: Authenticate user session
    const authContext = await this.authService.authenticate(userId);
    if (!authContext) {
      res.status(401).json({ error: 'Authentication failed' });
      return;
    }

    // Step 2: Establish SSE connection, return headers and keep-alive stream
    this.sseTransport.createConnection(req, res, userId);

    // The SSE transport is responsible for sending messages and closing the connection.
    // No explicit response needed; stream remains open for server-to-client push.
  }

  /**
   * Handle client messages (POST endpoint for SSE clients)
   */
  @UseGuards(JwtAuthGuard)
  @Post('message')
  async handleMessage(
    @Body(ZodPipe(handleMessageSchema)) body: HandleMessageDto,
  ) {
    const { connectionId, message } = body;

    // Handle the message through SSE transport
    this.sseTransport.handleClientMessage(connectionId, message);

    return { success: true };
  }

  /**
   * List available tools
   */
  @UseGuards(JwtAuthGuard)
  @Get('tools')
  async listTools(@CurrentUser('id') userId: string) {
    const authContext = await this.authService.authenticate(userId);
    if (!authContext) {
      return { success: false, error: 'Authentication failed' };
    }

    const tools = this.toolRegistry.toMCPDefinitions(authContext.integrations);

    return {
      success: true,
      tools,
      count: tools.length,
      integrations: authContext.integrations,
    };
  }

  /**
   * Get tool registry stats
   */
  @Public()
  @Get('stats')
  async getStats() {
    const stats = this.toolRegistry.getStats();

    return {
      success: true,
      stats,
    };
  }

  /**
   * Get MongoDB connections for the authenticated user
   */
  @UseGuards(JwtAuthGuard)
  @Get('mongodb/connections')
  async getMongoDBConnections(@CurrentUser('id') userId: string) {
    const connections = await this.mongodbConnectionModel
      .find({ userId, isActive: true })
      .select('-connectionString')
      .sort({ lastUsed: -1, createdAt: -1 });

    return {
      success: true,
      data: connections,
      count: connections.length,
    };
  }

  /**
   * Get all integration connections for the authenticated user
   */
  @UseGuards(JwtAuthGuard)
  @Get('connections')
  async getAllConnections(@CurrentUser('id') userId: string) {
    const connections: any = {};

    // Vercel connections
    const vercelConns = await this.vercelConnectionModel
      .find({
        userId,
        isActive: true,
      })
      .select('_id userId vercelUsername teamId createdAt lastSyncedAt');
    connections.vercel = vercelConns;

    // GitHub connections
    const githubConns = await this.githubConnectionModel
      .find({
        userId,
        isActive: true,
      })
      .select('_id userId login installationId createdAt lastSyncedAt');
    connections.github = githubConns;

    // Google connections
    const googleConns = await this.googleConnectionModel
      .find({
        userId,
        isActive: true,
      })
      .select('_id userId googleEmail googleName createdAt lastSyncedAt');
    connections.google = googleConns;

    // MongoDB connections
    const mongoConns = await this.mongodbConnectionModel
      .find({
        userId,
        isActive: true,
      })
      .select('_id alias database metadata.environment createdAt lastUsed');
    connections.mongodb = mongoConns;

    // AWS connections
    const awsConns = await this.awsConnectionModel
      .find({
        userId,
        status: 'active',
      })
      .select('_id userId awsAccountId region alias createdAt lastUsedAt');
    connections.aws = awsConns;

    // Generic Integration connections (Slack, Discord, Jira, Linear)
    const integrationConns = await this.integrationModel
      .find({
        userId,
        status: 'active',
      })
      .select('_id userId type name metadata createdAt lastUsedAt');

    // Group by type
    connections.slack = integrationConns.filter(
      (c) => c.type?.toLowerCase() === 'slack',
    );
    connections.discord = integrationConns.filter(
      (c) => c.type?.toLowerCase() === 'discord',
    );
    connections.jira = integrationConns.filter(
      (c) => c.type?.toLowerCase() === 'jira',
    );
    connections.linear = integrationConns.filter(
      (c) => c.type?.toLowerCase() === 'linear',
    );

    const totalCount = Object.values(connections).reduce(
      (sum: number, conns: any) =>
        sum + (Array.isArray(conns) ? conns.length : 0),
      0,
    );

    return {
      success: true,
      data: {
        connections,
        totalCount,
      },
    };
  }
}
