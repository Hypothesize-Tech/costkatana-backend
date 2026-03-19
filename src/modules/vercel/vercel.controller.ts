import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  Header,
  NotFoundException,
  Response,
  Req,
} from '@nestjs/common';
import type {
  Response as ExpressResponse,
  Request as ExpressRequest,
} from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { LoggerService } from '../../common/logger/logger.service';
import { ConfigService } from '@nestjs/config';
import { VercelService } from './vercel.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VercelConnection } from '../../schemas/integration/vercel-connection.schema';
import {
  triggerDeploymentSchema,
  rollbackDeploymentSchema,
  addDomainSchema,
  setEnvVarSchema,
  refreshQuerySchema,
  limitQuerySchema,
  connectionIdParamSchema,
  projectIdParamSchema,
  deploymentIdParamSchema,
  envVarIdParamSchema,
  domainParamSchema,
} from './dto/vercel.dto';
import type {
  TriggerDeploymentDto,
  RollbackDeploymentDto,
  AddDomainDto,
  SetEnvVarDto,
  RefreshQueryDto,
  LimitQueryDto,
  ConnectionIdParamDto,
  ProjectIdParamDto,
  DeploymentIdParamDto,
  EnvVarIdParamDto,
  DomainParamDto,
  VercelConnectionResponseDto,
  VercelProjectResponseDto,
  VercelDeploymentResponseDto,
  VercelDomainResponseDto,
  VercelEnvVarResponseDto,
} from './dto/vercel.dto';

@Controller('api/vercel')
@UseGuards(JwtAuthGuard)
export class VercelController {
  constructor(
    private readonly vercelService: VercelService,
    private readonly loggerService: LoggerService,
    private readonly configService: ConfigService,
    @InjectModel(VercelConnection.name)
    private readonly vercelConnectionModel: Model<VercelConnection>,
  ) {}

