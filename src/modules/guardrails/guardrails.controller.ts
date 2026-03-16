import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { GuardrailsService } from './guardrails.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CheckGuardrailsDto } from './dto/check-guardrails.dto';
import { TrackUsageDto } from './dto/track-usage.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SimulateUsageDto } from './dto/simulate-usage.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { Activity } from '../../schemas/team-project/activity.schema';
import { Alert } from '../../schemas/core/alert.schema';
import { Usage } from '../../schemas/core/usage.schema';

interface AuthenticatedRequest {
  user?: { id: string; _id?: string; role?: string };
  userId?: string;
}

const PLAN_LIMITS_PUBLIC: Record<string, Record<string, unknown>> = {
  free: {
    tokensPerMonth: 1_000_000,
    requestsPerMonth: 5_000,
    logsPerMonth: 5_000,
    projects: 1,
    workflows: 10,
    seats: 1,
    cortexDailyUsage: 0,
    models: ['claude-3-haiku', 'gpt-3.5-turbo', 'gemini-1.5-flash'],
    price: 0,
  },
  plus: {
    tokensPerMonth: 2_000_000,
    requestsPerMonth: 10_000,
    logsPerMonth: 'unlimited',
    projects: 'unlimited',
    workflows: 100,
    seats: 1,
    cortexDailyUsage: 0,
    models: 'all',
    price: 25,
  },
  pro: {
    tokensPerMonth: 5_000_000,
    requestsPerMonth: 50_000,
    logsPerMonth: 'unlimited',
    projects: 'unlimited',
    workflows: 100,
    seats: 20,
    cortexDailyUsage: 0,
    models: 'all',
    price: 499,
  },
  enterprise: {
    tokensPerMonth: 'unlimited',
    requestsPerMonth: 'unlimited',
    logsPerMonth: 'unlimited',
    projects: 'unlimited',
    workflows: 'unlimited',
    seats: 'custom',
    cortexDailyUsage: 'unlimited',
    models: 'all + custom',
    price: 'custom',
  },
};

@Controller('api/guardrails')
@UseGuards(JwtAuthGuard)
export class GuardrailsController {
  constructor(
    private readonly guardrailsService: GuardrailsService,
    private readonly subscriptionService: SubscriptionService,
    @InjectModel(Activity.name) private activityModel: Model<Activity>,
    @InjectModel(Alert.name) private alertModel: Model<Alert>,
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
  ) {}

