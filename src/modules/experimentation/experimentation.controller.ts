/**
 * Experimentation Controller
 *
 * Handles all experimentation endpoints including real-time model comparisons,
 * what-if scenarios, and SSE streaming for progress updates.
 */

import * as crypto from 'crypto';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UsePipes,
  UnauthorizedException,
  NotFoundException,
  Logger,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import type { z } from 'zod';

import { ExperimentationService } from './services/experimentation.service';

// DTOs
import {
  RunModelComparisonDto,
  StartRealTimeComparisonDto,
  EstimateExperimentCostDto,
  CreateWhatIfScenarioDto,
  RunRealTimeSimulationDto,
  GetExperimentHistoryQueryDto,
  GetExperimentHistoryQueryDtoType,
  RealTimeComparisonDtoSchema,
  ModelComparisonDtoSchema,
} from './dto/experimentation.dto';
import type {
  ModelComparisonRequest,
  RealTimeComparisonRequest,
  CreateWhatIfScenarioRequest,
  WhatIfSimulationRequest,
  EstimateExperimentCostRequest,
} from './interfaces/experimentation.interfaces';

// Services
import {
  AIRouterService,
  ModelRoute,
} from '../cortex/services/ai-router.service';

@Controller('api/experimentation')
export class ExperimentationController {
  private readonly logger = new Logger(ExperimentationController.name);

