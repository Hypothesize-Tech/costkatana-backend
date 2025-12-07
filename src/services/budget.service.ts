import { loggingService } from './logging.service';
import { Usage } from '../models';
import { redisService } from './redis.service';
import mongoose from 'mongoose';
import * as crypto from 'crypto';
import { webhookEventEmitter } from './webhookEventEmitter.service';
import { WEBHOOK_EVENTS, WebhookEventType } from '../types/webhook.types';
import { costStreamingService } from './costStreaming.service';

interface BudgetStatus {
  overall: {
    budget: number;
    used: number;
    remaining: number;
    cost: number;
    usagePercentage: number;
  };
  projects: Array<{
    name: string;
    budget: number;
    used: number;
    remaining: number;
    cost: number;
    usagePercentage: number;
  }>;
  alerts: Array<{
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
    timestamp: string;
  }>;
  recommendations: Array<{
    type: string;
    message: string;
    impact: 'low' | 'medium' | 'high';
    estimatedSavings: number;
  }>;
}

interface BudgetReservation {
  reservationId: string;
  userId: string;
  estimatedCost: number;
  timestamp: number;
  expiresAt: number;
}

interface PricingCacheEntry {
  inputPrice: number;
  outputPrice: number;
  lastUpdated: number;
}

export class BudgetService {
  // Cache TTL for pricing data (5 minutes)
  private static readonly PRICING_CACHE_TTL = 5 * 60 * 1000;
  
  // Reservation TTL (2 minutes - enough time for LLM call)
  private static readonly RESERVATION_TTL = 2 * 60 * 1000;
  
  /**
   * Get month date range for budget calculations
   */
  private static getMonthDateRange(): { startOfMonth: Date; endOfMonth: Date } {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date();
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    return { startOfMonth, endOfMonth };
  }

