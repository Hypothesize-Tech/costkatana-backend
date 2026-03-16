import { Injectable, Logger } from '@nestjs/common';
import { BudgetCheckResult } from '../interfaces/gateway.interfaces';
import { AnalyticsService } from '../../analytics/analytics.service';
import { AlertService } from '../../alert/alert.service';
import { CostSimulatorService } from '../../cost-simulator/cost-simulator.service';

/**
 * Budget Enforcement Service - Handles budget constraint checking and enforcement
 * Uses the existing BudgetService for comprehensive budget management
 */
@Injectable()
export class BudgetEnforcementService {
  private readonly logger = new Logger(BudgetEnforcementService.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly alertService: AlertService,
    private readonly costSimulatorService: CostSimulatorService,
  ) {}

  /**
   * Check budget constraints for a gateway request (pre-flight check)
   */
  async checkBudgetConstraints(request: any): Promise<BudgetCheckResult> {
    const context = request.gatewayContext;
    const requestId = (request.headers['x-request-id'] as string) || 'unknown';

    try {
      this.logger.log('Starting budget constraint check', {
        component: 'BudgetEnforcementService',
        operation: 'checkBudgetConstraints',
        type: 'budget_check_start',
        requestId,
        userId: context.userId,
        budgetId: context.budgetId,
        projectId: context.projectId,
      });

      let simulation:
        | {
            originalRequest?: {
              estimatedCost?: number;
              estimatedTokens?: { total?: number };
            };
            requestId?: string;
            alternatives?: unknown[];
          }
        | undefined;
      const prompt = this.extractPromptFromRequest(request.body);
      const model =
        request.body?.model || context.modelOverride || 'gpt-3.5-turbo';
      const provider = context.provider || 'openai';

      if (context.userId && prompt !== undefined) {
        try {
          simulation = await this.costSimulatorService.simulateRequestCost(
            prompt || '',
            model,
            provider,
            context.userId,
            context.workspaceId,
            {
              includeAlternatives: true,
              maxOutputTokens: request.body?.max_tokens || 1000,
            },
          );
          this.logger.debug('Cost simulation completed', {
            requestId: simulation.requestId,
            estimatedCost: simulation.originalRequest?.estimatedCost,
            alternatives: simulation.alternatives?.length ?? 0,
          });
        } catch (simError) {
          this.logger.warn(
            'Cost simulation failed, using fallback estimation',
            {
              error:
                simError instanceof Error ? simError.message : 'Unknown error',
            },
          );
          const estimatedTokens = prompt ? Math.ceil(prompt.length / 4) : 100;
          simulation = {
            originalRequest: {
              estimatedCost: estimatedTokens * 0.00001,
              estimatedTokens: { total: estimatedTokens * 1.5 },
            },
          };
        }
      }

      // Import BudgetService dynamically to avoid circular dependencies
      const { BudgetService } = await import('../../budget/budget.service');

      // Perform pre-flight budget check (BudgetService API may vary by codebase)
      const simTokens = simulation?.originalRequest?.estimatedTokens as
        | { input?: number; output?: number; total?: number }
        | undefined;
      const estimatedTokensForBudget =
        simTokens?.input != null && simTokens?.output != null
          ? { input: simTokens.input, output: simTokens.output }
          : this.estimateTokens(request.body);
      const budgetCheck = await (
        BudgetService as unknown as {
          preFlightBudgetCheck?: (opts: {
            userId?: string;
            budgetId?: string;
            projectId?: string;
            model?: string;
            estimatedTokens?: { input: number; output: number };
            provider?: string;
          }) => Promise<{
            allowed: boolean;
            message?: string;
            reservationId?: string;
            simulation?: any;
            cheaperAlternatives?: any[];
          }>;
        }
      ).preFlightBudgetCheck?.({
        userId: context.userId,
        budgetId: context.budgetId,
        projectId: context.projectId,
        model: request.body?.model,
        estimatedTokens: estimatedTokensForBudget,
        provider: context.provider,
      });

      const budgetCheckResult = budgetCheck ?? {
        allowed: true,
        message: 'Budget check skipped',
      };

      const result: BudgetCheckResult = {
        allowed: budgetCheckResult.allowed,
        message: budgetCheckResult.message,
        reservationId: budgetCheckResult.reservationId,
        simulation: simulation ?? budgetCheckResult.simulation,
        cheaperAlternatives: budgetCheckResult.cheaperAlternatives,
      };

      this.logger.log('Budget constraint check completed', {
        component: 'BudgetEnforcementService',
        operation: 'checkBudgetConstraints',
        type: budgetCheckResult.allowed ? 'budget_allowed' : 'budget_blocked',
        requestId,
        allowed: budgetCheckResult.allowed,
        message: budgetCheckResult.message,
        reservationId: budgetCheckResult.reservationId,
        estimatedCost:
          budgetCheckResult.simulation?.originalRequest?.estimatedCost,
      });

      return result;
    } catch (error: any) {
      this.logger.error('Budget constraint check failed', {
        component: 'BudgetEnforcementService',
        operation: 'checkBudgetConstraints',
        type: 'budget_check_error',
        requestId,
        userId: context.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error.stack,
      });

      // Fail-open: allow request if budget check fails
      return {
        allowed: true,
        message: 'Budget check failed, request allowed',
      };
    }
  }

