import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OnboardingService } from './onboarding.service';
import { ProjectService } from '../project/project.service';
import {
  CompleteStepDto,
  CreateOnboardingProjectDto,
  ExecuteLlmQueryDto,
} from './dto';

@Controller('api/onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingApiController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly projectService: ProjectService,
  ) {}

  private requireUserId(user: AuthenticatedUser | null): string {
    if (!user?.id) {
      throw new BadRequestException('Authentication required');
    }
    return user.id;
  }

  /**
   * Get onboarding status. Auto-initializes if no status exists.
   * GET /api/onboarding/status
   */
  @Get('status')
  async getOnboardingStatus(@CurrentUser() user: AuthenticatedUser | null) {
    const userId = this.requireUserId(user);
    let status = await this.onboardingService.getOnboardingStatus(userId);
    if (!status) {
      status = await this.onboardingService.initializeOnboarding(userId);
      return { success: true, data: status, initialized: true };
    }
    return { success: true, data: status };
  }

  /**
   * Initialize onboarding (reset to initial state).
   * POST /api/onboarding/initialize
   */
  @Post('initialize')
  @HttpCode(HttpStatus.OK)
  async initializeOnboarding(@CurrentUser() user: AuthenticatedUser | null) {
    const userId = this.requireUserId(user);
    const status = await this.onboardingService.initializeOnboarding(userId);
    return { success: true, data: status };
  }

  /**
   * Complete a single onboarding step.
   * POST /api/onboarding/complete-step
   */
  @Post('complete-step')
  @HttpCode(HttpStatus.OK)
  async completeStep(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: CompleteStepDto,
  ) {
    const userId = this.requireUserId(user);
    const status = await this.onboardingService.completeStep(
      userId,
      dto.stepId,
    );
    return { success: true, data: status };
  }

  /**
   * Create project during onboarding.
   * POST /api/onboarding/create-project
   */
  @Post('create-project')
  @HttpCode(HttpStatus.CREATED)
  async createProject(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: CreateOnboardingProjectDto,
  ) {
    const userId = this.requireUserId(user);
    const project = await this.onboardingService.createProject(userId, dto);
    return {
      success: true,
      data: project,
      message: 'Project created successfully',
    };
  }

  /**
   * Execute LLM query during onboarding (uses Cortex AIRouter, tracks usage).
   * POST /api/onboarding/llm-query
   */
  @Post('llm-query')
  @HttpCode(HttpStatus.OK)
  async executeLlmQuery(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: ExecuteLlmQueryDto,
  ) {
    const userId = this.requireUserId(user);
    const projects = await this.projectService.getUserProjects(userId);
    const projectId = projects[0]?._id?.toString?.();
    if (!projectId) {
      throw new BadRequestException(
        'No project found. Please create a project first.',
      );
    }
    const response = await this.onboardingService.executeLlmQuery(
      userId,
      dto.query,
      dto.model,
      projectId,
    );
    return {
      success: true,
      data: response,
      message: 'LLM query executed successfully',
    };
  }

  /**
   * Complete onboarding flow.
   * POST /api/onboarding/complete
   */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async completeOnboarding(@CurrentUser() user: AuthenticatedUser | null) {
    const userId = this.requireUserId(user);
    const status = await this.onboardingService.completeOnboarding(userId);
    return {
      success: true,
      data: status,
      message: 'Onboarding completed successfully!',
    };
  }

  /**
   * Skip onboarding.
   * POST /api/onboarding/skip
   */
  @Post('skip')
  @HttpCode(HttpStatus.OK)
  async skipOnboarding(@CurrentUser() user: AuthenticatedUser | null) {
    const userId = this.requireUserId(user);
    const status = await this.onboardingService.skipOnboarding(userId);
    return {
      success: true,
      data: status,
      message: 'Onboarding skipped successfully!',
    };
  }

  /**
   * Get available LLM models for onboarding (for UI dropdown).
   * GET /api/onboarding/models
   */
  @Get('models')
  async getAvailableModels() {
    const models = this.onboardingService.getAvailableModels();
    return { success: true, data: models };
  }
}