  /**
   * Initialize OAuth flow
   * GET /api/vercel/auth
   */
  @Get('auth')
  async initiateOAuth(
    @CurrentUser('id') userId: string,
  ): Promise<{ success: true; data: { authUrl: string } }> {
    const startTime = Date.now();
    try {
      const authUrl = await this.vercelService.initiateOAuth(userId);

      this.loggerService.info('OAuth initiation successful', {
        userId,
        hasAuthUrl: !!authUrl,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: { authUrl },
      };
    } catch (error: any) {
      this.loggerService.error('OAuth initiation failed', {
        userId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * OAuth callback handler - PUBLIC (called by Vercel redirect, no JWT in request)
   * GET /api/vercel/callback
   *
   * For Vercel Integrations, the callback receives:
   * - code: Authorization code to exchange for access token
   * - configurationId: The integration configuration ID
   * - teamId: (optional) The team ID if installed on a team
   * - next: (optional) URL to redirect after setup
   * - state: (optional) Our state token if passed through
   */
  @Public()
  @Get('callback')
  async handleOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('configurationId') configurationId: string,
    @Query('teamId') teamId: string,
    @Query('next') next: string,
    @Response() res: ExpressResponse,
  ): Promise<void> {
    if (!code) {
      const frontendUrl =
        this.configService.getOrThrow<string>('FRONTEND_URL');
      res.redirect(
        `${frontendUrl}/integrations?error=${encodeURIComponent('Missing authorization code')}`,
      );
      return;
    }

    if (!state) {
      // No state means direct installation from Vercel Marketplace
      // We cannot link this to a user account
      this.loggerService.error('Vercel OAuth callback received without state', {
        hasConfigurationId: !!configurationId,
        hasTeamId: !!teamId,
      });
      const frontendUrl =
        this.configService.getOrThrow<string>('FRONTEND_URL');
      res.redirect(
        `${frontendUrl}/integrations?error=${encodeURIComponent('Please connect Vercel from the CostKatana integrations page')}`,
      );
      return;
    }

    try {
      const connection = await this.vercelService.handleCallback(code, state);

      this.loggerService.info('OAuth callback successful', {
        connectionId: connection._id.toString(),
        vercelUsername: connection.vercelUsername,
        teamId: connection.teamId,
      });

      const frontendUrl =
        this.configService.getOrThrow<string>('FRONTEND_URL');
      res.redirect(
        `${frontendUrl}/integrations?vercelConnected=true&message=${encodeURIComponent('Vercel account connected successfully!')}`,
      );
    } catch (error: any) {
      // Note: OAuth callbacks redirect, so we handle redirects in the catch block
      const frontendUrl =
        this.configService.getOrThrow<string>('FRONTEND_URL');
      res.redirect(
        `${frontendUrl}/integrations?error=${encodeURIComponent(error.message || 'OAuth callback failed')}`,
      );
    }
  }

  /**
   * List user's Vercel connections
   * GET /api/vercel/connections
   * Cache-Control prevents stale data after disconnect
   */
  @Get('connections')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async listConnections(
    @CurrentUser('id') userId: string,
  ): Promise<{ success: true; data: VercelConnectionResponseDto[] }> {
    const startTime = Date.now();
    try {
      const connections = await this.vercelService.listConnections(userId);

      this.loggerService.info('List connections successful', {
        userId,
        connectionsCount: connections.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: connections,
      };
    } catch (error: any) {
      this.loggerService.error('List connections failed', {
        userId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Disconnect Vercel account
   * DELETE /api/vercel/connections/:id
   */
  @Delete('connections/:id')
  async disconnectConnection(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
  ): Promise<{ success: true; message: string }> {
    const startTime = Date.now();
    try {
      await this.vercelService.disconnectConnection(params.id, userId);

      this.loggerService.info('Disconnect connection successful', {
        userId,
        connectionId: params.id,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Vercel connection disconnected successfully',
      };
    } catch (error: any) {
      this.loggerService.error('Disconnect connection failed', {
        userId,
        connectionId: params.id,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get projects for a connection
   * GET /api/vercel/connections/:id/projects
   */
  @Get('connections/:id/projects')
  async getProjects(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Query(ZodPipe(refreshQuerySchema)) query: RefreshQueryDto,
  ): Promise<{ success: true; data: VercelProjectResponseDto[] }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const projects = await this.vercelService.getProjects(
        params.id,
        query.refresh,
      );

      this.loggerService.info('Get projects successful', {
        userId,
        connectionId: params.id,
        projectsCount: projects.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: projects,
      };
    } catch (error: any) {
      this.loggerService.error('Get projects failed', {
        userId,
        connectionId: params.id,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get project details
   * GET /api/vercel/connections/:id/projects/:projectId
   */
  @Get('connections/:id/projects/:projectId')
  async getProject(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
  ): Promise<{ success: true; data: VercelProjectResponseDto }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const project = await this.vercelService.getProject(
        params.id,
        projectParams.projectId,
      );

      this.loggerService.info('Get project successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        hasProject: !!project,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: project,
      };
    } catch (error: any) {
      this.loggerService.error('Get project failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get deployments for a project
   * GET /api/vercel/connections/:id/projects/:projectId/deployments
   */
  @Get('connections/:id/projects/:projectId/deployments')
  async getDeployments(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
    @Query(ZodPipe(limitQuerySchema)) query: LimitQueryDto,
  ): Promise<{ success: true; data: VercelDeploymentResponseDto[] }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const deployments = await this.vercelService.getDeployments(
        params.id,
        projectParams.projectId,
        query.limit,
      );

      this.loggerService.info('Get deployments successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        deploymentsCount: deployments.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: deployments,
      };
    } catch (error: any) {
      this.loggerService.error('Get deployments failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Trigger a new deployment
   * POST /api/vercel/connections/:id/projects/:projectId/deploy
   */
  @Post('connections/:id/projects/:projectId/deploy')
  async triggerDeployment(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
    @Body(ZodPipe(triggerDeploymentSchema)) options: TriggerDeploymentDto,
  ): Promise<{ success: true; data: VercelDeploymentResponseDto }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const deployment = await this.vercelService.triggerDeployment(
        params.id,
        projectParams.projectId,
        options,
      );

      this.loggerService.info('Trigger deployment successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        deploymentId: deployment.uid,
        target: options?.target || 'preview',
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: deployment,
      };
    } catch (error: any) {
      this.loggerService.error('Trigger deployment failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get deployment logs
   * GET /api/vercel/connections/:id/deployments/:deploymentId/logs
   */
  @Get('connections/:id/deployments/:deploymentId/logs')
  async getDeploymentLogs(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(deploymentIdParamSchema))
    deploymentParams: DeploymentIdParamDto,
  ): Promise<{ success: true; data: string[] }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const logs = await this.vercelService.getDeploymentLogs(
        params.id,
        deploymentParams.deploymentId,
      );

      this.loggerService.info('Get deployment logs successful', {
        userId,
        connectionId: params.id,
        deploymentId: deploymentParams.deploymentId,
        hasLogs: !!logs,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: logs,
      };
    } catch (error: any) {
      this.loggerService.error('Get deployment logs failed', {
        userId,
        connectionId: params.id,
        deploymentId: deploymentParams.deploymentId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Rollback to a previous deployment
   * POST /api/vercel/connections/:id/deployments/:deploymentId/rollback
   */
  @Post('connections/:id/deployments/:deploymentId/rollback')
  async rollbackDeployment(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(deploymentIdParamSchema))
    deploymentParams: DeploymentIdParamDto,
    @Body(ZodPipe(rollbackDeploymentSchema)) body: RollbackDeploymentDto,
  ): Promise<{ success: true; data: VercelDeploymentResponseDto }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const deployment = await this.vercelService.rollbackDeployment(
        params.id,
        body.projectId,
        deploymentParams.deploymentId,
      );

      this.loggerService.info('Rollback deployment successful', {
        userId,
        connectionId: params.id,
        deploymentId: deploymentParams.deploymentId,
        projectId: body.projectId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: deployment,
      };
    } catch (error: any) {
      this.loggerService.error('Rollback deployment failed', {
        userId,
        connectionId: params.id,
        deploymentId: deploymentParams.deploymentId,
        projectId: body.projectId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Promote deployment to production
   * POST /api/vercel/connections/:id/deployments/:deploymentId/promote
   */
  @Post('connections/:id/deployments/:deploymentId/promote')
  async promoteDeployment(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(deploymentIdParamSchema))
    deploymentParams: DeploymentIdParamDto,
  ): Promise<{ success: true; data: VercelDeploymentResponseDto }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const deployment = await this.vercelService.promoteDeployment(
        params.id,
        deploymentParams.deploymentId,
      );

      this.loggerService.info('Promote deployment successful', {
        userId,
        connectionId: params.id,
        deploymentId: deploymentParams.deploymentId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: deployment,
      };
    } catch (error: any) {
      this.loggerService.error('Promote deployment failed', {
        userId,
        connectionId: params.id,
        deploymentId: deploymentParams.deploymentId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get domains for a project
   * GET /api/vercel/connections/:id/projects/:projectId/domains
   */
  @Get('connections/:id/projects/:projectId/domains')
  async getDomains(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
  ): Promise<{ success: true; data: VercelDomainResponseDto[] }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const domains = await this.vercelService.getDomains(
        params.id,
        projectParams.projectId,
      );

      this.loggerService.info('Get domains successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        domainsCount: domains.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: domains,
      };
    } catch (error: any) {
      this.loggerService.error('Get domains failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Add domain to a project
   * POST /api/vercel/connections/:id/projects/:projectId/domains
   */
  @Post('connections/:id/projects/:projectId/domains')
  async addDomain(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
    @Body(ZodPipe(addDomainSchema)) body: AddDomainDto,
  ): Promise<{ success: true; data: VercelDomainResponseDto }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const result = await this.vercelService.addDomain(
        params.id,
        projectParams.projectId,
        body.domain,
      );

      this.loggerService.info('Add domain successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        domain: body.domain,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      this.loggerService.error('Add domain failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        domain: body.domain,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Remove domain from a project
   * DELETE /api/vercel/connections/:id/projects/:projectId/domains/:domain
   */
  @Delete('connections/:id/projects/:projectId/domains/:domain')
  async removeDomain(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
    @Param(ZodPipe(domainParamSchema)) domainParams: DomainParamDto,
  ): Promise<{ success: true; message: string }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      await this.vercelService.removeDomain(
        params.id,
        projectParams.projectId,
        domainParams.domain,
      );

      this.loggerService.info('Remove domain successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        domain: domainParams.domain,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Domain removed successfully',
      };
    } catch (error: any) {
      this.loggerService.error('Remove domain failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        domain: domainParams.domain,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get environment variables for a project
   * GET /api/vercel/connections/:id/projects/:projectId/env
   */
  @Get('connections/:id/projects/:projectId/env')
  async getEnvVars(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
  ): Promise<{ success: true; data: VercelEnvVarResponseDto[] }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const envVars = await this.vercelService.getEnvVars(
        params.id,
        projectParams.projectId,
      );

      this.loggerService.info('Get env vars successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        envVarsCount: envVars.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: envVars,
      };
    } catch (error: any) {
      this.loggerService.error('Get env vars failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Set environment variable
   * POST /api/vercel/connections/:id/projects/:projectId/env
   */
  @Post('connections/:id/projects/:projectId/env')
  async setEnvVar(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
    @Body(ZodPipe(setEnvVarSchema)) body: SetEnvVarDto,
  ): Promise<{ success: true; data: VercelEnvVarResponseDto }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      const envVar = await this.vercelService.setEnvVar(
        params.id,
        projectParams.projectId,
        body.key,
        body.value,
        body.target,
        body.type,
      );

      this.loggerService.info('Set env var successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        key: body.key,
        target: body.target,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: {
          id: envVar.id,
          key: envVar.key,
          type: envVar.type,
          target: envVar.target,
          createdAt: envVar.createdAt,
          updatedAt: envVar.updatedAt,
        },
      };
    } catch (error: any) {
      this.loggerService.error('Set env var failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        key: body.key,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Delete environment variable
   * DELETE /api/vercel/connections/:id/projects/:projectId/env/:envVarId
   */
  @Delete('connections/:id/projects/:projectId/env/:envVarId')
  async deleteEnvVar(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(connectionIdParamSchema)) params: ConnectionIdParamDto,
    @Param(ZodPipe(projectIdParamSchema)) projectParams: ProjectIdParamDto,
    @Param(ZodPipe(envVarIdParamSchema)) envVarParams: EnvVarIdParamDto,
  ): Promise<{ success: true; message: string }> {
    const startTime = Date.now();
    try {
      // Verify connection belongs to user
      const connection = await this.vercelService.getConnection(
        params.id,
        userId,
      );
      if (!connection) {
        throw new NotFoundException('Vercel connection not found');
      }

      await this.vercelService.deleteEnvVar(
        params.id,
        projectParams.projectId,
        envVarParams.envVarId,
      );

      this.loggerService.info('Delete env var successful', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        envVarId: envVarParams.envVarId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Environment variable deleted successfully',
      };
    } catch (error: any) {
      this.loggerService.error('Delete env var failed', {
        userId,
        connectionId: params.id,
        projectId: projectParams.projectId,
        envVarId: envVarParams.envVarId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Handle Vercel webhook events
   * POST /api/vercel/webhooks
   */
  @Public()
  @Post('webhooks')
  async handleWebhook(
    @Req() req: ExpressRequest,
    @Response() res: ExpressResponse,
  ): Promise<void> {
    try {
      const eventType = req.headers['x-vercel-event'] as string;
      const signature = req.headers['x-vercel-signature'] as string;
      const deliveryId = req.headers['x-vercel-delivery'] as string;

      // Log webhook receipt
      this.loggerService.info('Vercel webhook received', {
        eventType,
        deliveryId,
        hasSignature: !!signature,
      });

      // Vercel REQUIRES signature verification for all webhook requests
      const webhookSecret = this.configService.get<string>(
        'VERCEL_WEBHOOK_SECRET',
      );
      if (!webhookSecret) {
        this.loggerService.error('VERCEL_WEBHOOK_SECRET not configured', {
          deliveryId,
          eventType,
        });
        res.status(500).json({ error: 'Webhook secret not configured' });
        return;
      }

      if (!signature) {
        this.loggerService.warn('Vercel webhook missing signature header', {
          deliveryId,
          eventType,
        });
        res.status(401).json({ error: 'Missing signature' });
        return;
      }

      // Vercel uses HMAC SHA1 for webhook signatures (not SHA256)
      const crypto = require('crypto');

      // Get raw body (must be captured by middleware before JSON parsing)
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);

      // Compute expected signature
      const expectedSignature = crypto
        .createHmac('sha1', webhookSecret)
        .update(rawBody)
        .digest('hex');

      // Use constant-time comparison to prevent timing attacks
      if (
        !crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature),
        )
      ) {
        this.loggerService.warn('Invalid Vercel webhook signature', {
          deliveryId,
          eventType,
          receivedLength: signature.length,
          expectedLength: expectedSignature.length,
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      this.loggerService.info('Vercel webhook signature verified', {
        deliveryId,
        eventType,
      });

      // Handle different event types
      const payload = req.body;

      switch (eventType) {
        case 'deployment.created':
        case 'deployment.succeeded':
        case 'deployment.error':
        case 'deployment.canceled':
        case 'deployment.promoted':
          await this.handleDeploymentEvent(eventType, payload);
          break;

        case 'project.created':
        case 'project.removed':
        case 'project.renamed':
          await this.handleProjectEvent(eventType, payload);
          break;

        case 'project.domain.created':
        case 'project.domain.deleted':
        case 'project.domain.verified':
          await this.handleDomainEvent(eventType, payload);
          break;

        // Note: Configuration events are not available in webhook subscriptions
        // They are automatically subscribed and handled by Vercel internally

        default:
          this.loggerService.info('Unhandled Vercel webhook event', {
            eventType,
            deliveryId,
          });
      }

      // Acknowledge webhook
      res.status(200).json({ received: true });
    } catch (error: any) {
      this.loggerService.error('Vercel webhook processing failed', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        message: 'Webhook processing failed',
        error: error.message,
      });
    }
  }

  /**
   * Handle deployment webhook events
   */
  private async handleDeploymentEvent(
    eventType: string,
    payload: any,
  ): Promise<void> {
    try {
      const deployment = payload.deployment;
      const project = payload.project;

      if (!deployment || !project) {
        this.loggerService.warn('Deployment event missing required data', {
          eventType,
        });
        return;
      }

      // Find connection by project
      const connections = await this.vercelConnectionModel.find({
        'projects.id': project.id,
        isActive: true,
      });

      if (connections.length === 0) {
        this.loggerService.warn(
          'No active connection found for deployment event',
          {
            projectId: project.id,
            eventType,
          },
        );
        return;
      }

      // Update cached project data
      for (const connection of connections) {
        const projectIndex = connection.projects.findIndex(
          (p) => p.id === project.id,
        );
        if (projectIndex !== -1) {
          connection.projects[projectIndex].latestDeployment = {
            id: deployment.id,
            url: deployment.url,
            state: deployment.state,
            createdAt: new Date(deployment.createdAt || Date.now()),
          };
          await connection.save();
        }
      }

      this.loggerService.info('Deployment event processed', {
        eventType,
        deploymentId: deployment.id,
        projectId: project.id,
        state: deployment.state,
      });
    } catch (error: any) {
      this.loggerService.error('Failed to handle deployment event', {
        eventType,
        error: error.message,
      });
    }
  }

  /**
   * Handle project webhook events
   */
  private async handleProjectEvent(
    eventType: string,
    payload: any,
  ): Promise<void> {
    try {
      const project = payload.project;

      if (!project) {
        this.loggerService.warn('Project event missing required data', {
          eventType,
        });
        return;
      }

      // Find connection by project
      const connections = await this.vercelConnectionModel.find({
        'projects.id': project.id,
        isActive: true,
      });

      if (connections.length === 0) {
        this.loggerService.warn(
          'No active connection found for project event',
          {
            projectId: project.id,
            eventType,
          },
        );
        return;
      }

      // Update or remove project from cache
      for (const connection of connections) {
        if (eventType === 'project.removed') {
          connection.projects = connection.projects.filter(
            (p) => p.id !== project.id,
          );
        } else {
          // Update project data
          const projectIndex = connection.projects.findIndex(
            (p) => p.id === project.id,
          );
          if (projectIndex !== -1) {
            connection.projects[projectIndex].name = project.name;
            connection.projects[projectIndex].framework = project.framework;
            connection.projects[projectIndex].updatedAt = new Date();
          }
        }
        await connection.save();
      }

      this.loggerService.info('Project event processed', {
        eventType,
        projectId: project.id,
      });
    } catch (error: any) {
      this.loggerService.error('Failed to handle project event', {
        eventType,
        error: error.message,
      });
    }
  }

  /**
   * Handle domain webhook events
   */
  private async handleDomainEvent(
    eventType: string,
    payload: any,
  ): Promise<void> {
    try {
      const domain = payload.domain;
      const project = payload.project;

      this.loggerService.info('Domain event received', {
        eventType,
        domain: domain?.name,
        projectId: project?.id,
      });

      // Domain events are informational - we can log them
      // Actual domain management is done via API calls
    } catch (error: any) {
      this.loggerService.error('Failed to handle domain event', {
        eventType,
        error: error.message,
      });
    }
  }
}
