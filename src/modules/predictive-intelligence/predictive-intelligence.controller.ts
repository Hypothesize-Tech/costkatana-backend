import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { PredictiveCostIntelligenceService } from './services/predictive-cost-intelligence.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ServiceHelper } from '@/utils/serviceHelper';
import {
  PredictiveIntelligenceQueryDto,
  AlertsQueryDto,
  BudgetProjectionsQueryDto,
  OptimizationsQueryDto,
  ScenariosQueryDto,
  DashboardQueryDto,
  ScopeQueryDto,
} from './dto/predictive-query.dto';

const REQUEST_TIMEOUT_MS = 30000;
const MAX_SERVICE_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_MS = 300000;

@Controller('api/predictive-intelligence')
@UseGuards(JwtAuthGuard)
export class PredictiveIntelligenceController {
  private readonly logger = new Logger(PredictiveIntelligenceController.name);
  private serviceFailureCount = 0;
  private lastServiceFailureTime = 0;

  constructor(
    private readonly predictiveService: PredictiveCostIntelligenceService,
  ) {}

  @Get()
  async getPredictiveIntelligence(
    @CurrentUser('id') userId: string,
    @Query() query: PredictiveIntelligenceQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scope === 'project' && !scopeId) {
      throw new HttpException(
        'Project ID required when scope is project',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (scope === 'team' && !scopeId) {
      throw new HttpException(
        'Team ID required when scope is team',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (scopeId) {
      ServiceHelper.validateObjectId(scopeId, 'scopeId');
    }
    const timeHorizon = query.timeHorizon ?? 30;
    const parsed = parseInt(String(timeHorizon), 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 365) {
      throw new HttpException(
        'Time horizon must be between 1 and 365 days',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (this.isCircuitBreakerOpen()) {
      throw new HttpException(
        'Service temporarily unavailable. Please try again later.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('Request timeout')),
        REQUEST_TIMEOUT_MS,
      );
    });
    const intelligencePromise =
      this.predictiveService.generatePredictiveIntelligence(userId, {
        scope,
        scopeId,
        timeHorizon: parsed,
        includeScenarios:
          query.includeScenarios === true ||
          query.includeScenarios === undefined,
        includeCrossPlatform:
          query.includeCrossPlatform === true ||
          query.includeCrossPlatform === undefined,
      });
    try {
      const data = await Promise.race([intelligencePromise, timeoutPromise]);
      this.serviceFailureCount = 0;
      return {
        success: true,
        data,
        message: 'Predictive intelligence generated successfully',
      };
    } catch (error: any) {
      this.recordFailure();
      if (error?.message === 'Request timeout') {
        throw new HttpException(
          'Request timeout - analysis took too long. Please try again with a smaller scope.',
          HttpStatus.REQUEST_TIMEOUT,
        );
      }
      if (error?.message?.includes('circuit breaker')) {
        throw new HttpException(
          'Service temporarily unavailable. Please try again later.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.logger.error('getPredictiveIntelligence failed', {
        error: error?.message,
        userId,
      });
      throw new HttpException(
        'Failed to generate predictive intelligence',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('dashboard')
  async getDashboardSummary(
    @CurrentUser('id') userId: string,
    @Query() query: DashboardQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scopeId) ServiceHelper.validateObjectId(scopeId, 'scopeId');
    const data = await this.predictiveService.generatePredictiveIntelligence(
      userId,
      {
        scope,
        scopeId,
        timeHorizon: 30,
        includeScenarios: true,
        includeCrossPlatform: true,
      },
    );
    const criticalAlerts = data.proactiveAlerts.filter(
      (a) => a.severity === 'critical',
    ).length;
    const highAlerts = data.proactiveAlerts.filter(
      (a) => a.severity === 'high',
    ).length;
    const totalPotentialSavings = data.optimizationRecommendations.reduce(
      (s, o) => s + o.potentialSavings,
      0,
    );
    const budgetRisk = data.budgetExceedanceProjections.filter(
      (p) => p.exceedanceProbability > 0.7,
    ).length;
    const summary = {
      overview: {
        confidenceScore: data.confidenceScore,
        timeHorizon: data.timeHorizon,
        lastUpdated: data.lastUpdated,
        scopeType: scope,
        scopeId: scopeId ?? null,
      },
      alerts: {
        critical: criticalAlerts,
        high: highAlerts,
        total: data.proactiveAlerts.length,
        mostUrgent: data.proactiveAlerts[0] ?? null,
      },
      budgetRisk: {
        projectsAtRisk: budgetRisk,
        totalPotentialExceedance: data.budgetExceedanceProjections.reduce(
          (s, p) => s + p.exceedanceAmount,
          0,
        ),
        nearestExceedanceDate:
          data.budgetExceedanceProjections.length > 0
            ? [...data.budgetExceedanceProjections].sort(
                (a, b) => a.daysUntilExceedance - b.daysUntilExceedance,
              )[0].projectedExceedDate
            : null,
      },
      optimization: {
        totalPotentialSavings,
        easyImplementations: data.optimizationRecommendations.filter(
          (o) => o.implementationDifficulty === 'easy',
        ).length,
        topRecommendation: data.optimizationRecommendations[0] ?? null,
      },
      trends: {
        tokenGrowthRate: data.promptLengthGrowth.growthRatePerWeek,
        efficiencyTrend: data.historicalTokenTrends.tokenEfficiencyTrend,
        modelSwitchFrequency: data.modelSwitchPatterns.switchFrequency,
      },
      scenarios: {
        bestCaseScenario:
          data.scenarioSimulations.length > 0
            ? data.scenarioSimulations.reduce((best, cur) =>
                cur.projectedCosts.savings > best.projectedCosts.savings
                  ? cur
                  : best,
              )
            : null,
        totalScenarios: data.scenarioSimulations.length,
      },
    };
    return {
      success: true,
      data: summary,
      message: 'Dashboard summary retrieved successfully',
    };
  }

  @Get('alerts')
  async getProactiveAlerts(
    @CurrentUser('id') userId: string,
    @Query() query: AlertsQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scopeId) ServiceHelper.validateObjectId(scopeId, 'scopeId');
    const data = await this.predictiveService.generatePredictiveIntelligence(
      userId,
      {
        scope,
        scopeId,
        timeHorizon: 30,
        includeScenarios: false,
        includeCrossPlatform: false,
      },
    );
    let alerts = data.proactiveAlerts;
    if (query.severity)
      alerts = alerts.filter((a) => a.severity === query.severity);
    const limit = query.limit ?? 10;
    if (limit > 0) alerts = alerts.slice(0, limit);
    return {
      success: true,
      data: {
        alerts,
        total: alerts.length,
        confidenceScore: data.confidenceScore,
      },
      message: 'Proactive alerts retrieved successfully',
    };
  }

  @Get('budget-projections')
  async getBudgetProjections(
    @CurrentUser('id') userId: string,
    @Query() query: BudgetProjectionsQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scopeId) ServiceHelper.validateObjectId(scopeId, 'scopeId');
    const daysAhead = query.daysAhead ?? 30;
    const data = await this.predictiveService.generatePredictiveIntelligence(
      userId,
      {
        scope,
        scopeId,
        timeHorizon:
          typeof daysAhead === 'number'
            ? daysAhead
            : parseInt(String(daysAhead), 10) || 30,
        includeScenarios: false,
        includeCrossPlatform: false,
      },
    );
    const projections = [...data.budgetExceedanceProjections].sort(
      (a, b) => a.daysUntilExceedance - b.daysUntilExceedance,
    );
    return {
      success: true,
      data: {
        projections,
        summary: {
          totalProjections: projections.length,
          criticalProjections: projections.filter(
            (p) => p.daysUntilExceedance <= 7,
          ).length,
          highRiskProjections: projections.filter(
            (p) => p.exceedanceProbability >= 0.8,
          ).length,
          totalPotentialExceedance: projections.reduce(
            (s, p) => s + p.exceedanceAmount,
            0,
          ),
        },
      },
      message: 'Budget projections retrieved successfully',
    };
  }

  @Get('optimizations')
  async getIntelligentOptimizations(
    @CurrentUser('id') userId: string,
    @Query() query: OptimizationsQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scopeId) ServiceHelper.validateObjectId(scopeId, 'scopeId');
    const data = await this.predictiveService.generatePredictiveIntelligence(
      userId,
      {
        scope,
        scopeId,
        timeHorizon: 30,
        includeScenarios: false,
        includeCrossPlatform: false,
      },
    );
    let optimizations = data.optimizationRecommendations;
    const minSavings = query.minSavings ?? 50;
    const parsed = parseFloat(String(minSavings));
    if (!isNaN(parsed))
      optimizations = optimizations.filter((o) => o.potentialSavings >= parsed);
    if (query.difficulty)
      optimizations = optimizations.filter(
        (o) => o.implementationDifficulty === query.difficulty,
      );
    if (query.type)
      optimizations = optimizations.filter((o) => o.type === query.type);
    const totalPotentialSavings = optimizations.reduce(
      (s, o) => s + o.potentialSavings,
      0,
    );
    const avgConfidence =
      optimizations.length > 0
        ? optimizations.reduce((s, o) => s + o.confidenceLevel, 0) /
          optimizations.length
        : 0;
    return {
      success: true,
      data: {
        optimizations,
        summary: {
          totalOptimizations: optimizations.length,
          totalPotentialSavings,
          averageConfidence: avgConfidence,
          easyImplementations: optimizations.filter(
            (o) => o.implementationDifficulty === 'easy',
          ).length,
          autoOptimizable: optimizations.filter(
            (o) => o.implementationDifficulty === 'easy',
          ).length,
        },
      },
      message: 'Intelligent optimizations retrieved successfully',
    };
  }

  @Get('scenarios')
  async getScenarioSimulations(
    @CurrentUser('id') userId: string,
    @Query() query: ScenariosQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scopeId) ServiceHelper.validateObjectId(scopeId, 'scopeId');
    const timeHorizon = query.timeHorizon ?? 90;
    const parsed = parseInt(String(timeHorizon), 10) || 90;
    const data = await this.predictiveService.generatePredictiveIntelligence(
      userId,
      {
        scope,
        scopeId,
        timeHorizon: parsed,
        includeScenarios: true,
        includeCrossPlatform: false,
      },
    );
    let scenarios = data.scenarioSimulations;
    if (query.timeframe)
      scenarios = scenarios.filter((s) => s.timeframe === query.timeframe);
    const baselineTotal = scenarios.reduce(
      (s, sc) => s + sc.projectedCosts.baseline,
      0,
    );
    const optimizedTotal = scenarios.reduce(
      (s, sc) => s + sc.projectedCosts.optimized,
      0,
    );
    const totalSavings = scenarios.reduce(
      (s, sc) => s + sc.projectedCosts.savings,
      0,
    );
    const best = scenarios.reduce(
      (best, cur) =>
        cur.probabilityOfSuccess > best.probabilityOfSuccess ? cur : best,
      scenarios[0],
    );
    return {
      success: true,
      data: {
        scenarios,
        comparison: {
          totalScenarios: scenarios.length,
          baselineTotal,
          optimizedTotal,
          totalPotentialSavings: totalSavings,
          averageSavingsPercentage:
            baselineTotal > 0 ? (totalSavings / baselineTotal) * 100 : 0,
          recommendedScenario: best?.scenarioId,
        },
      },
      message: 'Scenario simulations retrieved successfully',
    };
  }

  @Get('token-trends')
  async getTokenTrends(
    @CurrentUser('id') userId: string,
    @Query() query: ScopeQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scopeId) ServiceHelper.validateObjectId(scopeId, 'scopeId');
    const data = await this.predictiveService.generatePredictiveIntelligence(
      userId,
      {
        scope,
        scopeId,
        timeHorizon: 30,
        includeScenarios: false,
        includeCrossPlatform: false,
      },
    );
    const tokenTrends = data.historicalTokenTrends;
    const promptGrowth = data.promptLengthGrowth;
    return {
      success: true,
      data: {
        tokenTrends,
        promptGrowth,
        insights: {
          isPromptLengthGrowing: promptGrowth.growthRatePerWeek > 5,
          tokenEfficiencyTrend: tokenTrends.tokenEfficiencyTrend,
          projectedMonthlyCostIncrease:
            promptGrowth.impactOnCosts.projectedMonthly -
            promptGrowth.impactOnCosts.currentMonthly,
          optimizationPotential: promptGrowth.impactOnCosts.potentialSavings,
          confidenceLevel: tokenTrends.confidenceLevel,
        },
      },
      message: 'Token trends retrieved successfully',
    };
  }

  @Get('model-patterns')
  async getModelPatterns(
    @CurrentUser('id') userId: string,
    @Query() query: ScopeQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scopeId) ServiceHelper.validateObjectId(scopeId, 'scopeId');
    const data = await this.predictiveService.generatePredictiveIntelligence(
      userId,
      {
        scope,
        scopeId,
        timeHorizon: 30,
        includeScenarios: false,
        includeCrossPlatform: false,
      },
    );
    const patterns = data.modelSwitchPatterns;
    const prefs = patterns.modelPreferences;
    const mostUsed = prefs.length
      ? prefs.reduce(
          (max, cur) => (cur.usagePercentage > max.usagePercentage ? cur : max),
          prefs[0],
        )
      : null;
    const mostCostEffective = prefs.length
      ? prefs.reduce(
          (min, cur) => (cur.averageCost < min.averageCost ? cur : min),
          prefs[0],
        )
      : null;
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const upcomingSwitches = patterns.predictedSwitches.filter(
      (ps) => ps.date.getTime() > now && ps.date.getTime() < now + thirtyDays,
    ).length;
    const potentialSwitchSavings = patterns.commonSwitchPatterns
      .filter((p) => p.costImpact < 0)
      .reduce((s, p) => s + Math.abs(p.costImpact), 0);
    return {
      success: true,
      data: {
        patterns,
        insights: {
          switchFrequency: patterns.switchFrequency,
          mostUsedModel: mostUsed?.model,
          mostCostEffectiveModel: mostCostEffective?.model,
          upcomingSwitches,
          potentialSwitchSavings,
        },
      },
      message: 'Model patterns retrieved successfully',
    };
  }