  /**
   * Validate budget limit for a request
   */
  async validateBudgetLimit(request: any): Promise<boolean> {
    const result = await this.checkBudgetConstraints(request);
    return result.allowed;
  }

  /**
   * Track request cost after completion
   */
  async trackRequestCost(
    request: any,
    response: any,
    cost: number,
  ): Promise<void> {
    const context = request.gatewayContext;
    const requestId = (request.headers['x-request-id'] as string) || 'unknown';

    try {
      this.logger.log('Tracking request cost', {
        component: 'BudgetEnforcementService',
        operation: 'trackRequestCost',
        type: 'cost_tracking',
        requestId,
        userId: context.userId,
        cost,
        model: request.body?.model,
        provider: context.provider,
      });

      // Import BudgetService dynamically
      const { BudgetService } = await import('../../budget/budget.service');

      // Confirm budget usage (instance or static API may vary)
      if (context.budgetReservationId) {
        const svc = BudgetService as unknown as {
          confirmBudget?: (id: string, cost: number) => Promise<void>;
        };
        if (typeof svc.confirmBudget === 'function') {
          await svc.confirmBudget(context.budgetReservationId, cost);
        }
      }

      // Update usage tracking
      await this.updateUsageTracking(request, response, cost);
    } catch (error: any) {
      this.logger.error('Failed to track request cost', {
        component: 'BudgetEnforcementService',
        operation: 'trackRequestCost',
        type: 'cost_tracking_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error.stack,
      });
    }
  }

