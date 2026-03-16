import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../common/logger/logger.service';
import { WebhookService } from './webhook.service';
import { WEBHOOK_EVENTS, WebhookEventData } from './webhook.types';

@Injectable()
export class WebhookEventEmitterService {
  constructor(
    private logger: LoggerService,
    private webhookService: WebhookService,
  ) {}

  /**
   * Emit a webhook event
   */
  async emitEvent(eventData: WebhookEventData): Promise<void> {
    try {
      await this.webhookService.processEvent(eventData);
    } catch (error) {
      this.logger.error('Failed to emit webhook event', { error, eventData });
      throw error;
    }
  }

  // Cost & Budget Events
  async emitCostAlert(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      cost: { amount: number; currency: string; period: string };
      threshold: number;
      changePercentage: number;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `cost_alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.COST_ALERT,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'cost',
          id: `cost_${userId}_${Date.now()}`,
          name: 'Cost Alert',
        },
        metrics: {
          current: data.cost.amount,
          threshold: data.threshold,
          changePercentage: data.changePercentage,
        },
        cost: data.cost,
        links: {
          dashboard: `/dashboard/costs?period=${data.cost.period}`,
          details: `/costs/alerts/${data.cost.period}`,
        },
      },
    });
  }

  async emitCostThresholdExceeded(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      cost: { amount: number; currency: string; period: string };
      threshold: number;
      exceededBy: number;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `cost_threshold_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.COST_THRESHOLD_EXCEEDED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'budget',
          id: `budget_${userId}_${projectId || 'global'}`,
          name: 'Budget Threshold',
        },
        metrics: {
          current: data.cost.amount,
          threshold: data.threshold,
          change: data.exceededBy,
        },
        cost: data.cost,
        links: {
          dashboard: '/dashboard/budgets',
          details: `/budgets/${projectId || 'global'}`,
        },
      },
    });
  }

  async emitBudgetWarning(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      budget: {
        amount: number;
        currency: string;
        spent: number;
        remaining: number;
      };
      warningThreshold: number;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `budget_warning_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.BUDGET_WARNING,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'budget',
          id: `budget_${userId}_${projectId || 'global'}`,
          name: 'Budget Warning',
        },
        metrics: {
          current: data.budget.spent,
          threshold: data.warningThreshold,
          change: data.budget.remaining,
        },
        cost: {
          amount: data.budget.spent,
          currency: data.budget.currency,
          period: 'current',
        },
        links: {
          dashboard: '/dashboard/budgets',
          details: `/budgets/${projectId || 'global'}`,
        },
      },
    });
  }

  async emitBudgetExceeded(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      budget: {
        amount: number;
        currency: string;
        spent: number;
        exceededBy: number;
      };
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `budget_exceeded_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.BUDGET_EXCEEDED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'budget',
          id: `budget_${userId}_${projectId || 'global'}`,
          name: 'Budget Exceeded',
        },
        metrics: {
          current: data.budget.spent,
          previous: data.budget.amount,
          change: data.budget.exceededBy,
        },
        cost: {
          amount: data.budget.exceededBy,
          currency: data.budget.currency,
          period: 'current',
        },
        links: {
          dashboard: '/dashboard/budgets',
          details: `/budgets/${projectId || 'global'}`,
        },
      },
    });
  }

  // Optimization Events
  async emitOptimizationCompleted(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      optimizationId: string;
      savings: { amount: number; currency: string; percentage: number };
      model?: string;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `optimization_completed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.OPTIMIZATION_COMPLETED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'optimization',
          id: data.optimizationId,
          name: 'Optimization Task',
          metadata: { model: data.model },
        },
        metrics: {
          change: data.savings.amount,
          changePercentage: data.savings.percentage,
        },
        cost: {
          amount: data.savings.amount,
          currency: data.savings.currency,
          period: 'optimization',
          breakdown: { savings: data.savings.amount },
        },
        links: {
          dashboard: '/dashboard/optimizations',
          details: `/optimizations/${data.optimizationId}`,
        },
      },
    });
  }

  async emitOptimizationSuggested(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      suggestionId: string;
      potentialSavings: {
        amount: number;
        currency: string;
        percentage: number;
      };
      model?: string;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `optimization_suggested_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.OPTIMIZATION_SUGGESTED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'optimization',
          id: data.suggestionId,
          name: 'Optimization Suggestion',
          metadata: { model: data.model },
        },
        metrics: {
          change: data.potentialSavings.amount,
          changePercentage: data.potentialSavings.percentage,
        },
        cost: {
          amount: data.potentialSavings.amount,
          currency: data.potentialSavings.currency,
          period: 'potential',
          breakdown: { potentialSavings: data.potentialSavings.amount },
        },
        links: {
          dashboard: '/dashboard/optimizations',
          details: `/optimizations/suggestions/${data.suggestionId}`,
          actions: [`/optimizations/suggestions/${data.suggestionId}/apply`],
        },
      },
    });
  }

  // Model & Performance Events
  async emitModelPerformanceDegraded(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      model: string;
      metric: string;
      current: number;
      threshold: number;
      degradation: number;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `model_performance_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.MODEL_PERFORMANCE_DEGRADED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'model',
          id: data.model,
          name: `Model: ${data.model}`,
          metadata: { metric: data.metric },
        },
        metrics: {
          current: data.current,
          threshold: data.threshold,
          change: -data.degradation,
          changePercentage: (data.degradation / data.threshold) * 100,
        },
        links: {
          dashboard: `/dashboard/models/${data.model}`,
          details: `/models/${data.model}/performance`,
        },
      },
    });
  }

  // Usage Events
  async emitUsageSpike(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      model?: string;
      currentUsage: number;
      baselineUsage: number;
      spikePercentage: number;
      period: string;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `usage_spike_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.USAGE_SPIKE,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'usage',
          id: `usage_${userId}_${Date.now()}`,
          name: 'Usage Spike',
          metadata: { model: data.model, period: data.period },
        },
        metrics: {
          current: data.currentUsage,
          previous: data.baselineUsage,
          changePercentage: data.spikePercentage,
        },
        links: {
          dashboard: `/dashboard/usage?period=${data.period}`,
          details: `/usage/spikes/${Date.now()}`,
        },
      },
    });
  }

  // Workflow Events
  async emitWorkflowCompleted(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      workflowId: string;
      workflowName: string;
      executionTime: number;
      stepsCompleted: number;
      result?: any;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `workflow_completed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.WORKFLOW_COMPLETED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'workflow',
          id: data.workflowId,
          name: data.workflowName,
        },
        metrics: {
          current: data.executionTime,
          change: data.stepsCompleted,
        },
        context: {
          result: data.result,
          executionTimeMs: data.executionTime,
          stepsCompleted: data.stepsCompleted,
        },
        links: {
          dashboard: '/dashboard/workflows',
          details: `/workflows/${data.workflowId}`,
        },
      },
    });
  }

  // Security Events
  async emitSecurityAlert(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      alertType: string;
      resource?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `security_alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.SECURITY_ALERT,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'security',
          id: `security_${userId}_${Date.now()}`,
          name: 'Security Alert',
          metadata: {
            alertType: data.alertType,
            resource: data.resource,
          },
        },
        context: {
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        },
        links: {
          dashboard: '/dashboard/security',
          details: `/security/alerts/${Date.now()}`,
        },
      },
    });
  }

  // Agent Events
  async emitAgentTaskCompleted(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      taskId: string;
      agentType: string;
      executionTime: number;
      result?: any;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `agent_task_completed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.AGENT_TASK_COMPLETED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'agent',
          id: data.taskId,
          name: `Agent Task: ${data.agentType}`,
        },
        metrics: {
          current: data.executionTime,
        },
        context: {
          result: data.result,
          agentType: data.agentType,
          executionTimeMs: data.executionTime,
        },
        links: {
          dashboard: '/dashboard/agents',
          details: `/agents/tasks/${data.taskId}`,
        },
      },
    });
  }

  // Quality Events
  async emitQualityDegraded(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      metric: string;
      currentScore: number;
      previousScore: number;
      threshold: number;
      degradation: number;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `quality_degraded_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.QUALITY_DEGRADED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'quality',
          id: `quality_${userId}_${Date.now()}`,
          name: 'Quality Metric',
          metadata: { metric: data.metric },
        },
        metrics: {
          current: data.currentScore,
          previous: data.previousScore,
          threshold: data.threshold,
          change: -data.degradation,
          changePercentage: (data.degradation / data.previousScore) * 100,
        },
        links: {
          dashboard: `/dashboard/quality?metric=${data.metric}`,
          details: `/quality/metrics/${data.metric}`,
        },
      },
    });
  }

  // Subscription Events
  async emitSubscriptionPaymentFailed(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      subscriptionId: string;
      amount: number;
      currency: string;
      failureReason?: string;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `subscription_payment_failed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.SUBSCRIPTION_PAYMENT_FAILED,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'subscription',
          id: data.subscriptionId,
          name: 'Subscription Payment',
        },
        cost: {
          amount: data.amount,
          currency: data.currency,
          period: 'monthly',
        },
        context: {
          failureReason: data.failureReason,
        },
        links: {
          dashboard: '/dashboard/billing',
          details: `/billing/subscription/${data.subscriptionId}`,
          actions: ['/billing/payment-methods', '/billing/subscription/update'],
        },
      },
    });
  }

  // System Events
  async emitSystemError(
    userId: string,
    projectId: string | undefined,
    data: {
      title: string;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
      service: string;
      error: string;
      stack?: string;
    },
  ): Promise<void> {
    await this.emitEvent({
      eventId: `system_error_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: WEBHOOK_EVENTS.SYSTEM_ERROR,
      occurredAt: new Date(),
      userId,
      projectId,
      data: {
        ...data,
        resource: {
          type: 'system',
          id: `system_${data.service}_${Date.now()}`,
          name: `System Service: ${data.service}`,
        },
        context: {
          error: data.error,
          stack: data.stack,
        },
        links: {
          dashboard: '/dashboard/system',
          details: `/system/logs?service=${data.service}`,
        },
      },
    });
  }
}
