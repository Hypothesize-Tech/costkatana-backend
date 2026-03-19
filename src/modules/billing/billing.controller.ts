import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { GetInvoicesQueryDto } from './dto/get-invoices-query.dto';
import { AddPaymentMethodDto } from './dto/add-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { CreateRazorpayPmOrderDto } from './dto/create-razorpay-pm-order.dto';
import { SaveRazorpayPaymentDto } from './dto/save-razorpay-payment.dto';

@Controller('api/billing')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly businessLogging: BusinessEventLoggingService,
  ) {}

  /**
   * Get billing history (invoices)
   * GET /api/billing/invoices
   */
  @Get('invoices')
  async getInvoices(
    @CurrentUser('id') userId: string,
    @Query() query: GetInvoicesQueryDto,
  ) {
    const startTime = Date.now();
    const { invoices, total } = await this.billingService.getInvoices(
      userId,
      query.limit ?? 10,
      query.offset ?? 0,
    );

    this.businessLogging.logBusiness({
      event: 'invoices_retrieved',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        total,
        limit: query.limit,
        offset: query.offset,
      },
    });

    return {
      success: true,
      data: {
        invoices,
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + query.limit < total,
        },
      },
    };
  }

  /**
   * Get upcoming invoice preview
   * GET /api/billing/invoices/upcoming
   */
  @Get('invoices/upcoming')
  async getUpcomingInvoice(@CurrentUser('id') userId: string) {
    const startTime = Date.now();
    const upcomingInvoice =
      await this.billingService.getUpcomingInvoice(userId);

    this.businessLogging.logBusiness({
      event: 'upcoming_invoice_retrieved',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        hasUpcomingInvoice: !!upcomingInvoice,
      },
    });

    return {
      success: true,
      data: upcomingInvoice,
      message: upcomingInvoice
        ? undefined
        : 'No upcoming invoice for free plan',
    };
  }

  /**
   * Get single invoice
   * GET /api/billing/invoices/:invoiceId
   */
  @Get('invoices/:invoiceId')
  async getInvoice(
    @CurrentUser('id') userId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    const startTime = Date.now();
    const invoice = await this.billingService.getInvoice(userId, invoiceId);

    this.businessLogging.logBusiness({
      event: 'invoice_retrieved',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        invoiceId,
      },
    });

    return {
      success: true,
      data: invoice,
    };
  }

  /**
   * Get payment methods
   * GET /api/billing/payment-methods
   */
  @Get('payment-methods')
  async getPaymentMethods(@CurrentUser('id') userId: string) {
    const startTime = Date.now();
    const paymentMethods = await this.billingService.getPaymentMethods(userId);

    this.businessLogging.logBusiness({
      event: 'payment_methods_retrieved',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        count: paymentMethods.length,
      },
    });

    return {
      success: true,
      data: paymentMethods,
    };
  }

  /**
   * Create Razorpay order for payment method collection
   * POST /api/billing/payment-methods/razorpay/create-order
   */
  @Post('payment-methods/razorpay/create-order')
  async createRazorpayPaymentMethodOrder(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRazorpayPmOrderDto,
  ) {
    const startTime = Date.now();
    const result = await this.billingService.createRazorpayPaymentMethodOrder(
      userId,
      dto,
    );

    this.businessLogging.logBusiness({
      event: 'razorpay_order_created',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        orderId: result.orderId,
        amount: dto.amount,
        currency: dto.currency,
      },
    });

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Save Razorpay payment method after successful checkout
   * POST /api/billing/payment-methods/razorpay/save
   */
  @Post('payment-methods/razorpay/save')
  async saveRazorpayPaymentMethod(
    @CurrentUser('id') userId: string,
    @Body() dto: SaveRazorpayPaymentDto,
  ) {
    const startTime = Date.now();
    const paymentMethod = await this.billingService.saveRazorpayPaymentMethod(
      userId,
      dto,
    );

    this.businessLogging.logBusiness({
      event: 'razorpay_payment_method_saved',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        paymentId: dto.paymentId,
        setAsDefault: dto.setAsDefault,
      },
    });

    return {
      success: true,
      message: 'Payment method saved successfully',
      data: paymentMethod,
    };
  }

  /**
   * Add payment method
   * POST /api/billing/payment-methods
   * PCI: Raw card data (cardDetails) is explicitly rejected.
   */
  @Post('payment-methods')
  async addPaymentMethod(
    @CurrentUser('id') userId: string,
    @Body() dto: AddPaymentMethodDto,
    @Req() req: { body?: Record<string, unknown> },
  ) {
    if (req.body?.cardDetails) {
      throw new BadRequestException(
        'Raw card data (cardDetails) cannot be sent for PCI compliance. ' +
          'Use paymentMethodId (Stripe) or razorpayTokenId (Razorpay) instead.',
      );
    }
    const startTime = Date.now();
    const paymentMethod = await this.billingService.addPaymentMethod(
      userId,
      dto,
    );

    this.businessLogging.logBusiness({
      event: 'payment_method_added',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        gateway: dto.gateway,
        type: dto.type,
        setAsDefault: dto.setAsDefault,
      },
    });

    return {
      success: true,
      message: 'Payment method added successfully',
      data: paymentMethod,
    };
  }

  /**
   * Update payment method
   * PUT /api/billing/payment-methods/:paymentMethodId
   */
  @Put('payment-methods/:paymentMethodId')
  async updatePaymentMethod(
    @CurrentUser('id') userId: string,
    @Param('paymentMethodId') paymentMethodId: string,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    const startTime = Date.now();
    const paymentMethod = await this.billingService.updatePaymentMethod(
      userId,
      paymentMethodId,
      dto,
    );

    this.businessLogging.logBusiness({
      event: 'payment_method_updated',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        paymentMethodId,
        setAsDefault: dto.setAsDefault,
      },
    });

    return {
      success: true,
      message: 'Payment method updated successfully',
      data: paymentMethod,
    };
  }

  /**
   * Remove payment method
   * DELETE /api/billing/payment-methods/:paymentMethodId
   */
  @Delete('payment-methods/:paymentMethodId')
  async removePaymentMethod(
    @CurrentUser('id') userId: string,
    @Param('paymentMethodId') paymentMethodId: string,
  ) {
    const startTime = Date.now();
    await this.billingService.removePaymentMethod(userId, paymentMethodId);

    this.businessLogging.logBusiness({
      event: 'payment_method_removed',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        userId,
        paymentMethodId,
      },
    });

    return {
      success: true,
      message: 'Payment method removed successfully',
    };
  }

  /**
   * Get payment gateway configuration (public keys only)
   * GET /api/billing/payment-config
   */
  @Get('payment-config')
  async getPaymentConfig() {
    const startTime = Date.now();
    const config = this.billingService.getPaymentConfig();

    this.businessLogging.logBusiness({
      event: 'payment_config_retrieved',
      category: 'billing_management',
      value: Date.now() - startTime,
      metadata: {
        gatewaysConfigured: Object.keys(config).length,
      },
    });

    return {
      success: true,
      data: config,
    };
  }
}