  static async getBudgetStatus(userId: string, projectFilter?: string): Promise<BudgetStatus> {
    try {
      const { startOfMonth, endOfMonth } = this.getMonthDateRange();

      // Get user's budget settings (default to 100K tokens)
      const userBudget = 100000; // This would come from user settings

      // Execute aggregations in parallel for better performance
      const [overallUsage, projectUsage] = await Promise.all([
        this.getOverallUsage(userId, startOfMonth, endOfMonth),
        this.getProjectUsage(userId, startOfMonth, endOfMonth, projectFilter)
      ]);

      // Calculate overall budget status
      const overall = {
        budget: userBudget,
        used: overallUsage.totalTokens,
        remaining: Math.max(0, userBudget - overallUsage.totalTokens),
        cost: overallUsage.totalCost,
        usagePercentage: (overallUsage.totalTokens / userBudget) * 100,
      };

      // Generate alerts based on usage
      const alerts = this.generateAlerts(overall, projectUsage, userId);

      // Generate recommendations
      const recommendations = this.generateRecommendations(overall, projectUsage);

      return {
        overall,
        projects: projectUsage,
        alerts,
        recommendations,
      };
    } catch (error) {
      loggingService.error('Error getting budget status:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private static async getOverallUsage(userId: string, startDate: Date, endDate: Date) {
    const match: any = {
      userId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: startDate, $lte: endDate },
    };

    const result = await Usage.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$cost' },
          totalRequests: { $sum: 1 },
        },
      },
    ]);

    const usage = result[0] || { totalTokens: 0, totalCost: 0, totalRequests: 0 };
    return usage;
  }

  private static async getProjectUsage(userId: string, startDate: Date, endDate: Date, projectFilter?: string) {
    const match: any = {
      userId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (projectFilter) {
      // If projectFilter is a project name, we need to look it up
      if (!mongoose.Types.ObjectId.isValid(projectFilter)) {
        const project = await mongoose.model('Project').findOne({ 
          name: projectFilter, 
          userId: new mongoose.Types.ObjectId(userId) 
        });
        if (project) {
          match.projectId = project._id;
        }
      } else {
        match.projectId = new mongoose.Types.ObjectId(projectFilter);
      }
    }

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'projects',
          localField: 'projectId',
          foreignField: '_id',
          as: 'project',
        },
      },
      {
        $group: {
          _id: '$projectId',
          name: { $first: { $arrayElemAt: ['$project.name', 0] } },
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$cost' },
          totalRequests: { $sum: 1 },
        },
      },
      { $sort: { totalCost: -1 as const } },
    ];

    const results = await Usage.aggregate(pipeline);

    // Calculate budget for each project (default 10K tokens per project)
    return results.map(project => {
      const projectBudget = 10000; // This would come from project settings
      const usagePercentage = (project.totalTokens / projectBudget) * 100;
      
      return {
        name: project.name || 'Unknown Project',
        budget: projectBudget,
        used: project.totalTokens,
        remaining: Math.max(0, projectBudget - project.totalTokens),
        cost: project.totalCost,
        usagePercentage,
      };
    });
  }

  /**
   * Get alert level and type based on usage percentage
   */
  private static getAlertLevel(percentage: number): { level: string; severity: 'low' | 'medium' | 'high' } | null {
    if (percentage >= 90) return { level: 'critical', severity: 'high' };
    if (percentage >= 75) return { level: 'warning', severity: 'medium' };
    if (percentage >= 50) return { level: 'notice', severity: 'low' };
    return null;
  }

  /**
   * Create budget alert object
   */
  private static createBudgetAlert(
    type: string,
    percentage: number,
    severity: 'low' | 'medium' | 'high',
    timestamp: string,
    isProject = false,
    projectName?: string
  ) {
    const target = isProject ? `Project "${projectName}"` : 'You';
    const budgetType = isProject ? 'its' : 'your monthly';
    
    let messagePrefix: string;
    switch (severity) {
      case 'high':
        messagePrefix = 'Critical';
        break;
      case 'medium':
        messagePrefix = 'Warning';
        break;
      default:
        messagePrefix = 'Notice';
    }

    return {
      type,
      message: `${messagePrefix}: ${target} ${isProject ? 'has' : 've'} used ${percentage.toFixed(1)}% of ${budgetType} budget`,
      severity,
      timestamp
    };
  }

  /**
   * Emit webhook event for budget alerts
   */
  private static async emitBudgetWebhook(
    userId: string,
    overall: any,
    eventType: WebhookEventType
  ): Promise<void> {
    try {
      const webhookData = {
        cost: { amount: overall.cost, currency: 'USD' },
        metrics: {
          current: overall.used,
          threshold: overall.budget,
          changePercentage: eventType === WEBHOOK_EVENTS.BUDGET_EXCEEDED 
            ? overall.usagePercentage - 100 
            : overall.usagePercentage,
          unit: 'tokens'
        }
      };

      await webhookEventEmitter.emitWebhookEvent(eventType, userId, webhookData);
    } catch (error) {
      loggingService.error('Failed to emit budget webhook', { 
        error: error instanceof Error ? error.message : String(error),
        userId,
        eventType
      });
    }
  }

  private static generateAlerts(overall: any, projects: any[], userId: string): Array<{
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
    timestamp: string;
  }> {
    const alerts: Array<{
      type: string;
      message: string;
      severity: 'low' | 'medium' | 'high';
      timestamp: string;
    }> = [];
    const now = new Date().toISOString();

    // Early return if no usage
    if (overall.usagePercentage === 0) {
      return alerts;
    }

    // Overall budget alerts with optimized logic
    const overallAlertLevel = this.getAlertLevel(overall.usagePercentage);
    if (overallAlertLevel) {
      const alertType = overallAlertLevel.level === 'critical' ? 'budget_critical' : 
                       overallAlertLevel.level === 'warning' ? 'budget_warning' : 'budget_notice';
      
      alerts.push(this.createBudgetAlert(
        alertType,
        overall.usagePercentage,
        overallAlertLevel.severity,
        now
      ));
      
      // Emit webhook events for critical and warning levels
      if (overallAlertLevel.severity === 'high') {
        const eventType = overall.usagePercentage >= 100 
          ? WEBHOOK_EVENTS.BUDGET_EXCEEDED 
          : WEBHOOK_EVENTS.BUDGET_WARNING;
        this.emitBudgetWebhook(userId, overall, eventType);
      } else if (overallAlertLevel.severity === 'medium') {
        this.emitBudgetWebhook(userId, overall, WEBHOOK_EVENTS.BUDGET_WARNING);
      }
    }

    // Project-specific alerts with optimized logic
    projects.forEach(project => {
      const projectAlertLevel = this.getAlertLevel(project.usagePercentage);
      if (projectAlertLevel && projectAlertLevel.severity !== 'low') {
        const alertType = projectAlertLevel.level === 'critical' ? 'project_critical' : 'project_warning';
        
        alerts.push(this.createBudgetAlert(
          alertType,
          project.usagePercentage,
          projectAlertLevel.severity,
          now,
          true,
          project.name
        ));
      }
    });

    // High cost alerts
    if (overall.cost > 50) {
      alerts.push({
        type: 'cost_high',
        message: `High cost alert: You've spent $${overall.cost.toFixed(2)} this month`,
        severity: 'medium' as const,
        timestamp: now,
      });
      
      // Emit webhook event for cost alert
      try {
        loggingService.info('Emitting cost alert webhook', { value:  {  userId, cost: overall.cost  } });
        webhookEventEmitter.emitCostAlert(
          userId,
          undefined, // No specific project
          overall.cost,
          50, // threshold
          'USD'
        );
      } catch (error) {
        loggingService.error('Failed to emit cost alert webhook', { error: error instanceof Error ? error.message : String(error) });
      }
    }

    return alerts;
  }

  private static generateRecommendations(overall: any, projects: any[]): Array<{
    type: string;
    message: string;
    impact: 'low' | 'medium' | 'high';
    estimatedSavings: number;
  }> {
    const recommendations: Array<{
      type: string;
      message: string;
      impact: 'low' | 'medium' | 'high';
      estimatedSavings: number;
    }> = [];

    // Budget optimization recommendations
    if (overall.usagePercentage >= 75) {
      recommendations.push({
        type: 'budget_increase',
        message: 'Consider increasing your monthly budget to avoid service interruptions',
        impact: 'high' as const,
        estimatedSavings: 0, // No savings, but prevents downtime
      });
    }

    // Cost optimization recommendations
    if (overall.cost > 30) {
      recommendations.push({
        type: 'cost_optimization',
        message: 'Enable prompt optimization to reduce token usage and costs',
        impact: 'high' as const,
        estimatedSavings: overall.cost * 0.2, // 20% potential savings
      });
    }

    // Model optimization recommendations
    if (overall.usagePercentage > 50) {
      recommendations.push({
        type: 'model_optimization',
        message: 'Consider using more cost-effective models for non-critical tasks',
        impact: 'medium' as const,
        estimatedSavings: overall.cost * 0.15, // 15% potential savings
      });
    }

    // Project-specific recommendations
    projects.forEach(project => {
      if (project.usagePercentage >= 75) {
        recommendations.push({
          type: 'project_optimization',
          message: `Optimize prompts in project "${project.name}" to reduce token usage`,
          impact: 'medium' as const,
          estimatedSavings: project.cost * 0.25, // 25% potential savings
        });
      }
    });

    return recommendations;
  }

  /**
   * Estimate request cost before making the LLM call
   * Uses hybrid pricing: cached prices from Redis with fallback to static pricing
   */
  static async estimateRequestCost(
    model: string,
    inputTokens: number,
    outputTokensEstimate?: number
  ): Promise<number> {
    try {
      // Default output tokens estimate if not provided
      const outputTokens = outputTokensEstimate || Math.ceil(inputTokens * 0.5);
      
      // Try to get pricing from cache first
      const cachedPricing = await this.getCachedPricing(model);
      
      if (cachedPricing) {
        const inputCost = (inputTokens / 1_000_000) * cachedPricing.inputPrice;
        const outputCost = (outputTokens / 1_000_000) * cachedPricing.outputPrice;
        
        loggingService.debug('Cost estimated from cache', {
          model,
          inputTokens,
          outputTokens,
          estimatedCost: inputCost + outputCost,
          source: 'cache'
        });
        
        return inputCost + outputCost;
      }
      
      // Fallback to static pricing
      const staticPricing = await this.getStaticPricing(model);
      
      if (staticPricing) {
        const inputCost = (inputTokens / 1_000_000) * staticPricing.inputPrice;
        const outputCost = (outputTokens / 1_000_000) * staticPricing.outputPrice;
        
        // Cache the pricing for future requests
        await this.cachePricing(model, staticPricing.inputPrice, staticPricing.outputPrice);
        
        loggingService.debug('Cost estimated from static pricing', {
          model,
          inputTokens,
          outputTokens,
          estimatedCost: inputCost + outputCost,
          source: 'static'
        });
        
        return inputCost + outputCost;
      }
      
      // Ultimate fallback: conservative estimate
      const conservativeEstimate = ((inputTokens + outputTokens) / 1_000_000) * 0.015;
      
      loggingService.warn('Using conservative cost estimate', {
        model,
        inputTokens,
        outputTokens,
        estimatedCost: conservativeEstimate
      });
      
      return conservativeEstimate;
      
    } catch (error) {
      loggingService.error('Error estimating request cost', {
        error: error instanceof Error ? error.message : String(error),
        model,
        inputTokens
      });
      
      // Return conservative estimate on error
      return ((inputTokens + (outputTokensEstimate || inputTokens * 0.5)) / 1_000_000) * 0.015;
    }
  }

  /**
   * Pre-flight budget check with enforcement
   * Checks if user has sufficient budget before allowing request
   */
  static async preFlightBudgetCheck(
    userId: string,
    estimatedCost: number,
    projectId?: string,
    workspaceId?: string,
    options: {
      enforceHardLimits?: boolean;
      allowDowngrade?: boolean;
      planTier?: 'free' | 'plus' | 'pro' | 'enterprise';
    } = {}
  ): Promise<{
    allowed: boolean;
    reason?: string;
    recommendedAction?: string;
    remainingBudget: number;
    reservationId?: string;
    cheaperAlternatives?: Array<{
      model: string;
      provider: string;
      estimatedCost: number;
      savings: number;
    }>;
  }> {
    try {
      const { enforceHardLimits = true, allowDowngrade = true, planTier = 'plus' } = options;

      // Get current budget status
      const budgetStatus = await this.getBudgetStatus(userId, projectId);
      const remainingBudget = budgetStatus.overall.remaining;
      const reservedBudget = await this.getReservedBudget(userId);
      const availableBudget = remainingBudget - reservedBudget;

      // Define thresholds based on plan tier
      const thresholds = {
        free: { soft: 0.8, hard: 0.95 },
        plus: { soft: 0.85, hard: 0.98 },
        pro: { soft: 0.9, hard: 0.99 },
        enterprise: { soft: 0.95, hard: 1.0 }
      };

      const threshold = thresholds[planTier] || thresholds.plus;
      const usagePercentage = budgetStatus.overall.usagePercentage / 100;

      // Hard limit check
      if (enforceHardLimits && availableBudget < estimatedCost) {
        // Generate cheaper alternatives
        const cheaperAlternatives = await this.findCheaperAlternatives(
          estimatedCost,
          availableBudget,
          projectId
        );

        // 🚨 P0: Emit real-time SSE budget exceeded alert
        setImmediate(async () => {
          try {
            const { RealtimeUpdateService } = await import('./realtime-update.service');
            RealtimeUpdateService.emitBudgetExceeded(userId, {
              budgetId: projectId || 'default',
              estimatedCost,
              budgetRemaining: availableBudget,
              blocked: true,
              cheaperAlternatives,
              message: `Request blocked: $${estimatedCost.toFixed(4)} required, only $${availableBudget.toFixed(4)} available`
            });
          } catch (error) {
            loggingService.error('Failed to emit budget exceeded SSE', {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });

        // Emit budget warning event (legacy streaming)
        costStreamingService.emitCostEvent({
          eventType: 'budget_warning',
          timestamp: new Date(),
          userId,
          workspaceId,
          data: {
            estimatedCost,
            budgetRemaining: availableBudget,
            metadata: {
              reason: 'insufficient_budget',
              severity: 'critical',
              cheaperAlternatives: cheaperAlternatives.length
            }
          }
        });

        return {
          allowed: false,
          reason: `Insufficient budget: $${availableBudget.toFixed(4)} available, $${estimatedCost.toFixed(4)} required`,
          recommendedAction: allowDowngrade 
            ? 'Consider using a cheaper model from alternatives or increase your budget'
            : 'Increase your budget to continue',
          remainingBudget: availableBudget,
          cheaperAlternatives
        };
      }

      // Soft limit warning (approaching limit)
      if (usagePercentage >= threshold.soft && usagePercentage < threshold.hard) {
        const severity: 'low' | 'medium' | 'high' = 
          usagePercentage >= 0.95 ? 'high' : 
          usagePercentage >= 0.85 ? 'medium' : 'low';

        loggingService.warn('User approaching budget limit', {
          userId,
          usagePercentage,
          remainingBudget: availableBudget,
          estimatedCost,
          severity
        });

        // 🚨 P0: Emit real-time SSE threshold alert
        setImmediate(async () => {
          try {
            const { RealtimeUpdateService } = await import('./realtime-update.service');
            
            // Calculate projected exhaustion
            const currentSpend = budgetStatus.overall.used;
            const dailySpendRate = currentSpend / 30; // Rough estimate
            const daysRemaining = availableBudget / dailySpendRate;
            const exhaustionDate = new Date();
            exhaustionDate.setDate(exhaustionDate.getDate() + Math.floor(daysRemaining));

            RealtimeUpdateService.emitBudgetThreshold(userId, {
              threshold: threshold.soft,
              usagePercentage,
              budgetRemaining: availableBudget,
              projectedExhaustion: {
                daysRemaining: Math.floor(daysRemaining),
                exhaustionDate
              },
              recommendations: [
                'Review your highest-cost requests',
                'Enable Cortex optimization for 40-75% savings',
                'Use semantic caching to reduce repeated requests',
                'Consider switching to more efficient models'
              ]
            });
          } catch (error) {
            loggingService.error('Failed to emit budget threshold SSE', {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });

        // Emit warning event (legacy streaming)
        costStreamingService.emitCostEvent({
          eventType: 'budget_warning',
          timestamp: new Date(),
          userId,
          workspaceId,
          data: {
            estimatedCost,
            budgetRemaining: availableBudget,
            metadata: {
              reason: 'approaching_limit',
              severity,
              threshold: threshold.soft
            }
          }
        });
      }

      // Reserve budget if check passes
      const reservationId = await this.reserveBudget(userId, estimatedCost, projectId);

      return {
        allowed: true,
        remainingBudget: availableBudget - estimatedCost,
        reservationId
      };

    } catch (error) {
      loggingService.error('Pre-flight budget check failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        estimatedCost
      });
      
      // Fail-open in case of errors (but log them)
      return {
        allowed: true,
        reason: 'Budget check bypassed due to error',
        remainingBudget: 0
      };
    }
  }

  /**
   * Reserve budget before making LLM call
   */
  static async reserveBudget(
    userId: string,
    estimatedCost: number,
    projectId?: string
  ): Promise<string> {
    try {
      const reservationId = crypto.randomBytes(16).toString('hex');
      const timestamp = Date.now();
      const expiresAt = timestamp + this.RESERVATION_TTL;
      
      const reservation: BudgetReservation = {
        reservationId,
        userId,
        estimatedCost,
        timestamp,
        expiresAt
      };
      
      // Store reservation in Redis with TTL
      const key = `budget:reservation:${reservationId}`;
      await redisService.set(key, reservation, Math.ceil(this.RESERVATION_TTL / 1000));
      
      // Track reserved amount for user
      const userReservedKey = `budget:reserved:${userId}`;
      await redisService.incr(userReservedKey, estimatedCost);
      await redisService.client.expire(userReservedKey, 300); // 5 minutes expiry
      
      loggingService.info('Budget reserved', {
        reservationId,
        userId,
        estimatedCost,
        projectId
      });
      
      return reservationId;
      
    } catch (error) {
      loggingService.error('Error reserving budget', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        estimatedCost
      });
      throw error;
    }
  }

  /**
   * Release budget reservation (if request fails)
   */
  static async releaseBudget(reservationId: string): Promise<void> {
    try {
      const key = `budget:reservation:${reservationId}`;
      const reservation = await redisService.get(key) as BudgetReservation | null;
      
      if (reservation) {
        // Remove from reserved amount
        const userReservedKey = `budget:reserved:${reservation.userId}`;
        await redisService.incr(userReservedKey, -reservation.estimatedCost);
        
        // Delete reservation
        await redisService.del(key);
        
        loggingService.info('Budget released', {
          reservationId,
          userId: reservation.userId,
          estimatedCost: reservation.estimatedCost
        });
      }
    } catch (error) {
      loggingService.error('Error releasing budget', {
        error: error instanceof Error ? error.message : String(error),
        reservationId
      });
    }
  }

  /**
   * Confirm budget usage (after successful LLM call)
   */
  static async confirmBudget(
    reservationId: string,
    actualCost: number
  ): Promise<void> {
    try {
      const key = `budget:reservation:${reservationId}`;
      const reservation = await redisService.get(key) as BudgetReservation | null;
      
      if (reservation) {
        // Remove from reserved amount
        const userReservedKey = `budget:reserved:${reservation.userId}`;
        await redisService.incr(userReservedKey, -reservation.estimatedCost);
        
        // Delete reservation
        await redisService.del(key);
        
        const difference = actualCost - reservation.estimatedCost;
        
        loggingService.info('Budget confirmed', {
          reservationId,
          userId: reservation.userId,
          estimatedCost: reservation.estimatedCost,
          actualCost,
          difference
        });
      }
    } catch (error) {
      loggingService.error('Error confirming budget', {
        error: error instanceof Error ? error.message : String(error),
        reservationId,
        actualCost
      });
    }
  }

  /**
   * Get currently reserved budget for a user
   */
  static async getReservedBudget(userId: string): Promise<number> {
    try {
      const userReservedKey = `budget:reserved:${userId}`;
      const reserved = await redisService.get(userReservedKey);
      return reserved ? parseFloat(reserved) : 0;
    } catch (error) {
      loggingService.error('Error getting reserved budget', {
        error: error instanceof Error ? error.message : String(error),
        userId
      });
      return 0;
    }
  }

  /**
   * Get cached pricing for a model
   */
  private static async getCachedPricing(model: string): Promise<PricingCacheEntry | null> {
    try {
      const key = `pricing:cache:${model}`;
      const cached = await redisService.get(key);
      
      if (cached) {
        const now = Date.now();
        if (now - cached.lastUpdated < this.PRICING_CACHE_TTL) {
          return cached;
        }
      }
      
      return null;
    } catch (error) {
      loggingService.warn('Error getting cached pricing', {
        error: error instanceof Error ? error.message : String(error),
        model
      });
      return null;
    }
  }

  /**
   * Cache pricing data
   */
  private static async cachePricing(
    model: string,
    inputPrice: number,
    outputPrice: number
  ): Promise<void> {
    try {
      const key = `pricing:cache:${model}`;
      const entry: PricingCacheEntry = {
        inputPrice,
        outputPrice,
        lastUpdated: Date.now()
      };
      
      await redisService.set(key, entry, Math.ceil(this.PRICING_CACHE_TTL / 1000));
    } catch (error) {
      loggingService.warn('Error caching pricing', {
        error: error instanceof Error ? error.message : String(error),
        model
      });
    }
  }

  /**
   * Get static pricing from model pricing data
   */
  private static async getStaticPricing(model: string): Promise<{ inputPrice: number; outputPrice: number } | null> {
    try {
      // Import dynamically to avoid circular dependency
      const modelPricingModule = await import('../data/modelPricing');
      // modelPricingData is exported as a named export
      const modelPricingData = (modelPricingModule as { modelPricingData: any[] }).modelPricingData;
      
      if (!modelPricingData || !Array.isArray(modelPricingData)) {
        return null;
      }
      
      // Find model in pricing data
      const modelData = modelPricingData.find((m: any) => 
        m.model === model || 
        m.model.toLowerCase().includes(model.toLowerCase()) ||
        model.toLowerCase().includes(m.model.toLowerCase())
      );
      
      if (modelData) {
        return {
          inputPrice: modelData.inputPrice,
          outputPrice: modelData.outputPrice
        };
      }
      
      return null;
    } catch (error) {
      loggingService.warn('Error getting static pricing', {
        error: error instanceof Error ? error.message : String(error),
        model
      });
      return null;
    }
  }

  /**
   * Find cheaper model alternatives when budget is insufficient
   */
  private static async findCheaperAlternatives(
    currentEstimatedCost: number,
    availableBudget: number,
    projectId?: string
  ): Promise<Array<{
    model: string;
    provider: string;
    estimatedCost: number;
    savings: number;
  }>> {
    try {
      // Import model pricing data
      const modelPricingModule = await import('../data/modelPricing');
      const modelPricingData = (modelPricingModule as { modelPricingData: any[] }).modelPricingData;
      
      if (!modelPricingData || !Array.isArray(modelPricingData)) {
        return [];
      }

      // Calculate target cost (must be under available budget)
      const targetCost = availableBudget * 0.95; // Use 95% of available budget as safety margin
      const savingsRequired = currentEstimatedCost - targetCost;

      if (savingsRequired <= 0) {
        return [];
      }

      // Find models that would fit within budget
      const alternatives = modelPricingData
        .map((modelData: any) => {
          // Estimate cost for this model (assuming similar token usage)
          const avgCost = (modelData.inputPrice + modelData.outputPrice) / 2;
          const estimatedCost = currentEstimatedCost * (avgCost / (currentEstimatedCost / 1000)); // Rough estimate
          const savings = currentEstimatedCost - estimatedCost;

          return {
            model: modelData.model,
            provider: modelData.provider || 'unknown',
            estimatedCost: Math.max(0.0001, estimatedCost), // Minimum $0.0001
            savings,
            fitsInBudget: estimatedCost <= availableBudget
          };
        })
        .filter((alt: any) => alt.fitsInBudget && alt.savings > 0)
        .sort((a: any, b: any) => b.savings - a.savings)
        .slice(0, 5)
        .map(({ model, provider, estimatedCost, savings }: any) => ({
          model,
          provider,
          estimatedCost,
          savings
        }));

      loggingService.info('Generated cheaper alternatives', {
        projectId,
        currentEstimatedCost,
        availableBudget,
        alternativesCount: alternatives.length
      });

      return alternatives;
    } catch (error) {
      loggingService.error('Error finding cheaper alternatives', {
        error: error instanceof Error ? error.message : String(error),
        currentEstimatedCost,
        availableBudget
      });
      return [];
    }
  }
}
