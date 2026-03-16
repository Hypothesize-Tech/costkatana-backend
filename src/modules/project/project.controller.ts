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
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ProjectService } from './project.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { WorkspaceRoleGuard } from '../team/guards/workspace-role.guard';
import { RequireWorkspaceRole } from '../team/decorators/require-workspace-role.decorator';
import {
  CreateProjectDto,
  UpdateProjectDto,
  AnalyticsQueryDto,
  CostAllocationQueryDto,
  ExportQueryDto,
  ApprovalsQueryDto,
  HandleApprovalDto,
} from './dto';

interface AuthenticatedUser {
  id: string;
  workspaceId?: string;
}

@Controller('api/projects')
export class ProjectController {
  private readonly logger = new Logger(ProjectController.name);

  constructor(private readonly projectService: ProjectService) {}

  private requireUserId(user: AuthenticatedUser | undefined): string {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }
    return user.id;
  }

  /**
   * Get all projects for the authenticated user (read-only, supports API key)
   * GET /v1/projects
   */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async getUserProjects(@CurrentUser() user?: AuthenticatedUser) {
    const userId = this.requireUserId(user);
    const projects = await this.projectService.getUserProjects(userId);
    return { success: true, data: projects };
  }

  /**
   * Create a new project
   * POST /v1/projects
   */
  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
  @RequireWorkspaceRole('admin')
  @HttpCode(HttpStatus.CREATED)
  async createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createProjectDto: CreateProjectDto,
  ) {
    const userId = this.requireUserId(user);
    const project = await this.projectService.createProject(
      userId,
      createProjectDto,
    );
    return {
      success: true,
      data: project,
      message: 'Project created successfully',
    };
  }

  /**
   * Recalculate all user project spending
   * POST /v1/projects/recalculate-all-spending
   */
  @Post('recalculate-all-spending')
  @UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
  @RequireWorkspaceRole('admin')
  @HttpCode(HttpStatus.OK)
  async recalculateUserProjectSpending(@CurrentUser() user: AuthenticatedUser) {
    const userId = this.requireUserId(user);
    await this.projectService.recalculateUserProjectSpending(userId);
    return {
      success: true,
      message: 'All project spending recalculated successfully',
    };
  }

  /**
   * Handle approval request (must be before :projectId routes)
   * POST /v1/projects/approvals/:requestId
   */
  @Post('approvals/:requestId')
  @UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
  @RequireWorkspaceRole('admin')
  async handleApprovalRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body() body: HandleApprovalDto,
  ) {
    const userId = this.requireUserId(user);
    try {
      const request = await this.projectService.handleApprovalRequest(
        requestId,
        userId,
        body.action,
        body.comments,
        body.conditions,
      );
      return {
        success: true,
        data: request,
        message: `Request ${body.action}d successfully`,
      };
    } catch (err: any) {
      if (err.message === 'Approval request not found') {
        throw new NotFoundException('Approval request not found');
      }
      if (err.message === 'Request has already been processed') {
        throw new BadRequestException('Request has already been processed');
      }
      if (err.message === 'Invalid action') {
        throw new BadRequestException('Invalid action');
      }
      throw err;
    }
  }

  /**
   * Get single project (read-only, supports API key)
   * GET /v1/projects/:projectId
   */
  @Get(':projectId')
  @UseGuards(OptionalJwtAuthGuard)
  async getProject(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('projectId') projectId: string,
  ) {
    const userId = this.requireUserId(user);
    try {
      const project = await this.projectService.getProjectById(
        projectId,
        userId,
      );
      return { success: true, data: project };
    } catch (err: any) {
      if (
        err.message === 'Project not found' ||
        err.message === 'Project not found after recalculation'
      ) {
        throw new NotFoundException('Project not found');
      }
      if (err.message === 'Access denied') {
        throw new UnauthorizedException('Access denied');
      }
      throw err;
    }
  }

  /**
   * Get project analytics
   * GET /v1/projects/:projectId/analytics
   */
  @Get(':projectId/analytics')
  @UseGuards(OptionalJwtAuthGuard)
  async getProjectAnalytics(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('projectId') projectId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    const userId = this.requireUserId(user);
    try {
      const analytics = await this.projectService.getProjectAnalytics(
        projectId,
        query.period,
      );
      return { success: true, data: analytics };
    } catch (err: any) {
      if (err.message === 'Project not found') {
        throw new NotFoundException('Project not found');
      }
      throw err;
    }
  }

  /**
   * Get cost allocation
   * GET /v1/projects/:projectId/cost-allocation
   */
  @Get(':projectId/cost-allocation')
  @UseGuards(OptionalJwtAuthGuard)
  async getCostAllocation(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('projectId') projectId: string,
    @Query() query: CostAllocationQueryDto,
  ) {
    this.requireUserId(user);
    try {
      const allocation = await this.projectService.getCostAllocation(
        projectId,
        {
          groupBy: query.groupBy,
          startDate: query.startDate ? new Date(query.startDate) : undefined,
          endDate: query.endDate ? new Date(query.endDate) : undefined,
        },
      );
      return { success: true, data: allocation };
    } catch (err: any) {
      if (err.message === 'Project not found') {
        throw new NotFoundException('Project not found');
      }
      throw err;
    }
  }

  /**
   * Export project data
   * GET /v1/projects/:projectId/export
   */
  @Get(':projectId/export')
  @UseGuards(OptionalJwtAuthGuard)
  async exportProjectData(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('projectId') projectId: string,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ) {
    this.requireUserId(user);
    try {
      const format = query.format ?? 'json';
      const data = await this.projectService.exportProjectData(projectId, {
        format,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
      });
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="project-${projectId}-export.csv"`,
        );
        return res.send(data);
      }
      if (format === 'excel') {
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="project-${projectId}-export.xlsx"`,
        );
        return res.send(data);
      }
      return res.json(data);
    } catch (err: any) {
      if (err.message === 'Project not found') {
        throw new NotFoundException('Project not found');
      }
      throw err;
    }
  }

  /**
   * Get approval requests for a project
   * GET /v1/projects/:projectId/approvals
   */
  @Get(':projectId/approvals')
  @UseGuards(OptionalJwtAuthGuard)
  async getApprovalRequests(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('projectId') projectId: string,
    @Query() query: ApprovalsQueryDto,
  ) {
    this.requireUserId(user);
    const requests = await this.projectService.getApprovalRequests(
      projectId,
      query.status,
    );
    return { success: true, data: requests };
  }

  /**
   * Recalculate project spending
   * POST /v1/projects/:projectId/recalculate-spending
   */
  @Post(':projectId/recalculate-spending')
  @UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
  @RequireWorkspaceRole('admin')
  @HttpCode(HttpStatus.OK)
  async recalculateProjectSpending(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    this.requireUserId(user);
    try {
      await this.projectService.recalculateProjectSpending(projectId);
      return {
        success: true,
        message: 'Project spending recalculated successfully',
      };
    } catch (err: any) {
      if (err.message === 'Project not found') {
        throw new NotFoundException('Project not found');
      }
      throw err;
    }
  }

  /**
   * Update project
   * PUT /v1/projects/:projectId
   */
  @Put(':projectId')
  @UseGuards(JwtAuthGuard)
  async updateProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    const userId = this.requireUserId(user);
    try {
      const project = await this.projectService.updateProject(
        projectId,
        updateProjectDto,
        userId,
      );
      return {
        success: true,
        data: project,
        message: 'Project updated successfully',
      };
    } catch (err: any) {
      if (err.message === 'Project not found') {
        throw new NotFoundException('Project not found');
      }
      if (
        err.message === 'Unauthorized to update project' ||
        err.message === 'Access denied'
      ) {
        throw new UnauthorizedException(err.message);
      }
      throw err;
    }
  }

  /**
   * Delete project
   * DELETE /v1/projects/:projectId
   */
  @Delete(':projectId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    const userId = this.requireUserId(user);
    try {
      await this.projectService.deleteProject(projectId, userId);
      return { success: true, message: 'Project deleted successfully' };
    } catch (err: any) {
      if (err.message === 'Project not found') {
        throw new NotFoundException('Project not found');
      }
      if (err.message === 'Access denied') {
        throw new UnauthorizedException('Access denied');
      }
      throw err;
    }
  }
}
