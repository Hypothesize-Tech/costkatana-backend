import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ConfirmStripePaymentDto,
  CreatePayPalPlanDto,
  ApprovePayPalDto,
  CreateRazorpayOrderDto,
  ConfirmRazorpayPaymentDto,
} from './dto/payment.dto';

@Controller('api/user/subscription')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create-stripe-setup-intent')
  @HttpCode(HttpStatus.OK)
  async createStripeSetupIntent(@CurrentUser() user: any) {
    const result = await this.paymentService.createStripeSetupIntent(user.id);
    return {
      success: true,
      data: result,
    };
  }

  @Post('confirm-stripe-payment')
  @HttpCode(HttpStatus.OK)
  async confirmStripePayment(
    @CurrentUser() user: any,
    @Body() dto: ConfirmStripePaymentDto,
  ) {
    return this.paymentService.confirmStripePayment(user.id, dto);
  }

  @Post('create-paypal-plan')
  @HttpCode(HttpStatus.OK)
  async createPayPalPlan(
    @CurrentUser() user: any,
    @Body() dto: CreatePayPalPlanDto,
  ) {
    const result = await this.paymentService.createPayPalPlan(user.id, dto);
    return {
      success: true,
      data: result,
    };
  }

  @Post('approve-paypal')
  @HttpCode(HttpStatus.OK)
  async approvePayPalSubscription(
    @CurrentUser() user: any,
    @Body() dto: ApprovePayPalDto,
  ) {
    return this.paymentService.approvePayPalSubscription(user.id, dto);
  }

  @Post('create-razorpay-order')
  @HttpCode(HttpStatus.OK)
  async createRazorpayOrder(
    @CurrentUser() user: any,
    @Body() dto: CreateRazorpayOrderDto,
  ) {
    const result = await this.paymentService.createRazorpayOrder(user.id, dto);
    return {
      success: true,
      data: result,
    };
  }

  @Post('confirm-razorpay-payment')
  @HttpCode(HttpStatus.OK)
  async confirmRazorpayPayment(
    @CurrentUser() user: any,
    @Body() dto: ConfirmRazorpayPaymentDto,
  ) {
    return this.paymentService.confirmRazorpayPayment(user.id, dto);
  }
}
