import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../schemas/user/user.schema';
import { ProjectService } from '../project/project.service';
import { AIRouterService } from '../cortex/services/ai-router.service';
import { UsageService } from '../usage/services/usage.service';
import { CreateProjectDto } from '../project/dto/create-project.dto';
import { BudgetDto } from '../project/dto/budget.dto';
import { CreateOnboardingProjectDto } from './dto/create-onboarding-project.dto';
import type { OnboardingStepId } from './dto/complete-step.dto';
import type { OnboardingLlmModel } from './dto/execute-llm-query.dto';

export interface OnboardingStep {
  id: string;
  name: string;
  completed: boolean;
  data?: Record<string, unknown>;
}

export interface OnboardingData {
  userId: string;
  currentStep: number;
  steps: OnboardingStep[];
  completed: boolean;
  startedAt: Date;
  completedAt?: Date;
  skipped?: boolean;
  skippedAt?: Date;
}

export interface OnboardingLlmResponse {
  content: string;
  model: string;
  tokens: number;
  cost: number;
}

/** Maps front-end model names to Bedrock model IDs supported by AIRouterService. */
const ONBOARDING_MODEL_TO_BEDROCK: Record<OnboardingLlmModel, string> = {
  'gpt-3.5-turbo': 'anthropic.claude-3-5-haiku-20241022-v1:0',
  'gpt-4': 'anthropic.claude-3-opus-20240229-v1:0',
  'claude-3-sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
  'claude-3-opus': 'anthropic.claude-3-opus-20240229-v1:0',
  'gemini-pro': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
};