  constructor(
    private readonly experimentationService: ExperimentationService,
    private readonly aiRouterService: AIRouterService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * SSE endpoint for real-time comparison progress
   * Marked as @Public() and validates session manually
   */
  @Public()
  @Sse('comparison-progress/:sessionId')
  streamComparisonProgress(
    @Param('sessionId') sessionId: string,
  ): Observable<MessageEvent> {
    const validation = this.experimentationService.validateSession(sessionId);
    if (!validation.isValid) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return new Observable<MessageEvent>((observer) => {
      // Send initial connection message
      observer.next({ data: { type: 'connection', sessionId } });

      const handler = (data: any) => {
        observer.next({ data });

        // Complete the stream when comparison is done
        if (data.stage === 'completed' || data.stage === 'failed') {
          setTimeout(() => {
            observer.complete();
          }, 1000); // Give client time to process final message
        }
      };

      const emitter = this.experimentationService.getProgressEmitter();
      emitter.on('progress', handler);

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        observer.next({ data: { type: 'heartbeat' } });
      }, 30000);

      // Cleanup on unsubscribe
      return () => {
        emitter.off('progress', handler);
        clearInterval(heartbeat);
      };
    });
  }

  /**
   * Get available models for experimentation
   */
  @Get('available-models')
  async getAvailableModels() {
    const allRoutes = await this.aiRouterService.getFullModelRegistry();

    const data = allRoutes.map((route: ModelRoute) => ({
      provider: route.provider,
      model: route.model,
      region: route.region,
      status: route.isActive ? 'available' : 'unavailable',
      availabilityStatus: route.isActive
        ? 'available'
        : ('not_configured' as const),
      healthScore: route.healthScore,
      priority: route.priority,
      notes: route.isActive
        ? undefined
        : 'Enable this model in AWS Bedrock (account/region) or adjust router config.',
    }));

    return {
      success: true,
      data,
      metadata: {
        totalModels: data.length,
        providers: [...new Set(data.map((m) => m.provider))],
        note: 'Includes inactive routes so you can see the full catalog; inactive models are greyed out in the UI.',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Get experiment history
   */
  @UseGuards(JwtAuthGuard)
  @Get('history')
  async getExperimentHistory(
    @Query() query: GetExperimentHistoryQueryDto,
    @CurrentUser('id') userId: string,
  ) {
    const q = query as unknown as GetExperimentHistoryQueryDtoType;
    const filters = {
      type: q.type,
      status: q.status,
      startDate: q.startDate ? new Date(q.startDate) : undefined,
      endDate: q.endDate ? new Date(q.endDate) : undefined,
      limit: q.limit,
    };

    const experiments = await this.experimentationService.getExperimentHistory(
      userId,
      filters,
    );
    return {
      success: true,
      data: experiments,
      metadata: {
        totalExperiments: experiments.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Run model comparison experiment
   * Uses ZodPipe to validate body (bypasses global ValidationPipe whitelist that strips body for empty DTOs)
   */
  @UseGuards(JwtAuthGuard)
  @UsePipes(ZodPipe(ModelComparisonDtoSchema))
  @Post('model-comparison')
  async runModelComparison(
    @Body() dto: z.infer<typeof ModelComparisonDtoSchema>,
    @CurrentUser('id') userId: string,
  ) {
    const request = dto as unknown as ModelComparisonRequest;
    const experiment = await this.experimentationService.runModelComparison(
      userId,
      request,
    );
    return {
      success: true,
      data: experiment,
      metadata: {
        experimentId: experiment.id,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Start real-time model comparison with SSE streaming
   * Uses ZodPipe to validate body (bypasses global ValidationPipe whitelist that strips body for empty DTOs)
   */
  @UseGuards(JwtAuthGuard)
  @UsePipes(ZodPipe(RealTimeComparisonDtoSchema))
  @Post('real-time-comparison')
  async startRealTimeComparison(
    @Body() dto: z.infer<typeof RealTimeComparisonDtoSchema>,
    @CurrentUser('id') userId: string,
  ) {
    // Generate sessionId when not provided (required for SSE progress streaming).
    // Must be a valid JWT so the SSE endpoint can verify it and associate progress with the user.
    const sessionId =
      dto.sessionId ??
      this.jwtService.sign(
        {
          id: userId,
          jti: `rt_${Date.now()}_${crypto.randomUUID()}`,
        },
        { expiresIn: '1h' },
      );

    const request: RealTimeComparisonRequest = {
      ...dto,
      sessionId,
      executeOnBedrock: dto.executeOnBedrock ?? true,
      comparisonMode: dto.comparisonMode ?? 'comprehensive',
    };

    // Run comparison in background so client can connect to SSE before/during execution.
    // Fire-and-forget: progress and completion are sent via progress emitter.
    this.experimentationService
      .runRealTimeModelComparison(userId, request)
      .catch((err) =>
        this.logger.error('Background comparison failed', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );

    return {
      success: true,
      data: {
        sessionId,
        message:
          'Real-time model comparison started. Connect to SSE endpoint for progress updates.',
        estimatedDuration: (request.models?.length ?? 0) * 10 || 10,
      },
    };
  }

  /**
   * Estimate experiment cost
   */
  @Public()
  @Post('estimate-cost')
  async estimateExperimentCost(@Body() dto: EstimateExperimentCostDto) {
    const params = dto as unknown as EstimateExperimentCostRequest;
    const costEstimate =
      await this.experimentationService.estimateExperimentCost(
        params.type,
        params.parameters,
      );
    return {
      success: true,
      data: costEstimate,
    };
  }

  /**
   * Get experiment recommendations
   */
  @UseGuards(JwtAuthGuard)
  @Get('recommendations')
  async getExperimentRecommendations(@CurrentUser('id') userId: string) {
    const recommendations =
      await this.experimentationService.getExperimentRecommendations(userId);
    return {
      success: true,
      data: recommendations,
      metadata: {
        totalRecommendations: recommendations.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Get what-if scenarios
   */
  @UseGuards(JwtAuthGuard)
  @Get('what-if-scenarios')
  async getWhatIfScenarios(@CurrentUser('id') userId: string) {
    const scenarios =
      await this.experimentationService.getWhatIfScenarios(userId);
    return {
      success: true,
      data: scenarios,
      metadata: {
        totalScenarios: scenarios.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Create what-if scenario
   */
  @UseGuards(JwtAuthGuard)
  @Post('what-if-scenarios')
  async createWhatIfScenario(
    @Body() dto: CreateWhatIfScenarioDto,
    @CurrentUser('id') userId: string,
  ) {
    const request = dto as unknown as CreateWhatIfScenarioRequest;
    const scenario = await this.experimentationService.createWhatIfScenario(
      userId,
      request,
    );
    return {
      success: true,
      data: scenario,
      message: 'What-if scenario created successfully',
    };
  }

  /**
   * Run what-if analysis
   */
  @UseGuards(JwtAuthGuard)
  @Post('what-if-scenarios/:scenarioName/analyze')
  async runWhatIfAnalysis(
    @Param('scenarioName') scenarioName: string,
    @CurrentUser('id') userId: string,
  ) {
    const analysis = await this.experimentationService.runWhatIfAnalysis(
      userId,
      scenarioName,
    );
    return {
      success: true,
      data: analysis,
      message: 'What-if analysis completed successfully',
    };
  }

  /**
   * Delete what-if scenario
   */
  @UseGuards(JwtAuthGuard)
  @Delete('what-if-scenarios/:scenarioName')
  async deleteWhatIfScenario(
    @Param('scenarioName') scenarioName: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.experimentationService.deleteWhatIfScenario(
      userId,
      scenarioName,
    );
    return {
      success: true,
      data: null,
      message: 'What-if scenario deleted successfully',
    };
  }

  /**
   * Run real-time what-if simulation
   */
  @Public()
  @Post('real-time-simulation')
  async runRealTimeSimulation(@Body() dto: RunRealTimeSimulationDto) {
    const request = dto as unknown as WhatIfSimulationRequest;
    const simulation =
      await this.experimentationService.runRealTimeWhatIfSimulation(request);
    return {
      success: true,
      data: simulation,
      message: 'Real-time simulation completed successfully',
    };
  }

  /**
   * Persisted comparison job (SSE reconnect / poll)
   */
  @UseGuards(JwtAuthGuard)
  @Get('comparison-job/:sessionId')
  async getComparisonJob(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    const job = await this.experimentationService.getComparisonJobState(
      sessionId,
      userId,
    );
    if (!job) {
      throw new NotFoundException('Comparison job not found');
    }
    return { success: true, data: job };
  }

  /**
   * Fine-tuning ROI / usage analysis (heuristic)
   */
  @UseGuards(JwtAuthGuard)
  @Get('fine-tuning-analysis')
  async getFineTuningAnalysis(
    @CurrentUser('id') userId: string,
    @Query('projectId') projectId?: string,
  ) {
    const data = await this.experimentationService.getFineTuningAnalysis(
      userId,
      projectId ?? 'default',
    );
    return { success: true, data };
  }

  /**
   * Update what-if scenario lifecycle status
   */
  @UseGuards(JwtAuthGuard)
  @Patch('what-if-scenarios/:scenarioName/lifecycle')
  async updateWhatIfLifecycle(
    @Param('scenarioName') scenarioName: string,
    @Body()
    body: { status: string; projectedMonthlySavings?: number },
    @CurrentUser('id') userId: string,
  ) {
    const updated =
      await this.experimentationService.updateWhatIfScenarioLifecycle(
        userId,
        scenarioName,
        body.status,
        { projectedMonthlySavings: body.projectedMonthlySavings },
      );
    if (!updated) {
      throw new NotFoundException('Scenario not found');
    }
    return {
      success: true,
      data: updated,
      message: 'Scenario lifecycle updated',
    };
  }

  /**
   * Export experiment results (JSON or CSV) — must be registered before GET :experimentId
   */
  @UseGuards(JwtAuthGuard)
  @Get(':experimentId/export')
  async exportExperimentResults(
    @Param('experimentId') experimentId: string,
    @Query('format') format: string | undefined,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    const fmt = format === 'csv' ? 'csv' : 'json';
    const { buffer, contentType, filename } =
      await this.experimentationService.exportExperimentResults(
        experimentId,
        userId,
        fmt,
      );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /**
   * Get experiment by ID
   */
  @UseGuards(JwtAuthGuard)
  @Get(':experimentId')
  async getExperimentById(
    @Param('experimentId') experimentId: string,
    @CurrentUser('id') userId: string,
  ) {
    const experiment = await this.experimentationService.getExperimentById(
      experimentId,
      userId,
    );
    if (!experiment) {
      throw new NotFoundException('Experiment not found');
    }
    return {
      success: true,
      data: experiment,
    };
  }

  /**
   * Delete experiment
   */
  @UseGuards(JwtAuthGuard)
  @Delete(':experimentId')
  async deleteExperiment(
    @Param('experimentId') experimentId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.experimentationService.deleteExperiment(experimentId, userId);
    return {
      success: true,
      data: null,
      message: 'Experiment deleted successfully',
    };
  }
}
