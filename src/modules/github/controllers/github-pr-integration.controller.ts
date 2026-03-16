import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Logger,
  ValidationPipe,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { GithubPRIntegrationService } from '../services/github-pr-integration.service';
import { StartIntegrationDto } from '../dto/start-integration.dto';
import { UpdateIntegrationDto } from '../dto/update-integration.dto';

@Controller('api/github')
export class GithubPRIntegrationController {
  private readonly logger = new Logger(GithubPRIntegrationController.name);

  constructor(
    private readonly githubPRIntegrationService: GithubPRIntegrationService,
  ) {}

  /**
   * Start a new GitHub integration
   * POST /api/github/integrations
   */
  @Post('integrations')
  @UseGuards(JwtAuthGuard)
  async startIntegration(
    @CurrentUser() user: any,
    @Body(ValidationPipe) startIntegrationDto: StartIntegrationDto,
  ) {
    try {
      this.logger.log('Starting GitHub integration', {
        userId: user.id,
        repository: startIntegrationDto.repositoryFullName,
        integrationType: startIntegrationDto.integrationType,
        featuresCount: startIntegrationDto.selectedFeatures.length,
      });

      // Override userId from token to ensure security
      const integrationRequest = {
        ...startIntegrationDto,
        userId: user.id,
      };

      const integration =
        await this.githubPRIntegrationService.startIntegration(
          integrationRequest,
        );

      this.logger.log('GitHub integration started successfully', {
        userId: user.id,
        integrationId: integration._id.toString(),
        repository: integration.repositoryFullName,
      });

      return {
        integration: {
          id: integration._id.toString(),
          status: integration.status,
          repositoryFullName: integration.repositoryFullName,
          branchName: integration.branchName,
          integrationType: integration.integrationType,
          selectedFeatures: integration.selectedFeatures,
          createdAt: integration.createdAt,
        },
        message:
          'Integration started successfully. Check status for progress updates.',
      };
    } catch (error: any) {
      this.logger.error('Failed to start GitHub integration', {
        userId: user.id,
        repository: startIntegrationDto.repositoryFullName,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * List user's integrations
   * GET /api/github/integrations
   */
  @Get('integrations')
  @UseGuards(JwtAuthGuard)
  async listIntegrations(@CurrentUser() user: any) {
    try {
      this.logger.log('Listing GitHub integrations', { userId: user.id });

      const integrations =
        await this.githubPRIntegrationService.listUserIntegrations(user.id);

      const formattedIntegrations = integrations.map((integration) => ({
        id: integration._id.toString(),
        repositoryFullName: integration.repositoryFullName,
        repositoryName: integration.repositoryName,
        branchName: integration.branchName,
        status: integration.status,
        integrationType: integration.integrationType,
        selectedFeatures: integration.selectedFeatures,
        prNumber: integration.prNumber,
        prUrl: integration.prUrl,
        prTitle: integration.prTitle,
        errorMessage: integration.errorMessage,
        lastActivityAt: integration.lastActivityAt,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
      }));

      this.logger.log('GitHub integrations listed successfully', {
        userId: user.id,
        count: formattedIntegrations.length,
      });

      return {
        success: true,
        data: formattedIntegrations,
        count: formattedIntegrations.length,
      };
    } catch (error: any) {
      this.logger.error('Failed to list GitHub integrations', {
        userId: user.id,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get integration status
   * GET /api/github/integrations/:integrationId
   */
  @Get('integrations/:integrationId')
  @UseGuards(JwtAuthGuard)
  async getIntegrationStatus(
    @CurrentUser() user: any,
    @Param('integrationId') integrationId: string,
  ) {
    try {
      this.logger.log('Getting integration status', {
        userId: user.id,
        integrationId,
      });

      // First check if the integration belongs to the user
      const integrations =
        await this.githubPRIntegrationService.listUserIntegrations(user.id);
      const integration = integrations.find(
        (integ) => integ._id.toString() === integrationId,
      );

      if (!integration) {
        throw new NotFoundException('Integration not found');
      }

      const status =
        await this.githubPRIntegrationService.getIntegrationStatus(
          integrationId,
        );

      this.logger.log('Integration status retrieved successfully', {
        userId: user.id,
        integrationId,
        status: status.status,
      });

      return status;
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error('Failed to get integration status', {
        userId: user.id,
        integrationId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Update integration from chat
   * POST /api/github/integrations/:integrationId/update
   */
  @Post('integrations/:integrationId/update')
  @UseGuards(JwtAuthGuard)
  async updateIntegration(
    @CurrentUser() user: any,
    @Param('integrationId') integrationId: string,
    @Body(ValidationPipe) updateIntegrationDto: UpdateIntegrationDto,
  ) {
    try {
      this.logger.log('Updating integration from chat', {
        userId: user.id,
        integrationId,
        updates: updateIntegrationDto,
      });

      // First check if the integration belongs to the user
      const integrations =
        await this.githubPRIntegrationService.listUserIntegrations(user.id);
      const integration = integrations.find(
        (integ) => integ._id.toString() === integrationId,
      );

      if (!integration) {
        throw new NotFoundException('Integration not found');
      }

      const updatedIntegration =
        await this.githubPRIntegrationService.updateIntegrationFromChat(
          integrationId,
          updateIntegrationDto,
        );

      this.logger.log('Integration updated successfully', {
        userId: user.id,
        integrationId,
        status: updatedIntegration.status,
      });

      return {
        integration: {
          id: updatedIntegration._id.toString(),
          status: updatedIntegration.status,
          repositoryFullName: updatedIntegration.repositoryFullName,
          branchName: updatedIntegration.branchName,
          integrationType: updatedIntegration.integrationType,
          selectedFeatures: updatedIntegration.selectedFeatures,
          prNumber: updatedIntegration.prNumber,
          prUrl: updatedIntegration.prUrl,
          lastActivityAt: updatedIntegration.lastActivityAt,
          updatedAt: updatedIntegration.updatedAt,
        },
        message: 'Integration updated successfully',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error('Failed to update integration', {
        userId: user.id,
        integrationId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get integration statistics for user
   * GET /api/github/integrations/stats
   */
  @Get('integrations/stats')
  @UseGuards(JwtAuthGuard)
  async getIntegrationStats(@CurrentUser() user: any) {
    try {
      this.logger.log('Getting integration statistics', { userId: user.id });

      const integrations =
        await this.githubPRIntegrationService.listUserIntegrations(user.id);

      const stats = {
        total: integrations.length,
        byStatus: {
          initializing: integrations.filter((i) => i.status === 'initializing')
            .length,
          analyzing: integrations.filter((i) => i.status === 'analyzing')
            .length,
          generating: integrations.filter((i) => i.status === 'generating')
            .length,
          draft: integrations.filter((i) => i.status === 'draft').length,
          open: integrations.filter((i) => i.status === 'open').length,
          updating: integrations.filter((i) => i.status === 'updating').length,
          merged: integrations.filter((i) => i.status === 'merged').length,
          closed: integrations.filter((i) => i.status === 'closed').length,
          failed: integrations.filter((i) => i.status === 'failed').length,
          permission_error: integrations.filter(
            (i) => i.status === 'permission_error',
          ).length,
        },
        byType: {
          npm: integrations.filter((i) => i.integrationType === 'npm').length,
          cli: integrations.filter((i) => i.integrationType === 'cli').length,
          python: integrations.filter((i) => i.integrationType === 'python')
            .length,
          'http-headers': integrations.filter(
            (i) => i.integrationType === 'http-headers',
          ).length,
        },
        recent: integrations.filter(
          (i) => i.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        ).length, // Last 7 days
        withPRs: integrations.filter((i) => i.prNumber).length,
      };

      this.logger.log('Integration statistics retrieved', {
        userId: user.id,
        stats,
      });

      return stats;
    } catch (error: any) {
      this.logger.error('Failed to get integration statistics', {
        userId: user.id,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}