const ONBOARDING_STEPS: { id: OnboardingStepId; name: string }[] = [
  { id: 'welcome', name: 'Welcome' },
  { id: 'project_creation', name: 'Create Project' },
  { id: 'project_pricing', name: 'Set Project Pricing' },
  { id: 'llm_query', name: 'Make First LLM Call' },
  { id: 'completion', name: 'Complete Setup' },
];

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly projectService: ProjectService,
    private readonly aiRouterService: AIRouterService,
    private readonly usageService: UsageService,
  ) {}

  /**
   * Check if user needs onboarding (completed or skipped means no).
   */
  async needsOnboarding(userId: string): Promise<boolean> {
    const user = await this.userModel
      .findById(userId)
      .select('onboarding')
      .lean();
    if (!user) return true;
    const onboarding = (user as any).onboarding;
    if (onboarding?.completed || onboarding?.skipped) return false;
    return true;
  }

  /**
   * Get user's onboarding status. Returns null if user not found.
   */
  async getOnboardingStatus(userId: string): Promise<OnboardingData | null> {
    const user = await this.userModel
      .findById(userId)
      .select('onboarding')
      .lean();
    if (!user) return null;

    const raw = (user as any).onboarding || {
      completed: false,
      skipped: false,
      projectCreated: false,
      firstLlmCall: false,
      stepsCompleted: [],
    };

    const steps: OnboardingStep[] = ONBOARDING_STEPS.map((step) => ({
      id: step.id,
      name: step.name,
      completed:
        Array.isArray(raw.stepsCompleted) &&
        raw.stepsCompleted.includes(step.id),
      data: this.getStepData(step.id, raw),
    }));

    return {
      userId,
      currentStep: this.getCurrentStepIndex(steps),
      steps,
      completed: Boolean(raw.completed),
      startedAt: raw.completedAt ? new Date(raw.completedAt) : new Date(),
      completedAt: raw.completedAt ? new Date(raw.completedAt) : undefined,
      skipped: Boolean(raw.skipped),
      skippedAt: raw.skippedAt ? new Date(raw.skippedAt) : undefined,
    };
  }

  /**
   * Initialize onboarding for user (reset steps).
   */
  async initializeOnboarding(userId: string): Promise<OnboardingData> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    (user as any).onboarding = {
      completed: false,
      skipped: false,
      projectCreated: false,
      firstLlmCall: false,
      stepsCompleted: [],
    };
    await user.save();

    const steps: OnboardingStep[] = ONBOARDING_STEPS.map((step) => ({
      id: step.id,
      name: step.name,
      completed: false,
    }));

    return {
      userId,
      currentStep: 0,
      steps,
      completed: false,
      startedAt: new Date(),
      skipped: false,
    };
  }

  /**
   * Complete a single onboarding step.
   */
  async completeStep(
    userId: string,
    stepId: OnboardingStepId,
  ): Promise<OnboardingData> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let onboarding = (user as any).onboarding;
    if (!onboarding) {
      await this.initializeOnboarding(userId);
      const u = await this.userModel.findById(userId);
      onboarding = (u as any).onboarding;
    }

    if (!Array.isArray(onboarding.stepsCompleted)) {
      onboarding.stepsCompleted = [];
    }
    if (!onboarding.stepsCompleted.includes(stepId)) {
      onboarding.stepsCompleted.push(stepId);
    }

    switch (stepId) {
      case 'project_creation':
        onboarding.projectCreated = true;
        break;
      case 'llm_query':
        onboarding.firstLlmCall = true;
        break;
      case 'completion':
        onboarding.completed = true;
        onboarding.completedAt = new Date();
        break;
      default:
        break;
    }

    (user as any).onboarding = onboarding;
    await user.save();

    this.logger.log('Onboarding step completed', {
      userId,
      stepId,
      completedSteps: onboarding.stepsCompleted,
      onboardingCompleted: onboarding.completed,
    });

    const status = await this.getOnboardingStatus(userId);
    if (!status) {
      throw new NotFoundException('User not found after step completion');
    }
    return status;
  }

  /**
   * Create project during onboarding and mark project_creation step complete.
   */
  async createProject(
    userId: string,
    dto: CreateOnboardingProjectDto,
  ): Promise<any> {
    const budget: BudgetDto = {
      amount: dto.budget?.amount ?? 100,
      period: dto.budget?.period ?? 'monthly',
      currency: dto.budget?.currency ?? 'USD',
      alerts: [
        { threshold: 50, type: 'in-app' },
        { threshold: 80, type: 'both' },
        { threshold: 90, type: 'both' },
      ],
    };

    const createDto: CreateProjectDto = {
      name: dto.name,
      description: dto.description ?? 'Project created during onboarding',
      budget,
      settings: {
        requireApprovalAbove: dto.settings?.requireApprovalAbove ?? 100,
        enablePromptLibrary: dto.settings?.enablePromptLibrary ?? true,
        enableCostAllocation: dto.settings?.enableCostAllocation ?? true,
        ...dto.settings,
      },
    };

    const project = await this.projectService.createProject(userId, createDto);
    await this.completeStep(userId, 'project_creation');

    this.logger.log('Project created during onboarding', {
      userId,
      projectId: project._id,
      projectName: project.name,
    });

    return project;
  }

  /**
   * Execute an LLM query during onboarding (Cortex AIRouter), track usage, complete llm_query step.
   */
  async executeLlmQuery(
    userId: string,
    query: string,
    model: OnboardingLlmModel,
    projectId: string,
  ): Promise<OnboardingLlmResponse> {
    const bedrockModelId = ONBOARDING_MODEL_TO_BEDROCK[model];

    const result = await this.aiRouterService.invokeModel({
      model: bedrockModelId,
      prompt: query,
      parameters: { temperature: 0.7, maxTokens: 2048 },
      metadata: { userId },
    });

    await this.usageService.trackUsage({
      userId,
      projectId,
      service: 'bedrock',
      model: model,
      prompt: query,
      completion: result.response,
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      cost: result.cost,
      responseTime: result.latency,
      metadata: {
        source: 'onboarding',
        isOnboarding: true,
        modelProvider: 'bedrock',
        requestedModel: model,
        bedrockModelId,
      },
      tags: ['onboarding', 'first-query', model],
    });

    await this.completeStep(userId, 'llm_query');

    this.logger.log('LLM query executed during onboarding', {
      userId,
      model,
      projectId,
      queryLength: query.length,
    });

    return {
      content: result.response,
      model,
      tokens: result.usage.totalTokens,
      cost: result.cost,
    };
  }

  /**
   * Mark onboarding as fully completed.
   */
  async completeOnboarding(userId: string): Promise<OnboardingData> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    (user as any).onboarding = (user as any).onboarding || {};
    (user as any).onboarding.completed = true;
    (user as any).onboarding.skipped = false;
    (user as any).onboarding.completedAt = new Date();
    await user.save();

    await this.completeStep(userId, 'completion');

    this.logger.log('Onboarding completed successfully', {
      userId,
      completedAt: (user as any).onboarding.completedAt,
    });

    const status = await this.getOnboardingStatus(userId);
    if (!status) {
      throw new NotFoundException('User not found after completion');
    }
    return status;
  }

  /**
   * Skip onboarding for the user.
   */
  async skipOnboarding(userId: string): Promise<OnboardingData> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    (user as any).onboarding = (user as any).onboarding || {};
    (user as any).onboarding.skipped = true;
    (user as any).onboarding.completed = false;
    (user as any).onboarding.skippedAt = new Date();
    await user.save();

    this.logger.log('Onboarding skipped successfully', {
      userId,
      skippedAt: (user as any).onboarding.skippedAt,
    });

    const status = await this.getOnboardingStatus(userId);
    if (!status) {
      throw new NotFoundException('User not found after skip');
    }
    return status;
  }

  /**
   * Return available LLM models for onboarding (for UI).
   */
  getAvailableModels(): Array<{ id: string; name: string; provider: string }> {
    return [
      { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI' },
      { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
      { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'Anthropic' },
      { id: 'gemini-pro', name: 'Gemini Pro', provider: 'Google' },
    ];
  }

  private getCurrentStepIndex(steps: OnboardingStep[]): number {
    const completedCount = steps.filter((s) => s.completed).length;
    return Math.min(completedCount, ONBOARDING_STEPS.length - 1);
  }

  private getStepData(
    stepId: string,
    onboarding: {
      projectCreated?: boolean;
      firstLlmCall?: boolean;
    },
  ): Record<string, unknown> | undefined {
    switch (stepId) {
      case 'project_creation':
        return { projectCreated: onboarding.projectCreated };
      case 'llm_query':
        return { firstLlmCall: onboarding.firstLlmCall };
      default:
        return undefined;
    }
  }
}
