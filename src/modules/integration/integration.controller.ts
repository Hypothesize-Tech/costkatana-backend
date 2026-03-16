import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  IntegrationService,
  CreateIntegrationDto,
  UpdateIntegrationDto,
} from './integration.service';
import { NotificationService } from './notification.service';
import { LinearService } from './services/linear.service';
import { JiraService } from './services/jira.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

@Controller('api/integrations')
export class IntegrationController {
  constructor(
    private readonly integrationService: IntegrationService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
    private readonly linearService: LinearService,
    private readonly jiraService: JiraService,
    private readonly httpService: HttpService,
  ) {}

  @Get('slack/auth')
  @UseGuards(JwtAuthGuard)
  async initiateSlackOAuth(@CurrentUser('id') userId: string) {
    const clientId = this.configService.get<string>('SLACK_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException(
        'Slack Client ID not configured. Set SLACK_CLIENT_ID in environment.',
      );
    }
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    const callbackUrl =
      this.configService.get<string>('SLACK_CALLBACK_URL') ??
      `${backendUrl}/api/integrations/slack/callback`;
    const state = crypto.randomBytes(16).toString('hex');
    const stateData = Buffer.from(
      JSON.stringify({ userId, nonce: state }),
    ).toString('base64');
    const scopes = [
      'chat:write',
      'channels:read',
      'channels:manage',
      'users:read',
      'channels:history',
      'groups:read',
    ].join(',');
    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateData}`;
    return { success: true, data: { authUrl, state: stateData } };
  }

  @Get('linear/auth')
  @UseGuards(JwtAuthGuard)
  async initiateLinearOAuth(@CurrentUser('id') userId: string) {
    const clientId = this.configService.get<string>('LINEAR_CLIENT_ID');
    if (!clientId)
      throw new BadRequestException('LINEAR_CLIENT_ID not configured');
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    const callbackUrl =
      this.configService.get<string>('LINEAR_CALLBACK_URL') ??
      `${backendUrl}/api/integrations/linear/callback`;
    const state = crypto.randomBytes(16).toString('hex');
    const stateData = Buffer.from(
      JSON.stringify({ userId, nonce: state }),
    ).toString('base64');
    const scopes = 'write read';
    const authUrl = `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${stateData}&response_type=code`;
    return { success: true, data: { authUrl, state: stateData } };
  }

  @Post('linear/validate-token')
  @UseGuards(JwtAuthGuard)
  async validateLinearToken(
    @Body() body: { accessToken: string; teamId?: string },
  ) {
    if (!body?.accessToken)
      throw new BadRequestException('Access token is required');
    const result = await this.integrationService.validateLinearToken(
      body.accessToken,
    );
    return { success: true, data: result };
  }

  @Get('jira/auth')
  @UseGuards(JwtAuthGuard)
  async initiateJiraOAuth(@CurrentUser('id') userId: string) {
    const clientId = this.configService.get<string>('JIRA_CLIENT_ID');
    if (!clientId)
      throw new BadRequestException('JIRA_CLIENT_ID not configured');
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    const callbackUrl =
      this.configService.get<string>('JIRA_CALLBACK_URL') ??
      `${backendUrl}/api/integrations/jira/callback`;
    const state = crypto.randomBytes(16).toString('hex');
    const stateData = Buffer.from(
      JSON.stringify({ userId, nonce: state }),
    ).toString('base64');
    const scopes =
      'read:jira-work write:jira-work offline_access read:jira-user';
    const authUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateData}&response_type=code&prompt=consent`;
    return { success: true, data: { authUrl, state: stateData } };
  }

  @Post('jira/validate-token')
  @UseGuards(JwtAuthGuard)
  async validateJiraToken(
    @Body() body: { accessToken: string; siteUrl: string },
  ) {
    if (!body?.accessToken || !body?.siteUrl)
      throw new BadRequestException('Access token and site URL are required');
    const result = await this.integrationService.validateJiraToken(
      body.accessToken,
      body.siteUrl,
    );
    return { success: true, data: result };
  }

  @Get('discord/auth')
  @UseGuards(JwtAuthGuard)
  async initiateDiscordOAuth(@CurrentUser('id') userId: string) {
    const clientId = this.configService.get<string>('DISCORD_CLIENT_ID');
    if (!clientId)
      throw new BadRequestException('DISCORD_CLIENT_ID not configured');
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    const callbackUrl =
      this.configService.get<string>('DISCORD_CALLBACK_URL') ??
      `${backendUrl}/api/integrations/discord/callback`;
    const state = crypto.randomBytes(16).toString('hex');
    const stateData = Buffer.from(
      JSON.stringify({ userId, nonce: state }),
    ).toString('base64');
    const scopes = ['bot', 'identify', 'guilds'].join('%20');
    const permissions = '8';
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=${scopes}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateData}&response_type=code`;
    return { success: true, data: { authUrl, state: stateData } };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createIntegration(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateIntegrationDto,
  ) {
    const integration = await this.integrationService.createIntegration({
      ...dto,
      userId,
    });
    return {
      success: true,
      message: 'Integration created successfully',
      data: {
        id: integration._id,
        type: integration.type,
        name: integration.name,
        description: integration.description,
        status: integration.status,
        alertRouting: Object.fromEntries(integration.alertRouting ?? new Map()),
        deliveryConfig: integration.deliveryConfig,
        stats: integration.stats,
        createdAt: integration.createdAt,
      },
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getIntegrations(
    @CurrentUser('id') userId: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    const integrations = await this.integrationService.getUserIntegrations(
      userId,
      {
        type: type as any,
        status,
      },
    );
    const formatted = integrations.map((i) => ({
      id: i._id,
      type: i.type,
      name: i.name,
      description: i.description,
      status: i.status,
      alertRouting: Object.fromEntries(i.alertRouting ?? new Map()),
      deliveryConfig: i.deliveryConfig,
      stats: i.stats,
      healthCheckStatus: i.healthCheckStatus,
      lastHealthCheck: i.lastHealthCheck,
      errorMessage: i.errorMessage,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }));
    return { success: true, data: formatted, count: formatted.length };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getIntegration(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const integration = await this.integrationService.getIntegrationById(
      String(id),
      userId,
    );
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }
    return {
      success: true,
      data: {
        id: integration._id,
        type: integration.type,
        name: integration.name,
        description: integration.description,
        status: integration.status,
        alertRouting: Object.fromEntries(integration.alertRouting ?? new Map()),
        deliveryConfig: integration.deliveryConfig,
        stats: integration.stats,
        healthCheckStatus: integration.healthCheckStatus,
        lastHealthCheck: integration.lastHealthCheck,
        errorMessage: integration.errorMessage,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
      },
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async updateIntegration(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body()
    updates: UpdateIntegrationDto & { metadata?: Record<string, unknown> },
  ) {
    const { metadata, ...rest } = updates;
    const integration = await this.integrationService.updateIntegration(
      String(id),
      userId,
      rest,
    );
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }
    if (metadata) {
      integration.metadata = { ...(integration.metadata ?? {}), ...metadata };
      await integration.save();
    }
    return {
      success: true,
      message: 'Integration updated successfully',
      data: {
        id: integration._id,
        type: integration.type,
        name: integration.name,
        description: integration.description,
        status: integration.status,
        alertRouting: Object.fromEntries(integration.alertRouting ?? new Map()),
        deliveryConfig: integration.deliveryConfig,
        stats: integration.stats,
        updatedAt: integration.updatedAt,
      },
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteIntegration(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const deleted = await this.integrationService.deleteIntegration(
      String(id),
      userId,
    );
    if (!deleted) {
      throw new NotFoundException('Integration not found');
    }
    return { success: true, message: 'Integration deleted successfully' };
  }

  @Post(':id/test')
  @UseGuards(JwtAuthGuard)
  async testIntegration(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const result = await this.integrationService.testIntegration(
      String(id),
      userId,
    );
    return {
      success: result.success,
      message: result.message,
      data: { responseTime: result.responseTime },
    };
  }

  @Get(':id/stats')
  @UseGuards(JwtAuthGuard)
  async getIntegrationStats(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const stats = await this.integrationService.getIntegrationStats(
      String(id),
      userId,
    );
    if (!stats) throw new NotFoundException('Integration not found');
    return { success: true, data: stats };
  }

  @Get(':id/logs')
  @UseGuards(JwtAuthGuard)
  async getDeliveryLogs(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('status') status?: string,
    @Query('alertType') alertType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    const logs = await this.notificationService.getDeliveryLogs(
      userId,
      String(id),
      {
        status,
        alertType,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
    );
    return { success: true, data: logs, count: logs.length };
  }

  @Get('logs/all')
  @UseGuards(JwtAuthGuard)
  async getAllDeliveryLogs(
    @CurrentUser('id') userId: string,
    @Query('status') status?: string,
    @Query('alertType') alertType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    const logs = await this.notificationService.getDeliveryLogs(
      userId,
      undefined,
      {
        status,
        alertType,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
    );
    return { success: true, data: logs, count: logs.length };
  }

  @Post('alerts/:alertId/retry')
  @UseGuards(JwtAuthGuard)
  async retryFailedDeliveries(@Param('alertId') alertId: string) {
    await this.notificationService.retryFailedDeliveries(alertId);
    return { success: true, message: 'Failed deliveries retried successfully' };
  }

  @Get(':id/slack/channels')
  @UseGuards(JwtAuthGuard)
  async getSlackChannels(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const channels = await this.integrationService.getSlackChannels(
      String(id),
      userId,
    );
    return { success: true, data: channels };
  }

  @Get(':id/discord/guilds')
  @UseGuards(JwtAuthGuard)
  async getDiscordGuilds(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const guilds = await this.integrationService.getDiscordGuilds(
      String(id),
      userId,
    );
    return { success: true, data: guilds };
  }

  @Get(':id/discord/guilds/:guildId/channels')
  @UseGuards(JwtAuthGuard)
  async getDiscordChannels(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('guildId') guildId: string,
  ) {
    const channels = await this.integrationService.getDiscordChannels(
      String(id),
      userId,
      guildId,
    );
    return { success: true, data: channels };
  }

  @Get(':id/linear/teams')
  @UseGuards(JwtAuthGuard)
  async getLinearTeams(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const teams = await this.integrationService.getLinearTeams(
      String(id),
      userId,
    );
    return { success: true, data: teams };
  }

  @Get(':id/linear/teams/:teamId/projects')
  @UseGuards(JwtAuthGuard)
  async getLinearProjects(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('teamId') teamId: string,
  ) {
    const projects = await this.integrationService.getLinearProjects(
      String(id),
      userId,
      teamId,
    );
    return { success: true, data: projects };
  }

  @Get(':id/jira/projects')
  @UseGuards(JwtAuthGuard)
  async getJiraProjects(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const projects = await this.integrationService.getJiraProjects(
      String(id),
      userId,
    );
    return { success: true, data: projects };
  }

  @Get(':id/jira/projects/:projectKey/issue-types')
  @UseGuards(JwtAuthGuard)
  async getJiraIssueTypes(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('projectKey') projectKey: string,
  ) {
    const issueTypes = await this.integrationService.getJiraIssueTypes(
      String(id),
      userId,
      projectKey,
    );
    return { success: true, data: issueTypes };
  }

  @Get(':id/jira/priorities')
  @UseGuards(JwtAuthGuard)
  async getJiraPriorities(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const priorities = await this.integrationService.getJiraPriorities(
      String(id),
      userId,
    );
    return { success: true, data: priorities };
  }

  @Post(':id/linear/issues')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createLinearIssue(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body()
    body: {
      title: string;
      description?: string;
      teamId: string;
      projectId?: string;
    },
  ) {
    if (!body?.title || !body?.teamId) {
      throw new BadRequestException('Title and teamId are required');
    }
    const result = await this.integrationService.createLinearIssue(
      String(id),
      userId,
      body,
    );
    return {
      success: true,
      message: 'Linear issue created successfully',
      data: result,
    };
  }

  @Put(':id/linear/issues/:issueId')
  @UseGuards(JwtAuthGuard)
  async updateLinearIssue(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('issueId') issueId: string,
    @Body()
    updates: {
      title?: string;
      description?: string;
      stateId?: string;
      priority?: number;
    },
  ) {
    const result = await this.integrationService.updateLinearIssue(
      String(id),
      userId,
      issueId,
      updates,
    );
    return {
      success: true,
      message: 'Linear issue updated successfully',
      data: { responseTime: result.responseTime },
    };
  }

  @Post(':id/jira/issues')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createJiraIssue(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body()
    body: {
      title: string;
      description?: string;
      projectKey: string;
      issueTypeId: string;
      priorityId?: string;
      labels?: string[];
      components?: Array<{ id: string }>;
    },
  ) {
    if (!body?.title || !body?.projectKey || !body?.issueTypeId) {
      throw new BadRequestException(
        'Title, projectKey, and issueTypeId are required',
      );
    }
    const result = await this.integrationService.createJiraIssue(
      String(id),
      userId,
      body,
    );
    return {
      success: true,
      message: 'JIRA issue created successfully',
      data: result,
    };
  }

  @Put(':id/jira/issues/:issueKey')
  @UseGuards(JwtAuthGuard)
  async updateJiraIssue(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('issueKey') issueKey: string,
    @Body()
    updates: {
      summary?: string;
      description?: string;
      priorityId?: string;
      labels?: string[];
    },
  ) {
    const result = await this.integrationService.updateJiraIssue(
      String(id),
      userId,
      issueKey,
      updates,
    );
    return {
      success: true,
      message: 'JIRA issue updated successfully',
      data: { responseTime: result.responseTime },
    };
  }

  @Get('slack/callback')
  @Public()
  @HttpCode(HttpStatus.FOUND)
  async handleSlackOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    if (error) {
      return res.redirect(
        `${frontendUrl}/integrations/slack/error?message=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return res.redirect(
        `${frontendUrl}/integrations/slack/error?message=${encodeURIComponent('Missing code or state')}`,
      );
    }
    let stateData: { userId: string; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    } catch {
      return res.redirect(
        `${frontendUrl}/integrations/slack/error?message=${encodeURIComponent('Invalid state')}`,
      );
    }
    const clientId = this.configService.get<string>('SLACK_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SLACK_CLIENT_SECRET');
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    const callbackUrl =
      this.configService.get<string>('SLACK_CALLBACK_URL') ??
      `${backendUrl}/api/integrations/slack/callback`;
    if (!clientId || !clientSecret) {
      return res.redirect(
        `${frontendUrl}/integrations/slack/error?message=${encodeURIComponent('Slack OAuth not configured')}`,
      );
    }
    const axios = await import('axios');
    const { data: tokenData } = await axios.default.post(
      'https://slack.com/api/oauth.v2.access',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    if (!tokenData.ok) {
      return res.redirect(
        `${frontendUrl}/integrations/slack/error?message=${encodeURIComponent(tokenData.error ?? 'Token exchange failed')}`,
      );
    }
    const accessToken = tokenData.access_token;
    const team = tokenData.team;
    const botUserId = tokenData.bot_user_id;
    if (!accessToken || !team) {
      return res.redirect(
        `${frontendUrl}/integrations/slack/error?message=${encodeURIComponent('Missing access token or team')}`,
      );
    }
    const integration = await this.integrationService.createIntegration({
      userId: stateData.userId,
      type: 'slack_oauth',
      name: `Slack - ${team.name}`,
      description: `Connected via OAuth to ${team.name} workspace`,
      credentials: {
        accessToken,
        teamId: team.id,
        teamName: team.name,
        botUserId,
      },
    });
    return res.redirect(
      `${frontendUrl}/integrations/slack/success?integrationId=${String(integration._id)}`,
    );
  }

  @Get('linear/callback')
  @Public()
  @HttpCode(HttpStatus.FOUND)
  async handleLinearOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    if (error)
      return res.redirect(
        `${frontendUrl}/integrations/linear/error?message=${encodeURIComponent(error)}`,
      );
    if (!code || !state)
      return res.redirect(
        `${frontendUrl}/integrations/linear/error?message=${encodeURIComponent('Missing code or state')}`,
      );
    let stateData: { userId: string; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    } catch {
      return res.redirect(
        `${frontendUrl}/integrations/linear/error?message=${encodeURIComponent('Invalid state')}`,
      );
    }
    const clientId = this.configService.get<string>('LINEAR_CLIENT_ID');
    const clientSecret = this.configService.get<string>('LINEAR_CLIENT_SECRET');
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    const callbackUrl =
      this.configService.get<string>('LINEAR_CALLBACK_URL') ??
      `${backendUrl}/api/integrations/linear/callback`;
    if (!clientId || !clientSecret)
      return res.redirect(
        `${frontendUrl}/integrations/linear/error?message=${encodeURIComponent('Linear OAuth not configured')}`,
      );
    try {
      const tokenResponse = await this.linearService.exchangeCodeForToken(
        code,
        clientId,
        clientSecret,
        callbackUrl,
      );
      const teams = await this.linearService.listTeams(
        tokenResponse.access_token,
      );
      if (teams.length === 0)
        return res.redirect(
          `${frontendUrl}/integrations/linear/error?message=${encodeURIComponent('No Linear teams found')}`,
        );
      const team = teams[0];
      const integration = await this.integrationService.createIntegration({
        userId: stateData.userId,
        type: 'linear_oauth',
        name: `Linear - ${team.name}`,
        description: `Connected via OAuth for team: ${team.name}`,
        credentials: {
          accessToken: tokenResponse.access_token,
          teamId: team.id,
          teamName: team.name,
          refreshToken: tokenResponse.refresh_token,
        },
      });
      return res.redirect(
        `${frontendUrl}/integrations/linear/success?integrationId=${String(integration._id)}`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to connect Linear';
      return res.redirect(
        `${frontendUrl}/integrations/linear/error?message=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('jira/callback')
  @Public()
  @HttpCode(HttpStatus.FOUND)
  async handleJiraOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    if (error)
      return res.redirect(
        `${frontendUrl}/integrations/jira/error?message=${encodeURIComponent(error)}`,
      );
    if (!code || !state)
      return res.redirect(
        `${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('Missing code or state')}`,
      );
    let stateData: { userId: string; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    } catch {
      return res.redirect(
        `${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('Invalid state')}`,
      );
    }
    const clientId = this.configService.get<string>('JIRA_CLIENT_ID');
    const clientSecret = this.configService.get<string>('JIRA_CLIENT_SECRET');
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    const callbackUrl =
      this.configService.get<string>('JIRA_CALLBACK_URL') ??
      `${backendUrl}/api/integrations/jira/callback`;
    if (!clientId || !clientSecret)
      return res.redirect(
        `${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('JIRA OAuth not configured')}`,
      );
    try {
      const tokenResponse = await this.jiraService.exchangeCodeForToken(
        code,
        clientId,
        clientSecret,
        callbackUrl,
      );
      const resourcesRes = await firstValueFrom(
        this.httpService.get(
          'https://api.atlassian.com/oauth/token/accessible-resources',
          {
            headers: {
              Authorization: `Bearer ${tokenResponse.access_token}`,
              Accept: 'application/json',
            },
          },
        ),
      );
      const resources = (resourcesRes.data as any[]) ?? [];
      if (resources.length === 0)
        return res.redirect(
          `${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('No JIRA sites found')}`,
        );
      const site = resources[0];
      const siteUrl = site.url;
      const cloudId = site.id;
      if (!cloudId)
        return res.redirect(
          `${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('Cloud ID not found')}`,
        );
      const projects = await this.jiraService.listProjects(
        cloudId,
        tokenResponse.access_token,
        true,
      );
      if (projects.length === 0)
        return res.redirect(
          `${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('No JIRA projects found')}`,
        );
      const projectKey = (projects[0] as any).key;
      const integration = await this.integrationService.createIntegration({
        userId: stateData.userId,
        type: 'jira_oauth',
        name: `JIRA - ${(projects[0] as any).name}`,
        description: `Connected via OAuth for site: ${siteUrl}`,
        credentials: {
          accessToken: tokenResponse.access_token,
          siteUrl,
          cloudId,
          projectKey,
          refreshToken: tokenResponse.refresh_token,
        },
      });
      return res.redirect(
        `${frontendUrl}/integrations/jira/success?integrationId=${String(integration._id)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect JIRA';
      return res.redirect(
        `${frontendUrl}/integrations/jira/error?message=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('discord/callback')
  @Public()
  @HttpCode(HttpStatus.FOUND)
  async handleDiscordOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('guild_id') guildId: string,
    @Res() res: Response,
  ) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    if (error)
      return res.redirect(
        `${frontendUrl}/integrations/discord/error?message=${encodeURIComponent(error)}`,
      );
    if (!code || !state)
      return res.redirect(
        `${frontendUrl}/integrations/discord/error?message=${encodeURIComponent('Missing code or state')}`,
      );
    let stateData: { userId: string; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    } catch {
      return res.redirect(
        `${frontendUrl}/integrations/discord/error?message=${encodeURIComponent('Invalid state')}`,
      );
    }
    const clientId = this.configService.get<string>('DISCORD_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'DISCORD_CLIENT_SECRET',
    );
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    const callbackUrl =
      this.configService.get<string>('DISCORD_CALLBACK_URL') ??
      `${backendUrl}/api/integrations/discord/callback`;
    if (!clientId || !clientSecret)
      return res.redirect(
        `${frontendUrl}/integrations/discord/error?message=${encodeURIComponent('Discord OAuth not configured')}`,
      );
    try {
      const tokenRes = await firstValueFrom(
        this.httpService.post(
          'https://discord.com/api/oauth2/token',
          new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: callbackUrl,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000,
          },
        ),
      );
      const data = tokenRes.data;
      const accessToken = data.access_token;
      const refreshToken = data.refresh_token;
      const botToken =
        this.configService.get<string>('DISCORD_BOT_TOKEN') ?? data.bot?.token;
      if (!botToken)
        return res.redirect(
          `${frontendUrl}/integrations/discord/error?message=${encodeURIComponent('DISCORD_BOT_TOKEN not set. Set it in env from Discord Developer Portal → Bot → Reset Token')}`,
        );
      const userRes = await firstValueFrom(
        this.httpService.get('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
      const discordUser = userRes.data;
      const gid = guildId ?? '';
      let guildName = '';
      if (gid && botToken) {
        try {
          const guildRes = await firstValueFrom(
            this.httpService.get(`https://discord.com/api/guilds/${gid}`, {
              headers: { Authorization: `Bot ${botToken}` },
            }),
          );
          guildName = guildRes.data.name ?? '';
        } catch {
          guildName = '';
        }
      }
      const integration = await this.integrationService.createIntegration({
        userId: stateData.userId,
        type: 'discord_oauth',
        name: guildName
          ? `Discord - ${guildName}`
          : `Discord - ${discordUser.username}`,
        description: `Connected via OAuth as ${discordUser.username}#${discordUser.discriminator ?? ''}`,
        credentials: {
          accessToken,
          refreshToken,
          botToken,
          guildId: gid,
          guildName,
        },
        metadata: {
          discordUserId: discordUser.id,
          discordUsername: discordUser.username,
          discriminator: discordUser.discriminator,
          guildId: gid || undefined,
        },
      });
      return res.redirect(
        `${frontendUrl}/integrations/discord/success?integrationId=${String(integration._id)}`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to connect Discord';
      return res.redirect(
        `${frontendUrl}/integrations/discord/error?message=${encodeURIComponent(msg)}`,
      );
    }
  }
}