  @Get('cross-platform')
  async getCrossPlatformInsights(
    @CurrentUser('id') userId: string,
    @Query() query: ScopeQueryDto,
  ) {
    const scope = (query.scope as 'user' | 'project' | 'team') ?? 'user';
    const scopeId = query.scopeId;
    if (scopeId) ServiceHelper.validateObjectId(scopeId, 'scopeId');
    const data = await this.predictiveService.generatePredictiveIntelligence(
      userId,
      {
        scope,
        scopeId,
        timeHorizon: 30,
        includeScenarios: false,
        includeCrossPlatform: true,
      },
    );
    const platforms = data.crossPlatformInsights;
    const totalRedundant = platforms.reduce((s, i) => s + i.redundantUsage, 0);
    const totalConsolidation = platforms.reduce(
      (s, i) =>
        s +
        i.consolidationOpportunities.reduce(
          (os, o) => os + o.potentialSaving,
          0,
        ),
      0,
    );
    const mostEfficient = platforms.length
      ? platforms.reduce(
          (max, cur) =>
            cur.efficiencyRating > max.efficiencyRating ? cur : max,
          platforms[0],
        )
      : null;
    return {
      success: true,
      data: {
        platforms,
        summary: {
          totalPlatforms: platforms.length,
          totalRedundantUsage: totalRedundant,
          totalConsolidationSavings: totalConsolidation,
          mostEfficientPlatform: mostEfficient?.platform,
          consolidationOpportunities: platforms.reduce(
            (s, i) => s + i.consolidationOpportunities.length,
            0,
          ),
        },
      },
      message: 'Cross-platform insights retrieved successfully',
    };
  }

  @Post('auto-optimize/:alertId')
  async autoOptimize(
    @CurrentUser('id') userId: string,
    @Param('alertId') alertId: string,
  ) {
    if (!alertId) {
      throw new HttpException('Alert ID is required', HttpStatus.BAD_REQUEST);
    }
    const result = await this.predictiveService.executeAutoOptimize(
      alertId,
      userId,
    );
    return {
      success: true,
      message: 'Auto-optimization completed successfully',
      data: {
        alertId,
        optimizationType: result.type,
        actionsApplied: result.actions,
        estimatedSavings: result.savings,
        implementationStatus: result.status,
        nextSteps: result.nextSteps,
      },
    };
  }

  private isCircuitBreakerOpen(): boolean {
    if (this.serviceFailureCount >= MAX_SERVICE_FAILURES) {
      const elapsed = Date.now() - this.lastServiceFailureTime;
      if (elapsed < CIRCUIT_BREAKER_RESET_MS) return true;
      this.serviceFailureCount = 0;
    }
    return false;
  }

  private recordFailure(): void {
    this.serviceFailureCount++;
    this.lastServiceFailureTime = Date.now();
  }
}