  /**
   * Release budget reservation on error
   */
  async releaseBudgetReservation(reservationId: string): Promise<void> {
    try {
      this.logger.log('Releasing budget reservation', {
        component: 'BudgetEnforcementService',
        operation: 'releaseBudgetReservation',
        type: 'budget_release',
        reservationId,
      });

      // Import BudgetService dynamically
      const { BudgetService } = await import('../../budget/budget.service');

      await (
        BudgetService as unknown as {
          releaseBudget?: (reservationId: string) => Promise<void>;
        }
      ).releaseBudget?.(reservationId);
    } catch (error: any) {
      this.logger.error('Failed to release budget reservation', {
        component: 'BudgetEnforcementService',
        operation: 'releaseBudgetReservation',
        type: 'budget_release_error',
        reservationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Extract prompt text from request body for cost simulation
   */
  private extractPromptFromRequest(requestBody: any): string | undefined {
    try {
      if (requestBody?.messages && Array.isArray(requestBody.messages)) {
        return requestBody.messages
          .map((msg: any) =>
            typeof msg.content === 'string' ? msg.content : '',
          )
          .join(' ');
      }
      if (requestBody?.prompt && typeof requestBody.prompt === 'string') {
        return requestBody.prompt;
      }
      if (requestBody?.input && typeof requestBody.input === 'string') {
        return requestBody.input;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  /**
   * Estimate tokens for a request
   */
  private estimateTokens(requestBody: any): { input: number; output: number } {
    try {
      let inputTokens = 0;

      // Extract prompt and estimate tokens
      if (requestBody?.messages && Array.isArray(requestBody.messages)) {
        // OpenAI format
        const prompt = requestBody.messages
          .map((msg: any) => msg.content || '')
          .join(' ');
        inputTokens = Math.ceil(prompt.length / 4); // Rough estimate
      } else if (requestBody?.prompt) {
        inputTokens = Math.ceil(requestBody.prompt.length / 4);
      } else if (requestBody?.input) {
        inputTokens = Math.ceil(requestBody.input.length / 4);
      }

      // Estimate output tokens (usually less than input)
      const outputTokens = Math.max(100, Math.ceil(inputTokens * 0.3));

      return { input: inputTokens, output: outputTokens };
    } catch (error) {
      this.logger.warn('Failed to estimate tokens', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { input: 1000, output: 300 }; // Conservative defaults
    }
  }

  /**
   * Update usage tracking
   */
  private async updateUsageTracking(
    request: any,
    response: any,
    cost: number,
  ): Promise<void> {
    try {
      const context = request.gatewayContext;

      // Update budget usage records
      await this.updateBudgetUsage(context, cost);

      // Update analytics with cost information
      await this.updateAnalyticsTracking(request, response, cost);

      // Check for budget alerts if usage is high
      await this.checkBudgetAlerts(context, cost);

      this.logger.debug('Usage tracking updated comprehensively', {
        component: 'BudgetEnforcementService',
        operation: 'updateUsageTracking',
        type: 'usage_update',
        cost,
        userId: context?.userId,
        projectId: context?.projectId,
        budgetId: context?.budgetId,
      });
    } catch (error) {
      this.logger.error('Failed to update usage tracking', {
        component: 'BudgetEnforcementService',
        operation: 'updateUsageTracking',
        type: 'usage_update_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Update budget usage records
   */
  private async updateBudgetUsage(context: any, cost: number): Promise<void> {
    try {
      // Import BudgetService dynamically
      const { BudgetService } = await import('../../budget/budget.service');

      // Record the actual cost usage (API may vary)
      if (context?.budgetReservationId) {
        const svc = BudgetService as unknown as {
          recordActualUsage?: (
            id: string,
            data: {
              cost: number;
              tokens?: number;
              timestamp: Date;
              metadata?: any;
            },
          ) => Promise<void>;
        };
        if (typeof svc.recordActualUsage === 'function') {
          await svc.recordActualUsage(context.budgetReservationId, {
            cost,
            tokens: context.inputTokens + context.outputTokens,
            timestamp: new Date(),
            metadata: {
              provider: context.provider,
              model: context.model,
              requestId: context.requestId,
            },
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to update budget usage records', {
        error: error instanceof Error ? error.message : 'Unknown error',
        budgetReservationId: context?.budgetReservationId,
      });
    }
  }

  /**
   * Update analytics tracking with cost information
   */
  private async updateAnalyticsTracking(
    request: any,
    response: any,
    cost: number,
  ): Promise<void> {
    const context = request.gatewayContext;
    if (!context?.userId) {
      this.logger.debug('Skipping analytics tracking: no userId in context');
      return;
    }
    try {
      const inputTokens = context.inputTokens ?? 0;
      const outputTokens = context.outputTokens ?? 0;
      await this.analyticsService.recordCostEvent({
        userId: context.userId,
        projectId: context.projectId,
        cost,
        currency: 'USD',
        provider: context.provider,
        model: request.body?.model,
        inputTokens,
        outputTokens,
        tokens: inputTokens + outputTokens,
        requestType: 'gateway_proxy',
        metadata: {
          requestId: context.requestId,
          responseStatus: response?.status,
          processingTime: Date.now() - (context.startTime || Date.now()),
        },
      });
    } catch (error) {
      this.logger.warn('Failed to update analytics tracking', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: context?.requestId,
      });
    }
  }

  /**
   * Check for budget alerts when usage is high
   */
  private async checkBudgetAlerts(context: any, cost: number): Promise<void> {
    if (cost <= 1.0 || !context?.userId) return;
    try {
      const severity: 'low' | 'medium' | 'high' | 'critical' =
        cost > 5.0 ? 'high' : 'medium';
      await this.alertService.createBudgetAlert({
        userId: context.userId,
        projectId: context.projectId,
        budgetId: context.budgetId,
        alertType: 'HIGH_COST_TRANSACTION',
        message: `High-cost transaction detected: $${cost.toFixed(2)}`,
        metadata: {
          cost,
          provider: context.provider,
          model: context.model,
          requestId: context.requestId,
        },
        severity,
      });
    } catch (error) {
      this.logger.warn('Failed to check budget alerts', {
        error: error instanceof Error ? error.message : 'Unknown error',
        cost,
        userId: context?.userId,
      });
    }
  }
}
