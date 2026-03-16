import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionNotificationService } from './subscription-notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  UpgradeSubscriptionDto,
  DowngradeSubscriptionDto,
  CancelSubscriptionDto,
  PauseSubscriptionDto,
  UpdatePaymentMethodDto,
  UpdateBillingCycleDto,
  ValidateDiscountDto,
  ApplyDiscountDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';

@Controller('api/user')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly subscriptionNotificationService: SubscriptionNotificationService,
  ) {}

  @Get('subscription')
  async getSubscription(@CurrentUser() user: any) {
    const data = await this.subscriptionService.getSubscriptionForApi(
      user.id,
    );
    return {
      success: true,
      message: 'Subscription retrieved successfully',
      data,
    };
  }

  @Put('subscription')
  async updateSubscription(
    @CurrentUser() user: any,
    @Body() updateData: UpdateSubscriptionDto,
  ) {
    const subscription = await this.subscriptionService.updateSubscription(
      user.id,
      updateData.plan,
      updateData.paymentGateway,
      updateData.paymentMethodId,
      {
        interval: updateData.interval,
        discountCode: updateData.discountCode,
      },
    );

    return {
      success: true,
      message: 'Subscription updated successfully',
      data: subscription,
    };
  }

  @Post('subscription/upgrade')
  @HttpCode(HttpStatus.OK)
  async upgradeSubscription(
    @CurrentUser() user: any,
    @Body() upgradeData: UpgradeSubscriptionDto,
  ) {
    const subscription = await this.subscriptionService.upgradeSubscription(
      user.id,
      upgradeData.plan,
      upgradeData.paymentGateway,
      upgradeData.paymentMethodId,
      {
        interval: upgradeData.interval,
        discountCode: upgradeData.discountCode,
      },
    );

    // Send notification email
    const userDoc = { _id: user.id, email: user.email, name: user.name };
    await this.subscriptionNotificationService.sendSubscriptionUpgradedEmail(
      userDoc as any,
      subscription.metadata?.upgradedFrom || 'free',
      subscription.plan,
    );

    return {
      success: true,
      message: 'Subscription upgraded successfully',
      data: subscription,
    };
  }

  @Post('subscription/downgrade')
  @HttpCode(HttpStatus.OK)
  async downgradeSubscription(
    @CurrentUser() user: any,
    @Body() downgradeData: DowngradeSubscriptionDto,
  ) {
    const currentSubscription =
      await this.subscriptionService.getSubscriptionByUserId(user.id);
    const subscription = await this.subscriptionService.downgradeSubscription(
      user.id,
      downgradeData.plan,
      downgradeData.scheduleForPeriodEnd,
    );

    // Send notification email
    const userDoc = { _id: user.id, email: user.email, name: user.name };
    await this.subscriptionNotificationService.sendSubscriptionDowngradedEmail(
      userDoc as any,
      currentSubscription?.plan || 'free',
      subscription.plan,
      subscription.currentPeriodEnd || new Date(),
    );

    return {
      success: true,
      message: 'Subscription downgrade scheduled successfully',
      data: subscription,
    };
  }

  @Post('subscription/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSubscription(
    @CurrentUser() user: any,
    @Body() cancelData: CancelSubscriptionDto,
  ) {
    const subscription = await this.subscriptionService.cancelSubscription(
      user.id,
      cancelData.cancelAtPeriodEnd,
      cancelData.reason,
    );

    // Send notification email
    const userDoc = { _id: user.id, email: user.email, name: user.name };
    await this.subscriptionNotificationService.sendSubscriptionCanceledEmail(
      userDoc as any,
      subscription,
      new Date(),
    );

    return {
      success: true,
      message: 'Subscription canceled successfully',
      data: subscription,
    };
  }

  @Post('subscription/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivateSubscription(@CurrentUser() user: any) {
    const subscription = await this.subscriptionService.reactivateSubscription(
      user.id,
    );

    // Send notification email
    const userDoc = { _id: user.id, email: user.email, name: user.name };
    await this.subscriptionNotificationService.sendSubscriptionReactivatedEmail(
      userDoc as any,
      subscription,
    );

    return {
      success: true,
      message: 'Subscription reactivated successfully',
      data: subscription,
    };
  }

  @Post('subscription/pause')
  @HttpCode(HttpStatus.OK)
  async pauseSubscription(
    @CurrentUser() user: any,
    @Body() pauseData: PauseSubscriptionDto,
  ) {
    const subscription = await this.subscriptionService.pauseSubscription(
      user.id,
      pauseData.reason,
    );

    return {
      success: true,
      message: 'Subscription paused successfully',
      data: subscription,
    };
  }

  @Post('subscription/resume')
  @HttpCode(HttpStatus.OK)
  async resumeSubscription(@CurrentUser() user: any) {
    const subscription = await this.subscriptionService.resumeSubscription(
      user.id,
    );

    return {
      success: true,
      message: 'Subscription resumed successfully',
      data: subscription,
    };
  }

  @Put('subscription/payment-method')
  async updatePaymentMethod(
    @CurrentUser() user: any,
    @Body() paymentData: UpdatePaymentMethodDto,
  ) {
    const subscription = await this.subscriptionService.updatePaymentMethod(
      user.id,
      paymentData.paymentMethodId,
    );

    return {
      success: true,
      message: 'Payment method updated successfully',
      data: subscription,
    };
  }

  @Put('subscription/billing-cycle')
  async updateBillingCycle(
    @CurrentUser() user: any,
    @Body() billingData: UpdateBillingCycleDto,
  ) {
    const subscription = await this.subscriptionService.updateBillingCycle(
      user.id,
      billingData.interval,
    );

    return {
      success: true,
      message: 'Billing cycle updated successfully',
      data: subscription,
    };
  }

  @Post('subscription/validate-discount')
  @HttpCode(HttpStatus.OK)
  async validateDiscountCode(
    @CurrentUser() user: any,
    @Body() discountData: ValidateDiscountDto,
  ) {
    const result = await this.subscriptionService.validateDiscountCode(
      discountData.code,
      discountData.plan,
      discountData.amount,
    );

    return {
      success: true,
      data: result,
    };
  }

  @Post('subscription/discount')
  @HttpCode(HttpStatus.OK)
  async applyDiscountCode(
    @CurrentUser() user: any,
    @Body() discountData: ApplyDiscountDto,
  ) {
    const subscription = await this.subscriptionService.applyDiscountCode(
      user.id,
      discountData.code,
    );

    return {
      success: true,
      message: 'Discount code applied successfully',
      data: subscription,
    };
  }

  @Get('subscription/plans')
  async getAvailablePlans(@CurrentUser() user: any) {
    const subscription = await this.subscriptionService.getSubscriptionByUserId(
      user.id,
    );
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const availableUpgrades = this.subscriptionService.getAvailableUpgrades(
      subscription.plan,
    );
    const allPlans = ['free', 'plus', 'pro', 'enterprise'] as const;

    const plans = allPlans.map((plan) => {
      const limits = this.subscriptionService.getPlanLimits(plan);
      const pricing = this.subscriptionService.getPlanPricing(plan, 'monthly');
      const yearlyPricing = this.subscriptionService.getPlanPricing(
        plan,
        'yearly',
      );

      return {
        plan,
        limits,
        pricing: {
          monthly: pricing.amount,
          yearly: yearlyPricing.amount,
          currency: pricing.currency,
        },
        canUpgrade: availableUpgrades.includes(plan as any),
        isCurrent: subscription.plan === plan,
      };
    });

    return {
      success: true,
      data: {
        currentPlan: subscription.plan,
        availableUpgrades,
        plans,
      },
    };
  }

  @Get('subscription/usage')
  async getUsageAnalytics(
    @CurrentUser() user: any,
    @Query('period') period?: 'daily' | 'weekly' | 'monthly',
  ) {
    const analytics = await this.subscriptionService.getUsageAnalytics(
      user.id,
      period || 'monthly',
    );

    return {
      success: true,
      data: analytics,
    };
  }

  @Get('subscription/history')
  async getSubscriptionHistory(@CurrentUser() user: any) {
    const history = await this.subscriptionService.getSubscriptionHistory(
      user.id,
    );

    return {
      success: true,
      data: history,
    };
  }

  @Get('spending')
  async getUserSpending(
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('service') service?: string,
    @Query('model') model?: string,
    @Query('projectId') projectId?: string,
  ) {
    const filters: any = {};

    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (service) filters.service = service;
    if (model) filters.model = model;
    if (projectId) filters.projectId = projectId;

    const spending = await this.subscriptionService.getUserSpending(
      user.id,
      filters,
    );

    return {
      success: true,
      data: spending,
    };
  }
}