  @Get('usage')
  async getUserUsage(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id ?? req.user?._id ?? req.userId;
    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }
    const stats = await this.guardrailsService.getUserUsageStats(userId);
    if (!stats) {
      return { success: false, message: 'User not found' };
    }
    return { success: true, data: stats };
  }

  @Get('usage/trend')
  async getUsageTrend(
    @Req() req: AuthenticatedRequest,
    @Query('days') daysStr?: string,
  ): Promise<
    | { success: false; message: string }
    | {
        success: true;
        data: Array<{
          date: string;
          requests: number;
          tokens: number;
          cost: number;
        }>;
      }
  > {
    const userId = req.user?.id ?? req.user?._id ?? req.userId;
    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }
    const days = Math.min(Math.max(parseInt(daysStr ?? '7', 10) || 7, 1), 90);
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setHours(23, 59, 59, 999);
    const dateBoundaries: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dateBoundaries.push(d.toISOString().split('T')[0]);
    }
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const trendData = await this.usageModel.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          requests: { $sum: 1 },
          tokens: { $sum: '$totalTokens' },
          cost: { $sum: '$cost' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const dataMap = new Map(
      trendData.map(
        (item: {
          _id: string;
          requests: number;
          tokens: number;
          cost: number;
        }) => [
          item._id,
          { requests: item.requests, tokens: item.tokens, cost: item.cost },
        ],
      ),
    );
    const trend = dateBoundaries.map((dateStr) => {
      const data = dataMap.get(dateStr);
      return {
        date: dateStr,
        requests: data?.requests ?? 0,
        tokens: data?.tokens ?? 0,
        cost: data?.cost ?? 0,
      };
    });
    return { success: true, data: trend };
  }

  @Get('usage/alerts')
  async getUsageAlerts(
    @Req() req: AuthenticatedRequest,
  ): Promise<
    { success: false; message: string } | { success: true; data: unknown[] }
  > {
    const userId = req.user?.id ?? req.user?._id ?? req.userId;
    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }
    const alerts = await this.alertModel
      .find({
        userId: new mongoose.Types.ObjectId(userId),
        type: 'usage_spike',
        read: false,
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    return { success: true, data: alerts };
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  async checkGuardrails(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CheckGuardrailsDto,
  ) {
    const userId = req.user?.id ?? req.user?._id ?? req.userId;
    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }
    const violation = await this.guardrailsService.checkRequestGuardrails(
      userId,
      dto.requestType,
      dto.amount ?? 1,
      dto.modelId,
    );
    return {
      success: true,
      data: {
        allowed: !violation || violation.action === 'allow',
        violation,
      },
    };
  }

  @Get('plans/:plan')
  getPlanLimits(@Param('plan') plan: string) {
    const limits = PLAN_LIMITS_PUBLIC[plan];
    if (!limits) {
      return { success: false, message: 'Invalid plan' };
    }
    return { success: true, data: limits };
  }

  @Put('subscription')
  async updateSubscription(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    const userId = req.user?.id ?? req.user?._id ?? req.userId;
    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }
    const updated = await this.subscriptionService.updatePlanAndSeats(
      userId,
      dto.plan,
      dto.seats,
    );
    await this.activityModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      type: 'subscription_changed',
      title: 'Subscription Updated',
      description: `Subscription updated to ${dto.plan} plan`,
      metadata: { newPlan: dto.plan, seats: dto.seats },
    });
    return {
      success: true,
      message: 'Subscription updated successfully',
      data: updated?.usage ?? {},
    };
  }

  @Post('usage/track')
  async trackUsage(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TrackUsageDto,
  ) {
    return this.trackUsageInternal(req, dto, undefined);
  }

  @Post('usage/track/:userId')
  async trackUsageForUser(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TrackUsageDto,
    @Param('userId') targetUserId: string,
  ) {
    return this.trackUsageInternal(req, dto, targetUserId);
  }

  private async trackUsageInternal(
    req: AuthenticatedRequest,
    dto: TrackUsageDto,
    targetUserIdFromPath?: string,
  ) {
    const userId = req.user?.id ?? req.user?._id ?? req.userId;
    const target = targetUserIdFromPath ?? dto.userId ?? userId;
    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }
    if (!target) {
      return { success: false, message: 'Target user required' };
    }
    if ((req.user as { role?: string })?.role !== 'admin') {
      return { success: false, message: 'Admin access required' };
    }
    await this.guardrailsService.trackUsage(target, {
      tokens: dto.tokens,
      requests: dto.requests,
      logs: dto.logs,
      cost: dto.cost,
    });
    return { success: true, message: 'Usage tracked successfully' };
  }

  @Post('usage/reset')
  async resetMonthlyUsage(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id ?? req.user?._id ?? req.userId;
    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }
    if ((req.user as { role?: string })?.role !== 'admin') {
      return { success: false, message: 'Admin access required' };
    }
    await this.guardrailsService.resetMonthlyUsage();
    return { success: true, message: 'Monthly usage reset successfully' };
  }

  @Post('usage/simulate')
  async simulateUsage(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SimulateUsageDto,
  ) {
    const userId = req.user?.id ?? req.user?._id ?? req.userId;
    if (
      (req.user as { role?: string })?.role !== 'admin' ||
      process.env.NODE_ENV === 'production'
    ) {
      throw new HttpException(
        {
          statusCode: 503,
          error: 'Service Unavailable',
          message:
            'Usage simulation is not available in production. This endpoint is for development and testing only.',
        },
        503,
      );
    }
    const targetUserId = dto.userId ?? userId;
    if (!targetUserId) {
      return { success: false, message: 'User not found' };
    }
    const sub =
      await this.subscriptionService.getSubscriptionByUserId(targetUserId);
    const limits =
      sub?.usageLimits ??
      ({} as { tokensPerMonth?: number; requestsPerMonth?: number });
    const tokensPerMonth =
      typeof limits.tokensPerMonth === 'number'
        ? limits.tokensPerMonth
        : 1000000;
    const requestsPerMonth =
      typeof limits.requestsPerMonth === 'number'
        ? limits.requestsPerMonth
        : 10000;
    const simulatedUsage = {
      tokens: Math.floor(tokensPerMonth * (dto.percentage / 100)),
      requests: Math.floor(requestsPerMonth * (dto.percentage / 100)),
      cost: Math.floor(100 * (dto.percentage / 100)),
    };
    await this.guardrailsService.trackUsage(targetUserId, simulatedUsage);
    return {
      success: true,
      message: `Simulated ${dto.percentage}% usage for user`,
      data: simulatedUsage,
    };
  }
}
